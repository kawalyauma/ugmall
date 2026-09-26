import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import type { Redis } from "ioredis";

const OTP_TTL = 5 * 60;
const MAX_ATTEMPTS = 5;
const RESEND_COOLDOWN = 60;

const hash = (code: string, phone: string) => createHash("sha256").update(`${phone}:${code}`).digest("hex");

export type OtpRequestResult = { ok: true; code: string; expiresIn: number } | { ok: false; retryAfter: number };

/** One-time codes for customer phone login, stored hashed in Redis. */
export class OtpService {
  constructor(private redis: Redis) {}

  async request(phone: string, purpose = "login"): Promise<OtpRequestResult> {
    const cooldownKey = `otp-cd:${purpose}:${phone}`;
    const ttl = await this.redis.ttl(cooldownKey);
    if (ttl > 0) return { ok: false, retryAfter: ttl };
    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    await this.redis
      .multi()
      .set(`otp:${purpose}:${phone}`, JSON.stringify({ h: hash(code, phone), a: 0 }), "EX", OTP_TTL)
      .set(cooldownKey, "1", "EX", RESEND_COOLDOWN)
      .exec();
    return { ok: true, code, expiresIn: OTP_TTL };
  }

  async verify(phone: string, code: string, purpose = "login"): Promise<boolean> {
    const key = `otp:${purpose}:${phone}`;
    const raw = await this.redis.get(key);
    if (!raw) return false;
    const rec = JSON.parse(raw) as { h: string; a: number };
    if (rec.a >= MAX_ATTEMPTS) {
      await this.redis.del(key);
      return false;
    }
    const a = Buffer.from(rec.h, "hex");
    const b = Buffer.from(hash(code.trim(), phone), "hex");
    if (a.length === b.length && timingSafeEqual(a, b)) {
      await this.redis.del(key);
      return true;
    }
    rec.a += 1;
    await this.redis.set(key, JSON.stringify(rec), "KEEPTTL");
    return false;
  }
}
