#!/usr/bin/env bash
# Restore a backup made by backup.sh.
#   ./scripts/restore.sh /opt/shop/backups/2026-09-26_0200
# Decrypt an off-site copy first:
#   gpg -d shop-2026-09-26_0200.tar.gz.gpg | tar -xz -C /opt/shop/backups
set -euo pipefail
cd "$(dirname "$0")/.."
SRC="${1:?usage: restore.sh <backup-folder>}"
set -a; . ./.env; set +a
SHOP_ROOT="${SHOP_ROOT:-/opt/shop}"
( cd "$SRC" && sha256sum -c SHA256SUMS )
read -r -p "This REPLACES the current database and files with $SRC. Type RESTORE to continue: " ok
[ "$ok" = "RESTORE" ] || exit 1

docker compose stop api worker storefront admin
docker compose up -d postgres
sleep 5
docker compose exec -T postgres dropdb -U "${POSTGRES_USER:-shop}" --if-exists "${POSTGRES_DB:-shop}"
docker compose exec -T postgres createdb -U "${POSTGRES_USER:-shop}" "${POSTGRES_DB:-shop}"
docker compose exec -T postgres pg_restore -U "${POSTGRES_USER:-shop}" -d "${POSTGRES_DB:-shop}" --no-owner < "$SRC/database.dump"
rsync -a --delete "$SRC/storage/" "$SHOP_ROOT/storage/"
chown -R 1000:1000 "$SHOP_ROOT/storage"
docker compose up -d
echo "Restore complete."
