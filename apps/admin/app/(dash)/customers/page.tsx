"use client";

import { useState } from "react";
import Link from "next/link";
import { prettyUgPhone } from "@ugmall/shared";
import { api, qs } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import { useToast } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/input";
import { Badge, Modal, PageHeader, StatusBadge, Table, dt, money } from "@/components/ui/kit";

interface Cust {
  id: string;
  name: string;
  phone: string;
  altPhone: string | null;
  email: string | null;
  isRegistered: boolean;
  isBlocked: boolean;
  notes: string | null;
  orderCount: number;
  totalSpent: number;
  lastOrderAt: string | null;
}
interface CustDetail extends Cust {
  orders: { id: string; orderNumber: string; status: string; total: number; createdAt: string }[];
  messages: { id: string; direction: string; body: string; createdAt: string }[];
}

export default function Customers() {
  const toast = useToast();
  const [q, setQ] = useState("");
  const { data } = useApi<{ items: Cust[]; total: number }>(`/admin/customers${qs({ q, limit: 200 })}`);
  const [openId, setOpenId] = useState<string | null>(null);
  const { data: d, reload } = useApi<CustDetail>(openId ? `/admin/customers/${openId}` : null);
  const [notes, setNotes] = useState<string | null>(null);

  return (
    <>
      <PageHeader title="Customers" subtitle={data ? `${data.total} customers (guests are saved by phone number)` : undefined} />
      <Input className="mb-3 h-10 max-w-xs" placeholder="Name or phone" value={q} onChange={(e) => setQ(e.target.value)} />
      <Table
        rows={data?.items ?? []}
        onRowClick={(c) => { setOpenId(c.id); setNotes(null); }}
        columns={[
          { header: "Name", cell: (c) => (<>{c.name} {c.isBlocked && <Badge tone="red">blocked</Badge>} {c.isRegistered && <Badge tone="brand">account</Badge>}</>) },
          { header: "Phone", cell: (c) => prettyUgPhone(c.phone) },
          { header: "Orders", cell: (c) => c.orderCount },
          { header: "Spent", cell: (c) => money(c.totalSpent), className: "text-right" },
          { header: "Last order", cell: (c) => dt(c.lastOrderAt) },
        ]}
      />
      <Modal open={!!openId && !!d} onClose={() => setOpenId(null)} title={d?.name ?? ""} wide>
        {d && (
          <div className="space-y-4 text-sm">
            <div className="flex flex-wrap gap-4">
              <a className="text-brand-700" href={`tel:+${d.phone}`}>{prettyUgPhone(d.phone)}</a>
              <a className="text-green-700" href={`https://wa.me/${d.phone}`} target="_blank" rel="noreferrer">WhatsApp</a>
              {d.email && <span>{d.email}</span>}
            </div>
            <Field label="Notes"><Textarea value={notes ?? d.notes ?? ""} onChange={(e) => setNotes(e.target.value)} /></Field>
            <div className="flex gap-2">
              <Button size="sm" disabled={notes === null} onClick={async () => { await api(`/admin/customers/${d.id}`, { method: "PATCH", body: { notes } }); toast("Saved"); }}>Save notes</Button>
              <Button size="sm" variant={d.isBlocked ? "secondary" : "danger"} onClick={async () => { await api(`/admin/customers/${d.id}`, { method: "PATCH", body: { isBlocked: !d.isBlocked } }); await reload(); }}>
                {d.isBlocked ? "Unblock" : "Block (fake orders)"}
              </Button>
            </div>
            <Table
              rows={d.orders}
              columns={[
                { header: "Order", cell: (o) => <Link className="text-brand-700" href={`/orders/${o.id}`}>{o.orderNumber}</Link> },
                { header: "Date", cell: (o) => dt(o.createdAt) },
                { header: "Total", cell: (o) => money(o.total) },
                { header: "Status", cell: (o) => <StatusBadge status={o.status} /> },
              ]}
            />
            {d.messages.length > 0 && (
              <div>
                <div className="mb-1 font-medium">WhatsApp messages</div>
                <div className="max-h-60 space-y-1 overflow-y-auto">
                  {d.messages.map((m) => (
                    <div key={m.id} className={`rounded-lg p-2 ${m.direction === "inbound" ? "bg-gray-100" : "ml-8 bg-green-50"}`}>
                      <div className="whitespace-pre-line">{m.body}</div>
                      <div className="text-[10px] text-gray-400">{dt(m.createdAt)}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </Modal>
    </>
  );
}
