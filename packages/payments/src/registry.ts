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
}

export function createPaymentRegistryFromEnv(env: NodeJS.ProcessEnv = process.env): PaymentRegistry {
  const registry = new PaymentRegistry();
  registry.register(new CashOnDeliveryProvider());
  // No pickup stations: "Pay on Pickup" is not offered, but the provider stays
  // registered (with no methods) so refunds of old pickup orders still work.
  registry.register(new PayOnPickupProvider(), []);

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
  if (mobile === "pesapal") {
    if (env.PESAPAL_CONSUMER_KEY && env.PESAPAL_CONSUMER_SECRET && env.PESAPAL_IPN_ID) {
      const pesapal = new PesaPalProvider({
        consumerKey: env.PESAPAL_CONSUMER_KEY,
        consumerSecret: env.PESAPAL_CONSUMER_SECRET,
        notificationId: env.PESAPAL_IPN_ID,
        environment: env.PESAPAL_ENV === "live" ? "live" : "sandbox",
        baseUrl: env.PESAPAL_BASE_URL || undefined,
      });
      // PesaPal presents Mobile Money and card choices together on its hosted
      // checkout, so expose one clear customer-facing option instead of three.
      registry.register(pesapal, ["card"]);
    } else if (env.NODE_ENV === "production") {
      console.warn("[payments] PESAPAL_CONSUMER_KEY/SECRET/IPN_ID not set — online payment is disabled");
    }
  }
  if (mobile === "fake" || (env.PAYMENTS_FAKE === "true" && !registry.enabledMethods().includes("mtn_momo"))) {
    if (env.NODE_ENV === "production") throw new PaymentError("The fake payment provider cannot run in production", "CONFIG");
    registry.register(new FakeMobileMoneyProvider(Number(env.PAYMENTS_FAKE_DELAY_MS ?? 3000)), ["mtn_momo", "airtel_money"]);
  }
  // Card: Ssentezo's public API covers mobile money; plug a card-capable
  // provider (Flutterwave/Pesapal) in here when one is contracted.
  return registry;
}
