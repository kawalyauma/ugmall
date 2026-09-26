import { Hono } from "hono";
import { z } from "zod";
import { and, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm";
import { inventoryLevels, inventoryMovements, productVariants, products, staffUsers } from "@ugmall/database";
import { InsufficientStockError, inventory, lowStockVariants } from "@ugmall/inventory";
import { INVENTORY_MOVEMENT_TYPES, PERMISSIONS } from "@ugmall/shared";
import { ApiError, body, pagination } from "../../lib/http";
import { audit } from "../../lib/audit";
import { requirePermission } from "../../middleware/auth";
import type { AppEnv } from "../../types";

export const adminInventoryRoutes = new Hono<AppEnv>();
const P = PERMISSIONS;

/** Variant-level stock: Blue Jeans / Size 30 = 8, Size 32 = 17 ... */
adminInventoryRoutes.get("/", requirePermission(P.inventoryView), async (c) => {
  const { db, reservations } = c.get("container");
  const { limit, offset } = pagination(c, 500);
  const q = c.req.query("q")?.trim();
  const filter = c.req.query("filter"); // low | out
  const where: SQL[] = [eq(productVariants.isActive, true)];
  if (q) where.push(or(ilike(products.name, `%${q}%`), ilike(productVariants.sku, `%${q}%`))!);
  const avail = sql`coalesce(${inventoryLevels.onHand},0) - coalesce(${inventoryLevels.reserved},0)`;
  if (filter === "low") where.push(sql`${avail} between 1 and ${productVariants.lowStockThreshold}`);
  if (filter === "out") where.push(sql`${avail} <= 0`);
  const rows = await db
    .select({
      variantId: productVariants.id,
      sku: productVariants.sku,
      options: productVariants.options,
      productId: products.id,
      productName: products.name,
      productStatus: products.status,
      threshold: productVariants.lowStockThreshold,
      costPrice: sql<number>`coalesce(${productVariants.costPrice}, ${products.costPrice})`,
      onHand: sql<number>`coalesce(${inventoryLevels.onHand},0)`,
      reserved: sql<number>`coalesce(${inventoryLevels.reserved},0)`,
    })
    .from(productVariants)
    .innerJoin(products, eq(products.id, productVariants.productId))
    .leftJoin(inventoryLevels, eq(inventoryLevels.variantId, productVariants.id))
    .where(and(...where))
    .orderBy(products.name, productVariants.sortOrder)
    .limit(limit)
    .offset(offset);
  const held = await reservations.held(rows.map((r) => r.variantId));
  return c.json(
    rows.map((r) => {
      const inCheckout = held.get(r.variantId) ?? 0;
      const available = r.onHand - r.reserved - inCheckout;
      return { ...r, inCheckout, available, status: available <= 0 ? "out" : available <= r.threshold ? "low" : "ok" };
    }),
  );
});

adminInventoryRoutes.get("/low-stock", requirePermission(P.inventoryView), async (c) => c.json(await lowStockVariants(c.get("container").db)));

const adjustSchema = z.object({
  variantId: z.string().uuid(),
  type: z.enum(["received", "damaged", "adjustment", "count", "return"]),
  quantity: z.number().int().min(-1_000_000).max(1_000_000),
  unitCost: z.number().int().min(0).optional(),
  note: z.string().max(500).optional(),
});

adminInventoryRoutes.post("/adjust", requirePermission(P.inventoryAdjust), async (c) => {
  const input = await body(c, adjustSchema);
  const { db } = c.get("container");
  const staffId = c.get("staff").id;
  const opts = { staffId, note: input.note, unitCost: input.unitCost, referenceType: "manual" };
  if (input.type !== "adjustment" && input.type !== "count" && input.quantity <= 0) throw new ApiError(422, "Quantity must be positive");
  if (input.type === "adjustment" && !input.note) throw new ApiError(422, "Please give a reason for manual adjustments");
  try {
    const level = await db.transaction(async (tx) => {
      switch (input.type) {
        case "received":
          return inventory.receive(tx, input.variantId, input.quantity, opts);
        case "damaged":
          return inventory.damaged(tx, input.variantId, input.quantity, opts);
        case "return":
          return inventory.restockReturn(tx, [{ variantId: input.variantId, quantity: input.quantity, condition: "resellable" }], { orderId: "manual", staffId }).then(() => null);
        case "count":
          return inventory.setCount(tx, input.variantId, input.quantity, opts);
        default:
          return inventory.adjust(tx, input.variantId, input.quantity, opts);
      }
    });
    await audit(db, staffId, `inventory.${input.type}`, "variant", input.variantId, input);
    return c.json({ ok: true, level });
  } catch (err) {
    if (err instanceof InsufficientStockError) throw new ApiError(409, `Not enough stock: only ${err.available} available (reserved stock can't be removed)`);
    throw err;
  }
});

/** Stock audit trail. */
adminInventoryRoutes.get("/movements", requirePermission(P.inventoryView), async (c) => {
  const { db } = c.get("container");
  const { limit, offset } = pagination(c, 500);
  const where: SQL[] = [];
  const variantId = c.req.query("variantId");
  if (variantId) where.push(eq(inventoryMovements.variantId, variantId));
  const type = c.req.query("type");
  if (type && (INVENTORY_MOVEMENT_TYPES as readonly string[]).includes(type)) where.push(eq(inventoryMovements.type, type as (typeof INVENTORY_MOVEMENT_TYPES)[number]));
  const rows = await db
    .select({ m: inventoryMovements, sku: productVariants.sku, productName: products.name, options: productVariants.options, staffName: staffUsers.name })
    .from(inventoryMovements)
    .innerJoin(productVariants, eq(productVariants.id, inventoryMovements.variantId))
    .innerJoin(products, eq(products.id, productVariants.productId))
    .leftJoin(staffUsers, eq(staffUsers.id, inventoryMovements.staffId))
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(inventoryMovements.createdAt))
    .limit(limit)
    .offset(offset);
  return c.json(rows.map((r) => ({ ...r.m, sku: r.sku, productName: r.productName, options: r.options, staffName: r.staffName })));
});
