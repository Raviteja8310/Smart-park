# Phase 9 — Monthly parking passes

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
