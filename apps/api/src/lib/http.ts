import type { Context } from "hono";
import { randomBytes } from "node:crypto";
import { HTTPException } from "hono/http-exception";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import type { z } from "zod";
import type { AppEnv } from "../types";

export class ApiError extends HTTPException {
  constructor(status: 400 | 401 | 403 | 404 | 409 | 422 | 429 | 500 | 502 | 503, message: string, public details?: unknown) {
    super(status, { message });
  }
}

export function parse<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data);
  if (!r.success) {
    const issues = r.error.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
    throw new ApiError(422, issues[0] ? `${issues[0].path ? `${issues[0].path}: ` : ""}${issues[0].message}` : "Invalid input", issues);
  }
  return r.data;
}

export async function body<T extends z.ZodType>(c: Context, schema: T): Promise<z.infer<T>> {
  let data: unknown;
  try {
    data = await c.req.json();
  } catch {
    throw new ApiError(400, "Expected a JSON body");
  }
  return parse(schema, data);
}

export function pagination(c: Context, maxLimit = 100) {
  const page = Math.max(1, Number(c.req.query("page") ?? 1) || 1);
  const limit = Math.min(maxLimit, Math.max(1, Number(c.req.query("limit") ?? 24) || 24));
  return { page, limit, offset: (page - 1) * limit };
}

export const COOKIES = {
  staff: "ugm_staff",
  customer: "ugm_session",
  cart: "ugm_cart",
  device: "ugm_device",
} as const;

const DEVICE_TTL = 60 * 60 * 24 * 365 * 2;

/** Stable, anonymous browser identity. It is an unguessable HttpOnly cookie,
 * so guest orders can remain available on this device without an account. */
export function getDeviceId(c: Context<AppEnv>, create = true): string | null {
  let id = c.get("deviceId") ?? readCookie(c, COOKIES.device);
  if (id && !/^[A-Za-z0-9_-]{24,64}$/.test(id)) id = undefined;
  if (!id && create) {
    id = randomBytes(24).toString("base64url");
    writeCookie(c, COOKIES.device, id, DEVICE_TTL);
  }
  if (id) c.set("deviceId", id);
  return id ?? null;
}

export function readCookie(c: Context, name: string) {
  return getCookie(c, name);
}

export function writeCookie(c: Context<AppEnv>, name: string, value: string, maxAgeSeconds: number) {
  const env = c.get("container").env;
  setCookie(c, name, value, {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "Lax",
    path: "/",
    maxAge: maxAgeSeconds,
    domain: env.COOKIE_DOMAIN || undefined,
  });
}

export function clearCookie(c: Context<AppEnv>, name: string) {
  deleteCookie(c, name, { path: "/", domain: c.get("container").env.COOKIE_DOMAIN || undefined });
}

export function clientIp(c: Context<AppEnv>): string {
  if (c.get("container").env.TRUST_PROXY) {
    const fwd = c.req.header("x-real-ip") ?? c.req.header("cf-connecting-ip") ?? c.req.header("x-forwarded-for")?.split(",")[0];
    if (fwd) return fwd.trim();
  }
  const info = (c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined)?.incoming?.socket?.remoteAddress;
  return info ?? "unknown";
}
