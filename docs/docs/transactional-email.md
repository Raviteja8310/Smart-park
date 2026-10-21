# SmartPark transactional email outbox

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

The `email-worker` service is part of `docker-compose.production.yml`, uses the same API image, has no published ports, and connects to MySQL and the outbound SMTP provider. The new-database deploy command starts it after applying migrations. For manually migrated databases, baseline existing migrations as documented in `docs/production-deployment.md`, then allow migration 009 to run.

Inspect worker status and logs:

```bash
docker compose -f docker-compose.production.yml ps email-worker
docker compose -f docker-compose.production.yml logs --tail=100 email-worker
```

## Delivery semantics and retention

Queue idempotency prevents the same business event from being enqueued twice. SMTP delivery is **at-least-once**, not exactly-once: if the SMTP server accepts a message and the worker stops before recording success in MySQL, a retry may send a duplicate. These emails are informational and must never be used as proof of payment, booking authorization or gate access.

Outbox rows contain recipient email addresses and reservation metadata. Restrict DB access and backups, set a retention policy that matches applicable law and business needs, and delete/anonymize old rows only after they are no longer needed for dispute/audit obligations. The automated worker does not yet purge rows.
