import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { pool } from '../config/database.js';
import { env } from '../config/env.js';
import { requireAuth, clearSessionCookie, setSessionCookie, SESSION_COOKIE_NAME } from '../middleware/authenticate.js';
import { createRateLimiter } from '../middleware/rate-limit.js';
import { hashPassword, verifyPassword } from '../security/password.js';
import { createOpaqueToken, hashOpaqueToken, readCookie } from '../security/tokens.js';
import { sendVerificationEmail, sendPasswordResetEmail } from '../services/mailer.js';

const router = Router();

// Express 4 does not automatically forward rejected async handlers to error middleware.
const asyncHandler = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
const VERIFY_TTL_MS = 30 * 60 * 1000;
const SESSION_TTL_MS = env.SESSION_TTL_HOURS * 60 * 60 * 1000;
const RATE_WINDOW_MS = 15 * 60 * 1000;
const registerLimiter = createRateLimiter({ windowMs: RATE_WINDOW_MS, max: 6, keyPrefix: 'auth-register' });
const loginLimiter = createRateLimiter({ windowMs: RATE_WINDOW_MS, max: 12, keyPrefix: 'auth-login' });
const resendLimiter = createRateLimiter({ windowMs: RATE_WINDOW_MS, max: 4, keyPrefix: 'auth-resend' });
const passwordResetLimiter = createRateLimiter({ windowMs: RATE_WINDOW_MS, max: 4, keyPrefix: 'auth-password-reset' });

const registerSchema = z.object({
  fullName: z.string().trim().min(2, 'Enter your full name.').max(120),
  email: z.string().trim().email('Enter a valid email address.').max(254),
  phone: z.string().trim().max(30).optional().or(z.literal('')),
  password: z.string().min(12, 'Use at least 12 characters.').max(128)
});
const loginSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(1).max(128)
});
const emailSchema = z.object({ email: z.string().trim().email().max(254) });
const verifySchema = z.object({ token: z.string().min(30).max(200).regex(/^[A-Za-z0-9_-]+$/) });
const resetPasswordSchema = z.object({ token: z.string().min(30).max(200).regex(/^[A-Za-z0-9_-]+$/), password: z.string().min(12, 'Use at least 12 characters.').max(128) });

// Calculated once so an unknown email still costs approximately one password verification.
const DUMMY_PASSWORD_HASH = await hashPassword('SmartPark timing-only dummy password 2026!');

function normalizedEmail(value) {
  return value.trim().toLowerCase();
}

function publicUser(row, roles) {
  return {
    id: row.id,
    fullName: row.full_name,
    email: row.email,
    phone: row.phone,
    emailVerifiedAt: row.email_verified_at,
    roles
  };
}

async function getRoles(executor, userId) {
  const [rows] = await executor.execute(
    `SELECT r.role_key FROM roles r
     JOIN user_roles ur ON ur.role_id = r.id
     WHERE ur.user_id = ? ORDER BY r.role_key`,
    [userId]
  );
  return rows.map((row) => row.role_key);
}

async function audit(executor, actorId, action, entityId, metadata = {}) {
  await executor.execute(
    'INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, metadata) VALUES (?, ?, ?, ?, ?)',
    [actorId ?? null, action, 'user', entityId ?? null, JSON.stringify(metadata)]
  );
}

async function createVerificationToken(executor, userId) {
  const rawToken = createOpaqueToken(32);
  const tokenHash = hashOpaqueToken(rawToken);
  const expiresAt = new Date(Date.now() + VERIFY_TTL_MS);
  await executor.execute('DELETE FROM email_verification_tokens WHERE user_id = ?', [userId]);
  await executor.execute(
    'INSERT INTO email_verification_tokens (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)',
    [randomUUID(), userId, tokenHash, expiresAt]
  );
  return rawToken;
}

async function trySendVerification(email, token) {
  try {
    await sendVerificationEmail(email, token);
    return true;
  } catch (error) {
    // The token remains valid for resend; never log the raw token in production.
    console.error('SmartPark verification email delivery failed:', error.message);
    return false;
  }
}

router.post('/register', registerLimiter, asyncHandler(async (req, res, next) => {
  if (env.NODE_ENV === 'production' && !env.SMTP_HOST) {
    return res.status(503).json({ error: { code: 'EMAIL_DELIVERY_NOT_CONFIGURED', message: 'Account registration is temporarily unavailable until email verification is configured.' } });
  }
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message ?? 'Check the submitted fields.' }
    });
  }

  const fullName = parsed.data.fullName;
  const email = normalizedEmail(parsed.data.email);
  const phone = parsed.data.phone?.trim() || null;
  const passwordHash = await hashPassword(parsed.data.password);
  const userId = randomUUID();
  const connection = await pool.getConnection();
  let verificationToken;

  try {
    await connection.beginTransaction();
    const [existing] = await connection.execute('SELECT id FROM users WHERE email = ? LIMIT 1', [email]);
    if (existing.length) {
      await connection.rollback();
      return res.status(409).json({
        error: { code: 'ACCOUNT_EXISTS', message: 'An account with this email already exists. Sign in or request a verification email.' }
      });
    }

    const [driverRoles] = await connection.execute('SELECT id FROM roles WHERE role_key = ? LIMIT 1', ['driver']);
    if (!driverRoles.length) throw new Error('Required driver role is missing. Apply the initial database migration.');

    await connection.execute(
      `INSERT INTO users (id, full_name, email, password_hash, phone, account_status)
       VALUES (?, ?, ?, ?, ?, 'pending_verification')`,
      [userId, fullName, email, passwordHash, phone]
    );
    await connection.execute('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)', [userId, driverRoles[0].id]);
    verificationToken = await createVerificationToken(connection, userId);
    await audit(connection, userId, 'auth.registered', userId, { registrationMethod: 'email_password' });
    await connection.commit();
  } catch (error) {
    await connection.rollback().catch(() => {});
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: { code: 'ACCOUNT_EXISTS', message: 'An account with this email already exists. Sign in or request a verification email.' } });
    }
    return next(error);
  } finally {
    connection.release();
  }

  const emailSent = await trySendVerification(email, verificationToken);
  return res.status(201).json({
    message: emailSent
      ? 'Account created. Verify your email before signing in. In local development, the verification URL is printed in the API terminal.'
      : 'Account created, but the verification email could not be sent. Check the email configuration and request a new link.',
    verificationRequired: true,
    emailDeliveryStatus: emailSent ? 'sent_or_logged' : 'failed',
    user: { id: userId, fullName, email }
  });
}));

router.post('/verify-email', asyncHandler(async (req, res, next) => {
  const parsed = verifySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: 'INVALID_VERIFICATION_TOKEN', message: 'The verification link is invalid or has expired.' } });
  }

  const tokenHash = hashOpaqueToken(parsed.data.token);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [tokens] = await connection.execute(
      'SELECT user_id FROM email_verification_tokens WHERE token_hash = ? AND expires_at > UTC_TIMESTAMP() LIMIT 1 FOR UPDATE',
      [tokenHash]
    );
    if (!tokens.length) {
      await connection.rollback();
      return res.status(400).json({ error: { code: 'INVALID_VERIFICATION_TOKEN', message: 'The verification link is invalid or has expired. Request a new one.' } });
    }

    const userId = tokens[0].user_id;
    await connection.execute(
      `UPDATE users SET account_status = 'active', email_verified_at = UTC_TIMESTAMP()
       WHERE id = ? AND account_status = 'pending_verification'`,
      [userId]
    );
    await connection.execute('DELETE FROM email_verification_tokens WHERE user_id = ?', [userId]);
    await audit(connection, userId, 'auth.email_verified', userId, {});
    await connection.commit();
    return res.status(200).json({ message: 'Your email is verified. You can now sign in.' });
  } catch (error) {
    await connection.rollback().catch(() => {});
    return next(error);
  } finally {
    connection.release();
  }
}));

router.post('/resend-verification', resendLimiter, asyncHandler(async (req, res, next) => {
  const parsed = emailSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Enter a valid email address.' } });
  }

  const email = normalizedEmail(parsed.data.email);
  if (env.NODE_ENV === 'production' && !env.SMTP_HOST) {
    return res.status(503).json({ error: { code: 'EMAIL_DELIVERY_NOT_CONFIGURED', message: 'Email delivery is not configured. Contact the site administrator.' } });
  }
  const connection = await pool.getConnection();
  let tokenToSend = null;
  try {
    await connection.beginTransaction();
    const [users] = await connection.execute(
      `SELECT id, email, account_status FROM users WHERE email = ? LIMIT 1 FOR UPDATE`,
      [email]
    );
    if (users.length && users[0].account_status === 'pending_verification') {
      tokenToSend = await createVerificationToken(connection, users[0].id);
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback().catch(() => {});
    return next(error);
  } finally {
    connection.release();
  }
  if (tokenToSend) await trySendVerification(email, tokenToSend);
  // Identical response prevents this endpoint being used to enumerate accounts.
  return res.status(200).json({ message: 'If the account needs verification, a new verification link has been sent. In local development, check the API terminal.' });
}));

router.post('/forgot-password', passwordResetLimiter, asyncHandler(async (req, res, next) => {
  const parsed = emailSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Enter a valid email address.' } });
  }
  if (env.NODE_ENV === 'production' && !env.SMTP_HOST) {
    return res.status(503).json({ error: { code: 'EMAIL_DELIVERY_NOT_CONFIGURED', message: 'Email delivery is not configured. Contact the site administrator.' } });
  }

  const email = normalizedEmail(parsed.data.email);
  const connection = await pool.getConnection();
  let userId = null;
  let rawToken = null;
  try {
    await connection.beginTransaction();
    const [users] = await connection.execute(
      `SELECT id FROM users WHERE email = ? AND account_status = 'active' LIMIT 1 FOR UPDATE`,
      [email]
    );
    if (users.length) {
      userId = users[0].id;
      rawToken = createOpaqueToken(32);
      await connection.execute('DELETE FROM password_reset_tokens WHERE user_id = ?', [userId]);
      await connection.execute(
        'INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)',
        [randomUUID(), userId, hashOpaqueToken(rawToken), new Date(Date.now() + VERIFY_TTL_MS)]
      );
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback().catch(() => {});
    return next(error);
  } finally {
    connection.release();
  }

  if (userId && rawToken) {
    try {
      await sendPasswordResetEmail(email, rawToken);
    } catch (error) {
      console.error('SmartPark password reset email delivery failed:', error.message);
    }
  }
  // Never reveal whether an email belongs to an account.
  return res.status(200).json({ message: 'If an active account matches that email, a password reset link has been sent. In local development, check the API terminal.' });
}));

router.post('/reset-password', passwordResetLimiter, asyncHandler(async (req, res, next) => {
  const parsed = resetPasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message ?? 'Check the submitted fields.' } });
  }

  const tokenHash = hashOpaqueToken(parsed.data.token);
  const passwordHash = await hashPassword(parsed.data.password);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [tokens] = await connection.execute(
      `SELECT pr.user_id FROM password_reset_tokens pr
       JOIN users u ON u.id = pr.user_id
       WHERE pr.token_hash = ? AND pr.expires_at > UTC_TIMESTAMP() AND u.account_status = 'active'
       LIMIT 1 FOR UPDATE`,
      [tokenHash]
    );
    if (!tokens.length) {
      await connection.rollback();
      return res.status(400).json({ error: { code: 'INVALID_RESET_TOKEN', message: 'The password reset link is invalid or has expired. Request a new one.' } });
    }
    const userId = tokens[0].user_id;
    await connection.execute('UPDATE users SET password_hash = ? WHERE id = ? AND account_status = \'active\'', [passwordHash, userId]);
    await connection.execute('DELETE FROM password_reset_tokens WHERE user_id = ?', [userId]);
    // Password resets revoke every existing browser session for that account.
    await connection.execute('DELETE FROM user_sessions WHERE user_id = ?', [userId]);
    await audit(connection, userId, 'auth.password_reset', userId, {});
    await connection.commit();
    return res.status(200).json({ message: 'Password updated. Sign in with your new password.' });
  } catch (error) {
    await connection.rollback().catch(() => {});
    return next(error);
  } finally {
    connection.release();
  }
}));

router.post('/login', loginLimiter, asyncHandler(async (req, res, next) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Enter a valid email address and password.' } });
  }

  const email = normalizedEmail(parsed.data.email);
  const { password } = parsed.data;
  try {
    const [users] = await pool.execute(
      `SELECT id, full_name, email, phone, password_hash, account_status, email_verified_at
       FROM users WHERE email = ? LIMIT 1`,
      [email]
    );
    const user = users[0];
    const passwordIsValid = await verifyPassword(password, user?.password_hash ?? DUMMY_PASSWORD_HASH);
    if (!user || !passwordIsValid) {
      return res.status(401).json({ error: { code: 'INVALID_CREDENTIALS', message: 'Email or password is incorrect.' } });
    }
    if (user.account_status === 'pending_verification') {
      return res.status(403).json({ error: { code: 'EMAIL_NOT_VERIFIED', message: 'Verify your email before signing in.' } });
    }
    if (user.account_status !== 'active') {
      return res.status(403).json({ error: { code: 'ACCOUNT_UNAVAILABLE', message: 'This account is unavailable. Contact support if you believe this is an error.' } });
    }

    const rawToken = createOpaqueToken(32);
    const tokenHash = hashOpaqueToken(rawToken);
    const sessionId = randomUUID();
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
    const ip = typeof req.ip === 'string' ? req.ip.slice(0, 45) : null;
    const agent = String(req.get('user-agent') ?? '').slice(0, 255) || null;
    const roles = await getRoles(pool, user.id);
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      await connection.execute(
        `INSERT INTO user_sessions (id, user_id, token_hash, expires_at, last_seen_at, ip_address, user_agent)
         VALUES (?, ?, ?, ?, UTC_TIMESTAMP(), ?, ?)`,
        [sessionId, user.id, tokenHash, expiresAt, ip, agent]
      );
      await audit(connection, user.id, 'auth.login', user.id, {});
      await connection.commit();
    } catch (error) {
      await connection.rollback().catch(() => {});
      throw error;
    } finally {
      connection.release();
    }
    setSessionCookie(res, rawToken, Math.floor(SESSION_TTL_MS / 1000));
    return res.status(200).json({ user: publicUser(user, roles) });
  } catch (error) {
    return next(error);
  }
}));

router.post('/logout', asyncHandler(async (req, res, next) => {
  try {
    const rawToken = readCookie(req, SESSION_COOKIE_NAME);
    if (rawToken && rawToken.length <= 200) {
      const tokenHash = hashOpaqueToken(rawToken);
      await pool.execute('DELETE FROM user_sessions WHERE token_hash = ?', [tokenHash]);
    }
    clearSessionCookie(res);
    return res.status(200).json({ message: 'You have been signed out.' });
  } catch (error) {
    return next(error);
  }
}));

router.get('/me', requireAuth, (req, res) => {
  return res.status(200).json({ user: req.user });
});

export default router;
