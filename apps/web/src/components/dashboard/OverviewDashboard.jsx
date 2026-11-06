import { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import {
  Activity, AlertTriangle, ArrowUpRight, Building2, CalendarClock, CalendarDays, CarFront, CheckCircle2, CircleDashed,
  CreditCard, Gauge, MapPin, Plus, Search, ShieldAlert, SquareParking, TrendingUp, Wallet
} from 'lucide-react';
import { AnimatedNumber, AreaChart, EmptyState, LiveDot, MetricCard, RingGauge, Skeleton, StateBar, stagger } from '../ui/primitives.jsx';

const money = (amount, currency = 'INR', digits = 0) => new Intl.NumberFormat('en-IN', { style: 'currency', currency, maximumFractionDigits: digits }).format(Number(amount ?? 0));
const statusLabel = (status) => ({ held: 'Awaiting payment', pending_payment: 'Pending payment', confirmed: 'Confirmed', checked_in: 'Checked in', completed: 'Completed', cancelled: 'Cancelled', expired: 'Expired', payment_failed: 'Payment failed' }[status] ?? status);
const statusTone = (status) => ({ confirmed: 'reserved', checked_in: 'occupied', completed: 'available', cancelled: 'muted', expired: 'muted', payment_failed: 'danger', held: 'warning', pending_payment: 'warning' }[status] ?? 'muted');
const dateLabel = (value) => { const d = new Date(value); return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }); };
const durationLabel = (a, b) => { const m = Math.max(0, Math.round((new Date(b) - new Date(a)) / 60000)); const h = Math.floor(m / 60); return [h ? `${h}h` : '', m % 60 ? `${m % 60}m` : ''].filter(Boolean).join(' ') || '—'; };
const ago = (value) => { const s = Math.round((Date.now() - new Date(value).getTime()) / 1000); if (!Number.isFinite(s)) return ''; if (s < 60) return 'just now'; if (s < 3600) return `${Math.floor(s / 60)}m ago`; if (s < 86400) return `${Math.floor(s / 3600)}h ago`; return `${Math.floor(s / 86400)}d ago`; };

async function getJson(url) {
  const response = await fetch(url, { credentials: 'same-origin' });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message ?? 'Request failed.');
  return data;
}

/** Management-only feeds: revenue trend, open alerts, per-facility health. */
function useOperationsFeeds(enabled) {
  const [state, setState] = useState({ loading: enabled, revenue: null, alerts: null, lots: null, error: '' });
  useEffect(() => {
    if (!enabled) { setState({ loading: false, revenue: null, alerts: null, lots: null, error: '' }); return undefined; }
    let cancelled = false;
    const load = async () => {
      const [revenue, alerts, occupancy] = await Promise.allSettled([
        getJson('/api/operations/reports/revenue'),
        getJson('/api/operations/alerts?status=open&limit=6'),
        getJson('/api/operations/reports/occupancy')
      ]);
      if (cancelled) return;
      setState({
        loading: false,
        revenue: revenue.status === 'fulfilled' ? revenue.value.series ?? [] : null,
        alerts: alerts.status === 'fulfilled' ? alerts.value.alerts ?? [] : null,
        lots: occupancy.status === 'fulfilled' ? occupancy.value.lots ?? [] : null,
        error: [revenue, alerts, occupancy].find((r) => r.status === 'rejected')?.reason?.message ?? ''
      });
    };
    load();
    const id = window.setInterval(load, 60000);
    return () => { cancelled = true; window.clearInterval(id); };
  }, [enabled]);
  return state;
}

function Panel({ kicker, title, action, children, className = '' }) {
  return (
    <motion.section className={`sp-card ${className}`} variants={stagger.item}>
      <header className="sp-card-head">
        <div>{kicker && <p className="sp-kicker">{kicker}</p>}<h2>{title}</h2></div>
        {action}
      </header>
      {children}
    </motion.section>
  );
}

function LinkButton({ children, onClick }) {
  return <button type="button" className="sp-link-btn" onClick={onClick}>{children}<ArrowUpRight size={14} aria-hidden="true" /></button>;
}

export default function OverviewDashboard({ parkingOverview, overviewError, displayName, isManagement, recentBookings, recentBookingsLoading, recentBookingsError, onNavigate, translate }) {
  const o = parkingOverview?.overview;
  const loaded = Boolean(o);
  const occupancy = o && o.openSpaces ? (o.occupiedNow + o.reservedNow) / o.openSpaces : null;
  const ops = useOperationsFeeds(isManagement);
  const [query, setQuery] = useState('');

  const revenuePoints = useMemo(() => {
    if (!ops.revenue?.length) return [];
    const byDate = new Map();
    ops.revenue.forEach((r) => byDate.set(r.date, (byDate.get(r.date) ?? 0) + r.amount));
    return [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([d, y]) => ({ x: new Date(`${d}T00:00:00`).toLocaleDateString([], { day: 'numeric', month: 'short' }), y }));
  }, [ops.revenue]);
  const revenueTotal = ops.revenue?.reduce((acc, r) => acc + r.amount, 0) ?? null;
  const revenueCurrency = ops.revenue?.[0]?.currency ?? 'INR';
  const paymentCount = ops.revenue?.reduce((acc, r) => acc + r.paymentCount, 0) ?? null;

  const facilities = isManagement && ops.lots
    ? ops.lots.map((l) => ({ id: l.lotId, name: l.name, city: l.city, total: l.totalSpaces, available: l.availableSpaces, occupied: l.occupiedSpaces, reserved: l.reservedEmptySpaces, unknown: l.unknownSpaces, pct: l.occupancyPercent }))
    : (parkingOverview?.featuredLots ?? []).map((l) => ({ id: l.id, name: l.name, city: l.city, total: l.totalSpaces, available: l.availableNow, rate: l.hourlyRate, currency: l.currency, pct: l.totalSpaces ? Math.round(((l.totalSpaces - l.availableNow) / l.totalSpaces) * 100) : null }));

  const bookings = recentBookings.filter((b) => `${b.bookingCode} ${b.parkingLotName ?? ''} ${b.slotCode ?? ''}`.toLowerCase().includes(query.toLowerCase()));
  const activeSessions = recentBookings.filter((b) => b.status === 'checked_in' || (b.status === 'confirmed' && new Date(b.startAt) <= new Date() && new Date(b.endAt) > new Date()));
  const firstName = (displayName || '').split(/\s+/)[0];
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  return (
    <motion.div className="sp-dash" initial="hidden" animate="show" variants={stagger.container}>
      <motion.section className="sp-hero" variants={stagger.item}>
        <div className="sp-hero-copy">
          <LiveDot state={overviewError ? 'down' : loaded ? 'live' : 'pending'} label={overviewError ? 'Live feed unavailable' : 'Live network · refreshes every 30s'} />
          <h1>{greeting}, {firstName}</h1>
          <p>{isManagement ? 'Your parking network at a glance — capacity, occupancy, revenue and alerts across the facilities you manage.' : 'Find, reserve and manage parking across the SmartPark network.'}</p>
          <div className="sp-hero-actions">
            <button type="button" className="sp-btn primary" onClick={() => onNavigate('Find parking')}><Search size={16} /> {translate('Find a parking spot')}</button>
            <button type="button" className="sp-btn ghost" onClick={() => onNavigate(isManagement ? 'Operations' : 'My bookings')}>{isManagement ? <><Activity size={16} /> Operations</> : <><CalendarDays size={16} /> My bookings</>}</button>
          </div>
        </div>
        <div className="sp-hero-gauge">
          <RingGauge ratio={occupancy} size={148} label="Network occupancy" />
          <dl className="sp-hero-stats">
            <div><dt>Open spaces</dt><dd><AnimatedNumber value={o?.openSpaces} /></dd></div>
            <div><dt>Facilities</dt><dd><AnimatedNumber value={o?.activeLots} /></dd></div>
          </dl>
        </div>
      </motion.section>

      {overviewError && <div className="sp-inline-alert" role="alert"><ShieldAlert size={16} /> {overviewError}</div>}

      <motion.section className="sp-metrics" variants={stagger.container} aria-label="Network capacity">
        <MetricCard icon={Building2} label="Total capacity" value={o?.totalSpaces} note={`${o?.activeLots ?? '—'} active facilities`} tone="ion" />
        <MetricCard icon={CheckCircle2} label="Available now" value={o?.availableNow} note="Empty and unreserved" tone="available" />
        <MetricCard icon={CarFront} label="Occupied" value={o?.occupiedNow} note="Latest sensor state" tone="occupied" />
        <MetricCard icon={CalendarClock} label="Reserved" value={o?.reservedNow} note="Active booking windows" tone="reserved" />
        <MetricCard icon={CircleDashed} label="Unknown state" value={o?.unknownSpaces} note="Awaiting sensor or staff update" tone="unknown" />
      </motion.section>

      <div className="sp-dash-grid">
        <Panel kicker="Parking utilisation" title="Space composition" className="span-7" action={<LinkButton onClick={() => onNavigate('Find parking')}>Explore map</LinkButton>}>
          {loaded ? <StateBar total={o.totalSpaces || undefined} segments={[
            { key: 'a', label: 'Available', value: o.availableNow, color: 'var(--state-available)' },
            { key: 'o', label: 'Occupied', value: o.occupiedNow, color: 'var(--state-occupied)' },
            { key: 'r', label: 'Reserved', value: o.reservedNow, color: 'var(--state-reserved)' },
            { key: 'u', label: 'Unknown', value: o.unknownSpaces, color: 'var(--state-unknown)' },
            { key: 'c', label: 'Closed', value: Math.max(0, o.totalSpaces - o.openSpaces), color: 'var(--state-maintenance)' }
          ]} /> : <Skeleton lines={2} />}
          <div className="sp-subhead"><strong>{isManagement ? 'Facility health' : 'Featured facilities'}</strong><span>{facilities.length ? `${facilities.length} shown` : ''}</span></div>
          {facilities.length ? (
            <ul className="sp-zone-list">
              {facilities.slice(0, 6).map((f) => {
                const pct = f.pct ?? 0;
                const health = f.total === 0 ? 'unknown' : pct >= 90 ? 'critical' : pct >= 70 ? 'busy' : 'healthy';
                return (
                  <li key={f.id}>
                    <button type="button" onClick={() => onNavigate(isManagement ? 'Parking spaces' : 'Find parking')}>
                      <span className={`sp-zone-health ${health}`} aria-hidden="true" />
                      <span className="sp-zone-copy"><strong>{f.name}</strong><small><MapPin size={12} /> {f.city || 'Location set by owner'} · {f.available ?? '—'} of {f.total} free</small></span>
                      <span className="sp-zone-bar" aria-hidden="true"><motion.i initial={{ width: 0 }} animate={{ width: `${Math.min(100, pct)}%` }} transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }} /></span>
                      <span className="sp-zone-pct sp-num">{f.total ? `${Math.round(pct)}%` : '—'}</span>
                      {f.rate != null && <span className="sp-zone-rate sp-num">{money(f.rate, f.currency || 'INR')}<small>/hr</small></span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : loaded ? (
            <EmptyState icon={SquareParking} title="No published facilities yet" action={<button type="button" className="sp-btn subtle" onClick={() => onNavigate('Parking spaces')}><Plus size={15} /> Add a facility</button>}>
              Publish a facility to see live occupancy and zone health here.
            </EmptyState>
          ) : <Skeleton lines={4} />}
        </Panel>

        {isManagement ? (
          <Panel kicker="Real-time alerts" title="Operational alerts" className="span-5" action={<LinkButton onClick={() => onNavigate('Operations')}>All alerts</LinkButton>}>
            {ops.loading ? <Skeleton lines={4} /> : ops.alerts?.length ? (
              <ul className="sp-alert-list">
                {ops.alerts.map((a) => (
                  <motion.li key={a.id} className={`sev-${a.severity}`} layout initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }}>
                    <span className="sp-alert-icon" aria-hidden="true"><AlertTriangle size={15} /></span>
                    <span className="sp-alert-copy"><strong>{a.title}</strong><small>{a.parking_lot_name ? `${a.parking_lot_name} · ` : ''}{ago(a.last_seen_at)}</small></span>
                    <span className={`sp-chip ${a.severity === 'critical' ? 'danger' : a.severity === 'warning' ? 'warning' : 'muted'}`}>{a.severity}</span>
                  </motion.li>
                ))}
              </ul>
            ) : ops.alerts ? <EmptyState icon={CheckCircle2} title="All clear">No open alerts across your facilities.</EmptyState>
              : <EmptyState icon={ShieldAlert} title="Alerts unavailable">{ops.error || 'Alert feed could not be loaded.'}</EmptyState>}
          </Panel>
        ) : (
          <Panel kicker="Quick access" title="Get moving" className="span-5">
            <div className="sp-quick">
              {[
                { label: 'Find parking nearby', hint: 'Live availability and pricing', icon: Search, to: 'Find parking' },
                { label: 'My reservations', hint: 'Upcoming, active and past', icon: CalendarDays, to: 'My bookings' },
                { label: 'Vehicles', hint: 'Registered plates and categories', icon: CarFront, to: 'Vehicles' },
                { label: 'Payments & receipts', hint: 'Transactions and refunds', icon: CreditCard, to: 'Transactions' }
              ].map(({ label, hint, icon: Icon, to }) => (
                <button key={label} type="button" onClick={() => onNavigate(to)}>
                  <span className="sp-quick-icon"><Icon size={17} /></span>
                  <span><strong>{label}</strong><small>{hint}</small></span>
                  <ArrowUpRight size={15} className="sp-quick-arrow" aria-hidden="true" />
                </button>
              ))}
            </div>
            <div className="sp-session-strip">
              <span className="sp-kicker">Active sessions</span>
              <strong className="sp-num">{recentBookingsLoading ? '—' : activeSessions.length}</strong>
              <small>{activeSessions[0] ? `${activeSessions[0].parkingLotName} · slot ${activeSessions[0].slotCode ?? '—'}` : 'No vehicle currently parked'}</small>
            </div>
          </Panel>
        )}

        {isManagement && (
          <Panel kicker="Revenue · last 30 days" title={revenueTotal != null ? money(revenueTotal, revenueCurrency) : 'Revenue'} className="span-12 sp-revenue" action={<div className="sp-revenue-meta"><span><TrendingUp size={14} /> {paymentCount ?? '—'} verified payments</span><LinkButton onClick={() => onNavigate('Owner earnings')}>Earnings</LinkButton></div>}>
            {ops.loading ? <Skeleton lines={3} /> : revenuePoints.length > 1 ? <AreaChart points={revenuePoints} format={(v) => money(v, revenueCurrency)} ariaLabel="Daily verified revenue over the last 30 days" />
              : <EmptyState icon={Wallet} title={revenuePoints.length ? 'Not enough data for a trend yet' : 'No verified payments in this period'}>Revenue appears here as payments are verified for your facilities.</EmptyState>}
          </Panel>
        )}

        <Panel kicker="Your activity" title="Recent reservations" className="span-12" action={<LinkButton onClick={() => onNavigate('My bookings')}>All bookings</LinkButton>}>
          <div className="sp-table-tools">
            <label className="sp-field-search"><Search size={15} aria-hidden="true" /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter by code, facility or slot" aria-label="Filter recent bookings" /></label>
          </div>
          {recentBookingsLoading ? <Skeleton lines={4} /> : bookings.length ? (
            <div className="sp-table-scroll">
              <table className="sp-dtable">
                <thead><tr><th scope="col">Booking</th><th scope="col">Facility</th><th scope="col">Start</th><th scope="col">Status</th><th scope="col" className="num">Amount</th></tr></thead>
                <tbody>
                  {bookings.map((b) => (
                    <tr key={b.id} onClick={() => onNavigate('My bookings')}>
                      <td data-label="Booking"><span className="sp-mono">{b.bookingCode}</span><small>Slot {b.slotCode ?? '—'} · {durationLabel(b.startAt, b.endAt)}</small></td>
                      <td data-label="Facility"><span className="sp-cell-icon"><MapPin size={13} /></span>{b.parkingLotName}</td>
                      <td data-label="Start">{dateLabel(b.startAt)}</td>
                      <td data-label="Status"><span className={`sp-chip ${statusTone(b.status)}`}><i />{statusLabel(b.status)}</span></td>
                      <td data-label="Amount" className="num sp-num">{money(b.totalAmount, b.currency, 2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState icon={recentBookingsError ? ShieldAlert : Gauge} title={recentBookingsError ? 'Bookings unavailable' : query ? 'No matches' : 'No reservations yet'}
              action={!recentBookingsError && !query ? <button type="button" className="sp-btn subtle" onClick={() => onNavigate('Find parking')}><Search size={15} /> Find parking</button> : null}>
              {recentBookingsError || (query ? `Nothing matches “${query}”.` : 'Your reservations will appear here once you book a space.')}
            </EmptyState>
          )}
        </Panel>
      </div>
    </motion.div>
  );
}
