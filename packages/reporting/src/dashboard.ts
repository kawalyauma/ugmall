import { sql } from "drizzle-orm";
import type { Database } from "@ugmall/database";
import { SALE_STATUSES_SQL } from "./reports";
import { TZ } from "./types";

export interface DashboardSummary {
  date: string;
  orders: number;
  revenue: number;
  cost: number;
  grossProfit: number;
  paidOrders: number;
  codOrders: number;
  cancelled: number;
  awaitingPayment: number;
  pendingConfirmation: number;
  pendingDelivery: number;
  lowStockProducts: number;
  outOfStockProducts: number;
  codWithRiders: number;
  last7Days: { date: string; revenue: number; orders: number }[];
  topProducts: { name: string; quantity: number; revenue: number }[];
}

/** The "TODAY" panel on the admin dashboard, computed in Kampala time. */
export async function dashboardSummary(db: Database, date?: string): Promise<DashboardSummary> {
  const day = date ?? new Date().toLocaleDateString("en-CA", { timeZone: TZ });
  const inDay = sql`o.created_at >= (${day}::date::timestamp AT TIME ZONE ${TZ}) AND o.created_at < ((${day}::date + 1)::timestamp AT TIME ZONE ${TZ})`;
  const [today] = (await db.execute(sql`
    select
      count(*) filter (where o.status <> 'cancelled')::int as orders,
      coalesce(sum(o.total - o.delivery_fee) filter (where o.status in ${SALE_STATUSES_SQL}), 0)::bigint as revenue,
      coalesce(sum(o.cost_total) filter (where o.status in ${SALE_STATUSES_SQL}), 0)::bigint as cost,
      count(*) filter (where o.payment_status = 'succeeded')::int as paid_orders,
      count(*) filter (where o.payment_method = 'cash_on_delivery' and o.status <> 'cancelled')::int as cod_orders,
      count(*) filter (where o.status = 'cancelled')::int as cancelled
    from orders o where ${inDay}`)) as unknown as Record<string, string | number>[];

  const [live] = (await db.execute(sql`
    select
      count(*) filter (where status = 'awaiting_payment')::int as awaiting_payment,
      count(*) filter (where status = 'pending')::int as pending_confirmation,
      count(*) filter (where status in ('paid','confirmed','processing','ready_for_dispatch','assigned_to_rider','out_for_delivery'))::int as pending_delivery
    from orders`)) as unknown as Record<string, number>[];

  const [stock] = (await db.execute(sql`
    select
      count(distinct v.product_id) filter (where coalesce(l.on_hand,0) - coalesce(l.reserved,0) between 1 and v.low_stock_threshold)::int as low,
      count(distinct v.product_id) filter (where coalesce(l.on_hand,0) - coalesce(l.reserved,0) <= 0)::int as out
    from product_variants v join products p on p.id = v.product_id left join inventory_levels l on l.variant_id = v.id
    where p.status = 'active' and v.is_active`)) as unknown as Record<string, number>[];

  const [cod] = (await db.execute(sql`
    select coalesce(sum(amount_collected), 0)::bigint as with_riders from deliveries
    where status = 'delivered' and amount_collected > 0 and not cash_handed_over`)) as unknown as Record<string, string>[];

  const last7 = (await db.execute(sql`
    select to_char(d, 'YYYY-MM-DD') as date,
      coalesce((select sum(total - delivery_fee) from orders o where o.status in ${SALE_STATUSES_SQL}
        and o.created_at >= (d::timestamp at time zone ${TZ}) and o.created_at < ((d + interval '1 day')::timestamp at time zone ${TZ})), 0)::bigint as revenue,
      coalesce((select count(*) from orders o where o.status <> 'cancelled'
        and o.created_at >= (d::timestamp at time zone ${TZ}) and o.created_at < ((d + interval '1 day')::timestamp at time zone ${TZ})), 0)::int as orders
    from generate_series(${day}::date - 6, ${day}::date, interval '1 day') d order by d`)) as unknown as { date: string; revenue: string; orders: number }[];

  const top = (await db.execute(sql`
    select i.product_name as name, sum(i.quantity)::int as quantity, sum(i.line_total)::bigint as revenue
    from order_items i join orders o on o.id = i.order_id
    where o.status in ${SALE_STATUSES_SQL} and o.created_at > now() - interval '30 days'
    group by 1 order by quantity desc limit 5`)) as unknown as { name: string; quantity: number; revenue: string }[];

  const revenue = Number(today?.revenue ?? 0);
  const cost = Number(today?.cost ?? 0);
  return {
    date: day,
    orders: Number(today?.orders ?? 0),
    revenue,
    cost,
    grossProfit: revenue - cost,
    paidOrders: Number(today?.paid_orders ?? 0),
    codOrders: Number(today?.cod_orders ?? 0),
    cancelled: Number(today?.cancelled ?? 0),
    awaitingPayment: Number(live?.awaiting_payment ?? 0),
    pendingConfirmation: Number(live?.pending_confirmation ?? 0),
    pendingDelivery: Number(live?.pending_delivery ?? 0),
    lowStockProducts: Number(stock?.low ?? 0),
    outOfStockProducts: Number(stock?.out ?? 0),
    codWithRiders: Number(cod?.with_riders ?? 0),
    last7Days: last7.map((r) => ({ date: r.date, revenue: Number(r.revenue), orders: Number(r.orders) })),
    topProducts: top.map((r) => ({ name: r.name, quantity: Number(r.quantity), revenue: Number(r.revenue) })),
  };
}
