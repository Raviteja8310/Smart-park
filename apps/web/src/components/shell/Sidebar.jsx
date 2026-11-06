import { useEffect, useRef } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { ChevronsLeft, ChevronsRight, ChevronDown, LifeBuoy, MoreHorizontal, X, Menu } from 'lucide-react';
import Logo, { LogoMark } from '../brand/Logo.jsx';
import { springSoft } from '../ui/primitives.jsx';

function NavList({ groups, activeNav, onSelect, collapsed, translate, layoutGroup }) {
  return (
    <nav className="sp-nav" aria-label="Main navigation">
      {groups.map((group) => (
        <div className="sp-nav-group" key={group.title} role="group" aria-label={translate(group.title)}>
          <p className="sp-nav-title">{collapsed ? <span aria-hidden="true">•••</span> : translate(group.title)}</p>
          <ul>
            {group.items.map(({ label, icon: Icon, badge }) => {
              const active = activeNav === label;
              return (
                <li key={label}>
                  <button
                    type="button"
                    className={`sp-nav-link ${active ? 'active' : ''}`}
                    aria-current={active ? 'page' : undefined}
                    title={collapsed ? translate(label) : undefined}
                    onClick={() => onSelect(label)}
                  >
                    {active && <motion.span layoutId={`${layoutGroup}-nav-active`} className="sp-nav-active" transition={springSoft} aria-hidden="true"><i /></motion.span>}
                    <span className="sp-nav-icon"><Icon size={18} strokeWidth={1.9} /></span>
                    <span className="sp-nav-label">{translate(label)}</span>
                    {badge ? <span className="sp-nav-badge sp-num">{badge > 99 ? '99+' : badge}</span> : null}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function ProfileButton({ displayName, roleLabel, initials, onOpenProfile }) {
  return (
    <button className="sp-profile" type="button" title="Open my profile" onClick={onOpenProfile}>
      <span className="sp-avatar" aria-hidden="true">{initials}</span>
      <span className="sp-profile-copy"><strong>{displayName}</strong><small>{roleLabel}</small></span>
      <MoreHorizontal size={16} aria-hidden="true" />
    </button>
  );
}

export default function Sidebar({ groups, activeNav, onSelect, collapsed, onToggleCollapsed, mobileOpen, onCloseMobile, translate, displayName, roleLabel, initials, onOpenProfile, onOpenHelp }) {
  const reduce = useReducedMotion();
  const drawerRef = useRef(null);

  useEffect(() => {
    if (!mobileOpen) return undefined;
    const previous = document.activeElement;
    const onKey = (event) => { if (event.key === 'Escape') onCloseMobile(); };
    document.addEventListener('keydown', onKey);
    const t = window.setTimeout(() => drawerRef.current?.querySelector('button')?.focus(), 50);
    return () => { document.removeEventListener('keydown', onKey); window.clearTimeout(t); previous?.focus?.(); };
  }, [mobileOpen, onCloseMobile]);

  const select = (label) => { onSelect(label); onCloseMobile(); };

  return (
    <>
      <aside className={`sp-sidebar ${collapsed ? 'collapsed' : ''}`} aria-label="Workspace sidebar">
        <div className="sp-sidebar-head">
          {collapsed ? <LogoMark size={44} /> : <Logo size={46} />}
        </div>
        <button className="sp-workspace" type="button" onClick={onOpenProfile} title="Switch workspace in My profile">
          <span className="sp-workspace-dot" aria-hidden="true" />
          <span className="sp-workspace-copy"><small>Workspace</small><strong>{roleLabel}</strong></span>
          <ChevronDown size={14} aria-hidden="true" />
        </button>
        <div className="sp-sidebar-scroll">
          <NavList groups={groups} activeNav={activeNav} onSelect={onSelect} collapsed={collapsed} translate={translate} layoutGroup="desk" />
        </div>
        <div className="sp-sidebar-foot">
          {!collapsed && <button type="button" className="sp-help-link" onClick={onOpenHelp}><LifeBuoy size={16} /> <span>{translate('Help & support')}</span></button>}
          <ProfileButton displayName={displayName} roleLabel={roleLabel} initials={initials} onOpenProfile={onOpenProfile} />
          <button type="button" className="sp-collapse" onClick={onToggleCollapsed} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} aria-expanded={!collapsed}>
            {collapsed ? <ChevronsRight size={16} /> : <><ChevronsLeft size={16} /><span>Collapse</span></>}
          </button>
        </div>
      </aside>

      <AnimatePresence>
        {mobileOpen && (
          <motion.div className="sp-drawer-layer" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reduce ? 0 : 0.2 }}>
            <button className="sp-drawer-scrim" type="button" aria-label="Close navigation" onClick={onCloseMobile} tabIndex={-1} />
            <motion.aside
              ref={drawerRef}
              className="sp-drawer" role="dialog" aria-modal="true" aria-label="Navigation"
              initial={{ x: reduce ? 0 : '-104%' }} animate={{ x: 0 }} exit={{ x: reduce ? 0 : '-104%' }} transition={reduce ? { duration: 0 } : springSoft}
            >
              <div className="sp-drawer-head"><Logo size={42} /><button type="button" className="sp-icon-btn" onClick={onCloseMobile} aria-label="Close navigation"><X size={18} /></button></div>
              <div className="sp-sidebar-scroll"><NavList groups={groups} activeNav={activeNav} onSelect={select} collapsed={false} translate={translate} layoutGroup="drawer" /></div>
              <div className="sp-sidebar-foot"><ProfileButton displayName={displayName} roleLabel={roleLabel} initials={initials} onOpenProfile={() => { onOpenProfile(); onCloseMobile(); }} /></div>
            </motion.aside>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

/** Bottom tab bar for phones: the four most-used destinations plus "More". */
export function MobileTabBar({ items, activeNav, onSelect, onOpenMenu, translate }) {
  return (
    <nav className="sp-tabbar" aria-label="Quick navigation">
      {items.map(({ label, short, icon: Icon }) => {
        const active = activeNav === label;
        return (
          <button key={label} type="button" className={active ? 'active' : ''} aria-current={active ? 'page' : undefined} onClick={() => onSelect(label)}>
            {active && <motion.span layoutId="tabbar-active" className="sp-tabbar-active" transition={springSoft} aria-hidden="true" />}
            <Icon size={19} strokeWidth={1.9} /><span>{short ?? translate(label)}</span>
          </button>
        );
      })}
      <button type="button" onClick={onOpenMenu}><Menu size={19} strokeWidth={1.9} /><span>More</span></button>
    </nav>
  );
}
