import { createHmac, createHash, timingSafeEqual } from 'node:crypto';

const CURRENCY_DECIMALS = Object.freeze({
  BHD: 3, IQD: 3, JOD: 3, KWD: 3, LYD: 3, OMR: 3, TND: 3,
  CLP: 0, DJF: 0, GNF: 0, JPY: 0, KRW: 0, PYG: 0, RWF: 0, UGX: 0, VND: 0, VUV: 0, XAF: 0, XOF: 0, XPF: 0
});

export function minorUnitFactor(currency) {
  return 10 ** (CURRENCY_DECIMALS[String(currency ?? '').toUpperCase()] ?? 2);
}

export function toMinorUnits(amount, currency) {
  const numeric = Number(amount);
  if (!Number.isFinite(numeric) || numeric < 0) throw new TypeError('Payment amount must be a finite non-negative number.');
  return Math.round((numeric + Number.EPSILON) * minorUnitFactor(currency));
}

export function fromMinorUnits(amount, currency) {
  const numeric = Number(amount);
  if (!Number.isSafeInteger(numeric) || numeric < 0) throw new TypeError('Minor-unit amount must be a non-negative safe integer.');
  return numeric / minorUnitFactor(currency);
}

export function sha256Hex(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

export function constantTimeStringEqual(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const a = Buffer.from(left, 'utf8');
  const b = Buffer.from(right, 'utf8');
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
}

export function hmacSha256Hex(secret, value) {
  if (!secret || typeof secret !== 'string') throw new TypeError('Signing secret is not configured.');
  return createHmac('sha256', secret).update(value).digest('hex');
}

export function verifyRazorpayCheckoutSignature({ orderId, paymentId, signature, secret }) {
  if (![orderId, paymentId, signature, secret].every((item) => typeof item === 'string' && item.length > 0)) return false;
  const expected = hmacSha256Hex(secret, `${orderId}|${paymentId}`);
  return constantTimeStringEqual(expected, signature.toLowerCase());
}

export function verifyRazorpayWebhookSignature({ rawBody, signature, secret }) {
  if (!Buffer.isBuffer(rawBody) || typeof signature !== 'string' || !signature || typeof secret !== 'string' || !secret) return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  return constantTimeStringEqual(expected, signature.toLowerCase());
}

export function createSignedTicket({ bookingId, endAt, secret, nowSeconds = Math.floor(Date.now() / 1000), graceSeconds = 12 * 60 * 60, allowExpired = false }) {
  if (typeof bookingId !== 'string' || !/^[0-9a-f-]{36}$/i.test(bookingId)) throw new TypeError('A valid booking identifier is required.');
  const endMs = endAt instanceof Date ? endAt.getTime() : new Date(endAt).getTime();
  if (!Number.isFinite(endMs)) throw new TypeError('A valid booking end time is required.');
  const expiresAt = Math.floor(endMs / 1000) + graceSeconds;
  if (expiresAt <= nowSeconds && !allowExpired) throw new RangeError('This booking ticket has expired.');
  const payload = `sp1:${bookingId}:${expiresAt}`;
  const signature = hmacSha256Hex(secret, payload);
  return { token: `${payload}:${signature}`, expiresAt: new Date(expiresAt * 1000).toISOString(), expiresAtSeconds: expiresAt };
}

export function verifySignedTicket(token, secret, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (typeof token !== 'string' || token.length > 2048) return { ok: false, code: 'INVALID_TICKET' };
  const parts = token.split(':');
  if (parts.length !== 4 || parts[0] !== 'sp1' || !/^[0-9a-f-]{36}$/i.test(parts[1]) || !/^\d{10,12}$/.test(parts[2]) || !/^[0-9a-f]{64}$/i.test(parts[3])) {
    return { ok: false, code: 'INVALID_TICKET' };
  }
  const expiresAt = Number(parts[2]);
  const expected = hmacSha256Hex(secret, `${parts[0]}:${parts[1]}:${parts[2]}`);
  if (!constantTimeStringEqual(expected, parts[3].toLowerCase())) return { ok: false, code: 'INVALID_TICKET' };
  if (expiresAt <= nowSeconds) return { ok: false, code: 'TICKET_EXPIRED', bookingId: parts[1], expiresAt };
  return { ok: true, bookingId: parts[1], expiresAt, expiresAtIso: new Date(expiresAt * 1000).toISOString() };
}

export function validateCapturedPayment({ expectedAmount, expectedCurrency, capturedAmount, capturedCurrency, providerOrderId, expectedProviderOrderId, capturedStatus = 'captured' }) {
  if (String(providerOrderId ?? '') !== String(expectedProviderOrderId ?? '')) return { ok: false, code: 'ORDER_MISMATCH' };
  if (String(expectedCurrency ?? '').toUpperCase() !== String(capturedCurrency ?? '').toUpperCase()) return { ok: false, code: 'CURRENCY_MISMATCH' };
  if (toMinorUnits(expectedAmount, expectedCurrency) !== Number(capturedAmount)) return { ok: false, code: 'AMOUNT_MISMATCH' };
  if (capturedStatus !== 'captured') return { ok: false, code: 'PAYMENT_NOT_CAPTURED' };
  return { ok: true };
}
