import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity, AlertCircle, AlertTriangle, BellRing, Building2, CheckCircle2,
  CircleDollarSign, Clock3, RefreshCw, ShieldAlert, Siren, TrendingUp, WifiOff
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
function localDate(offsetDays = 0) {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
function formatMoney(value, currency = 'INR') {
  try { return new Intl.NumberFormat('en-IN', { style: 'currency', currency, maximumFractionDigits: 2 }).format(Number(value || 0)); }
  catch { return `${currency} ${Number(value || 0).toFixed(2)}`; }
}
function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

function Metric({ icon: Icon, label, value, note, tone = 'green' }) {
  return <article className="sp-ops-metric"><span className={`sp-ops-metric-icon ${tone}`}><Icon size={18} /></span><div className="sp-ops-metric-label">{label}</div><div className="sp-ops-metric-value">{value}</div><div className="sp-ops-metric-note">{note}</div></article>;
}

function AlertCard({ alert, onAcknowledge, onResolve, busyId, canResolve, isAdmin }) {
  const isBusy = busyId === alert.id;
  const isCameraAlert = ['camera_offline', 'camera_stale'].includes(alert.alert_type);
  const isPaymentReview = alert.alert_type === 'payment_reconciliation';
  const isPlateReview = alert.alert_type === 'plate_manual_review';
  return <article className={`sp-ops-alert ${alert.severity}`}>
    <div className="sp-ops-alert-icon">{alert.severity === 'critical' ? <ShieldAlert size={18} /> : <AlertTriangle size={18} />}</div>
    <div className="sp-ops-alert-main">
      <div className="sp-ops-alert-heading"><strong>{alert.title}</strong><span className={`sp-ops-severity ${alert.severity}`}>{alert.severity}</span><span className={`sp-ops-alert-state ${alert.status}`}>{alert.status}</span></div>
      <p>{alert.message}</p>
      <div className="sp-ops-alert-meta">{alert.parking_lot_name || 'Platform-wide'} · Last observed {formatDate(alert.last_seen_at)}</div>
      <div className="sp-ops-alert-actions">
        {alert.status === 'open' && <button className="sp-button secondary" disabled={isBusy} onClick={() => onAcknowledge(alert)}>{isBusy ? 'Saving…' : 'Acknowledge'}</button>}
        {canResolve && !isCameraAlert && !isPlateReview && (!isPaymentReview || isAdmin) && alert.status !== 'resolved' && <button className="sp-button ghost" disabled={isBusy} onClick={() => onResolve(alert)}>{isBusy ? 'Saving…' : isPaymentReview ? 'Record resolution' : 'Resolve'}</button>}
        {isCameraAlert && alert.status !== 'resolved' && <small className="sp-ops-auto-resolve">Resolves automatically after the camera feed is healthy or disabled.</small>}
        {isPlateReview && alert.status !== 'resolved' && <small className="sp-ops-auto-resolve">Review this candidate in Plate recognition to resolve the alert.</small>}
      </div>
    </div>
  </article>;
}

export default function OperationsPage({ currentUser }) {
  const roles = currentUser?.roles ?? [];
  const canResolve = roles.some((role) => ['host', 'operator', 'admin'].includes(role));
  const [summary, setSummary] = useState(null);
  const [revenue, setRevenue] = useState([]);
  const [occupancy, setOccupancy] = useState([]);
  const [forecastData, setForecastData] = useState(null);
  const [alerts, setAlerts] = useState([]);
  const [alertStatus, setAlertStatus] = useState('open');
  const [from, setFrom] = useState(() => localDate(-29));
  const [to, setTo] = useState(() => localDate(0));
  const [appliedRange, setAppliedRange] = useState(() => ({ from: localDate(-29), to: localDate(0) }));
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [paymentResolveTarget, setPaymentResolveTarget] = useState(null);
  const [resolutionDisposition, setResolutionDisposition] = useState('refunded_externally');
  const [resolutionNote, setResolutionNote] = useState('');
  const [externalReference, setExternalReference] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const query = new URLSearchParams(appliedRange);
      const alertQuery = new URLSearchParams({ status: alertStatus, limit: '100' });
      const [summaryData, revenueData, occupancyData, forecastResponse, alertData] = await Promise.all([
        apiRequest('/api/operations/summary'),
        apiRequest(`/api/operations/reports/revenue?${query}`),
        apiRequest('/api/operations/reports/occupancy'),
        apiRequest('/api/operations/reports/forecast?hours=24'),
        apiRequest(`/api/operations/alerts?${alertQuery}`)
      ]);
      setSummary(summaryData.overview ?? null);
      setRevenue(revenueData.series ?? []);
      setOccupancy(occupancyData.lots ?? []);
      setForecastData(forecastResponse ?? null);
      setAlerts(alertData.alerts ?? []);
    } catch (requestError) {
      setError(requestError.message || 'Operations data could not be loaded. Apply migration 008 and check the API/database connection.');
    } finally { setLoading(false); }
  }, [appliedRange, alertStatus]);

  useEffect(() => { load(); }, [load]);

  async function updateAlert(alert, action) {
    if (action === 'resolve' && alert.alert_type === 'payment_reconciliation') {
      setPaymentResolveTarget(alert); setResolutionDisposition('refunded_externally'); setResolutionNote(''); setExternalReference(''); setError(''); setNotice('');
      return;
    }
    setBusyId(alert.id); setError(''); setNotice('');
    try {
      await apiRequest(`/api/operations/alerts/${alert.id}/${action}`, { method: 'POST' });
      setNotice(action === 'acknowledge' ? 'Alert acknowledged.' : 'Alert resolved.');
      await load();
    } catch (requestError) { setError(requestError.message || 'Unable to update this alert.'); }
    finally { setBusyId(''); }
  }

  async function submitPaymentResolution(event) {
    event.preventDefault();
    if (!paymentResolveTarget) return;
    setBusyId(paymentResolveTarget.id); setError(''); setNotice('');
    try {
      const result = await apiRequest(`/api/operations/alerts/${paymentResolveTarget.id}/resolve`, {
        method: 'POST', body: JSON.stringify({ disposition: resolutionDisposition, resolutionNote, externalReference })
      });
      setPaymentResolveTarget(null);
      setNotice(resolutionDisposition === 'refunded_externally'
        ? 'The externally processed refund has been recorded. SmartPark did not execute the refund.'
        : 'The administrator’s no-refund review has been recorded. The booking status was not changed.');
      await load();
    } catch (requestError) { setError(requestError.message || 'Unable to record this reconciliation decision.'); }
    finally { setBusyId(''); }
  }

  const revenueTotals = useMemo(() => {
    const totals = new Map();
    for (const row of revenue) totals.set(row.currency, (totals.get(row.currency) || 0) + Number(row.amount || 0));
    return [...totals.entries()].map(([currency, amount]) => ({ currency, amount }));
  }, [revenue]);

  const overview = summary ?? {};
  const totalOccupancy = occupancy.reduce((acc, row) => acc + Number(row.totalSpaces || 0), 0);
  const physicalOccupied = occupancy.reduce((acc, row) => acc + Number(row.occupiedSpaces || 0), 0);
  const occupancyPercent = totalOccupancy ? Math.round((physicalOccupied / totalOccupancy) * 1000) / 10 : 0;

  return <section className="sp-ops-page">
    <div className="sp-ops-title-row">
      <div><p className="section-kicker">OPERATIONS CONTROL</p><h1>Operations & analytics</h1><p className="muted-copy">Live facility health, verified payment revenue, occupancy and actionable system alerts.</p></div>
      <button className="sp-button secondary" onClick={load} disabled={loading}><RefreshCw size={15} className={loading ? 'sp-ops-spin' : ''} /> Refresh data</button>
    </div>
    {error && <div className="sp-ops-message error"><AlertCircle size={16} />{error}</div>}
    {notice && <div className="sp-ops-message success"><CheckCircle2 size={16} />{notice}</div>}

    <div className="sp-ops-metrics-grid">
      <Metric icon={Building2} label="Active facilities" value={overview.activeLots ?? '—'} note="Within your access scope" />
      <Metric icon={Activity} label="Total parking spaces" value={overview.totalSpaces ?? '—'} note={`${overview.unknownSpaces ?? 0} with unknown physical state`} tone="blue" />
      <Metric icon={CheckCircle2} label="Bookable now" value={overview.availableNow ?? '—'} note={`${overview.reservedEmptySpaces ?? 0} empty but reserved`} tone="green" />
      <Metric icon={WifiOff} label="Physically occupied" value={overview.occupiedNow ?? '—'} note={`${overview.unavailableSpaces ?? 0} closed or under maintenance`} tone="amber" />
      <Metric icon={Clock3} label="Active sessions/bookings" value={overview.activeBookings ?? '—'} note="Confirmed and checked-in within the current time window" tone="blue" />
      <Metric icon={Siren} label="Open alerts" value={overview.openAlerts ?? '—'} note={`${overview.criticalAlerts ?? 0} critical`} tone={Number(overview.criticalAlerts) ? 'red' : 'green'} />
    </div>

    <div className="sp-ops-revenue-strip">
      <div><span className="sp-ops-small-label"><CircleDollarSign size={15} /> Verified revenue · last 30 days</span>
        {overview.revenue30Days?.length ? <div className="sp-ops-money-values">{overview.revenue30Days.map((row) => <strong key={row.currency}>{formatMoney(row.amount, row.currency)} <small>{row.currency} · {row.paymentCount} payments</small></strong>)}</div> : <strong className="sp-ops-no-revenue">No reconciled revenue in the last 30 days.</strong>}
      </div>
      <div className="sp-ops-revenue-note"><TrendingUp size={18} /><span>Only captured, verified payments without a reconciliation flag are included.</span></div>
    </div>

    <div className="sp-ops-content-grid">
      <article className="sp-ops-panel">
        <div className="sp-ops-panel-head"><div><p className="section-kicker">REVENUE REPORT</p><h2>Verified payments by date</h2><p className="muted-copy">Grouped by currency; failed, pending and flagged payments are excluded.</p></div></div>
        <form className="sp-ops-date-filter" onSubmit={(event) => { event.preventDefault(); setAppliedRange({ from, to }); }}>
          <label>From<input type="date" value={from} max={to} onChange={(event) => setFrom(event.target.value)} required /></label>
          <label>To<input type="date" value={to} min={from} onChange={(event) => setTo(event.target.value)} required /></label>
          <button className="sp-button primary" type="submit">Apply range</button>
        </form>
        <div className="sp-ops-total-chips">{revenueTotals.length ? revenueTotals.map((row) => <div key={row.currency}><span>{row.currency} total</span><strong>{formatMoney(row.amount, row.currency)}</strong></div>) : <span className="sp-ops-muted">No verified payments in this period.</span>}</div>
        <div className="sp-ops-table-wrap"><table className="sp-ops-table"><thead><tr><th>DATE</th><th>CURRENCY</th><th>PAYMENTS</th><th>AMOUNT</th></tr></thead><tbody>
          {revenue.slice().sort((a, b) => b.date.localeCompare(a.date)).map((row, index) => <tr key={`${row.date}-${row.currency}-${index}`}><td>{row.date}</td><td>{row.currency}</td><td>{row.paymentCount}</td><td><strong>{formatMoney(row.amount, row.currency)}</strong></td></tr>)}
          {!revenue.length && <tr><td colSpan="4" className="sp-ops-empty-cell">{loading ? 'Loading verified payments…' : 'No report rows for the selected dates.'}</td></tr>}
        </tbody></table></div>
        <p className="sp-ops-footnote">Report window: {appliedRange.from} through {appliedRange.to} (inclusive, UTC timestamp range).</p>
      </article>

      <article className="sp-ops-panel">
        <div className="sp-ops-panel-head"><div><p className="section-kicker">CAPACITY & OCCUPANCY</p><h2>Facility utilization</h2><p className="muted-copy">Physical occupancy is distinct from a future or current reservation.</p></div></div>
        <div className="sp-ops-occupancy-summary"><div><span>Overall physical occupancy</span><strong>{occupancyPercent}%</strong></div><div className="sp-ops-mini-track"><i style={{ width: `${occupancyPercent}%` }} /></div><div className="sp-ops-occupancy-legend"><span><i className="occupied" /> {physicalOccupied} occupied</span><span><i className="unknown" /> {occupancy.reduce((sum, row) => sum + Number(row.unknownSpaces || 0), 0)} unknown</span><span><i className="available" /> {occupancy.reduce((sum, row) => sum + Number(row.availableSpaces || 0), 0)} available</span></div></div>
        <div className="sp-ops-table-wrap"><table className="sp-ops-table"><thead><tr><th>FACILITY</th><th>TOTAL</th><th>OCCUPIED</th><th>AVAILABLE</th><th>UNKNOWN</th></tr></thead><tbody>
          {occupancy.map((row) => <tr key={row.lotId}><td><strong>{row.name}</strong><small>{row.city}</small></td><td>{row.totalSpaces}</td><td>{row.occupiedSpaces}</td><td>{row.availableSpaces}</td><td>{row.unknownSpaces}</td></tr>)}
          {!occupancy.length && <tr><td colSpan="5" className="sp-ops-empty-cell">{loading ? 'Loading occupancy…' : 'No active facilities in your access scope.'}</td></tr>}
        </tbody></table></div>
      </article>
    </div>

    <article className="sp-ops-panel sp-ops-forecast-panel">
      <div className="sp-ops-panel-head"><div><p className="section-kicker">PLANNING INDICATOR</p><h2>Booking demand outlook</h2><p className="muted-copy">Expected reservation starts for the next 24 hours, based on the same UTC weekday/hour over the previous eight weeks.</p></div></div>
      <div className="sp-ops-forecast-summary"><div><span>Facilities in scope</span><strong>{forecastData?.totalFacilities ?? '—'}</strong></div><div><span>Total spaces</span><strong>{forecastData?.totalCapacity ?? '—'}</strong></div><div><span>Forecast window</span><strong>24 hours</strong></div></div>
      <div className="sp-ops-forecast-list">{(forecastData?.forecast ?? []).slice(0, 24).map((item) => { const pressure = Math.max(0, Math.min(100, Number(item.bookingDemandPercentOfCapacity) || 0)); return <div className="sp-ops-forecast-row" key={item.hourAt}><span>{new Date(item.hourAt).toLocaleTimeString([], { weekday: 'short', hour: '2-digit' })}</span><div className="sp-ops-forecast-track"><i style={{ width: `${pressure}%` }} /></div><strong>{Number(item.expectedBookingStarts || 0).toFixed(1)}</strong><small>{item.confidence} confidence</small></div>; })}
        {!forecastData?.forecast?.length && <div className="sp-ops-empty"><TrendingUp size={20}/><strong>{loading ? 'Preparing demand outlook…' : 'Not enough historical bookings yet'}</strong><span>Forecast quality improves as SmartPark collects booking history.</span></div>}
      </div>
      <p className="sp-ops-footnote">This estimates booking starts, not live physical occupancy. It is a planning signal, not an AI or sensor-based guarantee.</p>
    </article>

    <article className="sp-ops-panel sp-ops-alerts-panel">
      <div className="sp-ops-panel-head sp-ops-alerts-head"><div><p className="section-kicker">ACTION CENTER</p><h2><BellRing size={19} /> Operational alerts</h2><p className="muted-copy">Camera health, unmatched plate candidates, overstays, gate failures, and payment reconciliation alerts are generated from current system records.</p></div>
        <label className="sp-ops-alert-filter">Show<select value={alertStatus} onChange={(event) => setAlertStatus(event.target.value)}><option value="open">Open</option><option value="acknowledged">Acknowledged</option><option value="resolved">Resolved</option><option value="all">All alerts</option></select></label>
      </div>
      <div className="sp-ops-alert-list">{alerts.map((alert) => <AlertCard key={alert.id} alert={alert} onAcknowledge={(item) => updateAlert(item, 'acknowledge')} onResolve={(item) => updateAlert(item, 'resolve')} busyId={busyId} canResolve={canResolve} isAdmin={roles.includes('admin')} />)}
        {!alerts.length && <div className="sp-ops-empty"><CheckCircle2 size={22} /><strong>{loading ? 'Checking operational health…' : 'No alerts in this view'}</strong><span>Detected issues will appear here for camera feeds, plate review, overstays, gate command failures, and payment reconciliation.</span></div>}
      </div>
    </article>
    <p className="sp-ops-last-updated">{loading ? 'Refreshing data…' : `Last loaded ${new Date().toLocaleTimeString()}`} · Reports are scoped to the facilities your account is authorized to access.</p>
    {paymentResolveTarget && <div className="sp-ops-modal-backdrop"><section className="sp-ops-modal" role="dialog" aria-modal="true" aria-labelledby="sp-reconcile-title"><div className="sp-ops-panel-head"><div><p className="section-kicker">ADMINISTRATOR ACTION</p><h2 id="sp-reconcile-title">Record payment reconciliation</h2><p className="muted-copy">{paymentResolveTarget.message}</p></div></div><div className="sp-ops-message error"><ShieldAlert size={16} />This only records a provider/case decision. It does not initiate a refund or confirm the booking.</div><form className="sp-ops-reconcile-form" onSubmit={submitPaymentResolution}><label>Disposition<select value={resolutionDisposition} onChange={(event) => setResolutionDisposition(event.target.value)}><option value="refunded_externally">Refund already processed externally</option><option value="reviewed_no_refund">Reviewed — no refund</option></select></label><label>External provider or case reference<input value={externalReference} onChange={(event) => setExternalReference(event.target.value)} minLength={3} maxLength={180} placeholder="Refund ID or support case number" required /></label><label>Resolution note<textarea value={resolutionNote} onChange={(event) => setResolutionNote(event.target.value)} minLength={10} maxLength={1000} rows={4} placeholder="Record what you checked and the resolution decision" required /></label><div className="sp-ops-modal-actions"><button type="button" className="sp-button ghost" onClick={() => setPaymentResolveTarget(null)} disabled={busyId === paymentResolveTarget.id}>Cancel</button><button type="submit" className="sp-button primary" disabled={busyId === paymentResolveTarget.id}>{busyId === paymentResolveTarget.id ? 'Recording…' : 'Record resolution'}</button></div></form></section></div>}
  </section>;
}
