"use client";

import Link from "next/link";
import { useApi } from "@/lib/hooks";
import { Card, PageHeader, Stat, money } from "@/components/ui/kit";

interface Summary {
  date: string;
  orders: number;
  revenue: number | null;
  cost: number | null;
  grossProfit: number | null;
  paidOrders: number;
  codOrders: number;
  cancelled: number;
  awaitingPayment: number;
  pendingConfirmation: number;
  pendingDelivery: number;
  lowStockProducts: number;
  outOfStockProducts: number;
  codWithRiders: number | null;
  last7Days: { date: string; revenue: number | null; orders: number }[];
  topProducts: { name: string; quantity: number; revenue: number }[];
}

export default function Dashboard() {
  const { data: s } = useApi<Summary>("/admin/dashboard");
  if (!s) return <p className="text-gray-400">Loading…</p>;
  const max = Math.max(1, ...s.last7Days.map((d) => d.revenue ?? d.orders));
  return (
    <>
      <PageHeader title="Today" subtitle={new Date(s.date).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Orders" value={s.orders} />
        <Stat label="Revenue" value={money(s.revenue)} />
        <Stat label="Cost" value={money(s.cost)} />
        <Stat label="Gross profit" value={money(s.grossProfit)} tone="green" />
        <Stat label="Paid orders" value={s.paidOrders} />
        <Stat label="COD orders" value={s.codOrders} />
        <Stat label="Cancelled" value={s.cancelled} tone={s.cancelled ? "red" : undefined} />
        <Stat label="COD cash with riders" value={money(s.codWithRiders)} tone={s.codWithRiders ? "amber" : undefined} />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Link href="/orders?status=pending">
          <Stat label="To confirm" value={s.pendingConfirmation} tone={s.pendingConfirmation ? "amber" : undefined} />
        </Link>
        <Link href="/orders?status=awaiting_payment">
          <Stat label="Awaiting MoMo" value={s.awaitingPayment} />
        </Link>
        <Link href="/orders?status=paid,confirmed,processing,ready_for_dispatch,assigned_to_rider,out_for_delivery">
          <Stat label="Pending delivery" value={s.pendingDelivery} tone={s.pendingDelivery ? "amber" : undefined} />
        </Link>
        <Link href="/inventory?filter=low">
          <Stat label="Low / out of stock" value={`${s.lowStockProducts} / ${s.outOfStockProducts}`} tone={s.outOfStockProducts ? "red" : undefined} />
        </Link>
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title="Last 7 days">
          <div className="flex h-40 items-end gap-2">
            {s.last7Days.map((d) => {
              const v = d.revenue ?? d.orders;
              return (
                <div key={d.date} className="flex h-full flex-1 flex-col items-center justify-end gap-1">
                  <div className="text-[10px] text-gray-500">{d.revenue !== null ? `${Math.round((d.revenue ?? 0) / 1000)}k` : d.orders}</div>
                  <div className="w-full rounded-t bg-brand-600" style={{ height: `${(v / max) * 75}%`, minHeight: 2 }} title={`${d.date}: ${money(d.revenue)} · ${d.orders} orders`} />
                  <div className="text-[10px] text-gray-500">{new Date(d.date).toLocaleDateString("en-GB", { weekday: "short" })}</div>
                </div>
              );
            })}
          </div>
        </Card>
        <Card title="Top products (30 days)">
          <ol className="space-y-2 text-sm">
            {s.topProducts.map((p, i) => (
              <li key={p.name} className="flex justify-between">
                <span>
                  {i + 1}. {p.name}
                </span>
                <span className="text-gray-500">
                  {p.quantity} sold · {money(p.revenue)}
                </span>
              </li>
            ))}
            {!s.topProducts.length && <li className="text-gray-400">No sales yet.</li>}
          </ol>
        </Card>
      </div>
    </>
  );
}
