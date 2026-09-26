import { Hono } from "hono";
import { z } from "zod";
import { and, asc, count, desc, eq, gte, ilike, inArray, lt, or, sql, type SQL } from "drizzle-orm";
import {
  deliveries,
  mediaFiles,
  notificationLog,
  orderItems,
  orderStatusHistory,
  orders,
  paymentEvents,
  payments,
  refunds,
  returns,
  staffUsers,
} from "@ugmall/database";
import { invoicePdf } from "@ugmall/reporting";
import { signedPrivateUrl } from "@ugmall/storage";
import {
  checkoutSchema,
  DELIVERY_METHOD_LABELS,
  normalizeUgPhone,
  ORDER_SOURCES,
  ORDER_STATUSES,
  PAYMENT_METHOD_LABELS,
  PAYMENT_METHODS,
  PERMISSIONS,
  type OrderStatus,
} from "@ugmall/shared";
import { NOTIFICATION_EVENTS } from "@ugmall/notifications";
import { ApiError, body, pagination } from "../../lib/http";
import { audit } from "../../lib/audit";
import { getSettings } from "../../lib/settings";
import { enqueueOrderNotification } from "../../queues";
import { requirePermission } from "../../middleware/auth";
import { mapDomainError } from "../public/checkout";
import type { AppEnv } from "../../types";

export const adminOrderRoutes = new Hono<AppEnv>();
const P = PERMISSIONS;

adminOrderRoutes.get("/orders", requirePermission(P.ordersView), async (c) => {
  const { db } = c.get("container");
  const { limit, offset } = pagination(c, 200);
  const q = c.req.query();
  const where: SQL[] = [];
  if (q.status) {
    const statuses = q.status.split(",").filter((s) => (ORDER_STATUSES as readonly string[]).includes(s)) as OrderStatus[];
    if (statuses.length) where.push(inArray(orders.status, statuses));
  }
  if (q.paymentMethod && (PAYMENT_METHODS as readonly string[]).includes(q.paymentMethod)) where.push(eq(orders.paymentMethod, q.paymentMethod as (typeof PAYMENT_METHODS)[number]));
  if (q.riderId) where.push(eq(orders.riderId, q.riderId));
  if (q.from) where.push(gte(orders.createdAt, new Date(`${q.from}T00:00:00+03:00`)));
  if (q.to) where.push(lt(orders.createdAt, new Date(new Date(`${q.to}T00:00:00+03:00`).getTime() + 86_400_000)));
  if (q.q) {
    const term = q.q.trim();
    const phone = normalizeUgPhone(term);
    where.push(or(ilike(orders.orderNumber, `%${term}%`), ilike(orders.customerName, `%${term}%`), phone ? eq(orders.phone, phone) : ilike(orders.phone, `%${term.replace(/\D/g, "") || "x"}%`))!);
  }
  const w = where.length ? and(...where) : undefined;
  const [rows, [{ total }]] = await Promise.all([
    db
      .select({
        o: orders,
        riderName: staffUsers.name,
        itemCount: sql<number>`(select coalesce(sum(quantity),0)::int from ${orderItems} i where i.order_id = ${orders.id})`,
      })
      .from(orders)
      .leftJoin(staffUsers, eq(staffUsers.id, orders.riderId))
      .where(w)
      .orderBy(desc(orders.createdAt))
      .limit(limit)
      .offset(offset),
    db.select({ total: count() }).from(orders).where(w) as unknown as Promise<[{ total: number }]>,
  ]);
  const counts = await db.select({ status: orders.status, n: count() }).from(orders).groupBy(orders.status);
  return c.json({
    total,
    counts: Object.fromEntries(counts.map((r) => [r.status, r.n])),
    items: rows.map((r) => ({ ...r.o, trackingToken: undefined, riderName: r.riderName, itemCount: r.itemCount })),
  });
});

adminOrderRoutes.get("/orders/:id", requirePermission(P.ordersView), async (c) => {
  const { db, orders: svc } = c.get("container");
  const id = c.req.param("id");
  const [order] = await db.select().from(orders).where(or(eq(orders.orderNumber, id), sql`${orders.id}::text = ${id}`));
  if (!order) throw new ApiError(404, "Order not found");
  const [items, history, pays, dels, refs, rets, notes] = await Promise.all([
    db.select().from(orderItems).where(eq(orderItems.orderId, order.id)),
    db
      .select({ h: orderStatusHistory, staffName: staffUsers.name })
      .from(orderStatusHistory)
      .leftJoin(staffUsers, sql`${staffUsers.id}::text = ${orderStatusHistory.actorId}`)
      .where(eq(orderStatusHistory.orderId, order.id))
      .orderBy(asc(orderStatusHistory.createdAt)),
    db.select().from(payments).where(eq(payments.orderId, order.id)).orderBy(desc(payments.createdAt)),
    db
      .select({ d: deliveries, riderName: staffUsers.name, riderPhone: staffUsers.phone })
      .from(deliveries)
      .leftJoin(staffUsers, eq(staffUsers.id, deliveries.riderId))
      .where(eq(deliveries.orderId, order.id))
      .orderBy(desc(deliveries.createdAt)),
    db.select().from(refunds).where(eq(refunds.orderId, order.id)).orderBy(desc(refunds.createdAt)),
    db.select().from(returns).where(eq(returns.orderId, order.id)).orderBy(desc(returns.createdAt)),
    db.select().from(notificationLog).where(eq(notificationLog.orderId, order.id)).orderBy(desc(notificationLog.createdAt)),
  ]);
  return c.json({
    ...order,
    trackingUrl: svc.trackingUrl(order),
    items,
    history: history.map((h) => ({ ...h.h, actorName: h.staffName })),
    payments: pays.map((p) => ({ ...p, raw: undefined })),
    deliveries: dels.map((d) => ({ ...d.d, riderName: d.riderName, riderPhone: d.riderPhone })),
    refunds: refs.map((r) => ({ ...r, raw: undefined })),
    returns: rets,
    notifications: notes,
  });
});

/** Manual order entry for WhatsApp / phone orders. */
adminOrderRoutes.post("/orders", requirePermission(P.ordersManage), async (c) => {
  const input = await body(c, checkoutSchema.extend({ source: z.enum(ORDER_SOURCES).default("whatsapp"), items: checkoutSchema.shape.items.unwrap() }));
  try {
    const r = await c.get("container").orders.placeOrder(input, { source: input.source, staffId: c.get("staff").id });
    await audit(c.get("container").db, c.get("staff").id, "order.create", "order", r.order.id, { source: input.source });
    return c.json({ id: r.order.id, orderNumber: r.order.orderNumber, paymentMessage: r.paymentMessage }, 201);
  } catch (err) {
    mapDomainError(err);
  }
});

adminOrderRoutes.patch("/orders/:id", requirePermission(P.ordersManage), async (c) => {
  const input = await body(
    c,
    z.object({
      staffNotes: z.string().max(5000).nullable().optional(),
      altPhone: z.string().nullable().optional(),
      district: z.string().max(80).optional(),
      area: z.string().max(120).optional(),
      address: z.string().max(300).optional(),
    }),
  );
  const { db } = c.get("container");
  const patch: Record<string, unknown> = { ...input };
  if (input.altPhone !== undefined) patch.altPhone = input.altPhone ? normalizeUgPhone(input.altPhone) : null;
  const [row] = await db.update(orders).set(patch).where(eq(orders.id, c.req.param("id"))).returning();
  if (!row) throw new ApiError(404, "Order not found");
  await audit(db, c.get("staff").id, "order.update", "order", row.id, input);
  return c.json(row);
});

adminOrderRoutes.post("/orders/:id/status", requirePermission(P.ordersManage), async (c) => {
  const input = await body(c, z.object({ status: z.enum(ORDER_STATUSES), note: z.string().max(500).optional() }));
  if (input.status === "paid") throw new ApiError(422, "Payments mark orders as paid automatically. Record a payment instead.");
  if (input.status === "refunded") throw new ApiError(422, "Use the refund action to refund an order.");
  try {
    const o = await c.get("container").orders.transition(c.req.param("id"), input.status, { type: "staff", id: c.get("staff").id }, input.note);
    await audit(c.get("container").db, c.get("staff").id, "order.status", "order", o.id, input);
    return c.json(o);
  } catch (err) {
    mapDomainError(err);
  }
});

adminOrderRoutes.post("/orders/:id/assign-rider", requirePermission(P.deliveriesManage), async (c) => {
  const input = await body(c, z.object({ riderId: z.string().uuid(), notes: z.string().max(500).optional() }));
  try {
    return c.json(await c.get("container").orders.assignRider(c.req.param("id"), input.riderId, { type: "staff", id: c.get("staff").id }, input));
  } catch (err) {
    mapDomainError(err);
  }
});

adminOrderRoutes.post("/orders/:id/dispatch", requirePermission(P.deliveriesManage), async (c) => {
  const input = await body(c, z.object({ carrierName: z.string().min(2).max(120), trackingNumber: z.string().max(120).optional() }));
  try {
    return c.json(await c.get("container").orders.dispatchExternal(c.req.param("id"), { type: "staff", id: c.get("staff").id }, input));
  } catch (err) {
    mapDomainError(err);
  }
});

adminOrderRoutes.post("/orders/:id/payments", requirePermission(P.ordersManage), async (c) => {
  const input = await body(c, z.object({ amount: z.number().int().min(1), note: z.string().max(200).optional() }));
  try {
    await c.get("container").orders.recordOfflinePayment(c.req.param("id"), input.amount, { type: "staff", id: c.get("staff").id }, input.note);
    await audit(c.get("container").db, c.get("staff").id, "order.payment", "order", c.req.param("id"), input);
    return c.json({ ok: true });
  } catch (err) {
    mapDomainError(err);
  }
});

adminOrderRoutes.post("/orders/:id/check-payment", requirePermission(P.ordersView), async (c) => {
  const { db, orders: svc } = c.get("container");
  const pending = await db.select().from(payments).where(and(eq(payments.orderId, c.req.param("id")), eq(payments.status, "pending")));
  const results = [];
  for (const p of pending) results.push({ id: p.id, final: await svc.checkPayment(p.id).catch((e) => String(e.message)) });
  return c.json({ checked: results });
});

adminOrderRoutes.post("/orders/:id/refund", requirePermission(P.refundsManage), async (c) => {
  const input = await body(
    c,
    z.object({ amount: z.number().int().min(1), reason: z.string().min(3).max(300), method: z.enum(["provider", "cash", "mobile_money_manual"]).optional(), msisdn: z.string().optional() }),
  );
  try {
    const r = await c.get("container").orders.refund(c.req.param("id"), { ...input, staffId: c.get("staff").id });
    await audit(c.get("container").db, c.get("staff").id, "order.refund", "order", c.req.param("id"), input);
    return c.json(r);
  } catch (err) {
    mapDomainError(err);
  }
});

adminOrderRoutes.post("/orders/:id/notify", requirePermission(P.ordersManage), async (c) => {
  const { event } = await body(c, z.object({ event: z.enum(NOTIFICATION_EVENTS).exclude(["otp"]) }));
  const { db, queues, env } = c.get("container");
  await enqueueOrderNotification(db, queues, { shopName: env.SHOP_NAME, storefrontUrl: env.STOREFRONT_URL }, event, c.req.param("id"), { resend: Date.now() } as Record<string, unknown>);
  return c.json({ ok: true });
});

/** Generates the invoice/receipt PDF, stores it privately under storage/invoices and returns a signed link. */
adminOrderRoutes.post("/orders/:id/invoice", requirePermission(P.ordersView), async (c) => {
  const { db, storage, env } = c.get("container");
  const [order] = await db.select().from(orders).where(eq(orders.id, c.req.param("id")));
  if (!order) throw new ApiError(404, "Order not found");
  const items = await db.select().from(orderItems).where(eq(orderItems.orderId, order.id));
  const s = await getSettings(db);
  const pdf = await invoicePdf({
    shopName: s.shopName,
    shopAddress: s.pickupAddress,
    shopPhone: s.supportPhone,
    orderNumber: order.orderNumber,
    date: order.createdAt,
    customerName: order.customerName,
    customerPhone: `0${order.phone.slice(3)}`,
    deliveryAddress: `${order.address}, ${order.area}, ${order.district}`,
    paymentMethod: PAYMENT_METHOD_LABELS[order.paymentMethod],
    paymentStatus: order.paymentStatus,
    deliveryMethod: DELIVERY_METHOD_LABELS[order.deliveryMethod],
    items: items.map((i) => ({ name: i.productName, variant: i.variantLabel, sku: i.sku, quantity: i.quantity, unitPrice: i.unitPrice, lineTotal: i.lineTotal })),
    subtotal: order.subtotal,
    deliveryFee: order.deliveryFee,
    discount: order.discount,
    total: order.total,
    amountPaid: order.amountPaid,
  });
  const key = `invoices/${order.createdAt.getFullYear()}/${order.orderNumber}.pdf`;
  await storage.upload({ key, body: pdf, contentType: "application/pdf", visibility: "private" });
  await db
    .insert(mediaFiles)
    .values({ area: "invoices", fileName: `${order.orderNumber}.pdf`, mimeType: "application/pdf", fileSize: pdf.length, storageProvider: storage.name, storagePath: key, isPublic: false, uploadedByStaff: c.get("staff").id })
    .onConflictDoUpdate({ target: mediaFiles.storagePath, set: { fileSize: pdf.length, createdAt: new Date() } });
  return c.json({ url: signedPrivateUrl(env.APP_SECRET, `${env.API_PUBLIC_URL}`, key, 900) });
});

/* ------------------------------------------------------------- payments */

adminOrderRoutes.get("/payments", requirePermission(P.paymentsView), async (c) => {
  const { db } = c.get("container");
  const { limit, offset } = pagination(c, 200);
  const status = c.req.query("status");
  const rows = await db
    .select({ p: payments, orderNumber: orders.orderNumber, customerName: orders.customerName })
    .from(payments)
    .innerJoin(orders, eq(orders.id, payments.orderId))
    .where(status ? eq(payments.status, status as "pending") : undefined)
    .orderBy(desc(payments.createdAt))
    .limit(limit)
    .offset(offset);
  return c.json(rows.map((r) => ({ ...r.p, raw: undefined, orderNumber: r.orderNumber, customerName: r.customerName })));
});

adminOrderRoutes.get("/payments/:id/events", requirePermission(P.paymentsView), async (c) => {
  const { db } = c.get("container");
  return c.json(await db.select().from(paymentEvents).where(eq(paymentEvents.paymentId, c.req.param("id"))).orderBy(desc(paymentEvents.createdAt)));
});

adminOrderRoutes.get("/refunds", requirePermission(P.paymentsView), async (c) => {
  const { db } = c.get("container");
  const rows = await db
    .select({ r: refunds, orderNumber: orders.orderNumber, customerName: orders.customerName, staffName: staffUsers.name })
    .from(refunds)
    .innerJoin(orders, eq(orders.id, refunds.orderId))
    .leftJoin(staffUsers, eq(staffUsers.id, refunds.staffId))
    .orderBy(desc(refunds.createdAt))
    .limit(500);
  return c.json(rows.map((r) => ({ ...r.r, raw: undefined, orderNumber: r.orderNumber, customerName: r.customerName, staffName: r.staffName })));
});

adminOrderRoutes.get("/payment-providers", requirePermission(P.settingsManage), async (c) => {
  const { payments: reg } = c.get("container");
  const out = [];
  for (const p of reg.providers()) {
    let balance = null;
    const withBalance = p as { checkBalance?: () => Promise<unknown> };
    if (withBalance.checkBalance) balance = await withBalance.checkBalance().catch((e) => ({ error: (e as Error).message }));
    out.push({ id: p.id, name: p.displayName, methods: p.methods, offline: p.offline, balance });
  }
  return c.json(out);
});

/* -------------------------------------------------------------- returns */

adminOrderRoutes.get("/returns", requirePermission(P.ordersView), async (c) => {
  const { db } = c.get("container");
  const rows = await db
    .select({ r: returns, orderNumber: orders.orderNumber, customerName: orders.customerName, phone: orders.phone })
    .from(returns)
    .innerJoin(orders, eq(orders.id, returns.orderId))
    .orderBy(desc(returns.createdAt))
    .limit(500);
  return c.json(rows.map((r) => ({ ...r.r, orderNumber: r.orderNumber, customerName: r.customerName, phone: r.phone })));
});

adminOrderRoutes.post("/orders/:id/returns", requirePermission(P.ordersManage), async (c) => {
  const input = await body(
    c,
    z.object({
      reason: z.string().min(3).max(500),
      items: z.array(z.object({ orderItemId: z.string().uuid(), quantity: z.number().int().min(1), condition: z.enum(["resellable", "damaged"]) })).min(1),
    }),
  );
  try {
    return c.json(await c.get("container").orders.createReturn(c.req.param("id"), input), 201);
  } catch (err) {
    mapDomainError(err);
  }
});

adminOrderRoutes.post("/returns/:id/:action{approve|reject|receive}", requirePermission(P.ordersManage), async (c) => {
  const input = await body(c, z.object({ refundAmount: z.number().int().min(0).optional(), staffNotes: z.string().max(1000).optional() }));
  const { db, orders: svc } = c.get("container");
  const id = c.req.param("id");
  const action = c.req.param("action");
  const staffId = c.get("staff").id;
  try {
    if (action === "receive") await svc.receiveReturn(id, staffId, input);
    else {
      const [row] = await db
        .update(returns)
        .set({ status: action === "approve" ? "approved" : "rejected", staffNotes: input.staffNotes, handledBy: staffId })
        .where(and(eq(returns.id, id), inArray(returns.status, ["requested", "approved"])))
        .returning();
      if (!row) throw new ApiError(409, "Return already processed");
    }
    await audit(db, staffId, `return.${action}`, "return", id, input);
    return c.json({ ok: true });
  } catch (err) {
    mapDomainError(err);
  }
});
