import type { Readable } from "node:stream";

export type Visibility = "public" | "private";

export interface UploadInput {
  /** Storage key relative to the storage root, e.g. products/jeans/BLUE-JEANS-001/main.webp */
  key: string;
  body: Buffer;
  contentType: string;
  visibility: Visibility;
  /** Refuse to overwrite an existing object. Default false. */
  noOverwrite?: boolean;
}

export interface StoredObject {
  key: string;
  size: number;
  contentType: string;
  /** Public URL, or null for private objects (use a signed URL instead). */
  url: string | null;
}

export interface ObjectStat {
  size: number;
  modifiedAt: Date;
}

/**
 * Storage abstraction. Product, review, invoice etc. code only talks to this
 * interface, so the local filesystem can be swapped for MinIO/S3 without
 * touching business modules.
 */
export interface StorageProvider {
  readonly name: string;
  upload(input: UploadInput): Promise<StoredObject>;
  delete(key: string): Promise<void>;
  move(fromKey: string, toKey: string): Promise<void>;
  getUrl(key: string, visibility?: Visibility): string | null;
  exists(key: string): Promise<boolean>;
  read(key: string): Promise<Readable>;
  stat(key: string): Promise<ObjectStat | null>;
  /** List keys under a prefix (used by temp cleanup and integrity checks). */
  list(prefix: string): AsyncIterable<{ key: string; modifiedAt: Date; size: number }>;
}

export class StorageError extends Error {
  constructor(
    message: string,
    public code: "INVALID_KEY" | "NOT_FOUND" | "EXISTS" | "INVALID_FILE" | "TOO_LARGE",
  ) {
    super(message);
  }
}
