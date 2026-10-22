import test from 'node:test';
import assert from 'node:assert/strict';
import { productionConfigIssues } from '../src/config/production-rules.js';

const validProduction = {
  NODE_ENV: 'production',
  SMARTPARK_PROCESS: 'api',
  WEB_ORIGIN: 'https://smartpark-release.net',
  DB_PASSWORD: 'S8j!a2vN#71_xP0lQ3fB9zTx',
  SMTP_HOST: 'smtp.smartpark-release.net',
  SMTP_USER: 'smartpark-smtp-user',
  SMTP_PASSWORD: 'smtp-secret-with-unique-randomness',
  MAIL_FROM: 'SmartPark <no-reply@smartpark-release.net>',
  PAYMENT_PROVIDER: 'razorpay',
  RAZORPAY_KEY_ID: 'rzp_live_abc',
  RAZORPAY_KEY_SECRET: 'razorpay-secret-value',
  RAZORPAY_WEBHOOK_SECRET: 'webhook-secret-value',
  QR_SIGNING_SECRET: 'Q'.repeat(48),
  VISION_API_TOKEN: 'V'.repeat(48)
};

test('accepts a fully configured HTTPS production environment', () => {
  assert.deepEqual(productionConfigIssues(validProduction), []);
});

test('rejects HTTP/local origins and placeholder credentials', () => {
  const issues = productionConfigIssues({
    ...validProduction,
    WEB_ORIGIN: 'http://localhost:5173',
    DB_PASSWORD: 'change_this_local_password',
    MAIL_FROM: 'SmartPark <no-reply@smartpark.local>',
    QR_SIGNING_SECRET: 'local-development-only-smartpark-qr-secret-change-before-deployment',
    VISION_API_TOKEN: 'replace-with-a-unique-random-secret-at-least-32-characters'
  });
  const paths = issues.map((issue) => issue.path);
  assert.ok(paths.includes('WEB_ORIGIN'));
  assert.ok(paths.includes('DB_PASSWORD'));
  assert.ok(paths.includes('MAIL_FROM'));
  assert.ok(paths.includes('QR_SIGNING_SECRET'));
  assert.ok(paths.includes('VISION_API_TOKEN'));
});

test('requires SMTP and provider webhook configuration in production', () => {
  const issues = productionConfigIssues({ ...validProduction, SMTP_HOST: '', RAZORPAY_WEBHOOK_SECRET: '' });
  assert.ok(issues.some((issue) => issue.path === 'SMTP_HOST'));
  assert.ok(issues.some((issue) => issue.path === 'RAZORPAY_WEBHOOK_SECRET'));
});

test('rejects example/test-only production hostnames', () => {
  const issues = productionConfigIssues({ ...validProduction, WEB_ORIGIN: 'https://parking.example.org' });
  assert.ok(issues.some((issue) => issue.path === 'WEB_ORIGIN' && issue.message.includes('localhost')));
});

test('requires independent QR signing and vision service secrets', () => {
  const shared = 'a'.repeat(48);
  const issues = productionConfigIssues({ ...validProduction, QR_SIGNING_SECRET: shared, VISION_API_TOKEN: shared });
  assert.ok(issues.some((issue) => issue.path === 'QR_SIGNING_SECRET' && issue.message.includes('must be different')));
});


test('production email worker does not require API-only payment, QR, or vision secrets', () => {
  const worker = {
    ...validProduction,
    SMARTPARK_PROCESS: 'email-worker',
    PAYMENT_PROVIDER: 'mock',
    RAZORPAY_KEY_ID: '',
    RAZORPAY_KEY_SECRET: '',
    RAZORPAY_WEBHOOK_SECRET: '',
    QR_SIGNING_SECRET: '',
    VISION_API_TOKEN: ''
  };
  assert.deepEqual(productionConfigIssues(worker), []);
});

test('production email worker still requires its SMTP credentials', () => {
  const worker = {
    ...validProduction,
    SMARTPARK_PROCESS: 'email-worker',
    PAYMENT_PROVIDER: 'mock',
    RAZORPAY_KEY_ID: '',
    RAZORPAY_KEY_SECRET: '',
    RAZORPAY_WEBHOOK_SECRET: '',
    QR_SIGNING_SECRET: '',
    VISION_API_TOKEN: '',
    SMTP_PASSWORD: ''
  };
  assert.ok(productionConfigIssues(worker).some((issue) => issue.path === 'SMTP_PASSWORD'));
});


test('rejects reusing a high-value secret across service boundaries', () => {
  const issues = productionConfigIssues({
    ...validProduction,
    SMTP_PASSWORD: validProduction.DB_PASSWORD
  });
  assert.ok(issues.some((issue) => issue.path === 'SMTP_PASSWORD' && issue.message.includes('must be different')));
});
