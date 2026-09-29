"use client";

import { use, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  Clock,
  CreditCard,
  ExternalLink,
  Loader2,
  Lock,
  MessageCircle,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  XCircle,
} from "lucide-react";
import { DELIVERY_METHOD_LABELS, detectNetwork, formatUGX, isValidUgPhone, whatsappLink, type DeliveryMethod, type OrderStatus, type PaymentMethod } from "@ugmall/shared";
import { api } from "@/lib/api";
import type { PaymentOption } from "@/lib/types";
import { useStore } from "@/components/providers";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AirtelBadge, CardBrands, MtnBadge, PesaPalBadge } from "@/components/payment-brands";
import { cn } from "@/lib/utils";

interface PaymentAttempt {
  id: string;
  provider: string;
  method: PaymentMethod;
  status: string;
  amount: number;
  failureReason: string | null;
  msisdn: string | null;
  checkoutUrl: string | null;
  createdAt: string;
}

interface PayOrder {
  orderNumber: string;
  status: OrderStatus;
  statusLabel: string;
  paymentMethod: PaymentMethod;
  deliveryMethod: DeliveryMethod;
  customerName: string;
  phone: string;
  area: string;
  district: string;
  locationPath: string | null;
  subtotal: number;
  deliveryFee: number;
  discount: number;
  total: number;
  amountPaid: number;
  expiresAt: string | null;
  canCancel: boolean;
  latestPayment: PaymentAttempt | null;
  paymentOptions: PaymentOption[];
  items: { id: string; productName: string; variantLabel: string | null; imageUrl: string | null; unitPrice: number; quantity: number; lineTotal: number }[];
}

type Tab = "momo" | "card";
type MomoMethod = "mtn_momo" | "airtel_money";
const MOMO: MomoMethod[] = ["mtn_momo", "airtel_money"];
const isMomo = (m: PaymentMethod): m is MomoMethod => (MOMO as PaymentMethod[]).includes(m);

export default function PayPage({ params }: { params: Promise<{ orderNumber: string }> }) {
  const { orderNumber } = use(params);
  const sp = useSearchParams();
  const t = sp.get("t") ?? "";
  const returned = sp.get("return") === "1";
  const { settings, toast } = useStore();
  const [order, setOrder] = useState<PayOrder | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("momo");
  const [network, setNetwork] = useState<MomoMethod>("mtn_momo");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [changingNumber, setChangingNumber] = useState(false);
  const [now, setNow] = useState(Date.now());
  const initialised = useRef(false);

  const load = useCallback(async () => {
    try {
      const o = await api<PayOrder>(`/store/orders/${orderNumber}?t=${encodeURIComponent(t)}`);
      setOrder(o);
      if (!initialised.current) {
        // Open on the method the customer picked at checkout.
        initialised.current = true;
        const momoOk = o.paymentOptions.some((p) => isMomo(p.method));
        setTab(o.paymentMethod === "card" || !momoOk ? "card" : "momo");
        if (isMomo(o.paymentMethod)) setNetwork(o.paymentMethod);
        setPhone(o.latestPayment?.msisdn ?? o.phone);
      }
    } catch (e) {
      setError((e as Error).message);
    }
  }, [orderNumber, t]);

  useEffect(() => {
    void load();
  }, [load]);

  // Poll the lightweight status endpoint; reload the full order when anything moves.
  const waiting = order?.status === "awaiting_payment";
  const sig = order ? `${order.status}|${order.latestPayment?.id}|${order.latestPayment?.status}|${order.latestPayment?.failureReason}` : "";
  useEffect(() => {
    if (!waiting) return;
    const iv = setInterval(async () => {
      const s = await api<{ status: OrderStatus; latestPayment: PaymentAttempt | null }>(`/store/orders/${orderNumber}/status?t=${encodeURIComponent(t)}`).catch(() => null);
      if (!s) return;
      const next = `${s.status}|${s.latestPayment?.id}|${s.latestPayment?.status}|${s.latestPayment?.failureReason}`;
      if (next !== sig) void load();
    }, 4000);
    return () => clearInterval(iv);
  }, [waiting, sig, orderNumber, t, load]);

  useEffect(() => {
    if (!waiting) return;
    const iv = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(iv);
  }, [waiting]);

  async function startPayment(method: PaymentMethod, msisdn?: string) {
    setBusy(true);
    try {
      const r = await api<{ ok: boolean; message?: string; redirectUrl?: string; providerUnavailable?: boolean }>(`/store/orders/${orderNumber}/retry-payment`, {
        body: { t, method, msisdn: msisdn || undefined },
      });
      if (r.providerUnavailable) toast(r.message ?? "That payment service is not responding. Try the other option.");
      else if (!r.redirectUrl && r.message) toast(r.message);
      await load();
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    if (!confirm("Cancel this order?")) return;
    await api(`/store/orders/${orderNumber}/cancel`, { body: { t } }).then(load, (e) => toast((e as Error).message));
  }

  if (error) {
    return (
      <div className="container-page max-w-md py-16 text-center">
        <XCircle className="mx-auto size-10 text-gray-300" />
        <p className="mt-3 text-gray-600">{error}</p>
        <Link href="/track" className="mt-4 inline-block text-sm font-semibold text-brand-700">Find my order →</Link>
      </div>
    );
  }
  if (!order) {
    return (
      <div className="container-page grid max-w-md place-items-center py-24 text-gray-400">
        <Loader2 className="size-8 animate-spin" />
        <p className="mt-3 text-sm">Loading secure payment…</p>
      </div>
    );
  }

  const trackHref = `/orders/${order.orderNumber}?t=${encodeURIComponent(t)}`;
  const due = Math.max(0, order.total - order.amountPaid);
  const help = whatsappLink(settings.whatsappNumber, `Hello, I need help paying for order ${order.orderNumber}`);

  if (order.status === "cancelled") {
    return (
      <Shell>
        <div className="rounded-3xl border border-gray-200 bg-white p-8 text-center shadow-sm">
          <Clock className="mx-auto size-12 text-gray-400" />
          <h1 className="mt-4 text-2xl font-black">This order was cancelled</h1>
          <p className="mt-2 text-sm text-gray-600">The payment window closed before we received payment, so no money was taken. Your items are back in stock — you can order them again.</p>
          <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
            <Link href="/cart" className="inline-flex h-11 items-center justify-center rounded-xl bg-brand-700 px-5 text-sm font-semibold text-white">Back to shopping</Link>
            <a href={help} target="_blank" rel="noreferrer" className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-gray-300 px-5 text-sm font-semibold">
              <MessageCircle className="size-4" /> Talk to us
            </a>
          </div>
        </div>
      </Shell>
    );
  }

  if (order.status !== "awaiting_payment") {
    return (
      <Shell>
        <div className="overflow-hidden rounded-3xl border border-green-200 bg-white text-center shadow-sm">
          <div className="bg-gradient-to-br from-green-500 to-emerald-600 px-6 py-10 text-white">
            <div className="mx-auto grid size-20 place-items-center rounded-full bg-white/20 ring-8 ring-white/10">
              <CheckCircle2 className="size-12" />
            </div>
            <h1 className="mt-5 text-3xl font-black tracking-tight">Payment received</h1>
            <p className="mt-1 text-white/90">Thank you, {order.customerName.split(" ")[0]}! {formatUGX(order.amountPaid || order.total)} paid for order {order.orderNumber}.</p>
          </div>
          <div className="space-y-4 p-6">
            <p className="text-sm text-gray-600">We're preparing your order now and will keep you posted on WhatsApp.</p>
            <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
              <Link href={trackHref} className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-brand-700 px-6 font-semibold text-white">
                Track my order <ArrowRight className="size-4" />
              </Link>
              <Link href="/" className="inline-flex h-12 items-center justify-center rounded-xl border border-gray-300 px-6 font-semibold">Continue shopping</Link>
            </div>
          </div>
        </div>
      </Shell>
    );
  }

  const options = order.paymentOptions;
  const momoOptions = options.filter((o) => isMomo(o.method));
  const cardOption = options.find((o) => o.method === "card") ?? null;
  const momoDegraded = momoOptions.length > 0 && momoOptions.every((o) => o.health === "degraded");
  const latest = order.latestPayment;
  const latestIsMomo = !!latest && isMomo(latest.method) && latest.provider !== "pesapal";
  const latestIsCard = !!latest && latest.method === "card";
  const momoUnavailable = latestIsMomo && latest!.status === "pending" && !!latest!.failureReason;
  const momoWaiting = latestIsMomo && latest!.status === "pending" && !latest!.failureReason;
  const momoFailed = latestIsMomo && latest!.status === "failed";
  const cardFailed = latestIsCard && latest!.status === "failed";
  const cardUnavailable = latestIsCard && latest!.status === "pending" && !!latest!.failureReason && !latest!.checkoutUrl;
  const checkoutUrl = latestIsCard && latest!.status === "pending" ? latest!.checkoutUrl : null;
  const secondsLeft = order.expiresAt ? Math.max(0, Math.floor((new Date(order.expiresAt).getTime() - now) / 1000)) : null;
  const net = isValidUgPhone(phone) ? detectNetwork(phone) : "unknown";
  const netWarning = net !== "unknown" && ((network === "mtn_momo" && net !== "mtn") || (network === "airtel_money" && net !== "airtel")) ? `This looks like ${net === "mtn" ? "an MTN" : "an Airtel"} number.` : null;
  const showFallback = !!cardOption && (momoUnavailable || momoDegraded || momoFailed);

  return (
    <Shell>
      {/* Secure header */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <div className="inline-flex items-center gap-2 font-semibold text-brand-800">
          <span className="grid size-7 place-items-center rounded-full bg-brand-100"><Lock className="size-3.5" /></span>
          Secure payment
        </div>
        {secondsLeft !== null && (
          <div className={cn("inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold tabular-nums", secondsLeft < 300 ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-800")}>
            <Clock className="size-3.5" /> Pay within {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, "0")}
          </div>
        )}
      </div>

      <div className="mt-3 grid gap-5 lg:grid-cols-[1fr_340px]">
        <div className="space-y-4">
          {/* Amount */}
          <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-brand-800 via-brand-700 to-brand-600 p-5 text-white shadow-lg md:p-6">
            <div className="absolute -right-10 -top-10 size-40 rounded-full bg-white/10" />
            <div className="absolute -bottom-16 right-16 size-32 rounded-full bg-white/5" />
            <div className="relative">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-white/70">Amount to pay</div>
              <div className="mt-1 text-4xl font-black tracking-tight md:text-5xl">{formatUGX(due)}</div>
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-white/85">
                <span>Order <b className="text-white">{order.orderNumber}</b></span>
                <span>{order.items.reduce((s, i) => s + i.quantity, 0)} item(s)</span>
                <span>{settings.shopName}</span>
              </div>
            </div>
          </div>

          {returned && (latestIsCard ? latest!.status === "pending" : false) && (
            <div className="flex items-center gap-3 rounded-2xl border border-brand-100 bg-brand-50 p-4 text-sm text-brand-800">
              <Loader2 className="size-5 shrink-0 animate-spin" />
              <span>Welcome back! We're confirming your payment with PesaPal — this usually takes a few seconds.</span>
            </div>
          )}

          {/* Method switcher */}
          {momoOptions.length > 0 && cardOption && (
            <div className="grid grid-cols-2 gap-2 rounded-2xl bg-gray-100 p-1.5">
              <TabButton active={tab === "momo"} onClick={() => setTab("momo")} icon={Smartphone} title="Mobile Money" sub={<span className="flex gap-1"><MtnBadge className="h-5 text-[10px]" /><AirtelBadge className="h-5 text-[10px]" /></span>} />
              <TabButton active={tab === "card"} onClick={() => setTab("card")} icon={CreditCard} title="Card" sub={<CardBrands className="scale-90" />} />
            </div>
          )}

          {tab === "momo" && momoOptions.length > 0 ? (
            <section className="space-y-4 rounded-3xl border border-gray-200 bg-white p-5 shadow-sm">
              {showFallback && (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
                  <div className="flex items-start gap-3">
                    <AlertTriangle className="mt-0.5 size-5 shrink-0 text-amber-600" />
                    <div className="flex-1">
                      <div className="font-semibold text-amber-900">
                        {momoFailed ? "Mobile Money payment didn't go through" : "Mobile Money is not responding right now"}
                      </div>
                      <p className="mt-0.5 text-sm text-amber-800">
                        {momoFailed && latest?.failureReason ? `${latest.failureReason} ` : ""}
                        Pay securely with PesaPal instead — use a Visa/Mastercard card, or Mobile Money on PesaPal's page.
                      </p>
                      <Button className="mt-3 w-full sm:w-auto" loading={busy} onClick={() => { setTab("card"); void startPayment("card"); }}>
                        <PesaPalBadge className="h-5" /> Pay with PesaPal instead
                      </Button>
                    </div>
                  </div>
                </div>
              )}

              {momoWaiting && !changingNumber ? (
                <MomoWaiting attempt={latest!} network={latest!.method as MomoMethod} onResend={() => startPayment(latest!.method, phone)} onChangeNumber={() => setChangingNumber(true)} busy={busy} />
              ) : (
                <>
                  <div>
                    <div className="mb-2 text-sm font-semibold">Choose your network</div>
                    <div className="grid grid-cols-2 gap-2">
                      {momoOptions.map((o) => (
                        <button
                          key={o.method}
                          type="button"
                          onClick={() => setNetwork(o.method as MomoMethod)}
                          className={cn(
                            "flex items-center justify-between rounded-xl border p-3 text-left transition",
                            network === o.method ? "border-brand-700 bg-brand-50 ring-1 ring-brand-700" : "border-gray-300 hover:border-brand-500",
                          )}
                        >
                          {o.method === "mtn_momo" ? <MtnBadge /> : <AirtelBadge />}
                          <span className={cn("size-4 rounded-full border-2", network === o.method ? "border-brand-700 bg-brand-700 shadow-[inset_0_0_0_2px_white]" : "border-gray-300")} />
                        </button>
                      ))}
                    </div>
                  </div>
                  <label className="block">
                    <span className="mb-1 block text-sm font-semibold">Mobile Money number</span>
                    <Input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" autoComplete="tel" placeholder="07XX XXX XXX" className="h-12 text-lg tracking-wide" />
                    <span className={cn("mt-1 block text-xs", netWarning ? "text-amber-700" : "text-gray-500")}>{netWarning ?? "You'll get a prompt on this phone. Enter your PIN to approve."}</span>
                  </label>
                  <Button size="lg" className="w-full" loading={busy} disabled={!isValidUgPhone(phone)} onClick={() => startPayment(network, phone).then(() => setChangingNumber(false))}>
                    <Smartphone className="size-5" /> {momoFailed || momoUnavailable ? "Try again" : "Send payment prompt"} · {formatUGX(due)}
                  </Button>
                </>
              )}
              <p className="flex items-center justify-center gap-1.5 text-xs text-gray-500">
                <ShieldCheck className="size-3.5" /> Mobile Money processed by Ssentezo · We never see your PIN
              </p>
            </section>
          ) : cardOption ? (
            <section className="space-y-4 rounded-3xl border border-gray-200 bg-white p-5 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-lg font-bold">Pay by card</h2>
                  <p className="text-sm text-gray-500">Visa and Mastercard, or Mobile Money on PesaPal.</p>
                </div>
                <CardBrands />
              </div>

              {checkoutUrl ? (
                <div className="overflow-hidden rounded-2xl border border-gray-200">
                  <div className="flex items-center justify-between gap-2 border-b border-gray-100 bg-gray-50 px-3 py-2 text-xs text-gray-600">
                    <span className="inline-flex items-center gap-1.5"><Lock className="size-3.5 text-green-600" /> Secured by <PesaPalBadge className="h-5" /></span>
                    <a href={checkoutUrl} className="inline-flex items-center gap-1 font-semibold text-brand-700">Open full page <ExternalLink className="size-3.5" /></a>
                  </div>
                  <iframe src={checkoutUrl} title="PesaPal secure checkout" className="block h-[640px] w-full bg-white" allow="payment" />
                </div>
              ) : cardUnavailable || cardFailed ? (
                <div className="space-y-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
                  <div className="flex items-start gap-2">
                    <XCircle className="mt-0.5 size-5 shrink-0" />
                    <span>{latest?.failureReason ?? "The card payment was not completed."}</span>
                  </div>
                  <Button loading={busy} onClick={() => startPayment("card")} className="w-full">
                    <RefreshCw className="size-4" /> Try again
                  </Button>
                </div>
              ) : latestIsCard && latest!.status === "pending" ? (
                <div className="flex items-center gap-3 rounded-2xl bg-gray-50 p-4 text-sm text-gray-700">
                  <Loader2 className="size-5 animate-spin text-brand-700" /> Processing your payment…
                </div>
              ) : (
                <>
                  <ul className="space-y-2 text-sm text-gray-700">
                    {["Enter your card details on PesaPal's secure page — right here, without leaving the shop.", "Your card may ask for a one-time code (3-D Secure) from your bank.", "This page confirms your order automatically once you've paid."].map((x) => (
                      <li key={x} className="flex gap-2"><CheckCircle2 className="mt-0.5 size-4 shrink-0 text-brand-700" /> {x}</li>
                    ))}
                  </ul>
                  <Button size="lg" className="w-full" loading={busy} onClick={() => startPayment("card")}>
                    <Lock className="size-4" /> Pay {formatUGX(due)} securely
                  </Button>
                </>
              )}
              <div className="grid grid-cols-3 gap-2 border-t border-gray-100 pt-4 text-center text-[11px] text-gray-500">
                <div><ShieldCheck className="mx-auto mb-1 size-4 text-brand-700" />PCI-DSS certified processor</div>
                <div><Lock className="mx-auto mb-1 size-4 text-brand-700" />Encrypted end to end</div>
                <div><CreditCard className="mx-auto mb-1 size-4 text-brand-700" />We never store your card</div>
              </div>
            </section>
          ) : (
            <section className="rounded-3xl border border-gray-200 bg-white p-5 text-sm text-gray-600">
              Online payment is not available right now. Please contact us on WhatsApp to complete your order.
            </section>
          )}

          <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-sm">
            <a href={help} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 font-semibold text-green-700"><MessageCircle className="size-4" /> Need help? WhatsApp us</a>
            <Link href={trackHref} className="text-gray-600 underline-offset-2 hover:underline">View order details</Link>
            {order.canCancel && <button onClick={cancel} className="text-gray-500 underline-offset-2 hover:underline">Cancel order</button>}
          </div>
        </div>

        {/* Summary */}
        <aside className="h-fit rounded-3xl border border-gray-200 bg-white p-5 shadow-sm lg:sticky lg:top-28">
          <button className="flex w-full items-center justify-between lg:pointer-events-none" onClick={() => setSummaryOpen((v) => !v)}>
            <h2 className="font-bold">Order summary</h2>
            <span className="inline-flex items-center gap-1 text-sm font-semibold lg:hidden">
              {formatUGX(order.total)} <ChevronDown className={cn("size-4 transition", summaryOpen && "rotate-180")} />
            </span>
          </button>
          <div className={cn("mt-3 space-y-3", !summaryOpen && "hidden lg:block")}>
            <div className="max-h-64 space-y-2 overflow-y-auto">
              {order.items.map((i) => (
                <div key={i.id} className="flex gap-3 text-sm">
                  <div className="relative size-12 shrink-0 overflow-hidden rounded-lg bg-gray-100">
                    {i.imageUrl && <img src={i.imageUrl} alt="" className="size-full object-cover" />}
                    <span className="absolute -right-0 -top-0 grid size-5 place-items-center rounded-bl-lg bg-gray-900 text-[10px] font-bold text-white">{i.quantity}</span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="line-clamp-2">{i.productName}</div>
                    {i.variantLabel && <div className="text-xs text-gray-500">{i.variantLabel}</div>}
                  </div>
                  <div className="font-medium">{formatUGX(i.lineTotal)}</div>
                </div>
              ))}
            </div>
            <dl className="space-y-1 border-t border-gray-100 pt-3 text-sm">
              <Row label="Subtotal" value={formatUGX(order.subtotal)} />
              <Row label={`Delivery (${DELIVERY_METHOD_LABELS[order.deliveryMethod]})`} value={formatUGX(order.deliveryFee)} />
              {order.discount > 0 && <Row label="Discount" value={`-${formatUGX(order.discount)}`} className="text-green-700" />}
              {order.amountPaid > 0 && <Row label="Already paid" value={`-${formatUGX(order.amountPaid)}`} className="text-green-700" />}
              <Row label="To pay" value={formatUGX(due)} className="border-t border-gray-100 pt-2 text-base font-bold" />
            </dl>
            <div className="rounded-xl bg-gray-50 p-3 text-xs text-gray-600">
              Delivering to <b className="text-gray-800">{order.locationPath ?? `${order.area}, ${order.district}`}</b> for {order.customerName} · {order.phone}
            </div>
          </div>
        </aside>
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="container-page max-w-5xl py-5 md:py-8">{children}</div>;
}

function Row({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className={cn("flex justify-between gap-3", className)}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function TabButton({ active, onClick, icon: Icon, title, sub }: { active: boolean; onClick: () => void; icon: typeof Smartphone; title: string; sub: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn("flex flex-col items-center gap-1 rounded-xl px-2 py-2.5 text-sm font-bold transition", active ? "bg-white text-gray-900 shadow" : "text-gray-500 hover:text-gray-800")}
    >
      <span className="inline-flex items-center gap-1.5"><Icon className="size-4" /> {title}</span>
      {sub}
    </button>
  );
}

/** Live "approve on your phone" status for a Mobile Money prompt. */
function MomoWaiting({ attempt, network, onResend, onChangeNumber, busy }: { attempt: PaymentAttempt; network: MomoMethod; onResend: () => void; onChangeNumber: () => void; busy: boolean }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const started = new Date(attempt.createdAt).getTime();
    const tick = () => setElapsed(Math.max(0, Math.floor((Date.now() - started) / 1000)));
    tick();
    const iv = setInterval(tick, 1000);
    return () => clearInterval(iv);
  }, [attempt.createdAt]);
  const steps = [
    { t: "Prompt sent", d: `to ${attempt.msisdn ?? "your phone"}` },
    { t: "Enter your PIN", d: `on your ${network === "mtn_momo" ? "MTN" : "Airtel"} phone` },
    { t: "Payment confirmed", d: "this page updates by itself" },
  ];
  return (
    <div className="space-y-5">
      <div className="flex flex-col items-center py-2 text-center">
        <div className="relative grid size-20 place-items-center">
          <span className="absolute inset-0 animate-ping rounded-full bg-brand-500/20" />
          <span className="relative grid size-16 place-items-center rounded-full bg-brand-700 text-white shadow-lg">
            <Smartphone className="size-8" />
          </span>
        </div>
        <h2 className="mt-4 text-xl font-black">Check your phone</h2>
        <p className="mt-1 max-w-sm text-sm text-gray-600">
          Approve <b>{formatUGX(attempt.amount)}</b> by entering your {network === "mtn_momo" ? "MTN MoMo" : "Airtel Money"} PIN on {attempt.msisdn ?? "your phone"}.
        </p>
      </div>
      <ol className="space-y-3">
        {steps.map((s, i) => (
          <li key={s.t} className="flex items-center gap-3">
            <span className={cn("grid size-7 shrink-0 place-items-center rounded-full text-xs font-bold", i === 0 ? "bg-brand-700 text-white" : i === 1 ? "bg-brand-100 text-brand-800 ring-2 ring-brand-500" : "bg-gray-100 text-gray-400")}>
              {i === 0 ? <CheckCircle2 className="size-4" /> : i === 1 ? <Loader2 className="size-4 animate-spin" /> : 3}
            </span>
            <div className="text-sm">
              <div className={cn("font-semibold", i === 2 && "text-gray-400")}>{s.t}</div>
              <div className="text-xs text-gray-500">{s.d}</div>
            </div>
          </li>
        ))}
      </ol>
      <div className="rounded-2xl bg-gray-50 p-3 text-xs text-gray-600">
        No prompt? Dial <b>{network === "mtn_momo" ? "*165#" : "*185#"}</b> → My approvals, or resend it{elapsed < 30 ? ` in ${30 - elapsed}s` : ""}.
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Button variant="secondary" loading={busy} disabled={elapsed < 30} onClick={onResend}>
          <RefreshCw className="size-4" /> Resend
        </Button>
        <Button variant="ghost" onClick={onChangeNumber}>Change number</Button>
      </div>
    </div>
  );
}
