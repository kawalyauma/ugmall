import { describe, expect, it, vi } from "vitest";
import { mapPesaPalStatus, PesaPalProvider } from "./pesapal";

function mockFetch(responses: Record<string, unknown>) {
  const calls: { url: string; body: Record<string, unknown> | null; authorization: string | null }[] = [];
  const fn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const body = typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : null;
    calls.push({ url: String(url), body, authorization: new Headers(init?.headers).get("authorization") });
    const key = Object.keys(responses).find((candidate) => String(url).includes(candidate));
    return new Response(JSON.stringify(key ? responses[key] : {}), { status: 200 });
  });
  return { fn: fn as unknown as typeof fetch, calls };
}

const options = {
  consumerKey: "consumer-key",
  consumerSecret: "consumer-secret",
  notificationId: "notification-id",
  environment: "sandbox" as const,
};

describe("PesaPalProvider", () => {
  it("creates a hosted checkout using API 3.0", async () => {
    const { fn, calls } = mockFetch({
      RequestToken: { token: "token-1", expiryDate: new Date(Date.now() + 300_000).toISOString(), status: "200" },
      SubmitOrderRequest: { order_tracking_id: "track-1", merchant_reference: "PAY-1", redirect_url: "https://pesapal.test/pay/track-1", status: "200" },
    });
    const provider = new PesaPalProvider({ ...options, fetch: fn });
    const result = await provider.initiatePayment({
      externalReference: "PAY-1",
      orderNumber: "ORD-2026-000001",
      amount: 75_000,
      currency: "UGX",
      method: "card",
      msisdn: "256772123456",
      customerName: "John Mukasa",
      description: "Order ORD-2026-000001",
      callbackUrl: "https://shop.test/api/webhooks/payments/pesapal",
      returnUrl: "https://shop.test/orders/ORD-2026-000001?t=secret",
    });
    expect(result).toMatchObject({ status: "pending", providerReference: "track-1", redirectUrl: "https://pesapal.test/pay/track-1" });
    const submit = calls.find((call) => call.url.includes("SubmitOrderRequest"))!;
    expect(submit.authorization).toBe("Bearer token-1");
    expect(submit.body).toMatchObject({
      id: "PAY-1",
      currency: "UGX",
      amount: 75_000,
      notification_id: "notification-id",
      callback_url: "https://shop.test/orders/ORD-2026-000001?t=secret",
      billing_address: { phone_number: "0772123456", country_code: "UG", first_name: "John", last_name: "Mukasa" },
    });
  });

  it("maps and verifies a completed transaction", async () => {
    const { fn } = mockFetch({
      RequestToken: { token: "token-1", expiryDate: new Date(Date.now() + 300_000).toISOString() },
      GetTransactionStatus: {
        status_code: 1,
        payment_status_description: "Completed",
        merchant_reference: "PAY-2",
        amount: 12_500,
        confirmation_code: "CONF-2",
      },
    });
    const provider = new PesaPalProvider({ ...options, fetch: fn });
    const result = await provider.verifyPayment("PAY-2", "track-2");
    expect(result).toMatchObject({ externalReference: "PAY-2", status: "succeeded", amount: 12_500, providerReference: "track-2", financialTransactionId: "CONF-2" });
  });

  it("re-verifies IPNs and rejects a merchant-reference mismatch", async () => {
    const { fn } = mockFetch({
      RequestToken: { token: "token-1", expiryDate: new Date(Date.now() + 300_000).toISOString() },
      GetTransactionStatus: { status_code: 1, payment_status_description: "Completed", merchant_reference: "PAY-OTHER", amount: 5000 },
    });
    const provider = new PesaPalProvider({ ...options, fetch: fn });
    await expect(provider.handleWebhook({
      headers: {},
      query: {},
      body: { OrderTrackingId: "track-3", OrderMerchantReference: "PAY-3", OrderNotificationType: "IPNCHANGE" },
      rawBody: "",
    })).rejects.toThrow(/reference mismatch/);
  });

  it("maps provider statuses conservatively", () => {
    expect(mapPesaPalStatus(1, "Completed")).toBe("succeeded");
    expect(mapPesaPalStatus(2, "Failed")).toBe("failed");
    expect(mapPesaPalStatus(undefined, "Pending")).toBe("pending");
  });
});
