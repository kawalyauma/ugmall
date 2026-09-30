import type { WhatsAppProvider } from "./whatsapp";

export type AdminAlertKind = "new_order" | "failed_order" | "support_escalation" | "return_requested" | "agent_approval" | "system";

export interface AdminWhatsAppJob {
  kind: "admin";
  alertKind: AdminAlertKind;
  to: string;
  body: string;
  buttons?: { id: string; title: string }[];
  idempotencyKey: string;
  orderId?: string;
  actionId?: string;
}

export interface SupportHubWebhookEvent {
  event: "conversation.started" | "message.received" | string;
  reason?: string;
  application?: { id?: string; name?: string; code?: string };
  conversation: { id: string; phoneNumber: string; displayName?: string | null; status?: string; context?: Record<string, unknown> };
  message?: {
    id?: string;
    type?: string;
    content?: string;
    interactive?: { kind?: string; id?: string | null; title?: string | null } | null;
  };
  timestamp?: string;
}

export interface WhatsAppCareJob {
  kind: "support_hub_event";
  event: SupportHubWebhookEvent;
}

/** Sends operational alerts to the administrator through the shared Hub. */
export class AdminWhatsAppService {
  constructor(private whatsapp: WhatsAppProvider) {}

  async send(job: AdminWhatsAppJob) {
    if (job.buttons?.length && this.whatsapp.sendButtons) {
      return this.whatsapp.sendButtons(job.to, job.body, job.buttons, { idempotencyKey: job.idempotencyKey });
    }
    const choices = job.buttons?.length ? `\n\n${job.buttons.map((b) => `• ${b.title}`).join("\n")}` : "";
    return this.whatsapp.sendText(job.to, `${job.body}${choices}`, { idempotencyKey: job.idempotencyKey });
  }
}
