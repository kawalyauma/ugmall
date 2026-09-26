"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Clock, Lock } from "lucide-react";
import {
  DELIVERY_METHOD_LABELS,
  PAYMENT_METHOD_LABELS,
  codAllowed,
  detectNetwork,
  formatUGX,
  isValidUgPhone,
  type DeliveryMethod,
  type PaymentMethod,
} from "@ugmall/shared";
import { api, ApiError } from "@/lib/api";
import { AreaPicker, type AreaInfo } from "@/components/area-picker";
import { useStore } from "@/components/providers";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface Quote {
  subtotal: number;
  deliveryFee: number;
  deliveryDescription: string;
  deliveryIsFinal: boolean;
  zone: { name: string; etaText: string | null } | null;
  discount: number;
  couponError: string | null;
  total: number;
}

const SAVED_KEY = "ugmall.checkout";
type OrderablePayment = Exclude<PaymentMethod, "pay_on_pickup">;

export default function CheckoutPage() {
  const router = useRouter();
  const { cart, settings, customer, refreshCart, toast } = useStore();
  const [areaInfo, setAreaInfo] = useState<AreaInfo | null>(null);
  const [hold, setHold] = useState<{ id: string; expiresAt: number } | null>(null);
  const [holdError, setHoldError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [quote, setQuote] = useState<Quote | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({
    customerName: "",
    phone: "",
    altPhone: "",
    locationId: "",
    nearbyPlace: "",
    address: "",
    deliveryMethod: "boda" as DeliveryMethod,
    paymentMethod: "mtn_momo" as OrderablePayment,
    paymentPhone: "",
    couponCode: "",
    notes: "",
  });
  const set = (k: keyof typeof f, v: string) => setF((s) => ({ ...s, [k]: v }));

  // restore last-used details (saved on this phone only)
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(SAVED_KEY) ?? "null") as Record<string, unknown> | null;
      // only restore fields this form still has (older versions saved a zone id)
      if (saved) setF((s) => ({ ...s, ...Object.fromEntries(Object.entries(saved).filter(([k, v]) => k in s && typeof v === "string")), couponCode: "", notes: "" }));
    } catch {}
  }, []);
  useEffect(() => {
    if (customer) setF((s) => ({ ...s, customerName: s.customerName || customer.name, phone: s.phone || `0${customer.phone.slice(3)}` }));
  }, [customer]);


  // hold stock while the customer fills the form
  const reserve = async () => {
    try {
      const r = await api<{ reservationId: string; expiresAt: number }>("/store/checkout/reserve", { body: { reservationId: hold?.id } });
      setHold({ id: r.reservationId, expiresAt: r.expiresAt });
      setHoldError(null);
    } catch (e) {
      setHoldError(e instanceof ApiError && e.status === 409 ? "Some items in your cart just sold out or have fewer pieces left. Please update your cart." : (e as Error).message);
    }
  };
  const reservedOnce = useRef(false);
  useEffect(() => {
    if (cart.count > 0 && !reservedOnce.current) {
      reservedOnce.current = true;
      void reserve();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cart.count]);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const secondsLeft = hold ? Math.max(0, Math.floor((hold.expiresAt - now) / 1000)) : 0;

  const zone = areaInfo?.zone ?? null;
  // Every order is delivered (no pickup stations); options come from the customer's zone.
  const methods = useMemo<DeliveryMethod[]>(() => {
    const m = (zone?.methods ?? ["boda"]).filter((x) => x !== "pickup") as DeliveryMethod[];
    return m.length ? m : ["boda"];
  }, [zone]);
  useEffect(() => {
    if (!methods.includes(f.deliveryMethod)) set("deliveryMethod", methods[0]!);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [methods]);

  // Cash on Delivery only up to the shop's limit (order total incl. delivery).
  const orderTotal = quote?.total ?? cart.subtotal;
  const codLimit = settings.codMaxOrderTotal ?? 0;
  const codOk = codAllowed(orderTotal, codLimit);
  const paymentOptions = (settings.paymentMethods as PaymentMethod[]).filter((m): m is OrderablePayment => m !== "pay_on_pickup");
  const usablePayments = paymentOptions.filter((m) => m !== "cash_on_delivery" || codOk);
  useEffect(() => {
    if (usablePayments.length && !usablePayments.includes(f.paymentMethod)) set("paymentMethod", usablePayments[0]!);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usablePayments.join()]);

  // live totals
  useEffect(() => {
    if (!cart.count || !f.locationId) return setQuote(null);
    const t = setTimeout(() => {
      api<Quote>("/store/checkout/quote", {
        body: { locationId: f.locationId ? Number(f.locationId) : null, deliveryMethod: f.deliveryMethod, couponCode: f.couponCode || null, phone: isValidUgPhone(f.phone) ? f.phone : null },
      }).then(setQuote, (e) => toast((e as Error).message));
    }, 350);
    return () => clearTimeout(t);
  }, [cart.count, cart.subtotal, f.locationId, f.deliveryMethod, f.couponCode, f.phone, toast]);

  const isMomo = f.paymentMethod === "mtn_momo" || f.paymentMethod === "airtel_money";
  const payPhone = f.paymentPhone || f.phone;
  const net = isValidUgPhone(payPhone) ? detectNetwork(payPhone) : "unknown";
  const networkWarning =
    isMomo && net !== "unknown" && ((f.paymentMethod === "mtn_momo" && net !== "mtn") || (f.paymentMethod === "airtel_money" && net !== "airtel"))
      ? `This looks like ${net === "mtn" ? "an MTN" : "an Airtel"} number.`
      : null;

  function validate() {
    const e: Record<string, string> = {};
    if (f.customerName.trim().length < 2) e.customerName = "Enter your name";
    if (!isValidUgPhone(f.phone)) e.phone = "Enter a valid phone, e.g. 0772 123 456";
    if (f.altPhone && !isValidUgPhone(f.altPhone)) e.altPhone = "Invalid phone number";
    if (!f.locationId) e.locationId = "Choose at least your district";
    if (f.address.trim().length < 2) e.address = "Tell us a landmark so the rider can find you";
    if (f.paymentMethod === "cash_on_delivery" && !codOk) e.paymentMethod = "Cash on Delivery is not available for this order amount";
    if (isMomo && f.paymentPhone && !isValidUgPhone(f.paymentPhone)) e.paymentPhone = "Invalid Mobile Money number";
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function placeOrder() {
    if (!validate()) return toast("Please check the highlighted fields");
    setBusy(true);
    try {
      const { couponCode, notes, ...toSave } = f;
      localStorage.setItem(SAVED_KEY, JSON.stringify({ ...toSave, paymentPhone: "" }));
      const r = await api<{ orderNumber: string; trackingToken: string }>("/store/checkout/place", {
        body: {
          ...f,
          reservationId: hold?.id,
          locationId: f.locationId ? Number(f.locationId) : undefined,
          address: f.address,
          couponCode,
          notes,
        },
      });
      await refreshCart();
      router.push(`/orders/${r.orderNumber}?t=${r.trackingToken}&new=1`);
    } catch (e) {
      toast((e as Error).message);
      if (e instanceof ApiError && e.status === 409) void reserve();
    } finally {
      setBusy(false);
    }
  }

  if (!cart.count) {
    return (
      <div className="container-page py-16 text-center">
        <p>Your cart is empty.</p>
        <Link href="/" className="mt-4 inline-block text-brand-700">
          Continue shopping →
        </Link>
      </div>
    );
  }

  return (
    <div className="container-page grid gap-6 py-5 md:grid-cols-[1fr_360px]">
      <div className="space-y-5">
        <h1 className="text-2xl font-bold">Checkout</h1>
        {holdError ? (
          <div className="rounded-xl bg-red-50 p-3 text-sm text-red-700">
            {holdError}{" "}
            <Link href="/cart" className="font-semibold underline">
              Review cart
            </Link>
          </div>
        ) : hold ? (
          <div className="flex items-center gap-2 rounded-xl bg-brand-50 p-3 text-sm text-brand-800">
            <Clock className="size-4" />
            {secondsLeft > 0 ? (
              <>
                Items reserved for you for {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, "0")}
              </>
            ) : (
              <button className="underline" onClick={reserve}>
                Reservation expired — tap to hold again
              </button>
            )}
          </div>
        ) : null}

        <section className="space-y-3 rounded-2xl border border-gray-200 bg-white p-4">
          <h2 className="font-semibold">Your details</h2>
          <Field label="Full name" error={errors.customerName}>
            <Input value={f.customerName} onChange={(e) => set("customerName", e.target.value)} autoComplete="name" />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Phone number" error={errors.phone} hint="We'll call/WhatsApp this number">
              <Input value={f.phone} onChange={(e) => set("phone", e.target.value)} inputMode="tel" autoComplete="tel" placeholder="07XX XXX XXX" />
            </Field>
            <Field label="Alternative phone (optional)" error={errors.altPhone}>
              <Input value={f.altPhone} onChange={(e) => set("altPhone", e.target.value)} inputMode="tel" placeholder="07XX XXX XXX" />
            </Field>
          </div>
        </section>

        <section className="space-y-3 rounded-2xl border border-gray-200 bg-white p-4">
          <h2 className="font-semibold">Delivery</h2>
          <AreaPicker
            value={f.locationId ? Number(f.locationId) : null}
            error={errors.locationId}
            onChange={(info) => {
              setAreaInfo(info);
              set("locationId", info ? String(info.id) : "");
            }}
          />
          {areaInfo && (
            <div className="rounded-xl bg-brand-50 p-3 text-sm text-brand-800">
              <div className="font-medium">{areaInfo.path}</div>
              {areaInfo.zone ? (
                <div>
                  Delivery: {areaInfo.zone.isCalculated ? "calculated by weight (bus parcel / courier)" : formatUGX(areaInfo.zone.fee ?? 0)}
                  {areaInfo.zone.etaText ? ` · ${areaInfo.zone.etaText}` : ""}
                  {areaInfo.moreSpecificMayDiffer && <span className="block text-xs text-amber-700">Choose your division and village for the exact fee.</span>}
                </div>
              ) : (
                <div className="text-amber-700">We don't deliver here yet — please chat with us on WhatsApp.</div>
              )}
            </div>
          )}
          <Field label="Nearby place or exact location (if your place isn't listed)" hint="e.g. Kisaasi, near Total petrol station">
            <Input value={f.nearbyPlace} onChange={(e) => set("nearbyPlace", e.target.value)} maxLength={200} />
          </Field>
          <Field label="Landmark / directions" error={errors.address} hint="e.g. Blue gate opposite Mukwano shop, 2nd floor">
            <Input value={f.address} onChange={(e) => set("address", e.target.value)} autoComplete="street-address" maxLength={300} />
          </Field>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {methods.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => set("deliveryMethod", m)}
                className={cn("rounded-xl border p-3 text-left text-sm", f.deliveryMethod === m ? "border-brand-700 bg-brand-50 font-semibold" : "border-gray-300 bg-white")}
              >
                {DELIVERY_METHOD_LABELS[m]}
              </button>
            ))}
          </div>
        </section>

        <section className="space-y-3 rounded-2xl border border-gray-200 bg-white p-4">
          <h2 className="font-semibold">Payment</h2>
          <div className="grid gap-2">
            {paymentOptions.map((m) => {
              const disabled = m === "cash_on_delivery" && !codOk;
              return (
              <label key={m} className={cn("flex items-center gap-3 rounded-xl border p-3", disabled ? "cursor-not-allowed border-gray-200 bg-gray-50 text-gray-400" : "cursor-pointer", f.paymentMethod === m ? "border-brand-700 bg-brand-50" : !disabled && "border-gray-300")}>
                <input type="radio" name="pm" disabled={disabled} checked={f.paymentMethod === m} onChange={() => set("paymentMethod", m)} className="accent-brand-700" />
                <span className="font-medium">
                  {PAYMENT_METHOD_LABELS[m]}
                  {m === "cash_on_delivery" && codLimit > 0 && (
                    <span className={cn("block text-xs font-normal", disabled ? "text-amber-700" : "text-gray-500")}>
                      {disabled ? `Not available for orders above ${formatUGX(codLimit)} — pay with Mobile Money` : `For orders up to ${formatUGX(codLimit)}`}
                    </span>
                  )}
                </span>
                {m === "mtn_momo" && <span className="ml-auto rounded bg-yellow-300 px-2 text-xs font-bold text-black">MTN</span>}
                {m === "airtel_money" && <span className="ml-auto rounded bg-red-600 px-2 text-xs font-bold text-white">airtel</span>}
              </label>
              );
            })}
          </div>
          {isMomo && (
            <Field label="Mobile Money number" error={errors.paymentPhone} hint={networkWarning ?? "Leave empty to use your phone number above. You'll get a prompt to enter your PIN."}>
              <Input value={f.paymentPhone} onChange={(e) => set("paymentPhone", e.target.value)} inputMode="tel" placeholder={f.phone || "07XX XXX XXX"} />
            </Field>
          )}
        </section>

        <section className="space-y-3 rounded-2xl border border-gray-200 bg-white p-4">
          <Field label="Coupon code (optional)" error={quote?.couponError ?? undefined}>
            <Input value={f.couponCode} onChange={(e) => set("couponCode", e.target.value.toUpperCase())} />
          </Field>
          <Field label="Order notes (optional)">
            <Textarea value={f.notes} onChange={(e) => set("notes", e.target.value)} placeholder="Delivery time, directions…" />
          </Field>
        </section>
      </div>

      <aside className="h-fit space-y-3 rounded-2xl border border-gray-200 bg-white p-5 md:sticky md:top-28">
        <h2 className="font-semibold">Order summary</h2>
        <div className="max-h-60 space-y-2 overflow-y-auto">
          {cart.items.map((i) => (
            <div key={i.variantId} className="flex gap-2 text-sm">
              <div className="size-12 shrink-0 overflow-hidden rounded-lg bg-gray-100">{i.imageUrl && <img src={i.imageUrl} alt="" className="size-full object-cover" />}</div>
              <div className="min-w-0 flex-1">
                <div className="truncate">{i.productName}</div>
                <div className="text-xs text-gray-500">
                  {i.variantLabel} × {i.quantity}
                </div>
              </div>
              <div className="font-medium">{formatUGX(i.lineTotal)}</div>
            </div>
          ))}
        </div>
        <dl className="space-y-1 border-t border-gray-100 pt-3 text-sm">
          <div className="flex justify-between">
            <dt>Subtotal</dt>
            <dd>{formatUGX(quote?.subtotal ?? cart.subtotal)}</dd>
          </div>
          <div className="flex justify-between">
            <dt>Delivery</dt>
            <dd>{quote ? formatUGX(quote.deliveryFee) : "—"}</dd>
          </div>
          {quote && !quote.deliveryIsFinal && <p className="text-xs text-amber-700">We'll confirm the final delivery fee by phone.</p>}
          {quote && quote.discount > 0 && (
            <div className="flex justify-between text-green-700">
              <dt>Discount</dt>
              <dd>-{formatUGX(quote.discount)}</dd>
            </div>
          )}
          <div className="flex justify-between border-t border-gray-100 pt-2 text-base font-bold">
            <dt>Total</dt>
            <dd>{formatUGX(quote?.total ?? cart.subtotal)}</dd>
          </div>
        </dl>
        <Button size="lg" className="w-full" onClick={placeOrder} loading={busy} disabled={!!holdError}>
          <Lock className="size-4" /> {isMomo ? "Pay with Mobile Money" : "Place order"}
        </Button>
        <p className="text-center text-xs text-gray-500">No account needed. We'll send updates on WhatsApp.</p>
      </aside>
    </div>
  );
}
