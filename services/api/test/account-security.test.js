import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const testDir = dirname(fileURLToPath(import.meta.url));
const root = resolve(testDir, '../../..');
const read = (name) => readFile(join(root, name), 'utf8');

test('password recovery uses a short-lived email OTP with attempt tracking', async () => {
  const [auth, mailer, migration, runner] = await Promise.all([
    read('services/api/src/routes/auth.routes.js'),
    read('services/api/src/services/mailer.js'),
    read('database/migrations/020_password_reset_otp.sql'),
    read('services/api/src/scripts/migrate.js')
  ]);
  assert.match(auth, /PASSWORD_RESET_OTP_TTL_MS\s*=\s*10\s*\*\s*60\s*\*\s*1000/);
  assert.match(auth, /MAX_PASSWORD_RESET_OTP_ATTEMPTS\s*=\s*5/);
  assert.match(auth, /hashOpaqueToken\(`\$\{userId\}:\$\{otp\}`\)/);
  assert.match(auth, /attempt_count = \?/);
  assert.match(auth, /router\.post\('\/forgot-password'/);
  assert.match(auth, /router\.post\('\/reset-password'/);
  assert.match(mailer, /sendPasswordResetOtpEmail/);
  assert.match(mailer, /Password reset code: \$\{otp\}/);
  assert.match(migration, /ADD COLUMN attempt_count TINYINT UNSIGNED NOT NULL DEFAULT 0/);
  assert.match(runner, /version: 20, columns: \[\{ table: 'password_reset_tokens', column: 'attempt_count' \}\]/);
});

test('signed-in password change verifies current password and revokes other sessions', async () => {
  const auth = await read('services/api/src/routes/auth.routes.js');
  assert.match(auth, /router\.post\('\/change-password', changePasswordLimiter, requireAuth/);
  assert.match(auth, /verifyPassword\(parsed\.data\.currentPassword, users\[0\]\.password_hash\)/);
  assert.match(auth, /DELETE FROM user_sessions WHERE user_id = \? AND id <> \?/);
  assert.match(auth, /auth\.password_changed/);
});

test('password change is located on profile; forgot password uses the email-code flow', async () => {
  const [profile, authPage, settings] = await Promise.all([
    read('apps/web/src/components/AccountPages.jsx'),
    read('apps/web/src/components/AuthPage.jsx'),
    read('apps/web/src/App.jsx')
  ]);
  assert.match(profile, /Change password/);
  assert.match(profile, /\/api\/auth\/change-password/);
  assert.match(profile, /forgot your current password/i);
  assert.match(authPage, /Six-digit email code/);
  assert.match(authPage, /autoComplete="one-time-code"/);
  assert.match(authPage, /\/api\/auth\/forgot-password/);
  assert.match(settings, /sp-theme-toggle/);
  assert.match(profile, /sp-theme-option/);
  assert.match(profile, /Restore defaults/);
  assert.match(profile, /Export/);
});
