"use client";

import { useState } from "react";
import Link from "next/link";
import { DELIVERY_METHODS, DELIVERY_METHOD_LABELS, prettyUgPhone, type DeliveryMethod, PERMISSIONS as P } from "@ugmall/shared";
import { api } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import { Resource } from "@/components/resource";
import { useSession } from "@/components/session";
import { useToast } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { Badge, Card, PageHeader, StatusBadge, Table, dt, money } from "@/components/ui/kit";

interface Delivery {
  id: string;
  orderId: string;
  orderNumber: string;
  customerName: string;
  phone: string;
  area: string;
  district: string;
  method: DeliveryMethod;
  status: string;
  riderName: string | null;
  carrierName: string | null;
  amountToCollect: number;
  amountCollected: number | null;
  cashHandedOver: boolean;
  assignedAt: string;
}

export default function Deliveries() {
  const { can } = useSession();
  const toast = useToast();
  const [view, setView] = useState<"active" | "cash" | "all">("active");
  const status = view === "active" ? "assigned,picked_up" : "";
  const { data, reload } = useApi<Delivery[]>(`/admin/deliveries?${status ? `status=${status}` : ""}${view === "cash" ? "cash=outstanding" : ""}`);
  const { data: riders } = useApi<{ id: string; name: string; phone: string | null; activeDeliveries: number; cashHeld: number }[]>("/admin/riders");
  const [sel, setSel] = useState<string[]>([]);

  return (
    <>
      <PageHeader title="Deliveries" actions={<Link href="/deliveries/areas"><Button size="sm" variant="secondary">Delivery areas & fees</Button></Link>} />
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {riders?.map((r) => (
          <Card key={r.id}>
            <div className="font-semibold">{r.name}</div>
            <div className="text-xs text-gray-500">{r.phone ? prettyUgPhone(r.phone) : ""}</div>
            <div className="mt-2 flex justify-between text-sm">
              <span>{r.activeDeliveries} active</span>
              <span className={r.cashHeld ? "font-semibold text-amber-700" : ""}>Cash: {money(r.cashHeld)}</span>
            </div>
          </Card>
        ))}
      </div>
      <div className="mb-3 flex flex-wrap gap-2">
        <Button size="sm" variant={view === "active" ? "primary" : "secondary"} onClick={() => setView("active")}>In progress</Button>
        <Button size="sm" variant={view === "cash" ? "primary" : "secondary"} onClick={() => setView("cash")}>COD cash to hand over</Button>
        <Button size="sm" variant={view === "all" ? "primary" : "secondary"} onClick={() => setView("all")}>All</Button>
        {view === "cash" && can(P.deliveriesManage) && sel.length > 0 && (
          <Button
            size="sm"
            onClick={async () => {
              const r = await api<{ total: number }>("/admin/deliveries/handover", { body: { ids: sel } });
              toast(`Received ${money(r.total)} from rider(s)`);
              setSel([]);
              await reload();
            }}
          >
            Mark {sel.length} as handed over
          </Button>
        )}
      </div>
      <Table
        rows={data ?? []}
        columns={[
          ...(view === "cash" ? [{ header: "", cell: (d: Delivery) => <input type="checkbox" checked={sel.includes(d.id)} onChange={(e) => setSel((s) => (e.target.checked ? [...s, d.id] : s.filter((x) => x !== d.id)))} /> }] : []),
          { header: "Assigned", cell: (d) => dt(d.assignedAt) },
          { header: "Order", cell: (d) => <Link className="text-brand-700" href={`/orders/${d.orderId}`}>{d.orderNumber}</Link> },
          { header: "Customer", cell: (d) => (<div><div>{d.customerName}</div><div className="text-xs text-gray-500">{prettyUgPhone(d.phone)} · {d.area}, {d.district}</div></div>) },
          { header: "Method", cell: (d) => DELIVERY_METHOD_LABELS[d.method] },
          { header: "Rider / carrier", cell: (d) => d.riderName ?? d.carrierName ?? "—" },
          { header: "Collect", cell: (d) => money(d.amountToCollect) },
          { header: "Collected", cell: (d) => (d.amountCollected !== null ? (<>{money(d.amountCollected)} {d.cashHandedOver ? <Badge tone="green">handed over</Badge> : <Badge tone="amber">with rider</Badge>}</>) : "—") },
          { header: "Status", cell: (d) => <StatusBadge status={d.status} /> },
        ]}
      />
      <div className="mt-6">
        <Resource
          title="Delivery zones"
          endpoint="/admin/delivery-zones"
          fields={[
            { name: "name", label: "Zone name", required: true },
            { name: "district", label: "District", nullable: true },
            { name: "fee", label: "Flat fee (UGX)", type: "money", nullable: true },
            { name: "etaText", label: "Delivery time text", nullable: true },
            { name: "isCalculated", label: "Calculated fee (upcountry)", type: "checkbox" },
            { name: "baseFee", label: "Base fee (calculated)", type: "money", nullable: true },
            { name: "perKgFee", label: "Per kg (calculated)", type: "money", nullable: true },
            { name: "freeDeliveryThreshold", label: "Free delivery above (UGX)", type: "money", nullable: true },
            { name: "sortOrder", label: "Sort order", type: "number" },
            { name: "methods", label: "Methods offered", type: "multiselect", options: DELIVERY_METHODS.map((m) => ({ value: m, label: DELIVERY_METHOD_LABELS[m] })) },
            { name: "isActive", label: "Active", type: "checkbox" },
          ]}
          columns={[
            { header: "Zone", cell: (r) => r.name as string },
            { header: "Fee", cell: (r) => (r.isCalculated ? `from ${money((r.baseFee as number) ?? 0)} + ${money((r.perKgFee as number) ?? 0)}/kg` : money(r.fee as number)) },
            { header: "ETA", cell: (r) => (r.etaText as string) ?? "" },
            { header: "Methods", cell: (r) => (r.methods as string[]).map((m) => DELIVERY_METHOD_LABELS[m as DeliveryMethod]).join(", ") },
            { header: "Areas", cell: () => <Link className="text-xs text-brand-700" href="/deliveries/areas" onClick={(e) => e.stopPropagation()}>set areas →</Link> },
            { header: "Active", cell: (r) => (r.isActive ? "✓" : "—") },
          ]}
        />
      </div>
    </>
  );
}
