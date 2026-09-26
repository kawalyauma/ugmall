import { safeSegment, STORAGE_AREAS, type StorageArea, PUBLIC_STORAGE_AREAS } from "@ugmall/shared";
import { StorageError } from "./provider";

/**
 * Validates and normalises a storage key. Keys are always relative,
 * forward-slash separated, start with a known area, and may not contain
 * `..`, empty or hidden segments — so they can never escape the storage root.
 */
export function assertValidKey(key: string): string {
  if (typeof key !== "string" || key.length === 0 || key.length > 512) {
    throw new StorageError("Invalid storage key", "INVALID_KEY");
  }
  if (key.includes("\\") || key.includes("\0") || key.startsWith("/")) {
    throw new StorageError("Invalid storage key", "INVALID_KEY");
  }
  const segments = key.split("/");
  for (const s of segments) {
    if (!s || s === "." || s === ".." || s.startsWith(".") || !/^[A-Za-z0-9._-]+$/.test(s)) {
      throw new StorageError(`Invalid storage key segment: ${s}`, "INVALID_KEY");
    }
  }
  if (!(STORAGE_AREAS as readonly string[]).includes(segments[0]!)) {
    throw new StorageError(`Unknown storage area: ${segments[0]}`, "INVALID_KEY");
  }
  return key;
}

export function areaOf(key: string): StorageArea {
  return key.split("/")[0] as StorageArea;
}

export function isPublicKey(key: string): boolean {
  return PUBLIC_STORAGE_AREAS.includes(areaOf(key));
}

/** buildKey("products", ["jeans", "BLUE-JEANS-001"], "main.webp") */
export function buildKey(area: StorageArea, folders: string[], fileName: string): string {
  return assertValidKey([area, ...folders.map(safeSegment), safeSegment(fileName)].join("/"));
}
