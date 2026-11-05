# eBay integration

## Seller connection

Application keys identify this application, not your seller account. The integration cannot read listings or orders until the seller completes OAuth consent. The application credentials belong in the ignored `.env` file. `EBAY_TOKEN_KEY` is a 32-byte random encryption key; keep it when restoring backups, otherwise encrypted tokens cannot be read. The supplied Dev ID is not required for OAuth Trading requests.

In the eBay developer portal, select your production application, then User Tokens and the OAuth redirect settings. Obtain its **RuName** and configure an accepted HTTPS redirect URL. Enter the RuName in the app's eBay screen, then use Connect eBay to sign in and grant access.

The callback route is `/api/ebay/callback`. For production, configure the RuName's accepted redirect URL as `https://togacards.co.uk/api/ebay/callback`. Start consent in the HTTPS admin area so the HttpOnly state cookie returns to the same host. The optional Cloudflare relay can still handle marketplace deletion notifications; the production OAuth redirect should go directly to the application.

Keep secrets only in the ignored environment file. Preserve `EBAY_TOKEN_KEY` when moving the database: existing encrypted seller tokens depend on it. Do not print Compose's interpolated configuration or container environment in CI logs. A localhost OAuth relay does not work for remote customers or production seller consent.

## Data flow

- Reads production `GetMyeBaySelling` active listings, including existing listings made directly on eBay and their variation quantities. Each SKU/variation is a separate mapping.
- Reads production `GetOrders` with seller role and modification-date filters. Initial lookback is 89 days; subsequent runs overlap the last successful sync by one day. A gap exceeding the API history window is blocked for explicit recovery.
- Fetches all pages before committing a snapshot. Failure, warnings, rate limits or invalid pagination do not clear previous listings, advance the cursor or change holdings. Errors appear on the eBay screen.
- Sync runs every 15 minutes while the Nuxt server is running, including during stocktake. Sync now is also available. The production container restarts unless explicitly stopped. This is polling, not a webhook, and has up to 15-minute latency.
- Only title, SKU, listing/order IDs, quantities, prices, timestamps and relevant status are retained. Buyer contact details and addresses are discarded.
- Optional automatic stock protection reduces verified mapped listing quantities; it does not reprice, create listings, update shipments or send buyer messages.

## Stocktake and reconciliation

Stocktake mode is the default. Orders are imported for review without changing physical stock. Link each listing/SKU to the exact catalogue card; titles are not automatically trusted as identity. Only map a listing where one purchased unit means one copy of that card. Full sets, mixed lots and multi-card bundles need separate handling and must remain unmatched.

Listed quantities are shown separately. **Use listed quantities as minimum stock** sums active mapped listings and only raises lower local counts. It assumes these are distinct listed copies, not the same physical copies advertised more than once. Higher physical counts are preserved. Added copies have zero allocated purchase cost. A baseline timestamp prevents subsequent automatic processing of older sales from double-deducting those baseline copies.

Review older orders and either record the sale (if the sold copies are still included in the current stock count) or mark the order **Already reflected in my count**. The latter does not create a sales ledger entry; historical revenue remains excluded. A reviewed manual sale deliberately overrides baseline protection, so check it before deducting.

After finishing stocktake, **Stocktake complete: enable deductions** establishes a cutover timestamp. Paid, completed, non-cancelled GBP orders created on or after that cutover may deduct stock if mapped and sufficient stock exists. Unmatched, pre-cutover, unpaid, non-GBP, cancelled and insufficient-stock orders remain review items. Pausing and enabling again creates a new cutover; sales during the pause need manual review.

Stable order-line keys plus atomic SQLite transactions prevent duplicate deductions. Applied orders that subsequently change or show cancellation/refund indicators are flagged. They are not silently reversed, because a refund is not proof that a physical card was returned. Refund/restock and correction workflows are not automated in this version. Check eBay returns separately; Trading order status is not a complete returns ledger.

## Money

Item revenue is the Trading transaction price multiplied by quantity, in GBP pence. Buyer postage and tax are not added. Fees are not available as a complete verified cost total from these calls. Automatic sales start with provisional zero fees, explicitly marked in Sales and the profit metric. Confirm fees and net postage cost on the eBay order row. Reviewed manual imports require an explicit amount, including zero. Do not interpret provisional profit as final net proceeds. CSV reports include provisional fee status for eBay sales.

## Verification and limits

Automated tests use synthetic Trading XML and in-memory SQLite. They cover stocktake mode, identity/variation parsing, pagination, safe failure, minimum-stock reconciliation, cutover, baseline protection, insufficient stock, repeat imports, changed orders and fee updates. They do not prove live access, eBay consent, production account permissions or that your titles/SKUs map to the correct cards. Live validation must follow seller authorisation.

Official references: [eBay OAuth authorisation](https://developer.ebay.com/develop/guides/sell/authorization), [GetMyeBaySelling](https://developer.ebay.com/Devzone/xml/docs/Reference/ebay/GetMyeBaySelling.html), [GetOrders](https://developer.ebay.com/DevZone/XML/Docs/Reference/ebay/GetOrders.html).


## Automatic outbound stock protection

Use **Website shop → Automatic stock synchronisation** in `/admin`. Enable starts a persistent queue, and **Check stock now** retries outstanding work immediately. Polling runs every two minutes and local stock changes trigger it sooner. The queue survives container restarts. **Pause sync and website purchasing** stops further automatic work and hides website availability while preserving existing checkout reservations.

Website allocation increases are staged. The worker lowers the mapped eBay availability first, verifies sold counts and the remaining quantity, reimports orders, then releases the website allocation. Order conflicts, uncertain writes, unmatched listings and stale syncs keep website stock unavailable. Single-card fixed-price listings are managed; multiple correctly mapped listings share one capped stock pool. Variations require SKU allocation review. Every active eBay listing must have a correct inventory match before website stock is released.

Live availability is never automatically increased from a discrepancy. Count and explicitly review restocks; do not use the legacy stock-increase script while automatic sync is enabled. Zero-stock GTC listings use the seller's out-of-stock preference, enabled and verified by the worker where required. No pricing or listing-content fields are sent.

Tests cover verified allocation transfer, separate website/eBay sales, crashes and retry, delayed order arrival, sales during transfers, multiple workers, unmapped/unpaid/duplicate listings, stale checks and pause behavior, and the stock-only eBay XML requests. These controls reduce cross-channel overselling risk; external edits and incorrect physical counts still need operator review.
