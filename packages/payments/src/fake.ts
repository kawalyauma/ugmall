import type { PaymentMethod } from "@ugmall/shared";
import type {
  InitiatePaymentRequest,
  InitiatePaymentResult,
  PaymentProvider,
  RefundRequest,
  RefundResult,
  VerifyPaymentResult,
  WebhookRequest,
  WebhookResult,
} from "./types";

/** Payment references look like PAY-<base36 ms timestamp>-<random>. */
export function referenceTimestamp(ref: string): number | null {
  const part = ref.split("-")[1];
  if (!part) return null;
  const n = parseInt(part, 36);
  return Number.isFinite(n) ? n : null;
}

/**
 * DEVELOPMENT ONLY. Simulates mobile money without calling anyone: a payment
 * succeeds `delayMs` after its reference was created. Stateless, so the API
 * and the worker agree. The registry refuses it when NODE_ENV=production.
 */
export class FakeMobileMoneyProvider implements PaymentProvider {
  readonly id = "fake";
  readonly displayName = "Fake Mobile Money (dev)";
  readonly methods: readonly PaymentMethod[] = ["mtn_momo", "airtel_money", "card"];
  readonly offline = false;

  constructor(private delayMs = 3000) {}

  async initiatePayment(req: InitiatePaymentRequest): Promise<InitiatePaymentResult> {
    return {
      status: "pending",
      providerReference: `FAKE-${req.externalReference}`,
      customerMessage: "[dev] Simulated Mobile Money prompt — this payment will complete by itself in a few seconds.",
    };
  }
  async verifyPayment(externalReference: string): Promise<VerifyPaymentResult> {
    const ts = referenceTimestamp(externalReference);
    if (ts === null || Date.now() - ts < this.delayMs) return { externalReference, status: "pending" };
    return { externalReference, status: "succeeded", financialTransactionId: `FT${ts}` };
  }
  async refundPayment(_req: RefundRequest): Promise<RefundResult> {
    return { status: "succeeded", providerReference: `FAKE-RF-${Date.now()}` };
  }
  async handleWebhook(req: WebhookRequest): Promise<WebhookResult> {
    const ref = req.query.ref ?? "";
    return { externalReference: ref, verified: await this.verifyPayment(ref), kind: "payment" };
  }
}
