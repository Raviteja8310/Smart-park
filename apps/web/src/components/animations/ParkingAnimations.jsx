/**
 * Original, lightweight functional animations for SmartPark.
 * Pure SVG + CSS keyframes (see mobility.css, "Functional animations"), transform/opacity
 * only, theme-aware via tokens, and frozen on a meaningful final frame under reduced motion.
 * These are illustrations of a process — they never display live data themselves.
 */

/** A car approaches, turns in and aligns inside a bay; the bay sensor turns green. Loops. */
export function ParkingLoader({ size = 180, label = 'Loading', showLabel = true }) {
  return (
    <div className="sp-anim sp-anim-park" role="status" aria-live="polite">
      <svg width={size} height={size * 0.62} viewBox="0 0 200 124" aria-hidden="true">
        <rect x="1" y="1" width="198" height="122" rx="16" className="pk-ground" />
        <path d="M20 18v52M62 18v52M104 18v52M146 18v52M188 18v52" className="pk-line" />
        <path d="M20 18h168" className="pk-line" />
        <rect x="66" y="22" width="34" height="44" rx="6" className="pk-target" />
        <circle cx="83" cy="14" r="3.2" className="pk-sensor" />
        <rect x="26" y="26" width="30" height="40" rx="9" className="pk-parked" />
        <rect x="152" y="26" width="30" height="40" rx="9" className="pk-parked" />
        <path d="M10 98H190" className="pk-lane" />
        <g className="pk-car">
          <rect x="-15" y="-21" width="30" height="42" rx="10" className="pk-car-body" />
          <rect x="-11" y="-13" width="22" height="9" rx="3" className="pk-car-glass" />
          <rect x="-11" y="-21" width="6" height="2.4" rx="1.2" className="pk-car-head" />
          <rect x="5" y="-21" width="6" height="2.4" rx="1.2" className="pk-car-head" />
        </g>
      </svg>
      {showLabel && <span className="sp-anim-label">{label}</span>}
    </div>
  );
}

/** Vehicle rolls up to an automated gate, the ANPR beam scans, the barrier lifts, it drives through. */
export function GateEntryAnimation({ width = 300 }) {
  return (
    <div className="sp-anim sp-anim-gate" aria-hidden="true">
      <svg width={width} height={width * 0.42} viewBox="0 0 300 126">
        <path d="M0 104H300" className="gt-road" />
        <path d="M0 116H300" className="gt-lane" />
        <rect x="196" y="38" width="26" height="66" rx="5" className="gt-booth" />
        <circle cx="209" cy="50" r="3.4" className="gt-light" />
        <rect x="205" y="12" width="5" height="28" className="gt-post" />
        <rect x="196" y="8" width="24" height="9" rx="3" className="gt-cam" />
        <path d="M198 16L120 84L150 92Z" className="gt-beam" />
        <g className="gt-arm"><rect x="100" y="78" width="102" height="6" rx="3" className="gt-arm-bar" /><path d="M112 78h10v6h-10zM136 78h10v6h-10zM160 78h10v6h-10zM184 78h10v6h-10z" className="gt-arm-stripe" /></g>
        <circle cx="200" cy="81" r="5" className="gt-pivot" />
        <g className="gt-car">
          <path d="M4 92C4 86 9 84 16 83L34 80C41 73 51 70 64 70C76 70 85 73 92 80L101 83C105 84 107 87 107 92V95C107 97 106 98 103 98H7C5 98 4 97 4 95Z" className="gt-car-body" />
          <path d="M38 80C44 75 52 73 63 73C73 73 79 76 84 80Z" className="gt-car-glass" />
          <circle cx="27" cy="98" r="7" className="gt-wheel" /><circle cx="85" cy="98" r="7" className="gt-wheel" />
          <rect x="101" y="86" width="6" height="2.6" rx="1.3" className="gt-car-head" />
        </g>
      </svg>
    </div>
  );
}

/** Reservation / payment confirmed: a ring draws, a car settles into the bay, a check appears. Plays once. */
export function ConfirmationAnimation({ size = 96, kind = 'reservation' }) {
  return (
    <div className={`sp-anim sp-anim-confirm kind-${kind}`} aria-hidden="true">
      <svg width={size} height={size} viewBox="0 0 96 96">
        <circle cx="48" cy="48" r="42" className="cf-halo" />
        <circle cx="48" cy="48" r="38" className="cf-ring" pathLength="1" />
        <g className="cf-bay"><path d="M30 26v44M66 26v44" /></g>
        <g className="cf-car"><rect x="37" y="30" width="22" height="34" rx="8" /><rect x="40" y="36" width="16" height="7" rx="2.5" className="cf-car-glass" /></g>
        <path d="M33 50l10 10 20-22" className="cf-check" pathLength="1" />
      </svg>
    </div>
  );
}

/** EV charging: energy flows along the cable and the battery fills. */
export function EvChargingAnimation({ width = 220, percent = null }) {
  return (
    <div className="sp-anim sp-anim-ev" aria-hidden="true">
      <svg width={width} height={width * 0.45} viewBox="0 0 220 100">
        <rect x="8" y="14" width="34" height="76" rx="9" className="ev-pillar" />
        <rect x="15" y="22" width="20" height="26" rx="4" className="ev-screen" />
        <path d="M27 26l-6 10h5l-3 9 8-12h-5z" className="ev-bolt" />
        <path d="M42 60C70 60 70 82 98 82" className="ev-cable" />
        <path d="M42 60C70 60 70 82 98 82" className="ev-flow" />
        <rect x="98" y="58" width="104" height="34" rx="10" className="ev-batt" />
        <rect x="202" y="68" width="6" height="14" rx="2" className="ev-batt" />
        <rect x="103" y="63" width="94" height="24" rx="6" className="ev-fill" style={percent != null ? { transform: `scaleX(${Math.max(0.04, Math.min(1, percent / 100))})`, animation: 'none' } : undefined} />
      </svg>
    </div>
  );
}

/** Small live indicator for a bay's state; animates when the state changes. */
export function BayStateDot({ state = 'unknown', label }) {
  return <span className={`sp-bay-dot ${state}`} key={state}><i aria-hidden="true" />{label}</span>;
}
