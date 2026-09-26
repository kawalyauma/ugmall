export const PAYMENT_METHODS = ["mtn_momo", "airtel_money", "card", "cash_on_delivery", "pay_on_pickup"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  mtn_momo: "MTN Mobile Money",
  airtel_money: "Airtel Money",
  card: "Card",
  cash_on_delivery: "Cash on Delivery",
  pay_on_pickup: "Pay on Pickup",
};

export const PREPAID_METHODS: readonly PaymentMethod[] = ["mtn_momo", "airtel_money", "card"];
export const isPrepaid = (m: PaymentMethod) => PREPAID_METHODS.includes(m);

export const PAYMENT_STATUSES = ["pending", "succeeded", "failed", "cancelled", "refunded", "partially_refunded"] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const DELIVERY_METHODS = ["boda", "pickup", "courier", "bus_parcel", "internal_rider", "third_party"] as const;
export type DeliveryMethod = (typeof DELIVERY_METHODS)[number];

export const DELIVERY_METHOD_LABELS: Record<DeliveryMethod, string> = {
  boda: "Boda delivery",
  pickup: "Pickup from shop",
  courier: "Courier",
  bus_parcel: "Bus parcel",
  internal_rider: "Our rider",
  third_party: "Third-party delivery",
};

export const DELIVERY_STATUSES = ["assigned", "picked_up", "delivered", "failed", "cancelled"] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

export const PRODUCT_STATUSES = ["draft", "active", "archived"] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

export const INVENTORY_MOVEMENT_TYPES = [
  "received", // stock received (purchase / opening stock)
  "sale", // reserved stock converted to a sale
  "return", // customer return put back to stock
  "damaged", // written off
  "adjustment", // manual correction (+/-)
  "reserve", // order placed, stock held
  "release", // hold released (cancelled / expired)
] as const;
export type InventoryMovementType = (typeof INVENTORY_MOVEMENT_TYPES)[number];

export const RETURN_STATUSES = ["requested", "approved", "received", "rejected", "completed"] as const;
export type ReturnStatus = (typeof RETURN_STATUSES)[number];

export const REVIEW_STATUSES = ["pending", "approved", "rejected"] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

export const COUPON_TYPES = ["percent", "fixed", "free_delivery"] as const;
export type CouponType = (typeof COUPON_TYPES)[number];

export const ORDER_SOURCES = ["web", "whatsapp", "admin", "phone"] as const;
export type OrderSource = (typeof ORDER_SOURCES)[number];

/** Storage areas (top-level folders / buckets). Public ones are served by Nginx at /media. */
export const STORAGE_AREAS = ["products", "categories", "brands", "reviews", "customers", "invoices", "receipts", "returns", "temp"] as const;
export type StorageArea = (typeof STORAGE_AREAS)[number];
export const PUBLIC_STORAGE_AREAS: readonly StorageArea[] = ["products", "categories", "brands", "reviews"];

export const UG_DISTRICTS = [
  "Kampala", "Wakiso", "Mukono", "Entebbe", "Jinja", "Mbarara", "Gulu", "Lira", "Mbale", "Masaka",
  "Fort Portal", "Arua", "Hoima", "Kabale", "Soroti", "Tororo", "Mityana", "Mpigi", "Luwero", "Iganga",
  "Kasese", "Busia", "Kitgum", "Masindi", "Mubende", "Other",
] as const;

/**
 * What customers and staff can choose for new orders. "pickup" and
 * "pay_on_pickup" are no longer offered (no pickup stations); they stay in
 * the enums above only so old orders still display correctly.
 */
export const ORDERABLE_DELIVERY_METHODS = ["boda", "courier", "bus_parcel", "internal_rider", "third_party"] as const satisfies readonly DeliveryMethod[];
export const ORDERABLE_PAYMENT_METHODS = ["mtn_momo", "airtel_money", "card", "cash_on_delivery"] as const satisfies readonly PaymentMethod[];

/** Cash on Delivery policy: not allowed above this order total (UGX). Configurable in Settings. */
export const DEFAULT_COD_MAX_ORDER_TOTAL = 150_000;

/** limit 0 / null = no limit. The order total includes delivery. */
export function codAllowed(orderTotal: number, limit: number | null | undefined): boolean {
  return !limit || orderTotal <= limit;
}
