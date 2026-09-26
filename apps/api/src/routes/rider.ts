import { Hono } from "hono";
import { z } from "zod";
import { and, asc, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { deliveries, orderItems, orders } from "@ugmall/database";
import { PERMISSIONS, prettyUgPhone } from "@ugmall/shared";
import { body } from "../lib/http";
import { requirePermission, requireStaff } from "../middleware/auth";
import { mapDomainError } from "./public/checkout";
import type { AppEnv } from "../types";

/** Rider app: assigned deliveries, customer contact, navigation, cash to collect, confirmation. */
export const riderRoutes = new Hono<AppEnv>();
riderRoutes.use("*", requireStaff, requirePermission(PERMISSIONS.riderApp, PERMISSIONS.deliveriesManage));

riderRoutes.get("/deliveries", async (c) => {
  const { db } = c.get("container");
  const riderId = c.get("staff").id;
  const since = new Date(Date.now() - 36 * 3600_000);
  const rows = await db
    .select({ d: deliveries, o: orders })
    .from(deliveries)
    .innerJoin(orders, eq(orders.id, deliveries.orderId))
    .where(and(eq(deliveries.riderId, riderId), sql`(${deliveries.status} in ('assigned','picked_up') or ${deliveries.deliveredAt} >= ${since.toISOString()}::timestamptz)`))
    .orderBy(asc(deliveries.status), desc(deliveries.assignedAt));
  const items = rows.length ? await db.select().from(orderItems).where(inArray(orderItems.orderId, rows.map((r) => r.o.id))) : [];
  return c.json(
    rows.map(({ d, o }) => {
      const destination = `${o.address}, ${o.area}, ${o.district}, Uganda`;
      return {
        id: d.id,
        orderId: o.id,
        orderNumber: o.orderNumber,
        status: d.status,
        orderStatus: o.status,
        customerName: o.customerName,
        phone: prettyUgPhone(o.phone),
        phoneHref: `tel:+${o.phone}`,
        whatsappHref: `https://wa.me/${o.phone}`,
        altPhone: o.altPhone ? prettyUgPhone(o.altPhone) : null,
        location: { district: o.district, area: o.area, address: o.address },
        navigationUrl: `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}`,
        amountToCollect: d.amountToCollect,
        amountCollected: d.amountCollected,
        paymentMethod: o.paymentMethod,
        notes: [o.notes, d.notes].filter(Boolean).join(" · ") || null,
        items: items.filter((i) => i.orderId === o.id).map((i) => ({ name: i.productName, variant: i.variantLabel, quantity: i.quantity })),
        assignedAt: d.assignedAt,
        deliveredAt: d.deliveredAt,
      };
    }),
  );
});

riderRoutes.get("/summary", async (c) => {
  const { db } = c.get("container");
  const riderId = c.get("staff").id;
  const today = new Date(new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Kampala" }) + "T00:00:00+03:00");
  const [row] = await db
    .select({
      delivered: sql<number>`count(*) filter (where ${deliveries.status} = 'delivered' and ${deliveries.deliveredAt} >= ${today.toISOString()}::timestamptz)::int`,
      pending: sql<number>`count(*) filter (where ${deliveries.status} in ('assigned','picked_up'))::int`,
      cashHeld: sql<number>`coalesce(sum(${deliveries.amountCollected}) filter (where ${deliveries.status} = 'delivered' and not ${deliveries.cashHandedOver}), 0)::int`,
    })
    .from(deliveries)
    .where(and(eq(deliveries.riderId, riderId), gte(deliveries.createdAt, new Date(Date.now() - 90 * 86400_000))));
  return c.json(row);
});

riderRoutes.post("/deliveries/:orderId/pickup", async (c) => {
  try {
    await c.get("container").orders.riderPickup(c.req.param("orderId"), c.get("staff").id);
    return c.json({ ok: true });
  } catch (err) {
    mapDomainError(err);
  }
});

riderRoutes.post("/deliveries/:orderId/deliver", async (c) => {
  const input = await body(c, z.object({ amountCollected: z.number().int().min(0), recipientName: z.string().max(120).optional(), notes: z.string().max(500).optional() }));
  try {
    await c.get("container").orders.riderDeliver(c.req.param("orderId"), c.get("staff").id, input);
    return c.json({ ok: true });
  } catch (err) {
    mapDomainError(err);
  }
});

riderRoutes.post("/deliveries/:orderId/fail", async (c) => {
  const { reason } = await body(c, z.object({ reason: z.string().min(3).max(300) }));
  try {
    await c.get("container").orders.riderFail(c.req.param("orderId"), c.get("staff").id, reason);
    return c.json({ ok: true });
  } catch (err) {
    mapDomainError(err);
  }
});
