# SmartPark production deployment guide

This guide assumes a Linux server or cloud VM with Docker Engine and the Docker Compose plugin, a public DNS name you control, and ports 80/443 reachable from the internet. It is not a substitute for provider-specific network, privacy, tax, or payment onboarding requirements.

## 1. Architecture

- Caddy receives public HTTP/HTTPS and obtains/renews TLS certificates automatically for `APP_DOMAIN`.
- Nginx serves the built React application and reverse-proxies `/api`, uploaded listing photos, and camera preview streams.
- The Express API is private to the Docker networks and connects to MySQL.
- MySQL has no published host port in the production Compose file.
- The Python vision service is optional and is enabled with the Compose `vision` profile.
- Listing photo uploads and database data are kept in named volumes.

The included proxy chain is Caddy -> Nginx -> Express. The API is configured with `TRUST_PROXY_HOPS=2` for this topology. Change that value if the deployment adds or removes a proxy hop, and never trust arbitrary forwarding headers from a directly public API.

## 2. Prepare DNS and firewall

1. Point the DNS A record for your chosen hostname to the server's public IPv4 address; configure AAAA only if IPv6 is actually routable to the server.
2. Allow inbound TCP 80 and TCP 443. UDP 443 is optional for HTTP/3.
3. Do not expose MySQL port 3306, API port 4000, or vision port 8000 to the public internet.
4. If cameras use RTSP, restrict outbound and inbound camera network access to trusted camera IP ranges. RTSP is disabled by default for the vision service.

## 3. Configure secrets

Copy `.env.example` to `.env`, then edit it with your real deployment values. Do not commit `.env` or send it in support messages.

Required production configuration:

- `NODE_ENV=production`
- `APP_DOMAIN=parking.your-real-domain.tld`
- `WEB_ORIGIN=https://parking.your-real-domain.tld` (exact origin, no trailing slash)
- Strong unique `DB_PASSWORD` and `MYSQL_ROOT_PASSWORD` values, at least 24 characters and different from one another
- A real verified `MAIL_FROM`, `SMTP_HOST`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_PORT`, and correct `SMTP_SECURE` setting
- `PAYMENT_PROVIDER=razorpay`, plus merchant credentials and a webhook secret configured in the provider dashboard
- Different, unique `QR_SIGNING_SECRET` and `VISION_API_TOKEN`, at least 32 random characters

Generate hexadecimal secrets from a trusted terminal, for example:

```bash
openssl rand -hex 32
```

On Windows with Node.js, this also works:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Keep the `VISION_API_TOKEN` and `QR_SIGNING_SECRET` values independent. The API's production environment validation blocks mock payments, local origins, placeholder credentials, and missing SMTP/payment configuration.

## 4. Run preflight and validate Compose

From the project root:

```bash
npm run preflight:production
docker compose -f docker-compose.production.yml config --quiet
```

The preflight reads `.env` (environment variables already set in the current process override file values), checks expected production settings and does not print secrets. Passing it does not connect to DNS, SMTP, Razorpay, MySQL, or a camera.

## 5. First deployment on a new database

Build the images and start MySQL first:

```bash
docker compose -f docker-compose.production.yml build api web
docker compose -f docker-compose.production.yml up -d db
```

Apply numbered SQL migrations using the API container, which includes `mysql2` and the migration files:

```bash
docker compose -f docker-compose.production.yml run --rm api npm run migrate
```

Then start the public site and API:

```bash
docker compose -f docker-compose.production.yml up -d --build api web caddy email-worker
```

For a brand-new deployment only, the root convenience command `npm run deploy:up` runs the configuration preflight, builds the API/web images, starts MySQL, runs the migration runner, and then starts API/web/Caddy and the transactional email worker. For a manually migrated database, baseline it first as described below; do not run the new-database path against an untracked schema.

Caddy will request a TLS certificate once public DNS resolves to this server and the required ports are reachable. Inspect service status and logs:

```bash
docker compose -f docker-compose.production.yml ps
docker compose -f docker-compose.production.yml logs --tail=100 api web caddy db email-worker
```

### Existing database whose migrations were applied manually

Take and verify a backup first. The migration runner needs a history table so it can detect already-applied SQL files. If migrations 001 through 008 were fully applied to this database before the runner was introduced, baseline them through 008 without re-executing their SQL; the normal migration run then applies 009:

```bash
docker compose -f docker-compose.production.yml run --rm api npm run migrate -- --baseline 008 --confirm-existing-schema
```

The baseline command checks for expected tables/columns, records the migration checksums, and executes no migration SQL. It intentionally fails if the schema looks incomplete. If migration 009 was also applied manually, use `--baseline 009` instead so the outbox table is included in the schema check. Do not use it to hide a failed or partially applied migration.

The migration runner tracks checksums and refuses to replay a file that is already applied, has changed, or has an incomplete state. MySQL DDL is not fully transactional; if a migration fails, inspect its error and schema and repair it deliberately before changing migration history. Never edit a migration file that has already been applied; create a new numbered migration instead.

## 6. Enable camera detection when ready

The core booking application does not require the vision container to start. Prepare the machine's CPU/GPU and storage first. YOLO/PyTorch adds a large image and may download its model on first use.

```bash
docker compose -f docker-compose.production.yml --profile vision up -d --build vision
```

Set `VISION_INSTALL_YOLO=true` to include the detector dependency. If set to `false`, the service's health endpoint and API wiring can start but vehicle inference cannot run without installing a supported model package; do not treat that configuration as operational detection.

For video-file tests, place approved test clips into `services/vision/sample-videos/` before creating the container. For live feeds, configure the camera stream using the application, validate network reachability from the container, and only enable RTSP after network restrictions are in place. Do not put passwords or RTSP credentials into screenshots, logs, or public listing data.

Validate region calibration and detector accuracy at the actual site under relevant lighting/weather/occlusion. Unknown or stale sensor data must remain unknown; visual classification alone is not an access authorization.

## 7. Release smoke tests

Before any customer traffic, record pass/fail results for:

1. `https://APP_DOMAIN` serves the frontend over valid HTTPS.
2. `/api/health` reports the API and database connected.
3. Registration, verification email, login, logout and password reset work with the production email provider.
4. A new booking hold cannot overlap a second hold for the same slot.
5. Razorpay order verification and webhook verification work in provider test mode in staging; production keys are enabled only after the provider account is ready.
6. A failed or pending payment cannot produce a valid entry credential.
7. The correct attendant can scan a confirmed ticket; replay, expired tickets, wrong facility and unauthorized operators are rejected.
8. A camera outage produces stale/unknown state and an operational alert.
9. A host/operator cannot view or mutate unrelated facilities.
10. Backup/restore and recovery from an API or vision-worker restart have been tested.

## 8. Backup and restore

Back up MySQL before migrations and on a recurring schedule. Keep encrypted copies off the application server and periodically test a restore. Example backup command from Bash:

```bash
docker compose -f docker-compose.production.yml exec -T db sh -lc 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysqldump -uroot --single-transaction --routines --triggers "$MYSQL_DATABASE"' > smartpark-backup.sql
```

Treat the generated SQL dump as sensitive customer/payment metadata. Encrypt it at rest, restrict access, set retention limits, and do not commit backups to Git.

The named volumes `smartpark_mysql_data`, `smartpark_marketplace_uploads`, `smartpark_caddy_data`, `smartpark_caddy_config` and `smartpark_yolo_cache` contain runtime state. Do not run `docker compose down -v` on a production deployment unless you intentionally want to destroy persistent data.

## 9. Known release limitations

- The application has automated unit tests for selected pure logic, but this workspace has not completed a live production Compose deployment, migration run against production MySQL, or a full browser-based end-to-end suite.
- Host earnings are an internal ledger. Automated owner payouts, full refund reversal/reconciliation workflows, and settlement integration require additional implementation and business-provider configuration.
- Rate limiting uses process-local memory. Use a shared rate-limit store before horizontally scaling API instances.
- Verify CSP allowlists against the exact Google Maps/Razorpay integrations enabled for the release.
- Confirm privacy notices, data retention, local payment/tax requirements and CCTV signage/consent for the deployment location.


## 10. Transactional email worker

The production Compose stack runs `email-worker` privately, without a published port. To inspect its logs:

```bash
docker compose -f docker-compose.production.yml logs --tail=100 email-worker
```

For local development, run `npm run worker:email` in a separate terminal after migrations 001–009 have been applied. With no SMTP host in development, messages are logged as `simulated` and are not delivered. To process the due queue once and exit, use `npm run worker:email:once`.
