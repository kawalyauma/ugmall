import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export * from "./schema";
export { schema };
export type Database = PostgresJsDatabase<typeof schema>;
/** A database handle or an open transaction — services accept either. */
export type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
export type DbOrTx = Database | Tx;

let cached: { db: Database; client: postgres.Sql } | null = null;

export function createDb(url = process.env.DATABASE_URL, opts: { max?: number } = {}) {
  if (!url) throw new Error("DATABASE_URL is not set");
  const client = postgres(url, { max: opts.max ?? 10, prepare: true, onnotice: () => {} });
  const db = drizzle(client, { schema });
  return { db, client };
}

/** Process-wide singleton. */
export function getDb(): Database {
  if (!cached) cached = createDb();
  return cached.db;
}

export async function closeDb() {
  if (cached) {
    await cached.client.end({ timeout: 5 });
    cached = null;
  }
}
