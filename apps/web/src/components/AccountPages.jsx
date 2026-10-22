import { useEffect, useState } from 'react';
import {
  ShieldCheck, Save, CheckCircle2, ChevronDown, ChevronUp, CircleHelp, Accessibility,
  UserRound, KeyRound, LockKeyhole, Eye, EyeOff, Palette, Sun, Moon, BellRing,
  Languages, RotateCcw, Download, MonitorCog, Mail, ArrowRight, Sparkles, Building2, CarFront, Store, TicketCheck, Send, MessageSquare, CircleAlert
} from 'lucide-react';
import { supportedLanguages } from '../i18n.js';

const PREFERENCES_KEY = 'smartpark.preferences';
const preferenceDefaults = {
  bookingUpdates: true,
  parkingAlerts: true,
  compactTables: false,
  language: 'en',
  theme: 'light',
  highContrast: false,
  largeText: false,
  reduceMotion: false
};

function readPreferences() {
  try { return { ...preferenceDefaults, ...JSON.parse(localStorage.getItem(PREFERENCES_KEY) || '{}') }; }
  catch { return { ...preferenceDefaults }; }
}

function writePreferences(preferences) {
  try {
    localStorage.setItem(PREFERENCES_KEY, JSON.stringify({ ...preferenceDefaults, ...preferences }));
    window.dispatchEvent(new CustomEvent('smartpark:preferences-changed'));
  } catch { /* Storage can be unavailable in private/restricted browser contexts. */ }
}

function applyAccessibilityPreferences(preferences) {
  document.documentElement.classList.toggle('sp-high-contrast', Boolean(preferences.highContrast));
  document.documentElement.classList.toggle('sp-large-text', Boolean(preferences.largeText));
  document.documentElement.classList.toggle('sp-reduce-motion', Boolean(preferences.reduceMotion));
  document.documentElement.classList.toggle('sp-compact-tables', Boolean(preferences.compactTables));
}

async function readResponse(response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data?.error?.message ?? 'The request could not be completed.');
    error.code = data?.error?.code;
    throw error;
  }
  return data;
}

export function ProfilePage({ currentUser, onProfileUpdated, workspaceMode = 'driver', onWorkspaceChange, onNavigate }) {
  const [fullName, setFullName] = useState(currentUser?.fullName || '');
  const [phone, setPhone] = useState(currentUser?.phone || '');
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileError, setProfileError] = useState('');
  const [profileMessage, setProfileMessage] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordError, setPasswordError] = useState('');
  const [passwordMessage, setPasswordMessage] = useState('');
  const [ownerSetupBusy, setOwnerSetupBusy] = useState(false);
  const [workspaceError, setWorkspaceError] = useState('');
  const [workspaceMessage, setWorkspaceMessage] = useState('');

  useEffect(() => {
    setFullName(currentUser?.fullName || '');
    setPhone(currentUser?.phone || '');
  }, [currentUser?.fullName, currentUser?.phone]);

  const initials = (fullName || currentUser?.email || 'SP').split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('');
  const roles = currentUser?.roles || [];
  const hasFacilityOwnerRole = roles.includes('host');
  const isAdminAccount = roles.includes('admin');
  const roleLabel = roles.map((role) => role === 'host' ? 'facility owner' : role.replaceAll('_', ' ')).join(' · ') || 'driver';

  async function enableFacilityOwnerMode() {
    setOwnerSetupBusy(true); setWorkspaceError(''); setWorkspaceMessage('');
    try {
      const data = await readResponse(await fetch('/api/users/me/facility-owner', {
        method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({})
      }));
      onProfileUpdated?.(data.user);
      onWorkspaceChange?.('facility_owner');
      setWorkspaceMessage(data.message || 'Facility-owner capabilities are enabled. Your new listings still require approval before public booking.');
    } catch (error) { setWorkspaceError(error.message || 'Could not enable facility-owner mode.'); }
    finally { setOwnerSetupBusy(false); }
  }

  function switchWorkspace(nextMode) {
    setWorkspaceError(''); setWorkspaceMessage(nextMode === 'facility_owner'
      ? 'Facility owner workspace selected. You can manage listings and prices while keeping driver features available.'
      : 'Driver workspace selected. Your facilities, pricing, and owner history remain intact.');
    onWorkspaceChange?.(nextMode);
  }

  async function submitProfile(event) {
    event.preventDefault(); setProfileBusy(true); setProfileError(''); setProfileMessage('');
    try {
      const data = await readResponse(await fetch('/api/users/me', {
        method: 'PATCH', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fullName: fullName.trim(), phone: phone.trim() || null })
      }));
      onProfileUpdated?.(data.user);
      setProfileMessage('Your profile details have been saved.');
    } catch (error) { setProfileError(error.message || 'Could not save profile.'); }
    finally { setProfileBusy(false); }
  }

  async function submitPassword(event) {
    event.preventDefault(); setPasswordError(''); setPasswordMessage('');
    if (newPassword !== confirmPassword) { setPasswordError('The new passwords do not match.'); return; }
    if (currentPassword === newPassword) { setPasswordError('Choose a password different from your current password.'); return; }
    setPasswordBusy(true);
    try {
      const data = await readResponse(await fetch('/api/auth/change-password', {
        method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword })
      }));
      setCurrentPassword(''); setNewPassword(''); setConfirmPassword('');
      setPasswordMessage(data.message || 'Password changed successfully.');
    } catch (error) { setPasswordError(error.message || 'Could not change your password.'); }
    finally { setPasswordBusy(false); }
  }

  return <section className="sp-account-page sp-profile-page">
    <header className="sp-account-heading">
      <p className="section-kicker">ACCOUNT & SECURITY</p><h1>My profile</h1>
      <p className="muted-copy">Manage your personal details and account password from one secure place.</p>
    </header>

    {!isAdminAccount && <div className="panel sp-workspace-card">
      <div className="sp-workspace-card-heading"><span className="sp-settings-icon"><Building2 size={19}/></span><div><p className="section-kicker">YOUR SMARTPARK ROLE</p><h2>{hasFacilityOwnerRole ? 'Driver and facility owner' : 'Become a facility owner'}</h2><p>{hasFacilityOwnerRole ? 'Switch workspaces any time. Your owner capability is retained when you use Driver mode.' : 'List a private driveway, garage, apartment bay, or commercial parking facility and set your own rates.'}</p></div></div>
      {hasFacilityOwnerRole ? <>
        <div className="sp-workspace-mode-switch" role="group" aria-label="Choose active workspace">
          <button type="button" className={workspaceMode !== 'facility_owner' ? 'selected' : ''} aria-pressed={workspaceMode !== 'facility_owner'} onClick={() => switchWorkspace('driver')}><CarFront size={17}/><span><strong>Driver mode</strong><small>Find spaces, manage vehicles and bookings</small></span>{workspaceMode !== 'facility_owner' && <CheckCircle2 size={17}/>}</button>
          <button type="button" className={workspaceMode === 'facility_owner' ? 'selected' : ''} aria-pressed={workspaceMode === 'facility_owner'} onClick={() => switchWorkspace('facility_owner')}><Building2 size={17}/><span><strong>Facility owner mode</strong><small>Manage facilities, availability and prices</small></span>{workspaceMode === 'facility_owner' && <CheckCircle2 size={17}/>}</button>
        </div>
        <div className="sp-workspace-actions"><button className="sp-button secondary" onClick={() => { if (workspaceMode !== 'facility_owner') switchWorkspace('facility_owner'); onNavigate?.('My listings'); }}><Store size={15}/> {workspaceMode === 'facility_owner' ? 'Manage facilities & prices' : 'Switch to manage facilities'}</button><button className="sp-button primary" onClick={() => onNavigate?.('Find parking')}><CarFront size={15}/> Park a vehicle</button></div>
        <p className="sp-workspace-note"><ShieldCheck size={14}/> Owners can also book an available space as a driver, including an eligible space at a facility they own. Standard availability, vehicle compatibility, booking and payment rules still apply.</p>
      </> : <div className="sp-workspace-actions sp-workspace-join"><button className="sp-button primary" onClick={enableFacilityOwnerMode} disabled={ownerSetupBusy}>{ownerSetupBusy ? 'Enabling…' : <><Building2 size={15}/> Enable facility owner mode</>}</button><span>Your Driver access is preserved. New listings start as drafts and must be approved before they appear in public search.</span></div>}
      {workspaceError && <div className="sp-ops-message error" role="alert">{workspaceError}</div>}
      {workspaceMessage && <div className="sp-ops-message success" role="status"><CheckCircle2 size={15}/>{workspaceMessage}</div>}
    </div>}

    <div className="panel sp-profile-panel">
      <div className="sp-profile-head">
        <span className="sp-profile-avatar">{initials || 'SP'}</span>
        <div className="sp-profile-identity"><h2>{currentUser?.fullName || 'SmartPark user'}</h2><p>{currentUser?.email}</p><span className="sp-profile-role">{roleLabel}</span></div>
        <span className={`sp-account-verification ${currentUser?.emailVerifiedAt ? 'verified' : 'unknown'}`}><ShieldCheck size={14}/>{currentUser?.emailVerifiedAt ? 'Email verified' : 'Verification status unavailable'}</span>
      </div>
      <form className="sp-profile-form" onSubmit={submitProfile}>
        <label>Full name<input value={fullName} onChange={(event) => setFullName(event.target.value)} required minLength={2} maxLength={120} autoComplete="name"/></label>
        <label>Email address<input type="email" value={currentUser?.email || ''} disabled readOnly autoComplete="email"/><small>Email is protected. Changing it requires a separate verified-email workflow.</small></label>
        <label>Phone number<input type="tel" value={phone} onChange={(event) => setPhone(event.target.value)} maxLength={30} autoComplete="tel" placeholder="Add your phone number"/></label>
        <div className="sp-profile-readonly"><span>Account access</span><strong>Signed in with a protected SmartPark session</strong></div>
        {profileError && <div className="sp-ops-message error" role="alert">{profileError}</div>}
        {profileMessage && <div className="sp-ops-message success" role="status"><CheckCircle2 size={15}/>{profileMessage}</div>}
        <div className="sp-profile-actions"><span><ShieldCheck size={15}/> Email, roles, and account status cannot be edited here.</span><button className="sp-button primary" disabled={profileBusy}>{profileBusy ? 'Saving…' : <><Save size={15}/> Save profile</>}</button></div>
      </form>
    </div>

    <div className="sp-security-card panel">
      <div className="sp-settings-section-heading"><span className="sp-settings-icon"><KeyRound size={19}/></span><div><h2>Change password</h2><p>Confirm your current password before setting a new one.</p></div><span className="sp-secure-label"><LockKeyhole size={13}/> Secure</span></div>
      <form className="sp-password-form" onSubmit={submitPassword}>
        <label>Current password<div className="sp-password-input"><input type={showCurrentPassword ? 'text' : 'password'} value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} autoComplete="current-password" minLength={1} maxLength={128} required placeholder="Enter current password"/><button type="button" aria-label={showCurrentPassword ? 'Hide current password' : 'Show current password'} onClick={() => setShowCurrentPassword((visible) => !visible)}>{showCurrentPassword ? <EyeOff size={16}/> : <Eye size={16}/>}</button></div></label>
        <label>New password<div className="sp-password-input"><input type={showNewPassword ? 'text' : 'password'} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} autoComplete="new-password" minLength={12} maxLength={128} required placeholder="At least 12 characters"/><button type="button" aria-label={showNewPassword ? 'Hide new password' : 'Show new password'} onClick={() => setShowNewPassword((visible) => !visible)}>{showNewPassword ? <EyeOff size={16}/> : <Eye size={16}/>}</button></div><small>Use a long, unique passphrase of 12 characters or more.</small></label>
        <label>Confirm new password<input type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} autoComplete="new-password" minLength={12} maxLength={128} required placeholder="Enter your new password again"/></label>
        {passwordError && <div className="sp-ops-message error" role="alert">{passwordError}</div>}
        {passwordMessage && <div className="sp-ops-message success" role="status"><CheckCircle2 size={15}/>{passwordMessage}</div>}
        <div className="sp-profile-actions"><span><ShieldCheck size={15}/> Other active sessions are revoked after a successful change.</span><button className="sp-button primary" disabled={passwordBusy}>{passwordBusy ? 'Updating…' : <><KeyRound size={15}/> Update password</>}</button></div>
      </form>
      <p className="sp-security-help"><Mail size={15}/> Forgot your current password? Sign out and use <strong>Forgot password?</strong> on the sign-in screen to receive a six-digit code by email.</p>
    </div>
  </section>;
}

export function SettingsPage({ language = 'en', onLanguageChange, theme = 'light', onThemeChange, currentUser, onNavigate }) {
  const [prefs, setPrefs] = useState(readPreferences);
  const [saved, setSaved] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [smsPrefs, setSmsPrefs] = useState({ smsEnabled: false, phoneConfigured: false, phone: '', smsProviderConfigured: false, loading: true });
  const [smsSaving, setSmsSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/notifications/preferences', { credentials: 'same-origin' }).then(async (response) => {
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error?.message || 'Unable to load notification preferences.');
      if (!cancelled) setSmsPrefs({ ...(data.preferences || {}), smsProviderConfigured: Boolean(data.smsProviderConfigured), loading: false });
    }).catch(() => { if (!cancelled) setSmsPrefs((value) => ({ ...value, loading: false })); });
    return () => { cancelled = true; };
  }, [currentUser?.id]);

  useEffect(() => {
    const next = { ...prefs, language, theme };
    applyAccessibilityPreferences(next);
    document.documentElement.lang = language;
  }, [prefs.highContrast, prefs.largeText, prefs.reduceMotion, prefs.compactTables, language, theme]);

  function changePreference(key, value) {
    setPrefs((current) => ({ ...current, [key]: value }));
    setSaved(false); setFeedback('');
    if (key === 'language') onLanguageChange?.(value);
    if (key === 'theme') onThemeChange?.(value);
  }

  function saveSettings() {
    const complete = { ...preferenceDefaults, ...prefs, language, theme };
    writePreferences(complete);
    applyAccessibilityPreferences(complete);
    setSaved(true); setFeedback('Your preferences have been saved in this browser.');
  }

  async function updateSmsPreference(enabled) {
    setSmsSaving(true); setFeedback('');
    try {
      const response = await fetch('/api/notifications/preferences', { method: 'PATCH', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ smsEnabled: enabled }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error?.message || 'Unable to update SMS preferences.');
      setSmsPrefs((value) => ({ ...value, ...(data.preferences || {}), smsEnabled: enabled }));
      setFeedback(enabled ? 'SMS notifications enabled. Messages will be sent only when the SMS provider is configured.' : 'SMS notifications disabled.');
    } catch (error) { setFeedback(error.message || 'Unable to update SMS preferences.'); }
    finally { setSmsSaving(false); }
  }

  function resetSettings() {
    const defaults = { ...preferenceDefaults };
    setPrefs(defaults); onLanguageChange?.(defaults.language); onThemeChange?.(defaults.theme);
    writePreferences(defaults); applyAccessibilityPreferences(defaults); setSaved(true);
    setFeedback('Settings were restored to the default values.');
  }

  function exportPreferences() {
    const payload = { exportedAt: new Date().toISOString(), account: { email: currentUser?.email ?? null }, preferences: { ...preferenceDefaults, ...prefs, language, theme } };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'smartpark-settings.json'; anchor.click();
    URL.revokeObjectURL(url); setFeedback('Settings export prepared.');
  }

  const settingRows = [
    ['bookingUpdates', 'Booking and reservation updates', 'Show booking-related updates in your SmartPark inbox.'],
    ['parkingAlerts', 'Parking and operational alerts', 'Show parking-space and facility alerts in your inbox.'],
    ['compactTables', 'Compact data tables', 'Reduce table spacing to show more rows on larger screens.'],
    ['highContrast', 'High-contrast interface', 'Strengthen text and border contrast for readability.'],
    ['largeText', 'Larger interface text', 'Increase text sizing for easier reading.'],
    ['reduceMotion', 'Reduce animations', 'Limit decorative motion and transitions.']
  ];

  return <section className="sp-account-page sp-settings-page">
    <header className="sp-account-heading"><p className="section-kicker">WORKSPACE PREFERENCES</p><h1>Settings</h1><p className="muted-copy">Personalize how SmartPark looks and behaves. Theme, language, and accessibility choices apply immediately; save to retain other preferences in this browser.</p></header>

    <div className="sp-settings-account-banner panel">
      <span className="sp-settings-account-avatar"><UserRound size={21}/></span>
      <div><span className="sp-settings-overline">SIGNED-IN ACCOUNT</span><strong>{currentUser?.fullName || 'SmartPark user'}</strong><p>{currentUser?.email} · {(currentUser?.roles || ['driver']).join(' · ')}</p></div>
      <button className="sp-button secondary" onClick={() => onNavigate?.('My profile')}>Profile & password <ArrowRight size={15}/></button>
    </div>

    <div className="sp-settings-grid">
      <section className="panel sp-settings-card sp-settings-appearance">
        <div className="sp-settings-section-heading"><span className="sp-settings-icon"><Palette size={19}/></span><div><h2>Appearance</h2><p>Choose the look that feels right for your workspace.</p></div></div>
        <div className="sp-theme-options" role="radiogroup" aria-label="Color theme">
          <button type="button" className={`sp-theme-option ${theme === 'light' ? 'selected' : ''}`} role="radio" aria-checked={theme === 'light'} onClick={() => changePreference('theme', 'light')}>
            <span className="sp-theme-preview light"><i/><i/><i/></span><span><strong><Sun size={15}/> Light</strong><small>Bright and clear</small></span>{theme === 'light' && <CheckCircle2 size={17} className="sp-theme-check"/>}
          </button>
          <button type="button" className={`sp-theme-option ${theme === 'dark' ? 'selected' : ''}`} role="radio" aria-checked={theme === 'dark'} onClick={() => changePreference('theme', 'dark')}>
            <span className="sp-theme-preview dark"><i/><i/><i/></span><span><strong><Moon size={15}/> Dark</strong><small>Comfortable in low light</small></span>{theme === 'dark' && <CheckCircle2 size={17} className="sp-theme-check"/>}
          </button>
        </div>
        <p className="sp-settings-footnote">Your theme is applied immediately and remembered on this device.</p>
      </section>

      <section className="panel sp-settings-card">
        <div className="sp-settings-section-heading"><span className="sp-settings-icon"><Languages size={19}/></span><div><h2>Language</h2><p>Set the language for primary navigation and supported workspace labels.</p></div></div>
        <label className="sp-settings-language">Interface language<select value={language} onChange={(event) => changePreference('language', event.target.value)}>{supportedLanguages.map((item) => <option value={item.value} key={item.value}>{item.label}</option>)}</select></label>
        <p className="sp-settings-footnote">English, Hindi, Kannada, and Telugu are available. Some detailed operational pages may remain in English.</p>
      </section>

      <section className="panel sp-settings-card">
        <div className="sp-settings-section-heading"><span className="sp-settings-icon"><BellRing size={19}/></span><div><h2>Notifications & workspace</h2><p>Choose what appears in the in-app notification view.</p></div></div>
        {settingRows.slice(0, 2).map(([key, title, description]) => <label className="sp-settings-toggle-row" key={key}><span><strong>{title}</strong><small>{description}</small></span><input type="checkbox" checked={Boolean(prefs[key])} onChange={(event) => changePreference(key, event.target.checked)}/></label>)}
        <div className="sp-settings-sms-row"><span><strong>SMS notifications (opt-in)</strong><small>{smsPrefs.phoneConfigured ? `Number on profile: ${smsPrefs.phone}` : 'Add an international-format phone number on My profile first.'} {smsPrefs.smsProviderConfigured ? 'SMS provider configured.' : 'Provider not configured in this environment yet.'}</small></span><input type="checkbox" aria-label="Enable SMS notifications" checked={Boolean(smsPrefs.smsEnabled)} disabled={smsPrefs.loading || smsSaving || !smsPrefs.phoneConfigured} onChange={(event) => updateSmsPreference(event.target.checked)}/></div>
        <p className="sp-settings-footnote">In-app inbox filters are saved in this browser. SMS delivery requires explicit opt-in, an international-format phone number, and a configured Twilio sender. Security recovery codes remain email-only.</p>
      </section>

      <section className="panel sp-settings-card">
        <div className="sp-settings-section-heading"><span className="sp-settings-icon"><Accessibility size={19}/></span><div><h2>Accessibility & display</h2><p>Adjust readability and reduce visual distractions.</p></div></div>
        {settingRows.slice(2).map(([key, title, description]) => <label className="sp-settings-toggle-row" key={key}><span><strong>{title}</strong><small>{description}</small></span><input type="checkbox" checked={Boolean(prefs[key])} onChange={(event) => changePreference(key, event.target.checked)}/></label>)}
      </section>

      <section className="panel sp-settings-card sp-settings-privacy-card">
        <div className="sp-settings-section-heading"><span className="sp-settings-icon"><ShieldCheck size={19}/></span><div><h2>Privacy & account security</h2><p>Review account protection and manage this browser's stored preferences.</p></div></div>
        <div className="sp-security-info-row"><span className="sp-security-info-icon"><LockKeyhole size={16}/></span><span><strong>Password and active sessions</strong><small>Change your password on My profile. Password recovery uses a one-time email code.</small></span><button className="sp-button secondary" onClick={() => onNavigate?.('My profile')}>Manage</button></div>
        <div className="sp-security-info-row"><span className="sp-security-info-icon"><MonitorCog size={16}/></span><span><strong>Browser preferences</strong><small>Theme, language, accessibility and display preferences are saved locally on this device.</small></span><button className="sp-button ghost" onClick={exportPreferences}><Download size={14}/> Export</button></div>
        <div className="sp-settings-foot-actions"><button className="sp-button secondary" onClick={resetSettings}><RotateCcw size={14}/> Restore defaults</button></div>
      </section>
    </div>

    <div className="sp-settings-savebar panel"><span>{feedback || (saved ? 'All changes are saved.' : 'Some preferences are not saved yet.')}</span><button className="sp-button primary" onClick={saveSettings}><Save size={15}/> Save settings</button></div>
  </section>;
}

const faqs = [
  ['How do I add a parking facility?', 'Open Parking spaces. Administrators can create a facility, add zones and generate spaces, configure pricing, and publish or pause the facility.'],
  ['How do I enable camera detection?', 'Open Camera detection, choose a facility, add a camera source, map visible parking spaces, and enable the camera. A running vision service and valid source are required for live detection.'],
  ['Why can’t I open an admin page?', 'Admin tools require the admin role on the server-side account. Sign out and back in after an administrator changes your role.'],
  ['Where is data stored?', 'SmartPark records are stored in MySQL. In local development, Docker runs MySQL and its named volume persists the data.'],
  ['How do I change my password?', 'Open My profile and use the Change password section. If you have forgotten your current password, sign out and select Forgot password on the sign-in screen to receive a one-time code by email.'],
  ['How do I change the app theme?', 'Open Settings and select Light or Dark under Appearance. The theme is applied immediately and remembered in this browser.']
];

export function HelpSupportPage({ currentUser }) {
  const [open, setOpen] = useState(0);
  const [tickets, setTickets] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [detail, setDetail] = useState(null);
  const [form, setForm] = useState({ subject: '', category: 'other', priority: 'normal', description: '' });
  const [reply, setReply] = useState('');
  const [internalReply, setInternalReply] = useState(false);
  const [queueMode, setQueueMode] = useState(false);
  const [loadingTickets, setLoadingTickets] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const isStaff = (currentUser?.roles || []).some((role) => ['admin', 'host', 'operator', 'attendant'].includes(role));

  async function supportApi(path, options = {}) {
    const response = await fetch(path, { credentials: 'same-origin', ...options, headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data?.error?.message || 'The support request could not be completed.');
    return data;
  }

  async function loadTickets(mode = queueMode) {
    setLoadingTickets(true); setError('');
    try {
      const mine = await supportApi('/api/support/mine?limit=50');
      let all = mine.tickets || [];
      if (mode && isStaff) {
        const queue = await supportApi('/api/support/queue?status=all&limit=100');
        const unique = new Map([...all, ...(queue.tickets || [])].map((ticket) => [ticket.id, ticket]));
        all = [...unique.values()].sort((a, b) => new Date(b.lastActivityAt) - new Date(a.lastActivityAt));
      }
      setTickets(all);
      if (selectedId && !all.some((ticket) => ticket.id === selectedId)) { setSelectedId(''); setDetail(null); }
    } catch (requestError) { setError(requestError.message || 'Unable to load support tickets.'); }
    finally { setLoadingTickets(false); }
  }

  useEffect(() => { loadTickets(false); /* user session is the meaningful dependency */ }, [currentUser?.id]);

  async function openTicket(ticket, mode = queueMode) {
    setSelectedId(ticket.id); setError('');
    try { setDetail(await supportApi(`/api/support/${ticket.id}`)); }
    catch (requestError) { setError(requestError.message || 'Unable to open the ticket.'); }
  }

  async function createTicket(event) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      const data = await supportApi('/api/support', { method: 'POST', body: JSON.stringify(form) });
      setForm({ subject: '', category: 'other', priority: 'normal', description: '' });
      setNotice(`Support ticket ${data.ticket?.ticketCode || ''} created.`);
      await loadTickets(false);
      if (data.ticket) await openTicket(data.ticket, false);
    } catch (requestError) { setError(requestError.message || 'Unable to create a support ticket.'); }
    finally { setBusy(false); }
  }

  async function sendReply(event) {
    event.preventDefault(); if (!detail?.ticket || !reply.trim()) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await supportApi(`/api/support/${detail.ticket.id}/messages`, { method: 'POST', body: JSON.stringify({ message: reply.trim(), internal: Boolean(internalReply && isStaff) }) });
      setReply(''); setInternalReply(false); setDetail(await supportApi(`/api/support/${detail.ticket.id}`)); await loadTickets(); setNotice('Reply added.');
    } catch (requestError) { setError(requestError.message || 'Unable to add your reply.'); }
    finally { setBusy(false); }
  }

  async function changeTicketStatus(status) {
    if (!detail?.ticket) return; setBusy(true); setError(''); setNotice('');
    try { await supportApi(`/api/support/${detail.ticket.id}/status`, { method: 'PATCH', body: JSON.stringify({ status, note: `Updated by ${currentUser?.fullName || currentUser?.email || 'staff'} through SmartPark.` }) });
      setDetail(await supportApi(`/api/support/${detail.ticket.id}`)); await loadTickets(); setNotice(`Ticket marked ${status.replaceAll('_', ' ')}.`);
    } catch (requestError) { setError(requestError.message || 'Unable to update ticket status.'); }
    finally { setBusy(false); }
  }

  return <section className="sp-account-page sp-support-page">
    <header className="sp-account-heading"><p className="section-kicker">SMARTPARK HELP DESK</p><h1>Help & support</h1><p className="muted-copy">Create a ticket, follow replies, and track the status of booking, payment, facility, and account issues.</p></header>
    {error && <div className="sp-account-feedback error"><CircleAlert size={16}/>{error}<button onClick={() => setError('')} aria-label="Dismiss error">×</button></div>}
    {notice && <div className="sp-account-feedback success"><CheckCircle2 size={16}/>{notice}<button onClick={() => setNotice('')} aria-label="Dismiss notice">×</button></div>}
    <div className="sp-support-grid">
      <div className="panel sp-account-card sp-support-create"><div className="sp-help-title"><TicketCheck size={23}/><div><h2>Create a support ticket</h2><p className="muted-copy">Avoid sharing passwords, OTPs, or payment secrets in the description.</p></div></div>
        <form className="sp-support-form" onSubmit={createTicket}>
          <label>Subject<input value={form.subject} onChange={(event) => setForm({ ...form, subject: event.target.value })} minLength={6} maxLength={160} required placeholder="e.g. Payment completed but booking not confirmed"/></label>
          <div className="sp-support-form-row"><label>Category<select value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })}><option value="booking">Booking</option><option value="payment">Payment or refund</option><option value="entry_exit">Entry / exit</option><option value="facility">Parking facility</option><option value="safety">Safety issue</option><option value="account">Account access</option><option value="technical">Technical issue</option><option value="other">Other</option></select></label><label>Priority<select value={form.priority} onChange={(event) => setForm({ ...form, priority: event.target.value })}><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option></select></label></div>
          <label>Description<textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} minLength={10} maxLength={5000} rows={5} required placeholder="Describe what happened, the approximate time, and any non-sensitive reference number."/></label>
          <button className="sp-button primary" disabled={busy}><Send size={15}/>{busy ? 'Submitting…' : 'Submit ticket'}</button>
        </form>
      </div>
      <div className="panel sp-account-card sp-support-ticket-list"><div className="sp-help-title"><MessageSquare size={23}/><div><h2>{isStaff ? 'Your tickets & facility queue' : 'Your support tickets'}</h2><p className="muted-copy">Select a ticket to see the conversation and status.</p></div></div>
        {isStaff && <label className="sp-support-mode"><input type="checkbox" checked={queueMode} onChange={(event) => { setQueueMode(event.target.checked); loadTickets(event.target.checked); }}/><span>Include facility support queue</span></label>}
        <div className="sp-support-ticket-list-items">{tickets.map((ticket) => <button type="button" className={`sp-support-ticket-row ${selectedId === ticket.id ? 'selected' : ''}`} key={ticket.id} onClick={() => openTicket(ticket)}><div><strong>{ticket.subject}</strong><small>{ticket.ticketCode} · {ticket.category.replaceAll('_', ' ')} · {ticket.lastActivityAt ? new Date(ticket.lastActivityAt).toLocaleString() : '—'}</small></div><span className={`status-pill ${ticket.status}`}>{ticket.status.replaceAll('_', ' ')}</span>{isStaff && <small className="sp-support-requester">{ticket.requesterName || ticket.requesterEmail}</small>}</button>)}{!tickets.length && <div className="sp-support-empty">{loadingTickets ? 'Loading tickets…' : 'No support tickets yet.'}</div>}</div>
        <button type="button" className="sp-button secondary" onClick={() => loadTickets()} disabled={loadingTickets}><RefreshCw size={14}/>{loadingTickets ? 'Refreshing…' : 'Refresh tickets'}</button>
      </div>
    </div>
    {detail?.ticket && <section className="panel sp-support-conversation"><div className="sp-support-conversation-heading"><div><p className="section-kicker">{detail.ticket.ticketCode}</p><h2>{detail.ticket.subject}</h2><p className="muted-copy">{detail.ticket.parkingLotName || 'General support'}{detail.ticket.bookingCode ? ` · Booking ${detail.ticket.bookingCode}` : ''}</p></div><span className={`status-pill ${detail.ticket.status}`}>{detail.ticket.status.replaceAll('_', ' ')}</span></div>
      <div className="sp-support-ticket-meta"><span>Category: {detail.ticket.category.replaceAll('_', ' ')}</span><span>Priority: {detail.ticket.priority}</span><span>Opened: {new Date(detail.ticket.createdAt).toLocaleString()}</span></div>
      <div className="sp-support-messages">{(detail.messages || []).map((message) => <article key={message.id} className={`sp-support-message ${message.senderUserId === currentUser?.id ? 'mine' : ''} ${message.internal ? 'internal' : ''}`}><div><strong>{message.senderName || 'SmartPark user'}</strong><small>{new Date(message.createdAt).toLocaleString()}{message.internal ? ' · Internal note' : ''}</small></div><p>{message.message}</p></article>)}{!detail.messages?.length && <p className="muted-copy">No replies yet.</p>}</div>
      {!['resolved','closed'].includes(detail.ticket.status) && <form className="sp-support-reply-form" onSubmit={sendReply}><label>Reply<textarea value={reply} onChange={(event) => setReply(event.target.value)} minLength={2} maxLength={5000} rows={3} required placeholder="Write an update…"/></label>{isStaff && <label className="sp-support-mode"><input type="checkbox" checked={internalReply} onChange={(event) => setInternalReply(event.target.checked)}/><span>Internal note (visible to staff only)</span></label>}<button className="sp-button primary" disabled={busy || !reply.trim()}><Send size={14}/>{busy ? 'Sending…' : 'Send reply'}</button></form>}
      {isStaff && <div className="sp-support-status-actions"><span>Staff actions</span>{detail.ticket.status !== 'in_progress' && <button className="sp-button secondary" disabled={busy} onClick={() => changeTicketStatus('in_progress')}>In progress</button>}{detail.ticket.status !== 'waiting_on_user' && <button className="sp-button secondary" disabled={busy} onClick={() => changeTicketStatus('waiting_on_user')}>Waiting on user</button>}{!['resolved','closed'].includes(detail.ticket.status) && <button className="sp-button primary" disabled={busy} onClick={() => changeTicketStatus('resolved')}>Resolve ticket</button>}{detail.ticket.status === 'resolved' && <button className="sp-button secondary" disabled={busy} onClick={() => changeTicketStatus('closed')}>Close ticket</button>}</div>}
    </section>}
    <div className="panel sp-account-card"><div className="sp-help-title"><CircleHelp size={23}/><div><h2>Frequently asked questions</h2><p className="muted-copy">Quick answers before you open or update a ticket.</p></div></div>{faqs.map(([question, answer], index) => <div className="sp-faq" key={question}><button onClick={() => setOpen(open === index ? -1 : index)} aria-expanded={open === index}><span>{question}</span>{open === index ? <ChevronUp size={17}/> : <ChevronDown size={17}/>}</button>{open === index && <p>{answer}</p>}</div>)}</div>
  </section>;
}
