import { env } from '../config/env.js';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * SameSite cookies and this Origin check are the CSRF protections for browser
 * requests. Non-browser clients without an Origin header are not blocked.
 */
export function originGuard(req, res, next) {
  if (!MUTATING_METHODS.has(req.method)) return next();
  const origin = req.get('origin');
  if (origin && origin !== env.WEB_ORIGIN) {
    return res.status(403).json({
      error: { code: 'ORIGIN_NOT_ALLOWED', message: 'This request origin is not allowed.' }
    });
  }
  return next();
}
