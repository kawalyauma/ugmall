import type { MiddlewareHandler } from "hono";
import { rateLimit } from "@ugmall/auth";
import { ApiError, clientIp } from "../lib/http";
import type { AppEnv } from "../types";

/**
 * CSRF protection for cookie-authenticated requests: every state-changing
 * request must carry `X-Requested-With: ugmall`. Browsers can't add custom
 * headers cross-site without a CORS preflight, which we never approve for
 * foreign origins. Webhooks are exempt (they authenticate by signature).
 */
export const csrfGuard: MiddlewareHandler<AppEnv> = async (c, next) => {
  const m = c.req.method;
  if (m !== "GET" && m !== "HEAD" && m !== "OPTIONS" && !c.req.path.startsWith("/webhooks/")) {
    if (c.req.header("x-requested-with") !== "ugmall") throw new ApiError(403, "Missing CSRF header");
  }
  await next();
};

export const limit =
  (name: string, max: number, windowSeconds: number, keyFn?: (c: Parameters<MiddlewareHandler<AppEnv>>[0]) => string): MiddlewareHandler<AppEnv> =>
  async (c, next) => {
    const key = `${name}:${keyFn ? keyFn(c) : clientIp(c)}`;
    const r = await rateLimit(c.get("container").redis, key, max, windowSeconds);
    c.header("RateLimit-Remaining", String(r.remaining));
    if (!r.allowed) {
      c.header("Retry-After", String(r.resetIn));
      throw new ApiError(429, "Too many requests. Please wait a moment and try again.");
    }
    await next();
  };

export const securityHeaders: MiddlewareHandler<AppEnv> = async (c, next) => {
  await next();
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Referrer-Policy", "strict-origin-when-cross-origin");
  c.header("X-Frame-Options", "DENY");
};
