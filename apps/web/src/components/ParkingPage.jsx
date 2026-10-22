import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft, ArrowUpRight, Building2, CalendarClock, CarFront, Check, CircleAlert, Clock3,
  Layers3, LoaderCircle, MapPin, Plus, RefreshCw, Search, ShieldCheck,
  SlidersHorizontal, SquareParking, X, Heart, Star, MessageSquareText, LocateFixed, Map, List, Navigation
} from 'lucide-react';

async function apiRequest(path, options = {}) {
  const response = await fetch(path, {
    credentials: 'same-origin',
    ...options,
    headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers ?? {}) }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message ?? 'The request could not be completed.');
  return data;
}

function formatMoney(amount, currency = 'INR') {
  if (amount === null || amount === undefined || Number.isNaN(Number(amount))) return 'Rate not set';
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency, maximumFractionDigits: 2 }).format(Number(amount));
}

function facilityLocation(lot) {
  return [lot.addressLine, lot.city, lot.region].filter(Boolean).join(', ');
}

function facilityStatusLabel(value) {
  return String(value ?? 'unknown').replaceAll('_', ' ');
}

function distanceKm(origin, lot) {
  if (!origin || lot.latitude == null || lot.longitude == null) return null;
  const lat = Number(lot.latitude); const lon = Number(lot.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const radians = (value) => value * Math.PI / 180;
  const dLat = radians(lat - origin.latitude); const dLon = radians(lon - origin.longitude);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(radians(origin.latitude)) * Math.cos(radians(lat)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
}

function hasCoordinates(location) {
  return location?.latitude != null &&
    location?.longitude != null &&
    Number.isFinite(Number(location.latitude)) &&
    Number.isFinite(Number(location.longitude));
}

function osmEmbedUrl(lot) {
  const lat = Number(lot.latitude); const lon = Number(lot.longitude);
  const delta = 0.012;
  const bbox = [lon - delta, lat - delta, lon + delta, lat + delta].join('%2C');
  return `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat}%2C${lon}`;
}

function directionsUrl({ origin, destination, travelMode = 'driving' }) {
  const params = new URLSearchParams({ api: '1', destination, travelmode: travelMode });
  if (origin) params.set('origin', origin);
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

function localPartsInZone(date, timeZone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(date).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  return parts;
}

function defaultBookingStart(timeZone = 'Asia/Kolkata') {
  const value = new Date(Date.now() + 45 * 60 * 1000);
  const parts = localPartsInZone(value, timeZone);
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`
  };
}

function zonedLocalDateTimeToUtc(dateValue, timeValue, timeZone) {
  const dateParts = dateValue.split('-').map(Number);
  const timeParts = timeValue.split(':').map(Number);
  if (dateParts.length !== 3 || timeParts.length < 2 || [...dateParts, ...timeParts].some((part) => !Number.isInteger(part))) {
    throw new Error('Select a valid booking date and start time.');
  }
  const [year, month, day] = dateParts;
  const [hour, minute] = timeParts;
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    throw new Error('Select a valid booking date and start time.');
  }
  const desiredWallTime = Date.UTC(year, month - 1, day, hour, minute, 0);
  let timestamp = desiredWallTime;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const parts = localPartsInZone(new Date(timestamp), timeZone);
    const observedWallTime = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), 0);
    const difference = desiredWallTime - observedWallTime;
    if (difference === 0) break;
    timestamp += difference;
  }
  const result = new Date(timestamp);
  const check = localPartsInZone(result, timeZone);
  if (`${check.year}-${check.month}-${check.day}` !== dateValue || `${check.hour}:${check.minute}` !== timeValue) {
    throw new Error('That local time is not valid in the parking location time zone. Choose another time.');
  }
  return result;
}

function bookingPayload(slotId, startFields, durationHours, vehicleId = null, timeZone = 'Asia/Kolkata') {
  if (!startFields.date || !startFields.time) throw new Error('Select a booking date and start time.');
  const start = zonedLocalDateTimeToUtc(startFields.date, startFields.time, timeZone);
  const end = new Date(start.getTime() + Number(durationHours) * 60 * 60 * 1000);
  return { slotId, vehicleId: vehicleId || null, startAt: start.toISOString(), endAt: end.toISOString() };
}

function StatePill({ state }) {
  const labels = { available: 'Available', occupied: 'Occupied', reserved: 'Reserved', unknown: 'Unknown', disabled: 'Disabled', maintenance: 'Maintenance' };
  return <span className={`sp-state-pill ${state}`}><i />{labels[state] ?? state}</span>;
}

function LotCard({ lot, mode, onOpen, onSubmitForApproval, onSetStatus, isAdmin, canCreate, isFavorite = false, onToggleFavorite, distance = null, userLocation = null }) {
  const hasCoordinates =
    lot.latitude !== null &&
    lot.latitude !== undefined &&
    lot.longitude !== null &&
    lot.longitude !== undefined &&
    Number.isFinite(Number(lot.latitude)) &&
    Number.isFinite(Number(lot.longitude));

  const hasUserLocation = hasCoordinates(userLocation);

  return (
    <article className="sp-lot-card">
      <div className="sp-lot-card-top">
        <div className={`sp-lot-icon ${lot.coverPhoto ? 'has-photo' : ''}`}>{lot.coverPhoto ? <img src={lot.coverPhoto} alt={`${lot.name} parking`} /> : <Building2 size={20} />}</div>
        <div className="sp-lot-top-end">
          {mode === 'discover' && <button type="button" className={`sp-favorite-toggle ${isFavorite ? 'saved' : ''}`} aria-label={isFavorite ? `Remove ${lot.name} from saved parking` : `Save ${lot.name}`} aria-pressed={isFavorite} onClick={() => onToggleFavorite?.(lot)}><Heart size={16} fill={isFavorite ? 'currentColor' : 'none'} /></button>}
          <div className="sp-lot-status-wrap">
            <span className={`sp-facility-status ${lot.facilityStatus ?? 'unknown'}`}>{facilityStatusLabel(lot.facilityStatus)}</span>
            <span className="sp-lot-id">{String(lot.id ?? '').slice(0, 8).toUpperCase()}</span>
          </div>
        </div>
      </div>
      <h3>{lot.name}</h3>
      <div className="sp-lot-rating-line"><Star size={13} fill={Number(lot.averageRating) > 0 ? 'currentColor' : 'none'} />{lot.averageRating === null || lot.averageRating === undefined ? 'No reviews yet' : `${Number(lot.averageRating).toFixed(1)} · ${Number(lot.reviewCount ?? 0)} review${Number(lot.reviewCount ?? 0) === 1 ? '' : 's'}`}</div>
      <p className="sp-lot-address"><MapPin size={14} />{facilityLocation(lot)}</p>
      {distance !== null && <p className="sp-distance-label"><Navigation size={13} /> {distance < 1 ? `${Math.round(distance * 1000)} m away` : `${distance.toFixed(1)} km away`}</p>}
      {lot.description && <p className="sp-lot-description">{lot.description}</p>}
      <div className="sp-lot-metrics">
        <div><strong>{lot.totalSpaces}</strong><span>Total spaces</span></div>
        <div><strong>{lot.availableNow}</strong><span>Available now</span></div>
        <div><strong>{lot.occupiedNow}</strong><span>Occupied</span></div>
      </div>
      <div className="sp-lot-rate"><span>From</span><strong>{formatMoney(lot.hourlyRate, lot.currency)}<small>/ hour</small></strong></div>
      {mode === 'discover' && hasCoordinates && (
        <a
          className="sp-map-link"
          href={directionsUrl({
            origin: hasUserLocation
              ? `${userLocation.latitude},${userLocation.longitude}`
              : undefined,
            destination: `${lot.latitude},${lot.longitude}`
          })}
          target="_blank"
          rel="noreferrer"
        >
          Directions <ArrowUpRight size={14} />
        </a>
      )}
      <div className="sp-lot-card-actions">
        <button className="sp-button primary" onClick={() => onOpen(lot)}>{mode === 'discover' ? 'View parking spaces' : 'Manage spaces'} <ArrowUpRight size={15} /></button>
        {mode === 'manage' && lot.facilityStatus === 'draft' && canCreate && (
          <button className="sp-button secondary" onClick={() => onSubmitForApproval(lot)}>Submit for approval</button>
        )}
        {mode === 'manage' && isAdmin && lot.facilityStatus === 'pending_approval' && (
          <button className="sp-button secondary" onClick={() => onSetStatus(lot, 'active')}>Approve facility</button>
        )}
        {mode === 'manage' && isAdmin && lot.facilityStatus === 'active' && (
          <button className="sp-button ghost" onClick={() => onSetStatus(lot, 'paused')}>Pause</button>
        )}
        {mode === 'manage' && isAdmin && lot.facilityStatus === 'paused' && (
          <button className="sp-button secondary" onClick={() => onSetStatus(lot, 'active')}>Reactivate</button>
        )}
        {mode === 'manage' && isAdmin && lot.facilityStatus !== 'archived' && (
          <button className="sp-button ghost danger" onClick={() => onSetStatus(lot, 'archived')}>Archive facility</button>
        )}
        {mode === 'manage' && isAdmin && lot.facilityStatus === 'archived' && (
          <button className="sp-button secondary" onClick={() => onSetStatus(lot, 'active')}>Restore facility</button>
        )}
      </div>
    </article>
  );
}

export default function ParkingPage({ mode = 'discover', currentUser, onViewBookings, onViewEngagement, initialSearch }) {
  const isManager = mode === 'manage';
  const roles = currentUser?.roles ?? [];
  const isAdmin = roles.includes('admin');
  const canCreateFacility = isAdmin || roles.includes('host');
  const canManageInventory = canCreateFacility || roles.includes('operator');
  const canChangePhysicalState = canManageInventory || roles.includes('attendant');

  const [lots, setLots] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [query, setQuery] = useState('');
  const [city, setCity] = useState('');
  const [submittedQuery, setSubmittedQuery] = useState({ q: '', city: '' });
  const [userLocation, setUserLocation] = useState(null);
  const [locationStatus, setLocationStatus] = useState('');
  const [nearbyOnly, setNearbyOnly] = useState(false);
  const [radiusKm, setRadiusKm] = useState('10');
  const [discoveryView, setDiscoveryView] = useState('list');
  const [activeMapLotId, setActiveMapLotId] = useState('');
  const [arrivalDestination, setArrivalDestination] = useState('');
  const [destinationTravelMode, setDestinationTravelMode] = useState('walking');
  const [favoriteLotIds, setFavoriteLotIds] = useState(() => new Set());
  const [lotReviews, setLotReviews] = useState([]);
  const [lotReviewSummary, setLotReviewSummary] = useState({ averageRating: null, reviewCount: 0 });
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [selectedLot, setSelectedLot] = useState(null);
  const [slots, setSlots] = useState([]);
  const [slotSummary, setSlotSummary] = useState(null);
  const [zones, setZones] = useState([]);
  const [pricingRules, setPricingRules] = useState([]);
  const [pricingForm, setPricingForm] = useState({ rateType: 'hourly', amount: '40', serviceFee: '5', taxRatePercent: '0', slotId: '' });
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [busyAction, setBusyAction] = useState(false);
  const [bookingSlot, setBookingSlot] = useState(null);
  const [vehicles, setVehicles] = useState([]);
  const [bookingVehicleId, setBookingVehicleId] = useState('');
  const [bookingPromoCode, setBookingPromoCode] = useState('');
  const [bookingStart, setBookingStart] = useState(() => defaultBookingStart('Asia/Kolkata'));
  const [bookingDuration, setBookingDuration] = useState('2');
  const [bookingQuote, setBookingQuote] = useState(null);
  const [activeHold, setActiveHold] = useState(null);
  const [bookingBusy, setBookingBusy] = useState(false);
  const [canPurchaseParking, setCanPurchaseParking] = useState(false);
  const [newZoneName, setNewZoneName] = useState('');
  const [newZoneLevel, setNewZoneLevel] = useState('');
  const [newSlotCodes, setNewSlotCodes] = useState('');
  const [newSlotZone, setNewSlotZone] = useState('');
  const [newVehicleType, setNewVehicleType] = useState('any');
  const [newCovered, setNewCovered] = useState(false);
  const [newAccessible, setNewAccessible] = useState(false);
  const [lotForm, setLotForm] = useState({ name: '', description: '', addressLine: '', city: '', region: '', postalCode: '', countryCode: 'IN', latitude: '', longitude: '', openingTime: '06:00', closingTime: '23:00', currency: 'INR' });

  useEffect(() => {
    if (isManager) { setCanPurchaseParking(false); return undefined; }
    let active = true;
    apiRequest('/api/bookings/capabilities').then((data) => {
      if (active) setCanPurchaseParking(Boolean(data.canPurchaseParking));
    }).catch(() => {
      if (active) setCanPurchaseParking(false);
    });
    return () => { active = false; };
  }, [isManager, currentUser?.id]);

  const discoveryLots = useMemo(() => {
    const decorated = lots.map((lot) => ({ lot, distance: distanceKm(userLocation, lot) }));
    let result = nearbyOnly && userLocation ? decorated.filter((item) => item.distance !== null && item.distance <= Number(radiusKm)) : decorated;
    if (userLocation) result = [...result].sort((a, b) => {
      if (a.distance === null) return 1; if (b.distance === null) return -1; return a.distance - b.distance;
    });
    return result;
  }, [lots, userLocation, nearbyOnly, radiusKm]);

  const mapLots = discoveryLots.filter(({ lot }) => hasCoordinates(lot));
  const activeMapLot = mapLots.find(({ lot }) => lot.id === activeMapLotId)?.lot ?? mapLots[0]?.lot ?? null;

  function requestUserLocation() {
    if (!navigator.geolocation) { setLocationStatus('Location services are not supported by this browser.'); return; }
    setLocationStatus('Requesting your location…');
    navigator.geolocation.getCurrentPosition((position) => {
      setUserLocation({ latitude: position.coords.latitude, longitude: position.coords.longitude });
      setNearbyOnly(true); setLocationStatus('Nearby parking is sorted by distance from your current location.');
    }, (geoError) => {
      const messages = { 1: 'Location permission was denied. You can still search by city or address.', 2: 'Your location is currently unavailable. Try again or search by city.', 3: 'Location request timed out. Try again.' };
      setLocationStatus(messages[geoError.code] || 'Unable to determine your location.');
    }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 120000 });
  }

  const reloadLots = useCallback(async (criteria = submittedQuery) => {
    setLoading(true);
    setError('');
    try {
      const queryString = new URLSearchParams();
      if (criteria.q?.trim()) queryString.set('q', criteria.q.trim());
      if (criteria.city?.trim()) queryString.set('city', criteria.city.trim());
      const query = queryString.toString();
      const endpoint = isManager ? '/api/parking/managed-lots' : `/api/parking/lots${query ? `?${query}` : ''}`;
      const data = await apiRequest(endpoint);
      setLots(Array.isArray(data.lots) ? data.lots.filter(Boolean) : []);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }, [isManager, submittedQuery]);

  useEffect(() => { reloadLots(isManager ? { q: '', city: '' } : submittedQuery); }, [isManager, submittedQuery, reloadLots]);

  useEffect(() => {
    if (isManager || !currentUser?.id) { setFavoriteLotIds(new Set()); return undefined; }
    let active = true;
    apiRequest('/api/engagement/favorites/ids').then((data) => {
      if (active) setFavoriteLotIds(new Set(data.ids ?? []));
    }).catch(() => { /* Saving is optional if migration 011 has not been applied yet. */ });
    return () => { active = false; };
  }, [isManager, currentUser?.id]);

  useEffect(() => {
    if (!initialSearch?.nonce || isManager) return;
    const criteria = { q: initialSearch.q ?? '', city: initialSearch.city ?? '' };
    setQuery(criteria.q);
    setCity(criteria.city);
    setSubmittedQuery(criteria);
  }, [initialSearch?.nonce, isManager]);

  async function toggleFavorite(lot) {
    const isSaved = favoriteLotIds.has(lot.id);
    setError(''); setNotice('');
    try {
      if (isSaved) {
        await apiRequest(`/api/engagement/favorites/${lot.id}`, { method: 'DELETE' });
        setFavoriteLotIds((current) => { const next = new Set(current); next.delete(lot.id); return next; });
        setNotice(`Removed ${lot.name} from saved parking.`);
      } else {
        await apiRequest(`/api/engagement/favorites/${lot.id}`, { method: 'POST', body: JSON.stringify({}) });
        setFavoriteLotIds((current) => new Set([...current, lot.id]));
        setNotice(`Saved ${lot.name} to your parking favourites.`);
      }
    } catch (requestError) { setError(requestError.message || 'Unable to update saved parking.'); }
  }

  function handleSearchSubmit(event) {
    event.preventDefault();
    const criteria = { q: query.trim(), city: city.trim() };
    setSubmittedQuery(criteria);
    if (criteria.q || criteria.city) {
      apiRequest('/api/engagement/search-history', { method: 'POST', body: JSON.stringify(criteria) }).catch(() => { /* Search still works if history has not been migrated yet. */ });
    }
  }

  useEffect(() => {
    let active = true;
    apiRequest('/api/vehicles/mine')
      .then((data) => {
        if (!active) return;
        const list = data.vehicles ?? [];
        setVehicles(list);
        setBookingVehicleId((current) => current || list.find((vehicle) => vehicle.isDefault)?.id || list[0]?.id || '');
      })
      .catch(() => { /* Vehicle selection is optional; booking validation remains server-side. */ });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (bookingVehicleId || !vehicles.length) return;
    setBookingVehicleId(vehicles.find((vehicle) => vehicle.isDefault)?.id || vehicles[0].id);
  }, [vehicles, bookingVehicleId]);

  const loadLotDetails = useCallback(async (lot) => {
    setSelectedLot(lot);
    setLoadingDetails(true);
    setError('');
    setNotice('');
    try {
      const [lotData, slotData, zoneData, pricingData, reviewsData] = await Promise.all([
        apiRequest(`/api/parking/lots/${lot.id}`),
        apiRequest(`/api/parking/lots/${lot.id}/slots`),
        apiRequest(`/api/parking/lots/${lot.id}/zones`),
        apiRequest(`/api/parking/lots/${lot.id}/pricing`),
        isManager ? Promise.resolve(null) : apiRequest(`/api/engagement/lots/${lot.id}/reviews?limit=5`).catch(() => null)
      ]);
      setSelectedLot(lotData.lot ?? lot);
      setSlots(slotData.slots ?? []);
      setSlotSummary(slotData.summary ?? null);
      setZones(zoneData.zones ?? []);
      setPricingRules(pricingData.pricingRules ?? []);
      setLotReviews(reviewsData?.reviews ?? []);
      setLotReviewSummary(reviewsData?.summary ?? { averageRating: lot.averageRating ?? null, reviewCount: lot.reviewCount ?? 0 });
      setNewSlotZone(zoneData.zones?.[0]?.id ?? '');
    } catch (requestError) {
      setError(requestError.message);
      setSlots([]);
      setSlotSummary(null);
      setZones([]);
      setPricingRules([]);
      setLotReviews([]);
      setLotReviewSummary({ averageRating: null, reviewCount: 0 });
    } finally {
      setLoadingDetails(false);
    }
  }, []);

  const updateLotForm = (event) => setLotForm((previous) => ({ ...previous, [event.target.name]: event.target.value }));

  async function createLot(event) {
    event.preventDefault();
    setBusyAction(true);
    setError('');
    setNotice('');
    try {
      const payload = {
        ...lotForm,
        latitude: lotForm.latitude.trim() ? Number(lotForm.latitude) : null,
        longitude: lotForm.longitude.trim() ? Number(lotForm.longitude) : null,
        openingTime: lotForm.openingTime || null,
        closingTime: lotForm.closingTime || null,
        description: lotForm.description || null,
        region: lotForm.region || null,
        postalCode: lotForm.postalCode || null,
        countryCode: lotForm.countryCode || null
      };
      const data = await apiRequest('/api/parking/lots', { method: 'POST', body: JSON.stringify(payload) });
      setNotice(`Facility “${data.lot.name}” was created as a draft.`);
      setShowCreateForm(false);
      setLotForm({ name: '', description: '', addressLine: '', city: '', region: '', postalCode: '', countryCode: 'IN', latitude: '', longitude: '', openingTime: '06:00', closingTime: '23:00', currency: 'INR' });
      await reloadLots({ q: '', city: '' });
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusyAction(false);
    }
  }

  async function submitForApproval(lot) {
    setBusyAction(true); setError(''); setNotice('');
    try {
      await apiRequest(`/api/parking/lots/${lot.id}/submit-for-approval`, { method: 'POST', body: JSON.stringify({}) });
      setNotice('Facility submitted for administrator approval.');
      setSelectedLot((current) => current?.id === lot.id ? { ...current, facilityStatus: 'pending_approval' } : current);
      await reloadLots({ q: '', city: '' });
    } catch (requestError) { setError(requestError.message); }
    finally { setBusyAction(false); }
  }

  async function setFacilityStatus(lot, facilityStatus) {
    if (facilityStatus === 'archived' && !window.confirm(`Archive ${lot.name}? It will no longer be offered as an active facility. Existing booking and financial history will be retained.`)) return;
    setBusyAction(true); setError(''); setNotice('');
    try {
      await apiRequest(`/api/parking/lots/${lot.id}/status`, { method: 'PATCH', body: JSON.stringify({ facilityStatus }) });
      setNotice(`Facility status changed to ${facilityStatus.replaceAll('_', ' ')}.`);
      await reloadLots({ q: '', city: '' });
      if (selectedLot?.id === lot.id) setSelectedLot((old) => ({ ...old, facilityStatus }));
    } catch (requestError) { setError(requestError.message); }
    finally { setBusyAction(false); }
  }

  async function createZone(event) {
    event.preventDefault();
    if (!selectedLot) return;
    setBusyAction(true); setError(''); setNotice('');
    try {
      await apiRequest(`/api/parking/lots/${selectedLot.id}/zones`, { method: 'POST', body: JSON.stringify({ name: newZoneName, levelLabel: newZoneLevel || null }) });
      setNewZoneName(''); setNewZoneLevel('');
      const data = await apiRequest(`/api/parking/lots/${selectedLot.id}/zones`);
      setZones(data.zones ?? []);
      setNotice('Parking zone created.');
    } catch (requestError) { setError(requestError.message); }
    finally { setBusyAction(false); }
  }

  async function createSlots(event) {
    event.preventDefault();
    if (!selectedLot) return;
    const codes = newSlotCodes.split(/[\s,;]+/).map((code) => code.trim()).filter(Boolean);
    if (!codes.length) { setError('Enter one or more slot codes, separated by commas or spaces.'); return; }
    setBusyAction(true); setError(''); setNotice('');
    try {
      const data = await apiRequest(`/api/parking/lots/${selectedLot.id}/slots/bulk`, {
        method: 'POST',
        body: JSON.stringify({ codes, zoneId: newSlotZone || null, vehicleType: newVehicleType, covered: newCovered, accessible: newAccessible })
      });
      setNotice(data.message ?? `${data.createdCount} spaces created.`);
      setNewSlotCodes('');
      const [slotData, lotData] = await Promise.all([
        apiRequest(`/api/parking/lots/${selectedLot.id}/slots`),
        apiRequest(`/api/parking/lots/${selectedLot.id}`)
      ]);
      setSlots(slotData.slots ?? []); setSlotSummary(slotData.summary ?? null); setSelectedLot(lotData.lot ?? selectedLot);
      await reloadLots({ q: '', city: '' });
    } catch (requestError) { setError(requestError.message); }
    finally { setBusyAction(false); }
  }

  async function createPricingRule(event) {
    event.preventDefault();
    if (!selectedLot) return;
    setBusyAction(true); setError(''); setNotice('');
    try {
      const payload = {
        rateType: pricingForm.rateType,
        amount: Number(pricingForm.amount),
        serviceFee: Number(pricingForm.serviceFee || 0),
        taxRatePercent: Number(pricingForm.taxRatePercent || 0),
        slotId: pricingForm.slotId || null
      };
      const data = await apiRequest(`/api/parking/lots/${selectedLot.id}/pricing`, { method: 'POST', body: JSON.stringify(payload) });
      setPricingRules((old) => [data.pricingRule, ...old.filter((rule) => !(rule.rateType === data.pricingRule.rateType && rule.slotId === data.pricingRule.slotId && rule.isActive))]);
      setNotice(`The ${data.pricingRule.rateType} pricing rule is now active.`);
    } catch (requestError) { setError(requestError.message || 'Unable to save the pricing rule.'); }
    finally { setBusyAction(false); }
  }

  async function updateSlot(slot, patch) {
    setError(''); setNotice('');
    try {
      await apiRequest(`/api/parking/slots/${slot.id}`, { method: 'PATCH', body: JSON.stringify(patch) });
      const data = await apiRequest(`/api/parking/lots/${slot.parkingLotId}/slots`);
      setSlots(data.slots ?? []); setSlotSummary(data.summary ?? null);
      setNotice(`${slot.code} updated.`);
      await reloadLots({ q: '', city: '' });
    } catch (requestError) { setError(requestError.message); }
  }

  function openBooking(slot) {
    setBookingSlot(slot);
    setBookingStart(defaultBookingStart(selectedLot?.timezone || 'Asia/Kolkata'));
    setBookingDuration('2');
    setBookingVehicleId(vehicles.find((vehicle) => vehicle.isDefault)?.id || vehicles[0]?.id || '');
    setBookingPromoCode('');
    setBookingQuote(null);
    setActiveHold(null);
    setError('');
    setNotice('');
  }

  async function requestBookingQuote() {
    if (!bookingSlot) return;
    setBookingBusy(true); setError(''); setNotice(''); setBookingQuote(null);
    try {
      const payload = { ...bookingPayload(bookingSlot.id, bookingStart, bookingDuration, bookingVehicleId, selectedLot?.timezone || 'Asia/Kolkata'), promoCode: bookingPromoCode.trim() || undefined };
      const data = await apiRequest('/api/bookings/quote', { method: 'POST', body: JSON.stringify(payload) });
      setBookingQuote(data);
    } catch (requestError) { setError(requestError.message || 'Unable to calculate the booking price.'); }
    finally { setBookingBusy(false); }
  }

  async function createBookingHold() {
    if (!bookingSlot || !bookingQuote) return;
    setBookingBusy(true); setError(''); setNotice('');
    try {
      const payload = { ...bookingPayload(bookingSlot.id, bookingStart, bookingDuration, bookingVehicleId, selectedLot?.timezone || 'Asia/Kolkata'), promoCode: bookingPromoCode.trim() || undefined };
      const data = await apiRequest('/api/bookings', { method: 'POST', body: JSON.stringify(payload) });
      setActiveHold(data.booking);
      setBookingQuote(null);
      setNotice(`Temporary hold ${data.booking.bookingCode} created. Payment is not complete.`);
      const [slotData, lotData] = await Promise.all([
        apiRequest(`/api/parking/lots/${selectedLot.id}/slots`),
        apiRequest(`/api/parking/lots/${selectedLot.id}`)
      ]);
      setSlots(slotData.slots ?? []); setSlotSummary(slotData.summary ?? null); setSelectedLot(lotData.lot ?? selectedLot);
      await reloadLots({ q: '', city: '' });
    } catch (requestError) { setError(requestError.message || 'Unable to reserve this space.'); }
    finally { setBookingBusy(false); }
  }

  const availableSlots = useMemo(() => slots.filter((slot) => slot.availabilityState === 'available').length, [slots]);

  if (selectedLot) {
    return (
      <section className="sp-page">
        <div className="sp-page-heading">
          <button className="sp-back-button" onClick={() => { setSelectedLot(null); setSlots([]); setZones([]); setError(''); setNotice(''); reloadLots({ q: '', city: '' }); }}><ArrowLeft size={16} /> Back to {isManager ? 'managed facilities' : 'parking results'}</button>
          <div className="sp-heading-title-row"><div><p className="sp-kicker">{isManager ? 'FACILITY INVENTORY' : 'PARKING DETAILS'}</p><h1>{selectedLot.name}</h1><p>{facilityLocation(selectedLot)}</p></div><span className={`sp-facility-status ${selectedLot.facilityStatus ?? 'unknown'}`}>{facilityStatusLabel(selectedLot.facilityStatus)}</span></div>
        </div>

        {!isManager && !canPurchaseParking && <div className="sp-owner-driver-booking-note"><ShieldCheck size={17}/><span><strong>Online booking is temporarily unavailable.</strong> You can still browse parking spaces, view availability and prices, and use maps and directions.</span></div>}
        {!isManager && canPurchaseParking && (currentUser?.roles ?? []).includes('host') && <div className="sp-owner-driver-booking-note"><CarFront size={17}/><span><strong>Facility owner tip</strong> You can book parking as a driver too—including an available space at an approved facility you own. Choose a vehicle and use the normal price and reservation flow.</span></div>}

      {error && <div className="sp-alert error"><CircleAlert size={17} /><span>{error}</span><button onClick={() => setError('')} aria-label="Dismiss error"><X size={14} /></button></div>}
        {notice && <div className="sp-alert success"><Check size={17} /><span>{notice}</span><button onClick={() => setNotice('')} aria-label="Dismiss notice"><X size={14} /></button></div>}

        {bookingSlot && !isManager && <article className="sp-panel sp-booking-builder">
          <div className="sp-panel-header"><div><p className="sp-kicker">RESERVE A SPACE</p><h2>{bookingSlot.code} · {selectedLot.name}</h2><p>Choose your arrival time and duration to get a server-calculated price. Times use {selectedLot.timezone || 'Asia/Kolkata'}.</p></div><button className="sp-button ghost" onClick={() => { setBookingSlot(null); setBookingQuote(null); setActiveHold(null); }}><X size={14} /> Close</button></div>
          {activeHold ? <div className="sp-hold-confirmation">
            <div className="sp-hold-check"><Check size={20} /></div>
            <div><strong>Temporary reservation created</strong><p>Booking code: <b>{activeHold.bookingCode}</b></p><p>Hold expires: {activeHold.holdExpiresAt ? new Date(activeHold.holdExpiresAt).toLocaleString() : 'in approximately 10 minutes'}</p><small>This is an unpaid temporary hold. It becomes confirmed only after the payment provider verifies checkout.</small></div>
            <button className="sp-button primary" onClick={() => onViewBookings?.()}>View my bookings <ArrowUpRight size={14} /></button>
          </div> : <>
            <div className="sp-booking-form-grid">
              <label>Start date<input type="date" value={bookingStart.date} min={defaultBookingStart(selectedLot.timezone || 'Asia/Kolkata').date} onChange={(event) => { setBookingStart((old) => ({ ...old, date: event.target.value })); setBookingQuote(null); }} required /></label>
              <label>Start time<input type="time" value={bookingStart.time} onChange={(event) => { setBookingStart((old) => ({ ...old, time: event.target.value })); setBookingQuote(null); }} required /></label>
              <label>Duration<select value={bookingDuration} onChange={(event) => { setBookingDuration(event.target.value); setBookingQuote(null); }}><option value="1">1 hour</option><option value="2">2 hours</option><option value="3">3 hours</option><option value="4">4 hours</option><option value="8">8 hours</option><option value="24">24 hours</option><option value="48">2 days</option><option value="168">7 days</option></select></label>
              <label>Vehicle <span className="sp-optional">Optional</span><select value={bookingVehicleId} onChange={(event) => { setBookingVehicleId(event.target.value); setBookingQuote(null); }}><option value="">No vehicle selected</option>{vehicles.filter((vehicle) => bookingSlot.vehicleType === 'any' || vehicle.vehicleType === bookingSlot.vehicleType).map((vehicle) => <option key={vehicle.id} value={vehicle.id}>{vehicle.registrationNumber} · {[vehicle.make, vehicle.model].filter(Boolean).join(' ') || vehicle.vehicleType}</option>)}</select></label>
              <label>Promotion code <span className="sp-optional">Optional</span><input value={bookingPromoCode} onChange={(event) => { setBookingPromoCode(event.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 32)); setBookingQuote(null); }} placeholder="e.g. WELCOME10" autoComplete="off" /></label>
            </div>
            {!vehicles.length && <p className="sp-form-hint">You can add vehicles under My vehicles. Adding a vehicle helps parking staff match your reservation.</p>}
            <div className="sp-booking-builder-actions"><p>Holds expire after 10 minutes. Once held, open My bookings to continue to secure checkout.</p><button className="sp-button primary" onClick={requestBookingQuote} disabled={bookingBusy}><CalendarClock size={15} /> {bookingBusy ? 'Calculating…' : 'Check price'}</button></div>
            {bookingQuote && <div className="sp-quote-card">
              <div className="sp-quote-header"><div><span>Price estimate</span><strong>{formatMoney(bookingQuote.quote.totalAmount, bookingQuote.quote.currency)}</strong></div><span className="sp-quote-rate">{bookingQuote.quote.rateType} rate · {bookingQuote.quote.units} unit(s)</span></div>
              <div className="sp-quote-line"><span>Parking charge</span><strong>{formatMoney(bookingQuote.quote.baseAmount, bookingQuote.quote.currency)}</strong></div>
              <div className="sp-quote-line"><span>Service fee</span><strong>{formatMoney(bookingQuote.quote.serviceFee, bookingQuote.quote.currency)}</strong></div>
              <div className="sp-quote-line"><span>Tax ({bookingQuote.quote.taxRatePercent}%)</span><strong>{formatMoney(bookingQuote.quote.taxAmount, bookingQuote.quote.currency)}</strong></div>
              {Number(bookingQuote.quote.discountAmount) > 0 && <div className="sp-quote-line"><span>Promotion {bookingQuote.quote.promotion?.code ? `(${bookingQuote.quote.promotion.code})` : ''}</span><strong>−{formatMoney(bookingQuote.quote.discountAmount, bookingQuote.quote.currency)}</strong></div>}
              <div className="sp-quote-total"><span>Total due at checkout</span><strong>{formatMoney(bookingQuote.quote.totalAmount, bookingQuote.quote.currency)}</strong></div>
              <button className="sp-button primary" onClick={createBookingHold} disabled={bookingBusy}><Check size={15} /> {bookingBusy ? 'Reserving…' : 'Hold this parking space'}</button>
            </div>}
          </>}
        </article>}

        {loadingDetails ? <div className="sp-loading"><LoaderCircle className="sp-spin" size={20} /> Loading parking inventory…</div> : <>
          <div className="sp-detail-stats">
            <div><span>Total spaces</span><strong>{slotSummary?.total ?? selectedLot.totalSpaces ?? 0}</strong></div>
            <div><span>Available now</span><strong className="green-text">{slotSummary?.available ?? selectedLot.availableNow ?? 0}</strong></div>
            <div><span>Occupied</span><strong className="red-text">{slotSummary?.occupied ?? selectedLot.occupiedNow ?? 0}</strong></div>
            <div><span>Unknown status</span><strong>{slotSummary?.unknown ?? selectedLot.unknownSpaces ?? 0}</strong></div>
          </div>

          {(selectedLot.listingKind === 'shared_space' || selectedLot.amenities?.length || selectedLot.specialInstructions || selectedLot.contactPhone) && <article className="sp-panel sp-shared-listing-information"><div className="sp-panel-header"><div><p className="sp-kicker">PARKING LISTING</p><h2>{selectedLot.listingKind === 'shared_space' ? 'Shared parking space' : 'Facility details'}</h2><p>{selectedLot.parkingType ? selectedLot.parkingType.replaceAll('_', ' ') : 'Parking facility'}{selectedLot.contactPhone ? ` · Contact ${selectedLot.contactPhone}` : ''}</p></div>{selectedLot.coverPhoto && <img className="sp-shared-cover" src={selectedLot.coverPhoto} alt={`${selectedLot.name} parking`} />}</div>{selectedLot.amenities?.length > 0 && <div className="sp-shared-amenities">{selectedLot.amenities.map((amenity) => <span key={amenity}>{amenity.replaceAll(/([A-Z])/g, ' $1').replace(/^./, (char) => char.toUpperCase())}</span>)}</div>}{selectedLot.specialInstructions && <p className="sp-shared-instructions">{selectedLot.specialInstructions}</p>}</article>}

          {!isManager && <article className="sp-panel sp-lot-reviews-panel">
            <div className="sp-panel-header"><div><p className="sp-kicker">VERIFIED DRIVER FEEDBACK</p><h2>Reviews {lotReviewSummary.reviewCount > 0 ? `· ${lotReviewSummary.reviewCount}` : ''}</h2><p>{lotReviewSummary.averageRating === null ? 'No reviews yet. Completed visitors can share their experience.' : `${Number(lotReviewSummary.averageRating).toFixed(1)} out of 5 based on completed SmartPark bookings.`}</p></div><div className="sp-lot-rating-summary"><Star size={18} fill={lotReviewSummary.averageRating ? 'currentColor' : 'none'} /> <strong>{lotReviewSummary.averageRating === null ? '—' : Number(lotReviewSummary.averageRating).toFixed(1)}</strong></div></div>
            {lotReviews.length ? <div className="sp-lot-review-list">{lotReviews.map((review) => <article className="sp-lot-review-item" key={review.id}><div className="sp-lot-review-item-heading"><strong>{review.reviewerName}</strong><span><Star size={12} fill="currentColor" /> {review.rating}/5</span><small>{new Date(review.createdAt).toLocaleDateString()}</small></div>{review.title && <h3>{review.title}</h3>}<p>{review.text}</p></article>)}</div> : <div className="sp-review-empty"><MessageSquareText size={17} /><span>No published reviews yet.</span></div>}
            <div className="sp-review-footer"><span>Only completed bookings can post a review.</span><button className="sp-button secondary" onClick={() => onViewEngagement?.()}>Write a review <ArrowUpRight size={14} /></button></div>
          </article>}

          <article className="sp-panel">
            <div className="sp-panel-header"><div><p className="sp-kicker">SPACE MAP</p><h2>Parking spaces</h2><p>Unknown spaces are never advertised as available.</p></div><button className="sp-button ghost" onClick={() => loadLotDetails(selectedLot)}><RefreshCw size={14} /> Refresh</button></div>
            {slots.length ? <div className="sp-slot-grid">{slots.map((slot) => (
              <article className={`sp-slot-card ${slot.availabilityState}`} key={slot.id}>
                <div className="sp-slot-card-heading"><strong>{slot.code}</strong><StatePill state={slot.availabilityState} /></div>
                <small>{slot.zoneName || 'Unassigned zone'} · {slot.vehicleType === 'any' ? 'Any vehicle' : slot.vehicleType}</small>
                <div className="sp-slot-features">{slot.covered && <span>Covered</span>}{slot.accessible && <span>Accessible</span>}</div>
                {isManager && canChangePhysicalState && <label className="sp-inline-control"><span>Physical state</span><select value={slot.physicalState} onChange={(event) => updateSlot(slot, { physicalState: event.target.value })}><option value="unknown">Unknown</option><option value="empty">Empty</option><option value="occupied">Occupied</option></select></label>}
                {isManager && canManageInventory && <label className="sp-inline-control"><span>Operational status</span><select value={slot.operationalStatus} onChange={(event) => updateSlot(slot, { operationalStatus: event.target.value })}><option value="open">Open</option><option value="disabled">Disabled</option><option value="maintenance">Maintenance</option></select></label>}
                {slot.physicalStateUpdatedAt && <small className="sp-updated-at">Updated {new Date(slot.physicalStateUpdatedAt).toLocaleString()}</small>}
                {!isManager && canPurchaseParking && slot.operationalStatus === 'open' && <button className="sp-button secondary sp-slot-book-button" onClick={() => openBooking(slot)}>{slot.availabilityState === 'available' ? 'Choose time' : 'Check another time'}</button>}
              </article>
            ))}</div> : <div className="sp-empty-state"><SquareParking size={28} /><strong>No parking spaces configured yet</strong><span>Create zones and spaces to set up this facility's inventory.</span></div>}
          </article>

          {isManager && canManageInventory && (
            <div className="sp-management-grid">
              <article className="sp-panel">
                <div className="sp-panel-header"><div><p className="sp-kicker">ORGANIZATION</p><h2>Parking zones</h2><p>Group spaces by floor, level or area.</p></div><Layers3 size={19} /></div>
                <div className="sp-zone-list">{zones.map((zone) => <div className="sp-zone-row" key={zone.id}><div><strong>{zone.name}</strong><small>{zone.levelLabel || 'Level not specified'}</small></div><span>{slots.filter((slot) => slot.zoneId === zone.id).length} spaces</span></div>)}{zones.length === 0 && <p className="sp-muted">No zones created yet.</p>}</div>
                <form className="sp-form" onSubmit={createZone}>
                  <label>Zone name<input value={newZoneName} onChange={(event) => setNewZoneName(event.target.value)} required maxLength={80} placeholder="e.g. Level 1 - North" /></label>
                  <label>Level label <span className="sp-optional">Optional</span><input value={newZoneLevel} onChange={(event) => setNewZoneLevel(event.target.value)} maxLength={40} placeholder="e.g. Ground floor" /></label>
                  <button className="sp-button primary" disabled={busyAction}><Plus size={15} /> Add zone</button>
                </form>
              </article>

              <article className="sp-panel">
                <div className="sp-panel-header"><div><p className="sp-kicker">INVENTORY SETUP</p><h2>Add spaces in bulk</h2><p>New spaces start with unknown physical status.</p></div><Plus size={19} /></div>
                <form className="sp-form" onSubmit={createSlots}>
                  <label>Slot codes<input value={newSlotCodes} onChange={(event) => setNewSlotCodes(event.target.value)} required placeholder="A-01, A-02, A-03" /></label>
                  <small className="sp-form-hint">Use commas, spaces or new lines. Up to 100 spaces per operation.</small>
                  <label>Zone<select value={newSlotZone} onChange={(event) => setNewSlotZone(event.target.value)}><option value="">No zone</option>{zones.map((zone) => <option key={zone.id} value={zone.id}>{zone.name}</option>)}</select></label>
                  <label>Vehicle type<select value={newVehicleType} onChange={(event) => setNewVehicleType(event.target.value)}><option value="any">Any vehicle</option><option value="motorcycle">Motorcycle</option><option value="car">Car</option><option value="suv">SUV</option><option value="van">Van</option><option value="truck">Truck</option><option value="other">Other</option></select></label>
                  <div className="sp-checkbox-row"><label><input type="checkbox" checked={newCovered} onChange={(event) => setNewCovered(event.target.checked)} /> Covered</label><label><input type="checkbox" checked={newAccessible} onChange={(event) => setNewAccessible(event.target.checked)} /> Accessible</label></div>
                  <button className="sp-button primary" disabled={busyAction}><Plus size={15} /> Create parking spaces</button>
                </form>
              </article>
              <article className="sp-panel">
                <div className="sp-panel-header"><div><p className="sp-kicker">PRICING</p><h2>Rates and fees</h2><p>Configure active hourly, daily, weekly or monthly rates. New rules replace the active rule for the same rate type and scope.</p></div><CalendarClock size={19} /></div>
                <div className="sp-pricing-rule-list">
                  {pricingRules.filter((rule) => rule.isActive).map((rule) => <div className="sp-pricing-rule-row" key={rule.id}><div><strong>{rule.rateType.charAt(0).toUpperCase() + rule.rateType.slice(1)}</strong><small>{rule.slotCode ? `Only ${rule.slotCode}` : 'All spaces'} · Fee {formatMoney(rule.serviceFee, rule.currency)} · Tax {rule.taxRatePercent}%</small></div><b>{formatMoney(rule.amount, rule.currency)} <small>/ {rule.rateType === 'hourly' ? 'hour' : rule.rateType === 'daily' ? 'day' : rule.rateType === 'weekly' ? 'week' : 'month'}</small></b></div>)}
                  {!pricingRules.some((rule) => rule.isActive) && <p className="sp-muted">No active pricing yet. Add a rate before accepting bookings.</p>}
                </div>
                <form className="sp-form" onSubmit={createPricingRule}>
                  <div className="sp-form-grid">
                    <label>Rate type<select value={pricingForm.rateType} onChange={(event) => setPricingForm((old) => ({ ...old, rateType: event.target.value }))}><option value="hourly">Hourly</option><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option></select></label>
                    <label>Amount ({selectedLot.currency})<input type="number" min="0" max="10000000" step="0.01" required value={pricingForm.amount} onChange={(event) => setPricingForm((old) => ({ ...old, amount: event.target.value }))} /></label>
                    <label>Service fee<input type="number" min="0" max="1000000" step="0.01" value={pricingForm.serviceFee} onChange={(event) => setPricingForm((old) => ({ ...old, serviceFee: event.target.value }))} /></label>
                    <label>Tax rate (%)<input type="number" min="0" max="100" step="0.01" value={pricingForm.taxRatePercent} onChange={(event) => setPricingForm((old) => ({ ...old, taxRatePercent: event.target.value }))} /></label>
                    <label className="sp-span-full">Scope<select value={pricingForm.slotId} onChange={(event) => setPricingForm((old) => ({ ...old, slotId: event.target.value }))}><option value="">All spaces in this facility</option>{slots.map((slot) => <option key={slot.id} value={slot.id}>Only {slot.code}</option>)}</select></label>
                  </div>
                  <button className="sp-button primary" disabled={busyAction}><Plus size={15} /> Save pricing rule</button>
                </form>
              </article>
            </div>
          )}
          {isManager && canCreateFacility && selectedLot.facilityStatus === 'draft' && <div className="sp-submit-note"><ShieldCheck size={18} /><div><strong>This facility is still a draft.</strong><p>Submit it for administrator approval before it becomes visible in public parking search.</p></div><button className="sp-button primary" disabled={busyAction} onClick={() => submitForApproval(selectedLot)}>Submit for approval</button></div>}
          {isManager && isAdmin && selectedLot.facilityStatus === 'pending_approval' && <div className="sp-submit-note"><ShieldCheck size={18} /><div><strong>Awaiting approval</strong><p>Approve this facility to publish it in parking discovery.</p></div><button className="sp-button primary" disabled={busyAction} onClick={() => setFacilityStatus(selectedLot, 'active')}>Approve facility</button></div>}
          <div className="sp-detail-footer"><span><Clock3 size={14} /> {selectedLot.openingTime ?? 'Opening time unset'} – {selectedLot.closingTime ?? 'Closing time unset'}</span><span>Hourly rate: {formatMoney(selectedLot.hourlyRate, selectedLot.currency)}</span><span>{availableSlots} slots ready for booking now</span></div>
        </>}
      </section>
    );
  }

  return (
    <section className="sp-page">
      <div className="sp-page-heading">
        <div className="sp-heading-title-row"><div><p className="sp-kicker">{isManager ? 'FACILITY WORKSPACE' : 'PARKING DISCOVERY'}</p><h1>{isManager ? 'Parking spaces' : 'Find parking'}</h1><p>{isManager ? 'Manage facility inventory, zones and physical availability.' : 'Explore published facilities and check live parking availability.'}</p></div>{isManager && canCreateFacility && <button className="sp-button primary" onClick={() => setShowCreateForm((value) => !value)}>{showCreateForm ? <X size={16} /> : <Plus size={16} />}{showCreateForm ? 'Close form' : 'Add facility'}</button>}</div>
      </div>

      {!isManager && (currentUser?.roles ?? []).includes('host') && <div className="sp-owner-driver-booking-note"><CarFront size={17}/><span><strong>Facility owner tip</strong> You can book parking as a driver too—including an available space at an approved facility you own. Choose a vehicle and use the normal price and reservation flow.</span></div>}
      {error && <div className="sp-alert error"><CircleAlert size={17} /><span>{error}</span><button onClick={() => setError('')} aria-label="Dismiss error"><X size={14} /></button></div>}
      {notice && <div className="sp-alert success"><Check size={17} /><span>{notice}</span><button onClick={() => setNotice('')} aria-label="Dismiss notice"><X size={14} /></button></div>}

      {showCreateForm && isManager && canCreateFacility && <article className="sp-panel sp-create-panel">
        <div className="sp-panel-header"><div><p className="sp-kicker">NEW FACILITY</p><h2>Create a parking facility</h2><p>Host listings are created as drafts and require review before publication.</p></div></div>
        <form className="sp-form sp-form-grid" onSubmit={createLot}>
          <label>Facility name<input name="name" value={lotForm.name} onChange={updateLotForm} required minLength={2} maxLength={160} placeholder="e.g. Riverside Parking Hub" /></label>
          <label>Street address<input name="addressLine" value={lotForm.addressLine} onChange={updateLotForm} required minLength={3} maxLength={255} placeholder="Street, building or landmark" /></label>
          <label>City<input name="city" value={lotForm.city} onChange={updateLotForm} required maxLength={100} placeholder="City" /></label>
          <label>Region / state<input name="region" value={lotForm.region} onChange={updateLotForm} maxLength={100} placeholder="State or region" /></label>
          <label>Postal code<input name="postalCode" value={lotForm.postalCode} onChange={updateLotForm} maxLength={20} placeholder="Postal code" /></label>
          <label>Country code<input name="countryCode" value={lotForm.countryCode} onChange={updateLotForm} maxLength={2} placeholder="IN" /></label>
          <label>Latitude <span className="sp-optional">Optional</span><input name="latitude" type="number" step="any" min="-90" max="90" value={lotForm.latitude} onChange={updateLotForm} placeholder="12.9716" /></label>
          <label>Longitude <span className="sp-optional">Optional</span><input name="longitude" type="number" step="any" min="-180" max="180" value={lotForm.longitude} onChange={updateLotForm} placeholder="77.5946" /></label>
          <label>Opening time<input name="openingTime" type="time" value={lotForm.openingTime} onChange={updateLotForm} /></label>
          <label>Closing time<input name="closingTime" type="time" value={lotForm.closingTime} onChange={updateLotForm} /></label>
          <label>Currency<select name="currency" value={lotForm.currency} onChange={updateLotForm}><option value="INR">INR — Indian Rupee</option><option value="USD">USD — US Dollar</option><option value="EUR">EUR — Euro</option><option value="GBP">GBP — Pound Sterling</option></select></label>
          <label className="sp-span-full">Description <span className="sp-optional">Optional</span><textarea name="description" rows={3} value={lotForm.description} onChange={updateLotForm} maxLength={5000} placeholder="Describe the facility, access, rules and amenities." /></label>
          <div className="sp-form-actions sp-span-full"><span className="sp-form-hint">The new facility will not be publicly searchable until it is approved and activated.</span><button className="sp-button primary" disabled={busyAction}>{busyAction ? <LoaderCircle className="sp-spin" size={15} /> : <Plus size={15} />} Create draft facility</button></div>
        </form>
      </article>}

      {!isManager && <>
        <form className="sp-search-bar" onSubmit={handleSearchSubmit}>
          <label><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search destination, facility or landmark" aria-label="Search parking facilities or destination" /></label>
          <label><MapPin size={16} /><input value={city} onChange={(event) => setCity(event.target.value)} placeholder="City or area" aria-label="Filter by city or area" /></label>
          <button className="sp-button primary"><SlidersHorizontal size={15} /> Search</button>
        </form>
        <div className="sp-discovery-controls">
          <div className="sp-discovery-left">
            <button type="button" className="sp-button secondary" onClick={requestUserLocation}><LocateFixed size={15} /> Use my location</button>
            {userLocation && <label className="sp-radius-control">Within <select value={radiusKm} onChange={(event) => setRadiusKm(event.target.value)}><option value="2">2 km</option><option value="5">5 km</option><option value="10">10 km</option><option value="25">25 km</option><option value="50">50 km</option></select></label>}
            {userLocation && <label className="sp-nearby-check"><input type="checkbox" checked={nearbyOnly} onChange={(event) => setNearbyOnly(event.target.checked)} /> Nearby only</label>}
          </div>
          <div className="sp-view-switch" role="group" aria-label="Parking discovery view">
            <button type="button" className={discoveryView === 'list' ? 'selected' : ''} onClick={() => setDiscoveryView('list')}><List size={14} /> List</button>
            <button type="button" className={discoveryView === 'map' ? 'selected' : ''} onClick={() => { setDiscoveryView('map'); if (!activeMapLotId && mapLots[0]) setActiveMapLotId(mapLots[0].lot.id); }}><Map size={14} /> Map</button>
          </div>
        </div>
        {locationStatus && <p className="sp-location-status" role="status">{locationStatus}</p>}
      </>}

      {loading ? <div className="sp-loading"><LoaderCircle className="sp-spin" size={20} /> Loading {isManager ? 'managed facilities' : 'parking facilities'}…</div> : (isManager ? lots.length > 0 : discoveryLots.length > 0) ? <>
        {!isManager && discoveryView === 'map' ? <div className="sp-map-discovery">
          <div className="sp-map-location-list">
            <div className="sp-map-list-heading"><strong>Parking locations</strong><span>{mapLots.length} with map coordinates</span></div>
            {discoveryLots.map(({ lot, distance }) => <button type="button" key={lot.id} className={`sp-map-location-item ${activeMapLot?.id === lot.id ? 'selected' : ''}`} disabled={lot.latitude == null || lot.longitude == null} onClick={() => setActiveMapLotId(lot.id)}>
              <span className="sp-map-pin"><MapPin size={16} /></span><span className="sp-map-location-copy"><strong>{lot.name}</strong><small>{facilityLocation(lot)}</small><small>{distance == null ? 'Distance unavailable' : distance < 1 ? `${Math.round(distance * 1000)} m away` : `${distance.toFixed(1)} km away`}</small></span><span className="sp-map-price">{formatMoney(lot.hourlyRate, lot.currency)}<small>/hr</small></span>
            </button>)}
            {!mapLots.length && <p className="sp-muted">No published facilities have coordinates yet. Owners can add latitude and longitude in their facility details.</p>}
          </div>
          <div className="sp-map-preview-wrap">{activeMapLot ? <><iframe title={`Map showing ${activeMapLot.name}`} className="sp-map-iframe" src={osmEmbedUrl(activeMapLot)} loading="lazy" referrerPolicy="no-referrer-when-downgrade" />          <div className="sp-map-preview-footer"><div><strong>{activeMapLot.name}</strong><span>{facilityLocation(activeMapLot)}</span></div><div className="sp-map-footer-actions"><a href={directionsUrl({ origin: hasCoordinates(userLocation) ? `${userLocation.latitude},${userLocation.longitude}` : undefined, destination: `${activeMapLot.latitude},${activeMapLot.longitude}` })} target="_blank" rel="noreferrer"><Navigation size={13} /> Route to parking</a><a href={`https://www.openstreetmap.org/?mlat=${Number(activeMapLot.latitude)}&mlon=${Number(activeMapLot.longitude)}#map=16/${Number(activeMapLot.latitude)}/${Number(activeMapLot.longitude)}`} target="_blank" rel="noreferrer">Open map <ArrowUpRight size={13} /></a></div></div>
            <div className="sp-arrival-planner"><div className="sp-arrival-planner-heading"><strong>Plan your arrival</strong><span>Route to this parking space, then continue to your destination.</span></div><label className="sp-arrival-destination"><MapPin size={15} /><input value={arrivalDestination} onChange={(event) => setArrivalDestination(event.target.value)} placeholder="Destination after parking (optional)" aria-label="Destination after parking" /></label><div className="sp-arrival-actions"><label>From parking<select value={destinationTravelMode} onChange={(event) => setDestinationTravelMode(event.target.value)}><option value="walking">Walking</option><option value="bicycling">Cycling</option><option value="driving">Driving</option><option value="transit">Public transit</option></select></label><button className="sp-button secondary" disabled={!arrivalDestination.trim()} onClick={() => window.open(directionsUrl({ origin: `${activeMapLot.latitude},${activeMapLot.longitude}`, destination: arrivalDestination.trim(), travelMode: destinationTravelMode }), '_blank', 'noopener,noreferrer')}>Route to destination <ArrowUpRight size={14} /></button></div>
            {activeMapLot.specialInstructions && <div className="sp-arrival-instructions"><strong><MapPin size={14} /> Arrival instructions</strong><p>{activeMapLot.specialInstructions}</p></div>}
          </div></> : <div className="sp-map-empty"><MapPin size={25} /><strong>Map coordinates unavailable</strong><span>Add coordinates to parking facilities to show their map pins.</span></div>}</div>
        </div> : <div className="sp-lot-grid">{(isManager ? lots.map((lot) => ({ lot, distance: null })) : discoveryLots).map(({ lot, distance }) => <LotCard key={lot.id} lot={lot} mode={mode} onOpen={loadLotDetails} onSubmitForApproval={submitForApproval} onSetStatus={setFacilityStatus} isAdmin={isAdmin} canCreate={canCreateFacility} isFavorite={favoriteLotIds.has(lot.id)} onToggleFavorite={toggleFavorite} distance={distance} userLocation={userLocation} />)}</div>}
      </> : <div className="sp-empty-state sp-empty-panel"><SquareParking size={32} /><strong>{isManager ? 'No managed facilities yet' : 'No published parking facilities found'}</strong><span>{!isManager && nearbyOnly ? 'No geolocated parking facilities were found within this radius. Expand the radius or search by city.' : isManager ? canCreateFacility ? 'Create your first facility, add zones and configure parking spaces.' : 'A facility owner or administrator can assign a parking facility to your account.' : 'Try another search, or check back after more parking facilities are published.'}</span>{isManager && canCreateFacility && <button className="sp-button primary" onClick={() => setShowCreateForm(true)}><Plus size={15} /> Add your first facility</button>}</div>}

      <div className="sp-page-footer"><span><ShieldCheck size={14} /> Availability is based on recorded physical state and active reservations.</span><button className="sp-button ghost" onClick={() => reloadLots(isManager ? { q: '', city: '' } : submittedQuery)}><RefreshCw size={14} /> Refresh</button></div>
    </section>
  );
}
