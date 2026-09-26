"use client";

import { useState } from "react";
import Link from "next/link";
import { PAYMENT_METHOD_LABELS, prettyUgPhone, type PaymentMethod } from "@ugmall/shared";
import { useApi } from "@/lib/hooks";
import { Button } from "@/components/ui/button";
import { Card, PageHeader, StatusBadge, Table, dt, money } from "@/components/ui/kit";

interface Pay {
  id: string;
  orderId: string;
  orderNumber: string;
  customerName: string;
  provider: string;
  method: PaymentMethod;
  amount: number;
  refundedAmount: number;
  status: string;
  msisdn: string | null;
  externalReference: string;
  financialTransactionId: string | null;
  failureReason: string | null;
  createdAt: string;
}
interface Refund {
  id: string;
  orderId: string;
  orderNumber: string;
  customerName: string;
  amount: number;
  method: string;
  status: string;
  reason: string | null;
  staffName: string | null;
  createdAt: string;
}

export default function Payments() {
  const [status, setStatus] = useState("");
  const { data: pays } = useApi<Pay[]>(`/admin/payments?limit=200${status ? `&status=${status}` : ""}`);
  const { data: refunds } = useApi<Refund[]>("/admin/refunds");
  return (
    <>
      <PageHeader title="Payments & refunds" />
      <div className="mb-3 flex gap-2">
        {["", "pending", "succeeded", "failed", "refunded"].map((s) => (
          <Button key={s} size="sm" variant={status === s ? "primary" : "secondary"} onClick={() => setStatus(s)}>
            {s || "All"}
          </Button>
        ))}
      </div>
      <Table
        rows={pays ?? []}
        columns={[
          { header: "Date", cell: (p) => dt(p.createdAt), className: "whitespace-nowrap" },
          { header: "Order", cell: (p) => <Link className="text-brand-700" href={`/orders/${p.orderId}`}>{p.orderNumber}</Link> },
          { header: "Customer", cell: (p) => p.customerName },
          { header: "Method", cell: (p) => (<div><div>{PAYMENT_METHOD_LABELS[p.method]}</div><div className="text-xs text-gray-500">{p.provider}{p.msisdn ? ` · ${prettyUgPhone(p.msisdn)}` : ""}</div></div>) },
          { header: "Reference", cell: (p) => (<div className="text-xs"><div>{p.externalReference}</div>{p.financialTransactionId && <div className="text-gray-500">Tx {p.financialTransactionId}</div>}</div>) },
          { header: "Amount", cell: (p) => money(p.amount), className: "text-right" },
          { header: "Status", cell: (p) => (<div><StatusBadge status={p.status} />{p.failureReason && <div className="max-w-48 text-xs text-red-600">{p.failureReason}</div>}</div>) },
        ]}
      />
      <Card title="Refunds" className="mt-6">
        <Table
          rows={refunds ?? []}
          columns={[
            { header: "Date", cell: (r) => dt(r.createdAt) },
            { header: "Order", cell: (r) => <Link className="text-brand-700" href={`/orders/${r.orderId}`}>{r.orderNumber}</Link> },
            { header: "Customer", cell: (r) => r.customerName },
            { header: "Method", cell: (r) => r.method },
            { header: "Reason", cell: (r) => r.reason },
            { header: "By", cell: (r) => r.staffName },
            { header: "Amount", cell: (r) => money(r.amount), className: "text-right" },
            { header: "Status", cell: (r) => <StatusBadge status={r.status} /> },
          ]}
        />
      </Card>
    </>
  );
}
