import { randomUUID } from 'node:crypto';
import { enqueueTransactionalEmail } from './email-outbox.js';

export async function createNotification(executor, {
  userId, channel = 'in_app', eventType, title, message, deliveryStatus = (channel === 'in_app' ? 'sent' : 'queued'), email = null
}) {
  if (!userId || !eventType || !title || !message) return false;
  let notificationRecorded = false;
  try {
    await executor.execute(
      `INSERT INTO notifications (id, user_id, channel, event_type, title, message, delivery_status)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [randomUUID(), userId, channel, eventType, title.slice(0, 160), message.slice(0, 1000), deliveryStatus]
    );
    notificationRecorded = true;
  } catch (error) {
    // In-app inbox failures are logged, but must not block a confirmed business transaction.
    console.warn('SmartPark notification could not be recorded:', error?.code ?? error?.message ?? 'unknown error');
  }
  // The email outbox is different: callers request it only inside a business transaction.
  // If enqueueing fails, propagate the error so the surrounding transaction can roll back.
  if (email) await enqueueTransactionalEmail(executor, { userId, ...email });
  return notificationRecorded;
}

export async function notifyAdmins(executor, notification) {
  const [rows] = await executor.execute(
    `SELECT DISTINCT ur.user_id
       FROM user_roles ur JOIN roles r ON r.id = ur.role_id
       JOIN users u ON u.id = ur.user_id
      WHERE r.role_key = 'admin' AND u.account_status = 'active'`
  );
  await Promise.all(rows.map((row) => createNotification(executor, { ...notification, userId: row.user_id })));
}
