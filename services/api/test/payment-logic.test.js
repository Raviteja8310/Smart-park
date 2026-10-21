import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import {
  constantTimeStringEqual,
  createSignedTicket,
  fromMinorUnits,
  minorUnitFactor,
  sha256Hex,
  toMinorUnits,
  validateCapturedPayment,
  verifyRazorpayCheckoutSignature,
  verifyRazorpayWebhookSignature,
  verifySignedTicket
} from '../src/payments/payment-logic.js';

const secret = 'unit-test-secret-that-is-long-enough-to-use';

test('minor unit conversion handles two-, three- and zero-decimal currencies', () => {
  assert.equal(toMinorUnits('123.45', 'INR'), 12345);
  assert.equal(fromMinorUnits(12345, 'INR'), 123.45);
  assert.equal(toMinorUnits('5.123', 'KWD'), 5123);
  assert.equal(minorUnitFactor('JPY'), 1);
  assert.equal(toMinorUnits('150', 'JPY'), 150);
});

test('minor unit conversion rejects invalid and negative amounts', () => {
  assert.throws(() => toMinorUnits('NaN', 'INR'));
  assert.throws(() => toMinorUnits(-1, 'INR'));
});

test('Razorpay checkout signature verifies and rejects a modified payment id', () => {
  const orderId = 'order_test_123';
  const paymentId = 'pay_test_123';
  const signature = createHmac('sha256', secret).update(`${orderId}|${paymentId}`).digest('hex');
  assert.equal(verifyRazorpayCheckoutSignature({ orderId, paymentId, signature, secret }), true);
  assert.equal(verifyRazorpayCheckoutSignature({ orderId, paymentId: 'pay_changed', signature, secret }), false);
});

test('webhook signature validates the exact raw body bytes', () => {
  const rawBody = Buffer.from('{"event":"payment.captured"}');
  const signature = createHmac('sha256', secret).update(rawBody).digest('hex');
  assert.equal(verifyRazorpayWebhookSignature({ rawBody, signature, secret }), true);
  assert.equal(verifyRazorpayWebhookSignature({ rawBody: Buffer.from('{}'), signature, secret }), false);
});

test('constant-time string comparison rejects different and empty values', () => {
  assert.equal(constantTimeStringEqual('abcd', 'abcd'), true);
  assert.equal(constantTimeStringEqual('abcd', 'abce'), false);
  assert.equal(constantTimeStringEqual('', ''), false);
});

test('signed QR ticket verifies, binds to booking id, and expires', () => {
  const bookingId = randomUUID();
  const endAt = new Date('2026-10-20T12:00:00.000Z');
  const generated = createSignedTicket({ bookingId, endAt, secret, nowSeconds: 1_790_000_000 });
  const valid = verifySignedTicket(generated.token, secret, 1_790_000_000);
  assert.equal(valid.ok, true);
  assert.equal(valid.bookingId, bookingId);
  assert.equal(verifySignedTicket(generated.token, 'another-secret', 1_790_000_000).ok, false);
  assert.equal(verifySignedTicket(generated.token, secret, generated.expiresAtSeconds).code, 'TICKET_EXPIRED');
});

test('ticket hash can be stored without storing the QR bearer token', () => {
  const generated = createSignedTicket({ bookingId: randomUUID(), endAt: new Date(Date.now() + 60 * 60_000), secret });
  assert.equal(sha256Hex(generated.token).length, 64);
  assert.notEqual(sha256Hex(generated.token), generated.token);
});

test('captured payment requires matching provider order, currency, amount and captured status', () => {
  const expected = { expectedAmount: '120.50', expectedCurrency: 'INR', capturedAmount: 12050, capturedCurrency: 'INR', providerOrderId: 'order_1', expectedProviderOrderId: 'order_1', capturedStatus: 'captured' };
  assert.deepEqual(validateCapturedPayment(expected), { ok: true });
  assert.equal(validateCapturedPayment({ ...expected, capturedAmount: 1 }).code, 'AMOUNT_MISMATCH');
  assert.equal(validateCapturedPayment({ ...expected, capturedCurrency: 'USD' }).code, 'CURRENCY_MISMATCH');
  assert.equal(validateCapturedPayment({ ...expected, providerOrderId: 'order_2' }).code, 'ORDER_MISMATCH');
  assert.equal(validateCapturedPayment({ ...expected, capturedStatus: 'authorized' }).code, 'PAYMENT_NOT_CAPTURED');
});

test('a signed expired ticket can be reconstructed for exit-only recovery without becoming valid for entry', () => {
  const bookingId = randomUUID();
  const endAt = new Date('2026-01-01T00:00:00.000Z');
  const generated = createSignedTicket({ bookingId, endAt, secret, nowSeconds: 1_800_000_000, allowExpired: true });
  const verified = verifySignedTicket(generated.token, secret, 1_800_000_001);
  assert.equal(verified.ok, false);
  assert.equal(verified.code, 'TICKET_EXPIRED');
  assert.equal(verified.bookingId, bookingId);
  assert.equal(generated.token.split(':').length, 4);
});
