import { Hono } from "hono";
import { z } from "zod";
import { and, desc, eq, inArray, isNull, sql, type SQL } from "drizzle-orm";
import { deliveries, deliveryZones, locations, orders, roles, staffUsers } from "@ugmall/database";
import { addLocation, assignZone, resolveLocation, searchLocations, zoneCoverage } from "@ugmall/delivery";
import { DELIVERY_METHODS, DELIVERY_STATUSES, PERMISSIONS } from "@ugmall/shared";
import { ApiError, body } from "../../lib/http";
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

/* ------------------------------------------------------ areas & coverage */

adminDeliveryRoutes.get("/locations", requirePermission(P.ordersView), async (c) => {
  const { db } = c.get("container");
  const parent = c.req.query("parent");
  const parentId = parent && /^\d+$/.test(parent) ? Number(parent) : null;
  const rows = await db
    .select({
      id: locations.id,
      name: locations.name,
      level: locations.level,
      path: locations.path,
      zoneId: locations.deliveryZoneId,
      zoneName: deliveryZones.name,
      isCustom: locations.isCustom,
      isActive: locations.isActive,
      children: sql<number>`(select count(*)::int from ${locations} ch where ch.parent_id = ${locations.id})`,
    })
    .from(locations)
    .leftJoin(deliveryZones, eq(deliveryZones.id, locations.deliveryZoneId))
    .where(parentId === null ? isNull(locations.parentId) : eq(locations.parentId, parentId))
    .orderBy(locations.name);
  return c.json(rows);
});

adminDeliveryRoutes.get("/locations/search", requirePermission(P.ordersView), async (c) => {
  const hits = await searchLocations(c.get("container").db, c.req.query("q") ?? "", 30);
  return c.json(hits);
});

/** Effective zone + fee for an area (what a customer choosing it would pay). */
adminDeliveryRoutes.get("/locations/:id/resolve", requirePermission(P.ordersView), async (c) => {
  const r = await resolveLocation(c.get("container").db, Number(c.req.param("id")));
  if (!r) throw new ApiError(404, "Area not found");
  return c.json({ path: r.location.path, zone: r.zone, zoneFrom: r.zoneFrom?.path ?? null, moreSpecificMayDiffer: r.moreSpecificMayDiffer, chain: r.chain.map((l) => ({ id: l.id, name: l.name, level: l.level })) });
});

adminDeliveryRoutes.put("/locations/:id/zone", requirePermission(P.settingsManage), async (c) => {
  const { zoneId } = await body(c, z.object({ zoneId: z.string().uuid().nullable() }));
  const { db } = c.get("container");
  const id = Number(c.req.param("id"));
  await assignZone(db, id, zoneId);
  await audit(db, c.get("staff").id, "delivery.coverage", "location", String(id), { zoneId });
  return c.json({ ok: true });
});

/** Add an area missing from the official list (e.g. "Kitintale" under Nakawa). */
adminDeliveryRoutes.post("/locations", requirePermission(P.settingsManage), async (c) => {
  const input = await body(c, z.object({ parentId: z.number().int().positive(), name: z.string().trim().min(2).max(80) }));
  const { db } = c.get("container");
  try {
    const row = await addLocation(db, input.parentId, input.name);
    await audit(db, c.get("staff").id, "delivery.add_area", "location", String(row.id), input);
    return c.json(row, 201);
  } catch (err) {
    throw new ApiError(422, (err as Error).message);
  }
});

adminDeliveryRoutes.patch("/locations/:id", requirePermission(P.settingsManage), async (c) => {
  const input = await body(c, z.object({ isActive: z.boolean() }));
  const { db } = c.get("container");
  await db.update(locations).set(input).where(eq(locations.id, Number(c.req.param("id"))));
  return c.json({ ok: true });
});

/** Every area that has a zone set directly, grouped by zone (the coverage map, as a list). */
adminDeliveryRoutes.get("/delivery-coverage", requirePermission(P.ordersView), async (c) => {
  return c.json(await zoneCoverage(c.get("container").db));
});

/** Places customers typed because theirs wasn't in the list — candidates to add as areas. */
adminDeliveryRoutes.get("/locations/typed-places", requirePermission(P.ordersView), async (c) => {
  const { db } = c.get("container");
  const rows = await db.execute(sql`
    select lower(trim(nearby_place)) as key, min(nearby_place) as place, min(location_path) as "locationPath", min(location_id) as "locationId",
           count(*)::int as orders, max(created_at) as "lastOrder"
    from orders where nearby_place is not null and nearby_place <> '' and created_at > now() - interval '180 days'
    group by 1 order by orders desc, "lastOrder" desc limit 200`);
  return c.json(rows);
});
