import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { env } from '../config/env.js';
import { pool } from '../config/database.js';
import { requireAuth } from '../middleware/authenticate.js';
import { createBookingTicket } from '../tickets/ticket.js';
import { createNotification } from '../services/notifications.js';
import {
  constantTimeStringEqual,
  sha256Hex,
  toMinorUnits,
  validateCapturedPayment,
  verifyRazorpayCheckoutSignature,
  verifyRazorpayWebhookSignature
} from '../payments/payment-logic.js';

const router = Router();
const asyncHandler = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
const uuidSchema = z.string().uuid();
const orderSchema = z.object({ bookingId: uuidSchema });
const verifySchema = z.object({
  bookingId: uuidSchema,
  razorpay_order_id: z.string().trim().min(5).max(180),
  razorpay_payment_id: z.string().trim().min(5).max(180),
  razorpay_signature: z.string().trim().regex(/^[a-f0-9]{64}$/i)
});
const mockCompleteSchema = z.object({ paymentId: uuidSchema });

class PaymentError extends Error {
  constructor(status, code, message, details = undefined) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function fail(res, status, code, message, details = undefined) {
  return res.status(status).json({ error: { code, message, ...(details ? { details } : {}) } });
}
function validationFail(res, parsed) {
  return fail(res, 400, 'VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Check the submitted fields.');
}
function mapPayment(row) {
  return {
    id: row.id,
    bookingId: row.booking_id,
    bookingCode: row.booking_code ?? null,
    parkingLotName: row.parking_lot_name ?? null,
    bookingStatus: row.booking_status ?? null,
    bookingStartAt: row.booking_start_at ? new Date(row.booking_start_at).toISOString() : null,
    bookingEndAt: row.booking_end_at ? new Date(row.booking_end_at).toISOString() : null,
    provider: row.provider,
    providerOrderId: row.provider_order_id,
    providerPaymentId: row.provider_payment_id,
    amount: Number(row.amount),
    currency: row.currency,
    status: row.status,
    requiresReview: Boolean(row.needs_reconciliation),
    verifiedAt: row.verified_at ? new Date(row.verified_at).toISOString() : null,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null
  };
}
function razorpayAuthHeader() {
  return `Basic ${Buffer.from(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`).toString('base64')}`;
}

async function razorpayRequest(path, options = {}) {
  const response = await fetch(`https://api.razorpay.com/v1${path}`, {
    ...options,
    headers: {
      Authorization: razorpayAuthHeader(),
      'Content-Type': 'application/json',
      ...(options.headers ?? {})
    },
    signal: AbortSignal.timeout(15000)
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error('The payment provider could not complete the request.');
    error.providerCode = body?.error?.code ?? `HTTP_${response.status}`;
    error.statusCode = response.status;
    throw error;
  }
  return body;
}

async function lockBookingForCheckout(connection, bookingId, userId) {
  const [initialRows] = await connection.execute(
    'SELECT slot_id FROM bookings WHERE id = ? AND user_id = ? LIMIT 1',
    [bookingId, userId]
  );
  if (!initialRows.length) throw new PaymentError(404, 'BOOKING_NOT_FOUND', 'The reservation was not found.');
  await connection.execute('SELECT id FROM parking_slots WHERE id = ? FOR UPDATE', [initialRows[0].slot_id]);
  const [rows] = await connection.execute(
    `SELECT b.*, l.name AS parking_lot_name, l.currency AS lot_currency, s.slot_code,
            u.full_name, u.email
       FROM bookings b
       JOIN parking_lots l ON l.id = b.parking_lot_id
       JOIN parking_slots s ON s.id = b.slot_id
       JOIN users u ON u.id = b.user_id
      WHERE b.id = ? AND b.user_id = ? LIMIT 1 FOR UPDATE`,
    [bookingId, userId]
  );
  if (!rows.length) throw new PaymentError(404, 'BOOKING_NOT_FOUND', 'The reservation was not found.');
  return rows[0];
}

async function getPaymentRow(executor, paymentId, lock = false) {
  const [rows] = await executor.execute(
    `SELECT p.*, b.user_id, b.status AS booking_status, b.booking_code, b.slot_id,
            b.parking_lot_id, b.start_at, b.end_at, b.hold_expires_at, b.qr_token_hash,
            l.name AS parking_lot_name, l.city, l.facility_status, s.slot_code,
            s.physical_state, s.operational_status
       FROM payments p
       JOIN bookings b ON b.id = p.booking_id
       JOIN parking_lots l ON l.id = b.parking_lot_id
       JOIN parking_slots s ON s.id = b.slot_id
      WHERE p.id = ? LIMIT 1${lock ? ' FOR UPDATE' : ''}`,
    [paymentId]
  );
  return rows[0] ?? null;
}

async function findPaymentForBooking(bookingId, userId, providerOrderId) {
  const [rows] = await pool.execute(
    `SELECT p.*, b.user_id, b.status AS booking_status, b.booking_code,
            l.name AS parking_lot_name
       FROM payments p JOIN bookings b ON b.id = p.booking_id
       JOIN parking_lots l ON l.id = b.parking_lot_id
      WHERE b.id = ? AND b.user_id = ? AND p.provider = 'razorpay' AND p.provider_order_id = ?
      LIMIT 1`,
    [bookingId, userId, providerOrderId]
  );
  return rows[0] ?? null;
}

async function createRazorpayOrder({ payment, booking }) {
  const amount = toMinorUnits(payment.amount, payment.currency);
  const receipt = `${String(booking.booking_code).slice(0, 18)}-${payment.id.slice(0, 12)}`.slice(0, 40);
  return razorpayRequest('/orders', {
    method: 'POST',
    body: JSON.stringify({
      amount,
      currency: payment.currency,
      receipt,
      notes: { smartpark_payment_id: payment.id, smartpark_booking_id: booking.id, smartpark_booking_code: booking.booking_code }
    })
  });
}

async function buildOrderResponse(payment, booking) {
  const amountMinor = toMinorUnits(payment.amount, payment.currency);
  return {
    payment: {
      id: payment.id,
      bookingId: payment.booking_id,
      bookingCode: booking.booking_code,
      provider: payment.provider,
      providerOrderId: payment.provider_order_id,
      amount: Number(payment.amount),
      amountMinor,
      currency: payment.currency,
      status: payment.status
    },
    checkout: payment.provider === 'razorpay' ? {
      provider: 'razorpay',
      keyId: env.RAZORPAY_KEY_ID,
      orderId: payment.provider_order_id,
      amount: amountMinor,
      currency: payment.currency,
      name: 'SmartPark',
      description: `Parking reservation ${booking.booking_code}`,
      prefill: { name: booking.full_name ?? '', email: booking.email ?? '' },
      theme: { color: '#1a765d' }
    } : {
      provider: 'mock',
      orderId: payment.provider_order_id,
      amount: amountMinor,
      currency: payment.currency,
      testMode: true
    }
  };
}

router.post('/orders', requireAuth, asyncHandler(async (req, res) => {
  const parsed = orderSchema.safeParse(req.body);
  if (!parsed.success) return validationFail(res, parsed);
  if (env.PAYMENT_PROVIDER === 'mock' && env.NODE_ENV === 'production') {
    return fail(res, 503, 'PAYMENTS_NOT_CONFIGURED', 'A production payment provider must be configured before checkout can be used.');
  }
  const connection = await pool.getConnection();
  let newPayment = null;
  let bookingForProvider = null;
  try {
    await connection.beginTransaction();
    const booking = await lockBookingForCheckout(connection, parsed.data.bookingId, req.user.id);
    const now = Date.now();
    const holdExpires = booking.hold_expires_at ? new Date(booking.hold_expires_at).getTime() : 0;

    if (booking.status === 'confirmed' || booking.status === 'checked_in' || booking.status === 'completed') {
      throw new PaymentError(409, 'BOOKING_ALREADY_CONFIRMED', 'This reservation has already been confirmed. Open its QR ticket instead.');
    }
    if (booking.status === 'cancelled' || booking.status === 'payment_failed') {
      throw new PaymentError(409, 'BOOKING_NOT_PAYABLE', 'This reservation is no longer eligible for payment.');
    }
    if (['held', 'pending_payment'].includes(booking.status) && (!holdExpires || holdExpires <= now)) {
      await connection.execute("UPDATE bookings SET status = 'expired', hold_expires_at = NULL WHERE id = ? AND status IN ('held','pending_payment')", [booking.id]);
      await connection.commit();
      return fail(res, 409, 'HOLD_EXPIRED', 'This reservation hold has expired. Create a new hold before paying.');
    }
    if (!['held', 'pending_payment'].includes(booking.status)) {
      throw new PaymentError(409, 'BOOKING_NOT_PAYABLE', 'This reservation is no longer eligible for payment.');
    }

    const [existingRows] = await connection.execute(
      `SELECT * FROM payments WHERE booking_id = ? AND status IN ('created','pending')
        ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
      [booking.id]
    );
    if (existingRows.length) {
      const existing = existingRows[0];
      if (existing.provider !== env.PAYMENT_PROVIDER) {
        throw new PaymentError(409, 'PAYMENT_PROVIDER_CHANGED', 'A checkout attempt already exists with another payment provider. Wait for it to expire or contact support.');
      }
      if (existing.provider_order_id && existing.status === 'pending') {
        await connection.commit();
        return res.json(await buildOrderResponse(existing, booking));
      }
      throw new PaymentError(409, 'PAYMENT_ORDER_PROCESSING', 'A payment order is being prepared. Please retry in a few seconds.');
    }

    const paymentId = randomUUID();
    const idempotencyKey = `sp-${paymentId}`;
    await connection.execute(
      `INSERT INTO payments (id, booking_id, provider, amount, currency, status, idempotency_key)
       VALUES (?, ?, ?, ?, ?, 'created', ?)`,
      [paymentId, booking.id, env.PAYMENT_PROVIDER, booking.total_amount, booking.currency, idempotencyKey]
    );
    await connection.execute("UPDATE bookings SET status = 'pending_payment' WHERE id = ?", [booking.id]);
    await connection.execute(
      'INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, metadata) VALUES (?, ?, ?, ?, ?)',
      [req.user.id, 'payment.order_requested', 'booking', booking.id, JSON.stringify({ paymentId, provider: env.PAYMENT_PROVIDER })]
    );
    await connection.commit();

    newPayment = { id: paymentId, booking_id: booking.id, provider: env.PAYMENT_PROVIDER, provider_order_id: null, amount: Number(booking.total_amount), currency: booking.currency, status: 'created', idempotency_key: idempotencyKey };
    bookingForProvider = booking;
  } catch (error) {
    await connection.rollback().catch(() => {});
    if (error instanceof PaymentError) return fail(res, error.status, error.code, error.message, error.details);
    throw error;
  } finally {
    connection.release();
  }

  try {
    if (env.PAYMENT_PROVIDER === 'mock') {
      newPayment.provider_order_id = `mock_order_${newPayment.id}`;
    } else {
      const providerOrder = await createRazorpayOrder({ payment: newPayment, booking: bookingForProvider });
      newPayment.provider_order_id = providerOrder.id;
      const expectedAmount = toMinorUnits(newPayment.amount, newPayment.currency);
      if (Number(providerOrder.amount) !== expectedAmount || String(providerOrder.currency).toUpperCase() !== String(newPayment.currency).toUpperCase()) {
        throw new Error('The payment provider returned an order with an unexpected amount or currency.');
      }
    }
    newPayment.status = 'pending';
    await pool.execute(
      "UPDATE payments SET provider_order_id = ?, status = 'pending' WHERE id = ? AND status = 'created'",
      [newPayment.provider_order_id, newPayment.id]
    );
    return res.status(201).json(await buildOrderResponse(newPayment, bookingForProvider));
  } catch (error) {
    await pool.execute("UPDATE payments SET status = 'failed' WHERE id = ? AND status = 'created'", [newPayment.id]).catch(() => {});
    await pool.execute(
      `UPDATE bookings SET status = CASE WHEN hold_expires_at > UTC_TIMESTAMP() THEN 'held' ELSE 'expired' END
        WHERE id = ? AND status = 'pending_payment'`,
      [newPayment.booking_id]
    ).catch(() => {});
    console.error('Payment order creation failed:', error?.providerCode ?? error?.message ?? error);
    return fail(res, 502, 'PAYMENT_ORDER_FAILED', 'The payment order could not be created. Your card or bank account has not been charged by SmartPark. Please retry.');
  }
}));

/**
 * Shared captured-payment fulfillment path. It locks the physical slot before
 * the booking so that a late capture cannot silently overlap another confirmed
 * reservation. If money is captured after the hold is lost, it marks the
 * booking for review instead of issuing an invalid QR ticket.
 */
export async function settleCapturedPayment({ paymentId, provider, providerOrderId, providerPaymentId, capturedAmount, capturedCurrency, capturedStatus = 'captured', source = 'verify' }) {
  const connection = await pool.getConnection();
  try {
    const [initialRows] = await connection.execute(
      `SELECT b.slot_id FROM payments p JOIN bookings b ON b.id = p.booking_id WHERE p.id = ? LIMIT 1`,
      [paymentId]
    );
    if (!initialRows.length) throw new PaymentError(404, 'PAYMENT_NOT_FOUND', 'The payment record was not found.');
    await connection.beginTransaction();
    const [lockedSlotRows] = await connection.execute('SELECT id, physical_state, operational_status FROM parking_slots WHERE id = ? FOR UPDATE', [initialRows[0].slot_id]);
    const lockedSlot = lockedSlotRows[0];
    const row = await getPaymentRow(connection, paymentId, true);
    if (!row || row.provider !== provider) throw new PaymentError(404, 'PAYMENT_NOT_FOUND', 'The payment record was not found for this provider.');
    if (row.provider_order_id !== providerOrderId) throw new PaymentError(400, 'ORDER_MISMATCH', 'The payment does not match this checkout order.');

    const validCapture = validateCapturedPayment({
      expectedAmount: row.amount,
      expectedCurrency: row.currency,
      capturedAmount,
      capturedCurrency,
      providerOrderId,
      expectedProviderOrderId: row.provider_order_id,
      capturedStatus
    });
    if (!validCapture.ok) throw new PaymentError(409, validCapture.code, 'The provider payment details do not match the expected order amount, currency or captured state.');

    if (row.status === 'paid') {
      if (row.provider_payment_id && providerPaymentId && row.provider_payment_id !== providerPaymentId) {
        throw new PaymentError(409, 'PAYMENT_ID_MISMATCH', 'This checkout was already fulfilled by a different provider payment.');
      }
      await connection.commit();
      return { paid: true, bookingId: row.booking_id, bookingCode: row.booking_code, bookingStatus: row.booking_status, requiresReview: Boolean(row.needs_reconciliation) || row.booking_status === 'payment_failed' || row.booking_status === 'cancelled', alreadyProcessed: true };
    }

    const [duplicatePayment] = await connection.execute(
      'SELECT id FROM payments WHERE provider = ? AND provider_payment_id = ? AND id <> ? LIMIT 1',
      [provider, providerPaymentId, row.id]
    );
    if (duplicatePayment.length) throw new PaymentError(409, 'PAYMENT_ALREADY_USED', 'This provider payment has already been applied to another payment record.');

    await connection.execute(
      "UPDATE payments SET status = 'paid', provider_payment_id = ?, verified_at = UTC_TIMESTAMP() WHERE id = ?",
      [providerPaymentId, row.id]
    );

    const startMs = new Date(row.start_at).getTime();
    const endMs = new Date(row.end_at).getTime();
    const now = Date.now();
    let reviewReason = null;
    if (row.booking_status === 'cancelled') reviewReason = 'capture_after_cancellation';
    else if (row.booking_status === 'completed') reviewReason = 'capture_after_completion';
    else if (row.booking_status === 'checked_in' || row.booking_status === 'confirmed') reviewReason = 'another_payment_for_confirmed_booking';
    else if (endMs <= now) reviewReason = 'capture_after_booking_window';
    else if (!['held', 'pending_payment', 'expired'].includes(row.booking_status)) reviewReason = 'booking_not_confirmable';
    else if (!lockedSlot || lockedSlot.operational_status !== 'open' || row.facility_status !== 'active') reviewReason = 'facility_or_space_not_open';
    else if ((new Date(row.start_at).getTime() - now) < 30 * 60_000 && lockedSlot.physical_state !== 'empty') reviewReason = 'space_not_confirmed_empty';

    if (!reviewReason) {
      const [conflicts] = await connection.execute(
        `SELECT id FROM bookings
          WHERE slot_id = ? AND id <> ? AND start_at < ? AND end_at > ?
            AND (status IN ('confirmed','checked_in') OR (status IN ('held','pending_payment') AND hold_expires_at > UTC_TIMESTAMP()))
          LIMIT 1 FOR UPDATE`,
        [row.slot_id, row.booking_id, row.end_at, row.start_at]
      );
      if (conflicts.length) reviewReason = 'hold_lost_to_another_reservation';
    }

    if (reviewReason) {
      if (!['cancelled', 'completed', 'confirmed', 'checked_in'].includes(row.booking_status)) {
        await connection.execute("UPDATE bookings SET status = 'payment_failed', hold_expires_at = NULL WHERE id = ?", [row.booking_id]);
      }
      await connection.execute('UPDATE payments SET needs_reconciliation = TRUE WHERE id = ?', [row.id]);
      await connection.execute(
        'INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, metadata) VALUES (?, ?, ?, ?, ?)',
        [row.user_id, 'payment.captured_requires_review', 'booking', row.booking_id, JSON.stringify({ paymentId: row.id, provider, source, reason: reviewReason, providerPaymentId })]
      );
      await connection.commit();
      return { paid: true, bookingId: row.booking_id, bookingCode: row.booking_code, bookingStatus: ['cancelled', 'completed', 'confirmed', 'checked_in'].includes(row.booking_status) ? row.booking_status : 'payment_failed', requiresReview: true, reviewReason };
    }

    const ticket = createBookingTicket(row, env.QR_SIGNING_SECRET);
    await connection.execute(
      "UPDATE bookings SET status = 'confirmed', hold_expires_at = NULL, qr_token_hash = ? WHERE id = ?",
      [ticket.tokenHash, row.booking_id]
    );
    // Record host earnings only after a verified payment has also confirmed its booking.
    // This is a ledger entry, not a bank transfer; settlement remains an explicit later step.
    await connection.execute(
      `INSERT IGNORE INTO host_earnings
        (id, booking_id, payment_id, owner_user_id, parking_lot_id, gross_amount, discount_amount,
         platform_fee_amount, net_amount, currency, status)
       SELECT ?, b.id, p.id, l.owner_user_id, b.parking_lot_id, b.base_amount, b.discount_amount,
              0, GREATEST(0, b.base_amount - b.discount_amount), b.currency, 'pending'
         FROM bookings b
         JOIN parking_lots l ON l.id = b.parking_lot_id
         JOIN payments p ON p.booking_id = b.id
        WHERE b.id = ? AND p.id = ? AND l.owner_user_id IS NOT NULL`,
      [randomUUID(), row.booking_id, row.id]
    );
    await connection.execute(
      'INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, metadata) VALUES (?, ?, ?, ?, ?)',
      [row.user_id, 'payment.captured', 'booking', row.booking_id, JSON.stringify({ paymentId: row.id, provider, source, providerPaymentId, ticketExpiresAt: ticket.expiresAt })]
    );
    await createNotification(connection, {
      userId: row.user_id, eventType: 'payment.booking_confirmed', title: 'Payment received — booking confirmed',
      message: `Your booking ${row.booking_code} is confirmed. Open My bookings to view your parking ticket and QR code.`,
      email: { templateKey: 'booking_confirmed', idempotencyKey: `booking-confirmed:${row.booking_id}`, data: {
        bookingCode: row.booking_code, lotName: row.parking_lot_name, slotCode: row.slot_code,
        startAt: new Date(row.start_at).toISOString(), endAt: new Date(row.end_at).toISOString(),
        amount: String(row.amount), currency: row.currency
      } }
    });
    await connection.commit();
    return { paid: true, bookingId: row.booking_id, bookingCode: row.booking_code, bookingStatus: 'confirmed', requiresReview: false, ticketExpiresAt: ticket.expiresAt };
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally {
    connection.release();
  }
}

async function markProviderPaymentFailed(orderId, providerPaymentId) {
  const [initialRows] = await pool.execute(
    `SELECT p.id, b.slot_id FROM payments p JOIN bookings b ON b.id = p.booking_id
      WHERE p.provider = 'razorpay' AND p.provider_order_id = ? LIMIT 1`,
    [orderId]
  );
  if (!initialRows.length) return { skipped: true };
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.execute('SELECT id FROM parking_slots WHERE id = ? FOR UPDATE', [initialRows[0].slot_id]);
    const row = await getPaymentRow(connection, initialRows[0].id, true);
    if (!row) throw new PaymentError(404, 'PAYMENT_NOT_FOUND', 'Payment order not found.');
    if (row.status === 'paid') { await connection.commit(); return { skipped: true, paid: true }; }
    await connection.execute("UPDATE payments SET status = 'failed', provider_payment_id = COALESCE(provider_payment_id, ?) WHERE id = ?", [providerPaymentId ?? null, row.id]);
    if (['pending_payment', 'held'].includes(row.booking_status)) {
      await connection.execute(
        `UPDATE bookings SET status = CASE WHEN hold_expires_at > UTC_TIMESTAMP() THEN 'held' ELSE 'expired' END,
                             hold_expires_at = CASE WHEN hold_expires_at > UTC_TIMESTAMP() THEN hold_expires_at ELSE NULL END
          WHERE id = ?`,
        [row.booking_id]
      );
    }
    await connection.execute(
      'INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, metadata) VALUES (?, ?, ?, ?, ?)',
      [row.user_id, 'payment.failed', 'booking', row.booking_id, JSON.stringify({ paymentId: row.id, providerPaymentId: providerPaymentId ?? null })]
    );
    await connection.commit();
    return { failed: true };
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally { connection.release(); }
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

function receiptMoney(value, currency) {
  const amount = Number(value ?? 0);
  return `${escapeHtml(currency)} ${Number.isFinite(amount) ? amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '0.00'}`;
}

function receiptDate(value, timezone) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return escapeHtml(new Intl.DateTimeFormat('en-IN', { timeZone: timezone || 'UTC', dateStyle: 'medium', timeStyle: 'short' }).format(date));
}

router.get('/:paymentId/receipt', requireAuth, asyncHandler(async (req, res) => {
  const parsedId = uuidSchema.safeParse(req.params.paymentId);
  if (!parsedId.success) return fail(res, 400, 'INVALID_ID', 'The payment identifier is invalid.');
  const [rows] = await pool.execute(
    `SELECT p.id AS payment_id, p.provider, p.provider_order_id, p.provider_payment_id,
            p.status AS payment_status, p.amount, p.currency, p.verified_at, p.created_at AS payment_created_at, p.needs_reconciliation,
            b.id AS booking_id, b.booking_code, b.status AS booking_status, b.start_at, b.end_at,
            b.base_amount, b.service_fee, b.tax_amount, b.discount_amount, b.total_amount,
            l.name AS parking_lot_name, l.address_line, l.city, l.timezone, s.slot_code
       FROM payments p
       JOIN bookings b ON b.id = p.booking_id
       JOIN parking_lots l ON l.id = b.parking_lot_id
       JOIN parking_slots s ON s.id = b.slot_id
      WHERE p.id = ? AND b.user_id = ? LIMIT 1`,
    [parsedId.data, req.user.id]
  );
  const payment = rows[0];
  if (!payment) return fail(res, 404, 'PAYMENT_NOT_FOUND', 'The payment was not found.');
  if (payment.payment_status !== 'paid') return fail(res, 409, 'RECEIPT_NOT_AVAILABLE', 'A payment receipt is available only after the provider payment is verified as captured.');

  const currency = payment.currency || 'INR';
  const bookingUrlCode = escapeHtml(payment.booking_code);
  const reconciled = Boolean(payment.needs_reconciliation) || ['cancelled', 'payment_failed'].includes(payment.booking_status);
  const receipt = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>SmartPark receipt ${bookingUrlCode}</title>
<meta name="robots" content="noindex,nofollow">
<style>
:root{color-scheme:light;font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#20332a;background:#f4f7f4}*{box-sizing:border-box}body{margin:0;padding:32px 16px}.receipt{max-width:760px;margin:0 auto;background:#fff;border:1px solid #e1e9e2;border-radius:18px;padding:34px;box-shadow:0 12px 40px #183b2410}.brand{font-size:12px;font-weight:900;letter-spacing:2px;color:#168761}.title{display:flex;justify-content:space-between;gap:16px;align-items:flex-start;border-bottom:1px solid #e5ece6;padding:20px 0}.title h1{font-size:28px;letter-spacing:-1px;margin:0 0 8px}.status{padding:7px 10px;border-radius:999px;background:${reconciled ? '#fff2df' : '#e5f7ec'};color:${reconciled ? '#8a5508' : '#16784f'};font-size:11px;font-weight:800;white-space:nowrap}.muted{color:#718078;font-size:13px;line-height:1.7}.grid{display:grid;grid-template-columns:1fr 1fr;gap:18px;margin:24px 0}.card{background:#f8fbf8;border:1px solid #e8efe9;border-radius:12px;padding:16px;min-width:0}.label{font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#819087;font-weight:800;margin-bottom:8px}.value{font-size:14px;font-weight:800;overflow-wrap:anywhere}.table{width:100%;border-collapse:collapse;margin:20px 0}.table td{padding:13px 0;border-bottom:1px solid #e8efe9;font-size:13px}.table td:last-child{text-align:right;font-weight:700}.total td{font-size:17px;font-weight:900;border-bottom:0;padding-top:18px}.ref{font-size:11px;overflow-wrap:anywhere}.footer{border-top:1px solid #e8efe9;padding-top:16px;margin-top:20px}.notice{padding:12px;border-radius:9px;background:#fff7e8;color:#8a5508;font-size:12px;line-height:1.7;margin-top:14px}@media(max-width:600px){body{padding:12px}.receipt{padding:20px}.grid{grid-template-columns:1fr}.title{display:block}.status{display:inline-block;margin-top:12px}}
</style></head><body><main class="receipt"><div class="brand">SMARTPARK</div><div class="title"><div><h1>Payment receipt</h1><div class="muted">Booking ${bookingUrlCode} · Issued after verified payment</div></div><span class="status">${reconciled ? 'PAYMENT RECEIVED · REVIEW REQUIRED' : 'PAYMENT VERIFIED'}</span></div>
<div class="grid"><section class="card"><div class="label">Parking facility</div><div class="value">${escapeHtml(payment.parking_lot_name)}</div><div class="muted">${escapeHtml(payment.address_line)}, ${escapeHtml(payment.city)}</div><div class="muted">Space ${escapeHtml(payment.slot_code)}</div></section><section class="card"><div class="label">Reservation</div><div class="value">${bookingUrlCode}</div><div class="muted">From ${receiptDate(payment.start_at, payment.timezone)}</div><div class="muted">Until ${receiptDate(payment.end_at, payment.timezone)}</div></section></div>
<table class="table"><tbody><tr><td>Parking charge</td><td>${receiptMoney(payment.base_amount, currency)}</td></tr><tr><td>Service fee</td><td>${receiptMoney(payment.service_fee, currency)}</td></tr><tr><td>Tax</td><td>${receiptMoney(payment.tax_amount, currency)}</td></tr><tr><td>Discount</td><td>−${receiptMoney(payment.discount_amount, currency)}</td></tr><tr class="total"><td>Total paid</td><td>${receiptMoney(payment.amount, currency)}</td></tr></tbody></table>
<section class="card"><div class="label">Transaction details</div><div class="value">Payment verified</div><p class="muted">Provider: ${escapeHtml(payment.provider)}<br>Provider payment reference: <span class="ref">${escapeHtml(payment.provider_payment_id || '—')}</span><br>Provider order reference: <span class="ref">${escapeHtml(payment.provider_order_id || '—')}</span><br>Verified at: ${receiptDate(payment.verified_at, payment.timezone)}</p></section>
${reconciled ? '<div class="notice">The payment was captured but the reservation requires operator reconciliation. This receipt confirms the payment only; it does not authorize parking entry. Contact SmartPark support before travelling to the facility.</div>' : ''}
<div class="footer muted">Keep this receipt for your records. Use your booking QR ticket for entry only when the reservation is confirmed. To save a copy, use your browser’s Print command and choose Save as PDF.</div></main></body></html>`;
  res.set('Cache-Control', 'no-store');
  res.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
  return res.type('html').send(receipt);
}));

router.get('/mine', requireAuth, asyncHandler(async (req, res) => {
  const [rows] = await pool.execute(
    `SELECT p.*, b.booking_code, b.status AS booking_status, b.start_at AS booking_start_at, b.end_at AS booking_end_at, l.name AS parking_lot_name
       FROM payments p JOIN bookings b ON b.id = p.booking_id
       JOIN parking_lots l ON l.id = b.parking_lot_id
      WHERE b.user_id = ? ORDER BY p.created_at DESC LIMIT 100`,
    [req.user.id]
  );
  return res.json({ payments: rows.map(mapPayment), count: rows.length });
}));

router.post('/verify', requireAuth, asyncHandler(async (req, res) => {
  if (env.PAYMENT_PROVIDER !== 'razorpay') return fail(res, 409, 'PAYMENT_PROVIDER_NOT_ACTIVE', 'Razorpay verification is only available when Razorpay is configured.');
  const parsed = verifySchema.safeParse(req.body);
  if (!parsed.success) return validationFail(res, parsed);
  const { bookingId, razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: signature } = parsed.data;
  const row = await findPaymentForBooking(bookingId, req.user.id, orderId);
  if (!row) return fail(res, 404, 'PAYMENT_ORDER_NOT_FOUND', 'The payment order was not found for this reservation.');
  if (!verifyRazorpayCheckoutSignature({ orderId, paymentId, signature, secret: env.RAZORPAY_KEY_SECRET })) {
    return fail(res, 400, 'INVALID_PAYMENT_SIGNATURE', 'The payment confirmation signature could not be verified.');
  }
  try {
    const providerPayment = await razorpayRequest(`/payments/${encodeURIComponent(paymentId)}`);
    const validation = validateCapturedPayment({
      expectedAmount: row.amount,
      expectedCurrency: row.currency,
      capturedAmount: providerPayment.amount,
      capturedCurrency: providerPayment.currency,
      providerOrderId: providerPayment.order_id,
      expectedProviderOrderId: orderId,
      capturedStatus: providerPayment.status
    });
    if (!validation.ok) {
      if (validation.code === 'PAYMENT_NOT_CAPTURED') return fail(res, 409, 'PAYMENT_NOT_CAPTURED', 'The provider has not captured this payment yet. SmartPark will confirm the booking only after capture is verified.');
      return fail(res, 409, validation.code, 'The provider payment does not match this reservation.');
    }
    const result = await settleCapturedPayment({
      paymentId: row.id,
      provider: 'razorpay',
      providerOrderId: orderId,
      providerPaymentId: paymentId,
      capturedAmount: providerPayment.amount,
      capturedCurrency: providerPayment.currency,
      capturedStatus: providerPayment.status,
      source: 'checkout_verify'
    });
    return res.json({ ...result, message: result.requiresReview ? 'Payment was received, but the reservation could not be confirmed automatically. Contact support for reconciliation.' : 'Payment verified and reservation confirmed.' });
  } catch (error) {
    if (error instanceof PaymentError) return fail(res, error.status, error.code, error.message, error.details);
    console.error('Razorpay verification failed:', error?.providerCode ?? error?.message ?? error);
    return fail(res, 502, 'PAYMENT_VERIFICATION_FAILED', 'The payment provider could not be reached to verify this payment. You can refresh the booking after the provider webhook arrives.');
  }
}));

router.post('/mock/complete', requireAuth, asyncHandler(async (req, res) => {
  if (env.NODE_ENV === 'production' || env.PAYMENT_PROVIDER !== 'mock') {
    return fail(res, 404, 'NOT_FOUND', 'This development-only payment route is not available.');
  }
  const parsed = mockCompleteSchema.safeParse(req.body);
  if (!parsed.success) return validationFail(res, parsed);
  const [rows] = await pool.execute(
    `SELECT p.id, p.booking_id, p.provider, p.provider_order_id, p.amount, p.currency, p.status,
            b.user_id, b.booking_code
       FROM payments p JOIN bookings b ON b.id = p.booking_id
      WHERE p.id = ? AND b.user_id = ? LIMIT 1`,
    [parsed.data.paymentId, req.user.id]
  );
  if (!rows.length || rows[0].provider !== 'mock' || !rows[0].provider_order_id) {
    return fail(res, 404, 'PAYMENT_NOT_FOUND', 'A local test payment order was not found.');
  }
  if (!['pending', 'paid'].includes(rows[0].status)) {
    return fail(res, 409, 'TEST_PAYMENT_NOT_PAYABLE', 'This local test payment is no longer payable. Create a new reservation hold if the previous one expired.');
  }
  try {
    const row = rows[0];
    const result = await settleCapturedPayment({
      paymentId: row.id,
      provider: 'mock',
      providerOrderId: row.provider_order_id,
      providerPaymentId: `mock_payment_${row.id}`,
      capturedAmount: toMinorUnits(row.amount, row.currency),
      capturedCurrency: row.currency,
      capturedStatus: 'captured',
      source: 'development_simulator'
    });
    return res.json({ ...result, testMode: true, message: result.requiresReview ? 'TEST payment completed, but the reservation needs manual reconciliation.' : 'TEST MODE: simulated payment captured and reservation confirmed.' });
  } catch (error) {
    if (error instanceof PaymentError) return fail(res, error.status, error.code, error.message, error.details);
    throw error;
  }
}));

export async function razorpayWebhookHandler(req, res) {
  if (env.PAYMENT_PROVIDER !== 'razorpay' || !env.RAZORPAY_WEBHOOK_SECRET) {
    return res.status(503).json({ error: { code: 'WEBHOOK_NOT_CONFIGURED', message: 'The payment webhook is not configured.' } });
  }
  if (!Buffer.isBuffer(req.body)) return res.status(400).json({ error: { code: 'INVALID_WEBHOOK_BODY', message: 'The webhook body must be raw JSON bytes.' } });
  const signature = req.get('x-razorpay-signature');
  if (!verifyRazorpayWebhookSignature({ rawBody: req.body, signature, secret: env.RAZORPAY_WEBHOOK_SECRET })) {
    return res.status(400).json({ error: { code: 'INVALID_WEBHOOK_SIGNATURE', message: 'The webhook signature is invalid.' } });
  }
  let event;
  try { event = JSON.parse(req.body.toString('utf8')); }
  catch { return res.status(400).json({ error: { code: 'INVALID_WEBHOOK_JSON', message: 'The webhook payload is not valid JSON.' } }); }

  const eventIdHeader = req.get('x-razorpay-event-id');
  const eventId = (eventIdHeader || `sha256:${sha256Hex(req.body)}`).slice(0, 180);
  const eventType = String(event?.event ?? 'unknown').slice(0, 100);
  await pool.execute(
    `INSERT INTO payment_webhook_events (event_id, event_type, payload_sha256, processing_status)
     VALUES (?, ?, ?, 'received')
     ON DUPLICATE KEY UPDATE event_type = VALUES(event_type), payload_sha256 = VALUES(payload_sha256)`,
    [eventId, eventType, sha256Hex(req.body)]
  );
  const [eventRows] = await pool.execute('SELECT processing_status FROM payment_webhook_events WHERE event_id = ? LIMIT 1', [eventId]);
  if (eventRows[0]?.processing_status === 'processed') return res.status(200).json({ received: true, duplicate: true });

  try {
    if (eventType === 'payment.captured' || eventType === 'order.paid') {
      const paymentEntity = event?.payload?.payment?.entity;
      // payment.captured is the required confirmation event. order.paid is an
      // optional duplicate signal; it may not contain a payment entity.
      if (eventType === 'payment.captured' && (!paymentEntity?.order_id || !paymentEntity?.id)) {
        throw new Error('The payment.captured event is missing its payment entity.');
      }
      if (paymentEntity?.order_id && paymentEntity?.id) {
        const [payments] = await pool.execute(
          "SELECT id FROM payments WHERE provider = 'razorpay' AND provider_order_id = ? LIMIT 1",
          [paymentEntity.order_id]
        );
        if (!payments.length && eventType === 'payment.captured') {
          throw new Error('The captured provider order has not yet been linked to a SmartPark payment.');
        }
        if (payments.length) {
          await settleCapturedPayment({
            paymentId: payments[0].id,
            provider: 'razorpay',
            providerOrderId: paymentEntity.order_id,
            providerPaymentId: paymentEntity.id,
            capturedAmount: paymentEntity.amount,
            capturedCurrency: paymentEntity.currency,
            capturedStatus: paymentEntity.status,
            source: `webhook:${eventType}`
          });
        }
      }
    } else if (eventType === 'payment.failed') {
      const paymentEntity = event?.payload?.payment?.entity;
      if (paymentEntity?.order_id) await markProviderPaymentFailed(paymentEntity.order_id, paymentEntity.id ?? null);
    }
    await pool.execute("UPDATE payment_webhook_events SET processing_status = 'processed', processed_at = UTC_TIMESTAMP(), error_code = NULL WHERE event_id = ?", [eventId]);
    return res.status(200).json({ received: true });
  } catch (error) {
    await pool.execute("UPDATE payment_webhook_events SET processing_status = 'failed', error_code = ? WHERE event_id = ?", [String(error?.code ?? error?.providerCode ?? 'PROCESSING_ERROR').slice(0, 80), eventId]).catch(() => {});
    console.error('Razorpay webhook processing failed:', error?.providerCode ?? error?.message ?? error);
    return res.status(500).json({ error: { code: 'WEBHOOK_PROCESSING_FAILED', message: 'The signed webhook could not be processed. The provider may retry it.' } });
  }
}

router.use((error, _req, res, next) => {
  if (error instanceof PaymentError) return fail(res, error.status, error.code, error.message, error.details);
  return next(error);
});

export default router;
