# SmartPark architecture

## Services
- `apps/web`: responsive React application and role-aware workspace UI.
- `services/api`: Express REST API; owns authentication, authorization, booking/pricing transactions, payment verification, notifications, operational analytics and alerts.
- `database`: ordered MySQL 8 migrations (001–008).
- `services/vision`: Python FastAPI/OpenCV/YOLO service; sends authenticated time-stamped occupancy observations to the API.
- `services/api/uploads/marketplace`: local development storage for public parking listing photos; production should use durable shared/object storage.

## Source of truth

MySQL is authoritative for accounts, roles, sessions, parking facilities, slots, rates, reservations, payments, gate sessions, host earnings, occupancy event history, notifications and operational alerts. No client-supplied payment amount, role, booking status or camera classification is authoritative by itself.

## Authentication and authorization

- Passwords are stored as hashes. Session tokens are random, HttpOnly-cookie credentials and only hashes are stored server-side.
- Public registration can only assign the driver role; privileged roles come from a trusted administrative operation.
- Every private query checks the signed-in user and facility scope. Admins are platform-wide; hosts see owned facilities; operators and attendants are constrained to staff assignments.
- Operational reports filter through this same facility scope. Attendants can view/acknowledge permitted facility alerts but cannot access revenue analytics or resolve manager-level alerts.
- Notifications can only be read/changed by their owner.
- Camera feeds and event submission are protected by service credentials and short-lived stream tickets. Raw stream references must not be returned to browsers.

## Reservation and occupancy states

A slot has separate operational state, physical state and booking state. Availability is computed from operational status, a known physical observation and active reservation conflicts. Unknown or stale camera evidence is not considered empty. Payment capture is confirmed only by provider verification/webhook and an eligible booking transition. When a captured payment cannot safely confirm a booking, it remains flagged for reconciliation and does not receive a valid entry ticket.

## Operations and alert state

The operations API provides facility-scoped inventory/active-booking totals, verified revenue grouped by currency, current occupancy by facility and alert lifecycle. Revenue report windows are interpreted in UTC and capped at 366 calendar days. Only paid records without a reconciliation flag are included. System-generated alerts currently monitor stale/offline camera feeds and captured payments marked `needs_reconciliation`.

An alert's `condition_active` field tracks whether the monitored incident is still present. An alert can be acknowledged while work is in progress. Camera alerts auto-resolve when the feed is healthy/disabled and reopen if the incident later recurs. Payment reconciliation closure is admin-only, requires a documented external reference, and records whether a refund was already handled externally or the payment was retained after review; it does not initiate refunds or change booking status.

## Notifications

`notifications` is a user-owned in-app event history. Booking holds/cancellations, paid booking confirmations, gate entry/exit and first detection of system alerts create records. The API supports user-owned inbox retrieval and read status changes. Email verification has its own configured mail pathway; general business-event email/SMS/push dispatch is not yet a production worker.

## Production dependencies

- Web/API: Node.js, npm workspace install, React/Vite production build and Express API.
- Database: MySQL 8.4 with migrations 001–008 applied once.
- Vision: supported Python runtime, OpenCV, optional Ultralytics/PyTorch model and configured cameras/slot polygons.
- Payments: configured provider keys, verified signatures/webhooks and operational reconciliation.
- Infra: HTTPS reverse proxy, private database/vision network paths, strong secrets, durable uploads/model files, tested backups and monitored logs.

See `docs/deployment-security-checklist.md` and `docs/operations-runbook.md` before production deployment.
