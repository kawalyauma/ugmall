import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import type { Readable } from "node:stream";
import { assertValidKey, isPublicKey } from "./keys";
import { StorageError, type ObjectStat, type StorageProvider, type StoredObject, type UploadInput, type Visibility } from "./provider";

export interface LocalFilesystemOptions {
  /** Absolute storage root, e.g. /opt/shop/storage (mounted at /storage in containers). */
  root: string;
  /** Public base URL that Nginx serves the root from, e.g. https://shop.example.ug/media */
  publicBaseUrl: string;
}

/**
 * Stores files on the server's own disk. Writes are atomic (temp file +
 * rename) so Nginx never serves a half-written image.
 */
export class LocalFilesystemProvider implements StorageProvider {
  readonly name = "local";
  private root: string;
  private publicBaseUrl: string;

  constructor(opts: LocalFilesystemOptions) {
    this.root = path.resolve(opts.root);
    this.publicBaseUrl = opts.publicBaseUrl.replace(/\/+$/, "");
  }

  private abs(key: string): string {
    assertValidKey(key);
    const p = path.resolve(this.root, key);
    if (!p.startsWith(this.root + path.sep)) throw new StorageError("Path escapes storage root", "INVALID_KEY");
    return p;
  }

  async upload(input: UploadInput): Promise<StoredObject> {
    const target = this.abs(input.key);
    await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o755 });
    if (input.noOverwrite && (await this.exists(input.key))) {
      throw new StorageError(`Object already exists: ${input.key}`, "EXISTS");
    }
    const tmp = `${target}.${randomBytes(6).toString("hex")}.tmp`;
    await fs.writeFile(tmp, input.body, { mode: 0o644 });
    await fs.rename(tmp, target);
    return {
      key: input.key,
      size: input.body.length,
      contentType: input.contentType,
      url: this.getUrl(input.key, input.visibility),
    };
  }

  async delete(key: string): Promise<void> {
    await fs.rm(this.abs(key), { force: true });
    // tidy up empty parent folders (never the area root)
    let dir = path.dirname(this.abs(key));
    while (dir.startsWith(this.root + path.sep) && path.relative(this.root, dir).includes(path.sep)) {
      try {
        await fs.rmdir(dir);
      } catch {
        break;
      }
      dir = path.dirname(dir);
    }
  }

  async move(fromKey: string, toKey: string): Promise<void> {
    const from = this.abs(fromKey);
    const to = this.abs(toKey);
    await fs.mkdir(path.dirname(to), { recursive: true });
    try {
      await fs.rename(from, to);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "EXDEV") {
        await fs.copyFile(from, to);
        await fs.rm(from);
      } else if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        throw new StorageError(`Not found: ${fromKey}`, "NOT_FOUND");
      } else throw err;
    }
  }

  getUrl(key: string, visibility?: Visibility): string | null {
    assertValidKey(key);
    const vis = visibility ?? (isPublicKey(key) ? "public" : "private");
    if (vis !== "public") return null;
    return `${this.publicBaseUrl}/${key}`;
  }

  async exists(key: string): Promise<boolean> {
    try {
      await fs.access(this.abs(key));
      return true;
    } catch {
      return false;
    }
  }

  async stat(key: string): Promise<ObjectStat | null> {
    try {
      const s = await fs.stat(this.abs(key));
      return { size: s.size, modifiedAt: s.mtime };
    } catch {
      return null;
    }
  }

  async read(key: string): Promise<Readable> {
    const p = this.abs(key);
    await fs.access(p).catch(() => {
      throw new StorageError(`Not found: ${key}`, "NOT_FOUND");
    });
    return createReadStream(p);
  }

  async *list(prefix: string): AsyncIterable<{ key: string; modifiedAt: Date; size: number }> {
    const base = this.abs(prefix);
    const walk = async function* (dir: string, root: string): AsyncGenerator<{ key: string; modifiedAt: Date; size: number }> {
      let entries: import("node:fs").Dirent[];
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) yield* walk(full, root);
        else if (e.isFile()) {
          const s = await fs.stat(full);
          yield { key: path.relative(root, full).split(path.sep).join("/"), modifiedAt: s.mtime, size: s.size };
        }
      }
    };
    yield* walk(base, this.root);
  }

  /** Absolute path, used by the API to hand private files to Nginx via X-Accel-Redirect. */
  absolutePath(key: string): string {
    return this.abs(key);
  }
}
