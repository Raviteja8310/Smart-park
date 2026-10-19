/** A small in-process rate limiter for a single-instance development deployment.
 * Use a shared store (for example Redis) if the production API is horizontally scaled.
 */
export function createRateLimiter({ windowMs = 15 * 60 * 1000, max = 10, keyPrefix = 'default' } = {}) {
  const buckets = new Map();
  const cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [key, value] of buckets) {
      if (value.resetAt <= now) buckets.delete(key);
    }
  }, Math.min(windowMs, 60_000));
  cleanupTimer.unref?.();

  return function rateLimiter(req, res, next) {
    const key = `${keyPrefix}:${req.ip || req.socket.remoteAddress || 'unknown'}`;
    const now = Date.now();
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    res.setHeader('RateLimit-Limit', String(max));
    res.setHeader('RateLimit-Remaining', String(Math.max(0, max - bucket.count)));
    res.setHeader('RateLimit-Reset', String(Math.ceil(bucket.resetAt / 1000)));
    if (bucket.count > max) {
      res.setHeader('Retry-After', String(Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))));
      return res.status(429).json({
        error: { code: 'RATE_LIMITED', message: 'Too many attempts. Please wait and try again.' }
      });
    }
    return next();
  };
}
