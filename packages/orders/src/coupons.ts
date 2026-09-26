import type { CouponType } from "@ugmall/shared";

export interface CouponLike {
  code: string;
  type: CouponType;
  value: number;
  maxDiscount: number | null;
  minOrderAmount: number;
  maxUses: number | null;
  usedCount: number;
  startsAt: Date | null;
  endsAt: Date | null;
  isActive: boolean;
}

export class CouponError extends Error {}

/** Pure coupon maths; per-customer limits are checked against the DB by the service. */
export function computeCouponDiscount(c: CouponLike, subtotal: number, deliveryFee: number, now = new Date()): number {
  if (!c.isActive) throw new CouponError("This coupon is not active");
  if (c.startsAt && c.startsAt > now) throw new CouponError("This coupon is not valid yet");
  if (c.endsAt && c.endsAt <= now) throw new CouponError("This coupon has expired");
  if (c.maxUses !== null && c.usedCount >= c.maxUses) throw new CouponError("This coupon has been fully used");
  if (subtotal < c.minOrderAmount) {
    throw new CouponError(`Spend at least UGX ${c.minOrderAmount.toLocaleString("en-US")} to use this coupon`);
  }
  let discount = 0;
  if (c.type === "percent") discount = Math.round((subtotal * Math.min(100, c.value)) / 100);
  else if (c.type === "fixed") discount = c.value;
  else if (c.type === "free_delivery") discount = deliveryFee;
  if (c.maxDiscount !== null) discount = Math.min(discount, c.maxDiscount);
  return Math.max(0, Math.min(discount, subtotal + (c.type === "free_delivery" ? deliveryFee : 0)));
}
