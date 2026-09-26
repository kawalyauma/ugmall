import { LocalFilesystemProvider } from "./local";
import type { StorageProvider } from "./provider";
import { S3CompatibleProvider } from "./s3";

export function createStorageFromEnv(env: NodeJS.ProcessEnv = process.env): StorageProvider {
  const driver = (env.STORAGE_DRIVER ?? "local").toLowerCase();
  const publicBaseUrl = env.MEDIA_PUBLIC_URL ?? "http://localhost:8080/media";
  if (driver === "local") {
    return new LocalFilesystemProvider({ root: env.STORAGE_ROOT ?? "./storage", publicBaseUrl });
  }
  if (driver === "minio" || driver === "s3") {
    const need = (k: string) => {
      const v = env[k];
      if (!v) throw new Error(`${k} is required for STORAGE_DRIVER=${driver}`);
      return v;
    };
    return new S3CompatibleProvider({
      endpoint: need("S3_ENDPOINT"),
      region: env.S3_REGION,
      accessKeyId: need("S3_ACCESS_KEY"),
      secretAccessKey: need("S3_SECRET_KEY"),
      bucket: need("S3_BUCKET"),
      publicBaseUrl,
    });
  }
  throw new Error(`Unknown STORAGE_DRIVER: ${driver}`);
}
