# SmartPark release checklist

## Build and configuration
- [ ] `npm run preflight:production` passes without printing secrets.
- [ ] `docker compose -f docker-compose.production.yml config --quiet` passes.
- [ ] Web and API container images build from clean caches.
- [ ] `npm run test:api` and Python unit tests pass.
- [ ] `npm run build` succeeds.
- [ ] No `.env`, database dump, credentials, camera URL credentials, uploaded photos or model weights are tracked in Git.

## Database and deployment
- [ ] Fresh database migration path tested from 001 through 011.
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

- [ ] Refund processing has been tested against provider sandbox; every successful refund has an externally verified reference.
- [ ] Host payout requests reconcile to allocated earning rows; transfer references are verified against bank/provider records.
- [ ] Refund-processing entry lock, failure/recovery and manual-review paths tested using a real disposable MySQL 8 instance.

- [ ] Verify favorite ownership isolation, recent-search deletion, completed-booking review eligibility, unique-review constraint and administrator moderation against MySQL.
- [ ] Confirm public review responses never expose booking IDs, email addresses or full reviewer names.

## Phase 13 — Integration validation

- [ ] `npm run test:all` passes.
- [ ] `npm run build` completes without errors.
- [ ] Apply migrations with the controlled migration runner; verify history has no `running` or `failed` entry.
- [ ] Start the API with the migrated MySQL database and verify `/api/health` reports `database: connected`.
- [ ] Run `npm run test:integration`; verify API identity, public inventory response shapes, authentication boundaries, Origin guard, and 404 contract.
- [ ] With a verified staging account set `SMARTPARK_SMOKE_EMAIL` and `SMARTPARK_SMOKE_PASSWORD`, run the integration smoke suite again to exercise authenticated read endpoints and session revocation.
- [ ] Complete the manual end-to-end scenarios in `docs/integration-testing.md` using test-only payment credentials and test data.
- [ ] Verify browser and API access, payment/webhook, email-worker, and camera/vision behavior in the intended deployment environment.

A passing smoke test is not equivalent to production certification. Payment providers, SMTP, TLS issuance, database restore, camera detection accuracy and gate hardware require environment-specific validation.
