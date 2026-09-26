"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Input } from "./ui/input";
import { money } from "./ui/kit";

export interface VariantHit {
  id: string;
  sku: string;
  options: Record<string, string>;
  productName: string;
  price: number;
  costPrice: number;
  onHand: number;
  reserved: number;
}

/** Type-ahead search over variants by SKU or product name. */
export function VariantPicker({ onPick, placeholder = "Search product or SKU…" }: { onPick: (v: VariantHit) => void; placeholder?: string }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<VariantHit[]>([]);
  useEffect(() => {
    if (q.trim().length < 2) return setHits([]);
    const t = setTimeout(() => api<VariantHit[]>(`/admin/variant-search?q=${encodeURIComponent(q)}`).then(setHits, () => {}), 250);
    return () => clearTimeout(t);
  }, [q]);
  return (
    <div className="relative">
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} />
      {hits.length > 0 && (
        <div className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-xl border border-gray-200 bg-white shadow-lg">
          {hits.map((h) => (
            <button
              key={h.id}
              type="button"
              className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-gray-50"
              onClick={() => {
                onPick(h);
                setQ("");
                setHits([]);
              }}
            >
              <span>
                {h.productName} <span className="text-gray-500">{Object.values(h.options).join(" / ")}</span>
                <span className="block text-xs text-gray-400">{h.sku}</span>
              </span>
              <span className="text-right text-xs">
                {money(h.price)}
                <span className={`block ${h.onHand - h.reserved > 0 ? "text-green-700" : "text-red-600"}`}>{h.onHand - h.reserved} available</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
