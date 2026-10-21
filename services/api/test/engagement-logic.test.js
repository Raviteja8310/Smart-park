import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeReviewRow, normalizeSearchInput, reviewerLabel, validateReviewInput } from '../src/engagement/engagement-logic.js';

test('search input trims, normalizes whitespace, limits fields and ignores empty searches', () => {
  assert.deepEqual(normalizeSearchInput({ q: '  central   garage ', city: ' Bengaluru ' }), { query: 'central garage', city: 'Bengaluru' });
  assert.equal(normalizeSearchInput({ q: '   ', city: '' }), null);
  assert.equal(normalizeSearchInput({ q: 'a'.repeat(140) }).query.length, 100);
});

test('review input requires a whole-number rating from 1 to 5 and useful text', () => {
  assert.equal(validateReviewInput({ rating: 0, text: 'Good place' }).ok, false);
  assert.equal(validateReviewInput({ rating: 4.5, text: 'Good place' }).ok, false);
  assert.equal(validateReviewInput({ rating: 5, text: 'ok' }).ok, false);
  assert.equal(validateReviewInput({ rating: 5, text: 'Excellent parking' }).ok, true);
});

test('review input bounds title and review text and rejects control characters', () => {
  assert.equal(validateReviewInput({ rating: 5, title: 'x'.repeat(121), text: 'Great place' }).ok, false);
  assert.equal(validateReviewInput({ rating: 5, text: 'x'.repeat(1001) }).ok, false);
  assert.equal(validateReviewInput({ rating: 5, title: 'hey\u0007', text: 'Great place' }).ok, false);
});

test('reviewer label exposes only first name and last initial', () => {
  assert.equal(reviewerLabel('  Asha  Devi Rao '), 'Asha R.');
  assert.equal(reviewerLabel('Ravi'), 'Ravi');
  assert.equal(reviewerLabel(' '), 'Verified parker');
});

test('public review mapping returns expected typed fields without exposing user identity', () => {
  const mapped = normalizeReviewRow({ id: 'r1', parking_lot_id: 'l1', booking_id: 'b1', rating: '4', review_title: null, review_text: 'Smooth parking', full_name: 'Ravi Teja G', created_at: 'created', updated_at: 'updated' });
  assert.deepEqual(mapped, { id: 'r1', parkingLotId: 'l1', bookingId: 'b1', rating: 4, title: '', text: 'Smooth parking', reviewerName: 'Ravi G.', createdAt: 'created', updatedAt: 'updated' });
  assert.equal('full_name' in mapped, false);
  const publicReview = normalizeReviewRow({ id: 'r2', parking_lot_id: 'l1', booking_id: 'private-booking-id', rating: 5, review_text: 'Excellent visit', full_name: 'Mira Singh' }, { includeBookingId: false });
  assert.equal('bookingId' in publicReview, false);
});
