import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowDownToLine, BadgeIndianRupee, Banknote, CircleAlert, Clock3, LoaderCircle, RefreshCw, Wallet } from 'lucide-react';

async function apiRequest(path, options = {}) {
  const response = await fetch(path, {
    credentials: 'same-origin',
    ...options,
    headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers ?? {}) }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message ?? 'Unable to load host earnings.');
  return data;
}
function money(value, currency = 'INR') { return new Intl.NumberFormat('en-IN', { style: 'currency', currency, maximumFractionDigits: 2 }).format(Number(value ?? 0)); }
function dateTime(value) { if (!value) return '—'; const date = new Date(value); return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }); }
function label(value) { return String(value ?? 'unknown').replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()); }

export default function EarningsPage() {
  const [data, setData] = useState({ earnings: [], summary: {}, settlementEnabled: false });
  const [payouts, setPayouts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [payoutBusy, setPayoutBusy] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const reload = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [earningsData, payoutData] = await Promise.all([
        apiRequest('/api/marketplace/earnings/mine'),
        apiRequest('/api/financial/payouts/mine')
      ]);
      setData(earningsData);
      setPayouts(payoutData.payouts ?? []);
    } catch (requestError) { setError(requestError.message || 'Unable to load host earnings.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { reload(); }, [reload]);
  const currencies = useMemo(() => Object.entries(data.summary ?? {}), [data.summary]);
  const pendingEntries = (data.earnings ?? []).filter((earning) => earning.status === 'pending').length;

  async function requestPayout(currency) {
    if (!window.confirm(`Request payout of all currently approved ${currency} earnings? These amounts will be reserved until the request is resolved. SmartPark does not perform the bank transfer.`)) return;
    setPayoutBusy(currency); setError(''); setMessage('');
    try {
      const result = await apiRequest('/api/financial/payouts', {
        method: 'POST', body: JSON.stringify({ currency, note: 'Requested from the SmartPark owner earnings page.' })
      });
      setMessage(result.message ?? `Payout request created for ${money(result.payout?.amount, currency)}.`);
      await reload();
    } catch (requestError) { setError(requestError.message || 'Unable to create the payout request.'); }
    finally { setPayoutBusy(''); }
  }

  return <section className="sp-page sp-bookings-page sp-earnings-page">
    <div className="sp-page-heading"><div className="sp-heading-title-row"><div><p className="sp-kicker">HOST FINANCE</p><h1>Owner earnings</h1><p>Review earnings from verified customer payments for parking spaces you own.</p></div><button className="sp-button ghost" onClick={reload} disabled={loading || Boolean(payoutBusy)}><RefreshCw size={14} /> Refresh</button></div></div>
    {error && <div className="sp-alert error"><CircleAlert size={17} /><span>{error}</span></div>}
    {message && <div className="sp-alert success"><BadgeIndianRupee size={17} /><span>{message}</span></div>}
    <div className="sp-earnings-notice"><Wallet size={18} /><div><strong>Audited ledger — not an automatic bank payout</strong><p>Earnings start as pending. Administrators can approve eligible earnings after the booking is completed and payment has been verified. Requesting a payout reserves all currently approved earnings for one currency. The actual transfer happens externally and an administrator records its reference.</p></div></div>
    {loading ? <div className="sp-loading"><LoaderCircle className="sp-spin" size={20} /> Loading earnings…</div> : <>
      <div className="sp-earnings-currency-grid">{currencies.length ? currencies.map(([currency, totals]) => <div className="sp-earnings-currency" key={currency}>
        <div className="sp-earnings-currency-head"><span>{currency} earnings snapshot</span><BadgeIndianRupee size={18} /></div>
        <strong>{money(totals.totalNet, currency)}</strong><small>Net parking charges in the ledger, excluding reversed entries</small>
        <div className="sp-earnings-mini-stats">
          <span>Pending <b>{money(totals.pending, currency)}</b></span>
          <span>Approved <b>{money(totals.approved, currency)}</b></span>
          <span>In payout request <b>{money(totals.payout_requested, currency)}</b></span>
          <span>Refund review <b>{money(totals.refund_hold, currency)}</b></span>
          <span>Settled <b>{money(totals.paid, currency)}</b></span>
          <span>Reversed <b>{money(totals.reversed, currency)}</b></span>
        </div>
        <button className="sp-button primary" disabled={Number(totals.approved ?? 0) <= 0 || Boolean(payoutBusy)} onClick={() => requestPayout(currency)}>
          {payoutBusy === currency ? <LoaderCircle className="sp-spin" size={14} /> : <Banknote size={14} />}
          Request approved payout
        </button>
        {Number(totals.approved ?? 0) <= 0 && <small>No approved earnings are currently available for this currency.</small>}
      </div>) : <div className="sp-empty-state sp-empty-panel"><Wallet size={29} /><strong>No host earnings recorded yet</strong><span>When a paid booking is confirmed for one of your listings, its earnings entry will appear here.</span></div>}</div>

      <article className="sp-panel"><div className="sp-panel-header"><div><p className="sp-kicker">PAYOUT HISTORY</p><h2>Your payout requests</h2><p>Check the review status and external transfer reference recorded by finance administrators.</p></div><Banknote size={20} /></div>
        {payouts.length ? <div className="sp-finance-record-list">{payouts.map((item) => <article className="sp-finance-record" key={item.id}>
          <div className="sp-finance-record-main"><div className="sp-ops-alert-heading"><strong>{item.currency} payout · {item.earningCount} earning record(s)</strong><span className={`sp-ops-alert-state ${item.status === 'paid' ? 'resolved' : 'open'}`}>{label(item.status)}</span></div><p>Requested {dateTime(item.requestedAt)}{item.paidAt ? ` · Recorded paid ${dateTime(item.paidAt)}` : ''}</p><small>{item.adminNote ?? 'No administrator note yet.'}{item.externalReference ? ` · Transfer reference: ${item.externalReference}` : ''}</small></div>
          <div className="sp-finance-record-value"><strong>{money(item.amount, item.currency)}</strong><small>{item.status === 'paid' ? 'Transfer reference recorded' : 'Awaiting finance resolution'}</small></div>
        </article>)}</div> : <div className="sp-ops-empty"><Banknote size={24} /><strong>No payout requests yet</strong><span>Once an administrator approves eligible completed-booking earnings, you can request a payout here.</span></div>}
      </article>

      <article className="sp-panel"><div className="sp-panel-header"><div><p className="sp-kicker">EARNINGS LEDGER</p><h2>Verified booking earnings</h2><p>{pendingEntries} entry/entries awaiting settlement review. Pending means not approved for payout; paid means an external transfer reference was recorded.</p></div><Clock3 size={20} /></div>
        {data.earnings?.length ? <div className="sp-earnings-table-wrap"><table className="sp-earnings-table"><thead><tr><th>BOOKING</th><th>PARKING LISTING</th><th>PAYMENT VERIFIED</th><th>GROSS PARKING CHARGE</th><th>DISCOUNT</th><th>HOST LEDGER AMOUNT</th><th>STATUS</th></tr></thead><tbody>{data.earnings.map((item) => <tr key={item.id}><td><strong>{item.bookingCode}</strong><small>{item.providerPaymentId || `Payment ${item.paymentId.slice(0, 8)}`}</small></td><td>{item.parkingLotName}<small>{dateTime(item.startAt)}</small></td><td>{dateTime(item.createdAt)}</td><td>{money(item.grossAmount, item.currency)}</td><td>{money(item.discountAmount, item.currency)}</td><td><strong>{money(item.netAmount, item.currency)}</strong><small>Platform fee recorded: {money(item.platformFeeAmount, item.currency)}</small></td><td><span className={`sp-booking-status ${item.status}`}>{label(item.status)}</span>{item.settlementReference && <small>{item.settlementReference}</small>}</td></tr>)}</tbody></table></div> : null}
      </article>
    </>}
    <div className="sp-page-footer"><span><ArrowDownToLine size={14} /> External payout references are recorded for audit; bank transfers are not initiated by SmartPark.</span></div>
  </section>;
}
