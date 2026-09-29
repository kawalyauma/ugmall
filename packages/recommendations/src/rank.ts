import { affinityScore, DAY, HOUR, priceBand, timesSeen, type Profile } from "./profile";

/**
 * Ranking for the "For You" feed.
 *
 *   1. score every candidate on personal interest (category, brand, price
 *      band, keywords), "people also viewed" similarity, trending, quality,
 *      freshness and discount — blending personal and crowd signals by how
 *      much we know about the shopper (cold start = crowd, regulars = taste)
 *   2. penalise fatigue: things we have already shown and they ignored sink,
 *      things they just looked at and things they bought step aside
 *   3. sample instead of sort (Gumbel top-k): relevant items still win, but
 *      the order is different on every visit so the feed never looks frozen
 *   4. reserve some slots for exploration (categories they have not shown
 *      interest in yet) so the feed can discover new tastes
 *   5. re-order for variety: no long runs of one category or brand
 */

export type Reason = "for_you" | "similar" | "trending" | "new" | "deal" | "explore" | "popular";

export interface Candidate {
  id: string;
  categoryId: string | null;
  parentCategoryId: string | null;
  brandId: string | null;
  price: number;
  /** Price before discount. */
  listPrice: number;
  createdAt: number;
  rating: number; // 0..5
  ratingCount: number;
  sold: number;
  inStock: boolean;
  tags: string[];
  name: string;
}

export interface Signals {
  /** 0..1 — how hot the product is shop-wide over the last few days. */
  trending: Map<string, number>;
  /** 0..1 — co-viewed/co-bought with what this shopper recently engaged with. */
  similar: Map<string, number>;
}

export interface RankOptions {
  now?: number;
  /** Deterministic randomness (feed pages, hourly-stable listings). */
  seed?: number;
  /** 0 = strict sort, higher = more shuffle. Default 0.35. */
  temperature?: number;
  /** Share of slots reserved for exploration. Default 0.15. */
  exploreRate?: number;
  /** Max items of one category within any `diversityWindow` consecutive items. */
  maxPerCategory?: number;
  diversityWindow?: number;
  limit: number;
}

export interface Ranked {
  id: string;
  score: number;
  reason: Reason;
}

/* --------------------------------------------------------------- random */

/** Small fast seeded PRNG (mulberry32). */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashSeed(...parts: (string | number)[]): number {
  let h = 2166136261;
  for (const ch of parts.join("|")) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function gumbel(rand: () => number) {
  const u = Math.min(Math.max(rand(), 1e-12), 1 - 1e-12);
  return -Math.log(-Math.log(u));
}

/* -------------------------------------------------------------- scoring */

interface Scored extends Ranked {
  c: Candidate;
  key: number;
  explore: boolean;
}

/** How much to trust personal signals: 0 for a new visitor, ~1 after a few dozen actions. */
export function confidence(profile: Profile): number {
  return 1 - Math.exp(-profile.n / 6);
}

function normaliser(values: number[]) {
  const max = Math.max(0, ...values);
  return (v: number) => (max > 0 ? v / max : 0);
}

export function scoreCandidates(candidates: Candidate[], profile: Profile, signals: Signals, now = Date.now()) {
  const conf = confidence(profile);
  const cat = normaliser(Object.values(profile.cats).map((a) => affinityScore(a, now)));
  const brand = normaliser(Object.values(profile.brands).map((a) => affinityScore(a, now)));
  const price = normaliser(Object.values(profile.prices).map((a) => affinityScore(a, now)));
  const term = normaliser(Object.values(profile.terms).map((a) => affinityScore(a, now)));
  const maxSold = Math.max(1, ...candidates.map((c) => c.sold));
  const recent = new Set(profile.recent.slice(0, 12));
  const bought = new Set(profile.bought);
  const knowsPrices = Object.keys(profile.prices).length > 0;

  return candidates.map((c) => {
    const catAff = Math.min(1, cat(affinityScore(profile.cats[c.categoryId ?? ""], now)) + 0.5 * cat(affinityScore(profile.cats[c.parentCategoryId ?? ""], now)));
    const brandAff = brand(affinityScore(profile.brands[c.brandId ?? ""], now));
    const priceAff = knowsPrices ? price(affinityScore(profile.prices[String(priceBand(c.price))], now)) : 0.5;
    const words = new Set([...c.tags, ...c.name.split(/\s+/)].map((w) => w.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "")));
    let termAff = 0;
    for (const w of words) termAff = Math.max(termAff, term(affinityScore(profile.terms[w], now)));

    const interest = 0.5 * catAff + 0.2 * brandAff + 0.15 * priceAff + 0.15 * termAff;
    const similar = signals.similar.get(c.id) ?? 0;
    const trending = signals.trending.get(c.id) ?? 0;
    // Bayesian average: a single 5-star review should not beat 40 reviews at 4.6.
    const rating = (c.rating * c.ratingCount + 3.8 * 5) / (c.ratingCount + 5) / 5;
    const popularity = Math.log1p(c.sold) / Math.log1p(maxSold);
    const quality = 0.5 * rating + 0.5 * popularity;
    const ageDays = Math.max(0, (now - c.createdAt) / DAY);
    const freshness = Math.exp(-ageDays / 21);
    const discount = c.listPrice > c.price ? Math.min(0.5, (c.listPrice - c.price) / c.listPrice) * 2 : 0;

    let score =
      conf * (0.55 * interest + 0.25 * similar) + // personal
      (1 - conf) * (0.3 * trending + 0.2 * quality) + // crowd, for new visitors
      0.12 * trending +
      0.1 * quality +
      0.08 * freshness +
      0.05 * discount +
      0.02; // floor so everything has a chance

    // Fatigue: shown repeatedly without a click -> sink; just shown (a refresh) -> sink a bit more.
    // Bounded, so it rotates what they see within their interests instead of burying them.
    const seen = timesSeen(profile, c.id, now);
    if (seen.n > 0 && !profile.clicked[c.id]) score *= Math.max(0.35, Math.exp(-0.3 * seen.n));
    if (seen.lastMs && now - seen.lastMs < 10 * 60_000) score *= 0.7;
    // Already looked at it: it belongs in "continue browsing", not in discovery.
    if (recent.has(c.id)) score *= 0.25;
    if (bought.has(c.id)) score *= 0.05;
    if (!c.inStock) score *= 0.1;

    const reason: Reason =
      similar > 0.35 && conf > 0.2
        ? "similar"
        : interest > 0.45 && conf > 0.2
          ? "for_you"
          : trending > 0.5
            ? "trending"
            : ageDays < 10
              ? "new"
              : discount > 0.3
                ? "deal"
                : conf > 0.2 && interest > 0.2
                  ? "for_you"
                  : "popular";
    // "Explore" = something from outside the shopper's known interests.
    const explore = conf > 0.2 && catAff < 0.05 && similar === 0;
    return { c, id: c.id, score, reason, explore, key: 0 };
  });
}

/* -------------------------------------------------------------- ranking */

export function rank(candidates: Candidate[], profile: Profile, signals: Signals, opts: RankOptions): Ranked[] {
  const now = opts.now ?? Date.now();
  const rand = rng(opts.seed ?? Math.floor(Math.random() * 2 ** 32));
  const temperature = opts.temperature ?? 0.35;
  const unique = [...new Map(candidates.map((c) => [c.id, c])).values()];
  const scored = scoreCandidates(unique, profile, signals, now);

  // Gumbel-max trick: sorting by log(score) + T*Gumbel noise samples items
  // without replacement with probability ∝ score^(1/T).
  for (const s of scored) s.key = Math.log(s.score + 1e-9) + temperature * gumbel(rand);
  const exploit = scored.filter((s) => !s.explore).sort((a, b) => b.key - a.key);
  // Exploration picks are weighted by quality only (plus noise), not by taste.
  const explore = scored
    .filter((s) => s.explore)
    .map((s) => ({ ...s, key: Math.log(s.score + 1e-9) + 1.0 * gumbel(rand), reason: "explore" as Reason }))
    .sort((a, b) => b.key - a.key);

  // Interleave: every ~1/exploreRate slots, one exploration item.
  const exploreRate = profile.n === 0 ? 0 : (opts.exploreRate ?? 0.15);
  const every = exploreRate > 0 ? Math.max(2, Math.round(1 / exploreRate)) : Infinity;
  const merged: Scored[] = [];
  let i = 0;
  let j = 0;
  while (merged.length < unique.length && (i < exploit.length || j < explore.length)) {
    const slot = merged.length + 1;
    if ((slot % every === 0 && j < explore.length) || i >= exploit.length) merged.push(explore[j++]!);
    else merged.push(exploit[i++]!);
  }

  return diversify(merged, opts.limit, opts.maxPerCategory ?? 2, opts.diversityWindow ?? 5).map(({ id, score, reason }) => ({ id, score, reason }));
}

/**
 * Greedy re-order: walk the ranked list and take the best item that keeps the
 * last `window` picks to at most `maxPerCategory` of one category and no two
 * of the same brand back to back. A skipped item keeps its place in line, so a
 * strong item is only delayed a few slots, never dropped. When nothing left
 * fits the rule, the best remaining item is taken.
 */
export function diversify<T extends { c: Pick<Candidate, "categoryId" | "parentCategoryId" | "brandId"> }>(items: T[], limit: number, maxPerCategory = 2, window = 5): T[] {
  const pool = [...items];
  const out: T[] = [];
  while (out.length < limit && pool.length) {
    const tail = out.slice(-window);
    const lastBrand = out.at(-1)?.c.brandId;
    let pick = 0;
    for (let k = 0; k < pool.length; k++) {
      const c = pool[k]!.c;
      const sameCat = tail.filter((t) => t.c.categoryId === c.categoryId).length;
      const brandClash = c.brandId && c.brandId === lastBrand;
      if (sameCat < maxPerCategory && !brandClash) {
        pick = k;
        break;
      }
    }
    out.push(pool.splice(pick, 1)[0]!);
  }
  return out;
}

/** Stable seed for listings: same order for the same visitor within the hour, so pagination holds. */
export function hourlySeed(subject: string, scope: string, now = Date.now()) {
  return hashSeed(subject, scope, Math.floor(now / HOUR));
}
