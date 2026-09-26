import { and, eq, inArray, sql } from "drizzle-orm";
import { inventoryLevels, inventoryMovements, productVariants, products, type DbOrTx } from "@ugmall/database";
import type { InventoryMovementType } from "@ugmall/shared";

export class InsufficientStockError extends Error {
  constructor(
    public variantId: string,
    public requested: number,
    public available: number,
  ) {
    super(`Insufficient stock for variant ${variantId}: requested ${requested}, available ${available}`);
  }
}

export interface MovementInput {
  variantId: string;
  type: InventoryMovementType;
  onHandDelta?: number;
  reservedDelta?: number;
  unitCost?: number | null;
  referenceType?: string;
  referenceId?: string;
  note?: string;
  staffId?: string | null;
}

export async function ensureInventoryRows(db: DbOrTx, variantIds: string[]) {
  if (!variantIds.length) return;
  await db
    .insert(inventoryLevels)
    .values(variantIds.map((variantId) => ({ variantId })))
    .onConflictDoNothing();
}

/**
 * Applies one stock movement atomically: a single conditional UPDATE keeps
 * on_hand >= 0 and 0 <= reserved <= on_hand even under concurrent checkouts,
 * then the movement is appended to the audit trail with the resulting levels.
 */
export async function applyMovement(db: DbOrTx, m: MovementInput) {
  const dOn = m.onHandDelta ?? 0;
  const dRes = m.reservedDelta ?? 0;
  await ensureInventoryRows(db, [m.variantId]);
  const rows = await db
    .update(inventoryLevels)
    .set({
      onHand: sql`${inventoryLevels.onHand} + ${dOn}`,
      reserved: sql`${inventoryLevels.reserved} + ${dRes}`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(inventoryLevels.variantId, m.variantId),
        sql`${inventoryLevels.onHand} + ${dOn} >= 0`,
        sql`${inventoryLevels.reserved} + ${dRes} >= 0`,
        sql`${inventoryLevels.reserved} + ${dRes} <= ${inventoryLevels.onHand} + ${dOn}`,
      ),
    )
    .returning({ onHand: inventoryLevels.onHand, reserved: inventoryLevels.reserved });
  const row = rows[0];
  if (!row) {
    const [cur] = await db.select().from(inventoryLevels).where(eq(inventoryLevels.variantId, m.variantId));
    const available = cur ? cur.onHand - cur.reserved : 0;
    throw new InsufficientStockError(m.variantId, Math.abs(dRes || dOn), available);
  }
  await db.insert(inventoryMovements).values({
    variantId: m.variantId,
    type: m.type,
    onHandDelta: dOn,
    reservedDelta: dRes,
    onHandAfter: row.onHand,
    reservedAfter: row.reserved,
    unitCost: m.unitCost ?? null,
    referenceType: m.referenceType,
    referenceId: m.referenceId,
    note: m.note,
    staffId: m.staffId ?? null,
  });
  return row;
}

export interface StockLine {
  variantId: string;
  quantity: number;
}

/** Sort lines by variant id so concurrent transactions lock rows in the same order (no deadlocks). */
const ordered = (lines: StockLine[]) => [...lines].sort((a, b) => a.variantId.localeCompare(b.variantId));

export const inventory = {
  receive: (db: DbOrTx, variantId: string, quantity: number, opts: Omit<MovementInput, "variantId" | "type" | "onHandDelta"> = {}) =>
    applyMovement(db, { ...opts, variantId, type: "received", onHandDelta: Math.abs(quantity) }),

  damaged: (db: DbOrTx, variantId: string, quantity: number, opts: Omit<MovementInput, "variantId" | "type" | "onHandDelta"> = {}) =>
    applyMovement(db, { ...opts, variantId, type: "damaged", onHandDelta: -Math.abs(quantity) }),

  /** Manual correction by a signed delta. */
  adjust: (db: DbOrTx, variantId: string, delta: number, opts: Omit<MovementInput, "variantId" | "type" | "onHandDelta"> = {}) =>
    applyMovement(db, { ...opts, variantId, type: "adjustment", onHandDelta: delta }),

  /** Stock-take: set on-hand to a counted value. */
  async setCount(db: DbOrTx, variantId: string, counted: number, opts: Omit<MovementInput, "variantId" | "type" | "onHandDelta"> = {}) {
    await ensureInventoryRows(db, [variantId]);
    const [cur] = await db.select().from(inventoryLevels).where(eq(inventoryLevels.variantId, variantId)).for("update");
    const delta = counted - (cur?.onHand ?? 0);
    if (delta === 0) return cur;
    return applyMovement(db, { ...opts, variantId, type: "adjustment", onHandDelta: delta, note: opts.note ?? `Stock count: ${counted}` });
  },

  /** Order placed: hold stock (reserved += qty). */
  async reserveForOrder(db: DbOrTx, lines: StockLine[], orderId: string) {
    for (const l of ordered(lines)) {
      await applyMovement(db, { variantId: l.variantId, type: "reserve", reservedDelta: l.quantity, referenceType: "order", referenceId: orderId });
    }
  },

  /** Order cancelled/expired before fulfilment: release the hold. */
  async releaseForOrder(db: DbOrTx, lines: StockLine[], orderId: string, note?: string) {
    for (const l of ordered(lines)) {
      await applyMovement(db, { variantId: l.variantId, type: "release", reservedDelta: -l.quantity, referenceType: "order", referenceId: orderId, note });
    }
  },

  /** Paid (or delivered, for COD): convert the hold into a sale. */
  async commitSale(db: DbOrTx, lines: StockLine[], orderId: string) {
    for (const l of ordered(lines)) {
      await applyMovement(db, {
        variantId: l.variantId,
        type: "sale",
        onHandDelta: -l.quantity,
        reservedDelta: -l.quantity,
        referenceType: "order",
        referenceId: orderId,
      });
    }
  },

  /** Customer return. Resellable items go back on the shelf; damaged ones are logged and written off. */
  async restockReturn(db: DbOrTx, lines: (StockLine & { condition: "resellable" | "damaged" })[], ref: { orderId: string; returnId?: string; staffId?: string }) {
    for (const l of ordered(lines) as typeof lines) {
      await applyMovement(db, {
        variantId: l.variantId,
        type: "return",
        onHandDelta: l.quantity,
        referenceType: ref.returnId ? "return" : "order",
        referenceId: ref.returnId ?? ref.orderId,
        staffId: ref.staffId,
      });
      if (l.condition === "damaged") {
        await applyMovement(db, {
          variantId: l.variantId,
          type: "damaged",
          onHandDelta: -l.quantity,
          referenceType: "return",
          referenceId: ref.returnId ?? ref.orderId,
          note: "Returned damaged",
          staffId: ref.staffId,
        });
      }
    }
  },
};

/** DB-level availability (on_hand - reserved), not counting Redis checkout holds. */
export async function dbAvailability(db: DbOrTx, variantIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>(variantIds.map((id) => [id, 0]));
  if (!variantIds.length) return out;
  const rows = await db
    .select({ variantId: inventoryLevels.variantId, onHand: inventoryLevels.onHand, reserved: inventoryLevels.reserved })
    .from(inventoryLevels)
    .where(inArray(inventoryLevels.variantId, variantIds));
  for (const r of rows) out.set(r.variantId, r.onHand - r.reserved);
  return out;
}

export async function lowStockVariants(db: DbOrTx, limit = 100) {
  return db
    .select({
      variantId: productVariants.id,
      sku: productVariants.sku,
      productId: products.id,
      productName: products.name,
      options: productVariants.options,
      onHand: inventoryLevels.onHand,
      reserved: inventoryLevels.reserved,
      threshold: productVariants.lowStockThreshold,
    })
    .from(productVariants)
    .innerJoin(products, eq(products.id, productVariants.productId))
    .leftJoin(inventoryLevels, eq(inventoryLevels.variantId, productVariants.id))
    .where(
      and(
        eq(productVariants.isActive, true),
        eq(products.status, "active"),
        sql`coalesce(${inventoryLevels.onHand}, 0) - coalesce(${inventoryLevels.reserved}, 0) <= ${productVariants.lowStockThreshold}`,
      ),
    )
    .orderBy(sql`coalesce(${inventoryLevels.onHand}, 0) - coalesce(${inventoryLevels.reserved}, 0)`)
    .limit(limit);
}
