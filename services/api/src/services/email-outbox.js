import { randomUUID } from 'node:crypto';
import { normalizeEmailTemplateData } from './transactional-email.js';

export async function enqueueTransactionalEmail(executor, { userId, idempotencyKey, templateKey, data }) {
  if (!userId) return { queued: false, reason: 'missing_user' };
  if (typeof idempotencyKey !== 'string' || !idempotencyKey.trim() || idempotencyKey.length > 190) {
    throw new Error('A valid transactional email idempotency key is required.');
  }
  const templateData = normalizeEmailTemplateData(templateKey, data);
  const [users] = await executor.execute(
    `SELECT email, email_verified_at, account_status FROM users WHERE id = ? LIMIT 1`,
    [userId]
  );
  const user = users[0];
  if (!user || user.account_status !== 'active' || !user.email_verified_at || !user.email) {
    return { queued: false, reason: 'user_not_email_eligible' };
  }

  const id = randomUUID();
  const [result] = await executor.execute(
    `INSERT INTO transactional_email_outbox
       (id, idempotency_key, recipient_user_id, recipient_email, template_key, template_data, status, attempt_count, next_attempt_at)
     VALUES (?, ?, ?, ?, ?, ?, 'queued', 0, UTC_TIMESTAMP(3))
     ON DUPLICATE KEY UPDATE id = id`,
    [id, idempotencyKey, userId, user.email, templateKey, JSON.stringify(templateData)]
  );
  return { queued: result.affectedRows === 1, duplicate: result.affectedRows !== 1 };
}
