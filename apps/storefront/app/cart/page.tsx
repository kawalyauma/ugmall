"use client";

import Link from "next/link";
import { Minus, Plus, Trash2, MessageCircle } from "lucide-react";
import { buildWhatsAppOrderMessage, formatUGX, whatsappLink } from "@ugmall/shared";
import { api } from "@/lib/api";
import type { Cart } from "@/lib/types";
import { useStore } from "@/components/providers";
import { Button } from "@/components/ui/button";

export default function CartPage() {
  const { cart, setCart, toast, settings } = useStore();

  async function setQty(variantId: string, quantity: number) {
    try {
      setCart(await api<Cart>(`/store/cart/items/${variantId}`, { method: "PATCH", body: { quantity } }));
    } catch (e) {
      toast((e as Error).message);
    }
  }

  if (!cart.items.length) {
    return (
      <div className="container-page py-16 text-center">
        <h1 className="text-xl font-bold">Your cart is empty</h1>
        <p className="mt-2 text-gray-500">Find something you love.</p>
        <Link href="/" className="mt-6 inline-block rounded-xl bg-brand-700 px-6 py-3 font-semibold text-white">
          Start shopping
        </Link>
      </div>
    );
  }

  const wa = buildWhatsAppOrderMessage(cart.items.map((i) => ({ productName: i.productName, options: i.options, quantity: i.quantity, unitPrice: i.unitPrice, sku: i.sku })));

  return (
    <div className="container-page grid gap-6 py-5 md:grid-cols-[1fr_340px]">
      <div>
        <h1 className="mb-4 text-2xl font-bold">Cart ({cart.count})</h1>
        <div className="space-y-3">
          {cart.items.map((i) => (
            <div key={i.variantId} className="flex gap-3 rounded-2xl border border-gray-200 bg-white p-3">
              <Link href={`/p/${i.productSlug}`} className="size-24 shrink-0 overflow-hidden rounded-xl bg-gray-100">
                {i.imageUrl && <img src={i.imageUrl} alt="" className="size-full object-cover" />}
              </Link>
              <div className="flex min-w-0 flex-1 flex-col">
                <Link href={`/p/${i.productSlug}`} className="line-clamp-2 text-sm font-medium">
                  {i.productName}
                </Link>
                <div className="text-xs text-gray-500">{i.variantLabel}</div>
                {i.quantity > i.available && <div className="text-xs font-medium text-red-600">Only {i.available} available</div>}
                <div className="mt-auto flex items-center justify-between pt-2">
                  <div className="flex items-center rounded-lg border border-gray-300">
                    <button className="p-2" onClick={() => setQty(i.variantId, i.quantity - 1)} aria-label="Decrease">
                      <Minus className="size-3.5" />
                    </button>
                    <span className="w-7 text-center text-sm font-semibold">{i.quantity}</span>
                    <button className="p-2" onClick={() => setQty(i.variantId, Math.min(i.available, i.quantity + 1))} aria-label="Increase">
                      <Plus className="size-3.5" />
                    </button>
                  </div>
                  <div className="font-semibold">{formatUGX(i.lineTotal)}</div>
                  <button onClick={() => setQty(i.variantId, 0)} className="p-2 text-gray-400 hover:text-red-600" aria-label="Remove">
                    <Trash2 className="size-4" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
      <aside className="h-fit space-y-3 rounded-2xl border border-gray-200 bg-white p-5 md:sticky md:top-28">
        <div className="flex justify-between">
          <span>Subtotal</span>
          <span className="font-bold">{formatUGX(cart.subtotal)}</span>
        </div>
        <p className="text-xs text-gray-500">Delivery fee is calculated at checkout.</p>
        <Link href="/checkout" className="block">
          <Button size="lg" className="w-full" disabled={cart.hasStockIssues}>
            Checkout
          </Button>
        </Link>
        <a href={whatsappLink(settings.whatsappNumber, wa)} target="_blank" rel="noreferrer" className="flex h-11 items-center justify-center gap-2 rounded-xl bg-whatsapp text-sm font-semibold text-white">
          <MessageCircle className="size-4" /> Send cart on WhatsApp
        </a>
        <p className="text-center text-xs text-gray-500">No account needed — checkout as a guest.</p>
      </aside>
    </div>
  );
}
