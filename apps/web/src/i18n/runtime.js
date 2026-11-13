/**
 * SmartPark interface translation runtime.
 *
 * Translates every piece of interface text the app renders — page copy, buttons,
 * labels, placeholders, tooltips, ARIA labels, status text and messages returned
 * by the API — into the selected language, without changing component code.
 *
 * How it works
 *  - Dictionaries (src/locales/<lang>.json) map English interface strings to the
 *    target language. Strings with runtime values use {0}, {1}… placeholders.
 *  - A MutationObserver translates text nodes and UI attributes as React renders
 *    or updates them (before paint, so there is no English flash).
 *  - Only known interface strings are replaced. User and business data (names,
 *    addresses, booking codes, emails, amounts) never match and stay untouched.
 *  - Each node remembers its English original, so switching language — including
 *    back to English — is instant and lossless.
 *  - Dates formatted with the browser default locale follow the selected language.
 */

const LOCALE_TAGS = { en: 'en-IN', hi: 'hi-IN', kn: 'kn-IN', te: 'te-IN', es: 'es-ES', fr: 'fr-FR', ja: 'ja-JP' };
const loaders = {
  hi: () => import('../locales/hi.json'),
  kn: () => import('../locales/kn.json'),
  te: () => import('../locales/te.json'),
  es: () => import('../locales/es.json'),
  fr: () => import('../locales/fr.json'),
  ja: () => import('../locales/ja.json')
};
const ATTRS = ['placeholder', 'title', 'aria-label', 'alt', 'aria-description', 'aria-valuetext'];
// Text inside these is never touched. Textareas keep the user's typed text, but their
// placeholder/title attributes are still translated (see ATTR_SKIP_SELECTOR).
const SKIP_SELECTOR = 'script, style, noscript, textarea, code, pre, [contenteditable="true"], [translate="no"], .sp-no-translate, .notranslate';
const ATTR_SKIP_SELECTOR = 'script, style, noscript, code, pre, [contenteditable="true"], [translate="no"], .sp-no-translate, .notranslate';

let current = 'en';
let exact = new Map();
let patterns = [];
let observer = null;
const textOriginals = new WeakMap();   // Text -> { en, shown }
const attrOriginals = new WeakMap();   // Element -> Map(attr -> { en, shown })
const cache = new Map();               // lang -> { exact, patterns }

// ---------------------------------------------------------------- matching ---
const LEAD = /^[\s·•–—\-:]+/;
const TRAIL = /[\s:.…?!*]+$/;
const keyOf = (s) => s.replace(/\s+/g, ' ').trim().toLowerCase();

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function compile(dict) {
  const ex = new Map();
  const pats = [];
  for (const [en, tr] of Object.entries(dict)) {
    if (!tr) continue;
    const core = en.replace(LEAD, '').replace(TRAIL, '');
    if (/\{\d+\}/.test(core)) {
      const order = [];
      const src = escapeRe(core).replace(/\\\{(\d+)\\\}/g, (_, n) => { order.push(Number(n)); return '(.+?)'; });
      pats.push({ re: new RegExp(`^${src.replace(/\s+/g, '\\s+')}$`, 'i'), order, tr: tr.replace(LEAD, '').replace(TRAIL, ''), len: core.length });
    } else {
      ex.set(keyOf(core), tr.replace(LEAD, '').replace(TRAIL, ''));
    }
  }
  pats.sort((a, b) => b.len - a.len);
  return { exact: ex, patterns: pats };
}

/** Translate one string, or return null when it is not interface text we know. */
export function translateString(text, depth = 0) {
  if (current === 'en' || !text) return null;
  const lead = text.match(LEAD)?.[0] ?? '';
  const rest = text.slice(lead.length);
  const trail = rest.match(TRAIL)?.[0] ?? '';
  const core = rest.slice(0, rest.length - trail.length);
  if (!core || !/[A-Za-z]/.test(core)) return null;
  // Hindi closes sentences with the danda (।); Kannada and Telugu use the full stop.
  const end = current === 'hi' ? trail.replace(/^\.(?!\.)/, '।')
    : current === 'ja' ? trail.replace(/^\.(?!\.)/, '。').replace(/^\?/, '？').replace(/^!/, '！')
    : trail;
  const hit = exact.get(keyOf(core));
  if (hit) return lead + hit + end;
  if (depth > 1) return null;
  for (const p of patterns) {
    const m = core.match(p.re);
    if (!m) continue;
    const values = p.order.map((_, i) => m[i + 1]);
    const out = p.tr.replace(/\{(\d+)\}/g, (_, n) => {
      const v = values[p.order.indexOf(Number(n))] ?? '';
      return translateString(v, depth + 1) ?? v; // translate embedded labels such as statuses
    });
    return lead + out + end;
  }
  return null;
}

// ------------------------------------------------------------------- DOM ---
function skip(node) {
  const el = node.nodeType === 1 ? node : node.parentElement;
  return !el || Boolean(el.closest(SKIP_SELECTOR));
}

function translateTextNode(node) {
  if (skip(node)) return;
  const value = node.nodeValue;
  let rec = textOriginals.get(node);
  if (!rec || value !== rec.shown) { rec = { en: value, shown: value }; textOriginals.set(node, rec); }
  const next = current === 'en' ? rec.en : (translateString(rec.en) ?? rec.en);
  if (next !== value) { rec.shown = next; node.nodeValue = next; } else rec.shown = value;
}

function translateAttrs(el) {
  if (el.closest(ATTR_SKIP_SELECTOR)) return;
  let map = attrOriginals.get(el);
  for (const attr of ATTRS) {
    if (!el.hasAttribute(attr)) continue;
    const value = el.getAttribute(attr);
    if (!map) { map = new Map(); attrOriginals.set(el, map); }
    let rec = map.get(attr);
    if (!rec || value !== rec.shown) { rec = { en: value, shown: value }; map.set(attr, rec); }
    const next = current === 'en' ? rec.en : (translateString(rec.en) ?? rec.en);
    rec.shown = next;
    if (next !== value) el.setAttribute(attr, next);
  }
  if (el.tagName === 'INPUT' && /^(button|submit|reset)$/i.test(el.type) && el.value) {
    const t = current === 'en' ? null : translateString(el.value);
    if (t) el.value = t;
  }
}

function translateTree(root) {
  if (!root) return;
  if (root.nodeType === 3) { translateTextNode(root); return; }
  if (root.nodeType !== 1 && root.nodeType !== 9 && root.nodeType !== 11) return;
  if (root.nodeType === 1) { if (root.closest(ATTR_SKIP_SELECTOR)) return; translateAttrs(root); }
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
    acceptNode: (n) => (n.nodeType === 1 && n.matches(ATTR_SKIP_SELECTOR) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT)
  });
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n.nodeType === 3) { if (n.nodeValue.trim()) translateTextNode(n); } else translateAttrs(n);
  }
}

function onMutations(records) {
  for (const r of records) {
    if (r.type === 'characterData') translateTextNode(r.target);
    else if (r.type === 'attributes') translateAttrs(r.target);
    else r.addedNodes.forEach(translateTree);
  }
}

function startObserver() {
  if (observer || typeof MutationObserver === 'undefined') return;
  observer = new MutationObserver(onMutations);
  observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
}

// --------------------------------------------------- dates & native dialogs ---
let patched = false;
function patchGlobals() {
  if (patched) return;
  patched = true;
  const wrapDate = (name) => {
    const original = Date.prototype[name];
    Date.prototype[name] = function patchedLocale(locales, options) {
      const useDefault = locales === undefined || (Array.isArray(locales) && locales.length === 0);
      return original.call(this, useDefault ? LOCALE_TAGS[current] : locales, options);
    };
  };
  ['toLocaleString', 'toLocaleDateString', 'toLocaleTimeString'].forEach(wrapDate);
  const { alert, confirm, prompt } = window;
  window.alert = (msg) => alert.call(window, translateString(String(msg ?? '')) ?? msg);
  window.confirm = (msg) => confirm.call(window, translateString(String(msg ?? '')) ?? msg);
  window.prompt = (msg, def) => prompt.call(window, translateString(String(msg ?? '')) ?? msg, def);
}

// -------------------------------------------------------------- public API ---
export async function setInterfaceLanguage(lang) {
  const next = LOCALE_TAGS[lang] ? lang : 'en';
  if (next !== 'en' && !cache.has(next)) {
    const mod = await loaders[next]();
    cache.set(next, compile(mod.default ?? mod));
  }
  current = next;
  ({ exact, patterns } = next === 'en' ? { exact: new Map(), patterns: [] } : cache.get(next));
  document.documentElement.lang = next;
  patchGlobals();
  startObserver();
  translateTree(document.body);
  const t = document.querySelector('title');
  if (t) translateTree(t);
  return next;
}

export function currentInterfaceLanguage() { return current; }
export const localeTag = (lang = current) => LOCALE_TAGS[lang] ?? 'en-IN';
