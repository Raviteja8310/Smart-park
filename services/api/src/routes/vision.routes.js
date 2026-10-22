import { Router } from 'express';
import { createHmac, timingSafeEqual, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { pool } from '../config/database.js';
import { env } from '../config/env.js';
import { requireAuth, requireRole } from '../middleware/authenticate.js';
import { normalizePolygon, safeJsonArray } from '../vision/region-utils.js';
import { normalizePlate, plateMatchStatus } from '../vision/plate-utils.js';

const router = Router();
const asyncHandler = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
const uuidSchema = z.string().uuid();
const sourceSchema = z.string().trim().min(1).max(500).refine((value) => !/[\r\n\0]/.test(value), 'The camera source contains an invalid character.');
const createCameraSchema = z.object({
  parkingLotId: uuidSchema,
  name: z.string().trim().min(2).max(120),
  streamReference: sourceSchema,
  detectorMode: z.enum(['yolo']).default('yolo'),
  confidenceThreshold: z.coerce.number().min(0.1).max(0.95).default(0.25)
});
const updateCameraSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  streamReference: sourceSchema.optional(),
  detectorMode: z.enum(['yolo']).optional(),
  confidenceThreshold: z.coerce.number().min(0.1).max(0.95).optional(),
  enabled: z.boolean().optional()
}).refine((value) => Object.keys(value).length > 0, 'Provide at least one field to update.');
const regionSchema = z.object({
  slotId: uuidSchema,
  points: z.array(z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)])).min(3).max(16)
});
const eventSchema = z.object({
  cameraId: uuidSchema,
  frameAt: z.string().datetime({ offset: true }),
  events: z.array(z.object({
    slotId: uuidSchema,
    observedState: z.enum(['empty', 'occupied', 'unknown']),
    confidence: z.number().min(0).max(1).nullable().optional()
  })).max(100)
});
const healthSchema = z.object({ status: z.enum(['offline', 'configured']), message: z.string().trim().max(500).optional().nullable() });
const plateEventSchema = z.object({ cameraId: uuidSchema, plateText: z.string().trim().min(2).max(40), confidence: z.number().min(0).max(1), direction: z.enum(['entry', 'exit', 'unknown']).default('unknown'), observedAt: z.string().datetime({ offset: true }), providerEventId: z.string().trim().min(1).max(120).optional() });
const plateReviewSchema = z.object({ reviewStatus: z.enum(['confirmed', 'false_positive']), note: z.string().trim().max(500).optional().nullable() });

function fail(res, status, code, message) {
  return res.status(status).json({ error: { code, message } });
}
function validId(value) { return uuidSchema.safeParse(value).success; }
function isNetworkCameraSource(value) { return /^rtsps?:\/\//i.test(String(value ?? '').trim()); }
function parsePoints(value) { return safeJsonArray(value); }
function safeTokenEqual(left, right) {
  if (!left || !right) return false;
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
function requireVisionService(req, res, next) {
  if (!env.VISION_API_TOKEN) return fail(res, 503, 'VISION_SERVICE_NOT_CONFIGURED', 'Configure VISION_API_TOKEN in the API environment before connecting the vision service.');
  const authorization = req.get('authorization') ?? '';
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  if (!safeTokenEqual(token, env.VISION_API_TOKEN)) return fail(res, 401, 'VISION_SERVICE_UNAUTHORIZED', 'The vision service credential is invalid.');
  return next();
}
async function audit(executor, actorId, action, entityId, metadata = {}) {
  await executor.execute(
    'INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, metadata) VALUES (?, ?, ?, ?, ?)',
    [actorId ?? null, action, 'camera', entityId ?? null, JSON.stringify(metadata)]
  );
}
async function getCamera(executor, cameraId) {
  const [rows] = await executor.execute(`
    SELECT c.id, c.parking_lot_id, c.name, c.stream_reference, c.detector_mode,
           c.confidence_threshold, c.status, c.last_seen_at, c.last_frame_at,
           c.last_error, c.stale_after_seconds, l.owner_user_id, l.facility_status,
           l.name AS parking_lot_name
      FROM cameras c JOIN parking_lots l ON l.id = c.parking_lot_id
     WHERE c.id = ? LIMIT 1
  `, [cameraId]);
  return rows[0] ?? null;
}
async function canViewLot(executor, lot, user) {
  if (!lot || !user) return false;
  if (user.roles.includes('admin')) return true;
  if (user.roles.includes('host') && lot.owner_user_id === user.id) return true;
  const staffRoles = ['operator', 'attendant'].filter((role) => user.roles.includes(role));
  if (!staffRoles.length) return false;
  const [rows] = await executor.execute(
    `SELECT 1 FROM parking_lot_staff WHERE parking_lot_id = ? AND user_id = ? AND assignment_role IN (${staffRoles.map(() => '?').join(',')}) LIMIT 1`,
    [lot.id, user.id, ...staffRoles]
  );
  return rows.length > 0;
}
async function canManageLot(executor, lot, user) {
  if (!lot || !user) return false;
  if (user.roles.includes('admin')) return true;
  if (user.roles.includes('host') && lot.owner_user_id === user.id) return true;
  if (!user.roles.includes('operator')) return false;
  const [rows] = await executor.execute(
    "SELECT 1 FROM parking_lot_staff WHERE parking_lot_id = ? AND user_id = ? AND assignment_role = 'operator' LIMIT 1",
    [lot.id, user.id]
  );
  return rows.length > 0;
}
function mapCamera(row, regions = []) {
  return {
    id: row.id,
    parkingLotId: row.parking_lot_id,
    parkingLotName: row.parking_lot_name,
    name: row.name,
    detectorMode: row.detector_mode,
    confidenceThreshold: Number(row.confidence_threshold),
    status: row.status,
    lastSeenAt: row.last_seen_at,
    lastFrameAt: row.last_frame_at,
    lastError: row.last_error,
    staleAfterSeconds: Number(row.stale_after_seconds ?? 90),
    regionCount: regions.length,
    regions
  };
}
async function readRegions(executor, cameraId) {
  const [rows] = await executor.execute(`
    SELECT r.slot_id, s.slot_code, r.region_coordinates, r.is_active
      FROM camera_slot_regions r JOIN parking_slots s ON s.id = r.slot_id
     WHERE r.camera_id = ? ORDER BY s.slot_code
  `, [cameraId]);
  return rows.map((row) => ({ slotId: row.slot_id, slotCode: row.slot_code, points: parsePoints(row.region_coordinates), isActive: Boolean(row.is_active) }));
}
async function resetMappedSlotsToUnknown(executor, cameraId, specificSlotId = null) {
  const [mappings] = await executor.execute(`
    SELECT DISTINCT r.slot_id, c.last_frame_at, c.last_seen_at
      FROM camera_slot_regions r JOIN cameras c ON c.id = r.camera_id
     WHERE r.camera_id = ? AND r.is_active = TRUE ${specificSlotId ? 'AND r.slot_id = ?' : ''}
  `, specificSlotId ? [cameraId, specificSlotId] : [cameraId]);
  for (const mapping of mappings) {
    const [healthy] = await executor.execute(`
      SELECT 1 FROM camera_slot_regions r JOIN cameras c ON c.id = r.camera_id
       WHERE r.slot_id = ? AND r.is_active = TRUE AND c.id <> ?
         AND c.status = 'online' AND c.last_seen_at > DATE_SUB(UTC_TIMESTAMP(), INTERVAL c.stale_after_seconds SECOND)
       LIMIT 1
    `, [mapping.slot_id, cameraId]);
    if (healthy.length) continue;
    await executor.execute(`
      UPDATE parking_slots SET physical_state = 'unknown', physical_state_updated_at = UTC_TIMESTAMP(3)
       WHERE id = ? AND (physical_state_updated_at IS NULL OR physical_state_updated_at <= COALESCE(?, ?))
    `, [mapping.slot_id, mapping.last_frame_at, mapping.last_seen_at]);
  }
}
async function requireCameraAccess(req, res, cameraId, manage = false) {
  const camera = await getCamera(pool, cameraId);
  if (!camera) {
    fail(res, 404, 'CAMERA_NOT_FOUND', 'The camera was not found.');
    return null;
  }
  const allowed = manage ? await canManageLot(pool, camera, req.user) : await canViewLot(pool, camera, req.user);
  if (!allowed) {
    fail(res, 403, 'FORBIDDEN', 'You do not have permission to view or manage this camera.');
    return null;
  }
  return camera;
}

// User-facing camera configuration. Only facility owners/admins/assigned operators can change sources or regions.
router.get('/cameras', requireAuth, requireRole('host', 'operator', 'attendant', 'admin'), asyncHandler(async (req, res) => {
  const lotId = req.query.parkingLotId;
  if (lotId && !validId(lotId)) return fail(res, 400, 'INVALID_ID', 'The parking facility identifier is invalid.');
  if (lotId) {
    const [lots] = await pool.execute('SELECT id, owner_user_id FROM parking_lots WHERE id = ? LIMIT 1', [lotId]);
    if (!lots.length) return fail(res, 404, 'LOT_NOT_FOUND', 'The parking facility was not found.');
    if (!(await canViewLot(pool, lots[0], req.user))) return fail(res, 403, 'FORBIDDEN', 'You do not have access to this facility.');
  }
  const conditions = [];
  const params = [];
  if (lotId) { conditions.push('c.parking_lot_id = ?'); params.push(lotId); }
  if (!req.user.roles.includes('admin')) {
    const access = [];
    if (req.user.roles.includes('host')) { access.push('l.owner_user_id = ?'); params.push(req.user.id); }
    const staffRoles = ['operator', 'attendant'].filter((role) => req.user.roles.includes(role));
    if (staffRoles.length) {
      access.push(`EXISTS (SELECT 1 FROM parking_lot_staff p WHERE p.parking_lot_id = l.id AND p.user_id = ? AND p.assignment_role IN (${staffRoles.map(() => '?').join(',')}))`);
      params.push(req.user.id, ...staffRoles);
    }
    if (!access.length) return res.json({ cameras: [] });
    conditions.push(`(${access.join(' OR ')})`);
  }
  const [rows] = await pool.execute(`
    SELECT c.id, c.parking_lot_id, c.name, c.stream_reference, c.detector_mode,
           c.confidence_threshold, c.status, c.last_seen_at, c.last_frame_at,
           c.last_error, c.stale_after_seconds, l.owner_user_id, l.facility_status,
           l.name AS parking_lot_name
      FROM cameras c JOIN parking_lots l ON l.id = c.parking_lot_id
     WHERE ${conditions.length ? conditions.join(' AND ') : '1=1'}
     ORDER BY c.created_at DESC LIMIT 100
  `, params);
  const cameras = [];
  for (const row of rows) cameras.push(mapCamera(row, await readRegions(pool, row.id)));
  return res.json({ cameras });
}));

router.get('/plate-events', requireAuth, requireRole('host', 'operator', 'admin'), asyncHandler(async (req, res) => {
  const lotId = req.query.parkingLotId;
  if (!lotId || !validId(lotId)) return fail(res, 400, 'INVALID_PARKING_LOT', 'Select a valid parking facility to view plate events.');
  const [lots] = await pool.execute('SELECT id, owner_user_id FROM parking_lots WHERE id = ? LIMIT 1', [lotId]);
  if (!lots.length) return fail(res, 404, 'LOT_NOT_FOUND', 'The parking facility was not found.');
  if (!(await canViewLot(pool, lots[0], req.user))) return fail(res, 403, 'FORBIDDEN', 'You do not have access to this facility.');
  const [rows] = await pool.execute(`
    SELECT e.id, e.normalized_plate, e.confidence, e.direction, e.observed_at, e.match_status,
           e.review_status, e.review_note, e.reviewed_at, c.name AS camera_name,
           v.registration_number AS matched_registration, b.booking_code
      FROM anpr_events e JOIN cameras c ON c.id = e.camera_id
      LEFT JOIN vehicles v ON v.id = e.matched_vehicle_id
      LEFT JOIN bookings b ON b.id = e.matched_booking_id
     WHERE e.parking_lot_id = ? ORDER BY e.observed_at DESC LIMIT 100
  `, [lotId]);
  return res.json({ events: rows.map((row) => ({ id: row.id, plate: row.normalized_plate, confidence: Number(row.confidence), direction: row.direction, observedAt: row.observed_at, matchStatus: row.match_status, reviewStatus: row.review_status, reviewNote: row.review_note, reviewedAt: row.reviewed_at, cameraName: row.camera_name, matchedRegistration: row.matched_registration, bookingCode: row.booking_code })) });
}));

router.patch('/plate-events/:eventId/review', requireAuth, requireRole('host', 'operator', 'admin'), asyncHandler(async (req, res) => {
  if (!validId(req.params.eventId)) return fail(res, 400, 'INVALID_ID', 'The plate event identifier is invalid.');
  const parsed = plateReviewSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 400, 'VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Invalid review details.');
  const [rows] = await pool.execute('SELECT e.id, e.camera_id, c.parking_lot_id, l.owner_user_id FROM anpr_events e JOIN cameras c ON c.id = e.camera_id JOIN parking_lots l ON l.id = c.parking_lot_id WHERE e.id = ? LIMIT 1', [req.params.eventId]);
  if (!rows.length) return fail(res, 404, 'PLATE_EVENT_NOT_FOUND', 'The plate event was not found.');
  if (!(await canManageLot(pool, { id: rows[0].parking_lot_id, owner_user_id: rows[0].owner_user_id }, req.user))) return fail(res, 403, 'FORBIDDEN', 'Only the facility owner, assigned operator, or administrator can review plate events.');
  await pool.execute('UPDATE anpr_events SET review_status = ?, review_note = ?, reviewed_by_user_id = ?, reviewed_at = UTC_TIMESTAMP(3) WHERE id = ?', [parsed.data.reviewStatus, parsed.data.note ?? null, req.user.id, req.params.eventId]);
  await pool.execute(`UPDATE operational_alerts SET status='resolved',condition_active=FALSE,resolved_at=COALESCE(resolved_at,UTC_TIMESTAMP(3)),resolved_by_user_id=?,last_seen_at=UTC_TIMESTAMP(3) WHERE fingerprint=? AND alert_type='plate_manual_review' AND status<>'resolved'`, [req.user.id, `anpr-review:${req.params.eventId}`]);
  await audit(pool, req.user.id, 'vision.plate_event_reviewed', req.params.eventId, { reviewStatus: parsed.data.reviewStatus });
  return res.json({ message: 'Plate event review saved.', reviewStatus: parsed.data.reviewStatus });
}));

router.post('/cameras', requireAuth, requireRole('host', 'operator', 'admin'), asyncHandler(async (req, res) => {
  const parsed = createCameraSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 400, 'VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Check the camera fields.');
  if (isNetworkCameraSource(parsed.data.streamReference) && !req.user.roles.includes('admin')) {
    return fail(res, 403, 'NETWORK_CAMERA_ADMIN_ONLY', 'Only a platform administrator can configure RTSP network sources.');
  }
  const [lots] = await pool.execute('SELECT id, owner_user_id, facility_status FROM parking_lots WHERE id = ? LIMIT 1', [parsed.data.parkingLotId]);
  if (!lots.length) return fail(res, 404, 'LOT_NOT_FOUND', 'The parking facility was not found.');
  if (!(await canManageLot(pool, lots[0], req.user))) return fail(res, 403, 'FORBIDDEN', 'Only the owner, an assigned operator or an administrator can configure cameras.');
  const id = randomUUID();
  await pool.execute(`
    INSERT INTO cameras (id, parking_lot_id, name, stream_reference, detector_mode, confidence_threshold, status)
    VALUES (?, ?, ?, ?, ?, ?, 'configured')
  `, [id, parsed.data.parkingLotId, parsed.data.name, parsed.data.streamReference, parsed.data.detectorMode, parsed.data.confidenceThreshold]);
  await audit(pool, req.user.id, 'vision.camera_created', id, { parkingLotId: parsed.data.parkingLotId, name: parsed.data.name });
  return res.status(201).json({ message: 'Camera created. Configure slot regions before starting detection.', cameraId: id });
}));

router.patch('/cameras/:cameraId', requireAuth, requireRole('host', 'operator', 'admin'), asyncHandler(async (req, res) => {
  if (!validId(req.params.cameraId)) return fail(res, 400, 'INVALID_ID', 'The camera identifier is invalid.');
  const parsed = updateCameraSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 400, 'VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Check the camera fields.');
  const camera = await requireCameraAccess(req, res, req.params.cameraId, true);
  if (!camera) return;
  if (parsed.data.streamReference !== undefined && isNetworkCameraSource(parsed.data.streamReference) && !req.user.roles.includes('admin')) {
    return fail(res, 403, 'NETWORK_CAMERA_ADMIN_ONLY', 'Only a platform administrator can configure RTSP network sources.');
  }
  const assignments = [];
  const values = [];
  const map = { name: 'name', streamReference: 'stream_reference', detectorMode: 'detector_mode', confidenceThreshold: 'confidence_threshold' };
  for (const [key, column] of Object.entries(map)) {
    if (parsed.data[key] !== undefined) { assignments.push(`${column} = ?`); values.push(parsed.data[key]); }
  }
  if (parsed.data.enabled !== undefined) {
    assignments.push('status = ?'); values.push(parsed.data.enabled ? 'configured' : 'disabled');
    if (parsed.data.enabled) { assignments.push('last_error = NULL'); }
  } else if (parsed.data.streamReference !== undefined || parsed.data.detectorMode !== undefined || parsed.data.confidenceThreshold !== undefined) {
    assignments.push("status = 'configured'", 'last_error = NULL');
  }
  await pool.execute(`UPDATE cameras SET ${assignments.join(', ')} WHERE id = ?`, [...values, camera.id]);
  if (parsed.data.enabled !== undefined || parsed.data.streamReference !== undefined || parsed.data.detectorMode !== undefined || parsed.data.confidenceThreshold !== undefined) {
    await resetMappedSlotsToUnknown(pool, camera.id);
  }
  await audit(pool, req.user.id, 'vision.camera_updated', camera.id, parsed.data);
  return res.json({ message: 'Camera settings updated.' });
}));

router.post('/cameras/:cameraId/regions', requireAuth, requireRole('host', 'operator', 'admin'), asyncHandler(async (req, res) => {
  if (!validId(req.params.cameraId)) return fail(res, 400, 'INVALID_ID', 'The camera identifier is invalid.');
  const parsed = regionSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 400, 'VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Check the parking-space region.');
  let points;
  try { points = normalizePolygon(parsed.data.points); } catch (error) { return fail(res, 400, 'INVALID_REGION', error.message); }
  const camera = await requireCameraAccess(req, res, req.params.cameraId, true);
  if (!camera) return;
  const [slots] = await pool.execute('SELECT id FROM parking_slots WHERE id = ? AND parking_lot_id = ? LIMIT 1', [parsed.data.slotId, camera.parking_lot_id]);
  if (!slots.length) return fail(res, 400, 'SLOT_NOT_IN_FACILITY', 'The selected slot does not belong to this camera facility.');
  await pool.execute(`
    INSERT INTO camera_slot_regions (id, camera_id, slot_id, region_coordinates, is_active)
    VALUES (?, ?, ?, ?, TRUE)
    ON DUPLICATE KEY UPDATE region_coordinates = VALUES(region_coordinates), is_active = TRUE
  `, [randomUUID(), camera.id, parsed.data.slotId, JSON.stringify(points)]);
  await pool.execute("UPDATE cameras SET status = 'configured', last_error = NULL WHERE id = ? AND status <> 'disabled'", [camera.id]);
  await resetMappedSlotsToUnknown(pool, camera.id, parsed.data.slotId);
  await audit(pool, req.user.id, 'vision.slot_region_saved', camera.id, { slotId: parsed.data.slotId, points });
  return res.json({ message: 'Parking-space region saved. Coordinates are normalized to the camera frame.' });
}));

router.delete('/cameras/:cameraId/regions/:slotId', requireAuth, requireRole('host', 'operator', 'admin'), asyncHandler(async (req, res) => {
  if (!validId(req.params.cameraId) || !validId(req.params.slotId)) return fail(res, 400, 'INVALID_ID', 'The camera or slot identifier is invalid.');
  const camera = await requireCameraAccess(req, res, req.params.cameraId, true);
  if (!camera) return;
  const [result] = await pool.execute('UPDATE camera_slot_regions SET is_active = FALSE WHERE camera_id = ? AND slot_id = ?', [camera.id, req.params.slotId]);
  if (!result.affectedRows) return fail(res, 404, 'REGION_NOT_FOUND', 'The camera does not have a region mapped to this slot.');
  await pool.execute("UPDATE cameras SET status = 'configured', last_error = NULL WHERE id = ? AND status <> 'disabled'", [camera.id]);
  await resetMappedSlotsToUnknown(pool, camera.id, req.params.slotId);
  await audit(pool, req.user.id, 'vision.slot_region_removed', camera.id, { slotId: req.params.slotId });
  return res.json({ message: 'Slot region removed from this camera.' });
}));

router.get('/cameras/:cameraId/stream-ticket', requireAuth, requireRole('host', 'operator', 'attendant', 'admin'), asyncHandler(async (req, res) => {
  if (!validId(req.params.cameraId)) return fail(res, 400, 'INVALID_ID', 'The camera identifier is invalid.');
  if (!env.VISION_API_TOKEN) return fail(res, 503, 'VISION_SERVICE_NOT_CONFIGURED', 'Configure VISION_API_TOKEN before viewing the camera stream.');
  const camera = await requireCameraAccess(req, res, req.params.cameraId, false);
  if (!camera) return;
  const payload = Buffer.from(JSON.stringify({ cameraId: camera.id, exp: Math.floor(Date.now() / 1000) + 120 })).toString('base64url');
  const signature = createHmac('sha256', env.VISION_API_TOKEN).update(payload).digest('hex');
  return res.json({ ticket: `${payload}.${signature}`, expiresInSeconds: 120 });
}));

// Machine-to-machine endpoints are protected by a separate random bearer token, not a user session.
router.get('/service/config', requireVisionService, asyncHandler(async (_req, res) => {
  const [rows] = await pool.execute(`
    SELECT c.id, c.parking_lot_id, c.name, c.stream_reference, c.detector_mode,
           c.confidence_threshold, c.status, c.stale_after_seconds, l.timezone
      FROM cameras c JOIN parking_lots l ON l.id = c.parking_lot_id
     WHERE c.status <> 'disabled' AND c.stream_reference IS NOT NULL AND l.facility_status NOT IN ('closed', 'archived')
     ORDER BY c.created_at ASC LIMIT 100
  `);
  const cameras = [];
  for (const row of rows) {
    const [regionRows] = await pool.execute(`
      SELECT r.slot_id, s.slot_code, r.region_coordinates
        FROM camera_slot_regions r JOIN parking_slots s ON s.id = r.slot_id
       WHERE r.camera_id = ? AND r.is_active = TRUE AND s.operational_status = 'open'
       ORDER BY s.slot_code
    `, [row.id]);
    cameras.push({
      id: row.id,
      parkingLotId: row.parking_lot_id,
      name: row.name,
      streamReference: row.stream_reference,
      detectorMode: row.detector_mode,
      confidenceThreshold: Number(row.confidence_threshold),
      staleAfterSeconds: Number(row.stale_after_seconds),
      timezone: row.timezone,
      regions: regionRows.map((region) => ({ slotId: region.slot_id, slotCode: region.slot_code, points: parsePoints(region.region_coordinates) }))
    });
  }
  return res.json({ cameras, fetchedAt: new Date().toISOString() });
}));

router.post('/service/events', requireVisionService, asyncHandler(async (req, res) => {
  const parsed = eventSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 400, 'VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'The occupancy event payload is invalid.');
  const frameAt = new Date(parsed.data.frameAt);
  const now = Date.now();
  if (frameAt.getTime() > now + 30000 || frameAt.getTime() < now - 5 * 60 * 1000) return fail(res, 400, 'STALE_FRAME', 'Frame timestamp must be recent and cannot be in the future.');
  const seen = new Set();
  for (const event of parsed.data.events) {
    if (seen.has(event.slotId)) return fail(res, 400, 'DUPLICATE_SLOT_EVENT', 'Each slot can appear only once per event batch.');
    seen.add(event.slotId);
  }
  const connection = await pool.getConnection();
  let applied = 0;
  try {
    await connection.beginTransaction();
    const [cameraRows] = await connection.execute("SELECT id, status FROM cameras WHERE id = ? FOR UPDATE", [parsed.data.cameraId]);
    if (!cameraRows.length || cameraRows[0].status === 'disabled') {
      await connection.rollback();
      return fail(res, 404, 'CAMERA_UNAVAILABLE', 'The camera is missing or disabled.');
    }
    if (parsed.data.events.length) {
      const slotIds = parsed.data.events.map((event) => event.slotId);
      const placeholders = slotIds.map(() => '?').join(',');
      const [mappings] = await connection.execute(
        `SELECT slot_id FROM camera_slot_regions WHERE camera_id = ? AND is_active = TRUE AND slot_id IN (${placeholders})`,
        [parsed.data.cameraId, ...slotIds]
      );
      const mappedIds = new Set(mappings.map((row) => row.slot_id));
      if (slotIds.some((slotId) => !mappedIds.has(slotId))) {
        await connection.rollback();
        return fail(res, 400, 'UNMAPPED_SLOT', 'An occupancy event references a slot that is not actively mapped to this camera.');
      }
      for (const event of parsed.data.events) {
        const [updated] = await connection.execute(`
          UPDATE parking_slots
             SET physical_state = ?, physical_state_updated_at = ?
           WHERE id = ? AND (physical_state_updated_at IS NULL OR physical_state_updated_at < ?)
        `, [event.observedState, frameAt, event.slotId, frameAt]);
        if (!updated.affectedRows) continue;
        await connection.execute(`
          INSERT INTO occupancy_events (camera_id, slot_id, observed_state, confidence, observed_at, source)
          VALUES (?, ?, ?, ?, ?, 'camera')
        `, [parsed.data.cameraId, event.slotId, event.observedState, event.confidence ?? null, frameAt]);
        applied += 1;
      }
    }
    await connection.execute(`
      UPDATE cameras SET status = 'online', last_seen_at = UTC_TIMESTAMP(3), last_frame_at = ?, last_error = NULL
       WHERE id = ?
    `, [frameAt, parsed.data.cameraId]);
    await connection.commit();
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally {
    connection.release();
  }
  return res.json({ received: parsed.data.events.length, applied, status: 'online' });
}));

// ANPR provider callback. It records a candidate match for human review; it never opens a gate or changes booking state.
router.post('/service/plate-events', requireVisionService, asyncHandler(async (req, res) => {
  const parsed = plateEventSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 400, 'VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'The plate event payload is invalid.');
  const observed = new Date(parsed.data.observedAt);
  if (observed.getTime() > Date.now() + 30000 || observed.getTime() < Date.now() - 5 * 60 * 1000) return fail(res, 400, 'STALE_PLATE_EVENT', 'Plate event timestamp must be recent and cannot be in the future.');
  const plate = normalizePlate(parsed.data.plateText);
  if (plate.length < 2 || plate.length > 24) return fail(res, 400, 'INVALID_PLATE', 'The normalized vehicle plate must contain 2–24 letters or digits.');
  const [cameras] = await pool.execute('SELECT c.id, c.parking_lot_id, c.status FROM cameras c WHERE c.id = ? LIMIT 1', [parsed.data.cameraId]);
  if (!cameras.length || cameras[0].status === 'disabled') return fail(res, 404, 'CAMERA_UNAVAILABLE', 'The camera is missing or disabled.');
  const camera = cameras[0];
  const [vehicles] = await pool.execute("SELECT id, registration_number FROM vehicles WHERE UPPER(REPLACE(REPLACE(registration_number, ' ', ''), '-', '')) = ? LIMIT 1", [plate]);
  const vehicle = vehicles[0] ?? null;
  let booking = null;
  if (vehicle) {
    const [bookings] = await pool.execute(`SELECT id, booking_code FROM bookings WHERE vehicle_id = ? AND parking_lot_id = ? AND status IN ('confirmed','checked_in') AND start_at <= DATE_ADD(?, INTERVAL 30 MINUTE) AND end_at >= DATE_SUB(?, INTERVAL 30 MINUTE) ORDER BY start_at DESC LIMIT 1`, [vehicle.id, camera.parking_lot_id, observed, observed]);
    booking = bookings[0] ?? null;
  }
  const matchStatus = plateMatchStatus({ confidence: parsed.data.confidence, vehicleMatched: Boolean(vehicle), bookingMatched: Boolean(booking) });
  const id = randomUUID();
  try {
    await pool.execute(`INSERT INTO anpr_events (id, camera_id, parking_lot_id, provider_event_id, normalized_plate, confidence, direction, observed_at, matched_vehicle_id, matched_booking_id, match_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [id, camera.id, camera.parking_lot_id, parsed.data.providerEventId ?? null, plate, parsed.data.confidence, parsed.data.direction, observed, vehicle?.id ?? null, booking?.id ?? null, matchStatus]);
  } catch (error) {
    if (error?.code === 'ER_DUP_ENTRY' && parsed.data.providerEventId) return res.status(200).json({ duplicate: true, message: 'This provider event was already received.' });
    throw error;
  }
  return res.status(201).json({ eventId: id, matchStatus, vehicleMatched: Boolean(vehicle), bookingMatched: Boolean(booking), requiresHumanReview: matchStatus === 'review_required' || matchStatus === 'unmatched' });
}));

router.post('/service/cameras/:cameraId/health', requireVisionService, asyncHandler(async (req, res) => {
  if (!validId(req.params.cameraId)) return fail(res, 400, 'INVALID_ID', 'The camera identifier is invalid.');
  const parsed = healthSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 400, 'VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Invalid camera health payload.');
  const message = parsed.data.message ? parsed.data.message.slice(0, 500) : null;
  const [result] = await pool.execute(
    'UPDATE cameras SET status = ?, last_error = ? WHERE id = ? AND status <> \'disabled\'',
    [parsed.data.status, message, req.params.cameraId]
  );
  if (!result.affectedRows) return fail(res, 404, 'CAMERA_NOT_FOUND', 'The camera was not found or is disabled.');
  if (parsed.data.status === 'offline') {
    await pool.execute(`
      UPDATE parking_slots s
      JOIN camera_slot_regions r ON r.slot_id = s.id AND r.is_active = TRUE
      LEFT JOIN cameras c ON c.id = r.camera_id
         SET s.physical_state = 'unknown', s.physical_state_updated_at = UTC_TIMESTAMP(3)
       WHERE r.camera_id = ?
         AND (s.physical_state_updated_at IS NULL OR s.physical_state_updated_at <= COALESCE(c.last_frame_at, c.last_seen_at))
         AND NOT EXISTS (
           SELECT 1 FROM camera_slot_regions r2 JOIN cameras c2 ON c2.id = r2.camera_id
            WHERE r2.slot_id = s.id AND r2.is_active = TRUE AND c2.id <> ?
              AND c2.status = 'online' AND c2.last_seen_at > DATE_SUB(UTC_TIMESTAMP(), INTERVAL c2.stale_after_seconds SECOND)
         )
    `, [req.params.cameraId, req.params.cameraId]);
  }
  return res.json({ status: parsed.data.status, message: 'Camera health updated.' });
}));

// Compatibility for the API service monitor: all current camera heartbeats are refreshed by /service/events.
export default router;
