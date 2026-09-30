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
