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
