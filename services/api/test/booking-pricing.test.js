import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateBestQuote, isWithinWeeklyAvailability, toMysqlUtc, validateBookingInterval } from '../src/bookings/pricing.js';

test('booking interval rejects starts too close to current time', () => {
  const now = Date.parse('2026-10-20T00:00:00.000Z');
  const result = validateBookingInterval('2026-10-20T00:00:30.000Z', '2026-10-20T01:00:00.000Z', now);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'START_IN_PAST');
});

test('booking interval requires a valid order and at least 30 minutes', () => {
  const now = Date.parse('2026-10-20T00:00:00.000Z');
  assert.equal(validateBookingInterval('2026-10-20T01:00:00Z', '2026-10-20T00:59:00Z', now).code, 'INVALID_INTERVAL');
  assert.equal(validateBookingInterval('2026-10-20T01:00:00Z', '2026-10-20T01:20:00Z', now).code, 'MINIMUM_DURATION');
});

test('booking interval caps one reservation at 30 days', () => {
  const now = Date.parse('2026-10-20T00:00:00.000Z');
  const result = validateBookingInterval('2026-10-21T00:00:00Z', '2026-11-21T00:00:00Z', now);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'MAXIMUM_DURATION');
});

test('quote selects the cheapest effective rate including one-time fee and tax', () => {
  const quote = calculateBestQuote([
    { id: 'hourly', rate_type: 'hourly', amount: '40.00', service_fee: '5.00', tax_rate_percent: '10', currency: 'INR' },
    { id: 'daily', rate_type: 'daily', amount: '100.00', service_fee: '10.00', tax_rate_percent: '10', currency: 'INR' }
  ], 120, new Date('2026-10-20T00:00:00Z'));
  assert.equal(quote.rateType, 'hourly');
  assert.equal(quote.units, 2);
  assert.equal(quote.baseAmount, 80);
  assert.equal(quote.serviceFee, 5);
  assert.equal(quote.taxAmount, 8.5);
  assert.equal(quote.totalAmount, 93.5);
});

test('quote chooses the daily price for a long stay when it is cheaper', () => {
  const quote = calculateBestQuote([
    { id: 'hourly', rate_type: 'hourly', amount: '40', service_fee: '5', tax_rate_percent: '0', currency: 'INR' },
    { id: 'daily', rate_type: 'daily', amount: '100', service_fee: '0', tax_rate_percent: '0', currency: 'INR' }
  ], 24 * 60, new Date('2026-10-20T00:00:00Z'));
  assert.equal(quote.rateType, 'daily');
  assert.equal(quote.totalAmount, 100);
});

test('UTC date conversion creates a MySQL DATETIME string', () => {
  assert.equal(toMysqlUtc('2026-10-20T12:34:56.789Z'), '2026-10-20 12:34:56');
});

test('normal daytime facility hours require start and end within the daily window but allow multi-day stays', async () => {
  const { isWithinOperatingHours } = await import('../src/bookings/pricing.js');
  assert.equal(isWithinOperatingHours('2026-10-22T04:30:00Z', '2026-10-22T06:00:00Z', '10:00:00', '18:00:00', 'Asia/Kolkata'), true);
  assert.equal(isWithinOperatingHours('2026-10-22T04:30:00Z', '2026-10-29T06:00:00Z', '10:00:00', '18:00:00', 'Asia/Kolkata'), true);
  assert.equal(isWithinOperatingHours('2026-10-22T12:00:00Z', '2026-10-22T14:00:00Z', '10:00:00', '18:00:00', 'Asia/Kolkata'), false);
});

test('overnight facility hours accept start and end times in the overnight window', async () => {
  const { isWithinOperatingHours } = await import('../src/bookings/pricing.js');
  assert.equal(isWithinOperatingHours('2026-10-22T17:30:00Z', '2026-10-22T19:30:00Z', '22:00:00', '06:00:00', 'Asia/Kolkata'), true);
  assert.equal(isWithinOperatingHours('2026-10-22T17:30:00Z', '2026-10-29T19:30:00Z', '22:00:00', '06:00:00', 'Asia/Kolkata'), true);
  assert.equal(isWithinOperatingHours('2026-10-22T15:30:00Z', '2026-10-22T17:00:00Z', '22:00:00', '06:00:00', 'Asia/Kolkata'), false);
});


test('shared-space weekly availability validates local weekday and arrival/departure hours', () => {
  const rules = Array.from({ length: 7 }, (_, weekday) => ({
    weekday, is_available: 1, opens_at: '06:00:00', closes_at: '23:00:00'
  }));
  // Tuesday 09:00–11:00 in Asia/Kolkata.
  assert.equal(isWithinWeeklyAvailability('2026-10-20T03:30:00.000Z', '2026-10-20T05:30:00.000Z', rules, 'Asia/Kolkata'), true);
  // Tuesday arrival before opening.
  assert.equal(isWithinWeeklyAvailability('2026-10-20T00:00:00.000Z', '2026-10-20T02:00:00.000Z', rules, 'Asia/Kolkata'), false);
  // End at closing is accepted.
  assert.equal(isWithinWeeklyAvailability('2026-10-20T15:30:00.000Z', '2026-10-20T17:30:00.000Z', rules, 'Asia/Kolkata'), true);
});

test('shared-space weekly availability rejects closed days and incomplete schedules', () => {
  const rules = Array.from({ length: 7 }, (_, weekday) => ({
    weekday, is_available: weekday !== 0, opens_at: '06:00:00', closes_at: '23:00:00'
  }));
  // Sunday 09:00–10:00 local time.
  assert.equal(isWithinWeeklyAvailability('2026-10-25T03:30:00.000Z', '2026-10-25T04:30:00.000Z', rules, 'Asia/Kolkata'), false);
  assert.equal(isWithinWeeklyAvailability('2026-10-20T03:30:00.000Z', '2026-10-20T04:30:00.000Z', rules.slice(0, 6), 'Asia/Kolkata'), false);
});

test('shared-space weekly availability evaluates a multi-day stay against start and end weekdays', () => {
  const rules = Array.from({ length: 7 }, (_, weekday) => ({
    weekday, is_available: weekday !== 0, opens_at: '06:00:00', closes_at: '23:00:00'
  }));
  // Saturday 22:00 through Sunday 10:00 (local). Sunday is closed, so checkout is not allowed.
  assert.equal(isWithinWeeklyAvailability('2026-10-24T16:30:00.000Z', '2026-10-25T04:30:00.000Z', rules, 'Asia/Kolkata'), false);
  rules[0].is_available = 1;
  assert.equal(isWithinWeeklyAvailability('2026-10-24T16:30:00.000Z', '2026-10-25T04:30:00.000Z', rules, 'Asia/Kolkata'), true);
});
