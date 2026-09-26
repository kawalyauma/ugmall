#!/usr/bin/env bash
# Issue/renew a Let's Encrypt certificate for both domains using the webroot
# served by Nginx at /.well-known/acme-challenge. Requires ports 80/443 open
# (or use a Cloudflare Origin CA certificate instead — see README).
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; . ./.env; set +a
SHOP_ROOT="${SHOP_ROOT:-/opt/shop}"
docker run --rm \
  -v "$SHOP_ROOT/certbot:/var/www/certbot" -v "$SHOP_ROOT/letsencrypt:/etc/letsencrypt" \
  certbot/certbot certonly --webroot -w /var/www/certbot --non-interactive --agree-tos \
  -m "${SEED_ADMIN_EMAIL}" -d "$SHOP_DOMAIN" -d "www.$SHOP_DOMAIN" -d "$ADMIN_DOMAIN" --keep-until-expiring
cp -L "$SHOP_ROOT/letsencrypt/live/$SHOP_DOMAIN/fullchain.pem" "$SHOP_ROOT/certs/fullchain.pem"
cp -L "$SHOP_ROOT/letsencrypt/live/$SHOP_DOMAIN/privkey.pem" "$SHOP_ROOT/certs/privkey.pem"
docker compose exec -T nginx nginx -s reload
