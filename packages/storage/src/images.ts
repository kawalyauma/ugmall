import { createHash } from "node:crypto";
import sharp from "sharp";
import { StorageError, type StorageProvider, type Visibility } from "./provider";

export const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_BYTES ?? 10 * 1024 * 1024);

const SIGNATURES: { mime: string; test: (b: Buffer) => boolean }[] = [
  { mime: "image/jpeg", test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: "image/png", test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mime: "image/webp", test: (b) => b.subarray(0, 4).toString() === "RIFF" && b.subarray(8, 12).toString() === "WEBP" },
  { mime: "image/gif", test: (b) => b.subarray(0, 4).toString() === "GIF8" },
  { mime: "image/avif", test: (b) => b.subarray(4, 12).toString() === "ftypavif" },
  { mime: "application/pdf", test: (b) => b.subarray(0, 5).toString() === "%PDF-" },
];

/** Detect file type from magic bytes — the client-supplied MIME type is never trusted. */
export function sniffMime(buf: Buffer): string | null {
  return SIGNATURES.find((s) => s.test(buf))?.mime ?? null;
}

export const IMAGE_RENDITIONS = {
  main: 1600,
  medium: 800,
  thumb: 400,
} as const;

export interface StoredImage {
  fileName: string;
  mimeType: string;
  fileSize: number;
  width: number;
  height: number;
  checksum: string;
  storagePath: string;
  publicUrl: string | null;
  variants: Record<string, { path: string; url: string | null; width: number; height: number; size: number }>;
}

/**
 * Normalises an uploaded image: strips EXIF (privacy — phone photos carry GPS),
 * auto-rotates, converts to WebP and writes main/medium/thumb renditions:
 *   {folder}/{baseName}.webp, {folder}/{baseName}-medium.webp, {folder}/{baseName}-thumb.webp
 */
export async function processAndStoreImage(
  storage: StorageProvider,
  opts: { folderKey: string; baseName: string; input: Buffer; visibility: Visibility; quality?: number },
): Promise<StoredImage> {
  if (opts.input.length > MAX_UPLOAD_BYTES) throw new StorageError("File too large", "TOO_LARGE");
  const mime = sniffMime(opts.input);
  if (!mime || !mime.startsWith("image/")) throw new StorageError("Unsupported image type", "INVALID_FILE");

  const quality = opts.quality ?? 82;
  const variants: StoredImage["variants"] = {};
  let main: { key: string; size: number; width: number; height: number; url: string | null } | null = null;

  for (const [name, width] of Object.entries(IMAGE_RENDITIONS)) {
    const { data, info } = await sharp(opts.input, { failOn: "error", limitInputPixels: 50_000_000 })
      .rotate()
      .resize({ width, height: width, fit: "inside", withoutEnlargement: true })
      .webp({ quality })
      .toBuffer({ resolveWithObject: true });
    const key = `${opts.folderKey}/${name === "main" ? opts.baseName : `${opts.baseName}-${name}`}.webp`;
    const stored = await storage.upload({ key, body: data, contentType: "image/webp", visibility: opts.visibility });
    const entry = { path: key, url: stored.url, width: info.width, height: info.height, size: data.length };
    if (name === "main") main = { key, size: data.length, width: info.width, height: info.height, url: stored.url };
    else variants[name] = entry;
  }
  if (!main) throw new Error("unreachable");
  return {
    fileName: main.key.split("/").pop()!,
    mimeType: "image/webp",
    fileSize: main.size,
    width: main.width,
    height: main.height,
    checksum: createHash("sha256").update(opts.input).digest("hex"),
    storagePath: main.key,
    publicUrl: main.url,
    variants,
  };
}

/** Store a non-image document (PDF invoice, receipt scan) as-is after type sniffing. */
export async function storeDocument(
  storage: StorageProvider,
  opts: { key: string; input: Buffer; visibility: Visibility; allowed?: string[] },
) {
  if (opts.input.length > MAX_UPLOAD_BYTES) throw new StorageError("File too large", "TOO_LARGE");
  const mime = sniffMime(opts.input);
  const allowed = opts.allowed ?? ["application/pdf", "image/jpeg", "image/png", "image/webp"];
  if (!mime || !allowed.includes(mime)) throw new StorageError("Unsupported file type", "INVALID_FILE");
  const stored = await storage.upload({ key: opts.key, body: opts.input, contentType: mime, visibility: opts.visibility });
  return {
    fileName: opts.key.split("/").pop()!,
    mimeType: mime,
    fileSize: opts.input.length,
    checksum: createHash("sha256").update(opts.input).digest("hex"),
    storagePath: opts.key,
    publicUrl: stored.url,
  };
}
