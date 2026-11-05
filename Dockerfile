FROM php:8.4-fpm-bookworm AS php-base
RUN apt-get update && apt-get install -y --no-install-recommends libicu-dev libonig-dev libsqlite3-dev libzip-dev git unzip nginx supervisor curl && docker-php-ext-install intl mbstring pdo_sqlite bcmath zip && rm -rf /var/lib/apt/lists/*

FROM php-base AS admin-test
COPY --from=composer:2 /usr/bin/composer /usr/local/bin/composer
WORKDIR /app/admin
COPY admin/composer.json admin/composer.lock ./
RUN composer install --prefer-dist --no-interaction --no-progress --no-scripts --no-autoloader
COPY admin/ ./
RUN mkdir -p storage/framework/cache/data storage/framework/sessions storage/framework/views storage/logs bootstrap/cache && composer dump-autoload --optimize --no-interaction

FROM admin-test AS admin-build
RUN composer install --no-dev --prefer-dist --no-interaction --no-progress --optimize-autoloader && php artisan filament:assets --no-interaction

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package*.json .npmrc ./
RUN npm ci
COPY . .
RUN npm run build

FROM php-base AS runtime
WORKDIR /app
ARG APP_REVISION=local
ENV NODE_ENV=production HOST=127.0.0.1 PORT=3001 DATA_DIR=/app/data APP_REVISION=$APP_REVISION LARAVEL_ADMIN_ENABLED=true
LABEL org.opencontainers.image.source="https://github.com/theCowBoiCoder/toga_cards" org.opencontainers.image.revision=$APP_REVISION
COPY --from=node:22-bookworm-slim /usr/local/bin/node /usr/local/bin/node
COPY --from=build /app/.output ./.output
COPY --from=admin-build /app/admin ./admin
COPY deploy/runtime/ ./runtime/
RUN groupadd -g 1000 node && useradd -u 1000 -g node -m node && mkdir -p /app/data /app/admin/storage/framework/cache/data /app/admin/storage/framework/sessions /app/admin/storage/framework/views /app/admin/storage/logs /app/admin/bootstrap/cache && chown -R node:node /app/data /app/admin/storage /app/admin/bootstrap/cache && chmod +x /app/runtime/start.sh
RUN printf 'upload_max_filesize=6M\npost_max_size=8M\nmemory_limit=256M\nexpose_php=Off\nopcache.validate_timestamps=0\n' > /usr/local/etc/php/conf.d/toga.ini
USER node
EXPOSE 3000
ENTRYPOINT ["/app/runtime/start.sh"]
CMD ["supervisord", "-c", "/app/runtime/supervisord.conf"]
