import { Hono } from "hono";
import { aliasedTable, and, asc, desc, eq, gt, ilike, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { brands, categories, deals, deliveryZones, mediaFiles, promotions, reviews } from "@ugmall/database";
import { childLocations, LEVEL_LABELS, resolveLocation, searchLocations } from "@ugmall/delivery";
import { ApiError, pagination } from "../../lib/http";
import { listProducts, productDetail, productFeedItems } from "../../lib/catalog";
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
  // Categories without their own picture borrow one from a product in them (or in a subcategory),
  // so the homepage category circles never show a blank.
  const productPics = await db.execute<{ category_id: string; url: string }>(sql`
    select distinct on (p.category_id) p.category_id, coalesce(m.variants->'thumb'->>'url', m.public_url) as url
    from products p
    join product_images pi on pi.product_id = p.id
    join media_files m on m.id = pi.media_id
    where p.status = 'active' and p.category_id is not null and m.public_url is not null
    order by p.category_id, p.is_featured desc, p.created_at desc, pi.sort_order`);
  const fallback = new Map(productPics.map((r) => [r.category_id, r.url]));
  const children = new Map<string, string[]>();
  for (const r of rows) if (r.c.parentId) children.set(r.c.parentId, [...(children.get(r.c.parentId) ?? []), r.c.id]);
  const pictureFor = (id: string, seen = new Set<string>()): string | null => {
    if (seen.has(id)) return null;
    seen.add(id);
    if (fallback.has(id)) return fallback.get(id)!;
    for (const child of children.get(id) ?? []) {
      const found = pictureFor(child, seen);
      if (found) return found;
    }
    return null;
  };
  c.header("Cache-Control", "public, max-age=60");
  return c.json(
    rows.map((r) => ({
      id: r.c.id,
      name: r.c.name,
      slug: r.c.slug,
      parentId: r.c.parentId,
      description: r.c.description,
      image: r.thumb ?? r.image ?? pictureFor(r.c.id),
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
  let brandId: string | undefined;
  if (q.brand) brandId = (await db.select({ id: brands.id }).from(brands).where(eq(brands.slug, q.brand)))[0]?.id ?? "00000000-0000-0000-0000-000000000000";
  let productIds: string[] | undefined;
  if (q.deal) {
    const [deal] = await db.select({ productIds: deals.productIds }).from(deals).where(and(eq(deals.slug, q.deal), liveDeal()));
    productIds = deal?.productIds ?? [];
  }
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
    categorySlugs: requestedCategorySlugs,
    brandId,
    productIds,
    minPrice: num(q.min),
    maxPrice: num(q.max),
    size: q.size,
    colour: q.colour,
    featured: q.featured === "1",
    onSale: q.sale === "1",
    inStock: q.stock === "1",
    sort: (["newest", "price_asc", "price_desc", "popular", "rating"] as const).find((s) => s === q.sort),
    limit,
    offset,
  });
  return c.json({ ...result, page, limit });
});

/** Type-ahead for the search box: matching products, categories and brands in one round trip. */
catalogRoutes.get("/search/suggest", async (c) => {
  const { db } = c.get("container");
  const q = (c.req.query("q") ?? "").trim().slice(0, 60);
  if (q.length < 2) return c.json({ products: [], categories: [], brands: [] });
  const like = `%${q.replace(/[%_\\]/g, "")}%`;
  // Names that start with the query rank above ones that merely contain it.
  const starts = (col: typeof categories.name | typeof brands.name) => sql`case when ${col} ilike ${`${q.replace(/[%_\\]/g, "")}%`} then 0 else 1 end`;
  const parent = aliasedTable(categories, "parent");
  const [found, cats, brandRows] = await Promise.all([
    listProducts(db, { q, limit: 6, offset: 0, sort: "popular" }),
    db
      .select({ name: categories.name, slug: categories.slug, parent: parent.name })
      .from(categories)
      .leftJoin(parent, eq(parent.id, categories.parentId))
      .where(and(eq(categories.isActive, true), ilike(categories.name, like)))
      .orderBy(starts(categories.name), asc(sql`length(${categories.name})`))
      .limit(5),
    db
      .select({ name: brands.name, slug: brands.slug })
      .from(brands)
      .where(and(eq(brands.isActive, true), ilike(brands.name, like)))
      .orderBy(starts(brands.name), asc(brands.name))
      .limit(4),
  ]);
  c.header("Cache-Control", "public, max-age=60");
  return c.json({
    products: found.items.map((p) => ({ name: p.name, slug: p.slug, price: p.price, compareAt: p.compareAt, image: p.image?.thumb ?? p.image?.url ?? null, category: p.category?.name ?? null })),
    categories: cats,
    brands: brandRows,
    total: found.total,
  });
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

function liveDeal(now = new Date()) {
  return and(eq(deals.isActive, true), or(isNull(deals.startsAt), lte(deals.startsAt, now)), or(isNull(deals.endsAt), gt(deals.endsAt, now)))!;
}

/** Homepage slider: live deals that have a slide graphic. */
catalogRoutes.get("/deals", async (c) => {
  const { db } = c.get("container");
  const rows = await db
    .select({
      d: deals,
      image: mediaFiles.publicUrl,
      mobileImage: sql<string | null>`(select m.public_url from ${mediaFiles} m where m.id = ${deals.mobileImageId})`,
    })
    .from(deals)
    .innerJoin(mediaFiles, eq(mediaFiles.id, deals.imageId))
    .where(liveDeal())
    .orderBy(asc(deals.sortOrder), desc(deals.createdAt));
  c.header("Cache-Control", "public, max-age=30");
  return c.json(
    rows.map((r) => ({
      id: r.d.id,
      title: r.d.title,
      slug: r.d.slug,
      subtitle: r.d.subtitle,
      endsAt: r.d.endsAt,
      image: r.image,
      mobileImage: r.mobileImage,
      productCount: r.d.productIds.length,
    })),
  );
});

catalogRoutes.get("/deals/:slug", async (c) => {
  const { db } = c.get("container");
  const [row] = await db
    .select({ d: deals, image: mediaFiles.publicUrl })
    .from(deals)
    .leftJoin(mediaFiles, eq(mediaFiles.id, deals.imageId))
    .where(and(eq(deals.slug, c.req.param("slug")), liveDeal()));
  if (!row) throw new ApiError(404, "Deal not found");
  return c.json({ id: row.d.id, title: row.d.title, slug: row.d.slug, subtitle: row.d.subtitle, endsAt: row.d.endsAt, image: row.image });
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


const XML_ENTITIES: Record<string, string> = { "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" };
const xmlEscape = (v: unknown) => String(v ?? "").replace(/[<>&"']/g, (ch) => XML_ENTITIES[ch] ?? ch);
const csvCell = (v: unknown) => { const s = String(v ?? ""); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

catalogRoutes.get("/feeds/google.xml", async (c) => {
  const { db } = c.get("container");
  const [settings, items] = await Promise.all([getPublicSettings(db), productFeedItems(db)]);
  const base = (process.env.STOREFRONT_URL ?? new URL(c.req.url).origin).replace(/\/$/, "");
  const xmlItems = items.map((p) => {
    const normal = p.compareAt && p.compareAt > p.price ? p.compareAt : p.price;
    const sale = p.compareAt && p.compareAt > p.price ? p.price : null;
    return `<item>
      <g:id>${xmlEscape(p.id)}</g:id>
      <g:item_group_id>${xmlEscape(p.itemGroupId)}</g:item_group_id>
      <g:title>${xmlEscape(p.title)}</g:title>
      <g:description>${xmlEscape(p.description)}</g:description>
      <g:link>${xmlEscape(`${base}/p/${p.slug}`)}</g:link>
      ${p.image?.url ? `<g:image_link>${xmlEscape(p.image.medium ?? p.image.url)}</g:image_link>` : ""}
      <g:availability>${p.available ? "in_stock" : "out_of_stock"}</g:availability>
      <g:condition>new</g:condition>
      <g:price>${normal} UGX</g:price>
      ${sale ? `<g:sale_price>${sale} UGX</g:sale_price>` : ""}
      ${p.brand ? `<g:brand>${xmlEscape(p.brand)}</g:brand>` : ""}
      ${p.barcode ? `<g:gtin>${xmlEscape(p.barcode)}</g:gtin>` : ""}
      ${!p.barcode && !p.brand ? "<g:identifier_exists>false</g:identifier_exists>" : ""}
      ${p.size ? `<g:size>${xmlEscape(p.size)}</g:size>` : ""}
      ${p.colour ? `<g:color>${xmlEscape(p.colour)}</g:color>` : ""}
    </item>`;
  }).join("\n");
  c.header("Content-Type", "application/xml; charset=utf-8");
  c.header("Cache-Control", "public, max-age=900");
  return c.body(`<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">
  <channel>
    <title>${xmlEscape(settings.shopName)}</title>
    <link>${xmlEscape(base)}</link>
    <description>Product feed for ${xmlEscape(settings.shopName)}</description>
    ${xmlItems}
  </channel>
</rss>`);
});

catalogRoutes.get("/feeds/meta.csv", async (c) => {
  const { db } = c.get("container");
  const [settings, items] = await Promise.all([getPublicSettings(db), productFeedItems(db)]);
  const base = (process.env.STOREFRONT_URL ?? new URL(c.req.url).origin).replace(/\/$/, "");
  const header = ["id","item_group_id","title","description","availability","condition","price","sale_price","link","image_link","brand","gtin","size","color"];
  const rows = items.map((p) => {
    const normal = p.compareAt && p.compareAt > p.price ? p.compareAt : p.price;
    const sale = p.compareAt && p.compareAt > p.price ? p.price : "";
    return [
      p.id,
      p.itemGroupId,
      p.title,
      p.description || `${p.title} available from ${settings.shopName} in Uganda.`,
      p.available ? "in stock" : "out of stock",
      "new",
      `${normal} UGX`,
      sale ? `${sale} UGX` : "",
      `${base}/p/${p.slug}`,
      p.image?.medium ?? p.image?.url ?? "",
      p.brand ?? "",
      p.barcode ?? "",
      p.size ?? "",
      p.colour ?? "",
    ].map(csvCell).join(",");
  });
  c.header("Content-Type", "text/csv; charset=utf-8");
  c.header("Cache-Control", "public, max-age=900");
  return c.body([header.join(","), ...rows].join("\n"));
});
