import { pool } from '../config/database.js';
import { env } from '../config/env.js';
import { readCookie, hashOpaqueToken } from '../security/tokens.js';

export const SESSION_COOKIE_NAME = 'sp_session';

export function setSessionCookie(res, rawToken, maxAgeSeconds) {
  const secure = env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${SESSION_COOKIE_NAME}=${rawToken}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSeconds}${secure}`);
}

export function clearSessionCookie(res) {
  const secure = env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT${secure}`);
}

export async function requireAuth(req, res, next) {
  try {
    const rawToken = readCookie(req, SESSION_COOKIE_NAME);
    if (!rawToken || rawToken.length > 200) {
      return res.status(401).json({ error: { code: 'AUTH_REQUIRED', message: 'Sign in to continue.' } });
    }

    const tokenHash = hashOpaqueToken(rawToken);
    const [sessions] = await pool.execute(
      `SELECT s.id AS session_id, s.user_id, s.last_seen_at,
              u.full_name, u.email, u.phone, u.account_status, u.email_verified_at
         FROM user_sessions s
         JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = ? AND s.expires_at > UTC_TIMESTAMP()
        LIMIT 1`,
      [tokenHash]
    );
    if (!sessions.length || sessions[0].account_status !== 'active') {
      clearSessionCookie(res);
      return res.status(401).json({ error: { code: 'SESSION_INVALID', message: 'Your session has expired. Please sign in again.' } });
    }

    const session = sessions[0];
    const [roleRows] = await pool.execute(
      `SELECT r.role_key FROM roles r
       JOIN user_roles ur ON ur.role_id = r.id
       WHERE ur.user_id = ? ORDER BY r.role_key`,
      [session.user_id]
    );
    req.user = {
      id: session.user_id,
      fullName: session.full_name,
      email: session.email,
      phone: session.phone,
      emailVerifiedAt: session.email_verified_at,
      roles: roleRows.map((row) => row.role_key)
    };
    req.authSessionId = session.session_id;

    const lastSeen = session.last_seen_at ? new Date(session.last_seen_at).getTime() : 0;
    if (Date.now() - lastSeen > 5 * 60 * 1000) {
      await pool.execute('UPDATE user_sessions SET last_seen_at = UTC_TIMESTAMP() WHERE id = ?', [req.authSessionId]);
    }
    return next();
  } catch (error) {
    return next(error);
  }
}

export function requireRole(...allowedRoles) {
  return function roleGuard(req, res, next) {
    if (!req.user) {
      return res.status(401).json({ error: { code: 'AUTH_REQUIRED', message: 'Sign in to continue.' } });
    }
    if (!req.user.roles.some((role) => allowedRoles.includes(role))) {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'You do not have permission to perform this action.' } });
    }
    return next();
  };
}
