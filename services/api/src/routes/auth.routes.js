import { Router } from 'express';
import { randomBytes, randomUUID, randomInt } from 'node:crypto';
import { z } from 'zod';
import { pool } from '../config/database.js';
import { env } from '../config/env.js';
import { requireAuth, clearSessionCookie, setSessionCookie, SESSION_COOKIE_NAME } from '../middleware/authenticate.js';
import { createRateLimiter } from '../middleware/rate-limit.js';
import { hashPassword, verifyPassword } from '../security/password.js';
import { createOpaqueToken, hashOpaqueToken, readCookie } from '../security/tokens.js';
import { sendVerificationEmail, sendPasswordResetOtpEmail } from '../services/mailer.js';

const router = Router();

// Express 4 does not automatically forward rejected async handlers to error middleware.
const asyncHandler = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
const VERIFY_TTL_MS = 30 * 60 * 1000;
const PASSWORD_RESET_OTP_TTL_MS = 10 * 60 * 1000;
const MAX_PASSWORD_RESET_OTP_ATTEMPTS = 5;
const SESSION_TTL_MS = env.SESSION_TTL_HOURS * 60 * 60 * 1000;
const RATE_WINDOW_MS = 15 * 60 * 1000;
const registerLimiter = createRateLimiter({ windowMs: RATE_WINDOW_MS, max: 6, keyPrefix: 'auth-register' });
const loginLimiter = createRateLimiter({ windowMs: RATE_WINDOW_MS, max: 12, keyPrefix: 'auth-login' });
const resendLimiter = createRateLimiter({ windowMs: RATE_WINDOW_MS, max: 4, keyPrefix: 'auth-resend' });
const passwordResetLimiter = createRateLimiter({ windowMs: RATE_WINDOW_MS, max: 4, keyPrefix: 'auth-password-reset-request' });
const passwordResetVerifyLimiter = createRateLimiter({ windowMs: RATE_WINDOW_MS, max: 10, keyPrefix: 'auth-password-reset-verify' });
const changePasswordLimiter = createRateLimiter({ windowMs: RATE_WINDOW_MS, max: 5, keyPrefix: 'auth-change-password' });

const registerSchema = z.object({
  fullName: z.string().trim().min(2, 'Enter your full name.').max(120),
  email: z.string().trim().email('Enter a valid email address.').max(254),
  phone: z.string().trim().max(30).optional().or(z.literal('')),
  referralCode: z.string().trim().max(16).optional().or(z.literal('')),
  password: z.string().min(6, 'Use at least 6 characters.').max(128)
});
const loginSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(1).max(128)
});
const emailSchema = z.object({ email: z.string().trim().email().max(254) });
const verifySchema = z.object({ token: z.string().min(30).max(200).regex(/^[A-Za-z0-9_-]+$/) });
const resetPasswordSchema = z.object({ token: z.string().min(6).max(200).regex(/^(?:[0-9]{6}|[A-Za-z0-9_-]{30,200})$/, 'Enter the six-digit email code.'), email: z.string().trim().email().max(254).optional(), password: z.string().min(6, 'Use at least 6 characters.').max(128) }).refine((value) => !/^[0-9]{6}$/.test(value.token) || Boolean(value.email), { message: 'Enter the email address used to request the code.', path: ['email'] });
const changePasswordSchema = z.object({ currentPassword: z.string().min(1).max(128), newPassword: z.string().min(6, 'Use at least 6 characters.').max(128) }).strict();

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
  const referralCodeInput = parsed.data.referralCode?.trim().toUpperCase() || null;
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

    let referrerUserId = null;
    if (referralCodeInput) {
      const [referrerRows] = await connection.execute('SELECT user_id FROM referral_codes WHERE code = ? LIMIT 1 FOR UPDATE', [referralCodeInput]);
      if (!referrerRows.length) {
        await connection.rollback();
        return res.status(422).json({ error: { code: 'INVALID_REFERRAL_CODE', message: 'This referral code is not valid. Check it and try again, or leave the field blank.' } });
      }
      referrerUserId = referrerRows[0].user_id;
      if (referrerUserId === userId) {
        await connection.rollback();
        return res.status(422).json({ error: { code: 'SELF_REFERRAL_NOT_ALLOWED', message: 'You cannot refer your own account.' } });
      }
    }

    const [driverRoles] = await connection.execute('SELECT id FROM roles WHERE role_key = ? LIMIT 1', ['driver']);
    if (!driverRoles.length) throw new Error('Required driver role is missing. Apply the initial database migration.');

    await connection.execute(
      `INSERT INTO users (id, full_name, email, password_hash, phone, account_status)
       VALUES (?, ?, ?, ?, ?, 'pending_verification')`,
      [userId, fullName, email, passwordHash, phone]
    );
    await connection.execute('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)', [userId, driverRoles[0].id]);
    const ownReferralCode = `SP${randomBytes(5).toString('hex').toUpperCase()}`;
    await connection.execute('INSERT INTO referral_codes (user_id, code) VALUES (?, ?)', [userId, ownReferralCode]);
    if (referrerUserId) {
      await connection.execute('INSERT INTO referrals (id, referrer_user_id, referred_user_id, referral_code) VALUES (?, ?, ?, ?)', [randomUUID(), referrerUserId, userId, referralCodeInput]);
      await audit(connection, userId, 'referral.signup_attributed', userId, { referralCode: referralCodeInput });
    }
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
  let otp = null;
  try {
    await connection.beginTransaction();
    const [users] = await connection.execute(
      `SELECT id FROM users WHERE email = ? AND account_status = 'active' LIMIT 1 FOR UPDATE`,
      [email]
    );
    if (users.length) {
      userId = users[0].id;
      // Six-digit OTPs are short-lived and stored only as a user-bound hash.
      otp = String(randomInt(0, 1_000_000)).padStart(6, '0');
      await connection.execute('DELETE FROM password_reset_tokens WHERE user_id = ?', [userId]);
      await connection.execute(
        'INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at, attempt_count) VALUES (?, ?, ?, ?, 0)',
        [randomUUID(), userId, hashOpaqueToken(`${userId}:${otp}`), new Date(Date.now() + PASSWORD_RESET_OTP_TTL_MS)]
      );
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback().catch(() => {});
    return next(error);
  } finally {
    connection.release();
  }

  if (userId && otp) {
    try {
      await sendPasswordResetOtpEmail(email, otp);
    } catch (error) {
      console.error('SmartPark password reset email delivery failed:', error.message);
      // Remove a code that could not be delivered; the response remains non-enumerating.
      await pool.execute('DELETE FROM password_reset_tokens WHERE user_id = ?', [userId]).catch(() => {});
    }
  }
  // Never reveal whether an email belongs to an account.
  return res.status(200).json({ message: 'If an active account matches that email, a six-digit password reset code has been sent. The code expires in 10 minutes. In local development, check the API terminal.' });
}));

router.post('/reset-password', passwordResetVerifyLimiter, asyncHandler(async (req, res, next) => {
  const parsed = resetPasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message ?? 'Check the submitted fields.' } });
  }

  const suppliedToken = parsed.data.token;
  const isOtp = /^[0-9]{6}$/.test(suppliedToken);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    let userId = null;

    if (isOtp) {
      const email = normalizedEmail(parsed.data.email);
      const [users] = await connection.execute(
        `SELECT id FROM users WHERE email = ? AND account_status = 'active' LIMIT 1 FOR UPDATE`,
        [email]
      );
      if (!users.length) {
        await connection.rollback();
        return res.status(400).json({ error: { code: 'INVALID_RESET_CODE', message: 'The code is invalid, expired, or no longer available. Request a new code.' } });
      }
      userId = users[0].id;
      const [resetRows] = await connection.execute(
        `SELECT id, token_hash, (expires_at > UTC_TIMESTAMP()) AS is_unexpired, attempt_count
           FROM password_reset_tokens WHERE user_id = ? LIMIT 1 FOR UPDATE`,
        [userId]
      );
      const reset = resetRows[0];
      if (!reset || !Number(reset.is_unexpired) || Number(reset.attempt_count) >= MAX_PASSWORD_RESET_OTP_ATTEMPTS) {
        await connection.execute('DELETE FROM password_reset_tokens WHERE user_id = ?', [userId]);
        await connection.commit();
        return res.status(400).json({ error: { code: 'INVALID_RESET_CODE', message: 'The code is invalid, expired, or no longer available. Request a new code.' } });
      }
      if (reset.token_hash !== hashOpaqueToken(`${userId}:${suppliedToken}`)) {
        const nextAttempts = Number(reset.attempt_count || 0) + 1;
        if (nextAttempts >= MAX_PASSWORD_RESET_OTP_ATTEMPTS) {
          await connection.execute('DELETE FROM password_reset_tokens WHERE user_id = ?', [userId]);
        } else {
          await connection.execute('UPDATE password_reset_tokens SET attempt_count = ? WHERE id = ?', [nextAttempts, reset.id]);
        }
        await connection.commit();
        return res.status(400).json({ error: { code: nextAttempts >= MAX_PASSWORD_RESET_OTP_ATTEMPTS ? 'RESET_CODE_LOCKED' : 'INVALID_RESET_CODE', message: nextAttempts >= MAX_PASSWORD_RESET_OTP_ATTEMPTS ? 'Too many incorrect codes. Request a new code.' : 'That code is incorrect. Check the email and try again.' } });
      }
    } else {
      // Compatibility for previously-issued high-entropy reset links during rollout.
      const tokenHash = hashOpaqueToken(suppliedToken);
      const [tokens] = await connection.execute(
        `SELECT pr.user_id FROM password_reset_tokens pr
         JOIN users u ON u.id = pr.user_id
         WHERE pr.token_hash = ? AND pr.expires_at > UTC_TIMESTAMP() AND u.account_status = 'active'
         LIMIT 1 FOR UPDATE`,
        [tokenHash]
      );
      if (!tokens.length) {
        await connection.rollback();
        return res.status(400).json({ error: { code: 'INVALID_RESET_TOKEN', message: 'The password reset link is invalid or has expired. Request a new code.' } });
      }
      userId = tokens[0].user_id;
    }

    const passwordHash = await hashPassword(parsed.data.password);
    await connection.execute('UPDATE users SET password_hash = ? WHERE id = ? AND account_status = \'active\'', [passwordHash, userId]);
    await connection.execute('DELETE FROM password_reset_tokens WHERE user_id = ?', [userId]);
    // Password recovery revokes every browser session for the account.
    await connection.execute('DELETE FROM user_sessions WHERE user_id = ?', [userId]);
    await audit(connection, userId, 'auth.password_reset', userId, { method: isOtp ? 'email_otp' : 'legacy_reset_link' });
    await connection.commit();
    return res.status(200).json({ message: 'Password updated. Sign in with your new password.' });
  } catch (error) {
    await connection.rollback().catch(() => {});
    return next(error);
  } finally {
    connection.release();
  }
}));

router.post('/change-password', changePasswordLimiter, requireAuth, asyncHandler(async (req, res, next) => {
  const parsed = changePasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message ?? 'Check the submitted fields.' } });
  }
  if (parsed.data.currentPassword === parsed.data.newPassword) {
    return res.status(400).json({ error: { code: 'PASSWORD_UNCHANGED', message: 'Choose a password different from your current password.' } });
  }

  const [users] = await pool.execute('SELECT password_hash FROM users WHERE id = ? AND account_status = \'active\' LIMIT 1', [req.user.id]);
  if (!users.length || !(await verifyPassword(parsed.data.currentPassword, users[0].password_hash))) {
    return res.status(400).json({ error: { code: 'CURRENT_PASSWORD_INVALID', message: 'Your current password is incorrect.' } });
  }

  const nextHash = await hashPassword(parsed.data.newPassword);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.execute('UPDATE users SET password_hash = ? WHERE id = ? AND account_status = \'active\'', [nextHash, req.user.id]);
    // Keep this session active while revoking the other devices/sessions on the account.
    await connection.execute('DELETE FROM user_sessions WHERE user_id = ? AND id <> ?', [req.user.id, req.authSessionId]);
    await audit(connection, req.user.id, 'auth.password_changed', req.user.id, { otherSessionsRevoked: true });
    await connection.commit();
    return res.status(200).json({ message: 'Password changed successfully. Other signed-in sessions have been signed out.' });
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
