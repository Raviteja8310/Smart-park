/**
 * Read-only map feed for the OpenStreetMap / Leaflet integration.
 *
 *   GET /api/parking/map/locations                      all active facilities with coordinates
 *   GET /api/parking/map/locations?lat=&lng=&radiusKm=  nearby facilities, sorted by distance
 *   GET /api/parking/map/locations/:lotId               one active facility
 *
 * Availability is computed by the SAME SQL the parking and booking flows use
 * (LOT_SUMMARY_SELECT in parking.routes.js), so map counts can never disagree with
 * booking/slot-allocation logic. This router never writes to the database.
 * Like GET /api/parking/lots, these endpoints only expose published (active) facilities
 * and therefore do not require authentication. They are rate limited.
 */
import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../config/database.js';
import { mapLotRow, toNumber } from '../parking/availability.js';
import { createRateLimiter } from '../middleware/rate-limit.js';
import { LOT_SUMMARY_SELECT } from './parking.routes.js';

const router = Router();
const asyncHandler = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
const mapLimiter = createRateLimiter({ windowMs: 60 * 1000, max: 120, keyPrefix: 'parking-map' });
router.use(mapLimiter);

const EARTH_RADIUS_KM = 6371;
const MAX_FACILITIES = 500;

const listQuerySchema = z.object({
  lat: z.coerce.number({ invalid_type_error: 'Latitude must be a number.' }).min(-90, 'Latitude must be between -90 and 90.').max(90, 'Latitude must be between -90 and 90.').optional(),
  lng: z.coerce.number({ invalid_type_error: 'Longitude must be a number.' }).min(-180, 'Longitude must be between -180 and 180.').max(180, 'Longitude must be between -180 and 180.').optional(),
  radiusKm: z.coerce.number({ invalid_type_error: 'Radius must be a number.' }).min(0.1, 'Radius must be at least 0.1 km.').max(100, 'Radius cannot exceed 100 km.').default(10),
  limit: z.coerce.number().int().min(1).max(MAX_FACILITIES).default(200)
}).refine((value) => (value.lat === undefined) === (value.lng === undefined), {
  message: 'Provide both lat and lng, or neither.'
});
const lotIdSchema = z.string().uuid();

function fail(res, status, code, message) {
  return res.status(status).json({ error: { code, message } });
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const rad = (deg) => (deg * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * Marker status, derived only from SmartPark's own slot + booking records:
 *  available – at least one open, empty, unreserved space
 *  occupied  – no free space and physical occupancy is the main reason
 *  reserved  – no free space and active reservations are the main reason
 *  unknown   – no open inventory, or every open space has an unknown sensor state
 */
export function markerStatus(lot) {
  if (lot.openSpaces <= 0) return 'unknown';
  if (lot.availableNow > 0) return 'available';
  if (lot.occupiedNow > 0 && lot.occupiedNow >= lot.reservedNow) return 'occupied';
  if (lot.reservedNow > 0) return 'reserved';
  return 'unknown';
}

async function loadEvSummary(lotIds) {
  if (!lotIds.length) return new Map();
  const placeholders = lotIds.map(() => '?').join(',');
  const [rows] = await pool.execute(
    `SELECT parking_lot_id,
            COUNT(*) AS charger_count,
            COALESCE(SUM(quantity), 0) AS connector_count,
            COALESCE(SUM(CASE WHEN availability_status = 'available' THEN quantity ELSE 0 END), 0) AS available_connectors,
            MAX(power_kw) AS max_power_kw
       FROM ev_chargers
      WHERE is_active = TRUE AND parking_lot_id IN (${placeholders})
      GROUP BY parking_lot_id`,
    lotIds
  );
  return new Map(rows.map((row) => [row.parking_lot_id, {
    chargers: toNumber(row.charger_count),
    connectors: toNumber(row.connector_count),
    availableConnectors: toNumber(row.available_connectors),
    maxPowerKw: row.max_power_kw === null ? null : Number(row.max_power_kw)
  }]));
}

function toMapLocation(lot, ev, distanceKm = null) {
  const counts = {
    totalSlots: lot.totalSpaces,
    openSlots: lot.openSpaces,
    availableSlots: Math.max(0, lot.availableNow),
    occupiedSlots: Math.max(0, lot.occupiedNow),
    reservedSlots: Math.max(0, lot.reservedNow),
    unknownSlots: Math.max(0, lot.unknownSpaces)
  };
  return {
    id: lot.id,
    name: lot.name,
    latitude: lot.latitude,
    longitude: lot.longitude,
    address: [lot.addressLine, lot.city, lot.region, lot.postalCode].filter(Boolean).join(', '),
    addressLine: lot.addressLine,
    city: lot.city,
    ...counts,
    status: markerStatus(lot),
    pricePerHour: lot.hourlyRate,
    currency: lot.currency,
    evCharging: Boolean(ev && ev.connectors > 0),
    ev: ev ?? { chargers: 0, connectors: 0, availableConnectors: 0, maxPowerKw: null },
    facilityStatus: lot.facilityStatus,
    parkingType: lot.parkingType,
    openingTime: lot.openingTime,
    closingTime: lot.closingTime,
    timezone: lot.timezone,
    averageRating: lot.averageRating,
    reviewCount: lot.reviewCount,
    distanceKm: distanceKm === null ? null : Math.round(distanceKm * 100) / 100,
    source: 'smartpark'
  };
}

router.get('/locations', asyncHandler(async (req, res) => {
  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) return fail(res, 400, 'VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Check the map query.');
  const { lat, lng, radiusKm, limit } = parsed.data;
  const hasOrigin = lat !== undefined && lng !== undefined;

  const conditions = ["l.facility_status = 'active'", 'l.latitude IS NOT NULL', 'l.longitude IS NOT NULL'];
  const params = [];
  if (hasOrigin) {
    // Bounding-box pre-filter (index friendly); exact distance is applied below.
    const latDelta = radiusKm / 111.32;
    const lngDelta = radiusKm / (111.32 * Math.max(0.01, Math.cos((lat * Math.PI) / 180)));
    conditions.push('l.latitude BETWEEN ? AND ?', 'l.longitude BETWEEN ? AND ?');
    params.push(lat - latDelta, lat + latDelta, lng - lngDelta, lng + lngDelta);
  }

  const [rows] = await pool.execute(
    `${LOT_SUMMARY_SELECT} WHERE ${conditions.join(' AND ')} GROUP BY l.id ORDER BY l.name LIMIT ${MAX_FACILITIES}`,
    params
  );
  let lots = rows.map(mapLotRow).filter((lot) => Number.isFinite(lot.latitude) && Number.isFinite(lot.longitude));

  let withDistance = lots.map((lot) => ({ lot, distance: hasOrigin ? haversineKm(lat, lng, lot.latitude, lot.longitude) : null }));
  if (hasOrigin) withDistance = withDistance.filter((item) => item.distance <= radiusKm).sort((a, b) => a.distance - b.distance);
  withDistance = withDistance.slice(0, limit);

  const ev = await loadEvSummary(withDistance.map(({ lot }) => lot.id));
  const [[missing]] = await pool.execute(
    "SELECT COUNT(*) AS missing FROM parking_lots WHERE facility_status = 'active' AND (latitude IS NULL OR longitude IS NULL)"
  );

  return res.json({
    data: withDistance.map(({ lot, distance }) => toMapLocation(lot, ev.get(lot.id), distance)),
    meta: {
      count: withDistance.length,
      origin: hasOrigin ? { latitude: lat, longitude: lng, radiusKm } : null,
      activeFacilitiesWithoutCoordinates: toNumber(missing?.missing),
      generatedAt: new Date().toISOString()
    }
  });
}));

router.get('/locations/:lotId', asyncHandler(async (req, res) => {
  const id = lotIdSchema.safeParse(req.params.lotId);
  if (!id.success) return fail(res, 400, 'INVALID_ID', 'The parking facility identifier is invalid.');
  const [rows] = await pool.execute(
    `${LOT_SUMMARY_SELECT} WHERE l.id = ? AND l.facility_status = 'active' GROUP BY l.id`,
    [id.data]
  );
  if (!rows.length) return fail(res, 404, 'LOT_NOT_FOUND', 'The parking facility was not found.');
  const lot = mapLotRow(rows[0]);
  if (!Number.isFinite(lot.latitude) || !Number.isFinite(lot.longitude)) {
    return fail(res, 404, 'LOCATION_UNAVAILABLE', 'This parking facility does not have map coordinates yet.');
  }
  const ev = await loadEvSummary([lot.id]);
  return res.json({ data: toMapLocation(lot, ev.get(lot.id)) });
}));

export default router;
