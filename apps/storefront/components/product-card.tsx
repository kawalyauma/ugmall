"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Heart, Loader2, ShoppingCart, Star, Truck } from "lucide-react";
import { api } from "@/lib/api";
import type { Cart, ProductCard as P, ProductDetail } from "@/lib/types";
import { useStore } from "./providers";
import { Price } from "./price";
import { cn } from "@/lib/utils";

export function ProductCard({ p }: { p: P }) {
  const router = useRouter();
  const { customer, setCart, toast } = useStore();
  const [quickBusy, setQuickBusy] = useState(false);
  const [wishBusy, setWishBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  async function quickAdd() {
    if (!p.inStock) return toast("This product is currently sold out");
    setQuickBusy(true);
    try {
      const detail = await api<ProductDetail>(`/store/products/${encodeURIComponent(p.slug)}`);
      const available = detail.variants.filter((v) => v.available > 0);
      if (available.length === 1) {
        const cart = await api<Cart>("/store/cart/items", { body: { variantId: available[0]!.id, quantity: 1 } });
        setCart(cart);
        toast(cart.notice ?? "Added to cart");
      } else {
        router.push(`/p/${p.slug}?quick=1`);
        toast("Choose your size or colour to continue");
      }
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setQuickBusy(false);
    }
  }

  async function wishlist() {
    if (!customer) return router.push(`/account?next=/p/${p.slug}`);
    setWishBusy(true);
    try {
      await api(`/store/account/wishlist/${p.id}`, { method: "PUT" });
      setSaved(true);
      toast("Saved to wishlist");
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setWishBusy(false);
    }
  }

  return (
    <article className="group overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
      <div className="relative">
        <Link href={`/p/${p.slug}`} className="block">
          <div className="relative aspect-[4/5] bg-white p-2 sm:p-3">
            {p.image ? (
              <img
                src={p.image.medium ?? p.image.url ?? ""}
                srcSet={[p.image.thumb && `${p.image.thumb} 400w`, p.image.medium && `${p.image.medium} 800w`].filter(Boolean).join(", ")}
                sizes="(min-width: 1024px) 25vw, (min-width: 640px) 33vw, 50vw"
                alt={p.image.alt ?? p.name}
                loading="lazy"
                className="size-full object-contain transition duration-300 group-hover:scale-[1.02]"
              />
            ) : (
              <div className="grid size-full place-items-center rounded-xl bg-gray-50 text-xs text-gray-400">No image</div>
            )}
            {p.discountPercent > 0 && <span className="absolute left-2 top-2 rounded-full bg-accent px-2 py-0.5 text-xs font-bold text-white">-{p.discountPercent}%</span>}
            {!p.inStock && <span className="absolute inset-x-2 bottom-2 rounded-lg bg-gray-900/80 py-1.5 text-center text-xs font-semibold text-white">Sold out</span>}
          </div>
        </Link>
        <button
          type="button"
          onClick={wishlist}
          disabled={wishBusy}
          aria-label={saved ? "Saved to wishlist" : "Add to wishlist"}
          className={cn("absolute right-2 top-2 grid size-9 place-items-center rounded-full border border-gray-200 bg-white/95 shadow-sm transition hover:bg-gray-50", saved && "text-rose-600")}
        >
          {wishBusy ? <Loader2 className="size-4 animate-spin" /> : <Heart className={cn("size-4", saved && "fill-current")} />}
        </button>
      </div>

      <div className="space-y-2 p-3">
        <Link href={`/p/${p.slug}`} className="block">
          <h3 className="line-clamp-2 min-h-10 text-sm font-semibold leading-5 text-gray-900">{p.name}</h3>
        </Link>
        <Price price={p.price} compareAt={p.compareAt} size="sm" />

        {p.rating ? (
          <div className="flex items-center gap-1 text-xs text-gray-500">
            <Star className="size-3 fill-accent text-accent" /> {p.rating.average.toFixed(1)} <span>({p.rating.count})</span>
          </div>
        ) : (
          <div className="text-xs text-gray-400">New item</div>
        )}

        {(p.sizes.length > 0 || p.colours.length > 0) && (
          <div className="flex min-h-5 flex-wrap gap-1 text-[11px] text-gray-600">
            {p.sizes.slice(0, 3).map((s) => <span key={s} className="rounded-md bg-gray-100 px-1.5 py-0.5">{s}</span>)}
            {p.sizes.length > 3 && <span className="px-1 py-0.5">+{p.sizes.length - 3}</span>}
            {p.sizes.length === 0 && p.colours.slice(0, 2).map((c) => <span key={c} className="rounded-md bg-gray-100 px-1.5 py-0.5">{c}</span>)}
          </div>
        )}

        <div className="flex items-center gap-1 text-[11px] text-gray-500">
          <Truck className="size-3.5 text-brand-700" /> Delivery available across Uganda
        </div>

        <button
          type="button"
          onClick={quickAdd}
          disabled={quickBusy || !p.inStock}
          className="flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-brand-700 px-3 text-sm font-bold text-white transition hover:bg-brand-800 disabled:cursor-not-allowed disabled:bg-gray-300"
        >
          {quickBusy ? <Loader2 className="size-4 animate-spin" /> : <ShoppingCart className="size-4" />}
          {p.inStock ? "Add to cart" : "Sold out"}
        </button>
      </div>
    </article>
  );
}

export function ProductGrid({ items }: { items: P[] }) {
  if (!items.length) return <p className="py-12 text-center text-gray-500">No products found.</p>;
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:gap-4 lg:grid-cols-4">
      {items.map((p) => <ProductCard key={p.id} p={p} />)}
    </div>
  );
}
