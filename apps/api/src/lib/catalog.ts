import { and, asc, desc, eq, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import {
  brands,
  categories,
  inventoryLevels,
  mediaFiles,
  productImages,
  productVariants,
  products,
  type Database,
} from "@ugmall/database";
import { activePromotions, effectivePrice, type ActivePromotion } from "@ugmall/orders";
import { htmlToText } from "@ugmall/shared";
import type { StockReservations } from "@ugmall/inventory";

export type ImageDTO = { id: string; url: string | null; medium: string | null; thumb: string | null; alt: string | null; variantId: string | null; width: number | null; height: number | null };

export async function imagesFor(db: Database, productIds: string[]): Promise<Map<string, ImageDTO[]>> {
  const out = new Map<string, ImageDTO[]>();
  if (!productIds.length) return out;
  const rows = await db
    .select({
      productId: productImages.productId,
      id: productImages.id,
      mediaId: mediaFiles.id,
      alt: productImages.alt,
      variantId: productImages.variantId,
      url: mediaFiles.publicUrl,
      variants: mediaFiles.variants,
      width: mediaFiles.width,
      height: mediaFiles.height,
    })
    .from(productImages)
    .innerJoin(mediaFiles, eq(mediaFiles.id, productImages.mediaId))
    .where(inArray(productImages.productId, productIds))
    .orderBy(asc(productImages.sortOrder), asc(productImages.createdAt));
  for (const r of rows) {
    const list = out.get(r.productId) ?? [];
    list.push({
      id: r.id,
      url: r.url,
      medium: r.variants?.medium?.url ?? r.url,
      thumb: r.variants?.thumb?.url ?? r.url,
      alt: r.alt,
      variantId: r.variantId,
      width: r.width,
      height: r.height,
    });
    out.set(r.productId, list);
  }
  return out;
}

export interface ListFilters {
  q?: string;
  categoryIds?: string[];
  brandId?: string;
  minPrice?: number;
  maxPrice?: number;
  size?: string;
  colour?: string;
  featured?: boolean;
  onSale?: boolean;
  productIds?: string[];
  sort?: "newest" | "price_asc" | "price_desc" | "popular" | "rating";
  limit: number;
  offset: number;
}

const priceExpr = sql`least(${products.price}, coalesce(case when (${products.saleStartsAt} is null or ${products.saleStartsAt} <= now()) and (${products.saleEndsAt} is null or ${products.saleEndsAt} > now()) then ${products.salePrice} end, ${products.price}))`;

export async function listProducts(db: Database, f: ListFilters) {
  const where: SQL[] = [eq(products.status, "active")];
  if (f.q) {
    const q = f.q.trim().slice(0, 100);
    where.push(
      or(
        sql`to_tsvector('simple', coalesce(${products.name}, '') || ' ' || coalesce(${products.sku}, '') || ' ' || coalesce(${products.description}, '')) @@ plainto_tsquery('simple', ${q})`,
        ilike(products.name, `%${q.replace(/[%_]/g, "")}%`),
        ilike(products.sku, `${q.replace(/[%_]/g, "")}%`),
        sql`${q} ilike any(${products.tags})`,
      )!,
    );
  }
  if (f.categoryIds?.length) where.push(inArray(products.categoryId, f.categoryIds));
  if (f.brandId) where.push(eq(products.brandId, f.brandId));
  if (f.productIds) where.push(f.productIds.length ? inArray(products.id, f.productIds) : sql`false`);
  if (f.minPrice !== undefined) where.push(sql`${priceExpr} >= ${f.minPrice}`);
  if (f.maxPrice !== undefined) where.push(sql`${priceExpr} <= ${f.maxPrice}`);
  if (f.size) where.push(sql`${f.size} = any(${products.sizes})`);
  if (f.colour) where.push(sql`lower(${f.colour}) = any(select lower(x) from unnest(${products.colours}) x)`);
  if (f.featured) where.push(eq(products.isFeatured, true));
  if (f.onSale) where.push(sql`${priceExpr} < ${products.price}`);

  const order =
    f.sort === "price_asc"
      ? [asc(priceExpr)]
      : f.sort === "price_desc"
        ? [desc(priceExpr)]
        : f.sort === "rating"
          ? [desc(products.ratingAverage), desc(products.ratingCount)]
          : f.sort === "popular"
            ? [desc(sql`(select coalesce(sum(i.quantity),0) from order_items i where i.product_id = ${products.id})`)]
            : [desc(products.createdAt)];

  const [rows, [{ total }]] = await Promise.all([
    db
      .select({
        p: products,
        categoryName: categories.name,
        categorySlug: categories.slug,
        brandName: brands.name,
        available: sql<number>`(select coalesce(sum(greatest(l.on_hand - l.reserved, 0)), 0)::int from ${productVariants} v left join ${inventoryLevels} l on l.variant_id = v.id where v.product_id = ${products.id} and v.is_active)`,
      })
      .from(products)
      .leftJoin(categories, eq(categories.id, products.categoryId))
      .leftJoin(brands, eq(brands.id, products.brandId))
      .where(and(...where))
      .orderBy(...order, desc(products.id))
      .limit(f.limit)
      .offset(f.offset),
    db
      .select({ total: sql<number>`count(*)::int` })
      .from(products)
      .where(and(...where)) as unknown as Promise<[{ total: number }]>,
  ]);
  const promos = await activePromotions(db);
  const imgs = await imagesFor(db, rows.map((r) => r.p.id));
  return {
    total,
    items: rows.map((r) => productCard(r.p, promos, imgs.get(r.p.id) ?? [], r)),
  };
}

export function productCard(
  p: typeof products.$inferSelect,
  promos: ActivePromotion[],
  images: ImageDTO[],
  extra: { categoryName?: string | null; categorySlug?: string | null; brandName?: string | null; available?: number },
) {
  const pr = effectivePrice(p, null, promos);
  return {
    id: p.id,
    name: p.name,
    slug: p.slug,
    sku: p.sku,
    price: pr.price,
    compareAt: pr.compareAt,
    discountPercent: pr.discountPercent,
    image: images[0] ?? null,
    hoverImage: images[1] ?? null,
    category: extra.categoryName ? { name: extra.categoryName, slug: extra.categorySlug } : null,
    brand: extra.brandName ?? null,
    sizes: p.sizes,
    colours: p.colours,
    rating: p.ratingCount ? { average: p.ratingAverage / 100, count: p.ratingCount } : null,
    inStock: (extra.available ?? 1) > 0,
    isFeatured: p.isFeatured,
  };
}

export async function productDetail(db: Database, reservations: StockReservations, slugOrId: string, opts: { includeInactive?: boolean } = {}) {
  const isUuid = /^[0-9a-f-]{36}$/i.test(slugOrId);
  const [row] = await db
    .select({ p: products, category: categories, brandName: brands.name })
    .from(products)
    .leftJoin(categories, eq(categories.id, products.categoryId))
    .leftJoin(brands, eq(brands.id, products.brandId))
    .where(isUuid ? eq(products.id, slugOrId) : eq(products.slug, slugOrId));
  if (!row || (!opts.includeInactive && row.p.status !== "active")) return null;
  const variants = await db
    .select()
    .from(productVariants)
    .where(and(eq(productVariants.productId, row.p.id), eq(productVariants.isActive, true)))
    .orderBy(asc(productVariants.sortOrder), asc(productVariants.createdAt));
  const promos = await activePromotions(db);
  const available = await reservations.available(variants.map((v) => v.id));
  const images = (await imagesFor(db, [row.p.id])).get(row.p.id) ?? [];
  const base = effectivePrice(row.p, null, promos);
  return {
    id: row.p.id,
    name: row.p.name,
    slug: row.p.slug,
    sku: row.p.sku,
    description: row.p.description,
    price: base.price,
    compareAt: base.compareAt,
    discountPercent: base.discountPercent,
    optionNames: row.p.optionNames,
    sizes: row.p.sizes,
    colours: row.p.colours,
    tags: row.p.tags,
    attributes: row.p.attributes,
    weightGrams: row.p.weightGrams,
    category: row.category ? { id: row.category.id, name: row.category.name, slug: row.category.slug } : null,
    brand: row.brandName,
    seo: { title: row.p.seoTitle ?? row.p.name, description: row.p.seoDescription ?? (row.p.description ? htmlToText(row.p.description).slice(0, 160) : null) },
    rating: row.p.ratingCount ? { average: row.p.ratingAverage / 100, count: row.p.ratingCount } : null,
    images,
    variants: variants.map((v) => {
      const pr = effectivePrice(row.p, v, promos);
      const avail = available.get(v.id) ?? 0;
      return {
        id: v.id,
        sku: v.sku,
        options: v.options,
        price: pr.price,
        compareAt: pr.compareAt,
        available: Math.min(avail, 99),
        lowStock: avail > 0 && avail <= v.lowStockThreshold,
      };
    }),
  };
}
