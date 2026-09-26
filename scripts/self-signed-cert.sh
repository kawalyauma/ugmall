#!/usr/bin/env bash
# Temporary certificate so Nginx can start before real certificates are issued.
set -euo pipefail
SHOP_ROOT="${SHOP_ROOT:-/opt/shop}"
mkdir -p "$SHOP_ROOT/certs"
openssl req -x509 -nodes -newkey rsa:2048 -days 30 \
  -keyout "$SHOP_ROOT/certs/privkey.pem" -out "$SHOP_ROOT/certs/fullchain.pem" \
  -subj "/CN=${1:-localhost}" -addext "subjectAltName=DNS:${1:-localhost},DNS:www.${1:-localhost},DNS:${2:-admin.localhost}"
echo "Self-signed certificate written to $SHOP_ROOT/certs"
