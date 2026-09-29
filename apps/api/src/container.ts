import { createDb, type Database } from "@ugmall/database";
import { OtpService, SessionStore } from "@ugmall/auth";
import { StockReservations, dbAvailability } from "@ugmall/inventory";
import { OrderService } from "@ugmall/orders";
import { createPaymentRegistryFromEnv, type PaymentRegistry } from "@ugmall/payments";
import { RecommendationService } from "@ugmall/recommendations";
import { createStorageFromEnv, type StorageProvider } from "@ugmall/storage";
import type { Redis } from "ioredis";
import { loadEnv, type Env } from "./env";
import { createRedis } from "./lib/redis";
import { createOrderEffects, createQueues, type Queues } from "./queues";

export interface Container {
  env: Env;
  db: Database;
  closeDb: () => Promise<void>;
  redis: Redis;
  queueRedis: Redis;
  storage: StorageProvider;
  payments: PaymentRegistry;
  reservations: StockReservations;
  sessions: SessionStore;
  otp: OtpService;
  queues: Queues;
  orders: OrderService;
  recommendations: RecommendationService;
}

export function createContainer(env: Env = loadEnv()): Container {
  const { db, client } = createDb(env.DATABASE_URL, { max: Number(process.env.DB_POOL_SIZE ?? 10) });
  const redis = createRedis(env.REDIS_URL);
  const queueRedis = createRedis(env.REDIS_URL, { forQueue: true });
  const storage = createStorageFromEnv({ ...process.env, STORAGE_DRIVER: env.STORAGE_DRIVER, STORAGE_ROOT: env.STORAGE_ROOT, MEDIA_PUBLIC_URL: env.MEDIA_PUBLIC_URL });
  const payments = createPaymentRegistryFromEnv({ ...process.env, NODE_ENV: env.NODE_ENV, PAYMENT_CALLBACK_SECRET: env.PAYMENT_CALLBACK_SECRET });
  const reservations = new StockReservations(redis, (ids) => dbAvailability(db, ids), env.CHECKOUT_RESERVATION_MINUTES * 60);
  const queues = createQueues(queueRedis);
  const orders = new OrderService(db, reservations, payments, createOrderEffects(db, queues, { shopName: env.SHOP_NAME, storefrontUrl: env.STOREFRONT_URL }), {
    paymentTimeoutMinutes: env.PAYMENT_TIMEOUT_MINUTES,
    apiPublicUrl: env.API_PUBLIC_URL,
    storefrontUrl: env.STOREFRONT_URL,
  });
  return {
    env,
    db,
    closeDb: () => client.end({ timeout: 5 }),
    redis,
    queueRedis,
    storage,
    payments,
    reservations,
    sessions: new SessionStore(redis),
    otp: new OtpService(redis),
    queues,
    orders,
    recommendations: new RecommendationService(db, redis),
  };
}
