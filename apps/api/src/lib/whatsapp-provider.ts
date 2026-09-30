import type { Database } from "@ugmall/database";
import {
  createWhatsAppFromEnv,
  WhatsAppSupportHubProvider,
  type SendResult,
  type TemplateMessage,
  type WhatsAppProvider,
} from "@ugmall/notifications";
import type { Env } from "../env";
import { getWhatsAppRuntimeSettings } from "./settings";

/** Resolves Admin Settings before every send, so credential changes do not require a restart. */
export class ConfiguredWhatsAppProvider implements WhatsAppProvider {
  readonly name = "configured_whatsapp";
  private fallback: WhatsAppProvider;

  constructor(private db: Database, private env: Env) {
    this.fallback = createWhatsAppFromEnv(process.env);
  }

  private async provider() {
    const cfg = await getWhatsAppRuntimeSettings(this.db, this.env.APP_SECRET, this.env);
    if (cfg.hubUrl && cfg.appKey) return new WhatsAppSupportHubProvider({ baseUrl: cfg.hubUrl, apiKey: cfg.appKey });
    return this.fallback;
  }

  async sendText(to: string, body: string, opts?: { idempotencyKey?: string }): Promise<SendResult> {
    return (await this.provider()).sendText(to, body, opts);
  }

  async sendTemplate(to: string, template: TemplateMessage, opts?: { idempotencyKey?: string }): Promise<SendResult> {
    return (await this.provider()).sendTemplate(to, template, opts);
  }

  async sendButtons(to: string, body: string, buttons: { id: string; title: string }[], opts?: { idempotencyKey?: string }): Promise<SendResult> {
    const provider = await this.provider();
    if (provider.sendButtons) return provider.sendButtons(to, body, buttons, opts);
    return provider.sendText(to, `${body}\n\n${buttons.map((button) => `• ${button.title}`).join("\n")}`, opts);
  }
}
