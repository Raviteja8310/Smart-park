import { createHash, randomBytes } from 'node:crypto';

export function createOpaqueToken(bytes = 32) {
  return randomBytes(bytes).toString('base64url');
}

export function hashOpaqueToken(token) {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function readCookie(req, cookieName) {
  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    const name = part.slice(0, separator).trim();
    if (name === cookieName) return part.slice(separator + 1).trim();
  }
  return null;
}
