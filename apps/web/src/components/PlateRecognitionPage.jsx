import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, RefreshCw, ScanEye, ShieldCheck, XCircle } from 'lucide-react';

async function request(path, options = {}) {
  const response = await fetch(path, { credentials: 'same-origin', ...options, headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers ?? {}) } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message ?? 'Request failed.');
  return data;
}
const matchLabel = { matched_booking: 'Booking candidate', matched_vehicle: 'Vehicle match', unmatched: 'No match', review_required: 'Low confidence — review' };
const reviewLabel = { pending: 'Pending review', confirmed: 'Confirmed', false_positive: 'False positive' };
export default function PlateRecognitionPage() {
  const [lots, setLots] = useState([]); const [lotId, setLotId] = useState(''); const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true); const [busyId, setBusyId] = useState(''); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const load = useCallback(async (selectedId = lotId) => {
    if (!selectedId) { setEvents([]); setLoading(false); return; }
    setLoading(true); setError('');
    try { const data = await request(`/api/vision/plate-events?parkingLotId=${encodeURIComponent(selectedId)}`); setEvents(data.events ?? []); }
    catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, [lotId]);
  useEffect(() => { request('/api/parking/managed-lots').then(data => { const list=data.lots??[]; setLots(list); setLotId(list[0]?.id??''); if(list[0]?.id) load(list[0].id); else setLoading(false); }).catch(e=>{setError(e.message);setLoading(false)}); }, []);
  useEffect(() => { if (lotId) load(lotId); }, [lotId]);
  async function review(event, reviewStatus) { setBusyId(event.id); setError(''); setNotice(''); try { const data=await request(`/api/vision/plate-events/${event.id}/review`,{method:'PATCH',body:JSON.stringify({reviewStatus})}); setNotice(data.message); await load(); } catch(e) { setError(e.message); } finally { setBusyId(''); } }
  return <section className="sp-account-page sp-anpr-page"><header><p className="section-kicker">CAMERA INTELLIGENCE</p><h1>Number-plate recognition</h1><p className="muted-copy">Review plate candidates from a configured ANPR provider. Matches are suggestions only and never unlock gates or change bookings automatically.</p></header>
    <div className="panel sp-account-card"><div className="sp-anpr-toolbar"><label>Managed parking facility<select value={lotId} onChange={e=>setLotId(e.target.value)}><option value="">Select facility</option>{lots.map(l=><option key={l.id} value={l.id}>{l.name} · {l.city}</option>)}</select></label><button className="sp-button secondary" onClick={()=>load()} disabled={loading||!lotId}><RefreshCw size={15}/> Refresh</button></div>
      {error&&<div className="sp-ops-message error" role="alert"><AlertTriangle size={16}/>{error}</div>}{notice&&<div className="sp-ops-message success" role="status"><CheckCircle2 size={16}/>{notice}</div>}
      <div className="sp-anpr-list">{events.map(event=><article className="sp-anpr-event" key={event.id}><div className="sp-anpr-icon"><ScanEye size={20}/></div><div className="sp-anpr-main"><div className="sp-anpr-title"><strong>{event.plate}</strong><span className={`sp-referral-status ${event.reviewStatus}`}>{reviewLabel[event.reviewStatus]??event.reviewStatus}</span></div><p>{event.cameraName} · {event.direction} · {new Date(event.observedAt).toLocaleString()}</p><small>Confidence {(event.confidence*100).toFixed(1)}% · {matchLabel[event.matchStatus]??event.matchStatus}{event.bookingCode?` · Booking ${event.bookingCode}`:''}{event.matchedRegistration?` · Vehicle ${event.matchedRegistration}`:''}</small>{event.reviewNote&&<small>Review note: {event.reviewNote}</small>}</div>{event.reviewStatus==='pending'&&<div className="sp-anpr-actions"><button className="sp-button secondary" disabled={busyId===event.id} onClick={()=>review(event,'confirmed')} title="Confirm this plate candidate"><CheckCircle2 size={14}/> Confirm</button><button className="sp-button danger" disabled={busyId===event.id} onClick={()=>review(event,'false_positive')} title="Mark as a false positive"><XCircle size={14}/> False positive</button></div>}</article>)}{!loading&&!events.length&&<div className="sp-referral-empty"><ScanEye size={24}/><strong>No plate events recorded</strong><p>Connect a compatible ANPR provider to the secured `/api/vision/service/plate-events` endpoint. SmartPark does not perform OCR by itself.</p></div>}{loading&&<p className="muted-copy">Loading plate events…</p>}</div>
      <div className="sp-enterprise-note"><ShieldCheck size={17}/><p>Privacy and safety: SmartPark stores normalized plate text and confidence, not raw images. Keep camera notices and retention rules aligned with local law. Always verify low-confidence or unmatched events manually.</p></div>
    </div></section>;
}
