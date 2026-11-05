# Ubuntu, Nginx and GitHub Actions

Target: **https://togacards.co.uk**. The application runs in Docker behind the server's existing Nginx. Build/test jobs run on GitHub-hosted Ubuntu runners, not on the production host. The SSH key is restricted to a root-owned application release receiver; it cannot open a shell, forward ports or choose Docker options.

## Layout and prerequisites

- Ubuntu x86-64, rootful Docker Engine, Docker Compose **2.30+**, Nginx, Python **3.11+**, sudo and Certbot. Install Docker using its [Ubuntu instructions](https://docs.docker.com/engine/install/ubuntu/) if needed. The app's own Node runtime is supplied by Docker.
- Dedicated Compose project `toga-cards`; external Docker volume `toga_cards_production_data`.
- App listens only on `127.0.0.1:3100`; Nginx is the public entry point on ports 80/443. The release image contains an internal Nginx gateway, PHP-FPM for Laravel/Filament and Node for the storefront/inventory service. No host PHP or Composer is required.
- Root-owned configuration/secrets in `/etc/toga-cards`, state and deployment backups in `/var/lib/toga-cards`.
- SSH deployment account `toga-cards-deploy`, separate from the existing administrator/`actions-runner` login. It is not a self-hosted Actions runner and does not join the Docker group.
- Runtime image is built/tested once in CI, tagged by commit SHA, transferred over SSH, checksum-checked, loaded and health-checked. The previous image is restarted if rollout fails. Rollback does **not** overwrite the database: it could contain payments accepted after deployment.

## 1. One-time server setup

Log in using your existing working administrator SSH connection. These commands add only this site's files/account/volume and preserve other Nginx sites. Check that port 3100 is free before proceeding.

```bash
git clone https://github.com/theCowBoiCoder/toga_cards.git
cd toga_cards
sudo bash deploy/bootstrap.sh deploy/keys/production.pub
```

The public key is safe to store in Git. Its private counterpart belongs only in the GitHub `production` environment's `DEPLOY_SSH_KEY` secret and the owner's secure local key storage. Bootstrap installs the forced-command receiver and an HTTP setup page. It does **not** start the app, import data or change existing inventory.

If an existing `/etc/nginx/sites-available/togacards.co.uk` is present, bootstrap preserves it for administrator review. Do not overwrite an unrelated existing site. Future changes to the receiver/production Compose/Nginx configuration require an administrator to update those root-owned files; application releases cannot replace them.

## 2. DNS and HTTPS

Point the domain's A record to the Ubuntu server and `www` to the same destination. Remove or correct stale AAAA records. Wait for DNS to resolve to the intended server before requesting the certificate. Open ports 80/443 in the existing firewall without removing other application rules.

```bash
sudo certbot certonly --webroot -w /var/www/letsencrypt -d togacards.co.uk -d www.togacards.co.uk
sudo bash deploy/enable-https.sh
```

Complete Certbot's email/terms prompts yourself. Verify renewal is enabled (`systemctl list-timers '*certbot*'`). HTTPS redirects `www` to the canonical bare domain. Nginx overwrites forwarded host/protocol headers, forwards admin authentication, rate limits checkout/admin requests and omits OAuth callback query strings from access logs.

## 3. Transfer the real inventory — one active writer only

**Do not start the Ubuntu copy while the Windows Docker copy is still syncing the same seller.** They would have independent SQLite databases and could send contradictory eBay quantities. Wait until the server setup, DNS, TLS and SSH deployment key are ready, then run this from the existing Windows project:

```powershell
python deploy/export-inventory.py --stop-local
```

Run `python scripts/configure-admin.py` and start the current Docker release before cutover so the Laravel database exists. Export intentionally stops `togacards-cards-1`, leaves the volume intact, copies the complete stopped data directory, creates portable backups of both `cards.sqlite` and `admin.sqlite`, and exports a **private** bundle under ignored `.backups/`. It includes uploaded card photos, administrator accounts/MFA, sessions, audit history, credentials, `LARAVEL_APP_KEY`, `ADMIN_SERVICE_KEY` and the original eBay encryption key. Losing/changing the Laravel key makes existing MFA secrets unreadable. Do not commit it, put it in GitHub Actions artifacts, or send it through public links.

Use your working management SSH account to create a private upload directory:

```bash
ssh actions-runner@YOUR_SERVER_IP 'install -d -m 0700 ~/toga-private'
scp /path/to/inventory-cutover.tar.gz actions-runner@YOUR_SERVER_IP:toga-private/inventory-cutover.tar.gz
```

Then on Ubuntu:

```bash
sudo python3 /usr/local/lib/toga-cards/server.py import "$HOME/toga-private/inventory-cutover.tar.gz"
```

The importer checks the database checksum, row counts, admin password, canonical HTTPS URL and original eBay encryption-key fingerprint. It refuses an existing production database and refuses imports while a container uses the volume. It assigns the database to the container's Node user and stores the environment as root-only data. Keep the local PC container stopped once the server becomes authoritative. An aborted migration can restart the local app only after confirming the server is stopped.

The imported seller token normally remains usable because its encryption key is preserved. For future eBay reconnects, update the RuName's accepted redirect URL to `https://togacards.co.uk/api/ebay/callback`. The existing Cloudflare notification relay remains independent; a fixed localhost OAuth relay is unsuitable for production.

## 4. GitHub settings

The workflow is `.github/workflows/build-deploy.yml`. It builds/tests on pushes to `main`, PRs and manual dispatch. Only non-PR `main` runs can deploy, and only when the repository variable `DEPLOY_ENABLED` equals `true`.

Repository variables:

| Variable | Value |
|---|---|
| `DEPLOY_ENABLED` | `false` until migration is complete; then `true` |
| `DEPLOY_HOST` | Server hostname/IP |
| `DEPLOY_USER` | `toga-cards-deploy` |
| `DEPLOY_PORT` | `22` unless SSH uses a different port |

The `production` environment permits deployment from `main` only. Environment secrets:

| Secret | Value |
|---|---|
| `DEPLOY_SSH_KEY` | Dedicated Ed25519 private deployment key |
| `DEPLOY_KNOWN_HOSTS` | Trusted SSH host-key entry for `DEPLOY_HOST` and port |

Verify host keys using an existing trusted connection or the server console. Do not blindly accept `ssh-keyscan` output. The workflow requires strict host-key verification. No app/Stripe/eBay secrets or inventory databases are put in CI.

After importing inventory and verifying TLS, enable deployment from an authenticated machine:

```bash
gh variable set DEPLOY_ENABLED --body true --repo theCowBoiCoder/toga_cards
gh workflow run build-deploy.yml --ref main --repo theCowBoiCoder/toga_cards
```

Watch the Actions run through completion. Check `/api/health`, `/shop`, admin authentication, inventory counts and eBay sync. Stripe remains disabled until real shipping and Stripe configuration are supplied. Before accepting buyers, complete test payments and add real photos, stock allocations, contact, delivery, returns and privacy details.

## Backups and recovery

Each deployment stops only this app briefly and takes a consistent backup of both databases, their WAL/SHM files, uploaded photos and the environment before replacing the container. Backups remain root-only under `/var/lib/toga-cards/backups`; monitor disk usage and maintain independent encrypted/offsite backups. They include sensitive seller tokens and may include order contact information. Apply the relevant account-deletion/retention policy to backups as well.

Never run `docker compose down -v`, delete the external volume, or copy another database's WAL/SHM files into it. Restore a reviewed backup only with the app stopped and after backing up the current state again. A failed release restarts the previous **image**, preserving the current database; restoring an older database automatically could lose paid orders.

The `/api/health` response contains only status and the deployed commit revision. The deploy receiver checks that exact revision, not just HTTP 200, so it cannot mistake another service for a successful release.
