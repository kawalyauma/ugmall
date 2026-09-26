"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
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
  customer: Customer | null | undefined;
  refreshCustomer: () => Promise<void>;
  toast: (msg: string) => void;
}

const Ctx = createContext<StoreCtx | null>(null);
const EMPTY: Cart = { items: [], count: 0, subtotal: 0, hasStockIssues: false };

export function StoreProvider({ settings, children }: { settings: ShopSettings; children: React.ReactNode }) {
  const [cart, setCart] = useState<Cart>(EMPTY);
  const [customer, setCustomer] = useState<Customer | null | undefined>(undefined);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const refreshCart = useCallback(async () => {
    setCart(await api<Cart>("/store/cart").catch(() => EMPTY));
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
    <Ctx.Provider value={{ settings, cart, refreshCart, setCart, customer, refreshCustomer, toast }}>
      {children}
      {toastMsg && (
        <div role="status" className="fixed inset-x-4 bottom-24 z-50 mx-auto max-w-sm rounded-xl bg-gray-900 px-4 py-3 text-center text-sm text-white shadow-lg md:bottom-8">
          {toastMsg}
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
