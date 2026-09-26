"use client";

import { useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import { useToast } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Modal, PageHeader, StatusBadge, Table, dt, money } from "@/components/ui/kit";

interface Ret {
  id: string;
  orderId: string;
  orderNumber: string;
  customerName: string;
  reason: string;
  status: string;
  items: { orderItemId: string; quantity: number; condition: string }[];
  refundAmount: number | null;
  createdAt: string;
}

export default function Returns() {
  const toast = useToast();
  const { data, reload } = useApi<Ret[]>("/admin/returns");
  const [receiving, setReceiving] = useState<Ret | null>(null);
  const [refund, setRefund] = useState("");
  const [notes, setNotes] = useState("");

  const act = async (r: Ret, action: string, body: Record<string, unknown> = {}) => {
    try {
      await api(`/admin/returns/${r.id}/${action}`, { body });
      toast("Updated");
      setReceiving(null);
      await reload();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  return (
    <>
      <PageHeader title="Returns" subtitle="Receiving a return restocks resellable items and writes off damaged ones." />
      <Table
        rows={data ?? []}
        columns={[
          { header: "Date", cell: (r) => dt(r.createdAt) },
          { header: "Order", cell: (r) => <Link className="text-brand-700" href={`/orders/${r.orderId}`}>{r.orderNumber}</Link> },
          { header: "Customer", cell: (r) => r.customerName },
          { header: "Reason", cell: (r) => r.reason },
          { header: "Items", cell: (r) => r.items.map((i) => `${i.quantity} ${i.condition}`).join(", ") },
          { header: "Refund", cell: (r) => money(r.refundAmount) },
          { header: "Status", cell: (r) => <StatusBadge status={r.status} /> },
          {
            header: "",
            cell: (r) =>
              ["requested", "approved"].includes(r.status) ? (
                <div className="flex gap-1">
                  {r.status === "requested" && <Button size="sm" variant="secondary" onClick={() => act(r, "approve")}>Approve</Button>}
                  <Button size="sm" onClick={() => setReceiving(r)}>Receive</Button>
                  <Button size="sm" variant="ghost" className="text-red-600" onClick={() => act(r, "reject")}>Reject</Button>
                </div>
              ) : null,
          },
        ]}
      />
      <Modal open={!!receiving} onClose={() => setReceiving(null)} title="Receive returned goods">
        <div className="space-y-3">
          <Field label="Refund amount (UGX, optional)" hint="Sent back via the original payment method"><Input type="number" value={refund} onChange={(e) => setRefund(e.target.value)} /></Field>
          <Field label="Notes"><Input value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
        </div>
        <Button className="mt-4 w-full" onClick={() => receiving && act(receiving, "receive", { refundAmount: refund ? Number(refund) : undefined, staffNotes: notes || undefined })}>
          Confirm received
        </Button>
      </Modal>
    </>
  );
}
