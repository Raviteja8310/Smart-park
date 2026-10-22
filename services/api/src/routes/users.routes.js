import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../config/database.js';
import { requireAuth, requireRole } from '../middleware/authenticate.js';

const router = Router();
const asyncHandler = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
const listSchema = z.object({
  q: z.string().trim().max(120).optional().default(''),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).max(1000000).default(0)
});
const updateSchema = z.object({
  fullName: z.string().trim().min(2).max(120).optional(),
  phone: z.string().trim().max(30).nullable().optional(),
  accountStatus: z.enum(['active', 'suspended']).optional()
}).strict().refine((value) => Object.keys(value).length > 0, 'Provide at least one field to update.');
const uuidSchema = z.string().uuid();

function fail(res, status, code, message) {
  return res.status(status).json({ error: { code, message } });
}

async function audit(executor, actorId, action, targetId, metadata = {}) {
  await executor.execute(
    'INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, metadata) VALUES (?, ?, ?, ?, ?)',
    [actorId, action, 'user', targetId, JSON.stringify(metadata)]
  );
}

// Both listing and editing are administrator-only. Never return password hashes or tokens.
router.get('/', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const parsed = listSchema.safeParse(req.query);
  if (!parsed.success) return fail(res, 400, 'VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Check the query parameters.');
  const { q, limit, offset } = parsed.data;
  const search = `%${q.replace(/[\\%_]/g, '\\$&')}%`;
  const [countRows] = await pool.execute(
    `SELECT COUNT(*) AS total FROM users
      WHERE (? = '' OR full_name LIKE ? OR email LIKE ? OR phone LIKE ?)`,
    [q, search, search, search]
  );
  const [rows] = await pool.execute(
    `SELECT u.id, u.full_name, u.email, u.phone, u.account_status, u.email_verified_at, u.created_at,
            COALESCE(GROUP_CONCAT(DISTINCT r.role_key ORDER BY r.role_key SEPARATOR ','), '') AS role_keys
       FROM users u LEFT JOIN user_roles ur ON ur.user_id = u.id LEFT JOIN roles r ON r.id = ur.role_id
      WHERE (? = '' OR u.full_name LIKE ? OR u.email LIKE ? OR u.phone LIKE ?)
      GROUP BY u.id, u.full_name, u.email, u.phone, u.account_status, u.email_verified_at, u.created_at
      ORDER BY u.created_at DESC LIMIT ? OFFSET ?`,
    [q, search, search, search, limit, offset]
  );
  return res.json({
    users: rows.map((row) => ({
      id: row.id, fullName: row.full_name, email: row.email, phone: row.phone ?? '',
      accountStatus: row.account_status, emailVerifiedAt: row.email_verified_at,
      createdAt: row.created_at, roles: row.role_keys ? row.role_keys.split(',') : []
    })),
    pagination: { total: Number(countRows[0].total), limit, offset }
  });
}));

// Signed-in users may edit only their own basic profile fields.
const selfProfileSchema = z.object({
  fullName: z.string().trim().min(2, 'Name must contain at least 2 characters.').max(120).optional(),
  phone: z.string().trim().max(30, 'Phone number is too long.').nullable().optional()
}).strict().refine((value) => Object.keys(value).length > 0, 'Provide a name or phone number to update.');

router.patch('/me', requireAuth, asyncHandler(async (req, res) => {
  const parsed = selfProfileSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 400, 'VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Check the submitted fields.');
  const input = parsed.data;
  const columns = { fullName: 'full_name', phone: 'phone' };
  const updates = [];
  const values = [];
  for (const [key, value] of Object.entries(input)) {
    updates.push(`${columns[key]} = ?`);
    values.push(key === 'phone' && value === '' ? null : value);
  }
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [found] = await connection.execute('SELECT id, full_name, phone FROM users WHERE id = ? LIMIT 1 FOR UPDATE', [req.user.id]);
    if (!found.length) {
      await connection.rollback();
      return fail(res, 404, 'USER_NOT_FOUND', 'Your account was not found.');
    }
    const before = found[0];
    await connection.execute(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, [...values, req.user.id]);
    await audit(connection, req.user.id, 'user.profile.updated', req.user.id, {
      fields: Object.keys(input),
      changedName: Object.hasOwn(input, 'fullName') && input.fullName !== before.full_name,
      changedPhone: Object.hasOwn(input, 'phone') && input.phone !== (before.phone ?? '')
    });
    await connection.commit();
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally {
    connection.release();
  }
  const [rows] = await pool.execute(
    `SELECT u.id, u.full_name, u.email, u.phone, u.email_verified_at,
            COALESCE(GROUP_CONCAT(DISTINCT r.role_key ORDER BY r.role_key SEPARATOR ','), '') AS role_keys
       FROM users u LEFT JOIN user_roles ur ON ur.user_id = u.id LEFT JOIN roles r ON r.id = ur.role_id
      WHERE u.id = ? GROUP BY u.id, u.full_name, u.email, u.phone, u.email_verified_at`, [req.user.id]
  );
  const row = rows[0];
  return res.json({ user: {
    id: row.id, fullName: row.full_name, email: row.email, phone: row.phone ?? '',
    emailVerifiedAt: row.email_verified_at, roles: row.role_keys ? row.role_keys.split(',') : []
  }, message: 'Profile updated.' });
}));

router.patch('/:userId', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const id = uuidSchema.safeParse(req.params.userId);
  if (!id.success) return fail(res, 400, 'INVALID_ID', 'The user identifier is invalid.');
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 400, 'VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Check the submitted fields.');
  const input = parsed.data;
  if (id.data === req.user.id && input.accountStatus === 'suspended') {
    return fail(res, 409, 'CANNOT_SUSPEND_SELF', 'You cannot suspend your own administrator account.');
  }
  const columns = { fullName: 'full_name', phone: 'phone', accountStatus: 'account_status' };
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [found] = await connection.execute(
      'SELECT id, full_name, phone, account_status FROM users WHERE id = ? LIMIT 1 FOR UPDATE', [id.data]
    );
    if (!found.length) {
      await connection.rollback();
      return fail(res, 404, 'USER_NOT_FOUND', 'The user account was not found.');
    }
    const before = found[0];
    const updates = [];
    const values = [];
    for (const [key, value] of Object.entries(input)) {
      updates.push(`${columns[key]} = ?`);
      values.push(key === 'phone' && value === '' ? null : value);
    }
    await connection.execute(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, [...values, id.data]);
    await audit(connection, req.user.id, 'user.updated', id.data, {
      fields: Object.keys(input),
      previousStatus: before.account_status,
      newStatus: input.accountStatus ?? before.account_status
    });
    await connection.commit();
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally {
    connection.release();
  }
  const [rows] = await pool.execute(
    `SELECT u.id, u.full_name, u.email, u.phone, u.account_status, u.email_verified_at, u.created_at,
            COALESCE(GROUP_CONCAT(DISTINCT r.role_key ORDER BY r.role_key SEPARATOR ','), '') AS role_keys
       FROM users u LEFT JOIN user_roles ur ON ur.user_id = u.id LEFT JOIN roles r ON r.id = ur.role_id
      WHERE u.id = ? GROUP BY u.id, u.full_name, u.email, u.phone, u.account_status, u.email_verified_at, u.created_at`,
    [id.data]
  );
  const row = rows[0];
  return res.json({ user: {
    id: row.id, fullName: row.full_name, email: row.email, phone: row.phone ?? '',
    accountStatus: row.account_status, emailVerifiedAt: row.email_verified_at,
    createdAt: row.created_at, roles: row.role_keys ? row.role_keys.split(',') : []
  }, message: 'User account updated.' });
}));

export default router;
