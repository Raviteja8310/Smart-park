# SmartPark implementation status

## Completed foundation in the source tree
- Phase 1: web/API/database structure and dashboard foundation.
- Phase 2: secure session-based authentication, verification/password reset, role checks.
- Phase 3: facility discovery and summaries, owner/manager facility inventory, zones, bulk slots, current physical status, staff assignment and UI integration.

## Current database migration sequence
1. `database/migrations/001_initial_schema.sql`
2. `database/migrations/002_auth_sessions_and_verification.sql`
3. `database/migrations/003_parking_inventory.sql`

Always back up persistent data before applying schema changes. Apply each migration only once per database.

## Next phase
Phase 4 should implement a reservation engine with interval-based conflict protection, pricing quotes from server-owned pricing rules, temporary holds, cancellation/expiry handling and a real booking history API. Payment integration must come only after the booking transaction model is stable.

## Known limitations
- `My bookings` and recent booking rows are still UI placeholders; no booking API is implemented yet.
- Pricing rules are queried for display but no configurable pricing administration is present.
- Physical occupancy can be changed manually; the computer-vision service has not yet been connected.
- Map links use coordinates when available; an interactive map and Google Maps/Places credentials have not been configured.
- The API requires all three database migrations before the Phase 3 endpoints will work.

- Migration 012 extends shared parking listings with optional surface type, typical bay dimensions, and maximum vehicle height; the owner form supports create and edit.


## Phase 4 — Owner verification workflow (migration 014)

- Hosts can submit a manual owner-verification application with legal name, contact phone, property relationship, evidence type, and optional last four digits of a document reference.
- Administrators can review pending applications, approve them, or reject them with a reason. Decisions are recorded in `audit_logs`.
- The owner sees the latest application status and review note. The interface intentionally does not collect full government ID numbers or public document URLs.
- This is a manual review record, not an automated identity check. Verify evidence using the organization's approved process and a secure document-handling channel before approving.
- Apply `database/migrations/014_owner_verification.sql` after backup and migration-history verification.
