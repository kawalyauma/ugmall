import { auditLog, type Database } from "@ugmall/database";

export async function audit(db: Database, staffId: string | null, action: string, entityType?: string, entityId?: string, details?: unknown, ip?: string) {
  await db
    .insert(auditLog)
    .values({ staffId, action, entityType, entityId, details: details as object | undefined, ip })
    .catch(() => {});
}
