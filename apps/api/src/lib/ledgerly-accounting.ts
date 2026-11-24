import { and, asc, eq, lte, lt, or } from "drizzle-orm";
import { accountingOutbox, orders, refunds, type Database } from "@ugmall/database";
import type { Env } from "../env";
import { logger } from "./logger";

type JournalLine = { accountId: string; description: string; debitMinor?: number; creditMinor?: number };
type LedgerlyJournalResponse = { data?: { id?: string; status?: string }; error?: { message?: string } };

function apiRoot(base: string) {
  const root = base.replace(/\/+$/, "");
  return root.endsWith("/api/v1") ? root : `${root}/api/v1`;
}

function dateOnly(value: Date | null | undefined) {
  return (value ?? new Date()).toISOString().slice(0, 10);
}

/**
 * Posts through Ledgerly's scoped integration API. UG Mall never opens Ledgerly's
 * database or writes finance tables directly. Stable idempotency keys make retries safe.
 */
async function postJournal(env: Env, input: { key: string; date: string; description: string; reference: string; sourceId: string; lines: JournalLine[] }) {
  if (!env.LEDGERLY_API_BASE_URL || !env.LEDGERLY_API_KEY) throw new Error("Ledgerly accounting is not configured");
  const root = apiRoot(env.LEDGERLY_API_BASE_URL);
  const headers = { "Content-Type": "application/json", "X-API-Key": env.LEDGERLY_API_KEY, "Idempotency-Key": input.key };
  const create = await fetch(`${root}/journals`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      transactionDate: input.date,
      postingDate: input.date,
      description: input.description,
      reference: input.reference,
      sourceType: "ugmall",
      sourceId: input.sourceId,
      currency: "UGX",
      lines: input.lines,
    }),
    signal: AbortSignal.timeout(20_000),
  });
  const created = await create.json().catch(() => ({})) as LedgerlyJournalResponse;
  if (!create.ok || !created.data?.id) throw new Error(`Ledgerly journal create ${create.status}: ${created.error?.message ?? "invalid response"}`);
  if (created.data.status === "posted") return created.data.id;
  const post = await fetch(`${root}/journals/${encodeURIComponent(created.data.id)}/post`, {
    method: "POST",
    headers: { "X-API-Key": env.LEDGERLY_API_KEY, "Content-Type": "application/json" },
    body: "{}",
    signal: AbortSignal.timeout(20_000),
  });
  const result = await post.json().catch(() => ({})) as LedgerlyJournalResponse;
  if (!post.ok) throw new Error(`Ledgerly journal post ${post.status}: ${result.error?.message ?? "request failed"}`);
  return created.data.id;
}

function requireAccounts(env: Env) {
  const accounts = {
    clearing: env.LEDGERLY_CLEARING_ACCOUNT_ID,
    revenue: env.LEDGERLY_SALES_REVENUE_ACCOUNT_ID,
    delivery: env.LEDGERLY_DELIVERY_REVENUE_ACCOUNT_ID,
    discounts: env.LEDGERLY_SALES_DISCOUNTS_ACCOUNT_ID,
    cogs: env.LEDGERLY_COGS_ACCOUNT_ID,
    inventory: env.LEDGERLY_INVENTORY_ACCOUNT_ID,
    returns: env.LEDGERLY_RETURNS_ACCOUNT_ID,
  };
  if (Object.values(accounts).some((id) => !id)) throw new Error("Ledgerly account mappings are incomplete");
  return accounts as Record<keyof typeof accounts, string>;
}

async function postSale(db: Database, env: Env, orderId: string) {
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
  if (!order) throw new Error("UG Mall order for Ledgerly export was not found");
  if (order.amountPaid < order.total) throw new Error("Order is not fully paid; Ledgerly sale export deferred");
  const accounts = requireAccounts(env);
  const lines: JournalLine[] = [
    { accountId: accounts.clearing, description: `Settlement for ${order.orderNumber}`, debitMinor: order.total },
    { accountId: accounts.revenue, description: `Product sales ${order.orderNumber}`, creditMinor: order.subtotal },
  ];
  if (order.discount > 0) lines.push({ accountId: accounts.discounts, description: `Discount ${order.orderNumber}`, debitMinor: order.discount });
  if (order.deliveryFee > 0) lines.push({ accountId: accounts.delivery, description: `Delivery income ${order.orderNumber}`, creditMinor: order.deliveryFee });
  if (order.costTotal > 0) {
    lines.push({ accountId: accounts.cogs, description: `Cost of goods sold ${order.orderNumber}`, debitMinor: order.costTotal });
    lines.push({ accountId: accounts.inventory, description: `Inventory relieved ${order.orderNumber}`, creditMinor: order.costTotal });
  }
  return postJournal(env, { key: `ugmall:sale:${order.id}`, date: dateOnly(order.paidAt ?? order.deliveredAt ?? order.createdAt), description: `UG Mall sale ${order.orderNumber}`, reference: order.orderNumber, sourceId: order.id, lines });
}

async function postRefund(db: Database, env: Env, refundId: string) {
  const [refund] = await db.select().from(refunds).where(eq(refunds.id, refundId));
  if (!refund || refund.status !== "succeeded") throw new Error("Completed UG Mall refund for Ledgerly export was not found");
  const [order] = await db.select().from(orders).where(eq(orders.id, refund.orderId));
  if (!order) throw new Error("UG Mall refund order for Ledgerly export was not found");
  const accounts = requireAccounts(env);
  return postJournal(env, {
    key: `ugmall:refund:${refund.id}`,
    date: dateOnly(refund.completedAt ?? refund.createdAt),
    description: `UG Mall refund ${order.orderNumber}`,
    reference: refund.externalReference ?? `REF-${refund.id}`,
    sourceId: refund.id,
    lines: [
      { accountId: accounts.returns, description: `Refund / returns ${order.orderNumber}`, debitMinor: refund.amount },
      { accountId: accounts.clearing, description: `Refund settlement ${order.orderNumber}`, creditMinor: refund.amount },
    ],
  });
}

/** Claims committed events from PostgreSQL and retries safely across worker restarts. */
export async function processLedgerlyOutbox(db: Database, env: Env, batchSize = 25) {
  if (!env.LEDGERLY_API_BASE_URL || !env.LEDGERLY_API_KEY) return 0;
  const now = new Date();
  const staleBefore = new Date(now.getTime() - 5 * 60_000);
  const claimed = await db.transaction(async (tx) => {
    const rows = await tx.select().from(accountingOutbox).where(and(
      lte(accountingOutbox.availableAt, now),
      or(eq(accountingOutbox.status, "pending"), and(eq(accountingOutbox.status, "processing"), lt(accountingOutbox.lockedAt, staleBefore))),
    )).orderBy(asc(accountingOutbox.createdAt)).limit(batchSize).for("update", { skipLocked: true });
    for (const row of rows) await tx.update(accountingOutbox).set({ status: "processing", attempts: row.attempts + 1, lockedAt: now, updatedAt: now }).where(eq(accountingOutbox.id, row.id));
    return rows;
  });

  for (const item of claimed) {
    try {
      const journalId = item.eventType === "sale"
        ? await postSale(db, env, item.entityId)
        : await postRefund(db, env, item.entityId);
      await db.update(accountingOutbox).set({ status: "completed", ledgerlyJournalId: journalId, lastError: null, lockedAt: null, completedAt: new Date(), updatedAt: new Date() }).where(eq(accountingOutbox.id, item.id));
    } catch (error) {
      const message = String((error as Error).message).slice(0, 1000);
      const failed = item.attempts + 1 >= 20;
      const backoffMs = Math.min(60 * 60_000, 5_000 * 2 ** Math.min(item.attempts, 10));
      await db.update(accountingOutbox).set({ status: failed ? "failed" : "pending", availableAt: new Date(Date.now() + backoffMs), lockedAt: null, lastError: message, updatedAt: new Date() }).where(eq(accountingOutbox.id, item.id));
      logger.warn({ outboxId: item.id, eventType: item.eventType, entityId: item.entityId, attempts: item.attempts + 1, error: message }, "Ledgerly accounting export failed");
    }
  }
  return claimed.length;
}

