import type { Readable } from "node:stream";
import { assertValidKey, isPublicKey } from "./keys";
import { StorageError, type ObjectStat, type StorageProvider, type StoredObject, type UploadInput, type Visibility } from "./provider";

export interface S3CompatibleOptions {
  endpoint: string; // e.g. http://minio:9000 (self-hosted MinIO on the same server)
  region?: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  /** Public base URL for public objects, e.g. https://shop.example.ug/media (Nginx proxies to MinIO) */
  publicBaseUrl: string;
  forcePathStyle?: boolean;
}

/**
 * S3-compatible provider. Intended for a MinIO instance running on the
 * owner's own server (docker compose profile "minio"); also works with any
 * S3 API. The AWS SDK is loaded lazily so the local provider has no cost.
 */
export class S3CompatibleProvider implements StorageProvider {
  readonly name = "s3";
  private clientPromise: Promise<{ client: import("@aws-sdk/client-s3").S3Client; sdk: typeof import("@aws-sdk/client-s3") }>;

  constructor(private opts: S3CompatibleOptions) {
    this.clientPromise = import("@aws-sdk/client-s3").then((sdk) => ({
      sdk,
      client: new sdk.S3Client({
        endpoint: opts.endpoint,
        region: opts.region ?? "us-east-1",
        forcePathStyle: opts.forcePathStyle ?? true,
        credentials: { accessKeyId: opts.accessKeyId, secretAccessKey: opts.secretAccessKey },
      }),
    }));
  }

  async upload(input: UploadInput): Promise<StoredObject> {
    assertValidKey(input.key);
    const { client, sdk } = await this.clientPromise;
    if (input.noOverwrite && (await this.exists(input.key))) throw new StorageError("Object exists", "EXISTS");
    await client.send(
      new sdk.PutObjectCommand({
        Bucket: this.opts.bucket,
        Key: input.key,
        Body: input.body,
        ContentType: input.contentType,
        CacheControl: input.visibility === "public" ? "public, max-age=31536000, immutable" : "private, no-store",
      }),
    );
    return { key: input.key, size: input.body.length, contentType: input.contentType, url: this.getUrl(input.key, input.visibility) };
  }

  async delete(key: string): Promise<void> {
    assertValidKey(key);
    const { client, sdk } = await this.clientPromise;
    await client.send(new sdk.DeleteObjectCommand({ Bucket: this.opts.bucket, Key: key }));
  }

  async move(fromKey: string, toKey: string): Promise<void> {
    assertValidKey(fromKey);
    assertValidKey(toKey);
    const { client, sdk } = await this.clientPromise;
    await client.send(
      new sdk.CopyObjectCommand({ Bucket: this.opts.bucket, Key: toKey, CopySource: `${this.opts.bucket}/${fromKey}` }),
    );
    await this.delete(fromKey);
  }

  getUrl(key: string, visibility?: Visibility): string | null {
    assertValidKey(key);
    const vis = visibility ?? (isPublicKey(key) ? "public" : "private");
    return vis === "public" ? `${this.opts.publicBaseUrl.replace(/\/+$/, "")}/${key}` : null;
  }

  async stat(key: string): Promise<ObjectStat | null> {
    assertValidKey(key);
    const { client, sdk } = await this.clientPromise;
    try {
      const r = await client.send(new sdk.HeadObjectCommand({ Bucket: this.opts.bucket, Key: key }));
      return { size: Number(r.ContentLength ?? 0), modifiedAt: r.LastModified ?? new Date(0) };
    } catch {
      return null;
    }
  }

  async exists(key: string): Promise<boolean> {
    return (await this.stat(key)) !== null;
  }

  async read(key: string): Promise<Readable> {
    assertValidKey(key);
    const { client, sdk } = await this.clientPromise;
    const r = await client.send(new sdk.GetObjectCommand({ Bucket: this.opts.bucket, Key: key }));
    if (!r.Body) throw new StorageError(`Not found: ${key}`, "NOT_FOUND");
    return r.Body as Readable;
  }

  async *list(prefix: string): AsyncIterable<{ key: string; modifiedAt: Date; size: number }> {
    const { client, sdk } = await this.clientPromise;
    let token: string | undefined;
    do {
      const r = await client.send(
        new sdk.ListObjectsV2Command({ Bucket: this.opts.bucket, Prefix: prefix, ContinuationToken: token }),
      );
      for (const o of r.Contents ?? []) {
        if (o.Key) yield { key: o.Key, modifiedAt: o.LastModified ?? new Date(0), size: Number(o.Size ?? 0) };
      }
      token = r.IsTruncated ? r.NextContinuationToken : undefined;
    } while (token);
  }
}
