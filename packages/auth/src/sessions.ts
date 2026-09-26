import { createHash } from "node:crypto";
import type { Redis } from "ioredis";
import { randomToken } from "./password";

export type SessionKind = "staff" | "customer";

export interface SessionData {
  kind: SessionKind;
  subjectId: string;
  createdAt: number;
  ip?: string;
  userAgent?: string;
}

const TTL: Record<SessionKind, number> = {
  staff: 60 * 60 * 12, // 12h sliding
  customer: 60 * 60 * 24 * 60, // 60 days sliding
};

/** The token in the cookie is never stored; Redis keys use its SHA-256. */
const keyFor = (token: string) => `sess:${createHash("sha256").update(token).digest("hex")}`;
const indexKey = (kind: SessionKind, subjectId: string) => `sess-idx:${kind}:${subjectId}`;

export class SessionStore {
  constructor(private redis: Redis) {}

  async create(kind: SessionKind, subjectId: string, meta: { ip?: string; userAgent?: string } = {}): Promise<string> {
    const token = randomToken(32);
    const data: SessionData = { kind, subjectId, createdAt: Date.now(), ...meta };
    const key = keyFor(token);
    await this.redis
      .multi()
      .set(key, JSON.stringify(data), "EX", TTL[kind])
      .sadd(indexKey(kind, subjectId), key)
      .expire(indexKey(kind, subjectId), TTL[kind])
      .exec();
    return token;
  }

  async get(token: string | undefined, expectedKind?: SessionKind): Promise<SessionData | null> {
    if (!token || token.length > 200) return null;
    const key = keyFor(token);
    const raw = await this.redis.get(key);
    if (!raw) return null;
    const data = JSON.parse(raw) as SessionData;
    if (expectedKind && data.kind !== expectedKind) return null;
    await this.redis.expire(key, TTL[data.kind]); // sliding expiry
    return data;
  }

  async destroy(token: string | undefined) {
    if (!token) return;
    const key = keyFor(token);
    const raw = await this.redis.get(key);
    await this.redis.del(key);
    if (raw) {
      const data = JSON.parse(raw) as SessionData;
      await this.redis.srem(indexKey(data.kind, data.subjectId), key);
    }
  }

  /** Log a user out everywhere (e.g. when a staff member is deactivated). */
  async destroyAll(kind: SessionKind, subjectId: string) {
    const idx = indexKey(kind, subjectId);
    const keys = await this.redis.smembers(idx);
    if (keys.length) await this.redis.del(...keys);
    await this.redis.del(idx);
  }
}
