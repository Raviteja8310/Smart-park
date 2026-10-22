import { useCallback, useEffect, useState } from 'react';
import { BadgeCheck, FileCheck2, RefreshCw, ShieldCheck, XCircle, CheckCircle2, Clock3 } from 'lucide-react';

const RELATIONSHIPS = [
  ['owner', 'Property owner'], ['tenant_authorized', 'Tenant with owner authorization'],
  ['manager_authorized', 'Authorized property manager'], ['business_representative', 'Business representative']
];
const DOCUMENTS = [
  ['government_id', 'Government-issued identity document'], ['business_registration', 'Business registration'],
  ['property_proof', 'Proof of property ownership or control'], ['authorization_letter', 'Owner authorization letter']
];
async function request(path, options = {}) {
  const response = await fetch(path, { credentials: 'same-origin', ...options, headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers ?? {}) } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message ?? 'The request could not be completed.');
  return data;
}
function label(value) { return String(value ?? '').replaceAll('_', ' ').replace(/\b\w/g, (m) => m.toUpperCase()); }
function dateLabel(value) { if (!value) return '—'; const d = new Date(value); return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }); }

export default function OwnerVerificationPage({ currentUser }) {
  const isAdmin = (currentUser?.roles ?? []).includes('admin');
  const [application, setApplication] = useState(null);
  const [verified, setVerified] = useState(false);
  const [applications, setApplications] = useState([]);
  const [filter, setFilter] = useState('pending');
  const [form, setForm] = useState({ legalName: currentUser?.fullName ?? '', contactPhone: currentUser?.phone ?? '', propertyRelationship: 'owner', documentType: 'government_id', documentReferenceLast4: '', declarationAccepted: false });
  const [reviewNotes, setReviewNotes] = useState({});
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const loadMine = useCallback(async () => {
    const data = await request('/api/owner-verification/mine');
    setApplication(data.application ?? null); setVerified(Boolean(data.verified));
  }, []);
  const loadAdmin = useCallback(async () => {
    const data = await request(`/api/owner-verification/admin?status=${encodeURIComponent(filter)}`);
    setApplications(data.applications ?? []);
  }, [filter]);
  const reload = useCallback(async () => {
    setLoading(true); setError('');
    try { if (isAdmin) await loadAdmin(); else await loadMine(); }
    catch (e) { setError(e.message || 'Unable to load owner verification.'); }
    finally { setLoading(false); }
  }, [isAdmin, loadAdmin, loadMine]);
  useEffect(() => { reload(); }, [reload]);

  async function submit(event) {
    event.preventDefault(); setBusy(true); setError(''); setMessage('');
    try {
      const payload = { ...form, legalName: form.legalName.trim(), contactPhone: form.contactPhone.trim(), documentReferenceLast4: form.documentReferenceLast4.trim() };
      const data = await request('/api/owner-verification/submit', { method: 'POST', body: JSON.stringify(payload) });
      setMessage(data.message || 'Application submitted.'); setForm((v) => ({ ...v, declarationAccepted: false })); await loadMine();
    } catch (e) { setError(e.message || 'Unable to submit verification.'); }
    finally { setBusy(false); }
  }
  async function review(item, decision) {
    setBusy(true); setError(''); setMessage('');
    try {
      const data = await request(`/api/owner-verification/admin/${item.id}/review`, { method: 'POST', body: JSON.stringify({ decision, note: reviewNotes[item.id] ?? '' }) });
      setMessage(data.message || 'Review saved.'); await loadAdmin();
    } catch (e) { setError(e.message || 'Unable to save review.'); }
    finally { setBusy(false); }
  }

  return <section className="sp-admin-page"><header className="sp-admin-heading"><div><p className="section-kicker">TRUST & SAFETY</p><h1>{isAdmin ? 'Owner verification review' : 'Verify your owner account'}</h1><p className="muted-copy">{isAdmin ? 'Review owner declarations and record verification decisions.' : 'Submit your owner details for a manual review so drivers can see that your account has been verified.'}</p></div><button className="sp-button secondary" onClick={reload} disabled={loading || busy}><RefreshCw size={15}/> Refresh</button></header>
    {error && <div className="sp-ops-message error" role="alert">{error}</div>}{message && <div className="sp-ops-message success" role="status">{message}</div>}
    {!isAdmin ? <>
      <div className="panel sp-verification-status"><span className={`sp-verification-icon ${verified ? 'verified' : ''}`}>{verified ? <BadgeCheck size={25}/> : application?.status === 'pending' ? <Clock3 size={25}/> : <ShieldCheck size={25}/>}</span><div><h2>{verified ? 'Owner verified' : application?.status === 'pending' ? 'Application under review' : application?.status === 'rejected' ? 'Changes required' : 'Verification not submitted'}</h2><p>{verified ? 'Your latest owner verification application was approved.' : application?.reviewerNote || (application?.status === 'pending' ? 'An administrator will review your application.' : 'Complete the form below to request verification.')}</p>{application && <small>Last application: {dateLabel(application.createdAt)} · Status: {label(application.status)}</small>}</div></div>
      {(!application || application.status === 'rejected') && <form className="panel sp-verification-form" onSubmit={submit}><h2>Owner details</h2><p className="muted-copy">Provide accurate information. SmartPark does not ask you to enter a full government ID number here.</p><div className="sp-verification-fields"><label>Legal name<input required minLength={2} maxLength={160} value={form.legalName} onChange={e=>setForm(v=>({...v,legalName:e.target.value}))}/></label><label>Contact phone<input required minLength={7} maxLength={30} value={form.contactPhone} onChange={e=>setForm(v=>({...v,contactPhone:e.target.value}))}/></label><label>Relationship to property<select value={form.propertyRelationship} onChange={e=>setForm(v=>({...v,propertyRelationship:e.target.value}))}>{RELATIONSHIPS.map(([value,text])=><option value={value} key={value}>{text}</option>)}</select></label><label>Document type<select value={form.documentType} onChange={e=>setForm(v=>({...v,documentType:e.target.value}))}>{DOCUMENTS.map(([value,text])=><option value={value} key={value}>{text}</option>)}</select></label><label>Last four digits of document reference (optional)<input inputMode="numeric" pattern="[0-9]{4}" maxLength={4} value={form.documentReferenceLast4} onChange={e=>setForm(v=>({...v,documentReferenceLast4:e.target.value.replace(/\D/g,'').slice(0,4)}))} placeholder="1234"/><small>Do not enter a full ID number or upload confidential documents into this form.</small></label></div><label className="sp-verification-declaration"><input type="checkbox" required checked={form.declarationAccepted} onChange={e=>setForm(v=>({...v,declarationAccepted:e.target.checked}))}/><span>I confirm that these details are accurate and that I am authorized to offer this parking property.</span></label><button className="sp-button primary" disabled={busy}>{busy ? 'Submitting…' : 'Submit for verification'}</button></form>}
    </> : <><div className="sp-admin-toolbar"><select value={filter} onChange={e=>setFilter(e.target.value)} aria-label="Filter verification applications"><option value="pending">Pending review</option><option value="approved">Approved</option><option value="rejected">Rejected</option><option value="all">All applications</option></select><span>{applications.length} applications</span></div>{loading ? <div className="panel">Loading applications…</div> : !applications.length ? <div className="panel sp-overview-empty"><FileCheck2 size={24}/><span>No applications in this queue.</span></div> : <div className="sp-verification-list">{applications.map(item=><article className="panel sp-verification-card" key={item.id}><div className="sp-verification-card-head"><div><h2>{item.legalName}</h2><p>{item.email} · Account: {item.fullName}</p></div><span className={`sp-admin-status ${item.status}`}>{label(item.status)}</span></div><dl><div><dt>Phone</dt><dd>{item.contactPhone}</dd></div><div><dt>Property relationship</dt><dd>{label(item.propertyRelationship)}</dd></div><div><dt>Evidence type</dt><dd>{label(item.documentType)}{item.documentReferenceLast4 ? ` · ending ${item.documentReferenceLast4}` : ''}</dd></div><div><dt>Submitted</dt><dd>{dateLabel(item.createdAt)}</dd></div></dl>{item.status === 'pending' ? <><label>Review note<textarea maxLength={1000} value={reviewNotes[item.id] ?? ''} onChange={e=>setReviewNotes(v=>({...v,[item.id]:e.target.value}))} placeholder="Optional approval note or rejection reason (required for rejection)"/></label><div className="sp-verification-review-actions"><button className="sp-button primary" disabled={busy} onClick={()=>review(item,'approve')}><CheckCircle2 size={15}/> Approve</button><button className="sp-button danger" disabled={busy || (reviewNotes[item.id] ?? '').trim().length < 8} onClick={()=>review(item,'reject')}><XCircle size={15}/> Reject with reason</button></div></> : item.reviewerNote && <p className="muted-copy">Review note: {item.reviewerNote}</p>}</article>)}</div>}</>}
    <p className="sp-verification-footnote">This phase records a manual verification decision; it does not collect identity document images or automatically verify government records. Administrators must follow the organization's approved verification procedure and access policy.</p>
  </section>;
}
