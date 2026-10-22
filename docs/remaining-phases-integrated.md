# SmartPark remaining phases — integrated delivery notes

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

Do not mark a manually built database as fully migrated without checking its actual schema. Follow `docs/production-deployment.md` baseline guidance if migration history was not maintained.

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
