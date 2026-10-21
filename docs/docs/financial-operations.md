# SmartPark financial operations (Phase 11)

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
