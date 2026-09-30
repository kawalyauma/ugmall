import { and, desc, eq, inArray, or } from "drizzle-orm";
import {
  agentActions,
  orderItems,
  orders,
  returns as returnRecords,
  staffUsers,
  type Database,
} from "@ugmall/database";
import type { SupportHubWebhookEvent, WhatsAppProvider } from "@ugmall/notifications";
import type { OrderService } from "@ugmall/orders";
import type { StorageProvider } from "@ugmall/storage";
import { canTransition, formatUGX, normalizeUgPhone, ORDER_STATUS_LABELS } from "@ugmall/shared";
import { executeAgentAction } from "./agent-workforce";
import { audit } from "./audit";

const MENU_BUTTONS = [
  { id: "ug:orders", title: "My orders" },
  { id: "ug:returns", title: "Returns" },
  { id: "ug:human", title: "Talk to support" },
];

const compact = (value: string | null | undefined) => String(value ?? "").trim();
const customerCanCancel = (status: string) => status === "pending" || status === "awaiting_payment";

/**
 * Deterministic WhatsApp customer-care agent. It may expose customer-owned
 * order data and create reversible requests, but irreversible business
 * changes stay with staff or the governed agent approval flow.
 */
export class WhatsAppCareAgent {
  constructor(
    private db: Database,
    private ordersService: OrderService,
    private storage: StorageProvider,
    private whatsapp: WhatsAppProvider,
    private opts: { getAdminPhone: () => Promise<string | undefined>; adminUrl: string; shopName: string },
  ) {}

  async handle(event: SupportHubWebhookEvent) {
    const phone = normalizeUgPhone(event.conversation.phoneNumber);
    if (!phone) return;
    const messageKey = event.message?.id ?? `${event.event}:${event.conversation.id}:${event.timestamp ?? ""}`;
    const interactiveId = compact(event.message?.interactive?.id);

    const adminPhone = await this.opts.getAdminPhone();
    if (adminPhone && phone === adminPhone && interactiveId.startsWith("ug:")) {
      await this.handleAdminAction(adminPhone, interactiveId, messageKey);
      return;
    }

    if (event.event === "conversation.started") {
      await this.menu(phone, messageKey);
      return;
    }
    if (event.event !== "message.received") return;

    if (interactiveId === "ug:orders") return this.showOrders(phone, messageKey);
    if (interactiveId === "ug:returns") return this.showReturnOptions(phone, messageKey);
    if (interactiveId === "ug:human") return this.escalate(phone, event, "Customer requested a human agent", messageKey);
    if (interactiveId.startsWith("ug:track:")) return this.showOneOrder(phone, interactiveId.slice(9), messageKey);
    if (interactiveId.startsWith("ug:cancel:")) return this.cancelOrder(phone, interactiveId.slice(10), messageKey);
    if (interactiveId.startsWith("ug:return:")) return this.requestReturn(phone, interactiveId.slice(10), messageKey);

    const text = compact(event.message?.content);
    const lower = text.toLowerCase();
    const orderNumber = text.match(/UG-\d{4}-\d+/i)?.[0]?.toUpperCase();
    if (orderNumber) return this.showOneOrder(phone, orderNumber, messageKey);
    if (/\b(track|status|where.*order|my order|orders)\b/i.test(lower)) return this.showOrders(phone, messageKey);
    if (/\b(return|exchange|refund)\b/i.test(lower)) return this.showReturnOptions(phone, messageKey);
    if (/\b(cancel|stop order)\b/i.test(lower)) return this.showCancelableOrder(phone, messageKey);
    if (/^(hi|hello|hey|menu|help)\b/i.test(lower)) return this.menu(phone, messageKey);
    return this.escalate(phone, event, text || "Customer sent a non-text support request", messageKey);
  }

  private sendText(phone: string, body: string, key: string) {
    return this.whatsapp.sendText(phone, body, { idempotencyKey: `ugmall:care:${key}` });
  }

  private async sendButtons(phone: string, body: string, buttons: { id: string; title: string }[], key: string) {
    if (this.whatsapp.sendButtons) return this.whatsapp.sendButtons(phone, body, buttons.slice(0, 3), { idempotencyKey: `ugmall:care:${key}` });
    return this.sendText(phone, `${body}\n\n${buttons.map((b) => `• ${b.title}`).join("\n")}`, key);
  }

  private menu(phone: string, key: string) {
    return this.sendButtons(phone, `Hello 👋 I’m the ${this.opts.shopName} customer-care assistant. I can track and manage orders, start a return, or connect you to support.`, MENU_BUTTONS, key);
  }

  private async customerOrders(phone: string) {
    return this.db.select().from(orders).where(or(eq(orders.phone, phone), eq(orders.altPhone, phone))).orderBy(desc(orders.createdAt)).limit(5);
  }

  private async showOrders(phone: string, key: string) {
    const rows = await this.customerOrders(phone);
    if (!rows.length) return this.sendButtons(phone, "I couldn’t find an order on this WhatsApp number. Send your order number (for example UG-2026-123) or choose support.", [{ id: "ug:human", title: "Talk to support" }], key);
    const latest = rows[0]!;
    return this.orderCard(phone, latest, key);
  }

  private async showOneOrder(phone: string, idOrNumber: string, key: string) {
    const identity = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(idOrNumber)
      ? eq(orders.id, idOrNumber)
      : eq(orders.orderNumber, idOrNumber.toUpperCase());
    const [order] = await this.db.select().from(orders).where(and(or(eq(orders.phone, phone), eq(orders.altPhone, phone)), identity));
    if (!order) return this.sendText(phone, "I couldn’t find that order under this WhatsApp number. Please check the number or ask for support.", key);
    return this.orderCard(phone, order, key);
  }

  private async orderCard(phone: string, order: typeof orders.$inferSelect, key: string) {
    const buttons: { id: string; title: string }[] = [{ id: `ug:track:${order.id}`, title: "Refresh status" }];
    if (customerCanCancel(order.status)) buttons.push({ id: `ug:cancel:${order.id}`, title: "Cancel order" });
    if (order.status === "delivered") buttons.push({ id: `ug:return:${order.id}`, title: "Request return" });
    const balance = Math.max(0, order.total - order.amountPaid);
    return this.sendButtons(phone, [
      `*${order.orderNumber}* — ${ORDER_STATUS_LABELS[order.status]}`,
      `Total: ${formatUGX(order.total)}`,
      `Paid: ${formatUGX(order.amountPaid)}`,
      balance ? `Balance: ${formatUGX(balance)}` : null,
      `Delivery: ${order.area}, ${order.district}`,
    ].filter(Boolean).join("\n"), buttons, key);
  }

  private async showCancelableOrder(phone: string, key: string) {
    const rows = await this.customerOrders(phone);
    const order = rows.find((row) => customerCanCancel(row.status));
    if (!order) return this.sendText(phone, "I couldn’t find an order that can still be cancelled. I can connect you to support if the order is already in delivery.", key);
    return this.sendButtons(phone, `Cancel *${order.orderNumber}*? This cannot be undone.`, [{ id: `ug:cancel:${order.id}`, title: "Cancel order" }, { id: "ug:human", title: "Keep & get help" }], key);
  }

  private async cancelOrder(phone: string, orderId: string, key: string) {
    const [order] = await this.db.select().from(orders).where(and(eq(orders.id, orderId), or(eq(orders.phone, phone), eq(orders.altPhone, phone))));
    if (!order) return this.sendText(phone, "That order was not found on this WhatsApp number.", key);
    if (!customerCanCancel(order.status) || !canTransition(order.status, "cancelled")) return this.sendText(phone, `Order ${order.orderNumber} can no longer be cancelled automatically. I’ve left it unchanged; please ask for support.`, key);
    await this.ordersService.transition(order.id, "cancelled", { type: "customer", id: order.customerId ?? undefined }, "Cancelled by customer through WhatsApp");
    return this.sendText(phone, `Order *${order.orderNumber}* has been cancelled. If you already paid, our team will review the refund.`, key);
  }

  private async showReturnOptions(phone: string, key: string) {
    const rows = await this.customerOrders(phone);
    const delivered = rows.find((row) => row.status === "delivered");
    if (!delivered) return this.sendText(phone, "Returns can be requested for delivered orders. I couldn’t find an eligible delivered order on this number, so I’ve left everything unchanged.", key);
    return this.sendButtons(phone, `Start a return request for *${delivered.orderNumber}*? Our team will review it before anything is refunded.`, [{ id: `ug:return:${delivered.id}`, title: "Request return" }, { id: "ug:human", title: "Ask a question" }], key);
  }

  private async requestReturn(phone: string, orderId: string, key: string) {
    const [order] = await this.db.select().from(orders).where(and(eq(orders.id, orderId), or(eq(orders.phone, phone), eq(orders.altPhone, phone))));
    if (!order || order.status !== "delivered") return this.sendText(phone, "That order is not eligible for an automatic return request. No changes were made.", key);
    const existing = await this.db.select().from(returnRecords).where(and(eq(returnRecords.orderId, order.id), inArray(returnRecords.status, ["requested", "approved", "received"])));
    if (existing.length) return this.sendText(phone, `A return for *${order.orderNumber}* is already being handled.`, key);
    const items = await this.db.select().from(orderItems).where(eq(orderItems.orderId, order.id));
    const eligible = items.filter((item) => item.quantity > item.returnedQuantity).map((item) => ({ orderItemId: item.id, quantity: item.quantity - item.returnedQuantity, condition: "resellable" as const }));
    if (!eligible.length) return this.sendText(phone, "There are no remaining items eligible for return on that order.", key);
    const ret = await this.ordersService.createReturn(order.id, { reason: "Customer requested a return through WhatsApp; item condition requires inspection", items: eligible });
    await this.sendText(phone, `Return request received for *${order.orderNumber}*. Reference: ${ret.id.slice(0, 8)}. Our team will review it; no refund has been issued yet.`, key);
    const adminPhone = await this.opts.getAdminPhone();
    if (adminPhone) {
      await this.sendButtons(adminPhone, `↩️ Return approval needed\nOrder: *${order.orderNumber}*\nCustomer: ${order.customerName}\nReason: WhatsApp return request\n${this.opts.adminUrl.replace(/\/$/, "")}/returns`, [
        { id: `ug:return-approve:${ret.id}`, title: "Approve" },
        { id: `ug:return-reject:${ret.id}`, title: "Reject" },
      ], `return:${ret.id}`);
    }
  }

  private async escalate(phone: string, event: SupportHubWebhookEvent, issue: string, key: string) {
    await this.sendText(phone, "Thanks—I’ve passed this to our customer-care team with your chat context. You can continue writing here, and an agent will reply in the same conversation.", key);
    const adminPhone = await this.opts.getAdminPhone();
    if (adminPhone) {
      await this.whatsapp.sendText(adminPhone, `💬 Customer support needs attention\n${event.conversation.displayName || phone} · ${phone}\n${issue.slice(0, 600)}\n\nOpen the WhatsApp Support Console to reply.`, { idempotencyKey: `ugmall:escalation:${key}` });
    }
  }

  private async adminStaff(adminPhone: string) {
    const staff = await this.db.select().from(staffUsers).where(eq(staffUsers.isActive, true));
    return staff.find((user) => normalizeUgPhone(user.phone ?? "") === adminPhone);
  }

  private async handleAdminAction(adminPhone: string, id: string, key: string) {
    const staff = await this.adminStaff(adminPhone);
    if (!staff) {
      await this.sendText(adminPhone, "This WhatsApp number is not linked to an active UG Mall administrator, so nothing was changed.", key);
      return;
    }
    const [scope, verb, entityId] = id.split(":");
    if (scope !== "ug" || !entityId) return;
    if (verb === "approve" || verb === "reject") {
      const [action] = await this.db.select().from(agentActions).where(eq(agentActions.id, entityId));
      if (!action || action.status !== "awaiting_approval") return this.sendText(adminPhone, "That proposal has already been handled or no longer exists.", key);
      if (verb === "approve") {
        const done = await executeAgentAction(this.db, this.storage, action.id, staff.id);
        await audit(this.db, staff.id, "agent.action.execute.whatsapp", "agent_action", action.id, { actionType: action.actionType, runId: action.runId });
        return this.sendText(adminPhone, `✅ Approved and executed: ${done.title}`, key);
      }
      const [rejected] = await this.db.update(agentActions).set({ status: "rejected", approvedBy: staff.id, approvedAt: new Date(), error: "Rejected by administrator in WhatsApp" }).where(and(eq(agentActions.id, action.id), eq(agentActions.status, "awaiting_approval"))).returning();
      if (rejected) await audit(this.db, staff.id, "agent.action.reject.whatsapp", "agent_action", action.id, { runId: action.runId });
      return this.sendText(adminPhone, `❌ Rejected: ${action.title}`, key);
    }
    if (verb === "return-approve" || verb === "return-reject") {
      const [ret] = await this.db.update(returnRecords).set({ status: verb === "return-approve" ? "approved" : "rejected", handledBy: staff.id, staffNotes: `${verb === "return-approve" ? "Approved" : "Rejected"} by ${staff.name} in WhatsApp` }).where(and(eq(returnRecords.id, entityId), eq(returnRecords.status, "requested"))).returning();
      if (!ret) return this.sendText(adminPhone, "That return has already been handled or no longer exists.", key);
      await audit(this.db, staff.id, `return.${verb === "return-approve" ? "approve" : "reject"}.whatsapp`, "return", ret.id);
      const [order] = await this.db.select().from(orders).where(eq(orders.id, ret.orderId));
      if (order) await this.sendText(order.phone, `Your return request for *${order.orderNumber}* was ${verb === "return-approve" ? "approved. Our team will contact you about collection/inspection." : "not approved. Reply here if you need a detailed review."}`, `return-decision:${ret.id}`);
      return this.sendText(adminPhone, `${verb === "return-approve" ? "✅ Return approved" : "❌ Return rejected"}${order ? ` for ${order.orderNumber}` : ""}.`, key);
    }
  }
}
