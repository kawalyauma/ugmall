import { Redis } from "ioredis";

export function createRedis(url: string, opts: { forQueue?: boolean } = {}) {
  return new Redis(url, {
    // BullMQ requires maxRetriesPerRequest=null on its connections.
    maxRetriesPerRequest: opts.forQueue ? null : 3,
    enableReadyCheck: true,
    lazyConnect: false,
  });
}
