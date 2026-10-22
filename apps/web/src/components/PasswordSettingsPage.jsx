import { useState } from 'react';
import { KeyRound, ShieldCheck } from 'lucide-react';

export default function PasswordSettingsPage() {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function submit(event) {
    event.preventDefault(); setError(''); setMessage('');
    if (newPassword !== confirmPassword) { setError('The new passwords do not match.'); return; }
    if (newPassword.length < 6) { setError('Use at least 6 characters for your new password.'); return; }
    setBusy(true);
    try {
      const response = await fetch('/api/auth/change-password', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ currentPassword, newPassword }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error?.message || 'Could not change the password.');
      setCurrentPassword(''); setNewPassword(''); setConfirmPassword(''); setMessage(data.message || 'Password changed successfully.');
    } catch (reason) { setError(reason.message); }
    finally { setBusy(false); }
  }

  return <section className="page-section"><div className="panel-heading"><div><p className="section-kicker">ACCOUNT SECURITY</p><h2>Change password</h2><p className="muted-copy">Verify your current password before choosing a new one.</p></div><ShieldCheck size={25} /></div>
    <form onSubmit={submit} className="auth-form" style={{ maxWidth: 520, marginTop: 24 }}>
      <label className="auth-field"><span>Current password</span><input type="password" autoComplete="current-password" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} maxLength={128} required /></label>
      <label className="auth-field"><span>New password</span><input type="password" autoComplete="new-password" value={newPassword} onChange={e => setNewPassword(e.target.value)} minLength={6} maxLength={128} required /><small className="auth-field-hint">At least 6 characters.</small></label>
      <label className="auth-field"><span>Confirm new password</span><input type="password" autoComplete="new-password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} minLength={6} maxLength={128} required /></label>
      {error && <div className="auth-message error" role="alert">{error}</div>}{message && <div className="auth-message success" role="status">{message}</div>}
      <button className="auth-submit" type="submit" disabled={busy}><KeyRound size={16} /> {busy ? 'Updating…' : 'Change password'}</button>
    </form>
  </section>;
}
