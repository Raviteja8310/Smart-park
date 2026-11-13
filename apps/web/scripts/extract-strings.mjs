/**
 * Extracts every user-facing English string from the web app (and the API's
 * user-visible error messages) into apps/web/src/locales/source-strings.json.
 *
 *   node apps/web/scripts/extract-strings.mjs
 *
 * Template literals and string concatenations become patterns with {0}, {1}…
 * placeholders so runtime text such as "Showing 5 recent bookings" can be matched.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from '@babel/parser';
import traverseModule from '@babel/traverse';

const traverse = traverseModule.default ?? traverseModule;
const here = path.dirname(fileURLToPath(import.meta.url));
const webSrc = path.resolve(here, '../src');
const apiSrc = path.resolve(here, '../../../services/api/src');
const out = path.join(webSrc, 'locales', 'source-strings.json');

const UI_ATTRS = new Set(['placeholder', 'title', 'aria-label', 'alt', 'label', 'aria-description', 'aria-valuetext', 'hint', 'note', 'description', 'kicker', 'heading', 'emptyText', 'message', 'caption', 'short', 'ariaLabel']);
const SKIP_ATTRS = new Set(['className', 'class', 'id', 'key', 'type', 'name', 'href', 'src', 'role', 'value', 'htmlFor', 'autoComplete', 'inputMode', 'pattern', 'accept', 'method', 'rel', 'target', 'referrerPolicy', 'loading', 'decoding', 'variant', 'tone', 'kind', 'mode', 'state', 'scene', 'intensity', 'tint', 'layoutId', 'd', 'fill', 'stroke', 'viewBox', 'transform', 'points', 'stopColor', 'strokeLinecap', 'strokeLinejoin', 'preserveAspectRatio', 'aria-hidden', 'aria-current', 'aria-haspopup', 'aria-controls', 'aria-activedescendant', 'aria-keyshortcuts', 'data-label', 'lang', 'dir', 'step', 'min', 'max', 'size', 'colSpan', 'rowSpan', 'scope', 'capture', 'allow', 'sandbox']);

const strings = new Map(); // text -> Set(files)

const looksLikeUiText = (s) => {
  const t = s.replace(/\s+/g, ' ').trim();
  if (t.length < 2 || !/[A-Za-z]/.test(t)) return false;
  if (/^(https?:|\/|\.\/|#|data:|mailto:|tel:)/.test(t)) return false;
  if (/^[a-z0-9_.:\-\/[\]()=]+$/.test(t)) return false;              // identifiers, keys, css, routes
  if (/^[A-Z0-9_]+$/.test(t) && t.includes('_')) return false;      // ERROR_CODES
  if (/^[a-z]+(-[a-z0-9]+)+( [a-z0-9-]+)*$/.test(t)) return false;  // class lists
  if (/^(sp|lucide|auth|gt|pk|cf|ev|mi)-/.test(t)) return false;
  if (/^[\w.+-]+@[\w-]+\.[\w.]+$/.test(t)) return false;             // emails
  if (/[{};]/.test(t) && /:/.test(t) && !/ /.test(t)) return false;
  if (/^(GET|POST|PUT|PATCH|DELETE|OPTIONS)$/.test(t)) return false;
  if (/^(INR|USD|UTC|ISO|QR|ANPR|EV|API|OK|ID|PDF|CSV|JSON|SMS|OTP|KYC|GST|UPI|IFSC|PAN)$/.test(t)) return false;
  if (/^\d/.test(t) && !/[a-z]{3}/i.test(t)) return false;
  if (/^(en-IN|en-US|Asia\/Kolkata)$/.test(t)) return false;
  if (/\b(SELECT|INSERT INTO|UPDATE \w+ SET|DELETE FROM|WHERE|GROUP BY|ORDER BY|JOIN|VALUES ?\(|LIMIT \?|COALESCE|UTC_TIMESTAMP)\b/.test(t)) return false;
  if (/^[a-z]+[A-Z]\w*$/.test(t)) return false; // camelCase keys
  if (/^\[[\w-]+(=["'][^"']*["'])?\]$/.test(t)) return false; // attribute selectors
  if (/^\{\d+\}$/.test(t.trim())) return false;
  return true;
};

function add(text, file) {
  const t = text.replace(/\s+/g, ' ').trim();
  if (/[<>]|=;|\bAND\b|\bIS NOT NULL\b|^\{\d+\}[.=T]|\{\d+\} L\{/.test(t)) return;
  if (!/[A-Za-z]{3}/.test(t.replace(/\{\d+\}/g, ''))) return;
  if (!looksLikeUiText(t.replace(/\{\d+\}/g, ''))) return;
  if (!strings.has(t)) strings.set(t, new Set());
  strings.get(t).add(file);
}

function templateToPattern(node) {
  let s = '';
  node.quasis.forEach((q, i) => { s += q.value.cooked ?? q.value.raw; if (i < node.expressions.length) s += `{${i}}`; });
  return s;
}

function concatToPattern(node) {
  const parts = [];
  let n = 0;
  (function walk(x) {
    if (x.type === 'BinaryExpression' && x.operator === '+') { walk(x.left); walk(x.right); }
    else if (x.type === 'StringLiteral') parts.push(x.value);
    else if (x.type === 'TemplateLiteral') parts.push(templateToPattern(x).replace(/\{\d+\}/g, () => `{${n++}}`));
    else parts.push(`{${n++}}`);
  })(node);
  return parts.join('');
}

function isInNonUiContext(p) {
  const parent = p.parentPath;
  if (!parent) return false;
  if (parent.isImportDeclaration() || parent.isExportAllDeclaration() || parent.isExportNamedDeclaration()) return true;
  if (parent.isObjectProperty() && parent.node.key === p.node) return true;
  if (parent.isMemberExpression() && parent.node.property === p.node) return true;
  if (parent.isBinaryExpression() && ['===', '!==', '==', '!=', 'in', 'instanceof'].includes(parent.node.operator)) return true;
  if (parent.isSwitchCase()) return true;
  if (parent.isCallExpression()) {
    const callee = parent.get('callee');
    const name = callee.isIdentifier() ? callee.node.name : callee.isMemberExpression() && !callee.node.computed ? callee.node.property.name : '';
    if (['fetch', 'apiRequest', 'readJson', 'getJson', 'require', 'import', 'querySelector', 'querySelectorAll', 'getItem', 'setItem', 'removeItem', 'addEventListener', 'removeEventListener', 'includes', 'startsWith', 'endsWith', 'split', 'join', 'replace', 'replaceAll', 'toggle', 'add', 'remove', 'contains', 'matches', 'closest', 'getAttribute', 'setAttribute', 'getPropertyValue', 'setProperty', 'toLocaleString', 'toLocaleDateString', 'toLocaleTimeString', 'NumberFormat', 'DateTimeFormat', 'get', 'has', 'set', 'append', 'enum', 'regex', 'test', 'padStart', 'URL', 'URLSearchParams', 'Error'].includes(name) && name !== 'Error') return true;
  }
  if (parent.isJSXAttribute()) {
    const attr = parent.node.name.name;
    if (SKIP_ATTRS.has(attr) || attr.startsWith('on') || attr.startsWith('data-')) return true;
  }
  // inside className={...} or style={...}
  let a = p.parentPath;
  for (let i = 0; a && i < 6; i += 1, a = a.parentPath) {
    if (a.isJSXAttribute()) { const attr = a.node.name.name; if (SKIP_ATTRS.has(attr) || attr === 'style' || attr.startsWith('on')) return true; break; }
  }
  return false;
}

function scanFile(file, { api = false } = {}) {
  const code = fs.readFileSync(file, 'utf8');
  const rel = path.relative(path.resolve(here, '../../..'), file).replace(/\\/g, '/');
  let ast;
  try { ast = parse(code, { sourceType: 'module', plugins: ['jsx'] }); } catch (e) { console.warn('skip', rel, e.message); return; }
  traverse(ast, {
    JSXText(p) { if (!api) add(p.node.value, rel); },
    StringLiteral(p) {
      if (isInNonUiContext(p)) return;
      const parent = p.parentPath;
      if (parent.isBinaryExpression({ operator: '+' })) return; // handled as concat
      if (api) {
        // API: only user-visible messages: fail(res, status, CODE, 'message') / { message: '...' } / zod messages / new Error('...')
        const ok = (parent.isCallExpression() && /^(fail|Error)$/.test(parent.node.callee.name ?? '')) || (parent.isNewExpression() && parent.node.callee.name === 'Error')
          || (parent.isObjectProperty() && ['message', 'error'].includes(parent.node.key.name ?? parent.node.key.value))
          || (parent.isCallExpression() && parent.node.callee.type === 'MemberExpression' && ['min', 'max', 'email', 'regex', 'refine', 'url', 'length', 'nonempty'].includes(parent.node.callee.property.name));
        if (!ok || !/ /.test(p.node.value)) return;
      }
      add(p.node.value, rel);
    },
    TemplateLiteral(p) {
      if (p.parentPath.isTaggedTemplateExpression() || isInNonUiContext(p)) return;
      if (p.parentPath.isBinaryExpression({ operator: '+' })) return;
      const pattern = templateToPattern(p.node);
      if (api && !/ /.test(pattern)) return;
      add(pattern, rel);
    },
    BinaryExpression(p) {
      if (p.node.operator !== '+' || p.parentPath.isBinaryExpression({ operator: '+' })) return;
      const hasString = JSON.stringify(p.node).includes('"StringLiteral"') || JSON.stringify(p.node).includes('"TemplateLiteral"');
      if (!hasString || isInNonUiContext(p)) return;
      add(concatToPattern(p.node), rel);
    }
  });
}

const walk = (dir, exts) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => d.isDirectory() ? (d.name === 'locales' || d.name === 'node_modules' ? [] : walk(path.join(dir, d.name), exts)) : exts.some((e) => d.name.endsWith(e)) ? [path.join(dir, d.name)] : []);

for (const f of walk(webSrc, ['.jsx', '.js'])) { if (!/i18n|micro\.js|locales/.test(f)) scanFile(f); }
for (const f of walk(apiSrc, ['.js'])) { if (/[\\/](routes|middleware|bookings|payments|parking|finance|engagement|operations)[\\/]/.test(f) && !/scripts|migrat|config|email|sms/.test(f)) scanFile(f, { api: true }); }

const list = [...strings.keys()].sort((a, b) => a.localeCompare(b));
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(list, null, 1));
const words = list.reduce((n, s) => n + s.split(/\s+/).length, 0);
console.log(`${list.length} strings, ${words} words -> ${path.relative(process.cwd(), out)}`);
