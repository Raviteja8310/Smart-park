# SmartPark — OpenStreetMap map integration

Additive feature: the **Find parking → Map** view now shows an interactive Leaflet/OpenStreetMap map driven by live SmartPark availability from the existing MySQL database. Nothing else in the app was redesigned or replaced; the previous embedded OSM preview is kept as an automatic fallback.

## What it does

- **Markers from the database**: one marker per active facility with coordinates. Colour comes from the existing availability SQL:
  green = spaces available, red = fully occupied, orange = held by active reservations, grey = unknown / no live data.
- **Popups**: name, address, available / total / occupied / reserved, spaces awaiting a sensor update, price per hour, EV charging summary, **View & reserve** (opens the existing facility/booking screen) and **Directions**.
- **Your location**: uses the page's existing "Use my location" flow (one-off request, no continuous tracking, coordinates are not stored or sent to the server except as a nearby-search query). Denied / timeout / unsupported are handled by the existing messages.
- **Place search**: OpenStreetMap Nominatim (min. 3 characters, 1 request/second, results cached).
- **Nearby parking**: SmartPark facilities within the page's radius, sorted nearest first. Optional **OpenStreetMap parking** layer (Overpass) is drawn with dashed markers labelled "not managed by SmartPark · availability unknown" — never shown as available.
- **Directions**: OSRM public demo router; draws the route, shows distance and duration, **Clear route**. Labelled as an estimate, not live-traffic navigation.
- **Live availability**: refreshes every 30 s while the tab is visible; stops when the map is closed.
- Lazy-loaded (Leaflet ships in its own ~53 KB gzipped chunk, only when the Map view opens). Translated into Hindi, Kannada, Telugu, Spanish, French and Japanese with the rest of the app.

## Installation

Dependencies `leaflet` and `react-leaflet` are already declared in `apps/web/package.json`.

```bash
npm install
```

## Database / migrations

**No migration is required.** The existing `parking_lots.latitude` / `parking_lots.longitude` columns (already validated −90..90 / −180..180 by the existing facility forms) and the existing `parking_slots`, `bookings` and `ev_chargers` tables are read as they are. No tables, columns or rows are created, changed or deleted. Facilities without coordinates simply don't get a marker (owners can add coordinates in their facility details as before).

## Running

Start MySQL, the API and the web app exactly as before:

```bash
npm run db:up
```

```bash
npm run dev
```

Open the app → **Find parking** → search → **Map**.

Optional: `VITE_PARKING_API_URL` (see `.env.example`) overrides the map feed URL. No API keys are needed; no secrets reach the frontend.

## New API (read-only)

Mounted at `/api/parking/map`, rate-limited to 120 requests/minute per client, parameterized SQL, reusing the same availability SQL as `/api/parking/lots`.

| Endpoint | Query | Notes |
|---|---|---|
| `GET /api/parking/map/locations` | `lat`, `lng` (both or neither), `radiusKm` 0.1–100 (default 10), `limit` 1–500 (default 200) | Active facilities with coordinates; with `lat`/`lng`, filtered by radius and sorted by distance. |
| `GET /api/parking/map/locations/:lotId` | — | One facility. `400 INVALID_ID`, `404 LOT_NOT_FOUND`, `404 LOCATION_UNAVAILABLE`. |

Counts are clamped at 0; invalid input returns `400 VALIDATION_ERROR` with a readable message.

## Files added

| File | Purpose |
|---|---|
| `services/api/src/routes/parking-map.routes.js` | Read-only map feed (locations, details, nearby, availability, EV summary). |
| `apps/web/src/components/SmartParkMap.jsx` | Leaflet map: markers, popups, search, location, nearby, OSM layer, routing, polling. |
| `apps/web/src/components/SmartParkMap.css` | Map styles using the existing design tokens (light/dark). |
| `apps/web/src/components/MapErrorBoundary.jsx` | Falls back to the original OSM embed if the map fails. |
| `apps/web/src/services/parkingApi.js` | Client for the map feed. |
| `apps/web/src/services/osmServices.js` | Nominatim / Overpass / OSRM clients with timeouts, throttling and caching. |
| `apps/web/src/locales/{hi,kn,te}/part-11.tsv` | Translations for the map's text. |
| `OPENSTREETMAP_INTEGRATION.md` | This document. |

## Files modified (minimal)

| File | Change | Why |
|---|---|---|
| `services/api/src/app.js` | +2 lines: import and mount `/api/parking/map` | Register the new read-only router (before `/api/parking`). |
| `services/api/src/routes/parking.routes.js` | +3 lines: `export { LOT_SUMMARY_SELECT }` | Map feed reuses the exact existing availability SQL instead of duplicating it. |
| `apps/web/src/components/ParkingPage.jsx` | Map preview iframe wrapped: `SmartParkMap` (lazy) with the original iframe as fallback; 3 import lines. **Also a one-word bug fix in `LotCard`** (see below). | Show the interactive map in the existing Map view; all other page behaviour unchanged. |
| `apps/web/package.json` / `package-lock.json` | `leaflet`, `react-leaflet` | Map library. |
| `apps/web/src/locales/keys.tsv`, `source-strings.json` | Regenerated | New strings registered for translation. |
| `.env.example` | Commented optional `VITE_PARKING_API_URL` | Documentation only, no secrets. |

**Existing bug fixed (necessary):** in `ParkingPage.jsx`, `LotCard` declared a local `const hasCoordinates = …` that shadowed the module's `hasCoordinates()` function and then called it, so the Find parking page crashed ("hasCoordinates is not a function") whenever a result card rendered — in List view as well. The local variable was renamed to `lotHasCoordinates`; behaviour is otherwise identical.

Untouched: login/registration, authentication/authorization, roles, booking, slot allocation, payments, admin dashboard, theme, navigation, database schema.

## Test results (executed)

Environment: local Docker MySQL with the demo seed, API on :4000, Vite dev server, built-in browser.

**API (curl)**
- Nearby `lat=12.98&lng=77.60&radiusKm=5` → 1 facility, 1.1 km, status `available`; far location → 0 results. ✅
- `lat=95` → 400; `lat` without `lng` → 400; `lat=abc` → 400 "Latitude must be a number."; `radiusKm=500` → 400. ✅
- Detail: invalid UUID → 400; unknown UUID → 404; valid id → 200. ✅
- Counts match the existing `/api/parking/lots` feed (15 total, 8 available, 4 occupied, 3 unknown, 0 reserved). ✅
- Marker status mapping unit check (available / occupied / reserved / unknown ×2): 5/5. ✅

**Browser**
- Map loads, tiles load, zoom in/out (13→14→13), dragging pans the map. ✅
- Marker colour green and highlighted as the page's active facility; popup shows correct counts, price, EV line, buttons. ✅
- Location denied → existing "Location permission was denied…" message; location granted (simulated position) → blue marker. ✅
- Nominatim search ("Cubbon Park Bengaluru") → purple place marker; <3 characters → validation message. ✅
- Nearby search from location and from a searched place → sorted SmartPark results. ✅
- OSRM directions → route polyline + "1.8 km · about 3 min"; Clear route removes it. ✅
- Live update: one slot changed in the local DB → map popup updated on the next 30 s poll (8→7 available, 4→5 occupied) without reload; slot restored. ✅
- Map feed HTTP 500 and malformed response → readable message, map stays usable. ✅
- Overpass: the public server was overloaded during testing (requests exceeded 40 s) → timeout message shown correctly. OSM marker rendering and labelling were verified with a **stubbed** Overpass response, not the live service.
- Switching back to List view unmounts the map; no further polling (no timer leak). List cards render. ✅
- Mobile width (375 px): no horizontal scroll, controls wrap. ✅
- Hindi: map toolbar, legend, popup, status and placeholder translated. ✅

**Regression**
- `npm run build` ✅ (map in its own chunk).
- `npm run test:api`: 108/110 pass. The 2 failures are pre-existing and unrelated to the map: `account-security.test.js` expects `sp-theme-toggle` in `App.jsx` (not present at the committed HEAD either), and `release-contract.test.js` imports a top-level `scripts/` folder that is not in this repository (the same missing folder makes `npm run check:syntax` / `release:audit` fail).
- Not executed: end-to-end booking/cancellation/payment through the UI — online booking is disabled in this environment by the existing `ALLOW_DRIVER_BOOKINGS=false` setting, which was not changed. The map reads the same `ACTIVE_BOOKING` SQL as the existing booking screens, so active holds/confirmed bookings count as reserved.

## Known limitations

- Nominatim, Overpass and OSRM are shared public services with usage policies and no uptime guarantee (Overpass was slow during testing). For production traffic use a hosted or self-hosted provider; the URLs are constants in `apps/web/src/services/osmServices.js`.
- The OSRM demo route is an estimate, not turn-by-turn or live-traffic navigation.
- The Map view appears with search results (existing page behaviour kept).
- EV information appears only for facilities with rows in `ev_chargers`.
- The API rate limiter is in-process (per API instance), like the existing limiters.
- Production CSP (`deployment/nginx.conf`) already allows `https:` images and connections, which the tiles and services need.
