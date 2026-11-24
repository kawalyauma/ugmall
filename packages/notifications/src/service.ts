import { eq, sql } from "drizzle-orm";
import { notificationLog, whatsappMessages, type Database } from "@ugmall/database";
import { buildMessage, type NotificationEvent, type OrderMessageContext } from "./messages";
import type { WhatsAppProvider } from "./whatsapp";

export interface NotificationJob {
  kind?: "customer";
  event: NotificationEvent;
  to: string; // 2567XXXXXXXX
  orderId?: string;
  context: OrderMessageContext;
  /** Set when retrying an existing notification_log row. */
  logId?: string;
}

export interface EmailNotificationJob {
  kind: "email";
  event: NotificationEvent;
  to: string;
  orderId: string;
  context: OrderMessageContext;
  logId?: string;
}

const EMAIL_SUBJECTS: Record<NotificationEvent, string> = {
  order_received: "We received your UG Mall order",
  payment_confirmed: "Payment confirmed for your UG Mall order",
  payment_failed: "Action needed for your UG Mall order",
  order_confirmed: "Your UG Mall order is confirmed",
  rider_dispatched: "Your UG Mall order is on its way",
  delivered: "Your UG Mall order has been delivered",
  cancelled: "Your UG Mall order was cancelled",
  refund_sent: "Your UG Mall refund has been processed",
  otp: "Your UG Mall verification code",
};

function escapeHtml(value: string) {
  return value.replace(/[&<>\"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[char]!);
}

/** Resend REST adapter. It is only called by the notification worker. */
export class ResendEmailNotificationService {
  constructor(private db: Database, private opts: { apiKey?: string; from?: string; fetch?: typeof fetch }) {}

  async send(job: EmailNotificationJob, logId?: string): Promise<string> {
    if (!this.opts.apiKey || !this.opts.from) throw new Error("Resend is not configured");
    const msg = buildMessage(job.event, job.context);
    let id = logId;
    if (!id) {
      const [row] = await this.db.insert(notificationLog).values({ channel: "email", recipient: job.to, template: job.event, orderId: job.orderId, payload: job.context }).returning({ id: notificationLog.id });
      id = row!.id;
    }
    try {
      const response = await (this.opts.fetch ?? fetch)("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${this.opts.apiKey}`, "Content-Type": "application/json", "Idempotency-Key": `ugmall:${job.event}:${job.orderId}:${job.context.amount ?? ""}` },
        body: JSON.stringify({
          from: this.opts.from,
          to: [job.to],
          subject: EMAIL_SUBJECTS[job.event],
          text: msg.text,
          html: `<div style="font-family:Arial,sans-serif;line-height:1.6;max-width:600px;margin:auto"><h2>${escapeHtml(job.context.shopName)}</h2><p>Hi ${escapeHtml(job.context.customerName)},</p><p>${escapeHtml(msg.text).replace(/\n/g, "<br>")}</p><p><a href="${escapeHtml(job.context.trackingUrl)}">View your order</a></p></div>`,
        }),
        signal: AbortSignal.timeout(20_000),
      });
      const result = await response.json().catch(() => ({})) as { id?: string; message?: string };
      if (!response.ok) throw new Error(`Resend ${response.status}: ${result.message ?? "request failed"}`);
      await this.db.update(notificationLog).set({ status: "sent", sentAt: new Date(), providerMessageId: result.id ?? null, attempts: sql`${notificationLog.attempts} + 1`, error: null }).where(eq(notificationLog.id, id));
      return id;
    } catch (error) {
      await this.db.update(notificationLog).set({ status: "failed", error: String((error as Error).message).slice(0, 500), attempts: sql`${notificationLog.attempts} + 1` }).where(eq(notificationLog.id, id));
      throw Object.assign(error as Error, { logId: id });
    }
  }
}

/**
 * Sends one notification and records it in notification_log. Called from the
 * queue worker, so failures throw and BullMQ retries with backoff.
 */
export class NotificationService {
  constructor(
    private db: Database,
    private whatsapp: WhatsAppProvider,
    private opts: {
      useTemplates: boolean | (() => boolean | Promise<boolean>);
      templateLanguage: string | (() => string | Promise<string>);
    },
  ) {}

  async send(job: NotificationJob, logId?: string): Promise<string> {
    const msg = buildMessage(job.event, job.context);
    let id = logId;
    if (!id) {
      const [row] = await this.db
        .insert(notificationLog)
        .values({ channel: "whatsapp", recipient: job.to, template: job.event, orderId: job.orderId, payload: job.context })
        .returning({ id: notificationLog.id });
      id = row!.id;
    }
    try {
      const useTemplates = typeof this.opts.useTemplates === "function" ? await this.opts.useTemplates() : this.opts.useTemplates;
      const templateLanguage = typeof this.opts.templateLanguage === "function" ? await this.opts.templateLanguage() : this.opts.templateLanguage;
      const res = useTemplates
        ? await this.whatsapp.sendTemplate(job.to, { name: msg.template, language: templateLanguage, bodyParams: msg.params })
        : await this.whatsapp.sendText(job.to, msg.text);
      await this.db
        .update(notificationLog)
        .set({ status: "sent", sentAt: new Date(), providerMessageId: res.messageId, attempts: sql`${notificationLog.attempts} + 1`, error: null })
        .where(eq(notificationLog.id, id));
      await this.db
        .insert(whatsappMessages)
        .values({ direction: "outbound", waMessageId: res.messageId, phone: job.to, body: msg.text, status: "sent" })
        .onConflictDoNothing();
      return id;
    } catch (err) {
      await this.db
        .update(notificationLog)
        .set({ status: "failed", error: String((err as Error).message).slice(0, 500), attempts: sql`${notificationLog.attempts} + 1` })
        .where(eq(notificationLog.id, id));
      throw Object.assign(err as Error, { logId: id });
    }
  }
}
