"use client";

import { useState } from "react";
import { MessageCircle, Navigation, Phone, RefreshCw } from "lucide-react";
import { PAYMENT_METHOD_LABELS, type PaymentMethod } from "@ugmall/shared";
import { api } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import { useSession } from "@/components/session";
import { useToast } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Modal, StatusBadge, money } from "@/components/ui/kit";

interface Job {
  id: string;
  orderId: string;
  orderNumber: string;
  status: string;
  customerName: string;
  phone: string;
  phoneHref: string;
  whatsappHref: string;
  altPhone: string | null;
  location: { district: string; area: string; address: string; path: string | null; nearbyPlace: string | null };
  navigationUrl: string;
  amountToCollect: number;
  amountCollected: number | null;
  paymentMethod: PaymentMethod;
  notes: string | null;
  items: { name: string; variant: string | null; quantity: number }[];
}

/** Mobile screen for delivery riders. */
export default function RiderApp() {
  const { me } = useSession();
  const toast = useToast();
  const { data: jobs, reload, loading } = useApi<Job[]>("/rider/deliveries");
  const { data: sum, reload: reloadSum } = useApi<{ delivered: number; pending: number; cashHeld: number }>("/rider/summary");
  const [deliver, setDeliver] = useState<Job | null>(null);
  const [fail, setFail] = useState<Job | null>(null);
  const [amount, setAmount] = useState("");
  const [recipient, setRecipient] = useState("");
  const [reason, setReason] = useState("");

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      toast(ok);
      setDeliver(null);
      setFail(null);
      await Promise.all([reload(), reloadSum()]);
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  const active = jobs?.filter((j) => j.status === "assigned" || j.status === "picked_up") ?? [];
  const done = jobs?.filter((j) => j.status === "delivered") ?? [];

  return (
    <div className="mx-auto min-h-screen max-w-md bg-gray-100 pb-10">
      <header className="sticky top-0 z-10 bg-brand-700 p-4 text-white">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs opacity-80">Rider</div>
            <div className="text-lg font-bold">{me.name}</div>
          </div>
          <button onClick={() => { void reload(); void reloadSum(); }} aria-label="Refresh" className={loading ? "animate-spin" : ""}>
            <RefreshCw className="size-5" />
          </button>
        </div>
        {sum && (
          <div className="mt-3 grid grid-cols-3 gap-2 text-center text-sm">
            <div className="rounded-lg bg-white/10 p-2"><div className="text-xl font-bold">{sum.pending}</div>to deliver</div>
            <div className="rounded-lg bg-white/10 p-2"><div className="text-xl font-bold">{sum.delivered}</div>done today</div>
            <div className="rounded-lg bg-white/10 p-2"><div className="font-bold">{money(sum.cashHeld)}</div>cash held</div>
          </div>
        )}
      </header>
      <div className="space-y-3 p-3">
        {active.length === 0 && <p className="py-10 text-center text-gray-500">No deliveries assigned. 🏍️</p>}
        {active.map((j) => (
          <div key={j.id} className="space-y-3 rounded-2xl bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="font-bold">{j.orderNumber}</span>
              <StatusBadge status={j.status} />
            </div>
            <div>
              <div className="text-lg font-semibold">{j.customerName}</div>
              <div className="text-sm text-gray-600">{j.location.path ? j.location.path.split(" › ").slice(1).join(" › ") : `${j.location.area}, ${j.location.district}`}</div>
              {j.location.nearbyPlace && <div className="text-sm text-gray-800">Near: {j.location.nearbyPlace}</div>}
              <div className="text-sm font-medium text-gray-800">📍 {j.location.address}</div>
              {j.notes && <div className="mt-1 rounded bg-amber-50 p-2 text-sm">📝 {j.notes}</div>}
            </div>
            <ul className="text-sm text-gray-700">
              {j.items.map((i, k) => <li key={k}>{i.quantity} × {i.name} {i.variant && <span className="text-gray-500">({i.variant})</span>}</li>)}
            </ul>
            <div className={`rounded-xl p-3 text-center ${j.amountToCollect ? "bg-amber-100" : "bg-green-100"}`}>
              {j.amountToCollect ? (<>Collect <b className="text-lg">{money(j.amountToCollect)}</b> <div className="text-xs">{PAYMENT_METHOD_LABELS[j.paymentMethod]}</div></>) : <b>Already paid — nothing to collect</b>}
            </div>
            <div className="grid grid-cols-3 gap-2">
              <a href={j.phoneHref} className="flex flex-col items-center gap-1 rounded-xl bg-gray-100 py-2 text-xs"><Phone className="size-5" />Call</a>
              <a href={j.whatsappHref} target="_blank" rel="noreferrer" className="flex flex-col items-center gap-1 rounded-xl bg-gray-100 py-2 text-xs"><MessageCircle className="size-5" />WhatsApp</a>
              <a href={j.navigationUrl} target="_blank" rel="noreferrer" className="flex flex-col items-center gap-1 rounded-xl bg-gray-100 py-2 text-xs"><Navigation className="size-5" />Navigate</a>
            </div>
            {j.status === "assigned" ? (
              <Button className="w-full" size="lg" onClick={() => act(() => api(`/rider/deliveries/${j.orderId}/pickup`, { method: "POST" }), "Picked up — customer notified")}>
                Picked up — start delivery
              </Button>
            ) : (
              <div className="grid grid-cols-[1fr_auto] gap-2">
                <Button size="lg" onClick={() => { setDeliver(j); setAmount(String(j.amountToCollect)); setRecipient(""); }}>Delivered ✓</Button>
                <Button size="lg" variant="secondary" onClick={() => { setFail(j); setReason(""); }}>Problem</Button>
              </div>
            )}
          </div>
        ))}
        {done.length > 0 && (
          <div className="rounded-2xl bg-white p-4">
            <div className="mb-2 font-semibold">Delivered recently</div>
            {done.map((j) => (
              <div key={j.id} className="flex justify-between border-t border-gray-100 py-2 text-sm">
                <span>{j.orderNumber} · {j.customerName}</span>
                <span>{money(j.amountCollected ?? 0)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      <Modal open={!!deliver} onClose={() => setDeliver(null)} title="Confirm delivery">
        <div className="space-y-3">
          <Field label="Amount collected (UGX)" hint={deliver?.amountToCollect ? `Expected ${money(deliver.amountToCollect)}` : "Prepaid order"}><Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="numeric" /></Field>
          <Field label="Received by (optional)"><Input value={recipient} onChange={(e) => setRecipient(e.target.value)} /></Field>
        </div>
        <Button className="mt-4 w-full" size="lg" onClick={() => deliver && act(() => api(`/rider/deliveries/${deliver.orderId}/deliver`, { body: { amountCollected: Number(amount || 0), recipientName: recipient || undefined } }), "Delivery confirmed")}>
          Confirm delivered
        </Button>
      </Modal>
      <Modal open={!!fail} onClose={() => setFail(null)} title="Couldn't deliver">
        <Field label="What happened?"><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Customer not answering, wrong address…" /></Field>
        <Button className="mt-4 w-full" variant="danger" disabled={reason.length < 3} onClick={() => fail && act(() => api(`/rider/deliveries/${fail.orderId}/fail`, { body: { reason } }), "Returned to shop queue")}>
          Return order to shop
        </Button>
      </Modal>
    </div>
  );
}
