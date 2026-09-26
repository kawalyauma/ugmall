import { and, count, eq } from "drizzle-orm";
import { productImages, type Database } from "@ugmall/database";
import { pendingImageUrls, type ImageJob } from "@ugmall/importer";
import type { StorageProvider } from "@ugmall/storage";
import { saveImage } from "./media";

const MAX_BYTES = 10 * 1024 * 1024;

/** Seller-center CDNs serve small thumbnails by default; ask for a larger rendition first. */
export function candidateUrls(url: string): string[] {
  const out: string[] = [];
  if (/\/fit-in\/\d+x\d+\//.test(url)) out.push(url.replace(/\/fit-in\/\d+x\d+\//, "/fit-in/680x680/"));
  out.push(url);
  return [...new Set(out)];
}

async function download(url: string): Promise<Buffer> {
  let lastErr: unknown;
  for (const u of candidateUrls(url)) {
    try {
      const res = await fetch(u, { signal: AbortSignal.timeout(30_000), redirect: "follow", headers: { "User-Agent": "Mozilla/5.0 (compatible; ShopImporter/1.0)" } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const len = Number(res.headers.get("content-length") ?? 0);
      if (len > MAX_BYTES) throw new Error("image too large");
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > MAX_BYTES) throw new Error("image too large");
      return buf;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/**
 * Downloads a product's images from the sheet URLs onto this server
 * (storage/products/<category>/<SKU>/...), converts them to WebP renditions
 * and attaches them. Already-downloaded URLs are skipped, so re-imports and
 * job retries never duplicate photos. Throws if any image failed so the job
 * is retried later (successful ones are kept).
 */
export async function importProductImages(db: Database, storage: StorageProvider, job: ImageJob) {
  const pending = await pendingImageUrls(db, job.productId, job.urls);
  const failures: string[] = [];
  for (const url of pending) {
    try {
      const buf = await download(url);
      const [{ n }] = (await db.select({ n: count() }).from(productImages).where(eq(productImages.productId, job.productId))) as [{ n: number }];
      const media = await saveImage(db, storage, {
        area: "products",
        folders: job.folder,
        baseName: n === 0 ? "main" : `image-${n + 1}`,
        buffer: buf,
        originalName: url.split("/").pop()?.split("?")[0]?.slice(0, 100),
        sourceUrl: url,
      });
      const already = await db
        .select({ id: productImages.id })
        .from(productImages)
        .where(and(eq(productImages.productId, job.productId), eq(productImages.mediaId, media.id)));
      if (!already.length) {
        await db.insert(productImages).values({ productId: job.productId, mediaId: media.id, sortOrder: job.urls.indexOf(url) });
      }
    } catch (err) {
      failures.push(`${url}: ${(err as Error).message}`);
    }
  }
  if (failures.length) throw new Error(`${failures.length}/${pending.length} image(s) failed for ${job.sku}: ${failures[0]}`);
  return { downloaded: pending.length };
}
