import type { Redis } from "ioredis";

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetIn: number;
}

/** Fixed-window counter in Redis. Cheap and good enough for abuse protection. */
export async function rateLimit(redis: Redis, key: string, limit: number, windowSeconds: number): Promise<RateLimitResult> {
  const k = `rl:${key}`;
  const results = await redis.multi().incr(k).ttl(k).exec();
  const count = Number(results?.[0]?.[1] ?? 0);
  let ttl = Number(results?.[1]?.[1] ?? -1);
  if (ttl < 0) {
    await redis.expire(k, windowSeconds);
    ttl = windowSeconds;
  }
  return { allowed: count <= limit, remaining: Math.max(0, limit - count), resetIn: ttl };
}
