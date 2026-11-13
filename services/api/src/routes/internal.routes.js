import { Router } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { env } from '../config/env.js';
import { pool } from '../config/database.js';
import { runVisionStaleCheck } from '../vision/stale-monitor.js';

/**
 * Scheduled maintenance endpoints for serverless hosting (Vercel Cron), where no background
 * timers can run. Vercel Cron calls these with `Authorization: Bearer <CRON_SECRET>`; any other
 * caller is rejected. When CRON_SECRET is not set the endpoints are disabled.
 */
const router = Router();

function secretMatches(header) {
  const expected = Buffer.from(`Bearer ${env.CRON_SECRET}`);
  const actual = Buffer.from(String(header ?? ''));
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

router.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  if (!env.CRON_SECRET) {
    return res.status(503).json({ error: { code: 'CRON_DISABLED', message: 'Scheduled jobs are not configured on this server.' } });
  }
  if (!secretMatches(req.get('authorization'))) {
    return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'A valid cron secret is required.' } });
  }
  return next();
});

// Same check the persistent server runs every 20 seconds (vision/stale-monitor.js).
router.get('/cron/vision-stale', async (_req, res) => {
  try {
    const markedOffline = await runVisionStaleCheck(pool);
    res.json({ ok: true, markedOffline });
  } catch (error) {
    console.error('Vision stale check failed:', error.message);
    res.status(500).json({ error: { code: 'VISION_STALE_CHECK_FAILED', message: 'The stale-camera check could not complete.' } });
  }
});

export default router;
