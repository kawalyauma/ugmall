import { runMigrations } from "@ugmall/database/migrate";

await runMigrations(process.env.DATABASE_URL);
console.log("Migrations applied");
