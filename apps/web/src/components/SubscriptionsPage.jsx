import { useEffect, useMemo, useState } from 'react';
import { CalendarDays, Check, Clock3, RefreshCw, ShieldCheck, X } from 'lucide-react';

async function readJson(response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message ?? 'Could not complete the monthly pass request.');
  return data;
}
const money = (value, currency = 'INR') => new Intl.NumberFormat('en-IN', { style: 'currency', currency, maximumFractionDigits: 2 }).format(Number(value ?? 0));
const dateLabel = (value) => value ? new Date(`${String(value).slice(0, 10)}T12:00:00`).toLocaleDateString([], { dateStyle: 'medium' }) : '—';
const statusLabel = (status) => ({ pending: 'Awaiting owner review', approved: 'Owner approved · payment pending', rejected: 'Rejected', cancelled: 'Cancelled', expired: 'Expired' }[status] ?? status);

export default function SubscriptionsPage({ currentUser }) {
  const canReview = (currentUser?.roles ?? []).some((role) => ['host', 'admin'].includes(role));
  const [available, setAvailable] = useState([]);
  const [mine, setMine] = useState([]);
  const [ownerRequests, setOwnerRequests] = useState([]);
  const [selected, setSelected] = useState('');
  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 10));
  const [monthsCount, setMonthsCount] = useState('1');
  const [busy, setBusy] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function load() {
    setBusy(true); setError('');
    try {
      const [listingData, mineData, ownerData] = await Promise.all([
        fetch('/api/subscriptions/available', { credentials: 'same-origin' }).then(readJson),
        fetch('/api/subscriptions/me', { credentials: 'same-origin' }).then(readJson),
        canReview ? fetch('/api/subscriptions/owner', { credentials: 'same-origin' }).then(readJson) : Promise.resolve({ subscriptions: [] })
      ]);
      setAvailable(listingData.listings ?? []); setMine(mineData.subscriptions ?? []); setOwnerRequests(ownerData.subscriptions ?? []);
      setSelected((current) => current || listingData.listings?.[0]?.id || '');
    } catch (reason) { setError(reason.message); }
    finally { setBusy(false); }
  }
  useEffect(() => { load(); }, [currentUser?.id]);

  const chosen = useMemo(() => available.find((item) => item.id === selected), [available, selected]);
  const estimate = chosen ? Number(chosen.monthlyAmount) * Number(monthsCount) : 0;

  async function requestPass(event) {
    event.preventDefault(); setSaving(true); setError(''); setNotice('');
    try {
      const data = await readJson(await fetch('/api/subscriptions', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ parkingLotId: selected, startDate, monthsCount: Number(monthsCount) }) }));
      setNotice(`Monthly pass request submitted for ${data.subscription.parkingName}.`); await load();
    } catch (reason) { setError(reason.message); }
    finally { setSaving(false); }
  }
  async function reviewPass(id, decision) {
    const note = decision === 'rejected' ? window.prompt('Enter a reason for rejection:') : '';
    if (decision === 'rejected' && !note?.trim()) return;
    setSaving(true); setError(''); setNotice('');
    try {
      await readJson(await fetch(`/api/subscriptions/${id}/review`, { method: 'PATCH', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ decision, note: note ?? '' }) }));
      setNotice(decision === 'approved' ? 'Request approved. Payment is still pending.' : 'Request rejected.'); await load();
    } catch (reason) { setError(reason.message); }
    finally { setSaving(false); }
  }
  async function cancelPass(id) {
    if (!window.confirm('Cancel this unpaid monthly pass request?')) return;
    setSaving(true); setError('');
    try { await readJson(await fetch(`/api/subscriptions/${id}/cancel`, { method: 'POST', credentials: 'same-origin' })); setNotice('Monthly pass request cancelled.'); await load(); }
    catch (reason) { setError(reason.message); }
    finally { setSaving(false); }
  }

  return <section className="sp-account-page sp-subscriptions-page">
    <header><p className="section-kicker">PARK LONGER, PLAN EASIER</p><h1>Monthly passes</h1><p className="muted-copy">Request a monthly parking pass at eligible owner-listed spaces and track owner decisions in one place.</p></header>
    {error && <div className="auth-message error" role="alert">{error} <button className="sp-button" onClick={load}><RefreshCw size={14}/> Retry</button></div>}
    {notice && <div className="auth-message success" role="status">{notice}</div>}
    <div className="panel sp-account-card sp-subscription-note"><ShieldCheck size={20}/><div><strong>Transparent pass status</strong><p className="muted-copy">An owner-approved request is not yet a paid or active pass. Payment collection, recurring billing, and automatic renewal are not connected in this phase.</p></div></div>
    <div className="panel sp-account-card"><div className="sp-help-title"><CalendarDays size={22}/><div><h2>Find a monthly pass</h2><p className="muted-copy">Only approved listings with a monthly rate appear here.</p></div><button className="sp-button" onClick={load}><RefreshCw size={14}/> Refresh</button></div>
      {busy ? <p className="muted-copy">Loading monthly pass options…</p> : available.length === 0 ? <div className="sp-referral-empty"><CalendarDays size={25}/><strong>No monthly passes available</strong><p>Owners need to publish an approved listing with a monthly price first.</p></div> : <form className="sp-subscription-form" onSubmit={requestPass}>
        <label>Parking space<select value={selected} onChange={(event) => setSelected(event.target.value)} required>{available.map((listing) => <option key={listing.id} value={listing.id}>{listing.name} · {listing.city} · {money(listing.monthlyAmount, listing.currency)}/month</option>)}</select></label>
        {chosen && <p className="muted-copy">{chosen.addressLine}, {chosen.city} · Owner: {chosen.ownerName || 'SmartPark host'}</p>}
        <div className="sp-subscription-fields"><label>Start date<input type="date" value={startDate} min={new Date().toISOString().slice(0, 10)} onChange={(event) => setStartDate(event.target.value)} required /></label><label>Duration<select value={monthsCount} onChange={(event) => setMonthsCount(event.target.value)}>{Array.from({ length: 12 }, (_, index) => <option key={index + 1} value={String(index + 1)}>{index + 1} {index === 0 ? 'month' : 'months'}</option>)}</select></label></div>
        <div className="sp-subscription-estimate"><span>Estimated pass amount</span><strong>{money(estimate, chosen?.currency || 'INR')}</strong><small>Based on the current listed monthly rate. Final terms require owner approval.</small></div>
        <button className="sp-button primary" type="submit" disabled={saving || !selected || !startDate}>{saving ? 'Submitting…' : 'Request monthly pass'}</button>
      </form>}
    </div>
    <div className="panel sp-account-card"><div className="sp-help-title"><Clock3 size={22}/><div><h2>My monthly passes</h2><p className="muted-copy">Requests, approved terms, and status history.</p></div></div>
      {mine.length ? <div className="sp-subscription-list">{mine.map((pass) => <article className="sp-subscription-row" key={pass.id}><div><strong>{pass.parkingName}</strong><p className="muted-copy">{pass.city} · {dateLabel(pass.startDate)} – {dateLabel(pass.endDate)}</p><p className="muted-copy">{pass.monthsCount} month(s) · {money(pass.totalAmount, pass.currency)} · Payment: {pass.paymentStatus}</p>{pass.ownerNote && <p className="sp-subscription-owner-note">Owner note: {pass.ownerNote}</p>}<span className={`sp-referral-status ${pass.status}`}>{statusLabel(pass.status)}</span></div>{['pending', 'approved'].includes(pass.status) && pass.paymentStatus === 'unpaid' && <button className="sp-button" disabled={saving} onClick={() => cancelPass(pass.id)}><X size={14}/> Cancel</button>}</article>)}</div> : <div className="sp-referral-empty"><CalendarDays size={25}/><strong>No monthly pass requests</strong><p>Choose a listing above to request your first pass.</p></div>}
    </div>
    {canReview && <div className="panel sp-account-card"><div className="sp-help-title"><ShieldCheck size={22}/><div><h2>Owner review queue</h2><p className="muted-copy">Review requests for your listings. Administrators can see all requests.</p></div></div>
      {ownerRequests.filter((pass) => pass.status === 'pending').length ? <div className="sp-subscription-list">{ownerRequests.filter((pass) => pass.status === 'pending').map((pass) => <article className="sp-subscription-row" key={pass.id}><div><strong>{pass.parkingName}</strong><p className="muted-copy">Requested by {pass.userName || 'Driver'} · {dateLabel(pass.startDate)} – {dateLabel(pass.endDate)}</p><p className="muted-copy">{pass.monthsCount} month(s) · {money(pass.totalAmount, pass.currency)}</p></div><div className="sp-subscription-actions"><button className="sp-button primary" disabled={saving} onClick={() => reviewPass(pass.id, 'approved')}><Check size={14}/> Approve</button><button className="sp-button" disabled={saving} onClick={() => reviewPass(pass.id, 'rejected')}><X size={14}/> Reject</button></div></article>)}</div> : <p className="muted-copy">No pending monthly pass requests.</p>}
    </div>}
  </section>;
}
