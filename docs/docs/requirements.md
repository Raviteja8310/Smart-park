# SmartPark requirements

## Product goal

Build an original web-first smart parking platform for discovery, shared/private parking listings, reservations, payment verification, gate entry/exit, camera-based occupancy, owner operations and administration. Native mobile applications are out of scope for the first deployment; the web UI is responsive and the business API is intended to support future clients.

## Roles

- **Driver:** discover parking, manage vehicles, reserve and pay, retrieve QR tickets and receipts, review bookings/notifications.
- **Host:** publish parking listings, define rates and availability, manage photos, bookings and earnings-ledger records.
- **Attendant:** manage walk-in sessions/gate entry/exit and view/acknowledge alerts for assigned facilities.
- **Facility operator:** manage assigned lots, inventory, rates, cameras, occupancy and facility-level reports/alerts.
- **Administrator:** manage platform users, roles, facilities, moderation, operational analytics, alert reconciliation records and security operations.

## Core business rules

1. One API and database are authoritative for booking, pricing, payments, identities and inventory.
2. Physical occupancy, reservation state and operational state are separate.
3. A space is bookable only when the facility/slot are operational, eligibility passes, the time interval is valid, and no overlapping active reservation exists.
4. Quotes and booking amounts are calculated on the server from active pricing rules.
5. Payment success requires provider verification or authenticated provider webhook processing. Idempotency prevents duplicate confirmation.
6. A confirmed booking QR credential must be server-verifiable and must not expose sensitive personal information.
7. Camera events update observed physical state only. Unknown/stale readings must not imply availability.
8. Host earning ledger entries are not a payout; outbound settlement must be separate and auditable.
9. Every private operation checks user/facility scope server-side.
10. Operational revenue reports exclude payment rows flagged for reconciliation and group monetary data by currency rather than summing different currencies together.
11. Payment reconciliation decisions are audited with administrator identity, note and external case/provider reference. Recording an external refund must not be confused with executing the refund.
12. The in-app notification inbox is private to the signed-in user. External notification channels require their own delivery/retry and provider configuration.

## Functional modules

- Account registration, verification, password recovery, sessions and role-based permissions.
- Facility/zone/slot inventory, operator/attendant assignment, current parking sessions and walk-in records.
- Parking discovery, shared host listings, photos, amenity fields, schedules, hourly/daily/weekly/monthly pricing and registered vehicles.
- Reservation quotes, temporary holds, conflict prevention, payment processing/reconciliation, QR tickets and gate workflows.
- Python/OpenCV/YOLO camera service, polygon-to-slot mapping, stabilized empty/occupied/unknown observations, service health and private preview.
- Host/operations dashboard, verified revenue/occupancy reports, operational alerts, in-app notifications and deployment runbooks.

## Release readiness

See `docs/deployment-security-checklist.md`. Required release tasks include a clean dependency installation, frontend production build, disposable MySQL migration test, database-backed API integration tests, provider sandbox test, permission-isolation tests, backups/restore test and real camera/site validation.
