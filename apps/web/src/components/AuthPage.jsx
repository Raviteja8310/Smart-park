import { useEffect, useState } from 'react';
import { ArrowRight, CarFront, CheckCircle2, Eye, EyeOff, LockKeyhole, MapPinned, ShieldCheck, Sparkles } from 'lucide-react';

const verificationRequestCache = new Map();

async function readResponse(response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data?.error?.message ?? 'Something went wrong. Please try again.');
    error.code = data?.error?.code;
    throw error;
  }
  return data;
}

function verifyTokenOnce(token) {
  if (!verificationRequestCache.has(token)) {
    const request = fetch('/api/auth/verify-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token })
    }).then(readResponse);
    verificationRequestCache.set(token, request);
  }
  return verificationRequestCache.get(token);
}

export default function AuthPage({ onAuthenticated }) {
  const [mode, setMode] = useState('login');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [resetToken, setResetToken] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [verificationEmail, setVerificationEmail] = useState('');
  const [verificationResendAvailable, setVerificationResendAvailable] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const emailToken = params.get('verify');
    const passwordToken = params.get('reset');

    if (passwordToken) {
      setResetToken(passwordToken);
      setMode('reset');
      setMessage('Choose a new password for your SmartPark account.');
      return;
    }
    if (!emailToken) return;

    let cancelled = false;
    setBusy(true);
    verifyTokenOnce(emailToken)
      .then((data) => {
        if (!cancelled) {
          setMode('login');
          setMessage(data.message ?? 'Your email is verified. You can now sign in.');
        }
      })
      .catch((reason) => {
        if (!cancelled) setError(reason.message);
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
        window.history.replaceState({}, document.title, window.location.pathname);
      });

    return () => { cancelled = true; };
  }, []);

  function changeMode(nextMode) {
    setMode(nextMode);
    setError('');
    setMessage('');
    setVerificationResendAvailable(false);
    if (nextMode !== 'reset') setResetToken('');
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');
    setMessage('');
    setVerificationResendAvailable(false);

    if (['register', 'reset'].includes(mode) && password !== confirmPassword) {
      setError('The passwords do not match.');
      return;
    }

    setBusy(true);
    try {
      let endpoint;
      let payload;
      if (mode === 'register') {
        endpoint = '/api/auth/register';
        payload = { fullName, email, phone, password };
      } else if (mode === 'login') {
        endpoint = '/api/auth/login';
        payload = { email, password };
      } else if (mode === 'forgot') {
        endpoint = '/api/auth/forgot-password';
        payload = { email };
      } else {
        endpoint = '/api/auth/reset-password';
        payload = { token: resetToken, password };
      }

      const data = await readResponse(await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(payload)
      }));

      if (mode === 'login') {
        onAuthenticated(data.user);
      } else if (mode === 'register') {
        setVerificationEmail(email.trim());
        setVerificationResendAvailable(true);
        setMessage(data.message ?? 'Account created. Check your email to verify your account before signing in.');
        setPassword('');
        setConfirmPassword('');
        setMode('login');
      } else if (mode === 'forgot') {
        setMessage(data.message ?? 'If an active account matches that email, a reset link has been sent.');
      } else {
        setPassword('');
        setConfirmPassword('');
        setResetToken('');
        setMode('login');
        setMessage(data.message ?? 'Password updated. Sign in with your new password.');
        window.history.replaceState({}, document.title, window.location.pathname);
      }
    } catch (reason) {
      setError(reason.message);
      if (reason.code === 'EMAIL_NOT_VERIFIED') {
        setVerificationEmail(email.trim());
        setVerificationResendAvailable(true);
      }
    } finally {
      setBusy(false);
    }
  }

  async function resendVerification() {
    setError('');
    setMessage('');
    setBusy(true);
    try {
      const data = await readResponse(await fetch('/api/auth/resend-verification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: verificationEmail || email.trim() })
      }));
      setMessage(data.message);
    } catch (reason) {
      setError(reason.message);
    } finally {
      setBusy(false);
    }
  }

  const heading = mode === 'login' ? ['WELCOME BACK', 'Sign in to SmartPark', 'Your next parking experience starts here.']
    : mode === 'register' ? ['GET STARTED', 'Create your account', 'Create a driver account. Other roles are assigned by an administrator.']
    : mode === 'forgot' ? ['ACCOUNT RECOVERY', 'Reset your password', 'We will send a reset link if an active account matches your email.']
    : ['SECURE YOUR ACCOUNT', 'Choose a new password', 'Use a unique password of at least 12 characters.'];

  return (
    <div className="auth-page">
      <section className="auth-story" aria-label="SmartPark introduction">
        <div className="auth-brand"><span className="auth-brand-icon"><CarFront size={24} /></span><span><strong>smartpark</strong><small>YOUR SPACE. YOUR TIME.</small></span></div>
        <div className="auth-story-body">
          <div className="auth-eyebrow"><Sparkles size={14} /> A calmer way to park</div>
          <h1>Make room for what matters.</h1>
          <p>Find a space, plan your arrival and keep every parking detail in one place.</p>
          <div className="auth-feature-list">
            <div><span><MapPinned size={17} /></span><div><strong>Parking that fits your day</strong><small>Explore locations and space options.</small></div></div>
            <div><span><ShieldCheck size={17} /></span><div><strong>Bookings with clarity</strong><small>Your reservations and receipts, together.</small></div></div>
            <div><span><LockKeyhole size={17} /></span><div><strong>Account-first security</strong><small>Verified access and protected sessions.</small></div></div>
          </div>
        </div>
        <div className="auth-story-footer"><span className="auth-live-dot" /> Built for a smoother parking experience</div>
        <div className="auth-orb auth-orb-one" /><div className="auth-orb auth-orb-two" />
      </section>

      <section className="auth-form-side">
        <div className="auth-form-wrap">
          <div className="auth-mobile-brand"><span className="auth-brand-icon"><CarFront size={22} /></span><strong>smartpark</strong></div>
          <div className="auth-form-heading">
            <span className="auth-step-label">{heading[0]}</span>
            <h2>{heading[1]}</h2>
            <p>{heading[2]}</p>
          </div>

          {['login', 'register'].includes(mode) ? (
            <div className="auth-mode-switch" role="tablist" aria-label="Account access">
              <button type="button" className={mode === 'login' ? 'selected' : ''} onClick={() => changeMode('login')} role="tab" aria-selected={mode === 'login'}>Sign in</button>
              <button type="button" className={mode === 'register' ? 'selected' : ''} onClick={() => changeMode('register')} role="tab" aria-selected={mode === 'register'}>Create account</button>
            </div>
          ) : <button className="auth-resend-link" type="button" onClick={() => changeMode('login')}>← Back to sign in</button>}

          {message && <div className="auth-message success" role="status"><CheckCircle2 size={17} /><span>{message}</span></div>}
          {error && <div className="auth-message error" role="alert">{error}</div>}
          {verificationResendAvailable && <button className="auth-resend-button" type="button" disabled={busy} onClick={resendVerification}>Resend verification email</button>}

          <form className="auth-form" onSubmit={handleSubmit}>
            {mode === 'register' && <label className="auth-field"><span>Full name</span><input autoComplete="name" value={fullName} onChange={(event) => setFullName(event.target.value)} placeholder="Your full name" minLength={2} maxLength={120} required /></label>}
            {mode !== 'reset' && <label className="auth-field"><span>Email address</span><input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" maxLength={254} required /></label>}
            {mode === 'register' && <label className="auth-field"><span>Phone number <small>Optional</small></span><input type="tel" autoComplete="tel" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="Your contact number" maxLength={30} /></label>}
            {['login', 'register', 'reset'].includes(mode) && <label className="auth-field"><span>{mode === 'reset' ? 'New password' : 'Password'}</span><div className="auth-password-wrap"><input type={showPassword ? 'text' : 'password'} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} value={password} onChange={(event) => setPassword(event.target.value)} placeholder={mode === 'login' ? 'Enter your password' : 'At least 12 characters'} minLength={mode === 'login' ? 1 : 12} maxLength={128} required /><button type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? 'Hide password' : 'Show password'}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></div>{mode !== 'login' && <small className="auth-field-hint">Use a long, unique passphrase of 12 characters or more.</small>}</label>}
            {['register', 'reset'].includes(mode) && <label className="auth-field"><span>Confirm password</span><input type="password" autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} placeholder="Enter your password again" minLength={12} maxLength={128} required /></label>}
            <button className="auth-submit" type="submit" disabled={busy}>{busy ? 'Please wait…' : mode === 'login' ? 'Sign in securely' : mode === 'register' ? 'Create account' : mode === 'forgot' ? 'Send reset link' : 'Update password'} {!busy && <ArrowRight size={17} />}</button>
          </form>

          {mode === 'login' && <div className="auth-account-links"><button className="auth-resend-link" type="button" disabled={busy} onClick={() => changeMode('forgot')}>Forgot password?</button><button className="auth-resend-link" type="button" disabled={busy} onClick={() => { setVerificationEmail(email.trim()); setVerificationResendAvailable(true); setError(''); setMessage('Enter your email above, then request a new verification link.'); }}>Need a new verification link?</button></div>}
          <div className="auth-privacy-note"><LockKeyhole size={14} /><span>Passwords are never stored as plain text. Sessions are protected by an HttpOnly cookie.</span></div>
          <p className="auth-legal">By continuing, you agree to use SmartPark in accordance with its terms and privacy policy.</p>
        </div>
      </section>
    </div>
  );
}
