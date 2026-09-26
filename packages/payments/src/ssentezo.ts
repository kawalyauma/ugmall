import { createHmac, timingSafeEqual } from "node:crypto";
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

/**
 * Ssentezo Wallet (https://wallet.ssentezo.com) — Ugandan collections and
 * disbursements for MTN Mobile Money and Airtel Money through one API.
 *
 *  - Auth: HTTP Basic with the wallet API username/password
 *  - Requests: POST multipart/form-data
 *  - POST {base}/deposit      collect from a customer's phone (payment)
 *  - POST {base}/withdraw     send to a phone (used for refunds)
 *  - POST {base}/get_status/{externalReference}
 *  - POST {base}/acc_balance
 *  - POST {base}/msisdn-verification
 *  - Response envelope: { response: "OK" | "ERROR", data: {...}, error: { message, code } }
 *  - transactionStatus: PENDING | SUCCEEDED | FAILED | INDETERMINATE
 *
 * Callbacks are not signed by Ssentezo, so the callback URL we register
 * carries our own HMAC over the reference, and every callback is confirmed
 * by calling get_status before anything is marked paid.
 */
export interface SsentezoOptions {
  username: string;
  password: string;
  environment: "sandbox" | "live";
  /** Secret used to sign our callback URLs. */
  callbackSecret: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export const SSENTEZO_URLS = {
  live: "https://wallet.ssentezo.com/api/",
  sandbox: "https://devwallet.ssentezo.com/api/",
} as const;

interface SsentezoEnvelope {
  response?: string;
  data?: Record<string, unknown>;
  error?: { message?: string; code?: string | number; errors?: unknown };
  message?: string;
  status?: string;
}

export function mapSsentezoStatus(s: unknown): ProviderPaymentStatus {
  switch (String(s ?? "").toUpperCase()) {
    case "SUCCEEDED":
    case "SUCCESSFUL":
    case "SUCCESS":
      return "succeeded";
    case "FAILED":
    case "REJECTED":
    case "CANCELLED":
    case "EXPIRED":
      return "failed";
    default:
      return "pending"; // PENDING, INDETERMINATE, unknown -> keep checking
  }
}

export class SsentezoWalletProvider implements PaymentProvider {
  readonly id = "ssentezo";
  readonly displayName = "Ssentezo Wallet";
  readonly methods: readonly PaymentMethod[] = ["mtn_momo", "airtel_money"];
  readonly offline = false;
  private base: string;
  private fetchFn: typeof fetch;

  constructor(private opts: SsentezoOptions) {
    if (!opts.username || !opts.password) throw new PaymentError("Ssentezo credentials missing", "CONFIG");
    if (!opts.callbackSecret || opts.callbackSecret.length < 16) {
      throw new PaymentError("Ssentezo callback secret must be at least 16 characters", "CONFIG");
    }
    this.base = (opts.baseUrl ?? SSENTEZO_URLS[opts.environment]).replace(/\/?$/, "/");
    this.fetchFn = opts.fetch ?? fetch;
  }

  /** Signature appended to our callback URLs: HMAC(ref). */
  callbackSignature(externalReference: string): string {
    return createHmac("sha256", this.opts.callbackSecret).update(`ssentezo:${externalReference}`).digest("hex");
  }

  signedCallbackUrl(baseCallbackUrl: string, externalReference: string, outcome?: "success" | "failure"): string {
    const u = new URL(baseCallbackUrl);
    u.searchParams.set("ref", externalReference);
    u.searchParams.set("sig", this.callbackSignature(externalReference));
    if (outcome) u.searchParams.set("outcome", outcome);
    return u.toString();
  }

  private async post(path: string, fields: Record<string, string | number | undefined>): Promise<SsentezoEnvelope> {
    const form = new FormData();
    for (const [k, v] of Object.entries(fields)) if (v !== undefined) form.append(k, String(v));
    const auth = Buffer.from(`${this.opts.username}:${this.opts.password}`).toString("base64");
    const res = await this.fetchFn(this.base + path, {
      method: "POST",
      headers: { Authorization: `Basic ${auth}`, Accept: "application/json" },
      body: form,
      signal: AbortSignal.timeout(this.opts.timeoutMs ?? 30_000),
    });
    const text = await res.text();
    let json: SsentezoEnvelope;
    try {
      json = JSON.parse(text) as SsentezoEnvelope;
    } catch {
      throw new PaymentError(`Ssentezo returned non-JSON (HTTP ${res.status})`, "PROVIDER_ERROR", text.slice(0, 500));
    }
    if (res.status === 401 || res.status === 403) {
      throw new PaymentError("Ssentezo rejected the API credentials", "CONFIG", json);
    }
    return json;
  }

  private errorMessage(env: SsentezoEnvelope): string | undefined {
    if (env.error?.message) return env.error.message;
    if (String(env.response ?? "").toUpperCase() === "ERROR") return env.message ?? "Ssentezo returned an error";
    return undefined;
  }

  async initiatePayment(req: InitiatePaymentRequest): Promise<InitiatePaymentResult> {
    if (!this.methods.includes(req.method)) throw new PaymentError(`Ssentezo does not handle ${req.method}`, "NOT_SUPPORTED");
    if (!req.msisdn) throw new PaymentError("A mobile money number is required", "INVALID_REQUEST");
    if (req.amount < 500) throw new PaymentError("Minimum mobile money amount is UGX 500", "INVALID_REQUEST");
    const env = await this.post("deposit", {
      msisdn: toLocalUgPhone(req.msisdn),
      amount: req.amount,
      currency: "UGX",
      reason: req.description.slice(0, 100),
      externalReference: req.externalReference,
      name: req.customerName.slice(0, 60),
      success_callback: this.signedCallbackUrl(req.callbackUrl, req.externalReference, "success"),
      failure_callback: this.signedCallbackUrl(req.callbackUrl, req.externalReference, "failure"),
    });
    const err = this.errorMessage(env);
    if (err) return { status: "failed", failureReason: err, raw: env };
    const data = env.data ?? {};
    const status = mapSsentezoStatus(data.transactionStatus ?? "PENDING");
    return {
      status,
      providerReference: (data.ssentezoWalletReference as string) || (data.request_id as string) || undefined,
      customerMessage: `We've sent a payment prompt to ${toLocalUgPhone(req.msisdn)}. Enter your Mobile Money PIN to approve UGX ${req.amount.toLocaleString("en-US")}.`,
      raw: env,
    };
  }

  async verifyPayment(externalReference: string): Promise<VerifyPaymentResult> {
    const env = await this.post(`get_status/${encodeURIComponent(externalReference)}`, {});
    const err = this.errorMessage(env);
    const data = env.data ?? {};
    if (err && !data.transactionStatus) {
      // Unknown reference / transient error: keep it pending, the poller retries.
      return { externalReference, status: "pending", failureReason: err, raw: env };
    }
    return {
      externalReference,
      status: mapSsentezoStatus(data.transactionStatus ?? data.status),
      amount: data.amount !== undefined ? Math.round(Number(data.amount)) : undefined,
      providerReference: (data.ssentezoWalletReference as string) || undefined,
      financialTransactionId: (data.financialTransactionId as string) || (data.network_ref as string) || undefined,
      failureReason: (data.reason as string) && mapSsentezoStatus(data.transactionStatus) === "failed" ? String(data.reason) : undefined,
      raw: env,
    };
  }

  async refundPayment(req: RefundRequest): Promise<RefundResult> {
    if (!req.msisdn) throw new PaymentError("Refund needs the customer's mobile money number", "INVALID_REQUEST");
    const env = await this.post("withdraw", {
      msisdn: toLocalUgPhone(req.msisdn),
      amount: req.amount,
      currency: "UGX",
      reason: `Refund: ${req.reason}`.slice(0, 100),
      externalReference: req.externalReference,
      name: req.customerName?.slice(0, 60) ?? "",
      success_callback: this.signedCallbackUrl(req.callbackUrl, req.externalReference, "success"),
      failure_callback: this.signedCallbackUrl(req.callbackUrl, req.externalReference, "failure"),
    });
    const err = this.errorMessage(env);
    if (err) return { status: "failed", failureReason: err, raw: env };
    const data = env.data ?? {};
    return {
      status: mapSsentezoStatus(data.transactionStatus ?? "PENDING"),
      providerReference: (data.ssentezoWalletReference as string) || undefined,
      raw: env,
    };
  }

  async handleWebhook(req: WebhookRequest): Promise<WebhookResult> {
    const ref = req.query.ref;
    const sig = req.query.sig;
    if (!ref || !sig) throw new PaymentError("Missing callback reference", "BAD_SIGNATURE");
    const expected = Buffer.from(this.callbackSignature(ref));
    const given = Buffer.from(sig);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
      throw new PaymentError("Invalid callback signature", "BAD_SIGNATURE");
    }
    // Never trust the callback body; ask Ssentezo for the authoritative status.
    const verified = await this.verifyPayment(ref);
    return { externalReference: ref, verified, kind: ref.startsWith("RF-") ? "refund" : "payment" };
  }

  async checkBalance(): Promise<{ amount: number; currency: string } | null> {
    const env = await this.post("acc_balance", { username: this.opts.username, password: this.opts.password, currency: "UGX" });
    if (!env.data) return null;
    return { amount: Number(env.data.amount ?? 0), currency: String(env.data.currency ?? "UGX") };
  }

  /** Returns the registered names on a mobile money number (useful before refunds). */
  async verifyMsisdn(msisdn: string): Promise<{ firstName?: string; lastName?: string } | null> {
    const env = await this.post("msisdn-verification", { msisdn: toLocalUgPhone(msisdn) });
    if (!env.data) return null;
    return { firstName: env.data.FirstName as string | undefined, lastName: env.data.Surname as string | undefined };
  }
}
