import { z } from "zod";

const bool = z
  .string()
  .optional()
  .transform((v) => v === "true" || v === "1");

const schema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().default("postgres://shop:shop@localhost:5432/shop"),
  REDIS_URL: z.string().default("redis://localhost:6379"),
  SHOP_NAME: z.string().default("UG Mall"),
  /** Public URLs as customers see them (through Nginx). */
  STOREFRONT_URL: z.string().url().default("http://localhost:3000"),
  ADMIN_URL: z.string().url().default("http://localhost:3001"),
  API_PUBLIC_URL: z.string().url().default("http://localhost:4000"),
  MEDIA_PUBLIC_URL: z.string().default("http://localhost:4000/media"),
  STORAGE_DRIVER: z.enum(["local", "minio", "s3"]).default("local"),
  STORAGE_ROOT: z.string().default("./storage"),
  /** Serve /media from Node in development. In production Nginx serves it. */
  SERVE_MEDIA: bool,
  /** Use Nginx X-Accel-Redirect for private files (production). */
  USE_X_ACCEL: bool,
  APP_SECRET: z.string().min(16).default("dev-secret-change-me-please-0000"),
  PAYMENT_CALLBACK_SECRET: z.string().min(16).default("dev-callback-secret-change-me-0000"),
  PAYMENT_TIMEOUT_MINUTES: z.coerce.number().default(15),
  CHECKOUT_RESERVATION_MINUTES: z.coerce.number().default(10),
  WHATSAPP_VERIFY_TOKEN: z.string().optional(),
  WHATSAPP_APP_SECRET: z.string().optional(),
  /** Standalone WhatsApp Support Hub application credentials. */
  WHATSAPP_SUPPORT_HUB_URL: z.string().url().optional(),
  WHATSAPP_SUPPORT_APP_KEY: z.string().min(16).optional(),
  WHATSAPP_SUPPORT_WEBHOOK_SECRET: z.string().min(16).optional(),
  /** E.164 without '+'. Only this number may approve agent actions in chat. */
  WHATSAPP_ADMIN_NUMBER: z.string().regex(/^256\d{9}$/).optional(),
  WHATSAPP_USE_TEMPLATES: bool,
  WHATSAPP_TEMPLATE_LANGUAGE: z.string().default("en"),
  /** Transactional email via Resend; disabled when either setting is absent. */
  RESEND_API_KEY: z.string().min(16).optional().or(z.literal("")),
  RESEND_FROM_EMAIL: z.string().email().optional().or(z.literal("")),
  /** Ledgerly finance API; the API key must be scoped to journals:write. */
  LEDGERLY_API_BASE_URL: z.string().url().optional().or(z.literal("")),
  LEDGERLY_API_KEY: z.string().min(16).optional().or(z.literal("")),
  LEDGERLY_CLEARING_ACCOUNT_ID: z.string().min(1).optional().or(z.literal("")),
  LEDGERLY_SALES_REVENUE_ACCOUNT_ID: z.string().min(1).optional().or(z.literal("")),
  LEDGERLY_DELIVERY_REVENUE_ACCOUNT_ID: z.string().min(1).optional().or(z.literal("")),
  LEDGERLY_SALES_DISCOUNTS_ACCOUNT_ID: z.string().min(1).optional().or(z.literal("")),
  LEDGERLY_COGS_ACCOUNT_ID: z.string().min(1).optional().or(z.literal("")),
  LEDGERLY_INVENTORY_ACCOUNT_ID: z.string().min(1).optional().or(z.literal("")),
  LEDGERLY_RETURNS_ACCOUNT_ID: z.string().min(1).optional().or(z.literal("")),
  COOKIE_DOMAIN: z.string().optional(),
  TRUST_PROXY: bool,
  LOG_LEVEL: z.string().default("info"),
});

export type Env = z.infer<typeof schema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const env = schema.parse(source);
  if (env.WHATSAPP_SUPPORT_HUB_URL || env.WHATSAPP_SUPPORT_APP_KEY || env.WHATSAPP_SUPPORT_WEBHOOK_SECRET) {
    if (!env.WHATSAPP_SUPPORT_HUB_URL || !env.WHATSAPP_SUPPORT_APP_KEY || !env.WHATSAPP_SUPPORT_WEBHOOK_SECRET) {
      throw new Error("WHATSAPP_SUPPORT_HUB_URL, WHATSAPP_SUPPORT_APP_KEY and WHATSAPP_SUPPORT_WEBHOOK_SECRET must be configured together");
    }
  }
  if (env.NODE_ENV === "production") {
    for (const k of ["APP_SECRET", "PAYMENT_CALLBACK_SECRET"] as const) {
      if (env[k].startsWith("dev-")) throw new Error(`${k} must be set to a strong random value in production`);
    }
  }
  if (Boolean(env.RESEND_API_KEY) !== Boolean(env.RESEND_FROM_EMAIL)) {
    throw new Error("RESEND_API_KEY and RESEND_FROM_EMAIL must be configured together");
  }
  const ledgerlyKeys = ["LEDGERLY_API_BASE_URL", "LEDGERLY_API_KEY", "LEDGERLY_CLEARING_ACCOUNT_ID", "LEDGERLY_SALES_REVENUE_ACCOUNT_ID", "LEDGERLY_DELIVERY_REVENUE_ACCOUNT_ID", "LEDGERLY_SALES_DISCOUNTS_ACCOUNT_ID", "LEDGERLY_COGS_ACCOUNT_ID", "LEDGERLY_INVENTORY_ACCOUNT_ID", "LEDGERLY_RETURNS_ACCOUNT_ID"] as const;
  if (ledgerlyKeys.some((key) => Boolean(env[key])) && ledgerlyKeys.some((key) => !env[key])) {
    throw new Error(`Ledgerly accounting requires all settings: ${ledgerlyKeys.join(", ")}`);
  }
  return env;
}
