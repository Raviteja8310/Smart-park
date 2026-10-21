import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft, ArrowUpRight, BadgeCheck, CalendarClock, Camera, CarFront, Check, CircleAlert,
  Clock3, FileCheck2, ImagePlus, LoaderCircle, MapPin, ParkingSquare, Plus, RefreshCw,
  Save, ShieldCheck, Trash2, UploadCloud, X
} from 'lucide-react';

const AMENITIES = [
  { id: 'coveredParking', label: 'Covered parking' },
  { id: 'cctv', label: 'CCTV security' },
  { id: 'onsiteStaff', label: 'On-site staff' },
  { id: 'accessibleParking', label: 'Accessible parking' },
  { id: 'lighting', label: 'Good lighting' },
  { id: 'overnightAccess', label: 'Overnight access' },
  { id: 'evCharging', label: 'EV charging' },
  { id: 'gatedAccess', label: 'Gated access' }
];
const WEEKDAYS = [
  { value: 0, label: 'Sunday' }, { value: 1, label: 'Monday' }, { value: 2, label: 'Tuesday' },
  { value: 3, label: 'Wednesday' }, { value: 4, label: 'Thursday' }, { value: 5, label: 'Friday' }, { value: 6, label: 'Saturday' }
];
const DEFAULT_FORM = {
  name: '', description: '', addressLine: '', city: '', region: '', postalCode: '', countryCode: 'IN',
  latitude: '', longitude: '', timezone: 'Asia/Kolkata', currency: 'INR', openingTime: '06:00', closingTime: '23:00',
  contactPhone: '', specialInstructions: '', parkingType: 'private_bay', numberSpaces: '1', vehicleType: 'any',
  hourlyRate: '40', dailyRate: '', weeklyRate: '', monthlyRate: '', serviceFee: '5', taxRatePercent: '0', amenities: []
};
const DEFAULT_SCHEDULE = WEEKDAYS.map((day) => ({ weekday: day.value, isAvailable: true, opensAt: '06:00', closesAt: '23:00' }));

async function apiRequest(path, options = {}) {
  const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;
  const response = await fetch(path, {
    credentials: 'same-origin', ...options,
    headers: { ...(options.body && !isFormData ? { 'Content-Type': 'application/json' } : {}), ...(options.headers ?? {}) }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message ?? 'The request could not be completed.');
  return data;
}
function money(value, currency = 'INR') {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return 'Rate not set';
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency, maximumFractionDigits: 2 }).format(Number(value));
}
function label(value) { return String(value ?? '').replaceAll('_', ' ').replace(/\b\w/g, (character) => character.toUpperCase()); }
function normalizeTime(value) { return value ? String(value).slice(0, 5) : '06:00'; }
function toSchedule(rules = []) {
  const byDay = new Map(rules.map((rule) => [Number(rule.weekday), rule]));
  return WEEKDAYS.map((day) => {
    const rule = byDay.get(day.value);
    return rule ? { weekday: day.value, isAvailable: Boolean(rule.isAvailable), opensAt: normalizeTime(rule.opensAt), closesAt: normalizeTime(rule.closesAt) }
      : { weekday: day.value, isAvailable: true, opensAt: '06:00', closesAt: '23:00' };
  });
}
function listingToForm(listing) {
  return {
    ...DEFAULT_FORM,
    name: listing.name ?? '', description: listing.description ?? '', addressLine: listing.addressLine ?? '', city: listing.city ?? '',
    region: listing.region ?? '', postalCode: listing.postalCode ?? '', countryCode: listing.countryCode || 'IN',
    latitude: listing.latitude == null ? '' : String(listing.latitude), longitude: listing.longitude == null ? '' : String(listing.longitude),
    timezone: listing.timezone || 'Asia/Kolkata', currency: listing.currency || 'INR',
    openingTime: normalizeTime(listing.openingTime), closingTime: normalizeTime(listing.closingTime),
    contactPhone: listing.contactPhone ?? '', specialInstructions: listing.specialInstructions ?? '',
    parkingType: listing.parkingType || 'private_bay', amenities: Array.isArray(listing.amenities) ? listing.amenities : []
  };
}
function apiFormPayload(form) {
  return {
    name: form.name.trim(), description: form.description.trim() || null,
    addressLine: form.addressLine.trim(), city: form.city.trim(), region: form.region.trim() || null,
    postalCode: form.postalCode.trim() || null, countryCode: (form.countryCode || 'IN').toUpperCase(),
    latitude: form.latitude.trim() ? Number(form.latitude) : null,
    longitude: form.longitude.trim() ? Number(form.longitude) : null,
    timezone: form.timezone || 'Asia/Kolkata', currency: form.currency || 'INR',
    openingTime: form.openingTime, closingTime: form.closingTime,
    contactPhone: form.contactPhone.trim() || null, specialInstructions: form.specialInstructions.trim() || null,
    parkingType: form.parkingType, amenities: form.amenities
  };
}

function AmenityChecks({ value = [], onChange, disabled = false }) {
  const selected = new Set(value);
  return <div className="sp-market-amenities">{AMENITIES.map((amenity) => <label className="sp-market-check" key={amenity.id}>
    <input type="checkbox" checked={selected.has(amenity.id)} disabled={disabled} onChange={(event) => onChange(event.target.checked ? [...value, amenity.id] : value.filter((item) => item !== amenity.id))} />
    <span>{amenity.label}</span>
  </label>)}</div>;
}

export default function MarketplacePage({ currentUser }) {
  const isAdmin = (currentUser?.roles ?? []).includes('admin');
  const [listings, setListings] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [details, setDetails] = useState(null);
  const [form, setForm] = useState(DEFAULT_FORM);
  const [schedule, setSchedule] = useState(DEFAULT_SCHEDULE);
  const [rateForm, setRateForm] = useState({ rateType: 'hourly', amount: '40', serviceFee: '5', taxRatePercent: '0' });
  const [photoFiles, setPhotoFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [creating, setCreating] = useState(false);

  const reloadMine = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const data = await apiRequest('/api/marketplace/listings/mine');
      setListings(data.listings ?? []);
      if (selectedId && !(data.listings ?? []).some((listing) => listing.id === selectedId)) {
        setSelectedId(''); setDetails(null);
      }
    } catch (requestError) { setError(requestError.message || 'Unable to load your listings.'); }
    finally { setLoading(false); }
  }, [selectedId]);

  useEffect(() => { reloadMine(); }, [reloadMine]);

  const openListing = useCallback(async (id) => {
    setSelectedId(id); setLoadingDetails(true); setError(''); setNotice(''); setPhotoFiles([]);
    try {
      const data = await apiRequest(`/api/marketplace/listings/${id}`);
      setDetails(data);
      setForm(listingToForm(data.listing));
      setSchedule(toSchedule(data.availability));
      const activeHourly = (data.pricingRules ?? []).find((rule) => rule.isActive && rule.rateType === 'hourly');
      setRateForm({ rateType: 'hourly', amount: String(activeHourly?.amount ?? 40), serviceFee: String(activeHourly?.serviceFee ?? 0), taxRatePercent: String(activeHourly?.taxRatePercent ?? 0) });
    } catch (requestError) { setError(requestError.message || 'Unable to open listing.'); setDetails(null); }
    finally { setLoadingDetails(false); }
  }, []);

  const updateForm = (event) => setForm((old) => ({ ...old, [event.target.name]: event.target.value }));
  const selectedListing = details?.listing;
  const [search, setSearch] = useState('');
  const filteredListings = useMemo(() => listings.filter((listing) => `${listing.name} ${listing.city} ${listing.addressLine} ${listing.facilityStatus}`.toLowerCase().includes(search.toLowerCase())), [listings, search]);

  async function createListing(event) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      const payload = {
        ...apiFormPayload(form),
        numberSpaces: Number(form.numberSpaces), vehicleType: form.vehicleType,
        hourlyRate: Number(form.hourlyRate), dailyRate: form.dailyRate.trim() ? Number(form.dailyRate) : null,
        weeklyRate: form.weeklyRate.trim() ? Number(form.weeklyRate) : null,
        monthlyRate: form.monthlyRate.trim() ? Number(form.monthlyRate) : null,
        serviceFee: Number(form.serviceFee || 0), taxRatePercent: Number(form.taxRatePercent || 0)
      };
      const data = await apiRequest('/api/marketplace/listings', { method: 'POST', body: JSON.stringify(payload) });
      await reloadMine();
      setCreating(false);
      setNotice('Listing created as a draft. Add genuine photos, review the weekly schedule, then submit it for approval.');
      await openListing(data.listing.id);
    } catch (requestError) { setError(requestError.message || 'Unable to create the listing.'); }
    finally { setBusy(false); }
  }

  async function saveListing(event) {
    event.preventDefault(); if (!selectedId) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const payload = apiFormPayload(form);
      const data = await apiRequest(`/api/marketplace/listings/${selectedId}`, { method: 'PATCH', body: JSON.stringify(payload) });
      setDetails((old) => ({ ...old, listing: data.listing }));
      setNotice('Listing details saved.');
      await reloadMine();
    } catch (requestError) { setError(requestError.message || 'Unable to save listing details.'); }
    finally { setBusy(false); }
  }

  async function saveSchedule(event) {
    event.preventDefault(); if (!selectedId) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const payload = { rules: schedule.map((rule) => ({ weekday: rule.weekday, isAvailable: rule.isAvailable, opensAt: rule.isAvailable ? rule.opensAt : null, closesAt: rule.isAvailable ? rule.closesAt : null })) };
      const data = await apiRequest(`/api/marketplace/listings/${selectedId}/availability`, { method: 'PUT', body: JSON.stringify(payload) });
      setSchedule(toSchedule(data.availability)); setNotice('Weekly availability saved.');
    } catch (requestError) { setError(requestError.message || 'Unable to save availability.'); }
    finally { setBusy(false); }
  }

  async function uploadPhotos(event) {
    event.preventDefault(); if (!selectedId || !photoFiles.length) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const body = new FormData(); photoFiles.forEach((file) => body.append('photos', file));
      const data = await apiRequest(`/api/marketplace/listings/${selectedId}/photos`, { method: 'POST', body });
      setPhotoFiles([]); setNotice(data.message || 'Photos uploaded.'); await openListing(selectedId); await reloadMine();
    } catch (requestError) { setError(requestError.message || 'Unable to upload photos.'); }
    finally { setBusy(false); }
  }

  async function deletePhoto(photoId) {
    if (!selectedId || !window.confirm('Remove this photo from the listing?')) return;
    setBusy(true); setError(''); setNotice('');
    try { await apiRequest(`/api/marketplace/listings/${selectedId}/photos/${photoId}`, { method: 'DELETE' }); setNotice('Photo removed.'); await openListing(selectedId); await reloadMine(); }
    catch (requestError) { setError(requestError.message || 'Unable to remove photo.'); }
    finally { setBusy(false); }
  }

  async function saveRate(event) {
    event.preventDefault(); if (!selectedId) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const payload = { rateType: rateForm.rateType, amount: Number(rateForm.amount), serviceFee: Number(rateForm.serviceFee || 0), taxRatePercent: Number(rateForm.taxRatePercent || 0), slotId: null };
      const data = await apiRequest(`/api/parking/lots/${selectedId}/pricing`, { method: 'POST', body: JSON.stringify(payload) });
      setNotice(`${label(data.pricingRule.rateType)} price saved.`); await openListing(selectedId); await reloadMine();
    } catch (requestError) { setError(requestError.message || 'Unable to save pricing.'); }
    finally { setBusy(false); }
  }

  async function submitForApproval() {
    if (!selectedId) return;
    setBusy(true); setError(''); setNotice('');
    try { const data = await apiRequest(`/api/marketplace/listings/${selectedId}/submit-for-approval`, { method: 'POST', body: JSON.stringify({}) }); setNotice(data.message); await openListing(selectedId); await reloadMine(); }
    catch (requestError) { setError(requestError.message || 'Unable to submit listing.'); }
    finally { setBusy(false); }
  }

  async function moderateListing(status) {
    if (!selectedId) return;
    setBusy(true); setError(''); setNotice('');
    try { const data = await apiRequest(`/api/parking/lots/${selectedId}/status`, { method: 'PATCH', body: JSON.stringify({ facilityStatus: status }) }); setNotice(data.message || `Listing ${label(status).toLowerCase()}.`); await openListing(selectedId); await reloadMine(); }
    catch (requestError) { setError(requestError.message || 'Unable to change listing status.'); }
    finally { setBusy(false); }
  }

  const pageHeading = creating ? 'Create a shared-space listing' : selectedListing ? selectedListing.name : 'My listings';

  return <section className="sp-page sp-marketplace-page">
    <div className="sp-page-heading">
      <div className="sp-heading-title-row"><div><p className="sp-kicker">HOST MARKETPLACE</p><h1>{pageHeading}</h1><p>Publish private spaces, set availability and manage your parking listings.</p></div>
        {selectedListing || creating ? <button className="sp-button ghost" onClick={() => { setSelectedId(''); setDetails(null); setCreating(false); setError(''); setNotice(''); }}><ArrowLeft size={15} /> All listings</button> : <button className="sp-button primary" onClick={() => { setCreating(true); setDetails(null); setSelectedId(''); setForm(DEFAULT_FORM); setError(''); setNotice(''); }}><Plus size={15} /> Add parking space</button>}
      </div>
    </div>
    {error && <div className="sp-alert error"><CircleAlert size={17} /><span>{error}</span><button onClick={() => setError('')} aria-label="Dismiss error"><X size={14} /></button></div>}
    {notice && <div className="sp-alert success"><Check size={17} /><span>{notice}</span><button onClick={() => setNotice('')} aria-label="Dismiss notice"><X size={14} /></button></div>}
    {loadingDetails && <div className="sp-loading"><LoaderCircle className="sp-spin" size={20} /> Loading listing details…</div>}

    {creating && <article className="sp-panel sp-market-panel">
      <div className="sp-panel-header"><div><p className="sp-kicker">NEW HOST LISTING</p><h2>Tell drivers about your parking space</h2><p>Create a draft first. Photos and a complete schedule are required before administrator review.</p></div><ParkingSquare size={21} /></div>
      <form className="sp-form" onSubmit={createListing}>
        <div className="sp-form-grid sp-market-form-grid">
          <label>Listing title<input name="name" value={form.name} onChange={updateForm} required minLength={2} maxLength={160} placeholder="e.g. Covered driveway near metro" /></label>
          <label>Parking type<select name="parkingType" value={form.parkingType} onChange={updateForm}><option value="driveway">Driveway</option><option value="garage">Garage</option><option value="covered_lot">Covered lot</option><option value="outdoor_lot">Outdoor lot</option><option value="private_bay">Private bay</option><option value="commercial">Commercial car park</option><option value="other">Other</option></select></label>
          <label>Street address<input name="addressLine" value={form.addressLine} onChange={updateForm} required minLength={3} maxLength={255} placeholder="Address or nearby landmark" /></label>
          <label>City<input name="city" value={form.city} onChange={updateForm} required maxLength={100} placeholder="City" /></label>
          <label>State / region<input name="region" value={form.region} onChange={updateForm} maxLength={100} placeholder="State or region" /></label>
          <label>Postal code<input name="postalCode" value={form.postalCode} onChange={updateForm} maxLength={20} placeholder="Postal code" /></label>
          <label>Contact phone<input name="contactPhone" value={form.contactPhone} onChange={updateForm} maxLength={30} placeholder="Optional contact number" /></label>
          <label>Vehicle compatibility<select name="vehicleType" value={form.vehicleType} onChange={updateForm}><option value="any">Any supported vehicle</option><option value="motorcycle">Motorcycle</option><option value="car">Car</option><option value="suv">SUV</option><option value="van">Van</option><option value="truck">Truck</option><option value="other">Other</option></select></label>
          <label>Number of spaces<input name="numberSpaces" type="number" min="1" max="100" step="1" required value={form.numberSpaces} onChange={updateForm} /></label>
          <label>Opening time<input name="openingTime" type="time" required value={form.openingTime} onChange={updateForm} /></label>
          <label>Closing time<input name="closingTime" type="time" required value={form.closingTime} onChange={updateForm} /></label>
          <label>Currency<select name="currency" value={form.currency} onChange={updateForm}><option value="INR">INR — Indian Rupee</option><option value="USD">USD — US Dollar</option><option value="EUR">EUR — Euro</option><option value="GBP">GBP — Pound Sterling</option></select></label>
          <label>Latitude <span className="sp-optional">Optional</span><input name="latitude" type="number" step="any" min="-90" max="90" value={form.latitude} onChange={updateForm} placeholder="12.9716" /></label>
          <label>Longitude <span className="sp-optional">Optional</span><input name="longitude" type="number" step="any" min="-180" max="180" value={form.longitude} onChange={updateForm} placeholder="77.5946" /></label>
          <label className="sp-span-full">Description<textarea name="description" rows="3" value={form.description} onChange={updateForm} maxLength={5000} placeholder="Describe the entrance, vehicle size, nearby landmarks and useful information." /></label>
          <label className="sp-span-full">Special instructions<textarea name="specialInstructions" rows="2" value={form.specialInstructions} onChange={updateForm} maxLength={2000} placeholder="Entry gate, access code process, height restrictions or other instructions." /></label>
          <div className="sp-span-full"><span className="sp-field-title">Amenities</span><AmenityChecks value={form.amenities} onChange={(amenities) => setForm((old) => ({ ...old, amenities }))} /></div>
          <div className="sp-market-rate-block sp-span-full"><div><strong>Pricing</strong><p>Hourly pricing is required. Other rate periods are optional.</p></div><div className="sp-form-grid sp-market-rate-grid">
            <label>Hourly rate<input type="number" min="0" max="10000000" step="0.01" required value={form.hourlyRate} onChange={updateForm} name="hourlyRate" /></label>
            <label>Daily rate <span className="sp-optional">Optional</span><input type="number" min="0" max="10000000" step="0.01" value={form.dailyRate} onChange={updateForm} name="dailyRate" /></label>
            <label>Weekly rate <span className="sp-optional">Optional</span><input type="number" min="0" max="10000000" step="0.01" value={form.weeklyRate} onChange={updateForm} name="weeklyRate" /></label>
            <label>Monthly rate <span className="sp-optional">Optional</span><input type="number" min="0" max="10000000" step="0.01" value={form.monthlyRate} onChange={updateForm} name="monthlyRate" /></label>
            <label>Service fee<input type="number" min="0" max="1000000" step="0.01" value={form.serviceFee} onChange={updateForm} name="serviceFee" /></label>
            <label>Tax rate (%)<input type="number" min="0" max="100" step="0.01" value={form.taxRatePercent} onChange={updateForm} name="taxRatePercent" /></label>
          </div></div>
        </div>
        <div className="sp-form-actions"><span className="sp-form-hint">Creates the spaces, price rules and default 7-day schedule. It remains a draft until submitted and approved.</span><button className="sp-button primary" disabled={busy}>{busy ? <LoaderCircle className="sp-spin" size={15} /> : <Plus size={15} />} Create draft listing</button></div>
      </form>
    </article>}

    {!creating && !selectedListing && !loadingDetails && <>
      <div className="sp-market-toolbar"><label className="sp-market-search"><MapPin size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search your listings" aria-label="Search listings" /></label><button className="sp-button ghost" onClick={reloadMine} disabled={loading}><RefreshCw size={14} /> Refresh</button></div>
      {loading ? <div className="sp-loading"><LoaderCircle className="sp-spin" size={20} /> Loading listings…</div> : filteredListings.length ? <div className="sp-market-list-grid">{filteredListings.map((listing) => <article className="sp-market-list-card" key={listing.id}>
        <button className="sp-market-card-image" onClick={() => openListing(listing.id)} aria-label={`Manage ${listing.name}`}>{listing.coverPhoto ? <img src={listing.coverPhoto} alt={listing.name} /> : <span><ImagePlus size={30} /><small>Upload a space photo</small></span>}<b className={`sp-facility-status ${listing.facilityStatus}`}>{label(listing.facilityStatus)}</b></button>
        <div className="sp-market-card-content"><div className="sp-market-card-heading"><div><h3>{listing.name}</h3><p><MapPin size={13} /> {listing.city}, {listing.region || listing.countryCode}</p></div><span className="sp-market-type">{label(listing.parkingType)}</span></div>
          <div className="sp-market-card-stats"><span><ParkingSquare size={14} /> {listing.totalSpaces} spaces</span><span><Camera size={14} /> {listing.photoCount}/8 photos</span></div>
          <div className="sp-market-card-bottom"><strong>{money(listing.hourlyRate, listing.currency)}<small>/ hour</small></strong><button className="sp-button secondary" onClick={() => openListing(listing.id)}>Manage listing <ArrowUpRight size={14} /></button></div>
        </div>
      </article>)}</div> : <div className="sp-empty-state sp-empty-panel"><ParkingSquare size={32} /><strong>{listings.length ? 'No listings match your search' : 'Your parking marketplace starts here'}</strong><span>{listings.length ? 'Try a different name or city.' : 'Publish a private driveway, garage or reserved bay so drivers can discover and book it.'}</span>{!listings.length && <button className="sp-button primary" onClick={() => { setCreating(true); setForm(DEFAULT_FORM); }}><Plus size={15} /> Create your first listing</button>}</div>}
    </>}

    {selectedListing && !loadingDetails && <>
      <div className="sp-market-detail-banner"><div className="sp-market-detail-photo">{selectedListing.coverPhoto ? <img src={selectedListing.coverPhoto} alt={selectedListing.name} /> : <ParkingSquare size={32} />}</div><div className="sp-market-detail-copy"><span className={`sp-facility-status ${selectedListing.facilityStatus}`}>{label(selectedListing.facilityStatus)}</span><h2>{selectedListing.name}</h2><p><MapPin size={14} /> {selectedListing.addressLine}, {selectedListing.city}</p><div className="sp-market-detail-tags"><span>{label(selectedListing.parkingType)}</span><span>{selectedListing.totalSpaces} parking space{selectedListing.totalSpaces === 1 ? '' : 's'}</span><span>{selectedListing.photoCount} photos</span></div></div></div>
      <article className="sp-panel sp-market-panel"><div className="sp-panel-header"><div><p className="sp-kicker">LISTING PROFILE</p><h2>Space details</h2><p>Keep the location, amenities and instructions accurate for drivers.</p></div><Save size={20} /></div>
        <form className="sp-form" onSubmit={saveListing}><div className="sp-form-grid sp-market-form-grid">
          <label>Listing title<input name="name" value={form.name} onChange={updateForm} required minLength={2} maxLength={160} /></label>
          <label>Parking type<select name="parkingType" value={form.parkingType} onChange={updateForm}><option value="driveway">Driveway</option><option value="garage">Garage</option><option value="covered_lot">Covered lot</option><option value="outdoor_lot">Outdoor lot</option><option value="private_bay">Private bay</option><option value="commercial">Commercial car park</option><option value="other">Other</option></select></label>
          <label>Street address<input name="addressLine" value={form.addressLine} onChange={updateForm} required /></label><label>City<input name="city" value={form.city} onChange={updateForm} required /></label>
          <label>State / region<input name="region" value={form.region} onChange={updateForm} /></label><label>Postal code<input name="postalCode" value={form.postalCode} onChange={updateForm} /></label>
          <label>Contact phone<input name="contactPhone" value={form.contactPhone} onChange={updateForm} maxLength={30} /></label>
          <label>Opening time<input type="time" name="openingTime" value={form.openingTime} onChange={updateForm} required /></label><label>Closing time<input type="time" name="closingTime" value={form.closingTime} onChange={updateForm} required /></label>
          <label>Latitude<input type="number" step="any" name="latitude" value={form.latitude} onChange={updateForm} /></label><label>Longitude<input type="number" step="any" name="longitude" value={form.longitude} onChange={updateForm} /></label>
          <label className="sp-span-full">Description<textarea rows="3" name="description" value={form.description} onChange={updateForm} maxLength={5000} /></label>
          <label className="sp-span-full">Special instructions<textarea rows="2" name="specialInstructions" value={form.specialInstructions} onChange={updateForm} maxLength={2000} /></label>
          <div className="sp-span-full"><span className="sp-field-title">Amenities</span><AmenityChecks value={form.amenities} onChange={(amenities) => setForm((old) => ({ ...old, amenities }))} /></div>
        </div><div className="sp-form-actions"><span className="sp-form-hint">Changes are saved to the listing profile; pricing and weekly availability are edited separately below.</span><button className="sp-button primary" disabled={busy}><Save size={15} /> Save details</button></div></form>
      </article>

      <article className="sp-panel sp-market-panel"><div className="sp-panel-header"><div><p className="sp-kicker">LISTING PHOTOS</p><h2>Photos of the space</h2><p>Upload genuine JPEG, PNG or WebP images. Maximum eight photos, 5 MB each.</p></div><Camera size={20} /></div>
        <div className="sp-market-photo-grid">{(details.photos ?? []).map((photo) => <div className="sp-market-photo" key={photo.id}><img src={photo.publicUrl} alt={photo.altText} /><button className="sp-market-photo-delete" onClick={() => deletePhoto(photo.id)} disabled={busy} aria-label="Delete photo"><Trash2 size={14} /></button></div>)}{!(details.photos ?? []).length && <div className="sp-market-photo-empty"><ImagePlus size={26} /><span>No photos uploaded yet. Add a real photo to support review and help drivers identify the space.</span></div>}</div>
        <form className="sp-market-upload" onSubmit={uploadPhotos}><label><UploadCloud size={17} /><span>{photoFiles.length ? `${photoFiles.length} photo(s) selected` : 'Choose photo files'}</span><input type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={(event) => setPhotoFiles(Array.from(event.target.files ?? []).slice(0, 8))} /></label><button className="sp-button secondary" disabled={busy || !photoFiles.length}><UploadCloud size={14} /> Upload photos</button></form>
      </article>

      <article className="sp-panel sp-market-panel"><div className="sp-panel-header"><div><p className="sp-kicker">WEEKLY SCHEDULE</p><h2>Availability by day</h2><p>Choose when drivers can arrive. Overnight windows are not supported by this schedule version.</p></div><CalendarClock size={20} /></div>
        <form onSubmit={saveSchedule} className="sp-market-schedule-form"><div className="sp-market-schedule-list">{schedule.map((rule) => <div className={`sp-market-schedule-row ${rule.isAvailable ? '' : 'closed'}`} key={rule.weekday}>
          <label className="sp-market-day-toggle"><input type="checkbox" checked={rule.isAvailable} onChange={(event) => setSchedule((old) => old.map((item) => item.weekday === rule.weekday ? { ...item, isAvailable: event.target.checked } : item))} /><strong>{WEEKDAYS[rule.weekday].label}</strong></label>
          <span className="sp-market-schedule-state">{rule.isAvailable ? 'Available' : 'Closed'}</span>
          <label>Opens<input type="time" disabled={!rule.isAvailable} required={rule.isAvailable} value={rule.opensAt} onChange={(event) => setSchedule((old) => old.map((item) => item.weekday === rule.weekday ? { ...item, opensAt: event.target.value } : item))} /></label>
          <label>Closes<input type="time" disabled={!rule.isAvailable} required={rule.isAvailable} value={rule.closesAt} onChange={(event) => setSchedule((old) => old.map((item) => item.weekday === rule.weekday ? { ...item, closesAt: event.target.value } : item))} /></label>
        </div>)}</div><div className="sp-form-actions"><span className="sp-form-hint">All seven days are required. Closed days are saved as unavailable.</span><button className="sp-button primary" disabled={busy}><Save size={15} /> Save schedule</button></div></form>
      </article>

      <article className="sp-panel sp-market-panel"><div className="sp-panel-header"><div><p className="sp-kicker">FLEXIBLE PRICING</p><h2>Hourly, daily and longer stays</h2><p>Rates apply to the whole listing. Slot-specific prices can be managed in Parking spaces.</p></div><Clock3 size={20} /></div>
        <div className="sp-market-rate-chips">{(details.pricingRules ?? []).filter((rule) => rule.isActive).map((rule) => <div key={rule.id}><span>{label(rule.rateType)}</span><strong>{money(rule.amount, rule.currency)}</strong><small>Fee {money(rule.serviceFee, rule.currency)} · tax {rule.taxRatePercent}%</small></div>)}{!(details.pricingRules ?? []).some((rule) => rule.isActive) && <p>No active rates configured.</p>}</div>
        <form className="sp-form" onSubmit={saveRate}><div className="sp-form-grid sp-market-rate-grid">
          <label>Rate type<select value={rateForm.rateType} onChange={(event) => setRateForm((old) => ({ ...old, rateType: event.target.value }))}><option value="hourly">Hourly</option><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option></select></label>
          <label>Amount ({selectedListing.currency})<input type="number" min="0" max="10000000" step="0.01" required value={rateForm.amount} onChange={(event) => setRateForm((old) => ({ ...old, amount: event.target.value }))} /></label>
          <label>Service fee<input type="number" min="0" max="1000000" step="0.01" value={rateForm.serviceFee} onChange={(event) => setRateForm((old) => ({ ...old, serviceFee: event.target.value }))} /></label>
          <label>Tax rate (%)<input type="number" min="0" max="100" step="0.01" value={rateForm.taxRatePercent} onChange={(event) => setRateForm((old) => ({ ...old, taxRatePercent: event.target.value }))} /></label>
        </div><div className="sp-form-actions"><span className="sp-form-hint">Saving a rate replaces the active rule for that period while retaining old pricing records.</span><button className="sp-button secondary" disabled={busy}><Save size={15} /> Save rate</button></div></form>
      </article>

      <article className="sp-panel sp-market-submit-panel"><div className="sp-market-submit-icon"><FileCheck2 size={21} /></div><div><p className="sp-kicker">PUBLICATION WORKFLOW</p><h2>Review and publish</h2><p>Listings require at least one photo, one parking space, an active hourly rate and all seven weekly schedule rows before administrator review.</p></div>
        <div className="sp-market-submit-actions">{selectedListing.facilityStatus === 'draft' || selectedListing.facilityStatus === 'paused' ? <button className="sp-button primary" onClick={submitForApproval} disabled={busy}><ShieldCheck size={15} /> Submit for approval</button> : selectedListing.facilityStatus === 'pending_approval' && isAdmin ? <button className="sp-button primary" onClick={() => moderateListing('active')} disabled={busy}><BadgeCheck size={15} /> Approve & publish</button> : selectedListing.facilityStatus === 'pending_approval' ? <span className="sp-market-pending-note">Waiting for administrator review.</span> : selectedListing.facilityStatus === 'active' && isAdmin ? <button className="sp-button ghost" onClick={() => moderateListing('paused')} disabled={busy}>Pause listing</button> : <span className="sp-market-pending-note">Listing status: {label(selectedListing.facilityStatus)}</span>}</div>
      </article>
    </>}
    <div className="sp-page-footer"><span><ShieldCheck size={14} /> Photos are public listing assets. Do not upload IDs, payment cards or other sensitive documents.</span><button className="sp-button ghost" onClick={reloadMine} disabled={loading}><RefreshCw size={14} /> Refresh</button></div>
  </section>;
}
