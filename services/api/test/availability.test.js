import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveSlotState, isAvailableNow, mapLotRow, toNumber } from '../src/parking/availability.js';

test('operational status takes precedence over occupancy', () => {
  assert.equal(deriveSlotState({ operationalStatus: 'maintenance', physicalState: 'empty', reservedNow: false }), 'maintenance');
  assert.equal(deriveSlotState({ operationalStatus: 'disabled', physicalState: 'empty', reservedNow: false }), 'disabled');
});

test('occupied physical state is kept distinct from a reservation', () => {
  assert.equal(deriveSlotState({ operationalStatus: 'open', physicalState: 'occupied', reservedNow: true }), 'occupied');
  assert.equal(deriveSlotState({ operationalStatus: 'open', physicalState: 'empty', reservedNow: true }), 'reserved');
});

test('unknown is never advertised as available', () => {
  assert.equal(deriveSlotState({ operationalStatus: 'open', physicalState: 'unknown', reservedNow: false }), 'unknown');
  assert.equal(isAvailableNow({ operationalStatus: 'open', physicalState: 'unknown', reservedNow: false }), false);
});

test('only open, physically empty and unreserved slots are available now', () => {
  assert.equal(isAvailableNow({ operationalStatus: 'open', physicalState: 'empty', reservedNow: false }), true);
  assert.equal(isAvailableNow({ operationalStatus: 'open', physicalState: 'occupied', reservedNow: false }), false);
  assert.equal(isAvailableNow({ operationalStatus: 'open', physicalState: 'empty', reservedNow: true }), false);
});

test('numeric database fields are safely normalized', () => {
  assert.equal(toNumber('12'), 12);
  assert.equal(toNumber(null), 0);
  assert.equal(toNumber('not-a-number'), 0);
});

test('lot row maps database names to the public API contract', () => {
  const mapped = mapLotRow({
    id: 'abc', name: 'Demo', address_line: '1 Road', city: 'Bengaluru', facility_status: 'active',
    timezone: 'Asia/Kolkata', currency: 'INR', total_spaces: '10', available_now: '4', hourly_rate: '30.00'
  });
  assert.equal(mapped.name, 'Demo');
  assert.equal(mapped.totalSpaces, 10);
  assert.equal(mapped.availableNow, 4);
  assert.equal(mapped.hourlyRate, 30);
  assert.equal(mapped.latitude, null);
});
