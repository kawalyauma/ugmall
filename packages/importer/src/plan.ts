import { safeSegment, sanitizeHtml, slugify } from "@ugmall/shared";
import type { Sheet } from "./spreadsheet";

export interface PlannedVariant {
  sku: string;
  options: Record<string, string>;
  price: number;
  salePrice: number | null;
  stock: number | null;
  barcode: string | null;
  row: number;
}

export interface PlannedProduct {
  sku: string;
  name: string;
  description: string | null;
  brand: { externalId: string | null; name: string } | null;
  category: { externalId: string | null; path: string[] } | null;
  price: number;
  salePrice: number | null;
  weightGrams: number | null;
  colours: string[];
  tags: string[];
  attributes: Record<string, string>;
  images: string[];
  optionNames: string[];
  variants: PlannedVariant[];
  firstRow: number;
}

export interface ImportIssue {
  row: number | null;
  sku?: string;
  level: "error" | "warning";
  message: string;
}

export interface ImportPlan {
  format: "jumia" | "generic";
  products: PlannedProduct[];
  brands: { externalId: string | null; name: string }[];
  categories: { externalId: string | null; path: string[] }[];
  issues: ImportIssue[];
  stats: { rows: number; blankRows: number; skippedRows: number; products: number; variants: number };
}

/* ------------------------------------------------------------------ columns */

/** Header aliases so both Jumia/Kilimall-style exports and a simple sheet work. */
const COLUMNS = {
  variantSku: ["SellerSKU", "Seller SKU", "variant_sku", "Variant SKU", "sku", "SKU"],
  parentSku: ["ParentSKU", "Parent SKU", "parent_sku", "product_sku", "Product SKU", "group", "Group"],
  name: ["Name", "name", "title", "Title", "Product Name", "product_name"],
  description: ["Description", "description", "Long Description"],
  shortDescription: ["short_description", "Short Description"],
  brand: ["Brand", "brand"],
  category: ["PrimaryCategory", "Primary Category", "Category", "category", "category_path"],
  price: ["Price_UGX", "Price", "price", "Selling Price", "selling_price", "Price (UGX)"],
  salePrice: ["SalePrice_UGX", "Sale Price", "sale_price", "SalePrice", "special_price", "Discount Price"],
  stock: ["stock", "Stock", "quantity", "Quantity", "Qty", "qty"],
  barcode: ["GTIN_Barcode", "barcode", "Barcode", "GTIN"],
  colour: ["color", "colour", "Color", "Colour"],
  weight: ["product_weight", "weight", "Weight", "weight_kg"],
  tags: ["tags", "Tags", "labels", "Labels"],
  images: ["MainImage", "Image2", "Image3", "Image4", "Image5", "Image6", "Image7", "Image8", "image", "Image", "image_url", "Image URL", "image1", "image2", "image3", "image4", "image5"],
} as const;

/** Variation axis columns: anything that is a size. */
const SIZE_COLUMNS = ["size", "Size", "men_pant_size", "women_pant_size", "pant_size", "shoe_size", "men_shoe_size", "women_shoe_size", "kids_size", "clothing_size", "ring_size", "bra_size"];

/** Product facts worth keeping as a details table on the product page. */
const ATTRIBUTE_COLUMNS: Record<string, string> = {
  gender: "Gender",
  main_material: "Material",
  material_family: "Material family",
  package_content: "In the box",
  season: "Season",
  sleeve_length: "Sleeve length",
  color_family: "Colour family",
  dress_style: "Dress style",
  pant_type: "Pant type",
  skirts_type: "Skirt type",
  age_group: "Age group",
  model: "Model",
  production_country: "Made in",
  note: "Note",
  product_warranty: "Warranty",
  warranty_duration: "Warranty duration",
  product_measures: "Measurements",
  size_conversion_type: "Size system",
};

function pick(row: Record<string, string>, keys: readonly string[]): string | undefined {
  for (const k of keys) {
    const v = row[k];
    if (v !== undefined && v !== "") return v;
  }
  return undefined;
}

/** "1039426 - Fashion" -> { externalId: "1039426", name: "Fashion" } */
export function splitExternalId(value: string): { externalId: string | null; name: string } {
  const m = /^\s*(\d{3,})\s*[-–:]\s*(.+?)\s*$/.exec(value);
  return m ? { externalId: m[1]!, name: m[2]! } : { externalId: null, name: value.trim() };
}

/** "1029598 - Fashion / Men's Fashion / Clothing / Pants / Trousers" -> id + path */
export function parseCategory(value: string): { externalId: string | null; path: string[] } {
  const { externalId, name } = splitExternalId(value);
  const path = name
    .split(/\s*(?:\/|>|›|»)\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
  return { externalId, path };
}

export function parseMoney(v: string | undefined): number | null {
  if (!v) return null;
  const cleaned = v.replace(/ugx|shs?|\/=|,|\s/gi, "");
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return null;
  return Math.round(Number(cleaned));
}

function parseInteger(v: string | undefined): number | null {
  if (v === undefined || v === "") return null;
  const n = Number(v.replace(/,/g, ""));
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : null;
}

/** Weight is kg in Jumia templates; values above 50 are assumed to be grams already. */
function parseWeight(v: string | undefined): number | null {
  if (!v) return null;
  const n = Number(v.replace(/kg|g|\s/gi, ""));
  if (!Number.isFinite(n) || n <= 0) return null;
  return n > 50 ? Math.round(n) : Math.round(n * 1000);
}

const SIZE_ORDER = ["XXS", "XS", "S", "M", "L", "XL", "XXL", "2XL", "XXXL", "3XL", "4XL", "5XL", "6XL", "FREE SIZE", "ONE SIZE"];
export function sizeRank(v: string): number {
  const n = Number(v.replace(/[^\d.]/g, ""));
  if (/^\d+(\.\d+)?$/.test(v.trim())) return n;
  const i = SIZE_ORDER.indexOf(v.trim().toUpperCase());
  return i >= 0 ? 10_000 + i : 20_000;
}

function splitList(v: string | undefined): string[] {
  return (v ?? "")
    .split(/\s*(?:,|\/|&|\band\b)\s*/i)
    .map((s) => s.trim())
    .filter(Boolean);
}

const cleanSku = (s: string) => s.trim().toUpperCase().replace(/\s+/g, "-");

/* ---------------------------------------------------------------- planning */

/**
 * Turns spreadsheet rows into products. Each row in seller-center exports is
 * ONE VARIATION (e.g. MTR-001-28 = trousers, waist 28). Rows sharing a
 * ParentSKU become one product with several variants — never separate products.
 */
export function buildImportPlan(sheet: Sheet): ImportPlan {
  const issues: ImportIssue[] = [];
  const format: ImportPlan["format"] = sheet.headers.includes("SellerSKU") && sheet.headers.includes("ParentSKU") ? "jumia" : "generic";
  const sizeCols = SIZE_COLUMNS.filter((c) => sheet.headers.includes(c));
  let blankRows = 0;
  let skippedRows = 0;

  type Line = { row: number; r: Record<string, string>; sku: string; parent: string };
  const groups = new Map<string, Line[]>();
  const seenVariantSku = new Map<string, number>();

  for (const r of sheet.rows) {
    const row = Number(r.__row);
    const name = pick(r, COLUMNS.name);
    const variantSkuRaw = pick(r, COLUMNS.variantSku);
    const parentRaw = pick(r, COLUMNS.parentSku);
    if (!name && !variantSkuRaw && !parentRaw) {
      blankRows++;
      continue;
    }
    if (!variantSkuRaw && !parentRaw) {
      issues.push({ row, level: "error", message: "Row has no SKU — skipped" });
      skippedRows++;
      continue;
    }
    const sku = cleanSku(variantSkuRaw ?? parentRaw!);
    const parent = cleanSku(parentRaw ?? variantSkuRaw!);
    if (!/^[A-Z0-9._-]{2,80}$/.test(sku) || !/^[A-Z0-9._-]{2,60}$/.test(parent)) {
      issues.push({ row, sku, level: "error", message: "SKU may only contain letters, numbers, dot, dash and underscore — skipped" });
      skippedRows++;
      continue;
    }
    const dupOf = seenVariantSku.get(sku);
    if (dupOf !== undefined) {
      issues.push({ row, sku, level: "warning", message: `Duplicate SKU (already on row ${dupOf}) — skipped` });
      skippedRows++;
      continue;
    }
    seenVariantSku.set(sku, row);
    const list = groups.get(parent) ?? [];
    list.push({ row, r, sku, parent });
    groups.set(parent, list);
  }

  const products: PlannedProduct[] = [];
  const brands = new Map<string, { externalId: string | null; name: string }>();
  const categories = new Map<string, { externalId: string | null; path: string[] }>();

  for (const [parentSku, lines] of groups) {
    const first = lines[0]!;
    const r0 = first.r;
    const name = pick(r0, COLUMNS.name);
    if (!name) {
      issues.push({ row: first.row, sku: parentSku, level: "error", message: "Missing product name — group skipped" });
      skippedRows += lines.length;
      continue;
    }
    const inconsistentNames = new Set(lines.map((l) => pick(l.r, COLUMNS.name)).filter(Boolean));
    if (inconsistentNames.size > 1) {
      issues.push({ row: first.row, sku: parentSku, level: "warning", message: `Rows in this group have ${inconsistentNames.size} different names; using "${name}"` });
    }

    // Variation axes: size columns always; colour only when it differs between rows of the group
    const sizeOf = (r: Record<string, string>) => pick(r, sizeCols);
    const colourValues = new Set(lines.map((l) => pick(l.r, COLUMNS.colour) ?? ""));
    const colourIsAxis = colourValues.size > 1;
    const hasSize = lines.some((l) => sizeOf(l.r));
    const optionNames = [colourIsAxis ? "Colour" : null, hasSize ? "Size" : null].filter(Boolean) as string[];

    const variants: PlannedVariant[] = [];
    const seenOptions = new Set<string>();
    for (const l of lines) {
      const price = parseMoney(pick(l.r, COLUMNS.price));
      if (price === null || price <= 0) {
        issues.push({ row: l.row, sku: l.sku, level: "error", message: "Missing or invalid price — variant skipped" });
        skippedRows++;
        continue;
      }
      const options: Record<string, string> = {};
      if (colourIsAxis) options.Colour = pick(l.r, COLUMNS.colour) ?? "Default";
      const size = sizeOf(l.r);
      if (hasSize) options.Size = size ?? "One size";
      const key = JSON.stringify(options);
      if (seenOptions.has(key) && Object.keys(options).length) {
        issues.push({ row: l.row, sku: l.sku, level: "warning", message: `Same ${optionNames.join("/") || "option"} as another row of ${parentSku} — skipped` });
        skippedRows++;
        continue;
      }
      seenOptions.add(key);
      let salePrice = parseMoney(pick(l.r, COLUMNS.salePrice));
      if (salePrice !== null && salePrice >= price) salePrice = null;
      const stockRaw = pick(l.r, COLUMNS.stock);
      const stock = parseInteger(stockRaw);
      if (stockRaw !== undefined && stock === null) issues.push({ row: l.row, sku: l.sku, level: "warning", message: `Stock "${stockRaw}" is not a number — left unchanged` });
      variants.push({ sku: l.sku, options, price, salePrice, stock, barcode: pick(l.r, COLUMNS.barcode) ?? null, row: l.row });
    }
    if (!variants.length) continue;
    variants.sort((a, b) => {
      const c = (a.options.Colour ?? "").localeCompare(b.options.Colour ?? "");
      return c !== 0 ? c : sizeRank(a.options.Size ?? "") - sizeRank(b.options.Size ?? "") || (a.options.Size ?? "").localeCompare(b.options.Size ?? "");
    });

    // Product price = the most common variant price; variants only override when different.
    const priceCounts = new Map<number, number>();
    for (const v of variants) priceCounts.set(v.price, (priceCounts.get(v.price) ?? 0) + 1);
    const price = [...priceCounts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]![0];
    const saleCandidates = variants.filter((v) => v.price === price).map((v) => v.salePrice);
    const salePrice = saleCandidates.every((s) => s !== null && s === saleCandidates[0]) ? (saleCandidates[0] ?? null) : null;

    const brandRaw = pick(r0, COLUMNS.brand);
    const brand = brandRaw ? splitExternalId(brandRaw) : null;
    if (brand) brands.set(brand.externalId ?? brand.name.toLowerCase(), brand);
    const catRaw = pick(r0, COLUMNS.category);
    const category = catRaw ? parseCategory(catRaw) : null;
    if (category?.path.length) categories.set(category.externalId ?? category.path.join(" / ").toLowerCase(), category);
    else issues.push({ row: first.row, sku: parentSku, level: "warning", message: "No category — product will be uncategorised" });

    const images: string[] = [];
    for (const l of lines) {
      for (const col of COLUMNS.images) {
        const u = l.r[col];
        if (u && /^https?:\/\//i.test(u) && !images.includes(u)) images.push(u);
      }
    }

    const attributes: Record<string, string> = {};
    for (const [col, label] of Object.entries(ATTRIBUTE_COLUMNS)) {
      const v = r0[col];
      if (v) attributes[label] = v.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    }
    const colourText = pick(r0, COLUMNS.colour);
    if (colourText && !colourIsAxis) attributes.Colour = colourText;

    const description = pick(r0, COLUMNS.description);
    const shortDescription = pick(r0, COLUMNS.shortDescription);
    products.push({
      sku: parentSku,
      name: name.replace(/\s+/g, " ").trim().slice(0, 200),
      description: description ? sanitizeHtml(description) : shortDescription ? sanitizeHtml(shortDescription) : null,
      brand,
      category: category?.path.length ? category : null,
      price,
      salePrice,
      weightGrams: parseWeight(pick(r0, COLUMNS.weight)),
      colours: colourIsAxis ? [...colourValues].filter(Boolean) : splitList(colourText).slice(0, 10),
      tags: [
        ...new Set([
          ...splitList(pick(r0, COLUMNS.tags)),
          r0.gender,
          category?.path.at(-1),
        ].filter(Boolean).map((t) => t!.toLowerCase())),
      ],
      attributes,
      images: images.slice(0, 8),
      optionNames,
      variants,
      firstRow: first.row,
    });
  }

  return {
    format,
    products,
    brands: [...brands.values()],
    categories: [...categories.values()],
    issues,
    stats: {
      rows: sheet.rows.length,
      blankRows,
      skippedRows,
      products: products.length,
      variants: products.reduce((s, p) => s + p.variants.length, 0),
    },
  };
}

/** Folder for a product's images: products/<category-leaf>/<SKU> */
export function imageFolder(p: Pick<PlannedProduct, "category" | "sku">): string[] {
  return [safeSegment(slugify(p.category?.path.at(-1) ?? "uncategorised")), p.sku];
}
