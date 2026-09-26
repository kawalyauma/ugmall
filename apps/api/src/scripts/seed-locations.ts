/**
 * Loads Uganda's areas (regions → districts → divisions → parishes → villages)
 * and, the first time only, links the starter delivery zones to them.
 * Safe to run on every deploy.
 *   pnpm --filter @ugmall/api seed-locations        (dev)
 *   docker compose exec api node dist/seed-locations.js
 */
import { eq, sql } from "drizzle-orm";
import { createDb, deliveryZones, locations, settings, type Database } from "@ugmall/database";
import { findByPath, seedUgandaLocations } from "@ugmall/delivery";

/** Starter coverage: which areas each zone covers. Edit later in Admin → Deliveries. */
const STARTER_COVERAGE: { zone: string; fee?: number; eta?: string; methods?: string[]; paths: string[][] }[] = [
  { zone: "Upcountry", paths: [["Central"], ["Eastern"], ["Northern"], ["Western"]] },
  { zone: "Kampala – other areas", fee: 6000, eta: "Same day", methods: ["boda", "internal_rider", "pickup"], paths: [["Central", "Kampala"]] },
  { zone: "Kampala Central", paths: [["Central", "Kampala", "Kampala Central"]] },
  { zone: "Makindye", paths: [["Central", "Kampala", "Makindye Division"]] },
  { zone: "Ntinda", paths: [["Central", "Kampala", "Nakawa", "Ntinda"]] },
  { zone: "Kira", paths: [["Central", "Wakiso", "Kira Division"], ["Central", "Wakiso", "Bweyogerere Division"], ["Central", "Wakiso", "Namugongo Division"]] },
  { zone: "Wakiso", paths: [["Central", "Wakiso"]] },
  { zone: "Entebbe", paths: [["Central", "Wakiso", "Division A"], ["Central", "Wakiso", "Division B"]] },
];

export async function seedLocations(db: Database, log = console.log) {
  const r = await seedUgandaLocations(db);
  log(r.skipped ? "Locations already loaded" : `Loaded ${r.inserted} Ugandan areas`);

  // Starter coverage is applied once, after the starter zones exist; never overwrites the shop's choices.
  const [flag] = await db.select().from(settings).where(eq(settings.key, "starterCoverageApplied"));
  if (flag) return;
  const [{ n }] = (await db.select({ n: sql<number>`count(*)::int` }).from(locations).where(sql`${locations.deliveryZoneId} is not null`)) as [{ n: number }];
  const [upcountry] = await db.select().from(deliveryZones).where(eq(deliveryZones.name, "Upcountry"));
  if (n > 0 || !upcountry) {
    if (!upcountry && n === 0) log("Delivery zones not created yet — run the seed, then this again to link starter coverage");
    else await db.insert(settings).values({ key: "starterCoverageApplied", value: true }).onConflictDoNothing();
    return;
  }
  for (const c of STARTER_COVERAGE) {
    let [zone] = await db.select().from(deliveryZones).where(eq(deliveryZones.name, c.zone));
    if (!zone && c.fee !== undefined) {
      [zone] = await db.insert(deliveryZones).values({ name: c.zone, fee: c.fee, etaText: c.eta, methods: c.methods ?? ["boda", "pickup"], sortOrder: 7 }).returning();
    }
    if (!zone) continue;
    for (const p of c.paths) {
      const loc = await findByPath(db, p);
      if (loc) await db.update(locations).set({ deliveryZoneId: zone.id }).where(eq(locations.id, loc.id));
      else log(`  (starter coverage) area not found: ${p.join(" › ")}`);
    }
  }
  await db.insert(settings).values({ key: "starterCoverageApplied", value: true }).onConflictDoNothing();
  log("Linked starter delivery zones to areas");
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("seed-locations.js")) {
  const { db, client } = createDb();
  seedLocations(db)
    .catch((e) => {
      console.error(e);
      process.exitCode = 1;
    })
    .finally(() => client.end());
}
