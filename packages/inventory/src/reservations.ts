import { randomBytes } from "node:crypto";
import type { Redis } from "ioredis";

/**
 * Short-lived checkout holds in Redis.
 *
 * Per variant:
 *   reserve:variant:{variantId}  ZSET  member=reservationId score=expiresAtMs
 *   reserve:qty:{variantId}      HASH  reservationId -> quantity
 * Per reservation:
 *   reservation:{reservationId}  JSON  { items, expiresAt }   (TTL)
 *
 * A Lua script purges expired holds, sums the live ones and adds the new hold
 * only if every line fits — atomically, so two customers can't both grab the
 * last pair of size-34 jeans. Expired holds simply stop counting; there is
 * nothing to "release" when a customer abandons checkout.
 */

const RESERVE_LUA = `
local now = tonumber(ARGV[1])
local expiresAt = tonumber(ARGV[2])
local rid = ARGV[3]
local n = #KEYS / 2
local short = {}
-- pass 1: purge + check
for i = 1, n do
  local z = KEYS[i * 2 - 1]
  local h = KEYS[i * 2]
  local expired = redis.call('ZRANGEBYSCORE', z, '-inf', now)
  for _, m in ipairs(expired) do redis.call('HDEL', h, m) end
  redis.call('ZREMRANGEBYSCORE', z, '-inf', now)
  local held = 0
  local all = redis.call('HGETALL', h)
  for j = 1, #all, 2 do
    if all[j] ~= rid then held = held + tonumber(all[j + 1]) end
  end
  local want = tonumber(ARGV[3 + i * 2 - 1])
  local avail = tonumber(ARGV[3 + i * 2])
  if held + want > avail then
    table.insert(short, i)
    table.insert(short, avail - held)
  end
end
if #short > 0 then return short end
-- pass 2: commit
for i = 1, n do
  local z = KEYS[i * 2 - 1]
  local h = KEYS[i * 2]
  local want = tonumber(ARGV[3 + i * 2 - 1])
  redis.call('ZADD', z, expiresAt, rid)
  redis.call('HSET', h, rid, want)
  redis.call('PEXPIREAT', z, expiresAt + 60000)
  redis.call('PEXPIREAT', h, expiresAt + 60000)
end
return {}
`;

const HELD_LUA = `
local now = tonumber(ARGV[1])
local out = {}
for i = 1, #KEYS / 2 do
  local z = KEYS[i * 2 - 1]
  local h = KEYS[i * 2]
  local expired = redis.call('ZRANGEBYSCORE', z, '-inf', now)
  for _, m in ipairs(expired) do redis.call('HDEL', h, m) end
  redis.call('ZREMRANGEBYSCORE', z, '-inf', now)
  local held = 0
  local all = redis.call('HGETALL', h)
  for j = 1, #all, 2 do
    if all[j] ~= ARGV[2] then held = held + tonumber(all[j + 1]) end
  end
  table.insert(out, held)
end
return out
`;

export interface ReservationLine {
  variantId: string;
  quantity: number;
}

export interface Reservation {
  id: string;
  items: ReservationLine[];
  expiresAt: number;
}

export type ReserveResult =
  | { ok: true; reservation: Reservation }
  | { ok: false; shortages: { variantId: string; requested: number; available: number }[] };

const zkey = (v: string) => `reserve:variant:${v}`;
const hkey = (v: string) => `reserve:qty:${v}`;
const rkey = (id: string) => `reservation:${id}`;

export class StockReservations {
  constructor(
    private redis: Redis,
    /** Returns DB availability (on_hand - reserved) per variant. */
    private dbAvailable: (variantIds: string[]) => Promise<Map<string, number>>,
    private ttlSeconds = Number(process.env.CHECKOUT_RESERVATION_MINUTES ?? 10) * 60,
  ) {}

  private merge(lines: ReservationLine[]): ReservationLine[] {
    const m = new Map<string, number>();
    for (const l of lines) m.set(l.variantId, (m.get(l.variantId) ?? 0) + l.quantity);
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([variantId, quantity]) => ({ variantId, quantity }));
  }

  /** Create or refresh a hold. Passing an existing id replaces that hold's quantities. */
  async reserve(lines: ReservationLine[], existingId?: string): Promise<ReserveResult> {
    const items = this.merge(lines);
    const id = existingId && /^[A-Za-z0-9_-]{16,64}$/.test(existingId) ? existingId : randomBytes(16).toString("base64url");
    const avail = await this.dbAvailable(items.map((i) => i.variantId));
    const now = Date.now();
    const expiresAt = now + this.ttlSeconds * 1000;

    // Drop lines that are no longer in this reservation.
    if (existingId) {
      const prev = await this.get(existingId);
      for (const p of prev?.items ?? []) {
        if (!items.some((i) => i.variantId === p.variantId)) {
          await this.redis.multi().zrem(zkey(p.variantId), id).hdel(hkey(p.variantId), id).exec();
        }
      }
    }

    const keys = items.flatMap((i) => [zkey(i.variantId), hkey(i.variantId)]);
    const args = [now, expiresAt, id, ...items.flatMap((i) => [i.quantity, avail.get(i.variantId) ?? 0])];
    const res = (await this.redis.eval(RESERVE_LUA, keys.length, ...keys, ...args)) as number[];
    if (res.length) {
      const shortages = [];
      for (let k = 0; k < res.length; k += 2) {
        const item = items[res[k]! - 1]!;
        shortages.push({ variantId: item.variantId, requested: item.quantity, available: Math.max(0, res[k + 1]!) });
      }
      return { ok: false, shortages };
    }
    const reservation: Reservation = { id, items, expiresAt };
    await this.redis.set(rkey(id), JSON.stringify(reservation), "PX", this.ttlSeconds * 1000);
    return { ok: true, reservation };
  }

  async get(id: string): Promise<Reservation | null> {
    const raw = await this.redis.get(rkey(id));
    if (!raw) return null;
    const r = JSON.parse(raw) as Reservation;
    return r.expiresAt > Date.now() ? r : null;
  }

  /** Drop a hold (after the order has taken a durable DB reservation, or on cancel). */
  async release(id: string): Promise<void> {
    const r = await this.redis.get(rkey(id));
    const items: ReservationLine[] = r ? (JSON.parse(r) as Reservation).items : [];
    const m = this.redis.multi();
    for (const i of items) m.zrem(zkey(i.variantId), id).hdel(hkey(i.variantId), id);
    m.del(rkey(id));
    await m.exec();
  }

  /** Quantities currently held by live checkouts (optionally ignoring one reservation). */
  async held(variantIds: string[], excludeReservationId = ""): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    if (!variantIds.length) return out;
    const keys = variantIds.flatMap((v) => [zkey(v), hkey(v)]);
    const res = (await this.redis.eval(HELD_LUA, keys.length, ...keys, Date.now(), excludeReservationId)) as number[];
    variantIds.forEach((v, i) => out.set(v, Number(res[i] ?? 0)));
    return out;
  }

  /** What a shopper can actually add to cart right now. */
  async available(variantIds: string[], excludeReservationId?: string): Promise<Map<string, number>> {
    const [db, held] = await Promise.all([this.dbAvailable(variantIds), this.held(variantIds, excludeReservationId)]);
    const out = new Map<string, number>();
    for (const v of variantIds) out.set(v, Math.max(0, (db.get(v) ?? 0) - (held.get(v) ?? 0)));
    return out;
  }
}
