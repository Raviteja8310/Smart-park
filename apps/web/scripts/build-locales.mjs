/**
 * Builds the interface dictionaries.
 *
 *   node apps/web/scripts/build-locales.mjs keys    # (re)write locales/keys.tsv from source-strings.json
 *   node apps/web/scripts/build-locales.mjs build   # compile locales/<lang>/*.tsv -> locales/<lang>.json
 *   node apps/web/scripts/build-locales.mjs check   # report missing / placeholder-mismatched translations
 *
 * keys.tsv lines are "<id>\t<English>". Translation files are "<id>\t<translation>" and
 * may be split across several files (part-1.tsv, part-2.tsv …) per language.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/locales');
const LANGS = ['hi', 'kn', 'te', 'es', 'fr', 'ja'];
const LEAD = /^[\s·•–—\-:]+/;
const TRAIL = /[\s:.…?!*]+$/;
const core = (s) => s.replace(/\s+/g, ' ').replace(LEAD, '').replace(TRAIL, '').trim();

function readKeys() {
  return fs.readFileSync(path.join(dir, 'keys.tsv'), 'utf8').split(/\r?\n/).filter(Boolean).map((l) => {
    const i = l.indexOf('\t');
    return [Number(l.slice(0, i)), l.slice(i + 1)];
  });
}

function readTranslations(lang) {
  const out = new Map();
  const d = path.join(dir, lang);
  if (!fs.existsSync(d)) return out;
  for (const f of fs.readdirSync(d).filter((x) => x.endsWith('.tsv')).sort()) {
    for (const line of fs.readFileSync(path.join(d, f), 'utf8').split(/\r?\n/)) {
      const i = line.indexOf('\t');
      if (i < 1) continue;
      const id = Number(line.slice(0, i));
      if (Number.isInteger(id)) out.set(id, line.slice(i + 1).trim());
    }
  }
  return out;
}

const cmd = process.argv[2] ?? 'build';

if (cmd === 'keys') {
  const src = JSON.parse(fs.readFileSync(path.join(dir, 'source-strings.json'), 'utf8'));
  const byKey = new Map();
  for (const s of src) {
    const c = core(s);
    if (!c || !/[A-Za-z]{2}/.test(c.replace(/\{\d+\}/g, ''))) continue;
    const k = c.toLowerCase();
    const prev = byKey.get(k);
    // Prefer a sentence-cased representative over ALL CAPS.
    if (!prev || (prev === prev.toUpperCase() && c !== c.toUpperCase())) byKey.set(k, c);
  }
  // Keep existing ids stable; append new strings at the end.
  const existing = fs.existsSync(path.join(dir, 'keys.tsv')) ? readKeys() : [];
  const seen = new Set(existing.map(([, e]) => e.toLowerCase()));
  let next = existing.reduce((m, [id]) => Math.max(m, id + 1), 0);
  const added = [...byKey.values()].filter((v) => !seen.has(v.toLowerCase())).sort((a, b) => a.length - b.length || a.localeCompare(b));
  const lines = [...existing.map(([id, e]) => `${id}\t${e}`), ...added.map((e) => `${next++}\t${e}`)];
  fs.writeFileSync(path.join(dir, 'keys.tsv'), `${lines.join('\n')}\n`);
  console.log(`keys.tsv: ${lines.length} keys (${added.length} new)`);
}

if (cmd === 'build' || cmd === 'check') {
  const keys = readKeys();
  for (const lang of LANGS) {
    const tr = readTranslations(lang);
    const dict = {};
    const missing = [];
    const bad = [];
    for (const [id, en] of keys) {
      const t = tr.get(id);
      if (!t) { missing.push(id); continue; }
      // A translation may drop a placeholder (e.g. an English plural 's'), but never invent one.
      const enPh = new Set(en.match(/\{\d+\}/g) ?? []);
      if ((t.match(/\{\d+\}/g) ?? []).some((x) => !enPh.has(x))) { bad.push(id); continue; }
      dict[en] = t;
    }
    if (cmd === 'build') fs.writeFileSync(path.join(dir, `${lang}.json`), JSON.stringify(dict));
    console.log(`${lang}: ${Object.keys(dict).length}/${keys.length} translated; missing ${missing.length}${missing.length ? ` (first: ${missing.slice(0, 8).join(', ')})` : ''}; placeholder mismatches ${bad.length}${bad.length ? ` (${bad.slice(0, 8).join(', ')})` : ''}`);
  }
}
