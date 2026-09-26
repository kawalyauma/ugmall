import { Hono } from "hono";
import { z } from "zod";
import { and, asc, count, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import {
  customers,
  mediaFiles,
  orders,
  productVariants,
  products,
  purchaseItems,
  purchases,
  reviews,
  roles,
  staffUsers,
  suppliers,
  whatsappMessages,
} from "@ugmall/database";
import { hashPassword } from "@ugmall/auth";
import { inventory } from "@ugmall/inventory";
import { ALL_PERMISSIONS, normalizeUgPhone, PERMISSIONS, REVIEW_STATUSES, ugPhone } from "@ugmall/shared";
import { ApiError, body, pagination } from "../../lib/http";
import { audit } from "../../lib/audit";
import { crudRoutes } from "../../lib/crud";
import { requirePermission } from "../../middleware/auth";
import type { AppEnv } from "../../types";

export const adminPeopleRoutes = new Hono<AppEnv>();
const P = PERMISSIONS;

/* ------------------------------------------------------------ customers */

adminPeopleRoutes.get("/customers", requirePermission(P.customersView), async (c) => {
  const { db } = c.get("container");
  const { limit, offset } = pagination(c, 200);
  const q = c.req.query("q")?.trim();
  const phone = q ? normalizeUgPhone(q) : null;
  const where = q ? or(ilike(customers.name, `%${q}%`), phone ? eq(customers.phone, phone) : ilike(customers.phone, `%${q.replace(/\D/g, "") || "x"}%`)) : undefined;
  const rows = await db
    .select({
      c: customers,
      orders: sql<number>`(select count(*)::int from ${orders} o where o.phone = ${customers.phone} and o.status <> 'cancelled')`,
      spent: sql<number>`(select coalesce(sum(o.total),0)::bigint from ${orders} o where o.phone = ${customers.phone} and o.status in ('paid','confirmed','processing','ready_for_dispatch','assigned_to_rider','out_for_delivery','delivered'))`,
    })
    .from(customers)
    .where(where)
    .orderBy(desc(customers.lastOrderAt), desc(customers.createdAt))
    .limit(limit)
    .offset(offset);
  const [{ total }] = (await db.select({ total: count() }).from(customers).where(where)) as [{ total: number }];
  return c.json({ total, items: rows.map((r) => ({ ...r.c, orderCount: r.orders, totalSpent: Number(r.spent) })) });
});

adminPeopleRoutes.get("/customers/:id", requirePermission(P.customersView), async (c) => {
  const { db } = c.get("container");
  const [cust] = await db.select().from(customers).where(eq(customers.id, c.req.param("id")));
  if (!cust) throw new ApiError(404, "Customer not found");
  const [custOrders, messages] = await Promise.all([
    db.select().from(orders).where(eq(orders.phone, cust.phone)).orderBy(desc(orders.createdAt)).limit(200),
    db.select().from(whatsappMessages).where(eq(whatsappMessages.phone, cust.phone)).orderBy(desc(whatsappMessages.createdAt)).limit(100),
  ]);
  return c.json({ ...cust, orders: custOrders.map((o) => ({ ...o, trackingToken: undefined })), messages });
});

adminPeopleRoutes.patch("/customers/:id", requirePermission(P.customersManage), async (c) => {
  const input = await body(c, z.object({ name: z.string().min(2).max(120).optional(), altPhone: ugPhone.nullable().optional(), email: z.string().email().nullable().optional(), notes: z.string().max(5000).nullable().optional(), isBlocked: z.boolean().optional() }));
  const { db } = c.get("container");
  const patch: Record<string, unknown> = { ...input };
  if (input.altPhone) patch.altPhone = normalizeUgPhone(input.altPhone);
  const [row] = await db.update(customers).set(patch).where(eq(customers.id, c.req.param("id"))).returning();
  await audit(db, c.get("staff").id, "customer.update", "customer", c.req.param("id"), input);
  return c.json(row);
});

/* -------------------------------------------------------------- reviews */

adminPeopleRoutes.get("/reviews", requirePermission(P.reviewsManage), async (c) => {
  const { db } = c.get("container");
  const status = c.req.query("status");
  const rows = await db
    .select({ r: reviews, productName: products.name, productSlug: products.slug })
    .from(reviews)
    .innerJoin(products, eq(products.id, reviews.productId))
    .where(status && (REVIEW_STATUSES as readonly string[]).includes(status) ? eq(reviews.status, status as "pending") : undefined)
    .orderBy(desc(reviews.createdAt))
    .limit(500);
  const ids = rows.flatMap((r) => r.r.imageIds);
  const imgs = ids.length ? await db.select({ id: mediaFiles.id, url: mediaFiles.publicUrl }).from(mediaFiles).where(inArray(mediaFiles.id, ids)) : [];
  return c.json(rows.map((r) => ({ ...r.r, productName: r.productName, productSlug: r.productSlug, images: r.r.imageIds.map((i) => imgs.find((m) => m.id === i)?.url).filter(Boolean) })));
});

async function refreshRating(db: Parameters<typeof audit>[0], productId: string) {
  await db
    .update(products)
    .set({
      ratingAverage: sql`coalesce((select round(avg(rating) * 100)::int from ${reviews} where product_id = ${productId} and status = 'approved'), 0)`,
      ratingCount: sql`(select count(*)::int from ${reviews} where product_id = ${productId} and status = 'approved')`,
    })
    .where(eq(products.id, productId));
}

adminPeopleRoutes.patch("/reviews/:id", requirePermission(P.reviewsManage), async (c) => {
  const input = await body(c, z.object({ status: z.enum(REVIEW_STATUSES).optional(), reply: z.string().max(2000).nullable().optional() }));
  const { db } = c.get("container");
  const [row] = await db.update(reviews).set(input).where(eq(reviews.id, c.req.param("id"))).returning();
  if (!row) throw new ApiError(404, "Review not found");
  await refreshRating(db, row.productId);
  return c.json(row);
});

adminPeopleRoutes.delete("/reviews/:id", requirePermission(P.reviewsManage), async (c) => {
  const { db } = c.get("container");
  const [row] = await db.delete(reviews).where(eq(reviews.id, c.req.param("id"))).returning();
  if (row) await refreshRating(db, row.productId);
  return c.json({ ok: true });
});

/* ------------------------------------------------------------ suppliers */

adminPeopleRoutes.route(
  "/suppliers",
  crudRoutes({
    table: suppliers,
    schema: z.object({
      name: z.string().trim().min(2).max(120),
      contactName: z.string().max(120).nullable().optional(),
      phone: z.string().max(30).nullable().optional(),
      email: z.string().email().nullable().optional().or(z.literal("")),
      address: z.string().max(300).nullable().optional(),
      notes: z.string().max(2000).nullable().optional(),
      isActive: z.boolean().default(true),
    }),
    entity: "supplier",
    permission: P.purchasesManage,
    searchColumns: [suppliers.name, suppliers.phone],
    orderBy: suppliers.name,
    orderDesc: false,
  }),
);

/* ------------------------------------------------------------ purchases */

const purchaseSchema = z.object({
  supplierId: z.string().uuid().nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  items: z.array(z.object({ variantId: z.string().uuid(), quantity: z.number().int().min(1), unitCost: z.number().int().min(0) })).min(1).max(500),
});

adminPeopleRoutes.get("/purchases", requirePermission(P.purchasesManage), async (c) => {
  const { db } = c.get("container");
  const rows = await db
    .select({ p: purchases, supplierName: suppliers.name, items: sql<number>`(select coalesce(sum(quantity),0)::int from ${purchaseItems} i where i.purchase_id = ${purchases.id})` })
    .from(purchases)
    .leftJoin(suppliers, eq(suppliers.id, purchases.supplierId))
    .orderBy(desc(purchases.createdAt))
    .limit(500);
  return c.json(rows.map((r) => ({ ...r.p, supplierName: r.supplierName, itemCount: r.items })));
});

adminPeopleRoutes.get("/purchases/:id", requirePermission(P.purchasesManage), async (c) => {
  const { db } = c.get("container");
  const [p] = await db.select().from(purchases).where(eq(purchases.id, c.req.param("id")));
  if (!p) throw new ApiError(404, "Purchase not found");
  const items = await db
    .select({ i: purchaseItems, sku: productVariants.sku, options: productVariants.options, productName: products.name })
    .from(purchaseItems)
    .innerJoin(productVariants, eq(productVariants.id, purchaseItems.variantId))
    .innerJoin(products, eq(products.id, productVariants.productId))
    .where(eq(purchaseItems.purchaseId, p.id))
    .orderBy(asc(products.name));
  return c.json({ ...p, items: items.map((r) => ({ ...r.i, sku: r.sku, options: r.options, productName: r.productName })) });
});

adminPeopleRoutes.post("/purchases", requirePermission(P.purchasesManage), async (c) => {
  const input = await body(c, purchaseSchema);
  const { db } = c.get("container");
  const reference = `PO-${new Date().getFullYear()}-${Date.now().toString(36).toUpperCase()}`;
  const row = await db.transaction(async (tx) => {
    const [p] = await tx
      .insert(purchases)
      .values({ reference, supplierId: input.supplierId, notes: input.notes, status: "ordered", orderedAt: new Date(), createdBy: c.get("staff").id, totalCost: input.items.reduce((s, i) => s + i.quantity * i.unitCost, 0) })
      .returning();
    await tx.insert(purchaseItems).values(input.items.map((i) => ({ ...i, purchaseId: p!.id })));
    return p!;
  });
  return c.json(row, 201);
});

/** Receive goods: adds stock (movement type "received") and updates variant cost prices. */
adminPeopleRoutes.post("/purchases/:id/receive", requirePermission(P.purchasesManage, P.inventoryAdjust), async (c) => {
  const input = await body(c, z.object({ items: z.array(z.object({ purchaseItemId: z.string().uuid(), quantity: z.number().int().min(0) })).optional(), updateCostPrices: z.boolean().default(true) }));
  const { db } = c.get("container");
  const staffId = c.get("staff").id;
  const id = c.req.param("id");
  await db.transaction(async (tx) => {
    const [p] = await tx.select().from(purchases).where(eq(purchases.id, id)).for("update");
    if (!p) throw new ApiError(404, "Purchase not found");
    if (p.status === "received" || p.status === "cancelled") throw new ApiError(409, `Purchase already ${p.status}`);
    const items = await tx.select().from(purchaseItems).where(eq(purchaseItems.purchaseId, id));
    for (const it of items) {
      const qty = input.items ? (input.items.find((x) => x.purchaseItemId === it.id)?.quantity ?? 0) : it.quantity - it.receivedQuantity;
      if (qty <= 0) continue;
      await inventory.receive(tx, it.variantId, qty, { unitCost: it.unitCost, referenceType: "purchase", referenceId: p.reference, staffId });
      await tx.update(purchaseItems).set({ receivedQuantity: it.receivedQuantity + qty }).where(eq(purchaseItems.id, it.id));
      if (input.updateCostPrices) await tx.update(productVariants).set({ costPrice: it.unitCost }).where(eq(productVariants.id, it.variantId));
    }
    const after = await tx.select().from(purchaseItems).where(eq(purchaseItems.purchaseId, id));
    const complete = after.every((i) => i.receivedQuantity >= i.quantity);
    await tx.update(purchases).set({ status: complete ? "received" : "ordered", receivedAt: complete ? new Date() : null }).where(eq(purchases.id, id));
  });
  await audit(db, staffId, "purchase.receive", "purchase", id, input);
  return c.json({ ok: true });
});

adminPeopleRoutes.post("/purchases/:id/cancel", requirePermission(P.purchasesManage), async (c) => {
  const { db } = c.get("container");
  const [row] = await db.update(purchases).set({ status: "cancelled" }).where(and(eq(purchases.id, c.req.param("id")), inArray(purchases.status, ["draft", "ordered"]))).returning();
  if (!row) throw new ApiError(409, "Only open purchases can be cancelled");
  return c.json(row);
});

/* ---------------------------------------------------------- staff/roles */

adminPeopleRoutes.get("/roles", requirePermission(P.staffManage), async (c) => {
  const { db } = c.get("container");
  const rows = await db
    .select({ r: roles, members: sql<number>`(select count(*)::int from ${staffUsers} s where s.role_id = ${roles.id})` })
    .from(roles)
    .orderBy(asc(roles.name));
  return c.json({ roles: rows.map((r) => ({ ...r.r, members: r.members })), allPermissions: ALL_PERMISSIONS });
});

const permissionList = z.array(z.string().refine((p) => p === "*" || (ALL_PERMISSIONS as string[]).includes(p), "Unknown permission"));

adminPeopleRoutes.post("/roles", requirePermission(P.staffManage), async (c) => {
  const input = await body(c, z.object({ name: z.string().trim().min(2).max(40).regex(/^[a-z0-9_-]+$/i), description: z.string().max(200).optional(), permissions: permissionList }));
  const { db } = c.get("container");
  const [row] = await db.insert(roles).values({ ...input, name: input.name.toLowerCase() }).returning();
  await audit(db, c.get("staff").id, "role.create", "role", row!.id, input);
  return c.json(row, 201);
});

adminPeopleRoutes.patch("/roles/:id", requirePermission(P.staffManage), async (c) => {
  const input = await body(c, z.object({ description: z.string().max(200).optional(), permissions: permissionList.optional() }));
  const { db } = c.get("container");
  const [existing] = await db.select().from(roles).where(eq(roles.id, c.req.param("id")));
  if (!existing) throw new ApiError(404, "Role not found");
  if (existing.name === "owner" && input.permissions && !input.permissions.includes("*")) throw new ApiError(422, "The owner role must keep full access");
  const [row] = await db.update(roles).set(input).where(eq(roles.id, existing.id)).returning();
  await audit(db, c.get("staff").id, "role.update", "role", existing.id, input);
  return c.json(row);
});

adminPeopleRoutes.get("/staff", requirePermission(P.staffManage), async (c) => {
  const { db } = c.get("container");
  const rows = await db
    .select({ id: staffUsers.id, name: staffUsers.name, email: staffUsers.email, phone: staffUsers.phone, isActive: staffUsers.isActive, lastLoginAt: staffUsers.lastLoginAt, roleId: staffUsers.roleId, roleName: roles.name, createdAt: staffUsers.createdAt })
    .from(staffUsers)
    .innerJoin(roles, eq(roles.id, staffUsers.roleId))
    .orderBy(asc(staffUsers.name));
  return c.json(rows);
});

adminPeopleRoutes.post("/staff", requirePermission(P.staffManage), async (c) => {
  const input = await body(c, z.object({ name: z.string().trim().min(2).max(120), email: z.string().email(), phone: ugPhone.optional().or(z.literal("")), roleId: z.string().uuid(), password: z.string().min(10).max(200) }));
  const { db } = c.get("container");
  try {
    const [row] = await db
      .insert(staffUsers)
      .values({ name: input.name, email: input.email.toLowerCase(), phone: input.phone ? normalizeUgPhone(input.phone) : null, roleId: input.roleId, passwordHash: await hashPassword(input.password) })
      .returning({ id: staffUsers.id, name: staffUsers.name, email: staffUsers.email });
    await audit(db, c.get("staff").id, "staff.create", "staff", row!.id, { email: row!.email });
    return c.json(row, 201);
  } catch (err) {
    if ((err as { cause?: { code?: string } }).cause?.code === "23505") throw new ApiError(409, "A staff member with that email already exists");
    throw err;
  }
});

adminPeopleRoutes.patch("/staff/:id", requirePermission(P.staffManage), async (c) => {
  const input = await body(c, z.object({ name: z.string().min(2).max(120).optional(), phone: ugPhone.nullable().optional().or(z.literal("")), roleId: z.string().uuid().optional(), isActive: z.boolean().optional(), password: z.string().min(10).max(200).optional() }));
  const { db, sessions } = c.get("container");
  const id = c.req.param("id");
  if (id === c.get("staff").id && input.isActive === false) throw new ApiError(422, "You can't deactivate yourself");
  const { password, ...rest } = input;
  const patch: Record<string, unknown> = { ...rest };
  if (input.phone !== undefined) patch.phone = input.phone ? normalizeUgPhone(input.phone) : null;
  if (password) patch.passwordHash = await hashPassword(password);
  const [row] = await db.update(staffUsers).set(patch).where(eq(staffUsers.id, id)).returning({ id: staffUsers.id, name: staffUsers.name, isActive: staffUsers.isActive });
  if (!row) throw new ApiError(404, "Staff member not found");
  if (input.isActive === false || password || input.roleId) await sessions.destroyAll("staff", id);
  await audit(db, c.get("staff").id, "staff.update", "staff", id, { ...rest, passwordChanged: !!password });
  return c.json(row);
});
