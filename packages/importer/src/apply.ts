import { and, eq, inArray, isNull, notInArray, sql } from "drizzle-orm";
import { brands, categories, mediaFiles, productImages, productVariants, products, type Database, type DbOrTx } from "@ugmall/database";
import { ensureInventoryRows, InsufficientStockError, inventory } from "@ugmall/inventory";
import { slugify } from "@ugmall/shared";
import { imageFolder, type ImportIssue, type ImportPlan, type PlannedProduct } from "./plan";

export interface ImportOptions {
  /** set = make on-hand equal the sheet (stock count); add = receive sheet qty on top; ignore = only new variants get stock */
  stockMode: "set" | "add" | "ignore";
  /** Status for NEW products. Existing products keep their status. */
  status: "active" | "draft";
  /** Update name/price/description/category of products that already exist (matched by SKU). */
  updateExisting: boolean;
  /** Drop a root category shared by every row (e.g. "Fashion") so the shop menu starts at Men's / Women's / Kid's. */
  stripCommonRoot: boolean;
  /** Hide (deactivate) variants of imported products that are not in this file. Stock history is kept. */
  deactivateMissing: boolean;
  staffId?: string | null;
  sourceName: string;
}

export const DEFAULT_IMPORT_OPTIONS: Omit<ImportOptions, "sourceName"> = {
  stockMode: "set",
  status: "active",
  updateExisting: true,
  stripCommonRoot: true,
  deactivateMissing: false,
};

export interface ProductOutcome {
  sku: string;
  name: string;
  action: "create" | "update" | "skip";
  productId?: string;
  variantsNew: number;
  variantsExisting: number;
  /** Active variants on the shop that this file does not mention. */
  variantsNotInFile: number;
  category: string | null;
  price: number;
  stock: number;
}

export interface ImportSummary {
  brands: { new: number; existing: number; names: string[] };
  categories: { new: number; existing: number; paths: string[] };
  products: { new: number; existing: number; skipped: number };
  variants: { new: number; existing: number; notInFile: number; deactivated: number };
  stockUnits: number;
  images: number;
  outcomes: ProductOutcome[];
  issues: ImportIssue[];
}

export interface ImageJob {
  productId: string;
  sku: string;
  folder: string[];
  urls: string[];
}

function effectivePaths(plan: ImportPlan, strip: boolean): Map<string, string[]> {
  const roots = new Set(plan.categories.map((c) => c.path[0]?.toLowerCase()));
  const canStrip = strip && roots.size === 1 && plan.categories.every((c) => c.path.length > 1);
  const out = new Map<string, string[]>();
  for (const c of plan.categories) out.set(catKey(c), canStrip ? c.path.slice(1) : c.path);
  return out;
}
const catKey = (c: { externalId: string | null; path: string[] }) => c.externalId ?? c.path.join(" / ").toLowerCase();
const brandKey = (b: { externalId: string | null; name: string }) => b.externalId ?? b.name.toLowerCase();

/* ------------------------------------------------------------------ lookup */

async function findBrand(db: DbOrTx, b: { externalId: string | null; name: string }) {
  if (b.externalId) {
    const [byExt] = await db.select().from(brands).where(eq(brands.externalId, b.externalId));
    if (byExt) return byExt;
  }
  const [byName] = await db.select().from(brands).where(sql`lower(${brands.name}) = ${b.name.toLowerCase()}`);
  return byName ?? null;
}

async function findCategoryChild(db: DbOrTx, parentId: string | null, name: string) {
  const [row] = await db
    .select()
    .from(categories)
    .where(and(parentId ? eq(categories.parentId, parentId) : isNull(categories.parentId), sql`lower(${categories.name}) = ${name.toLowerCase()}`));
  return row ?? null;
}

async function uniqueSlug(db: DbOrTx, table: typeof categories | typeof brands | typeof products, candidates: string[]): Promise<string> {
  const list = candidates.map((c) => slugify(c)).filter(Boolean);
  for (const s of list) {
    const found: { id: string }[] = await db.select({ id: table.id }).from(table).where(eq(table.slug, s));
    if (!found.length) return s;
  }
  const base = list[0] ?? "item";
  for (let i = 2; ; i++) {
    const s = `${base}-${i}`;
    const found: { id: string }[] = await db.select({ id: table.id }).from(table).where(eq(table.slug, s));
    if (!found.length) return s;
  }
}

/* ----------------------------------------------------------------- preview */

/** Dry run: what would be created vs updated. Makes no changes. */
export async function previewImport(db: Database, plan: ImportPlan, opts: Omit<ImportOptions, "sourceName">): Promise<ImportSummary> {
  const paths = effectivePaths(plan, opts.stripCommonRoot);
  const summary = emptySummary(plan);

  for (const b of plan.brands) {
    if (await findBrand(db, b)) summary.brands.existing++;
    else {
      summary.brands.new++;
      summary.brands.names.push(b.name);
    }
  }
  for (const c of plan.categories) {
    const path = paths.get(catKey(c)) ?? c.path;
    let parentId: string | null = null;
    let missing = false;
    if (c.externalId) {
      const [ext] = await db.select().from(categories).where(eq(categories.externalId, c.externalId));
      if (ext) {
        summary.categories.existing++;
        continue;
      }
    }
    for (const seg of path) {
      const hit: { id: string } | null = missing ? null : await findCategoryChild(db, parentId, seg);
      if (!hit) missing = true;
      parentId = hit?.id ?? null;
    }
    if (missing) {
      summary.categories.new++;
      summary.categories.paths.push(path.join(" › "));
    } else summary.categories.existing++;
  }

  const skus = plan.products.map((p) => p.sku);
  const vskus = plan.products.flatMap((p) => p.variants.map((v) => v.sku));
  const existingProducts = skus.length ? await db.select({ id: products.id, sku: products.sku }).from(products).where(inArray(products.sku, skus)) : [];
  const existingVariants = vskus.length
    ? await db.select({ sku: productVariants.sku, productId: productVariants.productId }).from(productVariants).where(inArray(productVariants.sku, vskus))
    : [];
  const pBySku = new Map(existingProducts.map((p) => [p.sku, p.id]));
  const activeByProduct = new Map<string, string[]>();
  if (existingProducts.length) {
    const rows = await db
      .select({ productId: productVariants.productId, sku: productVariants.sku })
      .from(productVariants)
      .where(and(inArray(productVariants.productId, existingProducts.map((p) => p.id)), eq(productVariants.isActive, true)));
    for (const r of rows) activeByProduct.set(r.productId, [...(activeByProduct.get(r.productId) ?? []), r.sku]);
  }
  const vBySku = new Map(existingVariants.map((v) => [v.sku, v.productId]));

  for (const p of plan.products) {
    const pid = pBySku.get(p.sku);
    let vNew = 0;
    let vOld = 0;
    for (const v of p.variants) {
      const owner = vBySku.get(v.sku);
      if (!owner) vNew++;
      else if (pid && owner === pid) vOld++;
      else summary.issues.push({ row: v.row, sku: v.sku, level: "error", message: "This variant SKU already belongs to a different product — it will be skipped" });
    }
    const inFile = new Set(p.variants.map((v) => v.sku));
    const notInFile = pid ? (activeByProduct.get(pid) ?? []).filter((s) => !inFile.has(s)).length : 0;
    summary.variants.notInFile += notInFile;
    const action = pid ? (opts.updateExisting ? "update" : "skip") : "create";
    if (action === "create") summary.products.new++;
    else if (action === "update") summary.products.existing++;
    else summary.products.skipped++;
    summary.variants.new += vNew;
    summary.variants.existing += vOld;
    const stock = p.variants.reduce((s, v) => s + (v.stock ?? 0), 0);
    summary.stockUnits += stock;
    summary.images += p.images.length;
    summary.outcomes.push({ sku: p.sku, name: p.name, action, productId: pid, variantsNew: vNew, variantsExisting: vOld, variantsNotInFile: notInFile, category: p.category ? (paths.get(catKey(p.category)) ?? p.category.path).join(" › ") : null, price: p.price, stock });
  }
  return summary;
}

function emptySummary(plan: ImportPlan): ImportSummary {
  return {
    brands: { new: 0, existing: 0, names: [] },
    categories: { new: 0, existing: 0, paths: [] },
    products: { new: 0, existing: 0, skipped: 0 },
    variants: { new: 0, existing: 0, notInFile: 0, deactivated: 0 },
    stockUnits: 0,
    images: 0,
    outcomes: [],
    issues: [...plan.issues],
  };
}

/* ------------------------------------------------------------------- apply */

/**
 * Applies a plan. Idempotent: importing the same sheet twice updates the
 * same products/variants (matched by SKU) and, with stockMode "set", leaves
 * stock exactly as in the sheet. Every stock change goes through the
 * inventory ledger, so the audit trail shows "Import: <file>".
 */
export async function applyImport(db: Database, plan: ImportPlan, opts: ImportOptions): Promise<{ summary: ImportSummary; imageJobs: ImageJob[] }> {
  const summary = emptySummary(plan);
  const imageJobs: ImageJob[] = [];
  const paths = effectivePaths(plan, opts.stripCommonRoot);
  const note = `Import: ${opts.sourceName}`.slice(0, 200);

  // Brands
  const brandIds = new Map<string, string>();
  for (const b of plan.brands) {
    let row: typeof brands.$inferSelect | null | undefined = await findBrand(db, b);
    if (!row) {
      [row] = await db
        .insert(brands)
        .values({ name: b.name, slug: await uniqueSlug(db, brands, [b.name, `${b.name}-${b.externalId ?? ""}`]), externalId: b.externalId })
        .returning();
      summary.brands.new++;
      summary.brands.names.push(b.name);
    } else {
      summary.brands.existing++;
      if (b.externalId && !row.externalId) await db.update(brands).set({ externalId: b.externalId }).where(eq(brands.id, row.id));
    }
    brandIds.set(brandKey(b), row!.id);
  }

  // Category tree
  const categoryIds = new Map<string, string>();
  for (const c of plan.categories) {
    const path = paths.get(catKey(c)) ?? c.path;
    if (c.externalId) {
      const [ext] = await db.select().from(categories).where(eq(categories.externalId, c.externalId));
      if (ext) {
        categoryIds.set(catKey(c), ext.id);
        summary.categories.existing++;
        continue;
      }
    }
    let parentId: string | null = null;
    let created = false;
    for (const [i, seg] of path.entries()) {
      const isLeaf = i === path.length - 1;
      let row: typeof categories.$inferSelect | null | undefined = await findCategoryChild(db, parentId, seg);
      if (!row) {
        const top = path[0]!;
        [row] = await db
          .insert(categories)
          .values({
            name: seg,
            parentId,
            slug: await uniqueSlug(db, categories, i === 0 ? [seg] : [seg, `${top}-${seg}`, `${path[i - 1]}-${seg}`, `${top}-${path[i - 1]}-${seg}`]),
            externalId: isLeaf ? c.externalId : null,
            sortOrder: 0,
          })
          .returning();
        created = true;
      } else if (isLeaf && c.externalId && !row.externalId) {
        await db.update(categories).set({ externalId: c.externalId }).where(eq(categories.id, row.id));
      }
      parentId = row!.id;
    }
    if (created) {
      summary.categories.new++;
      summary.categories.paths.push(path.join(" › "));
    } else summary.categories.existing++;
    if (parentId) categoryIds.set(catKey(c), parentId);
  }

  // Products (one transaction each, so one bad product never half-imports)
  for (const p of plan.products) {
    try {
      const outcome = await db.transaction((tx) => upsertProduct(tx, p, opts, note, summary, brandIds, categoryIds, paths));
      summary.outcomes.push(outcome);
      if (outcome.action === "create") summary.products.new++;
      else if (outcome.action === "update") summary.products.existing++;
      else summary.products.skipped++;
      if (outcome.productId && outcome.action !== "skip" && p.images.length) {
        imageJobs.push({ productId: outcome.productId, sku: p.sku, folder: imageFolder(p), urls: p.images });
        summary.images += p.images.length;
      }
    } catch (err) {
      summary.issues.push({ row: p.firstRow, sku: p.sku, level: "error", message: `Product not imported: ${(err as Error).message}` });
      summary.products.skipped++;
    }
  }
  return { summary, imageJobs };
}

async function upsertProduct(
  tx: DbOrTx,
  p: PlannedProduct,
  opts: ImportOptions,
  note: string,
  summary: ImportSummary,
  brandIds: Map<string, string>,
  categoryIds: Map<string, string>,
  paths: Map<string, string[]>,
): Promise<ProductOutcome> {
  const [existing] = await tx.select().from(products).where(eq(products.sku, p.sku));
  const categoryId = p.category ? (categoryIds.get(catKey(p.category)) ?? null) : null;
  const brandId = p.brand ? (brandIds.get(brandKey(p.brand)) ?? null) : null;
  const sizes = [...new Set(p.variants.map((v) => v.options.Size).filter(Boolean))] as string[];
  const categoryLabel = p.category ? (paths.get(catKey(p.category)) ?? p.category.path).join(" › ") : null;
  const stockTotal = p.variants.reduce((s, v) => s + (v.stock ?? 0), 0);

  if (existing && !opts.updateExisting) {
    return { sku: p.sku, name: p.name, action: "skip", productId: existing.id, variantsNew: 0, variantsExisting: 0, variantsNotInFile: 0, category: categoryLabel, price: p.price, stock: stockTotal };
  }

  const fields = {
    name: p.name,
    description: p.description,
    categoryId,
    brandId,
    price: p.price,
    salePrice: p.salePrice,
    weightGrams: p.weightGrams,
    optionNames: p.optionNames,
    sizes,
    colours: p.colours,
    tags: p.tags,
    attributes: p.attributes,
  };
  let productId: string;
  if (existing) {
    productId = existing.id;
    // Never blank out something the sheet simply doesn't have (e.g. weight, brand, images).
    const patch: Record<string, unknown> = { ...fields, sizes: [...new Set([...existing.sizes, ...sizes])] };
    for (const k of ["description", "categoryId", "brandId", "weightGrams", "salePrice"] as const) if (patch[k] === null) delete patch[k];
    if (!p.colours.length) delete patch.colours;
    patch.attributes = { ...existing.attributes, ...p.attributes };
    await tx.update(products).set(patch).where(eq(products.id, productId));
  } else {
    const slug = await uniqueSlug(tx, products, [p.name, `${p.name}-${p.sku}`]);
    const [row] = await tx
      .insert(products)
      .values({ ...fields, sku: p.sku, slug, status: opts.status, seoDescription: p.description ? p.description.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 160) : null })
      .returning({ id: products.id });
    productId = row!.id;
  }

  let vNew = 0;
  let vOld = 0;
  for (const [i, v] of p.variants.entries()) {
    const [vex] = await tx.select().from(productVariants).where(eq(productVariants.sku, v.sku));
    const vFields = {
      options: v.options,
      size: v.options.Size ?? null,
      colour: v.options.Colour ?? null,
      price: v.price === p.price ? null : v.price,
      salePrice: v.salePrice !== null && v.salePrice !== p.salePrice ? v.salePrice : null,
      barcode: v.barcode,
      sortOrder: i,
      isActive: true,
    };
    let variantId: string;
    let isNew = false;
    if (vex) {
      if (vex.productId !== productId) {
        summary.issues.push({ row: v.row, sku: v.sku, level: "error", message: "Variant SKU already belongs to a different product — skipped" });
        continue;
      }
      variantId = vex.id;
      await tx.update(productVariants).set(vFields).where(eq(productVariants.id, variantId));
      vOld++;
      summary.variants.existing++;
    } else {
      const [row] = await tx.insert(productVariants).values({ ...vFields, productId, sku: v.sku }).returning({ id: productVariants.id });
      variantId = row!.id;
      await ensureInventoryRows(tx, [variantId]);
      isNew = true;
      vNew++;
      summary.variants.new++;
    }

    if (v.stock === null) continue;
    const mv = { note, staffId: opts.staffId ?? null, referenceType: "import" };
    try {
      if (isNew) {
        if (v.stock > 0) await inventory.receive(tx, variantId, v.stock, { ...mv, note: `Opening stock — ${note}` });
      } else if (opts.stockMode === "set") {
        await inventory.setCount(tx, variantId, v.stock, mv);
      } else if (opts.stockMode === "add" && v.stock > 0) {
        await inventory.receive(tx, variantId, v.stock, mv);
      }
      summary.stockUnits += isNew || opts.stockMode !== "ignore" ? v.stock : 0;
    } catch (err) {
      if (err instanceof InsufficientStockError) {
        summary.issues.push({ row: v.row, sku: v.sku, level: "warning", message: `Stock not set to ${v.stock}: ${err.available + 0} are reserved by open orders` });
      } else throw err;
    }
  }

  // Variants on the shop that this file no longer lists
  let notInFile = 0;
  if (existing) {
    const inFile = p.variants.map((v) => v.sku);
    const missing = await tx
      .select({ id: productVariants.id })
      .from(productVariants)
      .where(and(eq(productVariants.productId, productId), eq(productVariants.isActive, true), notInArray(productVariants.sku, inFile)));
    notInFile = missing.length;
    summary.variants.notInFile += notInFile;
    if (notInFile && opts.deactivateMissing) {
      await tx.update(productVariants).set({ isActive: false }).where(inArray(productVariants.id, missing.map((m) => m.id)));
      summary.variants.deactivated += notInFile;
    }
  }

  return { sku: p.sku, name: p.name, action: existing ? "update" : "create", productId, variantsNew: vNew, variantsExisting: vOld, variantsNotInFile: notInFile, category: categoryLabel, price: p.price, stock: stockTotal };
}

/* ------------------------------------------------------------------ images */

/** Which of a product's source image URLs have not been downloaded yet. */
export async function pendingImageUrls(db: DbOrTx, productId: string, urls: string[]): Promise<string[]> {
  if (!urls.length) return [];
  const done = await db
    .select({ url: mediaFiles.sourceUrl })
    .from(productImages)
    .innerJoin(mediaFiles, eq(mediaFiles.id, productImages.mediaId))
    .where(and(eq(productImages.productId, productId), inArray(mediaFiles.sourceUrl, urls)));
  const have = new Set(done.map((d) => d.url));
  return urls.filter((u) => !have.has(u));
}
