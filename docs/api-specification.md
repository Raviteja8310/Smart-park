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
