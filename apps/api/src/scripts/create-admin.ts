/**
 * Create (or reset) an owner account:
 *   pnpm --filter @ugmall/api create-admin -- owner@shop.ug "Owner Name" 'a-long-password'
 * In Docker: docker compose run --rm api node dist/create-admin.js owner@shop.ug "Owner" 'password'
 */
import { eq } from "drizzle-orm";
import { createDb, roles, staffUsers } from "@ugmall/database";
import { hashPassword } from "@ugmall/auth";
import { DEFAULT_ROLES } from "@ugmall/shared";

const [email, name, password] = process.argv.slice(2).filter((a) => a !== "--");
if (!email || !name || !password || password.length < 10) {
  console.error('Usage: create-admin <email> "<name>" <password (min 10 chars)>');
  process.exit(1);
}
const { db, client } = createDb();
await db
  .insert(roles)
  .values({ name: "owner", description: DEFAULT_ROLES.owner!.description, permissions: ["*"], isSystem: true })
  .onConflictDoNothing();
const [owner] = await db.select().from(roles).where(eq(roles.name, "owner"));
await db
  .insert(staffUsers)
  .values({ email: email.toLowerCase(), name, passwordHash: await hashPassword(password), roleId: owner!.id })
  .onConflictDoUpdate({ target: staffUsers.email, set: { passwordHash: await hashPassword(password), roleId: owner!.id, isActive: true } });
console.log(`Owner account ready: ${email}`);
await client.end();
