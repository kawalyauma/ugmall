import { describe, expect, it, vi } from "vitest";
import { SsentezoWalletProvider, mapSsentezoStatus } from "./ssentezo";
import { PaymentRegistry } from "./registry";
import { CashOnDeliveryProvider } from "./offline";

function mockFetch(responses: Record<string, unknown>) {
  const calls: { url: string; fields: Record<string, string>; auth: string | null }[] = [];
  const fn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    const fields: Record<string, string> = {};
    (init?.body as FormData | undefined)?.forEach((v, k) => (fields[k] = String(v)));
    calls.push({ url: u, fields, auth: new Headers(init?.headers).get("authorization") });
    const key = Object.keys(responses).find((k) => u.includes(k));
    return new Response(JSON.stringify(key ? responses[key] : {}), { status: 200 });
  });
  return { fn: fn as unknown as typeof fetch, calls };
}

const base = { username: "api-user", password: "api-pass", environment: "sandbox" as const, callbackSecret: "a-very-long-callback-secret" };

describe("SsentezoWalletProvider", () => {
  it("initiates a deposit with international msisdn, basic auth and signed callbacks", async () => {
    const { fn, calls } = mockFetch({
      deposit: { response: "OK", data: { externalReference: "PAY-1", transactionStatus: "PENDING", ssentezoWalletReference: "SW123" } },
    });
    const p = new SsentezoWalletProvider({ ...base, fetch: fn });
    const res = await p.initiatePayment({
      externalReference: "PAY-1",
      orderNumber: "ORD-2026-000001",
      amount: 118000,
      currency: "UGX",
      method: "mtn_momo",
      msisdn: "256772123456",
      customerName: "John Mukasa",
      description: "Order ORD-2026-000001",
      callbackUrl: "https://shop.example.ug/api/webhooks/payments/ssentezo",
    });
    expect(res.status).toBe("pending");
    expect(res.providerReference).toBe("SW123");
    const call = calls[0]!;
    expect(call.url).toBe("https://devwallet.ssentezo.com/api/deposit");
    expect(call.auth).toBe(`Basic ${Buffer.from("api-user:api-pass").toString("base64")}`);
    expect(call.fields.msisdn).toBe("256772123456");
    expect(call.fields.amount).toBe("118000");
    expect(call.fields.currency).toBe("UGX");
    const cb = new URL(call.fields.success_callback!);
    expect(cb.searchParams.get("ref")).toBe("PAY-1");
    expect(cb.searchParams.get("sig")).toBe(p.callbackSignature("PAY-1"));
  });

  it("returns failed when Ssentezo responds with an error envelope", async () => {
    const { fn } = mockFetch({ deposit: { response: "ERROR", error: { message: "Insufficient balance", code: "E1" } } });
    const p = new SsentezoWalletProvider({ ...base, fetch: fn });
    const res = await p.initiatePayment({
      externalReference: "PAY-2", orderNumber: "X", amount: 1000, currency: "UGX", method: "airtel_money",
      msisdn: "0701234567", customerName: "A", description: "d", callbackUrl: "https://x.ug/cb",
    });
    expect(res.status).toBe("failed");
    expect(res.failureReason).toBe("Insufficient balance");
  });

  it("verifies webhooks by signature and then by get_status", async () => {
    const { fn, calls } = mockFetch({
      "get_status/PAY-3": { response: "OK", data: { transactionStatus: "SUCCEEDED", amount: "5000", financialTransactionId: "FT99" } },
    });
    const p = new SsentezoWalletProvider({ ...base, fetch: fn });
    await expect(p.handleWebhook({ headers: {}, query: { ref: "PAY-3", sig: "bad" }, body: {}, rawBody: "" })).rejects.toThrow(/signature/);
    const res = await p.handleWebhook({
      headers: {},
      query: { ref: "PAY-3", sig: p.callbackSignature("PAY-3") },
      body: { status: "SUCCEEDED" },
      rawBody: "",
    });
    expect(res.verified.status).toBe("succeeded");
    expect(res.verified.amount).toBe(5000);
    expect(res.verified.financialTransactionId).toBe("FT99");
    expect(calls.at(-1)!.url).toBe("https://devwallet.ssentezo.com/api/get_status/PAY-3");
  });

  it("does not present the merchant description as a decline reason", async () => {
    const { fn } = mockFetch({
      "get_status/PAY-4": { response: "OK", data: { transactionStatus: "FAILED", reason: "Order ORD-2026-000001", amount: 5000 } },
    });
    const p = new SsentezoWalletProvider({ ...base, fetch: fn });
    const result = await p.verifyPayment("PAY-4");
    expect(result.status).toBe("failed");
    expect(result.failureReason).toBe("Mobile Money payment was declined or not completed. Please try again.");
  });

  it("maps statuses conservatively", () => {
    expect(mapSsentezoStatus("SUCCEEDED")).toBe("succeeded");
    expect(mapSsentezoStatus("FAILED")).toBe("failed");
    expect(mapSsentezoStatus("INDETERMINATE")).toBe("pending");
    expect(mapSsentezoStatus(undefined)).toBe("pending");
  });
});

describe("PaymentRegistry", () => {
  it("routes methods to providers and rejects disabled methods", () => {
    const r = new PaymentRegistry().register(new CashOnDeliveryProvider());
    expect(r.forMethod("cash_on_delivery").id).toBe("cash_on_delivery");
    expect(() => r.forMethod("card")).toThrow(/not enabled/);
  });
});
