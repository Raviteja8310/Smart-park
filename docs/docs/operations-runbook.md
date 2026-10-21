# SmartPark Operations Runbook

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
