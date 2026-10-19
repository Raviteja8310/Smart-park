# SmartPark

An original, web-first smart parking platform. The project is being built as a new codebase; legacy source code is not copied into it. Native mobile applications are outside the initial scope.

## Current implementation

### Phase 1 foundation
- React + Vite web app with a responsive dashboard (dashboard metrics/bookings are clearly illustrative until data APIs are implemented).
- Node.js + Express API with helmet, CORS and a database health endpoint.
- MySQL 8 schema for users, roles, vehicles, parking lots, zones, slots, pricing, bookings, sessions, payments, cameras, occupancy events, notifications and audit logs.

### Phase 2 authentication
- Driver registration with email verification.
- Password reset links with expiry and automatic session revocation after a password change.
- Passwords hashed using Node.js `scrypt`; plain-text passwords are never stored.
- Opaque random server sessions; only the session token hash is stored in MySQL.
- HttpOnly, SameSite=Strict session cookies (Secure in production).
- Login, logout, current-user endpoint and role-checking middleware.
- Basic API origin guard and in-memory rate limits for registration/login/resend routes.
- Verification-email support through SMTP; local development prints the verification link to the API terminal.
- CLI role assignment for active, verified users.

## Prerequisites
- Node.js 20+ recommended.
- npm.
- Docker Desktop (optional, for the included MySQL container) or a local MySQL 8 installation.

## Windows PowerShell setup

1. Copy the environment template and edit passwords:

   ```powershell
   Copy-Item .env.example .env
   ```

2. Install dependencies:

   ```powershell
   npm install
   ```

3. Start MySQL using Docker:

   ```powershell
   npm run db:up
   ```

   Alternatively configure `.env` to use a local MySQL 8 instance.

4. Apply the schema migrations in order. The DB user in `.env` needs permission to create tables and indexes:

   ```powershell
   Get-Content -Raw .\database\migrations\001_initial_schema.sql | mysql -h 127.0.0.1 -P 3306 -u smartpark_app -p smartpark
   Get-Content -Raw .\database\migrations\002_auth_sessions_and_verification.sql | mysql -h 127.0.0.1 -P 3306 -u smartpark_app -p smartpark
   ```

   Enter the value of `DB_PASSWORD` from `.env` when prompted. If you have already applied migration `001`, do not run it again against a database with data unless you have checked the schema and have a backup. Migration `002` can be applied after `001`.

5. Start the web app and API:

   ```powershell
   npm run dev
   ```

6. Open http://127.0.0.1:5173. The API health check is http://127.0.0.1:4000/api/health.

## Authentication flow in local development

1. Create an account on the web sign-in screen. Public registration can only assign the `driver` role.
2. The API terminal logs a one-time verification URL because SMTP is not required for local development.
3. Open that URL in the same browser, then return to sign in.
4. After sign-in, the backend sets the HttpOnly session cookie and `/api/auth/me` returns the current user.

To configure real email delivery, set `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, and `MAIL_FROM`. **Production registration is blocked when SMTP host configuration is missing.** Verify your email provider settings and delivery in a staging environment before launch.

## Assigning roles during development

Self-service registration must not allow a visitor to become an administrator. Register and verify an account first, then grant a role from a trusted development terminal:

```powershell
npm run role:grant --workspace @smartpark/api -- user@example.com admin
npm run role:grant --workspace @smartpark/api -- host@example.com host
```

Supported roles: `driver`, `host`, `attendant`, `operator`, `admin`. Treat access to the database and this CLI command as privileged. An application-facing role-management UI will be implemented in a later phase.

## Tests and build

```powershell
npm run test:api
npm run build
```

The API tests currently cover password hashing and opaque-token helpers. Database-backed integration tests require a configured MySQL instance and will be added as the API modules expand.

## Important limitations

- The booking rows, parking-slot counts and analytics on the dashboard are illustrative preview data; they are not yet returned by production APIs.
- The schema has placeholders for booking, payment, wallet, camera and occupancy functionality, but those workflows are not implemented just because tables exist.
- Payment processing, booking conflict protection, QR gate validation, the actual vision detector and production deployment pipelines are future phases.
- The in-process login rate limiter is for development/single-instance use. A horizontally scaled production deployment should use a shared rate-limit store.
- Before public deployment, configure HTTPS, SMTP, a production database, backups, monitoring, secrets, migrations, and reviewed access policies.
