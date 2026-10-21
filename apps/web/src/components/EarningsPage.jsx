import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowDownToLine, BadgeIndianRupee, CircleAlert, Clock3, LoaderCircle, RefreshCw, Wallet } from 'lucide-react';

async function apiRequest(path) {
  const response = await fetch(path, { credentials: 'same-origin' });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message ?? 'Unable to load host earnings.');
  return data;
}
function money(value, currency = 'INR') { return new Intl.NumberFormat('en-IN', { style: 'currency', currency, maximumFractionDigits: 2 }).format(Number(value ?? 0)); }
function dateTime(value) { if (!value) return '—'; const date = new Date(value); return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }); }
function label(value) { return String(value ?? 'unknown').replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()); }

export default function EarningsPage() {
  const [data, setData] = useState({ earnings: [], summary: {}, settlementEnabled: false });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const reload = useCallback(async () => {
    setLoading(true); setError('');
    try { setData(await apiRequest('/api/marketplace/earnings/mine')); }
    catch (requestError) { setError(requestError.message || 'Unable to load host earnings.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { reload(); }, [reload]);
  const currencies = useMemo(() => Object.entries(data.summary ?? {}), [data.summary]);
  const pendingEntries = (data.earnings ?? []).filter((earning) => earning.status === 'pending').length;

  return <section className="sp-page sp-bookings-page sp-earnings-page">
    <div className="sp-page-heading"><div className="sp-heading-title-row"><div><p className="sp-kicker">HOST FINANCE</p><h1>Owner earnings</h1><p>Review earnings from verified customer payments for parking spaces you own.</p></div><button className="sp-button ghost" onClick={reload} disabled={loading}><RefreshCw size={14} /> Refresh</button></div></div>
    {error && <div className="sp-alert error"><CircleAlert size={17} /><span>{error}</span></div>}
    <div className="sp-earnings-notice"><Wallet size={18} /><div><strong>Ledger report — not a bank payout</strong><p>These amounts are recorded when a verified payment confirms a booking. This screen does not transfer money or guarantee a settlement date. Provider fees, tax obligations, platform commission and payout onboarding must be finalized before enabling payouts.</p></div></div>
    {loading ? <div className="sp-loading"><LoaderCircle className="sp-spin" size={20} /> Loading earnings…</div> : <>
      <div className="sp-earnings-currency-grid">{currencies.length ? currencies.map(([currency, totals]) => <div className="sp-earnings-currency" key={currency}><div className="sp-earnings-currency-head"><span>{currency} earnings snapshot</span><BadgeIndianRupee size={18} /></div><strong>{money(totals.totalNet, currency)}</strong><small>Net parking charges in the ledger, excluding reversed entries</small><div className="sp-earnings-mini-stats"><span>Pending <b>{money(totals.pending, currency)}</b></span><span>Approved <b>{money(totals.approved, currency)}</b></span><span>Settled <b>{money(totals.paid, currency)}</b></span><span>Reversed <b>{money(totals.reversed, currency)}</b></span></div></div>) : <div className="sp-empty-state sp-empty-panel"><Wallet size={29} /><strong>No host earnings recorded yet</strong><span>When a paid booking is confirmed for one of your listings, its earnings entry will appear here.</span></div>}</div>
      <article className="sp-panel"><div className="sp-panel-header"><div><p className="sp-kicker">EARNINGS LEDGER</p><h2>Verified booking earnings</h2><p>{pendingEntries} entry/entries awaiting settlement review. A paid payment alone does not imply a bank transfer.</p></div><Clock3 size={20} /></div>
        {data.earnings?.length ? <div className="sp-earnings-table-wrap"><table className="sp-earnings-table"><thead><tr><th>BOOKING</th><th>PARKING LISTING</th><th>PAYMENT VERIFIED</th><th>GROSS PARKING CHARGE</th><th>DISCOUNT</th><th>HOST LEDGER AMOUNT</th><th>STATUS</th></tr></thead><tbody>{data.earnings.map((item) => <tr key={item.id}><td><strong>{item.bookingCode}</strong><small>{item.providerPaymentId || `Payment ${item.paymentId.slice(0, 8)}`}</small></td><td>{item.parkingLotName}<small>{dateTime(item.startAt)}</small></td><td>{dateTime(item.createdAt)}</td><td>{money(item.grossAmount, item.currency)}</td><td>{money(item.discountAmount, item.currency)}</td><td><strong>{money(item.netAmount, item.currency)}</strong><small>Platform fee recorded: {money(item.platformFeeAmount, item.currency)}</small></td><td><span className={`sp-booking-status ${item.status}`}>{label(item.status)}</span>{item.settlementReference && <small>{item.settlementReference}</small>}</td></tr>)}</tbody></table></div> : null}
      </article>
    </>}
    <div className="sp-page-footer"><span><ArrowDownToLine size={14} /> Downloadable statements and actual host payouts can be added after the payout provider and finance rules are selected.</span></div>
  </section>;
}
