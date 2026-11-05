# TOGA Cards

A Nuxt 4 storefront with a Laravel 13 / Filament 5 administration panel, Stripe checkout, eBay stock synchronisation and a shared SQLite inventory ledger.

See [storefront setup and limitations](docs/storefront.md) for Stripe and stock allocations. The Laravel admin lives at `/admin`: inventory and receipts, offline sales, website prices/photos/allocations, paid-order dispatch, eBay listing matching and order review, stock-sync controls, administrator accounts and an activity log.

Use **Cards & stock** to manage each card in one row: owned copies, shop price, available-to-buy copies and stock-check status. **Edit shop** controls its selling details; **Stock** contains receipts, physical counts and offline sales. The previous `/admin/website` URL redirects to this combined screen. Website availability still waits for verified channel allocations.

## Ubuntu and GitHub deployment

See [Ubuntu/Nginx deployment and inventory cutover](docs/deployment.md). GitHub-hosted runners test and build the image; a restricted SSH account deploys it. Production deployment stays disabled until server setup and inventory migration are complete.

## Run locally

Use Docker for the complete storefront and Laravel admin. Node-only development requires Node.js 22.22.3 or later and runs the older inventory interface for development compatibility.

```powershell
npm ci
npm run dev
```

Open http://127.0.0.1:3000. The app imports the official 2026/27 Topps Flagship Premier League catalogue with zero stock. Add cards with player, club, season, collection, card number, variant, condition, initial quantity and purchase price. Use **Set stock** to enter the total number of copies you own and **Sell** to record sales. Sales deduct stock immediately.

## Docker

```powershell
python scripts/configure-admin.py
docker compose up -d --build
```

Open http://127.0.0.1:3000. SQLite persists in the `cards-data` Docker volume. `docker compose down` preserves it; do not use `down -v` unless you intend to erase your collection. Stop the local development server first if it is using port 3000.

Sign in at `/admin` with `LARAVEL_ADMIN_EMAIL` (default `admin@togacards.co.uk`) and the existing `ADMIN_PASSWORD` in your ignored `.env`. The setup script creates missing secrets and preserves existing ones. On first startup only, Laravel creates the administrator. Subsequent restarts never reset accounts or passwords. Use the account profile to change your password and enable authenticator-based two-factor authentication with recovery codes. Public registration is disabled; existing administrators create staff accounts.

The image contains Nginx, PHP-FPM and Node. Laravel uses `/app/data/admin.sqlite` for users, sessions and audit entries; `/app/data/cards.sqlite` remains the authoritative stock ledger. Only the private loopback inventory service changes stock. Photos persist under `/app/data/admin-public/cards`. Back up the complete volume and `.env`, including `LARAVEL_APP_KEY`, which encrypts MFA secrets.

For PHP development, build `docker build -f deploy/php-tools.Dockerfile -t toga-cards-php-tools .`, then use `python scripts/admin-dev.py composer install` and `python scripts/admin-dev.py php vendor/bin/phpunit`. Dependencies use Docker volumes; host PHP is optional.

## Accounting

- GBP amounts are stored in integer pence.
- Inventory cost is purchase cost, not a market valuation.
- Receipts update the weighted average cost of remaining stock.
- Each sale stores its allocated cost permanently. Future receipts do not change historical profit.
- Realised profit = gross sale price minus total fees/postage minus allocated card cost.
- Selling fees are for the whole sale; sold price is per card.
- Operations use SQLite transactions and reject overselling, invalid quantities and invalid dates.
- Dates are record labels: entering an earlier date does not replay historical cost calculations. Enter receipts and sales in their actual order for correct weighted costs.

## Data and scope

Local data lives in `data/cards.sqlite` (override with `DATA_DIR`). Stop the app before copying the data directory for a backup. Docker and local development use separate databases. CSV export provides inventory and sales reports, not a complete restorable database backup.

The supplied launch configurations bind to localhost. Use HTTPS before public hosting. Laravel protects admin requests with sessions, CSRF checks and administrator access; the gateway blocks browser access to private stock APIs. Sales are immutable; refunds and CSV import are not implemented. Website listings accept uploaded JPEG/PNG/WebP images or hosted HTTPS photos. The bundled official checklist includes 1,138 entries; unlisted colour parallels can be entered manually. See [catalogue provenance](catalog/README.md).

## Validation

```powershell
npm test
npm run build
```

Tests cover stock deduction, weighted costs, full liquidation, overselling prevention, invalid input and transaction rollback.


## eBay

The eBay screen connects your seller account, reads active listings and recent orders, and helps reconcile an unfinished stocktake. Automatic deductions start only after you explicitly finish stocktake. See [eBay setup and operating guide](docs/ebay.md) for OAuth setup, fee handling and validation limits.

