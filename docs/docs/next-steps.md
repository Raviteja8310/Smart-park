# SmartPark implementation status

## Implemented feature foundations

- **Phase 1:** Original web/API/database structure and responsive dashboard foundation.
- **Phase 2:** Session-based authentication, account verification/password reset, server-side roles.
- **Phase 3:** Facility discovery, physical inventory, zones, slot management, staff assignment and availability summaries.
- **Phase 4:** Server-priced reservation quotes, temporary holds, overlapping-booking prevention, cancellation of unpaid holds and booking history.
- **Phase 5:** Razorpay checkout verification, development-only simulated checkout, reconciliation flags, signed QR tickets, gate entry/exit and transaction history.
- **Phase 6:** Shared-space listings, host availability/pricing, listing photos, vehicle garage and host-earnings ledger foundation.
- **Phase 7:** Python/OpenCV/YOLO vision service, configurable slot regions, stabilized occupancy events, camera health and private preview tickets.
- **Phase 8:** Operations dashboard, date-filtered verified revenue reports, per-facility occupancy reports, operational alert lifecycle and in-app notification inbox.
- **Phase 9:** Release hardening, production configuration validation, Docker deployment, proxy/TLS configuration and migration runner.
- **Phase 10:** Transactional email outbox, retrying SMTP worker, lifecycle email templates and production worker container.
- **Phase 11:** Customer refund requests, host payout requests, admin financial review, external reference tracking and audit records.
- **Phase 12:** Favorites, recent search history, completed-booking reviews, rating aggregates and moderation.
- **Phase 13:** Integration smoke tests, frontend/API route contracts, migration consistency checks, and release runbooks.
- **Phase 14:** Service-specific production configuration, least-privilege email worker, read-only application container filesystems where supported, temporary write mounts, capability/PID/resource limits.

## Database migration sequence

1. `database/migrations/001_initial_schema.sql`
2. `database/migrations/002_auth_sessions_and_verification.sql`
3. `database/migrations/003_parking_inventory.sql`
4. `database/migrations/004_payments_webhooks.sql`
5. `database/migrations/005_payment_reconciliation.sql`
6. `database/migrations/006_shared_parking_marketplace.sql`
7. `database/migrations/007_vision_detection.sql`
8. `database/migrations/008_operations_analytics_alerts.sql`
9. `database/migrations/009_transactional_email_outbox.sql`
10. `database/migrations/010_refunds_and_host_payouts.sql`
11. `database/migrations/011_favorites_search_reviews.sql`

Use `npm run migrate` for a fresh database; it tracks migration checksums and applied state. For an existing database that was migrated manually before the runner existed, back up and follow the baseline procedure in `docs/production-deployment.md`. Do not re-run successful SQL migrations manually.

## Phase 9 release hardening

1. Run a full dependency installation and frontend production build on the target machine.
2. Test migrations 001–010 against a disposable MySQL 8.4 database and a copy of representative data.
3. Add integration tests for role/facility isolation, bookings under concurrency, payment webhook idempotency, alert lifecycle and notification ownership.
4. Exercise real Razorpay test-mode orders/webhooks and document provider reconciliation procedure.
5. Complete deployment for API/web, durable image storage, reverse proxy, database backups, secrets and logging.
6. Complete real-camera inference validation at the target site, including darkness, glare, occlusion and camera outage.
7. Test Phase 10 transactional email deliverability, retry behavior, sender reputation and privacy on the chosen SMTP provider; SMS/push are still future integrations.
8. Phase 11 provides an audited manual refund and host-payout workflow. Automated provider refunds and bank payouts remain unimplemented; validate the external-reference process and reconcile every record with provider/bank reports.

## Known release limitations

- Full browser production build and real MySQL-backed end-to-end tests have not been run in the artifact-generation environment.
- The transactional email outbox supports the key booking and gate lifecycle events. General arbitrary-event email templates, SMS and push are not implemented; real SMTP deliverability still requires provider testing.
- Payment reconciliation resolution records the administrator's external reference; it does not execute a refund. A refund disposition must refer to an externally completed, verified refund.
- Host earnings are a ledger and not a bank transfer; automated payouts are not implemented.
- Camera detection requires site calibration and accuracy testing. Unknown/stale state must remain conservative.
- Map provider credentials, SMTP, production payment credentials, TLS, durable file storage and production secrets require environment-specific configuration.


## Phase 10: transactional email delivery

- Added an idempotent transactional email outbox (migration 009).
- Queues email for booking holds/cancellations, verified booking confirmations, and gate entry/exit events inside the related business transaction.
- Uses a separate worker with `FOR UPDATE SKIP LOCKED`, leases, retry backoff and a terminal failed state after eight attempts.
- Development-mode email without SMTP is logged as `simulated`, not reported as delivered.
- Production Compose starts a private worker container using the same API image; it has no public port.
- SMTP is at-least-once, not exactly-once. A provider acceptance followed by a worker crash before the database update can cause a duplicate email.


## Phase 10 validation performed

- API unit tests pass, including template allowlisting, HTML escaping, payload constraints, recipient eligibility, idempotency and bounded retry delay.
- Python vision tests continue to pass.
- The database-backed outbox claim/lock/retry path still requires integration testing against MySQL 8.4; this workspace has not executed it against a running database.
- SMTP acceptance, delayed/retried messages and duplicate-delivery behavior must be verified using the configured SMTP provider before public launch.


## Phase 11: financial operations

- Added migration 010 for refund requests, payout requests and earning allocations.
- Added explicit state transitions and audit notes for refund review, external completion, failures, and manual reconciliation.
- Added host payout request allocation and administrator review, with actual transfers intentionally external.
- Added customer transaction/refund UI, host earnings/payout history, and an admin financial operations queue.

## Phase 11 validation and release gaps

Pure API/helper tests cover refund and payout eligibility, status transitions, decimal arithmetic and external reference validation. A live MySQL migration test, concurrent booking/refund regression test, provider-side refund/payout verification, and full frontend production build remain required before public launch.


## Phase 12: discovery engagement

- Migration 011 adds per-account favorites, bounded recent search history and reviews unique per completed booking.
- Public parking cards show aggregate ratings and review count; public review content uses shortened reviewer names and omits booking IDs.
- The web app exposes a Saved & reviews workspace for managing favorites, reviewing eligible completed stays and returning to prior text/city searches.
- Before release, run migration 011 against disposable MySQL and verify route-level auth/ownership behavior, public aggregate rating performance and review moderation.


## Phase 12 validation and release gaps

- API unit tests cover search normalization, review payload constraints and privacy-safe review mapping.
- Test migration 011 on a clean/disposable MySQL 8.4 database and test ownership isolation for favorites/history/reviews.
- Run concurrent review submissions for one booking and verify the unique constraint and API 409 response.
- Confirm hidden reviews disappear from both review listings and aggregate rating counts, and verify moderator audit entries.
- Run Vite production build, browser tests and role-based end-to-end tests after `npm install`.


## Phase 13: integration and release checks

- Added `scripts/integration-smoke.mjs` for live API health, response-contract, security-header, Origin-guard, unauthorized-access, 404, and optional authenticated read checks.
- Added source-contract tests that compare all literal frontend API calls to the API route table, verify router mount points, confirm Razorpay raw-body parser order, check migration numbering and baseline coverage, and inspect production Compose assumptions.
- Added `docs/integration-testing.md` with local setup steps and a staging end-to-end checklist.
- Automated validation in this workspace: 88 API tests and 14 Python vision tests pass; API JavaScript syntax and Python compilation pass; Compose YAML files parse.

## Remaining environment-specific validation

- `npm install` could not reach `registry.npmjs.org` in this workspace (`EAI_AGAIN`), so no lockfile could be generated here and Vite is not installed. Run `npm install` on the development machine, commit the generated `package-lock.json`, and confirm `npm run build` passes before deploying.
- Run `npm run test:integration` with a migrated MySQL database and running API. Optional login collection checks require a verified, active staging account set through `SMARTPARK_SMOKE_EMAIL` and `SMARTPARK_SMOKE_PASSWORD`.
- Still required: real Razorpay staging order/webhook tests, SMTP delivery tests, backup/restore validation, HTTPS issuance, camera accuracy checks, and hardware gate acceptance testing.


## Phase 14: production least-privilege hardening

- API and email-worker environment configuration is now scoped by `SMARTPARK_PROCESS`. Keep `SMARTPARK_PROCESS=api` for the API and `SMARTPARK_PROCESS=email-worker` for the mail worker in production Compose.
- The mail worker receives no Razorpay credentials, QR-signing secret, vision token, or reverse-proxy trust configuration.
- Production Compose adds runtime hardening and conservative PID/memory controls to application containers while keeping MySQL private and preserving explicit persistent volumes for the database, user listing photos and Caddy state.
- No SQL migration is required.

## Phase 14 validation and remaining work

- Production rules and Compose contracts are covered with unit tests.
- This workspace has no Docker/MySQL runtime and no installed web dependencies, so it has not verified image startup, Nginx behavior with a read-only root, live migration/recovery, SMTP, payment APIs, TLS issuance or camera inference.
- Run the production Compose config/build checks and real staging acceptance checks on your deployment host. Review memory caps against measured usage before production traffic.

## Phase 15: final deployment verification (still required)

Phase 15 is not considered complete until all checks in `docs/release-checklist.md` are recorded against the intended deployment environment: clean dependency install and lockfile, frontend production build, API and vision test suites, fresh and upgrade migration paths, role isolation, booking/payment/QR workflows, email delivery/retry, refund/payout reconciliation, TLS, backup/restore, and camera accuracy.
