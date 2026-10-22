# SmartPark

An original, web-first smart-parking platform combining facility inventory, shared parking listings, bookings, payment verification, QR access, operator workflows and camera-based occupancy detection.

## Phase 14: production least-privilege hardening

The production Compose stack now runs the API, web server and email worker with hardened runtime settings where supported (read-only root filesystems, temporary writable mounts, resource/PID limits and `no-new-privileges`). The email worker uses `SMARTPARK_PROCESS=email-worker` and receives only database/site-origin/SMTP credentials; payment, QR-signing and vision-service secrets are not passed to that container. API-only settings stay with the API.

Review `docs/phase14-production-security.md` before deploying. A static preflight or passing unit tests is not a substitute for testing a clean build, migrated MySQL database, HTTPS, provider sandbox, SMTP, backup restore and camera hardware in staging.

## Phase 9: release hardening and deployment

Production deployment files are provided under `deployment/` and in `docker-compose.production.yml`. Read `docs/production-deployment.md` before deploying. Production requires a real public DNS name, HTTPS, SMTP, live Razorpay configuration, strong independent secrets, a backup plan, and a tested database migration path. Do not use mock payments with `NODE_ENV=production`.

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

Release hardening and production deployment instructions: `docs/production-deployment.md`, `docs/release-checklist.md`, and `docs/deployment-security-checklist.md`.

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

   The DB user in `.env` needs permission to create tables and indexes. On an existing database where migrations were applied manually before the runner was introduced, see `docs/production-deployment.md` for the schema-checking baseline command. Do not run the full migration chain against a manually migrated database without baselining it first.

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
   ```

   Enter the value of `DB_PASSWORD` from `.env` when prompted. On a new database, apply migrations `001`–`011` exactly once and in numeric order. On an existing database, run only migrations not yet applied, in order. In particular, a Phase 6 database needs only migration `007_vision_detection.sql` for Phase 7. Do not re-run any migration that has already succeeded. Back up a database with data before schema changes.

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

The release checklist is in `docs/deployment-security-checklist.md`, and operational response guidance is in `docs/operations-runbook.md`. Before production, complete a real MySQL migration test, full browser build, payment-provider end-to-end tests and a camera/network acceptance test.


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

Apply `database/migrations/010_refunds_and_host_payouts.sql` after migrations 001–009, then `database/migrations/011_favorites_search_reviews.sql` for Phase 12. Prefer `npm run migrate` after verifying the existing migration history. If the database was migrated manually with no `schema_migrations` history, follow `docs/production-deployment.md` and baseline only after confirming the complete schema version.

Read `docs/financial-operations.md` for the status transitions, role responsibilities, operational steps and testing checklist. A successful build and full MySQL/provider integration test still must be completed in your deployment environment before public launch.


## Phase 12: saved parking, recent searches and verified reviews

- Favorites are stored per account and can be added/removed from public parking cards. Draft and inactive facilities are not exposed through the favorites endpoint.
- Recent search history stores only entered search text and city; it does not store GPS coordinates. Users can delete one search or clear their history. A bounded retention behavior trims old entries if the history exceeds 500 rows.
- Reviews require an authenticated user and a completed booking at that facility. One review is permitted per completed booking. Facility owners cannot review their own facility.
- Public cards expose aggregate average rating and count, while public review records display a shortened reviewer name and do not include booking IDs. Users can edit/delete their own reviews, and administrators can hide or republish reviews.
- Apply migration `011_favorites_search_reviews.sql` after migration 010. Run `npm run migrate` when migration history has been verified.
- API pure-logic tests cover input normalization, review validation and privacy-safe public mapping. The migration and API endpoints still require live MySQL integration testing.

## Phase 13: integration smoke tests and release contracts

Phase 13 adds a live HTTP smoke-test harness and source contract tests to reduce the risk of frontend/backend route mismatches and configuration regressions. The smoke test checks database health, public parking response shapes, authentication boundaries, security headers, Origin enforcement and consistent 404 responses. Optional credentials enable authenticated read-only collection checks and verify session invalidation after logout.

Run deterministic tests with `npm run test:all`. With MySQL migrated and the API running, run `npm run test:integration`. Use `npm run verify:release` to run tests, build the production frontend and run the live smoke checks in sequence. See `docs/integration-testing.md` for setup, expected behavior and the end-to-end staging checklist.

The live API smoke tests, full Vite build, MySQL-backed business workflows, provider checkout/webhooks, SMTP delivery, production HTTPS and camera/hardware accuracy must be validated in the target environment. Passing unit and source-contract tests alone is not production certification.

### Phase 13: integration verification and release contracts

Phase 13 adds a read-mostly live API smoke suite (`npm run test:integration`) plus source-contract tests that verify router mounts, frontend-to-backend endpoint correspondence, raw webhook-body ordering, migration sequence/baseline coverage, and production network/secret assumptions. Run `npm run test:all` for deterministic API/vision tests, then `npm run build`, followed by the live smoke suite with the API and MySQL running. See `docs/integration-testing.md` and the Phase 13 section in `docs/release-checklist.md`.

The current environment could run the deterministic tests but could not download npm dependencies from the registry, and has no running MySQL/Docker runtime. Therefore the production frontend build, database-backed HTTP smoke tests, Razorpay staging checkout/webhooks, SMTP delivery, and physical camera/hardware flow must still be verified on the development computer or staging server.
