import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Bell, ChevronRight, LogOut, Menu, Moon, Search, Settings, Sun, UserRound } from 'lucide-react';
import { easeOutExpo } from '../ui/primitives.jsx';

function SystemStatus({ apiStatus }) {
  const ok = apiStatus.state === 'ok';
  const label = apiStatus.checking ? 'Checking' : ok ? 'All systems live' : apiStatus.state === 'degraded' ? 'Database offline' : 'API offline';
  return (
    <span className={`sp-sys ${ok ? 'ok' : apiStatus.checking ? 'pending' : 'down'}`} title={`API: ${apiStatus.state}; database: ${apiStatus.database}`} role="status">
      <i aria-hidden="true" /><span>{label}</span>
    </span>
  );
}

function ProfileMenu({ initials, avatarUrl, displayName, email, onNavigate, onLogout, loggingOut }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const reduce = useReducedMotion();
  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open]);
  const go = (label) => { setOpen(false); onNavigate(label); };
  return (
    <div className="sp-menu-wrap" ref={ref}>
      <button type="button" className="sp-avatar-btn" aria-haspopup="menu" aria-expanded={open} aria-label="Account menu" onClick={() => setOpen((v) => !v)}>
        <span className={`sp-avatar ${avatarUrl ? 'has-photo' : ''}`} aria-hidden="true">{avatarUrl ? <img src={avatarUrl} alt="" /> : initials}</span>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div className="sp-menu" role="menu" initial={reduce ? false : { opacity: 0, y: -6, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.22, ease: easeOutExpo }}>
            <div className="sp-menu-head"><strong>{displayName}</strong>{email && <small>{email}</small>}</div>
            <button role="menuitem" type="button" onClick={() => go('My profile')}><UserRound size={15} /> My profile</button>
            <button role="menuitem" type="button" onClick={() => go('Settings')}><Settings size={15} /> Settings</button>
            <button role="menuitem" type="button" onClick={() => go('Notifications')}><Bell size={15} /> Notifications</button>
            <hr />
            <button role="menuitem" type="button" className="danger" onClick={() => { setOpen(false); onLogout(); }} disabled={loggingOut}><LogOut size={15} /> {loggingOut ? 'Signing out…' : 'Sign out'}</button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function Topbar({ crumbs, apiStatus, theme, onToggleTheme, unreadCount, onNavigate, onOpenSearch, onOpenMenu, initials, avatarUrl, displayName, email, onLogout, loggingOut }) {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 4);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
  return (
    <header className={`sp-topbar ${scrolled ? 'scrolled' : ''}`}>
      <button type="button" className="sp-icon-btn sp-only-mobile" onClick={onOpenMenu} aria-label="Open navigation"><Menu size={19} /></button>
      <nav className="sp-crumbs" aria-label="Breadcrumb">
        <ol>
          {crumbs.map((crumb, i) => (
            <li key={`${crumb}-${i}`} aria-current={i === crumbs.length - 1 ? 'page' : undefined}>
              {i > 0 && <ChevronRight size={13} aria-hidden="true" />}
              {i === crumbs.length - 1 ? <strong>{crumb}</strong> : <span>{crumb}</span>}
            </li>
          ))}
        </ol>
      </nav>
      <button type="button" className="sp-search-trigger" onClick={onOpenSearch} aria-label="Search SmartPark" aria-keyshortcuts={isMac ? 'Meta+K' : 'Control+K'}>
        <Search size={16} aria-hidden="true" /><span>Search or jump to…</span><kbd>{isMac ? '⌘' : 'Ctrl'} K</kbd>
      </button>
      <div className="sp-top-actions">
        <SystemStatus apiStatus={apiStatus} />
        <button type="button" className="sp-icon-btn sp-only-mobile-search" onClick={onOpenSearch} aria-label="Search"><Search size={18} /></button>
        <button type="button" className="sp-icon-btn" onClick={onToggleTheme} aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`} title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}>
          <AnimatePresence mode="wait" initial={false}>
            <motion.span key={theme} initial={{ rotate: -40, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }} exit={{ rotate: 40, opacity: 0 }} transition={{ duration: 0.2 }} style={{ display: 'grid' }}>
              {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
            </motion.span>
          </AnimatePresence>
        </button>
        <button type="button" className="sp-icon-btn" onClick={() => onNavigate('Notifications')} aria-label={unreadCount ? `Notifications, ${unreadCount} unread` : 'Notifications'}>
          <Bell size={18} />
          {unreadCount > 0 && <span className="sp-badge-dot sp-num" aria-hidden="true">{unreadCount > 9 ? '9+' : unreadCount}</span>}
        </button>
        <ProfileMenu initials={initials} avatarUrl={avatarUrl} displayName={displayName} email={email} onNavigate={onNavigate} onLogout={onLogout} loggingOut={loggingOut} />
      </div>
    </header>
  );
}
