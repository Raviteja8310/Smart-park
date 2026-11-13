import { Component, lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { MotionConfig, motion } from 'motion/react';
import {
  Activity, BadgeCheck, BadgePercent, Bell, CalendarDays, CarFront, CircleHelp, CreditCard, DoorOpen, Gauge, Heart,
  LayoutDashboard, LogOut, MapPin, Moon, QrCode, ScanEye, Settings, ShieldCheck, Store, Sun, UserRound, Users, Wallet, Zap
} from 'lucide-react';
import AuthPage from './components/AuthPage.jsx';
import { ProfilePage, SettingsPage, HelpSupportPage } from './components/AccountPages.jsx';
import Sidebar, { MobileTabBar } from './components/shell/Sidebar.jsx';
import Topbar from './components/shell/Topbar.jsx';
import CommandPalette from './components/shell/CommandPalette.jsx';
import PageBackdrop, { sceneForPage } from './components/shell/PageBackdrop.jsx';
import { ParkingLoader } from './components/animations/ParkingAnimations.jsx';
import OverviewDashboard from './components/dashboard/OverviewDashboard.jsx';
import { BrandHero } from './components/brand/Logo.jsx';
import { Skeleton, easeOutExpo } from './components/ui/primitives.jsx';
import { translate } from './i18n.js';
import { setInterfaceLanguage } from './i18n/runtime.js';

// Feature pages are code-split so the first paint only ships the shell and dashboard.
const ParkingPage = lazy(() => import('./components/ParkingPage.jsx'));
const BookingsPage = lazy(() => import('./components/BookingsPage.jsx'));
const TransactionsPage = lazy(() => import('./components/TransactionsPage.jsx'));
const GatePage = lazy(() => import('./components/GatePage.jsx'));
const MarketplacePage = lazy(() => import('./components/MarketplacePage.jsx'));
const VehiclesPage = lazy(() => import('./components/VehiclesPage.jsx'));
const EarningsPage = lazy(() => import('./components/EarningsPage.jsx'));
const VisionPage = lazy(() => import('./components/VisionPage.jsx'));
const OperationsPage = lazy(() => import('./components/OperationsPage.jsx'));
const NotificationsPage = lazy(() => import('./components/NotificationsPage.jsx'));
const FinancialOperationsPage = lazy(() => import('./components/FinancialOperationsPage.jsx'));
const EngagementPage = lazy(() => import('./components/EngagementPage.jsx'));
const AdminUsersPage = lazy(() => import('./components/AdminUsersPage.jsx'));
const AdminDashboard = lazy(() => import('./components/AdminDashboard.jsx'));
const OwnerVerificationPage = lazy(() => import('./components/OwnerVerificationPage.jsx'));
const AdminPromotionsPage = lazy(() => import('./components/AdminPromotionsPage.jsx'));
const SubscriptionsPage = lazy(() => import('./components/SubscriptionsPage.jsx'));
const CorporateEvPage = lazy(() => import('./components/CorporateEvPage.jsx'));
const PlateRecognitionPage = lazy(() => import('./components/PlateRecognitionPage.jsx'));
const GateHardwarePage = lazy(() => import('./components/GateHardwarePage.jsx'));
// Public landing page for signed-out visitors; its own chunk, so signed-in users never download it.
const LandingPage = lazy(() => import('./components/landing/LandingPage.jsx'));
// '#signin' / '#signup' open the existing sign-in screen directly on its login or registration view
// (bookmarks, Back button, links from the landing page).
const SIGN_IN_HASH = '#signin';
const SIGN_UP_HASH = '#signup';
const wantsSignInScreen = () => [SIGN_IN_HASH, SIGN_UP_HASH].includes(window.location.hash) || ['verify', 'reset'].some((key) => new URLSearchParams(window.location.search).has(key));

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

  componentDidUpdate(prevProps) {
    if (prevProps.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return <section className="sp-page"><div className="sp-alert error" role="alert"><strong>This page could not be loaded.</strong><span>{this.state.error.message || 'Please try again.'}</span><button className="sp-button secondary" onClick={() => window.location.reload()}>Reload page</button></div></section>;
  }
}

function readPrefs() {
  try { return JSON.parse(localStorage.getItem('smartpark.preferences') || '{}'); } catch { return {}; }
}

function PageFallback() {
  return <div className="sp-page-loading"><ParkingLoader size={150} label="Opening page…" /><Skeleton lines={2} /></div>;
}

export default function App() {
  const [activeNav, setActiveNav] = useState('Overview');
  const [apiStatus, setApiStatus] = useState({ checking: true, state: 'checking', database: 'checking' });
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
  const [language, setLanguage] = useState(() => readPrefs().language || 'en');
  const [theme, setTheme] = useState(() => (readPrefs().theme === 'light' ? 'light' : 'dark'));
  const [reduceMotionPref, setReduceMotionPref] = useState(() => Boolean(readPrefs().reduceMotion));
  const [workspaceMode, setWorkspaceMode] = useState('driver');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => { try { return localStorage.getItem('smartpark.sidebarCollapsed') === '1'; } catch { return false; } });
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [showLanding, setShowLanding] = useState(() => !wantsSignInScreen());

  // Landing page routing (additive): Back from the sign-in screen returns to the landing page.
  useEffect(() => {
    const onPopState = () => setShowLanding(!wantsSignInScreen());
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);
  // Once signed in, behave exactly as before: signing out returns to the sign-in screen, not the landing page.
  useEffect(() => {
    if (!currentUser) return;
    setShowLanding(false);
    if ([SIGN_IN_HASH, SIGN_UP_HASH].includes(window.location.hash)) window.history.replaceState(window.history.state, document.title, window.location.pathname + window.location.search);
  }, [currentUser]);
  // Optional profile photo (added after sign-in so the existing session check is unchanged).
  useEffect(() => {
    if (!currentUser?.id) return undefined;
    let cancelled = false;
    fetch('/api/account', { credentials: 'same-origin' })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => { if (!cancelled && data?.user) setCurrentUser((current) => (current ? { ...current, avatar: data.user.avatar ?? null } : current)); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [currentUser?.id]);
  const openLanding = useCallback(() => {
    window.history.pushState(null, '', window.location.pathname);
    setShowLanding(true);
    window.scrollTo(0, 0);
  }, []);
  const openAuth = useCallback((hash) => {
    if (window.location.hash !== hash) window.history.pushState(null, '', hash);
    setShowLanding(false);
    window.scrollTo(0, 0);
  }, []);

  useEffect(() => {
    if (!currentUser?.id) { setWorkspaceMode('driver'); return; }
    try {
      setWorkspaceMode(localStorage.getItem(`smartpark.workspaceMode.${currentUser.id}`) === 'facility_owner' ? 'facility_owner' : 'driver');
    } catch { setWorkspaceMode('driver'); }
  }, [currentUser?.id, (currentUser?.roles ?? []).join('|')]);

  // The runtime translates every rendered string (pages, forms, messages, API errors) into the selected language.
  useEffect(() => { setInterfaceLanguage(language).catch((error) => console.error('Language pack failed to load:', error)); }, [language]);
  useEffect(() => { document.documentElement.classList.toggle('sp-dark-theme', theme === 'dark'); }, [theme]);
  useEffect(() => {
    const apply = () => {
      const prefs = readPrefs();
      document.documentElement.classList.toggle('sp-high-contrast', Boolean(prefs.highContrast));
      document.documentElement.classList.toggle('sp-large-text', Boolean(prefs.largeText));
      document.documentElement.classList.toggle('sp-reduce-motion', Boolean(prefs.reduceMotion));
      document.documentElement.classList.toggle('sp-compact-tables', Boolean(prefs.compactTables));
      setReduceMotionPref(Boolean(prefs.reduceMotion));
    };
    apply();
    window.addEventListener('smartpark:preferences-changed', apply);
    return () => window.removeEventListener('smartpark:preferences-changed', apply);
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

  // Unread notification count for the top bar badge.
  useEffect(() => {
    if (!currentUser) { setUnreadCount(0); return undefined; }
    let cancelled = false;
    const load = () => fetch('/api/notifications/mine?limit=1', { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => { if (!cancelled && data) setUnreadCount(Number(data.unreadCount || 0)); })
      .catch(() => {});
    load();
    const id = window.setInterval(load, 60000);
    return () => { cancelled = true; window.clearInterval(id); };
  }, [currentUser?.id, activeNav === 'Notifications']);

  // Global keyboard: Ctrl/⌘+K opens search.
  useEffect(() => {
    const onKey = (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); setPaletteOpen((open) => !open); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => { window.scrollTo({ top: 0 }); }, [activeNav]);

  const roles = currentUser?.roles ?? [];
  const isAdmin = roles.includes('admin');
  const hasFacilityOwnerRole = roles.includes('host');
  // Workspace switching is a presentation preference, not an authorization boundary.
  // Server-side route guards continue to enforce the user's actual roles.
  const ownerWorkspaceActive = isAdmin || (hasFacilityOwnerRole && workspaceMode === 'facility_owner');
  const canHost = isAdmin || (hasFacilityOwnerRole && ownerWorkspaceActive);
  const canManageParkingInventory = canHost || roles.some((role) => ['operator', 'attendant'].includes(role));
  const canOperate = isAdmin || roles.includes('operator') || (hasFacilityOwnerRole && ownerWorkspaceActive);
  const canSeeVision = canHost || roles.some((role) => ['operator', 'admin'].includes(role));
  const isManagement = isAdmin || roles.includes('operator') || (hasFacilityOwnerRole && ownerWorkspaceActive);

  const navGroups = useMemo(() => [
    { title: 'WORKSPACE', items: [{ label: 'Overview', icon: LayoutDashboard }, { label: 'Find parking', icon: MapPin }, { label: 'My bookings', icon: CalendarDays }, { label: 'Vehicles', icon: CarFront }, { label: 'Saved & reviews', icon: Heart }, { label: 'Monthly passes', icon: CalendarDays }, { label: 'Corporate & EV', icon: Zap }] },
    { title: 'MANAGE', items: [...(canManageParkingInventory ? [{ label: 'Parking spaces', icon: Gauge }] : []), ...(canHost ? [{ label: 'My listings', icon: Store }, ...(!isAdmin ? [{ label: 'Owner verification', icon: ShieldCheck }] : []), { label: 'Owner earnings', icon: Wallet }] : []), ...(canSeeVision ? [{ label: 'Camera detection', icon: Activity }, { label: 'Plate recognition', icon: ScanEye }] : []), ...(canOperate ? [{ label: 'Operations', icon: Activity }] : []), ...(isAdmin ? [{ label: 'Finance review', icon: ShieldCheck }] : []), { label: 'Transactions', icon: CreditCard }, ...(roles.some((role) => ['attendant', 'operator', 'admin'].includes(role)) ? [{ label: 'Gate access', icon: QrCode }] : []), ...(canManageParkingInventory && roles.some((role) => ['host', 'operator', 'admin'].includes(role)) ? [{ label: 'Gate hardware', icon: DoorOpen }] : [])] },
    ...(isAdmin ? [{ title: 'ADMINISTRATION', items: [{ label: 'Admin console', icon: ShieldCheck }, { label: 'User management', icon: Users }, { label: 'Owner verification', icon: BadgeCheck }, { label: 'Promotions', icon: BadgePercent }] }] : []),
    { title: 'PREFERENCES', items: [{ label: 'Notifications', icon: Bell, badge: unreadCount }, { label: 'Settings', icon: Settings }, { label: 'Help & support', icon: CircleHelp }] }
  ], [canManageParkingInventory, canHost, isAdmin, canSeeVision, canOperate, roles.join('|'), unreadCount]);

  const displayName = currentUser?.fullName || currentUser?.email || 'SmartPark user';
  const userInitials = displayName.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0].toUpperCase()).join('') || 'SP';
  const userRoleLabel = isAdmin ? 'Administrator'
    : roles.includes('operator') ? 'Facility operator'
    : roles.includes('attendant') ? 'Parking attendant'
    : hasFacilityOwnerRole && ownerWorkspaceActive ? 'Facility owner'
    : hasFacilityOwnerRole ? 'Driver · owner enabled' : 'Driver';
  const t = useCallback((key) => translate(language, key), [language]);

  const navigate = useCallback((label) => {
    if (label === 'Saved & reviews') setInitialEngagementTab('favorites');
    setActiveNav(label);
  }, []);

  function handleLanguageChange(nextLanguage) {
    setLanguage(nextLanguage);
    try {
      localStorage.setItem('smartpark.preferences', JSON.stringify({ ...readPrefs(), language: nextLanguage }));
    } catch { /* The language still changes for this session if storage is unavailable. */ }
  }

  function handleThemeChange(nextTheme) {
    const normalized = nextTheme === 'dark' ? 'dark' : 'light';
    setTheme(normalized);
    try {
      const preferences = readPrefs();
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

  function toggleSidebar() {
    setSidebarCollapsed((value) => {
      try { localStorage.setItem('smartpark.sidebarCollapsed', value ? '0' : '1'); } catch { /* preference only */ }
      return !value;
    });
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

  const paletteSections = useMemo(() => [
    { title: 'Navigate', items: navGroups.flatMap((g) => g.items.map((item) => ({ label: t(item.label), hint: t(g.title).toLowerCase().replace(/^\w/, (c) => c.toUpperCase()), icon: item.icon, keywords: item.label, run: () => navigate(item.label) }))) },
    { title: 'Actions', items: [
      { label: 'Find a parking spot', hint: 'Search live availability', icon: MapPin, keywords: 'reserve book park', run: () => navigate('Find parking') },
      { label: 'Add a vehicle', hint: 'Register a plate', icon: CarFront, keywords: 'car plate register', run: () => navigate('Vehicles') },
      { label: 'Open my profile', icon: UserRound, keywords: 'account workspace', run: () => navigate('My profile') },
      { label: theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme', icon: theme === 'dark' ? Sun : Moon, keywords: 'theme appearance mode', run: () => handleThemeChange(theme === 'dark' ? 'light' : 'dark') },
      { label: 'Sign out', icon: LogOut, keywords: 'logout exit', run: () => handleLogout() }
    ] },
    ...(recentBookings.length ? [{ title: 'Recent bookings', items: recentBookings.map((b) => ({ label: b.bookingCode, hint: `${b.parkingLotName ?? 'Facility'} · slot ${b.slotCode ?? '—'}`, icon: CalendarDays, keywords: `${b.parkingLotName} ${b.slotCode}`, run: () => navigate('My bookings') })) }] : [])
  ], [navGroups, recentBookings, theme, t, navigate]); // eslint-disable-line react-hooks/exhaustive-deps

  const groupOfActive = navGroups.find((g) => g.items.some((i) => i.label === activeNav));
  const crumbs = [ownerWorkspaceActive ? 'Operations' : 'Workspace', ...(groupOfActive && groupOfActive.title !== 'WORKSPACE' ? [t(groupOfActive.title).toLowerCase().replace(/^\w/, (c) => c.toUpperCase())] : []), t(activeNav)];

  const tabItems = [
    { label: 'Overview', short: 'Home', icon: LayoutDashboard },
    { label: 'Find parking', short: 'Find', icon: MapPin },
    { label: 'My bookings', short: 'Bookings', icon: CalendarDays },
    { label: isManagement && canOperate ? 'Operations' : 'Vehicles', short: isManagement && canOperate ? 'Ops' : 'Vehicles', icon: isManagement && canOperate ? Activity : CarFront }
  ];

  if (authLoading) {
    return <div className="sp-boot"><PageBackdrop scene="login" intensity="hero" reduceMotion={reduceMotionPref} /><motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease: easeOutExpo }}><BrandHero size={120} /></motion.div><ParkingLoader size={170} label="Loading your SmartPark workspace…" /></div>;
  }
  if (!currentUser && showLanding) return <Suspense fallback={<div style={{ minHeight: '100vh', background: '#050505' }} />}><LandingPage onLogin={() => openAuth(SIGN_IN_HASH)} onGetStarted={() => openAuth(SIGN_UP_HASH)} /></Suspense>;
  if (!currentUser) return <MotionConfig reducedMotion={reduceMotionPref ? 'always' : 'user'}><AuthPage onAuthenticated={setCurrentUser} language={language} onLanguageChange={handleLanguageChange} initialMode={window.location.hash === SIGN_UP_HASH ? 'register' : 'login'} onBrandClick={openLanding} /></MotionConfig>;

  const page = activeNav === 'Admin console' && isAdmin ? <AdminDashboard overview={parkingOverview} onNavigate={navigate} />
    : activeNav === 'User management' && isAdmin ? <AdminUsersPage currentUser={currentUser} />
    : activeNav === 'Owner verification' && canHost ? <OwnerVerificationPage currentUser={currentUser} />
    : activeNav === 'Promotions' && isAdmin ? <AdminPromotionsPage />
    : activeNav === 'My profile' ? <ProfilePage currentUser={currentUser} workspaceMode={workspaceMode} onWorkspaceChange={handleWorkspaceChange} onNavigate={navigate} onProfileUpdated={(user) => setCurrentUser((current) => ({ ...current, ...user }))} onAccountDeleted={() => { setCurrentUser(null); window.location.assign('/'); }} />
    : activeNav === 'Settings' ? <SettingsPage language={language} onLanguageChange={setLanguage} theme={theme} onThemeChange={handleThemeChange} currentUser={currentUser} onNavigate={navigate} />
    : activeNav === 'Help & support' ? <HelpSupportPage currentUser={currentUser} />
    : activeNav === 'Monthly passes' ? <SubscriptionsPage currentUser={currentUser} />
    : activeNav === 'Corporate & EV' ? <CorporateEvPage currentUser={currentUser} workspaceMode={workspaceMode} />
    : activeNav === 'Find parking' ? <ParkingPage mode="discover" currentUser={currentUser} onViewBookings={() => navigate('My bookings')} onViewEngagement={() => { setInitialEngagementTab('reviews'); setActiveNav('Saved & reviews'); }} initialSearch={initialParkingSearch} />
    : activeNav === 'Parking spaces' && canManageParkingInventory ? <ParkingPage mode="manage" currentUser={currentUser} />
    : activeNav === 'My bookings' ? <BookingsPage currentUser={currentUser} />
    : activeNav === 'Vehicles' ? <VehiclesPage currentUser={currentUser} />
    : activeNav === 'Saved & reviews' ? <EngagementPage currentUser={currentUser} initialTab={initialEngagementTab} onUseSearch={useRecentSearch} onBrowseParking={() => navigate('Find parking')} />
    : activeNav === 'My listings' && canHost ? <MarketplacePage currentUser={currentUser} />
    : activeNav === 'Owner earnings' && canHost ? <EarningsPage currentUser={currentUser} />
    : activeNav === 'Transactions' ? <TransactionsPage currentUser={currentUser} />
    : activeNav === 'Gate access' ? <GatePage currentUser={currentUser} />
    : activeNav === 'Gate hardware' ? <GateHardwarePage currentUser={currentUser} />
    : activeNav === 'Camera detection' && canSeeVision ? <VisionPage currentUser={currentUser} />
    : activeNav === 'Plate recognition' && canSeeVision ? <PlateRecognitionPage />
    : activeNav === 'Operations' && canOperate ? <OperationsPage currentUser={currentUser} />
    : activeNav === 'Finance review' && isAdmin ? <FinancialOperationsPage currentUser={currentUser} />
    : activeNav === 'Notifications' ? <NotificationsPage />
    : <OverviewDashboard parkingOverview={parkingOverview} overviewError={overviewError} displayName={displayName} isManagement={isManagement} recentBookings={recentBookings} recentBookingsLoading={recentBookingsLoading} recentBookingsError={recentBookingsError} onNavigate={navigate} translate={t} />;

  return (
    <MotionConfig reducedMotion={reduceMotionPref ? 'always' : 'user'}>
      <div className={`sp-shell ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
        <PageBackdrop scene={sceneForPage(activeNav, { ownerWorkspace: ownerWorkspaceActive, isAdmin })} reduceMotion={reduceMotionPref} />
        <a className="sp-skip-link" href="#main-content">Skip to main content</a>
        <Sidebar
          groups={navGroups} activeNav={activeNav} onSelect={navigate} collapsed={sidebarCollapsed} onToggleCollapsed={toggleSidebar}
          mobileOpen={mobileNavOpen} onCloseMobile={() => setMobileNavOpen(false)} translate={t}
          displayName={displayName} roleLabel={userRoleLabel} initials={userInitials}
          onOpenProfile={() => navigate('My profile')} onOpenHelp={() => navigate('Help & support')}
        />
        <div className="sp-main">
          <Topbar
            crumbs={crumbs} apiStatus={apiStatus} theme={theme} onToggleTheme={() => handleThemeChange(theme === 'dark' ? 'light' : 'dark')}
            unreadCount={unreadCount} onNavigate={navigate} onOpenSearch={() => setPaletteOpen(true)} onOpenMenu={() => setMobileNavOpen(true)}
            initials={userInitials} avatarUrl={currentUser.avatar?.url} displayName={displayName} email={currentUser.email} onLogout={handleLogout} loggingOut={loggingOut}
          />
          <main id="main-content" className="sp-content" tabIndex="-1">
            <WorkspaceErrorBoundary resetKey={activeNav}>
              {/* Page entrance is a CSS animation (scenes.css) keyed on the page, so a page swap
                  never waits on an exit animation — navigation stays instant even when the
                  window is in the background and animation frames are paused. */}
              <div key={activeNav} className="sp-page-frame" data-motion={sceneForPage(activeNav, { ownerWorkspace: ownerWorkspaceActive, isAdmin })}>
                <Suspense fallback={<PageFallback />}>{page}</Suspense>
              </div>
            </WorkspaceErrorBoundary>
            <footer className="sp-footer"><span>© {new Date().getFullYear()} SmartPark Mobility OS</span><span><i className="sp-footer-dot" aria-hidden="true" /> Availability reflects recorded sensor state and active reservations</span></footer>
          </main>
        </div>
        <MobileTabBar items={tabItems} activeNav={activeNav} onSelect={navigate} onOpenMenu={() => setMobileNavOpen(true)} translate={t} />
        <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} sections={paletteSections} />
      </div>
    </MotionConfig>
  );
}
