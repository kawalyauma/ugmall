import { Hono } from "hono";
import { z } from "zod";
import { eq, inArray } from "drizzle-orm";
import { categories, products } from "@ugmall/database";
import type { Ranked, ShopperEvent } from "@ugmall/recommendations";
import { body } from "../../lib/http";
import { listProducts } from "../../lib/catalog";
import { shopperSubject } from "../../lib/shopper";
import { limit } from "../../middleware/security";
import type { AppEnv } from "../../types";
import type { Database } from "@ugmall/database";

export const recommendationRoutes = new Hono<AppEnv>();

/** Product cards in ranked order, each tagged with why it was picked. */
export async function hydrate(db: Database, ranked: Ranked[]) {
  if (!ranked.length) return [];
  const { items } = await listProducts(db, { productIds: ranked.map((r) => r.id), limit: ranked.length, offset: 0 });
  const byId = new Map(items.map((p) => [p.id, p]));
  return ranked.flatMap((r) => {
    const p = byId.get(r.id);
    return p ? [{ ...p, reason: r.reason }] : [];
  });
}

/** Category slug -> its id plus every descendant id. */
export async function categoryScope(db: Database, slug: string): Promise<string[]> {
  const all = await db.select({ id: categories.id, parentId: categories.parentId, slug: categories.slug }).from(categories);
  const root = all.find((x) => x.slug === slug);
  if (!root) return [];
  const ids = [root.id];
  for (let i = 0; i < ids.length; i++) for (const x of all) if (x.parentId === ids[i] && !ids.includes(x.id)) ids.push(x.id);
  return ids;
}

const eventSchema = z.object({
  type: z.enum(["view", "dwell", "search", "category"]),
  productId: z.string().uuid().optional(),
  categorySlug: z.string().max(120).optional(),
  query: z.string().max(100).optional(),
});

/** Browser beacon: product views, time spent on a product, searches and category visits. */
recommendationRoutes.post("/events", limit("rec-events", 120, 60), async (c) => {
  const input = await body(c, z.object({ events: z.array(eventSchema).min(1).max(30) }));
  const { db, recommendations } = c.get("container");
  const subject = (await shopperSubject(c, true))!;
  const slugs = [...new Set(input.events.flatMap((e) => (e.type === "category" && e.categorySlug ? [e.categorySlug] : [])))];
  const catIds = slugs.length ? new Map((await db.select({ id: categories.id, slug: categories.slug }).from(categories).where(inArray(categories.slug, slugs))).map((r) => [r.slug, r.id])) : new Map<string, string>();
  const events: ShopperEvent[] = input.events.flatMap((e): ShopperEvent[] => {
    if (e.type === "category") return catIds.has(e.categorySlug ?? "") ? [{ type: "category", categoryId: catIds.get(e.categorySlug!) }] : [];
    if (e.type === "search") return e.query?.trim() ? [{ type: "search", query: e.query }] : [];
    return e.productId ? [{ type: e.type, productId: e.productId }] : [];
  });
  await recommendations.record(subject, events);
  return c.json({ ok: true });
});

/** The infinite "For You" feed. Optional `category` scopes it to one department. */
recommendationRoutes.get("/feed", limit("rec-feed", 60, 60), async (c) => {
  const { db, recommendations } = c.get("container");
  const subject = (await shopperSubject(c, true))!;
  const size = Math.min(48, Math.max(4, Number(c.req.query("limit")) || 24));
  const slug = c.req.query("category");
  const scope = slug ? { categoryIds: await categoryScope(db, slug) } : {};
  const exclude = c.req.query("exclude")?.split(",").filter((x) => /^[0-9a-f-]{36}$/i.test(x)).slice(0, 50);
  const page = await recommendations.feed(subject, { limit: size, cursor: c.req.query("cursor"), scope: { ...scope, excludeIds: exclude } });
  c.header("Cache-Control", "private, no-store");
  return c.json({ items: await hydrate(db, page.items), cursor: page.cursor });
});

/** Personal home-page rows. */
recommendationRoutes.get("/feed/home", limit("rec-home", 30, 60), async (c) => {
  const { db, recommendations } = c.get("container");
  const subject = (await shopperSubject(c, true))!;
  const h = await recommendations.home(subject);
  const [continueBrowsing, because, trending, fresh] = await Promise.all([
    hydrate(db, h.continueBrowsing.map((id) => ({ id, score: 0, reason: "for_you" as const }))),
    h.becauseYouViewed ? hydrate(db, h.becauseYouViewed.items) : [],
    hydrate(db, h.trending.items),
    hydrate(db, h.newForYou),
  ]);
  const [anchor] = h.becauseYouViewed ? await db.select({ name: products.name, slug: products.slug }).from(products).where(eq(products.id, h.becauseYouViewed.productId)) : [];
  const [trendCat] = h.trending.categoryId ? await db.select({ name: categories.name, slug: categories.slug }).from(categories).where(eq(categories.id, h.trending.categoryId)) : [];
  c.header("Cache-Control", "private, no-store");
  return c.json({
    continueBrowsing: continueBrowsing.filter((p) => p.inStock).slice(0, 12),
    becauseYouViewed: anchor && because.length ? { product: anchor, items: because } : null,
    trending: { category: trendCat ?? null, items: trending },
    newForYou: fresh,
  });
});

/** "You may also like" on a product page. */
recommendationRoutes.get("/products/:id/recommendations", limit("rec-similar", 60, 60), async (c) => {
  const { db, recommendations } = c.get("container");
  const id = c.req.param("id");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return c.json({ items: [] });
  const subject = (await shopperSubject(c, false)) ?? "anon";
  const items = await hydrate(db, await recommendations.similar(subject, id, Math.min(24, Number(c.req.query("limit")) || 12)));
  c.header("Cache-Control", "private, no-store");
  return c.json({ items });
});
