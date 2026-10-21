import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { pool } from '../config/database.js';
import { requireAuth, requireRole } from '../middleware/authenticate.js';
import { createNotification, notifyAdmins } from '../services/notifications.js';
import {
  addDecimalAmounts,
  canApproveEarning,
  canRequestRefund,
  nextPayoutStatus,
  nextRefundStatus,
  normalizeExternalReference,
  normalizeFinanceNote
} from '../finance/financial-logic.js';

const router = Router();
const asyncHandler = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
const uuidSchema = z.string().uuid();
const refundRequestSchema = z.object({
  paymentId: uuidSchema,
  reason: z.string().trim().min(10).max(500)
});
const noteSchema = z.object({ note: z.string().trim().min(5).max(1000) });
const payoutRequestSchema = z.object({
  currency: z.string().trim().regex(/^[A-Za-z]{3}$/).transform((value) => value.toUpperCase()),
  note: z.string().trim().max(500).optional()
});
const externalRefSchema = z.object({
  externalReference: z.string().trim().min(3).max(180),
  note: z.string().trim().min(10).max(1000)
});

function fail(res, status, code, message, details = undefined) {
  return res.status(status).json({ error: { code, message, ...(details ? { details } : {}) } });
}
function safeUuid(value) { return uuidSchema.safeParse(value); }
function normalizedStatusFilter(value, allowed) {
  if (value === undefined || value === '' || value === 'all') return null;
  return allowed.includes(value) ? value : undefined;
}
async function audit(executor, actorId, action, entityType, entityId, metadata = {}) {
  await executor.execute(
    'INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, metadata) VALUES (?, ?, ?, ?, ?)',
    [actorId ?? null, action, entityType, entityId ?? null, JSON.stringify(metadata)]
  );
}
async function notifyUser(executor, userId, eventType, title, message) {
  return createNotification(executor, { userId, eventType, title, message });
}

function mapRefund(row) {
  return {
    id: row.id,
    paymentId: row.payment_id,
    bookingId: row.booking_id,
    bookingCode: row.booking_code,
    parkingLotName: row.parking_lot_name,
    requestedByUserId: row.requested_by_user_id,
    requesterName: row.requester_name ?? null,
    requesterEmail: row.requester_email ?? null,
    reason: row.reason,
    amount: Number(row.amount),
    currency: row.currency,
    status: row.status,
    providerRefundReference: row.provider_refund_reference ?? null,
    adminNote: row.admin_note ?? null,
    requestedAt: row.requested_at,
    reviewedAt: row.reviewed_at,
    processedAt: row.processed_at
  };
}
function mapPayout(row) {
  return {
    id: row.id,
    ownerUserId: row.owner_user_id,
    ownerName: row.owner_name ?? null,
    ownerEmail: row.owner_email ?? null,
    amount: Number(row.amount),
    currency: row.currency,
    status: row.status,
    ownerNote: row.owner_note ?? null,
    adminNote: row.admin_note ?? null,
    externalReference: row.external_reference ?? null,
    earningCount: Number(row.earning_count ?? 0),
    requestedAt: row.requested_at,
    reviewedAt: row.reviewed_at,
    paidAt: row.paid_at
  };
}

const refundJoin = `SELECT rr.*, p.status AS payment_status, p.needs_reconciliation, p.provider_payment_id,
       b.status AS booking_status, b.start_at, b.end_at, b.slot_id, b.parking_lot_id,
       b.booking_code, l.name AS parking_lot_name,
       requester.full_name AS requester_name, requester.email AS requester_email,
       he.id AS owner_earning_id, he.status AS owner_earning_status
  FROM refund_requests rr
  JOIN payments p ON p.id = rr.payment_id
  JOIN bookings b ON b.id = rr.booking_id
  JOIN parking_lots l ON l.id = b.parking_lot_id
  JOIN users requester ON requester.id = rr.requested_by_user_id
  LEFT JOIN host_earnings he ON he.payment_id = p.id`;

async function restoreHeldEarning(executor, refund) {
  if (!refund.owner_earning_id || !refund.owner_earning_previous_status) return;
  await executor.execute(
    "UPDATE host_earnings SET status = ? WHERE id = ? AND status = 'refund_hold'",
    [refund.owner_earning_previous_status, refund.owner_earning_id]
  );
}

async function validatePayoutAllocations(executor, payout) {
  const [rows] = await executor.execute(
    `SELECT a.amount AS allocated_amount, a.currency AS allocated_currency,
            he.net_amount, he.currency AS earning_currency, he.owner_user_id, he.status AS earning_status
       FROM host_payout_allocations a
       JOIN host_earnings he ON he.id = a.host_earning_id
      WHERE a.payout_request_id = ? FOR UPDATE`, [payout.id]
  );
  if (!rows.length) return 'This payout has no earning allocations; it cannot be processed.';
  if (rows.some((row) => row.owner_user_id !== payout.owner_user_id || row.earning_status !== 'payout_requested' ||
      row.allocated_currency !== payout.currency || row.earning_currency !== payout.currency)) {
    return 'The earning allocations do not match the payout owner, currency or reserved earning state. Reconcile this request before processing.';
  }
  let allocatedTotal;
  let requestedTotal;
  try {
    for (const row of rows) {
      if (addDecimalAmounts([row.allocated_amount]) !== addDecimalAmounts([row.net_amount])) {
        return 'An earning allocation no longer matches the source earning amount. Reconcile this request before processing.';
      }
    }
    allocatedTotal = addDecimalAmounts(rows.map((row) => row.allocated_amount));
    requestedTotal = addDecimalAmounts([payout.amount]);
  } catch {
    return 'The payout amount or allocation contains an invalid decimal value. Reconcile it before processing.';
  }
  if (allocatedTotal !== requestedTotal) return 'The payout total does not match the sum of its reserved earning allocations.';
  return null;
}

async function getPayoutAllocationCount(executor, payoutId) {
  const [rows] = await executor.execute('SELECT COUNT(*) AS allocation_count FROM host_payout_allocations WHERE payout_request_id=?', [payoutId]);
  return Number(rows[0]?.allocation_count ?? 0);
}

async function resolveRefundRequest(req, res, action) {
  const parsedId = safeUuid(req.params.refundId);
  if (!parsedId.success) return fail(res, 400, 'INVALID_ID', 'The refund request identifier is invalid.');
  const parsedBody = noteSchema.safeParse(req.body);
  if (!parsedBody.success) return fail(res, 400, 'NOTE_REQUIRED', 'Provide a note of at least five characters for the financial audit trail.');
  const targetStatus = nextRefundStatus('requested', action);
  if (!targetStatus) return fail(res, 400, 'INVALID_ACTION', 'The requested refund action is not supported.');

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute(`${refundJoin} WHERE rr.id = ? LIMIT 1 FOR UPDATE`, [parsedId.data]);
    const refund = rows[0];
    if (!refund) { await connection.rollback(); return fail(res, 404, 'REFUND_NOT_FOUND', 'The refund request was not found.'); }
    if (refund.status !== 'requested' && !(action === 'reject' && refund.status === 'approved')) {
      await connection.rollback();
      return fail(res, 409, 'REFUND_STATE_CONFLICT', `A refund in ${refund.status} status cannot be ${action === 'approve' ? 'approved' : 'rejected'}.`);
    }
    await connection.execute(
      `UPDATE refund_requests SET status = ?, reviewed_by_user_id = ?, reviewed_at = UTC_TIMESTAMP(3), admin_note = ? WHERE id = ?`,
      [targetStatus, req.user.id, parsedBody.data.note, refund.id]
    );
    if (targetStatus === 'rejected') await restoreHeldEarning(connection, refund);
    await audit(connection, req.user.id, `finance.refund_${targetStatus}`, 'refund_request', refund.id, {
      paymentId: refund.payment_id, bookingId: refund.booking_id, amount: String(refund.amount), currency: refund.currency, note: parsedBody.data.note
    });
    await notifyUser(connection, refund.requested_by_user_id, `finance.refund_${targetStatus}`, `Refund request ${targetStatus}`,
      targetStatus === 'approved'
        ? `Your refund request for booking ${refund.booking_code} was approved. The facility team will process the refund externally and record its reference.`
        : `Your refund request for booking ${refund.booking_code} was rejected. Review the note or contact support if you need clarification.`);
    await connection.commit();
    return res.json({ success: true, refundId: refund.id, status: targetStatus });
  } catch (error) {
    await connection.rollback().catch(() => {});
    if (error?.code === 'ER_DUP_ENTRY') return fail(res, 409, 'REFERENCE_ALREADY_USED', 'This external reference has already been recorded.');
    throw error;
  } finally { connection.release(); }
}

router.post('/refunds', requireAuth, asyncHandler(async (req, res) => {
  const parsed = refundRequestSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 400, 'VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Check the refund request fields.');
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute(
      `SELECT p.id AS payment_id, p.status AS payment_status, p.amount, p.currency, p.needs_reconciliation,
              b.id AS booking_id, b.user_id, b.status AS booking_status, b.start_at, b.booking_code,
              he.id AS owner_earning_id, he.status AS owner_earning_status
         FROM payments p JOIN bookings b ON b.id = p.booking_id
         LEFT JOIN host_earnings he ON he.payment_id = p.id
        WHERE p.id = ? AND b.user_id = ? LIMIT 1 FOR UPDATE`,
      [parsed.data.paymentId, req.user.id]
    );
    const payment = rows[0];
    if (!payment) { await connection.rollback(); return fail(res, 404, 'PAYMENT_NOT_FOUND', 'The payment was not found for your account.'); }
    if (!Number.isFinite(Number(payment.amount)) || Number(payment.amount) <= 0) {
      await connection.rollback();
      return fail(res, 409, 'REFUND_AMOUNT_INVALID', 'This payment has no positive refundable amount.');
    }
    const [existing] = await connection.execute(
      `SELECT status FROM refund_requests WHERE payment_id = ?
        ORDER BY requested_at DESC LIMIT 1 FOR UPDATE`, [payment.payment_id]
    );
    const decision = canRequestRefund({
      paymentStatus: payment.payment_status,
      needsReconciliation: Boolean(payment.needs_reconciliation),
      bookingStatus: payment.booking_status,
      bookingStartAt: payment.start_at,
      hostEarningStatus: payment.owner_earning_status,
      activeRefundStatus: existing[0]?.status ?? null
    });
    if (!decision.ok) { await connection.rollback(); return fail(res, 409, decision.code, decision.message); }

    const refundId = randomUUID();
    await connection.execute(
      `INSERT INTO refund_requests
       (id, payment_id, booking_id, requested_by_user_id, reason, amount, currency, status, owner_earning_id, owner_earning_previous_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'requested', ?, ?)`,
      [refundId, payment.payment_id, payment.booking_id, req.user.id,
        parsed.data.reason, payment.amount, payment.currency, payment.owner_earning_id ?? null,
        ['pending', 'approved'].includes(payment.owner_earning_status) ? payment.owner_earning_status : null]
    );
    if (payment.owner_earning_id && ['pending', 'approved'].includes(payment.owner_earning_status)) {
      await connection.execute("UPDATE host_earnings SET status='refund_hold' WHERE id=? AND status=?", [payment.owner_earning_id, payment.owner_earning_status]);
    }
    await audit(connection, req.user.id, 'finance.refund_requested', 'refund_request', refundId, {
      paymentId: payment.payment_id, bookingId: payment.booking_id, amount: String(payment.amount), currency: payment.currency
    });
    await notifyAdmins(connection, {
      eventType: 'finance.refund_requested', title: 'Customer refund request received',
      message: `Booking ${payment.booking_code} has a refund request awaiting review.`
    });
    await connection.commit();
    return res.status(201).json({ refund: { id: refundId, paymentId: payment.payment_id, bookingId: payment.booking_id, bookingCode: payment.booking_code, amount: Number(payment.amount), currency: payment.currency, status: 'requested', reason: parsed.data.reason } });
  } catch (error) {
    await connection.rollback().catch(() => {});
    if (error?.code === 'ER_DUP_ENTRY') return fail(res, 409, 'REFUND_ALREADY_EXISTS', 'A refund request for this payment already exists. Refresh the page to see its status.');
    throw error;
  } finally { connection.release(); }
}));

router.get('/refunds/mine', requireAuth, asyncHandler(async (req, res) => {
  const [rows] = await pool.execute(
    `${refundJoin} WHERE rr.requested_by_user_id = ? ORDER BY rr.requested_at DESC LIMIT 100`, [req.user.id]
  );
  return res.json({ refunds: rows.map(mapRefund) });
}));

router.get('/refunds/queue', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const status = normalizedStatusFilter(req.query.status, ['requested', 'approved', 'processing', 'succeeded', 'rejected', 'failed', 'manual_review']);
  if (status === undefined) return fail(res, 400, 'INVALID_STATUS', 'The refund status filter is invalid.');
  const limit = Math.max(1, Math.min(200, Number.parseInt(req.query.limit ?? '100', 10) || 100));
  const params = status ? [status, limit] : [limit];
  const [rows] = await pool.execute(
    `${refundJoin} ${status ? 'WHERE rr.status=?' : ''} ORDER BY FIELD(rr.status,'requested','approved','processing','manual_review','failed','succeeded','rejected'), rr.requested_at DESC LIMIT ?`, params
  );
  return res.json({ refunds: rows.map(mapRefund) });
}));

router.post('/refunds/:refundId/approve', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => resolveRefundRequest(req, res, 'approve')));
router.post('/refunds/:refundId/reject', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => resolveRefundRequest(req, res, 'reject')));

router.post('/refunds/:refundId/start-processing', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const parsedId = safeUuid(req.params.refundId);
  const parsed = noteSchema.safeParse(req.body);
  if (!parsedId.success) return fail(res, 400, 'INVALID_ID', 'The refund request identifier is invalid.');
  if (!parsed.success) return fail(res, 400, 'NOTE_REQUIRED', 'Provide a note confirming that the refund has been checked and will be processed externally.');
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [preRows] = await connection.execute('SELECT b.slot_id FROM refund_requests rr JOIN bookings b ON b.id=rr.booking_id WHERE rr.id=? LIMIT 1', [parsedId.data]);
    if (!preRows.length) { await connection.rollback(); return fail(res, 404, 'REFUND_NOT_FOUND', 'The refund request was not found.'); }
    await connection.execute('SELECT id FROM parking_slots WHERE id=? FOR UPDATE', [preRows[0].slot_id]);
    const [rows] = await connection.execute(`${refundJoin} WHERE rr.id=? LIMIT 1 FOR UPDATE`, [parsedId.data]);
    const refund = rows[0];
    if (!refund) { await connection.rollback(); return fail(res, 404, 'REFUND_NOT_FOUND', 'The refund request was not found.'); }
    const targetStatus = nextRefundStatus(refund.status, 'startProcessing');
    if (targetStatus !== 'processing') { await connection.rollback(); return fail(res, 409, 'REFUND_STATE_CONFLICT', 'Only an approved refund can enter processing.'); }
    if (refund.payment_status !== 'paid' || Boolean(refund.needs_reconciliation)) {
      await connection.rollback();
      return fail(res, 409, 'PAYMENT_REQUIRES_RECONCILIATION', 'The payment is not currently eligible for refund processing. Reconcile it first.');
    }
    if (refund.booking_status !== 'confirmed' || new Date(refund.start_at).getTime() <= Date.now()) {
      await connection.rollback();
      return fail(res, 409, 'BOOKING_NOT_ELIGIBLE', 'The booking is no longer eligible for cancellation through this refund workflow.');
    }
    const [sessions] = await connection.execute("SELECT id FROM parking_sessions WHERE booking_id=? AND status='parked' LIMIT 1 FOR UPDATE", [refund.booking_id]);
    if (sessions.length) { await connection.rollback(); return fail(res, 409, 'PARKING_SESSION_ACTIVE', 'This vehicle has an active parking session. Refund processing cannot begin until the session is resolved.'); }
    await connection.execute(
      'UPDATE refund_requests SET status=?, reviewed_by_user_id=?, reviewed_at=COALESCE(reviewed_at,UTC_TIMESTAMP(3)), admin_note=? WHERE id=?',
      [targetStatus, req.user.id, parsed.data.note, refund.id]
    );
    await audit(connection, req.user.id, 'finance.refund_processing_started', 'refund_request', refund.id, { bookingId: refund.booking_id, note: parsed.data.note });
    await notifyUser(connection, refund.requested_by_user_id, 'finance.refund_processing', 'Refund processing started', `Refund processing for booking ${refund.booking_code} has started. Entry is temporarily blocked while this is being resolved.`);
    await connection.commit();
    return res.json({ success: true, refundId: refund.id, status: 'processing', note: 'Perform the refund in the configured payment provider or approved finance process, then record its provider reference in SmartPark. This endpoint does not transfer or refund money itself.' });
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally { connection.release(); }
}));

router.post('/refunds/:refundId/mark-refunded', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const parsedId = safeUuid(req.params.refundId);
  const parsed = externalRefSchema.safeParse(req.body);
  if (!parsedId.success) return fail(res, 400, 'INVALID_ID', 'The refund request identifier is invalid.');
  if (!parsed.success) return fail(res, 400, 'REFUND_REFERENCE_REQUIRED', 'Provide the provider refund reference and a note confirming the external refund was completed.');
  const externalReference = normalizeExternalReference(parsed.data.externalReference);
  const note = normalizeFinanceNote(parsed.data.note, { min: 10, max: 1000 });
  if (!externalReference || !note) return fail(res, 400, 'INVALID_REFERENCE', 'The external reference or note has an invalid format.');

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [preRows] = await connection.execute('SELECT b.slot_id FROM refund_requests rr JOIN bookings b ON b.id=rr.booking_id WHERE rr.id=? LIMIT 1', [parsedId.data]);
    if (!preRows.length) { await connection.rollback(); return fail(res, 404, 'REFUND_NOT_FOUND', 'The refund request was not found.'); }
    await connection.execute('SELECT id FROM parking_slots WHERE id=? FOR UPDATE', [preRows[0].slot_id]);
    const [rows] = await connection.execute(`${refundJoin} WHERE rr.id=? LIMIT 1 FOR UPDATE`, [parsedId.data]);
    const refund = rows[0];
    if (!refund) { await connection.rollback(); return fail(res, 404, 'REFUND_NOT_FOUND', 'The refund request was not found.'); }
    if (refund.status === 'succeeded' && refund.provider_refund_reference === externalReference) { await connection.commit(); return res.json({ success: true, refundId: refund.id, status: 'succeeded', idempotent: true }); }
    const targetStatus = nextRefundStatus(refund.status, 'markSucceeded');
    if (!targetStatus) { await connection.rollback(); return fail(res, 409, 'REFUND_STATE_CONFLICT', 'Only a refund in processing or manual review can be recorded as refunded.'); }
    if (refund.booking_status !== 'confirmed') { await connection.rollback(); return fail(res, 409, 'BOOKING_STATE_CONFLICT', 'The booking state changed while the refund was being processed. Reconcile it manually.'); }
    const [sessions] = await connection.execute("SELECT id FROM parking_sessions WHERE booking_id=? AND status='parked' LIMIT 1 FOR UPDATE", [refund.booking_id]);
    if (sessions.length) { await connection.rollback(); return fail(res, 409, 'PARKING_SESSION_ACTIVE', 'An active parking session exists; contact finance support before completing this refund.'); }
    if (refund.payment_status !== 'paid') { await connection.rollback(); return fail(res, 409, 'PAYMENT_STATE_CONFLICT', 'The underlying payment is not currently recorded as captured. Reconcile it before recording a refund.'); }
    if (Boolean(refund.needs_reconciliation)) { await connection.rollback(); return fail(res, 409, 'PAYMENT_REQUIRES_RECONCILIATION', 'This payment has a separate reconciliation flag. Resolve it before recording the refund as complete.'); }
    const [paymentUpdate] = await connection.execute("UPDATE payments SET status='refunded' WHERE id=? AND status='paid' AND needs_reconciliation=FALSE", [refund.payment_id]);
    if (paymentUpdate.affectedRows !== 1) { await connection.rollback(); return fail(res, 409, 'PAYMENT_STATE_CONFLICT', 'The payment status changed concurrently. Reconcile it before recording the refund.'); }
    const [bookingUpdate] = await connection.execute("UPDATE bookings SET status='cancelled', hold_expires_at=NULL, qr_token_hash=NULL WHERE id=? AND status='confirmed'", [refund.booking_id]);
    if (bookingUpdate.affectedRows !== 1) { await connection.rollback(); return fail(res, 409, 'BOOKING_STATE_CONFLICT', 'The booking status changed concurrently. Reconcile the provider refund before changing the reservation.'); }
    await connection.execute(
      `UPDATE refund_requests SET status=?, provider_refund_reference=?, admin_note=?, reviewed_by_user_id=?,
          processed_at=UTC_TIMESTAMP(3), reviewed_at=COALESCE(reviewed_at,UTC_TIMESTAMP(3)) WHERE id=?`,
      [targetStatus, externalReference, note, req.user.id, refund.id]
    );
    if (refund.owner_earning_id) await connection.execute("UPDATE host_earnings SET status='reversed' WHERE id=? AND status='refund_hold'", [refund.owner_earning_id]);
    await audit(connection, req.user.id, 'finance.refund_recorded_succeeded', 'refund_request', refund.id, {
      paymentId: refund.payment_id, bookingId: refund.booking_id, externalReference, amount: String(refund.amount), currency: refund.currency, note
    });
    await notifyUser(connection, refund.requested_by_user_id, 'finance.refund_succeeded', 'Refund recorded as completed', `The refund for booking ${refund.booking_code} has been recorded as completed. Reference: ${externalReference}.`);
    await connection.commit();
    return res.json({ success: true, refundId: refund.id, status: 'succeeded', externalReference });
  } catch (error) {
    await connection.rollback().catch(() => {});
    if (error?.code === 'ER_DUP_ENTRY') return fail(res, 409, 'REFERENCE_ALREADY_USED', 'This external refund reference has already been recorded.');
    throw error;
  } finally { connection.release(); }
}));

router.post('/refunds/:refundId/mark-failed', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const parsedId = safeUuid(req.params.refundId);
  const parsed = noteSchema.safeParse(req.body);
  if (!parsedId.success) return fail(res, 400, 'INVALID_ID', 'The refund request identifier is invalid.');
  if (!parsed.success) return fail(res, 400, 'NOTE_REQUIRED', 'Provide a note confirming the refund failed or was not submitted to the provider.');
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute(`${refundJoin} WHERE rr.id=? LIMIT 1 FOR UPDATE`, [parsedId.data]);
    const refund = rows[0];
    if (!refund) { await connection.rollback(); return fail(res, 404, 'REFUND_NOT_FOUND', 'The refund request was not found.'); }
    const status = nextRefundStatus(refund.status, 'markFailed');
    if (!status) { await connection.rollback(); return fail(res, 409, 'REFUND_STATE_CONFLICT', 'This refund cannot be marked failed from its current state.'); }
    await connection.execute('UPDATE refund_requests SET status=?, admin_note=?, reviewed_by_user_id=?, processed_at=UTC_TIMESTAMP(3) WHERE id=?', [status, parsed.data.note, req.user.id, refund.id]);
    await restoreHeldEarning(connection, refund);
    await audit(connection, req.user.id, 'finance.refund_failed', 'refund_request', refund.id, { bookingId: refund.booking_id, note: parsed.data.note });
    await notifyUser(connection, refund.requested_by_user_id, 'finance.refund_failed', 'Refund was not completed', `The refund for booking ${refund.booking_code} was not completed. Your reservation remains active if its scheduled time has not passed. Contact support for assistance.`);
    await connection.commit();
    return res.json({ success: true, refundId: refund.id, status: 'failed' });
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally { connection.release(); }
}));

router.post('/refunds/:refundId/manual-review', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const parsedId = safeUuid(req.params.refundId);
  const parsed = noteSchema.safeParse(req.body);
  if (!parsedId.success) return fail(res, 400, 'INVALID_ID', 'The refund request identifier is invalid.');
  if (!parsed.success) return fail(res, 400, 'NOTE_REQUIRED', 'Provide a note describing why the provider result needs manual review.');
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute(`${refundJoin} WHERE rr.id=? LIMIT 1 FOR UPDATE`, [parsedId.data]);
    const refund = rows[0];
    if (!refund) { await connection.rollback(); return fail(res, 404, 'REFUND_NOT_FOUND', 'The refund request was not found.'); }
    const status = nextRefundStatus(refund.status, 'markManualReview');
    if (!status) { await connection.rollback(); return fail(res, 409, 'REFUND_STATE_CONFLICT', 'Only a refund already in processing can enter manual review.'); }
    await connection.execute('UPDATE refund_requests SET status=?, admin_note=?, reviewed_by_user_id=?, reviewed_at=UTC_TIMESTAMP(3) WHERE id=?', [status, parsed.data.note, req.user.id, refund.id]);
    await audit(connection, req.user.id, 'finance.refund_manual_review', 'refund_request', refund.id, { bookingId: refund.booking_id, note: parsed.data.note });
    await notifyUser(connection, refund.requested_by_user_id, 'finance.refund_manual_review', 'Refund needs additional review', `Your refund for booking ${refund.booking_code} needs an additional check. Parking entry remains blocked while finance resolves the payment result.`);
    await connection.commit();
    return res.json({ success: true, refundId: refund.id, status: 'manual_review' });
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally { connection.release(); }
}));

router.get('/payouts/mine', requireAuth, requireRole('host', 'admin'), asyncHandler(async (req, res) => {
  const [rows] = await pool.execute(
    `SELECT hp.*, u.full_name AS owner_name, u.email AS owner_email,
            (SELECT COUNT(*) FROM host_payout_allocations a WHERE a.payout_request_id=hp.id) AS earning_count
       FROM host_payout_requests hp JOIN users u ON u.id=hp.owner_user_id
      WHERE hp.owner_user_id=? ORDER BY hp.requested_at DESC LIMIT 100`, [req.user.id]
  );
  return res.json({ payouts: rows.map(mapPayout), automatedTransferEnabled: false,
    message: 'Payout requests reserve eligible earnings. The actual bank/provider transfer is performed externally and must be recorded with its reference.' });
}));

router.post('/payouts', requireAuth, requireRole('host', 'admin'), asyncHandler(async (req, res) => {
  const parsed = payoutRequestSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 400, 'VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Check the payout request fields.');
  const currency = parsed.data.currency;
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.execute('SELECT id FROM users WHERE id=? FOR UPDATE', [req.user.id]);
    const [earnings] = await connection.execute(
      "SELECT id, net_amount, currency FROM host_earnings WHERE owner_user_id=? AND status='approved' AND currency=? AND net_amount > 0 ORDER BY created_at, id FOR UPDATE",
      [req.user.id, currency]
    );
    if (!earnings.length) { await connection.rollback(); return fail(res, 409, 'NO_APPROVED_EARNINGS', `There are no approved ${currency} earnings available for payout.`); }
    const amountText = addDecimalAmounts(earnings.map((row) => row.net_amount));
    const amount = Number(amountText);
    if (!Number.isFinite(amount) || amount <= 0) { await connection.rollback(); return fail(res, 409, 'NO_PAYOUT_BALANCE', 'There is no positive approved payout balance.'); }
    const payoutId = randomUUID();
    await connection.execute(
      "INSERT INTO host_payout_requests (id, owner_user_id, amount, currency, status, owner_note) VALUES (?, ?, ?, ?, 'requested', ?)",
      [payoutId, req.user.id, amountText, currency, parsed.data.note?.trim() || null]
    );
    for (const earning of earnings) {
      await connection.execute(
        'INSERT INTO host_payout_allocations (id, payout_request_id, host_earning_id, amount, currency) VALUES (?, ?, ?, ?, ?)',
        [randomUUID(), payoutId, earning.id, earning.net_amount, currency]
      );
    }
    const ids = earnings.map((row) => row.id);
    const [reserved] = await connection.execute(`UPDATE host_earnings SET status='payout_requested' WHERE status='approved' AND id IN (${ids.map(() => '?').join(',')})`, ids);
    if (reserved.affectedRows !== earnings.length) {
      await connection.rollback();
      return fail(res, 409, 'PAYOUT_ALLOCATION_STATE_CHANGED', 'Not all approved earnings could be reserved. Refresh the balance and try again.');
    }
    await audit(connection, req.user.id, 'finance.payout_requested', 'host_payout_request', payoutId, { amount: amountText, currency, earningCount: earnings.length });
    await notifyAdmins(connection, { eventType: 'finance.payout_requested', title: 'Host payout request received', message: `A host requested a ${currency} ${amountText} payout across ${earnings.length} earning records.` });
    await connection.commit();
    return res.status(201).json({ payout: { id: payoutId, amount, currency, status: 'requested', earningCount: earnings.length }, message: 'Your approved earnings have been reserved for this request. This does not initiate a bank transfer.' });
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally { connection.release(); }
}));

router.get('/payouts/queue', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const status = normalizedStatusFilter(req.query.status, ['requested', 'approved', 'paid', 'rejected', 'failed', 'manual_review']);
  if (status === undefined) return fail(res, 400, 'INVALID_STATUS', 'The payout status filter is invalid.');
  const limit = Math.max(1, Math.min(200, Number.parseInt(req.query.limit ?? '100', 10) || 100));
  const params = status ? [status, limit] : [limit];
  const [rows] = await pool.execute(
    `SELECT hp.*, u.full_name AS owner_name, u.email AS owner_email,
            (SELECT COUNT(*) FROM host_payout_allocations a WHERE a.payout_request_id=hp.id) AS earning_count
       FROM host_payout_requests hp JOIN users u ON u.id=hp.owner_user_id
      ${status ? 'WHERE hp.status=?' : ''}
      ORDER BY FIELD(hp.status,'requested','approved','manual_review','failed','paid','rejected'), hp.requested_at DESC LIMIT ?`, params
  );
  return res.json({ payouts: rows.map(mapPayout) });
}));

router.get('/earnings/queue', requireAuth, requireRole('admin'), asyncHandler(async (_req, res) => {
  const [rows] = await pool.execute(
    `SELECT he.id, he.booking_id, he.payment_id, he.owner_user_id, he.parking_lot_id, he.gross_amount,
            he.discount_amount, he.net_amount, he.platform_fee_amount, he.currency, he.status, he.created_at,
            b.booking_code, b.status AS booking_status, b.start_at, b.end_at,
            l.name AS parking_lot_name, u.full_name AS owner_name, u.email AS owner_email,
            p.status AS payment_status, p.needs_reconciliation
       FROM host_earnings he JOIN bookings b ON b.id=he.booking_id
       JOIN parking_lots l ON l.id=he.parking_lot_id JOIN users u ON u.id=he.owner_user_id
       JOIN payments p ON p.id=he.payment_id
      WHERE he.status='pending' ORDER BY he.created_at ASC LIMIT 200`
  );
  return res.json({ earnings: rows.map((row) => ({ ...row,
    grossAmount: Number(row.gross_amount), discountAmount: Number(row.discount_amount), netAmount: Number(row.net_amount),
    platformFeeAmount: Number(row.platform_fee_amount), needsReconciliation: Boolean(row.needs_reconciliation),
    eligibleForApproval: row.payment_status === 'paid' && !row.needs_reconciliation && row.booking_status === 'completed'
  })) });
}));

router.post('/earnings/:earningId/approve', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const parsedId = safeUuid(req.params.earningId);
  if (!parsedId.success) return fail(res, 400, 'INVALID_ID', 'The earning identifier is invalid.');
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute(
      `SELECT he.*, b.status AS booking_status, p.status AS payment_status, p.needs_reconciliation
         FROM host_earnings he JOIN bookings b ON b.id=he.booking_id JOIN payments p ON p.id=he.payment_id
        WHERE he.id=? LIMIT 1 FOR UPDATE`, [parsedId.data]
    );
    const earning = rows[0];
    if (!earning) { await connection.rollback(); return fail(res, 404, 'EARNING_NOT_FOUND', 'The earning record was not found.'); }
    const eligibility = canApproveEarning({ earningStatus: earning.status, paymentStatus: earning.payment_status, needsReconciliation: Boolean(earning.needs_reconciliation), bookingStatus: earning.booking_status });
    if (!eligibility.ok) { await connection.rollback(); return fail(res, 409, eligibility.code, eligibility.code === 'BOOKING_NOT_COMPLETED' ? 'Host earnings can only be approved after a booking is completed.' : 'This earning is not eligible for approval in its current state.'); }
    await connection.execute("UPDATE host_earnings SET status='approved' WHERE id=? AND status='pending'", [earning.id]);
    await audit(connection, req.user.id, 'finance.host_earning_approved', 'host_earning', earning.id, { bookingId: earning.booking_id, amount: String(earning.net_amount), currency: earning.currency });
    await notifyUser(connection, earning.owner_user_id, 'finance.earning_approved', 'Host earning approved', `Earnings for a completed booking were approved for payout review: ${earning.currency} ${earning.net_amount}.`);
    await connection.commit();
    return res.json({ success: true, earningId: earning.id, status: 'approved' });
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally { connection.release(); }
}));

router.post('/earnings/:earningId/reverse', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const parsedId = safeUuid(req.params.earningId);
  const parsed = noteSchema.safeParse(req.body);
  if (!parsedId.success) return fail(res, 400, 'INVALID_ID', 'The earning identifier is invalid.');
  if (!parsed.success) return fail(res, 400, 'NOTE_REQUIRED', 'Provide a reason of at least five characters.');
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute("SELECT id, booking_id, owner_user_id, status, currency, net_amount FROM host_earnings WHERE id=? LIMIT 1 FOR UPDATE", [parsedId.data]);
    const earning = rows[0];
    if (!earning) { await connection.rollback(); return fail(res, 404, 'EARNING_NOT_FOUND', 'The earning record was not found.'); }
    if (!['pending', 'approved'].includes(earning.status)) { await connection.rollback(); return fail(res, 409, 'EARNING_STATE_CONFLICT', 'Only pending or approved earnings can be reversed by this review action.'); }
    await connection.execute("UPDATE host_earnings SET status='reversed' WHERE id=?", [earning.id]);
    await audit(connection, req.user.id, 'finance.host_earning_reversed', 'host_earning', earning.id, { bookingId: earning.booking_id, amount: String(earning.net_amount), currency: earning.currency, note: parsed.data.note });
    await connection.commit();
    return res.json({ success: true, earningId: earning.id, status: 'reversed' });
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally { connection.release(); }
}));

async function reviewPayout(req, res, action) {
  const parsedId = safeUuid(req.params.payoutId);
  if (!parsedId.success) return fail(res, 400, 'INVALID_ID', 'The payout request identifier is invalid.');
  const schema = action === 'markPaid' ? externalRefSchema : noteSchema;
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return fail(res, 400, action === 'markPaid' ? 'TRANSFER_REFERENCE_REQUIRED' : 'NOTE_REQUIRED', action === 'markPaid' ? 'Record the external bank/provider transfer reference and a note.' : 'Provide an audit note of at least five characters.');
  const externalReference = action === 'markPaid' ? normalizeExternalReference(parsed.data.externalReference) : null;
  const note = action === 'markPaid' ? normalizeFinanceNote(parsed.data.note, { min: 10, max: 1000 }) : parsed.data.note.trim();
  if (action === 'markPaid' && (!externalReference || !note)) return fail(res, 400, 'INVALID_REFERENCE', 'The external transfer reference or note has an invalid format.');

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute('SELECT * FROM host_payout_requests WHERE id=? LIMIT 1 FOR UPDATE', [parsedId.data]);
    const payout = rows[0];
    if (!payout) { await connection.rollback(); return fail(res, 404, 'PAYOUT_NOT_FOUND', 'The payout request was not found.'); }
    if (action === 'markPaid' && payout.status === 'paid' && payout.external_reference === externalReference) {
      await connection.commit();
      return res.json({ success: true, payoutId: payout.id, status: 'paid', externalReference, idempotent: true });
    }
    const target = nextPayoutStatus(payout.status, action);
    if (!target) { await connection.rollback(); return fail(res, 409, 'PAYOUT_STATE_CONFLICT', `A payout in ${payout.status} status cannot complete this action.`); }
    const allocationIssue = await validatePayoutAllocations(connection, payout);
    if (allocationIssue) { await connection.rollback(); return fail(res, 409, 'PAYOUT_ALLOCATION_MISMATCH', allocationIssue); }

    if (action === 'reject' || action === 'markFailed') {
      const [released] = await connection.execute('UPDATE host_earnings he JOIN host_payout_allocations a ON a.host_earning_id=he.id SET he.status=\'approved\' WHERE a.payout_request_id=? AND he.status=\'payout_requested\'', [payout.id]);
      if (released.affectedRows !== (await getPayoutAllocationCount(connection, payout.id))) { await connection.rollback(); return fail(res, 409, 'PAYOUT_ALLOCATION_STATE_CHANGED', 'Not all payout earnings could be released. Reconcile this payout before retrying.'); }
      await connection.execute('UPDATE host_payout_requests SET status=?, admin_note=?, reviewed_by_user_id=?, reviewed_at=UTC_TIMESTAMP(3) WHERE id=?', [target, note, req.user.id, payout.id]);
    } else if (action === 'approve') {
      await connection.execute("UPDATE host_payout_requests SET status='approved', admin_note=?, reviewed_by_user_id=?, reviewed_at=UTC_TIMESTAMP(3) WHERE id=?", [note, req.user.id, payout.id]);
    } else if (action === 'markManualReview') {
      await connection.execute("UPDATE host_payout_requests SET status='manual_review', admin_note=?, reviewed_by_user_id=?, reviewed_at=UTC_TIMESTAMP(3) WHERE id=?", [note, req.user.id, payout.id]);
    } else if (action === 'markPaid') {
      await connection.execute("UPDATE host_payout_requests SET status='paid', external_reference=?, admin_note=?, paid_by_user_id=?, paid_at=UTC_TIMESTAMP(3), reviewed_by_user_id=COALESCE(reviewed_by_user_id,?), reviewed_at=COALESCE(reviewed_at,UTC_TIMESTAMP(3)) WHERE id=?", [externalReference, note, req.user.id, req.user.id, payout.id]);
      const [settled] = await connection.execute(
        `UPDATE host_earnings he JOIN host_payout_allocations a ON a.host_earning_id=he.id
            SET he.status='paid', he.settlement_reference=?, he.settled_at=UTC_TIMESTAMP()
          WHERE a.payout_request_id=? AND he.status='payout_requested'`, [externalReference, payout.id]
      );
      if (settled.affectedRows !== (await getPayoutAllocationCount(connection, payout.id))) {
        await connection.rollback();
        return fail(res, 409, 'PAYOUT_ALLOCATION_STATE_CHANGED', 'Not all payout earnings were settled in the database. Verify the external transfer and reconcile this payout before retrying.');
      }
    } else {
      await connection.rollback();
      return fail(res, 400, 'INVALID_ACTION', 'The payout action is not supported.');
    }
    await audit(connection, req.user.id, `finance.payout_${target}`, 'host_payout_request', payout.id, {
      amount: String(payout.amount), currency: payout.currency, externalReference, note
    });
    await notifyUser(connection, payout.owner_user_id, `finance.payout_${target}`, `Host payout ${target}`, target === 'paid'
      ? `A ${payout.currency} ${payout.amount} payout was recorded as paid. Reference: ${externalReference}.`
      : target === 'approved'
        ? `Your ${payout.currency} ${payout.amount} payout request was approved. The actual transfer must be performed externally.`
        : `Your ${payout.currency} ${payout.amount} payout request is ${target}. Review the note or contact support.`);
    await connection.commit();
    return res.json({ success: true, payoutId: payout.id, status: target, externalReference });
  } catch (error) {
    await connection.rollback().catch(() => {});
    if (error?.code === 'ER_DUP_ENTRY') return fail(res, 409, 'REFERENCE_ALREADY_USED', 'This external reference has already been recorded.');
    throw error;
  } finally { connection.release(); }
}

router.post('/payouts/:payoutId/approve', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => reviewPayout(req, res, 'approve')));
router.post('/payouts/:payoutId/reject', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => reviewPayout(req, res, 'reject')));
router.post('/payouts/:payoutId/mark-paid', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => reviewPayout(req, res, 'markPaid')));
router.post('/payouts/:payoutId/mark-failed', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => reviewPayout(req, res, 'markFailed')));
router.post('/payouts/:payoutId/manual-review', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => reviewPayout(req, res, 'markManualReview')));

export default router;
