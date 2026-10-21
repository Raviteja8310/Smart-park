import { useCallback, useEffect, useState } from 'react';
import { ArrowDownLeft, CheckCircle2, CircleAlert, CreditCard, LoaderCircle, RefreshCw, WalletCards } from 'lucide-react';

async function apiRequest(path) {
  const response = await fetch(path, { credentials: 'same-origin' });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message ?? 'Unable to load transactions.');
  return data;
}
function money(amount, currency = 'INR') {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency, maximumFractionDigits: 2 }).format(Number(amount ?? 0));
}
function dateTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}
function label(value) { return (value ?? 'unknown').replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()); }

export default function TransactionsPage() {
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const reload = useCallback(async () => {
    setLoading(true); setError('');
    try { const data = await apiRequest('/api/payments/mine'); setPayments(data.payments ?? []); }
    catch (requestError) { setError(requestError.message || 'Unable to load transactions.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { reload(); }, [reload]);

  const paid = payments.filter((item) => item.status === 'paid');
  const pending = payments.filter((item) => ['created', 'pending', 'authorized'].includes(item.status));
  const paidTotals = paid.reduce((totals, item) => { totals[item.currency] = (totals[item.currency] ?? 0) + Number(item.amount || 0); return totals; }, {});

  return <section className="sp-page sp-bookings-page">
    <div className="sp-page-heading"><div className="sp-heading-title-row"><div><p className="sp-kicker">PAYMENTS & RECEIPTS</p><h1>Transactions</h1><p>Review payment attempts and provider verification status. Pending orders are not completed payments.</p></div><button className="sp-button ghost" onClick={reload} disabled={loading}><RefreshCw size={14} /> Refresh</button></div></div>
    {error && <div className="sp-alert error"><CircleAlert size={17} /><span>{error}</span></div>}
    <div className="sp-booking-summary-grid">
      <article><span>Payment attempts</span><strong>{payments.length}</strong><small>Provider records</small></article>
      <article><span>Paid transactions</span><strong>{paid.length}</strong><small>Verified by SmartPark</small></article>
      <article><span>Verified amount</span><strong className="sp-verified-totals">{Object.entries(paidTotals).map(([currency, amount]) => money(amount, currency)).join(' · ') || '—'}</strong><small>{pending.length} pending or processing</small></article>
    </div>
    <article className="sp-panel">
      <div className="sp-panel-header"><div><p className="sp-kicker">TRANSACTION HISTORY</p><h2>Payment activity</h2><p>Payment references are provider-generated. SmartPark does not store raw card or UPI credentials.</p></div><WalletCards size={20} /></div>
      {loading ? <div className="sp-loading"><LoaderCircle className="sp-spin" size={20} /> Loading transactions…</div>
        : payments.length === 0 ? <div className="sp-empty-state"><CreditCard size={28} /><strong>No transactions yet</strong><span>When you start checkout for a reservation, the payment attempt will appear here.</span></div>
          : <div className="sp-bookings-list">{payments.map((payment) => <article className="sp-booking-row" key={payment.id}>
            <div className="sp-booking-row-icon">{payment.status === 'paid' ? <CheckCircle2 size={21} /> : <ArrowDownLeft size={21} />}</div>
            <div className="sp-booking-row-main"><div className="sp-booking-row-heading"><strong>{payment.parkingLotName ?? 'Parking reservation'}</strong><span className={`sp-booking-status ${payment.status}`}>{label(payment.status)}</span></div>
              <span className="sp-booking-id">Booking {payment.bookingCode ?? '—'} · Provider {payment.provider}</span>
              <div className="sp-booking-row-meta"><span>Created: {dateTime(payment.createdAt)}</span><span>{payment.verifiedAt ? `Verified: ${dateTime(payment.verifiedAt)}` : 'Not verified'}</span></div>
              {payment.providerPaymentId && <span className="sp-booking-id">Payment reference: {payment.providerPaymentId}</span>}
              {payment.requiresReview && <p className="sp-booking-hold-note">Payment was received but requires reconciliation. Do not retry payment for this booking; contact the operator or support team.</p>}
            </div>
            <div className="sp-booking-row-amount"><strong>{money(payment.amount, payment.currency)}</strong><small>Booking status: {label(payment.bookingStatus)}</small>{payment.status === 'paid' && <a className="sp-button ghost sp-transaction-receipt" href={`/api/payments/${payment.id}/receipt`} target="_blank" rel="noopener noreferrer">View receipt</a>}</div>
          </article>)}</div>}
    </article>
  </section>;
}
