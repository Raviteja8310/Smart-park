# SmartPark Integration Testing

This guide separates automated helper tests from checks that require a running API, a migrated MySQL database, and (optionally) a verified test account.

## 1. Prerequisites

- Node.js 22 or newer and npm.
- MySQL 8.0+ (the included Docker Compose uses MySQL 8.4).
- Python 3.10+ if testing the computer-vision worker.
- A populated `.env` based on `.env.example`.

Install dependencies from the project root:

```powershell
npm install
```

Start MySQL if using the included Docker configuration, and apply the migrations through the project's migration runner after checking the existing database history:

```powershell
npm run db:up
npm run migrate
```

Start the API and frontend in one terminal:

```powershell
npm run dev
```

The API defaults to `http://127.0.0.1:4000`; the Vite development server defaults to `http://127.0.0.1:5173`.

## 2. Automated tests

Run the deterministic tests without requiring a running MySQL instance:

```powershell
npm run test:all
```

This runs API logic/contract tests and Python vision-service tests. Then verify the production frontend compiles:

```powershell
npm run build
```

## 3. Live HTTP integration smoke tests

Keep the API and MySQL running in one terminal. In a separate PowerShell terminal from the project root:

```powershell
npm run test:integration
```

The smoke test checks:

- API identity, Helmet/security headers and database health.
- Public parking discovery and inventory overview response shapes.
- Validation response for a malformed login request.
- Rejection of a disallowed browser Origin.
- Authentication requirements for bookings, vehicles, notifications, payments, refunds, favorites, search history, reviews and operations.
- Consistent JSON 404 handling for unknown API routes.

This script is read-mostly: it does not create bookings, payment orders, refunds, payouts, or camera events. It sends an intentionally malformed login request and a disallowed-Origin request to test guards.

Configure an optional, active, email-verified test account to exercise authenticated read endpoints and session invalidation after logout:

```powershell
$env:SMARTPARK_SMOKE_EMAIL = "verified-test-account@example.com"
$env:SMARTPARK_SMOKE_PASSWORD = "Use-a-real-test-password-here"
npm run test:integration
Remove-Item Env:SMARTPARK_SMOKE_EMAIL
Remove-Item Env:SMARTPARK_SMOKE_PASSWORD
```

If the API is at another address, set `SMARTPARK_API_URL` (for example `http://127.0.0.1:4000`). The optional credential checks create and revoke a new smoke-test session; they do not delete existing user sessions.

A failing health endpoint generally means the API is unavailable or the database is not connected. A 500 on a collection endpoint after health passes can indicate a missing migration or an API/schema mismatch.

## 4. End-to-end scenario before deployment

Use a disposable staging database and provider test credentials. Do not run destructive or real-money tests against production.

1. Register a driver, verify the account and sign in.
2. Create a vehicle, publish/approve a test facility, add a slot and configure an active price rule.
3. Request a price quote and hold a slot. Attempt an overlapping hold in a second session; the second hold must be rejected.
4. Complete test checkout and verify that the booking only becomes confirmed after server-side payment verification.
5. Retrieve a signed QR ticket, scan it as an authorized attendant, record entry and exit, and verify the resulting parking session.
6. Confirm the payment/receipt and transactional email outbox state. A development-simulated email must not be represented as SMTP-delivered.
7. Request a refund on an eligible future booking and verify the admin transition flow. For real-provider staging tests, record a refund only after verifying it externally.
8. Complete a test session, submit one review, verify that a second review for that booking is rejected, and confirm moderation affects public rating totals.
9. Configure a test camera/video, verify stable occupancy updates, stop its heartbeat and confirm its mapped spaces become unknown rather than available.
10. Restart the API, database and workers as appropriate; verify data persists and the services recover.

## 5. Single release verification command

Once dependencies are installed, MySQL is migrated, and the API is running, run:

```powershell
npm run verify:release
```

This executes automated tests, builds the frontend, and runs the live HTTP smoke suite. The command intentionally fails if a required release check fails.

## What these tests do not prove

Passing this suite does not guarantee live payment provider success, email deliverability, backup restore, production HTTPS issuance, camera inference accuracy, hardware gate compatibility, load capacity or legal/privacy compliance. Those require provider, infrastructure and real-environment tests before public launch.
