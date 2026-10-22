import { Router } from 'express';
import { randomBytes, randomUUID } from 'node:crypto';
import { pool } from '../config/database.js';
import { env } from '../config/env.js';
import { requireAuth } from '../middleware/authenticate.js';

const router = Router();
const asyncHandler = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
const REWARD_AMOUNT = 100;
function fail(res, status, code, message) { return res.status(status).json({ error: { code, message } }); }

async function ensureReferralCode(userId) {
  const [existing] = await pool.execute('SELECT code FROM referral_codes WHERE user_id = ? LIMIT 1', [userId]);
  if (existing.length) return existing[0].code;
  // A collision is extraordinarily unlikely; retry with a fresh cryptographically random code.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const code = `SP${randomBytes(5).toString('hex').toUpperCase()}`;
    try {
      await pool.execute('INSERT INTO referral_codes (user_id, code) VALUES (?, ?)', [userId, code]);
      return code;
    } catch (error) {
      if (error.code !== 'ER_DUP_ENTRY') throw error;
      const [raced] = await pool.execute('SELECT code FROM referral_codes WHERE user_id = ? LIMIT 1', [userId]);
      if (raced.length) return raced[0].code;
    }
  }
  throw new Error('Could not allocate a unique referral code.');
}

router.get('/me', requireAuth, asyncHandler(async (req, res) => {
  const code = await ensureReferralCode(req.user.id);
  const [rows] = await pool.execute(
    `SELECT r.id, r.status, r.created_at, r.qualified_at, u.full_name AS referred_name
       FROM referrals r JOIN users u ON u.id = r.referred_user_id
      WHERE r.referrer_user_id = ? ORDER BY r.created_at DESC LIMIT 100`, [req.user.id]
  );
  const [rewardRows] = await pool.execute(
    `SELECT COALESCE(SUM(CASE WHEN status = 'available' THEN reward_amount ELSE 0 END), 0) AS available,
            COALESCE(SUM(CASE WHEN status = 'reversed' THEN reward_amount ELSE 0 END), 0) AS reversed,
            COUNT(CASE WHEN status = 'available' THEN 1 END) AS reward_count
       FROM referral_rewards WHERE beneficiary_user_id = ?`, [req.user.id]
  );
  const [counts] = await pool.execute(
    `SELECT COUNT(*) AS total, SUM(status = 'qualified') AS qualified, SUM(status = 'pending') AS pending
       FROM referrals WHERE referrer_user_id = ?`, [req.user.id]
  );
  const base = env.WEB_ORIGIN.replace(/\/$/, '');
  return res.json({
    code,
    referralLink: `${base}/?ref=${encodeURIComponent(code)}`,
    rewardPolicy: { amount: REWARD_AMOUNT, currency: 'INR', qualification: 'Both accounts receive SmartPark referral credits after the referred driver completes a paid parking session.' },
    summary: { totalReferrals: Number(counts[0]?.total ?? 0), qualifiedReferrals: Number(counts[0]?.qualified ?? 0), pendingReferrals: Number(counts[0]?.pending ?? 0), availableCredits: Number(rewardRows[0]?.available ?? 0), reversedCredits: Number(rewardRows[0]?.reversed ?? 0), rewardCount: Number(rewardRows[0]?.reward_count ?? 0) },
    referrals: rows.map((row) => ({ id: row.id, referredName: row.referred_name, status: row.status, createdAt: row.created_at, qualifiedAt: row.qualified_at })),
    note: 'Referral credits are an internal ledger balance, not cash and not currently withdrawable.'
  });
}));

router.get('/rewards', requireAuth, asyncHandler(async (req, res) => {
  const [rows] = await pool.execute(
    `SELECT rr.id, rr.reward_amount, rr.currency, rr.status, rr.created_at, r.status AS referral_status
       FROM referral_rewards rr JOIN referrals r ON r.id = rr.referral_id
      WHERE rr.beneficiary_user_id = ? ORDER BY rr.created_at DESC LIMIT 100`, [req.user.id]
  );
  return res.json({ rewards: rows.map((row) => ({ id: row.id, amount: Number(row.reward_amount), currency: row.currency, status: row.status, createdAt: row.created_at, referralStatus: row.referral_status })) });
}));

export async function qualifyReferralForCompletedBooking(executor, booking) {
  const [payments] = await executor.execute(
    `SELECT p.id FROM payments p WHERE p.booking_id = ? AND p.status = 'paid' AND p.verified_at IS NOT NULL LIMIT 1`, [booking.id]
  );
  if (!payments.length) return false;
  const [refunds] = await executor.execute(
    `SELECT id FROM refund_requests WHERE booking_id = ? AND status IN ('requested','processing','manual_review','completed') LIMIT 1`, [booking.id]
  );
  if (refunds.length) return false;
  const [referrals] = await executor.execute(
    `SELECT id, referrer_user_id, referred_user_id FROM referrals WHERE referred_user_id = ? AND status = 'pending' LIMIT 1 FOR UPDATE`, [booking.user_id]
  );
  if (!referrals.length) return false;
  const referral = referrals[0];
  await executor.execute("UPDATE referrals SET status = 'qualified', qualifying_booking_id = ?, qualified_at = UTC_TIMESTAMP() WHERE id = ? AND status = 'pending'", [booking.id, referral.id]);
  await executor.execute(
    `INSERT IGNORE INTO referral_rewards (id, referral_id, beneficiary_user_id, reward_amount, currency, status) VALUES (?, ?, ?, ?, 'INR', 'available'), (?, ?, ?, ?, 'INR', 'available')`,
    [randomUUID(), referral.id, referral.referrer_user_id, REWARD_AMOUNT, randomUUID(), referral.id, referral.referred_user_id, REWARD_AMOUNT]
  );
  await executor.execute('INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, metadata) VALUES (?, ?, ?, ?, ?)', [null, 'referral.qualified', 'referral', referral.id, JSON.stringify({ bookingId: booking.id, rewardAmount: REWARD_AMOUNT, currency: 'INR' })]);
  return true;
}

export default router;
