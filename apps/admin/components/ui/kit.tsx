"use client";

import { useEffect } from "react";
import { X } from "lucide-react";
import { ORDER_STATUS_LABELS, formatUGX, type OrderStatus } from "@ugmall/shared";
import { cn } from "@/lib/utils";

export function Card({ className, children, title, actions }: { className?: string; children: React.ReactNode; title?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <section className={cn("rounded-2xl border border-gray-200 bg-white p-4 shadow-sm", className)}>
      {(title || actions) && (
        <div className="mb-3 flex items-center justify-between gap-2">
          {title && <h2 className="font-semibold">{title}</h2>}
          {actions && <div className="flex gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: React.ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold">{title}</h1>
        {subtitle && <p className="text-sm text-gray-500">{subtitle}</p>}
      </div>
      {actions && <div className="no-print flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Badge({ children, tone = "gray" }: { children: React.ReactNode; tone?: "gray" | "green" | "amber" | "red" | "blue" | "brand" }) {
  const tones = {
    gray: "bg-gray-100 text-gray-700",
    green: "bg-green-100 text-green-800",
    amber: "bg-amber-100 text-amber-800",
    red: "bg-red-100 text-red-700",
    blue: "bg-blue-100 text-blue-800",
    brand: "bg-brand-100 text-brand-800",
  };
  return <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium", tones[tone])}>{children}</span>;
}

const STATUS_TONE: Record<string, "gray" | "green" | "amber" | "red" | "blue" | "brand"> = {
  pending: "amber",
  awaiting_payment: "amber",
  paid: "blue",
  confirmed: "blue",
  processing: "blue",
  ready_for_dispatch: "brand",
  assigned_to_rider: "brand",
  out_for_delivery: "brand",
  delivered: "green",
  cancelled: "red",
  returned: "gray",
  refunded: "gray",
  succeeded: "green",
  failed: "red",
  partially_refunded: "gray",
  assigned: "amber",
  picked_up: "brand",
  requested: "amber",
  approved: "blue",
  received: "green",
  rejected: "red",
  completed: "green",
  active: "green",
  draft: "gray",
  archived: "red",
  ok: "green",
  low: "amber",
  out: "red",
  sent: "green",
  queued: "amber",
};

export function StatusBadge({ status }: { status: string }) {
  return <Badge tone={STATUS_TONE[status] ?? "gray"}>{ORDER_STATUS_LABELS[status as OrderStatus] ?? status.replace(/_/g, " ")}</Badge>;
}

export const money = (n: number | null | undefined) => (n === null || n === undefined ? "—" : formatUGX(n));
export const dt = (d: string | Date | null | undefined) =>
  d ? new Date(d).toLocaleString("en-GB", { day: "numeric", month: "short", year: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Kampala" }) : "—";

export function Table<T>({ rows, columns, onRowClick, empty = "Nothing here yet." }: { rows: T[]; columns: { header: string; cell: (r: T) => React.ReactNode; className?: string }[]; onRowClick?: (r: T) => void; empty?: string }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
          <tr>
            {columns.map((c) => (
              <th key={c.header} className={cn("whitespace-nowrap px-3 py-2 font-medium", c.className)}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.length === 0 && (
            <tr>
              <td colSpan={columns.length} className="px-3 py-8 text-center text-gray-400">
                {empty}
              </td>
            </tr>
          )}
          {rows.map((r, i) => (
            <tr key={i} onClick={onRowClick ? () => onRowClick(r) : undefined} className={cn(onRowClick && "cursor-pointer hover:bg-gray-50")}>
              {columns.map((c) => (
                <td key={c.header} className={cn("px-3 py-2 align-middle", c.className)}>
                  {c.cell(r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode; wide?: boolean }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose}>
      <div className={cn("max-h-[92vh] w-full overflow-y-auto rounded-t-2xl bg-white p-5 sm:rounded-2xl", wide ? "sm:max-w-3xl" : "sm:max-w-lg")} onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold">{title}</h3>
          <button onClick={onClose} className="rounded-full p-1 hover:bg-gray-100" aria-label="Close">
            <X className="size-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Stat({ label, value, tone }: { label: string; value: React.ReactNode; tone?: "red" | "amber" | "green" }) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4">
      <div className="text-xs uppercase tracking-wide text-gray-500">{label}</div>
      <div className={cn("mt-1 text-2xl font-bold", tone === "red" && "text-red-600", tone === "amber" && "text-amber-600", tone === "green" && "text-green-700")}>{value}</div>
    </div>
  );
}
