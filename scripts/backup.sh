#!/usr/bin/env bash
# Backs up everything needed to rebuild the shop on a new machine:
#   - PostgreSQL (pg_dump custom format)
#   - uploaded files (${SHOP_ROOT}/storage), incremental hard-link snapshots
#   - configuration (.env, docker-compose.yml, nginx config, certificates)
# Keeps BACKUP_KEEP_DAYS locally (put ${SHOP_ROOT}/backups on a SECOND disk),
# and optionally pushes an encrypted copy off-site with rclone.
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; . ./.env; set +a
SHOP_ROOT="${SHOP_ROOT:-/opt/shop}"
DEST="${BACKUP_DIR:-$SHOP_ROOT/backups}"
KEEP="${BACKUP_KEEP_DAYS:-14}"
STAMP="$(date +%Y-%m-%d_%H%M)"
OUT="$DEST/$STAMP"
mkdir -p "$OUT"
log() { echo "[$(date +%T)] $*"; }

log "Dumping PostgreSQL"
docker compose exec -T postgres pg_dump -U "${POSTGRES_USER:-shop}" -d "${POSTGRES_DB:-shop}" -Fc --no-owner > "$OUT/database.dump"
[ -s "$OUT/database.dump" ] || { echo "Database dump is empty!"; exit 1; }

log "Snapshotting uploaded files"
LAST="$(ls -1d "$DEST"/*/storage 2>/dev/null | grep -v "$STAMP" | tail -1 || true)"
if ! command -v rsync >/dev/null; then
  echo "rsync not installed — doing a full copy (apt install rsync for incremental snapshots)"
  cp -a "$SHOP_ROOT/storage" "$OUT/storage"
elif [ -n "$LAST" ]; then
  rsync -a --delete --link-dest="$LAST" "$SHOP_ROOT/storage/" "$OUT/storage/"
else
  rsync -a "$SHOP_ROOT/storage/" "$OUT/storage/"
fi

log "Saving configuration"
tar -czf "$OUT/config.tar.gz" .env docker-compose.yml docker "$SHOP_ROOT/certs" 2>/dev/null || tar -czf "$OUT/config.tar.gz" .env docker-compose.yml docker
chmod 600 "$OUT/config.tar.gz"

( cd "$OUT" && sha256sum database.dump config.tar.gz > SHA256SUMS )
du -sh "$OUT" | awk '{print "Backup size: "$1}'

if [ -n "${BACKUP_RCLONE_REMOTE:-}" ]; then
  log "Uploading encrypted archive to $BACKUP_RCLONE_REMOTE"
  [ -n "${BACKUP_PASSPHRASE:-}" ] || { echo "Set BACKUP_PASSPHRASE to encrypt off-site backups"; exit 1; }
  ARCHIVE="/tmp/shop-$STAMP.tar.gz.gpg"
  tar -C "$DEST" -cz "$STAMP" | gpg --batch --yes --pinentry-mode loopback --passphrase "$BACKUP_PASSPHRASE" --symmetric --cipher-algo AES256 -o "$ARCHIVE"
  rclone copy "$ARCHIVE" "$BACKUP_RCLONE_REMOTE/" --transfers 2
  rm -f "$ARCHIVE"
  rclone delete "$BACKUP_RCLONE_REMOTE/" --min-age "$((KEEP * 2))d" || true
fi

log "Removing local backups older than $KEEP days"
find "$DEST" -mindepth 1 -maxdepth 1 -type d -mtime +"$KEEP" -exec rm -rf {} +
log "Backup complete: $OUT"
