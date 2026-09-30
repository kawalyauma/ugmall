import { Queue, type ConnectionOptions } from "bullmq";
import { eq } from "drizzle-orm";
import { orderItems, orders, staffUsers, type Database } from "@ugmall/database";
import type { AdminWhatsAppJob, NotificationEvent, NotificationJob, WhatsAppCareJob } from "@ugmall/notifications";
import type { OrderEffects } from "@ugmall/orders";
import type { ImageJob } from "@ugmall/importer";
import { prettyUgPhone } from "@ugmall/shared";

export const QUEUE_NAMES = {
  notifications: "notifications",
  payments: "payment-checks",
  orders: "order-expiry",
  maintenance: "maintenance",
  imports: "imports",
  agents: "agent-workforce",
  whatsappCare: "whatsapp-care",
} as const;

export function createQueues(connection: ConnectionOptions) {
  const defaultJobOptions = { removeOnComplete: 1000, removeOnFail: 5000 };
  return {
    notifications: new Queue<NotificationJob | AdminWhatsAppJob>(QUEUE_NAMES.notifications, {
      connection,
      defaultJobOptions: { ...defaultJobOptions, attempts: 6, backoff: { type: "exponential", delay: 30_000 } },
    }),
    payments: new Queue<{ paymentId: string; attempt: number }>(QUEUE_NAMES.payments, { connection, defaultJobOptions }),
    orders: new Queue<{ orderId: string }>(QUEUE_NAMES.orders, { connection, defaultJobOptions }),
    maintenance: new Queue(QUEUE_NAMES.maintenance, { connection, defaultJobOptions }),
    imports: new Queue<ImageJob>(QUEUE_NAMES.imports, {
      connection,
      defaultJobOptions: { ...defaultJobOptions, attempts: 4, backoff: { type: "exponential", delay: 60_000 } },
    }),
    agents: new Queue<{ runId: string }>(QUEUE_NAMES.agents, {
      connection,
      defaultJobOptions: { ...defaultJobOptions, attempts: 2, backoff: { type: "exponential", delay: 60_000 } },
    }),
    whatsappCare: new Queue<WhatsAppCareJob>(QUEUE_NAMES.whatsappCare, {
      connection,
      defaultJobOptions: { ...defaultJobOptions, attempts: 5, backoff: { type: "exponential", delay: 10_000 } },
    }),
  };
}
export type Queues = ReturnType<typeof createQueues>;

/** Builds the message context for an order and enqueues a WhatsApp notification. */
export async function enqueueOrderNotification(
  db: Database,
  queues: Queues,
  cfg: { shopName: string; storefrontUrl: string; adminUrl?: string; adminPhone?: string | (() => Promise<string | undefined>) },
  event: NotificationEvent,
  orderId: string,
  extra: Record<string, unknown> = {},
) {
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
  if (!order) return;
  const items = await db.select().from(orderItems).where(eq(orderItems.orderId, orderId));
  let rider: { name: string; phone: string | null } | undefined;
  if (order.riderId) {
    [rider] = await db.select({ name: staffUsers.name, phone: staffUsers.phone }).from(staffUsers).where(eq(staffUsers.id, order.riderId));
  }
  const job: NotificationJob = {
    event,
    to: order.phone,
    orderId,
    context: {
      shopName: cfg.shopName,
      orderNumber: order.orderNumber,
      customerName: order.customerName,
      total: order.total,
      paymentMethod: order.paymentMethod,
      deliveryMethod: order.deliveryMethod,
      trackingUrl: `${cfg.storefrontUrl.replace(/\/$/, "")}/orders/${order.orderNumber}?t=${order.trackingToken}`,
      items: items.map((i) => ({ name: `${i.productName}${i.variantLabel ? ` (${i.variantLabel})` : ""}`, quantity: i.quantity })),
      riderName: rider?.name,
      riderPhone: rider?.phone ? prettyUgPhone(rider.phone) : undefined,
      amountToCollect: Math.max(0, order.total - order.amountPaid),
      reason: typeof extra.reason === "string" ? extra.reason : undefined,
      amount: typeof extra.amount === "number" ? extra.amount : undefined,
    },
  };
  await queues.notifications.add(event, job, { jobId: `${event}-${orderId}-${extra.amount ?? ""}-${event === "payment_failed" ? Date.now() : ""}` });

  const adminPhone = typeof cfg.adminPhone === "function" ? await cfg.adminPhone() : cfg.adminPhone;
  if (adminPhone && ["order_received", "payment_failed", "cancelled"].includes(event)) {
    const failed = event === "payment_failed" || (event === "cancelled" && String(extra.reason ?? "").toLowerCase().includes("payment"));
    const heading = failed ? "⚠️ Order needs attention" : event === "cancelled" ? "Order cancelled" : "🛍️ New order";
    const detail = [
      `${heading}: *${order.orderNumber}*`,
      `${order.customerName} · ${prettyUgPhone(order.phone)}`,
      `${items.reduce((sum, item) => sum + item.quantity, 0)} item(s) · UGX ${order.total.toLocaleString("en-UG")}`,
      `${order.area}, ${order.district}`,
      extra.reason ? `Reason: ${String(extra.reason)}` : null,
      cfg.adminUrl ? `${cfg.adminUrl.replace(/\/$/, "")}/orders/${order.id}` : null,
    ].filter(Boolean).join("\n");
    const adminJob: AdminWhatsAppJob = {
      kind: "admin",
      alertKind: failed ? "failed_order" : event === "order_received" ? "new_order" : "system",
      to: adminPhone,
      body: detail,
      idempotencyKey: `ugmall:${event}:${order.id}:${String(extra.amount ?? "")}:${String(extra.reason ?? "")}`,
      orderId: order.id,
    };
    await queues.notifications.add(`admin-${event}`, adminJob, { jobId: `admin-${event}-${order.id}-${event === "payment_failed" ? Date.now() : ""}` });
  }
}

export function createOrderEffects(db: Database, queues: Queues, cfg: { shopName: string; storefrontUrl: string; adminUrl?: string; adminPhone?: string | (() => Promise<string | undefined>) }): OrderEffects {
  return {
    notify: (event, orderId, extra) => enqueueOrderNotification(db, queues, cfg, event, orderId, extra).catch((e) => console.error("notify failed", e)),
    schedulePaymentCheck: async (paymentId, delayMs) => {
      await queues.payments.add("check", { paymentId, attempt: 1 }, { delay: delayMs, jobId: `pay-${paymentId}-1` });
    },
    scheduleOrderExpiry: async (orderId, delayMs) => {
      await queues.orders.add("expire", { orderId }, { delay: delayMs, jobId: `expire-${orderId}-${Date.now()}` });
    },
  };
}
