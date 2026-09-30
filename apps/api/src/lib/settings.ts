import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { inArray } from "drizzle-orm";
import { settings, type Database } from "@ugmall/database";
import { DEFAULT_COD_MAX_ORDER_TOTAL } from "@ugmall/shared";

export interface ShopSettings {
  shopName: string;
  tagline: string;
  whatsappNumber: string; // 2567XXXXXXXX
  supportPhone: string;
  supportEmail: string;
  pickupAddress: string;
  pickupHours: string;
  businessHours: string;
  heroTitle: string;
  heroSubtitle: string;
  announcement: string;
  socialFacebook: string;
  socialInstagram: string;
  socialTiktok: string;
  returnPolicy: string;
  lowStockEmailAlerts: boolean;
  /** Cash on Delivery not allowed above this order total (UGX, incl. delivery). 0 = no limit. */
  codMaxOrderTotal: number;
}

export const DEFAULT_SETTINGS: ShopSettings = {
  shopName: process.env.SHOP_NAME ?? "UG Mall",
  tagline: "Quality fashion delivered across Uganda",
  whatsappNumber: "256768122426",
  supportPhone: "0768 122 426",
  supportEmail: "hello@shop.example.ug",
  pickupAddress: "Plot 1, Kampala Road, Kampala",
  pickupHours: "Mon–Sat 9:00am – 7:00pm",
  businessHours: "Mon–Sat 8:00am – 8:00pm",
  heroTitle: "Shop smart. Pay with Mobile Money.",
  heroSubtitle: "Fresh fashion, secure payments and delivery within 48 hours across our service areas.",
  announcement: "Order online or on WhatsApp — delivery within 48 hours",
  socialFacebook: "",
  socialInstagram: "",
  socialTiktok: "",
  returnPolicy: "Returns accepted within 7 days for unworn items with tags.",
  lowStockEmailAlerts: false,
  codMaxOrderTotal: DEFAULT_COD_MAX_ORDER_TOTAL,
};

const PUBLIC_KEYS: (keyof ShopSettings)[] = [
  "shopName", "tagline", "whatsappNumber", "supportPhone", "supportEmail", "pickupAddress", "pickupHours",
  "businessHours", "heroTitle", "heroSubtitle", "announcement", "socialFacebook", "socialInstagram", "socialTiktok", "returnPolicy",
  "codMaxOrderTotal",
];

export async function getSettings(db: Database): Promise<ShopSettings> {
  const rows = await db.select().from(settings).where(inArray(settings.key, Object.keys(DEFAULT_SETTINGS)));
  const out = { ...DEFAULT_SETTINGS } as Record<string, unknown>;
  for (const r of rows) out[r.key] = r.value;
  return out as unknown as ShopSettings;
}

export async function getPublicSettings(db: Database) {
  const s = await getSettings(db);
  return Object.fromEntries(PUBLIC_KEYS.map((k) => [k, s[k]])) as Partial<ShopSettings>;
}

export async function saveSettings(db: Database, patch: Partial<ShopSettings>) {
  for (const [key, value] of Object.entries(patch)) {
    if (!(key in DEFAULT_SETTINGS)) continue;
    await db.insert(settings).values({ key, value: value as unknown as object }).onConflictDoUpdate({ target: settings.key, set: { value: value as unknown as object, updatedAt: new Date() } });
  }
}

const WA_KEYS = {
  hubUrl: "whatsappSupportHubUrl",
  appKey: "whatsappSupportAppKeyEncrypted",
  webhookSecret: "whatsappSupportWebhookSecretEncrypted",
  adminNumber: "whatsappAdminNumber",
  useTemplates: "whatsappUseTemplates",
  templateLanguage: "whatsappTemplateLanguage",
} as const;

export interface WhatsAppRuntimeSettings {
  hubUrl?: string;
  appKey?: string;
  webhookSecret?: string;
  adminNumber?: string;
  useTemplates: boolean;
  templateLanguage: string;
}

const secretKey = (appSecret: string) => createHash("sha256").update(`ugmall:settings:${appSecret}`).digest();

function encryptSetting(value: string, appSecret: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", secretKey(appSecret), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return `v1:${iv.toString("base64url")}:${cipher.getAuthTag().toString("base64url")}:${encrypted.toString("base64url")}`;
}

function decryptSetting(value: unknown, appSecret: string) {
  if (typeof value !== "string" || !value.startsWith("v1:")) return undefined;
  try {
    const [, iv, tag, encrypted] = value.split(":");
    const decipher = createDecipheriv("aes-256-gcm", secretKey(appSecret), Buffer.from(iv!, "base64url"));
    decipher.setAuthTag(Buffer.from(tag!, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(encrypted!, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    return undefined;
  }
}

export async function getWhatsAppRuntimeSettings(db: Database, appSecret: string, env: Partial<Record<string, string | boolean | undefined>> = {}): Promise<WhatsAppRuntimeSettings> {
  const rows = await db.select().from(settings).where(inArray(settings.key, Object.values(WA_KEYS)));
  const values = Object.fromEntries(rows.map((row) => [row.key, row.value])) as Record<string, unknown>;
  return {
    hubUrl: String(values[WA_KEYS.hubUrl] ?? env.WHATSAPP_SUPPORT_HUB_URL ?? "").trim() || undefined,
    appKey: decryptSetting(values[WA_KEYS.appKey], appSecret) ?? (typeof env.WHATSAPP_SUPPORT_APP_KEY === "string" ? env.WHATSAPP_SUPPORT_APP_KEY : undefined),
    webhookSecret: decryptSetting(values[WA_KEYS.webhookSecret], appSecret) ?? (typeof env.WHATSAPP_SUPPORT_WEBHOOK_SECRET === "string" ? env.WHATSAPP_SUPPORT_WEBHOOK_SECRET : undefined),
    adminNumber: String(values[WA_KEYS.adminNumber] ?? env.WHATSAPP_ADMIN_NUMBER ?? "").trim() || undefined,
    useTemplates: typeof values[WA_KEYS.useTemplates] === "boolean" ? values[WA_KEYS.useTemplates] : Boolean(env.WHATSAPP_USE_TEMPLATES),
    templateLanguage: String(values[WA_KEYS.templateLanguage] ?? env.WHATSAPP_TEMPLATE_LANGUAGE ?? "en").trim() || "en",
  };
}

export async function getWhatsAppSettingsStatus(db: Database, appSecret: string, env: Partial<Record<string, string | boolean | undefined>> = {}) {
  const cfg = await getWhatsAppRuntimeSettings(db, appSecret, env);
  return {
    hubUrl: cfg.hubUrl ?? "",
    adminNumber: cfg.adminNumber ?? "",
    useTemplates: cfg.useTemplates,
    templateLanguage: cfg.templateLanguage,
    appKeyConfigured: Boolean(cfg.appKey),
    webhookSecretConfigured: Boolean(cfg.webhookSecret),
    ready: Boolean(cfg.hubUrl && cfg.appKey && cfg.webhookSecret && cfg.adminNumber),
  };
}

export async function saveWhatsAppSettings(db: Database, appSecret: string, input: { hubUrl?: string; appKey?: string; webhookSecret?: string; adminNumber?: string; useTemplates?: boolean; templateLanguage?: string }) {
  const updates: Record<string, unknown> = {};
  if (input.hubUrl !== undefined) updates[WA_KEYS.hubUrl] = input.hubUrl.trim();
  if (input.appKey?.trim()) updates[WA_KEYS.appKey] = encryptSetting(input.appKey.trim(), appSecret);
  if (input.webhookSecret?.trim()) updates[WA_KEYS.webhookSecret] = encryptSetting(input.webhookSecret.trim(), appSecret);
  if (input.adminNumber !== undefined) updates[WA_KEYS.adminNumber] = input.adminNumber.trim();
  if (input.useTemplates !== undefined) updates[WA_KEYS.useTemplates] = input.useTemplates;
  if (input.templateLanguage !== undefined) updates[WA_KEYS.templateLanguage] = input.templateLanguage.trim();
  for (const [key, value] of Object.entries(updates)) {
    await db.insert(settings).values({ key, value: value as object }).onConflictDoUpdate({ target: settings.key, set: { value: value as object, updatedAt: new Date() } });
  }
}
