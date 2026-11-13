import { useEffect, useRef, useState } from 'react';
import {
  ArrowRight, ArrowUpRight, BadgePercent, Bell, CalendarCheck, CreditCard, DoorOpen, Gauge, Languages,
  MapPin, Menu, Pause, Play, QrCode, ScanEye, Store, X, Zap
} from 'lucide-react';
import { LOGO_SRC } from '../brand/Logo.jsx';
import './LandingPage.css';

/**
 * Public SmartPark landing page (new, self-contained).
 * Everything here is scoped under `.slp` so no existing page is affected.
 * Login / Get started hand over to the existing AuthPage through the callbacks
 * passed in by App.jsx; this file never touches authentication itself.
 */

const VIDEO_SRC = '/videos/smartpark-hero.mp4';
const POSTER_SRC = '/assets/landing/hero-poster.jpg';
const FONT_HREF = 'https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@100..125,600..900&display=swap';
const PAGE_TITLE = 'SmartPark — Intelligent parking: find, reserve and park';

const SECTIONS = [
  { id: 'slp-home', label: 'Home' },
  { id: 'slp-about', label: 'About' },
  { id: 'slp-features', label: 'Features' },
  { id: 'slp-how', label: 'How it works' },
  { id: 'slp-contact', label: 'Contact' }
];

const FEATURES = [
  { icon: CalendarCheck, title: 'Reserve a space', text: 'Choose a facility, a space and a time window. The price is quoted before you confirm, including any promo code.' },
  { icon: QrCode, title: 'QR entry tickets', text: 'Every confirmed booking carries a QR ticket that is checked at the gate, so arrival takes seconds.' },
  { icon: CreditCard, title: 'Secure checkout', text: 'Payments run through Razorpay, with transactions, receipts and refunds recorded against each booking.' },
  { icon: ScanEye, title: 'Camera occupancy', text: 'A YOLO vision service watches operator-mapped camera zones and keeps space status current.' },
  { icon: Zap, title: 'EV charging', text: 'Find facilities with chargers, see connector types and power, and keep a record of each charging session.' },
  { icon: Gauge, title: 'Monthly passes', text: 'Regular parkers can hold a monthly pass instead of booking every visit.' },
  { icon: Store, title: 'List your space', text: 'Owners publish facilities and spaces, set pricing and opening hours, get verified and track earnings.' },
  { icon: DoorOpen, title: 'Gate operations', text: 'Operators validate entries and exits and can connect compatible gate hardware.' },
  { icon: BadgePercent, title: 'Promotions and referrals', text: 'Promo codes are checked at checkout, and referral codes reward drivers who invite friends.' },
  { icon: Bell, title: 'Alerts that reach you', text: 'Booking updates and account notices in the app, by email and, with consent, by SMS.' },
  { icon: Languages, title: 'Seven languages', text: 'The whole interface works in English, हिन्दी, ಕನ್ನಡ, తెలుగు, Español, Français and 日本語.' }
];

const STEPS = [
  { title: 'Find', text: 'Search by area, landmark or your location. The map shows which facilities have free spaces right now.' },
  { title: 'Reserve', text: 'Pick a space and a time. See the full price, apply a promo and pay securely.' },
  { title: 'Arrive', text: 'Show the QR ticket from your booking at the gate. Route to the entrance from the map.' },
  { title: 'Park and go', text: 'Your bookings, receipts and reviews stay in one place for the next trip.' }
];

const STACK = [
  ['Live availability', 'Space status combines sensor and camera readings with active reservations, so a held space is never shown as free.'],
  ['Computer vision', 'A Python service runs Ultralytics YOLO vehicle detection on camera feeds and maps detections onto parking zones.'],
  ['Maps and routing', 'OpenStreetMap with Leaflet, place search and driving routes, drawn from SmartPark’s own facility records.'],
  ['Platform', 'React and Vite on the front, a Node.js and Express API, a MySQL database, and Docker for deployment.'],
  ['Payments and tickets', 'Razorpay checkout with server-side verification, and a QR ticket for every confirmed booking.']
];

const AUDIENCES = [
  { title: 'Drivers', points: ['Know a space is free before you leave', 'One price, shown before you pay', 'Straight through the gate with your QR ticket', 'EV charging and monthly passes in the same app'] },
  { title: 'Space owners', points: ['Turn unused spaces into income', 'Set your own pricing and opening hours', 'Verified listings that drivers trust', 'Earnings and payouts in one view'] },
  { title: 'Operators', points: ['Live occupancy across every facility', 'Camera detection instead of manual counts', 'Gate validation and audit trails', 'Finance review, promotions and user management'] }
];

function prefersReducedMotion() {
  try {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return true;
    const prefs = JSON.parse(localStorage.getItem('smartpark.preferences') || '{}');
    return Boolean(prefs.reduceMotion);
  } catch { return false; }
}

function useMedia(query) {
  const [matches, setMatches] = useState(() => (typeof window !== 'undefined' ? window.matchMedia(query).matches : false));
  useEffect(() => {
    const list = window.matchMedia(query);
    const onChange = () => setMatches(list.matches);
    onChange();
    list.addEventListener('change', onChange);
    return () => list.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}

function scrollToSection(id) {
  const target = document.getElementById(id);
  if (!target) return;
  target.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
  // Move keyboard focus with the scroll so screen-reader and keyboard users land in the section.
  target.focus({ preventScroll: true });
}

function SectionLink({ id, children, className, onNavigate }) {
  return (
    <a href={`#${id}`} className={className} onClick={(event) => { event.preventDefault(); onNavigate?.(); scrollToSection(id); }}>
      {children}
    </a>
  );
}

function Brand() {
  return (
    <span className="slp-brand">
      <img src={LOGO_SRC} width="38" height="38" alt="" aria-hidden="true" decoding="async" />
      <span className="slp-brand-name">SmartPark</span>
    </span>
  );
}

function useLiveOverview() {
  const [overview, setOverview] = useState(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/parking/overview', { signal: controller.signal, credentials: 'same-origin' })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => { if (data?.overview) setOverview(data.overview); })
      .catch(() => {}); // The landing page never depends on the API being up.
    return () => controller.abort();
  }, []);
  return overview;
}

function useInView(options) {
  const ref = useRef(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const node = ref.current;
    if (!node) return undefined;
    if (!('IntersectionObserver' in window)) { setInView(true); return undefined; }
    const observer = new IntersectionObserver(([entry]) => { if (entry.isIntersecting) { setInView(true); observer.disconnect(); } }, options);
    observer.observe(node);
    return () => observer.disconnect();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return [ref, inView];
}

function HeroVideo() {
  const wide = useMedia('(min-width: 960px)');
  const backdropRef = useRef(null);
  const frameRef = useRef(null);
  const heroRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [userPaused, setUserPaused] = useState(() => prefersReducedMotion());
  const [failed, setFailed] = useState(false);

  const videos = () => [backdropRef.current, frameRef.current].filter(Boolean);

  // Play while the hero is on screen and the visitor hasn't paused; pause otherwise to save battery.
  useEffect(() => {
    const hero = heroRef.current;
    if (!hero) return undefined;
    let visible = true;
    const sync = () => {
      const shouldPlay = visible && !userPaused && document.visibilityState === 'visible';
      videos().forEach((video) => {
        if (shouldPlay) video.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
        else video.pause();
      });
      if (!shouldPlay) setPlaying(false);
    };
    const observer = 'IntersectionObserver' in window
      ? new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; sync(); }, { threshold: 0.15 })
      : null;
    observer?.observe(hero);
    document.addEventListener('visibilitychange', sync);
    sync();
    return () => { observer?.disconnect(); document.removeEventListener('visibilitychange', sync); };
  }, [userPaused, wide]); // eslint-disable-line react-hooks/exhaustive-deps

  const common = { muted: true, loop: true, playsInline: true, poster: POSTER_SRC, preload: 'auto', 'aria-hidden': true, tabIndex: -1, onError: () => setFailed(true) };

  return (
    <div ref={heroRef} className="slp-hero-media" data-failed={failed || undefined}>
      <div className="slp-hero-backdrop">
        {!failed && <video ref={backdropRef} className="slp-hero-video" src={VIDEO_SRC} {...common} />}
        {failed && <img className="slp-hero-video" src={POSTER_SRC} alt="" aria-hidden="true" />}
      </div>
      {wide && (
        <figure className="slp-hero-frame">
          {!failed ? <video ref={frameRef} className="slp-hero-frame-video" src={VIDEO_SRC} {...common} /> : <img className="slp-hero-frame-video" src={POSTER_SRC} alt="" aria-hidden="true" />}        </figure>
      )}
      {!failed && (
        <button type="button" className="slp-video-toggle" onClick={() => setUserPaused((paused) => !paused)} aria-pressed={!playing} aria-label={playing ? 'Pause background video' : 'Play background video'}>
          {playing ? <Pause size={15} aria-hidden="true" /> : <Play size={15} aria-hidden="true" />}
        </button>
      )}
    </div>
  );
}

function SlotBoard({ overview }) {
  // An illustrative ink-style deck that cycles through space states; the numbers beside it are live.
  const cells = Array.from({ length: 24 }, (_, index) => index);
  return (
    <div className="slp-board" aria-hidden="true">
      {cells.map((index) => <span key={index} className="slp-board-cell" style={{ '--slp-i': index }} />)}
      {overview && overview.activeLots > 0 && (
        <span className="slp-board-live"><i />{`${overview.availableNow} of ${overview.openSpaces} spaces free across ${overview.activeLots} facilities right now`}</span>
      )}
    </div>
  );
}

function Journey() {
  const [ref, inView] = useInView({ threshold: 0.35 });
  return (
    <ol ref={ref} className={`slp-road ${inView ? 'is-driving' : ''}`}>
      <span className="slp-road-car" aria-hidden="true" />
      {STEPS.map((step, index) => (
        <li key={step.title} className="slp-road-stop" style={{ '--slp-step': index }}>
          <span className="slp-road-marker" aria-hidden="true">{index + 1}</span>
          <h3>{step.title}</h3>
          <p>{step.text}</p>
        </li>
      ))}
    </ol>
  );
}

export default function LandingPage({ onLogin, onGetStarted }) {
  const [solidNav, setSolidNav] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const overview = useLiveOverview();
  const menuButtonRef = useRef(null);

  // Page metadata and the display face are owned by this page and restored on leave.
  useEffect(() => {
    const previousTitle = document.title;
    document.title = PAGE_TITLE;
    let link = document.querySelector(`link[href="${FONT_HREF}"]`);
    if (!link) {
      link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = FONT_HREF;
      document.head.appendChild(link);
    }
    return () => { document.title = previousTitle; };
  }, []);

  useEffect(() => {
    const onScroll = () => setSolidNav(window.scrollY > 24);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    if (!menuOpen) return undefined;
    const onKey = (event) => { if (event.key === 'Escape') { setMenuOpen(false); menuButtonRef.current?.focus(); } };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [menuOpen]);

  const closeMenu = () => setMenuOpen(false);
  const year = new Date().getFullYear();

  return (
    <div className="slp">
      <a className="slp-skip" href="#slp-about" onClick={(event) => { event.preventDefault(); scrollToSection('slp-about'); }}>Skip to content</a>

      <header className={`slp-nav ${solidNav || menuOpen ? 'is-solid' : ''}`}>
        <div className="slp-nav-inner">
          <SectionLink id="slp-home" className="slp-nav-brand" onNavigate={closeMenu}><Brand /><span className="slp-sr">SmartPark home</span></SectionLink>
          <nav className="slp-nav-links" aria-label="Page sections">
            {SECTIONS.map((section) => <SectionLink key={section.id} id={section.id} className="slp-nav-link">{section.label}</SectionLink>)}
          </nav>
          <div className="slp-nav-actions">
            <button type="button" className="slp-btn slp-btn--quiet" onClick={onLogin}>Login</button>
            <button type="button" className="slp-btn slp-btn--accent" onClick={onGetStarted}>Get started</button>
          </div>
          <button ref={menuButtonRef} type="button" className="slp-menu-button" aria-expanded={menuOpen} aria-controls="slp-mobile-menu" aria-label={menuOpen ? 'Close menu' : 'Open menu'} onClick={() => setMenuOpen((open) => !open)}>
            {menuOpen ? <X size={20} aria-hidden="true" /> : <Menu size={20} aria-hidden="true" />}
          </button>
        </div>
        <div id="slp-mobile-menu" className="slp-mobile-menu" hidden={!menuOpen}>
          <nav aria-label="Page sections">
            {SECTIONS.map((section) => <SectionLink key={section.id} id={section.id} className="slp-mobile-link" onNavigate={closeMenu}>{section.label}</SectionLink>)}
          </nav>
          <div className="slp-mobile-actions">
            <button type="button" className="slp-btn slp-btn--quiet" onClick={() => { closeMenu(); onLogin(); }}>Login</button>
            <button type="button" className="slp-btn slp-btn--accent" onClick={() => { closeMenu(); onGetStarted(); }}>Get started</button>
          </div>
        </div>
      </header>

      <main>
        <section id="slp-home" className="slp-hero" tabIndex={-1} aria-labelledby="slp-hero-title">
          <HeroVideo />
          <div className="slp-hero-copy">
            <h1 id="slp-hero-title" className="slp-hero-title">
              <span className="slp-hero-line" style={{ '--slp-line': 0 }}>Park smarter.</span>
              <span className="slp-hero-line" style={{ '--slp-line': 1 }}>Live better.</span>
            </h1>
            <p className="slp-hero-lede">The future of intelligent parking. SmartPark shows you which spaces are free right now, holds one for you, and gets you through the gate with a QR ticket.</p>
            <div className="slp-hero-actions">
              <button type="button" className="slp-btn slp-btn--accent slp-btn--lg" onClick={onGetStarted}>Get started <ArrowRight size={18} aria-hidden="true" /></button>
              <button type="button" className="slp-btn slp-btn--outline slp-btn--lg" onClick={onLogin}>Login</button>
              <SectionLink id="slp-about" className="slp-text-link">Explore SmartPark <ArrowUpRight size={16} aria-hidden="true" /></SectionLink>
            </div>
            {overview && overview.activeLots > 0 && (
              <p className="slp-hero-live"><i aria-hidden="true" />{overview.activeLots === 1 ? `Live now: ${overview.availableNow} free spaces at 1 facility` : `Live now: ${overview.availableNow} free spaces across ${overview.activeLots} facilities`}</p>
            )}
          </div>
        </section>

        <section id="slp-about" className="slp-section slp-about" tabIndex={-1} aria-labelledby="slp-about-title">
          <div className="slp-wrap slp-about-grid">
            <h2 id="slp-about-title" className="slp-display">Parking shouldn’t be a guessing game.</h2>
            <div className="slp-prose">
              <p>Drivers circle blocks looking for a space that may not exist. Owners sit on spaces that stay empty for hours. Operators count cars by hand and learn about a full facility from the queue at the gate.</p>
              <p>SmartPark connects all three. It reads each space’s real state from sensors, cameras and reservations, publishes it the moment it changes, and lets a driver turn that into a confirmed space before setting off.</p>
              <p>The result is less time circling, fewer surprises at the entrance, and facilities that are used the way they were meant to be.</p>
            </div>
          </div>
        </section>

        <section id="slp-features" className="slp-section slp-features" tabIndex={-1} aria-labelledby="slp-features-title">
          <div className="slp-wrap">
            <div className="slp-lead">
              <div className="slp-lead-copy">
                <h2 id="slp-features-title" className="slp-display">Every space, live.</h2>
                <p>Search by city, landmark or your own location and SmartPark ranks facilities by distance, with price, EV charging and how many spaces are open at this moment. Switch to the map to see them colour-coded, get directions, and reserve straight from the pin.</p>
                <ul className="slp-legend">
                  <li><i className="is-free" />Available</li>
                  <li><i className="is-full" />Occupied</li>
                  <li><i className="is-held" />Reserved</li>
                  <li><i className="is-unknown" />Awaiting update</li>
                </ul>
              </div>
              <SlotBoard overview={overview} />
            </div>
            <ul className="slp-specs">
              {FEATURES.map(({ icon: Icon, title, text }) => (
                <li key={title} className="slp-spec">
                  <Icon size={20} strokeWidth={1.75} aria-hidden="true" />
                  <div><h3>{title}</h3><p>{text}</p></div>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section id="slp-how" className="slp-section slp-how" tabIndex={-1} aria-labelledby="slp-how-title">
          <div className="slp-wrap">
            <h2 id="slp-how-title" className="slp-display">From search to space in four moves.</h2>
            <Journey />
          </div>
        </section>

        <section className="slp-section slp-tech" aria-labelledby="slp-tech-title">
          <div className="slp-tech-art" aria-hidden="true"><img src="/assets/landing/drift-front.jpg" alt="" loading="lazy" decoding="async" width="720" height="1280" /></div>
          <div className="slp-wrap slp-tech-grid">
            <h2 id="slp-tech-title" className="slp-display">The engine under the hood.</h2>
            <dl className="slp-stack">
              {STACK.map(([term, detail]) => <div key={term}><dt>{term}</dt><dd>{detail}</dd></div>)}
            </dl>
          </div>
        </section>

        <section className="slp-section slp-benefits" aria-labelledby="slp-benefits-title">
          <div className="slp-wrap">
            <h2 id="slp-benefits-title" className="slp-display">Built for everyone in the car park.</h2>
            <div className="slp-audiences">
              {AUDIENCES.map((audience) => (
                <div key={audience.title} className="slp-audience">
                  <h3>{audience.title}</h3>
                  <ul>{audience.points.map((point) => <li key={point}>{point}</li>)}</ul>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="slp-cta" aria-labelledby="slp-cta-title">
          <div className="slp-cta-lines" aria-hidden="true" />
          <div className="slp-wrap slp-cta-inner">
            <h2 id="slp-cta-title" className="slp-display slp-cta-title">Your smarter parking experience starts here.</h2>
            <p>Create a free account in a minute, or sign in to pick up where you left off.</p>
            <div className="slp-hero-actions slp-cta-actions">
              <button type="button" className="slp-btn slp-btn--accent slp-btn--lg" onClick={onGetStarted}>Get started <ArrowRight size={18} aria-hidden="true" /></button>
              <button type="button" className="slp-btn slp-btn--outline slp-btn--lg" onClick={onLogin}>Login</button>
            </div>
          </div>
        </section>
      </main>

      <footer id="slp-contact" className="slp-footer" tabIndex={-1} aria-labelledby="slp-contact-title">
        <div className="slp-wrap slp-footer-grid">
          <div className="slp-footer-brand">
            <Brand />
            <p className="slp-footer-tagline">Your drive. Our intelligence.</p>
            <p>Parking discovery, reservations, live occupancy and facility operations in one platform.</p>
          </div>
          <nav className="slp-footer-nav" aria-label="Footer">
            <h2 className="slp-footer-heading">Explore</h2>
            {SECTIONS.slice(0, 4).map((section) => <SectionLink key={section.id} id={section.id}>{section.label}</SectionLink>)}
          </nav>
          <div className="slp-footer-nav">
            <h2 className="slp-footer-heading">Account</h2>
            <button type="button" onClick={onLogin}>Login</button>
            <button type="button" onClick={onGetStarted}>Get started</button>
          </div>
          <div className="slp-footer-contact">
            <h2 id="slp-contact-title" className="slp-footer-heading">Contact</h2>
            <p>Already have an account? Sign in and open Help &amp; support to message the SmartPark team.</p>
            <p className="slp-footer-note">Your request and every reply stay in your account.</p>
            <button type="button" className="slp-text-link" onClick={onLogin}>Sign in for support <ArrowUpRight size={16} aria-hidden="true" /></button>
          </div>
        </div>
        <div className="slp-wrap slp-footer-base">
          <span>{`© ${year} SmartPark Mobility OS`}</span>
          <span>Availability reflects recorded sensor state and active reservations.</span>
        </div>
      </footer>
    </div>
  );
}
