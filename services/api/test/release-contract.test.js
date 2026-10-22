import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const testDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(testDir, '../../..');
const readText = (relativePath) => readFile(join(projectRoot, relativePath), 'utf8');

const routerMounts = [
  ['/api/health', 'healthRouter', 'health.routes.js'],
  ['/api/auth', 'authRouter', 'auth.routes.js'],
  ['/api/users', 'adminUsersRouter', 'admin-users.routes.js'],
  ['/api/owner-verification', 'ownerVerificationRouter', 'owner-verification.routes.js'],
  ['/api/promotions', 'promotionsRouter', 'promotions.routes.js'],
  ['/api/referrals', 'referralsRouter', 'referrals.routes.js'],
  ['/api/subscriptions', 'subscriptionsRouter', 'subscriptions.routes.js'],
  ['/api/enterprise', 'enterpriseRouter', 'enterprise.routes.js'],
  ['/api/charging', 'chargingRouter', 'charging.routes.js'],
  ['/api/parking', 'parkingRouter', 'parking.routes.js'],
  ['/api/bookings', 'bookingsRouter', 'bookings.routes.js'],
  ['/api/payments', 'paymentsRouter', 'payments.routes.js'],
  ['/api/gate', 'gateRouter', 'gate.routes.js'],
  ['/api/gate-hardware', 'gateHardwareRouter', 'gate-hardware.routes.js'],
  ['/api/support', 'supportRouter', 'support.routes.js'],
  ['/api/marketplace', 'marketplaceRouter', 'marketplace.routes.js'],
  ['/api/vehicles', 'vehiclesRouter', 'vehicles.routes.js'],
  ['/api/vision', 'visionRouter', 'vision.routes.js'],
  ['/api/operations', 'operationsRouter', 'operations.routes.js'],
  ['/api/notifications', 'notificationsRouter', 'notifications.routes.js'],
  ['/api/financial', 'financialRouter', 'financial.routes.js'],
  ['/api/engagement', 'engagementRouter', 'engagement.routes.js']
];

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}


function routesCouldMatch(frontendPath, backendPath) {
  const client = frontendPath.replace(/\/$/, '').split('/').filter(Boolean);
  const server = backendPath.replace(/\/$/, '').split('/').filter(Boolean);
  if (client.length !== server.length) return false;
  return client.every((segment, index) => segment === 'SP_DYNAMIC' || server[index].startsWith(':') || segment === server[index]);
}

function methodFromCall(source, matchEnd) {
  const trailing = source.slice(matchEnd, matchEnd + 260);
  const option = trailing.match(/^\s*,\s*\{[\s\S]{0,220}?\bmethod\s*:\s*(['"])(GET|POST|PUT|PATCH|DELETE)\1/i);
  return option?.[2]?.toUpperCase() ?? 'GET';
}

async function routeCatalog() {
  const catalog = [];
  for (const [prefix, _alias, filename] of routerMounts) {
    const source = await readText(`services/api/src/routes/${filename}`);
    const pattern = /router\.(get|post|put|patch|delete)\(\s*(['"])(.*?)\2/gi;
    for (const match of source.matchAll(pattern)) {
      const localPath = match[3];
      const fullPath = `${prefix}${localPath === '/' ? '/' : localPath}`.replace(/\/$/, '') || '/';
      catalog.push({ method: match[1].toUpperCase(), path: fullPath, source: filename });
    }
  }
  return catalog;
}

test('all critical API routers remain mounted at their documented prefixes', async () => {
  const source = await readText('services/api/src/app.js');
  for (const [prefix, alias] of routerMounts) {
    assert.match(source, new RegExp(`app\\.use\\(['"]${escapeRegex(prefix)}['"],\\s*${alias}\\)`), `${prefix} must be mounted`);
  }
});

test('Razorpay webhook raw body parser is registered before JSON parsing', async () => {
  const source = await readText('services/api/src/app.js');
  const webhookIndex = source.indexOf("app.post('/api/payments/webhook/razorpay'");
  const jsonIndex = source.indexOf('app.use(express.json');
  assert.ok(webhookIndex >= 0, 'Razorpay webhook route is missing');
  assert.ok(jsonIndex > webhookIndex, 'JSON parser must not consume the signed webhook body first');
});

test('every literal frontend API call matches a declared backend route method and path', async () => {
  const routes = await routeCatalog();
  const webRoot = join(projectRoot, 'apps', 'web', 'src');
  const pending = [webRoot];
  const files = [];
  while (pending.length) {
    const item = pending.pop();
    const { readdir: readDir } = await import('node:fs/promises');
    for (const entry of await readDir(item, { withFileTypes: true })) {
      const fullPath = join(item, entry.name);
      if (entry.isDirectory()) pending.push(fullPath);
      else if (/\.(?:js|jsx|ts|tsx)$/.test(entry.name)) files.push(fullPath);
    }
  }

  const missing = [];
  for (const filename of files) {
    const source = await readFile(filename, 'utf8');
    const callPattern = /(?:apiRequest|fetch)\(\s*(['"`])((?:\/api\/)[\s\S]*?)\1/g;
    for (const match of source.matchAll(callPattern)) {
      const rawPath = match[2].split('?')[0].replace(/\$\{[^}]+\}/g, 'SP_DYNAMIC');
      const method = methodFromCall(source, match.index + match[0].length);
      const found = routes.some((route) => route.method === method && routesCouldMatch(rawPath, route.path));
      if (!found) missing.push(`${filename.replace(projectRoot + '/', '')}: ${method} ${rawPath}`);
    }
  }
  assert.deepEqual(missing, [], `Frontend calls without a matching backend route:\n${missing.join('\n')}`);
});

test('release smoke-check script and operator runbook are included', async () => {
  const [pkg, docs] = await Promise.all([
    readText('package.json').then(JSON.parse),
    readText('README.md')
  ]);
  assert.equal(pkg.scripts['test:integration'], 'node scripts/integration-smoke.mjs');
  assert.ok(pkg.scripts['verify:release'], 'verify:release command is required');
  assert.ok(docs.includes('SMARTPARK_API_URL'));
  assert.ok(docs.includes('SMARTPARK_SMOKE_EMAIL'));
  assert.ok(docs.includes('npm run test:integration'));
});

test('profile can enable facility-owner mode while retaining driver access and driver booking', async () => {
  const [usersRouter, profilePage, appSource, bookingPage, parkingRouter] = await Promise.all([
    readText('services/api/src/routes/admin-users.routes.js'),
    readText('apps/web/src/components/AccountPages.jsx'),
    readText('apps/web/src/App.jsx'),
    readText('apps/web/src/components/ParkingPage.jsx'),
    readText('services/api/src/routes/parking.routes.js')
  ]);
  assert.match(usersRouter, /router\.post\('\/me\/facility-owner'/);
  const enablement = usersRouter.split("router.post('/me/facility-owner'")[1]?.split("router.get('/',")[0] ?? '';
  assert.match(enablement, /role_key IN \('driver','host'\)/);
  assert.match(enablement, /user\.facility_owner_enabled/);
  assert.doesNotMatch(enablement, /DELETE FROM user_roles/);
  assert.match(profilePage, /Enable facility owner mode/);
  assert.match(profilePage, /Driver mode/);
  assert.match(profilePage, /Facility owner mode/);
  assert.match(profilePage, /Park a vehicle/);
  assert.match(appSource, /smartpark\.workspaceMode\.\$\{currentUser\.id\}/);
  assert.match(bookingPage, /RESERVE A SPACE/);
  assert.match(parkingRouter, /router\.get\('\/lots'/);
  assert.match(parkingRouter, /router\.post\('\/lots'/);
});

test('migration set is contiguous and migration runner baseline covers latest schema', async () => {
  const migrationDir = join(projectRoot, 'database', 'migrations');
  const names = (await readdir(migrationDir)).filter((name) => /^\d{3}_[a-z0-9_-]+\.sql$/i.test(name)).sort();
  assert.ok(names.length > 0);
  names.forEach((name, index) => assert.equal(Number(name.slice(0, 3)), index + 1, `migration sequence gap at ${name}`));
  assert.equal(names.at(-1).slice(0, 3), String(names.length).padStart(3, '0'));
  const runner = await readText('services/api/src/scripts/migrate.js');
  assert.match(runner, new RegExp(`version: ${names.length},`), 'baseline requirements should describe latest migration');
});

test('production Compose keeps MySQL private and requires production secrets', async () => {
  const compose = await readText('docker-compose.production.yml');
  const dbSection = compose.split(/^  db:\s*$/m)[1]?.split(/^  [a-zA-Z_-]+:\s*$/m)[0] ?? '';
  assert.ok(dbSection, 'production database service was not found');
  assert.doesNotMatch(dbSection, /^\s+ports:/m, 'production MySQL must not publish a host port');
  assert.match(compose, /QR_SIGNING_SECRET:\s*\$\{QR_SIGNING_SECRET:\?/, 'QR signing secret must be required');
  assert.match(compose, /RAZORPAY_WEBHOOK_SECRET:\s*\$\{RAZORPAY_WEBHOOK_SECRET:\?/, 'payment webhook secret must be required');
  assert.match(compose, /VISION_API_TOKEN:\s*\$\{VISION_API_TOKEN:\?/, 'vision service token must be required');
});


test('production email worker receives only database, site-origin and mail credentials', async () => {
  const compose = await readText('docker-compose.production.yml');
  const worker = compose.split(/^  email-worker:\s*$/m)[1]?.split(/^  [a-zA-Z_-]+:\s*$/m)[0] ?? '';
  assert.ok(worker, 'email-worker service must exist');
  assert.match(worker, /SMARTPARK_PROCESS:\s*email-worker/);
  assert.match(worker, /SMTP_PASSWORD:/);
  assert.doesNotMatch(worker, /RAZORPAY_|QR_SIGNING_SECRET|VISION_API_TOKEN|TRUST_PROXY_HOPS|PAYMENT_PROVIDER/);
  assert.match(worker, /^    read_only:\s*true$/m);
  assert.match(worker, /no-new-privileges:true/);
  assert.match(worker, /cap_drop:[\s\S]*?- ALL/);
});

test('production application containers have read-only root filesystems where supported', async () => {
  const compose = await readText('docker-compose.production.yml');
  const serviceBlock = (name, next) => compose.split(new RegExp(`^  ${name}:\\s*$`, 'm'))[1]?.split(new RegExp(`^  ${next}:\\s*$`, 'm'))[0] ?? '';
  const api = serviceBlock('api', 'email-worker');
  const web = serviceBlock('web', 'caddy');
  assert.match(api, /^    read_only:\s*true$/m);
  assert.match(api, /tmpfs:[\s\S]*?\/tmp/);
  assert.match(api, /no-new-privileges:true/);
  assert.match(web, /^    read_only:\s*true$/m);
  assert.match(web, /\/var\/cache\/nginx/);
});


test('production preflight checks placeholder credentials and cross-service secret reuse', async () => {
  const preflight = await readText('scripts/preflight-production.mjs');
  assert.match(preflight, /SMTP_PASSWORD.*RAZORPAY_KEY_SECRET.*RAZORPAY_WEBHOOK_SECRET/);
  assert.match(preflight, /uniqueSecrets/);
  assert.match(preflight, /must be different secrets/);
  assert.match(preflight, /No secret values were printed/);
});


test('release audit script is wired into the final verification command', async () => {
  const [pkg, audit, checklist] = await Promise.all([
    readText('package.json').then(JSON.parse),
    readText('scripts/release-audit.mjs'),
    readText('README.md')
  ]);
  assert.equal(pkg.scripts['release:audit'], 'node scripts/release-audit.mjs');
  assert.match(pkg.scripts['verify:release'], /release:audit/);
  assert.match(audit, /package-lock\.json is missing/);
  assert.match(audit, /No high-confidence private-key or live-token patterns/);
  assert.match(checklist, /Phase 15/);
});


import { collectReleaseAudit, migrationSequenceIssue } from '../../../scripts/release-audit.mjs';

test('final release audit has no structural failures in the project source', async () => {
  const report = await collectReleaseAudit(projectRoot, { dockerAvailable: false, lockfileExists: false, checkedAt: '2026-10-22T00:00:00.000Z' });
  assert.equal(report.summary.failures, 0, report.checks.filter((item) => item.status === 'FAIL').map((item) => item.detail).join('\n'));
  assert.ok(report.checks.some((item) => item.name === 'Dependency lockfile' && item.status === 'WARN'));
  assert.ok(report.checks.some((item) => item.name === 'Container runtime availability' && item.status === 'WARN'));
});

test('release audit detects migration numbering gaps', () => {
  assert.match(migrationSequenceIssue(['001_first.sql', '003_third.sql']), /sequence gap/i);
  assert.equal(migrationSequenceIssue(['001_first.sql', '002_second.sql']), null);
});

test('release audit rejects unsupported Node.js runtime versions', async () => {
  const report = await collectReleaseAudit(projectRoot, { nodeVersion: '18.0.0', dockerAvailable: false, lockfileExists: false });
  assert.equal(report.checks.find((item) => item.name === 'Node.js runtime')?.status, 'FAIL');
});


test('final release pipeline includes frontend/server source syntax checks', async () => {
  const [pkg, checker] = await Promise.all([
    readText('package.json').then(JSON.parse),
    readText('scripts/check-source-syntax.mjs')
  ]);
  assert.equal(pkg.scripts['check:syntax'], 'node scripts/check-source-syntax.mjs');
  assert.match(pkg.scripts['verify:release'], /check:syntax/);
  assert.match(checker, /transpileModule/);
  assert.match(checker, /node --check/);
});


test('owner marketplace supports scheduled pricing without replacing the currently effective rate', async () => {
  const [parkingRoutes, marketplaceRoutes, component, schema] = await Promise.all([
    readText('services/api/src/routes/parking.routes.js'),
    readText('services/api/src/routes/marketplace.routes.js'),
    readText('apps/web/src/components/MarketplacePage.jsx'),
    readText('database/migrations/001_initial_schema.sql')
  ]);
  assert.match(schema, /valid_from DATETIME NULL/);
  assert.match(schema, /valid_until DATETIME NULL/);
  assert.match(parkingRoutes, /validFrom: z\.string\(\)\.datetime/);
  assert.match(parkingRoutes, /validUntil: z\.string\(\)\.datetime/);
  assert.match(parkingRoutes, /PRICING_START_CONFLICT/);
  assert.match(parkingRoutes, /valid_from IS NULL OR valid_from <= UTC_TIMESTAMP\(\)/);
  assert.match(marketplaceRoutes, /validFrom: row\.valid_from/);
  assert.match(marketplaceRoutes, /validUntil: row\.valid_until/);
  assert.match(component, /Effective from \(optional\)/);
  assert.match(component, /Effective until \(optional\)/);
  assert.match(component, /pricingRuleStatus/);
});


test('parking discovery supports user-consented nearby sorting and map preview without a schema migration', async () => {
  const [component, docs, parkingRoutes] = await Promise.all([
    readText('apps/web/src/components/ParkingPage.jsx'),
    readText('README.md'),
    readText('services/api/src/routes/parking.routes.js')
  ]);
  assert.match(component, /navigator\.geolocation\.getCurrentPosition/);
  assert.match(component, /distanceKm/);
  assert.match(component, /Nearby only/);
  assert.match(component, /openstreetmap\.org\/export\/embed\.html/);
  assert.match(component, /Map/);
  assert.match(parkingRoutes, /l\.latitude, l\.longitude/);
  assert.match(docs, /No database migration or new API endpoint is required/);
  assert.match(docs, /straight-line distance/);
});

test('parking discovery supports parking routes, onward destination planning, and public arrival notes', async () => {
  const [component, docs] = await Promise.all([
    readText('apps/web/src/components/ParkingPage.jsx'),
    readText('README.md')
  ]);
  assert.match(component, /function directionsUrl/);
  assert.match(component, /Route to parking/);
  assert.match(component, /Destination after parking/);
  assert.match(component, /destinationTravelMode/);
  assert.match(component, /activeMapLot\.specialInstructions/);
  assert.match(docs, /No database migration or new API endpoint is required/);
  assert.match(docs, /Do not put gate PINs/);
});


test('referral programme attributes registrations and awards idempotent credits after verified paid completion', async () => {
  const [app, auth, referralRoutes, gate, migration, component, docs] = await Promise.all([
    readText('services/api/src/app.js'),
    readText('services/api/src/routes/auth.routes.js'),
    readText('services/api/src/routes/referrals.routes.js'),
    readText('services/api/src/routes/gate.routes.js'),
    readText('database/migrations/016_referral_program.sql'),
    readText('apps/web/src/components/ReferralsPage.jsx'),
    readText('README.md')
  ]);
  assert.match(app, /app\.use\('\/api\/referrals', referralsRouter\)/);
  assert.match(auth, /referralCode: z\.string/);
  assert.match(auth, /INSERT INTO referrals/);
  assert.match(referralRoutes, /verified_at IS NOT NULL/);
  assert.match(referralRoutes, /INSERT IGNORE INTO referral_rewards/);
  assert.match(gate, /qualifyReferralForCompletedBooking/);
  assert.match(migration, /UNIQUE KEY uq_referral_reward_beneficiary/);
  assert.match(component, /Refer & earn/);
  assert.match(docs, /not cash/);
});

test('EV inventory and ordinary-driver booking restrictions remain server-enforced', async () => {
  const [charging, bookings, payments, subscriptions, env, app, corporate, parking, auth] = await Promise.all([
    readText('services/api/src/routes/charging.routes.js'),
    readText('services/api/src/routes/bookings.routes.js'),
    readText('services/api/src/routes/payments.routes.js'),
    readText('services/api/src/routes/subscriptions.routes.js'),
    readText('services/api/src/config/env.js'),
    readText('apps/web/src/App.jsx'),
    readText('apps/web/src/components/CorporateEvPage.jsx'),
    readText('apps/web/src/components/ParkingPage.jsx'),
    readText('apps/web/src/components/AuthPage.jsx')
  ]);
  assert.match(charging, /router\.post\('\/',requireAuth,requireRole\('host','admin'\)/);
  assert.match(charging, /You can add chargers only to a facility you own/);
  assert.match(charging, /You cannot manage this charger/);
  assert.match(env, /ALLOW_DRIVER_BOOKINGS:.*default\('false'\)/);
  assert.match(bookings, /DRIVER_BOOKINGS_DISABLED/);
  assert.match(payments, /DRIVER_BOOKINGS_DISABLED/);
  assert.match(subscriptions, /DRIVER_BOOKINGS_DISABLED/);
  assert.match(app, /CorporateEvPage currentUser=\{currentUser\} workspaceMode=\{workspaceMode\}/);
  assert.match(corporate, /workspaceMode === 'facility_owner'/);
  assert.match(parking, /\/api\/bookings\/capabilities/);
  assert.doesNotMatch(app, /Refer & earn/);
  assert.doesNotMatch(auth, /Referral code/);
});
