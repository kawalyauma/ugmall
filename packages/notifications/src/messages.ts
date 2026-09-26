import { DELIVERY_METHOD_LABELS, PAYMENT_METHOD_LABELS, formatUGX, type DeliveryMethod, type PaymentMethod } from "@ugmall/shared";

export const NOTIFICATION_EVENTS = [
  "order_received",
  "payment_confirmed",
  "order_confirmed",
  "rider_dispatched",
  "delivered",
  "cancelled",
  "payment_failed",
  "refund_sent",
  "otp",
] as const;
export type NotificationEvent = (typeof NOTIFICATION_EVENTS)[number];

export interface OrderMessageContext {
  shopName: string;
  orderNumber: string;
  customerName: string;
  total: number;
  paymentMethod: PaymentMethod;
  deliveryMethod: DeliveryMethod;
  trackingUrl: string;
  items: { name: string; quantity: number }[];
  riderName?: string;
  riderPhone?: string;
  amountToCollect?: number;
  reason?: string;
  amount?: number;
  code?: string;
}

const firstName = (n: string) => n.trim().split(/\s+/)[0] ?? n;

/**
 * Plain-text bodies (used inside the 24h window and by the console provider)
 * and matching template parameters for Meta-approved templates. Keep the
 * template bodies registered in WhatsApp Manager in sync with docs/whatsapp-templates.md.
 */
export function buildMessage(event: NotificationEvent, c: OrderMessageContext): { text: string; template: string; params: string[] } {
  const hi = `Hello ${firstName(c.customerName)},`;
  const itemsLine = c.items.map((i) => `${i.quantity} × ${i.name}`).join(", ");
  switch (event) {
    case "order_received":
      return {
        template: "order_received",
        params: [firstName(c.customerName), c.orderNumber, formatUGX(c.total), PAYMENT_METHOD_LABELS[c.paymentMethod], c.trackingUrl],
        text: `${hi} thank you for shopping with ${c.shopName}! 🛍️\n\nWe've received order *${c.orderNumber}*:\n${itemsLine}\n\nTotal: *${formatUGX(c.total)}*\nPayment: ${PAYMENT_METHOD_LABELS[c.paymentMethod]}\nDelivery: ${DELIVERY_METHOD_LABELS[c.deliveryMethod]}\n\nTrack your order: ${c.trackingUrl}`,
      };
    case "payment_confirmed":
      return {
        template: "payment_confirmed",
        params: [firstName(c.customerName), formatUGX(c.amount ?? c.total), c.orderNumber],
        text: `${hi} we've received your payment of *${formatUGX(c.amount ?? c.total)}* for order *${c.orderNumber}*. ✅ We're preparing it now.`,
      };
    case "order_confirmed":
      return {
        template: "order_confirmed",
        params: [firstName(c.customerName), c.orderNumber, c.trackingUrl],
        text: `${hi} your order *${c.orderNumber}* is confirmed and being prepared. We'll let you know when it's on the way.\n${c.trackingUrl}`,
      };
    case "rider_dispatched": {
      const rider = c.riderName ? `${c.riderName}${c.riderPhone ? ` (${c.riderPhone})` : ""}` : "our rider";
      const cod = c.amountToCollect ? `\nPlease have *${formatUGX(c.amountToCollect)}* ready (cash or Mobile Money).` : "";
      return {
        template: "rider_dispatched",
        params: [firstName(c.customerName), c.orderNumber, rider, c.amountToCollect ? formatUGX(c.amountToCollect) : "UGX 0"],
        text: `${hi} your order *${c.orderNumber}* is on the way with ${rider}. 🏍️${cod}`,
      };
    }
    case "delivered":
      return {
        template: "order_delivered",
        params: [firstName(c.customerName), c.orderNumber],
        text: `${hi} order *${c.orderNumber}* has been delivered. Thank you for shopping with ${c.shopName}! We'd love your review: ${c.trackingUrl}`,
      };
    case "cancelled":
      return {
        template: "order_cancelled",
        params: [firstName(c.customerName), c.orderNumber, c.reason ?? "—"],
        text: `${hi} order *${c.orderNumber}* has been cancelled.${c.reason ? ` Reason: ${c.reason}.` : ""} Reply to this message if you need help.`,
      };
    case "payment_failed":
      return {
        template: "payment_failed",
        params: [firstName(c.customerName), c.orderNumber, c.trackingUrl],
        text: `${hi} we couldn't complete the Mobile Money payment for order *${c.orderNumber}*${c.reason ? ` (${c.reason})` : ""}. You can try again here: ${c.trackingUrl}`,
      };
    case "refund_sent":
      return {
        template: "refund_sent",
        params: [firstName(c.customerName), formatUGX(c.amount ?? 0), c.orderNumber],
        text: `${hi} we've refunded *${formatUGX(c.amount ?? 0)}* for order *${c.orderNumber}*.`,
      };
    case "otp":
      return {
        template: "login_code",
        params: [c.code ?? ""],
        text: `Your ${c.shopName} login code is *${c.code}*. It expires in 5 minutes. Don't share it with anyone.`,
      };
  }
}
