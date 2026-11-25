import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';

const KINDS = [['', 'Everything'], ['recipe', 'Recipes'], ['thing', 'Things'], ['place', 'Places'], ['title', 'Collection'], ['list', 'Lists'], ['service', 'Home services'], ['project', 'Projects'], ['job', 'Upkeep'], ['license', 'Licenses'], ['pet', 'Pets'], ['plan', 'Plans'], ['event', 'Calendar'], ['routine', 'Routines'], ['tag', 'Tags']];

/**
 * One search across everything in Life Is, the way Sworkr's is: a box in the header, or "/" from anywhere
 * (but not while typing in a field), then a window of answers that each lead to their own page.
 */
export default function Search() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false);
      const el = document.activeElement;
      const typing = el && (['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || el.isContentEditable);
      if (e.key === '/' && !open && !typing && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); setOpen(true); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-label="Search everything in Life Is"
        className="flex items-center gap-2 rounded-full bg-white/20 px-3 py-1.5 text-left text-sm text-white/90 hover:bg-white/30">
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4 shrink-0" aria-hidden="true">
          <circle cx="8.5" cy="8.5" r="5.5" /><path d="M13 13l4 4" strokeLinecap="round" />
        </svg>
        <span className="hidden lg:inline">Search…</span>
        <kbd className="hidden rounded bg-white/20 px-1.5 font-sans text-[11px] text-white lg:inline">/</kbd>
      </button>
      {open && <SearchWindow onClose={() => setOpen(false)} />}
    </>
  );
}

function SearchWindow({ onClose }) {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState('');
  // The answers on screen are kept with the search they belong to, so "Nothing found" only ever shows for a
  // search that has finished.
  const [found, setFound] = useState({ key: '', results: [] });
  const [at, setAt] = useState(0);
  const key = `${kind}:${query.trim()}`;
  const searching = found.key !== key;

  useEffect(() => {
    const q = query.trim();
    if (!q) { setFound({ key: '', results: [] }); return undefined; }
    let stale = false;
    const timer = setTimeout(async () => {
      let next = null;
      try { next = (await axios.get('/api/search', { params: { q, ...(kind ? { kind } : {}) } })).data; } catch { next = null; }
      if (!stale) { setFound((before) => ({ key, results: next ?? before.results })); setAt(0); }
    }, 250);
    return () => { stale = true; clearTimeout(timer); };
  }, [query, kind]); // eslint-disable-line react-hooks/exhaustive-deps

  const go = (r) => { onClose(); navigate(r.link); };
  const keys = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setAt((n) => Math.min(n + 1, found.results.length - 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setAt((n) => Math.max(n - 1, 0)); }
    if (e.key === 'Enter' && found.results[at]) go(found.results[at]);
  };

  return createPortal(
    <div className="safe-sides fixed inset-0 z-50 flex items-start justify-center px-3 pt-16 sm:px-4 sm:pt-24" role="dialog" aria-modal="true" aria-label="Search">
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-2xl overflow-hidden rounded-2xl bg-card shadow-xl dark:bg-life-800">
        <div className="flex items-center gap-3 border-b border-life-100 p-3 dark:border-life-700">
          <input autoFocus type="text" enterKeyHint="search" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={keys} aria-label="Search everything"
            placeholder="A recipe, a thing, a place, a book, a job…" className="flex-1 bg-transparent px-2 py-2 text-gray-800 placeholder-gray-400 outline-none dark:text-life-50" />
          <button type="button" onClick={onClose} aria-label="Close" className="px-2 text-gray-400 hover:text-gray-700">✕</button>
        </div>
        <div className="flex gap-1 overflow-x-auto border-b border-life-100 px-3 py-2 dark:border-life-700" role="group" aria-label="What to search">
          {KINDS.map(([id, label]) => (
            <button key={id} type="button" onClick={() => setKind(id)} aria-pressed={kind === id}
              className={`whitespace-nowrap rounded-md px-2.5 py-1 text-sm ${kind === id ? 'bg-life-600 text-white' : 'text-gray-500 hover:text-gray-800 dark:text-life-200'}`}>{label}</button>
          ))}
        </div>
        <ul className="max-h-[60vh] overflow-y-auto p-2" aria-label="What was found">
          {!query.trim() ? <li className="py-6 text-center text-sm text-gray-400">Type to search everything you keep here</li>
            : searching && found.results.length === 0 ? <li className="py-6 text-center text-sm text-gray-400">Searching…</li>
              : found.results.length === 0 ? <li className="py-6 text-center text-sm text-gray-400">Nothing found</li>
                : found.results.map((r, i) => (
                  <li key={`${r.kind}-${r.id}`}>
                    <button type="button" onClick={() => go(r)} onMouseEnter={() => setAt(i)}
                      className={`flex w-full items-baseline gap-2 rounded-xl px-3 py-2 text-left ${i === at ? 'bg-life-50 dark:bg-life-700' : ''}`}>
                      <span aria-hidden="true">{r.icon}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-gray-800 dark:text-life-50">{r.title}</span>
                        {r.detail && <span className="block truncate text-xs text-gray-500 dark:text-life-300">{r.detail}</span>}
                      </span>
                    </button>
                  </li>
                ))}
        </ul>
      </div>
    </div>,
    document.body,
  );
}
