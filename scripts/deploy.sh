#!/usr/bin/env bash
# Build and (re)start the whole stack. Safe to run for every update:
#   git pull && ./scripts/deploy.sh
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f .env ] || { echo ".env missing — copy .env.example"; exit 1; }
set -a; . ./.env; set +a
SHOP_ROOT="${SHOP_ROOT:-/opt/shop}"

if [ ! -f "$SHOP_ROOT/certs/fullchain.pem" ]; then
  echo "No TLS certificate found in $SHOP_ROOT/certs — creating a temporary self-signed one."
  ./scripts/self-signed-cert.sh "$SHOP_DOMAIN" "$ADMIN_DOMAIN"
fi

# Take a backup before changing anything (skipped on first deploy).
if docker compose ps --status running postgres 2>/dev/null | grep -q postgres; then
  ./scripts/backup.sh || echo "WARNING: pre-deploy backup failed"
fi

docker compose build --pull
docker compose up -d postgres redis
docker compose up -d api          # runs database migrations on start
docker compose up -d worker storefront admin nginx
docker compose ps

if [ "${1:-}" = "--seed" ]; then
  docker compose exec -T api node dist/seed.js
fi
echo "Deployed. Storefront: https://$SHOP_DOMAIN  Admin: https://$ADMIN_DOMAIN"
