import { randomBytes } from "node:crypto";
import { mediaFiles, type Database } from "@ugmall/database";
import { processAndStoreImage, storeDocument, StorageError, type StorageProvider } from "@ugmall/storage";
import { safeSegment, type StorageArea, PUBLIC_STORAGE_AREAS } from "@ugmall/shared";
import { ApiError } from "./http";

export async function readUpload(form: FormData, field = "file"): Promise<{ buffer: Buffer; name: string }> {
  const file = form.get(field);
  if (!file || typeof file === "string") throw new ApiError(400, `Missing file field "${field}"`);
  const f = file as File;
  const max = Number(process.env.MAX_UPLOAD_BYTES ?? 10 * 1024 * 1024);
  if (f.size > max) throw new ApiError(413 as 400, `File too large (max ${Math.round(max / 1024 / 1024)} MB)`);
  return { buffer: Buffer.from(await f.arrayBuffer()), name: f.name };
}

/**
 * Saves an uploaded image to storage and records its metadata in media_files.
 * Path example: products/jeans/BLUE-JEANS-001/main-a1b2c3.webp
 */
export async function saveImage(
  db: Database,
  storage: StorageProvider,
  opts: { area: StorageArea; folders: string[]; baseName: string; buffer: Buffer; originalName?: string; staffId?: string; customerId?: string; sourceUrl?: string },
) {
  const visibility = PUBLIC_STORAGE_AREAS.includes(opts.area) ? "public" : "private";
  const folderKey = [opts.area, ...opts.folders.map(safeSegment)].join("/");
  // random suffix: re-uploads never collide and CDN/browser caches never serve a stale image
  const baseName = `${safeSegment(opts.baseName)}-${randomBytes(3).toString("hex")}`;
  try {
    const img = await processAndStoreImage(storage, { folderKey, baseName, input: opts.buffer, visibility });
    const [row] = await db
      .insert(mediaFiles)
      .values({
        area: opts.area,
        fileName: img.fileName,
        originalName: opts.originalName?.slice(0, 200),
        mimeType: img.mimeType,
        fileSize: img.fileSize,
        width: img.width,
        height: img.height,
        checksum: img.checksum,
        storageProvider: storage.name,
        storagePath: img.storagePath,
        publicUrl: img.publicUrl,
        isPublic: visibility === "public",
        variants: img.variants,
        uploadedByStaff: opts.staffId,
        uploadedByCustomer: opts.customerId,
        sourceUrl: opts.sourceUrl,
      })
      .returning();
    return row!;
  } catch (err) {
    if (err instanceof StorageError) throw new ApiError(422, err.message);
    throw err;
  }
}

export async function saveDocument(
  db: Database,
  storage: StorageProvider,
  opts: { area: StorageArea; folders: string[]; fileName: string; buffer: Buffer; originalName?: string; staffId?: string },
) {
  const key = [opts.area, ...opts.folders.map(safeSegment), `${randomBytes(4).toString("hex")}-${safeSegment(opts.fileName)}`].join("/");
  try {
    const doc = await storeDocument(storage, { key, input: opts.buffer, visibility: PUBLIC_STORAGE_AREAS.includes(opts.area) ? "public" : "private" });
    const [row] = await db
      .insert(mediaFiles)
      .values({
        area: opts.area,
        fileName: doc.fileName,
        originalName: opts.originalName,
        mimeType: doc.mimeType,
        fileSize: doc.fileSize,
        checksum: doc.checksum,
        storageProvider: storage.name,
        storagePath: doc.storagePath,
        publicUrl: doc.publicUrl,
        isPublic: false,
        uploadedByStaff: opts.staffId,
      })
      .returning();
    return row!;
  } catch (err) {
    if (err instanceof StorageError) throw new ApiError(422, err.message);
    throw err;
  }
}

/** Deletes the file (all renditions) and its metadata row. */
export async function deleteMedia(storage: StorageProvider, media: { storagePath: string; variants: Record<string, { path: string }> | null }) {
  await storage.delete(media.storagePath).catch(() => {});
  for (const v of Object.values(media.variants ?? {})) await storage.delete(v.path).catch(() => {});
}
