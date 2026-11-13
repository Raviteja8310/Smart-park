// SmartPark map data service (adapted from the supplied OpenStreetMap module).
// Reads the existing backend's read-only map feed: GET /api/parking/map/locations
// (same-origin, so the Vite dev proxy / production reverse proxy forward it to the API).
// VITE_PARKING_API_URL may override the endpoint; it never contains secrets.
const DEFAULT_URL = '/api/parking/map/locations';
const configuredUrl = () => import.meta.env.VITE_PARKING_API_URL || DEFAULT_URL;

const finiteOrNull = (value) => (value === null || value === undefined || value === '' || !Number.isFinite(Number(value)) ? null : Number(value));

export function normalizeParkingLocation(row, index = 0) {
  return {
    id: row.id ?? `parking-${index}`,
    name: row.name ?? 'Parking facility',
    latitude: Number(row.latitude ?? row.lat),
    longitude: Number(row.longitude ?? row.lng ?? row.lon),
    address: row.address ?? '',
    totalSlots: finiteOrNull(row.totalSlots),
    openSlots: finiteOrNull(row.openSlots),
    availableSlots: finiteOrNull(row.availableSlots),
    occupiedSlots: finiteOrNull(row.occupiedSlots),
    reservedSlots: finiteOrNull(row.reservedSlots),
    unknownSlots: finiteOrNull(row.unknownSlots),
    status: ['available', 'occupied', 'reserved', 'unknown'].includes(row.status) ? row.status : 'unknown',
    pricePerHour: finiteOrNull(row.pricePerHour),
    currency: row.currency || 'INR',
    evCharging: Boolean(row.evCharging),
    ev: row.ev ?? null,
    openingTime: row.openingTime ?? null,
    closingTime: row.closingTime ?? null,
    distanceKm: finiteOrNull(row.distanceKm),
    source: 'smartpark'
  };
}

async function readJson(response) {
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.error?.message || `Parking map service returned HTTP ${response.status}.`);
  if (!payload) throw new Error('The parking map service returned an invalid response.');
  return payload;
}

/** All active SmartPark facilities with coordinates, or those near `origin` when given. */
export async function fetchParkingLocations({ origin = null, radiusKm = null, signal } = {}) {
  const url = new URL(configuredUrl(), window.location.origin);
  if (origin && Number.isFinite(origin.latitude) && Number.isFinite(origin.longitude)) {
    url.searchParams.set('lat', origin.latitude.toFixed(6));
    url.searchParams.set('lng', origin.longitude.toFixed(6));
    if (radiusKm) url.searchParams.set('radiusKm', String(radiusKm));
  }
  const response = await fetch(url, { headers: { Accept: 'application/json' }, credentials: 'same-origin', signal });
  const payload = await readJson(response);
  const rows = Array.isArray(payload) ? payload : payload.data;
  if (!Array.isArray(rows)) throw new Error('The parking map response did not contain a list of locations.');
  return {
    lots: rows.map(normalizeParkingLocation).filter((lot) => Number.isFinite(lot.latitude) && Number.isFinite(lot.longitude)),
    meta: payload.meta ?? {}
  };
}

/** Latest record for one facility (used to refresh a popup). */
export async function fetchParkingLocation(lotId, { signal } = {}) {
  const response = await fetch(`${configuredUrl()}/${encodeURIComponent(lotId)}`, { headers: { Accept: 'application/json' }, credentials: 'same-origin', signal });
  const payload = await readJson(response);
  return normalizeParkingLocation(payload.data ?? payload);
}
