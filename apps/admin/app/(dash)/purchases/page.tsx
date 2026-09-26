"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";
import { variantLabel } from "@ugmall/shared";
import { api } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import { Resource } from "@/components/resource";
import { useToast } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import { Card, Modal, PageHeader, StatusBadge, Table, dt, money } from "@/components/ui/kit";
import { VariantPicker, type VariantHit } from "@/components/variant-picker";

interface Purchase {
  id: string;
  reference: string;
  supplierName: string | null;
  status: string;
  totalCost: number;
  itemCount: number;
  createdAt: string;
  receivedAt: string | null;
}
interface PurchaseDetail extends Purchase {
  items: { id: string; productName: string; options: Record<string, string>; sku: string; quantity: number; receivedQuantity: number; unitCost: number }[];
}

export default function Purchases() {
  const toast = useToast();
  const { data, reload } = useApi<Purchase[]>("/admin/purchases");
  const { data: suppliers } = useApi<{ items: { id: string; name: string }[] }>("/admin/suppliers?limit=500");
  const [creating, setCreating] = useState(false);
  const [supplierId, setSupplierId] = useState("");
  const [lines, setLines] = useState<(VariantHit & { quantity: number; unitCost: number })[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const { data: detail, reload: reloadDetail } = useApi<PurchaseDetail>(openId ? `/admin/purchases/${openId}` : null);

  async function create() {
    try {
      await api("/admin/purchases", { body: { supplierId: supplierId || null, items: lines.map((l) => ({ variantId: l.id, quantity: l.quantity, unitCost: l.unitCost })) } });
      toast("Purchase order created");
      setCreating(false);
      setLines([]);
      await reload();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }

  return (
    <>
      <PageHeader title="Suppliers & purchases" subtitle="Receiving a purchase adds stock and updates cost prices." actions={<Button size="sm" onClick={() => setCreating(true)}>New purchase</Button>} />
      <Table
        rows={data ?? []}
        onRowClick={(p) => setOpenId(p.id)}
        columns={[
          { header: "Reference", cell: (p) => <b>{p.reference}</b> },
          { header: "Supplier", cell: (p) => p.supplierName ?? "—" },
          { header: "Created", cell: (p) => dt(p.createdAt) },
          { header: "Items", cell: (p) => p.itemCount },
          { header: "Cost", cell: (p) => money(p.totalCost) },
          { header: "Status", cell: (p) => <StatusBadge status={p.status} /> },
        ]}
      />
      <div className="mt-6">
        <Resource
          title="Suppliers"
          endpoint="/admin/suppliers"
          fields={[
            { name: "name", label: "Name", required: true },
            { name: "contactName", label: "Contact person", nullable: true },
            { name: "phone", label: "Phone", nullable: true },
            { name: "email", label: "Email", nullable: true },
            { name: "address", label: "Address", nullable: true },
            { name: "notes", label: "Notes", type: "textarea", nullable: true },
            { name: "isActive", label: "Active", type: "checkbox" },
          ]}
          columns={[
            { header: "Name", cell: (r) => r.name as string },
            { header: "Contact", cell: (r) => `${(r.contactName as string) ?? ""} ${(r.phone as string) ?? ""}` },
            { header: "Active", cell: (r) => (r.isActive ? "✓" : "—") },
          ]}
        />
      </div>

      <Modal open={creating} onClose={() => setCreating(false)} title="New purchase order" wide>
        <div className="space-y-3">
          <Field label="Supplier">
            <Select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
              <option value="">—</option>
              {suppliers?.items.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          </Field>
          <VariantPicker onPick={(v) => setLines((ls) => (ls.some((l) => l.id === v.id) ? ls : [...ls, { ...v, quantity: 1, unitCost: v.costPrice }]))} />
          {lines.map((l) => (
            <div key={l.id} className="grid grid-cols-[1fr_80px_120px_32px] items-center gap-2 text-sm">
              <span>{l.productName} <span className="text-gray-500">{variantLabel(l.options)}</span></span>
              <Input type="number" className="h-9" value={l.quantity} onChange={(e) => setLines((ls) => ls.map((x) => (x.id === l.id ? { ...x, quantity: Number(e.target.value) } : x)))} />
              <Input type="number" className="h-9" value={l.unitCost} onChange={(e) => setLines((ls) => ls.map((x) => (x.id === l.id ? { ...x, unitCost: Number(e.target.value) } : x)))} />
              <button onClick={() => setLines((ls) => ls.filter((x) => x.id !== l.id))} aria-label="Remove"><Trash2 className="size-4 text-gray-400" /></button>
            </div>
          ))}
          <div className="text-right font-semibold">Total {money(lines.reduce((s, l) => s + l.quantity * l.unitCost, 0))}</div>
        </div>
        <Button className="mt-4 w-full" disabled={!lines.length} onClick={create}>Create</Button>
      </Modal>

      <Modal open={!!openId && !!detail} onClose={() => setOpenId(null)} title={detail?.reference ?? ""} wide>
        {detail && (
          <Card>
            <Table
              rows={detail.items}
              columns={[
                { header: "Item", cell: (i) => `${i.productName} ${variantLabel(i.options)}` },
                { header: "SKU", cell: (i) => i.sku },
                { header: "Ordered", cell: (i) => i.quantity },
                { header: "Received", cell: (i) => i.receivedQuantity },
                { header: "Unit cost", cell: (i) => money(i.unitCost) },
              ]}
            />
            {detail.status === "ordered" && (
              <div className="mt-4 flex justify-between">
                <Button variant="ghost" className="text-red-600" onClick={async () => { await api(`/admin/purchases/${detail.id}/cancel`, { method: "POST" }); await reload(); setOpenId(null); }}>Cancel PO</Button>
                <Button
                  onClick={async () => {
                    try {
                      await api(`/admin/purchases/${detail.id}/receive`, { body: { updateCostPrices: true } });
                      toast("Goods received — stock updated");
                      await reloadDetail();
                      await reload();
                    } catch (e) {
                      toast((e as Error).message, "error");
                    }
                  }}
                >
                  Receive all goods
                </Button>
              </div>
            )}
          </Card>
        )}
      </Modal>
    </>
  );
}
