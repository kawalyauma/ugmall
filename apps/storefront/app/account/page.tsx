"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { formatUGX } from "@ugmall/shared";
import { api } from "@/lib/api";
import { useStore } from "@/components/providers";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";

interface MyOrder {
  orderNumber: string;
  trackingToken: string;
  statusLabel: string;
  status: string;
  total: number;
  createdAt: string;
  itemCount: number;
  firstImage: string | null;
}

function Login() {
  const { refreshCustomer, toast } = useStore();
  const router = useRouter();
  const next = useSearchParams().get("next");
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [busy, setBusy] = useState(false);

  async function requestCode() {
    setBusy(true);
    try {
      const r = await api<{ devCode?: string }>("/store/account/otp/request", { body: { phone } });
      setStep("code");
      toast(r.devCode ? `Dev code: ${r.devCode}` : "We sent a 6-digit code to your WhatsApp");
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function verify() {
    setBusy(true);
    try {
      await api("/store/account/otp/verify", { body: { phone, code, name: name || undefined } });
      await refreshCustomer();
      if (next) router.push(next);
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-sm space-y-4 py-10">
      <h1 className="text-2xl font-bold">Sign in</h1>
      <p className="text-sm text-gray-600">Use your phone number — no password needed. Sign-in is optional; you can always checkout as a guest.</p>
      {step === "phone" ? (
        <>
          <Field label="Phone number">
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" placeholder="07XX XXX XXX" />
          </Field>
          <Field label="Your name (first time only)">
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Button size="lg" className="w-full" onClick={requestCode} loading={busy}>
            Send code on WhatsApp
          </Button>
        </>
      ) : (
        <>
          <Field label="6-digit code">
            <Input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" />
          </Field>
          <Button size="lg" className="w-full" onClick={verify} loading={busy} disabled={code.length !== 6}>
            Verify &amp; sign in
          </Button>
          <button className="w-full text-sm text-gray-500" onClick={() => setStep("phone")}>
            Change number
          </button>
        </>
      )}
    </div>
  );
}

export default function AccountPage() {
  const { customer, refreshCustomer } = useStore();
  const [orders, setOrders] = useState<MyOrder[]>([]);
  useEffect(() => {
    if (customer) api<MyOrder[]>("/store/account/orders").then(setOrders, () => {});
  }, [customer]);

  if (customer === undefined) return <div className="py-16 text-center text-gray-400">Loading…</div>;
  if (!customer) return <div className="container-page"><Login /></div>;

  return (
    <div className="container-page max-w-2xl space-y-5 py-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Hi, {customer.name.split(" ")[0]}</h1>
          <p className="text-sm text-gray-500">0{customer.phone.slice(3)}</p>
        </div>
        <Button variant="secondary" size="sm" onClick={async () => { await api("/store/account/logout", { method: "POST" }); await refreshCustomer(); }}>
          Sign out
        </Button>
      </div>
      <Link href="/account/wishlist" className="block rounded-2xl border border-gray-200 bg-white p-4 font-medium">
        ❤️ My wishlist →
      </Link>
      <section>
        <h2 className="mb-2 font-semibold">My orders</h2>
        {orders.length === 0 && <p className="text-sm text-gray-500">No orders yet.</p>}
        <div className="space-y-2">
          {orders.map((o) => (
            <Link key={o.orderNumber} href={`/orders/${o.orderNumber}?t=${o.trackingToken}`} className="flex items-center gap-3 rounded-2xl border border-gray-200 bg-white p-3">
              <div className="size-14 shrink-0 overflow-hidden rounded-lg bg-gray-100">{o.firstImage && <img src={o.firstImage} alt="" className="size-full object-cover" />}</div>
              <div className="flex-1 text-sm">
                <div className="font-semibold">{o.orderNumber}</div>
                <div className="text-gray-500">
                  {new Date(o.createdAt).toLocaleDateString("en-GB")} · {o.itemCount} item(s)
                </div>
              </div>
              <div className="text-right text-sm">
                <div className="font-semibold">{formatUGX(o.total)}</div>
                <div className="text-xs text-brand-700">{o.statusLabel}</div>
              </div>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
