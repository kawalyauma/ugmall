import { serve } from "@hono/node-server";
import { createApp } from "./app";
import { createContainer } from "./container";
import { logger } from "./lib/logger";

const container = createContainer();
if (process.env.RUN_MIGRATIONS === "true") {
  const { runMigrations } = await import("@ugmall/database/migrate");
  await runMigrations(container.env.DATABASE_URL);
  logger.info("migrations applied");
}
const app = createApp(container);

const server = serve({ fetch: app.fetch, port: container.env.PORT, hostname: "0.0.0.0" }, (info) => {
  logger.info(`API listening on :${info.port} (${container.env.NODE_ENV})`);
  logger.info(`payment methods enabled: ${container.payments.enabledMethods().join(", ")}`);
});

const shutdown = async (signal: string) => {
  logger.info(`${signal} received, shutting down`);
  server.close();
  await Promise.allSettled([...Object.values(container.queues).map((q) => q.close()), container.redis.quit(), container.queueRedis.quit(), container.closeDb()]);
  process.exit(0);
};
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
