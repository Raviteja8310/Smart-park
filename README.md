# SmartPark

> Smart parking for drivers, facility owners, operators, and administrators.

This is the single source of truth for SmartPark product behavior, setup, architecture, API contracts, operations, security, testing, release readiness, and project history.

## Contents

- [Quick start and product overview](#quick-start-and-product-overview)
- [Consolidated reference documentation](#consolidated-reference-documentation)
- [Documentation sources](#documentation-sources)

## Quick start and product overview

An original, web-first smart-parking platform combining facility inventory, shared parking listings, bookings, payment verification, QR access, operator workflows and camera-based occupancy detection.

## Phase 14: production least-privilege hardening

The production Compose stack now runs the API, web server and email worker with hardened runtime settings where supported (read-only root filesystems, temporary writable mounts, resource/PID limits and `no-new-privileges`). The email worker uses `SMARTPARK_PROCESS=email-worker` and receives only database/site-origin/SMTP credentials; payment, QR-signing and vision-service secrets are not passed to that container. API-only settings stay with the API.

Review `README.md#documentation-source-docs-phase14-production-security-md` before deploying. A static preflight or passing unit tests is not a substitute for testing a clean build, migrated MySQL database, HTTPS, provider sandbox, SMTP, backup restore and camera hardware in staging.

## Phase 9: release hardening and deployment

Production deployment files are provided under `deployment/` and in `docker-compose.production.yml`. Read `README.md#documentation-source-docs-production-deployment-md` before deploying. Production requires a real public DNS name, HTTPS, SMTP, live Razorpay configuration, strong independent secrets, a backup plan, and a tested database migration path. Do not use mock payments with `NODE_ENV=production`.

The included production stack uses Caddy for public HTTPS, Nginx for static frontend/reverse-proxy routing, Express for the API, MySQL on a private Docker network, and an optional vision profile. The vision service is optional because its YOLO/PyTorch image is large; enable it only after preparing the required compute and validating the camera layout.

Before deployment, run `npm run preflight:production`, then validate Compose using `docker compose -f docker-compose.production.yml config --quiet`. The preflight checks configuration only; it cannot prove DNS, SMTP, Razorpay credentials, database connectivity, or camera accuracy.

## Current implementation status

- The responsive web application, API, database migrations and Python vision service are included in this project.
- Automated API helper tests and Python unit tests cover selected logic paths. They do not replace full MySQL-backed integration and browser tests.
- Payment checkout needs provider-specific staging verification. Host earnings are an internal ledger, not an automated bank payout.
- Computer vision requires a YOLO model, supported camera source, calibrated per-space polygons and on-site validation before it can be trusted.
- Production deployment has not been certified in this workspace; follow the checklist and record the result of every release test.

---

## Current implementation

Release hardening and production deployment instructions: `README.md#documentation-source-docs-production-deployment-md`, `README.md#documentation-source-docs-release-checklist-md`, and `README.md#documentation-source-docs-deployment-security-checklist-md`.

### Phase 1 foundation
- React + Vite web app with a responsive dashboard, parking discovery and slot reservation flow.
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

### Phase 3 parking inventory
- Database-backed active-facility discovery and live inventory summary.
- Host facility creation, draft review workflow and admin publication controls.
- Parking zones, bulk space creation and manually updated physical state.
- Separate physical, reservation and operational states; unknown spaces are not advertised as available.
- Facility-specific operator/attendant assignments.
- Search and management views connected to the parking API.

### Phase 4 reservation holds and pricing
- Server-calculated booking quotes using active hourly, daily, weekly or monthly pricing rules. Slot-specific rules take precedence over lot-wide rules of the same rate type.
- Booking interval validation (minimum 30 minutes, maximum 30 days) and UTC normalization.
- Conflict checks across overlapping booking intervals, with a slot row locked inside the creation transaction to serialize competing reservation holds.
- Ten-minute temporary holds that expire automatically and are not marked as paid or confirmed.
- Cancellation of unpaid holds and audit events. Paid-booking cancellation remains disabled until a verified payment/refund flow exists.
- Real booking history and status filtering; the overview no longer relies on hard-coded sample booking rows.
- Reservation UI with start date/time, duration, price breakdown and hold confirmation.

## Prerequisites
- Node.js 22+ recommended (required by the production container images).
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

4. Apply the schema migrations in order. For a fresh development database, use the migration runner:

   ```powershell
   npm run migrate
   ```

   The DB user in `.env` needs permission to create tables and indexes. On an existing database where migrations were applied manually before the runner was introduced, see `README.md#documentation-source-docs-production-deployment-md` for the schema-checking baseline command. Do not run the full migration chain against a manually migrated database without baselining it first.

   The SQL files remain available for inspection and controlled manual recovery:

   ```powershell
   Get-Content -Raw .\database\migrations\001_initial_schema.sql | mysql -h 127.0.0.1 -P 3306 -u smartpark_app -p smartpark
   Get-Content -Raw .\database\migrations\002_auth_sessions_and_verification.sql | mysql -h 127.0.0.1 -P 3306 -u smartpark_app -p smartpark
   Get-Content -Raw .\database\migrations\003_parking_inventory.sql | mysql -h 127.0.0.1 -P 3306 -u smartpark_app -p smartpark
   Get-Content -Raw .\database\migrations\004_payments_webhooks.sql | mysql -h 127.0.0.1 -P 3306 -u smartpark_app -p smartpark
   Get-Content -Raw .\database\migrations\005_payment_reconciliation.sql | mysql -h 127.0.0.1 -P 3306 -u smartpark_app -p smartpark
   Get-Content -Raw .\database\migrations\006_shared_parking_marketplace.sql | mysql -h 127.0.0.1 -P 3306 -u smartpark_app -p smartpark
   Get-Content -Raw .\database\migrations\007_vision_detection.sql | mysql -h 127.0.0.1 -P 3306 -u smartpark_app -p smartpark
   Get-Content -Raw .\database\migrations\008_operations_analytics_alerts.sql | mysql -h 127.0.0.1 -P 3306 -u smartpark_app -p smartpark
   Get-Content -Raw .\database\migrations\009_transactional_email_outbox.sql | mysql -h 127.0.0.1 -P 3306 -u smartpark_app -p smartpark
   Get-Content -Raw .\database\migrations\010_refunds_and_host_payouts.sql | mysql -h 127.0.0.1 -P 3306 -u smartpark_app -p smartpark
   Get-Content -Raw .\database\migrations\011_favorites_search_reviews.sql | mysql -h 127.0.0.1 -P 3306 -u smartpark_app -p smartpark
   Get-Content -Raw .\database\migrations\012_shared_listing_space_dimensions.sql | mysql -h 127.0.0.1 -P 3306 -u smartpark_app -p smartpark
   ```

   Enter the value of `DB_PASSWORD` from `.env` when prompted. This command list is an older manual-recovery example; the current SmartPark schema has numbered migrations `001`–`021`. For a fresh database, prefer `npm run migrate`. For an existing database, verify `schema_migrations` and the actual schema, then run only pending migrations in order. Do not rerun successful migrations. Back up a database with data before schema changes.

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

The API tests cover password/token helpers, parking availability, booking pricing/interval rules including the shared-space weekly schedule, payment signature helpers, minor currency-unit conversion and signed QR tickets. Database-backed payment and gate routes require MySQL and a configured payment provider for end-to-end integration testing.

## Important limitations

- Inventory metrics, facility summaries and booking history are now sourced from the API.
- Razorpay checkout requires merchant test/live credentials and a configured provider webhook before real payments can be accepted. Local `mock` checkout only simulates payment for development and is blocked in production configuration.
- QR ticket issuing, gate check-in/check-out, a separate YOLO/OpenCV vision service, operator-configured parking-space polygons, stabilized occupancy events and a short-lived-ticket-protected MJPEG preview are implemented. Detection still requires a configured model, camera source and per-site validation before it can be trusted in production.
- The in-process login rate limiter is for development/single-instance use. A horizontally scaled production deployment should use a shared rate-limit store.
- Before public deployment, configure HTTPS, SMTP, a production database, backups, monitoring, secrets, migrations, and reviewed access policies.

## Phase 3: parking inventory and discovery

### New capabilities
- Database-backed facility discovery with city and text filters.
- Public summaries for published (`active`) facilities only.
- Host facility creation as a draft and submit-for-approval workflow.
- Administrator facility publication, pause and reactivation controls.
- Lot owners and assigned staff see only facilities they are permitted to access.
- Zones and bulk slot creation (up to 100 spaces per request).
- Separate physical slot state (`empty`, `occupied`, `unknown`) and operational state (`open`, `disabled`, `maintenance`).
- Live summary of total, available, occupied, reserved and unknown spaces.
- Availability is conservative: only open, physically empty, currently unreserved slots are marked available.
- Operator/attendant assignment to a facility by an administrator.
- Slot and facility actions are recorded in the audit log.

### Apply migration 003
Apply this after migrations 001 and 002. Run it exactly once against the configured SmartPark database:

```powershell
Get-Content -Raw .\database\migrations\003_parking_inventory.sql | mysql -h 127.0.0.1 -P 3306 -u smartpark_app -p smartpark
```

If you have existing data, back up the database before migrating. This migration adds physical-state fields and the `parking_lot_staff` assignment table; it does not delete current data.

### Optional local demo facility
To have a facility and fifteen numbered spaces to explore while developing, run:

```powershell
npm run seed:demo
```

This creates or fills a clearly named **SmartPark Demonstration Garage** with sample data. It is a local test fixture, not a real facility. Review and remove the fixture before production deployment. Slots with state `unknown` intentionally are not advertised as available.

### Phase 3 endpoints
- `GET /api/parking/overview` — inventory summary across active facilities.
- `GET /api/parking/lots?q=&city=&limit=` — published facility discovery.
- `GET /api/parking/managed-lots` — facilities owned by the user or assigned to staff.
- `GET /api/parking/lots/:lotId` — facility details, with draft details restricted to authorized users.
- `GET /api/parking/lots/:lotId/zones` — facility zones.
- `GET /api/parking/lots/:lotId/pricing` — pricing rules visible to authorized facility users.
- `POST /api/parking/lots/:lotId/pricing` — create or replace an active pricing rule as owner/admin/assigned operator.
- `GET /api/parking/lots/:lotId/slots` — per-space status and current reservation flag.
- `POST /api/parking/lots` — create a facility; public host-created facilities start as drafts.
- `PATCH /api/parking/lots/:lotId` — edit facility details as owner/admin.
- `POST /api/parking/lots/:lotId/submit-for-approval` — submit a draft for review.
- `PATCH /api/parking/lots/:lotId/status` — admin publication/status control.
- `POST /api/parking/lots/:lotId/zones` — create a zone.
- `POST /api/parking/lots/:lotId/slots/bulk` — create numbered spaces.
- `PATCH /api/parking/slots/:slotId` — authorized physical/operational state update.
- `POST /api/parking/lots/:lotId/staff` and `DELETE /api/parking/lots/:lotId/staff/:userId/:role` — administrator assignment management.

### Testing

```powershell
npm run test:api
npm run build
```

The dashboard's inventory cards and recent booking rows come from the API. Payment processing, QR entry/exit and camera-event ingestion remain later phases.


## Phase 4: booking engine and price quotes

### Booking endpoints
Base path: `/api/bookings`. Every route in this section requires a valid signed-in session.

- `POST /quote` — request a server-calculated quote with `slotId`, `startAt`, `endAt`, and optional `vehicleId`. Date values must be ISO-8601 timestamps including an offset. The API requires at least one minute of lead time, at least 30 minutes of duration, and caps one booking at 30 days.
- `POST /` — creates a ten-minute `held` reservation after checking the slot and preventing overlapping active bookings. It does not charge the user or mark the booking confirmed.
- `GET /mine?status=&limit=` — lists the signed-in user's bookings and expires overdue holds.
- `GET /:bookingId` — returns a booking only to its owner or an administrator.
- `POST /:bookingId/cancel` — cancels an unpaid temporary hold. Confirmed/paid cancellation is intentionally unavailable until a payment/refund flow is implemented.

### Pricing behavior
Authorized facility managers can configure hourly, daily, weekly and monthly prices, with an optional one-time service fee and tax rate. The API reads active rules in the facility's currency, prefers slot-specific rules over lot-wide rules of the same type, compares billing units and selects the lowest calculated total. Service fee is applied once per booking; tax is calculated on base amount plus service fee. The quote snapshot is stored with the booking for auditability. Setting a new active rule for the same rate type and scope deactivates its previous current rule while retaining history.

Near-term bookings (starting in less than 30 minutes) require the latest physical state to be `empty`. For later starts, the current camera observation does not by itself prove what the space's state will be at the future time; overlapping reservations are checked by interval. Operationally disabled or maintenance slots are never bookable.

### Phase 4 verification
Run the API and vision helper tests, then build the web app:

```powershell
npm run test:all
npm run build
```

Pure-function unit tests cover time validation, billing-unit selection, fee/tax calculation and UTC conversion. The complete database-backed workflow should also be tested locally with two simultaneous requests for the same slot; at most one overlapping hold must succeed. Until the payment phase is complete, the UI explicitly labels created bookings as unpaid temporary holds.


## Phase 5: payment verification, QR ticketing and gate access

### Local development checkout

The default `.env.example` uses `PAYMENT_PROVIDER=mock`. When a user clicks **Pay now**, SmartPark creates a local payment record and displays a clearly labelled test-payment confirmation. Completing that simulation uses the same booking-settlement logic to confirm the reservation and issue a signed QR ticket. It does not contact a bank or charge money. The simulator endpoint returns `404` when `NODE_ENV=production` or the active provider is not `mock`.

### Razorpay staging / production configuration

Configure the following in `.env` or the deployment secret manager. Do not commit real secrets:

```dotenv
NODE_ENV=production
PAYMENT_PROVIDER=razorpay
RAZORPAY_KEY_ID=your_razorpay_key_id
RAZORPAY_KEY_SECRET=your_razorpay_key_secret
RAZORPAY_WEBHOOK_SECRET=your_webhook_signing_secret
QR_SIGNING_SECRET=replace_with_a_unique_random_secret_of_at_least_32_characters
```

Use Razorpay test credentials for staging and complete a full test before switching to live credentials. Add the server webhook URL `https://YOUR_DOMAIN/api/payments/webhook/razorpay` in the payment dashboard. Configure the `payment.captured` and `payment.failed` events; `order.paid` is also accepted if enabled. The endpoint verifies the HMAC signature against the exact raw request body, records provider events idempotently and reconciles them with local payment records. Configure HTTPS and a stable production API URL before enabling provider webhooks.

Generate a new QR signing secret locally rather than using the example value:

```powershell
node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
```

Production startup validation rejects the mock payment provider and the example QR signing secret. Keep the Razorpay key secret and webhook secret only on the server. The key ID is returned to the browser because checkout providers require a public key identifier; it is not a secret.

### Reconciliation migration

`005_payment_reconciliation.sql` adds a durable `needs_reconciliation` flag to the payment record. Apply it once after migration 004. It identifies captured payments that could not safely confirm a booking or that appear to be an additional captured charge. The flag remains visible in transaction history after provider webhook retries. Refunds and operator-led financial reconciliation are not yet automated.

### Phase 5 endpoints

- `POST /api/payments/orders` — creates or reuses a checkout order for the signed-in user's active booking hold.
- `POST /api/payments/verify` — validates Razorpay checkout signature, fetches the payment directly from the provider, checks captured status, order ID, amount and currency, and then settles the booking.
- `POST /api/payments/webhook/razorpay` — verifies the provider webhook signature using the exact raw body; duplicate events are journaled and safely reconciled.
- `POST /api/payments/mock/complete` — development/test-only simulated payment; never available in production.
- `GET /api/payments/mine` — current user's transaction history, without exposing credentials. Captured transactions that require manual reconciliation keep that flag across duplicate webhook retries.
- `GET /api/payments/:paymentId/receipt` — owner-only printable HTML receipt for verified captured payments; open it in a browser and use Print → Save as PDF. Payments flagged for reconciliation show a warning and do not authorize entry.
- `GET /api/bookings/:bookingId/ticket` — returns a QR image data URL for the owner of a paid, confirmed or checked-in booking.
- `POST /api/gate/scan` — assigned attendants, assigned operators or administrators submit `{ "token": "...", "action": "entry" | "exit" }`. Entry requires a confirmed booking and checks the 30-minute early-entry rule; exit requires an active parking session.

### Payment and access safety behavior

- Amount and currency come from the stored booking and pricing snapshot, never from a client-supplied total.
- Checkout signature is verified server-side and the provider's payment record is fetched to confirm capture, amount, currency and order association.
- Webhook HMAC is checked before processing; provider event IDs are stored in `payment_webhook_events` for retry-safe processing.
- A hold is not confirmed until a captured provider payment (or an explicit local-development simulation) has passed settlement checks.
- If a provider reports money captured after the hold was cancelled, the booking window passed or another reservation consumed the slot, SmartPark records the paid transaction and flags the payment for reconciliation rather than issuing a contradictory ticket. Migration `005_payment_reconciliation.sql` persists this flag so duplicate webhook events cannot hide the warning. Configure an operations/refund workflow before public launch.
- QR credentials are signed, time-limited bearer tokens. The database stores their hash, not the raw token. Only the booking owner can retrieve the ticket.
- Gate scans require an `attendant`, `operator` or `admin` role; non-admins must be assigned to the booking's facility. Repeated entry and invalid/expired QR scans are rejected. The gate exit marks physical occupancy `unknown` until a camera or authorized operator confirms that the bay is empty.
- The QR scanner uses browser camera permissions. In deployment, serve the frontend over HTTPS; browsers generally allow camera access on localhost during development.

### Phase 5 verification

```powershell
npm run test:api
npm run build
```

The pure helper tests cover currency conversion, checkout/webhook HMACs, amount/order/currency validation and signed QR expiry. Run local end-to-end tests after applying migrations `004_payments_webhooks.sql` and `005_payment_reconciliation.sql`. For a Razorpay integration test, use test keys and verify a captured payment, provider webhook retry, failed payment, expired hold, duplicate scan, unauthorized staff scan and successful entry/exit before deploying.


## Phase 6: shared parking marketplace, vehicle garage and host earnings

### Shared listings
- Hosts can create private parking listings for driveways, garages, covered/outdoor lots, private bays or commercial spaces.
- Listing information includes map coordinates, address, contact details, arrival instructions, parking type and selectable amenities.
- Listing creation configures numbered parking spaces and hourly/daily/weekly/monthly pricing rules. Each listing has a seven-day local availability schedule.
- Hosts can edit listing details, upload up to eight JPEG/PNG/WebP listing photos (5 MB each), configure weekly opening days/times and submit a complete draft for administrator review.
- Only published `active` shared listings are publicly discoverable. Hosts can manage only their own listings; admins can review and moderate all listings.
- Public parking discovery displays the cover photo, listing type, contact and arrival information, and amenities where configured.

### Vehicle garage and booking checks
- Drivers can register, edit and remove vehicles, set a preferred default, and see vehicle compatibility when selecting a slot.
- A booking can include an optional `vehicleId`; the API verifies the vehicle belongs to the signed-in user and matches the configured space type.
- Shared-space booking quotes and reservations are validated against the host's weekly schedule using the listing timezone. Missing or incomplete weekly schedules fail closed. Generic facility bookings continue to use facility operating hours.
- Physical state, reservation state and operational status remain separate. An unknown/occupied space is not presented as reliably available for near-term booking.

### Host earnings
- Once a captured payment is verified and the related booking is safely confirmed, SmartPark adds an idempotent pending host-earnings ledger row when the parking listing has an owner.
- Host earnings are derived from verified transaction records, not edited as a client-side wallet balance.
- Automated bank payouts, refund reversals and a settlement provider integration are not implemented in this phase. Do not represent pending earnings as paid or withdrawable cash.

### Apply migration 006
Migration 006 extends `parking_lots` and creates listing-photo metadata, weekly availability and the host-earnings ledger. Back up a database with data before migrating. Apply it exactly once **after migrations 001–005**:

```powershell
Get-Content -Raw .\database\migrations\006_shared_parking_marketplace.sql | mysql -h 127.0.0.1 -P 3306 -u smartpark_app -p smartpark
```

This migration includes an `ALTER TABLE`; do not re-run it on a database where it has already been applied. The code relies on its columns and tables, so run the migration before starting the Phase 6 API.

Listing photos are stored under `services/api/uploads/marketplace/` and served as public listing assets at `/uploads/marketplace/`. Production deployments must mount durable storage for this directory, include it in backup/retention policy, and serve image assets over HTTPS. Only upload genuine parking-space photos; never upload IDs, payment cards or other sensitive documents. If you deploy multiple API replicas, use shared object storage and adjust the photo service instead of relying on a local instance disk.

### Phase 6 endpoints
- `GET /api/marketplace/listings?q=&city=&parkingType=&amenity=&maxHourlyRate=` — search active shared listings.
- `GET /api/marketplace/listings/mine` — list shared listings owned by the host; admins can review all.
- `POST /api/marketplace/listings` — create a draft shared listing and its initial slots, rate rules and weekly schedule.
- `GET /api/marketplace/listings/:listingId` — retrieve listing details, photos, rates and availability for an authorized owner/admin or a signed-in user viewing an active listing.
- `PATCH /api/marketplace/listings/:listingId` — edit descriptive, location and amenity fields.
- `PUT /api/marketplace/listings/:listingId/availability` — replace the listing's seven-day schedule.
- `POST /api/marketplace/listings/:listingId/photos` and `DELETE /api/marketplace/listings/:listingId/photos/:photoId` — upload/delete listing photos.
- `POST /api/marketplace/listings/:listingId/submit-for-approval` — verify completeness and send the listing for review.
- `GET /api/marketplace/earnings/mine` — list the signed-in host's earnings ledger and status totals.
- `GET /api/vehicles/mine`, `POST /api/vehicles`, `PATCH /api/vehicles/:vehicleId`, `DELETE /api/vehicles/:vehicleId` — owner-only vehicle garage operations.

### Phase 6 test and build checks
```powershell
npm run test:api
npm run build
```

The API unit tests include shared-space weekday/time checks. Database-backed listing/photo/earnings flows should be tested locally after applying all six migrations. A full browser build and live MySQL integration need local verification before deployment.


## Phase 7: camera-based occupancy detection

### What is implemented
- A separate Python FastAPI service manages cameras configured in the SmartPark API.
- YOLO/Ultralytics detects cars, motorcycles, buses and trucks in camera frames. Operator-configured normalized polygons associate detections with specific parking slots.
- An occupancy stabilizer requires multiple consistent frames before changing a slot from unknown to empty/occupied, reducing transient flicker.
- The vision API posts a service-token-authenticated heartbeat and only emits state transitions; the Node API validates that every slot is actively mapped to that camera before recording an `occupancy_events` row.
- Camera errors/disconnections mark mapped slots unknown. The API stale-heartbeat monitor also marks offline camera regions unknown.
- The Camera detection page manages sources, mapping polygons, current physical states, online status/errors and a ticket-protected MJPEG preview.
- Local video and webcam index sources are supported. RTSP is disabled by default and can only be configured by an administrator; enable it only inside a trusted camera network.
- Empty physical detection is not equivalent to a bookable reservation. The existing reservation/operational rules remain authoritative.

### Apply migration 007

Apply this once after `001` through `006`. It adds detector settings and heartbeat/error timestamps to `cameras`, and an index for the existing active camera-slot mappings.

```powershell
Get-Content -Raw .\database\migrations\007_vision_detection.sql | mysql -h 127.0.0.1 -P 3306 -u smartpark_app -p smartpark
```

If migration 007 has already been applied successfully, do not run it again. Restart the Node API after the migration.

### Configure the service credential

`VISION_API_TOKEN` is shared only between the Node API and the Python vision service. It is never sent to the browser. Create a long random value:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Put the same value into the repository-root `.env` as `VISION_API_TOKEN=...`. Replace the example value before production deployment. Production startup rejects a missing, short or clearly-placeholder token. Do not commit `.env`.

### Install and start the vision service on Windows

Install Python 3.11 or 3.12. Then run the following in PowerShell:

```powershell
cd services/vision
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements-yolo.txt
```

`requirements-yolo.txt` includes Ultralytics and PyTorch and can require several GB of disk space. The smaller `requirements.txt` starts the service health API but does not provide vehicle inference. A YOLO model is selected with `VISION_MODEL_PATH` (default `yolov8n.pt`); Ultralytics may download the default model on first use if network access is available. For a production deployment, manage the model file and cache explicitly and review the model's license/use requirements.

Keep the Python virtual environment active and start the service in this terminal:

```powershell
python -m uvicorn smartpark_vision.main:app --host 127.0.0.1 --port 8000
```

Or run `npm run vision:dev` from the project root after activating the vision virtual environment. Start the Node API and web app separately with `npm run dev` from another terminal. Check vision health at `http://127.0.0.1:8000/health`.

### Configure a camera in the UI

1. Create a facility and physical parking slots. Camera calibration is available while the facility is draft or pending approval; only active facilities are publicly discoverable/bookable.
2. Open **Camera detection** as the facility owner, an assigned operator or an admin.
3. Add a camera. Enter `0` for the first webcam available to the machine running the vision service, or place a local video in `services/vision/sample-videos` and enter only its filename, for example `parking-demo.mp4`.
4. The preview can connect before slot regions are mapped. Choose a slot and enter a polygon in normalized frame coordinates. Example:

   ```json
   [[0.1, 0.1], [0.4, 0.1], [0.4, 0.5], [0.1, 0.5]]
   ```

   `(0,0)` is the top-left of the video frame and `(1,1)` is bottom-right. Draw one polygon per visible bay. The preview overlays green for detected empty, red for occupied, and amber for unknown. Recalibrate mappings if camera position, zoom or aspect ratio changes.

5. A camera becomes operational when the vision service can open its source and the API can receive heartbeats. If it shows offline, read `lastError` in the camera UI and the Python service terminal.

The local video file must be copied by the developer; no sample parking footage or model weights are bundled in this original project. RTSP requires `VISION_ALLOW_RTSP=true` and should be enabled only in a trusted network. Local video paths are restricted to `VISION_MEDIA_ROOT` to reduce arbitrary local-file access.

### Optional vision container

A separate Dockerfile and Compose file are provided. To build/run the vision container (the default installs YOLO/PyTorch and may take time):

```powershell
docker compose -f docker-compose.vision.yml up -d --build
```

Set `VISION_API_URL` if the Node API is not reachable at `http://host.docker.internal:4000/api/vision/service`. For an initial lightweight service image without YOLO, build with `VISION_INSTALL_YOLO=false`; occupancy inference will remain unavailable until the YOLO package/model is installed. The container's video folder is mounted read-only, and the web reverse proxy must route `/vision-stream/` to port 8000. Keep that port private; do not publish it directly to the internet.

### Vision service endpoints

- `GET /api/vision/cameras?parkingLotId=...` — list camera settings and mapped regions visible to the signed-in host, operator or admin.
- `POST /api/vision/cameras` — create a configured camera for an accessible facility.
- `PATCH /api/vision/cameras/:cameraId` — update camera source/settings or disable it.
- `POST /api/vision/cameras/:cameraId/regions` and `DELETE /api/vision/cameras/:cameraId/regions/:slotId` — map/unmap a slot polygon.
- `GET /api/vision/cameras/:cameraId/stream-ticket` — issue a signed 2-minute ticket to an authorized operator for browser preview.
- `GET /api/vision/service/config`, `POST /api/vision/service/events`, and `POST /api/vision/service/cameras/:cameraId/health` — protected service-to-service endpoints.
- `GET /health` on the Python service — worker snapshots and service configuration.
- `GET /vision-stream/:cameraId?ticket=...` on the Python service — MJPEG live preview.

### Tests and remaining production validation

Run the API helper suite:

```powershell
npm run test:api
npm run build
```

Run the dependency-light Python logic tests from the repository root:

```powershell
$env:PYTHONPATH = "services/vision"
python -m unittest discover -s services/vision/tests -v
```

A real deployment still requires site-specific tests for detector accuracy in day/night and weather conditions, camera disconnects, multiple cameras, model performance, network isolation, and full database-backed occupancy events. Do not operate a physical gate or calculate charges solely from an unvalidated visual classification.

## Phase 8: operations analytics, alerts and notifications

Phase 8 adds a dedicated **Operations** workspace for hosts, operators and admins. It reads facility-scoped inventory and active booking counts, calculates verified revenue grouped by currency, shows facility occupancy, and provides an operational alert list. The **Notifications** inbox is available to every signed-in user.

### Apply migration 008

If migrations `001` through `007` have already been applied, back up your database and apply migration `008` once:

```powershell
Get-Content -Raw .\database\migrations\008_operations_analytics_alerts.sql | mysql -h 127.0.0.1 -P 3306 -u smartpark_app -p smartpark
```

Migration 008 creates `operational_alerts` and adds analytics indexes to existing notification, payment and booking tables. Migration 009 adds the transactional email outbox. Do not rerun either migration after it has succeeded. On a fresh database, apply migrations `001`–`010` in order.

### Operations and notification endpoints

- `GET /api/operations/summary` — facility-scoped active inventory, live slot state counts, active bookings, alert totals and verified revenue for the last 30 days by currency.
- `GET /api/operations/reports/revenue?from=YYYY-MM-DD&to=YYYY-MM-DD` — daily captured/verified payment totals by currency for a UTC date window; maximum 366 days. Reconciliation-flagged payments are excluded.
- `GET /api/operations/reports/occupancy` — physical occupancy and availability totals by accessible active facility.
- `GET /api/operations/alerts?status=open|acknowledged|resolved|all&limit=50` — camera health and captured-payment reconciliation alerts scoped to accessible facilities.
- `POST /api/operations/alerts/:alertId/acknowledge` — records who accepted the alert for investigation.
- `POST /api/operations/alerts/:alertId/resolve` — manager-level resolution action; attendants cannot resolve alerts.
- `GET /api/notifications/mine?limit=50&unreadOnly=true|false` — the signed-in user's notification inbox.
- `POST /api/notifications/:notificationId/read` and `POST /api/notifications/read-all` — update only the signed-in user's notifications.

Booking hold/cancellation, successful paid confirmation, gate entry/exit and operational alerts create in-app notification records. Phase 10 also queues allowlisted lifecycle emails for holds/cancellations, verified booking confirmations and gate entry/exit. The separate SMTP worker must be configured and tested; SMS and push dispatch are not implemented.

### Tests and release checks

```powershell
npm run test:api
npm run build
$env:PYTHONPATH = "services/vision"
python -m unittest discover -s services/vision/tests -v
```

The release checklist is in `README.md#documentation-source-docs-deployment-security-checklist-md`, and operational response guidance is in `README.md#documentation-source-docs-operations-runbook-md`. Before production, complete a real MySQL migration test, full browser build, payment-provider end-to-end tests and a camera/network acceptance test.


## Phase 10: transactional email delivery

Phase 10 adds a database-backed transactional email outbox and a separate worker. Booking holds/cancellations, verified booking confirmations, and gate entry/exit events queue email only for active, verified account addresses, in the same database transaction as the related business change.

### Migration 009

If migrations 001–008 are already applied, apply `database/migrations/009_transactional_email_outbox.sql` once, then migration 010 for audited refunds and host payouts, or use the migration runner after verifying/baselining the existing schema.

### Local worker

Run the app in one terminal and the mail worker in another:

```powershell
npm run dev
npm run worker:email
```

To process currently due messages once and exit:

```powershell
npm run worker:email:once
```

With `NODE_ENV=development` and no SMTP host, the worker logs email content as a local simulation and records status `simulated`; it does not claim that a message was delivered. Configure SMTP to test real delivery. Only verified active accounts receive event emails.

Production Compose starts `email-worker` as a private service with no published ports. Monitor it with `docker compose -f docker-compose.production.yml logs --tail=100 email-worker`.

SMTP delivery is at-least-once, not exactly-once. The outbox idempotency key prevents duplicate queue inserts for the same event; if the SMTP provider accepts a message and the worker crashes before saving the delivery result, a later retry can deliver a duplicate. Consumers should treat these event emails as notifications, not as proof of payment or authorization.


## Phase 11: refunds, host payouts and financial controls

Phase 11 adds audited customer refund requests and manual host-payout processing. Customers can request a refund for an eligible upcoming booking. Administrators can approve or reject the request, start processing, record a failed outcome, or record a completed provider refund using an external refund reference. The booking is cancelled and the QR credential invalidated only after a refund completion is recorded. Entry is blocked while a refund is being processed or is under manual review.

Host earnings are only eligible for approval after the booking is completed and payment is captured and reconciled. Hosts can request payout of their approved earnings. An administrator must perform the actual external bank/provider action, then record the transfer reference in SmartPark. **SmartPark does not initiate refunds or bank transfers in Phase 11.** These actions must be confirmed in the external provider first.

Apply `database/migrations/010_refunds_and_host_payouts.sql` after migrations 001–009, then `database/migrations/011_favorites_search_reviews.sql` for Phase 12. Prefer `npm run migrate` after verifying the existing migration history. If the database was migrated manually with no `schema_migrations` history, follow `README.md#documentation-source-docs-production-deployment-md` and baseline only after confirming the complete schema version.

Read `README.md#documentation-source-docs-financial-operations-md` for the status transitions, role responsibilities, operational steps and testing checklist. A successful build and full MySQL/provider integration test still must be completed in your deployment environment before public launch.


## Phase 12: saved parking, recent searches and verified reviews

- Favorites are stored per account and can be added/removed from public parking cards. Draft and inactive facilities are not exposed through the favorites endpoint.
- Recent search history stores only entered search text and city; it does not store GPS coordinates. Users can delete one search or clear their history. A bounded retention behavior trims old entries if the history exceeds 500 rows.
- Reviews require an authenticated user and a completed booking at that facility. One review is permitted per completed booking. Facility owners cannot review their own facility.
- Public cards expose aggregate average rating and count, while public review records display a shortened reviewer name and do not include booking IDs. Users can edit/delete their own reviews, and administrators can hide or republish reviews.
- Apply migration `011_favorites_search_reviews.sql` after migration 010. Run `npm run migrate` when migration history has been verified.
- API pure-logic tests cover input normalization, review validation and privacy-safe public mapping. The migration and API endpoints still require live MySQL integration testing.

## Phase 13: integration smoke tests and release contracts

Phase 13 adds a live HTTP smoke-test harness and source contract tests to reduce the risk of frontend/backend route mismatches and configuration regressions. The smoke test checks database health, public parking response shapes, authentication boundaries, security headers, Origin enforcement and consistent 404 responses. Optional credentials enable authenticated read-only collection checks and verify session invalidation after logout.

Run deterministic tests with `npm run test:all`. With MySQL migrated and the API running, run `npm run test:integration`. Use `npm run verify:release` to run tests, build the production frontend and run the live smoke checks in sequence. See `README.md#documentation-source-docs-integration-testing-md` for setup, expected behavior and the end-to-end staging checklist.

The live API smoke tests, full Vite build, MySQL-backed business workflows, provider checkout/webhooks, SMTP delivery, production HTTPS and camera/hardware accuracy must be validated in the target environment. Passing unit and source-contract tests alone is not production certification.

### Phase 13: integration verification and release contracts

Phase 13 adds a read-mostly live API smoke suite (`npm run test:integration`) plus source-contract tests that verify router mounts, frontend-to-backend endpoint correspondence, raw webhook-body ordering, migration sequence/baseline coverage, and production network/secret assumptions. Run `npm run test:all` for deterministic API/vision tests, then `npm run build`, followed by the live smoke suite with the API and MySQL running. See `README.md#documentation-source-docs-integration-testing-md` and the Phase 13 section in `README.md#documentation-source-docs-release-checklist-md`.

The current environment could run the deterministic tests but could not download npm dependencies from the registry, and has no running MySQL/Docker runtime. Therefore the production frontend build, database-backed HTTP smoke tests, Razorpay staging checkout/webhooks, SMTP delivery, and physical camera/hardware flow must still be verified on the development computer or staging server.

## Phase 15: final release candidate

This archive includes `npm run release:audit` for static release checks and `npm run check:syntax` for frontend JSX/TSX and server JavaScript syntax. `npm run verify:release` runs both checks, deterministic tests, the production frontend build and the live HTTP smoke suite. Read `README.md#documentation-source-docs-phase15-final-release-md` and complete every mandatory entry in `README.md#documentation-source-docs-release-checklist-md` before public launch. Automated helper tests do not certify live MySQL, payments, SMTP, TLS, backup/restore, camera accuracy or gate hardware.

Phase 15 static verification evidence and current release blockers are recorded in `README.md#documentation-source-docs-release-evidence-phase15-static-checks-md`. The package remains a release candidate until the local build, lockfile, database, external services and deployment checks pass.


## Phase 13: shared listing physical details

Migration `012_shared_listing_space_dimensions.sql` adds optional parking surface type, typical space length and width, and maximum vehicle height to shared parking listings. The fields are editable by the listing owner or an administrator and are validated by the API. Existing records remain valid and default to an unspecified surface. Back up the database and apply migration 012 once after migration 011, or use `npm run migrate` after checking migration history. Dimensions are stored in centimetres.


### Scheduled owner pricing

The marketplace pricing form supports future-effective rates and optional end times using the existing `pricing_rules.valid_from` and `valid_until` columns. Scheduled prices are kept alongside the currently effective rate; booking quote selection applies the newest effective rule and falls back to an earlier rule after a temporary rate expires. No schema migration is required for this enhancement.


## Phase 14: listing review decisions and owner feedback

Migration `013_listing_review_workflow.sql` adds an auditable moderation state, reviewer, review timestamp, and owner-visible review note for shared-space listings. Admins can approve or reject a listing that is currently pending review. Rejections require a clear reason; the listing is paused and the owner can correct the listing and resubmit it. Public search continues to show only active listings. Apply migration 013 after 001–012 using `npm run migrate` after verifying migration history.


## Phase 16: listing moderation feedback

The shared-space marketplace now records review decisions and owner-visible feedback. An administrator can approve or reject a listing while it is pending review; rejection requires a reason. Rejected listings remain paused and can be corrected and resubmitted. The review API rejects decisions for listings no longer awaiting review and writes moderation actions to the audit log. Apply `database/migrations/013_listing_review_workflow.sql` after migrations 001–012 using `npm run migrate` after checking the database's migration history.


### Owner verification (Phase 4)

Hosts can submit an owner-verification request from **Owner verification**. Administrators can review pending requests in the same module and approve or reject with a reason. Apply migration `014_owner_verification.sql` through the project's migration runner after backing up the database and confirming the existing migration history. This feature stores verification metadata only; it does not upload or automatically verify identity documents.


## Phase 15: promotion codes and booking discounts

Administrators can create percentage or fixed-value promotion codes with date windows, minimum parking-charge requirements, maximum discount caps, total redemption limits and per-driver limits. Drivers can apply a code in the reservation quote flow. The server validates the code both when calculating the quote and when creating the temporary hold; discounts are applied to the parking charge, then tax is recalculated. A redemption is reserved for the 10-minute hold, redeemed only after verified payment, and released on a failed payment. Apply `015_promotions.sql` with the migration runner after a database backup and migration-history check. See `README.md#documentation-source-docs-phase-7-promotions-md`. Referral rewards are a later phase and are not included in this update.


## Phase 9: monthly parking passes

Migration `017_monthly_subscriptions.sql` adds monthly-pass requests for approved shared-space listings that have an active monthly pricing rule. Drivers can request a pass for 1–12 months, review request history, and cancel unpaid requests. Hosts can approve or reject requests for their own listings; administrators can review all requests. Ownership checks, date/amount validation, overlapping-request checks, and audit events are enforced by the API.

**Scope note:** this phase records owner decisions and estimated amounts. It does not collect subscription payments, create an access entitlement, charge recurring payments, or automatically renew passes. An `approved` request remains `payment_status = 'unpaid'` until a later payment integration is implemented. Do not use this phase alone to grant gate access based on a monthly pass.

## Combined Phases 10–11: corporate fleet and EV charging

Migration `018_corporate_fleet_ev_charging.sql` adds corporate accounts, manager/employee membership, fleet vehicle records, EV charger inventory, and charging-session records. Open **Corporate & EV** in the web app to create a company account, add existing SmartPark users, manage fleet vehicles, register chargers at owned facilities, and review personal charging-session history. Corporate account and fleet APIs are mounted at `/api/enterprise`; EV inventory and session APIs are mounted at `/api/charging`.

This phase does not yet automate employee parking allocation, corporate invoices, charging hardware/OCPP control, live telemetry, meter readings, or EV charging payments. Charging session costs are estimates based on manually supplied energy and the rate snapshotted at session start. See `README.md#documentation-source-docs-phase-10-11-corporate-fleet-ev-md` for permissions and testing.


## Remaining roadmap integration: Phases 14–17

The latest integrated package adds overstay monitoring, a token-protected gate-adapter command queue, support tickets, opt-in Twilio SMS delivery, and a historical booking-demand planning indicator. Review [`README.md#documentation-source-docs-remaining-phases-integrated-md`](README.md#documentation-source-docs-remaining-phases-integrated-md) for migration `021_remaining_phases.sql`, worker commands, adapter API contract, service configuration, and external integration limitations. These helpers are a release candidate—not production certification. Test with a restored database and sandbox provider credentials before launch.

## Consolidated reference documentation

The reference material below was consolidated from the project documentation set. Duplicate files were included once; no application behavior was changed by this documentation cleanup.

<a id="documentation-source-changelog-md"></a>

## CHANGELOG.md

### Changelog

## Profile update — Driver and Facility Owner workspace switching
- Added a self-service profile action that enables facility-owner capability while preserving the Driver role.
- Added a per-account Driver / Facility Owner workspace switch in My profile; switching to Driver mode hides owner navigation without deleting facilities, bookings, or host capability.
- Added direct profile actions to manage facilities and pricing or find parking to book a vehicle, including eligible spaces at the owner's own active facility.
- Kept listing drafts behind the existing administrator review workflow and audit-logged owner-mode enablement.
- No database migration required; this reuses the existing roles, facility, pricing, vehicle and booking schema.
- Validation: source syntax checks passed, all 125 API tests passed, release audit reported 0 failures. Frontend build and live database/payment flows require environment verification because Vite and Docker are unavailable here.

## 2.4.0 — Phase 15 release-candidate gate
- Added `npm run release:audit` to check required project files, package scripts, migration continuity and baseline version, `.gitignore` hygiene, high-confidence secret patterns, dependency lockfile availability and local build/container tooling.
- Updated `npm run verify:release` to run the release audit before the deterministic test suite, production frontend build and live HTTP smoke checks.
- Added final launch-gate documentation with explicit environment-specific go/no-go evidence requirements.
- Release status remains candidate-only until the generated lockfile, clean install/build, MySQL integration, payment/email, HTTPS, backup/restore, and onsite camera/gate checks pass.

# SmartPark changelog

## Phase 14 — Production least-privilege hardening

- Scoped production environment validation by process role: API validates payment/QR/vision settings; the email worker validates only the database, site origin and SMTP settings it actually needs.
- Removed payment provider credentials, webhook secret, QR signing secret, vision token and proxy-trust configuration from the email-worker container environment.
- Added read-only root filesystems, bounded temporary writable mounts, `no-new-privileges`, dropped Linux capabilities where supported, and PID/memory limits for production application containers.
- Extended automated contract tests to prevent unnecessary secrets from returning to the mail worker and to protect the hardened container settings.
- Added a dedicated production-security guide, updated release/deployment docs, and documented the remaining host/image/dependency scanning requirements.
- No database schema migration was added in this phase.

## Validation performed in the artifact workspace

- 92 API tests passed, including service-specific production config and Compose least-privilege tests.
- 14 Python vision tests passed.
- JavaScript syntax checks passed for API source and tests.
- Python compile checks passed.
- Compose YAML parsed successfully using the available YAML parser.
- Full frontend build, container start, live MySQL workflow, SMTP and payment-provider connectivity were not verified because frontend dependencies, Docker and MySQL are not available in this environment.

## Known verification limits

A generated `package-lock.json` is still not present; run `npm install` on the development/staging machine with registry access and retain the lockfile. Then run `npm run build`, the complete test suite, production Compose config/image build, database migration tests, and external provider/camera checks before launch.

## Earlier phases

- Phases 1–13: refer to the README, `README.md#documentation-source-docs-next-steps-md`, `README.md#documentation-source-docs-release-checklist-md`, and individual phase notes for the implemented foundations and known limits.


## Phase 8 — Referral programme

- Added unique personal referral codes and optional signup attribution.
- Added the **Refer & earn** dashboard with referral status, personal link, counts and credit ledger.
- Qualification occurs only after a gate-recorded completed session and verified paid payment; unique constraints prevent duplicate referral rewards.
- Added migration `016_referral_program.sql` and migration-baseline coverage.
- Referral credits are internal ledger entries only; cash payout and booking redemption are not implemented.

## Remaining roadmap integration (Phases 14–17)

- Added an operations monitoring worker for booking overstays, incident alerts and expiry of queued gate commands. No automatic overstay charge is applied.
- Added gate-controller and short-lived command APIs with a token-protected edge-adapter interface, operational failure alerts and a management workspace.
- Added historical booking-demand outlook to Operations; it is clearly labeled as a planning baseline rather than AI or sensor-based occupancy prediction.
- Added scoped support tickets, staff responses/internal notes and ticket status updates.
- Added explicit SMS notification consent/preferences, Twilio outbox delivery with bounded retries, and production Compose worker services.
- Added migration `021_remaining_phases.sql` and expanded release-contract coverage.
- Documented external prerequisites and outstanding release checks. Automatic provider refunds, bank payouts, full browser push, physical gate control and real camera integrations remain deployment/provider integration tasks.

---

<a id="documentation-source-docs-access-controls-and-booking-gate-md"></a>

## docs/access-controls-and-booking-gate.md

### SmartPark access controls and temporary booking gate

This document records the current behavior for facility ownership, EV charging,
parking discovery, and the temporary ordinary-driver purchase restriction.

## EV charging

EV charger creation and inventory management are restricted to authenticated
administrators and users with the `host` facility-owner role. In the web app,
host users must also select **Facility Owner** workspace mode before charger
inventory controls are shown. Drivers can still view available chargers and
their own charging sessions.

The API remains the authorization boundary:

- `POST /api/charging` requires `host` or `admin` and verifies that the
  requested parking facility belongs to the authenticated owner.
- `PATCH /api/charging/:chargerId` requires `host` or `admin` and verifies
  ownership of the charger’s facility.
- Administrators retain cross-facility management access.

## Find parking and maps

Find Parking remains available to all authenticated users. Facilities with
coordinates show map pins and directions. Facilities without coordinates remain
searchable and show their address, availability, and prices without attempting
to construct a map URL.

## Temporary ordinary-driver purchase restriction

`ALLOW_DRIVER_BOOKINGS=false` is the default in `.env.example`. While false,
ordinary driver-only accounts can browse facilities, search by city/address,
view spaces and prices, use maps, manage vehicles, and manage saved parking,
but cannot:

- create a booking quote or hold;
- initiate or verify a payment checkout; or
- request a paid monthly pass.

The API returns `DRIVER_BOOKINGS_DISABLED` with the message:
“Online parking booking is temporarily unavailable. You can still browse
parking spaces.”

Users with `host` or `admin` capability retain the existing driver-mode
booking flow. This does not bypass normal availability, vehicle, ownership, or
payment validation, and an owner cannot request a monthly pass for their own
listing.

When SmartPark is ready to restore ordinary-driver purchases, set
`ALLOW_DRIVER_BOOKINGS=true` in the API environment and restart the API. The
frontend reads `/api/bookings/capabilities`; no browser-local workspace setting
is treated as authorization.

Referral database migrations, API routes, and historical data are intentionally
preserved. Only the frontend navigation, route, import, and unused referral
page were removed.

---

<a id="documentation-source-docs-account-security-and-settings-md"></a>

## docs/account-security-and-settings.md

### SmartPark account security and settings update

## Profile

- Edit the signed-in user's name and phone number from **My profile**.
- Change password from **My profile** only. The backend requires the current password and a new password of at least 6 characters.
- On successful password change, SmartPark revokes the account's other browser sessions while preserving the current session.
- Email and role assignments remain read-only in the profile editor.

## Forgot-password email OTP

1. From the sign-in screen select **Forgot password?** and enter the account email.
2. SmartPark returns a non-enumerating response and emails a six-digit code to an active account when configured.
3. Enter the code, choose a new 12+ character password, and confirm it.
4. Codes expire after 10 minutes, are single-use, and are limited to five incorrect attempts. Requesting a new code invalidates the previous code.
5. Password recovery signs out all existing browser sessions for that account.

In local development without SMTP, the code is written to the API terminal for development testing only. Production deployment requires working SMTP credentials. Email delivery failures are logged server-side and the unused reset code is removed.

## Themes and settings

- The top-bar theme control switches between light and dark modes immediately.
- The Settings page offers theme, interface language, notification-feed display filters, compact tables, high contrast, larger text, and reduced-motion preferences.
- Preferences are stored in `localStorage` in the user's current browser. The settings export contains the browser preferences and account email only; it is not a full database export.
- Notification-feed filters hide selected booking or operational notification categories only. They do not disable transactional email, payment receipts, security notifications, or server-side monitoring.

## Database migration

Migration `020_password_reset_otp.sql` adds `attempt_count` to the existing `password_reset_tokens` table. Take a backup and inspect `schema_migrations` before applying it. Use `npm run migrate` from the project root. If a schema has been manually baselined, follow `README.md#documentation-source-docs-production-deployment-md` and verify that the column does not already exist before manually applying the SQL.

## Validation

From the project root:

```powershell
npm run check:syntax
npm run test:api
npm run build
```

For live testing, use a test account, verify the code delivery through configured SMTP, enter wrong codes up to the attempt limit, confirm expired codes are rejected, verify that code reuse fails, and confirm password change retains the current session but invalidates other sessions.

---

<a id="documentation-source-docs-admin-console-guide-md"></a>

## docs/admin-console-guide.md

### SmartPark administrator console

## Access

Administrator navigation is shown only when the signed-in session includes the `admin` role. The API independently enforces this role for user listing, user updates, role assignment, facility status changes, camera configuration, operations and finance review. Hiding a navigation item is not the security boundary.

## Facility and space operations

Open **Parking spaces**. Administrators can create and edit facilities, add zones, generate parking spaces in bulk, manage pricing, change a facility's publication status, and set an individual space to `open`, `disabled`, or `maintenance`. Use **Archive facility** to remove a facility from active offerings without deleting booking/payment history. A facility can be restored from the archived state. Spaces are disabled rather than hard-deleted so bookings and audit references remain intact.

## Camera operations

Open **Camera detection**. Administrators can add a camera source to a facility, configure the detection confidence, map camera-frame regions to parking slots, enable/disable cameras, inspect the last frame/error, and refresh the stream preview. Live detection requires the optional vision service to be running, a valid `VISION_API_TOKEN`, and a source the vision worker can access. Camera configuration alone does not guarantee a real live feed.

## User management

Open **Administration → User management** to search and paginate accounts, inspect roles and email-verification state, edit full name/phone, update account status, and assign roles. Suspending/deleting an account revokes its active sessions. The API prevents an administrator from disabling their own account or removing their own admin role, and prevents demoting the last active administrator. Changes are written to `audit_logs`.

## Administrator profile

Click the profile card in the lower-left sidebar or the avatar in the top bar. Administrators can edit their own name and phone. Email changes, password changes and role changes are separate protected workflows.

## Data and safety

The application stores operational data in MySQL. In local development, Docker runs MySQL and its named volume persists database files. Do not run `docker compose down -v` unless you intend to delete that volume. Facility archive/space disable workflows are preferred to destructive deletes because reservations, payment reconciliation, refunds, and audit history may reference these records.

## Verification

Run `npm run check:syntax` and `npm run test:api`. Run `npm run build` after dependencies are installed on the target OS. The frontend build needs the platform-specific optional Rollup package installed by `npm install`; do not copy `node_modules` from another OS.

---

<a id="documentation-source-docs-api-specification-md"></a>

## docs/api-specification.md

### SmartPark API — Phase 3 contract

Base path: `/api/parking`. Browser requests are sent to the same origin; the Vite dev server proxies `/api` to the Express service.

All IDs are UUID strings. JSON request bodies use camelCase. Dates and timestamps returned by MySQL should be interpreted as UTC unless a field explicitly denotes a facility-local time.

## Discovery

### `GET /overview`
Returns aggregate data for active/published lots:

```json
{
  "overview": {
    "activeLots": 0,
    "totalSpaces": 0,
    "availableNow": 0,
    "occupiedNow": 0,
    "unknownSpaces": 0,
    "reservedNow": 0,
    "openSpaces": 0
  },
  "featuredLots": []
}
```

### `GET /lots?q=&city=&limit=`
Lists only facilities whose status is `active`. Text search matches facility name, address, city and description. `limit` defaults to 30 and is capped at 50.

### `GET /lots/:lotId`
Requires an active session. Published facilities can be read by signed-in drivers; non-public facilities require an owner/admin or assigned-staff permission.

### `GET /lots/:lotId/slots`
Returns the slot grid and summary. Every slot exposes its physical state, operational state, current-reservation flag and derived current availability state.

Derived availability priority:
1. `disabled` or `maintenance` operational state means unavailable.
2. `occupied` physical state displays occupied.
3. An active current booking displays reserved when the slot is not physically occupied.
4. Unknown physical state remains unknown.
5. Only open + physically empty + not currently reserved is available.

This is a **current-state view**. A full future-time availability endpoint belongs to the booking phase and must evaluate overlapping intervals transactionally.

## Facility and inventory management

### `POST /lots`
Host or administrator. Required fields: `name`, `addressLine`, `city`. Optional fields include `description`, `region`, `postalCode`, `countryCode`, `latitude`, `longitude`, `timezone`, `currency`, `openingTime`, `closingTime`. Host-created facilities are always created as `draft`; an administrator may explicitly set a supported status.

### `PATCH /lots/:lotId`
Owner/admin facility details update. Does not update status or owner identity.

### `POST /lots/:lotId/submit-for-approval`
Owner submits a draft for administrator review.

### `PATCH /lots/:lotId/status`
Administrator-only facility status workflow. Request: `{ "facilityStatus": "active" }` (also `draft`, `pending_approval`, `paused`, `closed`, `archived`).

### `POST /lots/:lotId/zones`
Owner/admin/assigned operator. Request: `{ "name": "Level 1 North", "levelLabel": "First floor" }`.

### Pricing rules

- `GET /lots/:lotId/pricing` — returns the pricing rules visible to the signed-in user if they can view the facility.
- `POST /lots/:lotId/pricing` — owner/admin/assigned operator. Request example:

```json
{
  "slotId": null,
  "rateType": "hourly",
  "amount": 40,
  "serviceFee": 5,
  "taxRatePercent": 0
}
```

`slotId: null` sets a facility-wide rule; a slot UUID limits the rule to that space. The server takes the currency from the facility, checks that a supplied slot belongs to that facility, retains previous rules as inactive history, and records the change in the audit log. Creating an active rule for the same scope/rate type deactivates the previous active rule.

### `POST /lots/:lotId/slots/bulk`
Owner/admin/assigned operator. Creates 1–100 slots atomically. Request example:

```json
{
  "codes": ["A-01", "A-02", "A-03"],
  "zoneId": null,
  "vehicleType": "car",
  "covered": false,
  "accessible": false
}
```

New slots are operationally open but their physical state defaults to `unknown`. They are not advertised as available until their physical state is known to be empty and they have no active reservation.

### `PATCH /slots/:slotId`
Owner/admin/assigned operator/assigned attendant can update allowed slot state. Attendants may update physical state, but only owners/admins/assigned operators can change operational status. The API checks the assignment; UI visibility is not used as a security boundary.

### Staff assignment
- `POST /lots/:lotId/staff` — administrator-only, assigns an already-active user with the corresponding `operator` or `attendant` role.
- `DELETE /lots/:lotId/staff/:userId/:role` — administrator-only removal.

## Status and error conventions

Successful list responses use `{ "lots": [...] }`, `{ "zones": [...] }` or `{ "slots": [...], "summary": {...} }`. Errors use `{ "error": { "code": "...", "message": "..." } }`.

Important statuses include 400 validation failures, 401 unauthenticated, 403 forbidden, 404 not found, 409 duplicate/conflicting inventory values and 500 unexpected service errors. The global error handler intentionally does not send database-driver messages to browser clients.


# Phase 4 — booking API contract

Base path: `/api/bookings`. All endpoints below require an authenticated session.

## `POST /quote`

Example request:

```json
{
  "slotId": "a-valid-slot-uuid",
  "startAt": "2026-10-22T10:00:00+05:30",
  "endAt": "2026-10-22T12:00:00+05:30",
  "vehicleId": null
}
```

Response includes the selected slot, normalized interval and a server-calculated `quote` with `rateType`, `units`, `unitAmount`, `baseAmount`, `serviceFee`, `taxRatePercent`, `taxAmount`, `discountAmount`, `totalAmount`, `currency` and pricing-rule snapshot details. The API does not trust prices sent by the client.

The API rejects invalid intervals, intervals under 30 minutes, intervals over 30 days, inactive facilities, disabled or maintenance spaces, incompatible owned vehicles, unavailable near-term physical state, uncovered pricing intervals and conflicting active reservations.

## `POST /`

Uses the same request body as `/quote`. Atomically locks the selected slot row, expires old holds for that slot, rechecks conflicts, recalculates the quote and creates a `held` booking with a ten-minute expiry. It returns HTTP 201 with `{ booking, holdMinutes, message }`. Status `held` is not a payment confirmation. Payment checkout is implemented under `/api/payments/orders`; a held reservation becomes confirmed only after the configured provider reports a verified captured payment, or after the explicitly local-only mock simulation in development.

The slot row lock ensures requests from this API serialize for the same space. The overlap predicate uses half-open intervals (`existing.start_at < requested.end_at` and `existing.end_at > requested.start_at`) so adjacent reservations can meet exactly at an endpoint.

## `GET /mine?status=&limit=`

Returns the signed-in user's booking history. `limit` defaults to 30 and is capped at 100. Expired holds are marked `expired` during retrieval when their expiry has passed.

## `GET /:bookingId`

Returns booking details to its owner or an administrator. Other users receive a not-found response.

## `POST /:bookingId/cancel`

Cancels an unpaid `held` or `pending_payment` reservation and writes an audit event. Confirmed bookings are not cancelled by this endpoint until provider refunds and cancellation rules are implemented.

## Booking status notes

- `held`: temporary slot hold; payment has not completed.
- `pending_payment`: reserved while an in-progress payment flow is being processed.
- `confirmed`: payment has been verified as captured (or simulated through local development mode), and a signed QR ticket is available.
- `expired`: hold expiry time passed.
- `cancelled`: user or admin cancelled an unpaid hold.

Payment records, provider checkout, server verification, signed QR ticket retrieval and gate scanning are implemented. Refunds, automatic late-capture refunds, and operator-led payment reconciliation UI remain future work; captured payments that cannot confirm a reservation are flagged in transaction history.


## Phase 5 — Payments and gate access

### `POST /api/payments/orders`
Authenticated. Body: `{ "bookingId": "UUID" }`. Returns a provider checkout descriptor and server-created amount in minor units. Reuses an active order where possible. The booking remains `pending_payment` until capture is verified.

### `POST /api/payments/verify`
Authenticated. Razorpay body: `{ "bookingId": "UUID", "razorpay_order_id": "...", "razorpay_payment_id": "...", "razorpay_signature": "..." }`. The server verifies the checkout HMAC and independently retrieves the provider payment before confirming a booking.

### `POST /api/payments/webhook/razorpay`
Provider-to-server webhook. Registered before JSON parsing so HMAC validation uses raw request bytes. Configure `payment.captured` and `payment.failed` in the payment provider. A signed, captured payment can confirm a valid hold; late captures that conflict with the inventory are recorded and flagged for review.

### `POST /api/payments/mock/complete`
Authenticated, development/test only. Body: `{ "paymentId": "UUID" }`. Simulates capture without charging money; the route is intentionally unavailable in production.

### `GET /api/payments/mine`
Authenticated. Returns the current user's payment attempts and statuses.

### `GET /api/bookings/:bookingId/ticket`
Authenticated owner-only endpoint. Returns booking details, ticket expiry and a PNG QR image data URL only for confirmed/checked-in bookings.

### `GET /api/payments/:paymentId/receipt`
Authenticated, owner-only printable HTML receipt for a verified captured payment. The receipt includes the transaction reference, booked facility/space, time interval and a price breakdown. A captured payment requiring reconciliation is clearly marked as payment-only and must not be treated as parking authorization.

### `POST /api/gate/scan`
Authenticated role: attendant/operator/admin. Body: `{ "token": "signed-qr-token", "action": "entry" | "exit" }`. Non-admin users must have an assignment to the target facility. Entry changes booking state to `checked_in` and opens a parking session; exit completes the active session and marks physical occupancy unknown pending a fresh observation.


# Phase 6 — shared parking marketplace and vehicle garage

## Shared listing search

`GET /api/marketplace/listings?q=&city=&parkingType=&amenity=&maxHourlyRate=&limit=` returns only active shared-space listings. Filters are optional. Photos and amenity labels are included in summary records. Public discovery requires no user identity in the search endpoint; viewing private draft details requires an authenticated owner or admin.

## Owner listing lifecycle

- `GET /api/marketplace/listings/mine` — host's shared listings; administrators may review all shared listings.
- `POST /api/marketplace/listings` — creates a draft listing, slot inventory, the initial hourly/optional daily-weekly-monthly rate rules, and seven default availability rows.
- `GET /api/marketplace/listings/:listingId` — requires authentication; an active listing can be viewed by a signed-in customer, while drafts and other non-active listings are restricted to their owner or admin.
- `PATCH /api/marketplace/listings/:listingId` — owner/admin descriptive, contact, location and amenity updates.
- `PUT /api/marketplace/listings/:listingId/availability` — saves exactly one schedule rule for each local weekday (0 Sunday through 6 Saturday). Available days need open and close times; overnight schedules are not supported by this version.
- `POST /api/marketplace/listings/:listingId/photos` — multipart form upload field `photos`; accepts up to eight JPEG/PNG/WebP files per listing, max 5 MB per file. Image signatures are checked after MIME validation. These files are public parking-listing assets, not private document storage.
- `DELETE /api/marketplace/listings/:listingId/photos/:photoId` — owner/admin.
- `POST /api/marketplace/listings/:listingId/submit-for-approval` — requires at least one slot, active hourly rule, seven schedule rows and one photo.
- `GET /api/marketplace/earnings/mine` — displays a ledger of pending/approved/paid/reversed earnings. No payout is initiated by this endpoint.

## Vehicles

- `GET /api/vehicles/mine` — current user's registered vehicles.
- `POST /api/vehicles` — create a vehicle; the first vehicle is made default automatically.
- `PATCH /api/vehicles/:vehicleId` — update owned vehicle details or default preference.
- `DELETE /api/vehicles/:vehicleId` — deletes only if no booking uses the vehicle; otherwise returns `409 VEHICLE_IN_USE`.

## Weekly schedule booking rule

A `shared_space` quote or hold requires a complete seven-day availability schedule. The start time must be inside the local day's interval; departure may occur exactly at closing. Multi-day stays validate the arrival's and departure's respective local days; the car may remain parked while the host is not accepting arrivals between those times. The listing's IANA timezone is used to evaluate local weekday and time. General facility listings continue to use their facility opening/closing hours.

The host earning ledger is written in the same database transaction that confirms a verified captured payment. It is unique by booking and payment; the status remains `pending` until a separate controlled settlement process exists. This phase does not implement payouts or refunds.


# Phase 8 — referral programme

All endpoints require an authenticated session.

- `GET /api/referrals/me` — creates a stable referral code for legacy accounts if needed, then returns the personal referral link, referral counts, referral activity, and internal-credit balance.
- `GET /api/referrals/rewards` — returns the signed-in user's referral-credit ledger.
- `POST /api/auth/register` accepts an optional `referralCode`. Unknown codes are rejected before account creation.

The current qualification rule awards INR 100 in internal credits to each party after the referred account completes a gate-recorded parking session and a verified paid payment exists, provided there is no refund request for that booking. These ledger credits are not cash and are not withdrawable or redeemable in this phase.

---

<a id="documentation-source-docs-architecture-md"></a>

## docs/architecture.md

### SmartPark architecture

## Services
- `apps/web`: responsive React application; browser requests `/api/*` via Vite proxy in development.
- `services/api`: Express REST API; owns authentication, validation, authorization and business transactions.
- `database`: ordered SQL migrations for MySQL 8.
- `services/vision`: planned Python/OpenCV service; will submit authenticated occupancy events to the API.
- `database/migrations/003_parking_inventory.sql`: adds physical slot state and lot-specific staff assignments.

## Authentication and source of truth
- MySQL is authoritative for users, roles, sessions, lots, slots, pricing, reservations and payment records.
- Passwords are hashed with Node.js `scrypt`; random session tokens are held in HttpOnly cookies, with only token hashes stored in MySQL.
- Account verification and password reset use random, single-use tokens stored as hashes with expiry.
- Public registration assigns only the `driver` role. Privileged roles are assigned from trusted administrative operations.
- Browser write requests are checked against the configured web origin, and session cookies use `SameSite=Strict`.
- The vision service contributes timestamped physical-occupancy observations; it must not decide booking availability by itself.
- Client-side state is never authoritative for payments or booking conflicts.
- Facility discovery returns only active/published lots. Draft details require owner/admin or assigned-staff permission.
- Availability is conservative: only open, known-empty, currently unreserved slots are reported available. Camera observations and reservations remain separate states.

## Development URLs
- Web: http://127.0.0.1:5173
- API: http://127.0.0.1:4000
- API health: http://127.0.0.1:4000/api/health

## Before public deployment
- Configure HTTPS, production secrets, SMTP email delivery and a production database.
- Replace the in-memory rate limiter with a shared store if running multiple API replicas.
- Add service-to-service authentication for camera events.
- Complete booking concurrency controls, payment verification, QR validation and the remaining booking/payment business endpoints.
- Apply migration 003 before using parking inventory endpoints; run `npm run seed:demo` only in local development if sample inventory is helpful.
- Configure audit retention, backups, monitoring and tested recovery procedures.
- Review and apply migrations carefully; never run initialization SQL against a non-empty database without checking schema and taking a backup.

---

<a id="documentation-source-docs-deployment-security-checklist-md"></a>

## docs/deployment-security-checklist.md

### SmartPark Production Deployment & Security Checklist

Use this checklist before exposing a SmartPark deployment to real customers. Passing local unit tests does not replace deployment-specific testing, payment-provider certification, or camera/site acceptance testing.

## 1. Secrets and environment

- [ ] Set `NODE_ENV=production` and a production-only environment file/secret manager.
- [ ] Run `npm run preflight:production` and `docker compose -f docker-compose.production.yml config --quiet` before release.
- [ ] Use the migration runner on a new database; for a manually migrated database, verify expected schema objects and baseline existing migrations rather than replaying them.
- [ ] Review `README.md#documentation-source-docs-production-deployment-md` and record each item in `README.md#documentation-source-docs-release-checklist-md`.
- [ ] Set a unique, high-entropy `DB_PASSWORD` and `MYSQL_ROOT_PASSWORD`; do not reuse development passwords.
- [ ] Set a unique `QR_SIGNING_SECRET` (at least 32 random characters) and `VISION_API_TOKEN` (at least 32 random characters).
- [ ] Set `PAYMENT_PROVIDER=razorpay`; configure production keys and a webhook secret only in the hosting secret manager.
- [ ] Configure `WEB_ORIGIN` to the exact HTTPS origin used by the browser application.
- [ ] Configure SMTP credentials and verify SPF, DKIM and DMARC for the sending domain if outbound email is enabled.
- [ ] Verify `.env`, private keys, payment credentials, model credentials and uploaded secrets are excluded from Git and CI artifacts.

## 2. Network and TLS

- [ ] Terminate TLS at a maintained reverse proxy/load balancer; redirect HTTP to HTTPS.
- [ ] Keep MySQL private. Do not expose port 3306 to the public internet.
- [ ] Keep the Node API private behind the reverse proxy where possible; restrict internal service access.
- [ ] Keep the Python vision API and MJPEG stream private. Do not expose camera endpoints directly to the internet.
- [ ] Restrict RTSP camera networks to approved sources. Do not place RTSP usernames/passwords in public UI or logs.
- [ ] Confirm CSP, HSTS, cookie flags, CORS origins, request-size limits and proxy trust settings match the actual deployment topology.
- [ ] Apply rate limits and abuse protection at both the application and edge layers.

## 3. Database and storage

- [ ] Back up MySQL and test a restore before running migrations against production data.
- [ ] Use `npm run migrate` on a new database. On an existing database manually migrated before the history table was introduced, back up first and use the checked baseline path in `README.md#documentation-source-docs-production-deployment-md`. Never blindly replay migrations.
- [ ] Use the least-privilege application database account; reserve schema migration credentials for deployment jobs.
- [ ] Enable automated encrypted backups and define retention/recovery objectives.
- [ ] Persist `services/api/uploads/marketplace/` or move photo storage to a private object-storage service; do not rely on ephemeral container disk.
- [ ] Check file size/type handling, backup retention and deletion behavior for user-uploaded images.
- [ ] Use durable persistent storage for configured camera media and manage detector model files deliberately.

## 4. Accounts and authorization

- [ ] Verify production email-verification links use HTTPS and a configured public origin.
- [ ] Verify password reset links, session expiry and session invalidation after password reset/logout.
- [ ] Test owner, operator, attendant and administrator data isolation across two or more facilities.
- [ ] Ensure public registration cannot assign privileged roles.
- [ ] Review administrator accounts and remove demo users/sample data.
- [ ] Test that a user cannot retrieve another user's bookings, vehicles, notifications, receipts or QR ticket by modifying IDs.
- [ ] Ensure an attendant cannot access financial analytics or resolve manager-level alerts.

## 5. Payments and QR entry

- [ ] Disable mock payments; production configuration must reject `PAYMENT_PROVIDER=mock`.
- [ ] Test real provider orders with correct amount/currency matching, signed checkout verification and provider webhook signature validation.
- [ ] Test duplicate/replayed webhooks and repeat checkout submits; confirm idempotency.
- [ ] Exercise captured-payment reconciliation cases before enabling live traffic.
- [ ] Reconcile provider settlements with local `payments` and `host_earnings`; the host ledger is not itself a bank transfer.
- [ ] Validate refund and cancellation policy operationally before enabling paid-booking cancellation.
- [ ] Test QR tampering, expired tickets, replay attempts, early/late arrival and facility/slot status changes.
- [ ] Keep gate devices and operator identities auditable. Do not authorize an entry based solely on a QR image without the server validation response.

## 6. Computer vision and operational alerts

- [ ] Measure empty/occupied classification accuracy at each site in daylight, darkness, glare, rain and occlusion conditions.
- [ ] Validate camera region mappings after any camera move, zoom or crop change.
- [ ] Test camera disconnects, stale heartbeats, service restart and multiple camera sources.
- [ ] Keep unknown/stale state conservative; do not sell or grant entry based only on an unverified visual classification.
- [ ] Test alert scope: owners/operators see only their facilities, attendants cannot resolve alerts, and only admins see platform-wide alerts.
- [ ] Configure an on-call/operator process for critical alerts and reconciliation flags.
- [ ] Check disk, memory, CPU/GPU, frame processing lag and model availability under realistic load.

## 7. Observability and operational readiness

- [ ] Ship application logs to a protected log sink; redact passwords, sessions, reset tokens, payment secrets and camera stream credentials.
- [ ] Monitor API health, database connectivity, queueing/latency, payment webhook failures and vision heartbeat freshness.
- [ ] Alert on failed backups, database storage, application restarts, high error rates and growing reconciliation backlog.
- [ ] Establish a rollback plan for both application releases and database migrations.
- [ ] Test recovery from a database restore and a lost vision worker.
- [ ] Complete automated API tests, frontend production build, database-backed integration tests and a browser-based end-to-end journey.
- [ ] Complete a security review and the legal/privacy review relevant to the deployment jurisdiction.

## 8. Release acceptance flow

Before launch, test this single flow end to end: driver registration and verification → facility discovery → slot selection and server quote → payment-provider capture → confirmed booking and QR ticket → authorized gate entry → camera/operational state reconciliation → exit and completed session → transaction/receipt history → owner/operator/admin reports.

---

<a id="documentation-source-docs-docs-api-specification-md"></a>

## docs/docs/api-specification.md

### SmartPark API — Phase 3 contract

Base path: `/api/parking`. Browser requests are sent to the same origin; the Vite dev server proxies `/api` to the Express service.

All IDs are UUID strings. JSON request bodies use camelCase. Dates and timestamps returned by MySQL should be interpreted as UTC unless a field explicitly denotes a facility-local time.

## Discovery

### `GET /overview`
Returns aggregate data for active/published lots:

```json
{
  "overview": {
    "activeLots": 0,
    "totalSpaces": 0,
    "availableNow": 0,
    "occupiedNow": 0,
    "unknownSpaces": 0,
    "reservedNow": 0,
    "openSpaces": 0
  },
  "featuredLots": []
}
```

### `GET /lots?q=&city=&limit=`
Lists only facilities whose status is `active`. Text search matches facility name, address, city and description. `limit` defaults to 30 and is capped at 50.

### `GET /lots/:lotId`
Requires an active session. Published facilities can be read by signed-in drivers; non-public facilities require an owner/admin or assigned-staff permission.

### `GET /lots/:lotId/slots`
Returns the slot grid and summary. Every slot exposes its physical state, operational state, current-reservation flag and derived current availability state.

Derived availability priority:
1. `disabled` or `maintenance` operational state means unavailable.
2. `occupied` physical state displays occupied.
3. An active current booking displays reserved when the slot is not physically occupied.
4. Unknown physical state remains unknown.
5. Only open + physically empty + not currently reserved is available.

This is a **current-state view**. A full future-time availability endpoint belongs to the booking phase and must evaluate overlapping intervals transactionally.

## Facility and inventory management

### `POST /lots`
Host or administrator. Required fields: `name`, `addressLine`, `city`. Optional fields include `description`, `region`, `postalCode`, `countryCode`, `latitude`, `longitude`, `timezone`, `currency`, `openingTime`, `closingTime`. Host-created facilities are always created as `draft`; an administrator may explicitly set a supported status.

### `PATCH /lots/:lotId`
Owner/admin facility details update. Does not update status or owner identity.

### `POST /lots/:lotId/submit-for-approval`
Owner submits a draft for administrator review.

### `PATCH /lots/:lotId/status`
Administrator-only facility status workflow. Request: `{ "facilityStatus": "active" }` (also `draft`, `pending_approval`, `paused`, `closed`, `archived`).

### `POST /lots/:lotId/zones`
Owner/admin/assigned operator. Request: `{ "name": "Level 1 North", "levelLabel": "First floor" }`.

### Pricing rules

- `GET /lots/:lotId/pricing` — returns the pricing rules visible to the signed-in user if they can view the facility.
- `POST /lots/:lotId/pricing` — owner/admin/assigned operator. Request example:

```json
{
  "slotId": null,
  "rateType": "hourly",
  "amount": 40,
  "serviceFee": 5,
  "taxRatePercent": 0
}
```

`slotId: null` sets a facility-wide rule; a slot UUID limits the rule to that space. The server takes the currency from the facility, checks that a supplied slot belongs to that facility, retains previous rules as inactive history, and records the change in the audit log. Creating an active rule for the same scope/rate type deactivates the previous active rule.

### `POST /lots/:lotId/slots/bulk`
Owner/admin/assigned operator. Creates 1–100 slots atomically. Request example:

```json
{
  "codes": ["A-01", "A-02", "A-03"],
  "zoneId": null,
  "vehicleType": "car",
  "covered": false,
  "accessible": false
}
```

New slots are operationally open but their physical state defaults to `unknown`. They are not advertised as available until their physical state is known to be empty and they have no active reservation.

### `PATCH /slots/:slotId`
Owner/admin/assigned operator/assigned attendant can update allowed slot state. Attendants may update physical state, but only owners/admins/assigned operators can change operational status. The API checks the assignment; UI visibility is not used as a security boundary.

### Staff assignment
- `POST /lots/:lotId/staff` — administrator-only, assigns an already-active user with the corresponding `operator` or `attendant` role.
- `DELETE /lots/:lotId/staff/:userId/:role` — administrator-only removal.

## Status and error conventions

Successful list responses use `{ "lots": [...] }`, `{ "zones": [...] }` or `{ "slots": [...], "summary": {...} }`. Errors use `{ "error": { "code": "...", "message": "..." } }`.

Important statuses include 400 validation failures, 401 unauthenticated, 403 forbidden, 404 not found, 409 duplicate/conflicting inventory values and 500 unexpected service errors. The global error handler intentionally does not send database-driver messages to browser clients.


# Phase 4 — booking API contract

Base path: `/api/bookings`. All endpoints below require an authenticated session.

## `POST /quote`

Example request:

```json
{
  "slotId": "a-valid-slot-uuid",
  "startAt": "2026-10-22T10:00:00+05:30",
  "endAt": "2026-10-22T12:00:00+05:30",
  "vehicleId": null
}
```

Response includes the selected slot, normalized interval and a server-calculated `quote` with `rateType`, `units`, `unitAmount`, `baseAmount`, `serviceFee`, `taxRatePercent`, `taxAmount`, `discountAmount`, `totalAmount`, `currency` and pricing-rule snapshot details. The API does not trust prices sent by the client.

The API rejects invalid intervals, intervals under 30 minutes, intervals over 30 days, inactive facilities, disabled or maintenance spaces, incompatible owned vehicles, unavailable near-term physical state, uncovered pricing intervals and conflicting active reservations.

## `POST /`

Uses the same request body as `/quote`. Atomically locks the selected slot row, expires old holds for that slot, rechecks conflicts, recalculates the quote and creates a `held` booking with a ten-minute expiry. It returns HTTP 201 with `{ booking, holdMinutes, message }`. Status `held` is not a payment confirmation. Payment checkout is implemented under `/api/payments/orders`; a held reservation becomes confirmed only after the configured provider reports a verified captured payment, or after the explicitly local-only mock simulation in development.

The slot row lock ensures requests from this API serialize for the same space. The overlap predicate uses half-open intervals (`existing.start_at < requested.end_at` and `existing.end_at > requested.start_at`) so adjacent reservations can meet exactly at an endpoint.

## `GET /mine?status=&limit=`

Returns the signed-in user's booking history. `limit` defaults to 30 and is capped at 100. Expired holds are marked `expired` during retrieval when their expiry has passed.

## `GET /:bookingId`

Returns booking details to its owner or an administrator. Other users receive a not-found response.

## `POST /:bookingId/cancel`

Cancels an unpaid `held` or `pending_payment` reservation and writes an audit event. Confirmed bookings are not cancelled by this endpoint until provider refunds and cancellation rules are implemented.

## Booking status notes

- `held`: temporary slot hold; payment has not completed.
- `pending_payment`: reserved while an in-progress payment flow is being processed.
- `confirmed`: payment has been verified as captured (or simulated through local development mode), and a signed QR ticket is available.
- `expired`: hold expiry time passed.
- `cancelled`: user or admin cancelled an unpaid hold.

Payment records, provider checkout, server verification, signed QR ticket retrieval and gate scanning are implemented. Refunds, automatic late-capture refunds, and operator-led payment reconciliation UI remain future work; captured payments that cannot confirm a reservation are flagged in transaction history.


## Phase 5 — Payments and gate access

### `POST /api/payments/orders`
Authenticated. Body: `{ "bookingId": "UUID" }`. Returns a provider checkout descriptor and server-created amount in minor units. Reuses an active order where possible. The booking remains `pending_payment` until capture is verified.

### `POST /api/payments/verify`
Authenticated. Razorpay body: `{ "bookingId": "UUID", "razorpay_order_id": "...", "razorpay_payment_id": "...", "razorpay_signature": "..." }`. The server verifies the checkout HMAC and independently retrieves the provider payment before confirming a booking.

### `POST /api/payments/webhook/razorpay`
Provider-to-server webhook. Registered before JSON parsing so HMAC validation uses raw request bytes. Configure `payment.captured` and `payment.failed` in the payment provider. A signed, captured payment can confirm a valid hold; late captures that conflict with the inventory are recorded and flagged for review.

### `POST /api/payments/mock/complete`
Authenticated, development/test only. Body: `{ "paymentId": "UUID" }`. Simulates capture without charging money; the route is intentionally unavailable in production.

### `GET /api/payments/mine`
Authenticated. Returns the current user's payment attempts and statuses.

### `GET /api/bookings/:bookingId/ticket`
Authenticated owner-only endpoint. Returns booking details, ticket expiry and a PNG QR image data URL only for confirmed/checked-in bookings.

### `GET /api/payments/:paymentId/receipt`
Authenticated, owner-only printable HTML receipt for a verified captured payment. The receipt includes the transaction reference, booked facility/space, time interval and a price breakdown. A captured payment requiring reconciliation is clearly marked as payment-only and must not be treated as parking authorization.

### `POST /api/gate/scan`
Authenticated role: attendant/operator/admin. Body: `{ "token": "signed-qr-token", "action": "entry" | "exit" }`. Non-admin users must have an assignment to the target facility. Entry changes booking state to `checked_in` and opens a parking session; exit completes the active session and marks physical occupancy unknown pending a fresh observation.


# Phase 6 — shared parking marketplace and vehicle garage

## Shared listing search

`GET /api/marketplace/listings?q=&city=&parkingType=&amenity=&maxHourlyRate=&limit=` returns only active shared-space listings. Filters are optional. Photos and amenity labels are included in summary records. Public discovery requires no user identity in the search endpoint; viewing private draft details requires an authenticated owner or admin.

## Owner listing lifecycle

- `GET /api/marketplace/listings/mine` — host's shared listings; administrators may review all shared listings.
- `POST /api/marketplace/listings` — creates a draft listing, slot inventory, the initial hourly/optional daily-weekly-monthly rate rules, and seven default availability rows.
- `GET /api/marketplace/listings/:listingId` — requires authentication; an active listing can be viewed by a signed-in customer, while drafts and other non-active listings are restricted to their owner or admin.
- `PATCH /api/marketplace/listings/:listingId` — owner/admin descriptive, contact, location and amenity updates.
- `PUT /api/marketplace/listings/:listingId/availability` — saves exactly one schedule rule for each local weekday (0 Sunday through 6 Saturday). Available days need open and close times; overnight schedules are not supported by this version.
- `POST /api/marketplace/listings/:listingId/photos` — multipart form upload field `photos`; accepts up to eight JPEG/PNG/WebP files per listing, max 5 MB per file. Image signatures are checked after MIME validation. These files are public parking-listing assets, not private document storage.
- `DELETE /api/marketplace/listings/:listingId/photos/:photoId` — owner/admin.
- `POST /api/marketplace/listings/:listingId/submit-for-approval` — requires at least one slot, active hourly rule, seven schedule rows and one photo.
- `GET /api/marketplace/earnings/mine` — displays a ledger of pending/approved/paid/reversed earnings. No payout is initiated by this endpoint.

## Vehicles

- `GET /api/vehicles/mine` — current user's registered vehicles.
- `POST /api/vehicles` — create a vehicle; the first vehicle is made default automatically.
- `PATCH /api/vehicles/:vehicleId` — update owned vehicle details or default preference.
- `DELETE /api/vehicles/:vehicleId` — deletes only if no booking uses the vehicle; otherwise returns `409 VEHICLE_IN_USE`.

## Weekly schedule booking rule

A `shared_space` quote or hold requires a complete seven-day availability schedule. The start time must be inside the local day's interval; departure may occur exactly at closing. Multi-day stays validate the arrival's and departure's respective local days; the car may remain parked while the host is not accepting arrivals between those times. The listing's IANA timezone is used to evaluate local weekday and time. General facility listings continue to use their facility opening/closing hours.

The host earning ledger is written in the same database transaction that confirms a verified captured payment. It is unique by booking and payment; the status remains `pending` until a separate controlled settlement process exists. This phase does not implement payouts or refunds.

## Phase 8: operations and notifications

### Operations analytics (host, operator, administrator)
- `GET /api/operations/summary` — scoped active facilities, spaces, availability, physical occupancy, active reservations, alert totals and verified 30-day revenue grouped by currency.
- `GET /api/operations/reports/revenue?from=YYYY-MM-DD&to=YYYY-MM-DD` — verified payment totals by UTC calendar date and currency. Reconciliation-flagged payments are excluded; date ranges are capped at 366 days.
- `GET /api/operations/reports/occupancy` — current inventory state by accessible active facility. Physical occupancy is distinct from reservations.

### Operational alerts
- `GET /api/operations/alerts?status=open|acknowledged|resolved|all&limit=50` — lists scoped alerts. System checks update camera-staleness/offline and payment-reconciliation alerts.
- `POST /api/operations/alerts/:alertId/acknowledge` — assigned host/operator/attendant or admin marks an open alert acknowledged.
- `POST /api/operations/alerts/:alertId/resolve` — assigned host/operator or admin records resolution.

### Notifications (authenticated user)
- `GET /api/notifications/mine?limit=50&unreadOnly=true|false` — reads only the signed-in user's inbox and unread count.
- `POST /api/notifications/:notificationId/read` — marks an owned notification as read.
- `POST /api/notifications/read-all` — marks the signed-in user's unread notifications as read.

All facility-scoped data is restricted by host ownership or operator/attendant assignments. Dates in revenue reports are evaluated as UTC day boundaries. In-app notifications are recorded, but external email/SMS/push dispatch must be configured and separately verified.


## Phase 10: transactional email worker

The worker is not exposed as a public API. It consumes due rows from `transactional_email_outbox`. `npm run worker:email` runs continuously; `npm run worker:email:once` processes due messages then exits. Lifecycle email templates are generated server-side from allowlisted data and HTML-escaped fields. The signed-in user's email must be verified and account status active before an event email can be queued.


## Phase 11: refund and host payout operations

Customer endpoints:
- `POST /api/financial/refunds` — create a full refund request for an eligible upcoming paid booking.
- `GET /api/financial/refunds/mine` — view the customer's own refund requests.
- `GET /api/financial/payouts/mine` — view a host's own payout requests.
- `POST /api/financial/payouts` — reserve the host's approved earning balance into a payout request.

Administrator endpoints:
- `GET /api/financial/refunds/queue`, `POST /api/financial/refunds/:refundId/approve`, `/reject`, `/start-processing`, `/mark-refunded`, `/mark-failed`, `/manual-review`.
- `GET /api/financial/earnings/queue`, `POST /api/financial/earnings/:earningId/approve`, `/reverse`.
- `GET /api/financial/payouts/queue`, `POST /api/financial/payouts/:payoutId/approve`, `/reject`, `/mark-paid`, `/mark-failed`, `/manual-review`.

All mutating financial endpoints require authenticated role permissions and an audit trail. External payment-provider and bank actions are not automatically executed by these endpoints; completed refunds and payouts must be externally confirmed before an administrator records their reference. Amounts use server-side payment/earning data, not client-submitted totals.


# Phase 12 — discovery engagement API

Base path: `/api/engagement`. All endpoints require an authenticated session unless noted otherwise.

- `GET /favorites/ids` — current user's saved active parking-lot IDs for fast card rendering.
- `GET /favorites` — current user's saved active facilities, public listing fields, minimum hourly rate and published review aggregate.
- `POST /favorites/:lotId` — idempotently save an active facility.
- `DELETE /favorites/:lotId` — remove a saved facility.
- `GET /search-history?limit=20` — current user's recent searches.
- `POST /search-history` — stores normalized query/city text only; empty searches are ignored and GPS coordinates are not accepted.
- `DELETE /search-history/:searchId` and `DELETE /search-history` — remove one saved search or clear history.
- `GET /eligible-reviews` — completed bookings that do not yet have a review, excluding the current user's own facility.
- `GET /my-reviews?limit=20` — current user's reviews and current publication status.
- `GET /lots/:lotId/reviews?limit=20` — public endpoint for active facilities; returns published reviews, aggregate rating and review count. Public output uses a shortened reviewer label and omits booking IDs.
- `POST /lots/:lotId/reviews` — authenticated review of a completed booking by its owner; one review per booking, no self-review of an owned facility.
- `PATCH /reviews/:reviewId` and `DELETE /reviews/:reviewId` — owner can edit or delete their own review.
- `PATCH /reviews/:reviewId/moderation` — administrator-only `published`/`hidden` moderation with audit event.

Input ratings are integers from 1 to 5, review title is optional up to 120 characters, and review text must be 3–1000 characters. Reviews require booking status `completed`. Ratings on parking summaries use only `published` reviews. Search history stores only query text and city; each account is bounded to 500 retained entries.

---

<a id="documentation-source-docs-docs-architecture-md"></a>

## docs/docs/architecture.md

### SmartPark architecture

## Services
- `apps/web`: responsive React application and role-aware workspace UI.
- `services/api`: Express REST API; owns authentication, authorization, booking/pricing transactions, payment verification, notifications, operational analytics and alerts.
- `database`: ordered MySQL 8 migrations (001–010).
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

`notifications` is a user-owned in-app event history. Booking holds/cancellations, paid booking confirmations, gate entry/exit and first detection of system alerts create records. The API supports user-owned inbox retrieval and read status changes. Email verification/password reset use the configured mail pathway. Phase 10 adds a separate transactional email outbox worker for booking and gate lifecycle events; SMS/push dispatch is not included. Phase 11 adds audited refund and host-payout workflows; actual provider refunds and bank transfers are carried out externally and recorded by an administrator.

## Production dependencies

- Web/API: Node.js, npm workspace install, React/Vite production build and Express API.
- Database: MySQL 8.4 with migrations 001–010 applied once.
- Vision: supported Python runtime, OpenCV, optional Ultralytics/PyTorch model and configured cameras/slot polygons.
- Payments: configured provider keys, verified signatures/webhooks and operational reconciliation.
- Infra: HTTPS reverse proxy, private database/vision network paths, strong secrets, durable uploads/model files, tested backups and monitored logs.

See `README.md#documentation-source-docs-deployment-security-checklist-md` and `README.md#documentation-source-docs-operations-runbook-md` before production deployment.


## Transactional email delivery

Booking and gate lifecycle routes enqueue email records in `transactional_email_outbox` within the same MySQL transaction as the business event. A separate Node worker claims due rows with `FOR UPDATE SKIP LOCKED`, renews processing leases, delivers allowlisted templates through SMTP, and applies exponential retry delays up to eight attempts. Event idempotency keys prevent duplicate queue records. SMTP is at-least-once delivery; duplicate emails are possible if the provider accepts an email immediately before a worker crash.


## Phase 12 discovery engagement

`/api/engagement` stores per-user favorites and limited recent query/city searches, and accepts reviews only for completed bookings. Public parking summaries include published review averages; public review output shortens reviewer names and omits booking IDs. Admin moderation hides/republishes reviews with an audit event. See `README.md#documentation-source-docs-engagement-md` and migration 011.

---

<a id="documentation-source-docs-docs-engagement-md"></a>

## docs/docs/engagement.md

### SmartPark saved parking and reviews (Phase 12)

## Favorites

- `GET /api/engagement/favorites/ids` returns active facility IDs saved by the current account.
- `GET /api/engagement/favorites` returns saved active facility cards for the current account.
- `POST /api/engagement/favorites/:lotId` saves an active facility. Repeating the request is safe.
- `DELETE /api/engagement/favorites/:lotId` removes the favorite.
- Favorites are private per user. The API does not expose one user's saved places to another account.

## Recent searches

- `POST /api/engagement/search-history` accepts only `q` and `city`, normalizes whitespace and truncates each field to 100 characters. Empty searches are ignored. GPS coordinates are not accepted or stored.
- `GET /api/engagement/search-history?limit=20` returns only the current user's records.
- `DELETE /api/engagement/search-history/:searchId` removes one record owned by the current user; `DELETE /api/engagement/search-history` clears the user's history.
- When an account has at least 500 retained searches, older records are pruned before another record is added.

## Reviews and ratings

- The review form is available only for a completed booking associated with that parking facility and current account.
- One review per completed booking is enforced in the application and by unique database constraint `uq_parking_review_booking_user`.
- Facility owners cannot review their own facility. Review rating is an integer 1–5; title is optional up to 120 characters; text is 3–1000 characters.
- Public review listing is limited to active facilities and published reviews. Average ratings/counts exclude hidden reviews.
- Public review records return a shortened display name (first name and last initial) and do not expose booking IDs, email addresses or full names.
- Users can edit/delete their own reviews. Admins can hide or republish reviews; moderation changes create an audit event.

## Migration and checks

Migration: `database/migrations/011_favorites_search_reviews.sql`.

Run `npm run migrate` after confirming the migration history is correct. Do not replay numbered migrations that have already succeeded. For a manually migrated database without history, back up and use the version-appropriate schema baseline procedure documented in `production-deployment.md`.

The pure logic tests cover search normalization, review input validation, reviewer-name shortening and public output mapping. Full route authorization and unique-key concurrency must still be verified against MySQL 8.4 before launch.

---

<a id="documentation-source-docs-docs-financial-operations-md"></a>

## docs/docs/financial-operations.md

### SmartPark financial operations (Phase 11)

This workflow adds an auditable **full-refund request** and **manual host payout** process. It does not initiate a refund with Razorpay or transfer money through a bank API. Administrators must perform the action in the external provider/bank system, verify its result, and then record the provider reference in SmartPark.

## Roles

- **Customer:** may request a refund for their own captured/verified payment when the booking is confirmed and its start time is still in the future. The current workflow requests the full payment amount; partial refunds are not implemented.
- **Host:** may request a payout using only their own approved earnings. An earning must come from a completed booking with a captured payment and no reconciliation flag.
- **Administrator:** reviews refund and payout requests, records audit notes, manages exceptions, and records a verified external reference after external processing.

All API changes are role-protected and audited. Do not share provider credentials, payment IDs, or banking details in support notes.

## Refund status flow

- `requested` → `approved` or `rejected`
- `approved` → `processing`, `rejected`, or `failed` (if it was confirmed no refund was submitted)
- `processing` → `succeeded`, `failed`, or `manual_review` (processing must be started before an externally completed refund can be recorded)
- `processing` → `succeeded`, `failed`, or `manual_review`
- `manual_review` → `succeeded` or `failed`
- `succeeded`, `rejected`, and `failed` are terminal for the current record. A later request after a rejected/failed record creates a separate audit record, subject to eligibility checks.

While a refund is `processing` or `manual_review`, QR entry is blocked. On recording a completed refund, the API requires the payment to still be captured and the booking to still be confirmed with no active parked session. It records the external provider reference, marks the payment refunded, cancels the booking and invalidates its QR credential in the same database transaction. If any of those state checks fail, do not repeat the external refund; investigate the provider record and reconcile manually.

### Refund steps

1. Customer submits a reason through **Transactions**.
2. An administrator reviews and approves or rejects the request.
3. Before the booking begins, the administrator starts processing. This blocks entry while the outcome is unresolved.
4. The administrator performs the refund through the configured payment provider or approved finance workflow.
5. After confirming the provider's successful refund, the administrator records the exact external refund reference and a meaningful audit note in **Finance review**.
6. If the provider operation was not completed, record failure with an explanation. If the outcome is ambiguous, use manual review; do not guess or mark success.

## Host earnings and payouts

Host earnings become eligible for approval only after a booking is completed and its payment is verified/captured and not flagged for reconciliation. An administrator can approve or reverse eligible pending earnings. Approved earnings are reserved into a payout request when the host requests payout; each earning is linked to the payout request with its currency and amount.

Payout states:

- `requested` → `approved` or `rejected`
- `approved` → `paid`, `failed`, or `manual_review`
- `manual_review` → `paid` or `failed`

The payout flow checks the reserved earning rows, owner, currency and sum before the state transition. A host payout request does **not** transfer funds. An authorized finance/admin user must complete the transfer using the chosen bank/provider, confirm its result, then record the transfer reference and note. If the transfer result is unclear, leave the request in manual review until it is resolved.

## UI and API routes

Customer/host:

- `GET /api/financial/refunds/mine`
- `POST /api/financial/refunds`
- `GET /api/financial/payouts/mine`
- `POST /api/financial/payouts`

Administrator:

- `GET /api/financial/refunds/queue`
- `POST /api/financial/refunds/:refundId/approve`
- `POST /api/financial/refunds/:refundId/reject`
- `POST /api/financial/refunds/:refundId/start-processing`
- `POST /api/financial/refunds/:refundId/mark-refunded`
- `POST /api/financial/refunds/:refundId/mark-failed`
- `POST /api/financial/refunds/:refundId/manual-review`
- `GET /api/financial/earnings/queue`
- `POST /api/financial/earnings/:earningId/approve`
- `POST /api/financial/earnings/:earningId/reverse`
- `GET /api/financial/payouts/queue`
- `POST /api/financial/payouts/:payoutId/approve`
- `POST /api/financial/payouts/:payoutId/reject`
- `POST /api/financial/payouts/:payoutId/mark-paid`
- `POST /api/financial/payouts/:payoutId/mark-failed`
- `POST /api/financial/payouts/:payoutId/manual-review`

All state-changing endpoints require authentication and the appropriate role. Notes and external references are validated and every financial transition writes an audit event.

## Migration

Phase 11 is migration `010_refunds_and_host_payouts.sql`. Apply migrations 001–010 once in order on a new database. On a database managed by the migration runner through migration 009, run `npm run migrate` to apply 010. If the database was manually migrated before `schema_migrations` existed, back it up and use the schema baseline procedure documented in `production-deployment.md`. Never baseline a partially applied migration or edit a migration after it has been recorded as applied.

## Test checklist

- [ ] Customer cannot request a refund for another user's payment.
- [ ] Refund is rejected unless payment is captured, reconciled, booking is confirmed and start time is in the future.
- [ ] Two concurrent refund requests cannot reserve the same earning twice.
- [ ] Gate entry is blocked while refund status is processing or manual review.
- [ ] Refund completion rejects stale booking/payment state and an active parking session.
- [ ] External refund references are unique; retrying the same completed reference is idempotent.
- [ ] Customer refund/payout endpoints expose only that user's records.
- [ ] Host cannot request payout for another host's earnings.
- [ ] Payout amount equals the sum of its reserved earning allocations and currencies match.
- [ ] Payout rejection/failure releases only the earnings belonging to that payout.
- [ ] Mark-paid is idempotent for the same external transfer reference.
- [ ] External refund and payout records have been reconciled with the provider/bank report.

The automated API/helper tests do not replace full MySQL integration tests. Validate migration 010 and all concurrency cases against a disposable MySQL 8 database before enabling financial operations in production.

---

<a id="documentation-source-docs-docs-integration-testing-md"></a>

## docs/docs/integration-testing.md

### SmartPark Integration Testing

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

---

<a id="documentation-source-docs-docs-next-steps-md"></a>

## docs/docs/next-steps.md

### SmartPark implementation status

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

Use `npm run migrate` for a fresh database; it tracks migration checksums and applied state. For an existing database that was migrated manually before the runner existed, back up and follow the baseline procedure in `README.md#documentation-source-docs-production-deployment-md`. Do not re-run successful SQL migrations manually.

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
- Added `README.md#documentation-source-docs-integration-testing-md` with local setup steps and a staging end-to-end checklist.
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

Phase 15 is not considered complete until all checks in `README.md#documentation-source-docs-release-checklist-md` are recorded against the intended deployment environment: clean dependency install and lockfile, frontend production build, API and vision test suites, fresh and upgrade migration paths, role isolation, booking/payment/QR workflows, email delivery/retry, refund/payout reconciliation, TLS, backup/restore, and camera accuracy.


## Phase 15: final release candidate and launch gate

Phase 15 adds `npm run release:audit`, a static release-candidate audit for required files and commands, contiguous migrations and baseline version, source artifact hygiene, secret-pattern scanning, lockfile presence, and build/container-tool availability. `npm run verify:release` now starts with this audit before running deterministic tests, production frontend build, and live API smoke tests.

**This phase is a release-candidate gate, not a claim that production launch has been verified.** In the artifact-generation environment, API tests (94) and vision tests (14) pass. npm registry access timed out, so there is no root lockfile and Vite is unavailable; Docker and MySQL CLIs are also unavailable. Clean dependency installation, a root `package-lock.json`, frontend build, actual MySQL migrations/integration, provider checkout/webhooks, SMTP, TLS, backups, deployment health and onsite camera/gate validation must be completed on the development/staging/production host.

Use `README.md#documentation-source-docs-phase15-final-release-md` and `README.md#documentation-source-docs-release-checklist-md` to record evidence. Do not enable public booking or real payment traffic until mandatory checklist items pass.

---

<a id="documentation-source-docs-docs-operations-runbook-md"></a>

## docs/docs/operations-runbook.md

### SmartPark Operations Runbook

## Routine monitoring

1. Open **Operations** as a host, operator or administrator.
2. Review critical and open alerts first.
3. Review current inventory totals, unknown physical states, reserved-empty spaces and active bookings.
4. Review verified payment revenue by date range and currency. Values marked for payment reconciliation are excluded from verified revenue.
5. Open **Notifications** to review booking, payment, entry/exit and operational-alert events recorded for the signed-in account.

## Camera offline or stale alert

1. Open **Camera detection** and select the affected facility/camera.
2. Check the vision service terminal/logs and its `/health` endpoint.
3. Confirm the correct `VISION_API_TOKEN` is configured on the Node API and vision worker.
4. Check the camera URL/device index, network reachability, configured media root, file permissions and model availability.
5. Confirm the camera can read frames and the service can send authenticated events to the Node API.
6. Re-check live status. Slots without fresh evidence must remain unknown rather than being manually forced empty without inspection.
7. Acknowledge the alert while investigating. Resolve it only after the feed returns and a fresh heartbeat/frame is visible.

## Captured payment requires review

1. Do not issue an entry credential or manually mark the booking confirmed while its payment has `needs_reconciliation=TRUE`.
2. Open the provider dashboard and verify the order, payment ID, amount, currency, capture status and booking reference.
3. Compare these facts with the SmartPark transaction and booking records.
4. Use the approved support/refund process if the payment was captured but the reservation cannot safely be confirmed. Do not edit amounts or statuses directly without an auditable repair procedure.
5. Clear the reconciliation flag only after a documented, verified resolution. The alert feed will resolve the operational alert once the underlying flag is cleared.

## Booking conflict or physical-state mismatch

1. Check the booking interval and current reservation/session state.
2. Inspect the actual bay. Camera occupancy and reservation status are deliberately separate facts.
3. If an authorized manual correction is required, record the reason and who approved it.
4. Do not remove a booking solely because a camera reports a vehicle or does not see one; check payment and entry/exit records first.

## Alert lifecycle

- **Open:** A detected condition needs attention.
- **Acknowledged:** Someone has accepted responsibility for investigation; it is not a claim that the underlying fault is fixed.
- **Resolved:** The operator/admin has marked the issue handled. Automatically monitored alerts are reopened if the source first becomes healthy/cleared and the condition later recurs.

System-generated alerts currently cover camera offline/stale conditions and captured payments flagged for reconciliation. Extend the alert generator deliberately as new monitoring rules are added.

## Notification behavior

SmartPark records in-app events in `notifications`. The inbox supports listing, unread filtering and marking one/all as read. This phase does not claim a fully deployed email/SMS/push delivery worker for all business notifications; configure, monitor and test outbound delivery separately before promising those channels to users.

---

<a id="documentation-source-docs-docs-phase14-production-security-md"></a>

## docs/docs/phase14-production-security.md

### Phase 14 — production security and deployment configuration

This phase tightens service privilege and clarifies how secrets should be scoped. It does not certify the complete system for production.

## What changed

- `SMARTPARK_PROCESS=api` uses the full production validation set because the API handles payment verification, signed parking tickets and vision-service authentication.
- `SMARTPARK_PROCESS=email-worker` requires only the shared database credentials, HTTPS web origin and SMTP credentials it uses. It does not need Razorpay keys, QR signing keys, vision service tokens, or proxy trust configuration.
- Production Compose gives the API, email worker and web server read-only root filesystems, with explicit temporary writable mounts for runtime/cache paths; API marketplace uploads remain on their named persistent volume.
- Application containers use `no-new-privileges`, and capabilities are dropped for the API, mail worker and non-root vision service where supported. Web/worker/API services have PID and memory bounds. Caddy retains the network capability needed to bind the public HTTP/HTTPS ports.
- No database migration is introduced.

## Operator steps

1. Copy `.env.example` to `.env`; never commit or share `.env`.
2. Use independently generated secrets for database, payment webhook, QR signing, and vision service authentication. Keep a separate password for MySQL's root account.
3. Verify `APP_DOMAIN` resolves to the server and `WEB_ORIGIN` exactly matches `https://APP_DOMAIN`.
4. Configure verified SMTP sender/credentials and the correct TLS/STARTTLS mode for that mail provider.
5. Configure Razorpay credentials and webhook secret according to the target environment. Test using provider test mode in staging. Do not enable live payment acceptance until the provider's verification and reconciliation flow has passed.
6. Run `npm run preflight:production`. It validates configuration, not connectivity.
7. Run `docker compose -f docker-compose.production.yml config --quiet` and build the images on the target deployment host.
8. Start on a disposable database first; test migrations and rollback/restore before applying to data that matters.
9. Confirm the `email-worker` service environment contains only the DB/site-origin/SMTP values required to deliver outbox emails.
10. Observe actual memory use and worker backlogs after startup. The included limits are starting defaults and must be reviewed for expected traffic and camera workload.

## Release checks

- [ ] `npm install` succeeds and root `package-lock.json` is committed.
- [ ] `npm run test:all` passes.
- [ ] `npm run build` passes with the actual web dependencies.
- [ ] `npm run preflight:production` passes without printing secrets.
- [ ] Production Compose config and clean image builds pass.
- [ ] Fresh database migration and existing-schema baseline paths are tested against disposable MySQL.
- [ ] API health reports database connectivity.
- [ ] API/web/email-worker containers start under read-only/security settings and can process the expected workflows.
- [ ] Razorpay sandbox order, callback signature and webhook verification are tested.
- [ ] SMTP delivery, failure retry and terminal outbox handling are tested.
- [ ] TLS issuance/renewal, backup/restore, monitoring and incident contacts are confirmed.
- [ ] Camera streams, region calibration and stale/unknown behavior are tested on the intended site.
- [ ] Dependency and container image vulnerabilities have been reviewed and documented.

## Important limitations

- Rate limiting is process-local; use shared storage before running multiple API replicas.
- Payment-provider, bank transfer, SMTP, DNS/TLS, database restore and camera behavior cannot be validated by static tests alone.
- The API upload volume must remain writable; otherwise listing-photo uploads fail.
- Read-only root filesystems and temporary Nginx paths need a real container smoke test before deployment.
- Configure secret rotation, logs/metrics collection, off-host encrypted backup retention, privacy/camera notices and any jurisdiction-specific compliance independently.

---

<a id="documentation-source-docs-docs-phase15-final-release-md"></a>

## docs/docs/phase15-final-release.md

### Phase 15 — Final Deployment & Launch Verification

Phase 15 is the release-candidate stage. It does not claim public-production certification unless the environment-specific checks below have been completed and recorded by the operator.

## Automated release audit

Run from the project root:

```powershell
npm run release:audit
```

The audit checks required source/deployment files, Node.js version, required npm commands, contiguous SQL migrations and migration baseline version, `.gitignore` rules, source artifact hygiene, high-confidence secret patterns, lockfile presence, and whether frontend build/container tools are available. It never prints secret values. Warnings mean the audit could not verify a requirement in the current working environment; resolve or explicitly accept each warning before launch.

Then run the full release pipeline with a running API and migrated MySQL database:

```powershell
npm install
npm run check:syntax
npm run test:all
npm run build
npm run test:integration
```

The single command `npm run verify:release` runs the static audit, deterministic tests, frontend production build, and live HTTP smoke tests in sequence. It stops if a required command fails.

## Verification performed for this package

- API tests and source-contract tests: 99 passed after adding the Phase 15 audit contract checks.
- Python vision tests: 14 passed.
- SQL migrations: 001–012 are contiguous and the migration-runner baseline validates through version 12.
- Source syntax: all frontend JS/JSX/TS/TSX files and API/script JS files pass syntax checks using the available TypeScript compiler and Node.js parser.
- `npm install` was attempted, but registry access timed out in this environment; no root lockfile could be generated and Vite is unavailable.
- The `npm run build` command was attempted and failed because `vite` was not installed (`vite: not found`).
- Docker CLI and MySQL CLI are not installed in this environment, so container builds/startup, live database migrations, API-to-DB integration and TLS were not tested.

These are explicit limitations, not passes. The generated ZIP must be installed and verified on the development machine or staging server. A timestamped summary of checks is retained in `README.md#documentation-source-docs-release-evidence-phase15-static-checks-md`.

## Required go/no-go evidence

Before public launch, record pass/fail outcomes for every mandatory item in `README.md#documentation-source-docs-release-checklist-md`. At minimum:

1. On a network-enabled machine run `npm install`, retain the generated root `package-lock.json`, and verify a clean `npm ci` install.
2. Run `npm run release:audit`, `npm run test:all`, `npm run build`, and `npm run test:integration` with the API and a migrated, disposable MySQL database.
3. Build and start the production Compose stack; verify health checks, HTTPS and redirect, private database networking, persistent volumes, least-privilege containers and log redaction.
4. Test registration/verification, role and facility isolation, booking concurrency, Razorpay test-mode checkout/webhooks, QR replay/expiry, entry/exit, email outbox retry, refunds and payouts, and saved/review ownership rules.
5. Test backup restore, rollback, monitoring/alerts, and camera acceptance at the intended site, including darkness, glare, occlusion, camera outage and manual correction.
6. Review legal/privacy and CCTV requirements applicable to the operating location.

## Security note

Do not add `.env`, provider credentials, database dumps, private keys, user-uploaded photos or model weights to the ZIP or source-control repository. `.env.example` is the only environment template that should be committed. Generate the dependency lockfile using npm on a machine that can reach the configured registry; do not create it manually.

## Release status

This archive is a **release candidate**, not a production-certified service, until environment-specific evidence exists. Do not open public booking or real payment traffic while a critical checklist item is incomplete.

---

<a id="documentation-source-docs-docs-production-deployment-md"></a>

## docs/docs/production-deployment.md

### SmartPark production deployment guide

This guide assumes a Linux server or cloud VM with Docker Engine and the Docker Compose plugin, a public DNS name you control, and ports 80/443 reachable from the internet. It is not a substitute for provider-specific network, privacy, tax, or payment onboarding requirements.

## 1. Architecture

- Caddy receives public HTTP/HTTPS and obtains/renews TLS certificates automatically for `APP_DOMAIN`.
- Nginx serves the built React application and reverse-proxies `/api`, uploaded listing photos, and camera preview streams.
- The Express API is private to the Docker networks and connects to MySQL.
- MySQL has no published host port in the production Compose file.
- API, web, and email-worker containers use read-only root filesystems where supported, temporary writable mounts, `no-new-privileges`, PID limits and container memory limits.
- The email-worker process is configured with `SMARTPARK_PROCESS=email-worker`; its container does not receive payment credentials, the QR signing secret, or the vision service token.
- The Python vision service is optional and is enabled with the Compose `vision` profile.
- Listing photo uploads and database data are kept in named volumes.

The included proxy chain is Caddy -> Nginx -> Express. The API is configured with `TRUST_PROXY_HOPS=2` for this topology. Change that value if the deployment adds or removes a proxy hop, and never trust arbitrary forwarding headers from a directly public API.

## 2. Prepare DNS and firewall

1. Point the DNS A record for your chosen hostname to the server's public IPv4 address; configure AAAA only if IPv6 is actually routable to the server.
2. Allow inbound TCP 80 and TCP 443. UDP 443 is optional for HTTP/3.
3. Do not expose MySQL port 3306, API port 4000, or vision port 8000 to the public internet.
4. If cameras use RTSP, restrict outbound and inbound camera network access to trusted camera IP ranges. RTSP is disabled by default for the vision service.

## 3. Configure secrets

Copy `.env.example` to `.env`, then edit it with your real deployment values. Do not commit `.env` or send it in support messages.

Required production configuration:

- `NODE_ENV=production`
- `APP_DOMAIN=parking.your-real-domain.tld`
- `WEB_ORIGIN=https://parking.your-real-domain.tld` (exact origin, no trailing slash)
- Strong unique `DB_PASSWORD` and `MYSQL_ROOT_PASSWORD` values, at least 24 characters and different from one another
- A real verified `MAIL_FROM`, `SMTP_HOST`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_PORT`, and correct `SMTP_SECURE` setting
- `PAYMENT_PROVIDER=razorpay`, plus merchant credentials and a webhook secret configured in the provider dashboard
- Different, unique `QR_SIGNING_SECRET` and `VISION_API_TOKEN`, at least 32 random characters

Generate hexadecimal secrets from a trusted terminal, for example:

```bash
openssl rand -hex 32
```

On Windows with Node.js, this also works:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Keep the `VISION_API_TOKEN` and `QR_SIGNING_SECRET` values independent. The API's production environment validation blocks mock payments, local origins, placeholder credentials, and missing SMTP/payment configuration. The email-worker has separate validation and only requires the database, HTTPS site origin and SMTP configuration it uses.

## 4. Run preflight and validate Compose

From the project root:

```bash
npm run preflight:production
docker compose -f docker-compose.production.yml config --quiet
```

The preflight reads `.env` (environment variables already set in the current process override file values), checks expected production settings and does not print secrets. Passing it does not connect to DNS, SMTP, Razorpay, MySQL, or a camera.

## 5. First deployment on a new database

Build the images and start MySQL first:

```bash
docker compose -f docker-compose.production.yml build api web
docker compose -f docker-compose.production.yml up -d db
```

Apply numbered SQL migrations using the API container, which includes `mysql2` and the migration files:

```bash
docker compose -f docker-compose.production.yml run --rm api npm run migrate
```

Then start the public site and API:

```bash
docker compose -f docker-compose.production.yml up -d --build api web caddy email-worker
```

For a brand-new deployment only, the root convenience command `npm run deploy:up` runs the configuration preflight, builds the API/web images, starts MySQL, runs the migration runner, and then starts API/web/Caddy and the transactional email worker. For a manually migrated database, baseline it first as described below; do not run the new-database path against an untracked schema.

Caddy will request a TLS certificate once public DNS resolves to this server and the required ports are reachable. Inspect service status and logs:

```bash
docker compose -f docker-compose.production.yml ps
docker compose -f docker-compose.production.yml logs --tail=100 api web caddy db email-worker
```

### Existing database whose migrations were applied manually

Take and verify a backup first. The migration runner needs a history table so it can detect already-applied SQL files. If migrations 001 through 008 were fully applied to this database before the runner was introduced, baseline them through 008 without re-executing their SQL; the normal migration run then applies 009, 010 and 011:

```bash
docker compose -f docker-compose.production.yml run --rm api npm run migrate -- --baseline 008 --confirm-existing-schema
```

The baseline command checks for expected tables/columns, records the migration checksums, and executes no migration SQL. It intentionally fails if the schema looks incomplete. If migrations through 009 were also applied manually, use `--baseline 009`, then run the migration runner to apply 010, 011 and 012. If migrations through 010 were also applied manually, use `--baseline 010` so the financial tables and enum values are validated before 011–012 are applied. If migration 011 was applied manually as well, use `--baseline 011` and let the runner apply 012. If migration 012 was also applied manually, use `--baseline 012`; the baseline validator checks the shared-listing physical-detail columns as well as prior schema requirements, but executes no SQL. Do not use it to hide a failed or partially applied migration.

The migration runner tracks checksums and refuses to replay a file that is already applied, has changed, or has an incomplete state. MySQL DDL is not fully transactional; if a migration fails, inspect its error and schema and repair it deliberately before changing migration history. Never edit a migration file that has already been applied; create a new numbered migration instead.

## 6. Enable camera detection when ready

The core booking application does not require the vision container to start. Prepare the machine's CPU/GPU and storage first. YOLO/PyTorch adds a large image and may download its model on first use.

```bash
docker compose -f docker-compose.production.yml --profile vision up -d --build vision
```

Set `VISION_INSTALL_YOLO=true` to include the detector dependency. If set to `false`, the service's health endpoint and API wiring can start but vehicle inference cannot run without installing a supported model package; do not treat that configuration as operational detection.

For video-file tests, place approved test clips into `services/vision/sample-videos/` before creating the container. For live feeds, configure the camera stream using the application, validate network reachability from the container, and only enable RTSP after network restrictions are in place. Do not put passwords or RTSP credentials into screenshots, logs, or public listing data.

Validate region calibration and detector accuracy at the actual site under relevant lighting/weather/occlusion. Unknown or stale sensor data must remain unknown; visual classification alone is not an access authorization.

## 7. Release smoke tests

Before any customer traffic, record pass/fail results for:

1. `https://APP_DOMAIN` serves the frontend over valid HTTPS.
2. `/api/health` reports the API and database connected.
3. Registration, verification email, login, logout and password reset work with the production email provider.
4. A new booking hold cannot overlap a second hold for the same slot.
5. Razorpay order verification and webhook verification work in provider test mode in staging; production keys are enabled only after the provider account is ready.
6. A failed or pending payment cannot produce a valid entry credential.
7. The correct attendant can scan a confirmed ticket; replay, expired tickets, wrong facility and unauthorized operators are rejected.
8. A camera outage produces stale/unknown state and an operational alert.
9. A host/operator cannot view or mutate unrelated facilities.
10. Backup/restore and recovery from an API or vision-worker restart have been tested.

## 8. Backup and restore

Back up MySQL before migrations and on a recurring schedule. Keep encrypted copies off the application server and periodically test a restore. Example backup command from Bash:

```bash
docker compose -f docker-compose.production.yml exec -T db sh -lc 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysqldump -uroot --single-transaction --routines --triggers "$MYSQL_DATABASE"' > smartpark-backup.sql
```

Treat the generated SQL dump as sensitive customer/payment metadata. Encrypt it at rest, restrict access, set retention limits, and do not commit backups to Git.

The named volumes `smartpark_mysql_data`, `smartpark_marketplace_uploads`, `smartpark_caddy_data`, `smartpark_caddy_config` and `smartpark_yolo_cache` contain runtime state. Do not run `docker compose down -v` on a production deployment unless you intentionally want to destroy persistent data.

## 9. Known release limitations

- The application has automated unit tests for selected pure logic, but this workspace has not completed a live production Compose deployment, migration run against production MySQL, or a full browser-based end-to-end suite.
- Host earnings are an internal ledger. Automated owner payouts, full refund reversal/reconciliation workflows, and settlement integration require additional implementation and business-provider configuration.
- Rate limiting uses process-local memory. Use a shared rate-limit store before horizontally scaling API instances.
- Container runtime hardening reduces writable paths and process privilege, but image vulnerability scanning, dependency audit, secret rotation, host hardening and runtime monitoring must still be carried out for each release.
- Verify CSP allowlists against the exact Google Maps/Razorpay integrations enabled for the release.
- Confirm privacy notices, data retention, local payment/tax requirements and CCTV signage/consent for the deployment location.


## 10. Transactional email worker

The production Compose stack runs `email-worker` privately, without a published port. To inspect its logs:

```bash
docker compose -f docker-compose.production.yml logs --tail=100 email-worker
```

For local development, run `npm run worker:email` in a separate terminal after migrations 001–010 have been applied. With no SMTP host in development, messages are logged as `simulated` and are not delivered. To process the due queue once and exit, use `npm run worker:email:once`.


## Phase 11 financial operations

Refund and host-payout controls require a named administrator to confirm actions in the configured external provider/bank portal. SmartPark stores the case, audit note, and external reference; it does not itself send money or initiate a provider refund in this release. Never record a refund or payout as completed before the external provider confirms it. Review `README.md#documentation-source-docs-financial-operations-md` before enabling the workflow for real customers.


## Phase 14 runtime-hardening notes

- Production API runs with `SMARTPARK_PROCESS=api`; the private mail worker runs with `SMARTPARK_PROCESS=email-worker`. The process role selects the minimum production environment validation set.
- The API container's writable marketplace-upload directory is a dedicated named volume. Do not remove that mount when keeping the API root filesystem read-only.
- The web container's writable Nginx runtime/cache locations are mounted as ephemeral `tmpfs`; application assets stay read-only.
- The mail worker has no payment provider key/secret, webhook secret, QR-signing secret, vision token, proxy-trust setting or public port.
- Service memory/PID limits are conservative starting values, not capacity sizing. Observe peak usage (especially during image upload and mail backlog) and adjust deliberately.
- If using an orchestrator/hosting platform other than the included Docker Compose topology, reproduce the same service-specific secret scopes, writable paths, private networking, health checks and resource controls in its native configuration.
- Before a public launch, run a dependency vulnerability review against a committed lockfile and scan built images using your chosen scanner; resolve or explicitly accept and document findings.

---

<a id="documentation-source-docs-docs-release-checklist-md"></a>

## docs/docs/release-checklist.md

### SmartPark release checklist

## Build and configuration
- [ ] `npm run preflight:production` passes without printing secrets.
- [ ] `docker compose -f docker-compose.production.yml config --quiet` passes.
- [ ] Web and API container images build from clean caches.
- [ ] `npm run test:api` and Python unit tests pass.
- [ ] `npm run build` succeeds.
- [ ] No `.env`, database dump, credentials, camera URL credentials, uploaded photos or model weights are tracked in Git.

## Database and deployment
- [ ] Fresh database migration path tested from 001 through 012.
- [ ] Existing-database baseline path tested only on a verified backup/schema.
- [ ] MySQL has no public host port.
- [ ] Web/API containers run non-root where supported and have health checks.
- [ ] Runtime photos, database files and Caddy certificates use persistent volumes.
- [ ] HTTPS certificate issuance/renewal and HTTP-to-HTTPS redirect verified.
- [ ] Backup restore and rollback procedure tested.

## Business and security
- [ ] Production uses Razorpay, not mock payments.
- [ ] Email verification/password reset and transactional event emails use the deployed HTTPS origin and verified SMTP sender.
- [ ] `email-worker` starts without public ports, drains an outbox message, retries a simulated SMTP failure, and records terminal failures after the attempt limit.
- [ ] Development-mode outbox rows are marked `simulated`, never falsely reported as delivered.
- [ ] Production worker logs contain no SMTP password, recipient/body payloads, or payment credentials; development-only message logging is kept local and is not shared.
- [ ] Role and facility isolation tested with separate driver/host/operator/admin accounts.
- [ ] Booking concurrency, payment idempotency, QR replay/expiry, and entry/exit tested.
- [ ] Alerts and notifications scoped correctly by facility/account.
- [ ] Vision stale state, camera outage, model failure, and manual correction tested onsite.
- [ ] Legal/privacy, retention and CCTV requirements reviewed for the deployment jurisdiction.

## Go/no-go
- [ ] All mandatory checks above have a recorded pass/fail result and owner.
- [ ] No unresolved critical security/payment/booking issue remains.
- [ ] Monitoring, on-call contact and rollback decision are documented.

- [ ] Refund processing has been tested against provider sandbox; every successful refund has an externally verified reference.
- [ ] Host payout requests reconcile to allocated earning rows; transfer references are verified against bank/provider records.
- [ ] Refund-processing entry lock, failure/recovery and manual-review paths tested using a real disposable MySQL 8 instance.

- [ ] Verify favorite ownership isolation, recent-search deletion, completed-booking review eligibility, unique-review constraint and administrator moderation against MySQL.
- [ ] Confirm public review responses never expose booking IDs, email addresses or full reviewer names.

## Phase 13 — Integration validation

- [ ] `npm run test:all` passes.
- [ ] `npm run build` completes without errors.
- [ ] Apply migrations with the controlled migration runner; verify history has no `running` or `failed` entry.
- [ ] Start the API with the migrated MySQL database and verify `/api/health` reports `database: connected`.
- [ ] Run `npm run test:integration`; verify API identity, public inventory response shapes, authentication boundaries, Origin guard, and 404 contract.
- [ ] With a verified staging account set `SMARTPARK_SMOKE_EMAIL` and `SMARTPARK_SMOKE_PASSWORD`, run the integration smoke suite again to exercise authenticated read endpoints and session revocation.
- [ ] Complete the manual end-to-end scenarios in `README.md#documentation-source-docs-integration-testing-md` using test-only payment credentials and test data.
- [ ] Verify browser and API access, payment/webhook, email-worker, and camera/vision behavior in the intended deployment environment.

A passing smoke test is not equivalent to production certification. Payment providers, SMTP, TLS issuance, database restore, camera detection accuracy and gate hardware require environment-specific validation.


## Phase 14 — Production least-privilege hardening
- [ ] Confirm production API process role is `SMARTPARK_PROCESS=api` and mail-worker role is `SMARTPARK_PROCESS=email-worker`.
- [ ] Confirm the mail worker does not receive payment credentials, webhook secret, QR signing secret, vision token or reverse-proxy trust configuration.
- [ ] Build and start API/web/email-worker with read-only roots, temporary mounts, capability restrictions and resource limits.
- [ ] Validate uploads still work through the persistent marketplace volume and Nginx health/static routes work with read-only web root.
- [ ] Run dependency vulnerability audit using the committed package-lock and scan deployable images.
- [ ] Review configured memory/PID limits under representative workload; check logs do not expose secrets or sensitive payloads.
- [ ] Complete the environment-specific items in `README.md#documentation-source-docs-phase14-production-security-md`.


## Phase 15 — Final launch gate
- [ ] `npm run release:audit` reports no failures; all warnings have an owner and disposition.
- [ ] Root `package-lock.json` was generated with a network-enabled npm install and a clean `npm ci` succeeds. The current Phase 15 archive does not include a lockfile because registry access timed out during packaging.
- [ ] `npm run verify:release` passes with a migrated disposable MySQL database and API running.
- [ ] Fresh-install and upgrade migration paths are tested against MySQL 8.4, including an approved backup and baseline when applicable.
- [ ] Production Compose images build and start on the target host; health checks and TLS issuance/renewal are verified.
- [ ] Payment, SMTP, refund, host payout, camera, and gate integrations pass environment-specific staging checks.
- [ ] Backup restore, rollback, alerts, and operational ownership are documented and exercised.
- [ ] Public launch is a GO only after every mandatory item above and every previous mandatory checklist item is recorded as PASS.

---

<a id="documentation-source-docs-docs-release-evidence-phase15-static-checks-md"></a>

## docs/docs/release-evidence\phase15-static-checks.md

### Phase 15 static verification evidence

**Check date:** 2026-10-22
**Project package:** SmartPark 2.4.0
**Classification:** Release candidate only — not production certified

## Checks executed in the artifact-generation environment

| Check | Result | Evidence / limitation |
|---|---|---|
| API unit + source-contract suite | PASS | 99 tests passed with `npm run test:api` / `npm run test:all`. |
| Python vision unit suite | PASS | 14 tests passed. |
| Frontend source syntax | PASS | 15 JS/JSX/TS/TSX files transpiled with TypeScript compiler API; no syntax errors. |
| API and script syntax | PASS | 61 JS/MJS/CJS files passed `node --check`. |
| Python source compilation | PASS | `compileall` succeeded for vision source and tests. |
| Compose YAML parse | PASS | `docker-compose.yml`, `docker-compose.production.yml`, and `docker-compose.vision.yml` parsed with PyYAML and contain service maps. This is syntax validation only. |
| Numbered SQL migrations | PASS | 001–012 are contiguous; migration-runner baseline validates through version 12. This does not prove SQL executes successfully against MySQL. |
| Static release audit | PASS WITH WARNINGS | 6 pass, 3 warnings, 0 failures at check time. |
| npm dependency installation | BLOCKED | Attempted `npm install --no-audit --no-fund`; command timed out while attempting dependency installation. |
| Dependency lockfile | NOT AVAILABLE | No root `package-lock.json` could be generated in this environment. Generate it via npm on a network-enabled machine; do not manufacture one manually. |
| Vite production build | NOT RUN SUCCESSFULLY | `npm run build` failed because `vite` was not installed (`vite: not found`). |
| Docker image build/startup | NOT RUN | Docker CLI is not installed in this environment. |
| MySQL migration / API integration | NOT RUN | MySQL CLI and a running MySQL 8 instance are unavailable here. |
| Payment / SMTP / HTTPS / backup-restore | NOT RUN | These require provider and deployment credentials/services. |
| Camera inference and gate hardware | NOT RUN | Requires the target camera, a calibrated parking layout and physical gate integration. |

## Repeatable commands for the development/staging machine

From the project root, after configuring `.env` and ensuring registry access:

```powershell
npm install
npm run release:audit
npm run check:syntax
npm run test:all
npm run build
npm run test:integration
```

`npm install` should generate `package-lock.json`. Keep it under source control and verify a clean installation with `npm ci` before production deployment. Run live integration tests only against a disposable/staging MySQL database, never against live bookings or real-money production transactions.

## Decision

**NO-GO for public production until the blockers above are resolved and all mandatory items in `README.md#documentation-source-docs-release-checklist-md` are recorded as PASS by the deployment owner.** Static/helper tests do not replace live database/provider/onsite validation.

---

<a id="documentation-source-docs-docs-requirements-md"></a>

## docs/docs/requirements.md

### SmartPark requirements

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

See `README.md#documentation-source-docs-deployment-security-checklist-md`. Required release tasks include a clean dependency installation, frontend production build, disposable MySQL migration test, database-backed API integration tests, provider sandbox test, permission-isolation tests, backups/restore test and real camera/site validation.

---

<a id="documentation-source-docs-docs-transactional-email-md"></a>

## docs/docs/transactional-email.md

### SmartPark transactional email outbox

## Scope

Phase 10 dispatches allowlisted lifecycle emails for booking hold creation, unpaid-hold cancellation, verified payment/booking confirmation, gate entry and gate exit. It supplements the in-app notification inbox; it does not replace it. Only active users with a verified email address can receive these event emails.

## Data flow

1. A booking, payment or gate route mutates the business record inside a MySQL transaction.
2. The same database executor inserts the in-app notification and an idempotent `transactional_email_outbox` record.
3. A separate worker claims due rows using `SELECT ... FOR UPDATE SKIP LOCKED` and a lease.
4. The worker renders a fixed template with HTML-escaped user/facility fields, sends through SMTP and records the result.
5. Failed deliveries retry with exponential backoff, beginning at 30 seconds and capped at one hour. After eight attempts they enter `failed` for manual inspection.

The template key and required data fields are validated before enqueue and render. Arbitrary HTML, sender addresses and subjects cannot be supplied by a request. Operational logs contain outbox IDs and SMTP error codes, not passwords or message contents in production.

## Local development

Apply migration `009_transactional_email_outbox.sql` after migrations 001–008. Start the API/web application in one terminal:

```powershell
npm run dev
```

Run the worker in a second terminal:

```powershell
npm run worker:email
```

To drain currently due work once and exit:

```powershell
npm run worker:email:once
```

If `NODE_ENV=development` and `SMTP_HOST` is blank, the worker logs a local-only simulation and records the outbox status as `simulated`. It does not mean an email was sent. Configure a test SMTP account to verify actual delivery.

## Production

The `email-worker` service is part of `docker-compose.production.yml`, uses the same API image, has no published ports, and connects to MySQL and the outbound SMTP provider. The new-database deploy command starts it after applying migrations. For manually migrated databases, baseline existing migrations as documented in `README.md#documentation-source-docs-production-deployment-md`, then allow migration 009 to run.

Inspect worker status and logs:

```bash
docker compose -f docker-compose.production.yml ps email-worker
docker compose -f docker-compose.production.yml logs --tail=100 email-worker
```

## Delivery semantics and retention

Queue idempotency prevents the same business event from being enqueued twice. SMTP delivery is **at-least-once**, not exactly-once: if the SMTP server accepts a message and the worker stops before recording success in MySQL, a retry may send a duplicate. These emails are informational and must never be used as proof of payment, booking authorization or gate access.

Outbox rows contain recipient email addresses and reservation metadata. Restrict DB access and backups, set a retention policy that matches applicable law and business needs, and delete/anonymize old rows only after they are no longer needed for dispute/audit obligations. The automated worker does not yet purge rows.

---

<a id="documentation-source-docs-next-steps-md"></a>

## docs/next-steps.md

### SmartPark implementation status

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

---

<a id="documentation-source-docs-phase-10-11-corporate-fleet-ev-md"></a>

## docs/phase-10-11-corporate-fleet-ev.md

### SmartPark combined Phases 10–11: Corporate fleet and EV charging

## Corporate and fleet management

- Authenticated users can create a corporate account with billing contact details.
- The creator is added as a manager. Managers/owners can add existing active SmartPark accounts by email as manager, employee, or driver.
- Corporate members can view their company roster and fleet. Managers/owners can add fleet vehicles, optionally assign them to an existing company member, and mark them active, in maintenance, or retired.
- Fleet registration numbers are normalized to uppercase and unique across the SmartPark fleet registry.
- Actions are recorded in the audit log. This is a company/fleet register, not yet an automated corporate booking allocator or invoicing system.

## EV charging inventory and session records

- Hosts can register chargers against parking facilities they own, including connector type, power, unit rate, connector quantity, notes, and optional hardware provider.
- Drivers can browse available chargers at active, approved facilities and create an operational session record.
- Session end can record energy delivered and calculates an estimate using the per-kWh rate snapshotted when the session started.
- The server enforces session ownership, charger capacity, vehicle ownership, and one active session per driver.

## Important integration boundaries

This release does **not** activate physical charging equipment, retrieve live charger telemetry, meter energy automatically, collect EV charging payments, issue corporate invoices, or allocate employee parking automatically. These require a supported charging-network/OCPP provider, payment integration, and further operational policy. Availability in this UI is the state stored in SmartPark, not verified live hardware status.

## Database migration

Migration `018_corporate_fleet_ev_charging.sql` creates corporate accounts/members/fleet vehicles and EV charger/session tables. Back up the database and verify migration history before running `npm run migrate`. Do not rerun or baseline migrations blindly on a manually managed database.

## Test plan

1. Create a corporate account; verify the creator appears as manager.
2. Add an existing active user as an employee and assign a fleet vehicle to that member.
3. Verify a non-manager cannot add members or fleet vehicles.
4. As a host, add an EV charger to a facility you own.
5. Confirm a driver can start one session only while connector capacity is available.
6. Stop a session with and without energy data; confirm cost is an estimate only and no payment is charged.
7. Verify a user cannot end another driver's session unless they own the facility or are an administrator.

---

<a id="documentation-source-docs-phase-5-location-discovery-md"></a>

## docs/phase-5-location-discovery.md

### SmartPark Phase 5 — Location-aware discovery

## What changed

The existing `ParkingPage` discovery experience now includes:

- An explicit **Use my location** action that asks the browser for permission only after the user clicks it.
- Distance estimates from the user's location to published facilities that have valid latitude/longitude values, calculated with the Haversine formula.
- Nearest-first sorting when a user location is available.
- Optional nearby-only filtering with 2, 5, 10, 25, and 50 km radii.
- List/map view switching, a location list, and a map preview for the selected facility using OpenStreetMap's embedded map.
- Directions and larger-map links for facilities with coordinates.
- Friendly states for denied permissions, unavailable location, facilities without coordinates, and empty radius results.

## Data and service requirements

No database migration or new API endpoint is required. The existing public `/api/parking/lots` response already includes facility latitude and longitude. Owners or administrators should add accurate coordinates to each listing for map pins and distance estimates to work.

The map preview uses OpenStreetMap in the user's browser. A network connection is needed to load map tiles. Browser geolocation generally requires HTTPS or localhost and always depends on the user's permission.

## Privacy and accuracy notes

- Location is requested only after the user clicks the location button.
- Coordinates remain in the browser and are not sent to the SmartPark API by this feature.
- Distance is straight-line distance, not road distance or travel time. Use a routing provider integration for route-aware estimates.
- The map displays one selected facility marker at a time; it does not claim to render every facility as a marker simultaneously.
- Missing or inaccurate facility coordinates must be corrected by the owner or an administrator.

## Verification

Run from the repository root:

```bash
npm run check:syntax
npm run test:api
npm run build
```

The production build requires dependencies to be installed first with `npm install`. Test the geolocation permission flow, radius filter, facilities with and without coordinates, and map links in a browser.

---

<a id="documentation-source-docs-phase-6-arrival-planning-md"></a>

## docs/phase-6-arrival-planning.md

### Phase 6 — Navigation and Arrival Planning

## What changed

- The parking discovery map now provides a **Route to parking** link. If the user has voluntarily shared their current location, it is used as the route origin; otherwise, the mapping provider chooses the origin.
- The selected facility can be used as the origin for a second leg to the driver's destination after parking.
- The onward journey supports walking, cycling, driving, or public transit.
- Public facility arrival instructions (`specialInstructions`) are shown in the selected facility panel when present.
- Parking cards use the same route-link helper for consistent route behavior.

## Provider behavior and limitations

- Routes open in Google Maps using its public directions URL. SmartPark does not calculate its own road route or claim an ETA.
- A route is available only when a selected facility has valid latitude and longitude.
- Onward destination is optional and is entered by the driver; no destination is geocoded or stored by SmartPark in this phase.
- Arrival instructions are facility-level information already stored by the marketplace. Do not put gate PINs, one-time access codes, or other secrets in public facility instructions; private booking access details must remain in the authenticated booking/access flow.
- Browser location is only used if the driver previously clicks the location button and grants permission. The location is not sent to the SmartPark API by this feature.

## Validation

From the project root:

```powershell
npm install
npm run check:syntax
npm run test:api
npm run build
```

No database migration or new API endpoint is required.

---

<a id="documentation-source-docs-phase-7-promotions-md"></a>

## docs/phase-7-promotions.md

### SmartPark Phase 7 — Promotion codes

This phase adds admin-managed promotion codes and server-side booking discounts. It extends the existing booking quote and hold flow; it does not introduce a second checkout.

## Included
- Admins can create promotion codes and activate/deactivate them.
- Percentage and fixed discounts, optional maximum discount, minimum parking charge, currency, start/end time, total redemption limit, and per-user limit.
- Drivers can enter a code when requesting a booking quote.
- The API validates the code during quote calculation and revalidates it in the booking transaction.
- The booking snapshot and booking discount amount record the applied discount.
- A redemption is reserved for the 10-minute booking hold, redeemed after verified payment, and released if payment fails. Expired reservations stop counting toward usage limits.
- Administrative changes are written to audit logs.

## API
- `GET /api/promotions` — active public-to-authenticated promotion list.
- `POST /api/promotions/validate` — validates a code against an amount and currency.
- `GET /api/promotions/admin` — admin listing with usage counts.
- `POST /api/promotions/admin` — create a promotion (admin only).
- `PATCH /api/promotions/admin/:promoId` — activate/deactivate a promotion (admin only).
- `POST /api/bookings/quote` and `POST /api/bookings` accept optional `promoCode`.

## Migration
Apply `database/migrations/015_promotions.sql` using the existing migration runner after taking a database backup and checking migration history. Despite the historical filename, this migration currently creates promotion and redemption tables only; referral rewards are not implemented in this phase.

## Important pricing rule
Discounts apply to the parking charge (base amount), not service fees. Tax is recalculated on the discounted base amount plus service fee. The API is authoritative; never trust a client-supplied discount amount.

---

<a id="documentation-source-docs-phase-8-referral-program-md"></a>

## docs/phase-8-referral-program.md

### Phase 8 — Referral programme

## Scope

This phase adds unique personal referral codes, optional attribution during registration, a referral dashboard, and an internal referral-credit ledger. It reuses the existing account, booking, payment-verification, gate-exit, and audit systems.

## Qualification and rewards

- Each new account receives a cryptographically random `SP` referral code. Existing users receive a code when they first open **Refer & earn**.
- A new account can enter one referral code during registration. Unknown codes are rejected; attribution cannot be changed later through a public endpoint.
- A referral becomes qualified only after the referred account completes a parking session through the gate-exit workflow and the booking has a verified payment in `paid` state, with no refund in progress or completed for that booking.
- Qualification is transactionally recorded against one booking. A unique constraint prevents duplicate qualifying bookings, and a unique `(referral_id, beneficiary_user_id)` constraint prevents duplicate rewards.
- Both referrer and referred driver receive INR 100 in the `referral_rewards` ledger.
- These credits are internal ledger entries only. This phase does not implement cash payouts, wallet redemption, or applying credits to a future booking. They are not cash and are not withdrawable funds.

## Migration

Run `database/migrations/016_referral_program.sql` using the existing migration runner after taking a database backup. The migration creates `referral_codes`, `referrals`, and `referral_rewards`. It does not modify existing migration files.

## API

- `GET /api/referrals/me` — personal code, referral link, summary, referral history, and reward policy.
- `GET /api/referrals/rewards` — the signed-in user's reward ledger.
- Registration accepts an optional `referralCode` field.

## Validation checklist

1. Apply migrations on a disposable database and run API tests.
2. Open **Refer & earn** for an existing user; confirm a stable code is created.
3. Register a new account using a valid code and verify the attribution appears in the referrer's dashboard.
4. Verify an invalid code is rejected and the account is not partially created.
5. Complete a test booking with a verified paid payment and record a gate exit; confirm one referral qualifies and exactly two credits are recorded.
6. Replay the exit request and confirm no duplicate rewards are created.
7. Verify unpaid, cancelled, or refunded bookings do not qualify.

## Operational notes

Referral codes are attribution identifiers, not authentication secrets. Apply rate limits to registration, monitor abuse, and consider device/payment risk checks before enabling monetary redemption. Rewards are fixed at INR 100 each in this phase; changing the policy requires a reviewed code change and clear user-facing terms.

---

<a id="documentation-source-docs-phase-9-monthly-subscriptions-md"></a>

## docs/phase-9-monthly-subscriptions.md

### Phase 9 — Monthly parking passes

This phase adds monthly-pass requests to the existing marketplace.

## Included

- Discover approved shared-space listings with an active monthly pricing rule.
- Request a pass starting today or later for 1–12 calendar months.
- Calculate and store the quoted amount from the current monthly rate at request time.
- Prevent the same driver from creating overlapping pending/approved requests for the same listing.
- View personal subscription requests and their owner review status.
- Let hosts review only requests for their own listings; admins can review all requests.
- Require a reason when rejecting a request, support cancellation of unpaid requests, and record audit events.

## API

- `GET /api/subscriptions/available`
- `GET /api/subscriptions/me`
- `GET /api/subscriptions/owner` (host/admin)
- `POST /api/subscriptions`
- `PATCH /api/subscriptions/:subscriptionId/review` (listing owner/admin)
- `POST /api/subscriptions/:subscriptionId/cancel` (requesting driver)

All endpoints except the API-level 404 are authenticated. The API checks listing approval, active status, monthly rate, ownership, dates, duration, and overlapping requests.

## Database migration

Apply `database/migrations/017_monthly_subscriptions.sql` using `npm run migrate` after backing up the database and verifying migration history. If an existing manually configured database has no migration records, use the baseline procedure only after confirming the entire schema; do not blindly baseline or rerun migrations.

## Deliberate limitation

This is a **request and owner-review workflow**, not a complete paid subscription product. An `approved` request remains `payment_status = 'unpaid'`. This phase does not process subscription payments, recurring charges, automatic renewals, prorated refunds, or gate-access entitlements. Do not grant parking access solely because a request is approved. Those capabilities need a later payment-provider integration and an explicit entitlement model.

---

<a id="documentation-source-docs-phase12-13-accessibility-anpr-md"></a>

## docs/phase12-13-accessibility-anpr.md

### SmartPark Phases 12–13: Accessibility, Language, and ANPR

## Phase 12: accessibility and language preferences
- Adds a skip-to-main-content link and preserves visible keyboard focus styles.
- Adds browser-local high-contrast, larger-text, and reduced-motion preferences.
- Adds English, Hindi, Kannada, and Telugu for the main navigation and selected workspace labels. Feature-specific detail pages may remain in English; this is a first translation layer, not a complete localization pass.
- Preferences are saved in localStorage for the current browser and are not synced across devices.

## Phase 13: number-plate recognition integration foundation
- Migration `019_anpr_events.sql` creates the plate-event review inbox.
- A compatible ANPR provider sends plate candidates to `POST /api/vision/service/plate-events` with `Authorization: Bearer <VISION_API_TOKEN>`.
- Payload: `{ "cameraId": "<uuid>", "plateText": "KA01AB1234", "confidence": 0.93, "direction": "entry", "observedAt": "2026-10-22T10:00:00.000Z", "providerEventId": "optional-provider-id" }`.
- Authenticated hosts, assigned operators, attendants, and admins can view events for facilities they can access. Only hosts, assigned operators, and admins can mark events confirmed or false positive.
- Matching is advisory. The API does not open a physical gate, check a driver in, or alter a booking automatically.
- Raw camera images are not stored by this feature. Plate text is sensitive data; configure signage, access restrictions, retention, and lawful processing before enabling it.
- OCR/ANPR itself is not bundled. A compatible provider or model must send events to the endpoint.

## Apply
Back up the database, then run `npm run migrate` after reviewing migration history. Do not rerun migrations against a manually baselined database without following the baseline guide.

## Verify
Run `npm run check:syntax`, `npm run test:api`, and `npm run build`. Test the service endpoint using a non-production camera and a valid vision token; verify that an event appears in Plate recognition and that no gate or booking status changes automatically.

---

<a id="documentation-source-docs-production-deployment-md"></a>

## docs/production-deployment.md

### SmartPark production deployment guide

This guide assumes a Linux server or cloud VM with Docker Engine and the Docker Compose plugin, a public DNS name you control, and ports 80/443 reachable from the internet. It is not a substitute for provider-specific network, privacy, tax, or payment onboarding requirements.

## 1. Architecture

- Caddy receives public HTTP/HTTPS and obtains/renews TLS certificates automatically for `APP_DOMAIN`.
- Nginx serves the built React application and reverse-proxies `/api`, uploaded listing photos, and camera preview streams.
- The Express API is private to the Docker networks and connects to MySQL.
- MySQL has no published host port in the production Compose file.
- API, web, and email-worker containers use read-only root filesystems where supported, temporary writable mounts, `no-new-privileges`, PID limits and container memory limits.
- The email-worker process is configured with `SMARTPARK_PROCESS=email-worker`; its container does not receive payment credentials, the QR signing secret, or the vision service token.
- The Python vision service is optional and is enabled with the Compose `vision` profile.
- Listing photo uploads and database data are kept in named volumes.

The included proxy chain is Caddy -> Nginx -> Express. The API is configured with `TRUST_PROXY_HOPS=2` for this topology. Change that value if the deployment adds or removes a proxy hop, and never trust arbitrary forwarding headers from a directly public API.

## 2. Prepare DNS and firewall

1. Point the DNS A record for your chosen hostname to the server's public IPv4 address; configure AAAA only if IPv6 is actually routable to the server.
2. Allow inbound TCP 80 and TCP 443. UDP 443 is optional for HTTP/3.
3. Do not expose MySQL port 3306, API port 4000, or vision port 8000 to the public internet.
4. If cameras use RTSP, restrict outbound and inbound camera network access to trusted camera IP ranges. RTSP is disabled by default for the vision service.

## 3. Configure secrets

Copy `.env.example` to `.env`, then edit it with your real deployment values. Do not commit `.env` or send it in support messages.

Required production configuration:

- `NODE_ENV=production`
- `APP_DOMAIN=parking.your-real-domain.tld`
- `WEB_ORIGIN=https://parking.your-real-domain.tld` (exact origin, no trailing slash)
- Strong unique `DB_PASSWORD` and `MYSQL_ROOT_PASSWORD` values, at least 24 characters and different from one another
- A real verified `MAIL_FROM`, `SMTP_HOST`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_PORT`, and correct `SMTP_SECURE` setting
- `PAYMENT_PROVIDER=razorpay`, plus merchant credentials and a webhook secret configured in the provider dashboard
- Different, unique `QR_SIGNING_SECRET` and `VISION_API_TOKEN`, at least 32 random characters

Generate hexadecimal secrets from a trusted terminal, for example:

```bash
openssl rand -hex 32
```

On Windows with Node.js, this also works:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Keep the `VISION_API_TOKEN` and `QR_SIGNING_SECRET` values independent. The API's production environment validation blocks mock payments, local origins, placeholder credentials, and missing SMTP/payment configuration. The email-worker has separate validation and only requires the database, HTTPS site origin and SMTP configuration it uses.

## 4. Run preflight and validate Compose

From the project root:

```bash
npm run preflight:production
docker compose -f docker-compose.production.yml config --quiet
```

The preflight reads `.env` (environment variables already set in the current process override file values), checks expected production settings and does not print secrets. Passing it does not connect to DNS, SMTP, Razorpay, MySQL, or a camera.

## 5. First deployment on a new database

Build the images and start MySQL first:

```bash
docker compose -f docker-compose.production.yml build api web
docker compose -f docker-compose.production.yml up -d db
```

Apply numbered SQL migrations using the API container, which includes `mysql2` and the migration files:

```bash
docker compose -f docker-compose.production.yml run --rm api npm run migrate
```

Then start the public site and API:

```bash
docker compose -f docker-compose.production.yml up -d --build api web caddy email-worker
```

For a brand-new deployment only, the root convenience command `npm run deploy:up` runs the configuration preflight, builds the API/web images, starts MySQL, runs the migration runner, and then starts API/web/Caddy and the transactional email worker. For a manually migrated database, baseline it first as described below; do not run the new-database path against an untracked schema.

Caddy will request a TLS certificate once public DNS resolves to this server and the required ports are reachable. Inspect service status and logs:

```bash
docker compose -f docker-compose.production.yml ps
docker compose -f docker-compose.production.yml logs --tail=100 api web caddy db email-worker
```

### Scheduled parking prices (existing schema)

The `pricing_rules` table already includes `valid_from` and `valid_until`; scheduled pricing therefore does not require a database migration. Owners can schedule a rate from the marketplace pricing form by choosing an effective start time and, optionally, an end time. Leave both dates blank to change the currently effective rate immediately. Scheduled rates remain alongside the current rate, and booking quotes select the most recently effective applicable rule. Times entered in the browser are converted to UTC before storage. An end time must be later than the start time, and scheduled start times cannot be in the past. Test the effective dates with the listing's configured timezone and verify the final quote before accepting real payments.

### Existing database whose migrations were applied manually

Take and verify a backup first. The migration runner needs a history table so it can detect already-applied SQL files. If migrations 001 through 008 were fully applied to this database before the runner was introduced, baseline them through 008 without re-executing their SQL; the normal migration run then applies 009, 010 and 011:

```bash
docker compose -f docker-compose.production.yml run --rm api npm run migrate -- --baseline 008 --confirm-existing-schema
```

The baseline command checks for expected tables/columns, records the migration checksums, and executes no migration SQL. It intentionally fails if the schema looks incomplete. If migrations through 009 were also applied manually, use `--baseline 009`, then run the migration runner to apply 010, 011 and 012. If migrations through 010 were also applied manually, use `--baseline 010` so the financial tables and enum values are validated before 011–012 are applied. If migration 011 was applied manually as well, use `--baseline 011` and let the runner apply 012. If migration 012 was also applied manually, use `--baseline 012`; the baseline validator checks the shared-listing physical-detail columns as well as prior schema requirements, but executes no SQL. Do not use it to hide a failed or partially applied migration.

The migration runner tracks checksums and refuses to replay a file that is already applied, has changed, or has an incomplete state. MySQL DDL is not fully transactional; if a migration fails, inspect its error and schema and repair it deliberately before changing migration history. Never edit a migration file that has already been applied; create a new numbered migration instead.

## 6. Enable camera detection when ready

The core booking application does not require the vision container to start. Prepare the machine's CPU/GPU and storage first. YOLO/PyTorch adds a large image and may download its model on first use.

```bash
docker compose -f docker-compose.production.yml --profile vision up -d --build vision
```

Set `VISION_INSTALL_YOLO=true` to include the detector dependency. If set to `false`, the service's health endpoint and API wiring can start but vehicle inference cannot run without installing a supported model package; do not treat that configuration as operational detection.

For video-file tests, place approved test clips into `services/vision/sample-videos/` before creating the container. For live feeds, configure the camera stream using the application, validate network reachability from the container, and only enable RTSP after network restrictions are in place. Do not put passwords or RTSP credentials into screenshots, logs, or public listing data.

Validate region calibration and detector accuracy at the actual site under relevant lighting/weather/occlusion. Unknown or stale sensor data must remain unknown; visual classification alone is not an access authorization.

## 7. Release smoke tests

Before any customer traffic, record pass/fail results for:

1. `https://APP_DOMAIN` serves the frontend over valid HTTPS.
2. `/api/health` reports the API and database connected.
3. Registration, verification email, login, logout and password reset work with the production email provider.
4. A new booking hold cannot overlap a second hold for the same slot.
5. Razorpay order verification and webhook verification work in provider test mode in staging; production keys are enabled only after the provider account is ready.
6. A failed or pending payment cannot produce a valid entry credential.
7. The correct attendant can scan a confirmed ticket; replay, expired tickets, wrong facility and unauthorized operators are rejected.
8. A camera outage produces stale/unknown state and an operational alert.
9. A host/operator cannot view or mutate unrelated facilities.
10. Backup/restore and recovery from an API or vision-worker restart have been tested.

## 8. Backup and restore

Back up MySQL before migrations and on a recurring schedule. Keep encrypted copies off the application server and periodically test a restore. Example backup command from Bash:

```bash
docker compose -f docker-compose.production.yml exec -T db sh -lc 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysqldump -uroot --single-transaction --routines --triggers "$MYSQL_DATABASE"' > smartpark-backup.sql
```

Treat the generated SQL dump as sensitive customer/payment metadata. Encrypt it at rest, restrict access, set retention limits, and do not commit backups to Git.

The named volumes `smartpark_mysql_data`, `smartpark_marketplace_uploads`, `smartpark_caddy_data`, `smartpark_caddy_config` and `smartpark_yolo_cache` contain runtime state. Do not run `docker compose down -v` on a production deployment unless you intentionally want to destroy persistent data.

## 9. Known release limitations

- The application has automated unit tests for selected pure logic, but this workspace has not completed a live production Compose deployment, migration run against production MySQL, or a full browser-based end-to-end suite.
- Host earnings are an internal ledger. Automated owner payouts, full refund reversal/reconciliation workflows, and settlement integration require additional implementation and business-provider configuration.
- Rate limiting uses process-local memory. Use a shared rate-limit store before horizontally scaling API instances.
- Container runtime hardening reduces writable paths and process privilege, but image vulnerability scanning, dependency audit, secret rotation, host hardening and runtime monitoring must still be carried out for each release.
- Verify CSP allowlists against the exact Google Maps/Razorpay integrations enabled for the release.
- Confirm privacy notices, data retention, local payment/tax requirements and CCTV signage/consent for the deployment location.


## 10. Transactional email worker

The production Compose stack runs `email-worker` privately, without a published port. To inspect its logs:

```bash
docker compose -f docker-compose.production.yml logs --tail=100 email-worker
```

For local development, run `npm run worker:email` in a separate terminal after migrations 001–010 have been applied. With no SMTP host in development, messages are logged as `simulated` and are not delivered. To process the due queue once and exit, use `npm run worker:email:once`.


## Phase 11 financial operations

Refund and host-payout controls require a named administrator to confirm actions in the configured external provider/bank portal. SmartPark stores the case, audit note, and external reference; it does not itself send money or initiate a provider refund in this release. Never record a refund or payout as completed before the external provider confirms it. Review `README.md#documentation-source-docs-financial-operations-md` before enabling the workflow for real customers.


## Phase 14 runtime-hardening notes

- Production API runs with `SMARTPARK_PROCESS=api`; the private mail worker runs with `SMARTPARK_PROCESS=email-worker`. The process role selects the minimum production environment validation set.
- The API container's writable marketplace-upload directory is a dedicated named volume. Do not remove that mount when keeping the API root filesystem read-only.
- The web container's writable Nginx runtime/cache locations are mounted as ephemeral `tmpfs`; application assets stay read-only.
- The mail worker has no payment provider key/secret, webhook secret, QR-signing secret, vision token, proxy-trust setting or public port.
- Service memory/PID limits are conservative starting values, not capacity sizing. Observe peak usage (especially during image upload and mail backlog) and adjust deliberately.
- If using an orchestrator/hosting platform other than the included Docker Compose topology, reproduce the same service-specific secret scopes, writable paths, private networking, health checks and resource controls in its native configuration.
- Before a public launch, run a dependency vulnerability review against a committed lockfile and scan built images using your chosen scanner; resolve or explicitly accept and document findings.

---

<a id="documentation-source-docs-profile-driver-facility-owner-mode-md"></a>

## docs/profile-driver-facility-owner-mode.md

### SmartPark Driver and Facility Owner Modes

## What the mode switch does

The My profile page lets an active account enable facility-owner capability and then switch the visible workspace between Driver and Facility Owner. The workspace preference is stored per user in that browser. Switching to Driver mode does not remove the `host` role, delete listings, cancel bookings, or change facility status. Server routes continue to make authorization decisions from the user's assigned roles.

## Becoming a facility owner

1. Sign in with an active SmartPark account.
2. Open **My profile** from the avatar or sidebar account control.
3. Choose **Enable facility owner mode**.
4. Select **Facility owner mode** when you want to manage facilities.
5. Choose **Manage facilities & prices** to use the existing `My listings` workflow.
6. Add facility details, spaces, operating availability, photos, and pricing; submit the listing for review.

The self-service endpoint adds `driver` and `host` role rows without removing existing roles. This is capability enablement, not property verification. Listings still pass through the existing review and owner-verification workflows before publication.

## Switching back to Driver

In **My profile**, choose **Driver mode**. This hides owner workspace navigation for convenience while preserving the user's facility-owner capability and data. Open **Find parking**, **Vehicles**, or **My bookings** to use driver features. The mode preference is browser-local and user-specific.

## Parking as a facility owner

A facility owner can also use the ordinary driver reservation flow. Open **Find parking**, choose an available slot from an active, approved facility, select a vehicle registered under **Vehicles**, check the server-calculated quote, and create a reservation hold. This includes an eligible slot at a facility the same user owns if that facility is published and the slot is available. Standard vehicle compatibility, booking overlap, availability, price, and payment rules still apply. Unapproved or draft facilities are not publicly bookable.

## Verification notes

- No database migration is required; this feature reuses the existing `roles`, `user_roles`, `parking_lots`, `parking_slots`, `pricing_rules`, and booking tables.
- Enabling owner capability is auditable through `user.facility_owner_enabled`.
- The active workspace selection is a presentation preference, not a security boundary. Direct API access remains protected by server-side role and ownership checks.
- Before production release, test host-role assignment, own-facility booking, approval status, and payment accounting against a test database/payment environment.

---

<a id="documentation-source-docs-release-checklist-md"></a>

## docs/release-checklist.md

### SmartPark release checklist

## Build and configuration
- [ ] `npm run preflight:production` passes without printing secrets.
- [ ] `docker compose -f docker-compose.production.yml config --quiet` passes.
- [ ] Web and API container images build from clean caches.
- [ ] `npm run test:api` and Python unit tests pass.
- [ ] `npm run build` succeeds.
- [ ] No `.env`, database dump, credentials, camera URL credentials, uploaded photos or model weights are tracked in Git.

## Database and deployment
- [ ] Fresh database migration path tested from 001 through 013.
- [ ] Existing-database baseline path tested only on a verified backup/schema.
- [ ] MySQL has no public host port.
- [ ] Web/API containers run non-root where supported and have health checks.
- [ ] Runtime photos, database files and Caddy certificates use persistent volumes.
- [ ] HTTPS certificate issuance/renewal and HTTP-to-HTTPS redirect verified.
- [ ] Backup restore and rollback procedure tested.

## Business and security
- [ ] Production uses Razorpay, not mock payments.
- [ ] Email verification/password reset and transactional event emails use the deployed HTTPS origin and verified SMTP sender.
- [ ] `email-worker` starts without public ports, drains an outbox message, retries a simulated SMTP failure, and records terminal failures after the attempt limit.
- [ ] Development-mode outbox rows are marked `simulated`, never falsely reported as delivered.
- [ ] Production worker logs contain no SMTP password, recipient/body payloads, or payment credentials; development-only message logging is kept local and is not shared.
- [ ] Role and facility isolation tested with separate driver/host/operator/admin accounts.
- [ ] Booking concurrency, payment idempotency, QR replay/expiry, and entry/exit tested.
- [ ] Alerts and notifications scoped correctly by facility/account.
- [ ] Vision stale state, camera outage, model failure, and manual correction tested onsite.
- [ ] Legal/privacy, retention and CCTV requirements reviewed for the deployment jurisdiction.

## Go/no-go
- [ ] All mandatory checks above have a recorded pass/fail result and owner.
- [ ] No unresolved critical security/payment/booking issue remains.
- [ ] Monitoring, on-call contact and rollback decision are documented.

- [ ] Refund processing has been tested against provider sandbox; every successful refund has an externally verified reference.
- [ ] Host payout requests reconcile to allocated earning rows; transfer references are verified against bank/provider records.
- [ ] Refund-processing entry lock, failure/recovery and manual-review paths tested using a real disposable MySQL 8 instance.

- [ ] Verify favorite ownership isolation, recent-search deletion, completed-booking review eligibility, unique-review constraint and administrator moderation against MySQL.
- [ ] Confirm public review responses never expose booking IDs, email addresses or full reviewer names.

## Phase 13 — Integration validation

- [ ] `npm run test:all` passes.
- [ ] `npm run build` completes without errors.
- [ ] Apply migrations with the controlled migration runner; verify history has no `running` or `failed` entry.
- [ ] Start the API with the migrated MySQL database and verify `/api/health` reports `database: connected`.
- [ ] Run `npm run test:integration`; verify API identity, public inventory response shapes, authentication boundaries, Origin guard, and 404 contract.
- [ ] With a verified staging account set `SMARTPARK_SMOKE_EMAIL` and `SMARTPARK_SMOKE_PASSWORD`, run the integration smoke suite again to exercise authenticated read endpoints and session revocation.
- [ ] Complete the manual end-to-end scenarios in `README.md#documentation-source-docs-integration-testing-md` using test-only payment credentials and test data.
- [ ] Verify browser and API access, payment/webhook, email-worker, and camera/vision behavior in the intended deployment environment.

A passing smoke test is not equivalent to production certification. Payment providers, SMTP, TLS issuance, database restore, camera detection accuracy and gate hardware require environment-specific validation.


## Phase 14 — Production least-privilege hardening
- [ ] Confirm production API process role is `SMARTPARK_PROCESS=api` and mail-worker role is `SMARTPARK_PROCESS=email-worker`.
- [ ] Confirm the mail worker does not receive payment credentials, webhook secret, QR signing secret, vision token or reverse-proxy trust configuration.
- [ ] Build and start API/web/email-worker with read-only roots, temporary mounts, capability restrictions and resource limits.
- [ ] Validate uploads still work through the persistent marketplace volume and Nginx health/static routes work with read-only web root.
- [ ] Run dependency vulnerability audit using the committed package-lock and scan deployable images.
- [ ] Review configured memory/PID limits under representative workload; check logs do not expose secrets or sensitive payloads.
- [ ] Complete the environment-specific items in `README.md#documentation-source-docs-phase14-production-security-md`.


## Phase 15 — Final launch gate
- [ ] `npm run release:audit` reports no failures; all warnings have an owner and disposition.
- [ ] Root `package-lock.json` was generated with a network-enabled npm install and a clean `npm ci` succeeds. The current Phase 15 archive does not include a lockfile because registry access timed out during packaging.
- [ ] `npm run verify:release` passes with a migrated disposable MySQL database and API running.
- [ ] Fresh-install and upgrade migration paths are tested against MySQL 8.4, including an approved backup and baseline when applicable.
- [ ] Production Compose images build and start on the target host; health checks and TLS issuance/renewal are verified.
- [ ] Payment, SMTP, refund, host payout, camera, and gate integrations pass environment-specific staging checks.
- [ ] Backup restore, rollback, alerts, and operational ownership are documented and exercised.
- [ ] Public launch is a GO only after every mandatory item above and every previous mandatory checklist item is recorded as PASS.

---

<a id="documentation-source-docs-remaining-phases-integrated-md"></a>

## docs/remaining-phases-integrated.md

### SmartPark remaining phases — integrated delivery notes

This update groups the remaining roadmap into a single branch/package. It builds on the latest Driver/Facility Owner mode update and keeps existing marketplace, booking, payment tracking, camera, ANPR, profile, and settings modules in place.

## Included work

### Phase 14 — Overstay monitoring and gate integration foundation
- `services/api/src/scripts/operations-monitor.js` detects checked-in parking sessions that remain parked beyond their booking end time plus a configurable grace period.
- New overstay incidents are linked to the parking session, booking, facility and slot. An operational alert is created and the driver and facility owner are notified once per incident.
- The monitor resolves incidents after exit or a valid reservation extension. It intentionally does **not** calculate or collect an overstay fee automatically; operators should follow the facility's published policy and review the booking first.
- `gate_devices` and `gate_device_commands` record authorized gate controllers and short-lived commands. `services/api/src/routes/gate-hardware.routes.js` exposes management and adapter-polling APIs.
- A physical controller is not operated by this code alone. Configure a long random `GATE_DEVICE_SERVICE_TOKEN`, implement the provider-specific edge adapter, protect its network, and test with a non-live gate before enabling entry/exit control. The API refuses to queue hardware commands when this token is unset.

### Phase 15 — Incident alerts and booking-demand planning
- Existing camera stale/offline alerting remains in Operations.
- Gate adapter command failures create critical operational alerts.
- `GET /api/operations/reports/forecast?hours=24` provides a 1–168 hour planning indicator based on the average historical booking starts for the same UTC weekday/hour over the previous eight weeks.
- The Operations workspace shows the next 24 hours of estimated booking starts and confidence labels.
- This is a historical baseline, not a trained AI model and not a sensor-derived prediction of physical occupancy. Facilities with sparse history will have low confidence.

### Phase 16 — Communications and support
- New support ticket APIs are available under `/api/support`: create a ticket, list own tickets, access a staff queue, read/reply, add staff-only internal notes, and update status. Permissions are scoped by the requester, assigned facility staff and administrators.
- Email and in-app notifications use the existing notification mechanisms.
- Optional SMS delivery can use Twilio. SMS is only queued for opted-in users with a valid E.164 phone number. Configure `SMS_PROVIDER=twilio`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and `TWILIO_FROM_NUMBER`. Start the `sms-worker` process only after consent, provider delivery and rate limits have been tested.
- New SMS delivery status, attempt count, lease, provider ID and retry fields are added by migration `021_remaining_phases.sql`.
- Actual money movement remains provider-/bank-integration work. Existing refund approvals, refund references and payout accounting are retained; this package does not initiate automated Razorpay refunds or bank payouts. Administrators must continue to verify and record external financial actions. Browser push notifications that work after the browser closes also need a service worker subscription and VAPID/Web Push provider setup; the existing in-app inbox remains available.

### Phase 17 — integration and release checklist
- Added a regression test for the historical demand forecast.
- Added release-contract route checks for the new support and gate-hardware API routers.
- Added protected UI for gate-controller registry/command review and a support ticket workspace.
- Included `sms-worker` and `operations-worker` services in `docker-compose.production.yml`.

## Migration

A new numbered migration, `021_remaining_phases.sql`, creates overstay incident, gate device/command, support-ticket/message, and SMS-consent preference tables and extends the notification delivery columns. It follows migrations 001–020 and is registered in the baseline requirements.

Before applying it:
1. Take a verified database backup and test restore.
2. Check `schema_migrations` and confirm migrations 001–020 are consistent with the deployed database.
3. Review the SQL in `database/migrations/021_remaining_phases.sql`.
4. Run `npm run migrate` from the project root.
5. Verify the new tables, the notification enum/columns, and the normal booking, email, refunds/payouts, camera and ANPR workflows.

Do not mark a manually built database as fully migrated without checking its actual schema. Follow `README.md#documentation-source-docs-production-deployment-md` baseline guidance if migration history was not maintained.

## Commands

```powershell
npm install
npm run check:syntax
npm run test:api
npm run test:vision
npm run build
npm run release:audit
```

Use `npm run worker:operations:once` to run one monitoring pass in a controlled test environment and `npm run worker:sms:once` to process one queued SMS after Twilio has been configured. Continuous workers are `npm run worker:operations` and `npm run worker:sms`. The production Compose file defines matching worker services.

## Hardware adapter contract

The edge adapter must authenticate with `Authorization: Bearer <GATE_DEVICE_SERVICE_TOKEN>` and poll:

`GET /api/gate-hardware/service/commands?deviceId=<registered-device-uuid>`

It then performs the provider-specific command in its own trusted environment and posts the result to:

`POST /api/gate-hardware/service/commands/<command-uuid>/result`

with JSON `{ "status": "succeeded" | "failed", "externalReference": "optional-provider-id", "message": "optional-safe-detail", "result": {} }`.

Never expose the service token in the browser or commit it to source control. Only run commands on hardware that you own or are explicitly authorized to control. Commands expire after 60 seconds; failure or expiry should be investigated before retrial.

## Release status

Source syntax checks, API tests and static release audit are available locally. A green source/API result does not establish production readiness. The production frontend build, clean-database and upgrade migrations, browser E2E tests, SMTP/Twilio delivery, Razorpay reconciliation, physical camera feeds, edge-controller safety, database restore, HTTPS and external money movement must be verified in the deployment environment with non-live/test resources first.

---

<a id="documentation-source-docs-requirements-md"></a>

## docs/requirements.md

### SmartPark requirements — initial baseline

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

---

<a id="documentation-source-services-vision-readme-md"></a>

## services/vision/README.md

### SmartPark Vision Service (see master docs)

This repository’s vision-service documentation has been consolidated into the root [README.md](README.md) under **Phase 7**.

---

## Documentation sources

The following source documents were merged into this file. The links are anchors into this README so the documentation remains navigable after cleanup.

- [CHANGELOG.md](#documentation-source-changelog-md)
- [docs/access-controls-and-booking-gate.md](#documentation-source-docs-access-controls-and-booking-gate-md)
- [docs/account-security-and-settings.md](#documentation-source-docs-account-security-and-settings-md)
- [docs/admin-console-guide.md](#documentation-source-docs-admin-console-guide-md)
- [docs/api-specification.md](#documentation-source-docs-api-specification-md)
- [docs/architecture.md](#documentation-source-docs-architecture-md)
- [docs/deployment-security-checklist.md](#documentation-source-docs-deployment-security-checklist-md)
- [docs/docs/api-specification.md](#documentation-source-docs-docs-api-specification-md)
- [docs/docs/architecture.md](#documentation-source-docs-docs-architecture-md)
- [docs/docs/engagement.md](#documentation-source-docs-docs-engagement-md)
- [docs/docs/financial-operations.md](#documentation-source-docs-docs-financial-operations-md)
- [docs/docs/integration-testing.md](#documentation-source-docs-docs-integration-testing-md)
- [docs/docs/next-steps.md](#documentation-source-docs-docs-next-steps-md)
- [docs/docs/operations-runbook.md](#documentation-source-docs-docs-operations-runbook-md)
- [docs/docs/phase14-production-security.md](#documentation-source-docs-docs-phase14-production-security-md)
- [docs/docs/phase15-final-release.md](#documentation-source-docs-docs-phase15-final-release-md)
- [docs/docs/production-deployment.md](#documentation-source-docs-docs-production-deployment-md)
- [docs/docs/release-checklist.md](#documentation-source-docs-docs-release-checklist-md)
- [docs/docs/release-evidence\phase15-static-checks.md](#documentation-source-docs-docs-release-evidence-phase15-static-checks-md)
- [docs/docs/requirements.md](#documentation-source-docs-docs-requirements-md)
- [docs/docs/transactional-email.md](#documentation-source-docs-docs-transactional-email-md)
- [docs/next-steps.md](#documentation-source-docs-next-steps-md)
- [docs/phase-10-11-corporate-fleet-ev.md](#documentation-source-docs-phase-10-11-corporate-fleet-ev-md)
- [docs/phase-5-location-discovery.md](#documentation-source-docs-phase-5-location-discovery-md)
- [docs/phase-6-arrival-planning.md](#documentation-source-docs-phase-6-arrival-planning-md)
- [docs/phase-7-promotions.md](#documentation-source-docs-phase-7-promotions-md)
- [docs/phase-8-referral-program.md](#documentation-source-docs-phase-8-referral-program-md)
- [docs/phase-9-monthly-subscriptions.md](#documentation-source-docs-phase-9-monthly-subscriptions-md)
- [docs/phase12-13-accessibility-anpr.md](#documentation-source-docs-phase12-13-accessibility-anpr-md)
- [docs/production-deployment.md](#documentation-source-docs-production-deployment-md)
- [docs/profile-driver-facility-owner-mode.md](#documentation-source-docs-profile-driver-facility-owner-mode-md)
- [docs/release-checklist.md](#documentation-source-docs-release-checklist-md)
- [docs/remaining-phases-integrated.md](#documentation-source-docs-remaining-phases-integrated-md)
- [docs/requirements.md](#documentation-source-docs-requirements-md)
- [services/vision/README.md](#documentation-source-services-vision-readme-md)
