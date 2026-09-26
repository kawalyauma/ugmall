"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { DELIVERY_METHOD_LABELS, ORDERABLE_DELIVERY_METHODS, ORDERABLE_PAYMENT_METHODS, ORDER_SOURCES, PAYMENT_METHOD_LABELS, UG_DISTRICTS } from "@ugmall/shared";
import { api } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import { useToast } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Card, PageHeader, money } from "@/components/ui/kit";
import { VariantPicker, type VariantHit } from "@/components/variant-picker";

export default function NewOrder() {
  const router = useRouter();
  const toast = useToast();
  const { data: zones } = useApi<{ items: { id: string; name: string; fee: number | null }[] }>("/admin/delivery-zones?limit=100");
  const [lines, setLines] = useState<(VariantHit & { quantity: number })[]>([]);
  const [f, setF] = useState<Record<string, string>>({ source: "whatsapp", district: "Kampala", deliveryMethod: "boda", paymentMethod: "cash_on_delivery" });
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }));
  const subtotal = lines.reduce((s, l) => s + l.price * l.quantity, 0);

  async function submit() {
    setBusy(true);
    try {
      const r = await api<{ id: string; paymentMessage?: string }>("/admin/orders", {
        body: {
          ...f,
          deliveryZoneId: f.deliveryZoneId || undefined,
          items: lines.map((l) => ({ variantId: l.id, quantity: l.quantity })),
        },
      });
      toast(r.paymentMessage ?? "Order created");
      router.push(`/orders/${r.id}`);
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader title="New order" subtitle="For orders received on WhatsApp, by phone or in the shop." />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Items">
          <VariantPicker onPick={(v) => setLines((ls) => (ls.some((l) => l.id === v.id) ? ls : [...ls, { ...v, quantity: 1 }]))} />
          <div className="mt-3 space-y-2">
            {lines.map((l) => (
              <div key={l.id} className="flex items-center gap-2 text-sm">
                <div className="flex-1">
                  {l.productName} <span className="text-gray-500">{Object.values(l.options).join(" / ")}</span>
                  <div className="text-xs text-gray-400">{money(l.price)} · {l.onHand - l.reserved} available</div>
                </div>
                <Input type="number" min={1} className="h-9 w-20" value={l.quantity} onChange={(e) => setLines((ls) => ls.map((x) => (x.id === l.id ? { ...x, quantity: Math.max(1, Number(e.target.value)) } : x)))} />
                <button onClick={() => setLines((ls) => ls.filter((x) => x.id !== l.id))} className="p-2 text-gray-400 hover:text-red-600" aria-label="Remove">
                  <Trash2 className="size-4" />
                </button>
              </div>
            ))}
          </div>
          <div className="mt-3 text-right font-semibold">Subtotal {money(subtotal)}</div>
        </Card>
        <Card title="Customer & delivery">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name"><Input value={f.customerName ?? ""} onChange={(e) => set("customerName", e.target.value)} /></Field>
            <Field label="Phone"><Input value={f.phone ?? ""} onChange={(e) => set("phone", e.target.value)} inputMode="tel" /></Field>
            <Field label="Alt phone"><Input value={f.altPhone ?? ""} onChange={(e) => set("altPhone", e.target.value)} /></Field>
            <Field label="Source">
              <Select value={f.source} onChange={(e) => set("source", e.target.value)}>
                {ORDER_SOURCES.map((s) => <option key={s}>{s}</option>)}
              </Select>
            </Field>
            <Field label="District">
              <Select value={f.district} onChange={(e) => set("district", e.target.value)}>
                {UG_DISTRICTS.map((d) => <option key={d}>{d}</option>)}
              </Select>
            </Field>
            <Field label="Area"><Input value={f.area ?? ""} onChange={(e) => set("area", e.target.value)} /></Field>
            <Field label="Address / landmark" className="sm:col-span-2"><Input value={f.address ?? ""} onChange={(e) => set("address", e.target.value)} /></Field>
            <Field label="Delivery zone">
              <Select value={f.deliveryZoneId ?? ""} onChange={(e) => set("deliveryZoneId", e.target.value)}>
                <option value="">—</option>
                {zones?.items.map((z) => <option key={z.id} value={z.id}>{z.name} {z.fee !== null ? `(${money(z.fee)})` : ""}</option>)}
              </Select>
            </Field>
            <Field label="Delivery method">
              <Select value={f.deliveryMethod} onChange={(e) => set("deliveryMethod", e.target.value)}>
                {ORDERABLE_DELIVERY_METHODS.map((m) => <option key={m} value={m}>{DELIVERY_METHOD_LABELS[m]}</option>)}
              </Select>
            </Field>
            <Field label="Payment">
              <Select value={f.paymentMethod} onChange={(e) => set("paymentMethod", e.target.value)}>
                {ORDERABLE_PAYMENT_METHODS.map((m) => <option key={m} value={m}>{PAYMENT_METHOD_LABELS[m]}</option>)}
              </Select>
            </Field>
            <Field label="MoMo number (if different)"><Input value={f.paymentPhone ?? ""} onChange={(e) => set("paymentPhone", e.target.value)} /></Field>
            <Field label="Coupon"><Input value={f.couponCode ?? ""} onChange={(e) => set("couponCode", e.target.value.toUpperCase())} /></Field>
            <Field label="Notes" className="sm:col-span-2"><Textarea value={f.notes ?? ""} onChange={(e) => set("notes", e.target.value)} /></Field>
          </div>
          <Button className="mt-4 w-full" size="lg" loading={busy} disabled={!lines.length} onClick={submit}>
            Create order
          </Button>
          <p className="mt-2 text-xs text-gray-500">Mobile Money orders send a payment prompt to the customer's phone immediately.</p>
        </Card>
      </div>
    </>
  );
}
