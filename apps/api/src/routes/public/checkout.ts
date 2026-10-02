import { createHash } from "node:crypto";
import { Hono, type Context } from "hono";
import { z } from "zod";
import { and, asc, desc, eq } from "drizzle-orm";
import { deliveries, orderItems, orderStatusHistory, orders, payments, products, staffUsers } from "@ugmall/database";
import { CartError, OrderError } from "@ugmall/orders";
import { DeliveryError } from "@ugmall/delivery";
import { PaymentError } from "@ugmall/payments";
import { checkoutSchema, ORDERABLE_DELIVERY_METHODS, normalizeUgPhone, ORDER_STATUS_LABELS, prettyUgPhone, ugPhone } from "@ugmall/shared";
import { ApiError, body, clientIp, getDeviceId } from "../../lib/http";
import { limit } from "../../middleware/security";
import type { AppEnv } from "../../types";
import { clearCart, getCartId, readCartLines } from "./cart";

export const checkoutRoutes = new Hono<AppEnv>();

function mapDomainError(err: unknown): never {
  if (err instanceof OrderError) {
    const status = err.code === "NOT_FOUND" ? 404 : err.code === "OUT_OF_STOCK" || err.code === "RESERVATION_EXPIRED" ? 409 : 422;
    throw new ApiError(status, err.message, err.details);
  }
  if (err instanceof CartError || err instanceof DeliveryError) throw new ApiError(422, err.message);
  if (err instanceof PaymentError) throw new ApiError(err.code === "NOT_SUPPORTED" || err.code === "INVALID_REQUEST" ? 422 : 502, err.message);
  throw err;
}
export { mapDomainError };

const quoteSchema = z.object({
  locationId: z.number().int().positive().optional().nullable(),
  deliveryZoneId: z.string().uuid().optional().nullable(),
  deliveryMethod: z.enum(ORDERABLE_DELIVERY_METHODS),
  couponCode: z.string().max(40).optional().nullable(),
  phone: z.string().optional().nullable(),
});

checkoutRoutes.post("/quote", async (c) => {
  const input = await body(c, quoteSchema);
  const lines = await readCartLines(c);
  if (!lines.length) throw new ApiError(400, "Your cart is empty");
  try {
    const q = await c.get("container").orders.quote({
      lines,
      locationId: input.locationId,
      deliveryZoneId: input.deliveryZoneId,
      deliveryMethod: input.deliveryMethod,
      couponCode: input.couponCode,
      phone: input.phone ? normalizeUgPhone(input.phone) : null,
    });
    return c.json({
      items: q.lines,
      subtotal: q.subtotal,
      deliveryFee: q.delivery.fee,
      deliveryDescription: q.delivery.description,
      deliveryIsFinal: q.delivery.isFinal,
      zone: q.zone ? { name: q.zone.name, etaText: q.zone.etaText, methods: q.zone.methods } : null,
      locationPath: q.location?.location.path ?? null,
      discount: q.discount,
      couponError: q.couponError,
      total: q.total,
    });
  } catch (err) {
    mapDomainError(err);
  }
});

/** Hold the cart's stock for the next few minutes while the customer fills in details. */
checkoutRoutes.post("/reserve", limit("reserve", 30, 60), async (c) => {
  const input = await body(c, z.object({ reservationId: z.string().max(64).optional() }));
  const lines = await readCartLines(c);
  if (!lines.length) throw new ApiError(400, "Your cart is empty");
  const { reservations, redis } = c.get("container");
  // One hold per cart: re-entering checkout refreshes the same hold instead of stacking new ones.
  const cartId = getCartId(c, false);
  const reservationId = input.reservationId ?? (cartId ? ((await redis.get(`cart-resv:${cartId}`)) ?? undefined) : undefined);
  const r = await reservations.reserve(lines, reservationId);
  if (!r.ok) return c.json({ ok: false, shortages: r.shortages }, 409);
  if (cartId) await redis.set(`cart-resv:${cartId}`, r.reservation.id, "PX", Math.max(1000, r.reservation.expiresAt - Date.now()));
  return c.json({ ok: true, reservationId: r.reservation.id, expiresAt: r.reservation.expiresAt });
});

checkoutRoutes.post(
  "/place",
  limit("place-order", 10, 600),
  async (c) => {
    const input = await body(c, checkoutSchema);
    const cartLines = await readCartLines(c);
    const cartId = getCartId(c, false);
    if (!input.reservationId && cartId) input.reservationId = (await c.get("container").redis.get(`cart-resv:${cartId}`)) ?? undefined;
    if (!cartLines.length && !input.items?.length) throw new ApiError(400, "Your cart is empty");
    try {
      const result = await c.get("container").orders.placeOrder(
        { ...input, items: input.items?.length ? input.items : cartLines },
        { source: "web", customerId: c.get("customer")?.id ?? null, deviceId: getDeviceId(c, true) },
      );
      await clearCart(c);
      return c.json({
        orderNumber: result.order.orderNumber,
        trackingToken: result.order.trackingToken,
        trackingUrl: result.trackingUrl,
        status: result.order.status,
        total: result.order.total,
        paymentMethod: result.order.paymentMethod,
        paymentMessage: result.paymentMessage,
        paymentRedirectUrl: result.paymentRedirectUrl,
      });
    } catch (err) {
      c.get("container").env.NODE_ENV !== "test" && console.warn("[checkout] failed", clientIp(c), (err as Error).message);
      mapDomainError(err);
    }
  },
);

/* --------------------------------------------------------- order tracking */

export const trackingRoutes = new Hono<AppEnv>();

async function findTrackedOrder(c: Context<AppEnv>, orderNumber: string, token: string | undefined) {
  const { db } = c.get("container");
  const [order] = await db.select().from(orders).where(eq(orders.orderNumber, orderNumber));
  const customer = c.get("customer");
  const deviceId = getDeviceId(c, false);
  if (!order || (order.trackingToken !== token && order.customerId !== customer?.id && order.deviceId !== deviceId)) throw new ApiError(404, "Order not found");
  return order;
}

const sha256 = (value: string) => createHash("sha256").update(value.trim().toLowerCase()).digest("hex");

/** Server-side Meta Conversions API Purchase event, deduped with the browser Pixel using eventId. */
trackingRoutes.post("/:orderNumber/meta-purchase", limit("meta-purchase", 10, 600), async (c) => {
  const input = await body(c, z.object({ t: z.string().optional(), eventId: z.string().min(8).max(120) }));
  const order = await findTrackedOrder(c, c.req.param("orderNumber"), input.t);
  const qualifies = order.paymentStatus === "succeeded" || order.paymentMethod === "cash_on_delivery";
  if (!qualifies || order.status === "cancelled") throw new ApiError(409, "Order is not ready for purchase tracking");

  const pixelId = process.env.NEXT_PUBLIC_META_PIXEL_ID;
  const token = process.env.META_CONVERSIONS_API_TOKEN;
  if (!pixelId || !token) return c.json({ ok: true, configured: false });

  const items = await c.get("container").db.select().from(orderItems).where(eq(orderItems.orderId, order.id));
  const base = (process.env.STOREFRONT_URL ?? new URL(c.req.url).origin).replace(/\/$/, "");
  const phone = order.phone.replace(/\D/g, "");
  const payload = {
    data: [{
      event_name: "Purchase",
      event_time: Math.floor(Date.now() / 1000),
      event_id: input.eventId,
      action_source: "website",
      event_source_url: base,
      user_data: {
        ph: phone ? [sha256(phone)] : undefined,
        client_ip_address: clientIp(c),
        client_user_agent: c.req.header("user-agent") ?? undefined,
      },
      custom_data: {
        currency: "UGX",
        value: order.total,
        order_id: order.orderNumber,
        content_type: "product",
        contents: items.map((i) => ({ id: i.productId, quantity: i.quantity, item_price: i.unitPrice })),
      },
    }],
  };

  const response = await fetch(`https://graph.facebook.com/v22.0/${encodeURIComponent(pixelId)}/events?access_token=${encodeURIComponent(token)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    console.warn("[meta-capi] purchase event failed", response.status, detail.slice(0, 300));
    throw new ApiError(502, "Purchase tracking provider unavailable");
  }
  return c.json({ ok: true, configured: true });
});

/** Find an order by number + phone (for customers who lost the tracking link). */
trackingRoutes.post("/lookup", limit("order-lookup", 10, 600), async (c) => {
  const input = await body(c, z.object({ orderNumber: z.string().min(5).max(40), phone: ugPhone }));
  const { db } = c.get("container");
  const [order] = await db
    .select({ orderNumber: orders.orderNumber, trackingToken: orders.trackingToken })
    .from(orders)
    .where(and(eq(orders.orderNumber, input.orderNumber.trim().toUpperCase()), eq(orders.phone, normalizeUgPhone(input.phone)!)));
  if (!order) throw new ApiError(404, "We couldn't find an order with that number and phone");
  return c.json(order);
});

trackingRoutes.get("/:orderNumber", async (c) => {
  const { db } = c.get("container");
  const order = await findTrackedOrder(c, c.req.param("orderNumber"), c.req.query("t"));
  const [items, history, pays, delivery] = await Promise.all([
    db
      .select({ i: orderItems, productSlug: products.slug })
      .from(orderItems)
      .leftJoin(products, eq(products.id, orderItems.productId))
      .where(eq(orderItems.orderId, order.id))
      .then((rows) => rows.map((r) => ({ ...r.i, productSlug: r.productSlug }))),
    db.select().from(orderStatusHistory).where(eq(orderStatusHistory.orderId, order.id)).orderBy(asc(orderStatusHistory.createdAt)),
    db.select().from(payments).where(eq(payments.orderId, order.id)).orderBy(desc(payments.createdAt)),
    db
      .select({ status: deliveries.status, riderName: staffUsers.name, riderPhone: staffUsers.phone, carrierName: deliveries.carrierName, trackingNumber: deliveries.trackingNumber })
      .from(deliveries)
      .leftJoin(staffUsers, eq(staffUsers.id, deliveries.riderId))
      .where(eq(deliveries.orderId, order.id))
      .orderBy(desc(deliveries.createdAt))
      .limit(1),
  ]);
  const latestPayment = pays[0];
  return c.json({
    orderNumber: order.orderNumber,
    status: order.status,
    statusLabel: ORDER_STATUS_LABELS[order.status],
    paymentStatus: order.paymentStatus,
    paymentMethod: order.paymentMethod,
    deliveryMethod: order.deliveryMethod,
    customerName: order.customerName,
    phone: prettyUgPhone(order.phone),
    district: order.district,
    area: order.area,
    address: order.address,
    locationPath: order.locationPath,
    nearbyPlace: order.nearbyPlace,
    subtotal: order.subtotal,
    deliveryFee: order.deliveryFee,
    discount: order.discount,
    total: order.total,
    amountPaid: order.amountPaid,
    expiresAt: order.expiresAt,
    createdAt: order.createdAt,
    canRetryPayment: order.status === "awaiting_payment",
    canCancel: order.status === "pending" || order.status === "awaiting_payment",
    canReview: order.status === "delivered",
    latestPayment: latestPayment
      ? { provider: latestPayment.provider, status: latestPayment.status, failureReason: latestPayment.failureReason, msisdn: latestPayment.msisdn ? prettyUgPhone(latestPayment.msisdn) : null }
      : null,
    items: items.map((i) => ({
      id: i.id,
      productId: i.productId,
      productSlug: i.productSlug,
      productName: i.productName,
      variantLabel: i.variantLabel,
      sku: i.sku,
      imageUrl: i.imageUrl,
      unitPrice: i.unitPrice,
      quantity: i.quantity,
      lineTotal: i.lineTotal,
    })),
    history: history.filter((h) => h.fromStatus !== h.toStatus).map((h) => ({ status: h.toStatus, label: ORDER_STATUS_LABELS[h.toStatus], at: h.createdAt })),
    delivery: delivery[0]
      ? { ...delivery[0], riderPhone: delivery[0].riderPhone ? prettyUgPhone(delivery[0].riderPhone) : null }
      : null,
  });
});

/** Lightweight polling endpoint for the "waiting for Mobile Money" screen. */
trackingRoutes.get("/:orderNumber/status", limit("order-status", 120, 60), async (c) => {
  const { db, redis, orders: svc } = c.get("container");
  const order = await findTrackedOrder(c, c.req.param("orderNumber"), c.req.query("t"));
  if (order.status === "awaiting_payment") {
    // opportunistic provider check, at most every 5s per order
    if (await redis.set(`paycheck:${order.id}`, "1", "EX", 5, "NX")) {
      const [p] = await db.select().from(payments).where(and(eq(payments.orderId, order.id), eq(payments.status, "pending"))).limit(1);
      if (p) await svc.checkPayment(p.id).catch(() => {});
    }
  }
  const [fresh] = await db.select({ status: orders.status, paymentStatus: orders.paymentStatus }).from(orders).where(eq(orders.id, order.id));
  const [latest] = await db.select().from(payments).where(eq(payments.orderId, order.id)).orderBy(desc(payments.createdAt)).limit(1);
  return c.json({ ...fresh, latestPayment: latest ? { status: latest.status, failureReason: latest.failureReason } : null });
});

trackingRoutes.post("/:orderNumber/retry-payment", limit("retry-payment", 5, 600), async (c) => {
  const input = await body(c, z.object({ t: z.string().optional(), msisdn: ugPhone.optional() }));
  const order = await findTrackedOrder(c, c.req.param("orderNumber"), input.t);
  try {
    const r = await c.get("container").orders.retryPayment(order.id, input.msisdn);
    return c.json({ ok: r.status !== "failed", message: r.customerMessage ?? r.failureReason, redirectUrl: r.redirectUrl });
  } catch (err) {
    mapDomainError(err);
  }
});

trackingRoutes.post("/:orderNumber/cancel", limit("cancel-order", 5, 600), async (c) => {
  const input = await body(c, z.object({ t: z.string().optional(), reason: z.string().max(200).optional() }));
  const order = await findTrackedOrder(c, c.req.param("orderNumber"), input.t);
  if (order.status !== "pending" && order.status !== "awaiting_payment") throw new ApiError(409, "This order can no longer be cancelled online. Please contact us on WhatsApp.");
  try {
    await c.get("container").orders.transition(order.id, "cancelled", { type: "customer", id: order.customerId ?? undefined }, input.reason || "Cancelled by customer");
    return c.json({ ok: true });
  } catch (err) {
    mapDomainError(err);
  }
});
