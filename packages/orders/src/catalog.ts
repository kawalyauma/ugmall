import { and, asc, eq, gt, inArray, isNull, lte, or } from "drizzle-orm";
import { mediaFiles, productImages, productVariants, products, promotions, type DbOrTx } from "@ugmall/database";
import { variantLabel } from "@ugmall/shared";
import { effectivePrice, type ActivePromotion } from "./pricing";

export async function activePromotions(db: DbOrTx, now = new Date()): Promise<ActivePromotion[]> {
  return db
    .select({ percentOff: promotions.percentOff, productIds: promotions.productIds, categoryIds: promotions.categoryIds })
    .from(promotions)
    .where(
      and(
        eq(promotions.isActive, true),
        or(isNull(promotions.startsAt), lte(promotions.startsAt, now)),
        or(isNull(promotions.endsAt), gt(promotions.endsAt, now)),
      ),
    );
}

export interface PricedLine {
  variantId: string;
  productId: string;
  productName: string;
  productSlug: string;
  sku: string;
  options: Record<string, string>;
  variantLabel: string;
  quantity: number;
  unitPrice: number;
  compareAt: number | null;
  unitCost: number;
  lineTotal: number;
  weightGrams: number;
  imageUrl: string | null;
}

export class CartError extends Error {
  constructor(
    message: string,
    public variantId?: string,
  ) {
    super(message);
  }
}

/** Loads and prices cart lines from the database. Prices from the client are never trusted. */
export async function priceLines(db: DbOrTx, lines: { variantId: string; quantity: number }[]): Promise<PricedLine[]> {
  if (!lines.length) return [];
  const ids = [...new Set(lines.map((l) => l.variantId))];
  const rows = await db
    .select({ v: productVariants, p: products })
    .from(productVariants)
    .innerJoin(products, eq(products.id, productVariants.productId))
    .where(inArray(productVariants.id, ids));
  const promos = await activePromotions(db);
  const images = await db
    .select({ productId: productImages.productId, variantId: productImages.variantId, url: mediaFiles.publicUrl, variants: mediaFiles.variants })
    .from(productImages)
    .innerJoin(mediaFiles, eq(mediaFiles.id, productImages.mediaId))
    .where(inArray(productImages.productId, [...new Set(rows.map((r) => r.p.id))]))
    .orderBy(asc(productImages.sortOrder));

  return lines.map((l) => {
    const row = rows.find((r) => r.v.id === l.variantId);
    if (!row) throw new CartError("A product in your cart is no longer available", l.variantId);
    const { v, p } = row;
    if (p.status !== "active" || !v.isActive) throw new CartError(`${p.name} is no longer available`, l.variantId);
    const { price, compareAt } = effectivePrice(p, v, promos);
    const img =
      images.find((i) => i.variantId === v.id) ?? images.find((i) => i.productId === p.id);
    return {
      variantId: v.id,
      productId: p.id,
      productName: p.name,
      productSlug: p.slug,
      sku: v.sku,
      options: v.options,
      variantLabel: variantLabel(v.options),
      quantity: l.quantity,
      unitPrice: price,
      compareAt,
      unitCost: v.costPrice ?? p.costPrice,
      lineTotal: price * l.quantity,
      weightGrams: (v.weightGrams ?? p.weightGrams ?? 0) * l.quantity,
      imageUrl: img?.variants?.thumb?.url ?? img?.url ?? null,
    };
  });
}
