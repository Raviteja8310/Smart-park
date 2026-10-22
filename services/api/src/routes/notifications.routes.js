import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../config/database.js';
import { requireAuth } from '../middleware/authenticate.js';

const router = Router();
const asyncHandler = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
const idSchema = z.string().uuid();
const listSchema = z.object({ limit: z.coerce.number().int().min(1).max(100).default(50), unreadOnly: z.enum(['true', 'false']).default('false') });
const notificationPreferenceSchema = z.object({ smsEnabled: z.boolean() });

router.get('/preferences', requireAuth, asyncHandler(async (req, res) => {
  const [[user]] = await pool.execute('SELECT phone FROM users WHERE id=? LIMIT 1', [req.user.id]);
  const [[prefs]] = await pool.execute('SELECT sms_enabled,sms_consent_at,updated_at FROM user_notification_preferences WHERE user_id=? LIMIT 1', [req.user.id]);
  return res.json({ preferences: { smsEnabled: Boolean(prefs?.sms_enabled), smsConsentAt: prefs?.sms_consent_at ?? null, phoneConfigured: Boolean(user?.phone), phone: user?.phone ?? '' }, smsProviderConfigured: process.env.SMS_PROVIDER === 'twilio' });
}));

router.patch('/preferences', requireAuth, asyncHandler(async (req, res) => {
  const parsed = notificationPreferenceSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Choose whether to opt in to SMS notifications.' } });
  const [users] = await pool.execute('SELECT phone FROM users WHERE id=? LIMIT 1', [req.user.id]);
  const phone = String(users[0]?.phone ?? '').trim();
  if (parsed.data.smsEnabled && !/^\+[1-9][0-9]{7,14}$/.test(phone)) return res.status(400).json({ error: { code: 'PHONE_REQUIRED', message: 'Add a valid phone number in international E.164 format on My profile (for example, +919876543210) before opting in.' } });
  await pool.execute(`INSERT INTO user_notification_preferences (user_id,sms_enabled,sms_consent_at) VALUES (?,?,IF(?,UTC_TIMESTAMP(3),NULL)) ON DUPLICATE KEY UPDATE sms_enabled=VALUES(sms_enabled),sms_consent_at=IF(VALUES(sms_enabled)=TRUE,COALESCE(sms_consent_at,UTC_TIMESTAMP(3)),NULL)`, [req.user.id,parsed.data.smsEnabled,parsed.data.smsEnabled]);
  if (!parsed.data.smsEnabled) {
    await pool.execute("UPDATE notifications SET delivery_status='failed',delivery_last_error='Recipient withdrew SMS consent',delivery_locked_by=NULL,delivery_locked_until=NULL WHERE user_id=? AND channel='sms' AND delivery_status IN ('queued','sending')", [req.user.id]);
  }
  await pool.execute('INSERT INTO audit_logs (actor_user_id,action,entity_type,entity_id,metadata) VALUES (?,?,?,?,?)', [req.user.id,parsed.data.smsEnabled?'notification.sms_opt_in':'notification.sms_opt_out','user',req.user.id,JSON.stringify({smsEnabled:parsed.data.smsEnabled})]);
  return res.json({ success:true, preferences:{smsEnabled:parsed.data.smsEnabled,phoneConfigured:Boolean(phone),phone} });
}));

router.get('/mine', requireAuth, asyncHandler(async (req, res) => {
  const parsed = listSchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Check the notification list filters.' } });
  const whereUnread = parsed.data.unreadOnly === 'true' ? "AND delivery_status <> 'read'" : '';
  const [rows] = await pool.execute(
    `SELECT id, channel, event_type, title, message, delivery_status, created_at, read_at
       FROM notifications WHERE user_id = ? ${whereUnread}
      ORDER BY created_at DESC LIMIT ?`,
    [req.user.id, parsed.data.limit]
  );
  const [[counts]] = await pool.execute(
    `SELECT COUNT(*) AS total_count,
            SUM(delivery_status <> 'read') AS unread_count
       FROM notifications WHERE user_id = ?`,
    [req.user.id]
  );
  return res.json({ notifications: rows, totalCount: Number(counts.total_count || 0), unreadCount: Number(counts.unread_count || 0) });
}));

router.post('/read-all', requireAuth, asyncHandler(async (req, res) => {
  const [result] = await pool.execute(
    "UPDATE notifications SET delivery_status = 'read', read_at = UTC_TIMESTAMP() WHERE user_id = ? AND delivery_status <> 'read'",
    [req.user.id]
  );
  return res.json({ success: true, updatedCount: result.affectedRows });
}));

router.post('/:notificationId/read', requireAuth, asyncHandler(async (req, res) => {
  const parsed = idSchema.safeParse(req.params.notificationId);
  if (!parsed.success) return res.status(400).json({ error: { code: 'INVALID_ID', message: 'The notification identifier is invalid.' } });
  const [result] = await pool.execute(
    "UPDATE notifications SET delivery_status = 'read', read_at = UTC_TIMESTAMP() WHERE id = ? AND user_id = ?",
    [parsed.data, req.user.id]
  );
  if (!result.affectedRows) {
    const [rows] = await pool.execute('SELECT id FROM notifications WHERE id = ? AND user_id = ? LIMIT 1', [parsed.data, req.user.id]);
    if (!rows.length) return res.status(404).json({ error: { code: 'NOTIFICATION_NOT_FOUND', message: 'The notification was not found.' } });
  }
  return res.json({ success: true });
}));

export default router;
