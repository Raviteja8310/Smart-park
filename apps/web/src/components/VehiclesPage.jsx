import { useCallback, useEffect, useState } from 'react';
import { CarFront, Check, CircleAlert, LoaderCircle, Pencil, Plus, RefreshCw, Save, Star, Trash2, X } from 'lucide-react';

const emptyVehicle = { registrationNumber: '', make: '', model: '', vehicleType: 'car', color: '', modelYear: '', isDefault: false };
async function apiRequest(path, options = {}) {
  const response = await fetch(path, { credentials: 'same-origin', ...options, headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers ?? {}) } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message ?? 'The request could not be completed.');
  return data;
}
function vehiclePayload(form) { return { ...form, registrationNumber: form.registrationNumber.trim().toUpperCase(), make: form.make.trim() || null, model: form.model.trim() || null, color: form.color.trim() || null, modelYear: form.modelYear ? Number(form.modelYear) : null }; }
function vehicleName(vehicle) { return [vehicle.make, vehicle.model].filter(Boolean).join(' ') || vehicle.vehicleType.replaceAll('_', ' '); }

export default function VehiclesPage() {
  const [vehicles, setVehicles] = useState([]);
  const [form, setForm] = useState(emptyVehicle);
  const [editingId, setEditingId] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const reload = useCallback(async () => {
    setLoading(true); setError('');
    try { const data = await apiRequest('/api/vehicles/mine'); setVehicles(data.vehicles ?? []); }
    catch (requestError) { setError(requestError.message || 'Unable to load your vehicle garage.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { reload(); }, [reload]);
  const update = (event) => setForm((old) => ({ ...old, [event.target.name]: event.target.type === 'checkbox' ? event.target.checked : event.target.value }));
  function startEdit(vehicle) {
    setEditingId(vehicle.id); setShowForm(true); setError(''); setNotice('');
    setForm({ registrationNumber: vehicle.registrationNumber, make: vehicle.make ?? '', model: vehicle.model ?? '', vehicleType: vehicle.vehicleType, color: vehicle.color ?? '', modelYear: vehicle.modelYear ? String(vehicle.modelYear) : '', isDefault: vehicle.isDefault });
  }
  function startCreate() { setEditingId(''); setForm(emptyVehicle); setShowForm(true); setError(''); setNotice(''); }
  async function save(event) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      const payload = vehiclePayload(form);
      const data = await apiRequest(editingId ? `/api/vehicles/${editingId}` : '/api/vehicles', { method: editingId ? 'PATCH' : 'POST', body: JSON.stringify(payload) });
      setNotice(data.message ?? 'Vehicle saved.'); setShowForm(false); setEditingId(''); setForm(emptyVehicle); await reload();
    } catch (requestError) { setError(requestError.message || 'Unable to save vehicle.'); }
    finally { setBusy(false); }
  }
  async function makeDefault(vehicle) {
    setBusy(true); setError(''); setNotice('');
    try { const data = await apiRequest(`/api/vehicles/${vehicle.id}`, { method: 'PATCH', body: JSON.stringify({ isDefault: true }) }); setNotice(data.message ?? 'Default vehicle updated.'); await reload(); }
    catch (requestError) { setError(requestError.message || 'Unable to set default vehicle.'); }
    finally { setBusy(false); }
  }
  async function remove(vehicle) {
    if (!window.confirm(`Remove ${vehicle.registrationNumber} from your vehicle garage?`)) return;
    setBusy(true); setError(''); setNotice('');
    try { const data = await apiRequest(`/api/vehicles/${vehicle.id}`, { method: 'DELETE' }); setNotice(data.message ?? 'Vehicle removed.'); await reload(); }
    catch (requestError) { setError(requestError.message || 'Unable to remove vehicle.'); }
    finally { setBusy(false); }
  }

  return <section className="sp-page sp-bookings-page sp-vehicles-page">
    <div className="sp-page-heading"><div className="sp-heading-title-row"><div><p className="sp-kicker">DRIVER PROFILE</p><h1>My vehicles</h1><p>Save your vehicle details once and use them for parking reservations.</p></div><div className="sp-heading-actions"><button className="sp-button ghost" onClick={reload} disabled={loading}><RefreshCw size={14} /> Refresh</button><button className="sp-button primary" onClick={startCreate}><Plus size={15} /> Add vehicle</button></div></div></div>
    {error && <div className="sp-alert error"><CircleAlert size={17} /><span>{error}</span><button onClick={() => setError('')} aria-label="Dismiss error"><X size={14} /></button></div>}
    {notice && <div className="sp-alert success"><Check size={17} /><span>{notice}</span><button onClick={() => setNotice('')} aria-label="Dismiss notice"><X size={14} /></button></div>}
    <div className="sp-booking-summary-grid"><article><span>Registered vehicles</span><strong>{vehicles.length}</strong><small>Up to 20 vehicles per account</small></article><article><span>Default vehicle</span><strong className="sp-vehicle-default-value">{vehicles.find((vehicle) => vehicle.isDefault)?.registrationNumber ?? '—'}</strong><small>Used as the preferred reservation vehicle</small></article><article><span>Vehicle profiles</span><strong>{new Set(vehicles.map((vehicle) => vehicle.vehicleType)).size}</strong><small>Distinct vehicle categories</small></article></div>
    {showForm && <article className="sp-panel sp-market-panel"><div className="sp-panel-header"><div><p className="sp-kicker">VEHICLE DETAILS</p><h2>{editingId ? 'Edit vehicle' : 'Register a vehicle'}</h2><p>Use the correct registration number so parking staff can match your booking.</p></div><CarFront size={21} /></div>
      <form className="sp-form" onSubmit={save}><div className="sp-form-grid sp-market-form-grid">
        <label>Registration number<input name="registrationNumber" value={form.registrationNumber} onChange={update} required minLength={2} maxLength={24} placeholder="KA01AB1234" /></label>
        <label>Vehicle type<select name="vehicleType" value={form.vehicleType} onChange={update}><option value="motorcycle">Motorcycle</option><option value="car">Car</option><option value="suv">SUV</option><option value="van">Van</option><option value="truck">Truck</option><option value="other">Other</option></select></label>
        <label>Make<input name="make" value={form.make} onChange={update} maxLength={80} placeholder="e.g. Honda" /></label>
        <label>Model<input name="model" value={form.model} onChange={update} maxLength={80} placeholder="e.g. City" /></label>
        <label>Color<input name="color" value={form.color} onChange={update} maxLength={40} placeholder="e.g. White" /></label>
        <label>Model year<input name="modelYear" type="number" min="1950" max={new Date().getFullYear() + 2} value={form.modelYear} onChange={update} /></label>
        <label className="sp-market-default-toggle"><input type="checkbox" name="isDefault" checked={form.isDefault} onChange={update} /> Make this my default vehicle</label>
      </div><div className="sp-form-actions"><button type="button" className="sp-button ghost" onClick={() => { setShowForm(false); setEditingId(''); }}><X size={14} /> Cancel</button><button className="sp-button primary" disabled={busy}>{busy ? <LoaderCircle className="sp-spin" size={15} /> : <Save size={15} />} {editingId ? 'Save changes' : 'Add vehicle'}</button></div></form>
    </article>}
    <article className="sp-panel"><div className="sp-panel-header"><div><p className="sp-kicker">YOUR GARAGE</p><h2>Saved vehicles</h2><p>Only you can view or change vehicles associated with your account.</p></div><CarFront size={20} /></div>
      {loading ? <div className="sp-loading"><LoaderCircle className="sp-spin" size={20} /> Loading your vehicles…</div> : vehicles.length ? <div className="sp-vehicle-grid">{vehicles.map((vehicle) => <article className="sp-vehicle-card" key={vehicle.id}><div className="sp-vehicle-icon"><CarFront size={23} /></div><div className="sp-vehicle-card-title"><div><h3>{vehicleName(vehicle)}</h3><span>{vehicle.registrationNumber}</span></div>{vehicle.isDefault && <span className="sp-vehicle-default"><Star size={12} fill="currentColor" /> Default</span>}</div><div className="sp-vehicle-tags"><span>{vehicle.vehicleType.replaceAll('_', ' ')}</span>{vehicle.color && <span>{vehicle.color}</span>}{vehicle.modelYear && <span>{vehicle.modelYear}</span>}</div><div className="sp-vehicle-actions"><button className="sp-button ghost" onClick={() => startEdit(vehicle)}><Pencil size={14} /> Edit</button>{!vehicle.isDefault && <button className="sp-button ghost" onClick={() => makeDefault(vehicle)} disabled={busy}><Star size={14} /> Set default</button>}<button className="sp-button danger" onClick={() => remove(vehicle)} disabled={busy}><Trash2 size={14} /> Remove</button></div></article>)}</div> : <div className="sp-empty-state sp-empty-panel"><CarFront size={31} /><strong>No vehicles registered yet</strong><span>Add the vehicle you use for parking. You can save registration, type, make, model and color.</span><button className="sp-button primary" onClick={startCreate}><Plus size={15} /> Add first vehicle</button></div>}
    </article>
    <div className="sp-page-footer"><span><CarFront size={14} /> Registration numbers are normalized and must be unique.</span></div>
  </section>;
}
