// Public OpenStreetMap-ecosystem services used by the SmartPark map.
// Usage-policy safeguards:
//  * Nominatim: explicit submit only (no autocomplete), max 1 request/second, results cached.
//  * Overpass:  explicit user action only, radius capped, results cached for 10 minutes.
//  * OSRM demo: explicit user action only, results cached; NOT a production navigation service.
// Every call has a timeout and fails with a readable message so the map keeps working.

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
const OSRM_URL = 'https://router.project-osrm.org/route/v1/driving';
const CACHE_PREFIX = 'smartpark.osm.';
const memoryCache = new Map();
let lastNominatimAt = 0;

export const isValidCoordinate = (lat, lng) =>
  Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;

function readCache(key, ttlMs) {
  const hit = memoryCache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value;
  try {
    const stored = JSON.parse(sessionStorage.getItem(CACHE_PREFIX + key) || 'null');
    if (stored && Date.now() - stored.at < ttlMs) { memoryCache.set(key, stored); return stored.value; }
  } catch { /* storage unavailable or corrupt: fall through to network */ }
  return undefined;
}

function writeCache(key, value) {
  const entry = { at: Date.now(), value };
  memoryCache.set(key, entry);
  try { sessionStorage.setItem(CACHE_PREFIX + key, JSON.stringify(entry)); } catch { /* quota or privacy mode */ }
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => controller.abort();
  options.signal?.addEventListener?.('abort', onAbort);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (options.signal?.aborted) throw error;
    throw new Error(error.name === 'AbortError' ? 'The map service took too long to respond. Please try again.' : 'The map service could not be reached. Check your connection and try again.');
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener?.('abort', onAbort);
  }
}

/** Geocode a place, landmark or address with Nominatim. Returns { latitude, longitude, label } or throws. */
export async function searchPlace(query, { language = 'en', signal } = {}) {
  const text = String(query || '').trim();
  if (text.length < 3) throw new Error('Enter at least 3 characters to search for a place.');
  const key = `place:${language}:${text.toLowerCase()}`;
  const cached = readCache(key, 24 * 60 * 60 * 1000);
  if (cached) return cached;
  const wait = 1100 - (Date.now() - lastNominatimAt);
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  lastNominatimAt = Date.now();
  const url = new URL(NOMINATIM_URL);
  url.search = new URLSearchParams({ q: text, format: 'jsonv2', limit: '1', 'accept-language': language });
  const response = await fetchWithTimeout(url, { headers: { Accept: 'application/json' }, signal });
  if (!response.ok) throw new Error('Place search is temporarily unavailable. Please try again later.');
  const results = await response.json().catch(() => null);
  if (!Array.isArray(results)) throw new Error('Place search returned an unexpected response.');
  if (!results.length) throw new Error('No matching place was found. Try a different name or address.');
  const latitude = Number(results[0].lat);
  const longitude = Number(results[0].lon);
  if (!isValidCoordinate(latitude, longitude)) throw new Error('Place search returned an invalid location.');
  const place = { latitude, longitude, label: results[0].display_name || text };
  writeCache(key, place);
  return place;
}

/** Mapped parking features from OpenStreetMap. These have NO real-time availability. */
export async function findOsmParking({ latitude, longitude }, radiusKm = 2, { signal } = {}) {
  if (!isValidCoordinate(latitude, longitude)) throw new Error('A valid location is required to find nearby mapped parking.');
  const radiusM = Math.round(Math.min(Math.max(radiusKm, 0.2), 5) * 1000);
  const key = `overpass:${latitude.toFixed(3)},${longitude.toFixed(3)}:${radiusM}`;
  const cached = readCache(key, 10 * 60 * 1000);
  if (cached) return cached;
  const query = `[out:json][timeout:20];(node["amenity"="parking"](around:${radiusM},${latitude},${longitude});way["amenity"="parking"](around:${radiusM},${latitude},${longitude}););out center tags 60;`;
  const response = await fetchWithTimeout(OVERPASS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
    body: new URLSearchParams({ data: query }),
    signal
  }, 40000); // the shared public Overpass server can queue requests for 30 s+ under load
  if (!response.ok) throw new Error('OpenStreetMap parking search is busy. Please try again later.');
  const result = await response.json().catch(() => null);
  if (!Array.isArray(result?.elements)) throw new Error('OpenStreetMap parking search returned an unexpected response.');
  const places = result.elements.map((item) => {
    const lat = Number(item.lat ?? item.center?.lat);
    const lng = Number(item.lon ?? item.center?.lon);
    const tags = item.tags || {};
    return {
      id: `osm-${item.type}-${item.id}`,
      name: tags.name || null,
      latitude: lat,
      longitude: lng,
      address: [tags['addr:housenumber'], tags['addr:street'], tags['addr:city']].filter(Boolean).join(', ') || tags['addr:full'] || '',
      access: tags.access || null,
      fee: tags.fee || null,
      capacity: tags.capacity || null,
      osmUrl: `https://www.openstreetmap.org/${item.type}/${item.id}`,
      source: 'osm'
    };
  }).filter((place) => isValidCoordinate(place.latitude, place.longitude));
  writeCache(key, places);
  return places;
}

/** Driving route from OSRM. Coordinates in/out are [latitude, longitude]. */
export async function getDrivingRoute(from, to, { signal } = {}) {
  if (!isValidCoordinate(from?.latitude, from?.longitude) || !isValidCoordinate(to?.latitude, to?.longitude)) {
    throw new Error('Directions need a valid start point and destination.');
  }
  const key = `route:${from.latitude.toFixed(4)},${from.longitude.toFixed(4)}>${to.latitude.toFixed(4)},${to.longitude.toFixed(4)}`;
  const cached = readCache(key, 15 * 60 * 1000);
  if (cached) return cached;
  // OSRM expects longitude,latitude order.
  const url = `${OSRM_URL}/${from.longitude},${from.latitude};${to.longitude},${to.latitude}?overview=full&geometries=geojson`;
  const response = await fetchWithTimeout(url, { headers: { Accept: 'application/json' }, signal });
  if (!response.ok) throw new Error('The routing service is unavailable right now. You can still open directions in your maps app.');
  const data = await response.json().catch(() => null);
  if (data?.code !== 'Ok' || !data.routes?.length) throw new Error('No driving route was found between these points.');
  const route = data.routes[0];
  const coordinates = route.geometry.coordinates.map(([lng, lat]) => [lat, lng]).filter(([lat, lng]) => isValidCoordinate(lat, lng));
  if (coordinates.length < 2) throw new Error('The routing service returned an invalid route.');
  const value = { coordinates, distanceKm: route.distance / 1000, durationMin: Math.max(1, Math.round(route.duration / 60)) };
  writeCache(key, value);
  return value;
}
