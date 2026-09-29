import type { PaymentMethod } from "@ugmall/shared";
import { FakeMobileMoneyProvider } from "./fake";
import { CashOnDeliveryProvider, PayOnPickupProvider } from "./offline";
import { SsentezoWalletProvider } from "./ssentezo";
import { PesaPalProvider } from "./pesapal";
import { PaymentError, type PaymentProvider } from "./types";

/**
 * Maps payment methods to providers. Business code asks the registry for "the
 * provider for mtn_momo" and never imports a specific company's SDK, so
 * switching to Flutterwave/Pesapal/MTN direct later is a config change plus
 * one new class implementing PaymentProvider.
 */
export class PaymentRegistry {
  private byId = new Map<string, PaymentProvider>();
  private byMethod = new Map<PaymentMethod, PaymentProvider>();

  register(provider: PaymentProvider, methods: readonly PaymentMethod[] = provider.methods) {
    this.byId.set(provider.id, provider);
    for (const m of methods) {
      if (!provider.methods.includes(m)) throw new PaymentError(`${provider.id} cannot handle ${m}`, "CONFIG");
      this.byMethod.set(m, provider);
    }
    return this;
  }

  forMethod(method: PaymentMethod): PaymentProvider {
    const p = this.byMethod.get(method);
    if (!p) throw new PaymentError(`Payment method ${method} is not enabled`, "NOT_SUPPORTED");
    return p;
  }

  byProviderId(id: string): PaymentProvider {
    const p = this.byId.get(id);
    if (!p) throw new PaymentError(`Unknown payment provider ${id}`, "NOT_SUPPORTED");
    return p;
  }

  enabledMethods(): PaymentMethod[] {
    return [...this.byMethod.keys()];
  }

  providers(): PaymentProvider[] {
    return [...this.byId.values()];
  }

  /**
   * The method a customer can switch to when their chosen online method's
   * provider is down (e.g. Ssentezo unreachable -> pay by card/MoMo on
   * PesaPal's hosted page). Null when no different provider can take over.
   */
  fallbackMethod(method: PaymentMethod): PaymentMethod | null {
    const primary = this.byMethod.get(method);
    const fallback = this.byMethod.get("card");
    if (!fallback || !primary || fallback === primary || primary.offline) return null;
    return "card";
  }

  /* ------------------------------------------------------------ health */

  private outcomes = new Map<string, { failures: number[]; lastSuccess: number }>();

  /** Record whether a call to start a payment reached the provider. */
  recordOutcome(providerId: string, ok: boolean, now = Date.now()) {
    const h = this.outcomes.get(providerId) ?? { failures: [], lastSuccess: 0 };
    if (ok) {
      h.failures = [];
      h.lastSuccess = now;
    } else {
      h.failures = [...h.failures.filter((t) => now - t < HEALTH_WINDOW_MS), now];
    }
    this.outcomes.set(providerId, h);
  }

  /**
   * "degraded" after HEALTH_FAILURES consecutive start-payment errors inside
   * HEALTH_WINDOW_MS, so the storefront can steer customers to the fallback
   * instead of letting them wait for a prompt that will never arrive.
   */
  health(providerId: string, now = Date.now()): "ok" | "degraded" {
    const h = this.outcomes.get(providerId);
    if (!h) return "ok";
    const recent = h.failures.filter((t) => now - t < HEALTH_WINDOW_MS);
    return recent.length >= HEALTH_FAILURES ? "degraded" : "ok";
  }

  /** Enabled online methods with who handles them and whether that provider is healthy. */
  onlineOptions(now = Date.now()) {
    return this.enabledMethods()
      .filter((m) => !this.byMethod.get(m)!.offline)
      .map((method) => {
        const p = this.byMethod.get(method)!;
        return { method, provider: p.id, providerName: p.displayName, health: this.health(p.id, now), fallbackMethod: this.fallbackMethod(method) };
      });
  }
}

const HEALTH_WINDOW_MS = 10 * 60_000;
const HEALTH_FAILURES = 3;

export function createPaymentRegistryFromEnv(env: NodeJS.ProcessEnv = process.env): PaymentRegistry {
  const registry = new PaymentRegistry();
  registry.register(new CashOnDeliveryProvider());
  // No pickup stations: "Pay on Pickup" is not offered, but the provider stays
  // registered (with no methods) so refunds of old pickup orders still work.
  registry.register(new PayOnPickupProvider(), []);

  // Mobile Money (MTN + Airtel) goes through Ssentezo: the customer gets a PIN
  // prompt on their phone without leaving the shop.
  const mobile = (env.PAYMENT_MOBILE_MONEY_PROVIDER ?? "ssentezo").toLowerCase();
  if (mobile === "ssentezo") {
    if (env.SSENTEZO_USERNAME && env.SSENTEZO_PASSWORD) {
      registry.register(
        new SsentezoWalletProvider({
          username: env.SSENTEZO_USERNAME,
          password: env.SSENTEZO_PASSWORD,
          environment: env.SSENTEZO_ENV === "live" ? "live" : "sandbox",
          callbackSecret: env.PAYMENT_CALLBACK_SECRET ?? "",
          baseUrl: env.SSENTEZO_BASE_URL || undefined,
        }),
      );
    } else if (env.NODE_ENV === "production") {
      console.warn("[payments] SSENTEZO_USERNAME/PASSWORD not set — mobile money is disabled");
    }
  }

  // Cards (Visa/Mastercard) go through PesaPal's hosted checkout. It also
  // accepts Mobile Money, so it doubles as the fallback when Ssentezo is down.
  const card = (env.PAYMENT_CARD_PROVIDER ?? "pesapal").toLowerCase();
  if (card === "pesapal" || mobile === "pesapal") {
    if (env.PESAPAL_CONSUMER_KEY && env.PESAPAL_CONSUMER_SECRET && env.PESAPAL_IPN_ID) {
      const pesapal = new PesaPalProvider({
        consumerKey: env.PESAPAL_CONSUMER_KEY,
        consumerSecret: env.PESAPAL_CONSUMER_SECRET,
        notificationId: env.PESAPAL_IPN_ID,
        environment: env.PESAPAL_ENV === "live" ? "live" : "sandbox",
        baseUrl: env.PESAPAL_BASE_URL || undefined,
      });
      // Only "card" is mapped: PesaPal shows its own Mobile Money and card
      // choices on the hosted page, so one customer-facing option is enough.
      registry.register(pesapal, ["card"]);
    } else if (env.NODE_ENV === "production") {
      console.warn("[payments] PESAPAL_CONSUMER_KEY/SECRET/IPN_ID not set — card payments are disabled");
    }
  }

  if (mobile === "fake" || (env.PAYMENTS_FAKE === "true" && !registry.enabledMethods().includes("mtn_momo"))) {
    if (env.NODE_ENV === "production") throw new PaymentError("The fake payment provider cannot run in production", "CONFIG");
    const fake = new FakeMobileMoneyProvider(Number(env.PAYMENTS_FAKE_DELAY_MS ?? 3000));
    registry.register(fake, registry.enabledMethods().includes("card") ? ["mtn_momo", "airtel_money"] : ["mtn_momo", "airtel_money", "card"]);
  }
  return registry;
}
