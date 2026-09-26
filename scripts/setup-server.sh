#!/usr/bin/env bash
# One-time preparation of a fresh Ubuntu 22.04/24.04 or Debian 12 server.
#   sudo ./scripts/setup-server.sh
set -euo pipefail
SHOP_ROOT="${SHOP_ROOT:-/opt/shop}"
[ "$(id -u)" -eq 0 ] || { echo "Run as root (sudo)"; exit 1; }

echo "==> Installing Docker, firewall and backup tools"
apt-get update
apt-get install -y ca-certificates curl gnupg ufw fail2ban rclone age unattended-upgrades
if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sh
fi
systemctl enable --now docker

echo "==> Firewall: only SSH, HTTP and HTTPS"
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
# Docker publishes ports around ufw; only nginx publishes ports in docker-compose.yml.

echo "==> Automatic security updates"
dpkg-reconfigure -f noninteractive unattended-upgrades

echo "==> Data directories under $SHOP_ROOT"
mkdir -p "$SHOP_ROOT"/{app,postgres,redis,backups,logs/nginx,certs,certbot,minio}
mkdir -p "$SHOP_ROOT"/storage/{products,categories,brands,reviews,customers,invoices,receipts,returns,temp}
# API/worker containers run as uid 1000 (node); nginx reads read-only.
chown -R 1000:1000 "$SHOP_ROOT/storage"
chmod 750 "$SHOP_ROOT/storage"/{customers,invoices,receipts,returns,temp}
chmod 700 "$SHOP_ROOT/backups" "$SHOP_ROOT/certs"

echo "==> Log rotation for nginx logs"
cat > /etc/logrotate.d/ugmall <<ROT
$SHOP_ROOT/logs/nginx/*.log {
  daily
  rotate 14
  compress
  missingok
  notifempty
  sharedscripts
  postrotate
    docker compose -f $SHOP_ROOT/app/docker-compose.yml exec -T nginx nginx -s reopen >/dev/null 2>&1 || true
  endscript
}
ROT

cat <<MSG

Server prepared.
Next steps:
  1. git clone <your repo> $SHOP_ROOT/app && cd $SHOP_ROOT/app
  2. cp .env.example .env && chmod 600 .env && nano .env
  3. Put TLS certificates in $SHOP_ROOT/certs (see README: Let's Encrypt or Cloudflare Origin CA)
  4. ./scripts/deploy.sh
  5. Install the backup cron: sudo cp scripts/cron.example /etc/cron.d/ugmall
MSG
