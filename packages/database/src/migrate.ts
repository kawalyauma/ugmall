import { fileURLToPath } from "node:url";
import path from "node:path";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDb } from "./index";

export async function runMigrations(url = process.env.DATABASE_URL, migrationsFolder?: string) {
  const folder =
    migrationsFolder ?? process.env.MIGRATIONS_DIR ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../migrations");
  const { db, client } = createDb(url, { max: 1 });
  try {
    await migrate(db, { migrationsFolder: folder });
  } finally {
    await client.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  runMigrations()
    .then(() => {
      console.log("Migrations applied");
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
