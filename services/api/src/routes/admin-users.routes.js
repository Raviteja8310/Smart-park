import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../config/database.js';
import { requireAuth, requireRole } from '../middleware/authenticate.js';

const router = Router();
const asyncHandler = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
const fail = (res, status, code, message) => res.status(status).json({ error: { code, message } });
const searchSchema = z.object({ q: z.string().trim().max(120).optional().default(''), status: z.enum(['all','active','pending_verification','suspended','deleted']).optional().default('all'), limit: z.coerce.number().int().min(1).max(100).default(25), offset: z.coerce.number().int().min(0).max(1000000).default(0) });
const updateSchema = z.object({ fullName: z.string().trim().min(2).max(120).optional(), phone: z.string().trim().max(30).nullable().optional(), accountStatus: z.enum(['active','suspended','pending_verification','deleted']).optional() }).strict().refine((value) => Object.keys(value).length > 0, 'Provide at least one field to update.');
const selfSchema = z.object({ fullName: z.string().trim().min(2).max(120).optional(), phone: z.string().trim().max(30).nullable().optional() }).strict().refine((value) => Object.keys(value).length > 0, 'Provide a name or phone number to update.');
async function audit(executor, actorId, action, entityId, metadata = {}) {
  await executor.execute('INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, metadata) VALUES (?, ?, ?, ?, ?)', [actorId, action, 'user', entityId, JSON.stringify(metadata)]);
}
function publicUser(row) { return { id: row.id, fullName: row.full_name, email: row.email, phone: row.phone ?? '', accountStatus: row.account_status, emailVerifiedAt: row.email_verified_at, createdAt: row.created_at, roles: row.role_keys ? row.role_keys.split(',') : [] }; }
const userSelect = `SELECT u.id,u.full_name,u.email,u.phone,u.account_status,u.email_verified_at,u.created_at,COALESCE(GROUP_CONCAT(DISTINCT r.role_key ORDER BY r.role_key SEPARATOR ','),'') role_keys FROM users u LEFT JOIN user_roles ur ON ur.user_id=u.id LEFT JOIN roles r ON r.id=ur.role_id`;

// Self-service profile update: never permits email, roles, account status or password changes.
router.patch('/me', requireAuth, asyncHandler(async (req, res) => {
  const parsed = selfSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 400, 'VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Check the submitted fields.');
  const input = parsed.data;
  const fields = []; const values = [];
  if (input.fullName !== undefined) { fields.push('full_name = ?'); values.push(input.fullName); }
  if (input.phone !== undefined) { fields.push('phone = ?'); values.push(input.phone || null); }
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.execute(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`, [...values, req.user.id]);
    await audit(connection, req.user.id, 'user.profile_updated', req.user.id, { fields: Object.keys(input) });
    await connection.commit();
  } catch (error) { await connection.rollback().catch(() => {}); throw error; }
  finally { connection.release(); }
  const [rows] = await pool.execute(`${userSelect} WHERE u.id=? GROUP BY u.id LIMIT 1`, [req.user.id]);
  return res.json({ user: publicUser(rows[0]), message: 'Profile updated.' });
}));

// Self-service facility-owner enablement. This grants host capabilities without removing
// the driver's role. Newly created listings remain private drafts until the normal review flow approves them.
router.post('/me/facility-owner', requireAuth, asyncHandler(async (req, res) => {
  if (req.user.roles.includes('admin')) {
    return res.status(200).json({ user: req.user, message: 'Administrator accounts already have facility-management access.' });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [users] = await connection.execute('SELECT id, account_status FROM users WHERE id=? FOR UPDATE', [req.user.id]);
    if (!users.length || users[0].account_status !== 'active') {
      await connection.rollback();
      return fail(res, 403, 'ACCOUNT_NOT_ACTIVE', 'An active account is required to enable facility-owner mode.');
    }

    // Keep the core roles present even on installations that were manually bootstrapped.
    await connection.execute(
      "INSERT INTO roles (role_key, display_name) VALUES ('driver','Driver'),('host','Facility Owner') ON DUPLICATE KEY UPDATE role_key=VALUES(role_key)"
    );
    await connection.execute(
      "INSERT IGNORE INTO user_roles (user_id, role_id) SELECT ?, id FROM roles WHERE role_key IN ('driver','host')",
      [req.user.id]
    );
    await audit(connection, req.user.id, 'user.facility_owner_enabled', req.user.id, { preservedDriverRole: true });
    await connection.commit();
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally {
    connection.release();
  }

  const [rows] = await pool.execute(`${userSelect} WHERE u.id=? GROUP BY u.id LIMIT 1`, [req.user.id]);
  return res.status(200).json({
    user: publicUser(rows[0]),
    message: 'Facility-owner mode is enabled. Your listings must pass the normal administrator approval process before public booking.'
  });
}));

router.get('/', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const parsed = searchSchema.safeParse(req.query);
  if (!parsed.success) return fail(res, 400, 'VALIDATION_ERROR', 'Check the search filters.');
  const { q, status, limit, offset } = parsed.data;
  const like = `%${q.replace(/[\\%_]/g, '\\$&')}%`;
  const filters = [`(? = '' OR u.full_name LIKE ? OR u.email LIKE ? OR COALESCE(u.phone,'') LIKE ?)`];
  const params = [q, like, like, like];
  if (status !== 'all') { filters.push('u.account_status = ?'); params.push(status); }
  const where = filters.join(' AND ');
  const [count] = await pool.execute(`SELECT COUNT(*) total FROM users u WHERE ${where}`, params);
  const [rows] = await pool.execute(`${userSelect} WHERE ${where} GROUP BY u.id,u.full_name,u.email,u.phone,u.account_status,u.email_verified_at,u.created_at ORDER BY u.created_at DESC LIMIT ? OFFSET ?`, [...params, limit, offset]);
  return res.json({ users: rows.map(publicUser), pagination: { total: Number(count[0].total), limit, offset } });
}));

router.patch('/:userId/roles', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const id = z.string().uuid().safeParse(req.params.userId);
  if (!id.success) return fail(res, 400, 'INVALID_ID', 'The user identifier is invalid.');
  const parsed = z.object({ roles: z.array(z.enum(['driver','host','operator','attendant','admin'])).min(1).max(5) }).strict().safeParse(req.body);
  if (!parsed.success) return fail(res, 400, 'VALIDATION_ERROR', 'Select one or more valid roles.');
  const roles = [...new Set(parsed.data.roles)];
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [users] = await connection.execute('SELECT id, account_status FROM users WHERE id=? FOR UPDATE', [id.data]);
    if (!users.length) { await connection.rollback(); return fail(res, 404, 'USER_NOT_FOUND', 'User not found.'); }
    const [oldRoles] = await connection.execute(`SELECT r.role_key FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE ur.user_id=?`, [id.data]);
    const hadAdmin = oldRoles.some(row => row.role_key === 'admin');
    const hasAdmin = roles.includes('admin');
    if (id.data === req.user.id && !hasAdmin) { await connection.rollback(); return fail(res, 409, 'CANNOT_REMOVE_OWN_ADMIN', 'You cannot remove your own administrator role.'); }
    if (hadAdmin && !hasAdmin && users[0].account_status === 'active') {
      const [count] = await connection.execute(`SELECT COUNT(*) total FROM users u JOIN user_roles ur ON ur.user_id=u.id JOIN roles r ON r.id=ur.role_id WHERE r.role_key='admin' AND u.account_status='active'`);
      if (Number(count[0].total) <= 1) { await connection.rollback(); return fail(res, 409, 'LAST_ADMIN', 'Assign another active administrator before removing this role.'); }
    }
    await connection.execute('DELETE FROM user_roles WHERE user_id=?', [id.data]);
    for (const role of roles) await connection.execute('INSERT INTO user_roles (user_id, role_id) SELECT ?, id FROM roles WHERE role_key=?', [id.data, role]);
    await audit(connection, req.user.id, 'admin.user_roles_changed', id.data, { from: oldRoles.map(row=>row.role_key), to: roles });
    await connection.commit();
  } catch (error) { await connection.rollback().catch(() => {}); throw error; }
  finally { connection.release(); }
  const [rows] = await pool.execute(`${userSelect} WHERE u.id=? GROUP BY u.id,u.full_name,u.email,u.phone,u.account_status,u.email_verified_at,u.created_at LIMIT 1`, [id.data]);
  return res.json({ user: publicUser(rows[0]), message: 'User roles updated.' });
}));

router.patch('/:userId', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const id = z.string().uuid().safeParse(req.params.userId);
  if (!id.success) return fail(res, 400, 'INVALID_ID', 'The user identifier is invalid.');
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 400, 'VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Check the submitted fields.');
  const input = parsed.data;
  if (id.data === req.user.id && input.accountStatus && input.accountStatus !== 'active') return fail(res, 409, 'CANNOT_DISABLE_SELF', 'You cannot disable your own administrator account.');
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [found] = await connection.execute('SELECT id, account_status FROM users WHERE id=? FOR UPDATE', [id.data]);
    if (!found.length) { await connection.rollback(); return fail(res, 404, 'USER_NOT_FOUND', 'User not found.'); }
    if (input.accountStatus && found[0].account_status !== input.accountStatus && found[0].account_status !== 'deleted') {
      const [admins] = await connection.execute(`SELECT COUNT(*) total FROM users u JOIN user_roles ur ON ur.user_id=u.id JOIN roles r ON r.id=ur.role_id WHERE r.role_key='admin' AND u.account_status='active'`);
      const [targetAdmin] = await connection.execute(`SELECT 1 FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE ur.user_id=? AND r.role_key='admin' LIMIT 1`, [id.data]);
      if (targetAdmin.length && input.accountStatus !== 'active' && Number(admins[0].total) <= 1) { await connection.rollback(); return fail(res, 409, 'LAST_ADMIN', 'The last active administrator cannot be disabled. Assign another administrator first.'); }
    }
    const assignments=[]; const values=[];
    if (input.fullName !== undefined) { assignments.push('full_name=?'); values.push(input.fullName); }
    if (input.phone !== undefined) { assignments.push('phone=?'); values.push(input.phone || null); }
    if (input.accountStatus !== undefined) { assignments.push('account_status=?'); values.push(input.accountStatus); }
    await connection.execute(`UPDATE users SET ${assignments.join(', ')} WHERE id=?`, [...values, id.data]);
    if (input.accountStatus && input.accountStatus !== 'active') await connection.execute('DELETE FROM user_sessions WHERE user_id=?', [id.data]);
    await audit(connection, req.user.id, 'admin.user_updated', id.data, { fields: Object.keys(input) });
    await connection.commit();
  } catch (error) { await connection.rollback().catch(() => {}); throw error; }
  finally { connection.release(); }
  const [rows] = await pool.execute(`${userSelect} WHERE u.id=? GROUP BY u.id,u.full_name,u.email,u.phone,u.account_status,u.email_verified_at,u.created_at LIMIT 1`, [id.data]);
  return res.json({ user: publicUser(rows[0]), message: 'User updated.' });
}));

export default router;
