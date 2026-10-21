import { Router } from 'express';
import { randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { pool } from '../config/database.js';
import { env } from '../config/env.js';
import { requireAuth, requireRole } from '../middleware/authenticate.js';
import { constantTimeStringEqual, sha256Hex, verifySignedTicket } from '../payments/payment-logic.js';
import { createNotification } from '../services/notifications.js';

const router = Router();
const asyncHandler = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
const scanSchema = z.object({
  token: z.string().trim().min(30).max(2048),
  action: z.enum(['entry', 'exit'])
});

class GateError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
function fail(res, status, code, message) { return res.status(status).json({ error: { code, message } }); }
function makeTicketCode() { return `PK${new Date().toISOString().slice(2, 10).replaceAll('-', '')}${randomBytes(3).toString('hex').toUpperCase()}`; }

async function requireAssignedGateAccess(connection, user, lotId) {
  if (user.roles.includes('admin')) return;
  const [rows] = await connection.execute(
    'SELECT assignment_role FROM parking_lot_staff WHERE user_id = ? AND parking_lot_id = ?',
    [user.id, lotId]
  );
  const assignments = rows.map((row) => row.assignment_role);
  const allowed = (user.roles.includes('attendant') && assignments.includes('attendant'))
    || (user.roles.includes('operator') && assignments.includes('operator'));
  if (!allowed) throw new GateError(403, 'FACILITY_ACCESS_DENIED', 'You are not assigned to operate the entrance or exit for this parking facility.');
}

router.post('/scan', requireAuth, requireRole('attendant', 'operator', 'admin'), asyncHandler(async (req, res) => {
  const parsed = scanSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 400, 'VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Provide a valid QR ticket and gate action.');
  const { token, action } = parsed.data;
  // Verify the signed token before looking up its booking ID. The stored hash below
  // separately enforces that the token was actually issued for this booking.
  const verified = verifySignedTicket(token, env.QR_SIGNING_SECRET);
  // An expired but correctly signed ticket may be used only to close an already-open
  // parking session. It cannot authorize a new entry.
  const validForRequestedAction = verified.ok || (action === 'exit' && verified.code === 'TICKET_EXPIRED' && verified.bookingId);
  if (!validForRequestedAction) return fail(res, 400, verified.code, verified.code === 'TICKET_EXPIRED' ? 'This QR ticket has expired.' : 'This QR ticket is invalid.');

  const connection = await pool.getConnection();
  try {
    const [initialRows] = await connection.execute('SELECT slot_id FROM bookings WHERE id = ? LIMIT 1', [verified.bookingId]);
    if (!initialRows.length) return fail(res, 404, 'BOOKING_NOT_FOUND', 'No reservation matches this QR ticket.');
    await connection.beginTransaction();
    await connection.execute('SELECT id FROM parking_slots WHERE id = ? FOR UPDATE', [initialRows[0].slot_id]);
    const [bookingRows] = await connection.execute(
      `SELECT b.*, l.name AS parking_lot_name, l.city, l.facility_status, s.slot_code, s.operational_status, s.physical_state
         FROM bookings b JOIN parking_lots l ON l.id = b.parking_lot_id
         JOIN parking_slots s ON s.id = b.slot_id
        WHERE b.id = ? LIMIT 1 FOR UPDATE`,
      [verified.bookingId]
    );
    const booking = bookingRows[0];
    if (!booking || !booking.qr_token_hash || !constantTimeStringEqual(sha256Hex(token), String(booking.qr_token_hash))) {
      throw new GateError(400, 'TICKET_REVOKED', 'This QR ticket is no longer valid.');
    }
    if (booking.booking_code == null || booking.status === 'cancelled') throw new GateError(409, 'BOOKING_INACTIVE', 'This reservation is not active.');
    await requireAssignedGateAccess(connection, req.user, booking.parking_lot_id);

    const now = Date.now();
    if (action === 'entry') {
      if (booking.status === 'checked_in') throw new GateError(409, 'ALREADY_CHECKED_IN', 'This booking already has a recorded entry. Use the exit action when the vehicle leaves.');
      if (booking.status !== 'confirmed') throw new GateError(409, 'BOOKING_NOT_CONFIRMED', 'Entry is allowed only for a paid and confirmed reservation.');
      const start = new Date(booking.start_at).getTime();
      const end = new Date(booking.end_at).getTime();
      if (booking.facility_status !== 'active') throw new GateError(409, 'FACILITY_NOT_OPEN', 'This facility is not currently accepting vehicles. Contact the operator.');
      if (booking.operational_status !== 'open') throw new GateError(409, 'SLOT_NOT_OPEN', 'The assigned parking space is closed or under maintenance. Contact the operator.');
      if (booking.physical_state === 'occupied') throw new GateError(409, 'SLOT_PHYSICALLY_OCCUPIED', 'The assigned space is currently reported as occupied. Ask the operator to inspect the space before entry.');
      if (now < start - 30 * 60_000) throw new GateError(409, 'ENTRY_TOO_EARLY', 'Entry opens 30 minutes before the reserved start time.');
      if (now > end) throw new GateError(409, 'BOOKING_WINDOW_ENDED', 'The reserved parking interval has ended.');
      const sessionId = randomUUID();
      const ticketCode = makeTicketCode();
      await connection.execute(
        `INSERT INTO parking_sessions (id, booking_id, parking_lot_id, slot_id, vehicle_id, ticket_code, entry_source, status)
         VALUES (?, ?, ?, ?, ?, ?, 'qr', 'parked')`,
        [sessionId, booking.id, booking.parking_lot_id, booking.slot_id, booking.vehicle_id, ticketCode]
      );
      await connection.execute("UPDATE bookings SET status = 'checked_in' WHERE id = ?", [booking.id]);
      await connection.execute("UPDATE parking_slots SET physical_state = 'occupied', physical_state_updated_at = UTC_TIMESTAMP(3) WHERE id = ?", [booking.slot_id]);
      await connection.execute(
        'INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, metadata) VALUES (?, ?, ?, ?, ?)',
        [req.user.id, 'gate.entry_authorized', 'booking', booking.id, JSON.stringify({ sessionId, ticketCode, lotId: booking.parking_lot_id, slotId: booking.slot_id })]
      );
      await createNotification(connection, {
        userId: booking.user_id, eventType: 'parking.entry_recorded', title: 'Parking entry recorded',
        message: `Your vehicle was checked in at ${booking.parking_lot_name}, space ${booking.slot_code}.`,
        email: { templateKey: 'parking_entry_recorded', idempotencyKey: `parking-entry:${booking.id}`, data: {
          bookingCode: booking.booking_code, lotName: booking.parking_lot_name, slotCode: booking.slot_code
        } }
      });
      await connection.commit();
      return res.json({ success: true, action, message: 'Entry authorized. The vehicle has been checked in.', session: { id: sessionId, ticketCode, status: 'parked', enteredAt: new Date().toISOString() }, booking: { id: booking.id, bookingCode: booking.booking_code, parkingLotName: booking.parking_lot_name, slotCode: booking.slot_code, status: 'checked_in' }, physicalCheckRequired: booking.physical_state === 'unknown' });
    }

    if (booking.status !== 'checked_in') throw new GateError(409, 'NOT_CHECKED_IN', 'Exit requires an active parking session created by a valid entry.');
    const [sessions] = await connection.execute(
      "SELECT id, ticket_code, entered_at FROM parking_sessions WHERE booking_id = ? AND status = 'parked' ORDER BY entered_at DESC LIMIT 1 FOR UPDATE",
      [booking.id]
    );
    if (!sessions.length) throw new GateError(409, 'ACTIVE_SESSION_NOT_FOUND', 'No active parking session was found for this booking. Ask an operator to review the record.');
    const session = sessions[0];
    await connection.execute("UPDATE parking_sessions SET status = 'exited', exited_at = UTC_TIMESTAMP() WHERE id = ?", [session.id]);
    await connection.execute("UPDATE bookings SET status = 'completed' WHERE id = ?", [booking.id]);
    // A gate exit is not sufficient proof that the bay is physically empty;
    // leave it unknown until the camera or an authorized operator updates it.
    await connection.execute("UPDATE parking_slots SET physical_state = 'unknown', physical_state_updated_at = UTC_TIMESTAMP(3) WHERE id = ?", [booking.slot_id]);
    await connection.execute(
      'INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, metadata) VALUES (?, ?, ?, ?, ?)',
      [req.user.id, 'gate.exit_recorded', 'booking', booking.id, JSON.stringify({ sessionId: session.id, ticketCode: session.ticket_code, lotId: booking.parking_lot_id, slotId: booking.slot_id })]
    );
    await createNotification(connection, {
      userId: booking.user_id, eventType: 'parking.exit_recorded', title: 'Parking session completed',
      message: `Your parking session at ${booking.parking_lot_name}, space ${booking.slot_code}, has been marked complete.`,
      email: { templateKey: 'parking_exit_recorded', idempotencyKey: `parking-exit:${session.id}`, data: {
        bookingCode: booking.booking_code, lotName: booking.parking_lot_name, slotCode: booking.slot_code
      } }
    });
    await connection.commit();
    return res.json({ success: true, action, message: 'Exit recorded. The parking session is complete.', session: { id: session.id, ticketCode: session.ticket_code, status: 'exited', enteredAt: new Date(session.entered_at).toISOString(), exitedAt: new Date().toISOString() }, booking: { id: booking.id, bookingCode: booking.booking_code, parkingLotName: booking.parking_lot_name, slotCode: booking.slot_code, status: 'completed' } });
  } catch (error) {
    await connection.rollback().catch(() => {});
    if (error instanceof GateError) return fail(res, error.status, error.code, error.message);
    throw error;
  } finally {
    connection.release();
  }
}));

export default router;
