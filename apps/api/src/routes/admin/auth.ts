import { Hono } from "hono";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { roles, staffUsers } from "@ugmall/database";
import { hashPassword, verifyPassword } from "@ugmall/auth";
import { ApiError, body, clearCookie, clientIp, COOKIES, writeCookie } from "../../lib/http";
import { audit } from "../../lib/audit";
import { requireStaff } from "../../middleware/auth";
import { limit } from "../../middleware/security";
import type { AppEnv } from "../../types";

export const adminAuthRoutes = new Hono<AppEnv>();

// A constant hash so failed lookups take as long as real ones (no user enumeration by timing).
const DUMMY_HASH = hashPassword("dummy-password-for-timing");

adminAuthRoutes.post(
  "/login",
  limit("staff-login-ip", 20, 900),
  async (c) => {
    const input = await body(c, z.object({ email: z.string().email(), password: z.string().min(1).max(200) }));
    const { db, sessions, redis } = c.get("container");
    const email = input.email.toLowerCase().trim();
    const lockKey = `login-fail:${email}`;
    if (Number(await redis.get(lockKey)) >= 8) throw new ApiError(429, "Too many failed attempts. Try again in 15 minutes.");
    const [user] = await db.select().from(staffUsers).where(eq(staffUsers.email, email));
    const ok = await verifyPassword(input.password, user?.passwordHash ?? (await DUMMY_HASH));
    if (!user || !ok || !user.isActive) {
      await redis.multi().incr(lockKey).expire(lockKey, 900).exec();
      throw new ApiError(401, "Wrong email or password");
    }
    await redis.del(lockKey);
    const token = await sessions.create("staff", user.id, { ip: clientIp(c), userAgent: c.req.header("user-agent") });
    writeCookie(c, COOKIES.staff, token, 60 * 60 * 12);
    await db.update(staffUsers).set({ lastLoginAt: new Date() }).where(eq(staffUsers.id, user.id));
    await audit(db, user.id, "auth.login", "staff", user.id, undefined, clientIp(c));
    const [role] = await db.select().from(roles).where(eq(roles.id, user.roleId));
    return c.json({ id: user.id, name: user.name, email: user.email, role: role?.name, permissions: role?.permissions ?? [] });
  },
);

adminAuthRoutes.post("/logout", requireStaff, async (c) => {
  await c.get("container").sessions.destroy(c.get("sessionToken"));
  clearCookie(c, COOKIES.staff);
  return c.json({ ok: true });
});

adminAuthRoutes.get("/me", requireStaff, (c) => {
  const s = c.get("staff");
  return c.json({ id: s.id, name: s.name, email: s.email, role: s.roleName, permissions: s.permissions });
});

adminAuthRoutes.post("/change-password", requireStaff, async (c) => {
  const input = await body(c, z.object({ currentPassword: z.string(), newPassword: z.string().min(10).max(200) }));
  const { db, sessions } = c.get("container");
  const staff = c.get("staff");
  const [user] = await db.select().from(staffUsers).where(eq(staffUsers.id, staff.id));
  if (!user || !(await verifyPassword(input.currentPassword, user.passwordHash))) throw new ApiError(401, "Current password is wrong");
  await db.update(staffUsers).set({ passwordHash: await hashPassword(input.newPassword) }).where(eq(staffUsers.id, staff.id));
  await sessions.destroyAll("staff", staff.id);
  const token = await sessions.create("staff", staff.id, { ip: clientIp(c) });
  writeCookie(c, COOKIES.staff, token, 60 * 60 * 12);
  await audit(db, staff.id, "auth.change_password", "staff", staff.id);
  return c.json({ ok: true });
});
