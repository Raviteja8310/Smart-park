import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { pool } from '../config/database.js';
import { requireAuth, requireRole } from '../middleware/authenticate.js';
import { normalizeReviewRow, normalizeSearchInput, validateReviewInput } from '../engagement/engagement-logic.js';

const router = Router();
const asyncHandler = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
const uuidSchema = z.string().uuid();
const listSchema = z.object({ limit: z.coerce.number().int().min(1).max(50).default(20) });
const searchSchema = z.object({ q: z.string().trim().max(100).optional(), city: z.string().trim().max(100).optional() });
const reviewSchema = z.object({ bookingId: z.string().uuid(), rating: z.coerce.number().int().min(1).max(5), title: z.string().trim().max(120).optional().nullable(), text: z.string().trim().min(3).max(1000) });
const updateReviewSchema = z.object({ rating: z.coerce.number().int().min(1).max(5), title: z.string().trim().max(120).optional().nullable(), text: z.string().trim().min(3).max(1000) });
const moderationSchema = z.object({ status: z.enum(['published', 'hidden']) });

function fail(res, status, code, message) { return res.status(status).json({ error: { code, message } }); }
function validationFail(res, parsed) { return fail(res, 400, 'VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Check the submitted fields.'); }
function audit(executor, actorId, action, entityId, metadata = {}) {
  return executor.execute('INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, metadata) VALUES (?, ?, ?, ?, ?)', [actorId, action, 'parking_engagement', entityId ?? null, JSON.stringify(metadata)]);
}

router.get('/favorites/ids', requireAuth, asyncHandler(async (req, res) => {
  const [rows] = await pool.execute(
    `SELECT f.parking_lot_id FROM parking_favorites f
      JOIN parking_lots l ON l.id = f.parking_lot_id
     WHERE f.user_id = ? AND l.facility_status = 'active'`, [req.user.id]
  );
  return res.json({ ids: rows.map((row) => row.parking_lot_id) });
}));

router.get('/favorites', requireAuth, asyncHandler(async (req, res) => {
  const [rows] = await pool.execute(
    `SELECT l.id, l.name, l.address_line, l.city, l.region, l.latitude, l.longitude, l.currency,
            l.listing_kind, l.parking_type, l.facility_status, f.created_at AS saved_at,
            (SELECT ph.public_url FROM parking_listing_photos ph WHERE ph.parking_lot_id = l.id ORDER BY ph.sort_order, ph.created_at LIMIT 1) AS cover_photo,
            (SELECT MIN(pr.amount) FROM pricing_rules pr WHERE pr.parking_lot_id = l.id AND pr.is_active = TRUE AND pr.rate_type = 'hourly'
              AND (pr.valid_from IS NULL OR pr.valid_from <= UTC_TIMESTAMP()) AND (pr.valid_until IS NULL OR pr.valid_until > UTC_TIMESTAMP())) AS hourly_rate,
            (SELECT AVG(rv.rating) FROM parking_reviews rv WHERE rv.parking_lot_id = l.id AND rv.status = 'published') AS average_rating,
            (SELECT COUNT(*) FROM parking_reviews rv WHERE rv.parking_lot_id = l.id AND rv.status = 'published') AS review_count
       FROM parking_favorites f JOIN parking_lots l ON l.id = f.parking_lot_id
      WHERE f.user_id = ? AND l.facility_status = 'active'
      ORDER BY f.created_at DESC`, [req.user.id]
  );
  return res.json({ favorites: rows.map((row) => ({
    id: row.id, name: row.name, addressLine: row.address_line, city: row.city, region: row.region,
    latitude: row.latitude === null ? null : Number(row.latitude), longitude: row.longitude === null ? null : Number(row.longitude),
    currency: row.currency, listingKind: row.listing_kind, parkingType: row.parking_type, facilityStatus: row.facility_status,
    savedAt: row.saved_at, coverPhoto: row.cover_photo ?? null,
    hourlyRate: row.hourly_rate === null ? null : Number(row.hourly_rate),
    averageRating: row.average_rating === null ? null : Number(row.average_rating), reviewCount: Number(row.review_count ?? 0)
  })) });
}));

router.post('/favorites/:lotId', requireAuth, asyncHandler(async (req, res) => {
  const parsedId = uuidSchema.safeParse(req.params.lotId);
  if (!parsedId.success) return fail(res, 400, 'INVALID_ID', 'The parking facility identifier is invalid.');
  const [lots] = await pool.execute("SELECT id FROM parking_lots WHERE id = ? AND facility_status = 'active' LIMIT 1", [parsedId.data]);
  if (!lots.length) return fail(res, 404, 'LOT_NOT_FOUND', 'The published parking facility was not found.');
  await pool.execute('INSERT IGNORE INTO parking_favorites (user_id, parking_lot_id) VALUES (?, ?)', [req.user.id, parsedId.data]);
  await audit(pool, req.user.id, 'parking.favorite.added', parsedId.data);
  return res.status(201).json({ success: true, favorite: { parkingLotId: parsedId.data } });
}));

router.delete('/favorites/:lotId', requireAuth, asyncHandler(async (req, res) => {
  const parsedId = uuidSchema.safeParse(req.params.lotId);
  if (!parsedId.success) return fail(res, 400, 'INVALID_ID', 'The parking facility identifier is invalid.');
  const [result] = await pool.execute('DELETE FROM parking_favorites WHERE user_id = ? AND parking_lot_id = ?', [req.user.id, parsedId.data]);
  if (result.affectedRows) await audit(pool, req.user.id, 'parking.favorite.removed', parsedId.data);
  return res.json({ success: true, removed: result.affectedRows > 0 });
}));

router.get('/search-history', requireAuth, asyncHandler(async (req, res) => {
  const parsed = listSchema.safeParse(req.query);
  if (!parsed.success) return validationFail(res, parsed);
  const [rows] = await pool.execute(
    `SELECT id, query_text, city, result_count, searched_at FROM parking_search_history
      WHERE user_id = ? ORDER BY searched_at DESC LIMIT ?`, [req.user.id, parsed.data.limit]
  );
  return res.json({ searches: rows.map((row) => ({ id: row.id, q: row.query_text ?? '', city: row.city ?? '', resultCount: row.result_count === null ? null : Number(row.result_count), searchedAt: row.searched_at })) });
}));

router.post('/search-history', requireAuth, asyncHandler(async (req, res) => {
  const parsed = searchSchema.safeParse(req.body ?? {});
  if (!parsed.success) return validationFail(res, parsed);
  const criteria = normalizeSearchInput(parsed.data);
  if (!criteria) return res.json({ recorded: false });
  const [countRows] = await pool.execute('SELECT COUNT(*) AS total FROM parking_search_history WHERE user_id = ?', [req.user.id]);
  if (Number(countRows[0]?.total ?? 0) >= 500) {
    await pool.execute('DELETE FROM parking_search_history WHERE user_id = ? AND id IN (SELECT id FROM (SELECT id FROM parking_search_history WHERE user_id = ? ORDER BY searched_at ASC LIMIT 50) old_searches)', [req.user.id, req.user.id]);
  }
  await pool.execute('INSERT INTO parking_search_history (id, user_id, query_text, city) VALUES (?, ?, ?, ?)', [randomUUID(), req.user.id, criteria.query, criteria.city]);
  return res.status(201).json({ recorded: true });
}));

router.delete('/search-history/:searchId', requireAuth, asyncHandler(async (req, res) => {
  const parsedId = uuidSchema.safeParse(req.params.searchId);
  if (!parsedId.success) return fail(res, 400, 'INVALID_ID', 'The search history identifier is invalid.');
  const [result] = await pool.execute('DELETE FROM parking_search_history WHERE id = ? AND user_id = ?', [parsedId.data, req.user.id]);
  if (!result.affectedRows) return fail(res, 404, 'SEARCH_NOT_FOUND', 'The saved search was not found.');
  return res.json({ success: true });
}));

router.delete('/search-history', requireAuth, asyncHandler(async (req, res) => {
  const [result] = await pool.execute('DELETE FROM parking_search_history WHERE user_id = ?', [req.user.id]);
  return res.json({ success: true, deletedCount: result.affectedRows });
}));

router.get('/eligible-reviews', requireAuth, asyncHandler(async (req, res) => {
  const [rows] = await pool.execute(
    `SELECT b.id AS booking_id, b.booking_code, b.parking_lot_id, b.start_at, b.end_at, b.total_amount, b.currency,
            l.name AS parking_lot_name, l.city
       FROM bookings b JOIN parking_lots l ON l.id = b.parking_lot_id
       LEFT JOIN parking_reviews rv ON rv.booking_id = b.id AND rv.user_id = b.user_id
      WHERE b.user_id = ? AND b.status = 'completed' AND rv.id IS NULL
        AND (l.owner_user_id IS NULL OR l.owner_user_id <> ?)
      ORDER BY b.end_at DESC LIMIT 50`, [req.user.id, req.user.id]
  );
  return res.json({ bookings: rows.map((row) => ({ bookingId: row.booking_id, bookingCode: row.booking_code, parkingLotId: row.parking_lot_id, parkingLotName: row.parking_lot_name, city: row.city, startAt: row.start_at, endAt: row.end_at, amount: Number(row.total_amount), currency: row.currency })) });
}));

router.get('/reviews/moderation-queue', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const parsed = listSchema.safeParse(req.query);
  if (!parsed.success) return validationFail(res, parsed);
  const [rows] = await pool.execute(
    `SELECT rv.id, rv.parking_lot_id, rv.booking_id, rv.rating, rv.review_title, rv.review_text, rv.status, rv.created_at, rv.updated_at,
            l.name AS parking_lot_name, b.booking_code, u.full_name
       FROM parking_reviews rv
       JOIN parking_lots l ON l.id = rv.parking_lot_id
       JOIN bookings b ON b.id = rv.booking_id
       JOIN users u ON u.id = rv.user_id
      ORDER BY CASE WHEN rv.status = 'published' THEN 0 ELSE 1 END, rv.updated_at DESC LIMIT ?`, [parsed.data.limit]
  );
  return res.json({ reviews: rows.map((row) => ({ ...normalizeReviewRow(row, { includeBookingId: false }), parkingLotName: row.parking_lot_name, status: row.status, bookingCode: row.booking_code })) });
}));

router.get('/my-reviews', requireAuth, asyncHandler(async (req, res) => {
  const parsed = listSchema.safeParse(req.query);
  if (!parsed.success) return validationFail(res, parsed);
  const [rows] = await pool.execute(
    `SELECT rv.id, rv.parking_lot_id, rv.booking_id, rv.rating, rv.review_title, rv.review_text, rv.status, rv.created_at, rv.updated_at,
            l.name AS parking_lot_name, b.booking_code
       FROM parking_reviews rv JOIN parking_lots l ON l.id = rv.parking_lot_id JOIN bookings b ON b.id = rv.booking_id
      WHERE rv.user_id = ? ORDER BY rv.updated_at DESC LIMIT ?`, [req.user.id, parsed.data.limit]
  );
  return res.json({ reviews: rows.map((row) => ({ ...normalizeReviewRow({ ...row, full_name: req.user.fullName }), parkingLotName: row.parking_lot_name, status: row.status, bookingCode: row.booking_code })) });
}));

router.get('/lots/:lotId/reviews', asyncHandler(async (req, res) => {
  const parsedId = uuidSchema.safeParse(req.params.lotId);
  if (!parsedId.success) return fail(res, 400, 'INVALID_ID', 'The parking facility identifier is invalid.');
  const parsedQuery = listSchema.safeParse(req.query);
  if (!parsedQuery.success) return validationFail(res, parsedQuery);
  const [lots] = await pool.execute("SELECT id FROM parking_lots WHERE id = ? AND facility_status = 'active' LIMIT 1", [parsedId.data]);
  if (!lots.length) return fail(res, 404, 'LOT_NOT_FOUND', 'The published parking facility was not found.');
  const [summaryRows] = await pool.execute(
    "SELECT AVG(rating) AS average_rating, COUNT(*) AS review_count FROM parking_reviews WHERE parking_lot_id = ? AND status = 'published'", [parsedId.data]
  );
  const [rows] = await pool.execute(
    `SELECT rv.id, rv.parking_lot_id, rv.booking_id, rv.rating, rv.review_title, rv.review_text, rv.created_at, rv.updated_at, u.full_name
       FROM parking_reviews rv JOIN users u ON u.id = rv.user_id
      WHERE rv.parking_lot_id = ? AND rv.status = 'published'
      ORDER BY rv.created_at DESC LIMIT ?`, [parsedId.data, parsedQuery.data.limit]
  );
  return res.json({
    summary: { averageRating: summaryRows[0].average_rating === null ? null : Number(summaryRows[0].average_rating), reviewCount: Number(summaryRows[0].review_count ?? 0) },
    reviews: rows.map((row) => normalizeReviewRow(row, { includeBookingId: false }))
  });
}));

router.post('/lots/:lotId/reviews', requireAuth, asyncHandler(async (req, res) => {
  const parsedLot = uuidSchema.safeParse(req.params.lotId);
  if (!parsedLot.success) return fail(res, 400, 'INVALID_ID', 'The parking facility identifier is invalid.');
  const parsed = reviewSchema.safeParse(req.body);
  if (!parsed.success) return validationFail(res, parsed);
  const checked = validateReviewInput(parsed.data);
  if (!checked.ok) return fail(res, 400, 'INVALID_REVIEW', checked.error);
  const input = { ...checked.value, bookingId: parsed.data.bookingId };
  const connection = await pool.getConnection();
  const reviewId = randomUUID();
  try {
    await connection.beginTransaction();
    const [lots] = await connection.execute('SELECT id, owner_user_id FROM parking_lots WHERE id = ? LIMIT 1 FOR UPDATE', [parsedLot.data]);
    if (!lots.length) { await connection.rollback(); return fail(res, 404, 'LOT_NOT_FOUND', 'The parking facility was not found.'); }
    if (lots[0].owner_user_id === req.user.id) { await connection.rollback(); return fail(res, 403, 'OWNER_REVIEW_NOT_ALLOWED', 'Parking owners cannot review their own facility.'); }
    const [bookings] = await connection.execute(
      "SELECT id FROM bookings WHERE id = ? AND parking_lot_id = ? AND user_id = ? AND status = 'completed' LIMIT 1 FOR UPDATE",
      [input.bookingId, parsedLot.data, req.user.id]
    );
    if (!bookings.length) { await connection.rollback(); return fail(res, 403, 'REVIEW_REQUIRES_COMPLETED_BOOKING', 'Only a completed booking at this parking facility can be reviewed.'); }
    const [existing] = await connection.execute('SELECT id FROM parking_reviews WHERE booking_id = ? AND user_id = ? LIMIT 1', [input.bookingId, req.user.id]);
    if (existing.length) { await connection.rollback(); return fail(res, 409, 'REVIEW_ALREADY_EXISTS', 'A review already exists for this completed booking.'); }
    await connection.execute(
      'INSERT INTO parking_reviews (id, parking_lot_id, booking_id, user_id, rating, review_title, review_text) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [reviewId, parsedLot.data, input.bookingId, req.user.id, input.rating, input.title, input.text]
    );
    await audit(connection, req.user.id, 'parking.review.created', reviewId, { parkingLotId: parsedLot.data, bookingId: input.bookingId, rating: input.rating });
    await connection.commit();
  } catch (error) {
    await connection.rollback().catch(() => {});
    if (error.code === 'ER_DUP_ENTRY') return fail(res, 409, 'REVIEW_ALREADY_EXISTS', 'A review already exists for this completed booking.');
    throw error;
  } finally { connection.release(); }
  return res.status(201).json({ review: { id: reviewId, parkingLotId: parsedLot.data, bookingId: input.bookingId, rating: input.rating, title: input.title ?? '', text: input.text, status: 'published' } });
}));

router.patch('/reviews/:reviewId', requireAuth, asyncHandler(async (req, res) => {
  const parsedId = uuidSchema.safeParse(req.params.reviewId);
  if (!parsedId.success) return fail(res, 400, 'INVALID_ID', 'The review identifier is invalid.');
  const parsed = updateReviewSchema.safeParse(req.body);
  if (!parsed.success) return validationFail(res, parsed);
  const checked = validateReviewInput(parsed.data);
  if (!checked.ok) return fail(res, 400, 'INVALID_REVIEW', checked.error);
  const [result] = await pool.execute(
    'UPDATE parking_reviews SET rating = ?, review_title = ?, review_text = ? WHERE id = ? AND user_id = ?',
    [checked.value.rating, checked.value.title, checked.value.text, parsedId.data, req.user.id]
  );
  if (!result.affectedRows) {
    const [rows] = await pool.execute('SELECT id FROM parking_reviews WHERE id = ? AND user_id = ? LIMIT 1', [parsedId.data, req.user.id]);
    if (!rows.length) return fail(res, 404, 'REVIEW_NOT_FOUND', 'The review was not found.');
  }
  await audit(pool, req.user.id, 'parking.review.updated', parsedId.data, { rating: checked.value.rating });
  return res.json({ success: true });
}));

router.delete('/reviews/:reviewId', requireAuth, asyncHandler(async (req, res) => {
  const parsedId = uuidSchema.safeParse(req.params.reviewId);
  if (!parsedId.success) return fail(res, 400, 'INVALID_ID', 'The review identifier is invalid.');
  const [rows] = await pool.execute('SELECT id FROM parking_reviews WHERE id = ? AND user_id = ? LIMIT 1', [parsedId.data, req.user.id]);
  if (!rows.length) return fail(res, 404, 'REVIEW_NOT_FOUND', 'The review was not found.');
  await pool.execute('DELETE FROM parking_reviews WHERE id = ? AND user_id = ?', [parsedId.data, req.user.id]);
  await audit(pool, req.user.id, 'parking.review.deleted', parsedId.data);
  return res.json({ success: true });
}));

router.patch('/reviews/:reviewId/moderation', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const parsedId = uuidSchema.safeParse(req.params.reviewId);
  if (!parsedId.success) return fail(res, 400, 'INVALID_ID', 'The review identifier is invalid.');
  const parsed = moderationSchema.safeParse(req.body);
  if (!parsed.success) return validationFail(res, parsed);
  const [result] = await pool.execute('UPDATE parking_reviews SET status = ? WHERE id = ?', [parsed.data.status, parsedId.data]);
  if (!result.affectedRows) {
    const [rows] = await pool.execute('SELECT id FROM parking_reviews WHERE id = ? LIMIT 1', [parsedId.data]);
    if (!rows.length) return fail(res, 404, 'REVIEW_NOT_FOUND', 'The review was not found.');
  }
  await audit(pool, req.user.id, 'parking.review.moderated', parsedId.data, { status: parsed.data.status });
  return res.json({ success: true, status: parsed.data.status });
}));

export default router;
