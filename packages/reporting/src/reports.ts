import { sql, type SQL } from "drizzle-orm";
import type { Database } from "@ugmall/database";
import { DELIVERY_METHOD_LABELS, PAYMENT_METHOD_LABELS, type DeliveryMethod, type PaymentMethod } from "@ugmall/shared";
import { TZ, type ReportColumn, type ReportParams, type ReportResult } from "./types";

/** Orders that count as real sales (booked, not cancelled/returned/unpaid-online). */
export const SALE_STATUSES_SQL = sql.raw(
  `('paid','confirmed','processing','ready_for_dispatch','assigned_to_rider','out_for_delivery','delivered')`,
);

const range = (col: SQL, p: ReportParams) =>
  sql`${col} >= (${p.from}::date::timestamp AT TIME ZONE ${TZ}) AND ${col} < ((${p.to}::date + 1)::timestamp AT TIME ZONE ${TZ})`;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export function validateParams(p: ReportParams): ReportParams {
  if (!DATE_RE.test(p.from) || !DATE_RE.test(p.to)) throw new Error("Dates must be YYYY-MM-DD");
  if (p.from > p.to) throw new Error("'from' must be before 'to'");
  return { ...p, granularity: p.granularity ?? "day" };
}

async function rows(db: Database, q: SQL): Promise<Record<string, string | number | null>[]> {
  const res = (await db.execute(q)) as unknown as Record<string, unknown>[];
  return res.map((r) => {
    const out: Record<string, string | number | null> = {};
    for (const [k, v] of Object.entries(r)) {
      if (v === null || v === undefined) out[k] = null;
      else if (typeof v === "number") out[k] = v;
      else if (typeof v === "bigint") out[k] = Number(v);
      else if (v instanceof Date) out[k] = v.toISOString();
      else if (typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v) && k !== "sku" && k !== "phone" && k !== "period") out[k] = Number(v);
      else out[k] = String(v);
    }
    return out;
  });
}

function sumCols(data: Record<string, string | number | null>[], cols: ReportColumn[]) {
  const totals: Record<string, number> = {};
  for (const c of cols) {
    if (c.type === "money" || c.type === "number") totals[c.key] = data.reduce((s, r) => s + (Number(r[c.key]) || 0), 0);
  }
  return totals;
}

const sub = (p: ReportParams) => `${p.from} to ${p.to}`;

type ReportFn = (db: Database, p: ReportParams) => Promise<ReportResult>;

const salesReport: ReportFn = async (db, p) => {
  const g = p.granularity ?? "day";
  const trunc = sql.raw(`'${g}'`);
  const columns: ReportColumn[] = [
    { key: "period", label: g === "day" ? "Date" : g === "week" ? "Week starting" : "Month", type: "text" },
    { key: "orders", label: "Orders", type: "number" },
    { key: "items", label: "Items", type: "number" },
    { key: "revenue", label: "Revenue", type: "money" },
    { key: "discounts", label: "Discounts", type: "money" },
    { key: "delivery_fees", label: "Delivery fees", type: "money" },
    { key: "cost", label: "Cost", type: "money" },
    { key: "gross_profit", label: "Gross profit", type: "money" },
  ];
  const data = await rows(
    db,
    sql`
    select to_char(date_trunc(${trunc}, o.created_at at time zone ${TZ}), 'YYYY-MM-DD') as period,
           count(*)::int as orders,
           coalesce(sum((select sum(quantity) from order_items i where i.order_id = o.id)), 0)::int as items,
           coalesce(sum(o.total - o.delivery_fee), 0)::bigint as revenue,
           coalesce(sum(o.discount), 0)::bigint as discounts,
           coalesce(sum(o.delivery_fee), 0)::bigint as delivery_fees,
           coalesce(sum(o.cost_total), 0)::bigint as cost,
           coalesce(sum(o.total - o.delivery_fee - o.cost_total), 0)::bigint as gross_profit
    from orders o
    where o.status in ${SALE_STATUSES_SQL} and ${range(sql`o.created_at`, p)}
    group by 1 order by 1`,
  );
  const title = g === "day" ? "Daily sales" : g === "week" ? "Weekly sales" : "Monthly sales";
  return { id: "sales", title, subtitle: sub(p), columns, rows: data, totals: sumCols(data, columns) };
};

const profitReport: ReportFn = async (db, p) => {
  const g = p.granularity ?? "month";
  const trunc = sql.raw(`'${g}'`);
  const columns: ReportColumn[] = [
    { key: "period", label: "Period", type: "text" },
    { key: "revenue", label: "Revenue", type: "money" },
    { key: "cost", label: "Cost of goods", type: "money" },
    { key: "gross_profit", label: "Gross profit", type: "money" },
    { key: "expenses", label: "Expenses", type: "money" },
    { key: "refunds", label: "Refunds", type: "money" },
    { key: "net_profit", label: "Net profit", type: "money" },
    { key: "margin", label: "Gross margin %", type: "percent" },
  ];
  const data = await rows(
    db,
    sql`
    with s as (
      select to_char(date_trunc(${trunc}, created_at at time zone ${TZ}), 'YYYY-MM-DD') as period,
             sum(total - delivery_fee) as revenue, sum(cost_total) as cost
      from orders where status in ${SALE_STATUSES_SQL} and ${range(sql`created_at`, p)} group by 1
    ), e as (
      select to_char(date_trunc(${trunc}, spent_on::timestamp), 'YYYY-MM-DD') as period, sum(amount) as expenses
      from expenses where spent_on between ${p.from}::date and ${p.to}::date group by 1
    ), r as (
      select to_char(date_trunc(${trunc}, created_at at time zone ${TZ}), 'YYYY-MM-DD') as period, sum(amount) as refunds
      from refunds where status = 'succeeded' and ${range(sql`created_at`, p)} group by 1
    ), periods as (select period from s union select period from e union select period from r)
    select periods.period,
           coalesce(s.revenue, 0)::bigint as revenue,
           coalesce(s.cost, 0)::bigint as cost,
           (coalesce(s.revenue, 0) - coalesce(s.cost, 0))::bigint as gross_profit,
           coalesce(e.expenses, 0)::bigint as expenses,
           coalesce(r.refunds, 0)::bigint as refunds,
           (coalesce(s.revenue, 0) - coalesce(s.cost, 0) - coalesce(e.expenses, 0))::bigint as net_profit,
           case when coalesce(s.revenue, 0) > 0 then round(100.0 * (s.revenue - s.cost) / s.revenue, 1) else 0 end as margin
    from periods left join s using (period) left join e using (period) left join r using (period)
    order by 1`,
  );
  const totals = sumCols(data, columns);
  delete totals.margin;
  return { id: "profit", title: "Profit report", subtitle: sub(p), columns, rows: data, totals };
};

const productPerformance: ReportFn = async (db, p) => {
  const columns: ReportColumn[] = [
    { key: "product", label: "Product", type: "text" },
    { key: "sku", label: "SKU", type: "text" },
    { key: "quantity", label: "Qty sold", type: "number" },
    { key: "orders", label: "Orders", type: "number" },
    { key: "revenue", label: "Revenue", type: "money" },
    { key: "cost", label: "Cost", type: "money" },
    { key: "profit", label: "Profit", type: "money" },
    { key: "returned", label: "Returned", type: "number" },
  ];
  const data = await rows(
    db,
    sql`
    select i.product_name as product, coalesce(max(pr.sku), max(i.sku)) as sku,
           sum(i.quantity)::int as quantity, count(distinct o.id)::int as orders,
           sum(i.line_total)::bigint as revenue, sum(i.unit_cost * i.quantity)::bigint as cost,
           sum(i.line_total - i.unit_cost * i.quantity)::bigint as profit, sum(i.returned_quantity)::int as returned
    from order_items i join orders o on o.id = i.order_id left join products pr on pr.id = i.product_id
    where o.status in ${SALE_STATUSES_SQL} and ${range(sql`o.created_at`, p)}
    group by i.product_id, i.product_name order by revenue desc`,
  );
  return { id: "product-performance", title: "Product performance", subtitle: sub(p), columns, rows: data, totals: sumCols(data, columns) };
};

const categoryPerformance: ReportFn = async (db, p) => {
  const columns: ReportColumn[] = [
    { key: "category", label: "Category", type: "text" },
    { key: "quantity", label: "Qty sold", type: "number" },
    { key: "revenue", label: "Revenue", type: "money" },
    { key: "profit", label: "Profit", type: "money" },
    { key: "share", label: "Share of revenue %", type: "percent" },
  ];
  const data = await rows(
    db,
    sql`
    with x as (
      select coalesce(c.name, 'Uncategorised') as category, sum(i.quantity) as quantity, sum(i.line_total) as revenue,
             sum(i.line_total - i.unit_cost * i.quantity) as profit
      from order_items i join orders o on o.id = i.order_id
      left join products pr on pr.id = i.product_id left join categories c on c.id = pr.category_id
      where o.status in ${SALE_STATUSES_SQL} and ${range(sql`o.created_at`, p)}
      group by 1)
    select category, quantity::int, revenue::bigint, profit::bigint,
           round(100.0 * revenue / nullif(sum(revenue) over (), 0), 1) as share
    from x order by revenue desc`,
  );
  const totals = sumCols(data, columns);
  delete totals.share;
  return { id: "category-performance", title: "Category performance", subtitle: sub(p), columns, rows: data, totals };
};

const inventoryValuation: ReportFn = async (db) => {
  const columns: ReportColumn[] = [
    { key: "product", label: "Product", type: "text" },
    { key: "sku", label: "SKU", type: "text" },
    { key: "variant", label: "Variant", type: "text" },
    { key: "on_hand", label: "On hand", type: "number" },
    { key: "reserved", label: "Reserved", type: "number" },
    { key: "unit_cost", label: "Unit cost", type: "money" },
    { key: "cost_value", label: "Cost value", type: "money" },
    { key: "retail_value", label: "Retail value", type: "money" },
  ];
  const data = await rows(
    db,
    sql`
    select p.name as product, v.sku, (select string_agg(value, ' / ') from jsonb_each_text(v.options)) as variant,
           coalesce(l.on_hand, 0) as on_hand, coalesce(l.reserved, 0) as reserved,
           coalesce(v.cost_price, p.cost_price) as unit_cost,
           (coalesce(l.on_hand, 0) * coalesce(v.cost_price, p.cost_price))::bigint as cost_value,
           (coalesce(l.on_hand, 0) * coalesce(v.price, p.price))::bigint as retail_value
    from product_variants v join products p on p.id = v.product_id
    left join inventory_levels l on l.variant_id = v.id
    where p.status <> 'archived' and coalesce(l.on_hand, 0) > 0
    order by cost_value desc`,
  );
  const totals = sumCols(data, columns);
  delete totals.unit_cost;
  return { id: "inventory-valuation", title: "Inventory valuation", subtitle: `As at ${new Date().toISOString().slice(0, 10)}`, columns, rows: data, totals };
};

const stockList = (id: string, title: string, cond: SQL): ReportFn => async (db) => {
  const columns: ReportColumn[] = [
    { key: "product", label: "Product", type: "text" },
    { key: "sku", label: "SKU", type: "text" },
    { key: "variant", label: "Variant", type: "text" },
    { key: "on_hand", label: "On hand", type: "number" },
    { key: "reserved", label: "Reserved", type: "number" },
    { key: "available", label: "Available", type: "number" },
    { key: "threshold", label: "Low-stock level", type: "number" },
    { key: "sold_30d", label: "Sold (30 days)", type: "number" },
  ];
  const data = await rows(
    db,
    sql`
    select p.name as product, v.sku, (select string_agg(value, ' / ') from jsonb_each_text(v.options)) as variant,
           coalesce(l.on_hand, 0) as on_hand, coalesce(l.reserved, 0) as reserved,
           coalesce(l.on_hand, 0) - coalesce(l.reserved, 0) as available, v.low_stock_threshold as threshold,
           coalesce((select sum(-m.on_hand_delta) from inventory_movements m where m.variant_id = v.id and m.type = 'sale'
                     and m.created_at > now() - interval '30 days'), 0)::int as sold_30d
    from product_variants v join products p on p.id = v.product_id
    left join inventory_levels l on l.variant_id = v.id
    where p.status = 'active' and v.is_active and ${cond}
    order by available asc, sold_30d desc`,
  );
  return { id, title, subtitle: `As at ${new Date().toISOString().slice(0, 10)}`, columns, rows: data };
};

const customerPurchases: ReportFn = async (db, p) => {
  const columns: ReportColumn[] = [
    { key: "customer", label: "Customer", type: "text" },
    { key: "phone", label: "Phone", type: "text" },
    { key: "orders", label: "Orders", type: "number" },
    { key: "spent", label: "Spent", type: "money" },
    { key: "average", label: "Average order", type: "money" },
    { key: "last_order", label: "Last order", type: "date" },
  ];
  const data = await rows(
    db,
    sql`
    select max(o.customer_name) as customer, o.phone, count(*)::int as orders, sum(o.total)::bigint as spent,
           round(avg(o.total))::bigint as average, max(o.created_at) as last_order
    from orders o where o.status in ${SALE_STATUSES_SQL} and ${range(sql`o.created_at`, p)}
    group by o.phone order by spent desc limit 1000`,
  );
  const totals = sumCols(data, columns);
  delete totals.average;
  return { id: "customer-purchases", title: "Customer purchases", subtitle: sub(p), columns, rows: data, totals };
};

const paymentMethods: ReportFn = async (db, p) => {
  const columns: ReportColumn[] = [
    { key: "method", label: "Payment method", type: "text" },
    { key: "orders", label: "Orders", type: "number" },
    { key: "order_value", label: "Order value", type: "money" },
    { key: "collected", label: "Collected", type: "money" },
    { key: "failed_attempts", label: "Failed attempts", type: "number" },
    { key: "refunded", label: "Refunded", type: "money" },
  ];
  const data = await rows(
    db,
    sql`
    select o.payment_method as method, count(distinct o.id)::int as orders,
           sum(o.total)::bigint as order_value,
           coalesce(sum((select sum(amount) from payments p where p.order_id = o.id and p.status in ('succeeded','refunded','partially_refunded'))), 0)::bigint as collected,
           coalesce(sum((select count(*) from payments p where p.order_id = o.id and p.status = 'failed')), 0)::int as failed_attempts,
           coalesce(sum((select sum(refunded_amount) from payments p where p.order_id = o.id)), 0)::bigint as refunded
    from orders o where o.status <> 'cancelled' and ${range(sql`o.created_at`, p)}
    group by 1 order by order_value desc`,
  );
  for (const r of data) r.method = PAYMENT_METHOD_LABELS[r.method as PaymentMethod] ?? r.method;
  return { id: "payment-methods", title: "Payment methods", subtitle: sub(p), columns, rows: data, totals: sumCols(data, columns) };
};

const deliveryPerformance: ReportFn = async (db, p) => {
  const columns: ReportColumn[] = [
    { key: "method", label: "Method", type: "text" },
    { key: "zone", label: "Zone", type: "text" },
    { key: "rider", label: "Rider / carrier", type: "text" },
    { key: "deliveries", label: "Deliveries", type: "number" },
    { key: "delivered", label: "Delivered", type: "number" },
    { key: "failed", label: "Failed", type: "number" },
    { key: "success_rate", label: "Success %", type: "percent" },
    { key: "avg_hours", label: "Avg hours order→delivered", type: "number" },
    { key: "fees", label: "Delivery fees", type: "money" },
  ];
  const data = await rows(
    db,
    sql`
    select d.method, coalesce(z.name, '-') as zone, coalesce(s.name, d.carrier_name, '-') as rider,
           count(*)::int as deliveries,
           count(*) filter (where d.status = 'delivered')::int as delivered,
           count(*) filter (where d.status = 'failed')::int as failed,
           round(100.0 * count(*) filter (where d.status = 'delivered') / nullif(count(*) filter (where d.status in ('delivered','failed')), 0), 1) as success_rate,
           round(avg(extract(epoch from (d.delivered_at - o.created_at)) / 3600) filter (where d.status = 'delivered')::numeric, 1) as avg_hours,
           sum(o.delivery_fee) filter (where d.status = 'delivered')::bigint as fees
    from deliveries d join orders o on o.id = d.order_id
    left join delivery_zones z on z.id = o.delivery_zone_id
    left join staff_users s on s.id = d.rider_id
    where d.status <> 'cancelled' and ${range(sql`d.assigned_at`, p)}
    group by 1, 2, 3 order by deliveries desc`,
  );
  for (const r of data) r.method = DELIVERY_METHOD_LABELS[r.method as DeliveryMethod] ?? r.method;
  const totals = sumCols(data, columns);
  delete totals.avg_hours;
  return { id: "delivery-performance", title: "Delivery performance", subtitle: sub(p), columns, rows: data, totals };
};

const returnsReport: ReportFn = async (db, p) => {
  const columns: ReportColumn[] = [
    { key: "date", label: "Date", type: "date" },
    { key: "order_number", label: "Order", type: "text" },
    { key: "customer", label: "Customer", type: "text" },
    { key: "reason", label: "Reason", type: "text" },
    { key: "items", label: "Items", type: "number" },
    { key: "status", label: "Status", type: "text" },
    { key: "refund", label: "Refund", type: "money" },
  ];
  const data = await rows(
    db,
    sql`
    select r.created_at as date, o.order_number, o.customer_name as customer, r.reason,
           (select coalesce(sum((x->>'quantity')::int), 0) from jsonb_array_elements(r.items) x)::int as items,
           r.status, coalesce(r.refund_amount, 0) as refund
    from returns r join orders o on o.id = r.order_id where ${range(sql`r.created_at`, p)} order by r.created_at desc`,
  );
  return { id: "returns", title: "Returns", subtitle: sub(p), columns, rows: data, totals: sumCols(data, columns) };
};

const discountUsage: ReportFn = async (db, p) => {
  const columns: ReportColumn[] = [
    { key: "code", label: "Coupon", type: "text" },
    { key: "uses", label: "Uses", type: "number" },
    { key: "discount", label: "Discount given", type: "money" },
    { key: "order_value", label: "Order value", type: "money" },
  ];
  const data = await rows(
    db,
    sql`
    select c.code, count(*)::int as uses, sum(cr.amount)::bigint as discount, sum(o.total)::bigint as order_value
    from coupon_redemptions cr join coupons c on c.id = cr.coupon_id join orders o on o.id = cr.order_id
    where o.status <> 'cancelled' and ${range(sql`cr.created_at`, p)}
    group by c.code order by discount desc`,
  );
  return { id: "discount-usage", title: "Discount usage", subtitle: sub(p), columns, rows: data, totals: sumCols(data, columns) };
};

const expensesReport: ReportFn = async (db, p) => {
  const columns: ReportColumn[] = [
    { key: "category", label: "Category", type: "text" },
    { key: "entries", label: "Entries", type: "number" },
    { key: "amount", label: "Amount", type: "money" },
  ];
  const data = await rows(
    db,
    sql`select category, count(*)::int as entries, sum(amount)::bigint as amount from expenses
        where spent_on between ${p.from}::date and ${p.to}::date group by 1 order by amount desc`,
  );
  return { id: "expenses", title: "Expenses", subtitle: sub(p), columns, rows: data, totals: sumCols(data, columns) };
};

const codCollections: ReportFn = async (db, p) => {
  const columns: ReportColumn[] = [
    { key: "rider", label: "Rider", type: "text" },
    { key: "deliveries", label: "COD deliveries", type: "number" },
    { key: "expected", label: "Expected", type: "money" },
    { key: "collected", label: "Collected", type: "money" },
    { key: "handed_over", label: "Handed over", type: "money" },
    { key: "outstanding", label: "With rider", type: "money" },
  ];
  const data = await rows(
    db,
    sql`
    select coalesce(s.name, d.carrier_name, 'Unassigned') as rider,
           count(*)::int as deliveries,
           sum(d.amount_to_collect)::bigint as expected,
           coalesce(sum(d.amount_collected), 0)::bigint as collected,
           coalesce(sum(d.amount_collected) filter (where d.cash_handed_over), 0)::bigint as handed_over,
           coalesce(sum(d.amount_collected) filter (where not d.cash_handed_over), 0)::bigint as outstanding
    from deliveries d left join staff_users s on s.id = d.rider_id
    where d.amount_to_collect > 0 and d.status = 'delivered' and ${range(sql`d.delivered_at`, p)}
    group by 1 order by outstanding desc`,
  );
  return { id: "cod-collections", title: "Cash on delivery collections", subtitle: sub(p), columns, rows: data, totals: sumCols(data, columns) };
};

export const REPORTS: Record<string, { title: string; needsRange: boolean; granularity?: boolean; run: ReportFn }> = {
  sales: { title: "Sales (daily / weekly / monthly)", needsRange: true, granularity: true, run: salesReport },
  profit: { title: "Profit", needsRange: true, granularity: true, run: profitReport },
  "product-performance": { title: "Product performance", needsRange: true, run: productPerformance },
  "category-performance": { title: "Category performance", needsRange: true, run: categoryPerformance },
  "inventory-valuation": { title: "Inventory valuation", needsRange: false, run: inventoryValuation },
  "low-stock": {
    title: "Low stock",
    needsRange: false,
    run: stockList("low-stock", "Low stock", sql`coalesce(l.on_hand, 0) - coalesce(l.reserved, 0) between 1 and v.low_stock_threshold`),
  },
  "out-of-stock": {
    title: "Out of stock",
    needsRange: false,
    run: stockList("out-of-stock", "Out of stock", sql`coalesce(l.on_hand, 0) - coalesce(l.reserved, 0) <= 0`),
  },
  "customer-purchases": { title: "Customer purchases", needsRange: true, run: customerPurchases },
  "payment-methods": { title: "Payment methods", needsRange: true, run: paymentMethods },
  "delivery-performance": { title: "Delivery performance", needsRange: true, run: deliveryPerformance },
  returns: { title: "Returns", needsRange: true, run: returnsReport },
  "discount-usage": { title: "Discount usage", needsRange: true, run: discountUsage },
  expenses: { title: "Expenses", needsRange: true, run: expensesReport },
  "cod-collections": { title: "Cash on delivery collections", needsRange: true, run: codCollections },
};

export async function runReport(db: Database, id: string, params: ReportParams): Promise<ReportResult> {
  const def = REPORTS[id];
  if (!def) throw new Error(`Unknown report: ${id}`);
  return def.run(db, validateParams(params));
}
