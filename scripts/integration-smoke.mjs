#!/usr/bin/env node
/**
 * Safe, read-mostly HTTP smoke checks for a running SmartPark API.
 * This script does not create bookings, initiate payments, or change facility data.
 * Optional sign-in checks create and revoke one temporary session for a verified test account.
 */
import assert from 'node:assert/strict';

const baseUrl = new URL(process.env.SMARTPARK_API_URL || 'http://127.0.0.1:4000');
const timeoutMs = Number(process.env.SMARTPARK_SMOKE_TIMEOUT_MS || 8000);
const email = process.env.SMARTPARK_SMOKE_EMAIL || '';
const password = process.env.SMARTPARK_SMOKE_PASSWORD || '';
const checks = [];
let failures = 0;

function logLine(status, message) {
  console.log(`${status} ${message}`);
}

async function request(path, init = {}) {
  const url = new URL(path, baseUrl);
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...(init.headers || {})
    }
  });
  const text = await response.text();
  let body = null;
  if (text) {
    try { body = JSON.parse(text); } catch { body = text; }
  }
  return { response, body };
}

async function check(name, fn) {
  try {
    await fn();
    checks.push({ name, passed: true });
    logLine('PASS', name);
  } catch (error) {
    failures += 1;
    checks.push({ name, passed: false, error: error?.message || String(error) });
    logLine('FAIL', `${name} — ${error?.message || String(error)}`);
  }
}

function expectJson({ response, body }, expectedStatus, label) {
  assert.equal(response.status, expectedStatus, `${label}: expected HTTP ${expectedStatus}, received ${response.status}`);
  assert.ok(body && typeof body === 'object' && !Array.isArray(body), `${label}: response must be a JSON object`);
  return body;
}

console.log(`SmartPark integration smoke checks against ${baseUrl.origin}`);
console.log('No booking, payment, refund, payout, or camera write operation is performed.');

let apiHealth = false;
await check('API root returns the SmartPark API identity', async () => {
  const result = await request('/');
  const body = expectJson(result, 200, 'API root');
  assert.equal(body.name, 'SmartPark API');
  assert.equal(result.response.headers.get('x-powered-by'), null, 'Express signature must be disabled');
  assert.equal(result.response.headers.get('x-content-type-options'), 'nosniff');
});

await check('database health endpoint reports connected', async () => {
  const result = await request('/api/health');
  const body = expectJson(result, 200, 'Health endpoint');
  assert.equal(body.status, 'ok');
  assert.equal(body.database, 'connected');
  assert.ok(typeof body.timestamp === 'string' && Number.isFinite(Date.parse(body.timestamp)));
  apiHealth = true;
});

await check('public parking discovery returns a typed collection', async () => {
  const body = expectJson(await request('/api/parking/lots?limit=1'), 200, 'Parking discovery');
  assert.ok(Array.isArray(body.lots), 'lots must be an array');
  assert.ok(Number.isInteger(body.count) && body.count >= 0, 'count must be a non-negative integer');
  assert.ok(body.lots.length <= 1, 'limit=1 must be honored');
});

await check('public overview contains non-negative inventory counts', async () => {
  const result = await request('/api/parking/overview');
  const body = expectJson(result, 200, 'Parking overview');
  const overview = body.overview;
  assert.ok(overview && typeof overview === 'object', 'overview object is missing');
  for (const key of ['activeLots', 'totalSpaces', 'availableNow', 'occupiedNow', 'unknownSpaces', 'reservedNow', 'openSpaces']) {
    assert.ok(Number.isInteger(overview[key]) && overview[key] >= 0, `${key} must be a non-negative integer`);
  }
  assert.ok(overview.availableNow <= overview.openSpaces, 'available spaces cannot exceed open spaces');
  assert.ok(overview.openSpaces <= overview.totalSpaces, 'open spaces cannot exceed total inventory');
  assert.ok(Array.isArray(body.featuredLots), 'featuredLots must be an array');
});

await check('invalid login payload fails validation without exposing internal errors', async () => {
  const result = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({}) });
  const body = expectJson(result, 400, 'Invalid login');
  assert.equal(body.error?.code, 'VALIDATION_ERROR');
  assert.ok(typeof body.error?.message === 'string');
  assert.equal(String(body.error.message).includes('ER_'), false, 'database error codes must not be exposed');
});

await check('unexpected browser origin is rejected by CSRF origin guard', async () => {
  const result = await request('/api/auth/login', {
    method: 'POST',
    headers: { origin: 'https://smoke-test.invalid' },
    body: JSON.stringify({})
  });
  const body = expectJson(result, 403, 'Origin guard');
  assert.equal(body.error?.code, 'ORIGIN_NOT_ALLOWED');
});

for (const path of [
  '/api/auth/me',
  '/api/bookings/mine',
  '/api/vehicles/mine',
  '/api/notifications/mine',
  '/api/payments/mine',
  '/api/financial/refunds/mine',
  '/api/engagement/favorites',
  '/api/engagement/search-history',
  '/api/engagement/my-reviews',
  '/api/operations/summary'
]) {
  await check(`protected route rejects anonymous access: ${path}`, async () => {
    const result = await request(path);
    const body = expectJson(result, 401, path);
    assert.ok(['AUTH_REQUIRED', 'SESSION_INVALID'].includes(body.error?.code), `${path}: expected an authentication error`);
  });
}

await check('unknown API routes return a consistent JSON 404', async () => {
  const result = await request('/api/__smartpark_smoke_route_that_does_not_exist__');
  const body = expectJson(result, 404, 'Unknown route');
  assert.equal(body.error?.code, 'NOT_FOUND');
});

if (Boolean(email) !== Boolean(password)) {
  failures += 1;
  logLine('FAIL', 'Optional authenticated checks require both SMARTPARK_SMOKE_EMAIL and SMARTPARK_SMOKE_PASSWORD.');
} else if (!email) {
  logLine('SKIP', 'Authenticated MySQL/API collection checks (set SMARTPARK_SMOKE_EMAIL and SMARTPARK_SMOKE_PASSWORD to enable).');
} else {
  let cookie = '';
  let signedIn = false;
  await check('test account can sign in and receive an HttpOnly session cookie', async () => {
    const result = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
    const body = expectJson(result, 200, 'Test account login');
    assert.ok(body.user?.id, 'user id is missing');
    assert.ok(Array.isArray(body.user.roles), 'roles must be an array');
    const cookieHeaders = result.response.headers.getSetCookie?.() ?? [result.response.headers.get('set-cookie') ?? ''];
    const session = cookieHeaders.map((item) => item.split(';', 1)[0]).find((item) => item.startsWith('sp_session='));
    assert.ok(session && session.length > 'sp_session='.length + 20, 'session cookie was not returned');
    const setCookieHeader = cookieHeaders.find((item) => item.startsWith('sp_session=')) || '';
    assert.match(setCookieHeader, /HttpOnly/i, 'session cookie must be HttpOnly');
    assert.match(setCookieHeader, /SameSite=Strict/i, 'session cookie must use SameSite=Strict');
    cookie = session;
    signedIn = true;
  });

  if (signedIn) {
    await check('current-session endpoint returns the signed-in account', async () => {
      const body = expectJson(await request('/api/auth/me', { headers: { cookie } }), 200, 'Current session');
      assert.ok(body.user?.id);
      assert.ok(Array.isArray(body.user?.roles));
    });

    const signedInCollections = [
      ['/api/bookings/mine?limit=5', 'bookings'],
      ['/api/vehicles/mine', 'vehicles'],
      ['/api/notifications/mine', 'notifications'],
      ['/api/payments/mine', 'payments'],
      ['/api/financial/refunds/mine', 'refunds'],
      ['/api/engagement/favorites', 'favorites'],
      ['/api/engagement/search-history?limit=5', 'searches'],
      ['/api/engagement/my-reviews?limit=5', 'reviews']
    ];
    for (const [path, key] of signedInCollections) {
      await check(`authenticated collection is queryable: ${path}`, async () => {
        const body = expectJson(await request(path, { headers: { cookie } }), 200, path);
        assert.ok(Array.isArray(body[key]), `${path}: ${key} must be an array`);
      });
    }

    await check('logout revokes the smoke-test session', async () => {
      const result = await request('/api/auth/logout', { method: 'POST', headers: { cookie } });
      expectJson(result, 200, 'Logout');
      const afterLogout = await request('/api/auth/me', { headers: { cookie } });
      const body = expectJson(afterLogout, 401, 'Session after logout');
      assert.ok(['AUTH_REQUIRED', 'SESSION_INVALID'].includes(body.error?.code));
    });
  }
}

console.log(`\nResult: ${checks.filter((item) => item.passed).length} passed, ${failures} failed${apiHealth ? '' : ' (health check did not pass; database-backed assertions may be blocked)'}.`);
if (failures) process.exitCode = 1;
