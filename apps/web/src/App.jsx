import { useEffect, useState } from 'react';
import {
  Activity, ArrowDownRight, ArrowUpRight, Bell, CarFront, CalendarDays,
  CheckCircle2, ChevronDown, CircleHelp, Clock3, CreditCard, Gauge,
  LayoutDashboard, LogOut, MapPin, MoreHorizontal, Plus, Search, Settings,
  ShieldCheck, SlidersHorizontal, Sparkles, Users, Wallet, Wifi, Zap
} from 'lucide-react';
import AuthPage from './components/AuthPage.jsx';

const demoBookings = [
  { code: 'SP-20481', place: 'Central Square Parking', slot: 'B-12', time: 'Today, 10:30 AM', duration: '2 hours', state: 'Confirmed', amount: '₹120' },
  { code: 'SP-20463', place: 'Orchid Business Park', slot: 'C-08', time: 'Today, 1:00 PM', duration: '3 hours', state: 'Awaiting entry', amount: '₹180' },
  { code: 'SP-20398', place: 'Metro Point Garage', slot: 'A-04', time: 'Yesterday, 6:15 PM', duration: '1 hour', state: 'Completed', amount: '₹60' }
];

const demoSpaces = [
  { code: 'A1', state: 'occupied' }, { code: 'A2', state: 'available' }, { code: 'A3', state: 'available' }, { code: 'A4', state: 'reserved' }, { code: 'A5', state: 'occupied' },
  { code: 'B1', state: 'available' }, { code: 'B2', state: 'occupied' }, { code: 'B3', state: 'available' }, { code: 'B4', state: 'available' }, { code: 'B5', state: 'available' },
  { code: 'C1', state: 'reserved' }, { code: 'C2', state: 'available' }, { code: 'C3', state: 'occupied' }, { code: 'C4', state: 'available' }, { code: 'C5', state: 'available' }
];

function StatCard({ icon: Icon, label, value, note, trend, tint = 'mint' }) {
  return (
    <article className="stat-card">
      <div className="stat-top">
        <span className={`stat-icon ${tint}`}><Icon size={18} /></span>
        <span className={`trend ${trend?.startsWith('-') ? 'negative' : ''}`}>
          {trend?.startsWith('-') ? <ArrowDownRight size={14} /> : <ArrowUpRight size={14} />}{trend}
        </span>
      </div>
      <p className="stat-label">{label}</p>
      <div className="stat-value">{value}</div>
      <p className="stat-note">{note}</p>
    </article>
  );
}

function StatusPill({ state }) {
  const cls = state.toLowerCase().replaceAll(' ', '-');
  return <span className={`status-pill ${cls}`}><span className="status-dot" />{state}</span>;
}

export default function App() {
  const [activeNav, setActiveNav] = useState('Overview');
  const [apiStatus, setApiStatus] = useState({ checking: true, state: 'checking', database: 'checking' });
  const [search, setSearch] = useState('');
  const [currentUser, setCurrentUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // A verification link must be processed by AuthPage even if the browser has an old session.
    if (new URLSearchParams(window.location.search).has('verify') || new URLSearchParams(window.location.search).has('reset')) {
      setAuthLoading(false);
      return () => { cancelled = true; };
    }
    fetch('/api/auth/me', { credentials: 'same-origin' })
      .then(async (response) => {
        if (response.status === 401) return null;
        const data = await response.json();
        if (!response.ok) throw new Error(data?.error?.message ?? 'Unable to check your session.');
        return data.user;
      })
      .then((user) => { if (!cancelled) setCurrentUser(user); })
      .catch(() => { if (!cancelled) setCurrentUser(null); })
      .finally(() => { if (!cancelled) setAuthLoading(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function checkApi() {
      try {
        const response = await fetch('/api/health');
        const data = await response.json();
        if (!cancelled) setApiStatus({ checking: false, state: data.status, database: data.database });
      } catch {
        if (!cancelled) setApiStatus({ checking: false, state: 'offline', database: 'unknown' });
      }
    }
    checkApi();
    const id = window.setInterval(checkApi, 15000);
    return () => { cancelled = true; window.clearInterval(id); };
  }, []);

  const navGroups = [
    { title: 'WORKSPACE', items: [{ label: 'Overview', icon: LayoutDashboard }, { label: 'Find parking', icon: MapPin }, { label: 'My bookings', icon: CalendarDays }, { label: 'Vehicles', icon: CarFront }] },
    { title: 'MANAGE', items: [{ label: 'Parking spaces', icon: Gauge }, { label: 'Transactions', icon: CreditCard }, { label: 'Owner earnings', icon: Wallet }] },
    { title: 'PREFERENCES', items: [{ label: 'Settings', icon: Settings }, { label: 'Help & support', icon: CircleHelp }] }
  ];

  const displayName = currentUser?.fullName || currentUser?.email || 'SmartPark user';
  const userInitials = displayName.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0].toUpperCase()).join('') || 'SP';
  const userRoleLabel = currentUser?.roles?.includes('admin') ? 'Administrator'
    : currentUser?.roles?.includes('operator') ? 'Facility operator'
    : currentUser?.roles?.includes('attendant') ? 'Parking attendant'
    : currentUser?.roles?.includes('host') ? 'Parking host' : 'Driver account';

  async function handleLogout() {
    setLoggingOut(true);
    try {
      const response = await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
      if (!response.ok) throw new Error('Sign out failed. Please try again.');
      setCurrentUser(null);
      setActiveNav('Overview');
    } catch (error) {
      window.alert(error.message || 'Sign out failed. Please try again.');
    } finally {
      setLoggingOut(false);
    }
  }

  const filteredBookings = demoBookings.filter((booking) => `${booking.code} ${booking.place} ${booking.slot}`.toLowerCase().includes(search.toLowerCase()));

  if (authLoading) {
    return <div className="auth-loading-screen"><div className="auth-loading-mark"><CarFront size={22} /></div><p>Loading your SmartPark workspace…</p></div>;
  }
  if (!currentUser) return <AuthPage onAuthenticated={setCurrentUser} />;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark"><CarFront size={22} strokeWidth={2.5} /></div>
          <div><span className="brand-name">smartpark</span><span className="brand-caption">PARKING, SIMPLIFIED</span></div>
        </div>
        <button className="workspace-switcher"><span className="workspace-avatar">SP</span><span className="workspace-copy"><strong>{displayName}</strong><small>{userRoleLabel}</small></span><ChevronDown size={15} /></button>
        <nav className="side-nav" aria-label="Main navigation">
          {navGroups.map((group) => <div className="nav-group" key={group.title}>
            <p className="nav-group-title">{group.title}</p>
            {group.items.map(({ label, icon: Icon }) => <button key={label} onClick={() => setActiveNav(label)} className={`nav-link ${activeNav === label ? 'active' : ''}`}><Icon size={17} /><span>{label}</span>{label === 'My bookings' && <span className="nav-count">3</span>}</button>)}
          </div>)}
        </nav>
        <div className="sidebar-bottom">
          <div className="help-card"><div className="help-spark"><Sparkles size={17} /></div><strong>Need a hand?</strong><p>Find answers and get help with your parking.</p><button onClick={() => setActiveNav('Help & support')}>Visit help center <span>↗</span></button></div>
          <button className="profile-mini" type="button" title="Signed-in account"><div className="profile-avatar">{userInitials}</div><span className="profile-text"><strong>{displayName}</strong><small>{userRoleLabel}</small></span><MoreHorizontal size={18} /></button>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="breadcrumb"><span>Workspace</span><span className="crumb-slash">/</span><strong>{activeNav}</strong></div>
          <div className="top-actions"><div className={`connection-status ${apiStatus.state === 'ok' ? 'connected' : ''}`} title={`API: ${apiStatus.state}; database: ${apiStatus.database}`}><span className="connection-dot" />{apiStatus.checking ? 'Checking system' : apiStatus.state === 'ok' ? 'System connected' : apiStatus.state === 'degraded' ? 'Database offline' : 'API offline'}</div><button className="icon-button" aria-label="Notifications"><Bell size={18} /><i /></button><div className="top-avatar" title={displayName}>{userInitials}</div><button className="logout-button" onClick={handleLogout} disabled={loggingOut} title="Sign out"><LogOut size={15} /><span>{loggingOut ? 'Signing out…' : 'Sign out'}</span></button></div>
        </header>

        <div className="page-content">
          <section className="welcome-row">
            <div><div className="eyebrow"><span className="eyebrow-line" /> YOUR PARKING OVERVIEW</div><h1>Welcome back, {displayName.split(/\s+/)[0]} <span className="wave">✳</span></h1><p className="welcome-subtitle">Everything you need for a smoother parking experience.</p></div>
            <button className="primary-button" onClick={() => setActiveNav('Find parking')}><Plus size={17} /> Find a parking spot</button>
          </section>

          <section className="stat-grid" aria-label="Dashboard preview statistics">
            <StatCard icon={CalendarDays} label="Total bookings" value="24" note="Across all time" trend="12.8%" tint="mint" />
            <StatCard icon={Clock3} label="Hours parked" value="48.5" note="This month" trend="8.2%" tint="blue" />
            <StatCard icon={Wallet} label="Total spent" value="₹3,240" note="Across all bookings" trend="5.4%" tint="violet" />
            <StatCard icon={MapPin} label="Saved locations" value="6" note="Your favourite spots" trend="2 new" tint="amber" />
          </section>

          <section className="content-grid">
            <article className="panel occupancy-panel">
              <div className="panel-heading"><div><p className="section-kicker">PARKING AVAILABILITY</p><h2>Spaces at a glance</h2><p className="muted-copy">Illustrative dashboard preview · not live facility data</p></div><button className="quiet-button" onClick={() => setActiveNav('Find parking')}>Explore locations <span>↗</span></button></div>
              <div className="availability-summary"><div><span className="availability-number">45</span><span className="availability-label">spaces available</span></div><div className="occupancy-total"><span className="mini-live-dot" /> 120 total spaces</div></div>
              <div className="progress-track"><span style={{ width: '62.5%' }} /></div>
              <div className="progress-caption"><span><i className="legend-dot green" /> Available <strong>45</strong></span><span><i className="legend-dot red" /> Occupied <strong>65</strong></span><span><i className="legend-dot yellow" /> Reserved <strong>10</strong></span></div>
              <div className="slot-map-heading"><strong>Sample slot layout</strong><span>15 sample spaces</span></div>
              <div className="slot-grid" aria-label="Illustrative parking slot grid">{demoSpaces.map((space) => <div key={space.code} className={`slot ${space.state}`} title={`${space.code}: ${space.state}`}><span>{space.code}</span>{space.state === 'available' && <CheckCircle2 size={12} />}{space.state === 'occupied' && <CarFront size={13} />}{space.state === 'reserved' && <Clock3 size={12} />}</div>)}</div>
              <div className="slot-legend"><span><i className="legend-dot green" /> Available</span><span><i className="legend-dot red" /> Occupied</span><span><i className="legend-dot yellow" /> Reserved</span></div>
            </article>

            <article className="panel quick-actions-panel">
              <div className="panel-heading"><div><p className="section-kicker">QUICK ACCESS</p><h2>What would you like to do?</h2></div><span className="subtle-icon"><Zap size={17} /></span></div>
              <div className="quick-action-list">
                <button className="quick-action" onClick={() => setActiveNav('Find parking')}><span className="quick-icon green-bg"><Search size={18} /></span><span className="quick-copy"><strong>Find parking nearby</strong><small>Explore available spaces</small></span><span className="action-arrow">↗</span></button>
                <button className="quick-action" onClick={() => setActiveNav('My bookings')}><span className="quick-icon blue-bg"><CalendarDays size={18} /></span><span className="quick-copy"><strong>Manage bookings</strong><small>View and track reservations</small></span><span className="action-arrow">↗</span></button>
                <button className="quick-action" onClick={() => setActiveNav('Parking spaces')}><span className="quick-icon violet-bg"><MapPin size={18} /></span><span className="quick-copy"><strong>Manage a parking space</strong><small>For owners and hosts</small></span><span className="action-arrow">↗</span></button>
                <button className="quick-action" onClick={() => setActiveNav('Transactions')}><span className="quick-icon amber-bg"><CreditCard size={18} /></span><span className="quick-copy"><strong>View transactions</strong><small>Payments and receipts</small></span><span className="action-arrow">↗</span></button>
              </div>
              <div className="security-note"><ShieldCheck size={16} /><span>Your account and future bookings will be protected with server-side validation.</span></div>
            </article>
          </section>

          <section className="panel bookings-panel">
            <div className="panel-heading bookings-heading"><div><p className="section-kicker">YOUR ACTIVITY</p><h2>Recent bookings</h2><p className="muted-copy">Illustrative entries for the initial UI build</p></div><button className="quiet-button" onClick={() => setActiveNav('My bookings')}>View all bookings <span>↗</span></button></div>
            <div className="table-toolbar"><div className="search-box"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search bookings..." aria-label="Search bookings" /></div><button className="filter-button" onClick={() => setSearch('')}><SlidersHorizontal size={15} /> Clear search</button></div>
            <div className="table-wrap"><table><thead><tr><th>BOOKING</th><th>PARKING LOCATION</th><th>DATE & TIME</th><th>STATUS</th><th>AMOUNT</th><th aria-label="Actions" /></tr></thead><tbody>{filteredBookings.map((booking) => <tr key={booking.code}><td><span className="booking-code">{booking.code}</span><small className="table-subline">Slot {booking.slot} · {booking.duration}</small></td><td><span className="location-cell"><span className="location-icon"><MapPin size={15} /></span>{booking.place}</span></td><td><span>{booking.time}</span><small className="table-subline">Local time</small></td><td><StatusPill state={booking.state} /></td><td className="amount-cell">{booking.amount}</td><td><button className="row-more" aria-label={`More actions for ${booking.code}`}><MoreHorizontal size={18} /></button></td></tr>)}</tbody></table>{filteredBookings.length === 0 && <div className="empty-state">No sample bookings match “{search}”. Try another search.</div>}</div>
            <div className="table-footer"><span>Showing {filteredBookings.length} sample bookings</span><span className="sample-label"><Activity size={13} /> Preview data</span></div>
          </section>

          <footer className="page-footer"><span>© 2026 SmartPark · Original project build</span><span><span className="footer-status" /> Designed for a reliable parking experience</span></footer>
        </div>
      </main>
    </div>
  );
}
