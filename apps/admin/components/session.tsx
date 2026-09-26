"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { hasPermission, type Permission } from "@ugmall/shared";
import { api } from "@/lib/api";

export interface Me {
  id: string;
  name: string;
  email: string;
  role: string;
  permissions: string[];
}

const Ctx = createContext<{ me: Me; can: (p: Permission) => boolean } | null>(null);

export function SessionGate({ children }: { children: React.ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const router = useRouter();
  const path = usePathname();
  useEffect(() => {
    api<Me>("/admin/auth/me").then(setMe, () => router.replace(`/login?next=${encodeURIComponent(path)}`));
  }, [router, path]);
  if (!me) return <div className="grid min-h-screen place-items-center text-gray-400">Loading…</div>;
  return <Ctx.Provider value={{ me, can: (p) => hasPermission(me.permissions, p) }}>{children}</Ctx.Provider>;
}

export function useSession() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useSession outside SessionGate");
  return v;
}
