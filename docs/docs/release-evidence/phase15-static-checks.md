# Phase 15 static verification evidence

**Check date:** 2026-10-22  
**Project package:** SmartPark 2.4.0  
**Classification:** Release candidate only — not production certified

## Checks executed in the artifact-generation environment

| Check | Result | Evidence / limitation |
|---|---|---|
| API unit + source-contract suite | PASS | 99 tests passed with `npm run test:api` / `npm run test:all`. |
| Python vision unit suite | PASS | 14 tests passed. |
| Frontend source syntax | PASS | 15 JS/JSX/TS/TSX files transpiled with TypeScript compiler API; no syntax errors. |
| API and script syntax | PASS | 61 JS/MJS/CJS files passed `node --check`. |
| Python source compilation | PASS | `compileall` succeeded for vision source and tests. |
| Compose YAML parse | PASS | `docker-compose.yml`, `docker-compose.production.yml`, and `docker-compose.vision.yml` parsed with PyYAML and contain service maps. This is syntax validation only. |
| Numbered SQL migrations | PASS | 001–012 are contiguous; migration-runner baseline validates through version 12. This does not prove SQL executes successfully against MySQL. |
| Static release audit | PASS WITH WARNINGS | 6 pass, 3 warnings, 0 failures at check time. |
| npm dependency installation | BLOCKED | Attempted `npm install --no-audit --no-fund`; command timed out while attempting dependency installation. |
| Dependency lockfile | NOT AVAILABLE | No root `package-lock.json` could be generated in this environment. Generate it via npm on a network-enabled machine; do not manufacture one manually. |
| Vite production build | NOT RUN SUCCESSFULLY | `npm run build` failed because `vite` was not installed (`vite: not found`). |
| Docker image build/startup | NOT RUN | Docker CLI is not installed in this environment. |
| MySQL migration / API integration | NOT RUN | MySQL CLI and a running MySQL 8 instance are unavailable here. |
| Payment / SMTP / HTTPS / backup-restore | NOT RUN | These require provider and deployment credentials/services. |
| Camera inference and gate hardware | NOT RUN | Requires the target camera, a calibrated parking layout and physical gate integration. |

## Repeatable commands for the development/staging machine

From the project root, after configuring `.env` and ensuring registry access:

```powershell
npm install
npm run release:audit
npm run check:syntax
npm run test:all
npm run build
npm run test:integration
```

`npm install` should generate `package-lock.json`. Keep it under source control and verify a clean installation with `npm ci` before production deployment. Run live integration tests only against a disposable/staging MySQL database, never against live bookings or real-money production transactions.

## Decision

**NO-GO for public production until the blockers above are resolved and all mandatory items in `docs/release-checklist.md` are recorded as PASS by the deployment owner.** Static/helper tests do not replace live database/provider/onsite validation.
