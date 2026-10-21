import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import multer from 'multer';
import { z } from 'zod';
import { pool } from '../config/database.js';
import { requireAuth, requireRole } from '../middleware/authenticate.js';

const router = Router();
const asyncHandler = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
const uploadDir = fileURLToPath(new URL('../../uploads/marketplace/', import.meta.url));
await mkdir(uploadDir, { recursive: true });
const uuidSchema = z.string().uuid();
const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/);
const parkingTypeSchema = z.enum(['driveway', 'garage', 'covered_lot', 'outdoor_lot', 'private_bay', 'commercial', 'other']);
const vehicleTypeSchema = z.enum(['motorcycle', 'car', 'suv', 'van', 'truck', 'other', 'any']);
const amenitySchema = z.enum(['coveredParking', 'cctv', 'onsiteStaff', 'accessibleParking', 'lighting', 'overnightAccess', 'evCharging', 'gatedAccess']);

const createListingSchema = z.object({
  name: z.string().trim().min(2).max(160),
  description: z.string().trim().max(5000).nullable().optional(),
  addressLine: z.string().trim().min(3).max(255),
  city: z.string().trim().min(2).max(100),
  region: z.string().trim().max(100).nullable().optional(),
  postalCode: z.string().trim().max(20).nullable().optional(),
  countryCode: z.string().trim().length(2).default('IN').transform((v) => v.toUpperCase()),
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
  timezone: z.string().trim().min(1).max(64).default('Asia/Kolkata'),
  currency: z.string().trim().length(3).default('INR').transform((v) => v.toUpperCase()),
  openingTime: timeSchema.default('06:00'),
  closingTime: timeSchema.default('23:00'),
  contactPhone: z.string().trim().max(30).nullable().optional(),
  specialInstructions: z.string().trim().max(2000).nullable().optional(),
  parkingType: parkingTypeSchema.default('private_bay'),
  amenities: z.array(amenitySchema).max(8).default([]),
  numberSpaces: z.coerce.number().int().min(1).max(100).default(1),
  vehicleType: vehicleTypeSchema.default('any'),
  hourlyRate: z.coerce.number().finite().min(0).max(10000000),
  dailyRate: z.number().finite().min(0).max(10000000).nullable().optional(),
  weeklyRate: z.number().finite().min(0).max(10000000).nullable().optional(),
  monthlyRate: z.number().finite().min(0).max(10000000).nullable().optional(),
  serviceFee: z.coerce.number().finite().min(0).max(1000000).default(0),
  taxRatePercent: z.coerce.number().finite().min(0).max(100).default(0)
}).superRefine((value, ctx) => {
  if (value.closingTime <= value.openingTime) {
    ctx.addIssue({ code: 'custom', message: 'Closing time must be later than opening time. Overnight schedules can be configured in a later version.', path: ['closingTime'] });
  }
  if ((value.latitude === null || value.latitude === undefined) !== (value.longitude === null || value.longitude === undefined)) {
    ctx.addIssue({ code: 'custom', message: 'Provide both latitude and longitude, or leave both blank.', path: ['latitude'] });
  }
});

const updateListingSchema = z.object({
  name: z.string().trim().min(2).max(160).optional(),
  description: z.string().trim().max(5000).nullable().optional(),
  addressLine: z.string().trim().min(3).max(255).optional(),
  city: z.string().trim().min(2).max(100).optional(),
  region: z.string().trim().max(100).nullable().optional(),
  postalCode: z.string().trim().max(20).nullable().optional(),
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
  contactPhone: z.string().trim().max(30).nullable().optional(),
  specialInstructions: z.string().trim().max(2000).nullable().optional(),
  parkingType: parkingTypeSchema.optional(),
  amenities: z.array(amenitySchema).max(8).optional(),
  openingTime: timeSchema.optional(),
  closingTime: timeSchema.optional()
}).refine((value) => Object.keys(value).length > 0, 'Provide at least one field to update.');

const scheduleSchema = z.object({
  weekday: z.number().int().min(0).max(6),
  isAvailable: z.boolean(),
  opensAt: timeSchema.nullable().optional(),
  closesAt: timeSchema.nullable().optional()
}).superRefine((value, ctx) => {
  if (value.isAvailable && (!value.opensAt || !value.closesAt || value.closesAt <= value.opensAt)) {
    ctx.addIssue({ code: 'custom', message: 'Available days need a closing time later than the opening time.', path: ['closesAt'] });
  }
});
const schedulesSchema = z.object({ rules: z.array(scheduleSchema).length(7) }).superRefine((value, ctx) => {
  const days = value.rules.map((rule) => rule.weekday);
  if (new Set(days).size !== 7) ctx.addIssue({ code: 'custom', message: 'Provide exactly one schedule for each weekday (Sunday through Saturday).', path: ['rules'] });
});

const searchSchema = z.object({
  q: z.string().trim().max(100).optional(),
  city: z.string().trim().max(100).optional(),
  parkingType: parkingTypeSchema.optional(),
  amenity: amenitySchema.optional(),
  maxHourlyRate: z.coerce.number().finite().min(0).max(10000000).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(30)
});

function fail(res, status, code, message) {
  return res.status(status).json({ error: { code, message } });
}
function validationFail(res, parsed) {
  return fail(res, 400, 'VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Check the submitted fields.');
}
function normalizeJson(value, fallback = []) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return value;
  if (typeof value === 'string') {
    try { return JSON.parse(value); } catch { return fallback; }
  }
  return fallback;
}
function mapPhoto(row) {
  return { id: row.id, publicUrl: row.public_url, altText: row.alt_text, sortOrder: Number(row.sort_order), createdAt: row.created_at };
}
function mapSchedule(row) {
  return { id: row.id, weekday: Number(row.weekday), isAvailable: Boolean(row.is_available), opensAt: row.opens_at ?? null, closesAt: row.closes_at ?? null };
}
function mapListing(row) {
  return {
    id: row.id,
    ownerUserId: row.owner_user_id,
    ownerName: row.owner_name ?? null,
    name: row.name,
    description: row.description ?? '',
    listingKind: row.listing_kind,
    parkingType: row.parking_type,
    contactPhone: row.contact_phone ?? '',
    specialInstructions: row.special_instructions ?? '',
    amenities: normalizeJson(row.amenities, []),
    addressLine: row.address_line,
    city: row.city,
    region: row.region ?? '',
    postalCode: row.postal_code ?? '',
    countryCode: row.country_code ?? 'IN',
    latitude: row.latitude === null || row.latitude === undefined ? null : Number(row.latitude),
    longitude: row.longitude === null || row.longitude === undefined ? null : Number(row.longitude),
    timezone: row.timezone,
    currency: row.currency,
    openingTime: row.opening_time ?? null,
    closingTime: row.closing_time ?? null,
    facilityStatus: row.facility_status,
    totalSpaces: Number(row.total_spaces ?? 0),
    availableNow: Number(row.available_now ?? 0),
    hourlyRate: row.hourly_rate === null || row.hourly_rate === undefined ? null : Number(row.hourly_rate),
    coverPhoto: row.cover_photo ?? null,
    photoCount: Number(row.photo_count ?? 0),
    createdAt: row.created_at
  };
}
async function audit(executor, actorId, action, entityType, entityId, metadata = {}) {
  await executor.execute(
    'INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, metadata) VALUES (?, ?, ?, ?, ?)',
    [actorId, action, entityType, entityId, JSON.stringify(metadata)]
  );
}
async function getOwnedListing(executor, listingId, user) {
  const [rows] = await executor.execute(
    `SELECT id, owner_user_id, facility_status, listing_kind FROM parking_lots WHERE id = ? LIMIT 1`,
    [listingId]
  );
  const lot = rows[0];
  if (!lot) return { lot: null, allowed: false };
  return { lot, allowed: Boolean(user.roles.includes('admin') || (user.roles.includes('host') && lot.owner_user_id === user.id)) };
}
const listingSummarySql = `
  SELECT l.id, l.owner_user_id, (SELECT u.full_name FROM users u WHERE u.id = l.owner_user_id LIMIT 1) AS owner_name,
         l.name, l.description, l.listing_kind, l.parking_type, l.contact_phone, l.special_instructions,
         l.amenities, l.address_line, l.city, l.region, l.postal_code, l.country_code,
         l.latitude, l.longitude, l.timezone, l.currency, l.opening_time, l.closing_time,
         l.facility_status, l.created_at,
         COUNT(s.id) AS total_spaces,
         COALESCE(SUM(CASE WHEN s.operational_status = 'open' AND s.physical_state = 'empty'
           AND NOT EXISTS (SELECT 1 FROM bookings b WHERE b.slot_id = s.id AND b.start_at <= UTC_TIMESTAMP() AND b.end_at > UTC_TIMESTAMP()
             AND (b.status IN ('confirmed','checked_in') OR (b.status IN ('held','pending_payment') AND b.hold_expires_at > UTC_TIMESTAMP())))
           THEN 1 ELSE 0 END), 0) AS available_now,
         (SELECT MIN(pr.amount) FROM pricing_rules pr WHERE pr.parking_lot_id = l.id AND pr.currency = l.currency AND pr.is_active = TRUE AND pr.rate_type = 'hourly'
           AND (pr.valid_from IS NULL OR pr.valid_from <= UTC_TIMESTAMP()) AND (pr.valid_until IS NULL OR pr.valid_until > UTC_TIMESTAMP())) AS hourly_rate,
         (SELECT ph.public_url FROM parking_listing_photos ph WHERE ph.parking_lot_id = l.id ORDER BY ph.sort_order, ph.created_at LIMIT 1) AS cover_photo,
         (SELECT COUNT(*) FROM parking_listing_photos pc WHERE pc.parking_lot_id = l.id) AS photo_count
    FROM parking_lots l LEFT JOIN parking_slots s ON s.parking_lot_id = l.id
`;
async function fetchListings(whereSql, params = [], limit = 30) {
  const [rows] = await pool.execute(`${listingSummarySql} WHERE ${whereSql} GROUP BY l.id ORDER BY l.created_at DESC LIMIT ${Number(limit)}`, params);
  return rows.map(mapListing);
}

const acceptedMimes = new Set(['image/jpeg', 'image/png', 'image/webp']);
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, callback) => callback(null, uploadDir),
    filename: (_req, file, callback) => {
      const extensionByMime = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };
      callback(null, `${randomUUID()}${extensionByMime[file.mimetype] ?? '.img'}`);
    }
  }),
  limits: { files: 8, fileSize: 5 * 1024 * 1024, fields: 3, fieldSize: 2048 },
  fileFilter: (_req, file, callback) => callback(acceptedMimes.has(file.mimetype) ? null : new Error('Only JPEG, PNG, or WebP images are accepted.'), acceptedMimes.has(file.mimetype))
});
function uploadPhotos(req, res, next) {
  upload.array('photos', 8)(req, res, (error) => {
    if (!error) return next();
    const code = error.code === 'LIMIT_FILE_SIZE' ? 'PHOTO_TOO_LARGE' : error.code === 'LIMIT_FILE_COUNT' ? 'TOO_MANY_PHOTOS' : 'INVALID_PHOTO';
    const status = error.code ? 400 : 415;
    // Multer can finish writing earlier files before a later file fails.
    void removeUploadedFiles(req.files ?? []).finally(() => {
      if (!res.headersSent) res.status(status).json({ error: { code, message: error.message || 'Unable to process uploaded photos.' } });
    });
  });
}
async function removeUploadedFiles(files = []) {
  await Promise.all(files.map((file) => unlink(file.path).catch(() => {})));
}
async function isSupportedImage(filePath, mimeType) {
  const buffer = await readFile(filePath);
  if (mimeType === 'image/jpeg') return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (mimeType === 'image/png') return buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (mimeType === 'image/webp') return buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP';
  return false;
}

// Public shared-parking search. Only active, approved listings are visible to drivers.
router.get('/listings', asyncHandler(async (req, res) => {
  const parsed = searchSchema.safeParse(req.query);
  if (!parsed.success) return validationFail(res, parsed);
  const input = parsed.data;
  const conditions = ["l.listing_kind = 'shared_space'", "l.facility_status = 'active'"];
  const params = [];
  if (input.q) {
    const needle = `%${input.q}%`;
    conditions.push('(l.name LIKE ? OR l.address_line LIKE ? OR l.city LIKE ? OR COALESCE(l.description, \'\') LIKE ? OR COALESCE(l.special_instructions, \'\') LIKE ?)');
    params.push(needle, needle, needle, needle, needle);
  }
  if (input.city) { conditions.push('l.city LIKE ?'); params.push(`%${input.city}%`); }
  if (input.parkingType) { conditions.push('l.parking_type = ?'); params.push(input.parkingType); }
  if (input.amenity) { conditions.push('JSON_CONTAINS(COALESCE(l.amenities, JSON_ARRAY()), JSON_QUOTE(?))'); params.push(input.amenity); }
  if (input.maxHourlyRate !== undefined) {
    conditions.push(`(SELECT MIN(pr.amount) FROM pricing_rules pr WHERE pr.parking_lot_id = l.id AND pr.currency = l.currency AND pr.is_active = TRUE AND pr.rate_type = 'hourly'
      AND (pr.valid_from IS NULL OR pr.valid_from <= UTC_TIMESTAMP()) AND (pr.valid_until IS NULL OR pr.valid_until > UTC_TIMESTAMP())) <= ?`);
    params.push(input.maxHourlyRate);
  }
  const listings = await fetchListings(conditions.join(' AND '), params, input.limit);
  return res.json({ listings, count: listings.length });
}));

router.get('/listings/mine', requireAuth, requireRole('host', 'admin'), asyncHandler(async (req, res) => {
  const listings = req.user.roles.includes('admin')
    ? await fetchListings("l.listing_kind = 'shared_space'", [], 50)
    : await fetchListings("l.listing_kind = 'shared_space' AND l.owner_user_id = ?", [req.user.id], 50);
  return res.json({ listings });
}));

router.post('/listings', requireAuth, requireRole('host', 'admin'), asyncHandler(async (req, res) => {
  const parsed = createListingSchema.safeParse(req.body);
  if (!parsed.success) return validationFail(res, parsed);
  const input = parsed.data;
  const connection = await pool.getConnection();
  const listingId = randomUUID();
  const openingTime = input.openingTime;
  const closingTime = input.closingTime;
  try {
    await connection.beginTransaction();
    await connection.execute(
      `INSERT INTO parking_lots
        (id, owner_user_id, name, description, listing_kind, parking_type, contact_phone, special_instructions, amenities,
         address_line, city, region, postal_code, country_code, latitude, longitude, timezone, currency, opening_time, closing_time, facility_status)
       VALUES (?, ?, ?, ?, 'shared_space', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft')`,
      [listingId, req.user.id, input.name, input.description ?? null, input.parkingType, input.contactPhone ?? null,
        input.specialInstructions ?? null, JSON.stringify(input.amenities), input.addressLine, input.city, input.region ?? null,
        input.postalCode ?? null, input.countryCode, input.latitude ?? null, input.longitude ?? null, input.timezone,
        input.currency, openingTime, closingTime]
    );
    const amenityFlags = new Set(input.amenities);
    for (let index = 1; index <= input.numberSpaces; index += 1) {
      const slotCode = `P${String(index).padStart(2, '0')}`;
      await connection.execute(
        `INSERT INTO parking_slots (id, parking_lot_id, slot_code, vehicle_type, covered, accessible, operational_status, physical_state)
         VALUES (?, ?, ?, ?, ?, ?, 'open', 'unknown')`,
        [randomUUID(), listingId, slotCode, input.vehicleType, amenityFlags.has('coveredParking') ? 1 : 0, amenityFlags.has('accessibleParking') ? 1 : 0]
      );
    }
    const rates = [
      ['hourly', input.hourlyRate], ['daily', input.dailyRate], ['weekly', input.weeklyRate], ['monthly', input.monthlyRate]
    ].filter(([, amount]) => amount !== undefined && amount !== null);
    for (const [rateType, amount] of rates) {
      await connection.execute(
        `INSERT INTO pricing_rules (id, parking_lot_id, rate_type, amount, currency, service_fee, tax_rate_percent, is_active)
         VALUES (?, ?, ?, ?, ?, ?, ?, TRUE)`,
        [randomUUID(), listingId, rateType, amount, input.currency, input.serviceFee, input.taxRatePercent]
      );
    }
    for (let weekday = 0; weekday <= 6; weekday += 1) {
      await connection.execute(
        `INSERT INTO parking_availability_rules (id, parking_lot_id, weekday, is_available, opens_at, closes_at)
         VALUES (?, ?, ?, TRUE, ?, ?)`,
        [randomUUID(), listingId, weekday, openingTime, closingTime]
      );
    }
    await audit(connection, req.user.id, 'marketplace.listing_created', 'parking_lot', listingId, { listingKind: 'shared_space', numberSpaces: input.numberSpaces, amenities: input.amenities });
    await connection.commit();
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally { connection.release(); }
  const listings = await fetchListings('l.id = ?', [listingId], 1);
  return res.status(201).json({ listing: listings[0], message: 'Shared parking listing created as a draft. Add photos and submit it for approval.' });
}));

router.get('/listings/:listingId', requireAuth, asyncHandler(async (req, res) => {
  const parsedId = uuidSchema.safeParse(req.params.listingId);
  if (!parsedId.success) return fail(res, 400, 'INVALID_ID', 'The listing identifier is invalid.');
  const [rows] = await pool.execute(`${listingSummarySql} WHERE l.id = ? AND l.listing_kind = 'shared_space' GROUP BY l.id LIMIT 1`, [parsedId.data]);
  const listingRow = rows[0];
  if (!listingRow) return fail(res, 404, 'LISTING_NOT_FOUND', 'The listing was not found.');
  if (listingRow.facility_status !== 'active') {
    const user = req.user;
    if (!user || !(user.roles.includes('admin') || (user.roles.includes('host') && listingRow.owner_user_id === user.id))) {
      return fail(res, 404, 'LISTING_NOT_FOUND', 'The listing was not found.');
    }
  }
  const [photoRows] = await pool.execute('SELECT id, public_url, alt_text, sort_order, created_at FROM parking_listing_photos WHERE parking_lot_id = ? ORDER BY sort_order, created_at', [parsedId.data]);
  const [scheduleRows] = await pool.execute('SELECT id, weekday, is_available, opens_at, closes_at FROM parking_availability_rules WHERE parking_lot_id = ? ORDER BY weekday', [parsedId.data]);
  const [pricingRows] = await pool.execute('SELECT id, rate_type, amount, currency, service_fee, tax_rate_percent, is_active FROM pricing_rules WHERE parking_lot_id = ? ORDER BY is_active DESC, rate_type', [parsedId.data]);
  return res.json({
    listing: mapListing(listingRow),
    photos: photoRows.map(mapPhoto),
    availability: scheduleRows.map(mapSchedule),
    pricingRules: pricingRows.map((row) => ({ id: row.id, rateType: row.rate_type, amount: Number(row.amount), currency: row.currency, serviceFee: Number(row.service_fee), taxRatePercent: Number(row.tax_rate_percent), isActive: Boolean(row.is_active) }))
  });
}));

router.patch('/listings/:listingId', requireAuth, requireRole('host', 'admin'), asyncHandler(async (req, res) => {
  const parsedId = uuidSchema.safeParse(req.params.listingId);
  if (!parsedId.success) return fail(res, 400, 'INVALID_ID', 'The listing identifier is invalid.');
  const access = await getOwnedListing(pool, parsedId.data, req.user);
  if (!access.lot || access.lot.listing_kind !== 'shared_space') return fail(res, 404, 'LISTING_NOT_FOUND', 'The listing was not found.');
  if (!access.allowed) return fail(res, 403, 'FORBIDDEN', 'Only the listing owner or an administrator can edit this listing.');
  const parsed = updateListingSchema.safeParse(req.body);
  if (!parsed.success) return validationFail(res, parsed);
  const mapping = {
    name: 'name', description: 'description', addressLine: 'address_line', city: 'city', region: 'region',
    postalCode: 'postal_code', latitude: 'latitude', longitude: 'longitude', contactPhone: 'contact_phone',
    specialInstructions: 'special_instructions', parkingType: 'parking_type', openingTime: 'opening_time', closingTime: 'closing_time'
  };
  const assignments = [];
  const values = [];
  for (const [field, value] of Object.entries(parsed.data)) {
    if (field === 'amenities') { assignments.push('amenities = ?'); values.push(JSON.stringify(value)); }
    else if (mapping[field]) { assignments.push(`${mapping[field]} = ?`); values.push(value); }
  }
  if (!assignments.length) return fail(res, 400, 'EMPTY_UPDATE', 'Provide at least one field to update.');
  await pool.execute(`UPDATE parking_lots SET ${assignments.join(', ')} WHERE id = ?`, [...values, parsedId.data]);
  await audit(pool, req.user.id, 'marketplace.listing_updated', 'parking_lot', parsedId.data, { fields: Object.keys(parsed.data) });
  const [rows] = await pool.execute(`${listingSummarySql} WHERE l.id = ? GROUP BY l.id LIMIT 1`, [parsedId.data]);
  return res.json({ listing: mapListing(rows[0]), message: 'Listing details saved.' });
}));

router.put('/listings/:listingId/availability', requireAuth, requireRole('host', 'admin'), asyncHandler(async (req, res) => {
  const parsedId = uuidSchema.safeParse(req.params.listingId);
  if (!parsedId.success) return fail(res, 400, 'INVALID_ID', 'The listing identifier is invalid.');
  const access = await getOwnedListing(pool, parsedId.data, req.user);
  if (!access.lot || access.lot.listing_kind !== 'shared_space') return fail(res, 404, 'LISTING_NOT_FOUND', 'The listing was not found.');
  if (!access.allowed) return fail(res, 403, 'FORBIDDEN', 'Only the listing owner or an administrator can edit availability.');
  const parsed = schedulesSchema.safeParse(req.body);
  if (!parsed.success) return validationFail(res, parsed);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    for (const rule of parsed.data.rules) {
      await connection.execute(
        `INSERT INTO parking_availability_rules (id, parking_lot_id, weekday, is_available, opens_at, closes_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE is_available = VALUES(is_available), opens_at = VALUES(opens_at), closes_at = VALUES(closes_at), updated_at = UTC_TIMESTAMP()`,
        [randomUUID(), parsedId.data, rule.weekday, rule.isAvailable ? 1 : 0, rule.isAvailable ? rule.opensAt : null, rule.isAvailable ? rule.closesAt : null]
      );
    }
    await audit(connection, req.user.id, 'marketplace.availability_updated', 'parking_lot', parsedId.data, { rules: parsed.data.rules });
    await connection.commit();
  } catch (error) { await connection.rollback().catch(() => {}); throw error; }
  finally { connection.release(); }
  const [rows] = await pool.execute('SELECT id, weekday, is_available, opens_at, closes_at FROM parking_availability_rules WHERE parking_lot_id = ? ORDER BY weekday', [parsedId.data]);
  return res.json({ availability: rows.map(mapSchedule), message: 'Weekly availability saved.' });
}));

router.post('/listings/:listingId/submit-for-approval', requireAuth, requireRole('host', 'admin'), asyncHandler(async (req, res) => {
  const parsedId = uuidSchema.safeParse(req.params.listingId);
  if (!parsedId.success) return fail(res, 400, 'INVALID_ID', 'The listing identifier is invalid.');
  const access = await getOwnedListing(pool, parsedId.data, req.user);
  if (!access.lot || access.lot.listing_kind !== 'shared_space') return fail(res, 404, 'LISTING_NOT_FOUND', 'The listing was not found.');
  if (!access.allowed) return fail(res, 403, 'FORBIDDEN', 'Only the listing owner or an administrator can submit this listing.');
  if (!['draft', 'paused'].includes(access.lot.facility_status)) return fail(res, 409, 'INVALID_LISTING_STATUS', 'Only a draft or paused listing can be submitted for approval.');
  const [checks] = await pool.execute(
    `SELECT (SELECT COUNT(*) FROM parking_slots WHERE parking_lot_id = ?) AS spaces,
            (SELECT COUNT(*) FROM pricing_rules WHERE parking_lot_id = ? AND rate_type = 'hourly' AND is_active = TRUE) AS hourly_rules,
            (SELECT COUNT(*) FROM parking_availability_rules WHERE parking_lot_id = ?) AS schedule_days,
            (SELECT COUNT(*) FROM parking_listing_photos WHERE parking_lot_id = ?) AS photos`,
    [parsedId.data, parsedId.data, parsedId.data, parsedId.data]
  );
  const check = checks[0];
  if (Number(check.spaces) < 1) return fail(res, 409, 'LISTING_INCOMPLETE', 'Add at least one parking space before submitting.');
  if (Number(check.hourly_rules) < 1) return fail(res, 409, 'LISTING_INCOMPLETE', 'Configure an active hourly price before submitting.');
  if (Number(check.schedule_days) !== 7) return fail(res, 409, 'LISTING_INCOMPLETE', 'Save all seven days of weekly availability before submitting.');
  if (Number(check.photos) < 1) return fail(res, 409, 'LISTING_INCOMPLETE', 'Upload at least one genuine photo of the parking space before submitting.');
  await pool.execute("UPDATE parking_lots SET facility_status = 'pending_approval' WHERE id = ?", [parsedId.data]);
  await audit(pool, req.user.id, 'marketplace.listing_submitted', 'parking_lot', parsedId.data, {});
  return res.json({ message: 'Listing submitted for administrator approval.', facilityStatus: 'pending_approval' });
}));

router.post('/listings/:listingId/photos', requireAuth, requireRole('host', 'admin'), uploadPhotos, asyncHandler(async (req, res) => {
  const parsedId = uuidSchema.safeParse(req.params.listingId);
  if (!parsedId.success) { await removeUploadedFiles(req.files); return fail(res, 400, 'INVALID_ID', 'The listing identifier is invalid.'); }
  const access = await getOwnedListing(pool, parsedId.data, req.user);
  if (!access.lot || access.lot.listing_kind !== 'shared_space') { await removeUploadedFiles(req.files); return fail(res, 404, 'LISTING_NOT_FOUND', 'The listing was not found.'); }
  if (!access.allowed) { await removeUploadedFiles(req.files); return fail(res, 403, 'FORBIDDEN', 'Only the listing owner or an administrator can upload photos.'); }
  const files = req.files ?? [];
  if (!files.length) return fail(res, 400, 'NO_PHOTOS', 'Select at least one image to upload.');
  const [countRows] = await pool.execute('SELECT COUNT(*) AS count FROM parking_listing_photos WHERE parking_lot_id = ?', [parsedId.data]);
  if (Number(countRows[0].count) + files.length > 8) { await removeUploadedFiles(files); return fail(res, 409, 'PHOTO_LIMIT_REACHED', 'A listing can contain at most eight photos. Remove a photo before uploading more.'); }
  for (const file of files) {
    if (!(await isSupportedImage(file.path, file.mimetype))) {
      await removeUploadedFiles(files);
      return fail(res, 415, 'INVALID_IMAGE_CONTENT', 'One of the uploaded files is not a valid JPEG, PNG or WebP image.');
    }
  }
  const created = [];
  try {
    for (const [index, file] of files.entries()) {
      const photoId = randomUUID();
      const publicUrl = `/uploads/marketplace/${file.filename}`;
      await pool.execute(
        'INSERT INTO parking_listing_photos (id, parking_lot_id, storage_name, public_url, alt_text, sort_order, uploaded_by_user_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [photoId, parsedId.data, file.filename, publicUrl, path.basename(file.originalname).slice(0, 180) || 'Parking space photo', Number(countRows[0].count) + index, req.user.id]
      );
      created.push({ id: photoId, publicUrl, altText: path.basename(file.originalname).slice(0, 180) || 'Parking space photo', sortOrder: Number(countRows[0].count) + index });
    }
  } catch (error) {
    await Promise.all(created.map((photo) => pool.execute('DELETE FROM parking_listing_photos WHERE id = ?', [photo.id]).catch(() => {})));
    await removeUploadedFiles(files);
    throw error;
  }
  await audit(pool, req.user.id, 'marketplace.photos_uploaded', 'parking_lot', parsedId.data, { photoCount: created.length });
  return res.status(201).json({ photos: created, message: `${created.length} photo${created.length === 1 ? '' : 's'} uploaded.` });
}));

router.delete('/listings/:listingId/photos/:photoId', requireAuth, requireRole('host', 'admin'), asyncHandler(async (req, res) => {
  const parsedListing = uuidSchema.safeParse(req.params.listingId);
  const parsedPhoto = uuidSchema.safeParse(req.params.photoId);
  if (!parsedListing.success || !parsedPhoto.success) return fail(res, 400, 'INVALID_ID', 'The listing or photo identifier is invalid.');
  const access = await getOwnedListing(pool, parsedListing.data, req.user);
  if (!access.lot || access.lot.listing_kind !== 'shared_space') return fail(res, 404, 'LISTING_NOT_FOUND', 'The listing was not found.');
  if (!access.allowed) return fail(res, 403, 'FORBIDDEN', 'Only the listing owner or an administrator can delete photos.');
  const [rows] = await pool.execute('SELECT id, storage_name FROM parking_listing_photos WHERE id = ? AND parking_lot_id = ? LIMIT 1', [parsedPhoto.data, parsedListing.data]);
  if (!rows.length) return fail(res, 404, 'PHOTO_NOT_FOUND', 'The photo was not found.');
  await pool.execute('DELETE FROM parking_listing_photos WHERE id = ?', [parsedPhoto.data]);
  await unlink(path.join(uploadDir, path.basename(rows[0].storage_name))).catch(() => {});
  await audit(pool, req.user.id, 'marketplace.photo_deleted', 'parking_lot', parsedListing.data, { photoId: parsedPhoto.data });
  return res.json({ message: 'Photo removed.' });
}));

router.get('/earnings/mine', requireAuth, requireRole('host', 'admin'), asyncHandler(async (req, res) => {
  const [rows] = await pool.execute(
    `SELECT he.id, he.booking_id, he.payment_id, he.parking_lot_id, he.gross_amount, he.discount_amount,
            he.platform_fee_amount, he.net_amount, he.currency, he.status, he.settlement_reference, he.settled_at, he.created_at,
            b.booking_code, b.start_at, b.end_at, l.name AS parking_lot_name, p.provider_payment_id
       FROM host_earnings he JOIN bookings b ON b.id = he.booking_id
       JOIN parking_lots l ON l.id = he.parking_lot_id JOIN payments p ON p.id = he.payment_id
      WHERE he.owner_user_id = ? ORDER BY he.created_at DESC LIMIT 200`, [req.user.id]
  );
  const earnings = rows.map((row) => ({ id: row.id, bookingId: row.booking_id, paymentId: row.payment_id,
    parkingLotId: row.parking_lot_id, bookingCode: row.booking_code, parkingLotName: row.parking_lot_name,
    startAt: row.start_at, endAt: row.end_at, grossAmount: Number(row.gross_amount), discountAmount: Number(row.discount_amount),
    platformFeeAmount: Number(row.platform_fee_amount), netAmount: Number(row.net_amount), currency: row.currency,
    status: row.status, settlementReference: row.settlement_reference ?? null, settledAt: row.settled_at ?? null,
    providerPaymentId: row.provider_payment_id ?? null, createdAt: row.created_at }));
  const summary = earnings.reduce((acc, item) => {
    if (!acc[item.currency]) acc[item.currency] = { pending: 0, approved: 0, paid: 0, reversed: 0, totalNet: 0 };
    acc[item.currency][item.status] += item.netAmount;
    if (item.status !== 'reversed') acc[item.currency].totalNet += item.netAmount;
    return acc;
  }, {});
  return res.json({ earnings, summary, settlementEnabled: false, message: 'Earnings reflect verified payments for owned listings. No bank payout is initiated by this report.' });
}));


export default router;
