import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { pool } from '../config/database.js';
import { requireAuth, requireRole } from '../middleware/authenticate.js';
import { deriveSlotState, isAvailableNow, mapLotRow } from '../parking/availability.js';

const router = Router();
const asyncHandler = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
const lotIdSchema = z.string().uuid();
const roleSchema = z.enum(['operator', 'attendant']);
const operationalStatusSchema = z.enum(['open', 'disabled', 'maintenance']);
const physicalStateSchema = z.enum(['empty', 'occupied', 'unknown']);
const vehicleTypeSchema = z.enum(['motorcycle', 'car', 'suv', 'van', 'truck', 'other', 'any']);
const facilityStatusSchema = z.enum(['draft', 'pending_approval', 'active', 'paused', 'closed', 'archived']);
const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/).nullable().optional();

const lotFields = {
  name: z.string().trim().min(2).max(160),
  description: z.string().trim().max(5000).nullable().optional(),
  addressLine: z.string().trim().min(3).max(255),
  city: z.string().trim().min(2).max(100),
  region: z.string().trim().max(100).nullable().optional(),
  postalCode: z.string().trim().max(20).nullable().optional(),
  countryCode: z.string().trim().length(2).transform((v) => v.toUpperCase()).nullable().optional(),
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
  timezone: z.string().trim().min(1).max(64).default('Asia/Kolkata'),
  currency: z.string().trim().length(3).transform((v) => v.toUpperCase()).default('INR'),
  openingTime: timeSchema,
  closingTime: timeSchema
};
const createLotSchema = z.object({ ...lotFields, timezone: lotFields.timezone, currency: lotFields.currency, facilityStatus: facilityStatusSchema.optional() });
const updateLotSchema = z.object(Object.fromEntries(Object.entries(lotFields).map(([key, schema]) => [key, schema.optional()]))).refine((value) => Object.keys(value).length > 0, 'Provide at least one field to update.');
const createZoneSchema = z.object({ name: z.string().trim().min(1).max(80), levelLabel: z.string().trim().max(40).nullable().optional() });
const bulkSlotsSchema = z.object({
  codes: z.array(z.string().trim().min(1).max(30)).min(1).max(100),
  zoneId: z.string().uuid().nullable().optional(),
  vehicleType: vehicleTypeSchema.default('any'),
  covered: z.boolean().default(false),
  accessible: z.boolean().default(false)
}).superRefine((value, ctx) => {
  const normalized = value.codes.map((code) => code.toUpperCase());
  if (new Set(normalized).size !== normalized.length) {
    ctx.addIssue({ code: 'custom', message: 'Slot codes must be unique within the request.', path: ['codes'] });
  }
});
const updateSlotSchema = z.object({
  operationalStatus: operationalStatusSchema.optional(),
  physicalState: physicalStateSchema.optional(),
  vehicleType: vehicleTypeSchema.optional(),
  covered: z.boolean().optional(),
  accessible: z.boolean().optional(),
  notes: z.string().trim().max(500).nullable().optional()
}).refine((value) => Object.keys(value).length > 0, 'Provide at least one field to update.');
const lotStaffSchema = z.object({ email: z.string().trim().email().max(254), role: roleSchema });
const statusSchema = z.object({ facilityStatus: facilityStatusSchema });
const listQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  city: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(30)
});

const ACTIVE_BOOKING = `EXISTS (
  SELECT 1 FROM bookings b
   WHERE b.slot_id = s.id
     AND b.start_at <= UTC_TIMESTAMP()
     AND b.end_at > UTC_TIMESTAMP()
     AND (
       b.status IN ('confirmed', 'checked_in')
       OR (b.status IN ('held', 'pending_payment') AND (b.hold_expires_at IS NULL OR b.hold_expires_at > UTC_TIMESTAMP()))
     )
)`;

const LOT_SUMMARY_SELECT = `
SELECT l.id, l.owner_user_id, l.name, l.description, l.address_line, l.city, l.region,
       l.postal_code, l.country_code, l.latitude, l.longitude, l.timezone, l.currency,
       l.opening_time, l.closing_time, l.facility_status, l.created_at,
       COUNT(s.id) AS total_spaces,
       COALESCE(SUM(CASE WHEN s.operational_status = 'open' THEN 1 ELSE 0 END), 0) AS open_spaces,
       COALESCE(SUM(CASE WHEN s.operational_status = 'open' AND s.physical_state = 'occupied' THEN 1 ELSE 0 END), 0) AS occupied_now,
       COALESCE(SUM(CASE WHEN s.operational_status = 'open' AND s.physical_state = 'unknown' THEN 1 ELSE 0 END), 0) AS unknown_spaces,
       COALESCE(SUM(CASE WHEN s.operational_status = 'open' AND ${ACTIVE_BOOKING} THEN 1 ELSE 0 END), 0) AS reserved_now,
       COALESCE(SUM(CASE WHEN s.operational_status = 'open' AND s.physical_state = 'empty' AND NOT ${ACTIVE_BOOKING} THEN 1 ELSE 0 END), 0) AS available_now,
       (SELECT MIN(pr.amount) FROM pricing_rules pr
         WHERE pr.parking_lot_id = l.id AND pr.is_active = TRUE AND pr.rate_type = 'hourly'
           AND (pr.valid_from IS NULL OR pr.valid_from <= UTC_TIMESTAMP())
           AND (pr.valid_until IS NULL OR pr.valid_until > UTC_TIMESTAMP())) AS hourly_rate
  FROM parking_lots l
  LEFT JOIN parking_slots s ON s.parking_lot_id = l.id
`;

function fail(res, status, code, message) {
  return res.status(status).json({ error: { code, message } });
}
function validationFail(res, parsed) {
  return fail(res, 400, 'VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Check the submitted fields.');
}
function readLotId(value, res) {
  const parsed = lotIdSchema.safeParse(value);
  if (!parsed.success) {
    fail(res, 400, 'INVALID_ID', 'The parking facility identifier is invalid.');
    return null;
  }
  return parsed.data;
}
async function audit(executor, actorId, action, entityType, entityId, metadata = {}) {
  await executor.execute(
    'INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, metadata) VALUES (?, ?, ?, ?, ?)',
    [actorId ?? null, action, entityType, entityId ?? null, JSON.stringify(metadata)]
  );
}
async function getLot(executor, lotId) {
  const [rows] = await executor.execute('SELECT id, owner_user_id, facility_status FROM parking_lots WHERE id = ? LIMIT 1', [lotId]);
  return rows[0] ?? null;
}
async function getAssignments(executor, userId, lotId) {
  const [rows] = await executor.execute(
    'SELECT assignment_role FROM parking_lot_staff WHERE user_id = ? AND parking_lot_id = ?',
    [userId, lotId]
  );
  return rows.map((row) => row.assignment_role);
}
async function canViewLot(executor, lot, user) {
  if (!lot || !user) return false;
  if (user.roles.includes('admin')) return true;
  if (user.roles.includes('host') && lot.owner_user_id === user.id) return true;
  const assignments = await getAssignments(executor, user.id, lot.id);
  return assignments.some((role) => user.roles.includes(role));
}
async function canManageFacility(executor, lot, user) {
  if (!lot || !user) return false;
  if (user.roles.includes('admin')) return true;
  return user.roles.includes('host') && lot.owner_user_id === user.id;
}
async function canManageInventory(executor, lot, user) {
  if (await canManageFacility(executor, lot, user)) return true;
  if (!lot || !user || !user.roles.includes('operator')) return false;
  const assignments = await getAssignments(executor, user.id, lot.id);
  return assignments.includes('operator');
}
async function canOperateLot(executor, lot, user) {
  return canViewLot(executor, lot, user);
}
async function fetchLotSummaries(whereSql, params = [], limit = 30) {
  const [rows] = await pool.execute(
    `${LOT_SUMMARY_SELECT} ${whereSql} GROUP BY l.id ORDER BY available_now DESC, l.created_at DESC LIMIT ${Number(limit)}`,
    params
  );
  return rows.map(mapLotRow);
}
async function requireLotRead(req, res, lotId) {
  const lot = await getLot(pool, lotId);
  if (!lot) {
    fail(res, 404, 'LOT_NOT_FOUND', 'The parking facility was not found.');
    return null;
  }
  if (lot.facility_status === 'active' || await canViewLot(pool, lot, req.user)) return lot;
  fail(res, 404, 'LOT_NOT_FOUND', 'The parking facility was not found.');
  return null;
}
async function requireLotFacilityManager(req, res, lotId) {
  const lot = await getLot(pool, lotId);
  if (!lot) {
    fail(res, 404, 'LOT_NOT_FOUND', 'The parking facility was not found.');
    return null;
  }
  if (!(await canManageFacility(pool, lot, req.user))) {
    fail(res, 403, 'FORBIDDEN', 'Only the facility owner or an administrator can change facility details.');
    return null;
  }
  return lot;
}
async function requireLotInventoryManager(req, res, lotId) {
  const lot = await getLot(pool, lotId);
  if (!lot) {
    fail(res, 404, 'LOT_NOT_FOUND', 'The parking facility was not found.');
    return null;
  }
  if (!(await canManageInventory(pool, lot, req.user))) {
    fail(res, 403, 'FORBIDDEN', 'You do not have permission to manage this facility inventory.');
    return null;
  }
  return lot;
}
function publicSlot(row) {
  const values = {
    operationalStatus: row.operational_status,
    physicalState: row.physical_state,
    reservedNow: Boolean(Number(row.reserved_now))
  };
  return {
    id: row.id,
    parkingLotId: row.parking_lot_id,
    zoneId: row.zone_id,
    zoneName: row.zone_name ?? null,
    code: row.slot_code,
    vehicleType: row.vehicle_type,
    covered: Boolean(row.covered),
    accessible: Boolean(row.accessible),
    operationalStatus: row.operational_status,
    physicalState: row.physical_state,
    physicalStateUpdatedAt: row.physical_state_updated_at ?? null,
    reservedNow: values.reservedNow,
    availabilityState: deriveSlotState(values),
    availableNow: isAvailableNow(values),
    createdAt: row.created_at
  };
}

// Public discovery list: only published and active facilities are exposed.
router.get('/lots', asyncHandler(async (req, res) => {
  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) return validationFail(res, parsed);
  const conditions = ["l.facility_status = 'active'"];
  const params = [];
  if (parsed.data.q) {
    const search = `%${parsed.data.q}%`;
    conditions.push('(l.name LIKE ? OR l.address_line LIKE ? OR l.city LIKE ? OR COALESCE(l.description, \'\') LIKE ?)');
    params.push(search, search, search, search);
  }
  if (parsed.data.city) {
    conditions.push('l.city LIKE ?');
    params.push(`%${parsed.data.city}%`);
  }
  const lots = await fetchLotSummaries(`WHERE ${conditions.join(' AND ')}`, params, parsed.data.limit);
  return res.json({ lots, count: lots.length });
}));

router.get('/overview', asyncHandler(async (_req, res) => {
  const [rows] = await pool.execute(`
    SELECT
      (SELECT COUNT(*) FROM parking_lots WHERE facility_status = 'active') AS active_lots,
      (SELECT COUNT(*) FROM parking_slots s JOIN parking_lots l ON l.id = s.parking_lot_id WHERE l.facility_status = 'active') AS total_spaces,
      (SELECT COUNT(*) FROM parking_slots s JOIN parking_lots l ON l.id = s.parking_lot_id
        WHERE l.facility_status = 'active' AND s.operational_status = 'open' AND s.physical_state = 'empty' AND NOT ${ACTIVE_BOOKING}) AS available_now,
      (SELECT COUNT(*) FROM parking_slots s JOIN parking_lots l ON l.id = s.parking_lot_id
        WHERE l.facility_status = 'active' AND s.operational_status = 'open' AND s.physical_state = 'occupied') AS occupied_now,
      (SELECT COUNT(*) FROM parking_slots s JOIN parking_lots l ON l.id = s.parking_lot_id
        WHERE l.facility_status = 'active' AND s.operational_status = 'open' AND s.physical_state = 'unknown') AS unknown_spaces,
      (SELECT COUNT(*) FROM parking_slots s JOIN parking_lots l ON l.id = s.parking_lot_id
        WHERE l.facility_status = 'active' AND s.operational_status = 'open' AND ${ACTIVE_BOOKING}) AS reserved_now,
      (SELECT COUNT(*) FROM parking_slots s JOIN parking_lots l ON l.id = s.parking_lot_id
        WHERE l.facility_status = 'active' AND s.operational_status = 'open') AS open_spaces
  `);
  const row = rows[0];
  const featuredLots = await fetchLotSummaries("WHERE l.facility_status = 'active'", [], 5);
  return res.json({
    overview: {
      activeLots: Number(row.active_lots ?? 0),
      totalSpaces: Number(row.total_spaces ?? 0),
      availableNow: Number(row.available_now ?? 0),
      occupiedNow: Number(row.occupied_now ?? 0),
      unknownSpaces: Number(row.unknown_spaces ?? 0),
      reservedNow: Number(row.reserved_now ?? 0),
      openSpaces: Number(row.open_spaces ?? 0)
    },
    featuredLots
  });
}));

// Authenticated user's inventory. Owners see their own facilities; assigned staff see only assigned facilities.
router.get('/managed-lots', requireAuth, asyncHandler(async (req, res) => {
  if (req.user.roles.includes('admin')) {
    const lots = await fetchLotSummaries('WHERE 1 = 1', [], 50);
    return res.json({ lots });
  }
  const conditions = [];
  const params = [];
  if (req.user.roles.includes('host')) {
    conditions.push('l.owner_user_id = ?');
    params.push(req.user.id);
  }
  const staffRoles = ['operator', 'attendant'].filter((role) => req.user.roles.includes(role));
  if (staffRoles.length) {
    conditions.push(`EXISTS (SELECT 1 FROM parking_lot_staff pls WHERE pls.parking_lot_id = l.id AND pls.user_id = ? AND pls.assignment_role IN (${staffRoles.map(() => '?').join(',')}))`);
    params.push(req.user.id, ...staffRoles);
  }
  if (!conditions.length) return res.json({ lots: [] });
  const lots = await fetchLotSummaries(`WHERE (${conditions.join(' OR ')})`, params, 50);
  return res.json({ lots });
}));

router.get('/lots/:lotId', requireAuth, asyncHandler(async (req, res) => {
  const lotId = readLotId(req.params.lotId, res);
  if (!lotId) return;
  const lot = await requireLotRead(req, res, lotId);
  if (!lot) return;
  const rows = await fetchLotSummaries('WHERE l.id = ?', [lotId], 1);
  if (!rows.length) return fail(res, 404, 'LOT_NOT_FOUND', 'The parking facility was not found.');
  return res.json({ lot: rows[0] });
}));

router.get('/lots/:lotId/zones', requireAuth, asyncHandler(async (req, res) => {
  const lotId = readLotId(req.params.lotId, res);
  if (!lotId) return;
  const lot = await requireLotRead(req, res, lotId);
  if (!lot) return;
  const [rows] = await pool.execute(
    'SELECT id, parking_lot_id, name, level_label, created_at FROM parking_zones WHERE parking_lot_id = ? ORDER BY name ASC',
    [lotId]
  );
  return res.json({ zones: rows.map((row) => ({ id: row.id, parkingLotId: row.parking_lot_id, name: row.name, levelLabel: row.level_label, createdAt: row.created_at })) });
}));

router.get('/lots/:lotId/slots', requireAuth, asyncHandler(async (req, res) => {
  const lotId = readLotId(req.params.lotId, res);
  if (!lotId) return;
  const lot = await requireLotRead(req, res, lotId);
  if (!lot) return;
  const [rows] = await pool.execute(`
    SELECT s.id, s.parking_lot_id, s.zone_id, z.name AS zone_name, s.slot_code,
           s.vehicle_type, s.covered, s.accessible, s.operational_status, s.physical_state,
           s.physical_state_updated_at, s.notes, s.created_at,
           (${ACTIVE_BOOKING}) AS reserved_now
      FROM parking_slots s
      LEFT JOIN parking_zones z ON z.id = s.zone_id
     WHERE s.parking_lot_id = ?
     ORDER BY z.name ASC, s.slot_code ASC
  `, [lotId]);
  const slots = rows.map(publicSlot);
  const summary = {
    total: slots.length,
    available: slots.filter((slot) => slot.availabilityState === 'available').length,
    occupied: slots.filter((slot) => slot.availabilityState === 'occupied').length,
    reserved: slots.filter((slot) => slot.availabilityState === 'reserved').length,
    unknown: slots.filter((slot) => slot.availabilityState === 'unknown').length,
    disabled: slots.filter((slot) => slot.availabilityState === 'disabled').length,
    maintenance: slots.filter((slot) => slot.availabilityState === 'maintenance').length
  };
  return res.json({ lotId, summary, slots });
}));

router.post('/lots', requireAuth, requireRole('host', 'admin'), asyncHandler(async (req, res) => {
  const parsed = createLotSchema.safeParse(req.body);
  if (!parsed.success) return validationFail(res, parsed);
  const input = parsed.data;
  const id = randomUUID();
  const isAdmin = req.user.roles.includes('admin');
  const status = isAdmin && input.facilityStatus ? input.facilityStatus : 'draft';
  await pool.execute(`
    INSERT INTO parking_lots
      (id, owner_user_id, name, description, address_line, city, region, postal_code, country_code,
       latitude, longitude, timezone, currency, opening_time, closing_time, facility_status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [id, req.user.roles.includes('host') && !isAdmin ? req.user.id : null, input.name, input.description ?? null,
    input.addressLine, input.city, input.region ?? null, input.postalCode ?? null, input.countryCode ?? null,
    input.latitude ?? null, input.longitude ?? null, input.timezone, input.currency,
    input.openingTime ?? null, input.closingTime ?? null, status]);
  await audit(pool, req.user.id, 'parking.lot_created', 'parking_lot', id, { status });
  const lots = await fetchLotSummaries('WHERE l.id = ?', [id], 1);
  return res.status(201).json({ lot: lots[0], message: 'Parking facility created.' });
}));

router.patch('/lots/:lotId', requireAuth, asyncHandler(async (req, res) => {
  const lotId = readLotId(req.params.lotId, res);
  if (!lotId) return;
  const lot = await requireLotFacilityManager(req, res, lotId);
  if (!lot) return;
  const parsed = updateLotSchema.safeParse(req.body);
  if (!parsed.success) return validationFail(res, parsed);
  const mapping = {
    name: 'name', description: 'description', addressLine: 'address_line', city: 'city', region: 'region',
    postalCode: 'postal_code', countryCode: 'country_code', latitude: 'latitude', longitude: 'longitude',
    timezone: 'timezone', currency: 'currency', openingTime: 'opening_time', closingTime: 'closing_time'
  };
  const fields = Object.entries(parsed.data).filter(([, value]) => value !== undefined);
  if (!fields.length) return fail(res, 400, 'EMPTY_UPDATE', 'Provide at least one field to update.');
  const assignments = fields.map(([field]) => `${mapping[field]} = ?`);
  const values = fields.map(([field, value]) => ['countryCode', 'currency'].includes(field) && value ? value.toUpperCase() : value);
  await pool.execute(`UPDATE parking_lots SET ${assignments.join(', ')} WHERE id = ?`, [...values, lotId]);
  await audit(pool, req.user.id, 'parking.lot_updated', 'parking_lot', lotId, { fields: fields.map(([field]) => field) });
  const [rows] = await pool.execute(`${LOT_SUMMARY_SELECT} WHERE l.id = ? GROUP BY l.id`, [lotId]);
  return res.json({ lot: rows[0] ? mapLotRow(rows[0]) : null, message: 'Facility details updated.' });
}));

router.post('/lots/:lotId/submit-for-approval', requireAuth, requireRole('host', 'admin'), asyncHandler(async (req, res) => {
  const lotId = readLotId(req.params.lotId, res);
  if (!lotId) return;
  const lot = await requireLotFacilityManager(req, res, lotId);
  if (!lot) return;
  if (lot.facility_status !== 'draft') return fail(res, 409, 'INVALID_FACILITY_TRANSITION', 'Only draft facilities can be submitted for approval.');
  await pool.execute("UPDATE parking_lots SET facility_status = 'pending_approval' WHERE id = ?", [lotId]);
  await audit(pool, req.user.id, 'parking.lot_submitted_for_approval', 'parking_lot', lotId, {});
  return res.json({ message: 'Facility submitted for administrator approval.', facilityStatus: 'pending_approval' });
}));

router.patch('/lots/:lotId/status', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const lotId = readLotId(req.params.lotId, res);
  if (!lotId) return;
  const parsed = statusSchema.safeParse(req.body);
  if (!parsed.success) return validationFail(res, parsed);
  const lot = await getLot(pool, lotId);
  if (!lot) return fail(res, 404, 'LOT_NOT_FOUND', 'The parking facility was not found.');
  await pool.execute('UPDATE parking_lots SET facility_status = ? WHERE id = ?', [parsed.data.facilityStatus, lotId]);
  await audit(pool, req.user.id, 'parking.lot_status_changed', 'parking_lot', lotId, { from: lot.facility_status, to: parsed.data.facilityStatus });
  return res.json({ message: 'Facility status updated.', facilityStatus: parsed.data.facilityStatus });
}));

router.post('/lots/:lotId/zones', requireAuth, asyncHandler(async (req, res) => {
  const lotId = readLotId(req.params.lotId, res);
  if (!lotId) return;
  const lot = await requireLotInventoryManager(req, res, lotId);
  if (!lot) return;
  const parsed = createZoneSchema.safeParse(req.body);
  if (!parsed.success) return validationFail(res, parsed);
  const id = randomUUID();
  try {
    await pool.execute('INSERT INTO parking_zones (id, parking_lot_id, name, level_label) VALUES (?, ?, ?, ?)',
      [id, lotId, parsed.data.name, parsed.data.levelLabel ?? null]);
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') return fail(res, 409, 'ZONE_EXISTS', 'A zone with this name already exists in the facility.');
    throw error;
  }
  await audit(pool, req.user.id, 'parking.zone_created', 'parking_zone', id, { parkingLotId: lotId });
  return res.status(201).json({ zone: { id, parkingLotId: lotId, name: parsed.data.name, levelLabel: parsed.data.levelLabel ?? null }, message: 'Zone created.' });
}));

router.post('/lots/:lotId/slots/bulk', requireAuth, asyncHandler(async (req, res) => {
  const lotId = readLotId(req.params.lotId, res);
  if (!lotId) return;
  const lot = await requireLotInventoryManager(req, res, lotId);
  if (!lot) return;
  const parsed = bulkSlotsSchema.safeParse(req.body);
  if (!parsed.success) return validationFail(res, parsed);
  const input = parsed.data;
  const codes = input.codes.map((code) => code.trim().toUpperCase());
  if (input.zoneId) {
    const [zones] = await pool.execute('SELECT id FROM parking_zones WHERE id = ? AND parking_lot_id = ? LIMIT 1', [input.zoneId, lotId]);
    if (!zones.length) return fail(res, 400, 'INVALID_ZONE', 'Choose a zone belonging to this facility.');
  }
  const connection = await pool.getConnection();
  const insertedIds = [];
  try {
    await connection.beginTransaction();
    for (const code of codes) {
      const id = randomUUID();
      await connection.execute(`
        INSERT INTO parking_slots
          (id, parking_lot_id, zone_id, slot_code, vehicle_type, covered, accessible, operational_status, physical_state)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'open', 'unknown')
      `, [id, lotId, input.zoneId ?? null, code, input.vehicleType, input.covered, input.accessible]);
      insertedIds.push(id);
    }
    await audit(connection, req.user.id, 'parking.slots_created', 'parking_lot', lotId, { codes, count: codes.length });
    await connection.commit();
  } catch (error) {
    await connection.rollback().catch(() => {});
    if (error.code === 'ER_DUP_ENTRY') return fail(res, 409, 'SLOT_CODE_EXISTS', 'One or more slot codes already exist in this facility. No slots were created.');
    throw error;
  } finally {
    connection.release();
  }
  return res.status(201).json({ message: `${insertedIds.length} parking space(s) created. Set physical status before advertising them as available.`, createdCount: insertedIds.length, ids: insertedIds });
}));

router.patch('/slots/:slotId', requireAuth, asyncHandler(async (req, res) => {
  const slotId = readLotId(req.params.slotId, res);
  if (!slotId) return;
  const parsed = updateSlotSchema.safeParse(req.body);
  if (!parsed.success) return validationFail(res, parsed);
  const [slots] = await pool.execute(`
    SELECT s.id, s.parking_lot_id, l.owner_user_id
      FROM parking_slots s JOIN parking_lots l ON l.id = s.parking_lot_id
     WHERE s.id = ? LIMIT 1
  `, [slotId]);
  if (!slots.length) return fail(res, 404, 'SLOT_NOT_FOUND', 'The parking space was not found.');
  const slot = slots[0];
  const lot = { id: slot.parking_lot_id, owner_user_id: slot.owner_user_id };
  if (!(await canOperateLot(pool, lot, req.user))) return fail(res, 403, 'FORBIDDEN', 'You do not have permission to update this parking space.');
  if (parsed.data.operationalStatus !== undefined && !(await canManageInventory(pool, lot, req.user))) {
    return fail(res, 403, 'FORBIDDEN', 'Only the owner, assigned operator or administrator can change operational status.');
  }
  const mapping = { operationalStatus: 'operational_status', physicalState: 'physical_state', vehicleType: 'vehicle_type', covered: 'covered', accessible: 'accessible', notes: 'notes' };
  const fields = Object.entries(parsed.data).filter(([, value]) => value !== undefined);
  const values = fields.map(([field, value]) => value);
  const assignments = fields.map(([field]) => `${mapping[field]} = ?`);
  if (parsed.data.physicalState !== undefined) {
    assignments.push('physical_state_updated_at = UTC_TIMESTAMP(3)');
  }
  await pool.execute(`UPDATE parking_slots SET ${assignments.join(', ')} WHERE id = ?`, [...values, slotId]);
  await audit(pool, req.user.id, 'parking.slot_updated', 'parking_slot', slotId, parsed.data);
  return res.json({ message: 'Parking space updated.' });
}));

router.post('/lots/:lotId/staff', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const lotId = readLotId(req.params.lotId, res);
  if (!lotId) return;
  const lot = await getLot(pool, lotId);
  if (!lot) return fail(res, 404, 'LOT_NOT_FOUND', 'The parking facility was not found.');
  const parsed = lotStaffSchema.safeParse(req.body);
  if (!parsed.success) return validationFail(res, parsed);
  const email = parsed.data.email.trim().toLowerCase();
  const [users] = await pool.execute("SELECT id, account_status FROM users WHERE email = ? LIMIT 1", [email]);
  if (!users.length || users[0].account_status !== 'active') return fail(res, 404, 'ACTIVE_USER_NOT_FOUND', 'An active, verified account with that email was not found.');
  const existingRole = parsed.data.role;
  const [userRoles] = await pool.execute(`SELECT r.role_key FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = ? AND r.role_key = ?`, [users[0].id, existingRole]);
  if (!userRoles.length) return fail(res, 400, 'ROLE_NOT_ASSIGNED', `Assign the ${existingRole} role to this user before assigning the facility.`);
  try {
    await pool.execute('INSERT INTO parking_lot_staff (id, parking_lot_id, user_id, assignment_role, assigned_by_user_id) VALUES (?, ?, ?, ?, ?)',
      [randomUUID(), lotId, users[0].id, existingRole, req.user.id]);
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') return fail(res, 409, 'STAFF_ALREADY_ASSIGNED', 'This staff member already has this assignment.');
    throw error;
  }
  await audit(pool, req.user.id, 'parking.staff_assigned', 'parking_lot', lotId, { staffUserId: users[0].id, role: existingRole });
  return res.status(201).json({ message: `${existingRole} assigned to facility.` });
}));

router.delete('/lots/:lotId/staff/:userId/:role', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const lotId = readLotId(req.params.lotId, res);
  const userId = readLotId(req.params.userId, res);
  if (!lotId || !userId) return;
  const roleParsed = roleSchema.safeParse(req.params.role);
  if (!roleParsed.success) return fail(res, 400, 'INVALID_ROLE', 'The assignment role is invalid.');
  const [result] = await pool.execute('DELETE FROM parking_lot_staff WHERE parking_lot_id = ? AND user_id = ? AND assignment_role = ?', [lotId, userId, roleParsed.data]);
  if (result.affectedRows === 0) return fail(res, 404, 'ASSIGNMENT_NOT_FOUND', 'That staff assignment was not found.');
  await audit(pool, req.user.id, 'parking.staff_unassigned', 'parking_lot', lotId, { staffUserId: userId, role: roleParsed.data });
  return res.json({ message: 'Staff assignment removed.' });
}));

export default router;
