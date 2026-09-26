# Architecture

UG Mall is a **modular monolith**: one API process (plus a worker process from the
same code) with clear module boundaries in `packages/*`. Everything runs on the
owner's own server with Docker; there is no dependency on cloud object storage.

```
                   INTERNET
                       │
                  CLOUDFLARE (optional DNS/proxy, never R2)
                       │
                 YOUR PUBLIC IP / tunnel
                       │
                     NGINX  ── /media/*  → /opt/shop/storage (served from disk)
                       │
         ┌─────────────┼──────────────┐
     STOREFRONT      ADMIN           API (Hono)  ── WORKER (BullMQ jobs)
      Next.js       Next.js            │
                          ┌────────────┼─────────────┐
                      PostgreSQL     Redis        /opt/shop/storage
```

## Modules

| Package | Responsibility |
|---|---|
| `packages/shared` | Browser-safe types, enums, order state machine, money/phone helpers, zod schemas, WhatsApp message builder |
| `packages/database` | Drizzle schema, SQL migrations, DB client |
| `packages/auth` | scrypt password hashing, Redis sessions, phone OTP, rate limiting |
| `packages/storage` | `StorageProvider` interface, `LocalFilesystemProvider`, `S3CompatibleProvider` (MinIO), image processing, signed private links |
| `packages/payments` | `PaymentProvider` interface, **Ssentezo Wallet**, Cash on Delivery, Pay on Pickup, dev fake provider, registry |
| `packages/inventory` | Variant-level stock ledger with audit trail, Redis checkout reservations |
| `packages/orders` | Pricing, coupons, order placement, lifecycle transitions, payments application, riders, refunds, returns |
| `packages/delivery` | Delivery fee calculation, Uganda area tree (region › district › division › parish › village), zone resolution by nearest area with a zone, bundled area data |
| `packages/notifications` | WhatsApp Cloud API provider, message templates, notification log |
| `packages/reporting` | Report queries, dashboard, CSV/XLSX/PDF export, invoices |
| `packages/importer` | Spreadsheet reader (xlsx/csv), Jumia seller-center mapping (variation rows → products + variants, brands, category tree), idempotent apply |
| `apps/api` | HTTP layer (Hono), auth middleware, queues, worker, scripts |
| `apps/storefront` | Customer site (Next.js, mobile-first) |
| `apps/admin` | Back office + rider app (Next.js) |

Business modules only depend on interfaces (`StorageProvider`, `PaymentProvider`,
`WhatsAppProvider`), so replacing a provider never touches products or orders code.

## Money
All amounts are integer UGX. Reports aggregate with `bigint`.

## Stock model
Per variant (`inventory_levels`):

- `on_hand` – physically in the shop
- `reserved` – committed to placed, unfulfilled orders (durable, in PostgreSQL)
- Redis checkout holds – short-lived (default 10 min) holds while a customer fills the checkout form
- **available = on_hand − reserved − checkout holds**

Flow:

1. Checkout opens → `POST /store/checkout/reserve` → Lua script atomically checks and holds stock in Redis (`reserve:variant:{id}`).
2. Order placed → in one DB transaction, the hold becomes `reserved` via a conditional `UPDATE` (cannot go negative, cannot oversell), then the Redis hold is dropped.
3. Mobile Money paid → `reserve → sale` (on_hand and reserved both decrease).
   COD / pickup → the sale is recorded when the order is delivered.
4. Unpaid after `PAYMENT_TIMEOUT_MINUTES`, or cancelled → `release`.
5. Returns → `return` (+ `damaged` write-off for unsellable items).

Every change writes an `inventory_movements` row with the resulting levels, the
reference (order / purchase / return / manual) and the staff member.

## Order lifecycle
`pending → awaiting_payment → paid → confirmed → processing → ready_for_dispatch → assigned_to_rider → out_for_delivery → delivered`, plus `cancelled`, `returned`, `refunded`.
Allowed transitions live in `packages/shared/src/order-status.ts`; every change is written to `order_status_history`.

## Payments (Ssentezo Wallet)
- `deposit` collects from the customer's MTN/Airtel number (a PIN prompt on their phone).
- Callback URLs carry our own HMAC (Ssentezo does not sign callbacks). The API never trusts the callback body: it calls `get_status/{reference}` and applies the verified result idempotently (row lock on the payment).
- The worker also polls pending payments (15s → 5min back-off) in case callbacks cannot reach the server.
- Refunds use `withdraw` to the customer's number.

To add Flutterwave, Pesapal, or MTN/Airtel direct APIs: implement `PaymentProvider`
in `packages/payments/src/<name>.ts` and register it in `registry.ts`.

## Storage
```
/opt/shop/storage/
├── products/<category>/<SKU>/main-xxxxxx.webp  (+ -medium, -thumb)
├── categories/  brands/  reviews/              ← public, served by Nginx at /media
├── customers/  invoices/  receipts/  returns/  ← private, signed links + X-Accel-Redirect
└── temp/                                        ← cleaned every 6 hours
```
Images are re-encoded to WebP (EXIF/GPS stripped) in three renditions. Database rows
in `media_files` hold only metadata (`file_name, mime_type, file_size, storage_path,
public_url, uploaded_by, created_at, ...`).

Switching to MinIO on the same server: `STORAGE_DRIVER=minio` and start the
`minio` compose profile; copy existing files with `mc mirror`.
