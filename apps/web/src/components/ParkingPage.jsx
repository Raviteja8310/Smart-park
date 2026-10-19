import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft, ArrowUpRight, Building2, Check, CircleAlert, Clock3,
  Layers3, LoaderCircle, MapPin, Plus, RefreshCw, Search, ShieldCheck,
  SlidersHorizontal, SquareParking, X
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

function StatePill({ state }) {
  const labels = { available: 'Available', occupied: 'Occupied', reserved: 'Reserved', unknown: 'Unknown', disabled: 'Disabled', maintenance: 'Maintenance' };
  return <span className={`sp-state-pill ${state}`}><i />{labels[state] ?? state}</span>;
}

function LotCard({ lot, mode, onOpen, onSubmitForApproval, onSetStatus, isAdmin, canCreate }) {
  return (
    <article className="sp-lot-card">
      <div className="sp-lot-card-top">
        <div className="sp-lot-icon"><Building2 size={20} /></div>
        <div className="sp-lot-status-wrap">
          <span className={`sp-facility-status ${lot.facilityStatus}`}>{lot.facilityStatus.replaceAll('_', ' ')}</span>
          <span className="sp-lot-id">{lot.id.slice(0, 8).toUpperCase()}</span>
        </div>
      </div>
      <h3>{lot.name}</h3>
      <p className="sp-lot-address"><MapPin size={14} />{facilityLocation(lot)}</p>
      {lot.description && <p className="sp-lot-description">{lot.description}</p>}
      <div className="sp-lot-metrics">
        <div><strong>{lot.totalSpaces}</strong><span>Total spaces</span></div>
        <div><strong>{lot.availableNow}</strong><span>Available now</span></div>
        <div><strong>{lot.occupiedNow}</strong><span>Occupied</span></div>
      </div>
      <div className="sp-lot-rate"><span>From</span><strong>{formatMoney(lot.hourlyRate, lot.currency)}<small>/ hour</small></strong></div>
      {mode === 'discover' && lot.latitude !== null && lot.longitude !== null && (
        <a className="sp-map-link" href={`https://www.google.com/maps/dir/?api=1&destination=${lot.latitude},${lot.longitude}`} target="_blank" rel="noreferrer">Directions <ArrowUpRight size={14} /></a>
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
      </div>
    </article>
  );
}

export default function ParkingPage({ mode = 'discover', currentUser }) {
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
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [selectedLot, setSelectedLot] = useState(null);
  const [slots, setSlots] = useState([]);
  const [slotSummary, setSlotSummary] = useState(null);
  const [zones, setZones] = useState([]);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [busyAction, setBusyAction] = useState(false);
  const [newZoneName, setNewZoneName] = useState('');
  const [newZoneLevel, setNewZoneLevel] = useState('');
  const [newSlotCodes, setNewSlotCodes] = useState('');
  const [newSlotZone, setNewSlotZone] = useState('');
  const [newVehicleType, setNewVehicleType] = useState('any');
  const [newCovered, setNewCovered] = useState(false);
  const [newAccessible, setNewAccessible] = useState(false);
  const [lotForm, setLotForm] = useState({ name: '', description: '', addressLine: '', city: '', region: '', postalCode: '', countryCode: 'IN', latitude: '', longitude: '', openingTime: '06:00', closingTime: '23:00', currency: 'INR' });

  const reloadLots = useCallback(async (criteria = submittedQuery) => {
    setLoading(true);
    setError('');
    try {
      const queryString = new URLSearchParams();
      if (criteria.q?.trim()) queryString.set('q', criteria.q.trim());
      if (criteria.city?.trim()) queryString.set('city', criteria.city.trim());
      const endpoint = isManager ? '/api/parking/managed-lots' : `/api/parking/lots${queryString.size ? `?${queryString}` : ''}`;
      const data = await apiRequest(endpoint);
      setLots(data.lots ?? []);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }, [isManager, submittedQuery]);

  useEffect(() => { reloadLots(isManager ? { q: '', city: '' } : submittedQuery); }, [isManager, submittedQuery, reloadLots]);

  const loadLotDetails = useCallback(async (lot) => {
    setSelectedLot(lot);
    setLoadingDetails(true);
    setError('');
    setNotice('');
    try {
      const [lotData, slotData, zoneData] = await Promise.all([
        apiRequest(`/api/parking/lots/${lot.id}`),
        apiRequest(`/api/parking/lots/${lot.id}/slots`),
        apiRequest(`/api/parking/lots/${lot.id}/zones`)
      ]);
      setSelectedLot(lotData.lot ?? lot);
      setSlots(slotData.slots ?? []);
      setSlotSummary(slotData.summary ?? null);
      setZones(zoneData.zones ?? []);
      setNewSlotZone(zoneData.zones?.[0]?.id ?? '');
    } catch (requestError) {
      setError(requestError.message);
      setSlots([]);
      setSlotSummary(null);
      setZones([]);
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

  const availableSlots = useMemo(() => slots.filter((slot) => slot.availabilityState === 'available').length, [slots]);

  if (selectedLot) {
    return (
      <section className="sp-page">
        <div className="sp-page-heading">
          <button className="sp-back-button" onClick={() => { setSelectedLot(null); setSlots([]); setZones([]); setError(''); setNotice(''); reloadLots({ q: '', city: '' }); }}><ArrowLeft size={16} /> Back to {isManager ? 'managed facilities' : 'parking results'}</button>
          <div className="sp-heading-title-row"><div><p className="sp-kicker">{isManager ? 'FACILITY INVENTORY' : 'PARKING DETAILS'}</p><h1>{selectedLot.name}</h1><p>{facilityLocation(selectedLot)}</p></div><span className={`sp-facility-status ${selectedLot.facilityStatus}`}>{selectedLot.facilityStatus.replaceAll('_', ' ')}</span></div>
        </div>

        {error && <div className="sp-alert error"><CircleAlert size={17} /><span>{error}</span><button onClick={() => setError('')} aria-label="Dismiss error"><X size={14} /></button></div>}
        {notice && <div className="sp-alert success"><Check size={17} /><span>{notice}</span><button onClick={() => setNotice('')} aria-label="Dismiss notice"><X size={14} /></button></div>}

        {loadingDetails ? <div className="sp-loading"><LoaderCircle className="sp-spin" size={20} /> Loading parking inventory…</div> : <>
          <div className="sp-detail-stats">
            <div><span>Total spaces</span><strong>{slotSummary?.total ?? selectedLot.totalSpaces ?? 0}</strong></div>
            <div><span>Available now</span><strong className="green-text">{slotSummary?.available ?? selectedLot.availableNow ?? 0}</strong></div>
            <div><span>Occupied</span><strong className="red-text">{slotSummary?.occupied ?? selectedLot.occupiedNow ?? 0}</strong></div>
            <div><span>Unknown status</span><strong>{slotSummary?.unknown ?? selectedLot.unknownSpaces ?? 0}</strong></div>
          </div>

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

      {!isManager && <form className="sp-search-bar" onSubmit={(event) => { event.preventDefault(); setSubmittedQuery({ q: query, city }); }}>
        <label><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search facility, address or landmark" aria-label="Search parking facilities" /></label>
        <label><MapPin size={16} /><input value={city} onChange={(event) => setCity(event.target.value)} placeholder="City" aria-label="Filter by city" /></label>
        <button className="sp-button primary"><SlidersHorizontal size={15} /> Search</button>
      </form>}

      {loading ? <div className="sp-loading"><LoaderCircle className="sp-spin" size={20} /> Loading {isManager ? 'managed facilities' : 'parking facilities'}…</div> : lots.length ? <div className="sp-lot-grid">{lots.map((lot) => <LotCard key={lot.id} lot={lot} mode={mode} onOpen={loadLotDetails} onSubmitForApproval={submitForApproval} onSetStatus={setFacilityStatus} isAdmin={isAdmin} canCreate={canCreateFacility} />)}</div> : <div className="sp-empty-state sp-empty-panel"><SquareParking size={32} /><strong>{isManager ? 'No managed facilities yet' : 'No published parking facilities found'}</strong><span>{isManager ? canCreateFacility ? 'Create your first facility, add zones and configure parking spaces.' : 'A facility owner or administrator can assign a parking facility to your account.' : 'Try another search, or check back after more parking facilities are published.'}</span>{isManager && canCreateFacility && <button className="sp-button primary" onClick={() => setShowCreateForm(true)}><Plus size={15} /> Add your first facility</button>}</div>}

      <div className="sp-page-footer"><span><ShieldCheck size={14} /> Availability is based on recorded physical state and active reservations.</span><button className="sp-button ghost" onClick={() => reloadLots(isManager ? { q: '', city: '' } : submittedQuery)}><RefreshCw size={14} /> Refresh</button></div>
    </section>
  );
}
