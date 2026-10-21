import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeRevenueRows, normalizeStatusFilter, resolveDateRange } from '../src/operations/reporting.js';

test('date range defaults to the last 30 calendar days ending today', () => {
  assert.deepEqual(resolveDateRange(undefined, undefined, new Date('2026-10-21T18:00:00Z')), {
    from: '2026-09-22', to: '2026-10-21', days: 30
  });
});

test('date range accepts leap day when valid', () => {
  assert.deepEqual(resolveDateRange('2024-02-28', '2024-02-29'), {
    from: '2024-02-28', to: '2024-02-29', days: 2
  });
});

test('date range rejects impossible dates and reversed intervals', () => {
  assert.throws(() => resolveDateRange('2026-02-30', '2026-03-01'), /valid calendar dates/);
  assert.throws(() => resolveDateRange('2026-10-22', '2026-10-21'), /on or before/);
});

test('date range rejects excessive windows', () => {
  assert.throws(() => resolveDateRange('2025-01-01', '2026-10-21'), /366 days or less/);
});

test('alert status filter supports known statuses and all', () => {
  assert.equal(normalizeStatusFilter(undefined), null);
  assert.equal(normalizeStatusFilter('all'), null);
  assert.equal(normalizeStatusFilter('open'), 'open');
  assert.throws(() => normalizeStatusFilter('closed'), /must be open/);
});

test('revenue rows convert SQL numeric fields to typed API fields', () => {
  assert.deepEqual(normalizeRevenueRows([{ report_date: new Date('2026-10-20T00:00:00Z'), currency: 'inr', amount: '420.50', payment_count: '2' }]), [
    { date: '2026-10-20', currency: 'INR', amount: 420.5, paymentCount: 2 }
  ]);
});
