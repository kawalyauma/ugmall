import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { z } from "zod";
import { desc, eq } from "drizzle-orm";
import { productImports, staffUsers } from "@ugmall/database";
import { applyImport, buildImportPlan, DEFAULT_IMPORT_OPTIONS, previewImport, readSpreadsheet, SpreadsheetError, type ImportOptions } from "@ugmall/importer";
import { PERMISSIONS, safeSegment } from "@ugmall/shared";
import { ApiError, body } from "../../lib/http";
import { audit } from "../../lib/audit";
import { requirePermission } from "../../middleware/auth";
import type { AppEnv } from "../../types";

export const adminImportRoutes = new Hono<AppEnv>();
const P = PERMISSIONS;
const MAX_IMPORT_BYTES = 20 * 1024 * 1024;

const optionsSchema = z.object({
  stockMode: z.enum(["set", "add", "ignore"]).default(DEFAULT_IMPORT_OPTIONS.stockMode),
  status: z.enum(["active", "draft"]).default(DEFAULT_IMPORT_OPTIONS.status),
  updateExisting: z.boolean().default(DEFAULT_IMPORT_OPTIONS.updateExisting),
  stripCommonRoot: z.boolean().default(DEFAULT_IMPORT_OPTIONS.stripCommonRoot),
  deactivateMissing: z.boolean().default(DEFAULT_IMPORT_OPTIONS.deactivateMissing),
  downloadImages: z.boolean().default(true),
});

async function loadPlan(storage: AppEnv["Variables"]["container"]["storage"], key: string, fileName: string) {
  const stream = await storage.read(key);
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(Buffer.from(c as Uint8Array));
  return buildImportPlan(readSpreadsheet(new Uint8Array(Buffer.concat(chunks)), fileName));
}

/**
 * Step 1: upload a sheet (Jumia/Kilimall seller-center export or a simple
 * sheet). Nothing is written to the catalogue; the response shows what will
 * be created/updated and any problems. The file is kept privately in
 * storage/temp/imports until applied (temp is cleaned after 24h).
 */
adminImportRoutes.post("/imports/preview", requirePermission(P.productsManage), async (c) => {
  const { db, storage } = c.get("container");
  const form = await c.req.formData();
  const file = form.get("file");
  if (!file || typeof file === "string") throw new ApiError(400, "Choose a spreadsheet to upload");
  const f = file as File;
  if (f.size > MAX_IMPORT_BYTES) throw new ApiError(422, "File is too large (max 20 MB)");
  const buf = new Uint8Array(await f.arrayBuffer());
  let options;
  try {
    options = optionsSchema.parse(JSON.parse(String(form.get("options") ?? "{}")));
  } catch {
    throw new ApiError(422, "Invalid import options");
  }
  let plan;
  try {
    plan = buildImportPlan(readSpreadsheet(buf, f.name));
  } catch (err) {
    if (err instanceof SpreadsheetError) throw new ApiError(422, err.message);
    throw err;
  }
  if (!plan.products.length) throw new ApiError(422, "No products found in this file", plan.issues.slice(0, 50));

  const id = randomUUID();
  const key = `temp/imports/${id}-${safeSegment(f.name).slice(0, 80)}`;
  await storage.upload({ key, body: Buffer.from(buf), contentType: "application/octet-stream", visibility: "private" });
  const summary = await previewImport(db, plan, options);
  await db.insert(productImports).values({ id, fileName: f.name, storagePath: key, format: plan.format, status: "previewed", options, summary: { ...summary, outcomes: undefined }, staffId: c.get("staff").id });
  return c.json({ importId: id, fileName: f.name, format: plan.format, stats: plan.stats, summary });
});

/** Step 2: apply a previewed import. */
adminImportRoutes.post("/imports/:id/apply", requirePermission(P.productsManage), requirePermission(P.inventoryAdjust), async (c) => {
  const { db, storage, queues } = c.get("container");
  const overrides = await body(c, optionsSchema.partial());
  const [imp] = await db.select().from(productImports).where(eq(productImports.id, c.req.param("id")));
  if (!imp || !imp.storagePath) throw new ApiError(404, "Import not found — upload the file again");
  if (imp.status === "completed") throw new ApiError(409, "This import was already applied");
  if (imp.status === "running") throw new ApiError(409, "This import is already running");
  await db.update(productImports).set({ status: "running" }).where(eq(productImports.id, imp.id));
  const options = { ...optionsSchema.parse(imp.options ?? {}), ...overrides };
  try {
    const plan = await loadPlan(storage, imp.storagePath, imp.fileName);
    const opts: ImportOptions = { ...options, staffId: c.get("staff").id, sourceName: imp.fileName };
    const { summary, imageJobs } = await applyImport(db, plan, opts);
    if (options.downloadImages) {
      for (const job of imageJobs) await queues.imports.add("product-images", job, { jobId: `img-${job.productId}-${imp.id}` });
    }
    await db
      .update(productImports)
      .set({ status: "completed", completedAt: new Date(), options, summary: { ...summary, outcomes: undefined, imageJobs: options.downloadImages ? imageJobs.length : 0 } })
      .where(eq(productImports.id, imp.id));
    await storage.delete(imp.storagePath).catch(() => {});
    await audit(db, c.get("staff").id, "products.import", "import", imp.id, { file: imp.fileName, products: summary.products, variants: summary.variants });
    return c.json({ summary, imageJobs: options.downloadImages ? imageJobs.length : 0 });
  } catch (err) {
    await db.update(productImports).set({ status: "failed", summary: { error: (err as Error).message } }).where(eq(productImports.id, imp.id));
    throw err;
  }
});

adminImportRoutes.get("/imports", requirePermission(P.productsView), async (c) => {
  const { db, queues } = c.get("container");
  const rows = await db
    .select({ i: productImports, staffName: staffUsers.name })
    .from(productImports)
    .leftJoin(staffUsers, eq(staffUsers.id, productImports.staffId))
    .orderBy(desc(productImports.createdAt))
    .limit(50);
  const images = await queues.imports.getJobCounts("waiting", "active", "delayed", "failed", "completed");
  return c.json({ imports: rows.map((r) => ({ ...r.i, storagePath: undefined, staffName: r.staffName })), imageQueue: images });
});

/** Simple template for shops that don't use a seller-center export. */
adminImportRoutes.get("/imports/template.csv", requirePermission(P.productsView), (c) => {
  const rows = [
    ["Name", "ParentSKU", "SellerSKU", "Brand", "Category", "Price", "SalePrice", "stock", "size", "color", "Description", "MainImage", "Image2", "product_weight"],
    ["Men's Blue Stretch Denim Jeans", "BLUE-JEANS-001", "BLUE-JEANS-001-30", "Levi's", "Men / Clothing / Jeans", "60000", "58000", "8", "30", "Blue", "Slim fit stretch denim", "https://example.com/jeans.jpg", "", "0.65"],
    ["Men's Blue Stretch Denim Jeans", "BLUE-JEANS-001", "BLUE-JEANS-001-32", "Levi's", "Men / Clothing / Jeans", "60000", "58000", "17", "32", "Blue", "Slim fit stretch denim", "https://example.com/jeans.jpg", "", "0.65"],
    ["Men's Blue Stretch Denim Jeans", "BLUE-JEANS-001", "BLUE-JEANS-001-34", "Levi's", "Men / Clothing / Jeans", "60000", "58000", "3", "34", "Blue", "Slim fit stretch denim", "https://example.com/jeans.jpg", "", "0.65"],
  ];
  c.header("Content-Type", "text/csv; charset=utf-8");
  c.header("Content-Disposition", 'attachment; filename="product-import-template.csv"');
  return c.body(rows.map((r) => r.map((v) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)).join(",")).join("\r\n") + "\r\n");
});
