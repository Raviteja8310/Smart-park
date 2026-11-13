import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import Logo, { BrandHero } from './brand/Logo.jsx';
import PageBackdrop from './shell/PageBackdrop.jsx';
import LoginVideoBackdrop from './shell/LoginVideoBackdrop.jsx';
import { LOGIN_BACKGROUND } from '../config/loginBackground.js';
import { stagger } from './ui/primitives.jsx';
import { supportedLanguages } from '../i18n.js';
import { ArrowRight, CheckCircle2, ChevronDown, Globe, Eye, EyeOff, LockKeyhole, MapPinned, ShieldCheck, Sparkles } from 'lucide-react';

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

export default function AuthPage({ onAuthenticated, language = 'en', onLanguageChange, initialMode = 'login', onBrandClick }) {
  const [mode, setMode] = useState(initialMode === 'register' ? 'register' : 'login');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [resetToken, setResetToken] = useState('');
  const [resetMethod, setResetMethod] = useState('otp');
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
      setResetMethod('link');
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
    if (nextMode !== 'reset') { setResetToken(''); setResetMethod('otp'); }
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
        payload = { token: resetToken, password, ...(resetMethod === 'otp' ? { email } : {}) };
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
        setMode('reset');
        setResetMethod('otp');
        setResetToken('');
        setPassword('');
        setConfirmPassword('');
        setMessage(data.message ?? 'If an active account matches that email, a six-digit code has been sent.');
      } else {
        setPassword('');
        setConfirmPassword('');
        setResetToken('');
        setResetMethod('otp');
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

  async function resendPasswordResetCode() {
    setError(''); setMessage(''); setBusy(true);
    try {
      const data = await readResponse(await fetch('/api/auth/forgot-password', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() })
      }));
      setResetToken('');
      setMessage(data.message ?? 'If an active account matches that email, a new code has been sent.');
    } catch (reason) { setError(reason.message); }
    finally { setBusy(false); }
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
    : mode === 'forgot' ? ['ACCOUNT RECOVERY', 'Reset your password', 'We will email a six-digit code if an active account matches your email.']
    : ['SECURE YOUR ACCOUNT', 'Choose a new password', resetMethod === 'otp' ? 'Enter the six-digit email code and choose a new password.' : 'Use a unique password of at least 6 characters.'];

  return (
    <div className="auth-page">
      <section className="auth-story" aria-label="SmartPark introduction">
        {/* Background is chosen in src/config/loginBackground.js ('video' or the original 'animation'). */}
        {LOGIN_BACKGROUND === 'video' ? <LoginVideoBackdrop /> : <PageBackdrop scene="login" intensity="hero" />}
        <div className="auth-brand">{onBrandClick ? <a className="auth-brand-link" href="/" aria-label="SmartPark home" onClick={(event) => { event.preventDefault(); onBrandClick(); }}><BrandHero size={150} /></a> : <BrandHero size={150} />}</div>
        <motion.div className="auth-story-body" initial="hidden" animate="show" variants={stagger.container}>
          <motion.div className="auth-eyebrow" variants={stagger.item}><Sparkles size={14} /> Smart mobility infrastructure</motion.div>
          <motion.div className="auth-feature-list" variants={stagger.container}>
            <motion.div variants={stagger.item}><span><MapPinned size={17} /></span><div><strong>Live availability</strong><small>Space-level state from sensors and reservations.</small></div></motion.div>
            <motion.div variants={stagger.item}><span><ShieldCheck size={17} /></span><div><strong>Reservations & payments</strong><small>Quotes, holds, receipts and refunds in one flow.</small></div></motion.div>
            <motion.div variants={stagger.item}><span><LockKeyhole size={17} /></span><div><strong>Role-based operations</strong><small>Drivers, owners, operators and admins, each scoped.</small></div></motion.div>
          </motion.div>
        </motion.div>
        <div className="auth-story-footer"><span className="auth-live-dot" /> SmartPark Mobility OS</div>
      </section>

      <section className="auth-form-side">
        {onLanguageChange && (
          <label className="auth-lang" title="Language">
            <Globe size={15} aria-hidden="true" />
            <span className="sp-visually-hidden">Language</span>
            <select value={language} onChange={(event) => onLanguageChange(event.target.value)} translate="no" aria-label="Language">
              {supportedLanguages.map((item) => <option key={item.value} value={item.value} lang={item.value}>{item.label}</option>)}
            </select>
            <ChevronDown size={14} aria-hidden="true" />
          </label>
        )}
        <div className="auth-form-wrap">
          <div className="auth-mobile-brand"><Logo size={52} /></div>
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
            {(mode !== 'reset' || resetMethod === 'otp') && <label className="auth-field"><span>Email address</span><input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" maxLength={254} required={mode !== 'reset'} readOnly={mode === 'reset' && resetMethod === 'otp'} /></label>}
            {mode === 'register' && <label className="auth-field"><span>Phone number <small>Optional</small></span><input type="tel" autoComplete="tel" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="Your contact number" maxLength={30} /></label>}
            {mode === 'reset' && resetMethod === 'otp' && <label className="auth-field"><span>Six-digit email code</span><input aria-label="Six-digit password reset code" inputMode="numeric" autoComplete="one-time-code" value={resetToken} onChange={(event) => setResetToken(event.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="Enter code from your email" pattern="[0-9]{6}" minLength={6} maxLength={6} required/><small className="auth-field-hint">The code expires in 10 minutes. Check your spam or junk folder too.</small></label>}
            {mode === 'reset' && resetMethod === 'link' && <div className="auth-message success" role="status"><LockKeyhole size={16}/><span>Secure reset link detected. Choose a new password below.</span></div>}
            {['login', 'register', 'reset'].includes(mode) && <label className="auth-field"><span>{mode === 'reset' ? 'New password' : 'Password'}</span><div className="auth-password-wrap"><input type={showPassword ? 'text' : 'password'} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} value={password} onChange={(event) => setPassword(event.target.value)} placeholder={mode === 'login' ? 'Enter your password' : 'At least 6 characters'} minLength={mode === 'login' ? 1 : 6} maxLength={128} required /><button type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? 'Hide password' : 'Show password'}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></div>{mode !== 'login' && <small className="auth-field-hint">Use a long, unique passphrase of 6 characters or more.</small>}</label>}
            {['register', 'reset'].includes(mode) && <label className="auth-field"><span>Confirm password</span><input type="password" autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} placeholder="Enter your password again" minLength={6} maxLength={128} required /></label>}
            <button className="auth-submit" type="submit" disabled={busy}>{busy ? 'Please wait…' : mode === 'login' ? 'Sign in securely' : mode === 'register' ? 'Create account' : mode === 'forgot' ? 'Email me a code' : 'Update password'} {!busy && <ArrowRight size={17} />}</button>
          </form>
          {mode === 'reset' && resetMethod === 'otp' && <button className="auth-resend-link auth-reset-resend" type="button" disabled={busy || !email.trim()} onClick={resendPasswordResetCode}>Didn’t receive the code? Send a new one</button>}

          {mode === 'login' && <div className="auth-account-links"><button className="auth-resend-link" type="button" disabled={busy} onClick={() => changeMode('forgot')}>Forgot password?</button><button className="auth-resend-link" type="button" disabled={busy} onClick={() => { setVerificationEmail(email.trim()); setVerificationResendAvailable(true); setError(''); setMessage('Enter your email above, then request a new verification link.'); }}>Need a new verification link?</button></div>}
          <p className="auth-legal">By continuing, you agree to use SmartPark in accordance with its terms and privacy policy.</p>
        </div>
      </section>
    </div>
  );
}
