import fs from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { and, asc, count, eq, ilike, isNull, sql } from "drizzle-orm";
import { deliveryZones, locations, LOCATION_LEVELS, type Database, type DbOrTx } from "@ugmall/database";

export type LocationLevel = (typeof LOCATION_LEVELS)[number];
export type LocationRow = typeof locations.$inferSelect;

export const LEVEL_LABELS: Record<LocationLevel, string> = {
  region: "Region",
  district: "District",
  division: "Division / Sub-county",
  parish: "Village / Area",
  village: "Village / Cell",
};

export const PATH_SEPARATOR = " › ";

/* ------------------------------------------------------------------ seeding */

type Node = [string, Node[] | string[]];
type Tree = Node[];

export function findLocationsDataFile(): string | null {
  const candidates = [
    process.env.LOCATIONS_DATA,
    path.resolve(process.cwd(), "data/uganda-locations.json.gz"),
    path.resolve(process.cwd(), "../../packages/delivery/data/uganda-locations.json.gz"),
    path.resolve(process.cwd(), "packages/delivery/data/uganda-locations.json.gz"),
  ].filter(Boolean) as string[];
  return candidates.find((c) => fs.existsSync(c)) ?? null;
}

/**
 * Loads Uganda's regions, districts, divisions, parishes and villages
 * (~84,000 areas) into the locations table. Runs once; later calls are no-ops.
 */
export async function seedUgandaLocations(db: Database, file = findLocationsDataFile()): Promise<{ inserted: number; skipped: boolean }> {
  const [{ n }] = (await db.select({ n: count() }).from(locations)) as [{ n: number }];
  if (n > 0) return { inserted: 0, skipped: true };
  if (!file) throw new Error("uganda-locations.json.gz not found (set LOCATIONS_DATA)");
  const tree = JSON.parse(gunzipSync(fs.readFileSync(file)).toString("utf8")) as Tree;

  let inserted = 0;
  // Breadth-first, one level at a time, in batches (fast even for 71k villages).
  type Pending = { parentId: number | null; parentPath: string; name: string; children: Tree | string[] | null };
  let level: Pending[] = tree.map(([name, children]) => ({ parentId: null, parentPath: "", name, children: children as Tree | string[] }));
  for (let depth = 0; depth < LOCATION_LEVELS.length && level.length; depth++) {
    const next: Pending[] = [];
    for (let i = 0; i < level.length; i += 2000) {
      const batch = level.slice(i, i + 2000);
      const rows = await db
        .insert(locations)
        .values(
          batch.map((b) => ({
            parentId: b.parentId,
            level: LOCATION_LEVELS[depth]!,
            name: b.name,
            path: b.parentPath ? `${b.parentPath}${PATH_SEPARATOR}${b.name}` : b.name,
          })),
        )
        .returning({ id: locations.id, path: locations.path });
      rows.forEach((r, k) => {
        const children = batch[k]!.children;
        if (!children) return;
        for (const c of children) {
          if (typeof c === "string") next.push({ parentId: r.id, parentPath: r.path, name: c, children: null });
          else next.push({ parentId: r.id, parentPath: r.path, name: c[0], children: c[1] });
        }
      });
      inserted += rows.length;
    }
    level = next;
  }
  return { inserted, skipped: false };
}

/** Find a location by its path names, e.g. ["Central", "Kampala", "Nakawa", "Ntinda"]. */
export async function findByPath(db: DbOrTx, names: string[]): Promise<LocationRow | null> {
  let parentId: number | null = null;
  let row: LocationRow | null = null;
  for (const name of names) {
    const found: LocationRow[] = await db
      .select()
      .from(locations)
      .where(and(parentId === null ? isNull(locations.parentId) : eq(locations.parentId, parentId), sql`lower(${locations.name}) = ${name.toLowerCase()}`))
      .limit(1);
    row = found[0] ?? null;
    if (!row) return null;
    parentId = row.id;
  }
  return row;
}

/* ------------------------------------------------------------ browsing/search */

export async function childLocations(db: DbOrTx, parentId: number | null) {
  return db
    .select({
      id: locations.id,
      name: locations.name,
      level: locations.level,
      hasChildren: sql<boolean>`exists(select 1 from ${locations} c where c.parent_id = ${locations.id} and c.is_active)`,
    })
    .from(locations)
    .where(and(parentId === null ? isNull(locations.parentId) : eq(locations.parentId, parentId), eq(locations.isActive, true)))
    .orderBy(asc(locations.name));
}

const LEVEL_RANK = sql`case ${locations.level} when 'parish' then 0 when 'division' then 1 when 'district' then 2 when 'village' then 3 else 4 end`;

/** Type-ahead: "ntinda" -> Ntinda (Central › Kampala › Nakawa). Areas people know rank first. */
export async function searchLocations(db: DbOrTx, q: string, limit = 20) {
  const term = q.trim().replace(/[%_\\]/g, "").slice(0, 60);
  if (term.length < 2) return [];
  return db
    .select({ id: locations.id, name: locations.name, level: locations.level, path: locations.path })
    .from(locations)
    .where(and(eq(locations.isActive, true), ilike(locations.name, `%${term}%`)))
    .orderBy(
      // Areas inside districts/divisions the shop has priced (Kampala, Wakiso …) first
      sql`case when exists (select 1 from ${locations} z where z.delivery_zone_id is not null and z.level <> 'region' and (${locations.path} = z.path or ${locations.path} like z.path || ' › %')) then 0 else 1 end`,
      sql`case when lower(${locations.name}) like lower(${`${term}%`}) then 0 else 1 end`,
      LEVEL_RANK,
      asc(locations.path),
    )
    .limit(limit);
}

/** The chain from the region down to the location (inclusive). */
export async function ancestry(db: DbOrTx, id: number): Promise<LocationRow[]> {
  const rows = (await db.execute(sql`
    with recursive up as (
      select l.*, 0 as depth from ${locations} l where l.id = ${id}
      union all
      select p.*, up.depth + 1 from ${locations} p join up on p.id = up.parent_id
    )
    select id, parent_id as "parentId", level, name, path, delivery_zone_id as "deliveryZoneId", is_custom as "isCustom", is_active as "isActive"
    from up order by depth desc`)) as unknown as LocationRow[];
  return rows;
}

/* ------------------------------------------------------------ zone resolution */

export interface ResolvedLocation {
  location: LocationRow;
  chain: LocationRow[];
  zone: typeof deliveryZones.$inferSelect | null;
  /** Which area in the chain supplied the zone (for "priced as Ntinda"). */
  zoneFrom: LocationRow | null;
  /** True when a more specific choice could change the fee (e.g. only "Kampala" chosen). */
  moreSpecificMayDiffer: boolean;
  district: string | null;
  area: string;
}

/**
 * Delivery zone for a chosen area: the nearest zone walking up the tree.
 * e.g. Ntinda (parish, zone "Ntinda") -> Ntinda; Kiwatule (no zone) ->
 * Nakawa (none) -> Kampala (zone "Kampala – other areas").
 */
export async function resolveLocation(db: DbOrTx, locationId: number): Promise<ResolvedLocation | null> {
  const chain = await ancestry(db, locationId);
  const location = chain.at(-1);
  if (!location) return null;
  const zoneFrom = [...chain].reverse().find((l) => l.deliveryZoneId) ?? null;
  const zone = zoneFrom
    ? ((await db.select().from(deliveryZones).where(eq(deliveryZones.id, zoneFrom.deliveryZoneId!)))[0] ?? null)
    : null;

  let moreSpecificMayDiffer = false;
  if (location.level !== "village") {
    const res = (await db.execute(sql`
      with recursive down as (
        select id, delivery_zone_id from ${locations} where parent_id = ${location.id}
        union all
        select c.id, c.delivery_zone_id from ${locations} c join down on c.parent_id = down.id
      )
      select 1 from down where delivery_zone_id is not null and delivery_zone_id is distinct from ${zone?.id ?? null}::uuid limit 1`)) as unknown as unknown[];
    moreSpecificMayDiffer = res.length > 0;
  }
  const district = chain.find((l) => l.level === "district")?.name ?? null;
  const below = chain.filter((l) => l.level === "parish" || l.level === "village" || l.level === "division");
  return { location, chain, zone, zoneFrom, moreSpecificMayDiffer, district, area: below.map((l) => l.name).reverse()[0] ?? location.name };
}

/* ------------------------------------------------------------------ admin */

export async function assignZone(db: DbOrTx, locationId: number, zoneId: string | null) {
  await db.update(locations).set({ deliveryZoneId: zoneId }).where(eq(locations.id, locationId));
}

export async function zoneCoverage(db: DbOrTx) {
  return db
    .select({ id: locations.id, name: locations.name, level: locations.level, path: locations.path, zoneId: locations.deliveryZoneId })
    .from(locations)
    .where(sql`${locations.deliveryZoneId} is not null`)
    .orderBy(asc(locations.path));
}

/** Staff can add an area that is missing from the official list (e.g. a new estate). */
export async function addLocation(db: DbOrTx, parentId: number, name: string) {
  const [parent] = await db.select().from(locations).where(eq(locations.id, parentId));
  if (!parent) throw new Error("Parent area not found");
  const idx = LOCATION_LEVELS.indexOf(parent.level);
  const level = LOCATION_LEVELS[Math.min(idx + 1, LOCATION_LEVELS.length - 1)]!;
  const clean = name.trim().replace(/\s+/g, " ").slice(0, 80);
  const [row] = await db
    .insert(locations)
    .values({ parentId, level, name: clean, path: `${parent.path}${PATH_SEPARATOR}${clean}`, isCustom: true })
    .onConflictDoNothing()
    .returning();
  return row ?? (await db.select().from(locations).where(and(eq(locations.parentId, parentId), sql`lower(${locations.name}) = ${clean.toLowerCase()}`)))[0]!;
}

