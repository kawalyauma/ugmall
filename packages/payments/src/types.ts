import type { PaymentMethod } from "@ugmall/shared";

export type ProviderPaymentStatus = "pending" | "succeeded" | "failed";

export interface InitiatePaymentRequest {
  /** Our unique reference; providers must treat it as an idempotency key. */
  externalReference: string;
  orderNumber: string;
  amount: number; // UGX
  currency: "UGX";
  method: PaymentMethod;
  /** Payer phone (2567XXXXXXXX) for mobile money. */
  msisdn?: string;
  customerName: string;
  email?: string;
  description: string;
  /** Where the provider should POST status notifications. */
  callbackUrl: string;
  /** Where to send the customer back to (card/hosted checkouts). */
  returnUrl?: string;
}

export interface InitiatePaymentResult {
  status: ProviderPaymentStatus;
  providerReference?: string;
  /** For hosted checkouts (card), redirect the customer here. */
  redirectUrl?: string;
  /** Text to show the customer, e.g. "Approve the prompt on your phone". */
  customerMessage?: string;
  failureReason?: string;
  raw?: unknown;
}

export interface VerifyPaymentResult {
  externalReference: string;
  status: ProviderPaymentStatus;
  amount?: number;
  providerReference?: string;
  financialTransactionId?: string;
  failureReason?: string;
  raw?: unknown;
}

export interface RefundRequest {
  externalReference: string; // new unique reference for the refund
  originalExternalReference: string;
  amount: number;
  msisdn?: string;
  customerName?: string;
  reason: string;
  callbackUrl: string;
}

export interface RefundResult {
  status: ProviderPaymentStatus;
  providerReference?: string;
  failureReason?: string;
  raw?: unknown;
}

export interface WebhookRequest {
  headers: Record<string, string | undefined>;
  query: Record<string, string | undefined>;
  body: unknown;
  rawBody: string;
}

export interface WebhookResult {
  /** Which payment the webhook is about. */
  externalReference: string;
  /** Authoritative status — providers must verify with the provider API, never trust the body alone. */
  verified: VerifyPaymentResult;
  kind: "payment" | "refund";
}

export interface PaymentProvider {
  readonly id: string;
  readonly displayName: string;
  readonly methods: readonly PaymentMethod[];
  /** Offline providers (COD, pickup) are settled manually by staff/riders. */
  readonly offline: boolean;
  initiatePayment(req: InitiatePaymentRequest): Promise<InitiatePaymentResult>;
  verifyPayment(externalReference: string): Promise<VerifyPaymentResult>;
  refundPayment(req: RefundRequest): Promise<RefundResult>;
  handleWebhook(req: WebhookRequest): Promise<WebhookResult>;
}

export class PaymentError extends Error {
  constructor(
    message: string,
    public code: "CONFIG" | "INVALID_REQUEST" | "PROVIDER_ERROR" | "BAD_SIGNATURE" | "NOT_SUPPORTED",
    public details?: unknown,
  ) {
    super(message);
  }
}
