"use client";

import { createContext, useCallback, useContext, useState } from "react";

const Ctx = createContext<(m: string, tone?: "ok" | "error") => void>(() => {});

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [msg, setMsg] = useState<{ m: string; tone: "ok" | "error" } | null>(null);
  const toast = useCallback((m: string, tone: "ok" | "error" = "ok") => {
    setMsg({ m, tone });
    setTimeout(() => setMsg((cur) => (cur?.m === m ? null : cur)), 3500);
  }, []);
  return (
    <Ctx.Provider value={toast}>
      {children}
      {msg && (
        <div role="status" className={`fixed bottom-6 left-1/2 z-[60] -translate-x-1/2 rounded-xl px-4 py-3 text-sm text-white shadow-lg ${msg.tone === "error" ? "bg-red-600" : "bg-gray-900"}`}>
          {msg.m}
        </div>
      )}
    </Ctx.Provider>
  );
}

export const useToast = () => useContext(Ctx);
