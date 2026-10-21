import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EMAIL_TEMPLATE_KEYS,
  escapeHtml,
  normalizeEmailTemplateData,
  renderTransactionalEmail,
  retryDelaySeconds
} from '../src/services/transactional-email.js';

const samples = {
  booking_hold_created: { bookingCode: 'SP261020ABC123', lotName: 'Central Garage', slotCode: 'A-12', startAt: '2026-11-01T09:00:00.000Z', endAt: '2026-11-01T10:00:00.000Z', holdMinutes: 10 },
  booking_cancelled: { bookingCode: 'SP261020ABC123', lotName: 'Central Garage', slotCode: 'A-12' },
  booking_confirmed: { bookingCode: 'SP261020ABC123', lotName: 'Central Garage', slotCode: 'A-12', startAt: '2026-11-01T09:00:00.000Z', endAt: '2026-11-01T10:00:00.000Z', amount: '125.50', currency: 'INR' },
  parking_entry_recorded: { bookingCode: 'SP261020ABC123', lotName: 'Central Garage', slotCode: 'A-12' },
  parking_exit_recorded: { bookingCode: 'SP261020ABC123', lotName: 'Central Garage', slotCode: 'A-12' }
};

test('all supported templates render text and html versions', () => {
  assert.deepEqual(Object.keys(samples).sort(), [...EMAIL_TEMPLATE_KEYS].sort());
  for (const [key, data] of Object.entries(samples)) {
    const rendered = renderTransactionalEmail(key, data);
    assert.ok(rendered.subject.length > 5);
    assert.match(rendered.text, /SP261020ABC123/);
    assert.match(rendered.html, /SmartPark/);
    assert.doesNotMatch(rendered.html, /<script>/i);
  }
});

test('untrusted facility and slot strings are escaped in HTML', () => {
  const rendered = renderTransactionalEmail('booking_cancelled', {
    bookingCode: 'SP1234', lotName: '<img src=x onerror=alert(1)> Garage & Lot', slotCode: 'A"<1'
  });
  assert.match(rendered.html, /&lt;img src=x onerror=alert\(1\)&gt; Garage &amp; Lot/);
  assert.match(rendered.html, /A&quot;&lt;1/);
  assert.doesNotMatch(rendered.html, /<img src=x/i);
});

test('unsupported templates and missing required fields fail closed', () => {
  assert.throws(() => renderTransactionalEmail('password_reset', {}), /Unsupported/);
  assert.throws(() => normalizeEmailTemplateData('booking_cancelled', { bookingCode: 'SP1', lotName: 'Garage' }), /slotCode/);
});

test('email schema rejects invalid currency, amount, and excessive field lengths', () => {
  assert.throws(() => normalizeEmailTemplateData('booking_confirmed', { ...samples.booking_confirmed, currency: 'inr' }), /currency/);
  assert.throws(() => normalizeEmailTemplateData('booking_confirmed', { ...samples.booking_confirmed, amount: '-1' }), /amount/);
  assert.throws(() => normalizeEmailTemplateData('booking_cancelled', { ...samples.booking_cancelled, lotName: 'g'.repeat(161) }), /too long/);
});

test('HTML escaping covers every special syntax character', () => {
  assert.equal(escapeHtml(`&<>"'`), '&amp;&lt;&gt;&quot;&#39;');
});

test('retry backoff grows exponentially and caps at one hour', () => {
  assert.equal(retryDelaySeconds(1), 30);
  assert.equal(retryDelaySeconds(2), 60);
  assert.equal(retryDelaySeconds(3), 120);
  assert.equal(retryDelaySeconds(8), 3600);
  assert.equal(retryDelaySeconds(20), 3600);
  assert.throws(() => retryDelaySeconds(0), /positive integer/);
});
