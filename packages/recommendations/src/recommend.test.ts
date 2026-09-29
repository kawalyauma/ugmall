import { describe, expect, it } from "vitest";
import { affinityScore, applyEvent, decay, emptyProfile, HOUR, DAY, mergeProfiles, priceBand, topKeys, type ProductFacts } from "./profile";
import { diversify, rank, type Candidate } from "./rank";

const now = 1_800_000_000_000;
const phone: ProductFacts = { id: "p1", categoryId: "phones", parentCategoryId: "electronics", brandId: "tecno", price: 450_000, tags: ["android"] };
const shoe: ProductFacts = { id: "s1", categoryId: "shoes", parentCategoryId: "fashion", brandId: "nike", price: 120_000, tags: ["sneakers"] };

function cand(id: string, categoryId: string, extra: Partial<Candidate> = {}): Candidate {
  return { id, name: id, categoryId, parentCategoryId: null, brandId: null, price: 50_000, listPrice: 50_000, createdAt: now - 60 * DAY, rating: 0, ratingCount: 0, sold: 1, inStock: true, tags: [], ...extra };
}

describe("profile", () => {
  it("decays by half every half-life", () => {
    expect(decay(8, 0, 2 * HOUR, HOUR)).toBeCloseTo(2);
  });

  it("learns categories, brands, price bands and recency, weighting carts over views", () => {
    const p = emptyProfile(now);
    applyEvent(p, { type: "view", productId: "s1" }, shoe, now);
    applyEvent(p, { type: "cart", productId: "p1" }, phone, now);
    expect(topKeys(p.cats, 1, now)[0]!.key).toBe("phones");
    expect(p.brands.tecno).toBeDefined();
    expect(p.prices[String(priceBand(450_000))]).toBeDefined();
    expect(p.recent).toEqual(["p1", "s1"]);
    expect(p.n).toBe(2);
  });

  it("short-term intent fades faster than long-term taste", () => {
    const p = emptyProfile(now);
    applyEvent(p, { type: "view", productId: "p1" }, phone, now);
    expect(affinityScore(p.cats.phones, now + 6 * HOUR)).toBeLessThan(affinityScore(p.cats.phones, now) * 0.5);
    expect(affinityScore(p.cats.phones, now + 6 * HOUR)).toBeGreaterThan(0.9);
  });

  it("merges a guest profile into the customer's", () => {
    const a = applyEvent(emptyProfile(now), { type: "view", productId: "p1" }, phone, now);
    const b = applyEvent(emptyProfile(now), { type: "view", productId: "s1" }, shoe, now);
    const m = mergeProfiles(a, b, now);
    expect(m.n).toBe(2);
    expect(Object.keys(m.cats)).toEqual(expect.arrayContaining(["phones", "shoes"]));
  });
});

describe("ranking", () => {
  const pool = [
    ...Array.from({ length: 20 }, (_, i) => cand(`phone${i}`, "phones")),
    ...Array.from({ length: 20 }, (_, i) => cand(`shoe${i}`, "shoes")),
    ...Array.from({ length: 20 }, (_, i) => cand(`pot${i}`, "kitchen")),
  ];
  const signals = { trending: new Map<string, number>(), similar: new Map<string, number>() };

  it("puts the shopper's interests first", () => {
    const p = emptyProfile(now);
    for (let i = 0; i < 15; i++) applyEvent(p, { type: "view", productId: "p1" }, phone, now);
    const top = rank(pool, p, signals, { now, limit: 10, seed: 1, exploreRate: 0, maxPerCategory: 10 });
    expect(top.filter((r) => r.id.startsWith("phone")).length).toBeGreaterThanOrEqual(8);
  });

  it("changes the order between visits but not for the same seed", () => {
    const p = emptyProfile(now);
    const a = rank(pool, p, signals, { now, limit: 12, seed: 1 }).map((r) => r.id);
    const b = rank(pool, p, signals, { now, limit: 12, seed: 2 }).map((r) => r.id);
    expect(rank(pool, p, signals, { now, limit: 12, seed: 1 }).map((r) => r.id)).toEqual(a);
    expect(a).not.toEqual(b);
  });

  it("sinks products already shown and ignored", () => {
    const p = emptyProfile(now);
    const first = rank(pool, p, signals, { now, limit: 12, seed: 7 }).map((r) => r.id);
    for (let k = 0; k < 3; k++) applyEvent(p, { type: "impression", productIds: first }, null, now - 2 * HOUR);
    const second = rank(pool, p, signals, { now, limit: 12, seed: 7 }).map((r) => r.id);
    expect(second.filter((id) => first.includes(id)).length).toBeLessThanOrEqual(6); // most of the page rotates
  });

  it("reserves exploration slots outside known interests", () => {
    const p = emptyProfile(now);
    for (let i = 0; i < 20; i++) applyEvent(p, { type: "view", productId: "p1" }, phone, now);
    const top = rank(pool, p, signals, { now, limit: 20, seed: 3, exploreRate: 0.2 });
    expect(top.some((r) => r.reason === "explore")).toBe(true);
  });

  it("never shows long runs of one category", () => {
    const items = pool.map((c) => ({ c }));
    const out = diversify(items, 30, 2, 5);
    for (let i = 0; i + 5 <= out.length; i++) {
      const w = out.slice(i, i + 5);
      for (const cat of ["phones", "shoes", "kitchen"]) expect(w.filter((x) => x.c.categoryId === cat).length).toBeLessThanOrEqual(2);
    }
  });

  it("drops out-of-stock and bought items to the bottom", () => {
    const p = emptyProfile(now);
    p.bought = ["phone0"];
    const r = rank([cand("phone0", "phones"), cand("gone", "phones", { inStock: false }), cand("ok", "phones")], p, signals, { now, limit: 3, seed: 1, temperature: 0 });
    expect(r[0]!.id).toBe("ok");
  });
});
