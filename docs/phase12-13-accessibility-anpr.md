# SmartPark Phases 12–13: Accessibility, Language, and ANPR

## Phase 12: accessibility and language preferences
- Adds a skip-to-main-content link and preserves visible keyboard focus styles.
- Adds browser-local high-contrast, larger-text, and reduced-motion preferences.
- Adds English, Hindi, Kannada, and Telugu for the main navigation and selected workspace labels. Feature-specific detail pages may remain in English; this is a first translation layer, not a complete localization pass.
- Preferences are saved in localStorage for the current browser and are not synced across devices.

## Phase 13: number-plate recognition integration foundation
- Migration `019_anpr_events.sql` creates the plate-event review inbox.
- A compatible ANPR provider sends plate candidates to `POST /api/vision/service/plate-events` with `Authorization: Bearer <VISION_API_TOKEN>`.
- Payload: `{ "cameraId": "<uuid>", "plateText": "KA01AB1234", "confidence": 0.93, "direction": "entry", "observedAt": "2026-10-22T10:00:00.000Z", "providerEventId": "optional-provider-id" }`.
- Authenticated hosts, assigned operators, attendants, and admins can view events for facilities they can access. Only hosts, assigned operators, and admins can mark events confirmed or false positive.
- Matching is advisory. The API does not open a physical gate, check a driver in, or alter a booking automatically.
- Raw camera images are not stored by this feature. Plate text is sensitive data; configure signage, access restrictions, retention, and lawful processing before enabling it.
- OCR/ANPR itself is not bundled. A compatible provider or model must send events to the endpoint.

## Apply
Back up the database, then run `npm run migrate` after reviewing migration history. Do not rerun migrations against a manually baselined database without following the baseline guide.

## Verify
Run `npm run check:syntax`, `npm run test:api`, and `npm run build`. Test the service endpoint using a non-production camera and a valid vision token; verify that an event appears in Plate recognition and that no gate or booking status changes automatically.
