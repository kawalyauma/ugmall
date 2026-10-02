import { randomBytes } from "node:crypto";
import { Hono } from "hono";
import { z } from "zod";
import { and, count, desc, eq, gt, inArray, sql } from "drizzle-orm";
import { coupons, customerAddresses, customerCampaigns, customers, orderItems, orders, products, reviews, wishlistItems } from "@ugmall/database";
import { normalizeUgPhone, ORDER_STATUS_LABELS, reviewSchema, ugPhone } from "@ugmall/shared";
import { ApiError, body, clearCookie, COOKIES, writeCookie, clientIp, getDeviceId } from "../../lib/http";
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
  locationId: z.number().int().positive().optional().nullable(),
  nearbyPlace: z.string().max(200).optional().nullable(),
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

/** Account-free order history tied to this anonymous browser. */
accountRoutes.get("/device-orders", async (c) => {
  const { db } = c.get("container");
  const deviceId = getDeviceId(c, true)!;
  const query = z.object({ limit:z.coerce.number().int().min(1).max(100).default(20), offset:z.coerce.number().int().min(0).default(0) }).parse(c.req.query());
  const where = eq(orders.deviceId, deviceId);
  const [rows, totalRows, summaryRows] = await Promise.all([
    db.select().from(orders).where(where).orderBy(desc(orders.createdAt)).limit(query.limit).offset(query.offset),
    db.select({ total:count() }).from(orders).where(where),
    db.select({
      totalOrders:count(),
      openOrders:sql<number>`count(*) filter (where ${orders.status} not in ('delivered','cancelled','returned','refunded'))::int`,
      deliveredOrders:sql<number>`count(*) filter (where ${orders.status}='delivered')::int`,
      totalSpent:sql<number>`coalesce(sum(case when ${orders.status} not in ('cancelled','refunded') then ${orders.total} else 0 end),0)::int`,
    }).from(orders).where(where),
  ]);
  const items = rows.length ? await db.select().from(orderItems).where(inArray(orderItems.orderId, rows.map((r) => r.id))) : [];
  const summary = summaryRows[0];
  return c.json({
    secured:false,
    summary:{ totalOrders:summary?.totalOrders ?? 0, openOrders:summary?.openOrders ?? 0, deliveredOrders:summary?.deliveredOrders ?? 0, totalSpent:summary?.totalSpent ?? 0 },
    pagination:{ total:totalRows[0]?.total ?? 0, limit:query.limit, offset:query.offset },
    orders:rows.map((o) => ({
      orderNumber:o.orderNumber, status:o.status, statusLabel:ORDER_STATUS_LABELS[o.status], paymentStatus:o.paymentStatus,
      paymentMethod:o.paymentMethod, deliveryMethod:o.deliveryMethod, total:o.total, amountPaid:o.amountPaid,
      createdAt:o.createdAt, updatedAt:o.updatedAt,
      itemCount:items.filter((i) => i.orderId === o.id).reduce((sum, i) => sum + i.quantity, 0),
      firstImage:items.find((i) => i.orderId === o.id)?.imageUrl ?? null,
    })),
  });
});

accountRoutes.get("/orders", requireCustomer, async (c) => {
  const { db } = c.get("container");
  const customer = c.get("customer")!;
  // Re-link any guest orders made with the same verified phone since sign-in.
  await db.update(orders).set({ customerId: customer.id }).where(and(eq(orders.phone, customer.phone), sql`${orders.customerId} is distinct from ${customer.id}`));
  const query = z.object({ limit:z.coerce.number().int().min(1).max(100).default(20), offset:z.coerce.number().int().min(0).default(0) }).parse(c.req.query());
  const where = eq(orders.customerId, customer.id);
  const [rows, totalRows, summaryRows] = await Promise.all([db
    .select()
    .from(orders)
    .where(where)
    .orderBy(desc(orders.createdAt))
    .limit(query.limit)
    .offset(query.offset),
  db.select({ total:count() }).from(orders).where(where),
  db.select({
    totalOrders:count(),
    openOrders:sql<number>`count(*) filter (where ${orders.status} not in ('delivered','cancelled','returned','refunded'))::int`,
    deliveredOrders:sql<number>`count(*) filter (where ${orders.status}='delivered')::int`,
    totalSpent:sql<number>`coalesce(sum(case when ${orders.status} not in ('cancelled','refunded') then ${orders.total} else 0 end),0)::int`,
  }).from(orders).where(where)]);
  const total = totalRows[0]?.total ?? 0;
  const summary = summaryRows[0];
  const items = rows.length ? await db.select().from(orderItems).where(inArray(orderItems.orderId, rows.map((r) => r.id))) : [];
  return c.json({
    summary:{ totalOrders:summary?.totalOrders ?? 0, openOrders:summary?.openOrders ?? 0, deliveredOrders:summary?.deliveredOrders ?? 0, totalSpent:summary?.totalSpent ?? 0 },
    pagination:{ total, limit:query.limit, offset:query.offset },
    orders:rows.map((o) => ({
      orderNumber: o.orderNumber,
      status: o.status,
      statusLabel: ORDER_STATUS_LABELS[o.status],
      paymentStatus:o.paymentStatus,
      paymentMethod:o.paymentMethod,
      deliveryMethod:o.deliveryMethod,
      total: o.total,
      amountPaid:o.amountPaid,
      createdAt: o.createdAt,
      updatedAt:o.updatedAt,
      itemCount: items.filter((i) => i.orderId === o.id).reduce((s, i) => s + i.quantity, 0),
      firstImage: items.find((i) => i.orderId === o.id)?.imageUrl ?? null,
    })),
  });
});

accountRoutes.get("/promotion", requireCustomer, async (c) => {
  const { db } = c.get("container");
  const customer = c.get("customer")!;
  const now = new Date();
  const [existingCampaign] = await db
    .select({ campaign:customerCampaigns, coupon:coupons })
    .from(customerCampaigns)
    .innerJoin(coupons, eq(coupons.id, customerCampaigns.couponId))
    .where(and(eq(customerCampaigns.customerId, customer.id), gt(customerCampaigns.endsAt, now)))
    .orderBy(desc(customerCampaigns.createdAt))
    .limit(1);
  let campaign: typeof existingCampaign | null = existingCampaign ?? null;

  if (!campaign) {
    campaign = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`buyer-campaign:${customer.id}`}))`);
      const [existing] = await tx
        .select({ campaign:customerCampaigns, coupon:coupons })
        .from(customerCampaigns)
        .innerJoin(coupons, eq(coupons.id, customerCampaigns.couponId))
        .where(and(eq(customerCampaigns.customerId, customer.id), gt(customerCampaigns.endsAt, now)))
        .orderBy(desc(customerCampaigns.createdAt))
        .limit(1);
      if (existing) return existing;
      await tx.update(coupons).set({ isActive:false }).where(eq(coupons.customerId, customer.id));
      const picks = await tx
        .select({ id:products.id })
        .from(products)
        .where(and(
          eq(products.status, "active"),
          sql`${products.price} between 20000 and 500000`,
          sql`(${products.costPrice}=0 or ${products.price}-${products.costPrice} >= 10000)`,
          sql`exists (select 1 from product_variants v join inventory_levels l on l.variant_id=v.id where v.product_id=${products.id} and v.is_active and greatest(l.on_hand-l.reserved,0)>0)`,
        ))
        .orderBy(products.price)
        .limit(8);
      if (!picks.length) return null;
      const startsAt = new Date();
      const endsAt = new Date(startsAt.getTime() + 24 * 60 * 60_000);
      const productIds = picks.map((p) => p.id);
      const code = `JUST4U-${customer.id.slice(0,4).toUpperCase()}-${randomBytes(2).toString("hex").toUpperCase()}`;
      const [coupon] = await tx.insert(coupons).values({
        code, customerId:customer.id, productIds, description:"Your private 24-hour UG Mall offer", type:"percent", value:3,
        maxDiscount:5000, minOrderAmount:20000, maxUses:1, maxUsesPerCustomer:1, startsAt, endsAt,
      }).returning();
      const [created] = await tx.insert(customerCampaigns).values({ customerId:customer.id, couponId:coupon!.id, title:"A little something, just for you", productIds, startsAt, endsAt }).returning();
      return { campaign:created!, coupon:coupon! };
    });
  }
  if (!campaign) return c.json(null);
  const catalogue = await listProducts(db, { productIds:campaign.campaign.productIds, inStock:true, sort:"price_asc", limit:8, offset:0 });
  return c.json({
    id:campaign.campaign.id,
    title:campaign.campaign.title,
    code:campaign.coupon.code,
    percentOff:campaign.coupon.value,
    maxDiscount:campaign.coupon.maxDiscount,
    startsAt:campaign.campaign.startsAt,
    endsAt:campaign.campaign.endsAt,
    used:campaign.coupon.usedCount > 0,
    products:catalogue.items,
  });
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
