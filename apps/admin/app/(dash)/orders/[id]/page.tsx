"use client";

import { use, useState } from "react";
import Link from "next/link";
import { FileText, MessageCircle, Phone, RefreshCw } from "lucide-react";
import {
  DELIVERY_METHOD_LABELS,
  ORDER_STATUS_LABELS,
  ORDER_TRANSITIONS,
  PAYMENT_METHOD_LABELS,
  PERMISSIONS as P,
  prettyUgPhone,
  type DeliveryMethod,
  type OrderStatus,
  type PaymentMethod,
} from "@ugmall/shared";
import { api } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import { useSession } from "@/components/session";
import { useToast } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Badge, Card, Modal, PageHeader, StatusBadge, Table, dt, money } from "@/components/ui/kit";

interface Detail {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  paymentStatus: string;
  paymentMethod: PaymentMethod;
  deliveryMethod: DeliveryMethod;
  source: string;
  customerName: string;
  phone: string;
  altPhone: string | null;
  email: string | null;
  district: string;
  area: string;
  address: string;
  notes: string | null;
  staffNotes: string | null;
  subtotal: number;
  deliveryFee: number;
  discount: number;
  total: number;
  costTotal: number;
  amountPaid: number;
  couponCode: string | null;
  trackingUrl: string;
  createdAt: string;
  items: { id: string; productName: string; variantLabel: string | null; sku: string; imageUrl: string | null; unitPrice: number; unitCost: number; quantity: number; lineTotal: number; returnedQuantity: number }[];
  history: { id: string; fromStatus: string | null; toStatus: string; note: string | null; actorType: string; actorName: string | null; createdAt: string }[];
  payments: { id: string; provider: string; method: string; amount: number; status: string; externalReference: string; financialTransactionId: string | null; msisdn: string | null; failureReason: string | null; createdAt: string }[];
  deliveries: { id: string; method: string; status: string; riderName: string | null; carrierName: string | null; trackingNumber: string | null; amountToCollect: number; amountCollected: number | null; cashHandedOver: boolean; createdAt: string }[];
  refunds: { id: string; amount: number; method: string; status: string; reason: string | null; createdAt: string }[];
  returns: { id: string; status: string; reason: string; createdAt: string }[];
  notifications: { id: string; template: string; status: string; error: string | null; createdAt: string }[];
}

type Dialog = null | "rider" | "dispatch" | "payment" | "refund" | "return" | { status: OrderStatus };

export default function OrderDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { can } = useSession();
  const toast = useToast();
  const { data: o, reload } = useApi<Detail>(`/admin/orders/${id}`);
  const { data: riders } = useApi<{ id: string; name: string; activeDeliveries: number }[]>("/admin/riders");
  const [dialog, setDialog] = useState<Dialog>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [notes, setNotes] = useState<string | null>(null);
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  if (!o) return <p className="text-gray-400">Loading…</p>;

  async function run(fn: () => Promise<unknown>, ok = "Done") {
    setBusy(true);
    try {
      await fn();
      toast(ok);
      setDialog(null);
      setForm({});
      await reload();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  const next = ORDER_TRANSITIONS[o.status].filter((s) => s !== "paid" && s !== "refunded" && s !== "assigned_to_rider");
  const due = o.total - o.amountPaid;
  const profit = o.total - o.deliveryFee - o.costTotal;

  return (
    <>
      <PageHeader
        title={o.orderNumber}
        subtitle={`${dt(o.createdAt)} · via ${o.source}`}
        actions={
          <>
            <Button size="sm" variant="secondary" onClick={() => run(async () => window.open((await api<{ url: string }>(`/admin/orders/${o.id}/invoice`, { method: "POST" })).url, "_blank"), "Invoice ready")}>
              <FileText className="size-4" /> Invoice
            </Button>
            <Button size="sm" variant="secondary" onClick={() => window.print()}>
              Print
            </Button>
          </>
        }
      />
      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <div className="space-y-4">
          <Card
            title={
              <span className="flex items-center gap-2">
                Status <StatusBadge status={o.status} />
              </span>
            }
          >
            {can(P.ordersManage) && (
              <div className="no-print flex flex-wrap gap-2">
                {next.map((s) => (
                  <Button key={s} size="sm" variant={s === "cancelled" ? "danger" : "secondary"} onClick={() => setDialog({ status: s })}>
                    → {ORDER_STATUS_LABELS[s]}
                  </Button>
                ))}
                {["confirmed", "processing", "ready_for_dispatch", "paid", "assigned_to_rider"].includes(o.status) && can(P.deliveriesManage) && (
                  <>
                    <Button size="sm" onClick={() => setDialog("rider")}>
                      Assign rider
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => setDialog("dispatch")}>
                      Courier / bus parcel
                    </Button>
                  </>
                )}
              </div>
            )}
          </Card>

          <Card title="Items">
            <Table
              rows={o.items}
              columns={[
                { header: "", cell: (i) => (i.imageUrl ? <img src={i.imageUrl} alt="" className="size-10 rounded object-cover" /> : null) },
                { header: "Product", cell: (i) => (<div><div>{i.productName}</div><div className="text-xs text-gray-500">{i.variantLabel} · {i.sku}</div></div>) },
                { header: "Qty", cell: (i) => (<>{i.quantity}{i.returnedQuantity ? <Badge tone="amber">{i.returnedQuantity} returned</Badge> : null}</>) },
                { header: "Price", cell: (i) => money(i.unitPrice), className: "text-right" },
                { header: "Total", cell: (i) => money(i.lineTotal), className: "text-right" },
              ]}
            />
            <dl className="ml-auto mt-3 max-w-xs space-y-1 text-sm">
              <div className="flex justify-between"><dt>Subtotal</dt><dd>{money(o.subtotal)}</dd></div>
              <div className="flex justify-between"><dt>Delivery</dt><dd>{money(o.deliveryFee)}</dd></div>
              {o.discount > 0 && <div className="flex justify-between text-green-700"><dt>Discount {o.couponCode && `(${o.couponCode})`}</dt><dd>-{money(o.discount)}</dd></div>}
              <div className="flex justify-between text-base font-bold"><dt>Total</dt><dd>{money(o.total)}</dd></div>
              <div className="flex justify-between"><dt>Paid</dt><dd>{money(o.amountPaid)}</dd></div>
              {due > 0 && <div className="flex justify-between font-semibold text-amber-700"><dt>Balance due</dt><dd>{money(due)}</dd></div>}
              {can(P.reportsView) && <div className="flex justify-between text-xs text-gray-500"><dt>Cost / gross profit</dt><dd>{money(o.costTotal)} / {money(profit)}</dd></div>}
            </dl>
          </Card>

          <Card
            title="Payments"
            actions={
              <div className="no-print flex gap-2">
                {o.paymentStatus === "pending" && o.payments.some((p) => p.status === "pending") && (
                  <Button size="sm" variant="ghost" onClick={() => run(() => api(`/admin/orders/${o.id}/check-payment`, { method: "POST" }), "Checked with provider")}>
                    <RefreshCw className="size-4" /> Check status
                  </Button>
                )}
                {due > 0 && can(P.ordersManage) && (
                  <Button size="sm" variant="secondary" onClick={() => { setForm({ amount: String(due) }); setDialog("payment"); }}>
                    Record payment
                  </Button>
                )}
                {o.amountPaid > 0 && can(P.refundsManage) && (
                  <Button size="sm" variant="secondary" onClick={() => { setForm({ amount: String(o.amountPaid), method: "" }); setDialog("refund"); }}>
                    Refund
                  </Button>
                )}
              </div>
            }
          >
            <Table
              rows={o.payments}
              columns={[
                { header: "Date", cell: (p) => dt(p.createdAt) },
                { header: "Provider", cell: (p) => (<div><div>{p.provider}</div><div className="text-xs text-gray-500">{p.externalReference}</div></div>) },
                { header: "Number", cell: (p) => (p.msisdn ? prettyUgPhone(p.msisdn) : "—") },
                { header: "Amount", cell: (p) => money(p.amount) },
                { header: "Status", cell: (p) => (<div><StatusBadge status={p.status} />{p.failureReason && <div className="text-xs text-red-600">{p.failureReason}</div>}{p.financialTransactionId && <div className="text-xs text-gray-500">TxID {p.financialTransactionId}</div>}</div>) },
              ]}
            />
            {o.refunds.length > 0 && (
              <div className="mt-3 text-sm">
                <div className="font-medium">Refunds</div>
                {o.refunds.map((r) => (
                  <div key={r.id} className="flex justify-between border-t border-gray-100 py-1">
                    <span>{dt(r.createdAt)} · {r.method} · {r.reason}</span>
                    <span>{money(r.amount)} <StatusBadge status={r.status} /></span>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {o.deliveries.length > 0 && (
            <Card title="Deliveries">
              <Table
                rows={o.deliveries}
                columns={[
                  { header: "Assigned", cell: (d) => dt(d.createdAt) },
                  { header: "Method", cell: (d) => DELIVERY_METHOD_LABELS[d.method as DeliveryMethod] ?? d.method },
                  { header: "Rider / carrier", cell: (d) => d.riderName ?? `${d.carrierName ?? "—"}${d.trackingNumber ? ` (${d.trackingNumber})` : ""}` },
                  { header: "To collect", cell: (d) => money(d.amountToCollect) },
                  { header: "Collected", cell: (d) => (d.amountCollected !== null ? `${money(d.amountCollected)}${d.cashHandedOver ? " ✓" : ""}` : "—") },
                  { header: "Status", cell: (d) => <StatusBadge status={d.status} /> },
                ]}
              />
            </Card>
          )}

          <Card title="History">
            <ol className="space-y-2 text-sm">
              {o.history.map((h) => (
                <li key={h.id} className="flex gap-3">
                  <span className="w-32 shrink-0 text-xs text-gray-500">{dt(h.createdAt)}</span>
                  <span>
                    {h.fromStatus !== h.toStatus ? <StatusBadge status={h.toStatus} /> : <Badge>note</Badge>} {h.note}{" "}
                    <span className="text-xs text-gray-400">— {h.actorName ?? h.actorType}</span>
                  </span>
                </li>
              ))}
            </ol>
          </Card>
        </div>

        <div className="space-y-4">
          <Card title="Customer">
            <div className="space-y-1 text-sm">
              <div className="font-semibold">{o.customerName}</div>
              <a className="flex items-center gap-1 text-brand-700" href={`tel:+${o.phone}`}><Phone className="size-3.5" /> {prettyUgPhone(o.phone)}</a>
              {o.altPhone && <div>Alt: {prettyUgPhone(o.altPhone)}</div>}
              <a className="flex items-center gap-1 text-green-700" href={`https://wa.me/${o.phone}`} target="_blank" rel="noreferrer"><MessageCircle className="size-3.5" /> WhatsApp</a>
              <div className="pt-2 text-gray-600">{o.address}<br />{o.area}, {o.district}</div>
              <div className="pt-2">Delivery: <b>{DELIVERY_METHOD_LABELS[o.deliveryMethod]}</b></div>
              <div>Payment: <b>{PAYMENT_METHOD_LABELS[o.paymentMethod]}</b> <StatusBadge status={o.paymentStatus} /></div>
              {o.notes && <div className="mt-2 rounded-lg bg-amber-50 p-2">📝 {o.notes}</div>}
              <a href={o.trackingUrl} target="_blank" rel="noreferrer" className="block pt-2 text-xs text-brand-700">Customer tracking page ↗</a>
            </div>
          </Card>
          <Card title="Staff notes" className="no-print">
            <Textarea value={notes ?? o.staffNotes ?? ""} onChange={(e) => setNotes(e.target.value)} />
            <Button size="sm" className="mt-2" disabled={notes === null} onClick={() => run(() => api(`/admin/orders/${o.id}`, { method: "PATCH", body: { staffNotes: notes } }), "Notes saved")}>
              Save notes
            </Button>
          </Card>
          <Card title="WhatsApp notifications" className="no-print">
            <ul className="space-y-1 text-xs">
              {o.notifications.map((n) => (
                <li key={n.id} className="flex justify-between">
                  <span>{n.template.replace(/_/g, " ")}</span>
                  <span>
                    <StatusBadge status={n.status} /> {dt(n.createdAt)}
                  </span>
                </li>
              ))}
            </ul>
            <div className="mt-2 flex gap-2">
              <Select className="h-9 text-sm" value={form.notify ?? ""} onChange={(e) => set("notify", e.target.value)}>
                <option value="">Resend…</option>
                {["order_received", "payment_confirmed", "order_confirmed", "rider_dispatched", "delivered", "cancelled"].map((e) => (
                  <option key={e} value={e}>{e.replace(/_/g, " ")}</option>
                ))}
              </Select>
              <Button size="sm" disabled={!form.notify} onClick={() => run(() => api(`/admin/orders/${o.id}/notify`, { body: { event: form.notify } }), "Queued")}>
                Send
              </Button>
            </div>
          </Card>
          {o.status === "delivered" && can(P.ordersManage) && (
            <Button variant="secondary" className="no-print w-full" onClick={() => setDialog("return")}>
              Record a return
            </Button>
          )}
          {o.returns.map((r) => (
            <Link key={r.id} href="/returns" className="block rounded-xl bg-amber-50 p-3 text-sm">
              Return: {r.reason} <StatusBadge status={r.status} />
            </Link>
          ))}
        </div>
      </div>

      <Modal open={!!dialog && typeof dialog === "object"} onClose={() => setDialog(null)} title={dialog && typeof dialog === "object" ? `Move to ${ORDER_STATUS_LABELS[dialog.status]}` : ""}>
        <Field label="Note (optional, visible in history)">
          <Input value={form.note ?? ""} onChange={(e) => set("note", e.target.value)} placeholder={dialog && typeof dialog === "object" && dialog.status === "cancelled" ? "Reason for cancelling" : ""} />
        </Field>
        <Button className="mt-4 w-full" loading={busy} onClick={() => dialog && typeof dialog === "object" && run(() => api(`/admin/orders/${o.id}/status`, { body: { status: dialog.status, note: form.note || undefined } }), "Status updated")}>
          Confirm
        </Button>
      </Modal>

      <Modal open={dialog === "rider"} onClose={() => setDialog(null)} title="Assign rider">
        <Select value={form.riderId ?? ""} onChange={(e) => set("riderId", e.target.value)}>
          <option value="">Choose rider…</option>
          {riders?.map((r) => (
            <option key={r.id} value={r.id}>{r.name} ({r.activeDeliveries} active)</option>
          ))}
        </Select>
        <p className="mt-2 text-sm text-gray-600">Rider collects: <b>{money(due)}</b></p>
        <Button className="mt-4 w-full" loading={busy} disabled={!form.riderId} onClick={() => run(() => api(`/admin/orders/${o.id}/assign-rider`, { body: { riderId: form.riderId } }), "Rider assigned")}>
          Assign
        </Button>
      </Modal>

      <Modal open={dialog === "dispatch"} onClose={() => setDialog(null)} title="Send with courier / bus / third party">
        <div className="space-y-3">
          <Field label="Carrier (e.g. Link Bus, Posta Uganda, SafeBoda)"><Input value={form.carrierName ?? ""} onChange={(e) => set("carrierName", e.target.value)} /></Field>
          <Field label="Tracking / receipt number"><Input value={form.trackingNumber ?? ""} onChange={(e) => set("trackingNumber", e.target.value)} /></Field>
        </div>
        <Button className="mt-4 w-full" loading={busy} disabled={!form.carrierName} onClick={() => run(() => api(`/admin/orders/${o.id}/dispatch`, { body: { carrierName: form.carrierName, trackingNumber: form.trackingNumber || undefined } }), "Dispatched")}>
          Mark out for delivery
        </Button>
      </Modal>

      <Modal open={dialog === "payment"} onClose={() => setDialog(null)} title="Record payment received">
        <div className="space-y-3">
          <Field label="Amount (UGX)"><Input type="number" value={form.amount ?? ""} onChange={(e) => set("amount", e.target.value)} /></Field>
          <Field label="Note" hint="e.g. Cash at shop, MoMo to shop line (TxID)"><Input value={form.note ?? ""} onChange={(e) => set("note", e.target.value)} /></Field>
        </div>
        <Button className="mt-4 w-full" loading={busy} onClick={() => run(() => api(`/admin/orders/${o.id}/payments`, { body: { amount: Number(form.amount), note: form.note || undefined } }), "Payment recorded")}>
          Save
        </Button>
      </Modal>

      <Modal open={dialog === "refund"} onClose={() => setDialog(null)} title="Refund">
        <div className="space-y-3">
          <Field label="Amount (UGX)"><Input type="number" value={form.amount ?? ""} onChange={(e) => set("amount", e.target.value)} /></Field>
          <Field label="Reason"><Input value={form.reason ?? ""} onChange={(e) => set("reason", e.target.value)} /></Field>
          <Field label="Method" hint="Automatic sends Mobile Money back through the payment provider.">
            <Select value={form.method ?? ""} onChange={(e) => set("method", e.target.value)}>
              <option value="">Automatic (original payment method)</option>
              <option value="cash">Cash handed over</option>
              <option value="mobile_money_manual">Sent manually from shop MoMo line</option>
            </Select>
          </Field>
          <Field label="Mobile Money number (optional)"><Input value={form.msisdn ?? ""} onChange={(e) => set("msisdn", e.target.value)} placeholder={prettyUgPhone(o.phone)} /></Field>
        </div>
        <Button variant="danger" className="mt-4 w-full" loading={busy} disabled={!form.reason} onClick={() => run(() => api(`/admin/orders/${o.id}/refund`, { body: { amount: Number(form.amount), reason: form.reason, method: form.method || undefined, msisdn: form.msisdn || undefined } }), "Refund processed")}>
          Refund {money(Number(form.amount || 0))}
        </Button>
      </Modal>

      <Modal open={dialog === "return"} onClose={() => setDialog(null)} title="Record a return" wide>
        <div className="space-y-3">
          <Field label="Reason"><Input value={form.reason ?? ""} onChange={(e) => set("reason", e.target.value)} placeholder="Wrong size, defective…" /></Field>
          {o.items.map((i) => (
            <div key={i.id} className="grid grid-cols-[1fr_80px_140px] items-center gap-2 text-sm">
              <span>{i.productName} <span className="text-gray-500">{i.variantLabel}</span></span>
              <Input type="number" min={0} max={i.quantity - i.returnedQuantity} className="h-9" value={form[`q_${i.id}`] ?? "0"} onChange={(e) => set(`q_${i.id}`, e.target.value)} />
              <Select className="h-9" value={form[`c_${i.id}`] ?? "resellable"} onChange={(e) => set(`c_${i.id}`, e.target.value)}>
                <option value="resellable">Resellable</option>
                <option value="damaged">Damaged</option>
              </Select>
            </div>
          ))}
        </div>
        <Button
          className="mt-4 w-full"
          loading={busy}
          onClick={() =>
            run(
              () =>
                api(`/admin/orders/${o.id}/returns`, {
                  body: {
                    reason: form.reason,
                    items: o.items.filter((i) => Number(form[`q_${i.id}`] ?? 0) > 0).map((i) => ({ orderItemId: i.id, quantity: Number(form[`q_${i.id}`]), condition: form[`c_${i.id}`] ?? "resellable" })),
                  },
                }),
              "Return created — receive it on the Returns page",
            )
          }
        >
          Create return
        </Button>
      </Modal>
    </>
  );
}
