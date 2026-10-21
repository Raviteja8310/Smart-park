# SmartPark implementation status

## Implemented feature foundations

- **Phase 1:** Original web/API/database structure and responsive dashboard foundation.
- **Phase 2:** Session-based authentication, account verification/password reset, server-side roles.
- **Phase 3:** Facility discovery, physical inventory, zones, slot management, staff assignment and availability summaries.
- **Phase 4:** Server-priced reservation quotes, temporary holds, overlapping-booking prevention, cancellation of unpaid holds and booking history.
- **Phase 5:** Razorpay checkout verification, development-only simulated checkout, reconciliation flags, signed QR tickets, gate entry/exit and transaction history.
- **Phase 6:** Shared-space listings, host availability/pricing, listing photos, vehicle garage and host-earnings ledger foundation.
- **Phase 7:** Python/OpenCV/YOLO vision service, configurable slot regions, stabilized occupancy events, camera health and private preview tickets.
- **Phase 8:** Operations dashboard, date-filtered verified revenue reports, per-facility occupancy reports, operational alert lifecycle, in-app notification inbox, deployment/security checklist and operations runbook.

## Database migration sequence

1. `database/migrations/001_initial_schema.sql`
2. `database/migrations/002_auth_sessions_and_verification.sql`
3. `database/migrations/003_parking_inventory.sql`
4. `database/migrations/004_payments_webhooks.sql`
5. `database/migrations/005_payment_reconciliation.sql`
6. `database/migrations/006_shared_parking_marketplace.sql`
7. `database/migrations/007_vision_detection.sql`
8. `database/migrations/008_operations_analytics_alerts.sql`

Apply every migration once, in order, on a fresh database. On an existing database apply only not-yet-applied migrations after backup and schema verification. These migrations are not an automatic migration runner; maintain your own deployment record.

## Next priorities: Phase 9 release hardening

1. Run a full dependency installation and frontend production build on the target machine.
2. Test migrations 001–008 against a disposable MySQL 8.4 database and a copy of representative data.
3. Add integration tests for role/facility isolation, bookings under concurrency, payment webhook idempotency, alert lifecycle and notification ownership.
4. Exercise real Razorpay test-mode orders/webhooks and document provider reconciliation procedure.
5. Complete deployment for API/web, durable image storage, reverse proxy, database backups, secrets and logging.
6. Complete real-camera inference validation at the target site, including darkness, glare, occlusion and camera outage.
7. Add external notification dispatch (SMTP/queue for business event emails, plus optional push/SMS) only after deliverability, retry and privacy behavior is tested.
8. Add audited refund-provider execution and host payouts only when the payment provider integration and business policy are ready.

## Known release limitations

- Full browser production build and real MySQL-backed end-to-end tests have not been run in the artifact-generation environment.
- The in-app notification inbox is implemented. General business-event email/SMS/push delivery is not yet a full production dispatch worker.
- Payment reconciliation resolution records the administrator's external reference; it does not execute a refund. A refund disposition must refer to an externally completed, verified refund.
- Host earnings are a ledger and not a bank transfer; automated payouts are not implemented.
- Camera detection requires site calibration and accuracy testing. Unknown/stale state must remain conservative.
- Map provider credentials, SMTP, production payment credentials, TLS, durable file storage and production secrets require environment-specific configuration.
