import { describe, expect, it } from "vitest";
import { quoteDelivery, type ZoneLike } from "./fees";

const zone = (z: Partial<ZoneLike>): ZoneLike => ({
  id: "z", name: "Ntinda", fee: 7000, isCalculated: false, baseFee: null, perKgFee: null,
  freeDeliveryThreshold: null, methods: ["boda", "pickup"], isActive: true, ...z,
});

describe("quoteDelivery", () => {
  it("charges flat fees per zone", () => {
    expect(quoteDelivery({ zone: zone({}), method: "boda", subtotal: 116000, totalWeightGrams: 0 }).fee).toBe(7000);
  });
  it("pickup is free and needs no zone", () => {
    expect(quoteDelivery({ zone: null, method: "pickup", subtotal: 1, totalWeightGrams: 0 }).fee).toBe(0);
  });
  it("applies free delivery threshold", () => {
    expect(quoteDelivery({ zone: zone({ freeDeliveryThreshold: 100000 }), method: "boda", subtotal: 116000, totalWeightGrams: 0 }).fee).toBe(0);
  });
  it("calculates upcountry by weight rounded to 500", () => {
    const q = quoteDelivery({
      zone: zone({ name: "Upcountry", isCalculated: true, fee: null, baseFee: 10000, perKgFee: 1200, methods: ["bus_parcel", "courier"] }),
      method: "bus_parcel",
      subtotal: 50000,
      totalWeightGrams: 2300,
    });
    expect(q.fee).toBe(14000); // 10,000 + 3 kg × 1,200 = 13,600 → rounded up to 14,000
  });
  it("rejects methods the zone does not offer", () => {
    expect(() => quoteDelivery({ zone: zone({}), method: "bus_parcel", subtotal: 1, totalWeightGrams: 0 })).toThrow();
  });
});
