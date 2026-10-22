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
  ['/api/parking', 'parkingRouter', 'parking.routes.js'],
  ['/api/bookings', 'bookingsRouter', 'bookings.routes.js'],
  ['/api/payments', 'paymentsRouter', 'payments.routes.js'],
  ['/api/gate', 'gateRouter', 'gate.routes.js'],
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
    readText('docs/integration-testing.md')
  ]);
  assert.equal(pkg.scripts['test:integration'], 'node scripts/integration-smoke.mjs');
  assert.ok(pkg.scripts['verify:release'], 'verify:release command is required');
  assert.ok(docs.includes('SMARTPARK_API_URL'));
  assert.ok(docs.includes('SMARTPARK_SMOKE_EMAIL'));
  assert.ok(docs.includes('npm run test:integration'));
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
