# Toga Cards storefront prototype

The existing Nuxt application now serves `/` (homepage), `/shop` (catalogue and basket) and `/admin` (Laravel/Filament inventory, sales, eBay tools, website listings, orders, dispatch, staff and audit history). Nothing has been deployed or applied to live eBay listings by this change.

## Preview and development

Use Node 22.22.3+ (24 LTS also supported). `npm run dev` serves the app on localhost. Use the Docker workflow on machines with an older Node runtime.

Run `npm run dev:shop` to reopen the isolated demo at http://127.0.0.1:3100/. Equivalent Windows PowerShell configuration:

```powershell
$env:DATA_DIR = "$PWD/.preview-data"
$env:TOGA_PREVIEW = "1"
node node_modules/nuxt/bin/nuxt.mjs dev --port 3100 --host 127.0.0.1
```

This uses a separate database, labels stock as demonstration data, disables checkout and suppresses background eBay polling. The catalogue metadata is genuine; illustrations and demonstration prices are placeholders. In the complete Docker app, add real product photos as JPEG/PNG/WebP uploads or hosted HTTPS URLs in Laravel admin.

## Stripe setup

Copy the empty variables from `.env.example` into the local `.env`; keep keys out of Git and chat. Start with Stripe **test** credentials. Configure `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `SHOP_URL` (exact trusted origin) and `SHOP_SHIPPING_PENCE` (actual UK postage, integer pence; explicitly use `0` for free postage). Restart after configuration changes. Unset `TOGA_PREVIEW` for test payments against a dedicated test database.

Forward Stripe test events with:

```text
stripe listen --forward-to localhost:3000/api/shop/webhook
```

Use the CLI's signing secret for the local webhook. Configure the deployed endpoint separately with its own signing secret. Subscribe to `checkout.session.completed`, `checkout.session.expired`, `refund.created`, `refund.updated` and `refund.failed`. Only GBP card payments and UK delivery are enabled. Checkout prices and stock come from the server, never the basket. Payment completion requires a valid webhook signature and matching paid total, currency and session. Returning to the success page alone cannot record a sale.

Orders reserve website stock transactionally before Stripe session creation. Sessions expire after 30 minutes; verified expiry events release reservations. Fulfilment is transactional and replay-safe. If a webhook is missed, use **Check Stripe** on a pending order to reconcile its actual status. Network failures during session creation retain reservations rather than assuming Stripe did not create a session. An order with no linked session needs manual lookup in Stripe by the UUID shown in admin (also the Stripe client reference, metadata orderId and idempotency key). Do not manually release a potentially payable session.

Test successful payment, duplicate webhook, expiry, mismatched payment, competing baskets and failed session creation before launch. Offline tests cover inventory/fulfilment behavior; a real Stripe test checkout has not been performed without credentials.

## Stock model and eBay

Physical stock remains the existing inventory ledger. `shop_listings.quantity` is the allocation reserved for website customers, including pending checkout holds. Website availability is allocation minus holds, capped by physical stock. Payment deducts both physical stock and the allocation. Manual sales and eBay order import cannot consume allocated website copies; conflicts go to review. A physical stock adjustment cannot reduce stock below the allocation.

Before publishing: count the copies, assess condition, set a price and requested allocation, and confirm the physical stock. Finish eBay stocktake, resolve order/sync errors and map every active listing. With automatic sync enabled, allocations are staged until the worker reduces and verifies eBay availability. Without automatic sync, the original manual publication check still rejects combined eBay listed quantity and website allocation above physical stock. A direct external eBay edit can still cause conflict; the application cannot promise atomic transactions across independent marketplaces.

Automatic stock sync is now available from the admin shop panel. It polls eBay every two minutes and also wakes after local stock/listing changes or Stripe payments. It reduces live eBay quantities for mapped single-card fixed-price listings and verifies the result with GetItem. A requested website allocation stays pending until its eBay exposure is reduced and orders are checked again. The website and eBay never deliberately share the same allocated copy.

The worker keeps durable jobs, retry delays, sold-counter watermarks and a renewable SQLite lease. Unknown write outcomes are checked against eBay before retrying. A sale during a transfer quarantines eBay availability at zero and prevents website release until that sale is accounted for. Failed or stale checks pause website purchasing. The admin panel shows errors, mapping counts, per-card progress and a pause control.

Automatic updates are **reduction-only**. Lower live quantities are not replenished from an unexplained ledger difference, which could be an order still arriving from eBay. New receipts/stock returned from the website remain unlisted on eBay until physically counted and explicitly restocked through a reviewed flow. Multiple mapped eBay listings share one capped stock pool; available units are distributed in stable listing-key order and only reduced. Variation listings remain quarantined for SKU allocation review. All active listings must be matched before website stock can be released; do not guess matches for other collections, numbered parallels or bundles. Existing paid/unpaid/refunded order issues also require review. No stock is invented from listing quantities.

When reducing a GTC listing to zero, the worker enables and verifies eBay's account-wide out-of-stock control if needed. This keeps zero-stock listings available for future restocking rather than deliberately ending them. Sync changes quantity only, never prices, titles or postage policies. External eBay edits, stale physical counts and API visibility delays cannot be made atomic with this database: keep confirmed channel allocations and monitor the review queue. Unmatched or unreviewed stock is not covered by automatic synchronisation.

## Hosting and remaining launch work

Use the supplied Docker image (Nginx, PHP-FPM and Node) with a persistent `/app/data` volume, HTTPS and backups of the volume plus runtime encryption keys. This SQLite application cannot be uploaded unchanged to a Cloudflare Worker/Sites runtime. Preserve the existing Docker volume when upgrading; back it up first. The schema additions are additive. Do not expose the local app unchanged or delete the Docker volume.

Run `python scripts/configure-admin.py` before starting Docker. The first administrator uses `LARAVEL_ADMIN_EMAIL` (default `admin@togacards.co.uk`) and `ADMIN_PASSWORD`. Existing accounts/passwords are preserved on restart. Use your profile to change the password and enable authenticator MFA. Laravel stores users, sessions and audit entries in a separate `admin.sqlite`; the existing stock ledger stays in `cards.sqlite`. The gateway blocks public access to private stock APIs. Laravel actions require authenticated administrator access and CSRF validation; a server-only key connects Laravel to the loopback Node service. Preserve `LARAVEL_APP_KEY` with backups. Use HTTPS and the supplied public Nginx rate limits.

Before launch: provide real stock, prices and photos; complete Stripe test acceptance; configure the domain/hosting/backups; supply actual contact, delivery, returns and privacy information; verify order dispatch and confirmation emails. This prototype records customer email and shipping details for admin review. Staff can issue full or partial Stripe refunds, reconcile their statuses, review returns and restore inspected returned copies separately. Refunds never restock cards automatically. Postage/payment-fee reconciliation remains manual; inventory profit figures for website sales currently exclude those costs and are not a complete net-profit calculation. Customers can register and sign in at `/account/login`, view orders placed while signed in, follow carrier tracking links, request returns/refunds and maintain an owned/wanted collection checklist. Guest checkout remains available; guest orders are not claimed by email address. There are no automated dispatch emails or postage label purchasing yet.

Validation includes Laravel login/access/MFA/audit and stock-action feature tests, combined Docker gateway/asset/CSRF checks, 41 offline inventory/payment/sync tests (`npm test`), production build (`npm run build`), and production HTTP smoke (`npm run test:http`) covering admin authentication including encoded/trailing-slash paths, SSR, cross-origin rejection, webhook signature rejection, synthetic signed fulfilment, duplicate delivery and expiry release. Stripe test checkout requires configured credentials. Live stock updates require a connected seller account and verified inventory mappings.

## Customer accounts, returns and mail

Customer routes are served by Laravel through the Docker gateway at `/account/*`; Node-only development does not serve these pages. Customer sessions use a separate guard and cannot authenticate staff accounts. Orders are bound to the server-side customer ID at reservation; neither an email address nor a browser-supplied customer ID can claim another order. Personal collection counts live in `admin.sqlite` and do not change physical stock or website availability.

In **Orders**, staff can record a carrier, reference and HTTPS tracking link. Customers see dispatch information and return responses in their account. Refund actions require an amount and confirmation, record a durable request before calling Stripe, and reuse its idempotency key on retries. If a request has an unknown outcome, use **Check refunds** or **Retry unconfirmed refund**. Requests older than the safe retry window require inspection in Stripe; do not create a replacement refund without checking. Stripe credentials and the additional refund webhook events are required for live refund processing.

Use **Open return** for guest orders, then approve/decline, record receipt, and restore only inspected copies. The restock form accepts the cumulative total received for that order line, making repeated submissions safe. Stock cost is restored from the original recorded sale; historical orders without that link need a reviewed physical count instead. Refund records are separate from immutable sales, so gross sales reports are not net-of-refund profit reports.

Password resets use Laravel's single-use email tokens. Configure `MAIL_MAILER=smtp`, `MAIL_HOST`, `MAIL_PORT`, `MAIL_SCHEME`, `MAIL_USERNAME`, `MAIL_PASSWORD`, `MAIL_FROM_ADDRESS` and `MAIL_FROM_NAME` in `/etc/toga-cards/runtime.env`, then recreate the container. With the default log mailer, reset links are not generated or logged; the customer sees that email delivery is unavailable. No SMTP credentials or Stripe live tests were assumed by this feature.
