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
  WHATSAPP_USE_TEMPLATES: bool,
  WHATSAPP_TEMPLATE_LANGUAGE: z.string().default("en"),
  COOKIE_DOMAIN: z.string().optional(),
  TRUST_PROXY: bool,
  LOG_LEVEL: z.string().default("info"),
});

export type Env = z.infer<typeof schema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const env = schema.parse(source);
  if (env.NODE_ENV === "production") {
    for (const k of ["APP_SECRET", "PAYMENT_CALLBACK_SECRET"] as const) {
      if (env[k].startsWith("dev-")) throw new Error(`${k} must be set to a strong random value in production`);
    }
  }
  return env;
}
