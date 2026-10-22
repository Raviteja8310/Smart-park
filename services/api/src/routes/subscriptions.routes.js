import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { pool } from '../config/database.js';
import { canPurchaseParking } from '../config/env.js';
import { requireAuth, requireRole } from '../middleware/authenticate.js';

const router = Router();
const asyncHandler = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
const SUBSCRIPTION_SCOPE_NOTE = 'Payment collection, recurring billing, and automatic renewal are not implemented in this phase.';
const uuidSchema = z.string().uuid();
const requestSchema = z.object({
  parkingLotId: uuidSchema,
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  monthsCount: z.coerce.number().int().min(1).max(12).default(1)
});
const reviewSchema = z.object({ decision: z.enum(['approved', 'rejected']), note: z.string().trim().max(500).optional().default('') }).superRefine((v, ctx) => {
  if (v.decision === 'rejected' && !v.note) ctx.addIssue({ code: 'custom', path: ['note'], message: 'Provide a reason when rejecting a monthly pass request.' });
});
function fail(res, status, code, message) { return res.status(status).json({ error: { code, message } }); }
function addMonths(dateString, count) {
  const [year, month, day] = dateString.split('-').map(Number);
  const targetMonth = month - 1 + count;
  const targetYear = year + Math.floor(targetMonth / 12);
  const monthIndex = ((targetMonth % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(targetYear, monthIndex + 1, 0)).getUTCDate();
  return `${targetYear}-${String(monthIndex + 1).padStart(2, '0')}-${String(Math.min(day, lastDay)).padStart(2, '0')}`;
}
function mapPass(row) {
  return { id: row.id, parkingLotId: row.parking_lot_id, parkingName: row.parking_name, city: row.city, addressLine: row.address_line,
    ownerUserId: row.owner_user_id, ownerName: row.owner_name ?? null, userId: row.user_id, userName: row.user_name ?? null,
    startDate: row.start_date, endDate: row.end_date, monthsCount: Number(row.months_count), monthlyAmount: Number(row.monthly_amount),
    totalAmount: Number(row.total_amount), currency: row.currency, status: row.status, paymentStatus: row.payment_status,
    ownerNote: row.owner_note ?? '', createdAt: row.created_at, reviewedAt: row.reviewed_at };
}
const passSql = `SELECT s.*, l.name AS parking_name, l.city, l.address_line, u.full_name AS user_name, o.full_name AS owner_name
  FROM parking_subscriptions s JOIN parking_lots l ON l.id = s.parking_lot_id
  JOIN users u ON u.id = s.user_id JOIN users o ON o.id = s.owner_user_id`;

router.get('/available', requireAuth, asyncHandler(async (_req, res) => {
  const [rows] = await pool.execute(`SELECT l.id, l.name, l.city, l.address_line, l.currency,
      (SELECT MIN(pr.amount) FROM pricing_rules pr WHERE pr.parking_lot_id = l.id AND pr.rate_type = 'monthly' AND pr.currency = l.currency AND pr.is_active = TRUE AND (pr.valid_from IS NULL OR pr.valid_from <= UTC_TIMESTAMP()) AND (pr.valid_until IS NULL OR pr.valid_until > UTC_TIMESTAMP())) AS monthly_amount,
      (SELECT u.full_name FROM users u WHERE u.id = l.owner_user_id) AS owner_name
    FROM parking_lots l WHERE l.listing_kind = 'shared_space' AND l.facility_status = 'active' AND l.review_status = 'approved'
    HAVING monthly_amount IS NOT NULL AND monthly_amount > 0 ORDER BY l.city, l.name LIMIT 100`);
  return res.json({ listings: rows.map((row) => ({ id: row.id, name: row.name, city: row.city, addressLine: row.address_line, currency: row.currency, monthlyAmount: Number(row.monthly_amount), ownerName: row.owner_name })) });
}));

router.get('/me', requireAuth, asyncHandler(async (req, res) => {
  const [rows] = await pool.execute(`${passSql} WHERE s.user_id = ? ORDER BY s.created_at DESC LIMIT 100`, [req.user.id]);
  return res.json({ subscriptions: rows.map(mapPass), note: `An approved request is not a paid pass. ${SUBSCRIPTION_SCOPE_NOTE}` });
}));

router.get('/owner', requireAuth, requireRole('host', 'admin'), asyncHandler(async (req, res) => {
  const where = req.user.roles.includes('admin') ? '' : 'WHERE s.owner_user_id = ?';
  const params = req.user.roles.includes('admin') ? [] : [req.user.id];
  const [rows] = await pool.execute(`${passSql} ${where} ORDER BY FIELD(s.status, 'pending','approved','rejected','cancelled','expired'), s.created_at DESC LIMIT 200`, params);
  return res.json({ subscriptions: rows.map(mapPass) });
}));

router.post('/', requireAuth, asyncHandler(async (req, res) => {
  if (!canPurchaseParking(req.user)) return fail(res, 403, 'DRIVER_BOOKINGS_DISABLED', 'Online parking booking is temporarily unavailable. You can still browse parking spaces.');
  const parsed = requestSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 400, 'VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Check the monthly pass details.');
  const { parkingLotId, startDate, monthsCount } = parsed.data;
  const today = new Date().toISOString().slice(0, 10);
  if (startDate < today) return fail(res, 400, 'INVALID_START_DATE', 'The pass start date must be today or later.');
  const connection = await pool.getConnection();
  const id = randomUUID();
  try {
    await connection.beginTransaction();
    const [listings] = await connection.execute(`SELECT l.id, l.owner_user_id, l.name, l.currency,
        (SELECT MIN(pr.amount) FROM pricing_rules pr WHERE pr.parking_lot_id = l.id AND pr.rate_type = 'monthly' AND pr.currency = l.currency AND pr.is_active = TRUE AND (pr.valid_from IS NULL OR pr.valid_from <= UTC_TIMESTAMP()) AND (pr.valid_until IS NULL OR pr.valid_until > UTC_TIMESTAMP())) AS monthly_amount
      FROM parking_lots l WHERE l.id = ? AND l.listing_kind = 'shared_space' AND l.facility_status = 'active' AND l.review_status = 'approved' LIMIT 1 FOR UPDATE`, [parkingLotId]);
    const listing = listings[0];
    if (!listing || listing.monthly_amount === null || Number(listing.monthly_amount) <= 0) { await connection.rollback(); return fail(res, 404, 'MONTHLY_PASS_UNAVAILABLE', 'This approved listing does not offer a monthly pass.'); }
    if (listing.owner_user_id === req.user.id) { await connection.rollback(); return fail(res, 403, 'SELF_SUBSCRIPTION', 'You cannot request a monthly pass for your own listing.'); }
    const endDate = addMonths(startDate, monthsCount);
    const [existing] = await connection.execute(`SELECT id FROM parking_subscriptions WHERE user_id = ? AND parking_lot_id = ? AND status IN ('pending','approved') AND start_date < ? AND end_date > ? LIMIT 1 FOR UPDATE`, [req.user.id, parkingLotId, endDate, startDate]);
    if (existing.length) { await connection.rollback(); return fail(res, 409, 'OVERLAPPING_PASS', 'You already have a pending or approved pass overlapping these dates.'); }
    const monthlyAmount = Number(listing.monthly_amount);
    const totalAmount = Math.round(monthlyAmount * monthsCount * 100) / 100;
    await connection.execute(`INSERT INTO parking_subscriptions (id, user_id, parking_lot_id, owner_user_id, start_date, end_date, months_count, monthly_amount, currency, total_amount, status, payment_status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 'unpaid')`, [id, req.user.id, parkingLotId, listing.owner_user_id, startDate, endDate, monthsCount, monthlyAmount, listing.currency, totalAmount]);
    await connection.execute('INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, metadata) VALUES (?, ?, ?, ?, ?)', [req.user.id, 'subscription.requested', 'parking_subscription', id, JSON.stringify({ parkingLotId, startDate, endDate, monthsCount, totalAmount, currency: listing.currency })]);
    await connection.commit();
    const [rows] = await pool.execute(`${passSql} WHERE s.id = ? LIMIT 1`, [id]);
    return res.status(201).json({ subscription: mapPass(rows[0]), message: 'Monthly pass request sent to the parking owner.' });
  } catch (error) { await connection.rollback().catch(() => {}); throw error; }
  finally { connection.release(); }
}));

router.patch('/:subscriptionId/review', requireAuth, requireRole('host', 'admin'), asyncHandler(async (req, res) => {
  const id = uuidSchema.safeParse(req.params.subscriptionId);
  const parsed = reviewSchema.safeParse(req.body);
  if (!id.success) return fail(res, 400, 'INVALID_ID', 'The monthly pass identifier is invalid.');
  if (!parsed.success) return fail(res, 400, 'VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Check the review decision.');
  const [rows] = await pool.execute('SELECT id, owner_user_id, status, payment_status FROM parking_subscriptions WHERE id = ? LIMIT 1', [id.data]);
  const pass = rows[0];
  if (!pass) return fail(res, 404, 'PASS_NOT_FOUND', 'The monthly pass request was not found.');
  if (!req.user.roles.includes('admin') && pass.owner_user_id !== req.user.id) return fail(res, 403, 'FORBIDDEN', 'You can review only requests for your own parking listings.');
  if (pass.status !== 'pending') return fail(res, 409, 'PASS_ALREADY_REVIEWED', 'Only pending monthly pass requests can be reviewed.');
  const decision = parsed.data.decision;
  const [updatedResult] = await pool.execute('UPDATE parking_subscriptions SET status = ?, owner_note = ?, reviewed_by_user_id = ?, reviewed_at = UTC_TIMESTAMP() WHERE id = ? AND status = \'pending\'', [decision, parsed.data.note || null, req.user.id, id.data]);
  if (!updatedResult.affectedRows) return fail(res, 409, 'PASS_ALREADY_REVIEWED', 'This request was reviewed by another administrator or owner. Refresh the queue.');
  await pool.execute('INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, metadata) VALUES (?, ?, ?, ?, ?)', [req.user.id, `subscription.${decision}`, 'parking_subscription', id.data, JSON.stringify({ note: parsed.data.note || null })]);
  const [updated] = await pool.execute(`${passSql} WHERE s.id = ? LIMIT 1`, [id.data]);
  return res.json({ subscription: mapPass(updated[0]), message: decision === 'approved' ? 'Request approved. Payment is still required before the pass can be considered active.' : 'Request rejected.' });
}));

router.post('/:subscriptionId/cancel', requireAuth, asyncHandler(async (req, res) => {
  const id = uuidSchema.safeParse(req.params.subscriptionId);
  if (!id.success) return fail(res, 400, 'INVALID_ID', 'The monthly pass identifier is invalid.');
  const [rows] = await pool.execute('SELECT id, user_id, status, payment_status FROM parking_subscriptions WHERE id = ? LIMIT 1', [id.data]);
  const pass = rows[0];
  if (!pass || pass.user_id !== req.user.id) return fail(res, 404, 'PASS_NOT_FOUND', 'The monthly pass was not found.');
  if (!['pending', 'approved'].includes(pass.status) || pass.payment_status !== 'unpaid') return fail(res, 409, 'PASS_NOT_CANCELLABLE', 'Only unpaid pending or approved requests can be cancelled. Contact support for paid passes.');
  const [cancelResult] = await pool.execute("UPDATE parking_subscriptions SET status = 'cancelled' WHERE id = ? AND user_id = ? AND status IN ('pending','approved') AND payment_status = 'unpaid'", [id.data, req.user.id]);
  if (!cancelResult.affectedRows) return fail(res, 409, 'PASS_NOT_CANCELLABLE', 'This request changed while you were cancelling it. Refresh and try again.');
  await pool.execute('INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, metadata) VALUES (?, ?, ?, ?, ?)', [req.user.id, 'subscription.cancelled', 'parking_subscription', id.data, JSON.stringify({})]);
  return res.json({ success: true });
}));

export default router;
