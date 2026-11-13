import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './SmartParkMap.css';
import { ArrowUpRight, Car, Crosshair, LoaderCircle, Navigation, Radar, Search, X, Zap } from 'lucide-react';
import { fetchParkingLocations } from '../services/parkingApi.js';
import { findOsmParking, getDrivingRoute, isValidCoordinate, searchPlace } from '../services/osmServices.js';

/**
 * SmartPark interactive map (OpenStreetMap + Leaflet), integrated into the Find parking → Map view.
 *
 * SmartPark facilities and their availability come only from the SmartPark API
 * (GET /api/parking/map/locations), refreshed every 30 s while the page is visible.
 * OpenStreetMap "mapped parking" from Overpass is optional, visually distinct, and is never
 * shown as available because OpenStreetMap has no real-time occupancy.
 *
 * Props
 *  visibleLotIds     ids currently listed by the page's search (null = show all)
 *  selectedLotId     facility highlighted on the page; the map focuses it
 *  onSelectLot(id)   marker selection → page selection
 *  onOpenLot(id)     open the facility in the existing booking flow
 *  userLocation      { latitude, longitude } from the page's existing geolocation flow
 *  onRequestLocation asks the page to request location (permission is asked only on click)
 *  radiusKm          nearby radius from the page's existing radius control
 *  formatPrice(amount, currency)
 */

const DEFAULT_CENTER = [12.9716, 77.5946];
const REFRESH_MS = 30000;
const STATUS_LABEL = { available: 'Available', occupied: 'Fully occupied', reserved: 'Reserved', unknown: 'Availability unknown' };

const lotIcon = (status, selected) => L.divIcon({
  className: 'spm-marker-wrap',
  html: `<span class="spm-marker spm-marker--${status}${selected ? ' is-selected' : ''}"><span>P</span></span>`,
  iconSize: [30, 30],
  iconAnchor: [15, 15],
  popupAnchor: [0, -16]
});
const osmIcon = L.divIcon({ className: 'spm-marker-wrap', html: '<span class="spm-osm-marker">P</span>', iconSize: [22, 22], iconAnchor: [11, 11], popupAnchor: [0, -12] });
const userIcon = L.divIcon({ className: 'spm-marker-wrap', html: '<span class="spm-user-marker"></span>', iconSize: [22, 22], iconAnchor: [11, 11] });
const placeIcon = L.divIcon({ className: 'spm-marker-wrap', html: '<span class="spm-place-marker"></span>', iconSize: [24, 24], iconAnchor: [12, 24], popupAnchor: [0, -24] });

const formatDistance = (km) => (km == null ? '' : km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`);
const currentLanguage = () => document.documentElement.lang || 'en';

function MapBehaviour({ focus, fitTo, routePath, onUserInteract, onTileError }) {
  const map = useMap();
  const fitted = useRef(false);
  useMapEvents({ dragstart: onUserInteract, zoomstart: (e) => { if (e?.originalEvent) onUserInteract(); } });

  // Fit to SmartPark facilities once, when they first arrive.
  useEffect(() => {
    if (fitted.current || !fitTo.length) return;
    fitted.current = true;
    if (fitTo.length === 1) map.setView(fitTo[0], 15);
    else map.fitBounds(L.latLngBounds(fitTo), { padding: [36, 36], maxZoom: 15 });
  }, [fitTo, map]);

  useEffect(() => {
    if (focus && isValidCoordinate(focus[0], focus[1])) map.flyTo(focus, Math.max(map.getZoom(), 15), { duration: 0.6 });
  }, [focus, map]);

  // Show the whole route, start to parking, whenever a new one is drawn.
  useEffect(() => {
    if (!routePath || routePath.length < 2) return;
    // Cancel any fly-to still animating (e.g. to your location) so it can't override the route view.
    map.stop();
    map.fitBounds(L.latLngBounds(routePath), { padding: [48, 48], maxZoom: 17 });
  }, [routePath, map]);

  // Leaflet must re-measure when its container is resized (layout changes, sidebar collapse).
  useEffect(() => {
    const container = map.getContainer();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(container);
    return () => observer.disconnect();
  }, [map]);

  useEffect(() => {
    let reported = false;
    const handler = () => { if (!reported) { reported = true; onTileError(); } };
    map.eachLayer((layer) => { if (layer instanceof L.TileLayer) layer.on('tileerror', handler); });
    return () => map.eachLayer((layer) => { if (layer instanceof L.TileLayer) layer.off('tileerror', handler); });
  }, [map, onTileError]);
  return null;
}

export default function SmartParkMap({
  visibleLotIds = null,
  selectedLotId = '',
  onSelectLot,
  onOpenLot,
  userLocation = null,
  onRequestLocation,
  radiusKm = 10,
  // { lotId, nonce } from the page's "Route to parking": draws the route to that exact facility pin.
  routeRequest = null,
  onReady,
  formatPrice = (amount, currency = 'INR') => new Intl.NumberFormat('en-IN', { style: 'currency', currency, maximumFractionDigits: 0 }).format(amount)
}) {
  const [lots, setLots] = useState([]);
  const [loadState, setLoadState] = useState('loading'); // loading | ready | error
  const [lastUpdated, setLastUpdated] = useState(null);
  const [filter, setFilter] = useState('all');
  const [placeQuery, setPlaceQuery] = useState('');
  const [place, setPlace] = useState(null);
  const [nearby, setNearby] = useState(null);       // { origin, lots } SmartPark nearby results
  const [osmPlaces, setOsmPlaces] = useState([]);
  const [showOsm, setShowOsm] = useState(false);
  const [route, setRoute] = useState(null);
  const [focus, setFocus] = useState(null);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [tileProblem, setTileProblem] = useState(false);
  const markerRefs = useRef(new Map());
  const rootRef = useRef(null);
  const pendingAfterLocation = useRef(null);
  const mounted = useRef(true);

  // Re-arm on mount so React StrictMode's dev mount/unmount/mount cycle doesn't leave it false.
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  // ---- SmartPark data + lightweight polling (paused while the tab is hidden) ----
  const loadLots = useCallback(async (signal) => {
    try {
      const { lots: rows } = await fetchParkingLocations({ signal });
      if (!mounted.current) return;
      setLots(rows); setLoadState('ready'); setLastUpdated(new Date());
    } catch (error) {
      if (signal?.aborted || !mounted.current) return;
      setLoadState((state) => (state === 'ready' ? 'ready' : 'error'));
      setMessage(`${error.message} The map is still available without live SmartPark data.`);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    loadLots(controller.signal);
    const id = setInterval(() => { if (document.visibilityState === 'visible') loadLots(controller.signal); }, REFRESH_MS);
    const onVisible = () => { if (document.visibilityState === 'visible') loadLots(controller.signal); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { controller.abort(); clearInterval(id); document.removeEventListener('visibilitychange', onVisible); };
  }, [loadLots]);

  const allowed = useMemo(() => (visibleLotIds ? new Set(visibleLotIds) : null), [visibleLotIds]);
  const shownLots = useMemo(() => lots.filter((lot) => (!allowed || allowed.has(lot.id)) && (filter === 'all' || lot.status === filter)), [lots, allowed, filter]);
  const fitTo = useMemo(() => lots.filter((lot) => !allowed || allowed.has(lot.id)).map((lot) => [lot.latitude, lot.longitude]), [lots, allowed]);
  const lotsById = useMemo(() => new Map(lots.map((lot) => [lot.id, lot])), [lots]);

  // ---- Page selection → focus marker and open its popup ----
  useEffect(() => {
    const lot = lotsById.get(selectedLotId);
    if (!lot) return;
    setFocus([lot.latitude, lot.longitude]);
    const timer = setTimeout(() => markerRefs.current.get(lot.id)?.openPopup(), 650);
    return () => clearTimeout(timer);
  }, [selectedLotId]); // eslint-disable-line react-hooks/exhaustive-deps

  const origin = userLocation && isValidCoordinate(userLocation.latitude, userLocation.longitude)
    ? { latitude: userLocation.latitude, longitude: userLocation.longitude, label: 'Your location' }
    : place;
  // Nearby search centres on an explicitly searched place first (that's usually where the driver is heading);
  // directions still start from the user's own location when it is known.
  const nearbyOrigin = place || origin;

  // When the page delivers a location we asked for, continue the pending action.
  useEffect(() => {
    if (!userLocation) return;
    setFocus([userLocation.latitude, userLocation.longitude]);
    const pending = pendingAfterLocation.current;
    pendingAfterLocation.current = null;
    if (pending) pending({ latitude: userLocation.latitude, longitude: userLocation.longitude, label: 'Your location' });
  }, [userLocation]); // eslint-disable-line react-hooks/exhaustive-deps

  function locate() {
    setPlace(null);
    if (userLocation) { setFocus([userLocation.latitude, userLocation.longitude]); return; }
    if (!onRequestLocation) { setMessage('Location services are not available here.'); return; }
    onRequestLocation();
  }

  async function submitPlace(event) {
    event.preventDefault();
    setBusy('search'); setMessage('');
    try {
      const result = await searchPlace(placeQuery, { language: currentLanguage() });
      setPlace(result); setFocus([result.latitude, result.longitude]); setRoute(null);
      setMessage(`Showing ${result.label}`);
    } catch (error) {
      setMessage(error.message);
    } finally { setBusy(''); }
  }

  async function findNearby() {
    if (!nearbyOrigin) {
      setMessage('Use your location or search for a place first, then find nearby parking.');
      if (onRequestLocation && !userLocation) { pendingAfterLocation.current = (loc) => findNearbyFrom(loc); onRequestLocation(); }
      return;
    }
    await findNearbyFrom(nearbyOrigin);
  }

  async function findNearbyFrom(start) {
    if (!start) return;
    setBusy('nearby'); setMessage('');
    try {
      const { lots: rows } = await fetchParkingLocations({ origin: start, radiusKm });
      setNearby({ origin: start, lots: rows });
      setFocus([start.latitude, start.longitude]);
      let osmCount = 0;
      let osmError = '';
      if (showOsm) {
        try {
          const osm = await findOsmParking(start, Math.min(radiusKm, 5));
          setOsmPlaces(osm); osmCount = osm.length;
        } catch (error) { setOsmPlaces([]); osmError = ` ${error.message}`; }
      }
      if (!rows.length) setMessage(`No SmartPark facilities within ${radiusKm} km.${showOsm && !osmError ? ` ${osmCount} OpenStreetMap parking places shown (availability unknown).` : ''}${osmError}`);
      else setMessage(`${rows.length} SmartPark facilities within ${radiusKm} km, nearest first.${osmError}`);
    } catch (error) {
      setMessage(error.message);
    } finally { setBusy(''); }
  }

  async function toggleOsm(checked) {
    setShowOsm(checked);
    if (!checked) { setOsmPlaces([]); return; }
    const start = nearby?.origin || nearbyOrigin;
    if (!start) { setMessage('OpenStreetMap parking appears after you choose a location and select Nearby.'); return; }
    setBusy('osm');
    try { setOsmPlaces(await findOsmParking(start, Math.min(radiusKm, 5))); }
    catch (error) { setMessage(error.message); }
    finally { setBusy(''); }
  }

  // Let the page know the interactive map is mounted (otherwise it falls back to an external maps link).
  useEffect(() => { onReady?.(true); return () => onReady?.(false); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // "Route to parking" from the page: route to the facility's own coordinates, labelled with its name.
  const handledRouteNonce = useRef(null);
  useEffect(() => {
    if (!routeRequest || handledRouteNonce.current === routeRequest.nonce) return;
    const lot = lots.find((item) => item.id === routeRequest.lotId);
    if (!lot) return; // wait until the facilities have loaded
    handledRouteNonce.current = routeRequest.nonce;
    rootRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    directionsTo(lot);
  }, [routeRequest, lots]); // eslint-disable-line react-hooks/exhaustive-deps

  async function directionsTo(target, from = origin) {
    if (!from) {
      setMessage('Share your location or search for a starting place to get directions.');
      if (onRequestLocation && !userLocation) { pendingAfterLocation.current = (loc) => directionsTo(target, loc); onRequestLocation(); }
      return;
    }
    setBusy('route'); setMessage('');
    try {
      const result = await getDrivingRoute(from, target);
      setRoute({ ...result, to: target.name || 'Parking' });
      setMessage('');
    } catch (error) {
      setRoute(null); setMessage(error.message);
    } finally { setBusy(''); }
  }

  const externalDirections = (target) => {
    const params = new URLSearchParams({ api: '1', destination: `${target.latitude},${target.longitude}`, travelmode: 'driving' });
    if (origin) params.set('origin', `${origin.latitude},${origin.longitude}`);
    return `https://www.google.com/maps/dir/?${params}`;
  };

  return (
    <section ref={rootRef} className="spm" aria-label="Parking map">
      <div className="spm-toolbar">
        <form className="spm-search" onSubmit={submitPlace} role="search">
          <Search size={15} aria-hidden="true" />
          <input value={placeQuery} onChange={(event) => setPlaceQuery(event.target.value)} placeholder="Search area, landmark or address" aria-label="Search area, landmark or address" />
          <button type="submit" className="sp-button secondary" disabled={busy === 'search' || placeQuery.trim().length < 3}>{busy === 'search' ? <LoaderCircle size={14} className="sp-spin" /> : 'Search'}</button>
        </form>
        <button type="button" className="sp-button ghost" onClick={locate}><Crosshair size={14} /> My location</button>
        <button type="button" className="sp-button primary" onClick={findNearby} disabled={busy === 'nearby'}>{busy === 'nearby' ? <LoaderCircle size={14} className="sp-spin" /> : <Radar size={14} />} Nearby parking</button>
        <label className="spm-filter">Show
          <select value={filter} onChange={(event) => setFilter(event.target.value)} aria-label="Filter by availability">
            <option value="all">All SmartPark facilities</option>
            <option value="available">Available</option>
            <option value="occupied">Fully occupied</option>
            <option value="reserved">Reserved</option>
            <option value="unknown">Availability unknown</option>
          </select>
        </label>
        <label className="spm-osm-toggle"><input type="checkbox" checked={showOsm} onChange={(event) => toggleOsm(event.target.checked)} /> Include OpenStreetMap parking</label>
      </div>

      <ul className="spm-legend" aria-label="Map legend">
        <li><i className="spm-dot available" /> Available</li>
        <li><i className="spm-dot occupied" /> Fully occupied</li>
        <li><i className="spm-dot reserved" /> Reserved</li>
        <li><i className="spm-dot unknown" /> Availability unknown</li>
        <li><i className="spm-dot user" /> You</li>
        {showOsm && <li><i className="spm-dot osm" /> OpenStreetMap parking (not SmartPark)</li>}
      </ul>

      <div className="spm-canvas-wrap">
        <MapContainer center={DEFAULT_CENTER} zoom={12} scrollWheelZoom className="spm-canvas" worldCopyJump>
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors'
            url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
            maxZoom={19}
          />
          <MapBehaviour focus={focus} fitTo={fitTo} routePath={route?.coordinates} onUserInteract={() => {}} onTileError={() => setTileProblem(true)} />

          {userLocation && isValidCoordinate(userLocation.latitude, userLocation.longitude) && (
            <Marker position={[userLocation.latitude, userLocation.longitude]} icon={userIcon} zIndexOffset={900}>
              <Popup>Your current location</Popup>
            </Marker>
          )}
          {place && (
            <Marker position={[place.latitude, place.longitude]} icon={placeIcon} zIndexOffset={800}>
              <Popup><div className="spm-popup"><strong>Searched place</strong><span>{place.label}</span></div></Popup>
            </Marker>
          )}

          {shownLots.map((lot) => (
            <Marker
              key={lot.id}
              position={[lot.latitude, lot.longitude]}
              icon={lotIcon(lot.status, lot.id === selectedLotId)}
              zIndexOffset={lot.id === selectedLotId ? 700 : 0}
              ref={(instance) => { if (instance) markerRefs.current.set(lot.id, instance); else markerRefs.current.delete(lot.id); }}
              eventHandlers={{ click: () => onSelectLot?.(lot.id) }}
            >
              <Popup minWidth={240} maxWidth={300}>
                <div className="spm-popup">
                  <span className="spm-popup-source">SmartPark facility</span>
                  <strong>{lot.name}</strong>
                  {lot.address && <span className="spm-muted">{lot.address}</span>}
                  <span className={`spm-status ${lot.status}`}><i />{STATUS_LABEL[lot.status]}</span>
                  <dl className="spm-counts">
                    <div><dt>Available</dt><dd>{lot.availableSlots ?? '—'}</dd></div>
                    <div><dt>Total</dt><dd>{lot.totalSlots ?? '—'}</dd></div>
                    <div><dt>Occupied</dt><dd>{lot.occupiedSlots ?? '—'}</dd></div>
                    <div><dt>Reserved</dt><dd>{lot.reservedSlots ?? '—'}</dd></div>
                  </dl>
                  {lot.unknownSlots > 0 && <span className="spm-muted">{`${lot.unknownSlots} spaces awaiting a sensor or staff update`}</span>}
                  <span className="spm-price">{lot.pricePerHour == null ? 'Rate not set' : `${formatPrice(lot.pricePerHour, lot.currency)} per hour`}</span>
                  <span className="spm-ev"><Zap size={13} /> {lot.evCharging ? `EV charging · ${lot.ev?.availableConnectors ?? 0} of ${lot.ev?.connectors ?? 0} connectors available` : 'No EV charging'}</span>
                  {lot.distanceKm != null && <span className="spm-muted">{`${formatDistance(lot.distanceKm)} away`}</span>}
                  <div className="spm-popup-actions">
                    <button type="button" className="sp-button primary" onClick={() => onOpenLot?.(lot.id)}><Car size={14} /> View &amp; reserve</button>
                    <button type="button" className="sp-button secondary" onClick={() => directionsTo(lot)} disabled={busy === 'route'}><Navigation size={14} /> Directions</button>
                  </div>
                </div>
              </Popup>
            </Marker>
          ))}

          {showOsm && osmPlaces.map((spot) => (
            <Marker key={spot.id} position={[spot.latitude, spot.longitude]} icon={osmIcon}>
              <Popup>
                <div className="spm-popup">
                  <span className="spm-popup-source osm">OpenStreetMap · not managed by SmartPark</span>
                  <strong>{spot.name || 'Mapped parking area'}</strong>
                  {spot.address && <span className="spm-muted">{spot.address}</span>}
                  <span className="spm-status unknown"><i />Availability unknown</span>
                  {spot.capacity && <span className="spm-muted">{`Mapped capacity: ${spot.capacity}`}</span>}
                  {spot.fee && <span className="spm-muted">{`Fee: ${spot.fee}`}</span>}
                  <div className="spm-popup-actions">
                    <button type="button" className="sp-button secondary" onClick={() => directionsTo(spot)} disabled={busy === 'route'}><Navigation size={14} /> Directions</button>
                    <a className="sp-button ghost" href={spot.osmUrl} target="_blank" rel="noreferrer">OpenStreetMap <ArrowUpRight size={13} /></a>
                  </div>
                </div>
              </Popup>
            </Marker>
          ))}

          {route && <Polyline positions={route.coordinates} pathOptions={{ color: '#2563eb', weight: 5, opacity: 0.85 }} />}
        </MapContainer>
        {loadState === 'loading' && <div className="spm-overlay"><LoaderCircle size={16} className="sp-spin" /> Loading SmartPark facilities…</div>}
      </div>

      {route && (
        <div className="spm-route" role="status">
          <Navigation size={15} />
          <span className="spm-route-summary">{`${route.distanceKm.toFixed(1)} km · about ${route.durationMin} min by car to ${route.to}`}</span>
          <span className="spm-muted">Estimate from the public OSRM demo service, not live traffic navigation.</span>
          <button type="button" className="sp-button ghost" onClick={() => setRoute(null)}><X size={13} /> Clear route</button>
        </div>
      )}

      {nearby && (
        <div className="spm-nearby">
          <div className="spm-nearby-head">
            <strong>Nearby SmartPark facilities</strong>
            <span className="spm-muted">{`Within ${radiusKm} km of ${nearby.origin.label || 'the selected place'}`}</span>
            <button type="button" className="sp-button ghost" onClick={() => setNearby(null)} aria-label="Close nearby results"><X size={13} /></button>
          </div>
          {nearby.lots.length ? (
            <ol>
              {nearby.lots.map((lot) => {
                const live = lotsById.get(lot.id) || lot;
                return (
                  <li key={lot.id}>
                    <button type="button" onClick={() => { onSelectLot?.(lot.id); setFocus([lot.latitude, lot.longitude]); setTimeout(() => markerRefs.current.get(lot.id)?.openPopup(), 650); }}>
                      <i className={`spm-dot ${live.status}`} />
                      <span className="spm-nearby-name"><strong>{lot.name}</strong><small>{`${STATUS_LABEL[live.status]} · ${live.availableSlots ?? '—'} of ${live.totalSlots ?? '—'} free`}{live.evCharging ? ' · EV' : ''}</small></span>
                      <span className="spm-nearby-meta"><b>{formatDistance(lot.distanceKm)}</b><small>{live.pricePerHour == null ? 'Rate not set' : `${formatPrice(live.pricePerHour, live.currency)}/hr`}</small></span>
                    </button>
                  </li>
                );
              })}
            </ol>
          ) : <p className="spm-muted">No SmartPark facilities in this radius. Increase the radius above, or include OpenStreetMap parking (availability unknown).</p>}
        </div>
      )}

      <div className="spm-status-line" role="status" aria-live="polite">
        {busy ? <span><LoaderCircle size={13} className="sp-spin" /> {busy === 'route' ? 'Calculating route…' : busy === 'search' ? 'Searching…' : 'Finding parking…'}</span>
          : message ? <span>{message}</span>
          : <span>{loadState === 'error' ? 'Live SmartPark data is unavailable.' : `${shownLots.length} SmartPark facilities on the map${lastUpdated ? ` · availability updated ${lastUpdated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}`}</span>}
        {tileProblem && <span className="spm-warn">Some map tiles could not load. Check your connection.</span>}
      </div>
      <p className="spm-disclaimer">Map data © OpenStreetMap contributors. Search (Nominatim), mapped parking (Overpass) and routing (OSRM demo) use shared public services with usage limits; use hosted or self-hosted services for production traffic. SmartPark availability comes from SmartPark records; OpenStreetMap places have no live availability.</p>
    </section>
  );
}
