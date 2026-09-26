# UG Mall — self-hosted e-commerce for Uganda

A production-grade, mobile-first online shop built as a **modular monolith** and
designed to run entirely on **your own server**: database, cache, queues, product
images, invoices and receipts all live on your machine. No cloud object storage.

- **Storefront** (Next.js): categories, search, product variants (sizes/colours), cart, wishlist, reviews, offers, guest checkout, order tracking, **Order on WhatsApp**
- **Payments**: **Ssentezo Wallet** (MTN Mobile Money + Airtel Money), Cash on Delivery, Pay on Pickup — behind a `PaymentProvider` interface
- **Admin** (Next.js): dashboard, products, variants, photos, categories, brands, inventory with audit trail, orders, payments, refunds, deliveries, riders & COD cash, returns, customers, reviews, suppliers & purchases, promotions & coupons, reports (PDF / Excel / CSV / print), expenses, staff, roles & permissions, settings
- **Rider app** (in the admin, mobile): assigned deliveries, call / WhatsApp / navigate, cash to collect, delivery confirmation
- **WhatsApp Business** notifications: order received, payment confirmed, order confirmed, rider dispatched, delivered, cancelled
- **API**: Hono + Node.js, PostgreSQL, Redis (sessions, carts, rate limits, OTPs, queues, stock reservations), BullMQ worker
- **Deploy**: Docker Compose + Nginx on Ubuntu/Debian, optional Cloudflare DNS/proxy, scripted backups (local + encrypted off-site)

See [docs/architecture.md](docs/architecture.md) for module boundaries, the stock
model, order lifecycle and payment flow.

```
ugmall/
├── apps/
│   ├── storefront/        Next.js customer site          :3000
│   ├── admin/             Next.js back office + /rider   :3001
│   └── api/               Hono API (+ worker, seed, scripts)  :4000
├── packages/
│   ├── database/  auth/  inventory/  orders/  payments/  delivery/
│   ├── storage/   notifications/  reporting/  shared/
├── docker/                Dockerfiles + Nginx config
├── scripts/               setup-server, deploy, backup, restore, certificates
├── docs/
├── storage/  backups/     (local dev only — production uses /opt/shop)
└── docker-compose.yml
```

---

## Local development

Requirements: Node 22+, pnpm 10, PostgreSQL 16, Redis 7 (or run just those two with Docker:
`docker compose up -d postgres redis` after filling `POSTGRES_PASSWORD`/`REDIS_PASSWORD` and
exposing ports, or use local installs).

```bash
pnpm install
cp .env.development.example .env        # uses the simulated Mobile Money provider
pnpm db:migrate
pnpm --filter @ugmall/api seed          # roles, zones, sample products, admin@shop.local / ChangeMe123!
pnpm dev:api        # http://localhost:4000
pnpm dev:worker     # background jobs (notifications, payment polling, expiry)
pnpm dev:storefront # http://localhost:3000
pnpm dev:admin      # http://localhost:3001   (rider app at /rider, rider@shop.local / RiderPass123!)
pnpm test           # unit tests
pnpm typecheck
```

In development WhatsApp messages are printed by the worker, OTP codes are returned
by the API, and the fake Mobile Money provider approves payments after a few seconds.
To try the real Ssentezo sandbox, set `PAYMENT_MOBILE_MONEY_PROVIDER=ssentezo`,
`SSENTEZO_ENV=sandbox` and your sandbox credentials.

After changing `packages/database/src/schema.ts`, generate a migration with
`pnpm db:generate` and commit the SQL in `packages/database/migrations`.

---

## Production deployment (your own server)

### 1. Server
A small VPS or a local machine: 2+ CPU cores, 4 GB RAM, SSD, **a second disk for backups**,
Ubuntu 22.04/24.04 or Debian 12.

```bash
git clone <this repo> /opt/shop/app && cd /opt/shop/app
sudo ./scripts/setup-server.sh     # Docker, ufw (22/80/443 only), fail2ban, /opt/shop/* folders
```

Resulting layout:
```
/opt/shop/
├── app/          this repository + .env
├── postgres/     database files
├── redis/        AOF persistence
├── storage/      products/ categories/ brands/ reviews/ customers/ invoices/ receipts/ returns/ temp/
├── backups/      nightly backups (mount your second disk here)
├── certs/        fullchain.pem + privkey.pem
└── logs/
```

### 2. Network / domain
Point `shop.example.ug` and `admin.shop.example.ug` to the server:

- **Static public IP**: DNS A records → your IP; forward ports 80/443 on the router to the server.
- **No static IP / CGNAT** (common with Ugandan ISPs): use a **Cloudflare Tunnel** (`cloudflared`)
  pointing at `https://localhost:443`, or a small VPS reverse proxy with WireGuard to your machine.
- With Cloudflare proxy on, use SSL mode **Full (strict)** and a Cloudflare **Origin CA certificate**
  saved as `/opt/shop/certs/fullchain.pem` + `privkey.pem`. Nginx already restores real client IPs
  from `CF-Connecting-IP`. (Cloudflare R2 is **not** used.)
- Without Cloudflare: `./scripts/issue-letsencrypt.sh` (after the first deploy, which starts Nginx
  with a temporary self-signed certificate).

### 3. Configure and start
```bash
cp .env.example .env && chmod 600 .env
nano .env        # domains, passwords, APP_SECRET, PAYMENT_CALLBACK_SECRET, Ssentezo, WhatsApp
./scripts/deploy.sh --seed     # builds images, runs migrations, starts everything, seeds roles/zones/owner
```
Subsequent updates: `git pull && ./scripts/deploy.sh` (takes a backup first).
Add more staff and riders in **Admin → Staff & roles**.

### 4. Ssentezo Wallet
1. Create API credentials in your Ssentezo Wallet dashboard (sandbox first, then live).
2. Set `SSENTEZO_USERNAME`, `SSENTEZO_PASSWORD`, `SSENTEZO_ENV=live` in `.env`, redeploy.
3. Callbacks are sent to `https://<SHOP_DOMAIN>/api/webhooks/payments/ssentezo?...` automatically
   (signed per payment). Even if a callback is lost, the worker polls the payment status.
4. Check the wallet balance in **Admin → Settings → Payment providers**.

### 5. WhatsApp Business
Set `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_APP_SECRET`,
`WHATSAPP_VERIFY_TOKEN`, create the templates in [docs/whatsapp-templates.md](docs/whatsapp-templates.md)
and register the webhook `https://<SHOP_DOMAIN>/api/webhooks/whatsapp`. Set the shop's WhatsApp
number (for the *Order on WhatsApp* buttons) in **Admin → Settings**.

### 6. Backups — do not skip this
```bash
sudo cp scripts/cron.example /etc/cron.d/ugmall   # nightly 02:15 + midday DB dump
./scripts/backup.sh                                # run once now and check /opt/shop/backups
```
Each backup contains a PostgreSQL dump, a hard-linked snapshot of all uploaded files and the
configuration (.env, compose, Nginx, certificates). Keep `/opt/shop/backups` on a **separate disk**,
and set `BACKUP_RCLONE_REMOTE` + `BACKUP_PASSPHRASE` to push a **GPG-encrypted** copy off-site
(another server over SFTP, Backblaze B2, Google Drive…).

Restore on a new machine: set up the server, copy the backup folder, then
`./scripts/restore.sh /opt/shop/backups/<date>`. **Test a restore regularly.**

### 7. Optional: MinIO instead of plain folders
`docker compose --profile minio up -d minio`, create bucket `shop`, set `STORAGE_DRIVER=minio`
and the `S3_*` variables, then configure Nginx `/media` to proxy to MinIO. Files still stay on
your server; the application code does not change (`StorageProvider` abstraction).

---

## Security notes
- Staff passwords: scrypt; sessions: random tokens stored hashed in Redis (12h sliding), cookies `HttpOnly; Secure; SameSite=Lax`.
- CSRF: every state-changing API call requires the `X-Requested-With: ugmall` header (forces a CORS preflight that foreign origins fail).
- Role-based permissions on every admin endpoint; audit log of staff actions and stock changes.
- Rate limits in Nginx and Redis (login, OTP, checkout, payment retries); login lock-out after repeated failures.
- Uploads: type detected from file bytes (not the name), re-encoded to WebP, EXIF/GPS removed, size-limited. Private areas are never served publicly.
- Payment callbacks are HMAC-signed and always re-verified with the provider before an order is marked paid; amounts are checked.
- The API refuses to start in production with default secrets; the fake payment provider cannot run in production.

## License
Private — all rights reserved.
