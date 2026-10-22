# SmartPark changelog

## Phase 13 — Integration validation and release contracts

- Added a live HTTP smoke suite for the running API and migrated database.
- Added an optional verified-account check covering authenticated reads and session revocation after logout.
- Added route-contract tests that compare frontend API calls with the Express route definitions.
- Added API mount, webhook raw-body ordering, migration continuity/baseline, production network isolation and secret-configuration checks.
- Added a release verification command and expanded integration runbooks/checklists.
- No database schema migration was added in this phase.

## Validation performed in the artifact workspace

- 88 API tests passed, including six release-contract tests.
- 14 Python vision tests passed.
- Node syntax checks passed for the integration smoke script and API source/tests.
- Python compile check passed.
- All supplied Docker Compose YAML files parsed successfully.

## Known verification limits

The npm registry was unavailable (`EAI_AGAIN`), so dependencies could not be installed and no `package-lock.json` could be generated in this workspace. The Vite build and live MySQL-backed smoke tests were therefore not run here. They must be run on the development machine or staging environment after installing dependencies and starting the migrated database/API. Payment-provider, SMTP, HTTPS, camera accuracy and gate hardware tests remain environment-specific.
