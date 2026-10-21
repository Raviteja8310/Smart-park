import { useCallback, useEffect, useState } from 'react';
import {
  CalendarClock, CarFront, CheckCircle2, CircleAlert, Clock3, CreditCard,
  Download, ExternalLink, LoaderCircle, MapPin, QrCode, RefreshCw, ShieldCheck,
  X, XCircle
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

function loadRazorpayCheckout() {
  if (window.Razorpay) return Promise.resolve(true);
  const existing = document.querySelector('script[data-smartpark-razorpay]');
  if (existing) return new Promise((resolve, reject) => {
    existing.addEventListener('load', () => resolve(Boolean(window.Razorpay)), { once: true });
    existing.addEventListener('error', () => reject(new Error('Unable to load the payment checkout script.')), { once: true });
  });
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.async = true;
    script.dataset.smartparkRazorpay = 'true';
    script.onload = () => window.Razorpay ? resolve(true) : reject(new Error('The payment checkout script did not initialize.'));
    script.onerror = () => reject(new Error('Unable to load the payment checkout script. Check the network and retry.'));
    document.head.appendChild(script);
  });
}

function money(value, currency = 'INR') {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency, maximumFractionDigits: 2 }).format(Number(value ?? 0));
}
function dateTime(value) {
  if (!value) return 'Not set';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Not set' : date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}
function durationText(startValue, endValue) {
  const minutes = Math.max(0, Math.round((new Date(endValue).getTime() - new Date(startValue).getTime()) / 60000));
  if (!minutes) return '—';
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const remainder = minutes % 60;
  return [days ? `${days}d` : '', hours ? `${hours}h` : '', remainder ? `${remainder}m` : ''].filter(Boolean).join(' ');
}
function prettyStatus(status) {
  return (status ?? 'unknown').replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export default function BookingsPage({ currentUser }) {
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState('');
  const [paymentActionId, setPaymentActionId] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [mockCheckout, setMockCheckout] = useState(null);
  const [ticketModal, setTicketModal] = useState(null);
  const [ticketLoadingId, setTicketLoadingId] = useState('');

  const reload = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await apiRequest('/api/bookings/mine?limit=100');
      setBookings(data.bookings ?? []);
    } catch (requestError) {
      setError(requestError.message || 'Unable to load your bookings.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { reload(); }, [reload, currentUser?.id]);

  async function cancelBooking(booking) {
    if (!window.confirm(`Cancel reservation hold ${booking.bookingCode}?`)) return;
    setBusyId(booking.id); setError(''); setNotice('');
    try {
      const data = await apiRequest(`/api/bookings/${booking.id}/cancel`, { method: 'POST', body: JSON.stringify({}) });
      setNotice(data.message ?? 'Reservation hold cancelled.');
      await reload();
    } catch (requestError) {
      setError(requestError.message || 'Could not cancel this booking.');
    } finally { setBusyId(''); }
  }

  async function beginPayment(booking) {
    setPaymentActionId(booking.id); setError(''); setNotice('');
    try {
      const data = await apiRequest('/api/payments/orders', { method: 'POST', body: JSON.stringify({ bookingId: booking.id }) });
      if (data.checkout?.provider === 'mock') {
        setMockCheckout({ booking, payment: data.payment, checkout: data.checkout });
        return;
      }
      await loadRazorpayCheckout();
      const checkout = new window.Razorpay({
        key: data.checkout.keyId,
        amount: data.checkout.amount,
        currency: data.checkout.currency,
        name: data.checkout.name,
        description: data.checkout.description,
        order_id: data.checkout.orderId,
        prefill: data.checkout.prefill,
        theme: data.checkout.theme,
        notes: { booking_code: booking.bookingCode },
        handler: async (response) => {
          setPaymentActionId(booking.id); setError(''); setNotice('Verifying payment with the provider…');
          try {
            const result = await apiRequest('/api/payments/verify', {
              method: 'POST',
              body: JSON.stringify({ bookingId: booking.id, ...response })
            });
            if (result.requiresReview) setError(result.message || 'Payment was received, but the booking needs manual reconciliation.');
            else setNotice(result.message || 'Payment verified and booking confirmed. Your QR entry ticket is ready.');
            await reload();
          } catch (requestError) {
            setError(`${requestError.message} Refresh transactions before attempting another payment.`);
          } finally { setPaymentActionId(''); }
        },
        modal: { ondismiss: () => setPaymentActionId('') }
      });
      checkout.on('payment.failed', (response) => {
        setError(response?.error?.description || 'Payment was not completed. Your hold may remain available until its expiry time.');
        setPaymentActionId('');
        reload();
      });
      checkout.open();
    } catch (requestError) {
      setError(requestError.message || 'Checkout could not be opened.');
    } finally {
      // Keep the busy indicator while the test-payment modal is open or the Razorpay modal is active.
      if (!window.Razorpay || !mockCheckout) setPaymentActionId((current) => current === booking.id ? '' : current);
    }
  }

  async function completeMockPayment() {
    if (!mockCheckout) return;
    const { booking, payment } = mockCheckout;
    setPaymentActionId(booking.id); setError(''); setNotice('');
    try {
      const result = await apiRequest('/api/payments/mock/complete', { method: 'POST', body: JSON.stringify({ paymentId: payment.id }) });
      setMockCheckout(null);
      if (result.requiresReview) setError(result.message || 'The test payment was simulated, but the booking requires review.');
      else setNotice(result.message || 'TEST MODE: payment simulated. The booking is confirmed.');
      await reload();
    } catch (requestError) {
      setError(requestError.message || 'Test payment could not be completed.');
    } finally { setPaymentActionId(''); }
  }

  async function showTicket(booking) {
    setTicketLoadingId(booking.id); setError('');
    try {
      const data = await apiRequest(`/api/bookings/${booking.id}/ticket`);
      setTicketModal(data.ticket);
    } catch (requestError) { setError(requestError.message || 'Unable to load the QR ticket.'); }
    finally { setTicketLoadingId(''); }
  }

  const filtered = statusFilter === 'all' ? bookings : bookings.filter((booking) => booking.status === statusFilter);
  const awaitingCount = bookings.filter((booking) => ['held', 'pending_payment'].includes(booking.status)).length;
  const confirmedCount = bookings.filter((booking) => ['confirmed', 'checked_in'].includes(booking.status)).length;

  return (
    <section className="sp-page sp-bookings-page">
      <div className="sp-page-heading">
        <div className="sp-heading-title-row">
          <div><p className="sp-kicker">RESERVATION HISTORY</p><h1>My bookings</h1><p>Manage checkout, entry tickets and your reservation history.</p></div>
          <button className="sp-button ghost" onClick={reload} disabled={loading}><RefreshCw size={14} /> Refresh</button>
        </div>
      </div>

      {error && <div className="sp-alert error"><CircleAlert size={17} /><span>{error}</span><button onClick={() => setError('')} aria-label="Dismiss error">×</button></div>}
      {notice && <div className="sp-alert success"><CheckCircle2 size={17} /><span>{notice}</span><button onClick={() => setNotice('')} aria-label="Dismiss notice">×</button></div>}

      <div className="sp-booking-summary-grid">
        <article><span>Total reservations</span><strong>{bookings.length}</strong><small>All recorded bookings</small></article>
        <article><span>Awaiting payment</span><strong>{awaitingCount}</strong><small>Temporary holds expire automatically</small></article>
        <article><span>Confirmed / checked in</span><strong>{confirmedCount}</strong><small>QR tickets available</small></article>
      </div>

      <article className="sp-panel">
        <div className="sp-panel-header"><div><p className="sp-kicker">YOUR RESERVATIONS</p><h2>Booking history</h2><p>In development, test payment is simulated locally and does not charge real money. Production checkout requires provider verification.</p></div><CalendarClock size={20} /></div>
        <div className="sp-booking-filter-row">
          <label>Filter by status
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              <option value="all">All statuses</option><option value="held">Held — awaiting payment</option><option value="pending_payment">Pending payment</option><option value="confirmed">Confirmed</option><option value="checked_in">Checked in</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option><option value="expired">Expired</option><option value="payment_failed">Payment requires review</option>
            </select>
          </label>
          <span className="sp-muted">{filtered.length} {filtered.length === 1 ? 'booking' : 'bookings'}</span>
        </div>

        {loading ? <div className="sp-loading"><LoaderCircle className="sp-spin" size={20} /> Loading bookings…</div>
          : filtered.length === 0 ? <div className="sp-empty-state"><CalendarClock size={28} /><strong>No bookings to show</strong><span>Your reservation history will appear here after you create a hold from an available parking space.</span></div>
            : <div className="sp-bookings-list">{filtered.map((booking) => (
              <article className="sp-booking-row" key={booking.id}>
                <div className="sp-booking-row-icon"><CarFront size={21} /></div>
                <div className="sp-booking-row-main">
                  <div className="sp-booking-row-heading"><strong>{booking.parkingLotName}</strong><span className={`sp-booking-status ${booking.status}`}>{prettyStatus(booking.status)}</span></div>
                  <span className="sp-booking-id">{booking.bookingCode} · Slot {booking.slotCode ?? '—'}</span>
                  <div className="sp-booking-row-meta"><span><MapPin size={13} /> {booking.city ?? 'Location details unavailable'}</span><span><Clock3 size={13} /> {durationText(booking.startAt, booking.endAt)}</span></div>
                  <div className="sp-booking-row-meta"><span>Start: {dateTime(booking.startAt)}</span><span>End: {dateTime(booking.endAt)}</span></div>
                  {booking.vehicleRegistration && <div className="sp-booking-id">Vehicle: {booking.vehicleRegistration}</div>}
                  {['held', 'pending_payment'].includes(booking.status) && booking.holdExpiresAt && <p className="sp-booking-hold-note">Payment is not completed. Hold expires at {dateTime(booking.holdExpiresAt)}.</p>}
                  {booking.status === 'payment_failed' && <p className="sp-booking-hold-note">This reservation needs payment reconciliation. Check Transactions or contact support before trying again.</p>}
                </div>
                <div className="sp-booking-row-amount"><strong>{money(booking.totalAmount, booking.currency)}</strong><small>Includes configured fees and tax</small>
                  {['held', 'pending_payment'].includes(booking.status) && <div className="sp-booking-action-stack">
                    <button className="sp-button primary" disabled={paymentActionId === booking.id} onClick={() => beginPayment(booking)}>{paymentActionId === booking.id ? <LoaderCircle className="sp-spin" size={14} /> : <CreditCard size={14} />} Pay now</button>
                    <button className="sp-button ghost danger-text" disabled={busyId === booking.id || paymentActionId === booking.id} onClick={() => cancelBooking(booking)}>{busyId === booking.id ? <LoaderCircle className="sp-spin" size={14} /> : <XCircle size={14} />} Cancel hold</button>
                  </div>}
                  {['confirmed', 'checked_in'].includes(booking.status) && <button className="sp-button secondary" onClick={() => showTicket(booking)} disabled={ticketLoadingId === booking.id}>{ticketLoadingId === booking.id ? <LoaderCircle className="sp-spin" size={14} /> : <QrCode size={14} />} View entry QR</button>}
                </div>
              </article>
            ))}</div>}
      </article>

      {mockCheckout && <div className="sp-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !paymentActionId) setMockCheckout(null); }}>
        <section className="sp-modal-card" role="dialog" aria-modal="true" aria-labelledby="sp-mock-payment-title">
          <button className="sp-modal-close" onClick={() => setMockCheckout(null)} disabled={Boolean(paymentActionId)} aria-label="Close test checkout"><X size={18} /></button>
          <div className="sp-ticket-icon"><CreditCard size={22} /></div>
          <p className="sp-kicker">LOCAL DEVELOPMENT ONLY</p><h2 id="sp-mock-payment-title">Simulate test payment</h2>
          <p className="sp-modal-copy">This is not a real payment and will not charge your account. Use it only to test the confirmation and QR-ticket flow before configuring a payment provider.</p>
          <div className="sp-ticket-details"><span>Booking <strong>{mockCheckout.payment.bookingCode}</strong></span><span>Location <strong>{mockCheckout.booking.parkingLotName}</strong></span><span>Total <strong>{money(mockCheckout.payment.amount, mockCheckout.payment.currency)}</strong></span><span>Test order <strong>{mockCheckout.payment.providerOrderId}</strong></span></div>
          <button className="sp-button primary sp-modal-main-action" onClick={completeMockPayment} disabled={Boolean(paymentActionId)}>{paymentActionId ? <LoaderCircle className="sp-spin" size={15} /> : <CheckCircle2 size={15} />} Complete successful test payment</button>
          <button className="sp-button ghost sp-modal-main-action" onClick={() => setMockCheckout(null)} disabled={Boolean(paymentActionId)}>Cancel</button>
        </section>
      </div>}

      {ticketModal && <div className="sp-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setTicketModal(null); }}>
        <section className="sp-modal-card sp-ticket-modal" role="dialog" aria-modal="true" aria-labelledby="sp-ticket-title">
          <button className="sp-modal-close" onClick={() => setTicketModal(null)} aria-label="Close QR ticket"><X size={18} /></button>
          <div className="sp-ticket-icon"><QrCode size={22} /></div><p className="sp-kicker">SMARTPARK ENTRY PASS</p><h2 id="sp-ticket-title">Your parking QR</h2>
          <p className="sp-modal-copy">Show this code to an authorized attendant at the parking facility. Keep it private; it grants access to this reservation.</p>
          <div className="sp-ticket-qr-wrap"><img src={ticketModal.qrDataUrl} alt={`QR entry ticket for booking ${ticketModal.bookingCode}`} /></div>
          <div className="sp-ticket-details"><span>Booking <strong>{ticketModal.bookingCode}</strong></span><span>Location <strong>{ticketModal.parkingLotName}</strong></span><span>Space <strong>{ticketModal.slotCode}</strong></span><span>Start <strong>{dateTime(ticketModal.startAt)}</strong></span><span>End <strong>{dateTime(ticketModal.endAt)}</strong></span><span>Ticket expires <strong>{dateTime(ticketModal.expiresAt)}</strong></span></div>
          <a className="sp-button primary sp-modal-main-action sp-ticket-download" href={ticketModal.qrDataUrl} download={`SmartPark-${ticketModal.bookingCode}-QR.png`}><Download size={15} /> Download QR ticket <ExternalLink size={13} /></a>
          <p className="sp-form-hint sp-ticket-security"><ShieldCheck size={13} /> This QR is signed and validated by the SmartPark server.</p>
        </section>
      </div>}
    </section>
  );
}
