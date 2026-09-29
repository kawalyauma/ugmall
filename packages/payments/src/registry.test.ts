import { describe, expect, it } from "vitest";
import { createPaymentRegistryFromEnv } from "./registry";

const ssentezo = { SSENTEZO_USERNAME: "u", SSENTEZO_PASSWORD: "p", PAYMENT_CALLBACK_SECRET: "a-very-long-callback-secret" };
const pesapal = { PESAPAL_CONSUMER_KEY: "k", PESAPAL_CONSUMER_SECRET: "s", PESAPAL_IPN_ID: "ipn" };

describe("payment registry", () => {
  it("routes Mobile Money to Ssentezo and cards to PesaPal", () => {
    const r = createPaymentRegistryFromEnv({ ...ssentezo, ...pesapal } as NodeJS.ProcessEnv);
    expect(r.forMethod("mtn_momo").id).toBe("ssentezo");
    expect(r.forMethod("airtel_money").id).toBe("ssentezo");
    expect(r.forMethod("card").id).toBe("pesapal");
    expect(r.fallbackMethod("mtn_momo")).toBe("card");
    expect(r.fallbackMethod("card")).toBeNull();
  });

  it("keeps Ssentezo alone when PesaPal is not configured or turned off", () => {
    const r = createPaymentRegistryFromEnv({ ...ssentezo, ...pesapal, PAYMENT_CARD_PROVIDER: "none" } as NodeJS.ProcessEnv);
    expect(r.enabledMethods()).not.toContain("card");
    expect(r.fallbackMethod("mtn_momo")).toBeNull();
  });

  it("marks a provider degraded after repeated start failures and recovers on success", () => {
    const r = createPaymentRegistryFromEnv({ ...ssentezo, ...pesapal } as NodeJS.ProcessEnv);
    const t = 1_000_000;
    r.recordOutcome("ssentezo", false, t);
    r.recordOutcome("ssentezo", false, t + 1000);
    expect(r.health("ssentezo", t + 2000)).toBe("ok");
    r.recordOutcome("ssentezo", false, t + 2000);
    expect(r.health("ssentezo", t + 3000)).toBe("degraded");
    expect(r.onlineOptions(t + 3000).find((o) => o.method === "mtn_momo")).toMatchObject({ health: "degraded", fallbackMethod: "card" });
    // failures age out of the window
    expect(r.health("ssentezo", t + 11 * 60_000)).toBe("ok");
    r.recordOutcome("ssentezo", true, t + 4000);
    expect(r.health("ssentezo", t + 5000)).toBe("ok");
  });
});
