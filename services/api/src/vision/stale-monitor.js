/**
 * One pass of the stale-camera check: marks cameras offline when the vision worker stopped sending
 * heartbeats, then makes their regions unknown. Returns how many cameras were marked offline.
 * Used by the long-running monitor below (local / Docker) and by the scheduled endpoint (Vercel Cron).
 */
export async function runVisionStaleCheck(pool, { staleSeconds = 90, logger = console } = {}) {
  let markedOffline = 0;
  const [cameras] = await pool.execute(`
    SELECT id, last_frame_at, last_seen_at
      FROM cameras
     WHERE status = 'online' AND last_seen_at IS NOT NULL
       AND last_seen_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? SECOND)
     LIMIT 100
  `, [staleSeconds]);
  for (const camera of cameras) {
    const [updated] = await pool.execute(`
      UPDATE cameras SET status = 'offline',
             last_error = COALESCE(last_error, 'No camera heartbeat received before the stale timeout.')
       WHERE id = ? AND status = 'online'
         AND last_seen_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? SECOND)
    `, [camera.id, staleSeconds]);
    if (!updated.affectedRows) continue;
    const [mappings] = await pool.execute(`
      SELECT DISTINCT r.slot_id
        FROM camera_slot_regions r
       WHERE r.camera_id = ? AND r.is_active = TRUE
    `, [camera.id]);
    for (const mapping of mappings) {
      const [healthySources] = await pool.execute(`
        SELECT 1 FROM camera_slot_regions r
        JOIN cameras c ON c.id = r.camera_id
         WHERE r.slot_id = ? AND r.is_active = TRUE AND c.id <> ?
           AND c.status = 'online' AND c.last_seen_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? SECOND)
         LIMIT 1
      `, [mapping.slot_id, camera.id, staleSeconds]);
      if (healthySources.length) continue;
      await pool.execute(`
        UPDATE parking_slots
           SET physical_state = 'unknown', physical_state_updated_at = UTC_TIMESTAMP(3)
         WHERE id = ? AND (
           physical_state_updated_at IS NULL OR
           physical_state_updated_at <= COALESCE(?, ?)
         )
      `, [mapping.slot_id, camera.last_frame_at, camera.last_seen_at]);
    }
    markedOffline += 1;
    logger.warn?.(`Vision camera ${camera.id} marked offline after missing heartbeat.`);
  }
  return markedOffline;
}

/** Long-running monitor for a persistent server: runs the check every `intervalMs`. */
export function startVisionStaleMonitor(pool, { intervalMs = 20000, staleSeconds = 90, logger = console } = {}) {
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await runVisionStaleCheck(pool, { staleSeconds, logger });
    } catch (error) {
      // Keep API traffic working if migration 007 has not been applied yet; warn rather than crash.
      logger.warn?.(`Vision stale monitor could not complete: ${error.message}`);
    } finally {
      running = false;
    }
  }, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}
