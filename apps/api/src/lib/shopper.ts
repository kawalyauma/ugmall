import { randomBytes } from "node:crypto";
import type { Context } from "hono";
import { COOKIES, readCookie, writeCookie } from "./http";
import type { AppEnv } from "../types";

const VISITOR_TTL = 60 * 60 * 24 * 365;

/**
 * Who the "For You" profile belongs to: the signed-in customer, else an
 * anonymous visitor id kept in a first-party cookie. What a guest browsed is
 * folded into their customer profile the first time they are seen signed in.
 * Returns null when there is no visitor yet and `create` is false.
 */
export async function shopperSubject(c: Context<AppEnv>, create: boolean): Promise<string | null> {
  let vid = readCookie(c, COOKIES.visitor);
  if (vid && !/^[A-Za-z0-9_-]{16,40}$/.test(vid)) vid = undefined;
  const customer = c.get("customer");
  if (customer) {
    if (vid) {
      await c.get("container").recommendations.store.adoptGuestProfile(`c:${customer.id}`, `v:${vid}`).catch(() => {});
    }
    return `c:${customer.id}`;
  }
  if (!vid && create) {
    vid = randomBytes(16).toString("base64url");
    writeCookie(c, COOKIES.visitor, vid, VISITOR_TTL);
  }
  return vid ? `v:${vid}` : null;
}

/** Learn from a server-side action without ever failing the request that caused it. */
export async function learn(c: Context<AppEnv>, fn: (subject: string) => Promise<unknown>) {
  try {
    const subject = await shopperSubject(c, true);
    if (subject) await fn(subject);
  } catch (err) {
    if (c.get("container").env.NODE_ENV !== "test") console.warn("[recommendations] could not record", (err as Error).message);
  }
}
