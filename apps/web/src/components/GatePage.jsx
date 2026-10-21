import { useEffect, useRef, useState } from 'react';
import { BrowserQRCodeReader } from '@zxing/browser';
import { Camera, CameraOff, CheckCircle2, CircleAlert, LoaderCircle, LogIn, LogOut, ScanLine, ShieldCheck } from 'lucide-react';

async function apiRequest(path, options = {}) {
  const response = await fetch(path, { credentials: 'same-origin', ...options, headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers ?? {}) } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message ?? 'The scan could not be processed.');
  return data;
}

export default function GatePage({ currentUser }) {
  const [action, setAction] = useState('entry');
  const [token, setToken] = useState('');
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const videoRef = useRef(null);

  useEffect(() => {
    if (!scanning || !videoRef.current) return undefined;
    let cancelled = false;
    let controls = null;
    const reader = new BrowserQRCodeReader();
    reader.decodeFromVideoDevice(undefined, videoRef.current, (scanResult) => {
      if (cancelled || !scanResult) return;
      setToken(scanResult.getText());
      setScanning(false);
      setError('');
    }).then((nextControls) => {
      if (cancelled) nextControls.stop();
      else controls = nextControls;
    }).catch((scanError) => {
      if (!cancelled) { setError(scanError?.message || 'Unable to access the camera. Check browser camera permissions or paste the QR token manually.'); setScanning(false); }
    });
    return () => { cancelled = true; controls?.stop(); };
  }, [scanning]);

  async function processScan(event) {
    event.preventDefault();
    setBusy(true); setError(''); setResult(null);
    try {
      const data = await apiRequest('/api/gate/scan', { method: 'POST', body: JSON.stringify({ token: token.trim(), action }) });
      setResult(data);
      setToken('');
    } catch (requestError) { setError(requestError.message || 'The ticket could not be validated.'); }
    finally { setBusy(false); }
  }

  const canOperate = currentUser?.roles?.some((role) => ['attendant', 'operator', 'admin'].includes(role));
  if (!canOperate) return <section className="sp-page"><div className="sp-alert error"><ShieldCheck size={17} /><span>Gate access is available only to authorized attendants, assigned operators and administrators.</span></div></section>;

  return <section className="sp-page sp-bookings-page">
    <div className="sp-page-heading"><div><p className="sp-kicker">FACILITY OPERATIONS</p><h1>Gate access</h1><p>Scan a SmartPark QR ticket to authorize entry or record a completed exit.</p></div></div>
    {error && <div className="sp-alert error"><CircleAlert size={17} /><span>{error}</span><button onClick={() => setError('')} aria-label="Dismiss error">×</button></div>}
    {result && <div className="sp-alert success"><CheckCircle2 size={17} /><span>{result.message} {result.booking?.bookingCode ? `Booking ${result.booking.bookingCode}, slot ${result.booking.slotCode}.` : ''} {result.physicalCheckRequired ? 'Occupancy data was unknown; visually confirm the assigned space before admitting the vehicle.' : ''} {result.physicalCheckRequired ? 'Occupancy data was unknown; visually confirm the assigned space before admitting the vehicle.' : ''}</span></div>}
    <div className="sp-gate-grid">
      <article className="sp-panel sp-gate-panel">
        <div className="sp-panel-header"><div><p className="sp-kicker">QR VALIDATION</p><h2>Scan reservation ticket</h2><p>Camera scanning requires browser permission and HTTPS when deployed outside localhost.</p></div><ScanLine size={20} /></div>
        <div className="sp-gate-action-toggle" role="group" aria-label="Gate action">
          <button type="button" className={action === 'entry' ? 'active' : ''} onClick={() => setAction('entry')}><LogIn size={16} /> Vehicle entry</button>
          <button type="button" className={action === 'exit' ? 'active' : ''} onClick={() => setAction('exit')}><LogOut size={16} /> Vehicle exit</button>
        </div>
        <div className="sp-gate-camera">
          {scanning ? <video ref={videoRef} className="sp-gate-video" muted playsInline /> : <div className="sp-gate-camera-empty"><Camera size={28} /><strong>Ready to scan</strong><span>Start the camera to read a booking QR code.</span></div>}
        </div>
        <div className="sp-form-actions"><button className="sp-button secondary" type="button" onClick={() => setScanning((value) => !value)}>{scanning ? <CameraOff size={15} /> : <Camera size={15} />}{scanning ? 'Stop camera' : 'Start camera scanner'}</button><span className="sp-form-hint">Camera access is handled by your browser.</span></div>
        <form className="sp-form sp-gate-token-form" onSubmit={processScan}>
          <label>QR ticket token<input autoComplete="off" value={token} onChange={(event) => setToken(event.target.value)} required minLength={30} maxLength={2048} placeholder="Scan the QR or paste the decoded token" /></label>
          <button className="sp-button primary" disabled={busy || !token.trim()}>{busy ? <LoaderCircle className="sp-spin" size={15} /> : <ShieldCheck size={15} />}{busy ? 'Validating…' : action === 'entry' ? 'Validate and authorize entry' : 'Validate and record exit'}</button>
        </form>
      </article>
      <article className="sp-panel sp-gate-rules">
        <p className="sp-kicker">GATE RULES</p><h2>{action === 'entry' ? 'Before allowing entry' : 'Before recording exit'}</h2>
        {action === 'entry' ? <ul><li>The reservation must be paid and confirmed.</li><li>Entry opens 30 minutes before the booking start time.</li><li>A booking can be checked in only once.</li><li>The attendant must be assigned to the selected facility.</li></ul> : <ul><li>The booking must have an active checked-in parking session.</li><li>Exit closes the active session and completes the booking.</li><li>The space becomes unknown until the camera or an operator confirms it is empty.</li><li>The exit action cannot be repeated on a completed session.</li></ul>}
        <div className="sp-gate-security-note"><ShieldCheck size={17} /><span>QR signatures, expiry, booking ownership and assigned-facility permissions are checked on the server.</span></div>
      </article>
    </div>
  </section>;
}
