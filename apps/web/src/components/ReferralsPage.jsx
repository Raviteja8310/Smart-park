import { useEffect, useState } from 'react';
import { BadgeCheck, Copy, Gift, Link2, RefreshCw, Users, Wallet } from 'lucide-react';

async function readJson(response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message ?? 'Could not load referral details.');
  return data;
}
const money = (value, currency = 'INR') => new Intl.NumberFormat('en-IN', { style: 'currency', currency, maximumFractionDigits: 2 }).format(Number(value ?? 0));
const dateLabel = (value) => value ? new Date(value).toLocaleDateString([], { dateStyle: 'medium' }) : '—';

export default function ReferralsPage() {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  async function load() {
    setBusy(true); setError('');
    try { setData(await readJson(await fetch('/api/referrals/me', { credentials: 'same-origin' }))); }
    catch (reason) { setError(reason.message); }
    finally { setBusy(false); }
  }
  useEffect(() => { load(); }, []);
  async function copy(value, label) {
    try {
      await navigator.clipboard.writeText(value);
      setNotice(`${label} copied.`);
    } catch {
      setNotice('Clipboard access is unavailable. Select and copy the link manually.');
    }
  }
  return <section className="sp-account-page sp-referrals-page">
    <header><p className="section-kicker">SHARE SMARTPARK</p><h1>Refer & earn</h1><p className="muted-copy">Invite a friend to SmartPark. When they complete their first paid parking session, both accounts receive referral credits.</p></header>
    {error && <div className="auth-message error" role="alert">{error} <button className="sp-button" onClick={load}><RefreshCw size={14}/> Retry</button></div>}
    {notice && <div className="auth-message success" role="status">{notice}</div>}
    {busy && !data ? <div className="panel sp-account-card">Loading your referral dashboard…</div> : data && <>
      <div className="sp-referral-hero panel"><div className="sp-referral-icon"><Gift size={25}/></div><div><span className="section-kicker">YOUR PERSONAL CODE</span><h2>{data.code}</h2><p>Share your link with friends who are new to SmartPark.</p></div><button className="sp-button primary" onClick={() => copy(data.code, 'Referral code')}><Copy size={15}/> Copy code</button></div>
      <div className="sp-referral-link panel"><div><strong><Link2 size={16}/> Referral link</strong><p>{data.referralLink}</p></div><button className="sp-button" onClick={() => copy(data.referralLink, 'Referral link')}><Copy size={15}/> Copy link</button></div>
      <div className="sp-referral-stats">
        <div className="panel sp-referral-stat"><Users size={19}/><span>Total referrals</span><strong>{data.summary.totalReferrals}</strong></div>
        <div className="panel sp-referral-stat"><BadgeCheck size={19}/><span>Qualified</span><strong>{data.summary.qualifiedReferrals}</strong></div>
        <div className="panel sp-referral-stat"><RefreshCw size={19}/><span>Pending</span><strong>{data.summary.pendingReferrals}</strong></div>
        <div className="panel sp-referral-stat"><Wallet size={19}/><span>Available credits</span><strong>{money(data.summary.availableCredits)}</strong></div>
      </div>
      <div className="panel sp-account-card"><div className="sp-help-title"><Users size={22}/><div><h2>Referral activity</h2><p className="muted-copy">Only completed sessions with a verified payment qualify.</p></div><button className="sp-button" onClick={load}><RefreshCw size={14}/> Refresh</button></div>
        {data.referrals.length ? <div className="sp-referral-table-wrap"><table className="sp-referral-table"><thead><tr><th>Friend</th><th>Joined</th><th>Status</th><th>Qualified</th></tr></thead><tbody>{data.referrals.map((ref) => <tr key={ref.id}><td>{ref.referredName}</td><td>{dateLabel(ref.createdAt)}</td><td><span className={`sp-referral-status ${ref.status}`}>{ref.status}</span></td><td>{dateLabel(ref.qualifiedAt)}</td></tr>)}</tbody></table></div> : <div className="sp-referral-empty"><Gift size={25}/><strong>No referrals yet</strong><p>Share your code to invite your first friend.</p></div>}
      </div>
      <p className="muted-copy sp-referral-footnote">Referral credits are an internal SmartPark ledger balance. They are not cash, are not currently withdrawable, and cannot currently be withdrawn or redeemed against bookings. Automated credit reversals are not implemented in this phase.</p>
    </>}
  </section>;
}
