# SmartPark requirements — initial baseline

## Product goal
Build an original, responsive web-first smart parking platform that unifies public parking operations, shared/private parking listings, reservations, payments, entry/exit and camera-based occupancy. A native iOS app is out of scope for the initial build.

## Roles
- Driver: discover parking, manage vehicles, book, pay, receive a QR pass and review booking history.
- Host: publish parking listings, define rates/availability, manage reservations and view verified earnings.
- Attendant: manage walk-in sessions, tickets, entry and exit.
- Facility operator: manage assigned lots, inventory, rates, cameras and reports.
- Administrator: manage users, roles, facilities, platform configuration, security events and reconciliation.

## Core business rules
1. One central API and database are authoritative for booking, pricing, payments and inventory.
2. A slot has distinct physical occupancy, reservation and operational states.
3. A slot is bookable only if the facility and slot are operational, eligibility rules pass, and no conflicting active reservation or session exists for the requested interval.
4. Booking intervals and prices are validated on the server.
5. A payment success is accepted only after server-side provider verification or authenticated webhook processing.
6. Payment events and booking creation must be idempotent.
7. QR credentials must be validated against server-side booking state and must not expose sensitive personal data.
8. Camera events update observations, not reservation state. Stale or uncertain observations must not be presented as reliable availability.
9. Financial ledger entries are append-only; balances are derived from verified entries.
10. Access is checked server-side for every private resource.

## Initial release milestones
- Workspace and API health check
- Schema and database migrations
- Authentication and role permissions
- Parking inventory and operator session workflows
- Discovery and host listings
- Time-based booking and pricing
- Payments, QR entry/exit
- Computer vision and real-time occupancy events
- Administration, notifications, testing and deployment

## UI data status
The Phase 3 dashboard inventory metrics, facility discovery and slot inventory are connected to the API. Recent booking rows remain illustrative placeholders until the reservation phase is implemented. The optional `seed:demo` command creates clearly named local test data; do not keep that fixture in production.
