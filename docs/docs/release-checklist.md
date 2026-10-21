# SmartPark release checklist

## Build and configuration
- [ ] `npm run preflight:production` passes without printing secrets.
- [ ] `docker compose -f docker-compose.production.yml config --quiet` passes.
- [ ] Web and API container images build from clean caches.
- [ ] `npm run test:api` and Python unit tests pass.
- [ ] `npm run build` succeeds.
- [ ] No `.env`, database dump, credentials, camera URL credentials, uploaded photos or model weights are tracked in Git.

## Database and deployment
- [ ] Fresh database migration path tested from 001 through 009.
- [ ] Existing-database baseline path tested only on a verified backup/schema.
- [ ] MySQL has no public host port.
- [ ] Web/API containers run non-root where supported and have health checks.
- [ ] Runtime photos, database files and Caddy certificates use persistent volumes.
- [ ] HTTPS certificate issuance/renewal and HTTP-to-HTTPS redirect verified.
- [ ] Backup restore and rollback procedure tested.

## Business and security
- [ ] Production uses Razorpay, not mock payments.
- [ ] Email verification/password reset and transactional event emails use the deployed HTTPS origin and verified SMTP sender.
- [ ] `email-worker` starts without public ports, drains an outbox message, retries a simulated SMTP failure, and records terminal failures after the attempt limit.
- [ ] Development-mode outbox rows are marked `simulated`, never falsely reported as delivered.
- [ ] Production worker logs contain no SMTP password, recipient/body payloads, or payment credentials; development-only message logging is kept local and is not shared.
- [ ] Role and facility isolation tested with separate driver/host/operator/admin accounts.
- [ ] Booking concurrency, payment idempotency, QR replay/expiry, and entry/exit tested.
- [ ] Alerts and notifications scoped correctly by facility/account.
- [ ] Vision stale state, camera outage, model failure, and manual correction tested onsite.
- [ ] Legal/privacy, retention and CCTV requirements reviewed for the deployment jurisdiction.

## Go/no-go
- [ ] All mandatory checks above have a recorded pass/fail result and owner.
- [ ] No unresolved critical security/payment/booking issue remains.
- [ ] Monitoring, on-call contact and rollback decision are documented.
