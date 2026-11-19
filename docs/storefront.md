# Toga Cards storefront prototype

## Combined Royal Mail postage

Admin → Delivery options lets staff edit each service's postage bands, card-count limits, packaging allowance and enablement. Prices are entered in pounds. A band charges once for the entire basket, counting all copies across all card designs; packaging is added once. No band means the existing flat-rate behaviour. Baskets above the final band need a manual quote. Both guest and signed-in checkout recalculate postage on the server and retain the selected name and final charge on the order.

If there are no delivery services at startup, Royal Mail 2nd Class and 1st Class are added. Existing options are never overwritten. Starter bands reflect one protected holder per card, with multiple cards grouped into one parcel: 1 card uses Large Letter up to 100g; 2–100 cards use Small Parcel up to 2kg. These quantity limits are estimates, not measured weights: verify your actual packed orders (including holders and mailer) fit the Royal Mail format and reduce the limit if necessary. Slabs and unusually heavy cards need separate review.

Starter online postage prices are 2nd Class £1.55/£4.40 and 1st Class £3.20/£5.70, with an editable £0.50 packaging allowance per order. Customer totals are therefore £2.05/£4.90 and £3.70/£6.20. Source: [Royal Mail online price guide, effective 5 October 2026](https://www.royalmail.com/sites/royalmail.com/files/2026-10/online-price-guide-october-2026-v1.pdf), UK Standard, page 6. These are online purchase prices, not Post Office counter prices; collection fees are not included. Rates are stored locally and require manual updates when Royal Mail changes prices. No labels are purchased automatically.

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

Use the CLI's signing secret for the local webhook. Configure the deployed endpoint separately with its own signing secret. Subscribe to `checkout.session.completed`, `checkout.session.expired`, `refund.created`, `refund.updated` and `refund.failed`. Manage payment methods in the Stripe Dashboard for the same sandbox or live account as the server API key. Enable cards only: the current fulfilment handler does not handle asynchronous payment success/failure events. Checkout uses GBP and UK delivery. Do not send payment_method_types when creating Checkout Sessions. Checkout prices and stock come from the server, never the basket. Payment completion requires a valid webhook signature and matching paid total, currency and session. Returning to the success page alone cannot record a sale.

Orders reserve website stock transactionally before Stripe session creation. Sessions expire after 30 minutes; verified expiry events release reservations. Fulfilment is transactional and replay-safe. Confirmed initial request/authentication/permission rejections release unlinked reservations immediately. Timeouts, server errors and idempotency conflicts keep the hold until Stripe's outcome is known. Failure messages distinguish returned stock from a reservation still being checked.

The reservation and exact Stripe request are saved in one SQLite transaction before the API call. A background worker checks pending orders every minute (up to 20 per pass), recovering missed payment/expiry webhooks. Ambiguous creations are retried with the original request and idempotency key, only with the original credential fingerprint and within 23 hours, before Stripe's minimum 24-hour idempotency retention window. A later authentication/validation failure cannot prove the original attempt failed and never frees its stock. A confirmed paid session is fulfilled, and a confirmed expired unpaid session releases the hold. An overdue session still reported open is explicitly expired first. Worker leases prevent recovery from interfering with an active creation.

Returning through Stripe's cancel button posts a cancellation request from the shop. A random per-order capability is returned only to the initiating browser and kept in that tab's session storage; only its SHA-256 hash is stored server-side. The capability never appears in a redirect URL. A guessed order reference or a cross-origin request cannot cancel someone else's checkout. The server expires the Stripe session before releasing stock. If payment wins that race, the order is fulfilled instead. Without browser storage or after closing the tab, confirmed expiry still returns the stock. Existing checkout sessions created before this feature use the expiry fallback.

Older linked pending orders are included in recovery. Legacy unlinked holds have no persisted Stripe request and still need manual review, as do ambiguous attempts with changed credentials or outside the safe retry window. Look up these orders in Stripe by the UUID shown in admin (also the Stripe client reference, metadata orderId and idempotency key). Neither local age alone, an API outage, nor an unmatched session is proof that a buyer has not paid. No production reservations are blindly cleared on deployment. **Check Stripe** remains available for individual linked orders. The worker is disabled in preview or without Stripe configuration. Checkout request snapshots contain order/customer data and belong in the existing privacy/backup controls.

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

Before launch: provide real stock, prices and photos; complete Stripe test acceptance; configure the domain/hosting/backups; supply actual contact, delivery, returns and privacy information; verify order dispatch and confirmation emails. This prototype records customer email and shipping details for admin review. Staff can issue full or partial Stripe refunds, reconcile their statuses, review returns and restore inspected returned copies separately. Refunds never restock cards automatically. Postage/payment-fee reconciliation remains manual; inventory profit figures for website sales currently exclude those costs and are not a complete net-profit calculation. Customers can register and sign in at `/account/login`, view orders placed while signed in, follow carrier tracking links, request returns/refunds and maintain an owned/wanted collection checklist. Guest checkout remains available; guest orders are not claimed by email address. Order and dispatch emails use the SMTP outbox described below; postage label purchasing is not implemented.

Validation includes Laravel login/access/MFA/audit and stock-action feature tests, combined Docker gateway/asset/CSRF checks, 41 offline inventory/payment/sync tests (`npm test`), production build (`npm run build`), and production HTTP smoke (`npm run test:http`) covering admin authentication including encoded/trailing-slash paths, SSR, cross-origin rejection, webhook signature rejection, synthetic signed fulfilment, duplicate delivery and expiry release. Stripe test checkout requires configured credentials. Live stock updates require a connected seller account and verified inventory mappings.

## Customer accounts, returns and mail

Customer routes are served by Laravel through the Docker gateway at `/account/*`; Node-only development does not serve these pages. Customer sessions use a separate guard and cannot authenticate staff accounts. Orders are bound to the server-side customer ID at reservation; neither an email address nor a browser-supplied customer ID can claim another order. Personal collection counts live in `admin.sqlite` and do not change physical stock or website availability.

In **Orders**, staff can record a carrier, reference and HTTPS tracking link. Customers see dispatch information and return responses in their account. Refund actions require an amount and confirmation, record a durable request before calling Stripe, and reuse its idempotency key on retries. If a request has an unknown outcome, use **Check refunds** or **Retry unconfirmed refund**. Requests older than the safe retry window require inspection in Stripe; do not create a replacement refund without checking. Stripe credentials and the additional refund webhook events are required for live refund processing.

Use **Open return** for guest orders, then approve/decline, record receipt, and restore only inspected copies. The restock form accepts the cumulative total received for that order line, making repeated submissions safe. Stock cost is restored from the original recorded sale; historical orders without that link need a reviewed physical count instead. Refund records are separate from immutable sales, so gross sales reports are not net-of-refund profit reports.

Password resets use Laravel's single-use email tokens. Configure `MAIL_MAILER=smtp`, `MAIL_HOST`, `MAIL_PORT`, `MAIL_SCHEME`, `MAIL_USERNAME`, `MAIL_PASSWORD`, `MAIL_FROM_ADDRESS` and `MAIL_FROM_NAME` in `/etc/toga-cards/runtime.env`, then recreate the container. With the default log mailer, reset links are not generated or logged; the customer sees that email delivery is unavailable. No SMTP credentials or Stripe live tests were assumed by this feature.

### Order emails

The shop queues customer confirmations only after verified payment (including payments confirmed through **Check Stripe**). Customers and staff also receive dispatch notifications, return-request acknowledgements and return updates, and confirmed-refund notifications. Failed refunds alert staff only. Guest customers receive order details without an account-only order link. Password resets continue through Laravel using the same SMTP credentials.

Configure these additional values in the server's `/etc/toga-cards/runtime.env`:

```dotenv
TOGA_EMAILS_ENABLED=1
SHOP_NOTIFICATION_EMAIL=your-existing-inbox@example.com
MAIL_REPLY_TO_ADDRESS=your-existing-inbox@example.com
MAIL_MAILER=smtp
MAIL_HOST=smtp-relay.brevo.com
MAIL_PORT=587
MAIL_SCHEME=smtp
MAIL_USERNAME=your-brevo-smtp-login
MAIL_PASSWORD=your-brevo-smtp-key
MAIL_FROM_ADDRESS=orders@togacards.co.uk
MAIL_FROM_NAME=Toga Cards
```

Brevo is one SMTP option; another provider can use the same variables. Authenticate the sending domain and create an approved sender in the provider first. For Brevo, use an **SMTP key**, not an API key or account password. Add exactly the DNS records the provider supplies, preserving other DNS records. Brevo sends mail but does not provide a customer-support inbox; replies go to `MAIL_REPLY_TO_ADDRESS` (defaults to `SHOP_NOTIFICATION_EMAIL`). Configure only `smtp` with STARTTLS (normally port 587) or `smtps` with implicit TLS (normally port 465). The Node worker requires encrypted SMTP with certificate verification. Both the enable flag and complete SMTP/recipient configuration are required before it sends anything. Recreate the container after changing the environment; a restart alone does not reload its environment file. Production Compose already reads this file. The local Compose file also passes these settings through.

Events and email snapshots are stored atomically with their order changes in `cards.sqlite`. Nothing is backfilled for orders paid before this feature was deployed. New events queue even while delivery is disabled; enabling delivery will drain that backlog, so review it first. The background worker runs every 15 seconds. Failed attempts back off from 30 seconds to one hour and stop after eight failed attempts. **Admin → Order emails** shows the latest 200 messages, configuration status and safe error codes, and lets staff retry exhausted messages. A `sent` status means the SMTP provider accepted the message, not that it reached the inbox; check the provider's logs for bounces or delivery outcomes. A missing customer email leaves only the staff notification.

Event keys prevent duplicate webhook deliveries and repeated dispatch actions from creating duplicate emails. SMTP cannot guarantee exactly-once delivery if the process stops or the network fails after acceptance: an ambiguous attempt can be sent again. Retries preserve the Message-ID but inbox deduplication is not guaranteed. The worker never holds a stock transaction open while sending, and an SMTP outage does not undo payment or dispatch. Outbox snapshots contain order/customer data and must be included in the same privacy/backup controls as orders.

Before enabling in production, verify one message to the shop inbox, a paid test order, replayed payment notification, dispatch with tracking, return updates, a confirmed refund, and password reset. Test order emails are real SMTP messages, so use your own email address. Stripe payment receipts are separate: enable successful-payment receipts in Stripe's customer email settings if wanted, in addition to the shop's itemised order confirmation. No marketing or abandoned-basket emails are sent.

## Delivery options

Use **Admin → Delivery options** to add delivery service names, prices per order and optional minimum/maximum working-day estimates. Enable only services with prices you are ready to offer. Customers choose a service in the basket before Stripe checkout; the server retrieves its current price and stores the service name and amount on the order. Editing or disabling a service does not rewrite an existing order or checkout reservation. Shipping is currently UK-only.

A valid existing `SHOP_SHIPPING_PENCE` creates one Standard UK delivery option on upgrade if no options exist. New installations can leave that variable blank and create their options in admin. Stripe checkout stays unavailable until at least one delivery option is enabled and Stripe credentials are configured.
