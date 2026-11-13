import { useState } from 'react';
import { CircleAlert, LoaderCircle, Trash2, UserX } from 'lucide-react';
import './account.css';

async function readResponse(response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data?.error?.message || 'The request could not be completed.');
    error.blockers = data?.error?.details?.blockers;
    throw error;
  }
  return data;
}

/**
 * "Delete account" section on My profile. Checks first whether anything is still open
 * (bookings, refunds, payouts, owned facilities…), then asks for the password and a typed
 * confirmation. On success the account is closed and the visitor is returned to the home page.
 */
export default function DeleteAccount({ onDeleted }) {
  const [step, setStep] = useState('idle'); // idle | checking | blocked | confirm | deleting | done
  const [blockers, setBlockers] = useState([]);
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState('');

  async function start() {
    setError(''); setStep('checking');
    try {
      const data = await readResponse(await fetch('/api/account/delete-check', { credentials: 'same-origin' }));
      setBlockers(data.blockers || []);
      setStep(data.canDelete ? 'confirm' : 'blocked');
    } catch (checkError) { setError(checkError.message); setStep('idle'); }
  }

  async function submit(event) {
    event.preventDefault();
    setError('');
    if (confirmation.trim() !== 'DELETE') { setError('Type DELETE to confirm that you want to delete your account.'); return; }
    setStep('deleting');
    try {
      await readResponse(await fetch('/api/account/delete', {
        method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password, confirmation: confirmation.trim() })
      }));
      setPassword(''); setStep('done');
      window.setTimeout(() => onDeleted?.(), 3500);
    } catch (deleteError) {
      if (deleteError.blockers?.length) { setBlockers(deleteError.blockers); setStep('blocked'); return; }
      setError(deleteError.message); setStep('confirm');
    }
  }

  function cancel() { setStep('idle'); setPassword(''); setConfirmation(''); setError(''); setBlockers([]); }

  return (
    <div className="panel sp-delete-account">
      <div className="sp-settings-section-heading">
        <span className="sp-settings-icon"><UserX size={19} /></span>
        <div><h2>Delete account</h2><p>Permanently close your SmartPark account and remove your personal details.</p></div>
      </div>

      {step === 'done' ? (
        <div className="sp-ops-message success" role="status">Your SmartPark account has been deleted. Taking you to the home page…</div>
      ) : (
        <>
          <ul className="sp-delete-account-facts">
            <li>Your name, email, phone number, profile photo, saved places and search history are removed.</li>
            <li>Your vehicles' registration numbers are erased and you are signed out everywhere.</li>
            <li>Past bookings and payments are kept only in anonymized form, because financial records must be retained.</li>
            <li>This cannot be undone. To use SmartPark again you would need to create a new account.</li>
          </ul>

          {step === 'idle' && <button type="button" className="sp-button danger" onClick={start}><Trash2 size={15} /> Delete my account…</button>}
          {step === 'checking' && <p className="sp-muted"><LoaderCircle className="sp-spin" size={15} /> Checking your account…</p>}

          {step === 'blocked' && (
            <div className="sp-delete-account-blocked" role="alert">
              <strong><CircleAlert size={15} /> Your account can't be deleted yet</strong>
              <ul>{blockers.map((blocker) => <li key={blocker.code}>{blocker.message}</li>)}</ul>
              <button type="button" className="sp-button ghost" onClick={cancel}>Close</button>
            </div>
          )}

          {(step === 'confirm' || step === 'deleting') && (
            <form className="sp-delete-account-form" onSubmit={submit}>
              <label>Current password<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required /></label>
              <label>Type DELETE to confirm<input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="off" spellCheck={false} required placeholder="DELETE" translate="no" /></label>
              {error && <div className="sp-ops-message error" role="alert">{error}</div>}
              <div className="sp-delete-account-actions">
                <button type="button" className="sp-button ghost" onClick={cancel} disabled={step === 'deleting'}>Cancel</button>
                <button className="sp-button danger" disabled={step === 'deleting' || !password || confirmation.trim() !== 'DELETE'}>
                  {step === 'deleting' ? <><LoaderCircle className="sp-spin" size={15} /> Deleting…</> : <><Trash2 size={15} /> Permanently delete my account</>}
                </button>
              </div>
            </form>
          )}
          {step === 'idle' && error && <div className="sp-ops-message error" role="alert">{error}</div>}
        </>
      )}
    </div>
  );
}
