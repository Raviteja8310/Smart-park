# SmartPark architecture

## Services
- `apps/web`: responsive React application; browser requests `/api/*` via Vite proxy in development.
- `services/api`: Express REST API; owns authentication, validation, authorization and business transactions.
- `database`: ordered SQL migrations for MySQL 8.
- `services/vision`: planned Python/OpenCV service; will submit authenticated occupancy events to the API.

## Authentication and source of truth
- MySQL is authoritative for users, roles, sessions, lots, slots, pricing, reservations and payment records.
- Passwords are hashed with Node.js `scrypt`; random session tokens are held in HttpOnly cookies, with only token hashes stored in MySQL.
- Account verification and password reset use random, single-use tokens stored as hashes with expiry.
- Public registration assigns only the `driver` role. Privileged roles are assigned from trusted administrative operations.
- Browser write requests are checked against the configured web origin, and session cookies use `SameSite=Strict`.
- The vision service contributes timestamped physical-occupancy observations; it must not decide booking availability by itself.
- Client-side state is never authoritative for payments or booking conflicts.

## Development URLs
- Web: http://127.0.0.1:5173
- API: http://127.0.0.1:4000
- API health: http://127.0.0.1:4000/api/health

## Before public deployment
- Configure HTTPS, production secrets, SMTP email delivery and a production database.
- Replace the in-memory rate limiter with a shared store if running multiple API replicas.
- Add service-to-service authentication for camera events.
- Complete booking concurrency controls, payment verification, QR validation and role-protected business endpoints.
- Configure audit retention, backups, monitoring and tested recovery procedures.
- Review and apply migrations carefully; never run initialization SQL against a non-empty database without checking schema and taking a backup.
