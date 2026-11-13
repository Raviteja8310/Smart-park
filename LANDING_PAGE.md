# SmartPark — public landing page

A new cinematic landing page is now the first screen signed-out visitors see. Everything after it — sign-in, registration, password reset, dashboards, admin, APIs and database — is the existing SmartPark application, unchanged.

## What visitors see

| Section | Content |
|---|---|
| Navigation | SmartPark logo, Home · About · Features · How it works · Contact, Login, Get started. Transparent over the video, solid when scrolling; a menu sheet on phones (Escape closes it). |
| Hero | Your video as the background. "Park smarter. Live better." with Get started, Login and Explore SmartPark, plus a live count of free spaces read from the existing public `/api/parking/overview` (hidden if the API is unavailable). |
| About | The problem (circling, idle spaces, manual counts) and how SmartPark connects drivers, owners and operators. |
| Features | "Every space, live" with an animated parking-deck illustration, then the features that exist in the code: reservations, QR entry tickets, Razorpay checkout, camera occupancy (YOLO), EV charging, monthly passes, owner listings, gate operations, promotions and referrals, notifications, seven languages. |
| How it works | Find → Reserve → Arrive → Park and go, drawn as a road a car drives along in a continuous loop, lighting each step as it passes. |
| Technology | Live availability, computer vision, maps and routing, platform, payments and tickets — only what the project actually uses. |
| Benefits | Drivers, space owners, operators. |
| Final call to action | "Your smarter parking experience starts here." with Get started and Login over manga-style focus lines. |
| Footer (Contact) | Branding, links, and how to reach the team: sign in and use the existing Help & support page. No contact details were invented. |

Design: an ink-and-paper world taken from the video itself (black, warm white, speed lines, screentone dots) with one indigo accent that matches the app's brand on the next screen. Display type is Archivo Expanded (loaded only by this page); body text uses the app's existing Plus Jakarta Sans. Icons come from the existing `lucide-react` dependency. No new packages were installed.

## The video

- Location: `apps/web/public/videos/smartpark-hero.mp4` (your file, copied unchanged — 720×1280, 7.7 s, H.264, 4.4 MB, already streamable).
- Posters: `apps/web/public/assets/landing/hero-poster.jpg` (first frame, shown until the video plays and if it fails) and `drift-front.jpg` (a frame used in the Technology band).
- Autoplay, muted, looping, `playsinline`, `object-fit: cover`, never stretched.
- The video is portrait, so it is composed per screen: on phones it fills the hero; on desktop the sharp video sits in a tall frame beside the headline while a dimmed copy fills the whole hero behind it (stretching a portrait clip across a wide screen would crop most of the car and blur it).
- Pauses when scrolled out of view or the tab is hidden; a pause/play button is always available.
- Reduced motion (system setting or SmartPark's own setting): the video starts paused on the poster and animations are off.

Note: the clip supplied is a black-and-white illustrated drift scene on a city highway, not a hypercar in a garage. It is used as provided; replacing the file at the same path is all that's needed to swap it.

## Routing

SmartPark has no URL router; the app decides what to show from the session. The landing page plugs into that the smallest possible way:

- Signed-out visitor → landing page. Signed-in user → existing dashboard, exactly as before.
- **Login** → the existing sign-in screen on its login view (`/#signin`).
- **Get started** → the same existing screen on its registration view (`/#signup`).
- The browser Back button returns to the landing page, and `/#signin` / `/#signup` can be bookmarked or linked.
- Email verification and password-reset links (`?verify=` / `?reset=`) skip the landing page and go straight to the existing screen, as before.
- After signing in the user lands on the same dashboard as today; after signing out they see the existing sign-in screen (as before), not the landing page.
- Home / About / Features / How it works / Contact scroll to their sections and move keyboard focus there.

**Get started and registration:** login and registration are one existing component (`AuthPage`) that always opened on its login view. With your approval it gained one optional prop, `initialMode` (default `'login'`), so Get started can open it on registration. Its forms, layout, styles and authentication logic are unchanged, and without the prop it behaves exactly as before.

## Files

Added:

| File | Purpose |
|---|---|
| `apps/web/src/components/landing/LandingPage.jsx` | The landing page. |
| `apps/web/src/components/landing/LandingPage.css` | Its styles; every rule is scoped under `.slp`. |
| `apps/web/public/videos/smartpark-hero.mp4` | Your video. |
| `apps/web/public/assets/landing/hero-poster.jpg`, `drift-front.jpg` | Poster and still frames taken from the video. |
| `apps/web/src/locales/{hi,kn,te,es,fr,ja}/part-12.tsv` | Landing-page text in Hindi, Kannada, Telugu, Spanish, French and Japanese. |
| `LANDING_PAGE.md` | This document. |

Modified:

| File | Change | Why |
|---|---|---|
| `apps/web/src/App.jsx` | About 30 lines: lazy import of the landing page, one `showLanding` state, a Back-button listener, one render line before the existing `AuthPage` line, and `initialMode` passed to `AuthPage`. | Make the landing page the public entry point. Nothing else in the file changed. |
| `apps/web/src/components/AuthPage.jsx` | 2 lines: optional `initialMode` prop (default `'login'`) used as the starting view. Approved separately. | Let Get started open the existing registration view. |
| `apps/web/src/components/AuthPage.jsx` (follow-up) | Optional `onBrandClick` prop: when given, the SmartPark logo on the sign-in screen links back to the landing page. | Requested. |
| `apps/web/src/scenes.css` | Language picker on the sign-in screen: the select now fills the whole pill (click the globe, text or arrow) and its dropdown follows the light/dark theme; style for the logo link. | Requested. |
| `apps/web/index.html` | Open Graph / Twitter meta tags. | Link previews and SEO (crawlers don't run JavaScript). |
| `apps/web/src/locales/keys.tsv`, `source-strings.json` | Regenerated. | Register the new text for translation. |

Not modified: dashboards, admin, every other page, global CSS, backend, database, APIs, `package.json`.

## Test results (executed)

Local dev server and API with the demo data, built-in browser.

- Opening `/` signed out shows the landing page; both videos play (muted, looping, inline) and report 720×1280. ✅
- Live count matches the API (8 free spaces, 1 facility). ✅
- Login opens the existing login view at `/#signin`; Get started opens the existing registration view at `/#signup` (name, email, phone, password, Create account); Back returns to the landing page from both; loading either URL directly opens the right view; switching between Sign in and Create account still works. ✅
- Signing in with a local test account → same dashboard as before ("Good evening, …"), `#signin` removed from the URL. ✅
- Sign out → existing sign-in screen; `/api/bookings/mine` returns 401 when signed out (auth guard intact). ✅
- Signed in, `/` goes straight to the dashboard (no landing page). ✅
- Existing pages Find parking and My bookings open without errors; `/api/health`, `/api/parking/overview`, `/api/parking/lots`, `/api/bookings/mine`, `/api/notifications/mine`, `/api/parking/map/locations` return 200. ✅
- Layout checked at 1440, 1280, 1024 and 390 px; no horizontal scrolling on phones; the phone menu opens, closes on Escape and returns focus; section links scroll and move focus. ✅
- Reduced motion: video starts paused, no animations, play button works. ✅
- Kannada: landing text translated. ✅
- All 200 CSS selectors of the landing stylesheet are scoped to `.slp`. ✅
- `npm run build` ✅ (landing page in its own ~6 KB JS + 5 KB CSS gzipped chunk, plus the video, loaded only for signed-out visitors).
- Impeccable design detector: no findings. ✅
- `npm run test:api`: 108/110 — the same 2 failures as before this change (a test expecting `sp-theme-toggle` in `App.jsx` and a test importing a missing top-level `scripts/` folder).

Not tested: the admin dashboard (the local test account is a driver, and its role was not changed); real iPhone/Android devices (phone sizes were emulated in a desktop browser).

## Languages (follow-up)

Spanish (Español), French (Français) and Japanese (日本語) were added alongside English, Hindi, Kannada and Telugu, for the whole app including this landing page.

- Registered in `apps/web/src/i18n.js` (picker list), `apps/web/src/i18n/runtime.js` (loaders, date locales `es-ES`, `fr-FR`, `ja-JP`) and `apps/web/scripts/build-locales.mjs`.
- Translations: `apps/web/src/locales/{es,fr,ja}/part-01…13.tsv`, compiled to `es.json`, `fr.json`, `ja.json` (each loaded only when chosen, ~62–65 KB gzipped).
- 2,269 of 2,287 interface strings per language, 0 placeholder mismatches. The 18 left in English are brand names, promo codes, sample charger IDs and technical strings (URLs, SQL, file names). Facility names, addresses and other user data stay as entered.
- Japanese sentences end with 。／？／！ (the runtime already did the same with । for Hindi).
- The landing page feature and the Settings footnote now list seven languages; the new strings are also translated into Hindi, Kannada and Telugu.
- Translations were written for this project, not by a professional translator; a native-speaker review is recommended before launch.
