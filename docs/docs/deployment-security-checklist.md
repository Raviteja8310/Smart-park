# SmartPark Production Deployment & Security Checklist

Use this checklist before exposing a SmartPark deployment to real customers. Passing local unit tests does not replace deployment-specific testing, payment-provider certification, or camera/site acceptance testing.

## 1. Secrets and environment

- [ ] Set `NODE_ENV=production` and a production-only environment file/secret manager.
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
- [ ] Apply migrations 001–008 in order on a fresh database, or only the migrations not yet applied on an existing database.
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
