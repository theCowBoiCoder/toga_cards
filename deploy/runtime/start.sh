#!/bin/sh
set -eu
if [ "${1:-}" != "supervisord" ]; then exec "$@"; fi
: "${ADMIN_SERVICE_KEY:?Configure the private admin service key}"
: "${LARAVEL_APP_KEY:?Configure the persistent Laravel application key}"
export APP_KEY="$LARAVEL_APP_KEY"
export APP_URL="${APP_URL:-${SHOP_URL:-http://127.0.0.1:3000}}"
export APP_ENV=production APP_DEBUG=false
export LOG_CHANNEL=stderr LOG_LEVEL=warning
export ADMIN_DATABASE_PATH=/app/data/admin.sqlite
export SESSION_DRIVER=database CACHE_STORE=database QUEUE_CONNECTION=sync
export SESSION_COOKIE=toga_cards_admin_session
case "$APP_URL" in https://*) export SESSION_SECURE_COOKIE=true;; *) export SESSION_SECURE_COOKIE=false;; esac
mkdir -p /app/data/admin-public/cards /app/admin/storage/framework/cache/data /app/admin/storage/framework/sessions /app/admin/storage/framework/views /app/admin/storage/logs /app/admin/bootstrap/cache
if [ ! -e "$ADMIN_DATABASE_PATH" ]; then touch "$ADMIN_DATABASE_PATH"; chmod 600 "$ADMIN_DATABASE_PATH"; fi
cd /app/admin
php artisan migrate --force --no-interaction
php artisan toga:bootstrap-admin --no-interaction
php artisan view:cache --no-interaction
cd /app
exec "$@"
