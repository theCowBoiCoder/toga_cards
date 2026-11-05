# TOGA Cards

A Nuxt storefront prototype with a single-user Topps Premier League inventory and sales backend built with Nuxt 4, Vue, shadcn-vue, Tailwind CSS, and SQLite. Nuxt server routes provide the backend; Laravel is not required for this version.

See [storefront setup and limitations](docs/storefront.md) for the public homepage, shop, Stripe setup and stock allocations. The inventory app now lives at `/admin`.

## Ubuntu and GitHub deployment

See [Ubuntu/Nginx deployment and inventory cutover](docs/deployment.md). GitHub-hosted runners test and build the image; a restricted SSH account deploys it. Production deployment stays disabled until server setup and inventory migration are complete.

## Run locally

Requires Node.js 22.22.3 or later (Node 22 LTS recommended).

```powershell
npm ci
npm run dev
```

Open http://127.0.0.1:3000. The app imports the official 2026/27 Topps Flagship Premier League catalogue with zero stock. Add cards with player, club, season, collection, card number, variant, condition, initial quantity and purchase price. Use **Set stock** to enter the total number of copies you own and **Sell** to record sales. Sales deduct stock immediately.

## Docker

```powershell
docker compose up -d --build
```

Open http://127.0.0.1:3000. SQLite persists in the `cards-data` Docker volume. `docker compose down` preserves it; do not use `down -v` unless you intend to erase your collection. Stop the local development server first if it is using port 3000.

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

This version is for one collector on a trusted local machine. The supplied launch configurations bind to localhost. Set ADMIN_PASSWORD and serve over HTTPS before public hosting; admin and private APIs require authentication outside local access. Sales are immutable in this version; sale editing, refunds and CSV import are not implemented. Website listings support HTTPS photo URLs. The bundled official checklist includes 1,138 entries; unlisted colour parallels can be entered manually. See [catalogue provenance](catalog/README.md).

## Validation

```powershell
npm test
npm run build
```

Tests cover stock deduction, weighted costs, full liquidation, overselling prevention, invalid input and transaction rollback.


## eBay

The eBay screen connects your seller account, reads active listings and recent orders, and helps reconcile an unfinished stocktake. Automatic deductions start only after you explicitly finish stocktake. See [eBay setup and operating guide](docs/ebay.md) for OAuth setup, fee handling and validation limits.

