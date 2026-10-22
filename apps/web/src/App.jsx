import { Component, useEffect, useState } from 'react';
import {
  Activity, ArrowDownRight, ArrowUpRight, BadgeCheck, Bell, CarFront, CalendarDays, Building2,
  CheckCircle2, ChevronDown, CircleHelp, Clock3, CreditCard, Gauge,
  LayoutDashboard, LogOut, MapPin, MoreHorizontal, Plus, Search, Settings,
  ShieldCheck, SlidersHorizontal, Sparkles, Users, Wallet, Wifi, Zap, SquareParking, QrCode, Store, Heart, BadgePercent,   ScanEye, Sun, Moon, DoorOpen
} from 'lucide-react';
import AuthPage from './components/AuthPage.jsx';
import ParkingPage from './components/ParkingPage.jsx';
import BookingsPage from './components/BookingsPage.jsx';
import TransactionsPage from './components/TransactionsPage.jsx';
import GatePage from './components/GatePage.jsx';
import MarketplacePage from './components/MarketplacePage.jsx';
import VehiclesPage from './components/VehiclesPage.jsx';
import EarningsPage from './components/EarningsPage.jsx';
import VisionPage from './components/VisionPage.jsx';
import OperationsPage from './components/OperationsPage.jsx';
import NotificationsPage from './components/NotificationsPage.jsx';
import FinancialOperationsPage from './components/FinancialOperationsPage.jsx';
import EngagementPage from './components/EngagementPage.jsx';
import AdminUsersPage from './components/AdminUsersPage.jsx';
import AdminDashboard from './components/AdminDashboard.jsx';
import OwnerVerificationPage from './components/OwnerVerificationPage.jsx';
import AdminPromotionsPage from './components/AdminPromotionsPage.jsx';
import SubscriptionsPage from './components/SubscriptionsPage.jsx';
import CorporateEvPage from './components/CorporateEvPage.jsx';
import { ProfilePage, SettingsPage, HelpSupportPage } from './components/AccountPages.jsx';
import PlateRecognitionPage from './components/PlateRecognitionPage.jsx';
import GateHardwarePage from './components/GateHardwarePage.jsx';
import { translate } from './i18n.js';


function StatCard({ icon: Icon, label, value, note, trend, tint = 'mint' }) {
  return (
    <article className="stat-card">
      <div className="stat-top">
        <span className={`stat-icon ${tint}`}><Icon size={18} /></span>
        {trend && <span className={`trend ${trend.startsWith('-') ? 'negative' : ''}`}>
          {trend.startsWith('-') ? <ArrowDownRight size={14} /> : <ArrowUpRight size={14} />}{trend}
        </span>}
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

class WorkspaceErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('Workspace page failed to render:', error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return <section className="sp-page"><div className="sp-alert error" role="alert"><strong>This page could not be loaded.</strong><span>{this.state.error.message || 'Please try again.'}</span><button className="sp-button secondary" onClick={() => window.location.reload()}>Reload page</button></div></section>;
  }
}

export default function App() {
  const [activeNav, setActiveNav] = useState('Overview');
  const [apiStatus, setApiStatus] = useState({ checking: true, state: 'checking', database: 'checking' });
  const [search, setSearch] = useState('');
  const [currentUser, setCurrentUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [loggingOut, setLoggingOut] = useState(false);
  const [parkingOverview, setParkingOverview] = useState(null);
  const [overviewError, setOverviewError] = useState('');
  const [recentBookings, setRecentBookings] = useState([]);
  const [recentBookingsLoading, setRecentBookingsLoading] = useState(false);
  const [recentBookingsError, setRecentBookingsError] = useState('');
  const [initialParkingSearch, setInitialParkingSearch] = useState(null);
  const [initialEngagementTab, setInitialEngagementTab] = useState('favorites');
  const [language, setLanguage] = useState(() => { try { return JSON.parse(localStorage.getItem('smartpark.preferences') || '{}').language || 'en'; } catch { return 'en'; } });
  const [theme, setTheme] = useState(() => { try { return JSON.parse(localStorage.getItem('smartpark.preferences') || '{}').theme === 'dark' ? 'dark' : 'light'; } catch { return 'light'; } });
  const [workspaceMode, setWorkspaceMode] = useState('driver');

  useEffect(() => {
    if (!currentUser?.id) { setWorkspaceMode('driver'); return; }
    try {
      setWorkspaceMode(localStorage.getItem(`smartpark.workspaceMode.${currentUser.id}`) === 'facility_owner' ? 'facility_owner' : 'driver');
    } catch { setWorkspaceMode('driver'); }
  }, [currentUser?.id, (currentUser?.roles ?? []).join('|')]);

  useEffect(() => { document.documentElement.lang = language; }, [language]);
  useEffect(() => { document.documentElement.classList.toggle('sp-dark-theme', theme === 'dark'); }, [theme]);
  useEffect(() => {
    try {
      const prefs = JSON.parse(localStorage.getItem('smartpark.preferences') || '{}');
      document.documentElement.classList.toggle('sp-high-contrast', Boolean(prefs.highContrast));
      document.documentElement.classList.toggle('sp-large-text', Boolean(prefs.largeText));
      document.documentElement.classList.toggle('sp-reduce-motion', Boolean(prefs.reduceMotion));
      document.documentElement.classList.toggle('sp-compact-tables', Boolean(prefs.compactTables));
      document.documentElement.classList.toggle('sp-dark-theme', prefs.theme === 'dark');
    } catch { /* Ignore malformed local preferences and keep accessible defaults. */ }
  }, []);

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


  useEffect(() => {
    let cancelled = false;
    async function loadParkingOverview() {
      try {
        const response = await fetch('/api/parking/overview');
        const data = await response.json();
        if (!response.ok) throw new Error(data?.error?.message ?? 'Unable to load parking overview.');
        if (!cancelled) { setParkingOverview(data); setOverviewError(''); }
      } catch (error) {
        if (!cancelled) setOverviewError(error.message || 'Parking overview is unavailable.');
      }
    }
    loadParkingOverview();
    const id = window.setInterval(loadParkingOverview, 30000);
    return () => { cancelled = true; window.clearInterval(id); };
  }, []);

  useEffect(() => {
    if (!currentUser) { setRecentBookings([]); return undefined; }
    let cancelled = false;
    setRecentBookingsLoading(true);
    fetch('/api/bookings/mine?limit=5', { credentials: 'same-origin' })
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data?.error?.message ?? 'Unable to load recent bookings.');
        return data;
      })
      .then((data) => { if (!cancelled) { setRecentBookings(data.bookings ?? []); setRecentBookingsError(''); } })
      .catch((error) => { if (!cancelled) { setRecentBookings([]); setRecentBookingsError(error.message || 'Unable to load recent bookings.'); } })
      .finally(() => { if (!cancelled) setRecentBookingsLoading(false); });
    return () => { cancelled = true; };
  }, [currentUser?.id]);

  const roles = currentUser?.roles ?? [];
  const isAdmin = roles.includes('admin');
  const hasFacilityOwnerRole = roles.includes('host');
  // Workspace switching is a presentation preference, not an authorization boundary.
  // Server-side route guards continue to enforce the user's actual roles.
  const ownerWorkspaceActive = isAdmin || (hasFacilityOwnerRole && workspaceMode === 'facility_owner');
  const canHost = isAdmin || (hasFacilityOwnerRole && ownerWorkspaceActive);
  const canManageParkingInventory = canHost || roles.some((role) => ['operator', 'attendant'].includes(role));
  const canOperate = isAdmin || roles.includes('operator') || (hasFacilityOwnerRole && ownerWorkspaceActive);
  const navGroups = [
    { title: 'WORKSPACE', items: [{ label: 'Overview', icon: LayoutDashboard }, { label: 'Find parking', icon: MapPin }, { label: 'My bookings', icon: CalendarDays }, { label: 'Vehicles', icon: CarFront }, { label: 'Saved & reviews', icon: Heart }, { label: 'Monthly passes', icon: CalendarDays }, { label: 'Corporate & EV', icon: Zap }] },
    { title: 'MANAGE', items: [...(canManageParkingInventory ? [{ label: 'Parking spaces', icon: Gauge }] : []), ...(canHost ? [{ label: 'My listings', icon: Store }, ...(!isAdmin ? [{ label: 'Owner verification', icon: ShieldCheck }] : []), { label: 'Owner earnings', icon: Wallet }] : []), ...((canHost || roles.some((role) => ['operator', 'admin'].includes(role))) ? [{ label: 'Camera detection', icon: Activity }, { label: 'Plate recognition', icon: ScanEye }] : []), ...(canOperate ? [{ label: 'Operations', icon: Activity }] : []), ...(isAdmin ? [{ label: 'Finance review', icon: ShieldCheck }] : []), { label: 'Transactions', icon: CreditCard }, ...(roles.some((role) => ['attendant', 'operator', 'admin'].includes(role)) ? [{ label: 'Gate access', icon: QrCode }] : []), ...(canManageParkingInventory && roles.some((role) => ['host','operator','admin'].includes(role)) ? [{ label: 'Gate hardware', icon: DoorOpen }] : [])] },
    ...(isAdmin ? [{ title: 'ADMINISTRATION', items: [{ label: 'Admin console', icon: ShieldCheck }, { label: 'User management', icon: Users }, { label: 'Owner verification', icon: BadgeCheck }, { label: 'Promotions', icon: BadgePercent }] }] : []),
    { title: 'PREFERENCES', items: [{ label: 'Notifications', icon: Bell }, { label: 'Settings', icon: Settings }, { label: 'Help & support', icon: CircleHelp }] }
  ];

  const displayName = currentUser?.fullName || currentUser?.email || 'SmartPark user';
  const userInitials = displayName.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0].toUpperCase()).join('') || 'SP';
  const userRoleLabel = isAdmin ? 'Administrator'
    : roles.includes('operator') ? 'Facility operator'
    : roles.includes('attendant') ? 'Parking attendant'
    : hasFacilityOwnerRole && ownerWorkspaceActive ? 'Facility owner workspace'
    : hasFacilityOwnerRole ? 'Driver workspace · owner enabled' : 'Driver workspace';

  function handleThemeChange(nextTheme) {
    const normalized = nextTheme === 'dark' ? 'dark' : 'light';
    setTheme(normalized);
    try {
      const preferences = JSON.parse(localStorage.getItem('smartpark.preferences') || '{}');
      localStorage.setItem('smartpark.preferences', JSON.stringify({ ...preferences, theme: normalized }));
      window.dispatchEvent(new CustomEvent('smartpark:preferences-changed'));
    } catch { /* The theme still changes for the current app session if storage is unavailable. */ }
  }

  function handleWorkspaceChange(nextMode) {
    const normalized = nextMode === 'facility_owner' ? 'facility_owner' : 'driver';
    setWorkspaceMode(normalized);
    try {
      if (currentUser?.id) localStorage.setItem(`smartpark.workspaceMode.${currentUser.id}`, normalized);
    } catch { /* Workspace switching still works for the current session if storage is unavailable. */ }
  }

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

  function useRecentSearch(search) {
    setInitialParkingSearch({ q: search.q ?? '', city: search.city ?? '', nonce: Date.now() });
    setActiveNav('Find parking');
  }

  const filteredBookings = recentBookings.filter((booking) => `${booking.bookingCode} ${booking.parkingLotName ?? ''} ${booking.slotCode ?? ''}`.toLowerCase().includes(search.toLowerCase()));
  const bookingStatusLabel = (status) => ({ held: 'Awaiting payment', pending_payment: 'Pending payment', confirmed: 'Confirmed', checked_in: 'Checked in', completed: 'Completed', cancelled: 'Cancelled', expired: 'Expired', payment_failed: 'Payment failed' }[status] ?? status);
  const bookingDateLabel = (value) => { const date = new Date(value); return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }); };
  const bookingDurationLabel = (startValue, endValue) => { const minutes = Math.max(0, Math.round((new Date(endValue).getTime() - new Date(startValue).getTime()) / 60000)); const hours = Math.floor(minutes / 60); const remainder = minutes % 60; return [hours ? `${hours}h` : '', remainder ? `${remainder}m` : ''].filter(Boolean).join(' ') || '—'; };
  const bookingMoney = (amount, currency = 'INR') => new Intl.NumberFormat('en-IN', { style: 'currency', currency, maximumFractionDigits: 2 }).format(Number(amount ?? 0));

  if (authLoading) {
    return <div className="auth-loading-screen"><div className="auth-loading-mark"><CarFront size={22} /></div><p>Loading your SmartPark workspace…</p></div>;
  }
  if (!currentUser) return <AuthPage onAuthenticated={setCurrentUser} />;

  return (
    <div className="app-shell"><a className="sp-skip-link" href="#main-content">Skip to main content</a>
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark"><CarFront size={22} strokeWidth={2.5} /></div>
          <div><span className="brand-name">smartpark</span><span className="brand-caption">PARKING, SIMPLIFIED</span></div>
        </div>
        <button className="workspace-switcher" type="button" onClick={() => setActiveNav('My profile')} title="Manage your driver and facility owner workspaces in My profile"><span className="workspace-avatar">SP</span><span className="workspace-copy"><strong>{displayName}</strong><small>{userRoleLabel}</small></span><ChevronDown size={15} /></button>
        <nav className="side-nav" aria-label="Main navigation">
          {navGroups.map((group) => <div className="nav-group" key={group.title}>
            <p className="nav-group-title">{translate(language, group.title)}</p>
            {group.items.map(({ label, icon: Icon }) => <button key={label} onClick={() => { if (label === 'Saved & reviews') setInitialEngagementTab('favorites'); setActiveNav(label); }} className={`nav-link ${activeNav === label ? 'active' : ''}`}><Icon size={17} /><span>{translate(language, label)}</span></button>)}
          </div>)}
        </nav>
        <div className="sidebar-bottom">
          <div className="help-card"><div className="help-spark"><Sparkles size={17} /></div><strong>{translate(language, 'Need a hand?')}</strong><p>Find answers and get help with your parking.</p><button onClick={() => setActiveNav('Help & support')}>{translate(language, 'Visit help center')} <span>↗</span></button></div>
          <button className="profile-mini" type="button" title="Open my profile" onClick={() => setActiveNav('My profile')}><div className="profile-avatar">{userInitials}</div><span className="profile-text"><strong>{displayName}</strong><small>{userRoleLabel}</small></span><MoreHorizontal size={18} /></button>
        </div>
      </aside>

      <main className="main-area" id="main-content" tabIndex="-1">
        <header className="topbar">
          <div className="breadcrumb"><span>Workspace</span><span className="crumb-slash">/</span><strong>{translate(language, activeNav)}</strong></div>
          <div className="top-actions"><div className={`connection-status ${apiStatus.state === 'ok' ? 'connected' : ''}`} title={`API: ${apiStatus.state}; database: ${apiStatus.database}`}><span className="connection-dot" />{apiStatus.checking ? 'Checking system' : apiStatus.state === 'ok' ? 'System connected' : apiStatus.state === 'degraded' ? 'Database offline' : 'API offline'}</div><button className="icon-button sp-theme-toggle" type="button" title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`} aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`} onClick={() => handleThemeChange(theme === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? <Sun size={18}/> : <Moon size={18}/>}</button><button className="icon-button" aria-label="Notifications" onClick={() => setActiveNav('Notifications')}><Bell size={18} /><i /></button><button className="top-avatar sp-top-avatar-button" type="button" title="Open my profile" aria-label="Open my profile" onClick={() => setActiveNav('My profile')}>{userInitials}</button><button className="logout-button" onClick={handleLogout} disabled={loggingOut} title="Sign out"><LogOut size={15} /><span>{loggingOut ? 'Signing out…' : translate(language, 'Sign out')}</span></button></div>
        </header>

        <WorkspaceErrorBoundary>
        <div className="page-content">
          {activeNav === 'Admin console' && currentUser?.roles?.includes('admin') ? <AdminDashboard overview={parkingOverview} onNavigate={setActiveNav} />
            : activeNav === 'User management' && currentUser?.roles?.includes('admin') ? <AdminUsersPage currentUser={currentUser} />
            : activeNav === 'Owner verification' && canHost ? <OwnerVerificationPage currentUser={currentUser} />
            : activeNav === 'Promotions' && currentUser?.roles?.includes('admin') ? <AdminPromotionsPage />
            : activeNav === 'My profile' ? <ProfilePage currentUser={currentUser} workspaceMode={workspaceMode} onWorkspaceChange={handleWorkspaceChange} onNavigate={setActiveNav} onProfileUpdated={(user) => setCurrentUser((current) => ({ ...current, ...user }))} />
            : activeNav === 'Settings' ? <SettingsPage language={language} onLanguageChange={setLanguage} theme={theme} onThemeChange={handleThemeChange} currentUser={currentUser} onNavigate={setActiveNav} />
            : activeNav === 'Help & support' ? <HelpSupportPage currentUser={currentUser} />
            : activeNav === 'Monthly passes' ? <SubscriptionsPage currentUser={currentUser} />
            : activeNav === 'Corporate & EV' ? <CorporateEvPage currentUser={currentUser} workspaceMode={workspaceMode} />
            : activeNav === 'Find parking' ? <ParkingPage mode="discover" currentUser={currentUser} onViewBookings={() => setActiveNav('My bookings')} onViewEngagement={() => { setInitialEngagementTab('reviews'); setActiveNav('Saved & reviews'); }} initialSearch={initialParkingSearch} />
            : activeNav === 'Parking spaces' && canManageParkingInventory ? <ParkingPage mode="manage" currentUser={currentUser} />
            : activeNav === 'My bookings' ? <BookingsPage currentUser={currentUser} />
            : activeNav === 'Vehicles' ? <VehiclesPage currentUser={currentUser} />
            : activeNav === 'Saved & reviews' ? <EngagementPage currentUser={currentUser} initialTab={initialEngagementTab} onUseSearch={useRecentSearch} onBrowseParking={() => setActiveNav('Find parking')} />
            : activeNav === 'My listings' && canHost ? <MarketplacePage currentUser={currentUser} />
            : activeNav === 'Owner earnings' && canHost ? <EarningsPage currentUser={currentUser} />
            : activeNav === 'Transactions' ? <TransactionsPage currentUser={currentUser} />
            : activeNav === 'Gate access' ? <GatePage currentUser={currentUser} />
            : activeNav === 'Gate hardware' ? <GateHardwarePage currentUser={currentUser} />
            : activeNav === 'Camera detection' && (canHost || roles.some((role) => ['operator', 'admin'].includes(role))) ? <VisionPage currentUser={currentUser} />
            : activeNav === 'Plate recognition' && (canHost || roles.some((role) => ['operator', 'admin'].includes(role))) ? <PlateRecognitionPage />
            : activeNav === 'Operations' && canOperate ? <OperationsPage currentUser={currentUser} />
            : activeNav === 'Finance review' && currentUser?.roles?.includes('admin') ? <FinancialOperationsPage currentUser={currentUser} />
            : activeNav === 'Notifications' ? <NotificationsPage /> : <>
          <section className="welcome-row">
            <div><div className="eyebrow"><span className="eyebrow-line" /> {translate(language, 'YOUR PARKING OVERVIEW')}</div><h1>{translate(language, 'Welcome back')}, {displayName.split(/\s+/)[0]} <span className="wave">✳</span></h1><p className="welcome-subtitle">Everything you need for a smoother parking experience.</p></div>
            <button className="primary-button" onClick={() => setActiveNav('Find parking')}><Plus size={17} /> {translate(language, 'Find a parking spot')}</button>
          </section>

          <section className="stat-grid" aria-label="Live parking inventory overview">
            <StatCard icon={Building2} label={translate(language, 'Active locations')} value={parkingOverview ? parkingOverview.overview.activeLots : '—'} note={translate(language, 'Published facilities')} tint="mint" />
            <StatCard icon={Gauge} label={translate(language, 'Total spaces')} value={parkingOverview ? parkingOverview.overview.totalSpaces : '—'} note={translate(language, 'Across active locations')} tint="blue" />
            <StatCard icon={CheckCircle2} label="Available now" value={parkingOverview ? parkingOverview.overview.availableNow : '—'} note="Known empty and unreserved" tint="violet" />
            <StatCard icon={CarFront} label="Occupied now" value={parkingOverview ? parkingOverview.overview.occupiedNow : '—'} note="Latest recorded physical state" tint="amber" />
          </section>

          <section className="content-grid">
            <article className="panel occupancy-panel">
              <div className="panel-heading"><div><p className="section-kicker">PARKING AVAILABILITY</p><h2>Spaces at a glance</h2><p className="muted-copy">{overviewError || 'Live summary of published facilities · refreshes every 30 seconds'}</p></div><button className="quiet-button" onClick={() => setActiveNav('Find parking')}>Explore locations <span>↗</span></button></div>
              <div className="availability-summary"><div><span className="availability-number">{parkingOverview ? parkingOverview.overview.availableNow : '—'}</span><span className="availability-label">spaces available</span></div><div className="occupancy-total"><span className="mini-live-dot" /> {parkingOverview ? parkingOverview.overview.totalSpaces : '—'} total spaces</div></div>
              <div className="progress-track"><span style={{ width: `${parkingOverview?.overview.totalSpaces ? Math.min(100, (parkingOverview.overview.availableNow / parkingOverview.overview.totalSpaces) * 100) : 0}%` }} /></div>
              <div className="progress-caption"><span><i className="legend-dot green" /> Available <strong>{parkingOverview?.overview.availableNow ?? '—'}</strong></span><span><i className="legend-dot red" /> Occupied <strong>{parkingOverview?.overview.occupiedNow ?? '—'}</strong></span><span><i className="legend-dot yellow" /> Unknown <strong>{parkingOverview?.overview.unknownSpaces ?? '—'}</strong></span></div>
              <div className="slot-map-heading"><strong>Published facilities</strong><span>{parkingOverview?.overview.activeLots ?? '—'} active locations</span></div>
              {parkingOverview?.featuredLots?.length ? <div className="sp-featured-lots">{parkingOverview.featuredLots.slice(0, 4).map((lot) => <button className="sp-featured-lot" key={lot.id} onClick={() => setActiveNav('Find parking')}><span className="sp-featured-lot-icon"><MapPin size={15} /></span><span className="sp-featured-lot-copy"><strong>{lot.name}</strong><small>{lot.city} · {lot.availableNow} available of {lot.totalSpaces}</small></span><span className="sp-featured-lot-rate">{lot.hourlyRate == null ? 'Rate unset' : new Intl.NumberFormat('en-IN', { style: 'currency', currency: lot.currency || 'INR', maximumFractionDigits: 0 }).format(lot.hourlyRate)}<small>/hr</small></span></button>)}</div> : <div className="sp-overview-empty"><SquareParking size={22} /><span>No published facilities yet. Add a facility and publish it to see live inventory here.</span><button onClick={() => setActiveNav('Parking spaces')}>Manage facilities</button></div>}
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
            <div className="panel-heading bookings-heading"><div><p className="section-kicker">YOUR ACTIVITY</p><h2>Recent bookings</h2><p className="muted-copy">Your latest reservations from SmartPark. Reservation holds are not paid bookings.</p></div><button className="quiet-button" onClick={() => setActiveNav('My bookings')}>View all bookings <span>↗</span></button></div>
            <div className="table-toolbar"><div className="search-box"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search bookings..." aria-label="Search bookings" /></div><button className="filter-button" onClick={() => setSearch('')}><SlidersHorizontal size={15} /> Clear search</button></div>
            <div className="table-wrap"><table><thead><tr><th>BOOKING</th><th>PARKING LOCATION</th><th>DATE & TIME</th><th>STATUS</th><th>AMOUNT</th><th aria-label="Actions" /></tr></thead><tbody>{filteredBookings.map((booking) => <tr key={booking.id}><td><span className="booking-code">{booking.bookingCode}</span><small className="table-subline">Slot {booking.slotCode ?? '—'} · {bookingDurationLabel(booking.startAt, booking.endAt)}</small></td><td><span className="location-cell"><span className="location-icon"><MapPin size={15} /></span>{booking.parkingLotName}</span></td><td><span>{bookingDateLabel(booking.startAt)}</span><small className="table-subline">Local time</small></td><td><StatusPill state={bookingStatusLabel(booking.status)} /></td><td className="amount-cell">{bookingMoney(booking.totalAmount, booking.currency)}</td><td><button className="row-more" aria-label={`Open ${booking.bookingCode}`} onClick={() => setActiveNav('My bookings')}><MoreHorizontal size={18} /></button></td></tr>)}</tbody></table>{filteredBookings.length === 0 && <div className="empty-state">{recentBookingsLoading ? 'Loading your bookings…' : recentBookingsError || (search ? `No bookings match “${search}”. Try another search.` : 'No bookings yet. Find a parking space to create your first reservation.')}</div>}</div>
            <div className="table-footer"><span>Showing {filteredBookings.length} recent bookings</span><span className="sample-label"><Activity size={13} /> Account data</span></div>
          </section>

          </>}
          <footer className="page-footer"><span>© 2026 SmartPark · Original project build</span><span><span className="footer-status" /> Designed for a reliable parking experience</span></footer>
        </div>
        </WorkspaceErrorBoundary>
      </main>
    </div>
  );
}
