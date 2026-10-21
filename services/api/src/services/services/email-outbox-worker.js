import { randomUUID } from 'node:crypto';
import { retryDelaySeconds } from './transactional-email.js';

export const MAX_EMAIL_ATTEMPTS = 8;
const LOCK_MINUTES = 10;

export async function claimNextEmail(executorPool, worker = `email-${process.pid}-${randomUUID()}`) {
  const connection = await executorPool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.execute(
      `UPDATE transactional_email_outbox
          SET status = 'failed', locked_by = NULL, locked_until = NULL,
              last_error = COALESCE(last_error, 'Worker lease expired after the final attempt')
        WHERE status = 'sending' AND locked_until < UTC_TIMESTAMP(3) AND attempt_count >= ?`,
      [MAX_EMAIL_ATTEMPTS]
    );
    const [rows] = await connection.execute(
      `SELECT id, idempotency_key, recipient_email, template_key, template_data, attempt_count
         FROM transactional_email_outbox
        WHERE attempt_count < ?
          AND ((status = 'queued' AND next_attempt_at <= UTC_TIMESTAMP(3))
            OR (status = 'sending' AND locked_until < UTC_TIMESTAMP(3)))
        ORDER BY next_attempt_at ASC, created_at ASC
        LIMIT 1 FOR UPDATE SKIP LOCKED`,
      [MAX_EMAIL_ATTEMPTS]
    );
    if (!rows.length) {
      await connection.commit();
      return null;
    }
    const row = rows[0];
    const nextAttempt = Number(row.attempt_count) + 1;
    await connection.execute(
      `UPDATE transactional_email_outbox
          SET status = 'sending', attempt_count = ?, locked_by = ?,
              locked_until = DATE_ADD(UTC_TIMESTAMP(3), INTERVAL ${LOCK_MINUTES} MINUTE), last_error = NULL
        WHERE id = ?`,
      [nextAttempt, worker, row.id]
    );
    await connection.commit();
    let templateData = row.template_data;
    if (typeof templateData === 'string') templateData = JSON.parse(templateData);
    return { ...row, template_data: templateData, attempt_count: nextAttempt, locked_by: worker };
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally {
    connection.release();
  }
}

async function markSent(executorPool, record, delivery) {
  await executorPool.execute(
    `UPDATE transactional_email_outbox
        SET status = ?, sent_at = IF(? = 1, NULL, UTC_TIMESTAMP(3)), processed_at = UTC_TIMESTAMP(3),
            provider_message_id = ?, locked_by = NULL, locked_until = NULL, last_error = NULL
      WHERE id = ? AND status = 'sending' AND locked_by = ?`,
    [delivery.simulated ? 'simulated' : 'sent', delivery.simulated ? 1 : 0, delivery.messageId, record.id, record.locked_by]
  );
}

async function markFailedOrRetry(executorPool, record, error) {
  const failed = record.attempt_count >= MAX_EMAIL_ATTEMPTS;
  const waitSeconds = retryDelaySeconds(record.attempt_count);
  const safeCode = String(error?.code ?? error?.responseCode ?? 'DELIVERY_FAILED').replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 60) || 'DELIVERY_FAILED';
  const safeMessage = `${safeCode}: delivery attempt failed`.slice(0, 500);
  await executorPool.execute(
    `UPDATE transactional_email_outbox
        SET status = ?, next_attempt_at = DATE_ADD(UTC_TIMESTAMP(3), INTERVAL ? SECOND),
            locked_by = NULL, locked_until = NULL, last_error = ?
      WHERE id = ? AND status = 'sending' AND locked_by = ?`,
    [failed ? 'failed' : 'queued', waitSeconds, safeMessage, record.id, record.locked_by]
  );
  return { failed, waitSeconds, safeCode };
}

export async function processOneEmail(executorPool, sender, logger = console, worker = `email-${process.pid}-${randomUUID()}`) {
  const record = await claimNextEmail(executorPool, worker);
  if (!record) return { processed: false };
  try {
    const delivery = await sender(record);
    await markSent(executorPool, record, delivery);
    logger.info?.(`SmartPark email ${delivery.simulated ? 'logged only (not delivered)' : 'delivered'}: id=${record.id}`);
    return { processed: true, sent: true, simulated: Boolean(delivery.simulated) };
  } catch (error) {
    const result = await markFailedOrRetry(executorPool, record, error);
    logger.error?.(`SmartPark email ${result.failed ? 'failed permanently' : 'scheduled for retry'}: id=${record.id}, code=${result.safeCode}, attempt=${record.attempt_count}`);
    return { processed: true, sent: false, ...result };
  }
}
