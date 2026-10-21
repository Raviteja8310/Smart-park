# SmartPark API — Phase 3 contract

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
