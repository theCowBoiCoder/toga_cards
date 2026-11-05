FROM php:8.4-fpm-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends libicu-dev libonig-dev libsqlite3-dev libzip-dev git unzip nginx supervisor curl && docker-php-ext-install intl mbstring pdo_sqlite bcmath zip && rm -rf /var/lib/apt/lists/*
COPY --from=composer:2 /usr/bin/composer /usr/local/bin/composer
WORKDIR /app/admin
