import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBookingDemandForecast } from '../src/operations/forecasting.js';

test('forecast uses the matching weekday and hour and averages across weekly samples', () => {
  const now = new Date('2026-10-22T10:30:00.000Z'); // Thursday
  const result = buildBookingDemandForecast({
    now, hours: 2, capacity: 20,
    historicalRows: [ { weekday: 5, hour: 11, booking_count: 24, sampled_days: 7 }, { weekday: 5, hour: 12, booking_count: 8, sampled_days: 4 } ],
    sampleWeeks: 8
  });
  assert.equal(result.length, 2);
  assert.equal(result[0].expectedBookingStarts, 3);
  assert.equal(result[0].bookingDemandPercentOfCapacity, 15);
  assert.equal(result[0].confidence, 'medium');
  assert.equal(result[1].expectedBookingStarts, 1);
});

test('forecast handles no capacity and caps horizon to seven days', () => {
  const result = buildBookingDemandForecast({ now: new Date('2026-01-01T00:00:00Z'), hours: 500, capacity: 0 });
  assert.equal(result.length, 168);
  assert.equal(result[0].bookingDemandPercentOfCapacity, 0);
  assert.equal(result[0].confidence, 'low');
});
