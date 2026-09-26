/**
 * Import products from the command line (useful for big catalogues):
 *   pnpm --filter @ugmall/api import-products -- ./jumia_upload.xlsx [--dry-run] [--stock=set|add|ignore] [--status=active|draft] [--no-update] [--no-images] [--keep-root] [--deactivate-missing]
 * In Docker:
 *   docker compose cp ./jumia_upload.xlsx api:/tmp/upload.xlsx
 *   docker compose exec api node dist/import-products.js /tmp/upload.xlsx --dry-run
 * Images are downloaded by the worker (keep it running).
 */
import fs from "node:fs";
import path from "node:path";
import { applyImport, buildImportPlan, DEFAULT_IMPORT_OPTIONS, previewImport, readSpreadsheet, type ImportSummary } from "@ugmall/importer";
import { createContainer } from "../container";

const args = process.argv.slice(2).filter((a) => a !== "--");
const file = args.find((a) => !a.startsWith("--"));
if (!file) {
  console.error("Usage: import-products <file.xlsx|csv> [--dry-run] [--stock=set|add|ignore] [--status=active|draft] [--no-update] [--no-images] [--keep-root]");
  process.exit(1);
}
const flag = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
const opts = {
  ...DEFAULT_IMPORT_OPTIONS,
  stockMode: (flag("stock") ?? DEFAULT_IMPORT_OPTIONS.stockMode) as "set" | "add" | "ignore",
  status: (flag("status") ?? DEFAULT_IMPORT_OPTIONS.status) as "active" | "draft",
  updateExisting: !args.includes("--no-update"),
  stripCommonRoot: !args.includes("--keep-root"),
  deactivateMissing: args.includes("--deactivate-missing"),
};

const container = createContainer();
const plan = buildImportPlan(readSpreadsheet(new Uint8Array(fs.readFileSync(file)), file));
console.log(`${path.basename(file)}: ${plan.format} format, ${plan.stats.rows} rows → ${plan.stats.products} products / ${plan.stats.variants} variants`);

const print = (s: ImportSummary) => {
  console.log(`Brands:     ${s.brands.new} new, ${s.brands.existing} existing ${s.brands.names.length ? `(${s.brands.names.join(", ")})` : ""}`);
  console.log(`Categories: ${s.categories.new} new, ${s.categories.existing} existing`);
  for (const p of s.categories.paths) console.log(`   + ${p}`);
  console.log(`Products:   ${s.products.new} new, ${s.products.existing} updated, ${s.products.skipped} skipped`);
  console.log(`Variants:   ${s.variants.new} new, ${s.variants.existing} updated · stock units ${s.stockUnits} · images ${s.images}`);
  if (s.variants.notInFile) console.log(`            ${s.variants.notInFile} variants on the shop are not in this file${s.variants.deactivated ? ` — ${s.variants.deactivated} deactivated` : " (kept; use --deactivate-missing to hide them)"}`);
  for (const i of s.issues.slice(0, 40)) console.log(`   ${i.level.toUpperCase()} row ${i.row ?? "-"} ${i.sku ?? ""}: ${i.message}`);
  if (s.issues.length > 40) console.log(`   … ${s.issues.length - 40} more issues`);
};

if (args.includes("--dry-run")) {
  print(await previewImport(container.db, plan, opts));
} else {
  const { summary, imageJobs } = await applyImport(container.db, plan, { ...opts, sourceName: path.basename(file) });
  print(summary);
  if (!args.includes("--no-images")) {
    for (const job of imageJobs) await container.queues.imports.add("product-images", job, { jobId: `img-${job.productId}-${Date.now()}` });
    console.log(`Queued image downloads for ${imageJobs.length} products (the worker downloads them to storage/products).`);
  }
}
await Promise.allSettled([...Object.values(container.queues).map((q) => q.close()), container.redis.quit(), container.queueRedis.quit(), container.closeDb()]);
