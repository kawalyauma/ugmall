"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  BarChart3, Bike, Boxes, ClipboardList, CreditCard, Gauge, LogOut, Megaphone, Menu, Package, Settings, Star, Tag, Truck, Undo2, UserCog, Users, Warehouse, Wallet, X,
} from "lucide-react";
import { PERMISSIONS as P, type Permission } from "@ugmall/shared";
import { SessionGate, useSession } from "@/components/session";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

const NAV: { group: string; items: { href: string; label: string; icon: typeof Gauge; perm: Permission }[] }[] = [
  { group: "", items: [{ href: "/", label: "Dashboard", icon: Gauge, perm: P.dashboard }] },
  {
    group: "Catalogue",
    items: [
      { href: "/products", label: "Products", icon: Package, perm: P.productsView },
      { href: "/categories", label: "Categories & brands", icon: Tag, perm: P.productsView },
      { href: "/inventory", label: "Inventory", icon: Boxes, perm: P.inventoryView },
    ],
  },
  {
    group: "Sales",
    items: [
      { href: "/orders", label: "Orders", icon: ClipboardList, perm: P.ordersView },
      { href: "/payments", label: "Payments & refunds", icon: CreditCard, perm: P.paymentsView },
      { href: "/deliveries", label: "Deliveries", icon: Truck, perm: P.ordersView },
      { href: "/returns", label: "Returns", icon: Undo2, perm: P.ordersView },
      { href: "/customers", label: "Customers", icon: Users, perm: P.customersView },
      { href: "/reviews", label: "Reviews", icon: Star, perm: P.reviewsManage },
    ],
  },
  {
    group: "Purchasing",
    items: [{ href: "/purchases", label: "Suppliers & purchases", icon: Warehouse, perm: P.purchasesManage }],
  },
  {
    group: "Marketing",
    items: [{ href: "/promotions", label: "Promotions & coupons", icon: Megaphone, perm: P.promotionsManage }],
  },
  {
    group: "Business",
    items: [
      { href: "/reports", label: "Reports", icon: BarChart3, perm: P.reportsView },
      { href: "/expenses", label: "Expenses", icon: Wallet, perm: P.expensesManage },
    ],
  },
  {
    group: "Admin",
    items: [
      { href: "/staff", label: "Staff & roles", icon: UserCog, perm: P.staffManage },
      { href: "/settings", label: "Settings", icon: Settings, perm: P.settingsManage },
      { href: "/rider", label: "Rider app", icon: Bike, perm: P.riderApp },
    ],
  },
];

function Shell({ children }: { children: React.ReactNode }) {
  const { me, can } = useSession();
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const nav = (
    <nav className="space-y-4 p-3 text-sm">
      {NAV.map((g) => {
        const items = g.items.filter((i) => can(i.perm));
        if (!items.length) return null;
        return (
          <div key={g.group || "main"}>
            {g.group && <div className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-gray-400">{g.group}</div>}
            {items.map((i) => {
              const active = i.href === "/" ? path === "/" : path.startsWith(i.href);
              return (
                <Link key={i.href} href={i.href} onClick={() => setOpen(false)} className={cn("flex items-center gap-3 rounded-lg px-3 py-2", active ? "bg-brand-700 text-white" : "text-gray-700 hover:bg-gray-100")}>
                  <i.icon className="size-4" /> {i.label}
                </Link>
              );
            })}
          </div>
        );
      })}
    </nav>
  );
  return (
    <div className="min-h-screen md:grid md:grid-cols-[240px_1fr]">
      <aside className="no-print sticky top-0 hidden h-screen overflow-y-auto border-r border-gray-200 bg-white md:block">
        <div className="px-6 py-4 text-lg font-extrabold text-brand-700">Shop Admin</div>
        {nav}
      </aside>
      {open && (
        <div className="no-print fixed inset-0 z-40 bg-black/40 md:hidden" onClick={() => setOpen(false)}>
          <aside className="h-full w-72 overflow-y-auto bg-white" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4">
              <span className="text-lg font-extrabold text-brand-700">Shop Admin</span>
              <button onClick={() => setOpen(false)} aria-label="Close menu">
                <X className="size-5" />
              </button>
            </div>
            {nav}
          </aside>
        </div>
      )}
      <div className="min-w-0">
        <header className="no-print sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-gray-200 bg-white px-4">
          <button className="md:hidden" onClick={() => setOpen(true)} aria-label="Open menu">
            <Menu className="size-5" />
          </button>
          <div className="ml-auto text-right text-sm leading-tight">
            <div className="font-medium">{me.name}</div>
            <div className="text-xs capitalize text-gray-500">{me.role}</div>
          </div>
          <button
            onClick={async () => {
              await api("/admin/auth/logout", { method: "POST" });
              window.location.href = "/login";
            }}
            className="rounded-lg p-2 text-gray-500 hover:bg-gray-100"
            aria-label="Sign out"
          >
            <LogOut className="size-4" />
          </button>
        </header>
        <main className="print-full p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}

export default function DashLayout({ children }: { children: React.ReactNode }) {
  return (
    <SessionGate>
      <Shell>{children}</Shell>
    </SessionGate>
  );
}
