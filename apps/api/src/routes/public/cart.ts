import { randomBytes } from "node:crypto";
import { Hono, type Context } from "hono";
import { z } from "zod";
import { CartError, priceLines } from "@ugmall/orders";
import { ApiError, body, COOKIES, readCookie, writeCookie } from "../../lib/http";
import { learn } from "../../lib/shopper";
import type { AppEnv } from "../../types";

const CART_TTL = 60 * 60 * 24 * 30;
const MAX_LINES = 50;

const cartKey = (id: string) => `cart:${id}`;

export function getCartId(c: Context<AppEnv>, create: boolean): string | null {
  let id = c.get("cartId") ?? readCookie(c, COOKIES.cart);
  if (id && !/^[A-Za-z0-9_-]{16,64}$/.test(id)) id = undefined;
  if (!id && create) {
    id = randomBytes(18).toString("base64url");
    writeCookie(c, COOKIES.cart, id, CART_TTL);
  }
  if (id) c.set("cartId", id);
  return id ?? null;
}

export async function readCartLines(c: Context<AppEnv>): Promise<{ variantId: string; quantity: number }[]> {
  const id = getCartId(c, false);
  if (!id) return [];
  const raw = await c.get("container").redis.hgetall(cartKey(id));
  return Object.entries(raw)
    .map(([variantId, q]) => ({ variantId, quantity: Number(q) }))
    .filter((l) => l.quantity > 0);
}

export async function clearCart(c: Context<AppEnv>) {
  const id = getCartId(c, false);
  if (id) await c.get("container").redis.del(cartKey(id), `cart-resv:${id}`);
}

/** Prices the cart, silently dropping lines whose product was removed. */
async function cartView(c: Context<AppEnv>) {
  const { db, reservations, redis } = c.get("container");
  let lines = await readCartLines(c);
  const id = getCartId(c, false);
  const priced = [];
  for (const l of lines) {
    try {
      priced.push(...(await priceLines(db, [l])));
    } catch (err) {
      if (err instanceof CartError && id) await redis.hdel(cartKey(id), l.variantId);
      else throw err;
    }
  }
  lines = priced;
  const avail = await reservations.available(priced.map((p) => p.variantId));
  const items = priced.map((p) => ({ ...p, available: avail.get(p.variantId) ?? 0 }));
  return {
    items,
    count: items.reduce((s, i) => s + i.quantity, 0),
    subtotal: items.reduce((s, i) => s + i.lineTotal, 0),
    hasStockIssues: items.some((i) => i.quantity > i.available),
  };
}

export const cartRoutes = new Hono<AppEnv>();

cartRoutes.get("/", async (c) => c.json(await cartView(c)));

const lineSchema = z.object({ variantId: z.string().uuid(), quantity: z.number().int().min(0).max(100) });

cartRoutes.post("/items", async (c) => {
  const input = await body(c, lineSchema.extend({ quantity: z.number().int().min(1).max(100) }));
  const { redis, reservations } = c.get("container");
  const id = getCartId(c, true)!;
  const key = cartKey(id);
  const current = Number((await redis.hget(key, input.variantId)) ?? 0);
  if (!current && (await redis.hlen(key)) >= MAX_LINES) throw new ApiError(400, "Your cart is full");
  const wanted = current + input.quantity;
  const available = (await reservations.available([input.variantId])).get(input.variantId) ?? 0;
  if (available <= 0) throw new ApiError(409, "Sorry, this size is sold out");
  const qty = Math.min(wanted, available);
  await priceLines(c.get("container").db, [{ variantId: input.variantId, quantity: qty }]).catch((e) => {
    throw new ApiError(400, (e as Error).message);
  });
  await redis.multi().hset(key, input.variantId, qty).expire(key, CART_TTL).exec();
  const view = await cartView(c);
  const productId = view.items.find((i) => i.variantId === input.variantId)?.productId;
  if (productId) await learn(c, (s) => c.get("container").recommendations.record(s, [{ type: "cart", productId }]));
  return c.json({ ...view, notice: qty < wanted ? `Only ${available} available — we added what's left.` : undefined });
});

cartRoutes.patch("/items/:variantId", async (c) => {
  const { quantity } = await body(c, z.object({ quantity: z.number().int().min(0).max(100) }));
  const variantId = c.req.param("variantId");
  const id = getCartId(c, true)!;
  const { redis } = c.get("container");
  if (quantity === 0) await redis.hdel(cartKey(id), variantId);
  else await redis.multi().hset(cartKey(id), variantId, quantity).expire(cartKey(id), CART_TTL).exec();
  return c.json(await cartView(c));
});

cartRoutes.delete("/items/:variantId", async (c) => {
  const id = getCartId(c, false);
  if (id) await c.get("container").redis.hdel(cartKey(id), c.req.param("variantId"));
  return c.json(await cartView(c));
});

cartRoutes.delete("/", async (c) => {
  await clearCart(c);
  return c.json({ items: [], count: 0, subtotal: 0, hasStockIssues: false });
});
