import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { pool } from '../config/database.js';
import { createNotification } from '../services/notifications.js';

const POLL_MS = Math.max(15000, Number(process.env.OPERATIONS_MONITOR_POLL_MS || 60000));
const GRACE_MINUTES = Math.min(120, Math.max(1, Number(process.env.OVERSTAY_GRACE_MINUTES || 10)));
let stopping = false;

export async function runOperationsMonitor({ once = false, executor = pool, logger = console } = {}) {
  do {
    try {
      const result = await runOperationsMonitorOnce({ executor, graceMinutes: GRACE_MINUTES });
      logger.info?.(`SmartPark operations scan: overdue=${result.overdue}, newIncidents=${result.newIncidents}, expiredCommands=${result.expiredCommands}`);
      if (once) return result;
    } catch (error) {
      logger.error?.('SmartPark operations monitor scan failed:', error?.code ?? error?.message ?? 'unknown error');
      if (once) throw error;
    }
    if (!once) await delay(POLL_MS);
  } while (!stopping);
}

export async function runOperationsMonitorOnce({ executor = pool, graceMinutes = GRACE_MINUTES } = {}) {
  const [overdueRows] = await executor.execute(
    `SELECT s.id AS session_id,s.booking_id,s.parking_lot_id,s.slot_id,s.entered_at,
            b.booking_code,b.user_id AS driver_user_id,b.end_at,l.name AS lot_name,l.owner_user_id,
            GREATEST(0,TIMESTAMPDIFF(MINUTE,b.end_at,UTC_TIMESTAMP())) AS minutes_overdue
       FROM parking_sessions s JOIN bookings b ON b.id=s.booking_id
       JOIN parking_lots l ON l.id=s.parking_lot_id
      WHERE s.status='parked' AND b.status='checked_in'
        AND b.end_at < DATE_SUB(UTC_TIMESTAMP(),INTERVAL ? MINUTE)
      ORDER BY b.end_at ASC LIMIT 1000`, [graceMinutes]);

  let newIncidents = 0;
  const activeSessionIds = [];
  for (const row of overdueRows) {
    activeSessionIds.push(row.session_id);
    const incidentId = randomUUID();
    const [insertResult] = await executor.execute(
      `INSERT IGNORE INTO overstay_incidents (id,session_id,booking_id,parking_lot_id,slot_id,status,grace_minutes,minutes_overdue)
       VALUES (?,?,?,?,?,'active',?,?)`,
      [incidentId,row.session_id,row.booking_id,row.parking_lot_id,row.slot_id,graceMinutes,Number(row.minutes_overdue || 0)]);
    const isNew = Number(insertResult.affectedRows) === 1;
    if (isNew) newIncidents += 1;
    await executor.execute(
      `UPDATE overstay_incidents SET status='active',grace_minutes=?,minutes_overdue=?,last_observed_at=UTC_TIMESTAMP(3),resolved_at=NULL,resolved_by_user_id=NULL,resolution_note=NULL
        WHERE session_id=? AND status<>'manual_review'`,
      [graceMinutes,Number(row.minutes_overdue || 0),row.session_id]);
    await executor.execute(
      `INSERT INTO operational_alerts (id,fingerprint,parking_lot_id,source_type,source_id,alert_type,severity,title,message,status,condition_active)
       VALUES (?,?,?,'booking',?,'overstay_detected',?,?,?,'open',TRUE)
       ON DUPLICATE KEY UPDATE last_seen_at=UTC_TIMESTAMP(3),severity=VALUES(severity),title=VALUES(title),message=VALUES(message),
         status=IF(status='resolved','open',status),condition_active=TRUE`,
      [randomUUID(),`overstay:${row.session_id}`,row.parking_lot_id,row.session_id,Number(row.minutes_overdue)>=30?'critical':'warning',
       'Vehicle overstay detected',`Booking ${row.booking_code} at ${row.lot_name} is ${Number(row.minutes_overdue)} minutes past the reserved end time. Review the session and apply the facility's published overstay policy. No automatic charge has been applied.`]);
    if (isNew) {
      const notify = [];
      if (row.owner_user_id) notify.push(row.owner_user_id);
      if (row.driver_user_id && row.driver_user_id !== row.owner_user_id) notify.push(row.driver_user_id);
      await Promise.all([...new Set(notify)].map((userId) => createNotification(executor, {
        userId, eventType: 'operations.overstay_detected', title: 'Vehicle overstay detected',
        message: `Booking ${row.booking_code} at ${row.lot_name} is past its reserved end time. Contact the facility if you need help.`
      })));
    }
  }

  // Close incidents when their session ended or the reservation was legitimately extended.
  await executor.execute(
    `UPDATE overstay_incidents oi
       LEFT JOIN parking_sessions s ON s.id=oi.session_id
       LEFT JOIN bookings b ON b.id=oi.booking_id
        SET oi.status='resolved',oi.resolved_at=COALESCE(oi.resolved_at,UTC_TIMESTAMP(3)),oi.last_observed_at=UTC_TIMESTAMP(3),
            oi.resolution_note=COALESCE(oi.resolution_note,IF(s.status='exited','Session exited','Reservation no longer overdue'))
      WHERE oi.status='active' AND (s.id IS NULL OR s.status<>'parked' OR b.id IS NULL OR b.status<>'checked_in' OR b.end_at>=DATE_SUB(UTC_TIMESTAMP(),INTERVAL ? MINUTE))`,
    [graceMinutes]);
  await executor.execute(
    `UPDATE operational_alerts a JOIN overstay_incidents oi ON a.source_id=oi.session_id
        SET a.status='resolved',a.condition_active=FALSE,a.resolved_at=COALESCE(a.resolved_at,UTC_TIMESTAMP()),a.last_seen_at=UTC_TIMESTAMP(3)
      WHERE a.alert_type='overstay_detected' AND oi.status='resolved' AND a.status<>'resolved'`);
  const [expired] = await executor.execute(
    `UPDATE gate_device_commands SET status='expired',failure_message='Command expired before delivery',completed_at=UTC_TIMESTAMP(3)
      WHERE status='queued' AND expires_at<=UTC_TIMESTAMP(3)`);
  return { overdue: overdueRows.length, newIncidents, expiredCommands: Number(expired.affectedRows || 0), activeSessionIds };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const once = process.argv.includes('--once');
  process.on('SIGTERM', () => { stopping = true; });
  process.on('SIGINT', () => { stopping = true; });
  runOperationsMonitor({ once }).then(async () => { await pool.end(); process.exitCode = 0; }).catch(async (error) => {
    console.error('SmartPark operations monitor stopped:', error?.code ?? error?.message ?? 'unknown error');
    await pool.end().catch(() => {}); process.exitCode = 1;
  });
}
