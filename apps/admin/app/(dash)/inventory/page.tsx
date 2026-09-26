"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { variantLabel, PERMISSIONS as P } from "@ugmall/shared";
import { api, qs } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import { useSession } from "@/components/session";
import { useToast } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import { Card, Modal, PageHeader, StatusBadge, Table, dt } from "@/components/ui/kit";

interface Level {
  variantId: string;
  sku: string;
  options: Record<string, string>;
  productName: string;
  onHand: number;
  reserved: number;
  inCheckout: number;
  available: number;
  threshold: number;
  status: string;
}
interface Movement {
  id: string;
  type: string;
  onHandDelta: number;
  reservedDelta: number;
  onHandAfter: number;
  reservedAfter: number;
  referenceType: string | null;
  referenceId: string | null;
  note: string | null;
  staffName: string | null;
  sku: string;
  productName: string;
  createdAt: string;
}

function Inventory() {
  const { can } = useSession();
  const toast = useToast();
  const sp = useSearchParams();
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState(sp.get("filter") ?? "");
  const [tab, setTab] = useState<"levels" | "movements">("levels");
  const { data, reload } = useApi<Level[]>(`/admin/inventory${qs({ q, filter, limit: 500 })}`);
  const { data: moves, reload: reloadMoves } = useApi<Movement[]>(tab === "movements" ? "/admin/inventory/movements?limit=300" : null);
  const [adj, setAdj] = useState<Level | null>(null);
  const [form, setForm] = useState({ type: "received", quantity: "", note: "", unitCost: "" });

  async function submit() {
    if (!adj) return;
    try {
      await api("/admin/inventory/adjust", {
        body: { variantId: adj.variantId, type: form.type, quantity: Number(form.quantity), note: form.note || undefined, unitCost: form.unitCost ? Number(form.unitCost) : undefined },
      });
      toast("Stock updated");
      setAdj(null);
      await reload();
      await reloadMoves();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }

  return (
    <>
      <PageHeader title="Inventory" subtitle="Stock is tracked per size/colour. Reserved = held by placed orders; in checkout = held for shoppers for a few minutes." />
      <div className="mb-3 flex flex-wrap gap-2">
        <Button size="sm" variant={tab === "levels" ? "primary" : "secondary"} onClick={() => setTab("levels")}>Stock levels</Button>
        <Button size="sm" variant={tab === "movements" ? "primary" : "secondary"} onClick={() => setTab("movements")}>Audit trail</Button>
        {tab === "levels" && (
          <>
            <Input className="h-9 max-w-xs" placeholder="Search product or SKU" value={q} onChange={(e) => setQ(e.target.value)} />
            <Select className="h-9 max-w-40" value={filter} onChange={(e) => setFilter(e.target.value)}>
              <option value="">All</option>
              <option value="low">Low stock</option>
              <option value="out">Out of stock</option>
            </Select>
          </>
        )}
      </div>
      {tab === "levels" ? (
        <Table
          rows={data ?? []}
          onRowClick={can(P.inventoryAdjust) ? (l) => { setAdj(l); setForm({ type: "received", quantity: "", note: "", unitCost: "" }); } : undefined}
          columns={[
            { header: "Product", cell: (l) => l.productName },
            { header: "Variant", cell: (l) => variantLabel(l.options) || "—" },
            { header: "SKU", cell: (l) => <code className="text-xs">{l.sku}</code> },
            { header: "On hand", cell: (l) => l.onHand, className: "text-right" },
            { header: "Reserved", cell: (l) => l.reserved, className: "text-right" },
            { header: "In checkout", cell: (l) => l.inCheckout, className: "text-right" },
            { header: "Available", cell: (l) => <b>{l.available}</b>, className: "text-right" },
            { header: "Status", cell: (l) => <StatusBadge status={l.status} /> },
          ]}
        />
      ) : (
        <Card>
          <Table
            rows={moves ?? []}
            columns={[
              { header: "When", cell: (m) => dt(m.createdAt), className: "whitespace-nowrap" },
              { header: "Item", cell: (m) => (<div><div>{m.productName}</div><div className="text-xs text-gray-500">{m.sku}</div></div>) },
              { header: "Type", cell: (m) => <StatusBadge status={m.type} /> },
              { header: "On hand Δ", cell: (m) => (m.onHandDelta > 0 ? `+${m.onHandDelta}` : m.onHandDelta || ""), className: "text-right" },
              { header: "Reserved Δ", cell: (m) => (m.reservedDelta > 0 ? `+${m.reservedDelta}` : m.reservedDelta || ""), className: "text-right" },
              { header: "After", cell: (m) => `${m.onHandAfter} / ${m.reservedAfter}` },
              { header: "Reference", cell: (m) => (m.referenceType ? `${m.referenceType}${m.referenceId && m.referenceType !== "manual" ? ` ${m.referenceId.slice(0, 18)}` : ""}` : "") },
              { header: "By / note", cell: (m) => `${m.staffName ?? "system"}${m.note ? ` — ${m.note}` : ""}` },
            ]}
          />
        </Card>
      )}
      <Modal open={!!adj} onClose={() => setAdj(null)} title={adj ? `${adj.productName} — ${variantLabel(adj.options)}` : ""}>
        <p className="mb-3 text-sm text-gray-600">On hand {adj?.onHand} · reserved {adj?.reserved} · available {adj?.available}</p>
        <div className="grid gap-3">
          <Field label="Change type">
            <Select value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}>
              <option value="received">Stock received (+)</option>
              <option value="return">Customer return, resellable (+)</option>
              <option value="damaged">Damaged / lost (−)</option>
              <option value="adjustment">Manual adjustment (±)</option>
              <option value="count">Stock count (set exact on-hand)</option>
            </Select>
          </Field>
          <Field label={form.type === "count" ? "Counted quantity" : form.type === "adjustment" ? "Change (+/−)" : "Quantity"}>
            <Input type="number" value={form.quantity} onChange={(e) => setForm((f) => ({ ...f, quantity: e.target.value }))} />
          </Field>
          {form.type === "received" && <Field label="Unit cost (UGX, optional)"><Input type="number" value={form.unitCost} onChange={(e) => setForm((f) => ({ ...f, unitCost: e.target.value }))} /></Field>}
          <Field label={`Note${form.type === "adjustment" ? " (required)" : ""}`}><Input value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} /></Field>
        </div>
        <Button className="mt-4 w-full" onClick={submit} disabled={!form.quantity}>Save</Button>
      </Modal>
    </>
  );
}

export default function InventoryPage() {
  return (
    <Suspense>
      <Inventory />
    </Suspense>
  );
}
