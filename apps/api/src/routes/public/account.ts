import { Hono } from "hono";
import { z } from "zod";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { customerAddresses, customers, orderItems, orders, products, reviews, wishlistItems } from "@ugmall/database";
import { normalizeUgPhone, ORDER_STATUS_LABELS, reviewSchema, ugPhone } from "@ugmall/shared";
import { ApiError, body, clearCookie, COOKIES, writeCookie, clientIp } from "../../lib/http";
import { listProducts } from "../../lib/catalog";
import { readUpload, saveImage } from "../../lib/media";
import { requireCustomer } from "../../middleware/auth";
import { limit } from "../../middleware/security";
import type { AppEnv } from "../../types";
import { mapDomainError } from "./checkout";

export const accountRoutes = new Hono<AppEnv>();

accountRoutes.post("/otp/request", limit("otp-ip", 10, 3600), async (c) => {
  const { phone } = await body(c, z.object({ phone: ugPhone }));
  const { otp, queues, env } = c.get("container");
  const n = normalizeUgPhone(phone)!;
  const r = await otp.request(n);
  if (!r.ok) throw new ApiError(429, `Please wait ${r.retryAfter}s before requesting another code`);
  await queues.notifications.add("otp", {
    event: "otp",
    to: n,
    context: {
      shopName: env.SHOP_NAME, code: r.code, orderNumber: "", customerName: "", total: 0,
      paymentMethod: "cash_on_delivery", deliveryMethod: "boda", trackingUrl: "", items: [],
    },
  });
  // In development the code is returned so you can sign in without WhatsApp configured.
  return c.json({ ok: true, expiresIn: r.expiresIn, devCode: env.NODE_ENV !== "production" ? r.code : undefined });
});

accountRoutes.post("/otp/verify", limit("otp-verify", 20, 3600), async (c) => {
  const input = await body(c, z.object({ phone: ugPhone, code: z.string().regex(/^\d{6}$/), name: z.string().trim().min(2).max(120).optional() }));
  const { otp, db, sessions } = c.get("container");
  const phone = normalizeUgPhone(input.phone)!;
  if (!(await otp.verify(phone, input.code))) throw new ApiError(401, "That code is incorrect or has expired");
  const [customer] = await db
    .insert(customers)
    .values({ phone, name: input.name ?? "Customer", isRegistered: true })
    .onConflictDoUpdate({ target: customers.phone, set: { isRegistered: true, ...(input.name ? { name: input.name } : {}) } })
    .returning();
  if (customer!.isBlocked) throw new ApiError(403, "This account is blocked. Please contact us.");
  const token = await sessions.create("customer", customer!.id, { ip: clientIp(c), userAgent: c.req.header("user-agent") });
  writeCookie(c, COOKIES.customer, token, 60 * 60 * 24 * 60);
  // Link earlier guest orders placed with this phone.
  await db.update(orders).set({ customerId: customer!.id }).where(and(eq(orders.phone, phone), sql`${orders.customerId} is distinct from ${customer!.id}`));
  return c.json({ id: customer!.id, name: customer!.name, phone: customer!.phone });
});

accountRoutes.post("/logout", async (c) => {
  await c.get("container").sessions.destroy(c.get("sessionToken"));
  clearCookie(c, COOKIES.customer);
  return c.json({ ok: true });
});

accountRoutes.get("/me", async (c) => {
  const customer = c.get("customer");
  if (!customer) return c.json(null);
  const { db } = c.get("container");
  const [row] = await db.select().from(customers).where(eq(customers.id, customer.id));
  const addresses = await db.select().from(customerAddresses).where(eq(customerAddresses.customerId, customer.id));
  return c.json({ id: row!.id, name: row!.name, phone: row!.phone, altPhone: row!.altPhone, email: row!.email, addresses });
});

accountRoutes.use("/profile", requireCustomer);
accountRoutes.patch("/profile", async (c) => {
  const input = await body(c, z.object({ name: z.string().trim().min(2).max(120), altPhone: ugPhone.optional().or(z.literal("")), email: z.string().email().optional().or(z.literal("")) }));
  const { db } = c.get("container");
  await db
    .update(customers)
    .set({ name: input.name, altPhone: input.altPhone ? normalizeUgPhone(input.altPhone) : null, email: input.email || null })
    .where(eq(customers.id, c.get("customer")!.id));
  return c.json({ ok: true });
});

accountRoutes.use("/addresses/*", requireCustomer);
accountRoutes.use("/addresses", requireCustomer);
const addressSchema = z.object({
  label: z.string().max(40).optional(),
  district: z.string().min(2).max(80),
  area: z.string().min(2).max(120),
  address: z.string().min(2).max(300),
  deliveryZoneId: z.string().uuid().optional().nullable(),
  isDefault: z.boolean().optional(),
});
accountRoutes.post("/addresses", async (c) => {
  const input = await body(c, addressSchema);
  const { db } = c.get("container");
  const customerId = c.get("customer")!.id;
  if (input.isDefault) await db.update(customerAddresses).set({ isDefault: false }).where(eq(customerAddresses.customerId, customerId));
  const [row] = await db.insert(customerAddresses).values({ ...input, customerId }).returning();
  return c.json(row);
});
accountRoutes.delete("/addresses/:id", async (c) => {
  const { db } = c.get("container");
  await db.delete(customerAddresses).where(and(eq(customerAddresses.id, c.req.param("id")), eq(customerAddresses.customerId, c.get("customer")!.id)));
  return c.json({ ok: true });
});

accountRoutes.get("/orders", requireCustomer, async (c) => {
  const { db } = c.get("container");
  const rows = await db
    .select()
    .from(orders)
    .where(eq(orders.customerId, c.get("customer")!.id))
    .orderBy(desc(orders.createdAt))
    .limit(100);
  const items = rows.length ? await db.select().from(orderItems).where(inArray(orderItems.orderId, rows.map((r) => r.id))) : [];
  return c.json(
    rows.map((o) => ({
      orderNumber: o.orderNumber,
      trackingToken: o.trackingToken,
      status: o.status,
      statusLabel: ORDER_STATUS_LABELS[o.status],
      total: o.total,
      createdAt: o.createdAt,
      itemCount: items.filter((i) => i.orderId === o.id).reduce((s, i) => s + i.quantity, 0),
      firstImage: items.find((i) => i.orderId === o.id)?.imageUrl ?? null,
    })),
  );
});

/* -------------------------------------------------------------- wishlist */

accountRoutes.get("/wishlist", requireCustomer, async (c) => {
  const { db } = c.get("container");
  const ids = (await db.select({ id: wishlistItems.productId }).from(wishlistItems).where(eq(wishlistItems.customerId, c.get("customer")!.id))).map((r) => r.id);
  const { items } = await listProducts(db, { productIds: ids, limit: 200, offset: 0 });
  return c.json(items);
});
accountRoutes.put("/wishlist/:productId", requireCustomer, async (c) => {
  const { db } = c.get("container");
  const [p] = await db.select({ id: products.id }).from(products).where(eq(products.id, c.req.param("productId")));
  if (!p) throw new ApiError(404, "Product not found");
  await db.insert(wishlistItems).values({ customerId: c.get("customer")!.id, productId: p.id }).onConflictDoNothing();
  return c.json({ ok: true });
});
accountRoutes.delete("/wishlist/:productId", requireCustomer, async (c) => {
  const { db } = c.get("container");
  await db.delete(wishlistItems).where(and(eq(wishlistItems.customerId, c.get("customer")!.id), eq(wishlistItems.productId, c.req.param("productId"))));
  return c.json({ ok: true });
});

/* --------------------------------------------------------------- reviews */

accountRoutes.post("/review-images", requireCustomer, limit("review-upload", 20, 3600), async (c) => {
  const { db, storage } = c.get("container");
  const { buffer, name } = await readUpload(await c.req.formData());
  const customer = c.get("customer")!;
  const media = await saveImage(db, storage, { area: "reviews", folders: [customer.id.slice(0, 8)], baseName: "review", buffer, originalName: name, customerId: customer.id });
  return c.json({ id: media.id, url: media.publicUrl });
});

accountRoutes.post("/products/:productId/reviews", requireCustomer, limit("review", 10, 3600), async (c) => {
  const input = await body(c, reviewSchema);
  const { db } = c.get("container");
  const customer = c.get("customer")!;
  const productId = c.req.param("productId");
  const [purchase] = await db
    .select({ orderId: orders.id })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .where(and(eq(orderItems.productId, productId), eq(orders.customerId, customer.id), eq(orders.status, "delivered")))
    .limit(1);
  const [existing] = await db.select({ id: reviews.id }).from(reviews).where(and(eq(reviews.productId, productId), eq(reviews.customerId, customer.id)));
  if (existing) throw new ApiError(409, "You have already reviewed this product");
  const [row] = await db
    .insert(reviews)
    .values({
      productId,
      customerId: customer.id,
      orderId: purchase?.orderId,
      name: input.name ?? customer.name,
      rating: input.rating,
      title: input.title,
      body: input.body,
      imageIds: input.imageIds ?? [],
      isVerifiedPurchase: !!purchase,
    })
    .returning();
  return c.json({ id: row!.id, status: row!.status, message: "Thanks! Your review will appear after moderation." });
});

/* --------------------------------------------------------------- returns */

accountRoutes.post("/orders/:orderNumber/returns", requireCustomer, async (c) => {
  const input = await body(
    c,
    z.object({
      reason: z.string().min(3).max(500),
      items: z.array(z.object({ orderItemId: z.string().uuid(), quantity: z.number().int().min(1), condition: z.enum(["resellable", "damaged"]).default("resellable") })).min(1),
    }),
  );
  const { db, orders: svc } = c.get("container");
  const [order] = await db.select().from(orders).where(and(eq(orders.orderNumber, c.req.param("orderNumber")), eq(orders.customerId, c.get("customer")!.id)));
  if (!order) throw new ApiError(404, "Order not found");
  try {
    const ret = await svc.createReturn(order.id, input);
    return c.json({ id: ret.id, status: ret.status });
  } catch (err) {
    mapDomainError(err);
  }
});
