import { Hono } from "hono";
import { cors } from "hono/cors";
import { bodyLimit } from "hono/body-limit";
import { HTTPException } from "hono/http-exception";
import { serveStatic } from "@hono/node-server/serve-static";
import { sql } from "drizzle-orm";
import type { Container } from "./container";
import { ApiError } from "./lib/http";
import { logger } from "./lib/logger";
import { loadCustomer, requireStaff } from "./middleware/auth";
import { csrfGuard, securityHeaders } from "./middleware/security";
import { catalogRoutes } from "./routes/public/catalog";
import { cartRoutes } from "./routes/public/cart";
import { checkoutRoutes, trackingRoutes } from "./routes/public/checkout";
import { accountRoutes } from "./routes/public/account";
import { recommendationRoutes } from "./routes/public/recommendations";
import { webhookRoutes } from "./routes/webhooks";
import { fileRoutes } from "./routes/files";
import { riderRoutes } from "./routes/rider";
import { adminAuthRoutes } from "./routes/admin/auth";
import { adminCatalogRoutes } from "./routes/admin/catalog";
import { adminInventoryRoutes } from "./routes/admin/inventory";
import { adminOrderRoutes } from "./routes/admin/orders";
import { adminDeliveryRoutes } from "./routes/admin/delivery";
import { adminPeopleRoutes } from "./routes/admin/people";
import { adminMarketingRoutes } from "./routes/admin/marketing";
import { adminReportRoutes } from "./routes/admin/reports";
import { adminSystemRoutes } from "./routes/admin/system";
import { adminImportRoutes } from "./routes/admin/imports";
import type { AppEnv } from "./types";

/**
 * The API is mounted at the root here; Nginx exposes it as /api on both the
 * storefront and admin domains (so cookies stay first-party).
 */
export function createApp(container: Container) {
  const app = new Hono<AppEnv>();
  const { env } = container;

  app.use("*", async (c, next) => {
    c.set("container", container);
    const start = Date.now();
    await next();
    if (c.req.path !== "/health") logger.debug({ method: c.req.method, path: c.req.path, status: c.res.status, ms: Date.now() - start });
  });
  app.use("*", securityHeaders);
  app.use(
    "*",
    cors({
      origin: [env.STOREFRONT_URL, env.ADMIN_URL],
      credentials: true,
      allowHeaders: ["Content-Type", "X-Requested-With", "Authorization"],
      allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    }),
  );
  const defaultLimit = bodyLimit({ maxSize: Number(process.env.MAX_UPLOAD_BYTES ?? 10 * 1024 * 1024) + 1024 * 64 });
  const importLimit = bodyLimit({ maxSize: 21 * 1024 * 1024 });
  app.use("*", (c, next) => (c.req.path === "/admin/imports/preview" ? importLimit(c, next) : defaultLimit(c, next)));
  app.use("*", csrfGuard);

  app.get("/health", async (c) => {
    const checks: Record<string, string> = {};
    try {
      await container.db.execute(sql`select 1`);
      checks.postgres = "ok";
    } catch {
      checks.postgres = "down";
    }
    checks.redis = (await container.redis.ping().catch(() => "down")) === "PONG" ? "ok" : "down";
    const ok = Object.values(checks).every((v) => v === "ok");
    return c.json({ ok, ...checks }, ok ? 200 : 503);
  });

  if (env.SERVE_MEDIA) {
    // Development convenience only — in production Nginx serves /media straight from disk.
    app.use("/media/*", serveStatic({ root: env.STORAGE_ROOT, rewriteRequestPath: (p) => p.replace(/^\/media/, "") }));
  }

  app.route("/webhooks", webhookRoutes);
  app.route("/files", fileRoutes);

  // Storefront API
  app.use("/store/*", loadCustomer);
  app.route("/store", catalogRoutes);
  app.route("/store", recommendationRoutes);
  app.route("/store/cart", cartRoutes);
  app.route("/store/checkout", checkoutRoutes);
  app.route("/store/orders", trackingRoutes);
  app.route("/store/account", accountRoutes);

  // Rider app
  app.route("/rider", riderRoutes);

  // Admin API
  app.route("/admin/auth", adminAuthRoutes);
  app.use("/admin/*", async (c, next) => (c.req.path.startsWith("/admin/auth/") ? next() : requireStaff(c, next)));
  for (const r of [adminCatalogRoutes, adminOrderRoutes, adminDeliveryRoutes, adminPeopleRoutes, adminMarketingRoutes, adminReportRoutes, adminSystemRoutes, adminImportRoutes]) {
    app.route("/admin", r);
  }
  app.route("/admin/inventory", adminInventoryRoutes);

  app.notFound((c) => c.json({ error: "Not found" }, 404));
  app.onError((err, c) => {
    if (err instanceof ApiError) return c.json({ error: err.message, details: err.details }, err.status);
    if (err instanceof HTTPException) return c.json({ error: err.message || "Request error" }, err.status);
    logger.error({ err, path: c.req.path, method: c.req.method }, "unhandled error");
    return c.json({ error: "Something went wrong. Please try again." }, 500);
  });
  return app;
}
