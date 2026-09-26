import { Hono } from "hono";
import { z } from "zod";
import { coupons, promotions } from "@ugmall/database";
import { COUPON_TYPES, PERMISSIONS, slugify } from "@ugmall/shared";
import { crudRoutes } from "../../lib/crud";
import { readUpload, saveImage } from "../../lib/media";
import { requirePermission } from "../../middleware/auth";
import { eq } from "drizzle-orm";
import { ApiError } from "../../lib/http";
import type { AppEnv } from "../../types";

export const adminMarketingRoutes = new Hono<AppEnv>();
const P = PERMISSIONS;

const dateish = z
  .string()
  .nullable()
  .optional()
  .transform((v) => (v ? new Date(v) : v === null ? null : undefined));

adminMarketingRoutes.route(
  "/coupons",
  crudRoutes({
    table: coupons,
    schema: z.object({
      code: z.string().trim().min(3).max(40).regex(/^[A-Za-z0-9_-]+$/),
      description: z.string().max(300).nullable().optional(),
      type: z.enum(COUPON_TYPES),
      value: z.number().int().min(0),
      maxDiscount: z.number().int().min(0).nullable().optional(),
      minOrderAmount: z.number().int().min(0).default(0),
      maxUses: z.number().int().min(1).nullable().optional(),
      maxUsesPerCustomer: z.number().int().min(1).default(1),
      startsAt: dateish,
      endsAt: dateish,
      isActive: z.boolean().default(true),
    }),
    entity: "coupon",
    permission: P.promotionsManage,
    searchColumns: [coupons.code],
    prepare: (i) => {
      if (i.type === "percent" && typeof i.value === "number" && i.value > 100) throw new ApiError(422, "Percentage cannot exceed 100");
      return i.code ? { ...i, code: String(i.code).toUpperCase() } : i;
    },
  }),
);

adminMarketingRoutes.route(
  "/promotions",
  crudRoutes({
    table: promotions,
    schema: z.object({
      title: z.string().trim().min(2).max(120),
      slug: z.string().max(120).optional(),
      description: z.string().max(2000).nullable().optional(),
      bannerId: z.string().uuid().nullable().optional(),
      percentOff: z.number().int().min(1).max(90).nullable().optional(),
      productIds: z.array(z.string().uuid()).max(1000).default([]),
      categoryIds: z.array(z.string().uuid()).max(100).default([]),
      startsAt: dateish,
      endsAt: dateish,
      isActive: z.boolean().default(true),
    }),
    entity: "promotion",
    permission: P.promotionsManage,
    searchColumns: [promotions.title],
    prepare: (i) => (i.title || i.slug ? { ...i, slug: slugify(String(i.slug || i.title)) } : i),
  }),
);

adminMarketingRoutes.post("/promotions/:id/banner", requirePermission(P.promotionsManage), async (c) => {
  const { db, storage } = c.get("container");
  const [promo] = await db.select().from(promotions).where(eq(promotions.id, c.req.param("id")));
  if (!promo) throw new ApiError(404, "Promotion not found");
  const { buffer, name } = await readUpload(await c.req.formData());
  // banners live with category imagery: storage/categories/offers/<slug>/banner-xxxx.webp
  const media = await saveImage(db, storage, { area: "categories", folders: ["offers", promo.slug], baseName: "banner", buffer, originalName: name, staffId: c.get("staff").id });
  await db.update(promotions).set({ bannerId: media.id }).where(eq(promotions.id, promo.id));
  return c.json({ bannerId: media.id, url: media.publicUrl });
});
