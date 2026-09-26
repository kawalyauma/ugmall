import { percentOf } from "@ugmall/shared";

export interface PriceSource {
  price: number;
  salePrice: number | null;
  saleStartsAt: Date | null;
  saleEndsAt: Date | null;
}

export interface VariantPriceSource {
  price: number | null;
  salePrice: number | null;
}

export interface ActivePromotion {
  percentOff: number | null;
  productIds: string[];
  categoryIds: string[];
}

export function isSaleActive(p: Pick<PriceSource, "saleStartsAt" | "saleEndsAt">, now = new Date()): boolean {
  return (!p.saleStartsAt || p.saleStartsAt <= now) && (!p.saleEndsAt || p.saleEndsAt > now);
}

/**
 * The price a customer pays for a variant right now:
 *  base = variant.price ?? product.price
 *  sale = variant.salePrice ?? product.salePrice   (only inside the sale window)
 *  promo = best active percentage promotion covering the product/category
 * The lowest wins. `compareAt` is the crossed-out price when discounted.
 */
export function effectivePrice(
  product: PriceSource & { id: string; categoryId: string | null },
  variant: VariantPriceSource | null,
  promotions: ActivePromotion[] = [],
  now = new Date(),
): { price: number; compareAt: number | null; discountPercent: number } {
  const base = variant?.price ?? product.price;
  let best = base;
  const sale = variant?.salePrice ?? product.salePrice;
  if (sale !== null && sale !== undefined && sale < base && isSaleActive(product, now)) best = sale;
  for (const promo of promotions) {
    if (!promo.percentOff) continue;
    const applies = promo.productIds.includes(product.id) || (product.categoryId !== null && promo.categoryIds.includes(product.categoryId));
    if (!applies) continue;
    const promoPrice = base - percentOf(base, promo.percentOff);
    if (promoPrice < best) best = promoPrice;
  }
  const compareAt = best < base ? base : null;
  return { price: best, compareAt, discountPercent: compareAt ? Math.round(((base - best) / base) * 100) : 0 };
}
