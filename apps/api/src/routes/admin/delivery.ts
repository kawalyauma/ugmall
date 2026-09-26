import { Hono } from "hono";
import { z } from "zod";
import { and, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { deliveries, deliveryZones, orders, roles, staffUsers } from "@ugmall/database";
import { DELIVERY_METHODS, DELIVERY_STATUSES, PERMISSIONS } from "@ugmall/shared";
import { body } from "../../lib/http";
import { audit } from "../../lib/audit";
import { crudRoutes } from "../../lib/crud";
import { requirePermission } from "../../middleware/auth";
import type { AppEnv } from "../../types";

export const adminDeliveryRoutes = new Hono<AppEnv>();
const P = PERMISSIONS;

const money = z.number().int().min(0);
adminDeliveryRoutes.route(
  "/delivery-zones",
  crudRoutes({
    table: deliveryZones,
    schema: z.object({
      name: z.string().trim().min(2).max(80),
      district: z.string().max(80).nullable().optional(),
      fee: money.nullable().optional(),
      isCalculated: z.boolean().default(false),
      baseFee: money.nullable().optional(),
      perKgFee: money.nullable().optional(),
      freeDeliveryThreshold: money.nullable().optional(),
      etaText: z.string().max(80).nullable().optional(),
      methods: z.array(z.enum(DELIVERY_METHODS)).default(["boda", "pickup"]),
      sortOrder: z.number().int().default(0),
      isActive: z.boolean().default(true),
    }),
    entity: "delivery zone",
    permission: P.settingsManage,
    viewPermission: P.ordersView,
    searchColumns: [deliveryZones.name, deliveryZones.district],
    orderBy: deliveryZones.sortOrder,
    orderDesc: false,
  }),
);

adminDeliveryRoutes.get("/riders", requirePermission(P.ordersView), async (c) => {
  const { db } = c.get("container");
  const rows = await db
    .select({
      id: staffUsers.id,
      name: staffUsers.name,
      phone: staffUsers.phone,
      isActive: staffUsers.isActive,
      activeDeliveries: sql<number>`(select count(*)::int from ${deliveries} d where d.rider_id = ${staffUsers.id} and d.status in ('assigned','picked_up'))`,
      cashHeld: sql<number>`(select coalesce(sum(d.amount_collected),0)::int from ${deliveries} d where d.rider_id = ${staffUsers.id} and d.status = 'delivered' and not d.cash_handed_over)`,
    })
    .from(staffUsers)
    .innerJoin(roles, eq(roles.id, staffUsers.roleId))
    .where(and(eq(roles.name, "rider"), eq(staffUsers.isActive, true)));
  return c.json(rows);
});

adminDeliveryRoutes.get("/deliveries", requirePermission(P.ordersView), async (c) => {
  const { db } = c.get("container");
  const where: SQL[] = [];
  const status = c.req.query("status");
  if (status) where.push(inArray(deliveries.status, status.split(",").filter((s) => (DELIVERY_STATUSES as readonly string[]).includes(s)) as (typeof DELIVERY_STATUSES)[number][]));
  if (c.req.query("riderId")) where.push(eq(deliveries.riderId, c.req.query("riderId")!));
  if (c.req.query("cash") === "outstanding") where.push(sql`${deliveries.status} = 'delivered' and ${deliveries.amountCollected} > 0 and not ${deliveries.cashHandedOver}`);
  const rows = await db
    .select({
      d: deliveries,
      orderNumber: orders.orderNumber,
      customerName: orders.customerName,
      phone: orders.phone,
      area: orders.area,
      district: orders.district,
      address: orders.address,
      orderStatus: orders.status,
      riderName: staffUsers.name,
    })
    .from(deliveries)
    .innerJoin(orders, eq(orders.id, deliveries.orderId))
    .leftJoin(staffUsers, eq(staffUsers.id, deliveries.riderId))
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(deliveries.createdAt))
    .limit(500);
  return c.json(rows.map((r) => ({ ...r.d, orderNumber: r.orderNumber, customerName: r.customerName, phone: r.phone, area: r.area, district: r.district, address: r.address, orderStatus: r.orderStatus, riderName: r.riderName })));
});

/** Rider hands collected COD cash (or MoMo) over to the cashier. */
adminDeliveryRoutes.post("/deliveries/handover", requirePermission(P.deliveriesManage), async (c) => {
  const { ids } = await body(c, z.object({ ids: z.array(z.string().uuid()).min(1).max(500) }));
  const { db } = c.get("container");
  const rows = await db
    .update(deliveries)
    .set({ cashHandedOver: true, cashHandedOverAt: new Date() })
    .where(and(inArray(deliveries.id, ids), eq(deliveries.cashHandedOver, false)))
    .returning({ id: deliveries.id, amount: deliveries.amountCollected });
  await audit(db, c.get("staff").id, "delivery.cash_handover", "delivery", ids.join(","), { total: rows.reduce((s, r) => s + (r.amount ?? 0), 0) });
  return c.json({ updated: rows.length, total: rows.reduce((s, r) => s + (r.amount ?? 0), 0) });
});
