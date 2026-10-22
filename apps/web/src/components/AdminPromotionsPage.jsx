import { useCallback, useEffect, useState } from 'react';
import { BadgePercent, CircleAlert, CircleCheck, LoaderCircle, Plus, RefreshCw, ShieldCheck, ToggleLeft, ToggleRight } from 'lucide-react';

const initialForm = { code: '', description: '', discountType: 'percent', discountValue: '10', maxDiscountAmount: '', minBookingAmount: '0', currency: 'INR', maxRedemptions: '', maxRedemptionsPerUser: '1', startsAt: '', endsAt: '', isActive: true };
function money(value, currency = 'INR') { return new Intl.NumberFormat('en-IN', { style: 'currency', currency, maximumFractionDigits: 2 }).format(Number(value || 0)); }
function localToIso(value) { return value ? new Date(value).toISOString() : null; }

export default function AdminPromotionsPage() {
  const [promotions, setPromotions] = useState([]);
  const [form, setForm] = useState(initialForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const response = await fetch('/api/promotions/admin', { credentials: 'same-origin' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error?.message || 'Could not load promotions.');
      setPromotions(data.promotions ?? []);
    } catch (err) { setError(err.message || 'Could not load promotions.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function create(event) {
    event.preventDefault(); setSaving(true); setError(''); setNotice('');
    try {
      const payload = { ...form, discountValue: Number(form.discountValue), maxDiscountAmount: form.maxDiscountAmount ? Number(form.maxDiscountAmount) : null, minBookingAmount: Number(form.minBookingAmount), maxRedemptions: form.maxRedemptions ? Number(form.maxRedemptions) : null, maxRedemptionsPerUser: Number(form.maxRedemptionsPerUser), startsAt: localToIso(form.startsAt), endsAt: localToIso(form.endsAt) };
      const response = await fetch('/api/promotions/admin', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error?.message || 'Could not create promotion.');
      setNotice(`Promotion ${data.promotion.code} created.`); setForm(initialForm); await load();
    } catch (err) { setError(err.message || 'Could not create promotion.'); }
    finally { setSaving(false); }
  }

  async function toggle(promo) {
    setError(''); setNotice('');
    try {
      const response = await fetch(`/api/promotions/admin/${promo.id}`, { method: 'PATCH', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ isActive: !promo.isActive }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error?.message || 'Could not update promotion.');
      setNotice(`${promo.code} ${promo.isActive ? 'deactivated' : 'activated'}.`); await load();
    } catch (err) { setError(err.message || 'Could not update promotion.'); }
  }

  return <section className="sp-page">
    <div className="sp-page-heading"><div><p className="sp-kicker">ADMINISTRATION</p><h1>Promotions & discount codes</h1><p>Create server-validated offers for drivers and track redemption limits.</p></div><button className="sp-button ghost" onClick={load} disabled={loading}><RefreshCw size={14} /> Refresh</button></div>
    {error && <div className="sp-alert error"><CircleAlert size={17} /><span>{error}</span></div>}
    {notice && <div className="sp-alert success"><CircleCheck size={17} /><span>{notice}</span></div>}
    <article className="sp-panel"><div className="sp-panel-header"><div><p className="sp-kicker">NEW OFFER</p><h2>Create a promotion</h2><p>Discounts apply to the parking charge; tax is recalculated by the API.</p></div><BadgePercent size={24} /></div>
      <form className="sp-promotion-form" onSubmit={create}>
        <label>Promotion code<input required minLength={3} maxLength={32} pattern="[A-Za-z0-9_-]+" value={form.code} onChange={e=>setForm(v=>({...v,code:e.target.value.toUpperCase()}))} placeholder="WELCOME10" /></label>
        <label>Description<input maxLength={240} value={form.description} onChange={e=>setForm(v=>({...v,description:e.target.value}))} placeholder="Welcome offer for new drivers" /></label>
        <label>Discount type<select value={form.discountType} onChange={e=>setForm(v=>({...v,discountType:e.target.value}))}><option value="percent">Percentage</option><option value="fixed">Fixed amount</option></select></label>
        <label>Discount value<input type="number" required min="0.01" max={form.discountType === 'percent' ? '100' : '1000000'} step="0.01" value={form.discountValue} onChange={e=>setForm(v=>({...v,discountValue:e.target.value}))} /></label>
        <label>Maximum discount <span className="sp-optional">Optional</span><input type="number" min="0.01" step="0.01" value={form.maxDiscountAmount} onChange={e=>setForm(v=>({...v,maxDiscountAmount:e.target.value}))} placeholder="No cap" /></label>
        <label>Minimum parking charge<input type="number" min="0" step="0.01" required value={form.minBookingAmount} onChange={e=>setForm(v=>({...v,minBookingAmount:e.target.value}))} /></label>
        <label>Currency<input required minLength={3} maxLength={3} value={form.currency} onChange={e=>setForm(v=>({...v,currency:e.target.value.toUpperCase()}))} /></label>
        <label>Total redemptions <span className="sp-optional">Optional</span><input type="number" min="1" step="1" value={form.maxRedemptions} onChange={e=>setForm(v=>({...v,maxRedemptions:e.target.value}))} placeholder="Unlimited" /></label>
        <label>Uses per driver<input type="number" required min="1" max="100" step="1" value={form.maxRedemptionsPerUser} onChange={e=>setForm(v=>({...v,maxRedemptionsPerUser:e.target.value}))} /></label>
        <label>Starts <span className="sp-optional">Optional</span><input type="datetime-local" value={form.startsAt} onChange={e=>setForm(v=>({...v,startsAt:e.target.value}))} /></label>
        <label>Ends <span className="sp-optional">Optional</span><input type="datetime-local" value={form.endsAt} onChange={e=>setForm(v=>({...v,endsAt:e.target.value}))} /></label>
        <label className="sp-promotion-active"><input type="checkbox" checked={form.isActive} onChange={e=>setForm(v=>({...v,isActive:e.target.checked}))} /> Active immediately when within the date window</label>
        <div className="sp-promotion-form-actions"><button className="sp-button primary" disabled={saving}>{saving ? <LoaderCircle className="sp-spin" size={15} /> : <Plus size={15} />}{saving ? 'Creating…' : 'Create promotion'}</button></div>
      </form>
    </article>
    <article className="sp-panel"><div className="sp-panel-header"><div><p className="sp-kicker">PROMOTION INVENTORY</p><h2>Existing codes</h2><p>Redemption counts include verified uses and unexpired booking holds.</p></div><ShieldCheck size={23} /></div>
      {loading ? <div className="sp-loading"><LoaderCircle className="sp-spin" size={18} /> Loading promotions…</div> : promotions.length ? <div className="sp-promotion-list">{promotions.map(promo=><div className="sp-promotion-row" key={promo.id}><div className="sp-promotion-code"><strong>{promo.code}</strong><small>{promo.description || 'No description'}</small></div><div><strong>{promo.discountType === 'percent' ? `${promo.discountValue}% off` : `${money(promo.discountValue,promo.currency)} off`}</strong><small>Minimum {money(promo.minBookingAmount,promo.currency)}{promo.maxDiscountAmount ? ` · Max ${money(promo.maxDiscountAmount,promo.currency)}` : ''}</small></div><div><strong>{promo.usedCount ?? 0}{promo.maxRedemptions ? ` / ${promo.maxRedemptions}` : ''}</strong><small>redemptions</small></div><span className={`sp-facility-status ${promo.isActive ? 'active' : 'paused'}`}>{promo.isActive ? 'Active' : 'Inactive'}</span><button className="sp-button ghost" onClick={()=>toggle(promo)}>{promo.isActive ? <ToggleRight size={15}/> : <ToggleLeft size={15}/>} {promo.isActive ? 'Deactivate' : 'Activate'}</button></div>)}</div> : <p className="muted-copy">No promotion codes have been created yet.</p>}
    </article>
  </section>;
}
