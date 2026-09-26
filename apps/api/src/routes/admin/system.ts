import { Hono } from "hono";
import { z } from "zod";
import { count, desc, eq, sql } from "drizzle-orm";
import { auditLog, mediaFiles, notificationLog, staffUsers } from "@ugmall/database";
import type { NotificationEvent, OrderMessageContext } from "@ugmall/notifications";
import { PERMISSIONS, STORAGE_AREAS, type StorageArea } from "@ugmall/shared";
import { signedPrivateUrl } from "@ugmall/storage";
import { ApiError, body, pagination } from "../../lib/http";
import { audit } from "../../lib/audit";
import { deleteMedia, readUpload, saveDocument, saveImage } from "../../lib/media";
import { DEFAULT_SETTINGS, getSettings, saveSettings } from "../../lib/settings";
import { requirePermission } from "../../middleware/auth";
import type { AppEnv } from "../../types";

export const adminSystemRoutes = new Hono<AppEnv>();
const P = PERMISSIONS;

adminSystemRoutes.get("/settings", requirePermission(P.settingsManage), async (c) => c.json(await getSettings(c.get("container").db)));

adminSystemRoutes.put("/settings", requirePermission(P.settingsManage), async (c) => {
  const shape = Object.fromEntries(
    Object.entries(DEFAULT_SETTINGS).map(([k, v]) => [k, (typeof v === "boolean" ? z.boolean() : z.string().max(2000)).optional()]),
  );
  const input = await body(c, z.object(shape));
  if (typeof input.whatsappNumber === "string" && !/^256\d{9}$/.test(input.whatsappNumber)) throw new ApiError(422, "WhatsApp number must look like 2567XXXXXXXX");
  const { db } = c.get("container");
  await saveSettings(db, input);
  await audit(db, c.get("staff").id, "settings.update", "settings", undefined, input);
  return c.json(await getSettings(db));
});

/** Generic upload into a storage area (e.g. receipts for expenses, supplier invoices). */
adminSystemRoutes.post("/media", requirePermission(P.mediaUpload, P.productsManage, P.expensesManage, P.purchasesManage), async (c) => {
  const { db, storage, env } = c.get("container");
  const form = await c.req.formData();
  const area = String(form.get("area") ?? "temp") as StorageArea;
  if (!STORAGE_AREAS.includes(area)) throw new ApiError(422, "Unknown storage area");
  const folder = String(form.get("folder") ?? new Date().toISOString().slice(0, 7));
  const { buffer, name } = await readUpload(form);
  const isImage = /\.(jpe?g|png|webp|gif|avif)$/i.test(name) && form.get("keepOriginal") !== "1";
  const row = isImage
    ? await saveImage(db, storage, { area, folders: [folder], baseName: name.replace(/\.[^.]+$/, ""), buffer, originalName: name, staffId: c.get("staff").id })
    : await saveDocument(db, storage, { area, folders: [folder], fileName: name, buffer, originalName: name, staffId: c.get("staff").id });
  return c.json({ ...row, url: row.publicUrl ?? signedPrivateUrl(env.APP_SECRET, env.API_PUBLIC_URL, row.storagePath, 900) }, 201);
});

adminSystemRoutes.get("/media", requirePermission(P.productsView), async (c) => {
  const { db, env } = c.get("container");
  const { limit, offset } = pagination(c, 200);
  const area = c.req.query("area");
  const rows = await db
    .select()
    .from(mediaFiles)
    .where(area ? eq(mediaFiles.area, area) : undefined)
    .orderBy(desc(mediaFiles.createdAt))
    .limit(limit)
    .offset(offset);
  return c.json(rows.map((m) => ({ ...m, url: m.publicUrl ?? signedPrivateUrl(env.APP_SECRET, env.API_PUBLIC_URL, m.storagePath, 900) })));
});

adminSystemRoutes.delete("/media/:id", requirePermission(P.productsManage), async (c) => {
  const { db, storage } = c.get("container");
  const [m] = await db.select().from(mediaFiles).where(eq(mediaFiles.id, c.req.param("id")));
  if (!m) throw new ApiError(404, "File not found");
  try {
    await db.delete(mediaFiles).where(eq(mediaFiles.id, m.id));
  } catch {
    throw new ApiError(409, "This file is still used by a product, category or record");
  }
  await deleteMedia(storage, m);
  await audit(db, c.get("staff").id, "media.delete", "media", m.id, { path: m.storagePath });
  return c.json({ ok: true });
});

/** Storage usage per area, for the settings/system page. */
adminSystemRoutes.get("/system/storage", requirePermission(P.settingsManage), async (c) => {
  const { db, storage, env } = c.get("container");
  const rows = await db
    .select({ area: mediaFiles.area, files: count(), bytes: sql<number>`coalesce(sum(${mediaFiles.fileSize}),0)::bigint` })
    .from(mediaFiles)
    .groupBy(mediaFiles.area);
  return c.json({ driver: storage.name, root: env.STORAGE_DRIVER === "local" ? env.STORAGE_ROOT : undefined, areas: rows.map((r) => ({ ...r, bytes: Number(r.bytes) })) });
});

adminSystemRoutes.get("/notifications", requirePermission(P.ordersView), async (c) => {
  const { db } = c.get("container");
  const { limit, offset } = pagination(c, 200);
  return c.json(await db.select().from(notificationLog).orderBy(desc(notificationLog.createdAt)).limit(limit).offset(offset));
});

adminSystemRoutes.post("/notifications/:id/retry", requirePermission(P.ordersManage), async (c) => {
  const { db, queues } = c.get("container");
  const [n] = await db.select().from(notificationLog).where(eq(notificationLog.id, c.req.param("id")));
  if (!n) throw new ApiError(404, "Notification not found");
  await queues.notifications.add(n.template, { event: n.template as NotificationEvent, to: n.recipient, orderId: n.orderId ?? undefined, context: n.payload as OrderMessageContext, logId: n.id });
  return c.json({ ok: true });
});

adminSystemRoutes.get("/audit-log", requirePermission(P.staffManage), async (c) => {
  const { db } = c.get("container");
  const { limit, offset } = pagination(c, 500);
  const rows = await db
    .select({ a: auditLog, staffName: staffUsers.name })
    .from(auditLog)
    .leftJoin(staffUsers, eq(staffUsers.id, auditLog.staffId))
    .orderBy(desc(auditLog.createdAt))
    .limit(limit)
    .offset(offset);
  return c.json(rows.map((r) => ({ ...r.a, staffName: r.staffName })));
});

/** Queue health for the system page. */
adminSystemRoutes.get("/system/queues", requirePermission(P.settingsManage), async (c) => {
  const { queues } = c.get("container");
  const out: Record<string, unknown> = {};
  for (const [name, q] of Object.entries(queues)) out[name] = await q.getJobCounts("waiting", "active", "delayed", "failed", "completed");
  return c.json(out);
});

