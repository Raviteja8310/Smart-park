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

Use `npm run migrate` for a fresh database; it tracks migration checksums and applied state. For an existing database that was migrated manually before the runner existed, back up and follow the baseline procedure in `docs/production-deployment.md`. Do not re-run successful SQL migrations manually.

## Phase 9 release hardening

1. Run a full dependency installation and frontend production build on the target machine.
2. Test migrations 001–009 against a disposable MySQL 8.4 database and a copy of representative data.
3. Add integration tests for role/facility isolation, bookings under concurrency, payment webhook idempotency, alert lifecycle and notification ownership.
4. Exercise real Razorpay test-mode orders/webhooks and document provider reconciliation procedure.
5. Complete deployment for API/web, durable image storage, reverse proxy, database backups, secrets and logging.
6. Complete real-camera inference validation at the target site, including darkness, glare, occlusion and camera outage.
7. Test Phase 10 transactional email deliverability, retry behavior, sender reputation and privacy on the chosen SMTP provider; SMS/push are still future integrations.
8. Add audited refund-provider execution and host payouts only when the payment provider integration and business policy are ready.

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
