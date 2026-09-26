import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Short-lived signed URLs for private files (invoices, receipts, customer
 * documents). The API verifies the signature and then asks Nginx to stream
 * the file with X-Accel-Redirect, so Node never pushes the bytes itself.
 */
export function signKey(secret: string, key: string, expiresAt: number): string {
  return createHmac("sha256", secret).update(`${key}:${expiresAt}`).digest("base64url");
}

export function signedPrivateUrl(secret: string, apiBase: string, key: string, ttlSeconds = 600): string {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const sig = signKey(secret, key, exp);
  return `${apiBase.replace(/\/+$/, "")}/files/${key}?exp=${exp}&sig=${sig}`;
}

export function verifySignedKey(secret: string, key: string, exp: string | number, sig: string): boolean {
  const e = Number(exp);
  if (!Number.isFinite(e) || e < Math.floor(Date.now() / 1000)) return false;
  const expected = Buffer.from(signKey(secret, key, e));
  const given = Buffer.from(sig);
  return expected.length === given.length && timingSafeEqual(expected, given);
}
