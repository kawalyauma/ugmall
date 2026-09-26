import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import sharp from "sharp";
import { LocalFilesystemProvider } from "./local";
import { buildKey } from "./keys";
import { processAndStoreImage, sniffMime } from "./images";
import { signedPrivateUrl, verifySignedKey } from "./signing";

let root: string;
let storage: LocalFilesystemProvider;

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "ugmall-storage-"));
  storage = new LocalFilesystemProvider({ root, publicBaseUrl: "https://shop.example.ug/media/" });
});
afterAll(() => fs.rm(root, { recursive: true, force: true }));

describe("LocalFilesystemProvider", () => {
  it("uploads, reports public URLs, moves and deletes", async () => {
    const key = buildKey("products", ["jeans", "BLUE-JEANS-001"], "main.webp");
    expect(key).toBe("products/jeans/BLUE-JEANS-001/main.webp");
    const res = await storage.upload({ key, body: Buffer.from("x"), contentType: "image/webp", visibility: "public" });
    expect(res.url).toBe("https://shop.example.ug/media/products/jeans/BLUE-JEANS-001/main.webp");
    expect(await storage.exists(key)).toBe(true);
    await storage.move(key, "products/jeans/BLUE-JEANS-001/other.webp");
    expect(await storage.exists(key)).toBe(false);
    await storage.delete("products/jeans/BLUE-JEANS-001/other.webp");
    expect(await storage.exists("products/jeans/BLUE-JEANS-001/other.webp")).toBe(false);
  });

  it("never returns a public URL for private areas", () => {
    expect(storage.getUrl("invoices/2026/ORD-2026-000001.pdf")).toBeNull();
  });

  it("rejects path traversal and unknown areas", async () => {
    for (const bad of ["../etc/passwd", "products/../../x", "/abs", "secret/x.txt", "products/.hidden", "products//x"]) {
      await expect(storage.upload({ key: bad, body: Buffer.from("x"), contentType: "text/plain", visibility: "public" })).rejects.toThrow();
    }
  });

  it("processes images into webp renditions", async () => {
    const png = await sharp({ create: { width: 2000, height: 1000, channels: 3, background: "#1d4ed8" } }).png().toBuffer();
    expect(sniffMime(png)).toBe("image/png");
    const img = await processAndStoreImage(storage, { folderKey: "products/jeans/SKU1", baseName: "main", input: png, visibility: "public" });
    expect(img.width).toBe(1600);
    expect(img.variants.thumb?.width).toBe(400);
    expect(await storage.exists("products/jeans/SKU1/main-thumb.webp")).toBe(true);
    await expect(
      processAndStoreImage(storage, { folderKey: "products/x", baseName: "main", input: Buffer.from("<svg/>"), visibility: "public" }),
    ).rejects.toThrow(/Unsupported/);
  });
});

describe("signed private URLs", () => {
  it("verifies signatures and expiry", () => {
    const url = new URL(signedPrivateUrl("s3cret", "https://shop.example.ug/api", "invoices/a.pdf", 60));
    const exp = url.searchParams.get("exp")!;
    const sig = url.searchParams.get("sig")!;
    expect(verifySignedKey("s3cret", "invoices/a.pdf", exp, sig)).toBe(true);
    expect(verifySignedKey("other", "invoices/a.pdf", exp, sig)).toBe(false);
    expect(verifySignedKey("s3cret", "invoices/b.pdf", exp, sig)).toBe(false);
    expect(verifySignedKey("s3cret", "invoices/a.pdf", 1, sig)).toBe(false);
  });
});
