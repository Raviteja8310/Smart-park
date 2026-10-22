import { Router } from 'express';
import { randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { pool } from '../config/database.js';
import { requireAuth, requireRole } from '../middleware/authenticate.js';
import { createNotification } from '../services/notifications.js';

const router = Router();
const asyncHandler = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
const uuidSchema = z.string().uuid();
const createSchema = z.object({
  subject: z.string().trim().min(6).max(160),
  description: z.string().trim().min(10).max(5000),
  category: z.enum(['booking','payment','entry_exit','facility','safety','account','technical','other']).default('other'),
  priority: z.enum(['low','normal','high','urgent']).default('normal'),
  bookingId: uuidSchema.optional().nullable(),
  parkingLotId: uuidSchema.optional().nullable()
});
const messageSchema = z.object({ message: z.string().trim().min(2).max(5000), internal: z.boolean().default(false) });
const statusSchema = z.object({ status: z.enum(['in_progress','waiting_on_user','resolved','closed']), note: z.string().trim().max(1000).optional().default('') });

function fail(res, status, code, message) { return res.status(status).json({ error: { code, message } }); }
function staff(user) { return (user?.roles ?? []).some((role) => ['admin','host','operator','attendant'].includes(role)); }
function canManageAnyLot(user) { return (user?.roles ?? []).some((role) => ['admin','host','operator','attendant'].includes(role)); }
function scopeFor(user, alias = 'l') {
  if (user.roles.includes('admin')) return { sql: '', params: [] };
  const parts = [];
  const params = [];
  if (user.roles.includes('host')) { parts.push(`${alias}.owner_user_id=?`); params.push(user.id); }
  const staffRoles = ['operator','attendant'].filter((role) => user.roles.includes(role));
  if (staffRoles.length) {
    parts.push(`EXISTS (SELECT 1 FROM parking_lot_staff pls WHERE pls.parking_lot_id=${alias}.id AND pls.user_id=? AND pls.assignment_role IN (${staffRoles.map(() => '?').join(',')}))`);
    params.push(user.id, ...staffRoles);
  }
  return parts.length ? { sql: ` AND (${parts.join(' OR ')})`, params } : { sql: ' AND 1=0', params: [] };
}
async function ticketById(executor, id) {
  const [rows] = await executor.execute(
    `SELECT t.*, u.full_name AS requester_name, u.email AS requester_email, l.name AS parking_lot_name,
            b.booking_code, assignee.full_name AS assignee_name
       FROM support_tickets t JOIN users u ON u.id=t.user_id
       LEFT JOIN parking_lots l ON l.id=t.parking_lot_id
       LEFT JOIN bookings b ON b.id=t.booking_id
       LEFT JOIN users assignee ON assignee.id=t.assigned_to_user_id
      WHERE t.id=? LIMIT 1`, [id]);
  return rows[0] ?? null;
}
async function canViewTicket(executor, ticket, user) {
  if (!ticket || !user) return false;
  if (ticket.user_id === user.id || user.roles.includes('admin')) return true;
  if (!ticket.parking_lot_id) return false;
  const scope = scopeFor(user, 'l');
  if (scope.sql === ' AND 1=0') return false;
  const [rows] = await executor.execute(`SELECT l.id FROM parking_lots l WHERE l.id=?${scope.sql} LIMIT 1`, [ticket.parking_lot_id, ...scope.params]);
  return rows.length > 0;
}
async function canUseLot(executor, lotId, user) {
  if (!lotId) return true;
  const scope = scopeFor(user, 'l');
  if (scope.sql === ' AND 1=0') return false;
  const [rows] = await executor.execute(`SELECT l.id FROM parking_lots l WHERE l.id=?${scope.sql} LIMIT 1`, [lotId, ...scope.params]);
  return rows.length > 0;
}
function mappedTicket(row) {
  return { id: row.id, ticketCode: row.ticket_code, userId: row.user_id, requesterName: row.requester_name ?? null,
    requesterEmail: row.requester_email ?? null, bookingId: row.booking_id, bookingCode: row.booking_code ?? null,
    parkingLotId: row.parking_lot_id, parkingLotName: row.parking_lot_name ?? null, assignedToUserId: row.assigned_to_user_id,
    assigneeName: row.assignee_name ?? null, category: row.category, priority: row.priority, status: row.status,
    subject: row.subject, description: row.description, resolutionNote: row.resolution_note, lastActivityAt: row.last_activity_at,
    resolvedAt: row.resolved_at, closedAt: row.closed_at, createdAt: row.created_at, updatedAt: row.updated_at };
}

router.get('/mine', requireAuth, asyncHandler(async (req, res) => {
  const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit ?? '50', 10) || 50));
  const [rows] = await pool.execute(
    `SELECT t.*, u.full_name AS requester_name, u.email AS requester_email, l.name AS parking_lot_name,
            b.booking_code, a.full_name AS assignee_name
       FROM support_tickets t JOIN users u ON u.id=t.user_id
       LEFT JOIN parking_lots l ON l.id=t.parking_lot_id LEFT JOIN bookings b ON b.id=t.booking_id
       LEFT JOIN users a ON a.id=t.assigned_to_user_id WHERE t.user_id=? ORDER BY t.last_activity_at DESC LIMIT ?`, [req.user.id, limit]);
  return res.json({ tickets: rows.map(mappedTicket) });
}));

router.get('/queue', requireAuth, requireRole('host','operator','attendant','admin'), asyncHandler(async (req, res) => {
  const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit ?? '100', 10) || 100));
  const status = req.query.status;
  if (status !== undefined && !['open','in_progress','waiting_on_user','resolved','closed','all'].includes(status)) return fail(res, 400, 'INVALID_STATUS', 'Choose a valid support status.');
  const scope = scopeFor(req.user, 'allowed_lot');
  const queueScope = req.user.roles.includes('admin') ? '' : ` AND ((t.assigned_to_user_id=? AND t.parking_lot_id IS NULL) OR (t.parking_lot_id IS NOT NULL AND EXISTS (SELECT 1 FROM parking_lots allowed_lot WHERE allowed_lot.id=t.parking_lot_id${scope.sql})))`;
  const statusSql = status && status !== 'all' ? ' AND t.status=?' : '';
  const params = [];
  if (!req.user.roles.includes('admin')) params.push(req.user.id, ...scope.params);
  if (statusSql) params.push(status);
  params.push(limit);
  const [rows] = await pool.execute(
    `SELECT t.*, u.full_name AS requester_name, u.email AS requester_email, l.name AS parking_lot_name,
            b.booking_code, a.full_name AS assignee_name
       FROM support_tickets t JOIN users u ON u.id=t.user_id LEFT JOIN parking_lots l ON l.id=t.parking_lot_id
       LEFT JOIN bookings b ON b.id=t.booking_id LEFT JOIN users a ON a.id=t.assigned_to_user_id
      WHERE 1=1${queueScope}${statusSql} ORDER BY FIELD(t.priority,'urgent','high','normal','low'),
        FIELD(t.status,'open','in_progress','waiting_on_user','resolved','closed'), t.last_activity_at DESC LIMIT ?`, params);
  return res.json({ tickets: rows.map(mappedTicket) });
}));

router.post('/', requireAuth, asyncHandler(async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 400, 'VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Check the support ticket details.');
  const input = parsed.data;
  let lotId = input.parkingLotId ?? null;
  if (input.bookingId) {
    const [bookingRows] = await pool.execute('SELECT id,user_id,parking_lot_id FROM bookings WHERE id=? LIMIT 1', [input.bookingId]);
    const booking = bookingRows[0];
    if (!booking || booking.user_id !== req.user.id) return fail(res, 400, 'INVALID_BOOKING', 'Choose a booking from your own account.');
    if (lotId && lotId !== booking.parking_lot_id) return fail(res, 400, 'BOOKING_FACILITY_MISMATCH', 'The selected booking does not belong to that facility.');
    lotId = booking.parking_lot_id;
  }
  if (lotId && !await canUseLot(pool, lotId, req.user) && !input.bookingId) return fail(res, 403, 'FACILITY_ACCESS_DENIED', 'You can reference a facility only when you own it or are assigned to manage it, unless you select one of your own bookings.');
  const id = randomUUID();
  const ticketCode = `SP-${new Date().toISOString().slice(2,10).replaceAll('-','')}-${randomBytes(2).toString('hex').toUpperCase()}`;
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.execute(
      `INSERT INTO support_tickets (id,ticket_code,user_id,booking_id,parking_lot_id,category,priority,subject,description)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [id,ticketCode,req.user.id,input.bookingId ?? null,lotId,input.category,input.priority,input.subject,input.description]);
    await connection.execute('INSERT INTO support_ticket_messages (id,ticket_id,sender_user_id,message_text,is_internal) VALUES (?,?,?,?,FALSE)', [randomUUID(),id,req.user.id,input.description]);
    await connection.execute('INSERT INTO audit_logs (actor_user_id,action,entity_type,entity_id,metadata) VALUES (?,?,?,?,?)',
      [req.user.id,'support.ticket.created','support_ticket',id,JSON.stringify({ ticketCode, category: input.category, priority: input.priority, bookingId: input.bookingId ?? null, parkingLotId: lotId })]);
    // Admins receive an in-app alert. Email/SMS delivery obeys the configured outbox/channel policy.
    const [admins] = await connection.execute(`SELECT DISTINCT ur.user_id FROM user_roles ur JOIN roles r ON r.id=ur.role_id JOIN users u ON u.id=ur.user_id WHERE r.role_key='admin' AND u.account_status='active'`);
    await Promise.all(admins.map((row) => createNotification(connection, { userId: row.user_id, eventType: 'support.ticket_created', title: `Support ticket ${ticketCode}`, message: input.subject })));
    await connection.commit();
  } catch (error) { await connection.rollback().catch(() => {}); throw error; }
  finally { connection.release(); }
  const ticket = await ticketById(pool, id);
  return res.status(201).json({ ticket: mappedTicket(ticket), message: 'Support ticket created. Keep the ticket code for follow-up.' });
}));

router.get('/:ticketId', requireAuth, asyncHandler(async (req, res) => {
  const parsed = uuidSchema.safeParse(req.params.ticketId);
  if (!parsed.success) return fail(res, 400, 'INVALID_ID', 'The support ticket identifier is invalid.');
  const ticket = await ticketById(pool, parsed.data);
  if (!ticket || !await canViewTicket(pool, ticket, req.user)) return fail(res, 404, 'TICKET_NOT_FOUND', 'The support ticket was not found.');
  const maySeeInternal = ticket.user_id !== req.user.id && staff(req.user);
  const [messages] = await pool.execute(
    `SELECT m.id,m.sender_user_id,m.message_text,m.is_internal,m.created_at,u.full_name AS sender_name
       FROM support_ticket_messages m JOIN users u ON u.id=m.sender_user_id
      WHERE m.ticket_id=? ${maySeeInternal ? '' : 'AND m.is_internal=FALSE'} ORDER BY m.created_at ASC LIMIT 500`, [ticket.id]);
  return res.json({ ticket: mappedTicket(ticket), messages: messages.map((row) => ({ id: row.id, senderUserId: row.sender_user_id,
    senderName: row.sender_name, message: row.message_text, internal: Boolean(row.is_internal), createdAt: row.created_at })) });
}));

router.post('/:ticketId/messages', requireAuth, asyncHandler(async (req, res) => {
  const parsedId = uuidSchema.safeParse(req.params.ticketId);
  const parsed = messageSchema.safeParse(req.body);
  if (!parsedId.success) return fail(res, 400, 'INVALID_ID', 'The support ticket identifier is invalid.');
  if (!parsed.success) return fail(res, 400, 'VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Enter a message.');
  const ticket = await ticketById(pool, parsedId.data);
  if (!ticket || !await canViewTicket(pool, ticket, req.user)) return fail(res, 404, 'TICKET_NOT_FOUND', 'The support ticket was not found.');
  const internal = Boolean(parsed.data.internal && ticket.user_id !== req.user.id && staff(req.user));
  if (['closed','resolved'].includes(ticket.status) && ticket.user_id === req.user.id) return fail(res, 409, 'TICKET_CLOSED', 'This ticket is resolved or closed. Create a new ticket if the issue continues.');
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.execute('INSERT INTO support_ticket_messages (id,ticket_id,sender_user_id,message_text,is_internal) VALUES (?,?,?,?,?)', [randomUUID(),ticket.id,req.user.id,parsed.data.message,internal]);
    const newStatus = internal ? ticket.status : (ticket.user_id === req.user.id ? 'in_progress' : 'waiting_on_user');
    await connection.execute('UPDATE support_tickets SET last_activity_at=UTC_TIMESTAMP(3), status=? WHERE id=?', [newStatus,ticket.id]);
    await connection.execute('INSERT INTO audit_logs (actor_user_id,action,entity_type,entity_id,metadata) VALUES (?,?,?,?,?)',
      [req.user.id,'support.ticket.message_added','support_ticket',ticket.id,JSON.stringify({ internal, messageLength: parsed.data.message.length })]);
    if (!internal) {
      const recipientId = ticket.user_id === req.user.id ? ticket.assigned_to_user_id : ticket.user_id;
      if (recipientId && recipientId !== req.user.id) await createNotification(connection, { userId: recipientId, eventType: 'support.ticket_reply', title: `Reply on ${ticket.ticket_code}`, message: parsed.data.message.slice(0, 240) });
    }
    await connection.commit();
  } catch (error) { await connection.rollback().catch(() => {}); throw error; }
  finally { connection.release(); }
  return res.status(201).json({ success: true, message: 'Reply added.' });
}));

router.patch('/:ticketId/status', requireAuth, asyncHandler(async (req, res) => {
  const parsedId = uuidSchema.safeParse(req.params.ticketId);
  const parsed = statusSchema.safeParse(req.body);
  if (!parsedId.success) return fail(res, 400, 'INVALID_ID', 'The support ticket identifier is invalid.');
  if (!parsed.success) return fail(res, 400, 'VALIDATION_ERROR', 'Choose a valid support status and optional note.');
  const ticket = await ticketById(pool, parsedId.data);
  if (!ticket || !await canViewTicket(pool, ticket, req.user)) return fail(res, 404, 'TICKET_NOT_FOUND', 'The support ticket was not found.');
  if (!staff(req.user) || !await canViewTicket(pool, ticket, req.user) || (!ticket.parking_lot_id && !req.user.roles.includes('admin'))) {
    return fail(res, 403, 'FORBIDDEN', 'Only authorized support or facility staff can change ticket status.');
  }
  const resolvedAt = parsed.data.status === 'resolved' ? 'UTC_TIMESTAMP(3)' : 'NULL';
  const closedAt = parsed.data.status === 'closed' ? 'UTC_TIMESTAMP(3)' : 'NULL';
  await pool.execute(`UPDATE support_tickets SET status=?, resolution_note=?, resolved_at=${resolvedAt}, closed_at=${closedAt}, last_activity_at=UTC_TIMESTAMP(3) WHERE id=?`,
    [parsed.data.status, parsed.data.note || null, ticket.id]);
  await pool.execute('INSERT INTO audit_logs (actor_user_id,action,entity_type,entity_id,metadata) VALUES (?,?,?,?,?)',
    [req.user.id,'support.ticket.status_changed','support_ticket',ticket.id,JSON.stringify({ from: ticket.status, to: parsed.data.status, note: parsed.data.note || '' })]);
  if (ticket.user_id !== req.user.id) await createNotification(pool, { userId: ticket.user_id, eventType: 'support.ticket_status', title: `Ticket ${ticket.ticket_code} updated`, message: `Your support ticket status is now ${parsed.data.status.replaceAll('_',' ')}.` });
  return res.json({ success: true, status: parsed.data.status });
}));

export default router;
