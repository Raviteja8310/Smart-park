import { Router } from 'express';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import multer from 'multer';
import { z } from 'zod';
import { pool } from '../config/database.js';
import { requireAuth, clearSessionCookie } from '../middleware/authenticate.js';
import { createRateLimiter } from '../middleware/rate-limit.js';
import { hashPassword, verifyPassword } from '../security/password.js';

/**
 * Self-service account features for the signed-in user:
 *   GET    /api/account          profile summary, including whether a profile photo exists
 *   GET    /api/account/avatar   the user's own profile photo (private; never public)
 *   PUT    /api/account/avatar   upload or replace the profile photo (JPEG, PNG or WebP, max 2 MB)
 *   DELETE /api/account/avatar   remove the profile photo
 *   POST   /api/account/delete   permanently close the account (password + typed confirmation)
 *
 * Deleting an account closes and anonymizes it rather than erasing rows: bookings, payments,
 * refunds and audit records must stay intact for finance and legal reasons, and 50 tables
 * reference users. Personal details are removed, every session is signed out, and the
 * account can never sign in again.
 */
const router = Router();
const asyncHandler = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
const fail = (res, status, code, message, details) => res.status(status).json({ error: { code, message, ...(details ? { details } : {}) } });

const avatarDir = fileURLToPath(new URL('../../uploads/avatars/', import.meta.url));
await mkdir(avatarDir, { recursive: true });
const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
const EXTENSIONS = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };
const CONTENT_TYPES = { '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };

const avatarLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 20, keyPrefix: 'account-avatar' });
const deleteLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 5, keyPrefix: 'account-delete' });

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, callback) => callback(null, avatarDir),
    filename: (_req, file, callback) => callback(null, `${randomUUID()}${EXTENSIONS[file.mimetype] ?? '.img'}`)
  }),
  limits: { files: 1, fileSize: MAX_AVATAR_BYTES, fields: 0 },
  fileFilter: (_req, file, callback) => callback(EXTENSIONS[file.mimetype] ? null : new Error('Only JPEG, PNG or WebP images are accepted.'), Boolean(EXTENSIONS[file.mimetype]))
});

function receiveAvatar(req, res, next) {
  upload.single('photo')(req, res, (error) => {
    if (!error) return next();
    const tooLarge = error.code === 'LIMIT_FILE_SIZE';
    void removeFile(req.file?.path).finally(() => {
      if (!res.headersSent) fail(res, tooLarge ? 400 : 415, tooLarge ? 'PHOTO_TOO_LARGE' : 'INVALID_PHOTO', tooLarge ? 'The photo must be 2 MB or smaller.' : (error.message || 'Unable to process the photo.'));
    });
  });
}

async function removeFile(filePath) {
  if (filePath) await unlink(filePath).catch(() => {});
}

function storedPath(storageName) {
  // Only the file name is stored; never trust it as a path.
  return path.join(avatarDir, path.basename(String(storageName)));
}

async function hasImageSignature(filePath, mimeType) {
  const buffer = await readFile(filePath);
  if (mimeType === 'image/jpeg') return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (mimeType === 'image/png') return buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (mimeType === 'image/webp') return buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP';
  return false;
}

async function audit(executor, actorId, action, metadata = {}) {
  await executor.execute(
    'INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, metadata) VALUES (?, ?, ?, ?, ?)',
    [actorId, action, 'user', actorId, JSON.stringify(metadata)]
  );
}

function avatarInfo(row) {
  if (!row?.avatar_storage_name) return null;
  // Each upload gets a new random file name, so its stem is a reliable cache-busting version.
  const version = path.basename(String(row.avatar_storage_name)).split('.')[0].slice(0, 12);
  return { url: `/api/account/avatar?v=${version}`, updatedAt: row.avatar_updated_at };
}

router.get('/', requireAuth, asyncHandler(async (req, res) => {
  const [rows] = await pool.execute('SELECT avatar_storage_name, avatar_updated_at FROM users WHERE id = ? LIMIT 1', [req.user.id]);
  return res.json({ user: { ...req.user, avatar: avatarInfo(rows[0]) } });
}));

router.get('/avatar', requireAuth, asyncHandler(async (req, res) => {
  const [rows] = await pool.execute('SELECT avatar_storage_name FROM users WHERE id = ? LIMIT 1', [req.user.id]);
  const name = rows[0]?.avatar_storage_name;
  if (!name) return fail(res, 404, 'NO_PROFILE_PHOTO', 'You have not added a profile photo.');
  const filePath = storedPath(name);
  res.set({ 'Cache-Control': 'private, max-age=86400', 'X-Content-Type-Options': 'nosniff', 'Content-Type': CONTENT_TYPES[path.extname(filePath)] ?? 'application/octet-stream' });
  return res.sendFile(filePath, (error) => { if (error && !res.headersSent) fail(res, 404, 'NO_PROFILE_PHOTO', 'The profile photo file was not found.'); });
}));

router.put('/avatar', avatarLimiter, requireAuth, receiveAvatar, asyncHandler(async (req, res) => {
  const file = req.file;
  if (!file) return fail(res, 400, 'NO_PHOTO', 'Choose a photo to upload.');
  if (!(await hasImageSignature(file.path, file.mimetype))) {
    await removeFile(file.path);
    return fail(res, 415, 'INVALID_IMAGE_CONTENT', 'The file is not a valid JPEG, PNG or WebP image.');
  }
  let previous = null;
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute("SELECT avatar_storage_name FROM users WHERE id = ? AND account_status = 'active' LIMIT 1 FOR UPDATE", [req.user.id]);
    if (!rows.length) { await connection.rollback(); await removeFile(file.path); return fail(res, 404, 'USER_NOT_FOUND', 'Your account was not found.'); }
    previous = rows[0].avatar_storage_name;
    await connection.execute('UPDATE users SET avatar_storage_name = ?, avatar_updated_at = UTC_TIMESTAMP() WHERE id = ?', [file.filename, req.user.id]);
    await audit(connection, req.user.id, 'user.avatar.updated', { replaced: Boolean(previous) });
    await connection.commit();
  } catch (error) {
    await connection.rollback().catch(() => {});
    await removeFile(file.path);
    throw error;
  } finally {
    connection.release();
  }
  if (previous) await removeFile(storedPath(previous));
  const [rows] = await pool.execute('SELECT avatar_storage_name, avatar_updated_at FROM users WHERE id = ? LIMIT 1', [req.user.id]);
  return res.json({ avatar: avatarInfo(rows[0]), message: 'Profile photo updated.' });
}));

router.delete('/avatar', avatarLimiter, requireAuth, asyncHandler(async (req, res) => {
  const [rows] = await pool.execute('SELECT avatar_storage_name FROM users WHERE id = ? LIMIT 1', [req.user.id]);
  const name = rows[0]?.avatar_storage_name;
  if (!name) return res.json({ avatar: null, message: 'No profile photo to remove.' });
  await pool.execute('UPDATE users SET avatar_storage_name = NULL, avatar_updated_at = NULL WHERE id = ?', [req.user.id]);
  await audit(pool, req.user.id, 'user.avatar.removed');
  await removeFile(storedPath(name));
  return res.json({ avatar: null, message: 'Profile photo removed.' });
}));

const deleteSchema = z.object({
  password: z.string().min(1, 'Enter your current password.').max(200),
  confirmation: z.string().trim()
}).strict();

/** Things that must be finished before an account can be closed, each with a user-facing reason. */
async function findBlockers(executor, userId, roles) {
  const checks = [
    ['ACTIVE_BOOKINGS', 'You have a current or upcoming booking. Cancel it or wait until it has ended.',
      `SELECT COUNT(*) AS n FROM bookings WHERE user_id = ? AND end_at > UTC_TIMESTAMP() AND status IN ('held','pending_payment','confirmed','checked_in')`],
    ['PARKED_NOW', 'A vehicle is still checked in on one of your bookings. Exit the facility first.',
      `SELECT COUNT(*) AS n FROM bookings WHERE user_id = ? AND status = 'checked_in'`],
    ['ACTIVE_CHARGING', 'You have a charging session in progress. End it first.',
      `SELECT COUNT(*) AS n FROM ev_charging_sessions WHERE user_id = ? AND status = 'active'`],
    ['OPEN_REFUNDS', 'A refund request is still being processed. Wait until it is resolved.',
      `SELECT COUNT(*) AS n FROM refund_requests WHERE requested_by_user_id = ? AND status IN ('requested','approved','processing','manual_review')`],
    ['OPEN_PAYOUTS', 'A payout request is still open. Wait until it has been paid or closed.',
      `SELECT COUNT(*) AS n FROM host_payout_requests WHERE owner_user_id = ? AND status IN ('requested','approved','manual_review')`],
    ['OWNS_FACILITIES', 'You still own parking facilities that are not archived. Archive them under Parking spaces first.',
      `SELECT COUNT(*) AS n FROM parking_lots WHERE owner_user_id = ? AND facility_status <> 'archived'`]
  ];
  const blockers = [];
  for (const [code, message, sql] of checks) {
    const [rows] = await executor.execute(sql, [userId]);
    if (Number(rows[0].n) > 0) blockers.push({ code, message });
  }
  if (roles.includes('admin')) {
    const [rows] = await executor.execute(
      `SELECT COUNT(DISTINCT u.id) AS n FROM users u JOIN user_roles ur ON ur.user_id = u.id JOIN roles r ON r.id = ur.role_id
        WHERE r.role_key = 'admin' AND u.account_status = 'active' AND u.id <> ?`, [userId]
    );
    if (Number(rows[0].n) === 0) blockers.push({ code: 'LAST_ADMIN', message: 'You are the only administrator. Give another account the administrator role first.' });
  }
  return blockers;
}

router.get('/delete-check', requireAuth, asyncHandler(async (req, res) => {
  const blockers = await findBlockers(pool, req.user.id, req.user.roles ?? []);
  return res.json({ canDelete: blockers.length === 0, blockers });
}));

router.post('/delete', deleteLimiter, requireAuth, asyncHandler(async (req, res) => {
  const parsed = deleteSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 400, 'VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Check the submitted fields.');
  if (parsed.data.confirmation !== 'DELETE') return fail(res, 400, 'CONFIRMATION_REQUIRED', 'Type DELETE to confirm that you want to delete your account.');

  const [users] = await pool.execute("SELECT password_hash, avatar_storage_name FROM users WHERE id = ? AND account_status = 'active' LIMIT 1", [req.user.id]);
  if (!users.length || !(await verifyPassword(parsed.data.password, users[0].password_hash))) {
    return fail(res, 400, 'CURRENT_PASSWORD_INVALID', 'Your current password is incorrect.');
  }

  // An unusable random password: nobody (including the former owner) can sign in again.
  const lockedHash = await hashPassword(randomBytes(48).toString('base64url'));
  const shortId = req.user.id.replaceAll('-', '').slice(0, 12);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.execute("SELECT id FROM users WHERE id = ? AND account_status = 'active' FOR UPDATE", [req.user.id]);
    const blockers = await findBlockers(connection, req.user.id, req.user.roles ?? []);
    if (blockers.length) {
      await connection.rollback();
      return fail(res, 409, 'ACCOUNT_DELETION_BLOCKED', blockers[0].message, { blockers });
    }
    await connection.execute(
      `UPDATE users SET full_name = 'Deleted user', email = ?, phone = NULL, password_hash = ?, account_status = 'deleted',
              avatar_storage_name = NULL, avatar_updated_at = NULL, email_verified_at = NULL WHERE id = ?`,
      [`deleted-${shortId}@deleted.smartpark.invalid`, lockedHash, req.user.id]
    );
    // Vehicles stay linked to past bookings, but the registration plate is personal data.
    await connection.execute(
      "UPDATE vehicles SET registration_number = CONCAT('DEL-', UPPER(SUBSTRING(REPLACE(id, '-', ''), 1, 16))) WHERE owner_user_id = ?",
      [req.user.id]
    );
    await connection.execute('DELETE FROM parking_favorites WHERE user_id = ?', [req.user.id]);
    await connection.execute('DELETE FROM parking_search_history WHERE user_id = ?', [req.user.id]);
    await connection.execute('DELETE FROM user_notification_preferences WHERE user_id = ?', [req.user.id]);
    await connection.execute("UPDATE corporate_members SET status = 'inactive' WHERE user_id = ?", [req.user.id]);
    await connection.execute('DELETE FROM password_reset_tokens WHERE user_id = ?', [req.user.id]);
    await connection.execute('DELETE FROM email_verification_tokens WHERE user_id = ?', [req.user.id]);
    await connection.execute('DELETE FROM user_sessions WHERE user_id = ?', [req.user.id]);
    await audit(connection, req.user.id, 'user.account.deleted', { selfService: true });
    await connection.commit();
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally {
    connection.release();
  }
  if (users[0].avatar_storage_name) await removeFile(storedPath(users[0].avatar_storage_name));
  clearSessionCookie(res);
  return res.json({ message: 'Your SmartPark account has been deleted. Your past bookings and payments are kept only in anonymized form for financial records.' });
}));

export default router;
