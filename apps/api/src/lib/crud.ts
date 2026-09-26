import { Hono, type Context } from "hono";
import { asc, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import type { z } from "zod";
import type { Permission } from "@ugmall/shared";
import { requirePermission } from "../middleware/auth";
import { ApiError, body, pagination } from "./http";
import { audit } from "./audit";
import type { AppEnv } from "../types";

interface CrudOptions<S extends z.ZodObject> {
  table: PgTable & { id: PgColumn };
  schema: S;
  entity: string;
  permission: Permission;
  viewPermission?: Permission;
  searchColumns?: PgColumn[];
  orderBy?: PgColumn;
  orderDesc?: boolean;
  /** Transform validated input before insert/update (e.g. slugs, phone normalisation). */
  prepare?: (input: Record<string, unknown>, isCreate: boolean) => Record<string, unknown> | Promise<Record<string, unknown>>;
  /** Refuse deletes that would break history; return a message to block. */
  beforeDelete?: (id: string, c: Context<AppEnv>) => Promise<string | null>;
}

/** Standard list/get/create/update/delete endpoints for simple admin tables. */
export function crudRoutes<S extends z.ZodObject>(o: CrudOptions<S>) {
  const r = new Hono<AppEnv>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const t = o.table as any;

  r.get("/", requirePermission(o.viewPermission ?? o.permission), async (c) => {
    const { db } = c.get("container");
    const { limit, offset } = pagination(c, 500);
    const q = c.req.query("q")?.trim();
    const where: SQL | undefined =
      q && o.searchColumns?.length ? or(...o.searchColumns.map((col) => ilike(col, `%${q.replace(/[%_]/g, "")}%`))) : undefined;
    const orderCol = o.orderBy ?? t.createdAt ?? t.id;
    const [items, [{ total }]] = await Promise.all([
      db.select().from(t).where(where).orderBy(o.orderDesc === false ? asc(orderCol) : desc(orderCol)).limit(limit).offset(offset),
      db.select({ total: sql<number>`count(*)::int` }).from(t).where(where) as unknown as Promise<[{ total: number }]>,
    ]);
    return c.json({ items, total });
  });

  r.get("/:id", requirePermission(o.viewPermission ?? o.permission), async (c) => {
    const { db } = c.get("container");
    const [row] = await db.select().from(t).where(eq(t.id, c.req.param("id")));
    if (!row) throw new ApiError(404, `${o.entity} not found`);
    return c.json(row);
  });

  r.post("/", requirePermission(o.permission), async (c) => {
    const { db } = c.get("container");
    let input = (await body(c, o.schema)) as Record<string, unknown>;
    if (o.prepare) input = await o.prepare(input, true);
    try {
      const [row] = await db.insert(t).values(input).returning();
      await audit(db, c.get("staff").id, `${o.entity}.create`, o.entity, (row as { id: string }).id, input);
      return c.json(row, 201);
    } catch (err) {
      if ((err as { code?: string }).code === "23505" || (err as { cause?: { code?: string } }).cause?.code === "23505") throw new ApiError(409, `A ${o.entity} with that name/code already exists`);
      throw err;
    }
  });

  r.patch("/:id", requirePermission(o.permission), async (c) => {
    const { db } = c.get("container");
    let input = (await body(c, o.schema.partial())) as Record<string, unknown>;
    if (o.prepare) input = await o.prepare(input, false);
    try {
      const [row] = await db.update(t).set(input).where(eq(t.id, c.req.param("id"))).returning();
      if (!row) throw new ApiError(404, `${o.entity} not found`);
      await audit(db, c.get("staff").id, `${o.entity}.update`, o.entity, c.req.param("id"), input);
      return c.json(row);
    } catch (err) {
      if ((err as { cause?: { code?: string } }).cause?.code === "23505") throw new ApiError(409, `A ${o.entity} with that name/code already exists`);
      throw err;
    }
  });

  r.delete("/:id", requirePermission(o.permission), async (c) => {
    const { db } = c.get("container");
    const id = c.req.param("id");
    const block = o.beforeDelete ? await o.beforeDelete(id, c) : null;
    if (block) throw new ApiError(409, block);
    try {
      await db.delete(t).where(eq(t.id, id));
    } catch (err) {
      if ((err as { cause?: { code?: string } }).cause?.code === "23503") {
        throw new ApiError(409, `This ${o.entity} is in use. Deactivate it instead of deleting.`);
      }
      throw err;
    }
    await audit(db, c.get("staff").id, `${o.entity}.delete`, o.entity, id);
    return c.json({ ok: true });
  });
  return r;
}
