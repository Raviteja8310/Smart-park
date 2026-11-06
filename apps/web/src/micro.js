/**
 * SmartPark micro-interaction behaviours (pairs with micro.css).
 * Delegated listeners only — one set for the whole document, no per-component wiring.
 *  - Search fields: while the user types, the nearby magnifier "scans".
 *  - Buttons: a ripple from the pointer, and an icon press acknowledgement.
 *  - Copy buttons: a short "copied" state.
 * All effects are skipped when the user prefers reduced motion (OS or in-app setting).
 */
const reducedMotion = () =>
  document.documentElement.classList.contains('sp-reduce-motion') ||
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

const SEARCH_HOSTS = '.sp-field-search, .sp-cmdk-input, .search-box, .sp-search-bar, label, form, [role="search"], div';
const RIPPLE_TARGETS = '.sp-button, .sp-btn, .primary-button, .auth-page button[type="submit"]';
const timers = new WeakMap();

function flash(el, className, ms) {
  if (!el) return;
  clearTimeout(timers.get(el));
  el.classList.add(className);
  timers.set(el, setTimeout(() => el.classList.remove(className), ms));
}

function searchHostFor(input) {
  // Walk up to the nearest container that holds a search icon.
  let el = input.parentElement;
  for (let depth = 0; el && depth < 4; depth += 1, el = el.parentElement) {
    if (el.matches?.(SEARCH_HOSTS) && el.querySelector('svg.lucide-search')) return el;
  }
  return null;
}

function onInput(event) {
  const input = event.target;
  if (!(input instanceof HTMLInputElement)) return;
  const isSearch = input.type === 'search' || /search|filter|find|jump/i.test(`${input.placeholder} ${input.getAttribute('aria-label') ?? ''}`);
  if (!isSearch || reducedMotion()) return;
  flash(searchHostFor(input), 'sp-searching', 650);
}

function onPointerDown(event) {
  if (event.button !== 0 || reducedMotion()) return;
  const button = event.target.closest?.(RIPPLE_TARGETS);
  if (!button || button.disabled) return;
  const rect = button.getBoundingClientRect();
  const ripple = document.createElement('span');
  ripple.className = 'sp-ripple';
  ripple.style.left = `${event.clientX - rect.left}px`;
  ripple.style.top = `${event.clientY - rect.top}px`;
  ripple.style.setProperty('--sp-ripple-scale', String(Math.ceil((Math.hypot(rect.width, rect.height) * 2) / 8)));
  button.appendChild(ripple);
  ripple.addEventListener('animationend', () => ripple.remove(), { once: true });
}

function onClick(event) {
  if (reducedMotion()) return;
  const host = event.target.closest?.('button, a, [role="button"], [role="tab"], [role="menuitem"]');
  if (!host || host.disabled) return;
  if (host.querySelector(':scope svg.lucide-copy, :scope [class*="lucide-link"]')) flash(host, 'sp-copied', 1200);
  else if (host.querySelector(':scope > svg.lucide, :scope > span > svg.lucide')) flash(host, 'sp-clicked', 360);
}

if (typeof document !== 'undefined' && !window.__spMicro) {
  window.__spMicro = true;
  document.addEventListener('input', onInput, { passive: true });
  document.addEventListener('pointerdown', onPointerDown, { passive: true });
  document.addEventListener('click', onClick, { passive: true });
}
