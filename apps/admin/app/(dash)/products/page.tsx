"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { qs } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { PageHeader, StatusBadge, Table, money } from "@/components/ui/kit";

interface Row {
  id: string;
  name: string;
  sku: string;
  price: number;
  salePrice: number | null;
  status: string;
  categoryName: string | null;
  variantCount: number;
  onHand: number;
  reserved: number;
  image: string | null;
}

export default function Products() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const { data } = useApi<{ items: Row[]; total: number }>(`/admin/products${qs({ q, status, limit: 200 })}`);
  return (
    <>
      <PageHeader
        title="Products"
        subtitle={data ? `${data.total} products` : undefined}
        actions={
          <Link href="/products/new">
            <Button size="sm"><Plus className="size-4" /> Add product</Button>
          </Link>
        }
      />
      <div className="mb-3 flex gap-2">
        <Input className="h-10 max-w-xs" placeholder="Search name or SKU" value={q} onChange={(e) => setQ(e.target.value)} />
        <Select className="h-10 max-w-40" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="draft">Draft</option>
          <option value="archived">Archived</option>
        </Select>
      </div>
      <Table
        rows={data?.items ?? []}
        onRowClick={(p) => router.push(`/products/${p.id}`)}
        columns={[
          { header: "", cell: (p) => (p.image ? <img src={p.image} alt="" className="size-10 rounded object-cover" /> : <div className="size-10 rounded bg-gray-100" />) },
          { header: "Product", cell: (p) => (<div><div className="font-medium">{p.name}</div><div className="text-xs text-gray-500">{p.sku}</div></div>) },
          { header: "Category", cell: (p) => p.categoryName ?? "—" },
          { header: "Price", cell: (p) => (<>{money(p.salePrice ?? p.price)}{p.salePrice ? <div className="text-xs text-gray-400 line-through">{money(p.price)}</div> : null}</>) },
          { header: "Variants", cell: (p) => p.variantCount },
          { header: "Stock", cell: (p) => (<span className={p.onHand - p.reserved <= 0 ? "text-red-600" : ""}>{p.onHand - p.reserved} <span className="text-xs text-gray-400">({p.reserved} reserved)</span></span>) },
          { header: "Status", cell: (p) => <StatusBadge status={p.status} /> },
        ]}
      />
    </>
  );
}
