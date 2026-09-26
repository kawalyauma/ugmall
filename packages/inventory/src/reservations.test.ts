import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Redis } from "ioredis";
import { StockReservations } from "./reservations";

// Runs against a real Redis when TEST_REDIS_URL is set (e.g. redis://localhost:6379/15).
const url = process.env.TEST_REDIS_URL;
const d = url ? describe : describe.skip;

d("StockReservations (Redis)", () => {
  let redis: Redis;
  const stock = new Map<string, number>();
  let svc: StockReservations;

  beforeAll(async () => {
    redis = new Redis(url!);
    await redis.flushdb();
    svc = new StockReservations(redis, async (ids) => new Map(ids.map((i) => [i, stock.get(i) ?? 0])), 60);
  });
  afterAll(async () => {
    await redis.flushdb();
    await redis.quit();
  });

  it("never lets concurrent checkouts hold more than is available", async () => {
    stock.set("v-last-pair", 2);
    const results = await Promise.all(Array.from({ length: 10 }, () => svc.reserve([{ variantId: "v-last-pair", quantity: 1 }])));
    expect(results.filter((r) => r.ok)).toHaveLength(2);
    expect((await svc.available(["v-last-pair"])).get("v-last-pair")).toBe(0);
  });

  it("refreshing an existing hold does not double count, and release frees stock", async () => {
    stock.set("v2", 3);
    const a = await svc.reserve([{ variantId: "v2", quantity: 2 }]);
    expect(a.ok).toBe(true);
    const id = a.ok ? a.reservation.id : "";
    const again = await svc.reserve([{ variantId: "v2", quantity: 3 }], id);
    expect(again.ok).toBe(true);
    const other = await svc.reserve([{ variantId: "v2", quantity: 1 }]);
    expect(other.ok).toBe(false);
    await svc.release(id);
    expect((await svc.available(["v2"])).get("v2")).toBe(3);
  });

  it("expired holds stop counting", async () => {
    stock.set("v3", 1);
    const short = new StockReservations(redis, async (ids) => new Map(ids.map((i) => [i, stock.get(i) ?? 0])), 1);
    expect((await short.reserve([{ variantId: "v3", quantity: 1 }])).ok).toBe(true);
    expect((await short.reserve([{ variantId: "v3", quantity: 1 }])).ok).toBe(false);
    await new Promise((r) => setTimeout(r, 1100));
    expect((await short.reserve([{ variantId: "v3", quantity: 1 }])).ok).toBe(true);
  });
});
