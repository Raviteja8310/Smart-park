import { randomUUID } from 'node:crypto';

export const MAX_SMS_ATTEMPTS = 5;
const LOCK_MINUTES = 2;
function retrySeconds(attempt) { return Math.min(6 * 60 * 60, 30 * (2 ** Math.max(0, attempt - 1))); }

export async function claimNextSms(executorPool, worker = `sms-${process.pid}-${randomUUID()}`) {
  const connection = await executorPool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.execute(`UPDATE notifications n LEFT JOIN user_notification_preferences p ON p.user_id=n.user_id JOIN users u ON u.id=n.user_id
      SET n.delivery_status='failed',n.delivery_last_error='SMS consent withdrawn or recipient phone unavailable',n.delivery_locked_by=NULL,n.delivery_locked_until=NULL
      WHERE n.channel='sms' AND n.delivery_status='queued' AND (COALESCE(p.sms_enabled,FALSE)=FALSE OR u.phone IS NULL OR u.phone NOT REGEXP '^\\\\+[1-9][0-9]{7,14}$')`);
    await connection.execute(`UPDATE notifications SET delivery_status='failed',delivery_locked_by=NULL,delivery_locked_until=NULL,delivery_last_error=COALESCE(delivery_last_error,'SMS delivery failed after maximum attempts') WHERE channel='sms' AND delivery_status='sending' AND delivery_locked_until<UTC_TIMESTAMP(3) AND delivery_attempt_count>=?`, [MAX_SMS_ATTEMPTS]);
    const [rows] = await connection.execute(`SELECT n.id,n.user_id,n.title,n.message,n.delivery_attempt_count,u.phone
      FROM notifications n JOIN users u ON u.id=n.user_id JOIN user_notification_preferences p ON p.user_id=n.user_id
      WHERE n.channel='sms' AND p.sms_enabled=TRUE AND n.delivery_attempt_count<?
        AND ((n.delivery_status='queued' AND n.next_attempt_at<=UTC_TIMESTAMP(3)) OR (n.delivery_status='sending' AND n.delivery_locked_until<UTC_TIMESTAMP(3)))
      ORDER BY n.next_attempt_at,n.created_at LIMIT 1 FOR UPDATE SKIP LOCKED`, [MAX_SMS_ATTEMPTS]);
    if (!rows.length) { await connection.commit(); return null; }
    const row = rows[0];
    const attempt = Number(row.delivery_attempt_count) + 1;
    await connection.execute(`UPDATE notifications SET delivery_status='sending',delivery_attempt_count=?,delivery_locked_by=?,delivery_locked_until=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL ${LOCK_MINUTES} MINUTE),delivery_last_error=NULL WHERE id=?`, [attempt,worker,row.id]);
    await connection.commit();
    return { ...row, delivery_attempt_count: attempt, delivery_locked_by: worker };
  } catch (error) { await connection.rollback().catch(() => {}); throw error; }
  finally { connection.release(); }
}

async function markSmsSent(executorPool, record, delivery) {
  await executorPool.execute(`UPDATE notifications SET delivery_status='sent',provider_message_id=?,delivery_locked_by=NULL,delivery_locked_until=NULL,delivery_last_error=NULL WHERE id=? AND delivery_status='sending' AND delivery_locked_by=?`, [delivery.messageId,record.id,record.delivery_locked_by]);
}
async function markSmsFailed(executorPool, record, error) {
  const permanentlyFailed = record.delivery_attempt_count >= MAX_SMS_ATTEMPTS;
  const code = String(error?.code ?? 'SMS_DELIVERY_FAILED').replace(/[^A-Za-z0-9_.-]/g,'').slice(0,60) || 'SMS_DELIVERY_FAILED';
  await executorPool.execute(`UPDATE notifications SET delivery_status=?,next_attempt_at=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL ? SECOND),delivery_locked_by=NULL,delivery_locked_until=NULL,delivery_last_error=? WHERE id=? AND delivery_status='sending' AND delivery_locked_by=?`, [permanentlyFailed?'failed':'queued',retrySeconds(record.delivery_attempt_count),`${code}: SMS attempt failed`,record.id,record.delivery_locked_by]);
  return { permanentlyFailed, code };
}

export async function processOneSms(executorPool, sender, logger = console, worker = `sms-${process.pid}-${randomUUID()}`) {
  const record = await claimNextSms(executorPool,worker);
  if (!record) return { processed:false };
  try {
    const delivery = await sender({ to: record.phone, body: `${record.title}: ${record.message}` });
    await markSmsSent(executorPool,record,delivery);
    logger.info?.(`SmartPark SMS sent: notification=${record.id}`);
    return { processed:true,sent:true };
  } catch (error) {
    const retry = await markSmsFailed(executorPool,record,error);
    logger.error?.(`SmartPark SMS ${retry.permanentlyFailed?'failed permanently':'scheduled for retry'}: notification=${record.id}, code=${retry.code}, attempt=${record.delivery_attempt_count}`);
    return { processed:true,sent:false,...retry };
  }
}
