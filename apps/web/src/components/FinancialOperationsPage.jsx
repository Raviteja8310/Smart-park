import { useCallback, useEffect, useState } from 'react';
import {
  BadgeCheck, Banknote, CheckCircle2, CircleAlert, Clock3, FileCheck2,
  LoaderCircle, RefreshCw, RotateCcw, ShieldCheck, Wallet
} from 'lucide-react';

async function request(path, options = {}) {
  const response = await fetch(path, {
    credentials: 'same-origin',
    ...options,
    headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers ?? {}) }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message ?? 'The financial operation could not be completed.');
  return data;
}
function money(value, currency = 'INR') {
  try { return new Intl.NumberFormat('en-IN', { style: 'currency', currency, maximumFractionDigits: 2 }).format(Number(value ?? 0)); }
  catch { return `${currency} ${Number(value ?? 0).toFixed(2)}`; }
}
function dateTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}
function label(value) { return String(value ?? 'unknown').replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()); }
function notePrompt(message, min = 5) {
  const note = window.prompt(message);
  if (note === null) return null;
  if (note.trim().length < min) { window.alert(`Please enter at least ${min} characters.`); return null; }
  return note.trim();
}
function referencePrompt() {
  const reference = window.prompt('Enter the external bank or payment-provider transfer/refund reference. SmartPark does not perform the transfer.');
  if (reference === null) return null;
  const value = reference.trim();
  if (value.length < 3 || value.length > 180 || !/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(value)) {
    window.alert('Enter a valid external reference (3–180 letters, numbers, dot, dash, slash, colon or underscore).');
    return null;
  }
  return value;
}

export default function FinancialOperationsPage() {
  const [earnings, setEarnings] = useState([]);
  const [refunds, setRefunds] = useState([]);
  const [payouts, setPayouts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const reload = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [earningData, refundData, payoutData] = await Promise.all([
        request('/api/financial/earnings/queue'),
        request('/api/financial/refunds/queue'),
        request('/api/financial/payouts/queue')
      ]);
      setEarnings(earningData.earnings ?? []);
      setRefunds(refundData.refunds ?? []);
      setPayouts(payoutData.payouts ?? []);
    } catch (requestError) {
      setError(requestError.message || 'Unable to load the financial review queue. Ensure migration 010 has been applied.');
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { reload(); }, [reload]);

  async function mutate(key, path, body, successText) {
    setBusy(key); setError(''); setMessage('');
    try {
      await request(path, { method: 'POST', body: JSON.stringify(body ?? {}) });
      setMessage(successText);
      await reload();
    } catch (requestError) {
      setError(requestError.message || 'The financial operation failed.');
    } finally { setBusy(''); }
  }

  function reviewEarning(item, action) {
    const note = notePrompt(action === 'approve' ? 'Why is this completed earning eligible for payout approval?' : 'Why should this earning be reversed?');
    if (!note) return;
    const endpoint = action === 'approve'
      ? `/api/financial/earnings/${item.id}/approve`
      : `/api/financial/earnings/${item.id}/reverse`;
    mutate(`earning:${item.id}`, endpoint, { note }, action === 'approve' ? 'Earning approved.' : 'Earning reversed.');
  }

  function reviewRefund(item, action) {
    if (action === 'mark-refunded') {
      const externalReference = referencePrompt();
      if (!externalReference) return;
      const note = notePrompt('Confirm that the refund was actually completed in the payment provider. Enter the check performed.', 10);
      if (!note) return;
      mutate(`refund:${item.id}`, `/api/financial/refunds/${item.id}/mark-refunded`, { externalReference, note }, 'Refund completion recorded and audited.');
      return;
    }
    const prompts = {
      approve: 'Why is this customer refund request approved?',
      reject: 'Why is this customer refund request rejected?',
      'start-processing': 'Confirm the booking is still eligible. Refund will be handled externally, and gate entry will be blocked while processing.',
      'mark-failed': 'Record why the external refund failed or was not submitted.',
      'manual-review': 'Explain why the external provider result needs manual reconciliation.'
    };
    const note = notePrompt(prompts[action] ?? 'Enter an audit note.', action === 'start-processing' ? 10 : 5);
    if (!note) return;
    mutate(`refund:${item.id}`, `/api/financial/refunds/${item.id}/${action}`, { note }, `Refund ${action.replaceAll('-', ' ')} recorded.`);
  }

  function reviewPayout(item, action) {
    if (action === 'mark-paid') {
      const externalReference = referencePrompt();
      if (!externalReference) return;
      const note = notePrompt('Confirm that the bank/provider transfer has actually completed. Enter the reconciliation note.', 10);
      if (!note) return;
      mutate(`payout:${item.id}`, `/api/financial/payouts/${item.id}/mark-paid`, { externalReference, note }, 'Payout transfer reference recorded.');
      return;
    }
    const prompts = {
      approve: 'Why is this host payout request approved?',
      reject: 'Why is this host payout request rejected?',
      'mark-failed': 'Record why the external transfer failed or was not made.',
      'manual-review': 'Explain why the payout needs manual reconciliation.'
    };
    const note = notePrompt(prompts[action] ?? 'Enter an audit note.');
    if (!note) return;
    mutate(`payout:${item.id}`, `/api/financial/payouts/${item.id}/${action}`, { note }, `Payout ${action.replaceAll('-', ' ')} recorded.`);
  }

  return <section className="sp-page sp-bookings-page sp-finance-page">
    <div className="sp-page-heading">
      <div className="sp-heading-title-row"><div><p className="sp-kicker">ADMINISTRATION · CONTROLLED FINANCE</p><h1>Finance review</h1><p>Review completed host earnings, customer refunds and external payout records. Every action is written to the audit log.</p></div>
        <button className="sp-button ghost" onClick={reload} disabled={loading || Boolean(busy)}><RefreshCw size={14} /> Refresh</button>
      </div>
    </div>
    <div className="sp-earnings-notice"><ShieldCheck size={18} /><div><strong>Manual provider operations only</strong><p>SmartPark does not transfer money from this screen. Before marking a refund or payout completed, perform it in the configured provider/bank system and enter its real reference. Never use a made-up reference.</p></div></div>
    {error && <div className="sp-alert error"><CircleAlert size={16} /><span>{error}</span></div>}
    {message && <div className="sp-alert success"><CheckCircle2 size={16} /><span>{message}</span></div>}
    {loading ? <div className="sp-loading"><LoaderCircle className="sp-spin" size={20} /> Loading finance queues…</div> : <>
      <section className="sp-finance-queue-grid">
        <article className="sp-finance-queue-card"><span className="sp-finance-queue-icon"><Clock3 size={17} /></span><div><strong>{earnings.length}</strong><small>Pending earnings reviews</small></div></article>
        <article className="sp-finance-queue-card"><span className="sp-finance-queue-icon amber"><RotateCcw size={17} /></span><div><strong>{refunds.filter((item) => ['requested', 'approved', 'processing', 'manual_review'].includes(item.status)).length}</strong><small>Open refund requests</small></div></article>
        <article className="sp-finance-queue-card"><span className="sp-finance-queue-icon blue"><Banknote size={17} /></span><div><strong>{payouts.filter((item) => ['requested', 'approved', 'manual_review'].includes(item.status)).length}</strong><small>Open host payouts</small></div></article>
      </section>

      <article className="sp-panel sp-finance-panel">
        <div className="sp-panel-header"><div><p className="sp-kicker">HOST LEDGER</p><h2>Completed earnings awaiting review</h2><p>Only verified, non-reconciled payments from completed bookings can be approved for payout. Other pending records stay blocked.</p></div><BadgeCheck size={20} /></div>
        {earnings.length === 0 ? <div className="sp-ops-empty"><FileCheck2 size={24} /><strong>No pending host earnings</strong><span>New host earnings appear here after verified payment. Approve only after the corresponding booking is completed.</span></div> : <div className="sp-finance-record-list">{earnings.map((item) => <article className="sp-finance-record" key={item.id}>
          <div className="sp-finance-record-main"><div className="sp-ops-alert-heading"><strong>{item.booking_code} · {item.parking_lot_name}</strong><span className={`sp-ops-alert-state ${item.eligibleForApproval ? 'resolved' : 'open'}`}>{item.eligibleForApproval ? 'Eligible' : 'Hold'}</span></div>
            <p>{item.owner_name ?? item.owner_email} · {label(item.booking_status)} · {dateTime(item.start_at)}</p><small>{item.needsReconciliation ? 'Payment needs reconciliation.' : item.payment_status !== 'paid' ? 'Payment is not verified as paid.' : 'Booking must be completed before approval.'}</small></div>
          <div className="sp-finance-record-value"><strong>{money(item.netAmount, item.currency)}</strong><small>Host ledger amount</small><div className="sp-ops-alert-actions"><button className="sp-button primary" disabled={!item.eligibleForApproval || busy === `earning:${item.id}`} onClick={() => reviewEarning(item, 'approve')}>Approve</button><button className="sp-button ghost" disabled={busy === `earning:${item.id}`} onClick={() => reviewEarning(item, 'reverse')}>Reverse</button></div></div>
        </article>)}</div>}
      </article>

      <article className="sp-panel sp-finance-panel">
        <div className="sp-panel-header"><div><p className="sp-kicker">CUSTOMER CARE</p><h2>Refund requests</h2><p>Requests cover the full payment amount. A refund is complete only after the external refund reference has been verified and recorded.</p></div><RotateCcw size={20} /></div>
        {refunds.length === 0 ? <div className="sp-ops-empty"><RotateCcw size={24} /><strong>No refund requests</strong><span>Customer refund requests will appear here for administrator review.</span></div> : <div className="sp-finance-record-list">{refunds.map((item) => <article className="sp-finance-record" key={item.id}>
          <div className="sp-finance-record-main"><div className="sp-ops-alert-heading"><strong>{item.bookingCode} · {item.parkingLotName}</strong><span className={`sp-ops-alert-state ${['succeeded', 'rejected', 'failed'].includes(item.status) ? 'resolved' : 'open'}`}>{label(item.status)}</span></div>
            <p>{item.requesterName ?? item.requesterEmail} · {dateTime(item.requestedAt)}</p><small>Reason: {item.reason}{item.providerRefundReference ? ` · Reference: ${item.providerRefundReference}` : ''}{item.adminNote ? ` · Note: ${item.adminNote}` : ''}</small></div>
          <div className="sp-finance-record-value"><strong>{money(item.amount, item.currency)}</strong><small>Full-payment refund request</small><div className="sp-ops-alert-actions">
            {item.status === 'requested' && <><button className="sp-button primary" disabled={busy === `refund:${item.id}`} onClick={() => reviewRefund(item, 'approve')}>Approve</button><button className="sp-button ghost" disabled={busy === `refund:${item.id}`} onClick={() => reviewRefund(item, 'reject')}>Reject</button></>}
            {item.status === 'approved' && <><button className="sp-button primary" disabled={busy === `refund:${item.id}`} onClick={() => reviewRefund(item, 'start-processing')}>Start processing</button><button className="sp-button ghost" disabled={busy === `refund:${item.id}`} onClick={() => reviewRefund(item, 'reject')}>Reject</button></>}
            {['processing', 'manual_review'].includes(item.status) && <><button className="sp-button primary" disabled={busy === `refund:${item.id}`} onClick={() => reviewRefund(item, 'mark-refunded')}>Record refunded</button><button className="sp-button ghost" disabled={busy === `refund:${item.id}`} onClick={() => reviewRefund(item, 'mark-failed')}>Record failed</button>{item.status === 'processing' && <button className="sp-button ghost" disabled={busy === `refund:${item.id}`} onClick={() => reviewRefund(item, 'manual-review')}>Manual review</button>}</>}
          </div></div>
        </article>)}</div>}
      </article>

      <article className="sp-panel sp-finance-panel">
        <div className="sp-panel-header"><div><p className="sp-kicker">HOST SETTLEMENT</p><h2>Payout requests</h2><p>Owners request all approved, unreserved earnings for one currency. Bank transfer is performed outside SmartPark and then recorded here.</p></div><Wallet size={20} /></div>
        {payouts.length === 0 ? <div className="sp-ops-empty"><Banknote size={24} /><strong>No payout requests</strong><span>Approved host earnings will be reserved when a host requests a payout.</span></div> : <div className="sp-finance-record-list">{payouts.map((item) => <article className="sp-finance-record" key={item.id}>
          <div className="sp-finance-record-main"><div className="sp-ops-alert-heading"><strong>{item.ownerName ?? item.ownerEmail}</strong><span className={`sp-ops-alert-state ${['paid', 'rejected', 'failed'].includes(item.status) ? 'resolved' : 'open'}`}>{label(item.status)}</span></div>
            <p>{item.earningCount} earning record(s) · Requested {dateTime(item.requestedAt)}</p><small>{item.ownerNote ? `Owner note: ${item.ownerNote} · ` : ''}{item.externalReference ? `Transfer reference: ${item.externalReference} · ` : ''}{item.adminNote ? `Admin note: ${item.adminNote}` : ''}</small></div>
          <div className="sp-finance-record-value"><strong>{money(item.amount, item.currency)}</strong><small>External transfer</small><div className="sp-ops-alert-actions">
            {item.status === 'requested' && <><button className="sp-button primary" disabled={busy === `payout:${item.id}`} onClick={() => reviewPayout(item, 'approve')}>Approve</button><button className="sp-button ghost" disabled={busy === `payout:${item.id}`} onClick={() => reviewPayout(item, 'reject')}>Reject</button></>}
            {['approved', 'manual_review'].includes(item.status) && <><button className="sp-button primary" disabled={busy === `payout:${item.id}`} onClick={() => reviewPayout(item, 'mark-paid')}>Record paid</button><button className="sp-button ghost" disabled={busy === `payout:${item.id}`} onClick={() => reviewPayout(item, 'mark-failed')}>Record failed</button>{item.status === 'approved' && <button className="sp-button ghost" disabled={busy === `payout:${item.id}`} onClick={() => reviewPayout(item, 'manual-review')}>Manual review</button>}</>}
          </div></div>
        </article>)}</div>}
      </article>
    </>}
  </section>;
}
