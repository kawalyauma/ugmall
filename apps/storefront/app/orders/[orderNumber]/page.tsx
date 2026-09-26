"use client";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CheckCircle2, Circle, MessageCircle, Phone, Smartphone } from "lucide-react";
import { DELIVERY_METHOD_LABELS, PAYMENT_METHOD_LABELS, TRACKING_STEPS, ORDER_STATUS_LABELS, formatUGX, whatsappLink, type OrderStatus, type PaymentMethod, type DeliveryMethod } from "@ugmall/shared";
import { api } from "@/lib/api";
import { useStore } from "@/components/providers";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

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
  subtotal: number;
  deliveryFee: number;
  discount: number;
  total: number;
  amountPaid: number;
  expiresAt: string | null;
  canRetryPayment: boolean;
  canCancel: boolean;
  latestPayment: { status: string; failureReason: string | null; msisdn: string | null } | null;
  items: { id: string; productName: string; variantLabel: string | null; imageUrl: string | null; unitPrice: number; quantity: number; lineTotal: number }[];
  history: { status: OrderStatus; label: string; at: string }[];
  delivery: { status: string; riderName: string | null; riderPhone: string | null; carrierName: string | null; trackingNumber: string | null } | null;
}

export default function OrderPage({ params }: { params: Promise<{ orderNumber: string }> }) {
  const { orderNumber } = use(params);
  const sp = useSearchParams();
  const t = sp.get("t") ?? "";
  const isNew = sp.get("new") === "1";
  const { settings, toast } = useStore();
  const [order, setOrder] = useState<Tracked | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retryPhone, setRetryPhone] = useState("");
  const [busy, setBusy] = useState(false);

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
      const r = await api<{ message?: string }>(`/store/orders/${orderNumber}/retry-payment`, { body: { t, msisdn: retryPhone || undefined } });
      toast(r.message ?? "Payment prompt sent");
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
    <div className="container-page max-w-2xl space-y-4 py-5">
      {isNew && order.status !== "awaiting_payment" && !cancelled && (
        <div className="rounded-2xl bg-green-50 p-4 text-green-800">
          <div className="text-lg font-bold">Thank you, {order.customerName.split(" ")[0]}! 🎉</div>
          <p className="text-sm">Your order has been received. We'll confirm on WhatsApp shortly.</p>
        </div>
      )}

      {order.status === "awaiting_payment" && (
        <div className="space-y-3 rounded-2xl border-2 border-amber-300 bg-amber-50 p-4">
          <div className="flex items-center gap-2 text-lg font-bold">
            <Smartphone className="size-5" /> Approve payment on your phone
          </div>
          {order.latestPayment?.status === "failed" ? (
            <p className="text-sm text-red-700">Payment failed{order.latestPayment.failureReason ? `: ${order.latestPayment.failureReason}` : ""}. Try again below.</p>
          ) : (
            <p className="text-sm">
              We sent {order.paymentMethod === "mtn_momo" ? "an" : "a"} {PAYMENT_METHOD_LABELS[order.paymentMethod]} prompt for <b>{formatUGX(order.total - order.amountPaid)}</b> to <b>{order.latestPayment?.msisdn ?? order.phone}</b>. Enter your PIN to
              approve. This page updates automatically.
            </p>
          )}
          <p className="text-xs text-gray-600">No prompt? Dial *165# (MTN) or *185# (Airtel) → check pending approvals, or resend below.</p>
          <div className="flex gap-2">
            <Input value={retryPhone} onChange={(e) => setRetryPhone(e.target.value)} placeholder="Other number (optional)" inputMode="tel" />
            <Button onClick={retry} loading={busy} variant="secondary" className="shrink-0">
              Resend prompt
            </Button>
          </div>
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
              {PAYMENT_METHOD_LABELS[order.paymentMethod]} · {order.amountPaid >= order.total ? "Paid" : order.amountPaid > 0 ? `Paid ${formatUGX(order.amountPaid)}` : "Not paid"}
            </dd>
          </div>
        </dl>
        <div className="mt-3 border-t border-gray-100 pt-3 text-sm text-gray-600">
          Deliver to: {order.address}, {order.area}, {order.district} · {order.phone}
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
  );
}
