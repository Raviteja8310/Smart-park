/**
 * Official SmartPark brand logo — the user-supplied animated GIF, used as-is.
 * The GIF is never redrawn, recoloured or converted. Its pure-black canvas is
 * dissolved on dark surfaces with `mix-blend-mode: screen`; on light surfaces it
 * sits in a dark tile so the artwork keeps its original appearance.
 * All instances share one URL, so the browser downloads and caches it once.
 */
export const LOGO_SRC = '/assets/branding/smartpark-logo.gif';
export const BRAND_NAME = 'SMARTPARK';
export const BRAND_TAGLINE = 'YOUR DRIVE. OUR INTELLIGENCE.';

export function LogoMark({ size = 40, className = '', decorative = false }) {
  return (
    <span className={`sp-logo-gif ${className}`} style={{ '--logo-size': `${size}px` }}>
      <img
        src={LOGO_SRC}
        width={size}
        height={Math.round(size * (355 / 357))}
        alt={decorative ? '' : 'SmartPark logo'}
        aria-hidden={decorative || undefined}
        decoding="async"
        draggable="false"
      />
    </span>
  );
}

export function Wordmark({ caption = true }) {
  return (
    <span className="sp-wordmark">
      <span className="sp-wordmark-name">{BRAND_NAME}</span>
      {caption && <span className="sp-wordmark-caption">{BRAND_TAGLINE}</span>}
    </span>
  );
}

/** Horizontal lockup: logo + SMARTPARK + tagline. */
export default function Logo({ size = 40, caption = true }) {
  return <span className="sp-logo"><LogoMark size={size} decorative /><Wordmark caption={caption} /><span className="sp-visually-hidden">SmartPark — {BRAND_TAGLINE}</span></span>;
}

/** Stacked hero lockup for login, registration and loading screens. */
export function BrandHero({ size = 132 }) {
  return (
    <div className="sp-brand-hero">
      <LogoMark size={size} />
      <p className="sp-brand-hero-name">{BRAND_NAME}</p>
      <p className="sp-brand-hero-tagline">{BRAND_TAGLINE}</p>
    </div>
  );
}
