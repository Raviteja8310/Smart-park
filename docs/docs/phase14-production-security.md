# Phase 14 — production security and deployment configuration

This phase tightens service privilege and clarifies how secrets should be scoped. It does not certify the complete system for production.

## What changed

- `SMARTPARK_PROCESS=api` uses the full production validation set because the API handles payment verification, signed parking tickets and vision-service authentication.
- `SMARTPARK_PROCESS=email-worker` requires only the shared database credentials, HTTPS web origin and SMTP credentials it uses. It does not need Razorpay keys, QR signing keys, vision service tokens, or proxy trust configuration.
- Production Compose gives the API, email worker and web server read-only root filesystems, with explicit temporary writable mounts for runtime/cache paths; API marketplace uploads remain on their named persistent volume.
- Application containers use `no-new-privileges`, and capabilities are dropped for the API, mail worker and non-root vision service where supported. Web/worker/API services have PID and memory bounds. Caddy retains the network capability needed to bind the public HTTP/HTTPS ports.
- No database migration is introduced.

## Operator steps

1. Copy `.env.example` to `.env`; never commit or share `.env`.
2. Use independently generated secrets for database, payment webhook, QR signing, and vision service authentication. Keep a separate password for MySQL's root account.
3. Verify `APP_DOMAIN` resolves to the server and `WEB_ORIGIN` exactly matches `https://APP_DOMAIN`.
4. Configure verified SMTP sender/credentials and the correct TLS/STARTTLS mode for that mail provider.
5. Configure Razorpay credentials and webhook secret according to the target environment. Test using provider test mode in staging. Do not enable live payment acceptance until the provider's verification and reconciliation flow has passed.
6. Run `npm run preflight:production`. It validates configuration, not connectivity.
7. Run `docker compose -f docker-compose.production.yml config --quiet` and build the images on the target deployment host.
8. Start on a disposable database first; test migrations and rollback/restore before applying to data that matters.
9. Confirm the `email-worker` service environment contains only the DB/site-origin/SMTP values required to deliver outbox emails.
10. Observe actual memory use and worker backlogs after startup. The included limits are starting defaults and must be reviewed for expected traffic and camera workload.

## Release checks

- [ ] `npm install` succeeds and root `package-lock.json` is committed.
- [ ] `npm run test:all` passes.
- [ ] `npm run build` passes with the actual web dependencies.
- [ ] `npm run preflight:production` passes without printing secrets.
- [ ] Production Compose config and clean image builds pass.
- [ ] Fresh database migration and existing-schema baseline paths are tested against disposable MySQL.
- [ ] API health reports database connectivity.
- [ ] API/web/email-worker containers start under read-only/security settings and can process the expected workflows.
- [ ] Razorpay sandbox order, callback signature and webhook verification are tested.
- [ ] SMTP delivery, failure retry and terminal outbox handling are tested.
- [ ] TLS issuance/renewal, backup/restore, monitoring and incident contacts are confirmed.
- [ ] Camera streams, region calibration and stale/unknown behavior are tested on the intended site.
- [ ] Dependency and container image vulnerabilities have been reviewed and documented.

## Important limitations

- Rate limiting is process-local; use shared storage before running multiple API replicas.
- Payment-provider, bank transfer, SMTP, DNS/TLS, database restore and camera behavior cannot be validated by static tests alone.
- The API upload volume must remain writable; otherwise listing-photo uploads fail.
- Read-only root filesystems and temporary Nginx paths need a real container smoke test before deployment.
- Configure secret rotation, logs/metrics collection, off-host encrypted backup retention, privacy/camera notices and any jurisdiction-specific compliance independently.
