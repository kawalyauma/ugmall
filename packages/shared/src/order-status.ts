export const ORDER_STATUSES = [
  "pending",
  "awaiting_payment",
  "paid",
  "confirmed",
  "processing",
  "ready_for_dispatch",
  "assigned_to_rider",
  "out_for_delivery",
  "delivered",
  "cancelled",
  "returned",
  "refunded",
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  pending: "Pending",
  awaiting_payment: "Awaiting payment",
  paid: "Paid",
  confirmed: "Confirmed",
  processing: "Processing",
  ready_for_dispatch: "Ready for dispatch",
  assigned_to_rider: "Assigned to rider",
  out_for_delivery: "Out for delivery",
  delivered: "Delivered",
  cancelled: "Cancelled",
  returned: "Returned",
  refunded: "Refunded",
};

/**
 * Allowed transitions of the order state machine. Anything not listed here is
 * rejected by the orders module, so the status history is always coherent.
 */
export const ORDER_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  pending: ["awaiting_payment", "confirmed", "cancelled"],
  awaiting_payment: ["paid", "cancelled"],
  paid: ["confirmed", "processing", "ready_for_dispatch", "assigned_to_rider", "out_for_delivery", "cancelled", "refunded"],
  confirmed: ["processing", "ready_for_dispatch", "assigned_to_rider", "out_for_delivery", "delivered", "cancelled"],
  processing: ["ready_for_dispatch", "assigned_to_rider", "out_for_delivery", "cancelled"],
  ready_for_dispatch: ["assigned_to_rider", "out_for_delivery", "delivered", "cancelled"],
  assigned_to_rider: ["out_for_delivery", "ready_for_dispatch", "cancelled"],
  out_for_delivery: ["delivered", "returned", "ready_for_dispatch", "cancelled"],
  delivered: ["returned", "refunded"],
  cancelled: ["refunded"],
  returned: ["refunded"],
  refunded: [],
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_TRANSITIONS[from].includes(to);
}

export const TERMINAL_ORDER_STATUSES: readonly OrderStatus[] = ["delivered", "cancelled", "returned", "refunded"];

/** Statuses where the order is "live" and waiting on the shop to deliver. */
export const PENDING_DELIVERY_STATUSES: readonly OrderStatus[] = [
  "paid",
  "confirmed",
  "processing",
  "ready_for_dispatch",
  "assigned_to_rider",
  "out_for_delivery",
];

/** Customer-facing progress steps shown on the order tracking page. */
export const TRACKING_STEPS: readonly OrderStatus[] = [
  "pending",
  "confirmed",
  "processing",
  "ready_for_dispatch",
  "out_for_delivery",
  "delivered",
];
