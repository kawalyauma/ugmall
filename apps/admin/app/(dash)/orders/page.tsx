"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Plus } from "lucide-react";
import { ORDER_STATUSES, ORDER_STATUS_LABELS, PAYMENT_METHOD_LABELS, prettyUgPhone, type PaymentMethod } from "@ugmall/shared";
import { qs } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { PageHeader, StatusBadge, Table, dt, money } from "@/components/ui/kit";

interface OrderRow {
  id: string;
  orderNumber: string;
  customerName: string;
  phone: string;
  area: string;
  total: number;
  amountPaid: number;
  status: string;
  paymentMethod: PaymentMethod;
  paymentStatus: string;
  source: string;
  riderName: string | null;
  itemCount: number;
  createdAt: string;
}

function Orders() {
  const router = useRouter();
  const sp = useSearchParams();
  const [status, setStatus] = useState(sp.get("status") ?? "");
  const [q, setQ] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const { data } = useApi<{ items: OrderRow[]; total: number; counts: Record<string, number> }>(`/admin/orders${qs({ status, q, from, to, page, limit: 50 })}`);

  const quick = ["pending", "awaiting_payment", "confirmed", "ready_for_dispatch", "out_for_delivery", "delivered", "cancelled"];
  return (
    <>
      <PageHeader
        title="Orders"
        actions={
          <Link href="/orders/new">
            <Button size="sm">
              <Plus className="size-4" /> New order (WhatsApp / phone)
            </Button>
          </Link>
        }
      />
      <div className="mb-3 flex flex-wrap gap-2 text-sm">
        <button onClick={() => setStatus("")} className={`rounded-full border px-3 py-1 ${!status ? "border-brand-700 bg-brand-700 text-white" : "bg-white"}`}>
          All
        </button>
        {quick.map((s) => (
          <button key={s} onClick={() => setStatus(s)} className={`rounded-full border px-3 py-1 ${status === s ? "border-brand-700 bg-brand-700 text-white" : "bg-white"}`}>
            {ORDER_STATUS_LABELS[s as keyof typeof ORDER_STATUS_LABELS]} {data?.counts[s] ? <b>({data.counts[s]})</b> : null}
          </button>
        ))}
      </div>
      <div className="mb-3 grid gap-2 sm:grid-cols-4">
        <Input className="h-10" placeholder="Order no., name or phone" value={q} onChange={(e) => setQ(e.target.value)} />
        <Select className="h-10" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Any status</option>
          {ORDER_STATUSES.map((s) => (
            <option key={s} value={s}>
              {ORDER_STATUS_LABELS[s]}
            </option>
          ))}
        </Select>
        <Input className="h-10" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        <Input className="h-10" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
      </div>
      <Table
        rows={data?.items ?? []}
        onRowClick={(o) => router.push(`/orders/${o.id}`)}
        columns={[
          { header: "Order", cell: (o) => <span className="font-semibold">{o.orderNumber}</span> },
          { header: "Date", cell: (o) => dt(o.createdAt), className: "whitespace-nowrap" },
          { header: "Customer", cell: (o) => (<div><div>{o.customerName}</div><div className="text-xs text-gray-500">{prettyUgPhone(o.phone)} · {o.area}</div></div>) },
          { header: "Items", cell: (o) => o.itemCount },
          { header: "Total", cell: (o) => money(o.total), className: "text-right whitespace-nowrap" },
          { header: "Payment", cell: (o) => (<div className="text-xs"><div>{PAYMENT_METHOD_LABELS[o.paymentMethod]}</div><StatusBadge status={o.paymentStatus} /></div>) },
          { header: "Status", cell: (o) => <StatusBadge status={o.status} /> },
          { header: "Rider", cell: (o) => o.riderName ?? "—" },
          { header: "Source", cell: (o) => <span className="text-xs text-gray-500">{o.source}</span> },
        ]}
      />
      {data && data.total > 50 && (
        <div className="mt-3 flex items-center justify-center gap-3 text-sm">
          <Button size="sm" variant="secondary" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
            Previous
          </Button>
          Page {page} of {Math.ceil(data.total / 50)}
          <Button size="sm" variant="secondary" disabled={page * 50 >= data.total} onClick={() => setPage((p) => p + 1)}>
            Next
          </Button>
        </div>
      )}
    </>
  );
}

export default function OrdersPage() {
  return (
    <Suspense>
      <Orders />
    </Suspense>
  );
}
