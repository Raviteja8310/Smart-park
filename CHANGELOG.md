# Changelog

## Profile update — Driver and Facility Owner workspace switching
- Added a self-service profile action that enables facility-owner capability while preserving the Driver role.
- Added a per-account Driver / Facility Owner workspace switch in My profile; switching to Driver mode hides owner navigation without deleting facilities, bookings, or host capability.
- Added direct profile actions to manage facilities and pricing or find parking to book a vehicle, including eligible spaces at the owner's own active facility.
- Kept listing drafts behind the existing administrator review workflow and audit-logged owner-mode enablement.
- No database migration required; this reuses the existing roles, facility, pricing, vehicle and booking schema.
- Validation: source syntax checks passed, all 125 API tests passed, release audit reported 0 failures. Frontend build and live database/payment flows require environment verification because Vite and Docker are unavailable here.

## 2.4.0 — Phase 15 release-candidate gate
- Added `npm run release:audit` to check required project files, package scripts, migration continuity and baseline version, `.gitignore` hygiene, high-confidence secret patterns, dependency lockfile availability and local build/container tooling.
- Updated `npm run verify:release` to run the release audit before the deterministic test suite, production frontend build and live HTTP smoke checks.
- Added final launch-gate documentation with explicit environment-specific go/no-go evidence requirements.
- Release status remains candidate-only until the generated lockfile, clean install/build, MySQL integration, payment/email, HTTPS, backup/restore, and onsite camera/gate checks pass.

# SmartPark changelog

## Phase 14 — Production least-privilege hardening

- Scoped production environment validation by process role: API validates payment/QR/vision settings; the email worker validates only the database, site origin and SMTP settings it actually needs.
- Removed payment provider credentials, webhook secret, QR signing secret, vision token and proxy-trust configuration from the email-worker container environment.
- Added read-only root filesystems, bounded temporary writable mounts, `no-new-privileges`, dropped Linux capabilities where supported, and PID/memory limits for production application containers.
- Extended automated contract tests to prevent unnecessary secrets from returning to the mail worker and to protect the hardened container settings.
- Added a dedicated production-security guide, updated release/deployment docs, and documented the remaining host/image/dependency scanning requirements.
- No database schema migration was added in this phase.

## Validation performed in the artifact workspace

- 92 API tests passed, including service-specific production config and Compose least-privilege tests.
- 14 Python vision tests passed.
- JavaScript syntax checks passed for API source and tests.
- Python compile checks passed.
- Compose YAML parsed successfully using the available YAML parser.
- Full frontend build, container start, live MySQL workflow, SMTP and payment-provider connectivity were not verified because frontend dependencies, Docker and MySQL are not available in this environment.

## Known verification limits

A generated `package-lock.json` is still not present; run `npm install` on the development/staging machine with registry access and retain the lockfile. Then run `npm run build`, the complete test suite, production Compose config/image build, database migration tests, and external provider/camera checks before launch.

## Earlier phases

- Phases 1–13: refer to the README, `docs/next-steps.md`, `docs/release-checklist.md`, and individual phase notes for the implemented foundations and known limits.


## Phase 8 — Referral programme

- Added unique personal referral codes and optional signup attribution.
- Added the **Refer & earn** dashboard with referral status, personal link, counts and credit ledger.
- Qualification occurs only after a gate-recorded completed session and verified paid payment; unique constraints prevent duplicate referral rewards.
- Added migration `016_referral_program.sql` and migration-baseline coverage.
- Referral credits are internal ledger entries only; cash payout and booking redemption are not implemented.

## Remaining roadmap integration (Phases 14–17)

- Added an operations monitoring worker for booking overstays, incident alerts and expiry of queued gate commands. No automatic overstay charge is applied.
- Added gate-controller and short-lived command APIs with a token-protected edge-adapter interface, operational failure alerts and a management workspace.
- Added historical booking-demand outlook to Operations; it is clearly labeled as a planning baseline rather than AI or sensor-based occupancy prediction.
- Added scoped support tickets, staff responses/internal notes and ticket status updates.
- Added explicit SMS notification consent/preferences, Twilio outbox delivery with bounded retries, and production Compose worker services.
- Added migration `021_remaining_phases.sql` and expanded release-contract coverage.
- Documented external prerequisites and outstanding release checks. Automatic provider refunds, bank payouts, full browser push, physical gate control and real camera integrations remain deployment/provider integration tasks.
