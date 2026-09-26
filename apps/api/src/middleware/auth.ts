import type { MiddlewareHandler } from "hono";
import { eq } from "drizzle-orm";
import { customers, roles, staffUsers } from "@ugmall/database";
import { hasPermission, type Permission } from "@ugmall/shared";
import { ApiError, COOKIES, readCookie } from "../lib/http";
import type { AppEnv } from "../types";

/** Staff session from cookie (or `Authorization: Bearer` for scripts). */
export const requireStaff: MiddlewareHandler<AppEnv> = async (c, next) => {
  const { sessions, db } = c.get("container");
  const bearer = c.req.header("authorization")?.replace(/^Bearer\s+/i, "");
  const token = readCookie(c, COOKIES.staff) ?? bearer;
  const session = await sessions.get(token, "staff");
  if (!session) throw new ApiError(401, "Please sign in");
  const [row] = await db
    .select({ id: staffUsers.id, name: staffUsers.name, email: staffUsers.email, isActive: staffUsers.isActive, roleName: roles.name, permissions: roles.permissions })
    .from(staffUsers)
    .innerJoin(roles, eq(roles.id, staffUsers.roleId))
    .where(eq(staffUsers.id, session.subjectId));
  if (!row || !row.isActive) {
    await sessions.destroy(token);
    throw new ApiError(401, "Your account is disabled");
  }
  c.set("staff", { id: row.id, name: row.name, email: row.email, roleName: row.roleName, permissions: row.permissions });
  c.set("sessionToken", token!);
  await next();
};

export const requirePermission =
  (...needed: Permission[]): MiddlewareHandler<AppEnv> =>
  async (c, next) => {
    const staff = c.get("staff");
    if (!needed.some((p) => hasPermission(staff.permissions, p))) throw new ApiError(403, "You don't have permission to do that");
    await next();
  };

/** Optional customer session; sets `customer` to null when absent. */
export const loadCustomer: MiddlewareHandler<AppEnv> = async (c, next) => {
  const { sessions, db } = c.get("container");
  const token = readCookie(c, COOKIES.customer);
  c.set("customer", null);
  if (token) {
    const session = await sessions.get(token, "customer");
    if (session) {
      const [row] = await db.select({ id: customers.id, name: customers.name, phone: customers.phone }).from(customers).where(eq(customers.id, session.subjectId));
      if (row) {
        c.set("customer", row);
        c.set("sessionToken", token);
      }
    }
  }
  await next();
};

export const requireCustomer: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!c.get("customer")) throw new ApiError(401, "Please sign in with your phone number");
  await next();
};
