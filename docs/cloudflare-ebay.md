# Cloudflare eBay notification relay

The optional Worker in `cloudflare/ebay-notifications/worker.mjs` receives marketplace account-deletion notifications, encrypts them into a D1 queue and allows the application to consume them using a shared secret. It verifies the eBay verification challenge. The application verifies notification signatures against eBay public keys before deleting matching seller data.

Configure the Worker with a D1 `DB` binding, `VERIFICATION_TOKEN`, a random 32-byte hex `RELAY_SECRET`, and `PROCESSING_READY=true` after testing. Configure the same secret as `EBAY_RELAY_SECRET` on the application and the Worker HTTPS origin as `EBAY_RELAY_URL`. Use your own Worker hostname; never commit secrets or account-specific deployment files.

Register `https://YOUR-WORKER.workers.dev/api/ebay/deletion` in the eBay developer portal. Keep the verification token and endpoint consistent. Queued notifications are encrypted; protect secrets and D1 backups according to your retention requirements. The application polls the relay at startup, every minute and around order imports. Backlog and verification errors pause imports.

The Worker's OAuth callback route has a fixed localhost destination for local development only. On Ubuntu, configure the eBay RuName's accepted redirect URL directly to `https://togacards.co.uk/api/ebay/callback`. This is independent of the marketplace-deletion endpoint, which can remain on Cloudflare.

Run relay tests with `node --test cloudflare/ebay-notifications/worker.test.mjs`.
