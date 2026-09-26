"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import type { ProductCard as P } from "@/lib/types";
import { useStore } from "@/components/providers";
import { ProductCard } from "@/components/product-card";

export default function WishlistPage() {
  const { customer } = useStore();
  const [items, setItems] = useState<P[] | null>(null);
  useEffect(() => {
    if (customer) api<P[]>("/store/account/wishlist").then(setItems, () => setItems([]));
  }, [customer]);

  if (customer === null)
    return (
      <div className="container-page py-16 text-center">
        <p>Sign in to save items to your wishlist.</p>
        <Link href="/account?next=/account/wishlist" className="mt-3 inline-block text-brand-700">
          Sign in →
        </Link>
      </div>
    );
  return (
    <div className="container-page py-5">
      <h1 className="mb-4 text-2xl font-bold">Wishlist</h1>
      {items === null ? (
        <p className="text-gray-400">Loading…</p>
      ) : items.length === 0 ? (
        <p className="text-gray-500">Nothing saved yet.</p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {items.map((p) => (
            <div key={p.id} className="relative">
              <ProductCard p={p} />
              <button
                onClick={async () => {
                  await api(`/store/account/wishlist/${p.id}`, { method: "DELETE" });
                  setItems((xs) => xs?.filter((x) => x.id !== p.id) ?? null);
                }}
                className="absolute right-2 top-2 rounded-full bg-white/90 px-2 py-1 text-xs shadow"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
