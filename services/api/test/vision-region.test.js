import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePolygon, safeJsonArray } from '../src/vision/region-utils.js';

test('normalizes valid normalized parking-space polygons', () => {
  assert.deepEqual(normalizePolygon([[0.1, 0.1], [0.4, 0.1], [0.4, 0.5], [0.1, 0.5]]), [[0.1, 0.1], [0.4, 0.1], [0.4, 0.5], [0.1, 0.5]]);
});
test('rejects points outside normalized image coordinates', () => {
  assert.throws(() => normalizePolygon([[0, 0], [2, 0], [0, 1]]), /between 0 and 1/);
});
test('rejects degenerate region polygons', () => {
  assert.throws(() => normalizePolygon([[0, 0], [0.2, 0.2], [0.4, 0.4]]), /non-zero area/);
});
test('rejects duplicate points that do not form a usable polygon', () => {
  assert.throws(() => normalizePolygon([[0, 0], [0, 0], [0, 0], [0.4, 0.4]]), /distinct points/);
});
test('reads JSON arrays returned as parsed values or strings', () => {
  assert.deepEqual(safeJsonArray('[[0.1,0.2],[0.5,0.6]]'), [[0.1, 0.2], [0.5, 0.6]]);
  assert.deepEqual(safeJsonArray([[0.1, 0.2]]), [[0.1, 0.2]]);
  assert.deepEqual(safeJsonArray('bad-json'), []);
});
