# UG Mall — self-hosted e-commerce for Uganda

A production-grade, mobile-first online shop built as a **modular monolith** and
designed to run entirely on **your own server**: database, cache, queues, product
images, invoices and receipts all live on your machine. No cloud object storage.

- **Storefront** (Next.js): categories, search, product variants (sizes/colours), cart, wishlist, reviews, offers, guest checkout, order tracking, **Order on WhatsApp**, analytics hooks, SEO sitemap/robots and Google/Meta product feeds
- **Payments**: **Ssentezo Wallet** (MTN Mobile Money + Airtel Money) and Cash on Delivery — behind a `PaymentProvider` interface. **Cash on Delivery is only allowed for orders up to UGX 150,000** (total incl. delivery; change in Admin → Settings, 0 = no limit), enforced by the server for web and staff-entered orders. There are **no pickup stations**: every order is delivered
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
│   ├── storage/   notifications/  reporting/  shared/  importer/
├── docker/                Dockerfiles + Nginx config
├── scripts/               setup-server, deploy, backup, restore, certificates
├── docs/
├── storage/  backups/     (local dev only — production uses /opt/shop)
└── docker-compose.yml
```

---

## Delivery areas & fees (no maps needed)

Customers choose **Region → District → Division/Sub-county → Village/Area → Cell** (or search "Ntinda",
"Kansanga", "Mbarara" to fill all of it in one tap), then type a **landmark**. If their exact place isn't
listed they type it under **Nearby place**.

- All of Uganda is included: 4 regions, 135 districts, 2,115 divisions/sub-counties, 10,359 parishes and
  71,037 villages ([kusaasira/uganda-geo-data](https://github.com/kusaasira/uganda-geo-data), MIT), loaded
  automatically by `seed-locations` on deploy.
- **Fees come from zones attached to areas**, inherited downwards: put a zone on a district for its default
  price, then override a division or village. E.g. *Kampala → 6,000*, *Nakawa › Ntinda → 7,000*,
  *regions → Upcountry (by weight, bus parcel/courier)*. The customer sees the fee as soon as they pick an area;
  if they stop at "Kampala" while parts of Kampala cost more, they're asked to choose the exact area.
- **Admin → Deliveries → Delivery areas & fees**: browse or search areas, see what a customer would pay and
  where it's inherited from, set/clear zones, add areas missing from the official list (popular neighbourhood
  names like Kitintale or Najjera are not official parishes), and review places customers typed.
- Orders, the rider app and invoices show the full area path, the typed nearby place and the landmark.

---

## Importing products (Jumia / Kilimall sheets or your own)

**Admin → Products → Import** (or `pnpm --filter @ugmall/api import-products -- file.xlsx --dry-run`).

- Accepts the seller-center *Upload Template* (`.xlsx`, including exports that other libraries fail to open) or a simple `.csv`/`.xlsx` (download the template on the import page).
- **Each row is a variation.** Rows sharing a `ParentSKU` become **one product**; `size` / `men_pant_size` become its size variants (`SellerSKU` = variant SKU). A colour axis is only added when colour differs between rows of the same product (otherwise "Black, Grey…" is kept as a product detail, e.g. for multi-packs).
- **Brands and categories are imported too**: `1039426 - Fashion` → brand *Fashion*; `1029598 - Fashion / Men's Fashion / Clothing / Pants / Trousers` → the full category tree (the shared "Fashion" root is dropped by default so the shop menu starts at Men's / Women's / Kid's). Jumia IDs are stored so later imports match the same records.
- **Safe to re-run**: products and variants are matched by SKU and updated, never duplicated. Stock can be *set* to the sheet (stock count), *added*, or left alone; every change is recorded in the inventory audit trail as "Import: <file>". Optionally hide sizes that are on the shop but not in the file.
- Always shows a **preview** (new vs updated products, new categories, row-level problems) before anything is written.
- Product images listed in the sheet are **downloaded to your server** by the worker (`storage/products/<category>/<SKU>/`), converted to WebP; failed downloads retry automatically. The server must be able to reach the image URLs.
- HTML descriptions are sanitised; extra columns (gender, material, pack contents, season…) appear as a *Details* table on the product page.

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
To try the PesaPal sandbox, set `PAYMENT_MOBILE_MONEY_PROVIDER=pesapal`,
`PESAPAL_ENV=sandbox`, your sandbox credentials and the registered `PESAPAL_IPN_ID`.

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
nano .env        # domains, passwords, APP_SECRET, PAYMENT_CALLBACK_SECRET, PesaPal, WhatsApp
./scripts/deploy.sh --seed     # builds images, runs migrations, starts everything, seeds roles/zones/owner
```
Subsequent updates: `git pull && ./scripts/deploy.sh` (takes a backup first).
Add more staff and riders in **Admin → Staff & roles**.

### 4. PesaPal
1. Create PesaPal API 3.0 credentials (sandbox first, then live).
2. Register `https://<SHOP_DOMAIN>/api/webhooks/payments/pesapal` as a POST IPN URL and copy its IPN ID.
3. Set `PAYMENT_MOBILE_MONEY_PROVIDER=pesapal`, `PESAPAL_CONSUMER_KEY`,
   `PESAPAL_CONSUMER_SECRET`, `PESAPAL_IPN_ID`, and `PESAPAL_ENV=live` in `.env`, then redeploy.
4. Customers are redirected to PesaPal to choose Mobile Money or card. IPNs and the worker both
   verify the authoritative transaction status before an order is marked paid.

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


## Product feeds and analytics

- Google Merchant Center scheduled feed: `https://<SHOP_DOMAIN>/api/store/feeds/google.xml`
- Meta Commerce Manager catalogue feed: `https://<SHOP_DOMAIN>/api/store/feeds/meta.csv`
- Set `NEXT_PUBLIC_GA_MEASUREMENT_ID` and/or `NEXT_PUBLIC_META_PIXEL_ID` in `.env`, then rebuild the storefront with `./scripts/deploy.sh`.
