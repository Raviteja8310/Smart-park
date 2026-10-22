# Phase 15 — Final Deployment & Launch Verification

Phase 15 is the release-candidate stage. It does not claim public-production certification unless the environment-specific checks below have been completed and recorded by the operator.

## Automated release audit

Run from the project root:

```powershell
npm run release:audit
```

The audit checks required source/deployment files, Node.js version, required npm commands, contiguous SQL migrations and migration baseline version, `.gitignore` rules, source artifact hygiene, high-confidence secret patterns, lockfile presence, and whether frontend build/container tools are available. It never prints secret values. Warnings mean the audit could not verify a requirement in the current working environment; resolve or explicitly accept each warning before launch.

Then run the full release pipeline with a running API and migrated MySQL database:

```powershell
npm install
npm run check:syntax
npm run test:all
npm run build
npm run test:integration
```

The single command `npm run verify:release` runs the static audit, deterministic tests, frontend production build, and live HTTP smoke tests in sequence. It stops if a required command fails.

## Verification performed for this package

- API tests and source-contract tests: 99 passed after adding the Phase 15 audit contract checks.
- Python vision tests: 14 passed.
- SQL migrations: 001–012 are contiguous and the migration-runner baseline validates through version 12.
- Source syntax: all frontend JS/JSX/TS/TSX files and API/script JS files pass syntax checks using the available TypeScript compiler and Node.js parser.
- `npm install` was attempted, but registry access timed out in this environment; no root lockfile could be generated and Vite is unavailable.
- The `npm run build` command was attempted and failed because `vite` was not installed (`vite: not found`).
- Docker CLI and MySQL CLI are not installed in this environment, so container builds/startup, live database migrations, API-to-DB integration and TLS were not tested.

These are explicit limitations, not passes. The generated ZIP must be installed and verified on the development machine or staging server. A timestamped summary of checks is retained in `docs/release-evidence/phase15-static-checks.md`.

## Required go/no-go evidence

Before public launch, record pass/fail outcomes for every mandatory item in `docs/release-checklist.md`. At minimum:

1. On a network-enabled machine run `npm install`, retain the generated root `package-lock.json`, and verify a clean `npm ci` install.
2. Run `npm run release:audit`, `npm run test:all`, `npm run build`, and `npm run test:integration` with the API and a migrated, disposable MySQL database.
3. Build and start the production Compose stack; verify health checks, HTTPS and redirect, private database networking, persistent volumes, least-privilege containers and log redaction.
4. Test registration/verification, role and facility isolation, booking concurrency, Razorpay test-mode checkout/webhooks, QR replay/expiry, entry/exit, email outbox retry, refunds and payouts, and saved/review ownership rules.
5. Test backup restore, rollback, monitoring/alerts, and camera acceptance at the intended site, including darkness, glare, occlusion, camera outage and manual correction.
6. Review legal/privacy and CCTV requirements applicable to the operating location.

## Security note

Do not add `.env`, provider credentials, database dumps, private keys, user-uploaded photos or model weights to the ZIP or source-control repository. `.env.example` is the only environment template that should be committed. Generate the dependency lockfile using npm on a machine that can reach the configured registry; do not create it manually.

## Release status

This archive is a **release candidate**, not a production-certified service, until environment-specific evidence exists. Do not open public booking or real payment traffic while a critical checklist item is incomplete.
