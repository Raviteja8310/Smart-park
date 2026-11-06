import { useEffect, useId, useRef, useState } from 'react';
import { animate, motion, useInView, useReducedMotion } from 'motion/react';

export const springSoft = { type: 'spring', stiffness: 260, damping: 30, mass: 0.9 };
export const easeOutExpo = [0.16, 1, 0.3, 1];

/** Staggered entrance for groups of cards. Use with <motion.div variants={stagger.container}>. */
export const stagger = {
  container: { hidden: {}, show: { transition: { staggerChildren: 0.06, delayChildren: 0.04 } } },
  item: { hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: easeOutExpo } } }
};

/**
 * Counts up to `value` when it changes. Renders the final value immediately under
 * reduced motion, and a dash when the value is unknown (never a fabricated zero).
 */
export function AnimatedNumber({ value, format = (n) => Math.round(n).toLocaleString('en-IN'), duration = 0.9, className = 'sp-num' }) {
  const ref = useRef(null);
  const previous = useRef(0);
  const reduce = useReducedMotion();
  const known = value !== null && value !== undefined && Number.isFinite(Number(value));
  useEffect(() => {
    if (!known || !ref.current) return undefined;
    const target = Number(value);
    if (reduce) { ref.current.textContent = format(target); previous.current = target; return undefined; }
    const controls = animate(previous.current, target, {
      duration, ease: easeOutExpo,
      onUpdate: (latest) => { if (ref.current) ref.current.textContent = format(latest); }
    });
    previous.current = target;
    return () => controls.stop();
  }, [value, known, reduce]); // eslint-disable-line react-hooks/exhaustive-deps
  return <span ref={ref} className={className}>{known ? format(reduce ? Number(value) : previous.current) : '—'}</span>;
}

export function MetricCard({ icon: Icon, label, value, format, suffix, note, tone = 'ion', accent, children }) {
  return (
    <motion.article className={`sp-metric tone-${tone}`} variants={stagger.item}>
      <div className="sp-metric-head">
        <span className="sp-metric-icon" aria-hidden="true">{Icon && <Icon size={16} />}</span>
        <span className="sp-metric-label">{label}</span>
        {accent}
      </div>
      <div className="sp-metric-value"><AnimatedNumber value={value} format={format} />{suffix && value != null && <small>{suffix}</small>}</div>
      {note && <p className="sp-metric-note">{note}</p>}
      {children}
    </motion.article>
  );
}

/** Radial occupancy gauge. `ratio` 0..1 or null when unknown. */
export function RingGauge({ ratio, size = 132, stroke = 10, label = 'Occupancy' }) {
  const reduce = useReducedMotion();
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const known = ratio != null && Number.isFinite(ratio);
  const pct = known ? Math.max(0, Math.min(1, ratio)) : 0;
  const tone = pct >= 0.9 ? 'var(--state-occupied)' : pct >= 0.7 ? 'var(--state-maintenance)' : 'var(--state-available)';
  const gid = useId().replace(/:/g, '');
  return (
    <div className="sp-gauge" style={{ width: size, height: size }} role="img" aria-label={known ? `${label} ${Math.round(pct * 100)} percent` : `${label} unavailable`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor={tone} stopOpacity=".55" /><stop offset="1" stopColor={tone} /></linearGradient>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-border)" strokeWidth={stroke} />
        <motion.circle
          cx={size / 2} cy={size / 2} r={r} fill="none" stroke={`url(#${gid})`} strokeWidth={stroke} strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`} strokeDasharray={circumference}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: circumference * (1 - pct) }}
          transition={reduce ? { duration: 0 } : { duration: 1.2, ease: easeOutExpo }}
        />
      </svg>
      <div className="sp-gauge-center"><strong>{known ? <AnimatedNumber value={pct * 100} /> : '—'}{known && <small>%</small>}</strong><span>{label}</span></div>
    </div>
  );
}

/** Stacked state bar: segments = [{ key, label, value, color }] */
export function StateBar({ segments, total }) {
  const reduce = useReducedMotion();
  const sum = total ?? segments.reduce((acc, s) => acc + (Number(s.value) || 0), 0);
  return (
    <div className="sp-statebar">
      <div className="sp-statebar-track" role="img" aria-label={segments.map((s) => `${s.label} ${s.value ?? 'unknown'}`).join(', ')}>
        {sum > 0 && segments.map((s) => {
          const w = ((Number(s.value) || 0) / sum) * 100;
          return w > 0 ? <motion.span key={s.key} style={{ background: s.color }} initial={{ width: 0 }} animate={{ width: `${w}%` }} transition={reduce ? { duration: 0 } : { duration: 0.9, ease: easeOutExpo }} /> : null;
        })}
      </div>
      <ul className="sp-statebar-legend">
        {segments.map((s) => <li key={s.key}><i style={{ background: s.color }} />{s.label}<strong className="sp-num">{s.value ?? '—'}</strong></li>)}
      </ul>
    </div>
  );
}

/** Lightweight SVG area chart. points = [{ x: label, y: number }] */
export function AreaChart({ points, height = 168, format = (v) => v, ariaLabel = 'Trend chart' }) {
  const reduce = useReducedMotion();
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: '-40px' });
  const [hover, setHover] = useState(null);
  const gid = useId().replace(/:/g, '');
  const width = 640;
  const pad = { t: 12, r: 8, b: 22, l: 8 };
  if (!points?.length) return null;
  const max = Math.max(...points.map((p) => p.y), 1);
  const stepX = points.length > 1 ? (width - pad.l - pad.r) / (points.length - 1) : 0;
  const xy = points.map((p, i) => [pad.l + i * stepX, pad.t + (1 - p.y / max) * (height - pad.t - pad.b)]);
  const line = xy.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  const area = `${line} L${xy[xy.length - 1][0]} ${height - pad.b} L${xy[0][0]} ${height - pad.b} Z`;
  const show = inView || reduce;
  return (
    <div className="sp-areachart" ref={ref}>
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label={ariaLabel} onMouseLeave={() => setHover(null)}>
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="var(--color-primary-text)" stopOpacity=".28" /><stop offset="1" stopColor="var(--color-primary-text)" stopOpacity="0" /></linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map((g) => <line key={g} x1={pad.l} x2={width - pad.r} y1={pad.t + g * (height - pad.t - pad.b)} y2={pad.t + g * (height - pad.t - pad.b)} stroke="var(--color-hairline)" />)}
        <motion.path d={area} fill={`url(#${gid})`} initial={{ opacity: 0 }} animate={{ opacity: show ? 1 : 0 }} transition={{ duration: reduce ? 0 : 0.8, delay: reduce ? 0 : 0.3 }} />
        <motion.path d={line} fill="none" stroke="var(--color-primary-text)" strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round"
          initial={{ pathLength: reduce ? 1 : 0 }} animate={{ pathLength: show ? 1 : 0 }} transition={{ duration: reduce ? 0 : 1.2, ease: easeOutExpo }} />
        {xy.map(([x], i) => <rect key={i} x={x - stepX / 2} y={0} width={Math.max(stepX, 8)} height={height} fill="transparent" onMouseEnter={() => setHover(i)} />)}
        {hover != null && <><line x1={xy[hover][0]} x2={xy[hover][0]} y1={pad.t} y2={height - pad.b} stroke="var(--color-border-strong)" strokeDasharray="3 3" /><circle cx={xy[hover][0]} cy={xy[hover][1]} r="4" fill="var(--color-surface)" stroke="var(--color-primary-text)" strokeWidth="2" vectorEffect="non-scaling-stroke" /></>}
      </svg>
      <div className="sp-areachart-axis"><span>{points[0].x}</span><span>{points[points.length - 1].x}</span></div>
      {hover != null && <div className="sp-areachart-tip" style={{ left: `${(xy[hover][0] / width) * 100}%` }}><strong>{format(points[hover].y)}</strong><span>{points[hover].x}</span></div>}
    </div>
  );
}

export function EmptyState({ icon: Icon, title, children, action }) {
  return (
    <div className="sp-empty">
      {Icon && <span className="sp-empty-icon" aria-hidden="true"><Icon size={20} /></span>}
      <strong>{title}</strong>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

export function Skeleton({ lines = 3 }) {
  return <div className="sp-skeleton" aria-hidden="true">{Array.from({ length: lines }, (_, i) => <span key={i} style={{ width: `${92 - i * 14}%` }} />)}</div>;
}

export function LiveDot({ state = 'live', label }) {
  return <span className={`sp-live-dot ${state}`}><i aria-hidden="true" />{label}</span>;
}
