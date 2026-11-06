import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { ArrowRight, CornerDownLeft, Search } from 'lucide-react';
import { easeOutExpo } from '../ui/primitives.jsx';

/**
 * Global ⌘K / Ctrl+K palette. Searches navigation destinations, quick actions and
 * the user's recent bookings (already loaded by the shell — no extra requests).
 */
export default function CommandPalette({ open, onClose, sections }) {
  const reduce = useReducedMotion();
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  const flat = useMemo(() => {
    const q = query.trim().toLowerCase();
    const out = [];
    sections.forEach((section) => {
      const items = section.items.filter((item) => !q || `${item.label} ${item.hint ?? ''} ${item.keywords ?? ''}`.toLowerCase().includes(q));
      if (items.length) out.push({ section: section.title, items });
    });
    return out;
  }, [sections, query]);
  const all = flat.flatMap((g) => g.items);

  useEffect(() => { if (open) { setQuery(''); setCursor(0); window.setTimeout(() => inputRef.current?.focus(), 30); } }, [open]);
  useEffect(() => { setCursor(0); }, [query]);
  useEffect(() => { listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }); }, [cursor]);

  function onKeyDown(event) {
    if (event.key === 'ArrowDown') { event.preventDefault(); setCursor((c) => Math.min(all.length - 1, c + 1)); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); setCursor((c) => Math.max(0, c - 1)); }
    else if (event.key === 'Enter' && all[cursor]) { event.preventDefault(); all[cursor].run(); onClose(); }
    else if (event.key === 'Escape') { event.preventDefault(); onClose(); }
  }

  let index = -1;
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="sp-cmdk-layer" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reduce ? 0 : 0.18 }} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
          <motion.div
            className="sp-cmdk" role="dialog" aria-modal="true" aria-label="Search SmartPark"
            initial={reduce ? false : { opacity: 0, y: -8, scale: 0.985 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={reduce ? { opacity: 0 } : { opacity: 0, y: -6, scale: 0.99 }}
            transition={{ duration: 0.28, ease: easeOutExpo }}
          >
            <div className="sp-cmdk-input">
              <Search size={18} aria-hidden="true" />
              <input
                ref={inputRef} value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={onKeyDown}
                placeholder="Search pages, actions and bookings…" aria-label="Search" role="combobox" aria-expanded="true"
                aria-controls="sp-cmdk-list" aria-activedescendant={all[cursor] ? `sp-cmdk-${cursor}` : undefined} autoComplete="off" spellCheck="false"
              />
              <kbd>Esc</kbd>
            </div>
            <div className="sp-cmdk-list" id="sp-cmdk-list" role="listbox" ref={listRef}>
              {flat.length === 0 && <p className="sp-cmdk-empty">No results for “{query}”.</p>}
              {flat.map((group) => (
                <div key={group.section} role="group" aria-label={group.section}>
                  <p className="sp-cmdk-section">{group.section}</p>
                  {group.items.map((item) => {
                    index += 1;
                    const i = index;
                    const Icon = item.icon;
                    return (
                      <button
                        type="button" key={`${group.section}-${item.label}`} id={`sp-cmdk-${i}`} role="option" aria-selected={cursor === i}
                        className={`sp-cmdk-item ${cursor === i ? 'active' : ''}`} onMouseMove={() => setCursor(i)} onClick={() => { item.run(); onClose(); }}
                      >
                        <span className="sp-cmdk-icon">{Icon ? <Icon size={16} /> : <ArrowRight size={16} />}</span>
                        <span className="sp-cmdk-copy"><strong>{item.label}</strong>{item.hint && <small>{item.hint}</small>}</span>
                        {cursor === i && <CornerDownLeft size={14} className="sp-cmdk-enter" aria-hidden="true" />}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
            <div className="sp-cmdk-foot"><span><kbd>↑</kbd><kbd>↓</kbd> navigate</span><span><kbd>↵</kbd> open</span><span><kbd>Ctrl</kbd><kbd>K</kbd> toggle</span></div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
