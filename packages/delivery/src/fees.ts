import type { DeliveryMethod } from "@ugmall/shared";

export interface ZoneLike {
  id: string;
  name: string;
  fee: number | null;
  isCalculated: boolean;
  baseFee: number | null;
  perKgFee: number | null;
  freeDeliveryThreshold: number | null;
  methods: string[];
  isActive: boolean;
}

export interface DeliveryQuote {
  fee: number;
  /** false when the fee must be confirmed by staff (e.g. upcountry with no weights). */
  isFinal: boolean;
  description: string;
}

export class DeliveryError extends Error {}

/**
 * Delivery pricing.
 *  - pickup is always free
 *  - flat-fee zones (Kampala Central 5,000, Ntinda 7,000 ...)
 *  - calculated zones (upcountry): base + per-kg, rounded up to the next 500
 *  - optional free delivery above a zone's order threshold
 */
export function quoteDelivery(opts: {
  zone: ZoneLike | null;
  method: DeliveryMethod;
  subtotal: number;
  totalWeightGrams: number;
}): DeliveryQuote {
  const { zone, method, subtotal, totalWeightGrams } = opts;
  if (method === "pickup") return { fee: 0, isFinal: true, description: "Pickup from shop — free" };
  if (!zone) throw new DeliveryError("Please choose a delivery area");
  if (!zone.isActive) throw new DeliveryError(`We don't currently deliver to ${zone.name}`);
  if (zone.methods.length && !zone.methods.includes(method)) {
    throw new DeliveryError(`${method.replace("_", " ")} is not available for ${zone.name}`);
  }
  if (zone.freeDeliveryThreshold && subtotal >= zone.freeDeliveryThreshold) {
    return { fee: 0, isFinal: true, description: `Free delivery to ${zone.name}` };
  }
  if (!zone.isCalculated) {
    return { fee: zone.fee ?? 0, isFinal: true, description: `Delivery to ${zone.name}` };
  }
  const base = zone.baseFee ?? zone.fee ?? 0;
  if (!zone.perKgFee) {
    return { fee: base, isFinal: totalWeightGrams > 0 || base > 0, description: `Delivery to ${zone.name} (${zone.name === "Upcountry" ? "we'll confirm the final fee" : "estimate"})` };
  }
  const kg = Math.max(1, Math.ceil(totalWeightGrams / 1000));
  const raw = base + zone.perKgFee * kg;
  return {
    fee: Math.ceil(raw / 500) * 500,
    isFinal: totalWeightGrams > 0,
    description: `Delivery to ${zone.name} (${kg} kg)`,
  };
}
