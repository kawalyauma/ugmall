"use client";

import { useEffect, useState } from "react";
import type { ProductCard } from "@/lib/types";
import { ProductGrid } from "./product-card";
import { trackCommerceEvent } from "./analytics";

const KEY = "ugmall.recently-viewed";
const MAX = 8;

export function RecentlyViewedTracker({ product }: { product: ProductCard }) {
  useEffect(() => {
    try {
      const current = JSON.parse(localStorage.getItem(KEY) ?? "[]") as ProductCard[];
      localStorage.setItem(KEY, JSON.stringify([product, ...current.filter((p) => p.id !== product.id)].slice(0, MAX)));
    } catch {}
    trackCommerceEvent("view_item", { currency: "UGX", value: product.price, items: [{ item_id: product.id, item_name: product.name, price: product.price }] });
  }, [product]);
  return null;
}

export function RecentlyViewedSection() {
  const [items, setItems] = useState<ProductCard[]>([]);
  useEffect(() => {
    try { setItems((JSON.parse(localStorage.getItem(KEY) ?? "[]") as ProductCard[]).slice(0, 4)); } catch {}
  }, []);
  if (!items.length) return null;
  return <section className="container-page mt-10"><div className="mb-4"><div className="text-xs font-bold uppercase tracking-[0.16em] text-brand-700">Pick up where you left off</div><h2 className="mt-1 text-2xl font-black tracking-tight">Recently viewed</h2></div><ProductGrid items={items} /></section>;
}
