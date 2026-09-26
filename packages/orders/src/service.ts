import { randomBytes } from "node:crypto";
import { and, count, eq, inArray, sql } from "drizzle-orm";
import {
  couponRedemptions,
  coupons,
  customers,
  deliveries,
  deliveryZones,
  orderItems,
  orderNumberSeq,
  orderStatusHistory,
  orders,
  paymentEvents,
  payments,
  refunds,
  returns,
  settings,
  staffUsers,
  type Database,
  type DbOrTx,
  type Order,
  type Payment,
} from "@ugmall/database";
import { inventory, type StockReservations } from "@ugmall/inventory";
import { DeliveryError, quoteDelivery, resolveLocation, type ResolvedLocation } from "@ugmall/delivery";
import type { PaymentRegistry, VerifyPaymentResult } from "@ugmall/payments";
import type { NotificationEvent } from "@ugmall/notifications";
import {
  codAllowed,
  DEFAULT_COD_MAX_ORDER_TOTAL,
  canTransition,
  formatOrderNumber,
  isPrepaid,
  normalizeUgPhone,
  ORDER_STATUS_LABELS,
  type CheckoutInput,
  type OrderSource,
  type OrderStatus,
  type PaymentMethod,
} from "@ugmall/shared";
import { priceLines, type PricedLine } from "./catalog";
import { computeCouponDiscount, CouponError } from "./coupons";

export class OrderError extends Error {
  constructor(
    message: string,
    public code:
      | "INVALID_TRANSITION"
      | "NOT_FOUND"
      | "RESERVATION_EXPIRED"
      | "OUT_OF_STOCK"
      | "INVALID"
      | "PAYMENT"
      | "COUPON" = "INVALID",
    public details?: unknown,
  ) {
    super(message);
  }
}

export type Actor =
  | { type: "system"; id?: string }
  | { type: "customer"; id?: string }
  | { type: "staff"; id: string }
  | { type: "rider"; id: string }
  | { type: "payment"; id?: string };

/** Side effects the orders module needs from the outside world (queues). */
export interface OrderEffects {
  notify(event: NotificationEvent, orderId: string, extra?: Record<string, unknown>): Promise<void>;
  schedulePaymentCheck(paymentId: string, delayMs: number): Promise<void>;
  scheduleOrderExpiry(orderId: string, delayMs: number): Promise<void>;
}

export interface OrderServiceConfig {
  /** How long a customer has to approve Mobile Money before the order is cancelled. */
  paymentTimeoutMinutes: number;
  /** Public base URL of the API (for provider callbacks). */
  apiPublicUrl: string;
  /** Public base URL of the storefront (for tracking links). */
  storefrontUrl: string;
}

const STATUS_TO_EVENT: Partial<Record<OrderStatus, NotificationEvent>> = {
  paid: "payment_confirmed",
  confirmed: "order_confirmed",
  out_for_delivery: "rider_dispatched",
  delivered: "delivered",
  cancelled: "cancelled",
};

export const newPaymentReference = (prefix = "PAY") => `${prefix}-${Date.now().toString(36)}-${randomBytes(5).toString("hex")}`.toUpperCase();

export class OrderService {
  constructor(
    private db: Database,
    private reservations: StockReservations,
    private paymentsRegistry: PaymentRegistry,
    private effects: OrderEffects,
    private config: OrderServiceConfig,
  ) {}

  trackingUrl(order: Pick<Order, "orderNumber" | "trackingToken">) {
    return `${this.config.storefrontUrl.replace(/\/$/, "")}/orders/${order.orderNumber}?t=${order.trackingToken}`;
  }

  /* ------------------------------------------------------------ quoting */

  async quote(input: {
    lines: { variantId: string; quantity: number }[];
    locationId?: number | null;
    deliveryZoneId?: string | null;
    deliveryMethod: CheckoutInput["deliveryMethod"];
    couponCode?: string | null;
    phone?: string | null;
  }) {
    const lines = await priceLines(this.db, input.lines);
    const subtotal = lines.reduce((s, l) => s + l.lineTotal, 0);
    const weight = lines.reduce((s, l) => s + l.weightGrams, 0);
    // Zone comes from the customer's area (nearest zone up the region › district › … tree).
    // Staff creating orders may still pass a zone explicitly.
    let location: ResolvedLocation | null = null;
    let zone: typeof deliveryZones.$inferSelect | null = null;
    if (input.deliveryZoneId) {
      zone = (await this.db.select().from(deliveryZones).where(eq(deliveryZones.id, input.deliveryZoneId)))[0] ?? null;
    } else if (input.locationId) {
      location = await resolveLocation(this.db, input.locationId);
      if (!location) throw new DeliveryError("Please choose your area again");
      zone = location.zone;
      if (!zone) throw new DeliveryError(`We don't deliver to ${location.location.name} yet — please contact us on WhatsApp`);
    }
    const delivery = quoteDelivery({ zone, method: input.deliveryMethod, subtotal, totalWeightGrams: weight });
    if (location?.moreSpecificMayDiffer && delivery.isFinal) {
      delivery.isFinal = false;
      delivery.description += " — choose your exact area for the final fee";
    }
    let discount = 0;
    let coupon: typeof coupons.$inferSelect | null = null;
    let couponError: string | null = null;
    if (input.couponCode) {
      try {
        const r = await this.resolveCoupon(this.db, input.couponCode, subtotal, delivery.fee, input.phone ?? null);
        discount = r.discount;
        coupon = r.coupon;
      } catch (err) {
        if (err instanceof CouponError || err instanceof OrderError) couponError = err.message;
        else throw err;
      }
    }
    const total = Math.max(0, subtotal + delivery.fee - discount);
    return { lines, subtotal, delivery, zone, location, discount, coupon, couponError, total, weightGrams: weight };
  }

  private async resolveCoupon(db: DbOrTx, code: string, subtotal: number, deliveryFee: number, phone: string | null) {
    const [coupon] = await db
      .select()
      .from(coupons)
      .where(sql`upper(${coupons.code}) = upper(${code.trim()})`);
    if (!coupon) throw new CouponError("Coupon code not found");
    const discount = computeCouponDiscount(coupon, subtotal, deliveryFee);
    if (phone) {
      const [used] = await db
        .select({ n: count() })
        .from(couponRedemptions)
        .where(and(eq(couponRedemptions.couponId, coupon.id), eq(couponRedemptions.phone, phone)));
      if ((used?.n ?? 0) >= coupon.maxUsesPerCustomer) throw new CouponError("You have already used this coupon");
    }
    return { coupon, discount };
  }

  /* ------------------------------------------------------------ placing */

  /**
   * Places an order:
   *  1. make sure the customer holds a live Redis reservation for the lines
   *  2. in ONE transaction: upsert customer, insert order + items, move the
   *     hold into a durable DB reservation (conditional UPDATE — can't oversell),
   *     redeem coupon, write history, create the payment row
   *  3. drop the Redis hold, start the payment (MoMo prompt) and notify
   */
  async placeOrder(input: CheckoutInput, ctx: { source: OrderSource; customerId?: string | null; staffId?: string | null }) {
    const phone = normalizeUgPhone(input.phone)!;
    const altPhone = input.altPhone ? normalizeUgPhone(input.altPhone) : null;
    const paymentPhone = input.paymentPhone ? normalizeUgPhone(input.paymentPhone) : phone;
    const provider = this.paymentsRegistry.forMethod(input.paymentMethod);

    // 1. Reservation
    let reservation = input.reservationId ? await this.reservations.get(input.reservationId) : null;
    let heldHere = false;
    if (!reservation) {
      if (!input.items?.length) throw new OrderError("Your checkout session expired. Please review your cart.", "RESERVATION_EXPIRED");
      const r = await this.reservations.reserve(input.items, input.reservationId);
      if (!r.ok) throw new OrderError("Some items are no longer available in the quantity you want", "OUT_OF_STOCK", r.shortages);
      reservation = r.reservation;
      heldHere = true;
    }
    try {
      return await this.placeReserved(input, ctx, reservation, { phone, altPhone, paymentPhone, provider });
    } catch (err) {
      // A hold created just for this attempt must not linger if the order is refused.
      if (heldHere) await this.reservations.release(reservation.id).catch(() => {});
      throw err;
    }
  }

  private async placeReserved(
    input: CheckoutInput,
    ctx: { source: OrderSource; customerId?: string | null; staffId?: string | null },
    reservation: NonNullable<Awaited<ReturnType<StockReservations["get"]>>>,
    p: { phone: string; altPhone: string | null; paymentPhone: string | null; provider: ReturnType<PaymentRegistry["forMethod"]> },
  ) {
    const { phone, altPhone, paymentPhone, provider } = p;

    const q = await this.quote({
      lines: reservation.items,
      locationId: input.locationId,
      deliveryZoneId: input.deliveryZoneId,
      deliveryMethod: input.deliveryMethod,
      couponCode: input.couponCode || null,
      phone,
    });
    if (q.couponError) throw new OrderError(q.couponError, "COUPON");
    if (input.paymentMethod === "cash_on_delivery") {
      const limit = await this.codLimit();
      if (!codAllowed(q.total, limit)) {
        throw new OrderError(
          `Cash on Delivery is available for orders up to UGX ${limit.toLocaleString("en-US")}. Please pay this order (UGX ${q.total.toLocaleString("en-US")}) with MTN or Airtel Mobile Money.`,
          "PAYMENT",
        );
      }
    }
    const prepaid = isPrepaid(input.paymentMethod);
    const status: OrderStatus = prepaid ? "awaiting_payment" : "pending";
    const expiresAt = prepaid ? new Date(Date.now() + this.config.paymentTimeoutMinutes * 60_000) : null;

    const { order, payment } = await this.db.transaction(async (tx) => {
      // customer (guest checkout creates/updates a customer record keyed by phone)
      const [customer] = await tx
        .insert(customers)
        .values({ name: input.customerName, phone, altPhone, email: input.email || null, lastOrderAt: new Date() })
        .onConflictDoUpdate({
          target: customers.phone,
          set: { name: input.customerName, altPhone: altPhone ?? sql`${customers.altPhone}`, lastOrderAt: new Date() },
        })
        .returning();
      if (customer!.isBlocked) throw new OrderError("We can't accept orders from this number. Please contact us on WhatsApp.");

      const [{ seq }] = (await tx.execute(sql`select nextval(${orderNumberSeq.seqName}) as seq`)) as unknown as [{ seq: string }];
      const orderNumber = formatOrderNumber(new Date().getFullYear(), Number(seq));

      const [order] = await tx
        .insert(orders)
        .values({
          orderNumber,
          trackingToken: randomBytes(18).toString("base64url"),
          customerId: ctx.customerId ?? customer!.id,
          customerName: input.customerName,
          phone,
          altPhone,
          email: input.email || null,
          district: q.location?.district ?? (input.district || "-"),
          area: input.nearbyPlace || q.location?.area || input.area || "-",
          address: input.address,
          locationId: q.location?.location.id ?? input.locationId ?? null,
          locationPath: q.location?.location.path ?? null,
          nearbyPlace: input.nearbyPlace || null,
          deliveryZoneId: q.zone?.id ?? null,
          deliveryMethod: input.deliveryMethod,
          paymentMethod: input.paymentMethod,
          status,
          source: ctx.source,
          subtotal: q.subtotal,
          deliveryFee: q.delivery.fee,
          discount: q.discount,
          total: q.total,
          costTotal: q.lines.reduce((s, l) => s + l.unitCost * l.quantity, 0),
          couponCode: q.coupon?.code ?? null,
          notes: input.notes || null,
          stockReserved: true,
          createdByStaff: ctx.staffId ?? null,
          expiresAt,
        })
        .returning();

      await tx.insert(orderItems).values(
        q.lines.map((l: PricedLine) => ({
          orderId: order!.id,
          productId: l.productId,
          variantId: l.variantId,
          productName: l.productName,
          variantLabel: l.variantLabel,
          sku: l.sku,
          imageUrl: l.imageUrl,
          unitPrice: l.unitPrice,
          unitCost: l.unitCost,
          quantity: l.quantity,
          lineTotal: l.lineTotal,
        })),
      );

      try {
        await inventory.reserveForOrder(tx, reservation!.items, order!.id);
      } catch (err) {
        throw new OrderError("Some items just sold out. Please review your cart.", "OUT_OF_STOCK", (err as Error).message);
      }

      if (q.coupon && q.discount > 0) {
        const updated = await tx
          .update(coupons)
          .set({ usedCount: sql`${coupons.usedCount} + 1` })
          .where(and(eq(coupons.id, q.coupon.id), sql`(${coupons.maxUses} is null or ${coupons.usedCount} < ${coupons.maxUses})`))
          .returning({ id: coupons.id });
        if (!updated.length) throw new OrderError("This coupon has just been fully used", "COUPON");
        await tx.insert(couponRedemptions).values({ couponId: q.coupon.id, orderId: order!.id, customerId: customer!.id, phone, amount: q.discount });
      }

      await tx.insert(orderStatusHistory).values({
        orderId: order!.id,
        fromStatus: null,
        toStatus: status,
        note: `Order placed via ${ctx.source}`,
        actorType: ctx.staffId ? "staff" : "customer",
        actorId: ctx.staffId ?? customer!.id,
      });

      const [payment] = await tx
        .insert(payments)
        .values({
          orderId: order!.id,
          provider: provider.id,
          method: input.paymentMethod,
          amount: q.total,
          externalReference: newPaymentReference(),
          msisdn: prepaid ? paymentPhone : null,
        })
        .returning();
      return { order: order!, payment: payment! };
    });

    await this.reservations.release(reservation.id).catch(() => {});

    let paymentMessage: string | undefined;
    if (prepaid) {
      paymentMessage = (await this.startPayment(order, payment)).customerMessage;
      await this.effects.scheduleOrderExpiry(order.id, this.config.paymentTimeoutMinutes * 60_000 + 5_000);
    } else {
      paymentMessage = (await provider.initiatePayment(this.paymentRequest(order, payment))).customerMessage;
    }
    await this.effects.notify("order_received", order.id);
    return { order, payment, paymentMessage, trackingUrl: this.trackingUrl(order) };
  }

  /** Cash on Delivery ceiling from Settings (key codMaxOrderTotal); 0 = no limit. */
  async codLimit(): Promise<number> {
    const [row] = await this.db.select().from(settings).where(eq(settings.key, "codMaxOrderTotal"));
    const v = row ? Number(row.value) : DEFAULT_COD_MAX_ORDER_TOTAL;
    return Number.isFinite(v) && v >= 0 ? v : DEFAULT_COD_MAX_ORDER_TOTAL;
  }

  private paymentRequest(order: Order, payment: Payment) {
    return {
      externalReference: payment.externalReference,
      orderNumber: order.orderNumber,
      amount: payment.amount,
      currency: "UGX" as const,
      method: payment.method,
      msisdn: payment.msisdn ?? undefined,
      customerName: order.customerName,
      email: order.email ?? undefined,
      description: `Order ${order.orderNumber}`,
      callbackUrl: `${this.config.apiPublicUrl.replace(/\/$/, "")}/webhooks/payments/${payment.provider}`,
      returnUrl: this.trackingUrl(order),
    };
  }

  private async startPayment(order: Order, payment: Payment) {
    const provider = this.paymentsRegistry.byProviderId(payment.provider);
    let result;
    try {
      result = await provider.initiatePayment(this.paymentRequest(order, payment));
    } catch (err) {
      result = { status: "pending" as const, failureReason: (err as Error).message, raw: { error: (err as Error).message } };
    }
    await this.db.insert(paymentEvents).values({ paymentId: payment.id, provider: provider.id, kind: "initiate", payload: (result.raw ?? result) as object });
    await this.db
      .update(payments)
      .set({ providerReference: result.providerReference ?? null, raw: (result.raw ?? null) as object | null })
      .where(eq(payments.id, payment.id));
    if (result.status === "failed") {
      await this.applyPaymentResult(payment.externalReference, { externalReference: payment.externalReference, status: "failed", failureReason: result.failureReason });
    } else {
      // Poll in case the callback never reaches our server (ISP/tunnel hiccups).
      await this.effects.schedulePaymentCheck(payment.id, 15_000);
    }
    return result;
  }

  /** Customer asks for a new MoMo prompt (e.g. first one timed out or wrong number). */
  async retryPayment(orderId: string, msisdn?: string) {
    const order = await this.getOrder(orderId);
    if (order.status !== "awaiting_payment") throw new OrderError("This order is not waiting for payment");
    const phone = msisdn ? normalizeUgPhone(msisdn) : order.phone;
    if (!phone) throw new OrderError("Invalid mobile money number");
    const pending = await this.db
      .select()
      .from(payments)
      .where(and(eq(payments.orderId, orderId), eq(payments.status, "pending")));
    for (const p of pending) {
      await this.db.update(payments).set({ status: "cancelled", failureReason: "Superseded by retry" }).where(eq(payments.id, p.id));
    }
    const provider = this.paymentsRegistry.forMethod(order.paymentMethod);
    const [payment] = await this.db
      .insert(payments)
      .values({
        orderId,
        provider: provider.id,
        method: order.paymentMethod,
        amount: order.total - order.amountPaid,
        externalReference: newPaymentReference(),
        msisdn: phone,
      })
      .returning();
    // give the customer a fresh window
    const expiresAt = new Date(Date.now() + this.config.paymentTimeoutMinutes * 60_000);
    await this.db.update(orders).set({ expiresAt }).where(eq(orders.id, orderId));
    await this.effects.scheduleOrderExpiry(orderId, this.config.paymentTimeoutMinutes * 60_000 + 5_000);
    return this.startPayment(order, payment!);
  }

  /* ------------------------------------------------------------ payments */

  /** Poll the provider for a pending payment (called by the worker). Returns true when final. */
  async checkPayment(paymentId: string): Promise<boolean> {
    const [payment] = await this.db.select().from(payments).where(eq(payments.id, paymentId));
    if (!payment || payment.status !== "pending") return true;
    const provider = this.paymentsRegistry.byProviderId(payment.provider);
    if (provider.offline) return true;
    const result = await provider.verifyPayment(payment.externalReference);
    await this.db.update(payments).set({ lastCheckedAt: new Date() }).where(eq(payments.id, paymentId));
    await this.db.insert(paymentEvents).values({ paymentId, provider: provider.id, kind: "status_check", payload: (result.raw ?? result) as object });
    if (result.status === "pending") return false;
    await this.applyPaymentResult(payment.externalReference, result);
    return true;
  }

  /**
   * Idempotently applies a verified provider result. Safe to call from the
   * webhook, the poller and the expiry job at the same time: the payment row
   * is locked and only a pending payment can change state.
   */
  async applyPaymentResult(externalReference: string, result: VerifyPaymentResult) {
    let event: { e: NotificationEvent; orderId: string; extra?: Record<string, unknown> } | null = null;
    await this.db.transaction(async (tx) => {
      const [payment] = await tx.select().from(payments).where(eq(payments.externalReference, externalReference)).for("update");
      if (!payment || payment.status !== "pending") return;
      const [order] = await tx.select().from(orders).where(eq(orders.id, payment.orderId)).for("update");
      if (!order) return;

      if (result.status === "failed") {
        await tx
          .update(payments)
          .set({ status: "failed", failureReason: result.failureReason ?? "Payment failed or was declined", completedAt: new Date(), raw: (result.raw ?? null) as object | null })
          .where(eq(payments.id, payment.id));
        event = { e: "payment_failed", orderId: order.id, extra: { reason: result.failureReason } };
        return;
      }
      if (result.status !== "succeeded") return;

      if (result.amount !== undefined && result.amount < payment.amount) {
        await tx
          .update(payments)
          .set({ status: "failed", failureReason: `Amount mismatch: expected ${payment.amount}, got ${result.amount}`, raw: (result.raw ?? null) as object | null })
          .where(eq(payments.id, payment.id));
        await this.addHistory(tx, order, order.status, { type: "payment" }, `⚠️ Underpayment received (UGX ${result.amount}). Needs review.`);
        return;
      }

      await tx
        .update(payments)
        .set({
          status: "succeeded",
          completedAt: new Date(),
          financialTransactionId: result.financialTransactionId ?? null,
          providerReference: result.providerReference ?? payment.providerReference,
          raw: (result.raw ?? null) as object | null,
        })
        .where(eq(payments.id, payment.id));
      const amountPaid = order.amountPaid + payment.amount;
      await tx
        .update(orders)
        .set({ amountPaid, paymentStatus: amountPaid >= order.total ? "succeeded" : "pending", paidAt: new Date() })
        .where(eq(orders.id, order.id));

      if (order.status === "awaiting_payment") {
        await this.applyTransition(tx, { ...order, amountPaid }, "paid", { type: "payment", id: payment.id }, `Paid via ${payment.provider} (${result.financialTransactionId ?? payment.externalReference})`);
        event = { e: "payment_confirmed", orderId: order.id, extra: { amount: payment.amount } };
      } else {
        // Money arrived after the order was cancelled/expired: record it and flag for staff.
        await this.addHistory(tx, order, order.status, { type: "payment", id: payment.id }, `⚠️ Payment of UGX ${payment.amount} received while order was ${ORDER_STATUS_LABELS[order.status]}. Reinstate or refund.`);
      }
    });
    if (event) {
      const ev = event as { e: NotificationEvent; orderId: string; extra?: Record<string, unknown> };
      await this.effects.notify(ev.e, ev.orderId, ev.extra);
    }
  }

  /** Staff/rider records cash or MoMo-to-shop-line collection for COD/pickup orders. */
  async recordOfflinePayment(orderId: string, amount: number, actor: Actor, note?: string) {
    await this.db.transaction(async (tx) => {
      const [order] = await tx.select().from(orders).where(eq(orders.id, orderId)).for("update");
      if (!order) throw new OrderError("Order not found", "NOT_FOUND");
      const [payment] = await tx
        .select()
        .from(payments)
        .where(and(eq(payments.orderId, orderId), eq(payments.status, "pending")))
        .for("update");
      const staffId = actor.type === "staff" || actor.type === "rider" ? actor.id : null;
      if (payment) {
        await tx
          .update(payments)
          .set({ status: "succeeded", amount, completedAt: new Date(), collectedBy: staffId, failureReason: null, raw: note ? { note } : null })
          .where(eq(payments.id, payment.id));
      } else {
        await tx.insert(payments).values({
          orderId,
          provider: order.paymentMethod === "pay_on_pickup" ? "pay_on_pickup" : "cash_on_delivery",
          method: order.paymentMethod,
          amount,
          status: "succeeded",
          externalReference: newPaymentReference("CASH"),
          collectedBy: staffId,
          completedAt: new Date(),
          raw: note ? { note } : null,
        });
      }
      const amountPaid = order.amountPaid + amount;
      await tx
        .update(orders)
        .set({ amountPaid, paymentStatus: amountPaid >= order.total ? "succeeded" : "pending", paidAt: new Date() })
        .where(eq(orders.id, orderId));
      await this.addHistory(tx, order, order.status, actor, `Collected UGX ${amount.toLocaleString("en-US")}${note ? ` — ${note}` : ""}`);
    });
  }

  /* ---------------------------------------------------------- transitions */

  async getOrder(orderId: string): Promise<Order> {
    const [order] = await this.db.select().from(orders).where(eq(orders.id, orderId));
    if (!order) throw new OrderError("Order not found", "NOT_FOUND");
    return order;
  }

  async transition(orderId: string, to: OrderStatus, actor: Actor, note?: string) {
    const updated = await this.db.transaction(async (tx) => {
      const [order] = await tx.select().from(orders).where(eq(orders.id, orderId)).for("update");
      if (!order) throw new OrderError("Order not found", "NOT_FOUND");
      return this.applyTransition(tx, order, to, actor, note);
    });
    const ev = STATUS_TO_EVENT[to];
    if (ev) await this.effects.notify(ev, orderId, { reason: note });
    return updated;
  }

  private async addHistory(tx: DbOrTx, order: Order, to: OrderStatus, actor: Actor, note?: string) {
    await tx.insert(orderStatusHistory).values({
      orderId: order.id,
      fromStatus: order.status,
      toStatus: to,
      note,
      actorType: actor.type,
      actorId: actor.id ?? null,
    });
  }

  /** Must be called inside a transaction holding the order row lock. Applies stock side effects. */
  private async applyTransition(tx: DbOrTx, order: Order, to: OrderStatus, actor: Actor, note?: string): Promise<Order> {
    if (!canTransition(order.status, to)) {
      throw new OrderError(`Cannot move order from ${ORDER_STATUS_LABELS[order.status]} to ${ORDER_STATUS_LABELS[to]}`, "INVALID_TRANSITION");
    }
    if (to === "paid" && order.amountPaid < order.total) {
      throw new OrderError("Order cannot be marked paid before the full amount is received", "INVALID_TRANSITION");
    }
    const items = await tx.select().from(orderItems).where(eq(orderItems.orderId, order.id));
    const lines = items.filter((i) => i.variantId).map((i) => ({ variantId: i.variantId!, quantity: i.quantity }));
    const patch: Partial<Order> = { status: to };
    const now = new Date();

    switch (to) {
      case "paid":
        // Prepaid: payment converts the hold into a sale.
        if (order.stockReserved && !order.stockCommitted) {
          await inventory.commitSale(tx, lines, order.id);
          patch.stockCommitted = true;
          patch.stockReserved = false;
        }
        patch.expiresAt = null;
        break;
      case "confirmed":
        patch.confirmedAt = now;
        break;
      case "out_for_delivery":
        patch.dispatchedAt = now;
        break;
      case "delivered":
        // COD / pickup: the sale happens on hand-over.
        if (order.stockReserved && !order.stockCommitted) {
          await inventory.commitSale(tx, lines, order.id);
          patch.stockCommitted = true;
          patch.stockReserved = false;
        }
        patch.deliveredAt = now;
        await tx
          .update(deliveries)
          .set({ status: "delivered", deliveredAt: now })
          .where(and(eq(deliveries.orderId, order.id), inArray(deliveries.status, ["assigned", "picked_up"])));
        break;
      case "cancelled":
      case "returned":
        if (order.stockReserved && !order.stockCommitted) {
          await inventory.releaseForOrder(tx, lines, order.id, note);
          patch.stockReserved = false;
        } else if (order.stockCommitted && to === "cancelled") {
          // Cancelled after payment but before dispatch: goods never left, put them back.
          await inventory.restockReturn(tx, lines.map((l) => ({ ...l, condition: "resellable" as const })), { orderId: order.id });
          patch.stockCommitted = false;
        } else if (order.stockCommitted && to === "returned") {
          // Refused at the door / whole order returned: back on the shelf (itemised returns use the returns flow).
          const unreturned = items
            .filter((i) => i.variantId && i.quantity > i.returnedQuantity)
            .map((i) => ({ variantId: i.variantId!, quantity: i.quantity - i.returnedQuantity, condition: "resellable" as const }));
          if (unreturned.length) await inventory.restockReturn(tx, unreturned, { orderId: order.id });
          await tx.update(orderItems).set({ returnedQuantity: sql`${orderItems.quantity}` }).where(eq(orderItems.orderId, order.id));
        }
        if (to === "cancelled") {
          patch.cancelledAt = now;
          patch.expiresAt = null;
          await tx.update(payments).set({ status: "cancelled" }).where(and(eq(payments.orderId, order.id), eq(payments.status, "pending")));
          await tx
            .update(deliveries)
            .set({ status: "cancelled" })
            .where(and(eq(deliveries.orderId, order.id), inArray(deliveries.status, ["assigned", "picked_up"])));
          if (order.couponCode) {
            await tx.delete(couponRedemptions).where(eq(couponRedemptions.orderId, order.id));
            await tx.update(coupons).set({ usedCount: sql`greatest(${coupons.usedCount} - 1, 0)` }).where(eq(coupons.code, order.couponCode));
          }
        }
        break;
      case "ready_for_dispatch":
        if (order.status === "assigned_to_rider" || order.status === "out_for_delivery") {
          // rider unassigned / delivery attempt failed
          patch.riderId = null;
          await tx
            .update(deliveries)
            .set({ status: "failed", failureReason: note ?? "Returned to shop" })
            .where(and(eq(deliveries.orderId, order.id), inArray(deliveries.status, ["assigned", "picked_up"])));
        }
        break;
    }
    const [updated] = await tx.update(orders).set(patch).where(eq(orders.id, order.id)).returning();
    await this.addHistory(tx, order, to, actor, note);
    return updated!;
  }

  /** Cancel an unpaid Mobile Money order once its payment window has passed. */
  async expireIfUnpaid(orderId: string) {
    const order = await this.getOrder(orderId);
    if (order.status !== "awaiting_payment") return;
    if (order.expiresAt && order.expiresAt.getTime() > Date.now()) {
      await this.effects.scheduleOrderExpiry(orderId, order.expiresAt.getTime() - Date.now() + 2_000);
      return;
    }
    // Last check with the provider before giving up.
    const pending = await this.db.select().from(payments).where(and(eq(payments.orderId, orderId), eq(payments.status, "pending")));
    for (const p of pending) await this.checkPayment(p.id).catch(() => false);
    const fresh = await this.getOrder(orderId);
    if (fresh.status === "awaiting_payment") {
      await this.transition(orderId, "cancelled", { type: "system" }, "Payment not received in time");
    }
  }

  /* ------------------------------------------------------------ delivery */

  async assignRider(orderId: string, riderId: string, actor: Actor, opts: { notes?: string } = {}) {
    const [rider] = await this.db.select().from(staffUsers).where(eq(staffUsers.id, riderId));
    if (!rider || !rider.isActive) throw new OrderError("Rider not found or inactive");
    return this.db.transaction(async (tx) => {
      const [order] = await tx.select().from(orders).where(eq(orders.id, orderId)).for("update");
      if (!order) throw new OrderError("Order not found", "NOT_FOUND");
      await tx
        .update(deliveries)
        .set({ status: "cancelled", notes: "Reassigned" })
        .where(and(eq(deliveries.orderId, orderId), inArray(deliveries.status, ["assigned", "picked_up"])));
      await tx.insert(deliveries).values({
        orderId,
        riderId,
        method: order.deliveryMethod === "pickup" ? "internal_rider" : order.deliveryMethod,
        amountToCollect: Math.max(0, order.total - order.amountPaid),
        notes: opts.notes,
      });
      await tx.update(orders).set({ riderId }).where(eq(orders.id, orderId));
      if (order.status !== "assigned_to_rider") {
        return this.applyTransition(tx, order, "assigned_to_rider", actor, `Assigned to ${rider.name}`);
      }
      return order;
    });
  }

  /** Courier / bus parcel / third party hand-over without an internal rider. */
  async dispatchExternal(orderId: string, actor: Actor, info: { carrierName: string; trackingNumber?: string }) {
    const order = await this.getOrder(orderId);
    await this.db.insert(deliveries).values({
      orderId,
      method: order.deliveryMethod,
      status: "picked_up",
      carrierName: info.carrierName,
      trackingNumber: info.trackingNumber,
      amountToCollect: Math.max(0, order.total - order.amountPaid),
      pickedUpAt: new Date(),
    });
    return this.transition(orderId, "out_for_delivery", actor, `Sent with ${info.carrierName}${info.trackingNumber ? ` (${info.trackingNumber})` : ""}`);
  }

  async riderPickup(orderId: string, riderId: string) {
    const order = await this.getOrder(orderId);
    if (order.riderId !== riderId) throw new OrderError("This delivery is not assigned to you");
    await this.db
      .update(deliveries)
      .set({ status: "picked_up", pickedUpAt: new Date() })
      .where(and(eq(deliveries.orderId, orderId), eq(deliveries.riderId, riderId), eq(deliveries.status, "assigned")));
    return this.transition(orderId, "out_for_delivery", { type: "rider", id: riderId }, "Rider picked up the order");
  }

  async riderDeliver(orderId: string, riderId: string, info: { amountCollected: number; recipientName?: string; notes?: string }) {
    const order = await this.getOrder(orderId);
    if (order.riderId !== riderId) throw new OrderError("This delivery is not assigned to you");
    const due = Math.max(0, order.total - order.amountPaid);
    if (info.amountCollected < due) throw new OrderError(`Collect UGX ${due.toLocaleString("en-US")} before confirming delivery`);
    if (due > 0) await this.recordOfflinePayment(orderId, info.amountCollected, { type: "rider", id: riderId }, "Collected by rider");
    await this.db
      .update(deliveries)
      .set({ amountCollected: info.amountCollected, collectedAt: new Date(), recipientName: info.recipientName, notes: info.notes })
      .where(and(eq(deliveries.orderId, orderId), eq(deliveries.riderId, riderId), inArray(deliveries.status, ["assigned", "picked_up"])));
    return this.transition(orderId, "delivered", { type: "rider", id: riderId }, info.recipientName ? `Received by ${info.recipientName}` : "Delivered");
  }

  async riderFail(orderId: string, riderId: string, reason: string) {
    const order = await this.getOrder(orderId);
    if (order.riderId !== riderId) throw new OrderError("This delivery is not assigned to you");
    return this.transition(orderId, "ready_for_dispatch", { type: "rider", id: riderId }, `Delivery failed: ${reason}`);
  }

  /* -------------------------------------------------------------- refunds */

  async refund(orderId: string, opts: { amount: number; reason: string; staffId: string; method?: "provider" | "cash" | "mobile_money_manual"; msisdn?: string; returnId?: string }) {
    const order = await this.getOrder(orderId);
    const paid = await this.db.select().from(payments).where(and(eq(payments.orderId, orderId), inArray(payments.status, ["succeeded", "partially_refunded"])));
    const refundable = paid.reduce((s, p) => s + p.amount - p.refundedAmount, 0);
    if (opts.amount <= 0 || opts.amount > refundable) {
      throw new OrderError(`Refund must be between 1 and UGX ${refundable.toLocaleString("en-US")}`);
    }
    const payment = paid.find((p) => p.amount - p.refundedAmount >= opts.amount) ?? paid[0]!;
    const provider = this.paymentsRegistry.byProviderId(payment.provider);
    const method = opts.method ?? (provider.offline ? "cash" : "provider");
    const ref = newPaymentReference("RF");
    const [refund] = await this.db
      .insert(refunds)
      .values({
        orderId,
        paymentId: payment.id,
        returnId: opts.returnId,
        amount: opts.amount,
        method,
        reason: opts.reason,
        externalReference: ref,
        msisdn: opts.msisdn ? normalizeUgPhone(opts.msisdn) : (payment.msisdn ?? order.phone),
        staffId: opts.staffId,
      })
      .returning();

    let status: "pending" | "succeeded" | "failed" = "succeeded";
    if (method === "provider") {
      const res = await provider.refundPayment({
        externalReference: ref,
        originalExternalReference: payment.externalReference,
        amount: opts.amount,
        msisdn: refund!.msisdn ?? undefined,
        customerName: order.customerName,
        reason: opts.reason,
        callbackUrl: `${this.config.apiPublicUrl.replace(/\/$/, "")}/webhooks/payments/${payment.provider}`,
      });
      status = res.status;
      await this.db
        .update(refunds)
        .set({ status, providerReference: res.providerReference, raw: (res.raw ?? null) as object | null, completedAt: status === "succeeded" ? new Date() : null })
        .where(eq(refunds.id, refund!.id));
      if (status === "failed") throw new OrderError(`Refund failed: ${res.failureReason ?? "provider error"}`, "PAYMENT");
    } else {
      await this.db.update(refunds).set({ status: "succeeded", completedAt: new Date() }).where(eq(refunds.id, refund!.id));
    }
    // Money is considered committed to the customer once the provider accepts the disbursement.
    const newRefunded = payment.refundedAmount + opts.amount;
    await this.db
      .update(payments)
      .set({ refundedAmount: newRefunded, status: newRefunded >= payment.amount ? "refunded" : "partially_refunded" })
      .where(eq(payments.id, payment.id));
    const totalRefunded = refundable - opts.amount === 0;
    await this.db
      .update(orders)
      .set({ paymentStatus: totalRefunded ? "refunded" : "partially_refunded" })
      .where(eq(orders.id, orderId));
    if (totalRefunded && canTransition(order.status, "refunded")) {
      await this.transition(orderId, "refunded", { type: "staff", id: opts.staffId }, opts.reason);
    } else {
      await this.db.insert(orderStatusHistory).values({
        orderId,
        fromStatus: order.status,
        toStatus: order.status,
        note: `Refunded UGX ${opts.amount.toLocaleString("en-US")}: ${opts.reason}`,
        actorType: "staff",
        actorId: opts.staffId,
      });
    }
    await this.effects.notify("refund_sent", orderId, { amount: opts.amount });
    return { ...refund!, status };
  }

  /* -------------------------------------------------------------- returns */

  async createReturn(orderId: string, input: { reason: string; items: { orderItemId: string; quantity: number; condition: "resellable" | "damaged" }[]; imageIds?: string[] }) {
    const order = await this.getOrder(orderId);
    if (order.status !== "delivered") throw new OrderError("Only delivered orders can be returned");
    const items = await this.db.select().from(orderItems).where(eq(orderItems.orderId, orderId));
    for (const r of input.items) {
      const it = items.find((i) => i.id === r.orderItemId);
      if (!it || r.quantity < 1 || r.quantity > it.quantity - it.returnedQuantity) throw new OrderError("Invalid return quantity");
    }
    const [ret] = await this.db
      .insert(returns)
      .values({ orderId, reason: input.reason, items: input.items, imageIds: input.imageIds ?? [] })
      .returning();
    return ret!;
  }

  /** Goods physically received back: restock, optionally refund, and close the order if fully returned. */
  async receiveReturn(returnId: string, staffId: string, opts: { refundAmount?: number; staffNotes?: string }) {
    const [ret] = await this.db.select().from(returns).where(eq(returns.id, returnId));
    if (!ret) throw new OrderError("Return not found", "NOT_FOUND");
    if (!["requested", "approved"].includes(ret.status)) throw new OrderError("Return already processed");
    const fullyReturned = await this.db.transaction(async (tx) => {
      const items = await tx.select().from(orderItems).where(eq(orderItems.orderId, ret.orderId));
      const lines = ret.items.map((r) => {
        const it = items.find((i) => i.id === r.orderItemId)!;
        return { variantId: it.variantId!, quantity: r.quantity, condition: r.condition, itemId: it.id };
      });
      await inventory.restockReturn(tx, lines.filter((l) => l.variantId), { orderId: ret.orderId, returnId, staffId });
      for (const l of lines) {
        await tx.update(orderItems).set({ returnedQuantity: sql`${orderItems.returnedQuantity} + ${l.quantity}` }).where(eq(orderItems.id, l.itemId));
      }
      await tx
        .update(returns)
        .set({ status: "received", handledBy: staffId, staffNotes: opts.staffNotes, refundAmount: opts.refundAmount ?? null })
        .where(eq(returns.id, returnId));
      const after = await tx.select().from(orderItems).where(eq(orderItems.orderId, ret.orderId));
      return after.every((i) => i.returnedQuantity >= i.quantity);
    });
    if (fullyReturned) {
      const order = await this.getOrder(ret.orderId);
      if (canTransition(order.status, "returned")) {
        // stock already restocked above; mark committed=false so the transition doesn't restock again
        await this.db.update(orders).set({ stockCommitted: false }).where(eq(orders.id, order.id));
        await this.transition(order.id, "returned", { type: "staff", id: staffId }, `Return received: ${ret.reason}`);
      }
    }
    if (opts.refundAmount && opts.refundAmount > 0) {
      await this.refund(ret.orderId, { amount: opts.refundAmount, reason: `Return: ${ret.reason}`, staffId, returnId });
    }
    await this.db.update(returns).set({ status: "completed" }).where(eq(returns.id, returnId));
  }
}
