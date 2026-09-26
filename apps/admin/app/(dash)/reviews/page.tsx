"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge, Card, PageHeader, StatusBadge, dt } from "@/components/ui/kit";

interface Review {
  id: string;
  productName: string;
  name: string;
  rating: number;
  title: string | null;
  body: string;
  status: string;
  isVerifiedPurchase: boolean;
  reply: string | null;
  images: string[];
  createdAt: string;
}

export default function Reviews() {
  const [status, setStatus] = useState("pending");
  const { data, reload } = useApi<Review[]>(`/admin/reviews?status=${status}`);
  const [replies, setReplies] = useState<Record<string, string>>({});
  const update = async (id: string, body: Record<string, unknown>) => {
    await api(`/admin/reviews/${id}`, { method: "PATCH", body });
    await reload();
  };
  return (
    <>
      <PageHeader title="Reviews" />
      <div className="mb-3 flex gap-2">
        {["pending", "approved", "rejected"].map((s) => (
          <Button key={s} size="sm" variant={status === s ? "primary" : "secondary"} onClick={() => setStatus(s)}>{s}</Button>
        ))}
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        {data?.map((r) => (
          <Card key={r.id}>
            <div className="flex items-start justify-between">
              <div>
                <div className="text-xs text-gray-500">{r.productName}</div>
                <div className="font-semibold">{"★".repeat(r.rating)}{"☆".repeat(5 - r.rating)} {r.name} {r.isVerifiedPurchase && <Badge tone="green">verified</Badge>}</div>
              </div>
              <StatusBadge status={r.status} />
            </div>
            <p className="mt-2 text-sm">{r.body}</p>
            {r.images.length > 0 && <div className="mt-2 flex gap-2">{r.images.map((u) => <img key={u} src={u} alt="" className="size-16 rounded object-cover" />)}</div>}
            <div className="mt-1 text-xs text-gray-400">{dt(r.createdAt)}</div>
            <div className="mt-3 flex gap-2">
              <Input className="h-9 text-sm" placeholder="Public reply (optional)" value={replies[r.id] ?? r.reply ?? ""} onChange={(e) => setReplies((x) => ({ ...x, [r.id]: e.target.value }))} />
              <Button size="sm" onClick={() => update(r.id, { status: "approved", reply: replies[r.id] ?? r.reply })}>Approve</Button>
              <Button size="sm" variant="secondary" onClick={() => update(r.id, { status: "rejected" })}>Reject</Button>
            </div>
          </Card>
        ))}
        {data?.length === 0 && <p className="text-gray-400">No {status} reviews.</p>}
      </div>
    </>
  );
}
