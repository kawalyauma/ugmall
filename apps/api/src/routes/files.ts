import { Hono } from "hono";
import { stream } from "hono/streaming";
import { LocalFilesystemProvider, verifySignedKey, assertValidKey } from "@ugmall/storage";
import { ApiError } from "../lib/http";
import type { AppEnv } from "../types";

/**
 * Private files (invoices, receipts, customer documents, return photos).
 * Access requires a short-lived HMAC-signed URL issued by an authorised
 * endpoint. In production Nginx streams the bytes via X-Accel-Redirect from
 * an `internal` location, so Node only checks the signature.
 */
export const fileRoutes = new Hono<AppEnv>();

fileRoutes.get("/*", async (c) => {
  const { env, storage } = c.get("container");
  const key = decodeURIComponent(c.req.path.replace(/^.*?\/files\//, ""));
  try {
    assertValidKey(key);
  } catch {
    throw new ApiError(400, "Invalid file path");
  }
  if (!verifySignedKey(env.APP_SECRET, key, c.req.query("exp") ?? "", c.req.query("sig") ?? "")) throw new ApiError(403, "Link expired");
  c.header("Cache-Control", "private, no-store");
  c.header("Content-Disposition", `inline; filename="${key.split("/").pop()}"`);
  if (env.USE_X_ACCEL && storage instanceof LocalFilesystemProvider) {
    c.header("X-Accel-Redirect", `/_protected/${key}`);
    return c.body(null, 200);
  }
  const st = await storage.stat(key);
  if (!st) throw new ApiError(404, "File not found");
  const ext = key.split(".").pop()?.toLowerCase();
  c.header("Content-Type", ext === "pdf" ? "application/pdf" : ext === "webp" ? "image/webp" : ext === "png" ? "image/png" : ext === "jpg" || ext === "jpeg" ? "image/jpeg" : "application/octet-stream");
  c.header("Content-Length", String(st.size));
  const readable = await storage.read(key);
  return stream(c, async (s) => {
    for await (const chunk of readable) await s.write(chunk as Uint8Array);
  });
});
