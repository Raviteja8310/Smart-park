# SmartPark Phase 5 — Location-aware discovery

## What changed

The existing `ParkingPage` discovery experience now includes:

- An explicit **Use my location** action that asks the browser for permission only after the user clicks it.
- Distance estimates from the user's location to published facilities that have valid latitude/longitude values, calculated with the Haversine formula.
- Nearest-first sorting when a user location is available.
- Optional nearby-only filtering with 2, 5, 10, 25, and 50 km radii.
- List/map view switching, a location list, and a map preview for the selected facility using OpenStreetMap's embedded map.
- Directions and larger-map links for facilities with coordinates.
- Friendly states for denied permissions, unavailable location, facilities without coordinates, and empty radius results.

## Data and service requirements

No database migration or new API endpoint is required. The existing public `/api/parking/lots` response already includes facility latitude and longitude. Owners or administrators should add accurate coordinates to each listing for map pins and distance estimates to work.

The map preview uses OpenStreetMap in the user's browser. A network connection is needed to load map tiles. Browser geolocation generally requires HTTPS or localhost and always depends on the user's permission.

## Privacy and accuracy notes

- Location is requested only after the user clicks the location button.
- Coordinates remain in the browser and are not sent to the SmartPark API by this feature.
- Distance is straight-line distance, not road distance or travel time. Use a routing provider integration for route-aware estimates.
- The map displays one selected facility marker at a time; it does not claim to render every facility as a marker simultaneously.
- Missing or inaccurate facility coordinates must be corrected by the owner or an administrator.

## Verification

Run from the repository root:

```bash
npm run check:syntax
npm run test:api
npm run build
```

The production build requires dependencies to be installed first with `npm install`. Test the geolocation permission flow, radius filter, facilities with and without coordinates, and map links in a browser.
