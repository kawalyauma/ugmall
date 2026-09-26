import { describe, expect, it } from "vitest";
import { effectivePrice } from "./pricing";
import { computeCouponDiscount } from "./coupons";

const product = { id: "p1", categoryId: "c1", price: 60000, salePrice: 58000, saleStartsAt: null, saleEndsAt: null };

describe("effectivePrice", () => {
  it("uses the sale price inside the window", () => {
    expect(effectivePrice(product, null)).toEqual({ price: 58000, compareAt: 60000, discountPercent: 3 });
    const expired = { ...product, saleEndsAt: new Date(Date.now() - 1000) };
    expect(effectivePrice(expired, null).price).toBe(60000);
  });
  it("variant overrides and promotions pick the lowest price", () => {
    expect(effectivePrice(product, { price: 65000, salePrice: null }).price).toBe(58000);
    expect(effectivePrice(product, null, [{ percentOff: 10, productIds: [], categoryIds: ["c1"] }]).price).toBe(54000);
  });
});

describe("coupons", () => {
  const base = { code: "X", value: 10, maxDiscount: null, minOrderAmount: 0, maxUses: null, usedCount: 0, startsAt: null, endsAt: null, isActive: true };
  it("computes percent, fixed and free delivery", () => {
    expect(computeCouponDiscount({ ...base, type: "percent" }, 116000, 7000)).toBe(11600);
    expect(computeCouponDiscount({ ...base, type: "fixed", value: 5000 }, 116000, 7000)).toBe(5000);
    expect(computeCouponDiscount({ ...base, type: "free_delivery" }, 116000, 7000)).toBe(7000);
    expect(computeCouponDiscount({ ...base, type: "percent", maxDiscount: 3000 }, 116000, 7000)).toBe(3000);
  });
  it("enforces minimums, limits and dates", () => {
    expect(() => computeCouponDiscount({ ...base, type: "fixed", minOrderAmount: 200000 }, 116000, 0)).toThrow(/Spend at least/);
    expect(() => computeCouponDiscount({ ...base, type: "fixed", maxUses: 1, usedCount: 1 }, 116000, 0)).toThrow(/fully used/);
    expect(() => computeCouponDiscount({ ...base, type: "fixed", endsAt: new Date(0) }, 116000, 0)).toThrow(/expired/);
  });
});
