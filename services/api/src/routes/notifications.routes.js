import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../config/database.js';
import { requireAuth } from '../middleware/authenticate.js';

const router = Router();
const asyncHandler = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
const idSchema = z.string().uuid();
const listSchema = z.object({ limit: z.coerce.number().int().min(1).max(100).default(50), unreadOnly: z.enum(['true', 'false']).default('false') });

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
