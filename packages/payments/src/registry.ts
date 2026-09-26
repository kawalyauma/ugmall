import type { PaymentMethod } from "@ugmall/shared";
import { FakeMobileMoneyProvider } from "./fake";
import { CashOnDeliveryProvider, PayOnPickupProvider } from "./offline";
import { SsentezoWalletProvider } from "./ssentezo";
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
  registry.register(new PayOnPickupProvider());

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
  if (mobile === "fake" || (env.PAYMENTS_FAKE === "true" && !registry.enabledMethods().includes("mtn_momo"))) {
    if (env.NODE_ENV === "production") throw new PaymentError("The fake payment provider cannot run in production", "CONFIG");
    registry.register(new FakeMobileMoneyProvider(Number(env.PAYMENTS_FAKE_DELAY_MS ?? 3000)), ["mtn_momo", "airtel_money"]);
  }
  // Card: Ssentezo's public API covers mobile money; plug a card-capable
  // provider (Flutterwave/Pesapal) in here when one is contracted.
  return registry;
}
