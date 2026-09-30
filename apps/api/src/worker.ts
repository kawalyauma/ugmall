import { Worker, type Job } from "bullmq";
import { and, eq, lt, sql } from "drizzle-orm";
import { agentActions, orders, payments } from "@ugmall/database";
import { AdminWhatsAppService, NotificationService, type AdminWhatsAppJob, type NotificationJob, type WhatsAppCareJob } from "@ugmall/notifications";
import { createContainer } from "./container";
import { logger } from "./lib/logger";
import { QUEUE_NAMES } from "./queues";
import { importProductImages } from "./lib/product-import";
import type { ImageJob } from "@ugmall/importer";
import { processAgentRun } from "./lib/agent-workforce";
import { WhatsAppCareAgent } from "./lib/whatsapp-care-agent";
import { ConfiguredWhatsAppProvider } from "./lib/whatsapp-provider";
import { getWhatsAppRuntimeSettings } from "./lib/settings";

/**
 * Background worker (separate process/container from the API):
 *  - WhatsApp notifications with retries
 *  - Mobile Money status polling (in case callbacks don't reach the server)
 *  - Expiry of unpaid orders (releases reserved stock)
 *  - Housekeeping: temp upload cleanup, safety sweeps
 */
const container = createContainer();
const { db, orders: orderService, queues, storage, env } = container;
const connection = container.queueRedis;
const whatsapp = new ConfiguredWhatsAppProvider(db, env);
const notifier = new NotificationService(db, whatsapp, {
  useTemplates: async () => (await getWhatsAppRuntimeSettings(db, env.APP_SECRET, env)).useTemplates,
  templateLanguage: async () => (await getWhatsAppRuntimeSettings(db, env.APP_SECRET, env)).templateLanguage,
});
const adminNotifier = new AdminWhatsAppService(whatsapp);
const careAgent = new WhatsAppCareAgent(db, orderService, storage, whatsapp, {
  getAdminPhone: async () => (await getWhatsAppRuntimeSettings(db, env.APP_SECRET, env)).adminNumber,
  adminUrl: env.ADMIN_URL,
  shopName: env.SHOP_NAME,
});

async function enqueueApprovalAlerts(runId?: string) {
  const adminPhone = (await getWhatsAppRuntimeSettings(db, env.APP_SECRET, env)).adminNumber;
  if (!adminPhone) return;
  const where = runId
    ? and(eq(agentActions.runId, runId), eq(agentActions.status, "awaiting_approval"))
    : eq(agentActions.status, "awaiting_approval");
  const pending = await db.select().from(agentActions).where(where).limit(100);
  for (const action of pending) {
    const alert: AdminWhatsAppJob = {
      kind: "admin",
      alertKind: "agent_approval",
      to: adminPhone,
      body: `🤖 *Agent approval needed*\n${action.title}\n\n${action.explanation}\nRisk: ${action.risk}\n\nApprove only if the proposed change is correct.`,
      buttons: [
        { id: `ug:approve:${action.id}`, title: "Approve" },
        { id: `ug:reject:${action.id}`, title: "Reject" },
      ],
      idempotencyKey: `ugmall:agent-approval:${action.id}`,
      actionId: action.id,
    };
    await queues.notifications.add("agent-approval", alert, { jobId: `agent-approval-${action.id}` });
  }
}

// 15s, 30s, 1m, 2m, 3m, 5m, 5m... up to ~30 minutes of polling
const POLL_DELAYS = [15, 30, 60, 120, 180, 300, 300, 300, 300, 300].map((s) => s * 1000);

const workers = [
  new Worker<NotificationJob | AdminWhatsAppJob>(
    QUEUE_NAMES.notifications,
    async (job) => {
      if (job.data.kind === "admin") {
        await adminNotifier.send(job.data);
        return;
      }
      const logId = await notifier.send(job.data, job.data.logId);
      // Keep the log id so retries update the same row instead of creating duplicates.
      if (!job.data.logId) await job.updateData({ ...job.data, logId });
    },
    { connection, concurrency: 5 },
  ),

  new Worker<{ paymentId: string; attempt: number }>(
    QUEUE_NAMES.payments,
    async (job) => {
      const final = await orderService.checkPayment(job.data.paymentId);
      if (!final && job.data.attempt < POLL_DELAYS.length) {
        const attempt = job.data.attempt + 1;
        await queues.payments.add("check", { paymentId: job.data.paymentId, attempt }, { delay: POLL_DELAYS[attempt - 1], jobId: `pay-${job.data.paymentId}-${attempt}` });
      }
    },
    { connection, concurrency: 10 },
  ),

  // Product images from imported sheets are downloaded onto this server.
  new Worker<ImageJob>(QUEUE_NAMES.imports, async (job) => importProductImages(db, storage, job.data), { connection, concurrency: 3 }),

  // Codex is intentionally single-concurrency: predictable cost/load and a
  // complete audit record matter more than throughput for business workers.
  new Worker<{ runId: string }>(QUEUE_NAMES.agents, async (job) => {
    await processAgentRun(db, job.data.runId);
    await enqueueApprovalAlerts(job.data.runId);
  }, { connection, concurrency: 1 }),

  new Worker<WhatsAppCareJob>(QUEUE_NAMES.whatsappCare, async (job) => careAgent.handle(job.data.event), { connection, concurrency: 4 }),

  new Worker<{ orderId: string }>(QUEUE_NAMES.orders, async (job) => orderService.expireIfUnpaid(job.data.orderId), { connection, concurrency: 5 }),

  new Worker(
    QUEUE_NAMES.maintenance,
    async (job: Job) => {
      if (job.name === "sweep-unpaid") {
        // Safety net: if Redis lost delayed jobs, still cancel stale unpaid orders.
        const stale = await db
          .select({ id: orders.id })
          .from(orders)
          .where(and(eq(orders.status, "awaiting_payment"), lt(orders.expiresAt, new Date(Date.now() - 60_000))))
          .limit(200);
        for (const o of stale) await orderService.expireIfUnpaid(o.id).catch((e) => logger.warn({ e }, "expire failed"));
        const pending = await db
          .select({ id: payments.id })
          .from(payments)
          .where(and(eq(payments.status, "pending"), sql`${payments.provider} not in ('cash_on_delivery','pay_on_pickup')`, lt(payments.createdAt, new Date(Date.now() - 120_000))))
          .limit(200);
        for (const p of pending) await orderService.checkPayment(p.id).catch(() => {});
      }
      if (job.name === "clean-temp") {
        const cutoff = Date.now() - 24 * 3600_000;
        let removed = 0;
        for await (const f of storage.list("temp")) {
          if (f.modifiedAt.getTime() < cutoff) {
            await storage.delete(f.key);
            removed++;
          }
        }
        if (removed) logger.info(`removed ${removed} temp files`);
      }
    },
    { connection },
  ),
];

for (const w of workers) {
  w.on("failed", (job, err) => logger.warn({ queue: w.name, jobId: job?.id, attempts: job?.attemptsMade, err: err.message }, "job failed"));
  w.on("error", (err) => logger.error({ queue: w.name, err }, "worker error"));
}

await queues.maintenance.upsertJobScheduler("sweep-unpaid", { every: 5 * 60_000 }, { name: "sweep-unpaid" });
await queues.maintenance.upsertJobScheduler("clean-temp", { every: 6 * 3600_000 }, { name: "clean-temp" });
await enqueueApprovalAlerts().catch((error) => logger.warn({ error }, "unable to enqueue existing agent approvals"));
logger.info("worker started");

const shutdown = async () => {
  await Promise.allSettled(workers.map((w) => w.close()));
  await Promise.allSettled([...Object.values(queues).map((q) => q.close()), container.redis.quit(), container.queueRedis.quit(), container.closeDb()]);
  process.exit(0);
};
process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());
