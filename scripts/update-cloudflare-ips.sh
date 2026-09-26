#!/usr/bin/env bash
# Refresh docker/nginx/cloudflare-ips.conf from Cloudflare's published ranges.
set -euo pipefail
cd "$(dirname "$0")/.."
{
  echo "# https://www.cloudflare.com/ips/ — generated $(date -I)"
  for ip in $(curl -fsS https://www.cloudflare.com/ips-v4) $(curl -fsS https://www.cloudflare.com/ips-v6); do echo "set_real_ip_from $ip;"; done
  echo "real_ip_header CF-Connecting-IP;"
} > docker/nginx/cloudflare-ips.conf
docker compose exec -T nginx nginx -s reload || true
