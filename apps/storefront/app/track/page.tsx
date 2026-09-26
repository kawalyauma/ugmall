"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";

export default function TrackPage() {
  const router = useRouter();
  const [orderNumber, setOrderNumber] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ orderNumber: string; trackingToken: string }>("/store/orders/lookup", { body: { orderNumber: orderNumber.trim().toUpperCase(), phone } });
      router.push(`/orders/${r.orderNumber}?t=${r.trackingToken}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="container-page max-w-md space-y-4 py-10">
      <h1 className="text-2xl font-bold">Track your order</h1>
      <Field label="Order number">
        <Input value={orderNumber} onChange={(e) => setOrderNumber(e.target.value)} placeholder="ORD-2026-000145" required />
      </Field>
      <Field label="Phone number used for the order">
        <Input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" placeholder="07XX XXX XXX" required />
      </Field>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <Button type="submit" size="lg" className="w-full" loading={busy}>
        Track order
      </Button>
    </form>
  );
}
