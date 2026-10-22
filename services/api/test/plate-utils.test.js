import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePlate, plateMatchStatus } from '../src/vision/plate-utils.js';

test('normalizes plate text to uppercase letters and digits only', () => {
  assert.equal(normalizePlate(' ka-01 ab 1234 '), 'KA01AB1234');
  assert.equal(normalizePlate('MH 12 / XY 0099'), 'MH12XY0099');
});

test('requires human review for low-confidence plate candidates', () => {
  assert.equal(plateMatchStatus({ confidence: 0.4, vehicleMatched: true, bookingMatched: true }), 'review_required');
});

test('ranks booking matches above vehicle-only matches without making gate decisions', () => {
  assert.equal(plateMatchStatus({ confidence: 0.91, vehicleMatched: true, bookingMatched: true }), 'matched_booking');
  assert.equal(plateMatchStatus({ confidence: 0.9, vehicleMatched: true, bookingMatched: false }), 'matched_vehicle');
  assert.equal(plateMatchStatus({ confidence: 0.9, vehicleMatched: false, bookingMatched: false }), 'unmatched');
});
