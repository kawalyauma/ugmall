import type { PaymentMethod } from "@ugmall/shared";
import {
  PaymentError,
  type InitiatePaymentRequest,
  type InitiatePaymentResult,
  type PaymentProvider,
  type RefundRequest,
  type RefundResult,
  type VerifyPaymentResult,
  type WebhookResult,
} from "./types";

/**
 * Cash on Delivery / Pay on Pickup. Nothing is collected online; the payment
 * stays "pending" until a rider or cashier records the cash (or MoMo to the
 * shop line) in the admin/rider app.
 */
abstract class OfflineProvider implements PaymentProvider {
  abstract readonly id: string;
  abstract readonly displayName: string;
  abstract readonly methods: readonly PaymentMethod[];
  readonly offline = true;
  protected abstract message: string;

  async initiatePayment(_req: InitiatePaymentRequest): Promise<InitiatePaymentResult> {
    return { status: "pending", customerMessage: this.message };
  }
  async verifyPayment(externalReference: string): Promise<VerifyPaymentResult> {
    return { externalReference, status: "pending" };
  }
  async refundPayment(_req: RefundRequest): Promise<RefundResult> {
    // Cash refunds are handed over in person and recorded by staff.
    return { status: "succeeded" };
  }
  async handleWebhook(): Promise<WebhookResult> {
    throw new PaymentError(`${this.displayName} has no webhooks`, "NOT_SUPPORTED");
  }
}

export class CashOnDeliveryProvider extends OfflineProvider {
  readonly id = "cash_on_delivery";
  readonly displayName = "Cash on Delivery";
  readonly methods: readonly PaymentMethod[] = ["cash_on_delivery"];
  protected message = "Pay the rider in cash or Mobile Money when your order arrives.";
}

export class PayOnPickupProvider extends OfflineProvider {
  readonly id = "pay_on_pickup";
  readonly displayName = "Pay on Pickup";
  readonly methods: readonly PaymentMethod[] = ["pay_on_pickup"];
  protected message = "Pay at the shop when you pick up your order.";
}
