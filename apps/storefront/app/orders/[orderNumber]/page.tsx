"use client";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CheckCircle2, Circle, MessageCircle, Phone, Smartphone, Star } from "lucide-react";
import { DELIVERY_METHOD_LABELS, PAYMENT_METHOD_LABELS, TRACKING_STEPS, ORDER_STATUS_LABELS, formatUGX, whatsappLink, type OrderStatus, type PaymentMethod, type DeliveryMethod } from "@ugmall/shared";
import { api } from "@/lib/api";
import { useStore } from "@/components/providers";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { trackCommerceEvent } from "@/components/analytics";
import { PesaPalFrame } from "@/components/pesapal-frame";

interface Tracked {
  orderNumber: string;
  status: OrderStatus;
  statusLabel: string;
  paymentStatus: string;
  paymentMethod: PaymentMethod;
  deliveryMethod: DeliveryMethod;
  customerName: string;
  phone: string;
  district: string;
  area: string;
  address: string;
  locationPath: string | null;
  nearbyPlace: string | null;
  subtotal: number;
  deliveryFee: number;
  discount: number;
  total: number;
  amountPaid: number;
  expiresAt: string | null;
  canRetryPayment: boolean;
  canCancel: boolean;
  canReview?: boolean;
  latestPayment: { provider: string; status: string; failureReason: string | null; msisdn: string | null } | null;
  items: { id: string; productId: string; productSlug?: string | null; productName: string; variantLabel: string | null; imageUrl: string | null; unitPrice: number; quantity: number; lineTotal: number }[];
  history: { status: OrderStatus; label: string; at: string }[];
  delivery: { status: string; riderName: string | null; riderPhone: string | null; carrierName: string | null; trackingNumber: string | null } | null;
}

export default function OrderPage({ params }: { params: Promise<{ orderNumber: string }> }) {
  const { orderNumber } = use(params);
  const sp = useSearchParams();
  const t = sp.get("t") ?? "";
  const isNew = sp.get("new") === "1";
  const { settings, toast, customer } = useStore();
  const [order, setOrder] = useState<Tracked | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retryPhone, setRetryPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [cardPaymentUrl, setCardPaymentUrl] = useState<string | null>(null);

  const purchaseEventSent = useState(false);
  const purchaseSent = purchaseEventSent[0];
  const setPurchaseSent = purchaseEventSent[1];

  const load = useCallback(async () => {
    try {
      setOrder(await api<Tracked>(`/store/orders/${orderNumber}?t=${encodeURIComponent(t)}`));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [orderNumber, t]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!order || !isNew || purchaseSent || order.status === "cancelled") return;
    const qualifies = order.paymentStatus === "succeeded" || order.paymentMethod === "cash_on_delivery";
    if (!qualifies) return;
    const key = `ugmall.purchase.${order.orderNumber}`;
    if (sessionStorage.getItem(key)) {
      setPurchaseSent(true);
      return;
    }
    const eventId = `purchase:${order.orderNumber}`;
    trackCommerceEvent("purchase", {
      event_id: eventId,
      transaction_id: order.orderNumber,
      currency: "UGX",
      value: order.total,
      items: order.items.map((i) => ({ item_id: i.productId, item_name: i.productName, price: i.unitPrice, quantity: i.quantity })),
    });
    sessionStorage.setItem(key, "1");
    setPurchaseSent(true);
    void api(`/store/orders/${order.orderNumber}/meta-purchase`, { body: { t, eventId } }).catch(() => null);
  }, [order, isNew, purchaseSent, t]);

  // Poll while waiting for the customer to approve the Mobile Money prompt.
  useEffect(() => {
    if (order?.status !== "awaiting_payment") return;
    const iv = setInterval(async () => {
      const s = await api<{ status: OrderStatus; latestPayment: { status: string } | null }>(`/store/orders/${orderNumber}/status?t=${encodeURIComponent(t)}`).catch(() => null);
      if (s && (s.status !== order.status || s.latestPayment?.status !== order.latestPayment?.status)) void load();
    }, 4000);
    return () => clearInterval(iv);
  }, [order, orderNumber, t, load]);

  async function retry() {
    setBusy(true);
    try {
      const r = await api<{ message?: string; redirectUrl?: string }>(`/store/orders/${orderNumber}/retry-payment`, { body: { t, msisdn: retryPhone || undefined } });
      if (r.redirectUrl) {
        setCardPaymentUrl(r.redirectUrl);
        return;
      }
      toast(r.message ?? "Payment started");
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

  if (error) return <div className="container-page py-16 text-center text-gray-600">{error}</div>;
  if (!order) return <div className="container-page py-16 text-center text-gray-400">Loading…</div>;

  const cancelled = order.status === "cancelled";
  const isPesaPal = order.latestPayment?.provider === "pesapal";
  const stepIdx = Math.max(
    0,
    TRACKING_STEPS.findIndex((s) => s === order.status) >= 0
      ? TRACKING_STEPS.indexOf(order.status)
      : order.status === "paid" || order.status === "awaiting_payment"
        ? 0
        : order.status === "assigned_to_rider"
          ? 3
          : TRACKING_STEPS.length - 1,
  );
  const help = whatsappLink(settings.whatsappNumber, `Hello, I need help with order ${order.orderNumber}`);

  return (
    <>
    {cardPaymentUrl && <PesaPalFrame src={cardPaymentUrl} onClose={() => setCardPaymentUrl(null)} onReturn={() => { setCardPaymentUrl(null); void load(); }} />}
    <div className="container-page max-w-2xl space-y-4 py-5">
      {isNew && order.status !== "awaiting_payment" && !cancelled && (
        <div className="rounded-2xl bg-green-50 p-4 text-green-800">
          <div className="text-lg font-bold">Thank you, {order.customerName.split(" ")[0]}! 🎉</div>
          <p className="text-sm">Your order has been received. We'll confirm on WhatsApp shortly.</p>
        </div>
      )}

      {isNew && !customer && (
        <div className="rounded-2xl border border-brand-200 bg-brand-50 p-4 text-brand-900">
          <div className="font-bold">This order is saved on this browser</div>
          <p className="mt-1 text-sm">No account was needed. Secure it with your WhatsApp number only if you want to see it again on another phone or browser.</p>
          <Link href={`/account?next=${encodeURIComponent(`/orders/${order.orderNumber}`)}`} className="mt-3 inline-flex rounded-xl bg-brand-700 px-4 py-2 text-sm font-bold text-white">Secure my orders with WhatsApp</Link>
        </div>
      )}

      {order.status === "awaiting_payment" && (
        <div className="space-y-3 rounded-2xl border-2 border-amber-300 bg-amber-50 p-4">
          <div className="flex items-center gap-2 text-lg font-bold">
            <Smartphone className="size-5" /> {isPesaPal ? "Complete your secure payment" : "Approve payment on your phone"}
          </div>
          {order.latestPayment?.status === "failed" ? (
            <p className="text-sm text-red-700">Payment failed{order.latestPayment.failureReason ? `: ${order.latestPayment.failureReason}` : ""}. Try again below.</p>
          ) : isPesaPal ? (
            <p className="text-sm">Pay <b>{formatUGX(order.total - order.amountPaid)}</b> securely by card through PesaPal. This page updates automatically after payment.</p>
          ) : (
            <p className="text-sm">
              We sent {order.paymentMethod === "mtn_momo" ? "an" : "a"} {PAYMENT_METHOD_LABELS[order.paymentMethod]} prompt for <b>{formatUGX(order.total - order.amountPaid)}</b> to <b>{order.latestPayment?.msisdn ?? order.phone}</b>. Enter your PIN to
              approve. This page updates automatically.
            </p>
          )}
          {isPesaPal ? (
            <Button onClick={retry} loading={busy} className="w-full">Open secure card payment</Button>
          ) : (
            <>
              <p className="text-xs text-gray-600">No prompt? Dial *165# (MTN) or *185# (Airtel) → check pending approvals, or resend below.</p>
              <div className="flex gap-2">
                <Input value={retryPhone} onChange={(e) => setRetryPhone(e.target.value)} placeholder="Other number (optional)" inputMode="tel" />
                <Button onClick={retry} loading={busy} variant="secondary" className="shrink-0">Resend prompt</Button>
              </div>
            </>
          )}
          {order.expiresAt && <p className="text-xs text-gray-500">Unpaid orders are cancelled automatically at {new Date(order.expiresAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}.</p>}
        </div>
      )}

      <div className="rounded-2xl border border-gray-200 bg-white p-4">
        <div className="flex items-start justify-between">
          <div>
            <div className="text-xs text-gray-500">Order</div>
            <div className="text-lg font-bold">{order.orderNumber}</div>
          </div>
          <span className={cn("rounded-full px-3 py-1 text-xs font-semibold", cancelled ? "bg-red-100 text-red-700" : "bg-brand-100 text-brand-800")}>{order.statusLabel}</span>
        </div>
        {!cancelled && (
          <ol className="mt-4 space-y-3">
            {TRACKING_STEPS.map((s, i) => (
              <li key={s} className="flex items-center gap-3 text-sm">
                {i <= stepIdx ? <CheckCircle2 className="size-5 text-brand-700" /> : <Circle className="size-5 text-gray-300" />}
                <span className={i <= stepIdx ? "font-medium" : "text-gray-400"}>{s === "pending" ? "Order placed" : ORDER_STATUS_LABELS[s]}</span>
                <span className="ml-auto text-xs text-gray-400">
                  {(() => {
                    const h = order.history.find((x) => x.status === s);
                    return h ? new Date(h.at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "";
                  })()}
                </span>
              </li>
            ))}
          </ol>
        )}
        {order.delivery?.riderName && (
          <div className="mt-4 flex items-center justify-between rounded-xl bg-gray-50 p-3 text-sm">
            <span>
              Rider: <b>{order.delivery.riderName}</b>
            </span>
            {order.delivery.riderPhone && (
              <a href={`tel:${order.delivery.riderPhone.replace(/\s/g, "")}`} className="inline-flex items-center gap-1 text-brand-700">
                <Phone className="size-4" /> {order.delivery.riderPhone}
              </a>
            )}
          </div>
        )}
        {order.delivery?.carrierName && (
          <div className="mt-4 rounded-xl bg-gray-50 p-3 text-sm">
            Sent with <b>{order.delivery.carrierName}</b>
            {order.delivery.trackingNumber && <> · Ref {order.delivery.trackingNumber}</>}
          </div>
        )}
      </div>

      {order.canReview && order.items.some((i) => i.productSlug) && (
        <div className="rounded-2xl border border-amber-200 bg-gradient-to-br from-amber-50 to-orange-50 p-4">
          <div className="flex items-center gap-2 font-bold text-amber-900">
            <Star className="size-5 fill-accent text-accent" /> How was your order?
          </div>
          <p className="mt-1 text-sm text-amber-900/80">Rate your items to help other shoppers choose.</p>
          <div className="mt-3 space-y-2">
            {order.items
              .filter((i, idx, all) => i.productSlug && all.findIndex((x) => x.productSlug === i.productSlug) === idx)
              .map((i) => (
                <Link key={i.id} href={`/p/${i.productSlug}?review=1`} className="flex items-center gap-3 rounded-xl bg-white p-2 text-sm shadow-sm transition hover:shadow-md">
                  <div className="size-12 shrink-0 overflow-hidden rounded-lg bg-gray-100">{i.imageUrl && <img src={i.imageUrl} alt="" className="size-full object-cover" />}</div>
                  <span className="line-clamp-2 flex-1 font-medium">{i.productName}</span>
                  <span className="inline-flex shrink-0 items-center gap-0.5 text-accent">
                    {[1, 2, 3, 4, 5].map((n) => <Star key={n} className="size-3.5" />)}
                  </span>
                </Link>
              ))}
          </div>
        </div>
      )}

      <div className="rounded-2xl border border-gray-200 bg-white p-4">
        <div className="space-y-2">
          {order.items.map((i) => (
            <div key={i.id} className="flex gap-3 text-sm">
              <div className="size-14 shrink-0 overflow-hidden rounded-lg bg-gray-100">{i.imageUrl && <img src={i.imageUrl} alt="" className="size-full object-cover" />}</div>
              <div className="flex-1">
                <div>{i.productName}</div>
                <div className="text-xs text-gray-500">
                  {i.variantLabel} · {i.quantity} × {formatUGX(i.unitPrice)}
                </div>
              </div>
              <div className="font-medium">{formatUGX(i.lineTotal)}</div>
            </div>
          ))}
        </div>
        <dl className="mt-3 space-y-1 border-t border-gray-100 pt-3 text-sm">
          <div className="flex justify-between">
            <dt>Subtotal</dt>
            <dd>{formatUGX(order.subtotal)}</dd>
          </div>
          <div className="flex justify-between">
            <dt>Delivery ({DELIVERY_METHOD_LABELS[order.deliveryMethod]})</dt>
            <dd>{formatUGX(order.deliveryFee)}</dd>
          </div>
          {order.discount > 0 && (
            <div className="flex justify-between text-green-700">
              <dt>Discount</dt>
              <dd>-{formatUGX(order.discount)}</dd>
            </div>
          )}
          <div className="flex justify-between text-base font-bold">
            <dt>Total</dt>
            <dd>{formatUGX(order.total)}</dd>
          </div>
          <div className="flex justify-between text-gray-600">
            <dt>Payment</dt>
            <dd>
              {isPesaPal ? "PesaPal" : PAYMENT_METHOD_LABELS[order.paymentMethod]} · {order.amountPaid >= order.total ? "Paid" : order.amountPaid > 0 ? `Paid ${formatUGX(order.amountPaid)}` : "Not paid"}
            </dd>
          </div>
        </dl>
        <div className="mt-3 border-t border-gray-100 pt-3 text-sm text-gray-600">
          Deliver to: {order.locationPath ?? `${order.area}, ${order.district}`}
          {order.nearbyPlace && <> · {order.nearbyPlace}</>}
          <br />
          Landmark: {order.address} · {order.phone}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <a href={help} target="_blank" rel="noreferrer" className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-whatsapp px-4 text-sm font-semibold text-white">
          <MessageCircle className="size-4" /> Help on WhatsApp
        </a>
        {order.canCancel && (
          <Button variant="secondary" onClick={cancel}>
            Cancel order
          </Button>
        )}
      </div>
      <Link href="/" className="block text-center text-sm text-brand-700">
        Continue shopping →
      </Link>
    </div>
    </>
  );
}
