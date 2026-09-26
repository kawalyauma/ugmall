import { createHmac, timingSafeEqual } from "node:crypto";

export interface TemplateMessage {
  name: string;
  language: string;
  /** Positional body parameters {{1}}, {{2}}, ... */
  bodyParams: string[];
}

export interface SendResult {
  messageId?: string;
}

export interface WhatsAppProvider {
  readonly name: string;
  sendText(toE164: string, body: string): Promise<SendResult>;
  sendTemplate(toE164: string, template: TemplateMessage): Promise<SendResult>;
}

/**
 * WhatsApp Business Platform (Cloud API).
 * Business-initiated messages outside the 24-hour customer-service window
 * must use pre-approved templates, so order notifications go out as
 * templates when WHATSAPP_USE_TEMPLATES=true.
 */
export class WhatsAppCloudProvider implements WhatsAppProvider {
  readonly name = "whatsapp_cloud";
  constructor(
    private opts: { phoneNumberId: string; accessToken: string; apiVersion?: string; fetch?: typeof fetch },
  ) {}

  private async post(payload: Record<string, unknown>): Promise<SendResult> {
    const url = `https://graph.facebook.com/${this.opts.apiVersion ?? "v21.0"}/${this.opts.phoneNumberId}/messages`;
    const res = await (this.opts.fetch ?? fetch)(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.opts.accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", ...payload }),
      signal: AbortSignal.timeout(20_000),
    });
    const json = (await res.json().catch(() => ({}))) as { messages?: { id: string }[]; error?: { message?: string } };
    if (!res.ok) throw new Error(`WhatsApp API ${res.status}: ${json.error?.message ?? "unknown error"}`);
    return { messageId: json.messages?.[0]?.id };
  }

  sendText(to: string, body: string) {
    return this.post({ to, type: "text", text: { preview_url: true, body } });
  }

  sendTemplate(to: string, t: TemplateMessage) {
    return this.post({
      to,
      type: "template",
      template: {
        name: t.name,
        language: { code: t.language },
        components: t.bodyParams.length
          ? [{ type: "body", parameters: t.bodyParams.map((text) => ({ type: "text", text })) }]
          : [],
      },
    });
  }
}

/** Development provider: prints messages instead of sending them. */
export class ConsoleWhatsAppProvider implements WhatsAppProvider {
  readonly name = "console";
  async sendText(to: string, body: string) {
    console.log(`[whatsapp:console] -> ${to}\n${body}\n`);
    return { messageId: `console-${Date.now()}` };
  }
  async sendTemplate(to: string, t: TemplateMessage) {
    console.log(`[whatsapp:console] -> ${to} template=${t.name} params=${JSON.stringify(t.bodyParams)}`);
    return { messageId: `console-${Date.now()}` };
  }
}

export function createWhatsAppFromEnv(env: NodeJS.ProcessEnv = process.env): WhatsAppProvider {
  if (env.WHATSAPP_PHONE_NUMBER_ID && env.WHATSAPP_ACCESS_TOKEN) {
    return new WhatsAppCloudProvider({
      phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID,
      accessToken: env.WHATSAPP_ACCESS_TOKEN,
      apiVersion: env.WHATSAPP_API_VERSION,
    });
  }
  return new ConsoleWhatsAppProvider();
}

/** Verifies Meta's X-Hub-Signature-256 header on webhook deliveries. */
export function verifyWhatsAppSignature(appSecret: string, rawBody: string, header: string | undefined): boolean {
  if (!header?.startsWith("sha256=")) return false;
  const expected = Buffer.from(`sha256=${createHmac("sha256", appSecret).update(rawBody).digest("hex")}`);
  const given = Buffer.from(header);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export interface InboundWhatsAppMessage {
  from: string;
  id: string;
  name?: string;
  text?: string;
  type: string;
  timestamp: number;
}

/** Extracts inbound messages from a Cloud API webhook payload. */
export function parseWhatsAppWebhook(body: unknown): { messages: InboundWhatsAppMessage[]; statuses: { id: string; status: string; recipient: string }[] } {
  const messages: InboundWhatsAppMessage[] = [];
  const statuses: { id: string; status: string; recipient: string }[] = [];
  const b = body as { entry?: { changes?: { value?: Record<string, unknown> }[] }[] };
  for (const entry of b?.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const v = change.value as {
        contacts?: { wa_id: string; profile?: { name?: string } }[];
        messages?: { from: string; id: string; type: string; timestamp: string; text?: { body: string }; button?: { text: string }; interactive?: { button_reply?: { title: string } } }[];
        statuses?: { id: string; status: string; recipient_id: string }[];
      };
      for (const m of v?.messages ?? []) {
        messages.push({
          from: m.from,
          id: m.id,
          type: m.type,
          timestamp: Number(m.timestamp) * 1000,
          name: v.contacts?.find((c) => c.wa_id === m.from)?.profile?.name,
          text: m.text?.body ?? m.button?.text ?? m.interactive?.button_reply?.title,
        });
      }
      for (const s of v?.statuses ?? []) statuses.push({ id: s.id, status: s.status, recipient: s.recipient_id });
    }
  }
  return { messages, statuses };
}
