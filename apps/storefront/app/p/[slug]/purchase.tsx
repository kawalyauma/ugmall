"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Heart, MessageCircle, Minus, Plus, Truck } from "lucide-react";
import { buildWhatsAppOrderMessage, formatUGX, whatsappLink } from "@ugmall/shared";
import { api } from "@/lib/api";
import type { Cart, ProductDetail } from "@/lib/types";
import { useStore } from "@/components/providers";
import { Button } from "@/components/ui/button";
import { Price } from "@/components/price";
import { trackCommerceEvent } from "@/components/analytics";
import { cn } from "@/lib/utils";

export function ProductPurchase({ product: p, whatsappNumber }: { product: ProductDetail; whatsappNumber: string }) {
  const router = useRouter();
  const { setCart, toast, customer } = useStore();
  const axes = p.optionNames.length ? p.optionNames : [...new Set(p.variants.flatMap((v) => Object.keys(v.options)))];
  const [selected, setSelected] = useState<Record<string, string>>(() => (p.variants.length === 1 ? { ...p.variants[0]!.options } : {}));
  const [qty, setQty] = useState(1);
  const [imgIdx, setImgIdx] = useState(0);
  const [busy, setBusy] = useState<"cart" | "buy" | null>(null);

  const variant = useMemo(() => p.variants.find((v) => axes.every((a) => v.options[a] === selected[a])) ?? null, [p.variants, axes, selected]);
  const needsChoice = axes.length > 0 && !variant;
  const valuesFor = (axis: string) => [...new Set(p.variants.map((v) => v.options[axis]).filter(Boolean))] as string[];
  const availableFor = (axis: string, value: string) =>
    p.variants.some((v) => v.options[axis] === value && v.available > 0 && axes.every((a) => a === axis || !selected[a] || v.options[a] === selected[a]));

  const images = p.images.length ? p.images : [];
  const shownImage = (variant && images.find((i) => i.variantId === variant.id)) || images[imgIdx];
  const price = variant?.price ?? p.price;
  const compareAt = variant ? variant.compareAt : p.compareAt;

  async function add(buyNow: boolean) {
    if (!variant) return toast(`Please choose a ${axes.find((a) => !selected[a])?.toLowerCase() ?? "option"}`);
    setBusy(buyNow ? "buy" : "cart");
    try {
      const cart = await api<Cart>("/store/cart/items", { body: { variantId: variant.id, quantity: qty } });
      setCart(cart);
      toast(cart.notice ?? "Added to cart");
      trackCommerceEvent("add_to_cart", { currency: "UGX", value: price * qty, items: [{ item_id: p.id, item_name: p.name, item_variant: variant.sku, price, quantity: qty }] });
      if (buyNow) router.push("/checkout");
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function wishlist() {
    if (!customer) return router.push(`/account?next=/p/${p.slug}`);
    await api(`/store/account/wishlist/${p.id}`, { method: "PUT" }).then(() => toast("Saved to wishlist"), (e) => toast((e as Error).message));
  }

  const waMessage = buildWhatsAppOrderMessage(
    [{ productName: p.name, options: variant?.options ?? selected, quantity: qty, unitPrice: price, sku: variant?.sku ?? p.sku }],
    { productUrl: typeof window !== "undefined" ? window.location.href : undefined },
  );

  return (
    <div className="grid gap-6 md:grid-cols-2">
      <div>
        <div className="aspect-[4/5] overflow-hidden rounded-2xl bg-gray-100">
          {shownImage ? <img src={shownImage.url ?? ""} alt={shownImage.alt ?? p.name} className="size-full object-cover" /> : <div className="grid size-full place-items-center text-gray-400">No image</div>}
        </div>
        {images.length > 1 && (
          <div className="mt-2 flex gap-2 overflow-x-auto">
            {images.map((im, i) => (
              <button key={im.id} onClick={() => setImgIdx(i)} className={cn("size-16 shrink-0 overflow-hidden rounded-lg border-2", i === imgIdx ? "border-brand-700" : "border-transparent")}>
                <img src={im.thumb ?? im.url ?? ""} alt="" className="size-full object-cover" />
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-5">
        <div>
          {p.brand && <div className="text-sm text-gray-500">{p.brand}</div>}
          <h1 className="text-2xl font-bold leading-tight">{p.name}</h1>
          <div className="mt-1 text-xs text-gray-500">SKU: {variant?.sku ?? p.sku}</div>
          <div className="mt-3">
            <Price price={price} compareAt={compareAt} size="lg" />
          </div>
        </div>

        {axes.map((axis) => (
          <div key={axis}>
            <div className="mb-2 text-sm font-semibold">
              {axis}: <span className="font-normal text-gray-600">{selected[axis] ?? "choose"}</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {valuesFor(axis).map((val) => {
                const ok = availableFor(axis, val);
                const active = selected[axis] === val;
                return (
                  <button
                    key={val}
                    onClick={() => setSelected((s) => ({ ...s, [axis]: val }))}
                    className={cn(
                      "min-w-12 rounded-xl border px-3 py-2.5 text-sm font-medium transition",
                      active ? "border-brand-700 bg-brand-700 text-white" : "border-gray-300 bg-white",
                      !ok && !active && "border-dashed text-gray-400 line-through",
                    )}
                  >
                    {val}
                  </button>
                );
              })}
            </div>
            {axis.toLowerCase().includes("size") && <details className="mt-2 rounded-xl bg-gray-50 px-3 py-2 text-xs text-gray-600"><summary className="cursor-pointer font-semibold text-brand-700">Size guide</summary><p className="mt-2 leading-relaxed">Choose your usual clothing size. Imported products can vary slightly by maker, so check the product details and measurements where provided. If unsure, use WhatsApp support before ordering.</p></details>}
          </div>
        ))}

        {variant && (
          <div className={cn("text-sm font-medium", variant.available === 0 ? "text-red-600" : variant.lowStock ? "text-amber-600" : "text-green-700")}>
            {variant.available === 0 ? "Sold out in this size" : variant.lowStock ? `Only ${variant.available} left!` : "In stock"}
          </div>
        )}

        <div className="flex items-center gap-3">
          <div className="flex items-center rounded-xl border border-gray-300 bg-white">
            <button className="p-3" onClick={() => setQty((q) => Math.max(1, q - 1))} aria-label="Decrease">
              <Minus className="size-4" />
            </button>
            <span className="w-8 text-center font-semibold">{qty}</span>
            <button className="p-3" onClick={() => setQty((q) => Math.min(variant?.available || 10, q + 1))} aria-label="Increase">
              <Plus className="size-4" />
            </button>
          </div>
          <button onClick={wishlist} className="rounded-xl border border-gray-300 bg-white p-3" aria-label="Add to wishlist">
            <Heart className="size-5" />
          </button>
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          <Button size="lg" variant="secondary" onClick={() => add(false)} loading={busy === "cart"} disabled={variant?.available === 0}>
            Add to cart
          </Button>
          <Button size="lg" onClick={() => add(true)} loading={busy === "buy"} disabled={variant?.available === 0}>
            Buy now
          </Button>
        </div>
        <a
          href={whatsappLink(whatsappNumber, waMessage)}
          target="_blank"
          rel="noreferrer"
          aria-disabled={needsChoice}
          onClick={(e) => {
            if (needsChoice) {
              e.preventDefault();
              toast("Choose your size first so we know what to send");
            }
          }}
          className="flex h-12 items-center justify-center gap-2 rounded-xl bg-whatsapp font-semibold text-white"
        >
          <MessageCircle className="size-5" /> Order on WhatsApp
        </a>

        <div className="space-y-2 rounded-2xl bg-brand-50 p-4 text-sm text-brand-800">
          <div className="flex items-center gap-2 font-semibold">
            <Truck className="size-4" /> Delivery across Uganda
          </div>
          <p>Kampala boda delivery from {formatUGX(5000)} • Upcountry by bus parcel or courier • Pay with MTN MoMo, Airtel Money or cash on delivery.</p>
        </div>
      </div>
    </div>
  );
}
