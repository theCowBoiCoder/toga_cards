#!/usr/bin/env bash
set -euo pipefail
[[ $(id -u) -eq 0 ]] || { echo "Run with sudo." >&2; exit 1; }
source_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
test -s /etc/letsencrypt/live/togacards.co.uk/fullchain.pem
test -s /etc/letsencrypt/live/togacards.co.uk/privkey.pem
backup="/var/lib/toga-cards/nginx-before-https-$(date -u +%Y%m%dT%H%M%SZ).conf"
cp -p /etc/nginx/sites-available/togacards.co.uk "$backup"
install -m 0644 "$source_dir/nginx/togacards.https.conf" /etc/nginx/sites-available/togacards.co.uk
if ! nginx -t; then
  cp -p "$backup" /etc/nginx/sites-available/togacards.co.uk
  echo "Nginx validation failed; previous site configuration restored." >&2
  exit 1
fi
systemctl reload nginx
