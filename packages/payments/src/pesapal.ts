import { toLocalUgPhone, type PaymentMethod } from "@ugmall/shared";
import {
  PaymentError,
  type InitiatePaymentRequest,
  type InitiatePaymentResult,
  type PaymentProvider,
  type ProviderPaymentStatus,
  type RefundRequest,
  type RefundResult,
  type VerifyPaymentResult,
  type WebhookRequest,
  type WebhookResult,
} from "./types";

export interface PesaPalOptions {
  consumerKey: string;
  consumerSecret: string;
  notificationId: string;
  environment: "sandbox" | "live";
  baseUrl?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export const PESAPAL_URLS = {
  live: "https://pay.pesapal.com/v3/api/",
  sandbox: "https://cybqa.pesapal.com/pesapalv3/api/",
} as const;

type PesaPalJson = Record<string, unknown> & {
  error?: { type?: string; code?: string; message?: string } | null;
  message?: string;
  status?: string | number;
};

export function mapPesaPalStatus(code: unknown, description?: unknown): ProviderPaymentStatus {
  const numeric = Number(code);
  const text = String(description ?? "").toUpperCase();
  if (numeric === 1 || text === "COMPLETED") return "succeeded";
  if (numeric === 2 || numeric === 3 || numeric === 0 || ["FAILED", "REVERSED", "INVALID"].includes(text)) return "failed";
  return "pending";
}

export class PesaPalProvider implements PaymentProvider {
  readonly id = "pesapal";
  readonly displayName = "PesaPal";
  readonly methods: readonly PaymentMethod[] = ["mtn_momo", "airtel_money", "card"];
  readonly offline = false;
  private base: string;
  private fetchFn: typeof fetch;
  private token: { value: string; expiresAt: number } | null = null;

  constructor(private opts: PesaPalOptions) {
    if (!opts.consumerKey || !opts.consumerSecret) throw new PaymentError("PesaPal credentials missing", "CONFIG");
    if (!opts.notificationId) throw new PaymentError("PesaPal IPN notification ID missing", "CONFIG");
    this.base = (opts.baseUrl ?? PESAPAL_URLS[opts.environment]).replace(/\/?$/, "/");
    this.fetchFn = opts.fetch ?? fetch;
  }

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 15_000) return this.token.value;
    const response = await this.fetchFn(`${this.base}Auth/RequestToken`, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ consumer_key: this.opts.consumerKey, consumer_secret: this.opts.consumerSecret }),
      signal: AbortSignal.timeout(this.opts.timeoutMs ?? 30_000),
    });
    const json = (await response.json()) as PesaPalJson & { token?: string; expiryDate?: string };
    if (!response.ok || !json.token) {
      throw new PaymentError("PesaPal rejected the API credentials", "CONFIG", json.error ?? json);
    }
    const parsedExpiry = json.expiryDate ? Date.parse(json.expiryDate) : NaN;
    this.token = { value: json.token, expiresAt: Number.isFinite(parsedExpiry) ? parsedExpiry : Date.now() + 4 * 60_000 };
    return json.token;
  }

  private async request(path: string, init: RequestInit = {}): Promise<PesaPalJson> {
    const token = await this.accessToken();
    const response = await this.fetchFn(`${this.base}${path}`, {
      ...init,
      headers: { Accept: "application/json", "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...init.headers },
      signal: AbortSignal.timeout(this.opts.timeoutMs ?? 30_000),
    });
    const text = await response.text();
    let json: PesaPalJson;
    try {
      json = JSON.parse(text) as PesaPalJson;
    } catch {
      throw new PaymentError(`PesaPal returned non-JSON (HTTP ${response.status})`, "PROVIDER_ERROR", text.slice(0, 500));
    }
    if (!response.ok || json.error) {
      throw new PaymentError(json.error?.message || json.message || `PesaPal request failed (HTTP ${response.status})`, "PROVIDER_ERROR", json);
    }
    return json;
  }

  async initiatePayment(req: InitiatePaymentRequest): Promise<InitiatePaymentResult> {
    if (!this.methods.includes(req.method)) throw new PaymentError(`PesaPal does not handle ${req.method}`, "NOT_SUPPORTED");
    if (!req.returnUrl) throw new PaymentError("PesaPal return URL missing", "INVALID_REQUEST");
    const names = req.customerName.trim().split(/\s+/);
    const json = await this.request("Transactions/SubmitOrderRequest", {
      method: "POST",
      body: JSON.stringify({
        id: req.externalReference,
        currency: req.currency,
        amount: req.amount,
        description: req.description.slice(0, 100),
        callback_url: req.returnUrl,
        cancellation_url: req.returnUrl,
        redirect_mode: "TOP_WINDOW",
        notification_id: this.opts.notificationId,
        branch: "UG Mall",
        billing_address: {
          email_address: req.email ?? "",
          phone_number: req.msisdn ? toLocalUgPhone(req.msisdn) : "",
          country_code: "UG",
          first_name: names[0] ?? "Customer",
          last_name: names.slice(1).join(" "),
        },
      }),
    });
    const providerReference = String(json.order_tracking_id ?? "");
    const redirectUrl = String(json.redirect_url ?? "");
    if (!providerReference || !redirectUrl) throw new PaymentError("PesaPal did not return a checkout URL", "PROVIDER_ERROR", json);
    return {
      status: "pending",
      providerReference,
      redirectUrl,
      customerMessage: "Continue to PesaPal to pay securely with Mobile Money or card.",
      raw: json,
    };
  }

  async verifyPayment(externalReference: string, providerReference?: string): Promise<VerifyPaymentResult> {
    if (!providerReference) return { externalReference, status: "pending", failureReason: "Waiting for the PesaPal checkout to start" };
    return this.verifyTrackingId(providerReference, externalReference);
  }

  private async verifyTrackingId(providerReference: string, expectedReference?: string): Promise<VerifyPaymentResult> {
    const json = await this.request(`Transactions/GetTransactionStatus?orderTrackingId=${encodeURIComponent(providerReference)}`);
    const externalReference = String(json.merchant_reference ?? expectedReference ?? "");
    if (!externalReference) throw new PaymentError("PesaPal status did not include the merchant reference", "PROVIDER_ERROR", json);
    if (expectedReference && externalReference !== expectedReference) throw new PaymentError("PesaPal merchant reference mismatch", "BAD_SIGNATURE");
    const status = mapPesaPalStatus(json.status_code, json.payment_status_description);
    return {
      externalReference,
      status,
      amount: json.amount === undefined ? undefined : Math.round(Number(json.amount)),
      providerReference,
      financialTransactionId: json.confirmation_code ? String(json.confirmation_code) : undefined,
      failureReason: status === "failed" ? String(json.description ?? json.message ?? "Payment was not completed. Please try again.") : undefined,
      raw: json,
    };
  }

  async handleWebhook(req: WebhookRequest): Promise<WebhookResult> {
    const body = req.body && typeof req.body === "object" ? (req.body as Record<string, unknown>) : {};
    const trackingId = String(body.OrderTrackingId ?? body.orderTrackingId ?? req.query.OrderTrackingId ?? req.query.orderTrackingId ?? "");
    const merchantReference = String(body.OrderMerchantReference ?? body.orderMerchantReference ?? req.query.OrderMerchantReference ?? req.query.orderMerchantReference ?? "");
    if (!trackingId || !merchantReference) throw new PaymentError("Invalid PesaPal IPN payload", "BAD_SIGNATURE");
    const verified = await this.verifyTrackingId(trackingId, merchantReference);
    return { externalReference: merchantReference, verified, kind: "payment" };
  }

  async refundPayment(req: RefundRequest): Promise<RefundResult> {
    if (!req.originalFinancialTransactionId) {
      return { status: "failed", failureReason: "The PesaPal confirmation code is missing; process this refund in the PesaPal dashboard." };
    }
    const json = await this.request("Transactions/RefundRequest", {
      method: "POST",
      body: JSON.stringify({
        confirmation_code: req.originalFinancialTransactionId,
        amount: req.amount,
        username: req.customerName || "UG Mall",
        remarks: req.reason.slice(0, 100),
      }),
    });
    const accepted = String(json.status) === "200";
    return {
      status: accepted ? "pending" : "failed",
      providerReference: req.originalFinancialTransactionId,
      failureReason: accepted ? undefined : String(json.message ?? "PesaPal rejected the refund request"),
      raw: json,
    };
  }
}
