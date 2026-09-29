import { randomBytes } from "node:crypto";
import { and, desc, eq, gt, inArray, or, sql, type SQL } from "drizzle-orm";
import { categories, orderItems, productVariants, inventoryLevels, products, type Database } from "@ugmall/database";
import { applyEvent, DAY, EVENT_WEIGHTS, topKeys, type ProductFacts, type Profile, type ShopperEvent } from "./profile";
import { hashSeed, hourlySeed, rank, type Candidate, type Ranked, type Signals } from "./rank";
import { RecommendationStore } from "./store";

/** Effective price now (sale price when a sale is running). */
const priceExpr = sql<number>`least(${products.price}, coalesce(case when (${products.saleStartsAt} is null or ${products.saleStartsAt} <= now()) and (${products.saleEndsAt} is null or ${products.saleEndsAt} > now()) then ${products.salePrice} end, ${products.price}))`;

export interface FeedScope {
  /** Only products in these categories (already expanded to descendants). */
  categoryIds?: string[];
  /** Never return these (e.g. the product being viewed). */
  excludeIds?: string[];
}

export interface FeedPage {
  items: Ranked[];
  /** Pass back to get the next page; null when the feed is exhausted. */
  cursor: string | null;
}

export interface HomeSections {
  continueBrowsing: string[];
  becauseYouViewed: { productId: string; items: Ranked[] } | null;
  trending: { categoryId: string | null; items: Ranked[] };
  newForYou: Ranked[];
}

/**
 * The "For You" engine: learns each shopper's taste from their actions and
 * turns the catalogue into a personal, ever-changing feed.
 */
export class RecommendationService {
  readonly store: RecommendationStore;

  constructor(
    private db: Database,
    redis: ConstructorParameters<typeof RecommendationStore>[0],
  ) {
    this.store = new RecommendationStore(redis);
  }

  /* ------------------------------------------------------------ learning */

  async facts(productIds: string[]): Promise<Map<string, ProductFacts>> {
    if (!productIds.length) return new Map();
    const rows = await this.db
      .select({ id: products.id, categoryId: products.categoryId, parentCategoryId: categories.parentId, brandId: products.brandId, price: priceExpr, tags: products.tags })
      .from(products)
      .leftJoin(categories, eq(categories.id, products.categoryId))
      .where(inArray(products.id, productIds));
    return new Map(rows.map((r) => [r.id, { ...r, price: Number(r.price) }]));
  }

  /** Record what a shopper did. Unknown product ids are ignored. */
  async record(subject: string, events: ShopperEvent[], now = Date.now()) {
    if (!events.length) return;
    const ids = [...new Set(events.flatMap((e) => (e.productId ? [e.productId] : [])))];
    const facts = await this.facts(ids);
    const catIds = [...new Set(events.flatMap((e) => (e.type === "category" && e.categoryId ? [e.categoryId] : [])))];
    const parents = catIds.length
      ? new Map((await this.db.select({ id: categories.id, parentId: categories.parentId }).from(categories).where(inArray(categories.id, catIds))).map((r) => [r.id, r.parentId]))
      : new Map<string, string | null>();

    const profile = await this.store.getProfile(subject);
    const before = profile.recent.slice(0, 6);
    for (const e of events) {
      const product = e.productId ? (facts.get(e.productId) ?? null) : null;
      if (e.productId && !product) continue;
      if (e.type === "category") {
        if (!parents.has(e.categoryId ?? "")) continue;
        e.parentCategoryId = parents.get(e.categoryId!) ?? null;
      }
      applyEvent(profile, e, product, now);
      if (product && e.type !== "impression") {
        const w = EVENT_WEIGHTS[e.type as keyof typeof EVENT_WEIGHTS];
        await this.store.bumpTrending(product.id, w, now);
        if (e.type !== "dwell") await this.store.linkCoEngagement(product.id, before, e.type === "purchase" || e.type === "cart" ? 2 : 1);
      }
    }
    await this.store.saveProfile(subject, profile);
  }

  /** Purchases also link every product in the basket together ("bought together"). */
  async recordPurchase(subject: string, productIds: string[]) {
    const unique = [...new Set(productIds)];
    await this.record(subject, unique.map((productId) => ({ type: "purchase" as const, productId })));
    for (const id of unique) await this.store.linkCoEngagement(id, unique, 3);
  }

  /* ----------------------------------------------------------- candidates */

  private baseWhere(scope: FeedScope): SQL[] {
    const w: SQL[] = [eq(products.status, "active")];
    if (scope.categoryIds) w.push(scope.categoryIds.length ? inArray(products.categoryId, scope.categoryIds) : sql`false`);
    return w;
  }

  private async ids(where: SQL[], order: SQL | SQL[], limit: number): Promise<string[]> {
    const rows = await this.db
      .select({ id: products.id })
      .from(products)
      .leftJoin(categories, eq(categories.id, products.categoryId))
      .where(and(...where))
      .orderBy(...(Array.isArray(order) ? order : [order]))
      .limit(limit);
    return rows.map((r) => r.id);
  }

  /** Gather a few hundred plausible products from several independent sources. */
  private async gather(profile: Profile, scope: FeedScope, similar: Map<string, number>, trending: Map<string, number>, now: number): Promise<string[]> {
    const base = this.baseWhere(scope);
    const cats = topKeys(profile.cats, 6, now).map((k) => k.key);
    const brands = topKeys(profile.brands, 4, now).map((k) => k.key);
    const random = sql`random()`;
    const sources = await Promise.all([
      cats.length ? this.ids([...base, or(inArray(products.categoryId, cats), inArray(categories.parentId, cats))!], random, 160) : [],
      brands.length ? this.ids([...base, inArray(products.brandId, brands)], random, 60) : [],
      this.ids([...base, gt(products.createdAt, new Date(now - 45 * DAY))], desc(products.createdAt), 60),
      this.ids([...base, sql`${priceExpr} < ${products.price}`], random, 50),
      this.ids(base, desc(sql`(select coalesce(sum(i.quantity), 0) from ${orderItems} i where i.product_id = ${products.id})`), 60),
      this.ids(base, random, 90), // exploration pool
    ]);
    const exclude = new Set(scope.excludeIds ?? []);
    return [...new Set([...similar.keys(), ...trending.keys(), ...sources.flat()])].filter((id) => !exclude.has(id));
  }

  private async candidates(ids: string[], scope: FeedScope): Promise<Candidate[]> {
    if (!ids.length) return [];
    const rows = await this.db
      .select({
        id: products.id,
        name: products.name,
        categoryId: products.categoryId,
        parentCategoryId: categories.parentId,
        brandId: products.brandId,
        price: priceExpr,
        listPrice: products.price,
        createdAt: products.createdAt,
        rating: products.ratingAverage,
        ratingCount: products.ratingCount,
        tags: products.tags,
        sold: sql<number>`(select coalesce(sum(i.quantity), 0)::int from ${orderItems} i where i.product_id = ${products.id})`,
        available: sql<number>`(select coalesce(sum(greatest(l.on_hand - l.reserved, 0)), 0)::int from ${productVariants} v left join ${inventoryLevels} l on l.variant_id = v.id where v.product_id = ${products.id} and v.is_active)`,
      })
      .from(products)
      .leftJoin(categories, eq(categories.id, products.categoryId))
      .where(and(inArray(products.id, ids.slice(0, 800)), ...this.baseWhere(scope)));
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      categoryId: r.categoryId,
      parentCategoryId: r.parentCategoryId,
      brandId: r.brandId,
      price: Number(r.price),
      listPrice: r.listPrice,
      createdAt: r.createdAt.getTime(),
      rating: r.rating / 100,
      ratingCount: r.ratingCount,
      tags: r.tags,
      sold: Number(r.sold),
      inStock: Number(r.available) > 0,
    }));
  }

  private async signals(profile: Profile, now: number): Promise<Signals> {
    const [trending, similar] = await Promise.all([this.store.trending(200, now), this.store.similarTo(profile.recent.slice(0, 8))]);
    return { trending, similar };
  }

  /* ---------------------------------------------------------------- feeds */

  /**
   * One page of the personal feed. The first call ranks up to `depth` items
   * and stores the order under a cursor, so infinite scroll never repeats or
   * skips; the next visit gets a freshly shuffled feed. Served items are
   * logged as impressions, which makes them sink next time unless clicked.
   */
  async feed(subject: string, opts: { limit: number; cursor?: string | null; scope?: FeedScope; depth?: number }, now = Date.now()): Promise<FeedPage> {
    let token: string;
    let offset = 0;
    let ranked: Ranked[] | null = null;
    if (opts.cursor) {
      const [t, o] = opts.cursor.split(".");
      const stored = t && /^[\w-]{8,40}$/.test(t) ? await this.store.loadFeed(t) : null;
      if (stored) {
        token = t!;
        offset = Math.max(0, Number(o) || 0);
        ranked = stored.map((s) => JSON.parse(s) as Ranked);
      }
    }
    if (!ranked) {
      token = randomBytes(9).toString("base64url");
      const profile = await this.store.getProfile(subject);
      const signals = await this.signals(profile, now);
      const ids = await this.gather(profile, opts.scope ?? {}, signals.similar, signals.trending, now);
      const cands = await this.candidates(ids, opts.scope ?? {});
      ranked = rank(cands, profile, signals, { now, limit: opts.depth ?? 240, seed: hashSeed(subject, now, token) });
      await this.store.saveFeed(token, ranked.map((r) => JSON.stringify(r)));
    }
    const items = ranked.slice(offset, offset + opts.limit);
    const next = offset + items.length;
    if (items.length) await this.record(subject, [{ type: "impression", productIds: items.map((i) => i.id) }], now);
    return { items, cursor: next < ranked.length ? `${token!}.${next}` : null };
  }

  /**
   * A personal order for a category/search listing. Same order for this
   * shopper for the whole hour, so page 2 continues page 1 exactly.
   */
  async orderListing(subject: string, productIds: string[], now = Date.now()): Promise<string[]> {
    const profile = await this.store.getProfile(subject);
    const signals = await this.signals(profile, now);
    const cands = await this.candidates(productIds, {});
    const ranked = rank(cands, profile, signals, { now, limit: cands.length, seed: hourlySeed(subject, productIds.length.toString(), now), temperature: 0.2, exploreRate: 0 });
    return ranked.map((r) => r.id);
  }

  /** "You may also like" for a product page: co-viewed + same category/brand/price, personalised. */
  async similar(subject: string, productId: string, limit = 12, now = Date.now()): Promise<Ranked[]> {
    const [facts] = [(await this.facts([productId])).get(productId)];
    if (!facts) return [];
    const profile = await this.store.getProfile(subject);
    const co = await this.store.similarTo([productId], 40);
    const base = this.baseWhere({});
    const near = [
      facts.categoryId ? this.ids([...base, eq(products.categoryId, facts.categoryId)], sql`random()`, 60) : Promise.resolve([]),
      facts.parentCategoryId ? this.ids([...base, eq(categories.parentId, facts.parentCategoryId)], sql`random()`, 40) : Promise.resolve([]),
      facts.brandId ? this.ids([...base, eq(products.brandId, facts.brandId)], sql`random()`, 20) : Promise.resolve([]),
    ];
    const ids = [...new Set([...co.keys(), ...(await Promise.all(near)).flat()])].filter((id) => id !== productId);
    const cands = await this.candidates(ids, {});
    // Similarity to THIS product counts most; the shopper's taste breaks ties.
    const similarity = new Map<string, number>();
    for (const c of cands) {
      const sameCat = c.categoryId === facts.categoryId ? 1 : c.parentCategoryId && c.parentCategoryId === facts.parentCategoryId ? 0.5 : 0;
      const brand = c.brandId && c.brandId === facts.brandId ? 1 : 0;
      const priceNear = facts.price > 0 ? Math.max(0, 1 - Math.abs(Math.log((c.price || 1) / facts.price)) / Math.log(3)) : 0;
      similarity.set(c.id, 0.45 * (co.get(c.id) ?? 0) + 0.3 * sameCat + 0.1 * brand + 0.15 * priceNear);
    }
    const trending = await this.store.trending(200, now);
    return rank(cands, profile, { similar: similarity, trending }, { now, limit, temperature: 0.25, exploreRate: 0 }).map((r) => ({ ...r, reason: "similar" as const }));
  }

  /** Personal rows for the home page. */
  async home(subject: string, now = Date.now()): Promise<HomeSections> {
    const profile = await this.store.getProfile(subject);
    const signals = await this.signals(profile, now);
    const recent = profile.recent.slice(0, 12);

    // Rotate the "because you viewed" anchor among the last few products.
    const anchor = recent.length ? recent[Math.floor(Math.random() * Math.min(3, recent.length))]! : null;
    const because = anchor ? (await this.similar(subject, anchor, 10, now)).filter((r) => !recent.includes(r.id)) : [];

    const favCat = topKeys(profile.cats, 1, now)[0]?.key ?? null;
    const trendIds = [...signals.trending.keys()];
    let trendCands = await this.candidates(trendIds.length ? trendIds : await this.gather(profile, {}, new Map(), new Map(), now), {});
    let trendCategory: string | null = null;
    if (favCat) {
      const inFav = trendCands.filter((c) => c.categoryId === favCat || c.parentCategoryId === favCat);
      if (inFav.length >= 6) {
        trendCands = inFav;
        trendCategory = favCat;
      }
    }
    const trending = rank(trendCands, profile, signals, { now, limit: 12, temperature: 0.5, exploreRate: 0 }).map((r) => ({ ...r, reason: "trending" as const }));

    const freshIds = await this.ids([...this.baseWhere({}), gt(products.createdAt, new Date(now - 30 * DAY))], desc(products.createdAt), 80);
    const newForYou = rank(await this.candidates(freshIds, {}), profile, signals, { now, limit: 12, temperature: 0.4, exploreRate: 0 }).map((r) => ({ ...r, reason: "new" as const }));

    return {
      continueBrowsing: recent.length >= 2 ? recent : [],
      becauseYouViewed: anchor && because.length >= 4 ? { productId: anchor, items: because } : null,
      trending: { categoryId: trendCategory, items: trending },
      newForYou,
    };
  }
}
