import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { pool } from '../config/database.js';
import { requireAuth, requireRole } from '../middleware/authenticate.js';

const router = Router();
const asyncHandler = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
const createSchema = z.object({
  code: z.string().trim().min(3).max(32).regex(/^[A-Za-z0-9_-]+$/),
  description: z.string().trim().max(240).default(''),
  discountType: z.enum(['percent', 'fixed']),
  discountValue: z.coerce.number().positive().max(1000000),
  maxDiscountAmount: z.coerce.number().positive().nullable().optional(),
  minBookingAmount: z.coerce.number().min(0).default(0),
  currency: z.string().trim().length(3).default('INR'),
  maxRedemptions: z.coerce.number().int().positive().nullable().optional(),
  maxRedemptionsPerUser: z.coerce.number().int().positive().max(100).default(1),
  startsAt: z.string().datetime({ offset: true }).nullable().optional(),
  endsAt: z.string().datetime({ offset: true }).nullable().optional(),
  isActive: z.boolean().default(true)
}).superRefine((v, ctx) => {
  if (v.discountType === 'percent' && v.discountValue > 100) ctx.addIssue({ code: 'custom', path: ['discountValue'], message: 'Percentage discounts cannot exceed 100%.' });
  if (v.startsAt && v.endsAt && new Date(v.endsAt) <= new Date(v.startsAt)) ctx.addIssue({ code: 'custom', path: ['endsAt'], message: 'End date must be after the start date.' });
});
const statusSchema = z.object({ isActive: z.boolean() });
function fail(res, status, code, message) { return res.status(status).json({ error: { code, message } }); }
function mapPromo(row) { return { id: row.id, code: row.code, description: row.description, discountType: row.discount_type, discountValue: Number(row.discount_value), maxDiscountAmount: row.max_discount_amount === null ? null : Number(row.max_discount_amount), minBookingAmount: Number(row.min_booking_amount), currency: row.currency, maxRedemptions: row.max_redemptions === null ? null : Number(row.max_redemptions), maxRedemptionsPerUser: Number(row.max_redemptions_per_user), startsAt: row.starts_at, endsAt: row.ends_at, isActive: Boolean(row.is_active), createdAt: row.created_at }; }

router.get('/', requireAuth, asyncHandler(async (_req, res) => {
  const [rows] = await pool.execute(`SELECT id, code, description, discount_type, discount_value, max_discount_amount, min_booking_amount, currency, max_redemptions, max_redemptions_per_user, starts_at, ends_at, is_active, created_at FROM promo_codes WHERE is_active = TRUE AND (starts_at IS NULL OR starts_at <= UTC_TIMESTAMP()) AND (ends_at IS NULL OR ends_at > UTC_TIMESTAMP()) ORDER BY created_at DESC LIMIT 50`);
  return res.json({ promotions: rows.map(mapPromo) });
}));

router.post('/validate', requireAuth, asyncHandler(async (req, res) => {
  const code = String(req.body?.code ?? '').trim().toUpperCase();
  const amount = Number(req.body?.amount);
  const currency = String(req.body?.currency ?? 'INR').toUpperCase();
  if (!/^[A-Z0-9_-]{3,32}$/.test(code) || !Number.isFinite(amount) || amount < 0) return fail(res, 400, 'VALIDATION_ERROR', 'Enter a valid code and booking amount.');
  const [rows] = await pool.execute('SELECT * FROM promo_codes WHERE code = ? AND is_active = TRUE LIMIT 1', [code]);
  if (!rows.length) return fail(res, 404, 'PROMO_NOT_FOUND', 'This promotion code is not available.');
  const promo = rows[0];
  const validation = await validatePromo(pool, promo, req.user.id, amount, currency);
  if (!validation.ok) return fail(res, 422, validation.code, validation.message);
  return res.json({ valid: true, code: promo.code, discountAmount: validation.discountAmount, finalAmount: Math.max(0, Math.round((amount - validation.discountAmount) * 100) / 100), description: promo.description });
}));

router.get('/admin', requireAuth, requireRole('admin'), asyncHandler(async (_req, res) => {
  const [rows] = await pool.execute(`SELECT p.*, (SELECT COUNT(*) FROM promo_redemptions r WHERE r.promo_code_id = p.id AND (r.status = 'redeemed' OR (r.status = 'reserved' AND r.expires_at > UTC_TIMESTAMP()))) AS used_count FROM promo_codes p ORDER BY p.created_at DESC LIMIT 200`);
  return res.json({ promotions: rows.map((row) => ({ ...mapPromo(row), usedCount: Number(row.used_count ?? 0) })) });
}));

router.post('/admin', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 400, 'VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Check the promotion fields.');
  const v = parsed.data; const id = randomUUID(); const code = v.code.toUpperCase();
  try {
    await pool.execute(`INSERT INTO promo_codes (id, code, description, discount_type, discount_value, max_discount_amount, min_booking_amount, currency, max_redemptions, max_redemptions_per_user, starts_at, ends_at, is_active, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [id, code, v.description, v.discountType, v.discountValue, v.maxDiscountAmount ?? null, v.minBookingAmount, v.currency.toUpperCase(), v.maxRedemptions ?? null, v.maxRedemptionsPerUser, v.startsAt ? new Date(v.startsAt) : null, v.endsAt ? new Date(v.endsAt) : null, v.isActive, req.user.id]);
  } catch (error) { if (error.code === 'ER_DUP_ENTRY') return fail(res, 409, 'PROMO_CODE_EXISTS', 'A promotion with this code already exists.'); throw error; }
  await pool.execute('INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, metadata) VALUES (?, ?, ?, ?, ?)', [req.user.id, 'promotion.created', 'promo_code', id, JSON.stringify({ code, discountType: v.discountType, discountValue: v.discountValue })]);
  const [rows] = await pool.execute('SELECT * FROM promo_codes WHERE id = ?', [id]);
  return res.status(201).json({ promotion: mapPromo(rows[0]) });
}));

router.patch('/admin/:promoId', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const parsedId = z.string().uuid().safeParse(req.params.promoId); const parsed = statusSchema.safeParse(req.body);
  if (!parsedId.success) return fail(res, 400, 'INVALID_ID', 'The promotion identifier is invalid.');
  if (!parsed.success) return fail(res, 400, 'VALIDATION_ERROR', 'Provide an active/inactive status.');
  const [result] = await pool.execute('UPDATE promo_codes SET is_active = ? WHERE id = ?', [parsed.data.isActive, parsedId.data]);
  if (!result.affectedRows) return fail(res, 404, 'PROMO_NOT_FOUND', 'The promotion was not found.');
  await pool.execute('INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, metadata) VALUES (?, ?, ?, ?, ?)', [req.user.id, 'promotion.status_changed', 'promo_code', parsedId.data, JSON.stringify({ isActive: parsed.data.isActive })]);
  return res.json({ success: true });
}));

export async function validatePromo(executor, promo, userId, amount, currency = 'INR') {
  if (!promo || !promo.is_active) return { ok: false, code: 'PROMO_INACTIVE', message: 'This promotion is not active.' };
  if (String(promo.currency).toUpperCase() !== String(currency).toUpperCase()) return { ok: false, code: 'PROMO_CURRENCY_MISMATCH', message: 'This code is not valid for this booking currency.' };
  const now = Date.now();
  if (promo.starts_at && new Date(promo.starts_at).getTime() > now) return { ok: false, code: 'PROMO_NOT_STARTED', message: 'This promotion has not started yet.' };
  if (promo.ends_at && new Date(promo.ends_at).getTime() <= now) return { ok: false, code: 'PROMO_EXPIRED', message: 'This promotion has expired.' };
  if (amount < Number(promo.min_booking_amount)) return { ok: false, code: 'PROMO_MINIMUM_NOT_MET', message: `This code requires a parking charge of at least ${promo.currency} ${Number(promo.min_booking_amount).toFixed(2)}.` };
  const [usageRows] = await executor.execute(`SELECT COUNT(*) AS used_count FROM promo_redemptions WHERE promo_code_id = ? AND (status = 'redeemed' OR (status = 'reserved' AND expires_at > UTC_TIMESTAMP()))`, [promo.id]);
  if (promo.max_redemptions !== null && Number(usageRows[0]?.used_count ?? 0) >= Number(promo.max_redemptions)) return { ok: false, code: 'PROMO_LIMIT_REACHED', message: 'This promotion has reached its redemption limit.' };
  const [userRows] = await executor.execute(`SELECT COUNT(*) AS used_count FROM promo_redemptions WHERE promo_code_id = ? AND user_id = ? AND (status = 'redeemed' OR (status = 'reserved' AND expires_at > UTC_TIMESTAMP()))`, [promo.id, userId]);
  if (Number(userRows[0]?.used_count ?? 0) >= Number(promo.max_redemptions_per_user)) return { ok: false, code: 'PROMO_USER_LIMIT_REACHED', message: 'You have already used this promotion the maximum number of times.' };
  const rawDiscount = promo.discount_type === 'percent' ? amount * Number(promo.discount_value) / 100 : Number(promo.discount_value);
  const capped = promo.max_discount_amount === null ? rawDiscount : Math.min(rawDiscount, Number(promo.max_discount_amount));
  const discountAmount = Math.max(0, Math.min(amount, Math.round((capped + Number.EPSILON) * 100) / 100));
  return { ok: true, discountAmount };
}

export default router;
