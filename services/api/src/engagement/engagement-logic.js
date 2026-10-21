export function normalizeSearchInput(value = {}) {
  const query = String(value.q ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100);
  const city = String(value.city ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100);
  if (!query && !city) return null;
  return { query: query || null, city: city || null };
}

export function validateReviewInput(value = {}) {
  const rating = Number(value.rating);
  const title = String(value.title ?? '').trim();
  const text = String(value.text ?? '').trim();
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) return { ok: false, error: 'Rating must be an integer from 1 to 5.' };
  if (title.length > 120) return { ok: false, error: 'Review title must be 120 characters or fewer.' };
  if (text.length < 3 || text.length > 1000) return { ok: false, error: 'Review text must be between 3 and 1000 characters.' };
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(title + text)) return { ok: false, error: 'Review text contains unsupported control characters.' };
  return { ok: true, value: { rating, title: title || null, text } };
}

export function reviewerLabel(fullName = '') {
  const parts = String(fullName).trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'Verified parker';
  return parts.length === 1 ? parts[0] : `${parts[0]} ${parts.at(-1).slice(0, 1).toUpperCase()}.`;
}

export function normalizeReviewRow(row, { includeBookingId = true } = {}) {
  const review = {
    id: row.id,
    parkingLotId: row.parking_lot_id,
    rating: Number(row.rating),
    title: row.review_title ?? '',
    text: row.review_text,
    reviewerName: reviewerLabel(row.full_name),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
  if (includeBookingId) review.bookingId = row.booking_id;
  return review;
}
