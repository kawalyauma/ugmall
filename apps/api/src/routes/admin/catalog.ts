import { Hono, type Context } from "hono";
import { z } from "zod";
import { and, asc, count, desc, eq, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import {
  brands,
  categories,
  inventoryLevels,
  mediaFiles,
  orderItems,
  productImages,
  productVariants,
  products,
} from "@ugmall/database";
import { ensureInventoryRows, inventory } from "@ugmall/inventory";
import { PERMISSIONS, PRODUCT_STATUSES, safeSegment, slugify } from "@ugmall/shared";
import { ApiError, body, pagination } from "../../lib/http";
import { audit } from "../../lib/audit";
import { crudRoutes } from "../../lib/crud";
import { deleteMedia, readUpload, saveImage } from "../../lib/media";
import { requirePermission } from "../../middleware/auth";
import type { AppEnv } from "../../types";

export const adminCatalogRoutes = new Hono<AppEnv>();
const P = PERMISSIONS;

const money = z.number().int().min(0).max(2_000_000_000);
const optionalDate = z
  .string()
  .datetime({ offset: true })
  .or(z.string().regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/))
  .nullable()
  .optional()
  .transform((v) => (v ? new Date(v) : v === null ? null : undefined));

const productSchema = z.object({
  name: z.string().trim().min(2).max(200),
  slug: z.string().trim().max(120).optional(),
  sku: z.string().trim().min(2).max(60).regex(/^[A-Za-z0-9._-]+$/, "SKU may only contain letters, numbers, dot, dash and underscore"),
  description: z.string().max(20000).nullable().optional(),
  categoryId: z.string().uuid().nullable().optional(),
  brandId: z.string().uuid().nullable().optional(),
  price: money,
  costPrice: money.default(0),
  salePrice: money.nullable().optional(),
  saleStartsAt: optionalDate,
  saleEndsAt: optionalDate,
  weightGrams: z.number().int().min(0).max(200_000).nullable().optional(),
  status: z.enum(PRODUCT_STATUSES).default("draft"),
  isFeatured: z.boolean().default(false),
  optionNames: z.array(z.string().max(30)).max(3).default([]),
  sizes: z.array(z.string().max(20)).max(60).default([]),
  colours: z.array(z.string().max(30)).max(30).default([]),
  tags: z.array(z.string().max(40)).max(30).default([]),
  seoTitle: z.string().max(120).nullable().optional(),
  seoDescription: z.string().max(300).nullable().optional(),
});

/* -------------------------------------------------------------- products */

adminCatalogRoutes.get("/products", requirePermission(P.productsView), async (c) => {
  const { db } = c.get("container");
  const { limit, offset } = pagination(c, 200);
  const q = c.req.query("q")?.trim();
  const where: SQL[] = [];
  if (q) where.push(or(ilike(products.name, `%${q}%`), ilike(products.sku, `%${q}%`), sql`exists (select 1 from ${productVariants} v where v.product_id = ${products.id} and v.sku ilike ${`%${q}%`})`)!);
  const status = c.req.query("status");
  if (status && (PRODUCT_STATUSES as readonly string[]).includes(status)) where.push(eq(products.status, status as (typeof PRODUCT_STATUSES)[number]));
  if (c.req.query("categoryId")) where.push(eq(products.categoryId, c.req.query("categoryId")!));
  const w = where.length ? and(...where) : undefined;
  const rows = await db
    .select({
      p: products,
      categoryName: categories.name,
      brandName: brands.name,
      variants: sql<number>`(select count(*)::int from ${productVariants} v where v.product_id = ${products.id})`,
      onHand: sql<number>`(select coalesce(sum(l.on_hand),0)::int from ${productVariants} v join ${inventoryLevels} l on l.variant_id = v.id where v.product_id = ${products.id})`,
      reserved: sql<number>`(select coalesce(sum(l.reserved),0)::int from ${productVariants} v join ${inventoryLevels} l on l.variant_id = v.id where v.product_id = ${products.id})`,
      image: sql<string | null>`(select coalesce(m.variants->'thumb'->>'url', m.public_url) from ${productImages} pi join ${mediaFiles} m on m.id = pi.media_id where pi.product_id = ${products.id} order by pi.sort_order limit 1)`,
    })
    .from(products)
    .leftJoin(categories, eq(categories.id, products.categoryId))
    .leftJoin(brands, eq(brands.id, products.brandId))
    .where(w)
    .orderBy(desc(products.updatedAt))
    .limit(limit)
    .offset(offset);
  const [{ total }] = (await db.select({ total: count() }).from(products).where(w)) as [{ total: number }];
  return c.json({
    total,
    items: rows.map((r) => ({ ...r.p, categoryName: r.categoryName, brandName: r.brandName, variantCount: r.variants, onHand: r.onHand, reserved: r.reserved, image: r.image })),
  });
});

async function productWithDetails(c: Context<AppEnv>, id: string) {
  const { db } = c.get("container");
  const [p] = await db.select().from(products).where(eq(products.id, id));
  if (!p) throw new ApiError(404, "Product not found");
  const variants = await db
    .select({ v: productVariants, onHand: inventoryLevels.onHand, reserved: inventoryLevels.reserved })
    .from(productVariants)
    .leftJoin(inventoryLevels, eq(inventoryLevels.variantId, productVariants.id))
    .where(eq(productVariants.productId, id))
    .orderBy(asc(productVariants.sortOrder), asc(productVariants.createdAt));
  const images = await db
    .select({ id: productImages.id, mediaId: productImages.mediaId, alt: productImages.alt, variantId: productImages.variantId, sortOrder: productImages.sortOrder, url: mediaFiles.publicUrl, thumb: sql<string | null>`${mediaFiles.variants}->'thumb'->>'url'`, storagePath: mediaFiles.storagePath, fileSize: mediaFiles.fileSize, width: mediaFiles.width, height: mediaFiles.height })
    .from(productImages)
    .innerJoin(mediaFiles, eq(mediaFiles.id, productImages.mediaId))
    .where(eq(productImages.productId, id))
    .orderBy(asc(productImages.sortOrder));
  return {
    ...p,
    variants: variants.map((r) => ({ ...r.v, onHand: r.onHand ?? 0, reserved: r.reserved ?? 0, available: (r.onHand ?? 0) - (r.reserved ?? 0) })),
    images,
  };
}

adminCatalogRoutes.get("/products/:id", requirePermission(P.productsView), async (c) => c.json(await productWithDetails(c, c.req.param("id"))));

adminCatalogRoutes.post("/products", requirePermission(P.productsManage), async (c) => {
  const input = await body(c, productSchema);
  const { db } = c.get("container");
  const slug = slugify(input.slug || input.name);
  const [exists] = await db.select({ id: products.id }).from(products).where(or(eq(products.slug, slug), eq(products.sku, input.sku.toUpperCase())));
  if (exists) throw new ApiError(409, "A product with this SKU or URL already exists");
  const [row] = await db.insert(products).values({ ...input, sku: input.sku.toUpperCase(), slug }).returning();
  await audit(db, c.get("staff").id, "product.create", "product", row!.id, { name: row!.name });
  return c.json(row, 201);
});

adminCatalogRoutes.patch("/products/:id", requirePermission(P.productsManage), async (c) => {
  const input = await body(c, productSchema.partial());
  const { db } = c.get("container");
  const patch: Record<string, unknown> = { ...input };
  if (input.slug !== undefined) patch.slug = slugify(input.slug || input.name || "");
  if (input.sku) patch.sku = input.sku.toUpperCase();
  try {
    const [row] = await db.update(products).set(patch).where(eq(products.id, c.req.param("id"))).returning();
    if (!row) throw new ApiError(404, "Product not found");
    await audit(db, c.get("staff").id, "product.update", "product", row.id, input);
    return c.json(await productWithDetails(c, row.id));
  } catch (err) {
    if ((err as { cause?: { code?: string } }).cause?.code === "23505") throw new ApiError(409, "SKU or URL already used by another product");
    throw err;
  }
});

adminCatalogRoutes.delete("/products/:id", requirePermission(P.productsManage), async (c) => {
  const { db, storage } = c.get("container");
  const id = c.req.param("id");
  const [{ n }] = (await db.select({ n: count() }).from(orderItems).where(eq(orderItems.productId, id))) as [{ n: number }];
  if (n > 0) {
    await db.update(products).set({ status: "archived" }).where(eq(products.id, id));
    await audit(db, c.get("staff").id, "product.archive", "product", id);
    return c.json({ ok: true, archived: true, message: "Product has orders, so it was archived instead of deleted." });
  }
  const media = await db
    .select({ id: mediaFiles.id, storagePath: mediaFiles.storagePath, variants: mediaFiles.variants })
    .from(productImages)
    .innerJoin(mediaFiles, eq(mediaFiles.id, productImages.mediaId))
    .where(eq(productImages.productId, id));
  await db.delete(products).where(eq(products.id, id));
  for (const m of media) {
    await deleteMedia(storage, m);
    await db.delete(mediaFiles).where(eq(mediaFiles.id, m.id));
  }
  await audit(db, c.get("staff").id, "product.delete", "product", id);
  return c.json({ ok: true, archived: false });
});

/* -------------------------------------------------------------- variants */

const variantSchema = z.object({
  sku: z.string().trim().min(2).max(80).regex(/^[A-Za-z0-9._-]+$/),
  options: z.record(z.string(), z.string().max(40)).default({}),
  price: money.nullable().optional(),
  salePrice: money.nullable().optional(),
  costPrice: money.nullable().optional(),
  weightGrams: z.number().int().min(0).nullable().optional(),
  barcode: z.string().max(60).nullable().optional(),
  lowStockThreshold: z.number().int().min(0).max(10000).default(3),
  sortOrder: z.number().int().default(0),
  isActive: z.boolean().default(true),
  openingStock: z.number().int().min(0).max(1_000_000).optional(),
});

function sizeColour(options: Record<string, string>) {
  const find = (k: string) => Object.entries(options).find(([n]) => n.toLowerCase() === k)?.[1] ?? null;
  return { size: find("size"), colour: find("colour") ?? find("color") };
}

adminCatalogRoutes.post("/products/:id/variants", requirePermission(P.productsManage), async (c) => {
  const { openingStock, ...input } = await body(c, variantSchema);
  const { db } = c.get("container");
  const productId = c.req.param("id");
  const staffId = c.get("staff").id;
  try {
    const variant = await db.transaction(async (tx) => {
      const [v] = await tx.insert(productVariants).values({ ...input, sku: input.sku.toUpperCase(), productId, ...sizeColour(input.options) }).returning();
      await ensureInventoryRows(tx, [v!.id]);
      if (openingStock) await inventory.receive(tx, v!.id, openingStock, { note: "Opening stock", staffId, referenceType: "manual" });
      return v!;
    });
    return c.json(variant, 201);
  } catch (err) {
    if ((err as { cause?: { code?: string } }).cause?.code === "23505") throw new ApiError(409, "Variant SKU already exists");
    throw err;
  }
});

/**
 * Generate the size × colour grid in one go, e.g. sizes 30…48 for jeans:
 * SKUs become BLUE-JEANS-001-30, BLUE-JEANS-001-31, …
 */
adminCatalogRoutes.post("/products/:id/variants/generate", requirePermission(P.productsManage), async (c) => {
  const input = await body(
    c,
    z.object({
      sizes: z.array(z.string().trim().min(1).max(20)).max(60).default([]),
      colours: z.array(z.string().trim().min(1).max(30)).max(30).default([]),
      openingStock: z.number().int().min(0).max(100000).default(0),
      lowStockThreshold: z.number().int().min(0).default(3),
    }),
  );
  const { db } = c.get("container");
  const productId = c.req.param("id");
  const staffId = c.get("staff").id;
  const [p] = await db.select().from(products).where(eq(products.id, productId));
  if (!p) throw new ApiError(404, "Product not found");
  const sizes = input.sizes.length ? input.sizes : [null];
  const colours = input.colours.length ? input.colours : [null];
  const existing = await db.select({ sku: productVariants.sku }).from(productVariants).where(eq(productVariants.productId, productId));
  const created: string[] = [];
  await db.transaction(async (tx) => {
    let sort = existing.length;
    for (const colour of colours) {
      for (const size of sizes) {
        const options: Record<string, string> = {};
        if (colour) options.Colour = colour;
        if (size) options.Size = size;
        const sku = [p.sku, colour ? safeSegment(colour).toUpperCase().slice(0, 12) : null, size ? safeSegment(size).toUpperCase() : null].filter(Boolean).join("-");
        if (existing.some((e) => e.sku === sku)) continue;
        const [v] = await tx
          .insert(productVariants)
          .values({ productId, sku, options, size, colour, lowStockThreshold: input.lowStockThreshold, sortOrder: sort++ })
          .onConflictDoNothing()
          .returning();
        if (!v) continue;
        await ensureInventoryRows(tx, [v.id]);
        if (input.openingStock) await inventory.receive(tx, v.id, input.openingStock, { note: "Opening stock", staffId, referenceType: "manual" });
        created.push(sku);
      }
    }
    const optionNames = [colours[0] ? "Colour" : null, sizes[0] ? "Size" : null].filter(Boolean) as string[];
    await tx
      .update(products)
      .set({
        optionNames,
        sizes: [...new Set([...p.sizes, ...input.sizes])],
        colours: [...new Set([...p.colours, ...input.colours])],
      })
      .where(eq(products.id, productId));
  });
  return c.json({ created });
});

adminCatalogRoutes.patch("/variants/:id", requirePermission(P.productsManage), async (c) => {
  const { openingStock: _ignored, ...input } = await body(c, variantSchema.partial());
  const { db } = c.get("container");
  const patch: Record<string, unknown> = { ...input };
  if (input.options) Object.assign(patch, sizeColour(input.options));
  if (input.sku) patch.sku = input.sku.toUpperCase();
  const [row] = await db.update(productVariants).set(patch).where(eq(productVariants.id, c.req.param("id"))).returning();
  if (!row) throw new ApiError(404, "Variant not found");
  return c.json(row);
});

adminCatalogRoutes.delete("/variants/:id", requirePermission(P.productsManage), async (c) => {
  const { db } = c.get("container");
  const id = c.req.param("id");
  const [{ n }] = (await db.select({ n: count() }).from(orderItems).where(eq(orderItems.variantId, id))) as [{ n: number }];
  if (n > 0) {
    await db.update(productVariants).set({ isActive: false }).where(eq(productVariants.id, id));
    return c.json({ ok: true, deactivated: true });
  }
  await db.delete(productVariants).where(eq(productVariants.id, id));
  return c.json({ ok: true, deactivated: false });
});

/* ---------------------------------------------------------------- images */

adminCatalogRoutes.post("/products/:id/images", requirePermission(P.productsManage, P.mediaUpload), async (c) => {
  const { db, storage } = c.get("container");
  const productId = c.req.param("id");
  const form = await c.req.formData();
  const { buffer, name } = await readUpload(form);
  const [p] = await db.select({ sku: products.sku, categorySlug: categories.slug }).from(products).leftJoin(categories, eq(categories.id, products.categoryId)).where(eq(products.id, productId));
  if (!p) throw new ApiError(404, "Product not found");
  const [{ n }] = (await db.select({ n: count() }).from(productImages).where(eq(productImages.productId, productId))) as [{ n: number }];
  // storage/products/<category>/<SKU>/main-xxxx.webp
  const media = await saveImage(db, storage, {
    area: "products",
    folders: [p.categorySlug ?? "uncategorised", p.sku],
    baseName: n === 0 ? "main" : `image-${n + 1}`,
    buffer,
    originalName: name,
    staffId: c.get("staff").id,
  });
  const variantId = form.get("variantId");
  const [img] = await db
    .insert(productImages)
    .values({ productId, mediaId: media.id, alt: String(form.get("alt") ?? "") || null, variantId: typeof variantId === "string" && variantId ? variantId : null, sortOrder: n })
    .returning();
  return c.json({ ...img, url: media.publicUrl, thumb: media.variants?.thumb?.url ?? media.publicUrl }, 201);
});

adminCatalogRoutes.put("/products/:id/images/order", requirePermission(P.productsManage), async (c) => {
  const { ids } = await body(c, z.object({ ids: z.array(z.string().uuid()).max(50) }));
  const { db } = c.get("container");
  await db.transaction(async (tx) => {
    for (const [i, id] of ids.entries()) {
      await tx.update(productImages).set({ sortOrder: i }).where(and(eq(productImages.id, id), eq(productImages.productId, c.req.param("id"))));
    }
  });
  return c.json({ ok: true });
});

adminCatalogRoutes.patch("/product-images/:id", requirePermission(P.productsManage), async (c) => {
  const input = await body(c, z.object({ alt: z.string().max(200).nullable().optional(), variantId: z.string().uuid().nullable().optional() }));
  const { db } = c.get("container");
  const [row] = await db.update(productImages).set(input).where(eq(productImages.id, c.req.param("id"))).returning();
  return c.json(row);
});

adminCatalogRoutes.delete("/product-images/:id", requirePermission(P.productsManage), async (c) => {
  const { db, storage } = c.get("container");
  const [img] = await db
    .select({ id: productImages.id, mediaId: mediaFiles.id, storagePath: mediaFiles.storagePath, variants: mediaFiles.variants })
    .from(productImages)
    .innerJoin(mediaFiles, eq(mediaFiles.id, productImages.mediaId))
    .where(eq(productImages.id, c.req.param("id")));
  if (!img) throw new ApiError(404, "Image not found");
  await db.delete(productImages).where(eq(productImages.id, img.id));
  const [{ n }] = (await db.select({ n: count() }).from(productImages).where(eq(productImages.mediaId, img.mediaId))) as [{ n: number }];
  if (n === 0) {
    await deleteMedia(storage, img);
    await db.delete(mediaFiles).where(eq(mediaFiles.id, img.mediaId));
  }
  return c.json({ ok: true });
});

/* ------------------------------------------------------ categories/brands */

const categorySchema = z.object({
  name: z.string().trim().min(2).max(120),
  slug: z.string().max(120).optional(),
  parentId: z.string().uuid().nullable().optional(),
  description: z.string().max(2000).nullable().optional(),
  imageId: z.string().uuid().nullable().optional(),
  sortOrder: z.number().int().default(0),
  isActive: z.boolean().default(true),
  seoTitle: z.string().max(120).nullable().optional(),
  seoDescription: z.string().max(300).nullable().optional(),
});

adminCatalogRoutes.route(
  "/categories",
  crudRoutes({
    table: categories,
    schema: categorySchema,
    entity: "category",
    permission: P.productsManage,
    viewPermission: P.productsView,
    searchColumns: [categories.name],
    orderBy: categories.sortOrder,
    orderDesc: false,
    prepare: (i, isCreate) => (isCreate || i.name || i.slug ? { ...i, slug: slugify(String(i.slug || i.name || "")) || undefined } : i),
  }),
);

adminCatalogRoutes.post("/categories/:id/image", requirePermission(P.productsManage), async (c) => {
  const { db, storage } = c.get("container");
  const [cat] = await db.select().from(categories).where(eq(categories.id, c.req.param("id")));
  if (!cat) throw new ApiError(404, "Category not found");
  const { buffer, name } = await readUpload(await c.req.formData());
  const media = await saveImage(db, storage, { area: "categories", folders: [cat.slug], baseName: "cover", buffer, originalName: name, staffId: c.get("staff").id });
  await db.update(categories).set({ imageId: media.id }).where(eq(categories.id, cat.id));
  return c.json({ imageId: media.id, url: media.publicUrl });
});

adminCatalogRoutes.route(
  "/brands",
  crudRoutes({
    table: brands,
    schema: z.object({ name: z.string().trim().min(1).max(120), slug: z.string().max(120).optional(), isActive: z.boolean().default(true) }),
    entity: "brand",
    permission: P.productsManage,
    viewPermission: P.productsView,
    searchColumns: [brands.name],
    orderBy: brands.name,
    orderDesc: false,
    prepare: (i) => (i.name || i.slug ? { ...i, slug: slugify(String(i.slug || i.name)) } : i),
  }),
);

/** Lightweight variant search used by order entry, purchases and stock screens. */
adminCatalogRoutes.get("/variant-search", requirePermission(P.productsView), async (c) => {
  const { db } = c.get("container");
  const q = (c.req.query("q") ?? "").trim();
  if (q.length < 2) return c.json([]);
  const rows = await db
    .select({ id: productVariants.id, sku: productVariants.sku, options: productVariants.options, productName: products.name, price: sql<number>`coalesce(${productVariants.price}, ${products.price})`, costPrice: sql<number>`coalesce(${productVariants.costPrice}, ${products.costPrice})`, onHand: inventoryLevels.onHand, reserved: inventoryLevels.reserved })
    .from(productVariants)
    .innerJoin(products, eq(products.id, productVariants.productId))
    .leftJoin(inventoryLevels, eq(inventoryLevels.variantId, productVariants.id))
    .where(and(eq(productVariants.isActive, true), or(ilike(productVariants.sku, `%${q}%`), ilike(products.name, `%${q}%`))))
    .orderBy(asc(products.name), asc(productVariants.sortOrder))
    .limit(30);
  return c.json(rows.map((r) => ({ ...r, onHand: r.onHand ?? 0, reserved: r.reserved ?? 0 })));
});

