import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { pool } from '../config/database.js';
import { requireAuth, requireRole } from '../middleware/authenticate.js';
import { normalizeRevenueRows, normalizeStatusFilter, resolveDateRange } from '../operations/reporting.js';
import { createNotification } from '../services/notifications.js';

const router = Router();
const asyncHandler = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
const managementRoles = ['host', 'operator', 'admin'];
const alertRoles = ['host', 'operator', 'attendant', 'admin'];
const dateQuerySchema = z.object({ from: z.string().optional(), to: z.string().optional() });
const alertIdSchema = z.string().uuid();
const reconciliationSchema = z.object({
  disposition: z.enum(['refunded_externally', 'reviewed_no_refund']),
  resolutionNote: z.string().trim().min(10).max(1000),
  externalReference: z.string().trim().min(3).max(180)
});

function fail(res, status, code, message) {
  return res.status(status).json({ error: { code, message } });
}

function lotScope(user, alias = 'l') {
  if (user.roles.includes('admin')) return { sql: '', params: [] };
  const clauses = [];
  const params = [];
  if (user.roles.includes('host')) {
    clauses.push(`${alias}.owner_user_id = ?`);
    params.push(user.id);
  }
  const staffRoles = ['operator', 'attendant'].filter((role) => user.roles.includes(role));
  if (staffRoles.length) {
    clauses.push(`EXISTS (SELECT 1 FROM parking_lot_staff access_staff
                            WHERE access_staff.parking_lot_id = ${alias}.id
                              AND access_staff.user_id = ?
                              AND access_staff.assignment_role IN (${staffRoles.map(() => '?').join(',')}))`);
    params.push(user.id, ...staffRoles);
  }
  return clauses.length ? { sql: ` AND (${clauses.join(' OR ')})`, params } : { sql: ' AND 1 = 0', params: [] };
}

async function recordAudit(actorId, action, entityType, entityId, metadata = {}) {
  await pool.execute(
    'INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, metadata) VALUES (?, ?, ?, ?, ?)',
    [actorId ?? null, action, entityType, entityId ?? null, JSON.stringify(metadata)]
  );
}

async function alertRecipients(parkingLotId) {
  if (!parkingLotId) {
    const [admins] = await pool.execute(
      `SELECT DISTINCT ur.user_id FROM user_roles ur JOIN roles r ON r.id=ur.role_id
       JOIN users u ON u.id=ur.user_id WHERE r.role_key='admin' AND u.account_status='active'`
    );
    return admins.map((row) => row.user_id);
  }
  const [rows] = await pool.execute(
    `SELECT l.owner_user_id AS user_id FROM parking_lots l WHERE l.id=? AND l.owner_user_id IS NOT NULL
     UNION
     SELECT s.user_id FROM parking_lot_staff s WHERE s.parking_lot_id=?
     UNION
     SELECT ur.user_id FROM user_roles ur JOIN roles r ON r.id=ur.role_id JOIN users u ON u.id=ur.user_id
      WHERE r.role_key='admin' AND u.account_status='active'`,
    [parkingLotId, parkingLotId]
  );
  return rows.map((row) => row.user_id);
}

async function upsertOperationalAlert(alert) {
  const [result] = await pool.execute(
    `INSERT INTO operational_alerts
       (id, fingerprint, parking_lot_id, source_type, source_id, alert_type, severity, title, message, status, condition_active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', TRUE)
     ON DUPLICATE KEY UPDATE
       last_seen_at=UTC_TIMESTAMP(3), severity=VALUES(severity), title=VALUES(title), message=VALUES(message),
       resolved_at=IF(condition_active=FALSE AND status='resolved',NULL,resolved_at),
       resolved_by_user_id=IF(condition_active=FALSE AND status='resolved',NULL,resolved_by_user_id),
       status=IF(condition_active=FALSE AND status='resolved','open',status),
       condition_active=TRUE`,
    [randomUUID(), alert.fingerprint, alert.parkingLotId ?? null, alert.sourceType, alert.sourceId ?? null,
      alert.alertType, alert.severity, alert.title, alert.message]
  );
  if (result.affectedRows === 1) {
    try {
      const users = await alertRecipients(alert.parkingLotId);
      await Promise.all([...new Set(users)].map((userId) => createNotification(pool, {
        userId, eventType: `operations.${alert.alertType}`, title: alert.title, message: alert.message
      })));
    } catch (error) {
      console.warn('Could not notify operational alert recipients:', error?.code ?? error?.message ?? 'unknown error');
    }
  }
}

async function resolveInactiveAlerts(sourceType, activeSourceIds, scopedLotIds = null) {
  const params = [sourceType];
  const activeFilter = activeSourceIds.length
    ? ` AND source_id NOT IN (${activeSourceIds.map(() => '?').join(',')})`
    : '';
  params.push(...activeSourceIds);
  let lotFilter = '';
  if (scopedLotIds !== null) {
    lotFilter = scopedLotIds.length ? ` AND parking_lot_id IN (${scopedLotIds.map(() => '?').join(',')})` : ' AND 1=0';
    params.push(...scopedLotIds);
  }
  await pool.execute(
    `UPDATE operational_alerts SET
        resolved_at=IF(status IN ('open','acknowledged'),UTC_TIMESTAMP(),resolved_at),
        resolved_by_user_id=IF(status IN ('open','acknowledged'),NULL,resolved_by_user_id),
        status=IF(status IN ('open','acknowledged'),'resolved',status),
        condition_active=FALSE
      WHERE source_type=?${activeFilter}${lotFilter}`,
    params
  );
}

async function refreshSystemAlerts(user) {
  let scopedLotIds = null;
  if (!user.roles.includes('admin')) {
    const scope = lotScope(user, 'l');
    const [accessibleLots] = await pool.execute(`SELECT l.id FROM parking_lots l WHERE 1=1${scope.sql}`, scope.params);
    scopedLotIds = accessibleLots.map((row) => row.id);
    if (!scopedLotIds.length) return;
  }
  const activeLotFilter = scopedLotIds === null ? '' : ` AND l.id IN (${scopedLotIds.map(() => '?').join(',')})`;
  const scopeParams = scopedLotIds ?? [];
  const [cameraRows] = await pool.execute(
    `SELECT c.id, c.parking_lot_id, c.name, c.status, c.last_frame_at, c.stale_after_seconds, l.name AS lot_name
       FROM cameras c JOIN parking_lots l ON l.id=c.parking_lot_id
      WHERE c.status <> 'disabled'
        AND (c.status='offline' OR c.last_frame_at IS NULL
             OR c.last_frame_at < DATE_SUB(UTC_TIMESTAMP(3), INTERVAL c.stale_after_seconds SECOND))${activeLotFilter}`,
    scopeParams
  );
  const cameraIds = [];
  for (const camera of cameraRows) {
    cameraIds.push(camera.id);
    const isOffline = camera.status === 'offline';
    const noFrame = !camera.last_frame_at;
    const title = isOffline ? 'Parking camera is offline' : 'Parking camera feed is stale';
    const message = isOffline
      ? `${camera.name} at ${camera.lot_name} is reporting offline. Slot detection may be unavailable.`
      : noFrame
        ? `${camera.name} at ${camera.lot_name} has not reported a frame yet. Complete setup and verify the feed.`
        : `${camera.name} at ${camera.lot_name} has not reported a recent frame. Check the camera connection and vision worker.`;
    await upsertOperationalAlert({
      fingerprint: `camera:${camera.id}`,
      parkingLotId: camera.parking_lot_id,
      sourceType: 'camera', sourceId: camera.id,
      alertType: isOffline ? 'camera_offline' : 'camera_stale',
      severity: isOffline ? 'critical' : 'warning', title, message
    });
  }
  await resolveInactiveAlerts('camera', cameraIds, scopedLotIds);

  const [paymentRows] = await pool.execute(
    `SELECT p.id, p.booking_id, p.provider_payment_id, b.booking_code, b.parking_lot_id, l.name AS lot_name
       FROM payments p JOIN bookings b ON b.id=p.booking_id JOIN parking_lots l ON l.id=b.parking_lot_id
      WHERE p.needs_reconciliation=TRUE${activeLotFilter}`,
    scopeParams
  );
  const paymentIds = [];
  for (const payment of paymentRows) {
    paymentIds.push(payment.id);
    await upsertOperationalAlert({
      fingerprint: `payment-reconciliation:${payment.id}`,
      parkingLotId: payment.parking_lot_id,
      sourceType: 'payment', sourceId: payment.id,
      alertType: 'payment_reconciliation', severity: 'critical',
      title: 'Captured payment needs review',
      message: `Payment for booking ${payment.booking_code} at ${payment.lot_name} was captured but the booking could not be confirmed automatically. Review the provider record before taking action.`
    });
  }
  await resolveInactiveAlerts('payment', paymentIds, scopedLotIds);
}

function dateRangeFromQuery(query) {
  const parsed = dateQuerySchema.safeParse(query);
  if (!parsed.success) throw new Error('Use from and to dates in YYYY-MM-DD format.');
  return resolveDateRange(parsed.data.from, parsed.data.to);
}

router.get('/summary', requireAuth, requireRole(...managementRoles), asyncHandler(async (req, res) => {
  await refreshSystemAlerts(req.user);
  const scope = lotScope(req.user, 'l');
  const [lotRows] = await pool.execute(
    `SELECT COUNT(*) AS active_lots FROM parking_lots l WHERE l.facility_status='active'${scope.sql}`,
    scope.params
  );
  const [slotRows] = await pool.execute(
    `SELECT COUNT(s.id) AS total_spaces,
            COALESCE(SUM(s.operational_status='open' AND s.physical_state='occupied'),0) AS occupied_spaces,
            COALESCE(SUM(s.physical_state='unknown'),0) AS unknown_spaces,
            COALESCE(SUM(s.operational_status<>'open'),0) AS unavailable_spaces,
            COALESCE(SUM(s.operational_status='open' AND s.physical_state='empty' AND NOT EXISTS (
              SELECT 1 FROM bookings b WHERE b.slot_id=s.id AND b.start_at<=UTC_TIMESTAMP() AND b.end_at>UTC_TIMESTAMP()
                AND (b.status IN ('confirmed','checked_in') OR (b.status IN ('held','pending_payment') AND b.hold_expires_at>UTC_TIMESTAMP()))
            )),0) AS available_spaces,
            COALESCE(SUM(s.operational_status='open' AND s.physical_state='empty' AND EXISTS (
              SELECT 1 FROM bookings b WHERE b.slot_id=s.id AND b.start_at<=UTC_TIMESTAMP() AND b.end_at>UTC_TIMESTAMP()
                AND (b.status IN ('confirmed','checked_in') OR (b.status IN ('held','pending_payment') AND b.hold_expires_at>UTC_TIMESTAMP()))
            )),0) AS reserved_empty_spaces
       FROM parking_slots s JOIN parking_lots l ON l.id=s.parking_lot_id
      WHERE l.facility_status='active'${scope.sql}`,
    scope.params
  );
  const [[bookingRow]] = await pool.execute(
    `SELECT COUNT(*) AS active_bookings FROM bookings b JOIN parking_lots l ON l.id=b.parking_lot_id
      WHERE b.status IN ('confirmed','checked_in') AND b.start_at<=UTC_TIMESTAMP() AND b.end_at>UTC_TIMESTAMP()${scope.sql}`,
    scope.params
  );
  const [[alertRow]] = await pool.execute(
    `SELECT COUNT(*) AS open_alerts, SUM(a.severity='critical') AS critical_alerts
       FROM operational_alerts a LEFT JOIN parking_lots l ON l.id=a.parking_lot_id
      WHERE a.status IN ('open','acknowledged')${req.user.roles.includes('admin') ? '' : ` AND a.parking_lot_id IS NOT NULL${scope.sql}`}`,
    req.user.roles.includes('admin') ? [] : scope.params
  );
  const revenueScope = lotScope(req.user, 'l');
  const [revenueRows] = await pool.execute(
    `SELECT p.currency, COALESCE(SUM(p.amount),0) AS amount, COUNT(*) AS payment_count
       FROM payments p JOIN bookings b ON b.id=p.booking_id JOIN parking_lots l ON l.id=b.parking_lot_id
      WHERE p.status='paid' AND p.needs_reconciliation=FALSE
        AND p.verified_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 30 DAY)${revenueScope.sql}
      GROUP BY p.currency ORDER BY p.currency`, revenueScope.params
  );
  const slots = slotRows[0] ?? {};
  return res.json({
    generatedAt: new Date().toISOString(),
    windowDays: 30,
    overview: {
      activeLots: Number(lotRows[0]?.active_lots || 0),
      totalSpaces: Number(slots.total_spaces || 0),
      availableNow: Number(slots.available_spaces || 0),
      occupiedNow: Number(slots.occupied_spaces || 0),
      unknownSpaces: Number(slots.unknown_spaces || 0),
      reservedEmptySpaces: Number(slots.reserved_empty_spaces || 0),
      unavailableSpaces: Number(slots.unavailable_spaces || 0),
      activeBookings: Number(bookingRow?.active_bookings || 0),
      openAlerts: Number(alertRow?.open_alerts || 0),
      criticalAlerts: Number(alertRow?.critical_alerts || 0),
      revenue30Days: revenueRows.map((row) => ({ currency: row.currency, amount: Number(row.amount || 0), paymentCount: Number(row.payment_count || 0) }))
    }
  });
}));

router.get('/reports/revenue', requireAuth, requireRole(...managementRoles), asyncHandler(async (req, res) => {
  let range;
  try { range = dateRangeFromQuery(req.query); } catch (error) { return fail(res, 400, 'INVALID_DATE_RANGE', error.message); }
  const scope = lotScope(req.user, 'l');
  const [rows] = await pool.execute(
    `SELECT DATE(p.verified_at) AS report_date, p.currency, SUM(p.amount) AS amount, COUNT(*) AS payment_count
       FROM payments p JOIN bookings b ON b.id=p.booking_id JOIN parking_lots l ON l.id=b.parking_lot_id
      WHERE p.status='paid' AND p.needs_reconciliation=FALSE
        AND p.verified_at >= ? AND p.verified_at < DATE_ADD(?, INTERVAL 1 DAY)${scope.sql}
      GROUP BY DATE(p.verified_at), p.currency ORDER BY DATE(p.verified_at), p.currency`,
    [`${range.from} 00:00:00`, `${range.to} 00:00:00`, ...scope.params]
  );
  return res.json({ range, series: normalizeRevenueRows(rows) });
}));

router.get('/reports/occupancy', requireAuth, requireRole(...managementRoles), asyncHandler(async (req, res) => {
  const scope = lotScope(req.user, 'l');
  const [rows] = await pool.execute(
    `SELECT l.id AS lot_id, l.name, l.city, l.currency,
            COUNT(s.id) AS total_spaces,
            COALESCE(SUM(s.operational_status='open' AND s.physical_state='occupied'),0) AS occupied_spaces,
            COALESCE(SUM(s.physical_state='unknown'),0) AS unknown_spaces,
            COALESCE(SUM(s.operational_status<>'open'),0) AS unavailable_spaces,
            COALESCE(SUM(s.operational_status='open' AND s.physical_state='empty' AND NOT EXISTS (
              SELECT 1 FROM bookings b WHERE b.slot_id=s.id AND b.start_at<=UTC_TIMESTAMP() AND b.end_at>UTC_TIMESTAMP()
                AND (b.status IN ('confirmed','checked_in') OR (b.status IN ('held','pending_payment') AND b.hold_expires_at>UTC_TIMESTAMP()))
            )),0) AS available_spaces,
            COALESCE(SUM(s.operational_status='open' AND s.physical_state='empty' AND EXISTS (
              SELECT 1 FROM bookings b WHERE b.slot_id=s.id AND b.start_at<=UTC_TIMESTAMP() AND b.end_at>UTC_TIMESTAMP()
                AND (b.status IN ('confirmed','checked_in') OR (b.status IN ('held','pending_payment') AND b.hold_expires_at>UTC_TIMESTAMP()))
            )),0) AS reserved_empty_spaces
       FROM parking_lots l LEFT JOIN parking_slots s ON s.parking_lot_id=l.id
      WHERE l.facility_status='active'${scope.sql}
      GROUP BY l.id, l.name, l.city, l.currency ORDER BY l.name`,
    scope.params
  );
  const lots = rows.map((row) => {
    const totalSpaces = Number(row.total_spaces || 0);
    const occupiedSpaces = Number(row.occupied_spaces || 0);
    return {
      lotId: row.lot_id, name: row.name, city: row.city, currency: row.currency,
      totalSpaces, occupiedSpaces, unknownSpaces: Number(row.unknown_spaces || 0),
      unavailableSpaces: Number(row.unavailable_spaces || 0),
      availableSpaces: Number(row.available_spaces || 0),
      reservedEmptySpaces: Number(row.reserved_empty_spaces || 0),
      occupancyPercent: totalSpaces ? Math.round((occupiedSpaces / totalSpaces) * 1000) / 10 : 0
    };
  });
  return res.json({ lots, generatedAt: new Date().toISOString() });
}));

router.get('/alerts', requireAuth, requireRole(...alertRoles), asyncHandler(async (req, res) => {
  await refreshSystemAlerts(req.user);
  let status;
  try { status = normalizeStatusFilter(req.query.status); } catch (error) { return fail(res, 400, 'INVALID_ALERT_FILTER', error.message); }
  const scope = lotScope(req.user, 'l');
  const conditions = [];
  const params = [];
  if (!req.user.roles.includes('admin')) {
    conditions.push(`a.parking_lot_id IS NOT NULL${scope.sql}`);
    params.push(...scope.params);
  }
  if (status) { conditions.push('a.status=?'); params.push(status); }
  const limit = Math.max(1, Math.min(100, Number.parseInt(req.query.limit ?? '50', 10) || 50));
  params.push(limit);
  const [rows] = await pool.execute(
    `SELECT a.id, a.fingerprint, a.parking_lot_id, l.name AS parking_lot_name, a.source_type, a.source_id,
            a.alert_type, a.severity, a.title, a.message, a.status, a.first_seen_at, a.last_seen_at,
            a.acknowledged_at, a.resolved_at
       FROM operational_alerts a LEFT JOIN parking_lots l ON l.id=a.parking_lot_id
      ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
      ORDER BY FIELD(a.status,'open','acknowledged','resolved'), FIELD(a.severity,'critical','warning','info'), a.last_seen_at DESC LIMIT ?`, params
  );
  return res.json({ alerts: rows, count: rows.length });
}));

async function accessibleAlert(req, alertId) {
  const [rows] = await pool.execute('SELECT id, parking_lot_id, status, title, source_type, source_id, alert_type FROM operational_alerts WHERE id=? LIMIT 1', [alertId]);
  const alert = rows[0];
  if (!alert) return { alert: null, allowed: false };
  if (req.user.roles.includes('admin')) return { alert, allowed: true };
  if (!alert.parking_lot_id) return { alert, allowed: false };
  const scope = lotScope(req.user, 'l');
  const [visible] = await pool.execute(`SELECT l.id FROM parking_lots l WHERE l.id=?${scope.sql} LIMIT 1`, [alert.parking_lot_id, ...scope.params]);
  return { alert, allowed: visible.length > 0 };
}

router.post('/alerts/:alertId/acknowledge', requireAuth, requireRole(...alertRoles), asyncHandler(async (req, res) => {
  const parsed = alertIdSchema.safeParse(req.params.alertId);
  if (!parsed.success) return fail(res, 400, 'INVALID_ID', 'The alert identifier is invalid.');
  const { alert, allowed } = await accessibleAlert(req, parsed.data);
  if (!alert || !allowed) return fail(res, 404, 'ALERT_NOT_FOUND', 'The alert was not found for a facility you can access.');
  if (alert.status === 'resolved') return fail(res, 409, 'ALERT_ALREADY_RESOLVED', 'This alert has already been resolved.');
  await pool.execute(
    "UPDATE operational_alerts SET status='acknowledged', acknowledged_by_user_id=?, acknowledged_at=UTC_TIMESTAMP() WHERE id=? AND status IN ('open','acknowledged')",
    [req.user.id, alert.id]
  );
  await recordAudit(req.user.id, 'operations.alert_acknowledged', 'operational_alert', alert.id, { title: alert.title });
  return res.json({ success: true, status: 'acknowledged' });
}));

router.post('/alerts/:alertId/resolve', requireAuth, requireRole('host', 'operator', 'admin'), asyncHandler(async (req, res) => {
  const parsed = alertIdSchema.safeParse(req.params.alertId);
  if (!parsed.success) return fail(res, 400, 'INVALID_ID', 'The alert identifier is invalid.');
  await refreshSystemAlerts(req.user);
  const { alert, allowed } = await accessibleAlert(req, parsed.data);
  if (!alert || !allowed) return fail(res, 404, 'ALERT_NOT_FOUND', 'The alert was not found for a facility you can access.');
  if (alert.status === 'resolved') return res.json({ success: true, status: 'resolved' });

  if (alert.source_type === 'payment' && alert.alert_type === 'payment_reconciliation') {
    if (!req.user.roles.includes('admin')) return fail(res, 403, 'ADMIN_REQUIRED', 'Only an administrator can close a payment reconciliation alert.');
    const decision = reconciliationSchema.safeParse(req.body);
    if (!decision.success) return fail(res, 400, 'RECONCILIATION_DETAILS_REQUIRED', 'Provide a disposition, a resolution note of at least 10 characters, and an external provider/case reference.');
    const [paymentRows] = await pool.execute(
      `SELECT p.id, p.status, p.needs_reconciliation, p.booking_id, p.provider, p.provider_payment_id,
              b.booking_code, b.user_id
         FROM payments p JOIN bookings b ON b.id=p.booking_id WHERE p.id=? LIMIT 1`,
      [alert.source_id]
    );
    const payment = paymentRows[0];
    if (!payment) return fail(res, 404, 'PAYMENT_NOT_FOUND', 'The payment associated with this alert was not found.');
    if (!payment.needs_reconciliation) {
      await pool.execute("UPDATE operational_alerts SET status='resolved', condition_active=FALSE, resolved_by_user_id=?, resolved_at=UTC_TIMESTAMP() WHERE id=?", [req.user.id, alert.id]);
      return res.json({ success: true, status: 'resolved' });
    }
    if (payment.status !== 'paid') return fail(res, 409, 'PAYMENT_STATE_CHANGED', 'The payment is no longer in the captured/paid state. Refresh operations and review the latest transaction state.');

    // This records an administrator's externally verified decision; it does not call a refund provider.
    const newPaymentStatus = decision.data.disposition === 'refunded_externally' ? 'refunded' : 'paid';
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [lockedRows] = await connection.execute('SELECT status, needs_reconciliation FROM payments WHERE id=? FOR UPDATE', [payment.id]);
      const lockedPayment = lockedRows[0];
      if (!lockedPayment || lockedPayment.status !== 'paid' || !lockedPayment.needs_reconciliation) {
        await connection.rollback();
        return fail(res, 409, 'PAYMENT_STATE_CHANGED', 'This payment was updated by another operation. Refresh and review its current state.');
      }
      await connection.execute('UPDATE payments SET status=?, needs_reconciliation=FALSE WHERE id=?', [newPaymentStatus, payment.id]);
      await connection.execute(
        'UPDATE operational_alerts SET status=\'resolved\', condition_active=FALSE, resolved_by_user_id=?, resolved_at=UTC_TIMESTAMP() WHERE id=?',
        [req.user.id, alert.id]
      );
      await connection.execute(
        'INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, metadata) VALUES (?, ?, ?, ?, ?)',
        [req.user.id, 'payment.reconciliation_recorded', 'payment', payment.id, JSON.stringify({ bookingId: payment.booking_id, bookingCode: payment.booking_code, disposition: decision.data.disposition, resolutionNote: decision.data.resolutionNote, externalReference: decision.data.externalReference, paymentStatus: newPaymentStatus, note: 'External provider/case resolution reference recorded by an administrator; this operation does not execute a refund.' })]
      );
      await createNotification(connection, {
        userId: payment.user_id, eventType: 'payment.reconciliation_reviewed', title: 'Payment review updated',
        message: decision.data.disposition === 'refunded_externally'
          ? `The payment review for booking ${payment.booking_code} was recorded as refunded externally. This action does not change or confirm the booking.`
          : `The payment review for booking ${payment.booking_code} was recorded by support. The booking status remains unchanged; contact support if you need further assistance.`
      });
      await connection.commit();
    } catch (error) {
      await connection.rollback().catch(() => {});
      throw error;
    } finally {
      connection.release();
    }
    return res.json({ success: true, status: 'resolved', paymentStatus: newPaymentStatus, bookingStatusChanged: false, refundExecuted: false });
  }

  if (alert.source_type === 'camera' && alert.source_id) {
    const [cameras] = await pool.execute(
      'SELECT status, last_frame_at, stale_after_seconds FROM cameras WHERE id=? LIMIT 1', [alert.source_id]
    );
    const camera = cameras[0];
    if (camera && camera.status !== 'disabled') {
      const stale = !camera.last_frame_at || new Date(camera.last_frame_at).getTime() < Date.now() - Number(camera.stale_after_seconds || 90) * 1000;
      if (camera.status === 'offline' || stale) return fail(res, 409, 'ALERT_CONDITION_ACTIVE', 'Fix or disable the camera first. The alert will resolve automatically when the feed is healthy.');
    }
  }

  await pool.execute(
    "UPDATE operational_alerts SET status='resolved', condition_active=FALSE, resolved_by_user_id=?, resolved_at=UTC_TIMESTAMP() WHERE id=? AND status <> 'resolved'",
    [req.user.id, alert.id]
  );
  await recordAudit(req.user.id, 'operations.alert_resolved', 'operational_alert', alert.id, { title: alert.title });
  return res.json({ success: true, status: 'resolved' });
}));

export default router;
