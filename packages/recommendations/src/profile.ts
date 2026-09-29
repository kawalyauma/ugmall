/**
 * A shopper's taste profile, learned from what they do in the shop.
 *
 * Every interest (a category, a brand, a price band, a keyword) keeps two
 * exponentially-decayed scores:
 *  - long:  half-life of two weeks — what this person generally likes
 *  - short: half-life of two hours — what they are shopping for right now
 * so a burst of phone-case views re-shapes the feed within the session, and
 * then fades back to their long-term taste. Scores decay lazily: each entry
 * stores the time it was last touched and is brought forward when read.
 *
 * The profile is a plain JSON object (no classes) so it can live in Redis and
 * be unit-tested without any I/O.
 */

export const DAY = 86_400_000;
export const HOUR = 3_600_000;
export const LONG_HALF_LIFE = 14 * DAY;
export const SHORT_HALF_LIFE = 2 * HOUR;
/** Impressions ("we showed you this") fade after about a day. */
export const SEEN_HALF_LIFE = DAY;

/** [longScore, shortScore, lastUpdatedMs] */
export type Affinity = [number, number, number];

export interface Profile {
  v: 1;
  /** Last time anything was recorded. */
  t: number;
  /** Number of engagement events ever recorded — how much we know about this shopper. */
  n: number;
  cats: Record<string, Affinity>;
  brands: Record<string, Affinity>;
  /** Log-scale price band (see priceBand) -> affinity. */
  prices: Record<string, Affinity>;
  /** Search words and product tags. */
  terms: Record<string, Affinity>;
  /** Products engaged with, newest first. */
  recent: string[];
  /** Products bought, newest first. */
  bought: string[];
  /** Impressions: productId -> [decayed times shown, last shown ms]. */
  seen: Record<string, [number, number]>;
  /** Products the shopper opened from a feed after being shown them: productId -> ms. */
  clicked: Record<string, number>;
}

export type EventType = "view" | "dwell" | "cart" | "wishlist" | "purchase" | "search" | "category" | "impression";

/** How strongly each action says "I like this". Purchases and carts dominate plain views. */
export const EVENT_WEIGHTS: Record<Exclude<EventType, "impression">, number> = {
  view: 1,
  dwell: 1.5,
  cart: 4,
  wishlist: 3,
  purchase: 6,
  search: 2,
  category: 1.2,
};

/** What we need to know about a product to learn from an event on it. */
export interface ProductFacts {
  id: string;
  categoryId: string | null;
  parentCategoryId: string | null;
  brandId: string | null;
  price: number;
  tags: string[];
}

export interface ShopperEvent {
  type: EventType;
  productId?: string;
  /** For "category" events. */
  categoryId?: string;
  parentCategoryId?: string | null;
  /** For "search" events. */
  query?: string;
  /** For "impression" events. */
  productIds?: string[];
}

const LIMITS = { cats: 40, brands: 30, prices: 30, terms: 60, recent: 40, bought: 100, seen: 600, clicked: 200 };

export function emptyProfile(now = Date.now()): Profile {
  return { v: 1, t: now, n: 0, cats: {}, brands: {}, prices: {}, terms: {}, recent: [], bought: [], seen: {}, clicked: {} };
}

export function decay(value: number, fromMs: number, toMs: number, halfLife: number): number {
  if (toMs <= fromMs) return value;
  return value * Math.pow(0.5, (toMs - fromMs) / halfLife);
}

/** Current (long, short) scores of one affinity entry. */
export function affinityNow(a: Affinity | undefined, now: number): { long: number; short: number } {
  if (!a) return { long: 0, short: 0 };
  return { long: decay(a[0], a[2], now, LONG_HALF_LIFE), short: decay(a[1], a[2], now, SHORT_HALF_LIFE) };
}

/** One number for "how much do they like this right now": long-term taste plus a boost for current intent. */
export function affinityScore(a: Affinity | undefined, now: number): number {
  const { long, short } = affinityNow(a, now);
  return long + 1.5 * short;
}

function bump(map: Record<string, Affinity>, key: string | null | undefined, weight: number, now: number) {
  if (!key || weight <= 0) return;
  const { long, short } = affinityNow(map[key], now);
  map[key] = [long + weight, short + weight, now];
}

/** Log-scale price band: ~1.6x per band, so UGX 10k and 12k share a band but 10k and 50k don't. */
export function priceBand(price: number): number {
  if (!Number.isFinite(price) || price <= 1000) return 0;
  return Math.min(30, Math.floor(Math.log(price / 1000) / Math.log(1.6)));
}

export function normaliseTerm(raw: string): string | null {
  const t = raw.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, "");
  return t.length >= 3 && t.length <= 30 ? t : null;
}

export function queryTerms(query: string): string[] {
  const stop = new Set(["the", "and", "for", "with", "men", "women", "new", "size", "ugx"]);
  return [...new Set(query.split(/\s+/).map(normaliseTerm).filter((t): t is string => !!t && !stop.has(t)))].slice(0, 6);
}

function pushFront(list: string[], id: string, max: number): string[] {
  return [id, ...list.filter((x) => x !== id)].slice(0, max);
}

/** Keep only the strongest entries so profiles stay small (a few KB). */
function prune(map: Record<string, Affinity>, max: number, now: number) {
  const keys = Object.keys(map);
  if (keys.length <= max) return;
  keys
    .map((k) => [k, affinityScore(map[k], now)] as const)
    .sort((a, b) => a[1] - b[1])
    .slice(0, keys.length - max)
    .forEach(([k]) => delete map[k]);
}

/**
 * Learn from one event. `product` must be given for product events (view,
 * dwell, cart, wishlist, purchase). Mutates and returns the profile.
 */
export function applyEvent(profile: Profile, event: ShopperEvent, product: ProductFacts | null, now = Date.now()): Profile {
  const p = profile;
  if (event.type === "impression") {
    for (const id of event.productIds ?? []) {
      const prev = p.seen[id];
      const n = prev ? decay(prev[0], prev[1], now, SEEN_HALF_LIFE) : 0;
      p.seen[id] = [n + 1, now];
    }
    trimSeen(p, now);
    p.t = now;
    return p;
  }

  const w = EVENT_WEIGHTS[event.type];
  if (event.type === "search") {
    for (const term of queryTerms(event.query ?? "")) bump(p.terms, term, w, now);
  } else if (event.type === "category") {
    bump(p.cats, event.categoryId, w, now);
    bump(p.cats, event.parentCategoryId, w * 0.5, now);
  } else if (product) {
    bump(p.cats, product.categoryId, w, now);
    bump(p.cats, product.parentCategoryId, w * 0.5, now);
    bump(p.brands, product.brandId, w * 0.8, now);
    const band = priceBand(product.price);
    bump(p.prices, String(band), w * 0.6, now);
    bump(p.prices, String(band - 1), w * 0.25, now);
    bump(p.prices, String(band + 1), w * 0.25, now);
    for (const tag of product.tags.slice(0, 6)) bump(p.terms, normaliseTerm(tag), w * 0.3, now);
    if (event.type !== "dwell") p.recent = pushFront(p.recent, product.id, LIMITS.recent);
    if (event.type === "purchase") p.bought = pushFront(p.bought, product.id, LIMITS.bought);
    if (p.seen[product.id] && event.type === "view") {
      p.clicked[product.id] = now;
      const keys = Object.keys(p.clicked);
      if (keys.length > LIMITS.clicked) keys.sort((a, b) => p.clicked[a]! - p.clicked[b]!).slice(0, keys.length - LIMITS.clicked).forEach((k) => delete p.clicked[k]);
    }
  } else {
    return p;
  }
  p.n += 1;
  p.t = now;
  prune(p.cats, LIMITS.cats, now);
  prune(p.brands, LIMITS.brands, now);
  prune(p.prices, LIMITS.prices, now);
  prune(p.terms, LIMITS.terms, now);
  return p;
}

function trimSeen(p: Profile, now: number) {
  for (const [id, [n, t]] of Object.entries(p.seen)) if (decay(n, t, now, SEEN_HALF_LIFE) < 0.05) delete p.seen[id];
  const keys = Object.keys(p.seen);
  if (keys.length > LIMITS.seen) keys.sort((a, b) => p.seen[a]![1] - p.seen[b]![1]).slice(0, keys.length - LIMITS.seen).forEach((k) => delete p.seen[k]);
}

/** How many times (decayed) we have shown this product recently. */
export function timesSeen(p: Profile, productId: string, now: number): { n: number; lastMs: number } {
  const s = p.seen[productId];
  return s ? { n: decay(s[0], s[1], now, SEEN_HALF_LIFE), lastMs: s[1] } : { n: 0, lastMs: 0 };
}

/**
 * Merge a guest profile into the signed-in customer's (on login), so what they
 * browsed before signing in is not lost. Returns a new profile.
 */
export function mergeProfiles(a: Profile, b: Profile, now = Date.now()): Profile {
  const out = emptyProfile(now);
  out.n = a.n + b.n;
  for (const key of ["cats", "brands", "prices", "terms"] as const) {
    for (const src of [a[key], b[key]]) {
      for (const [k, v] of Object.entries(src)) {
        const cur = affinityNow(out[key][k], now);
        const add = affinityNow(v, now);
        out[key][k] = [cur.long + add.long, cur.short + add.short, now];
      }
    }
    prune(out[key], LIMITS[key], now);
  }
  out.recent = [...new Set([...b.recent, ...a.recent])].slice(0, LIMITS.recent);
  out.bought = [...new Set([...b.bought, ...a.bought])].slice(0, LIMITS.bought);
  out.seen = { ...a.seen, ...b.seen };
  out.clicked = { ...a.clicked, ...b.clicked };
  trimSeen(out, now);
  return out;
}

/** Top-N keys of an affinity map by current score. */
export function topKeys(map: Record<string, Affinity>, n: number, now: number): { key: string; score: number }[] {
  return Object.entries(map)
    .map(([key, a]) => ({ key, score: affinityScore(a, now) }))
    .filter((x) => x.score > 0.05)
    .sort((x, y) => y.score - x.score)
    .slice(0, n);
}
