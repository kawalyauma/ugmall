"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { api } from "@/lib/api";
import type { Cart, ShopSettings } from "@/lib/types";

interface Customer {
  id: string;
  name: string;
  phone: string;
}

interface StoreCtx {
  settings: ShopSettings;
  cart: Cart;
  refreshCart: () => Promise<void>;
  setCart: (c: Cart) => void;
  /** Bumps whenever the cart grows, so the cart badge can animate. */
  cartBump: number;
  customer: Customer | null | undefined;
  refreshCustomer: () => Promise<void>;
  toast: (msg: string) => void;
}

const Ctx = createContext<StoreCtx | null>(null);
const EMPTY: Cart = { items: [], count: 0, subtotal: 0, hasStockIssues: false };

export function StoreProvider({ settings, children }: { settings: ShopSettings; children: React.ReactNode }) {
  const [cart, setCartState] = useState<Cart>(EMPTY);
  const [cartBump, setCartBump] = useState(0);
  const lastCount = useRef(0);
  const setCart = useCallback((c: Cart) => {
    if (c.count > lastCount.current) setCartBump((n) => n + 1);
    lastCount.current = c.count;
    setCartState(c);
  }, []);
  const [customer, setCustomer] = useState<Customer | null | undefined>(undefined);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const refreshCart = useCallback(async () => {
    const c = await api<Cart>("/store/cart").catch(() => EMPTY);
    lastCount.current = c.count;
    setCartState(c);
  }, []);
  const refreshCustomer = useCallback(async () => {
    setCustomer(await api<Customer | null>("/store/account/me").catch(() => null));
  }, []);
  const toast = useCallback((m: string) => {
    setToastMsg(m);
    setTimeout(() => setToastMsg((cur) => (cur === m ? null : cur)), 3000);
  }, []);

  useEffect(() => {
    void refreshCart();
    void refreshCustomer();
  }, [refreshCart, refreshCustomer]);

  return (
    <Ctx.Provider value={{ settings, cart, refreshCart, setCart, cartBump, customer, refreshCustomer, toast }}>
      {children}
      {toastMsg && (
        <div
          key={toastMsg}
          role="status"
          className="fixed inset-x-4 bottom-24 z-50 mx-auto flex max-w-sm animate-toast-in items-center gap-3 rounded-2xl bg-gray-900 px-4 py-3 text-sm text-white shadow-xl md:bottom-8"
        >
          {/added to cart/i.test(toastMsg) ? (
            <>
              <CheckCircle2 className="size-5 shrink-0 text-emerald-400" />
              <span className="flex-1">{toastMsg}</span>
              <Link href="/cart" className="shrink-0 rounded-lg bg-white/15 px-3 py-1.5 text-xs font-bold hover:bg-white/25">
                View cart
              </Link>
            </>
          ) : (
            <span className="flex-1 text-center">{toastMsg}</span>
          )}
        </div>
      )}
    </Ctx.Provider>
  );
}

export function useStore() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useStore outside StoreProvider");
  return v;
}
