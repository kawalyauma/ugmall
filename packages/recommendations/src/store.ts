import type { Redis } from "ioredis";
import { DAY, emptyProfile, mergeProfiles, type Profile } from "./profile";

/**
 * Redis layout (all keys prefixed `rec:`):
 *   prof:{subject}   JSON Profile                       (TTL 120 days)
 *   trend:{yyyymmdd} ZSET productId -> weighted actions  (TTL 8 days)
 *   co:{productId}   ZSET productId -> co-engagement     (TTL 90 days, top 60 kept)
 *   feed:{token}     JSON list of ranked ids for paging  (TTL 30 minutes)
 *
 * `subject` is `c:<customerId>` for signed-in shoppers, else `v:<visitorId>`.
 */
const PROFILE_TTL = 120 * 24 * 3600;
const TREND_TTL = 8 * 24 * 3600;
const CO_TTL = 90 * 24 * 3600;
const CO_KEEP = 60;
export const FEED_TTL = 30 * 60;

const day = (ms: number) => new Date(ms).toISOString().slice(0, 10).replace(/-/g, "");

export class RecommendationStore {
  private trendCache: { at: number; map: Map<string, number> } | null = null;

  constructor(private redis: Redis) {}

  async getProfile(subject: string): Promise<Profile> {
    const raw = await this.redis.get(`rec:prof:${subject}`);
    if (!raw) return emptyProfile();
    try {
      const p = JSON.parse(raw) as Profile;
      return p?.v === 1 ? p : emptyProfile();
    } catch {
      return emptyProfile();
    }
  }

  async saveProfile(subject: string, profile: Profile) {
    await this.redis.set(`rec:prof:${subject}`, JSON.stringify(profile), "EX", PROFILE_TTL);
  }

  /** Fold a guest's profile into the customer's once they sign in. */
  async adoptGuestProfile(customerSubject: string, visitorSubject: string) {
    const guestRaw = await this.redis.get(`rec:prof:${visitorSubject}`);
    if (!guestRaw) return;
    const [guest, mine] = [JSON.parse(guestRaw) as Profile, await this.getProfile(customerSubject)];
    await this.saveProfile(customerSubject, mergeProfiles(mine, guest));
    await this.redis.del(`rec:prof:${visitorSubject}`);
  }

  /** Shop-wide popularity: today's actions count fully, older days less. */
  async bumpTrending(productId: string, weight: number, now = Date.now()) {
    const key = `rec:trend:${day(now)}`;
    await this.redis.multi().zincrby(key, weight, productId).expire(key, TREND_TTL).exec();
  }

  async trending(limit = 200, now = Date.now()): Promise<Map<string, number>> {
    if (this.trendCache && now - this.trendCache.at < 60_000) return this.trendCache.map;
    const weights = [1, 0.6, 0.35, 0.2];
    const days = await Promise.all(weights.map((_, i) => this.redis.zrevrange(`rec:trend:${day(now - i * DAY)}`, 0, limit - 1, "WITHSCORES")));
    const sum = new Map<string, number>();
    days.forEach((flat, i) => {
      for (let k = 0; k < flat.length; k += 2) sum.set(flat[k]!, (sum.get(flat[k]!) ?? 0) + Number(flat[k + 1]) * weights[i]!);
    });
    const top = [...sum.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
    const max = top[0]?.[1] ?? 1;
    const map = new Map(top.map(([id, v]) => [id, v / max]));
    this.trendCache = { at: now, map };
    return map;
  }

  /**
   * Item-to-item "people who looked at A also looked at B": link a product
   * with the shopper's previous few, closer in time = stronger.
   */
  async linkCoEngagement(productId: string, previous: string[], weight = 1) {
    const others = previous.filter((id) => id !== productId).slice(0, 6);
    if (!others.length) return;
    const m = this.redis.multi();
    others.forEach((other, i) => {
      const w = weight * (1 - i * 0.12);
      m.zincrby(`rec:co:${productId}`, w, other);
      m.zincrby(`rec:co:${other}`, w, productId);
    });
    for (const id of [productId, ...others]) {
      m.zremrangebyrank(`rec:co:${id}`, 0, -(CO_KEEP + 1));
      m.expire(`rec:co:${id}`, CO_TTL);
    }
    await m.exec();
  }

  /** Neighbours of several seed products, blended (earlier seeds weigh more), normalised 0..1. */
  async similarTo(seeds: string[], perSeed = 20): Promise<Map<string, number>> {
    if (!seeds.length) return new Map();
    const lists = await Promise.all(seeds.map((id) => this.redis.zrevrange(`rec:co:${id}`, 0, perSeed - 1, "WITHSCORES")));
    const out = new Map<string, number>();
    lists.forEach((flat, i) => {
      const seedWeight = 1 / (1 + i * 0.35);
      const top = Number(flat[1] ?? 1) || 1;
      for (let k = 0; k < flat.length; k += 2) {
        const id = flat[k]!;
        out.set(id, (out.get(id) ?? 0) + (Number(flat[k + 1]) / top) * seedWeight);
      }
    });
    for (const s of seeds) out.delete(s);
    const max = Math.max(0, ...out.values());
    if (max > 0) for (const [k, v] of out) out.set(k, v / max);
    return out;
  }

  async saveFeed(token: string, ids: string[]) {
    await this.redis.set(`rec:feed:${token}`, JSON.stringify(ids), "EX", FEED_TTL);
  }

  async loadFeed(token: string): Promise<string[] | null> {
    const raw = await this.redis.get(`rec:feed:${token}`);
    return raw ? (JSON.parse(raw) as string[]) : null;
  }
}
