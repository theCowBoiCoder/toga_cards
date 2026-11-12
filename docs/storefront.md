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

Copy the empty variables from `.env.example` into the local `.env`; keep keys out of Git and chat. Start with Stripe **test** credentials. Configure `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `SHOP_URL` (exact trusted origin) and `SHOP_SHIPPING_PENCE` (optional legacy UK postage, integer pence; `0` means free postage). Restart after configuration changes. Unset `TOGA_PREVIEW` for test payments against a dedicated test database.

Forward Stripe test events with:

```text
stripe listen --forward-to localhost:3000/api/shop/webhook
```

Use the CLI's signing secret for the local webhook. Configure the deployed endpoint separately with its own signing secret. Subscribe to `checkout.session.completed`, `checkout.session.expired`, `refund.created`, `refund.updated` and `refund.failed`. Only GBP card payments and UK delivery are enabled. Checkout prices and stock come from the server, never the basket. Payment completion requires a valid webhook signature and matching paid total, currency and session. Returning to the success page alone cannot record a sale.

Orders reserve website stock transactionally before Stripe session creation. Sessions expire after 30 minutes; verified expiry events release reservations. Fulfilment is transactional and replay-safe. If a webhook is missed, use **Check Stripe** on a pending order to reconcile its actual status. Network failures during session creation retain reservations rather than assuming Stripe did not create a session. An order with no linked session needs manual lookup in Stripe by the UUID shown in admin (also the Stripe client reference, metadata orderId and idempotency key). Do not manually release a potentially payable session.

Test successful payment, duplicate webhook, expiry, mismatched payment, competing baskets and failed session creation before launch. Offline tests cover inventory/fulfilment behavior; a real Stripe test checkout has not been performed without credentials.

## Stock model and eBay

The website inventory ledger is authoritative. Confirmed website quantities become available immediately at the saved price, capped by physical stock and reduced by pending checkout holds. eBay connection errors, stale checks and unmatched listings do not hide website stock. Existing confirmed website quantities previously staged behind eBay verification are carried forward on upgrade; prices and physical counts are preserved.

Use **Cards & stock → Update eBay stock** for the card you want to update. This is a one-off action: only that card’s linked eBay quantities are updated from its current website availability, and the result is verified with GetItem. Updates can reduce or replenish quantity. Prices, titles and postage policies stay unchanged. If several listings are linked to one card, the first in stable listing-key order receives the quantity and the others are set to zero; the confirmation explains this before applying it.

There are no automatic outbound quantity updates after website edits, payments, stock changes, listing matches or background order imports. Failed or uncertain writes need review and another explicit selection; they never retry in the background. Existing automatic-sync flags and queued jobs cannot authorize writes. Order/listing reads and configured sale imports continue independently.

Mapping and order checks apply to the selected eBay update only. Unrelated unmatched listings do not block website sales or updates for matched cards. Variation listings still require reviewed SKU support. When setting a GTC listing to zero, out-of-stock control is enabled and verified to keep the listing available for future restocking.

Website and eBay can offer the same stock under this manual workflow. Later changes are not pushed to eBay until the seller selects another update. Pending website checkout holds are excluded from the quantity sent; after a hold expires, another explicit update is needed to replenish eBay. External marketplace sales and edits cannot be atomic with the website ledger.

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

## Delivery options

Use **Admin → Delivery options** to add delivery service names, prices per order and optional minimum/maximum working-day estimates. Enable only services with prices you are ready to offer. Customers choose a service in the basket before Stripe checkout; the server retrieves its current price and stores the service name and amount on the order. Editing or disabling a service does not rewrite an existing order or checkout reservation. Shipping is currently UK-only.

A valid existing `SHOP_SHIPPING_PENCE` creates one Standard UK delivery option on upgrade if no options exist. New installations can leave that variable blank and create their options in admin. Stripe checkout stays unavailable until at least one delivery option is enabled and Stripe credentials are configured.
