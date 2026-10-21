import { Router } from 'express';
import { randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import QRCode from 'qrcode';
import { env } from '../config/env.js';
import { createBookingTicket } from '../tickets/ticket.js';
import { constantTimeStringEqual } from '../payments/payment-logic.js';
import { pool } from '../config/database.js';
import { requireAuth } from '../middleware/authenticate.js';
import { calculateBestQuote, isWithinOperatingHours, isWithinWeeklyAvailability, mapBookingRow, toMysqlUtc, validateBookingInterval } from '../bookings/pricing.js';
import { createNotification } from '../services/notifications.js';

const router = Router();
const asyncHandler = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
const idSchema = z.string().uuid();
const bookingInputSchema = z.object({
  slotId: idSchema,
  startAt: z.string().datetime({ offset: true }),
  endAt: z.string().datetime({ offset: true }),
  vehicleId: idSchema.nullable().optional()
});
const listQuerySchema = z.object({
  status: z.enum(['held', 'pending_payment', 'confirmed', 'checked_in', 'completed', 'cancelled', 'expired', 'payment_failed']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30)
});

class BookingError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function fail(res, status, code, message, details) {
  return res.status(status).json({ error: { code, message, ...(details ? { details } : {}) } });
}
function validationFail(res, parsed) {
  return fail(res, 400, 'VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Check the submitted fields.');
}
function parseInterval(startAt, endAt) {
  const interval = validateBookingInterval(startAt, endAt);
  if (!interval.ok) throw new BookingError(400, interval.code, interval.message);
  return interval;
}
function bookingCode() {
  const day = new Date().toISOString().slice(2, 10).replaceAll('-', '');
  return `SP${day}${randomBytes(3).toString('hex').toUpperCase()}`;
}

async function getSlotContext(executor, slotId, lock = false) {
  const [rows] = await executor.execute(
    `SELECT s.id AS slot_id, s.parking_lot_id, s.zone_id, s.slot_code,
            s.vehicle_type AS slot_vehicle_type, s.operational_status, s.physical_state,
            s.physical_state_updated_at, s.covered, s.accessible,
            l.name AS parking_lot_name, l.city, l.currency, l.timezone, l.listing_kind,
            l.opening_time, l.closing_time, l.facility_status
       FROM parking_slots s
       JOIN parking_lots l ON l.id = s.parking_lot_id
      WHERE s.id = ? LIMIT 1${lock ? ' FOR UPDATE' : ''}`,
    [slotId]
  );
  if (!rows.length) throw new BookingError(404, 'SLOT_NOT_FOUND', 'The selected parking space was not found.');
  const slot = rows[0];
  if (slot.facility_status !== 'active') throw new BookingError(409, 'FACILITY_UNAVAILABLE', 'This parking facility is not currently accepting reservations.');
  if (slot.operational_status !== 'open') throw new BookingError(409, 'SLOT_UNAVAILABLE', 'This parking space is closed or under maintenance.');
  return slot;
}

async function assertVehicle(executor, userId, vehicleId, slotVehicleType) {
  if (!vehicleId) return null;
  const [rows] = await executor.execute(
    'SELECT id, vehicle_type, registration_number FROM vehicles WHERE id = ? AND owner_user_id = ? LIMIT 1',
    [vehicleId, userId]
  );
  if (!rows.length) throw new BookingError(400, 'VEHICLE_NOT_FOUND', 'Choose a vehicle registered to your account.');
  const vehicle = rows[0];
  if (slotVehicleType !== 'any' && vehicle.vehicle_type !== slotVehicleType) {
    throw new BookingError(409, 'VEHICLE_NOT_COMPATIBLE', `This space is configured for ${slotVehicleType} vehicles.`);
  }
  return vehicle;
}

async function getPriceRows(executor, slotId, lotId, currency, startAt, endAt) {
  const startMysql = toMysqlUtc(startAt);
  const endMysql = toMysqlUtc(endAt);
  const [rows] = await executor.execute(
    `SELECT id, parking_lot_id, slot_id, rate_type, amount, currency, service_fee, tax_rate_percent, valid_from, valid_until, created_at
       FROM pricing_rules
      WHERE parking_lot_id = ?
        AND currency = ?
        AND (slot_id = ? OR slot_id IS NULL)
        AND is_active = TRUE
        AND (valid_from IS NULL OR valid_from <= ?)
        AND (valid_until IS NULL OR valid_until >= ?)
      ORDER BY CASE WHEN slot_id = ? THEN 0 ELSE 1 END,
               COALESCE(valid_from, '1000-01-01 00:00:00') DESC,
               created_at DESC`,
    [lotId, currency, slotId, startMysql, endMysql, slotId]
  );
  return rows;
}

async function makeQuote(executor, userId, input, options = {}) {
  const interval = parseInterval(input.startAt, input.endAt);
  const slot = options.slotContext ?? await getSlotContext(executor, input.slotId, false);
  await assertVehicle(executor, userId, input.vehicleId ?? null, slot.slot_vehicle_type);
  if (slot.listing_kind === 'shared_space') {
    const [scheduleRows] = await executor.execute(
      'SELECT weekday, is_available, opens_at, closes_at FROM parking_availability_rules WHERE parking_lot_id = ? ORDER BY weekday',
      [slot.parking_lot_id]
    );
    if (!isWithinWeeklyAvailability(interval.start, interval.end, scheduleRows, slot.timezone || 'UTC')) {
      throw new BookingError(422, 'OUTSIDE_LISTING_AVAILABILITY', 'The selected arrival or departure time is outside the host’s published weekly availability.');
    }
  } else if (!isWithinOperatingHours(interval.start, interval.end, slot.opening_time, slot.closing_time, slot.timezone || 'UTC')) {
    throw new BookingError(422, 'OUTSIDE_OPERATING_HOURS', 'The selected time interval does not fit within this facility’s operating hours.');
  }
  const [conflicts] = await executor.execute(
    `SELECT id FROM bookings
      WHERE slot_id = ? AND start_at < ? AND end_at > ?
        AND (
          status IN ('confirmed','checked_in')
          OR (status IN ('held','pending_payment') AND hold_expires_at > UTC_TIMESTAMP())
        )
      LIMIT 1`,
    [input.slotId, toMysqlUtc(interval.end), toMysqlUtc(interval.start)]
  );
  if (conflicts.length) throw new BookingError(409, 'BOOKING_CONFLICT', 'That space has another active reservation overlapping your selected time. Choose another time or space.');

  // The live physical state is used for near-term reservations only. For a
  // later start time, interval conflicts are authoritative; a current camera
  // observation does not prove the space will remain occupied at that future time.
  const minutesUntilStart = (interval.start.getTime() - Date.now()) / 60_000;
  if (minutesUntilStart < 30 && slot.physical_state !== 'empty') {
    throw new BookingError(409, 'PHYSICAL_STATE_UNAVAILABLE', 'This space is not confirmed empty for a near-term booking. Choose a later time or another space.');
  }

  const rateRows = await getPriceRows(executor, input.slotId, slot.parking_lot_id, slot.currency, interval.start, interval.end);
  const quote = calculateBestQuote(rateRows, interval.durationMinutes);
  if (!quote) {
    throw new BookingError(422, 'PRICING_NOT_CONFIGURED', 'This facility has no active pricing rule that covers the entire requested booking interval.');
  }
  return {
    slot: {
      id: slot.slot_id,
      code: slot.slot_code,
      parkingLotId: slot.parking_lot_id,
      parkingLotName: slot.parking_lot_name,
      city: slot.city,
      vehicleType: slot.slot_vehicle_type,
      physicalState: slot.physical_state,
      covered: Boolean(slot.covered),
      accessible: Boolean(slot.accessible)
    },
    interval: { startAt: interval.start.toISOString(), endAt: interval.end.toISOString(), durationMinutes: interval.durationMinutes },
    quote
  };
}

async function fetchBooking(executor, bookingId, userId, isAdmin = false, lock = false) {
  const [rows] = await executor.execute(
    `SELECT b.*, l.name AS parking_lot_name, l.city, s.slot_code, v.registration_number
       FROM bookings b
       JOIN parking_lots l ON l.id = b.parking_lot_id
       JOIN parking_slots s ON s.id = b.slot_id
       LEFT JOIN vehicles v ON v.id = b.vehicle_id
      WHERE b.id = ?${isAdmin ? '' : ' AND b.user_id = ?'}
      LIMIT 1${lock ? ' FOR UPDATE' : ''}`,
    isAdmin ? [bookingId] : [bookingId, userId]
  );
  return rows[0] ?? null;
}

router.post('/quote', requireAuth, asyncHandler(async (req, res) => {
  const parsed = bookingInputSchema.safeParse(req.body);
  if (!parsed.success) return validationFail(res, parsed);
  try {
    const result = await makeQuote(pool, req.user.id, parsed.data);
    return res.json(result);
  } catch (error) {
    if (error instanceof BookingError) return fail(res, error.status, error.code, error.message);
    throw error;
  }
}));

router.post('/', requireAuth, asyncHandler(async (req, res, next) => {
  const parsed = bookingInputSchema.safeParse(req.body);
  if (!parsed.success) return validationFail(res, parsed);
  const input = parsed.data;
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    // Locking the inventory row serializes competing holds for this exact slot.
    const slot = await getSlotContext(connection, input.slotId, true);
    const interval = parseInterval(input.startAt, input.endAt);
    await connection.execute(
      `UPDATE bookings SET status = 'expired'
        WHERE slot_id = ? AND status IN ('held','pending_payment')
          AND hold_expires_at IS NOT NULL AND hold_expires_at <= UTC_TIMESTAMP()`,
      [input.slotId]
    );
    const [conflicts] = await connection.execute(
      `SELECT id FROM bookings
        WHERE slot_id = ? AND start_at < ? AND end_at > ?
          AND (
            status IN ('confirmed','checked_in')
            OR (status IN ('held','pending_payment') AND hold_expires_at > UTC_TIMESTAMP())
          )
        LIMIT 1 FOR UPDATE`,
      [input.slotId, toMysqlUtc(interval.end), toMysqlUtc(interval.start)]
    );
    if (conflicts.length) throw new BookingError(409, 'BOOKING_CONFLICT', 'That space has another active reservation overlapping your selected time. Choose another time or space.');

    const quoteResult = await makeQuote(connection, req.user.id, input, { slotContext: slot });
    const bookingId = randomUUID();
    const code = bookingCode();
    const holdMinutes = 10;
    const quote = quoteResult.quote;
    await connection.execute(
      `INSERT INTO bookings
        (id, booking_code, user_id, parking_lot_id, slot_id, vehicle_id, start_at, end_at,
         status, hold_expires_at, currency, base_amount, service_fee, tax_amount, discount_amount,
         total_amount, pricing_snapshot)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'held', DATE_ADD(UTC_TIMESTAMP(), INTERVAL ${holdMinutes} MINUTE), ?, ?, ?, ?, ?, ?, ?)`,
      [bookingId, code, req.user.id, slot.parking_lot_id, input.slotId, input.vehicleId ?? null,
        toMysqlUtc(interval.start), toMysqlUtc(interval.end), quote.currency, quote.baseAmount,
        quote.serviceFee, quote.taxAmount, quote.discountAmount, quote.totalAmount, JSON.stringify(quote)]
    );
    await connection.execute(
      'INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, metadata) VALUES (?, ?, ?, ?, ?)',
      [req.user.id, 'booking.hold_created', 'booking', bookingId, JSON.stringify({ slotId: input.slotId, bookingCode: code, holdMinutes })]
    );
    await createNotification(connection, {
      userId: req.user.id, eventType: 'booking.hold_created', title: 'Parking space temporarily held',
      message: `${slot.parking_lot_name}, space ${slot.slot_code} is held for 10 minutes. Complete checkout before the hold expires.`,
      email: { templateKey: 'booking_hold_created', idempotencyKey: `booking-hold-created:${bookingId}`, data: {
        bookingCode: code, lotName: slot.parking_lot_name, slotCode: slot.slot_code,
        startAt: interval.start.toISOString(), endAt: interval.end.toISOString(), holdMinutes
      } }
    });
    const row = await fetchBooking(connection, bookingId, req.user.id, false, false);
    await connection.commit();
    return res.status(201).json({ booking: mapBookingRow(row), holdMinutes, message: 'A temporary reservation hold was created. Payment is not yet completed.' });
  } catch (error) {
    await connection.rollback().catch(() => {});
    if (error instanceof BookingError) return fail(res, error.status, error.code, error.message);
    return next(error);
  } finally {
    connection.release();
  }
}));

router.get('/mine', requireAuth, asyncHandler(async (req, res) => {
  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) return validationFail(res, parsed);
  await pool.execute(
    `UPDATE bookings SET status = 'expired'
      WHERE user_id = ? AND status IN ('held','pending_payment')
        AND hold_expires_at IS NOT NULL AND hold_expires_at <= UTC_TIMESTAMP()`,
    [req.user.id]
  );
  const conditions = ['b.user_id = ?'];
  const params = [req.user.id];
  if (parsed.data.status) { conditions.push('b.status = ?'); params.push(parsed.data.status); }
  params.push(parsed.data.limit);
  const [rows] = await pool.execute(
    `SELECT b.*, l.name AS parking_lot_name, l.city, s.slot_code, v.registration_number
       FROM bookings b
       JOIN parking_lots l ON l.id = b.parking_lot_id
       JOIN parking_slots s ON s.id = b.slot_id
       LEFT JOIN vehicles v ON v.id = b.vehicle_id
      WHERE ${conditions.join(' AND ')}
      ORDER BY b.created_at DESC LIMIT ?`,
    params
  );
  return res.json({ bookings: rows.map(mapBookingRow), count: rows.length });
}));

router.get('/:bookingId/ticket', requireAuth, asyncHandler(async (req, res) => {
  const parsedId = idSchema.safeParse(req.params.bookingId);
  if (!parsedId.success) return fail(res, 400, 'INVALID_ID', 'The booking identifier is invalid.');
  const [rows] = await pool.execute(
    `SELECT b.id, b.booking_code, b.user_id, b.status, b.start_at, b.end_at, b.qr_token_hash,
            l.name AS parking_lot_name, l.city, s.slot_code
       FROM bookings b JOIN parking_lots l ON l.id = b.parking_lot_id
       JOIN parking_slots s ON s.id = b.slot_id
      WHERE b.id = ? AND b.user_id = ? LIMIT 1`,
    [parsedId.data, req.user.id]
  );
  const booking = rows[0];
  if (!booking) return fail(res, 404, 'BOOKING_NOT_FOUND', 'The booking was not found.');
  if (!['confirmed', 'checked_in'].includes(booking.status) || !booking.qr_token_hash) {
    return fail(res, 409, 'TICKET_NOT_AVAILABLE', 'A QR entry ticket is available only for a paid, confirmed reservation that has not been completed.');
  }
  let ticket;
  try {
    ticket = createBookingTicket(booking, env.QR_SIGNING_SECRET, { allowExpired: booking.status === 'checked_in' });
  } catch (error) {
    return fail(res, 409, 'TICKET_EXPIRED', 'This booking ticket has expired. Contact the parking facility if you are still on site.');
  }
  if (!constantTimeStringEqual(ticket.tokenHash, String(booking.qr_token_hash))) {
    return fail(res, 409, 'TICKET_INVALIDATED', 'This ticket is no longer valid. Contact support for assistance.');
  }
  const qrDataUrl = await QRCode.toDataURL(ticket.token, {
    errorCorrectionLevel: 'M', margin: 1, width: 320,
    color: { dark: '#10211d', light: '#ffffff' }
  });
  return res.json({
    ticket: {
      bookingId: booking.id,
      bookingCode: booking.booking_code,
      bookingStatus: booking.status,
      parkingLotName: booking.parking_lot_name,
      city: booking.city,
      slotCode: booking.slot_code,
      startAt: new Date(booking.start_at).toISOString(),
      endAt: new Date(booking.end_at).toISOString(),
      expiresAt: ticket.expiresAt,
      qrDataUrl
    }
  });
}));

router.get('/:bookingId', requireAuth, asyncHandler(async (req, res) => {
  const parsedId = idSchema.safeParse(req.params.bookingId);
  if (!parsedId.success) return fail(res, 400, 'INVALID_ID', 'The booking identifier is invalid.');
  const isAdmin = req.user.roles.includes('admin');
  const row = await fetchBooking(pool, parsedId.data, req.user.id, isAdmin, false);
  if (!row) return fail(res, 404, 'BOOKING_NOT_FOUND', 'The booking was not found.');
  return res.json({ booking: mapBookingRow(row) });
}));

router.post('/:bookingId/cancel', requireAuth, asyncHandler(async (req, res, next) => {
  const parsedId = idSchema.safeParse(req.params.bookingId);
  if (!parsedId.success) return fail(res, 400, 'INVALID_ID', 'The booking identifier is invalid.');
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const isAdmin = req.user.roles.includes('admin');
    const row = await fetchBooking(connection, parsedId.data, req.user.id, isAdmin, true);
    if (!row) throw new BookingError(404, 'BOOKING_NOT_FOUND', 'The booking was not found.');
    if (row.status === 'cancelled') {
      await connection.commit();
      return res.json({ booking: mapBookingRow(row), message: 'This booking was already cancelled.' });
    }
    if (!['held', 'pending_payment'].includes(row.status)) {
      throw new BookingError(409, 'CANCELLATION_NOT_AVAILABLE', 'Only unpaid reservation holds can be cancelled in this phase. Paid-booking cancellation and refunds will be enabled with payment integration.');
    }
    await connection.execute("UPDATE bookings SET status = 'cancelled', hold_expires_at = NULL WHERE id = ?", [row.id]);
    await connection.execute(
      'INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, metadata) VALUES (?, ?, ?, ?, ?)',
      [req.user.id, 'booking.cancelled', 'booking', row.id, JSON.stringify({ previousStatus: row.status })]
    );
    await createNotification(connection, {
      userId: row.user_id, eventType: 'booking.cancelled', title: 'Parking hold cancelled',
      message: `Your hold ${row.booking_code} has been cancelled. No payment was captured by this cancellation workflow.`,
      email: { templateKey: 'booking_cancelled', idempotencyKey: `booking-cancelled:${row.id}`, data: {
        bookingCode: row.booking_code, lotName: row.parking_lot_name, slotCode: row.slot_code
      } }
    });
    const updated = await fetchBooking(connection, row.id, req.user.id, isAdmin, false);
    await connection.commit();
    return res.json({ booking: mapBookingRow(updated), message: 'The unpaid reservation hold was cancelled.' });
  } catch (error) {
    await connection.rollback().catch(() => {});
    if (error instanceof BookingError) return fail(res, error.status, error.code, error.message);
    return next(error);
  } finally {
    connection.release();
  }
}));

export default router;
