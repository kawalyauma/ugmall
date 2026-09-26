import { Hono } from "hono";
import { and, asc, desc, eq, gt, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { brands, categories, deliveryZones, mediaFiles, promotions, reviews } from "@ugmall/database";
import { childLocations, LEVEL_LABELS, resolveLocation, searchLocations } from "@ugmall/delivery";
import { ApiError, pagination } from "../../lib/http";
import { listProducts, productDetail } from "../../lib/catalog";
import { getPublicSettings } from "../../lib/settings";
import type { AppEnv } from "../../types";

export const catalogRoutes = new Hono<AppEnv>();

catalogRoutes.get("/settings", async (c) => {
  const { db, payments } = c.get("container");
  c.header("Cache-Control", "public, max-age=60");
  return c.json({ ...(await getPublicSettings(db)), paymentMethods: payments.enabledMethods() });
});

catalogRoutes.get("/categories", async (c) => {
  const { db } = c.get("container");
  const rows = await db
    .select({ c: categories, image: mediaFiles.publicUrl, thumb: sql<string | null>`${mediaFiles.variants}->'medium'->>'url'` })
    .from(categories)
    .leftJoin(mediaFiles, eq(mediaFiles.id, categories.imageId))
    .where(eq(categories.isActive, true))
    .orderBy(asc(categories.sortOrder), asc(categories.name));
  c.header("Cache-Control", "public, max-age=60");
  return c.json(
    rows.map((r) => ({
      id: r.c.id,
      name: r.c.name,
      slug: r.c.slug,
      parentId: r.c.parentId,
      description: r.c.description,
      image: r.thumb ?? r.image,
    })),
  );
});

catalogRoutes.get("/brands", async (c) => {
  const { db } = c.get("container");
  return c.json(await db.select({ id: brands.id, name: brands.name, slug: brands.slug }).from(brands).where(eq(brands.isActive, true)).orderBy(asc(brands.name)));
});

catalogRoutes.get("/products", async (c) => {
  const { db } = c.get("container");
  const { limit, offset, page } = pagination(c, 60);
  const q = c.req.query();
  let categoryIds: string[] | undefined;
  const requestedCategorySlugs = [q.category, ...(q.categories?.split(",") ?? [])].filter((slug): slug is string => Boolean(slug));
  if (requestedCategorySlugs.length) {
    const all = await db.select({ id: categories.id, parentId: categories.parentId, slug: categories.slug }).from(categories);
    const roots = all.filter((x) => requestedCategorySlugs.includes(x.slug));
    if (!roots.length) return c.json({ items: [], total: 0, page, limit });
    // Include descendants of every requested category, without duplicates.
    categoryIds = [...new Set(roots.map((x) => x.id))];
    for (let i = 0; i < categoryIds.length; i++) {
      for (const x of all) if (x.parentId === categoryIds[i] && !categoryIds.includes(x.id)) categoryIds.push(x.id);
    }
  }
  let brandId: string | undefined;
  if (q.brand) brandId = (await db.select({ id: brands.id }).from(brands).where(eq(brands.slug, q.brand)))[0]?.id ?? "00000000-0000-0000-0000-000000000000";
  let productIds: string[] | undefined;
  if (q.offer) {
    const [promo] = await db.select().from(promotions).where(eq(promotions.slug, q.offer));
    if (promo) {
      productIds = promo.productIds;
      if (promo.categoryIds.length) categoryIds = [...(categoryIds ?? []), ...promo.categoryIds];
      if (promo.categoryIds.length && !promo.productIds.length) productIds = undefined;
    }
  }
  const num = (v?: string) => (v && /^\d+$/.test(v) ? Number(v) : undefined);
  const result = await listProducts(db, {
    q: q.q,
    categoryIds,
    brandId,
    productIds,
    minPrice: num(q.min),
    maxPrice: num(q.max),
    size: q.size,
    colour: q.colour,
    featured: q.featured === "1",
    onSale: q.sale === "1",
    sort: (["newest", "price_asc", "price_desc", "popular", "rating"] as const).find((s) => s === q.sort),
    limit,
    offset,
  });
  return c.json({ ...result, page, limit });
});

catalogRoutes.get("/products/:slug", async (c) => {
  const { db, reservations } = c.get("container");
  const p = await productDetail(db, reservations, c.req.param("slug"));
  if (!p) throw new ApiError(404, "Product not found");
  const related = p.category
    ? await listProducts(db, { categoryIds: [p.category.id], limit: 9, offset: 0, sort: "popular" })
    : { items: [] };
  return c.json({ ...p, related: related.items.filter((r) => r.id !== p.id).slice(0, 8) });
});

catalogRoutes.get("/products/:id/reviews", async (c) => {
  const { db } = c.get("container");
  const { limit, offset } = pagination(c, 50);
  const rows = await db
    .select({
      id: reviews.id,
      name: reviews.name,
      rating: reviews.rating,
      title: reviews.title,
      body: reviews.body,
      verified: reviews.isVerifiedPurchase,
      reply: reviews.reply,
      imageIds: reviews.imageIds,
      createdAt: reviews.createdAt,
    })
    .from(reviews)
    .where(and(eq(reviews.productId, c.req.param("id")), eq(reviews.status, "approved")))
    .orderBy(desc(reviews.createdAt))
    .limit(limit)
    .offset(offset);
  const ids = rows.flatMap((r) => r.imageIds);
  const imgs = ids.length ? await db.select({ id: mediaFiles.id, url: mediaFiles.publicUrl }).from(mediaFiles).where(inArray(mediaFiles.id, ids)) : [];
  return c.json(rows.map(({ imageIds, ...r }) => ({ ...r, images: imageIds.map((i) => imgs.find((m) => m.id === i)?.url).filter(Boolean) })));
});

catalogRoutes.get("/offers", async (c) => {
  const { db } = c.get("container");
  const now = new Date();
  const rows = await db
    .select({ p: promotions, banner: mediaFiles.publicUrl })
    .from(promotions)
    .leftJoin(mediaFiles, eq(mediaFiles.id, promotions.bannerId))
    .where(and(eq(promotions.isActive, true), or(isNull(promotions.startsAt), lte(promotions.startsAt, now)), or(isNull(promotions.endsAt), gt(promotions.endsAt, now))))
    .orderBy(desc(promotions.createdAt));
  return c.json(
    rows.map((r) => ({ id: r.p.id, title: r.p.title, slug: r.p.slug, description: r.p.description, percentOff: r.p.percentOff, endsAt: r.p.endsAt, banner: r.banner })),
  );
});

catalogRoutes.get("/delivery-zones", async (c) => {
  const { db } = c.get("container");
  const zones = await db
    .select({
      id: deliveryZones.id,
      name: deliveryZones.name,
      district: deliveryZones.district,
      fee: deliveryZones.fee,
      isCalculated: deliveryZones.isCalculated,
      baseFee: deliveryZones.baseFee,
      freeDeliveryThreshold: deliveryZones.freeDeliveryThreshold,
      etaText: deliveryZones.etaText,
      methods: deliveryZones.methods,
    })
    .from(deliveryZones)
    .where(eq(deliveryZones.isActive, true))
    .orderBy(asc(deliveryZones.sortOrder), asc(deliveryZones.name));
  c.header("Cache-Control", "public, max-age=60");
  return c.json(zones);
});

/* ------------------------------------------------------------- delivery areas */

/** Region → District → Division → Village/Area, one level at a time (cascading dropdowns). */
catalogRoutes.get("/locations", async (c) => {
  const { db } = c.get("container");
  const parent = c.req.query("parent");
  const parentId = parent && /^\d+$/.test(parent) ? Number(parent) : null;
  c.header("Cache-Control", "public, max-age=300");
  return c.json(await childLocations(db, parentId));
});

catalogRoutes.get("/locations/search", async (c) => {
  const { db } = c.get("container");
  const hits = await searchLocations(db, c.req.query("q") ?? "", 15);
  return c.json(hits.map((h) => ({ ...h, levelLabel: LEVEL_LABELS[h.level] })));
});

/** Full chain for an area (to prefill dropdowns) and the delivery zone that applies. */
catalogRoutes.get("/locations/:id", async (c) => {
  const { db } = c.get("container");
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id) || id <= 0) throw new ApiError(404, "Area not found");
  const r = await resolveLocation(db, id);
  if (!r) throw new ApiError(404, "Area not found");
  return c.json({
    id: r.location.id,
    name: r.location.name,
    path: r.location.path,
    chain: r.chain.map((l) => ({ id: l.id, name: l.name, level: l.level })),
    zone: r.zone ? { id: r.zone.id, name: r.zone.name, fee: r.zone.fee, isCalculated: r.zone.isCalculated, etaText: r.zone.etaText, methods: r.zone.methods } : null,
    moreSpecificMayDiffer: r.moreSpecificMayDiffer,
  });
});
