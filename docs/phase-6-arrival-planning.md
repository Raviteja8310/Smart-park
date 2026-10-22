# Phase 6 — Navigation and Arrival Planning

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
