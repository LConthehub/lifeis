import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import axios from 'axios';
import { LIBRARIES, TYPES, piecesWord } from './Media';
import { SORTS, collectionTotals, dollarsField, dollarsText, labelKey, sortTitles } from '../components/collectionTools';
import { buttonClass, cardClass, quietButtonClass, errorMessage } from '../components/ui';

const control = 'min-h-[44px]';
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const COLUMNS = [['creator', 'Creator'], ['year', 'Year'], ['formats', 'Formats'], ['where', 'Where it is'], ['lent', 'Lent to'], ['cost', 'Cost'], ['worth', 'Worth']];
const LABELS = { title: 'Title', ...Object.fromEntries(COLUMNS) };
const NO_PLACE = 'No place yet';

// What printing needs that the screen does not: black on white, headings repeated on every page, a row never cut in two.
// On a phone's screen each row becomes a small block, so nothing scrolls sideways.
const PRINT_RULES = `
.list-sheet table { border-collapse: collapse; width: 100%; }
.list-sheet th, .list-sheet td { overflow-wrap: anywhere; }
@media screen and (max-width: 639px) {
  .list-sheet td:empty { display: none; }
  .list-sheet thead { display: none; }
  .list-sheet table, .list-sheet tbody, .list-sheet tr { display: block; }
  .list-sheet tr { padding: 6px 0; }
  .list-sheet td { display: flex; gap: 8px; padding: 1px 0; text-align: left !important; }
  .list-sheet td::before { content: attr(data-label); min-width: 5.5rem; font-weight: 600; color: #444; }
  .list-sheet td[data-label="Title"] { font-weight: 600; }
  .list-sheet td[data-label="Title"]::before { display: none; }
}
@media print {
  @page { margin: 0.6in; }
  .list-sheet { color: #000 !important; background: #fff !important; box-shadow: none !important; border-radius: 0 !important; font-size: 10pt; padding: 0 !important; }
  .list-sheet thead { display: table-header-group; }
  .list-sheet tr { break-inside: avoid; page-break-inside: avoid; }
  .list-sheet h3 { break-after: avoid; page-break-after: avoid; }
}`;

/** A cell for a spreadsheet: a leading = + - @ would be run as a formula, so it gets an apostrophe; quoted when it needs to be. */
export function csvCell(value) {
  let s = String(value ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export const csvText = (rows) => `﻿${rows.map((r) => r.map(csvCell).join(',')).join('\r\n')}\r\n`;

const formatsText = (m) => m.formats.map((f) => {
  const n = m.pieces?.[f];
  return n >= 2 ? `${f} (${n} ${piecesWord(f).many})` : f;
}).join('; ');
const pad = (n) => String(n).padStart(2, '0');
const today = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const dayText = () => new Date().toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' });

/**
 * The collection as a plain list, to print or keep as a spreadsheet: for insurance, for a move, or to take to a store.
 * It shows what the Collection page was showing (the tab, the filters and the sort come in the address). It is made
 * here, on your own Life Is, and goes nowhere unless you send it.
 */
export default function CollectionPrint() {
  const [params] = useSearchParams();
  const lib = LIBRARIES[params.get('lib') ?? ''] ?? null;
  const type = lib ? lib.type : (TYPES.some(([id]) => id === params.get('type')) ? params.get('type') : '');
  const show = ['wanted', 'lent'].includes(params.get('show')) ? params.get('show') : '';
  const q = (params.get('q') ?? '').trim();
  const genre = params.get('genre') ?? '';
  const yearOf = (name) => { const v = params.get(name); return v !== null && /^\d{1,4}$/.test(v) ? Number(v) : null; };
  const lo = yearOf('from');
  const hi = yearOf('to');
  const sort = SORTS.some(([id]) => id === params.get('sort')) ? params.get('sort') : 'title';

  const [titles, setTitles] = useState(null);
  const [places, setPlaces] = useState({});       // media id → where its copies are
  const [picked, setPicked] = useState({ creator: true, year: true, formats: true, where: true, lent: true, cost: true, worth: true });
  const [group, setGroup] = useState('none');     // 'none', 'type' or 'place'
  const [total, setTotal] = useState(true);
  const [problem, setProblem] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => { axios.get('/api/media').then(({ data }) => setTitles(data)).catch(() => setTitles(false)); }, []);

  const shown = useMemo(() => {
    if (!titles) return [];
    const mine = lib ? titles.filter((m) => m.type === lib.type && lib.fits(m)) : titles;
    const word = q.toLowerCase();
    const matching = mine.filter((m) => (!type || m.type === type) && (show !== 'wanted' || m.wanted) && (show !== 'lent' || m.lent_to.length > 0)
      && (!genre || m.genres.some((g) => labelKey(g) === labelKey(genre)))
      && (lo === null || (m.year != null && m.year >= lo)) && (hi === null || (m.year != null && m.year <= hi))
      && (!word || [m.title, m.creator, ...m.genres, ...m.formats].some((v) => String(v ?? '').toLowerCase().includes(word))));
    return sortTitles(matching, sort);
  }, [titles, lib, type, show, q, genre, lo, hi, sort]);

  // Where each is kept comes from the title's own copies, fetched a few at a time, and only when the list needs it.
  const needsPlaces = picked.where || group === 'place';
  useEffect(() => {
    if (!needsPlaces) return undefined;
    let wanted = true;
    const missing = shown.filter((m) => places[m.id] === undefined).map((m) => m.id);
    (async () => {
      for (let at = 0; at < missing.length && wanted; at += 6) {
        const got = await Promise.all(missing.slice(at, at + 6).map((id) => axios.get(`/api/media/${id}`).then(({ data }) => [id, [...new Set((data.copies ?? []).map((c) => c.place).filter(Boolean))]]).catch(() => [id, []])));
        if (wanted) setPlaces((was) => ({ ...was, ...Object.fromEntries(got) }));
      }
    })();
    return () => { wanted = false; };
  }, [shown, needsPlaces]); // eslint-disable-line react-hooks/exhaustive-deps

  if (titles === null) return null;
  if (titles === false) return <p className="text-sm text-gray-600 dark:text-life-200">The list couldn't be made just now.</p>;

  const waiting = needsPlaces && shown.some((m) => places[m.id] === undefined);
  const columns = ['title', ...COLUMNS.map(([id]) => id).filter((id) => picked[id])];
  const wherever = (m) => places[m.id] ?? [];
  const text = (m, id) => ({
    title: m.title, creator: m.creator ?? '', year: m.year ?? '', formats: formatsText(m), where: wherever(m).join('; '),
    lent: m.lent_to.join('; '), cost: m.cost_cents != null ? dollarsText(m.cost_cents) : '', worth: m.worth_cents != null ? dollarsText(m.worth_cents) : '',
  })[id];
  const plain = (m, id) => (id === 'cost' ? dollarsField(m.cost_cents) : id === 'worth' ? dollarsField(m.worth_cents) : text(m, id));

  const groups = (() => {
    if (group === 'none') return [{ name: null, rows: shown }];
    const by = new Map();
    for (const m of shown) {
      const name = group === 'type' ? TYPES.find(([id]) => id === m.type)?.[1] ?? 'Other' : (wherever(m)[0] ?? NO_PLACE);
      by.set(name, [...(by.get(name) ?? []), m]);
    }
    const names = [...by.keys()];
    if (group === 'type') names.sort((a, b) => TYPES.findIndex(([, l]) => l === a) - TYPES.findIndex(([, l]) => l === b));
    else names.sort((a, b) => (a === NO_PLACE) - (b === NO_PLACE) || a.localeCompare(b));
    return names.map((name) => ({ name, rows: by.get(name) }));
  })();
  const totals = collectionTotals(shown);

  const describe = [
    lib ? lib.title : type ? TYPES.find(([id]) => id === type)?.[1] : 'Everything', show === 'wanted' && 'Wanted', show === 'lent' && 'Lent out',
    q && `matching “${q}”`, genre && `genre ${genre}`, (lo !== null || hi !== null) && `years ${lo ?? 'any'} to ${hi ?? 'any'}`,
  ].filter(Boolean).join(' · ');

  const save = async () => {
    setProblem(''); setSaving(true);
    try {
      const rows = [columns.map((id) => LABELS[id])];
      for (const g of groups) for (const m of g.rows) rows.push(columns.map((id) => plain(m, id)));
      if (total) {
        rows.push(columns.map((id) => (id === 'title' ? `Total: ${plural(totals.titles, 'title', 'titles')}` : id === 'cost' ? dollarsField(totals.cost_cents) : id === 'worth' ? dollarsField(totals.worth_cents) : '')));
      }
      const bytes = new TextEncoder().encode(csvText(rows));
      const { handOver } = await import('../device/handOver.js');
      await handOver(bytes, `collection-list-${today()}.csv`);
    } catch (err) { setProblem(errorMessage(err, "The spreadsheet couldn't be made just now")); }
    setSaving(false);
  };

  const back = lib ? `/media/${params.get('lib')}` : '/media';
  const cellClass = (id) => (id === 'cost' || id === 'worth' ? 'whitespace-nowrap py-1.5 text-right' : 'py-1.5 pr-2');
  const none = shown.length === 0;

  return (
    <div className="space-y-4">
      <style>{PRINT_RULES}</style>
      <div className="space-y-3 print:hidden">
        <Link to={back} className="inline-flex min-h-[44px] items-center text-sm text-life-600 hover:underline dark:text-life-200">← Collection</Link>
        <h1 className="text-xl font-semibold text-life-800 dark:text-life-50">Print or save a list</h1>
        <p className="text-sm text-gray-600 dark:text-life-100">A plain list of what the Collection page was showing, for insurance, a move, or to take to a store. It is made here on your own Life Is and goes nowhere unless you send it.</p>
        <section className={`${cardClass} space-y-3`} aria-label="What goes in the list">
          <h2 className="font-semibold text-life-800 dark:text-life-50">Choose what goes in it</h2>
          <fieldset className="space-y-0">
            <legend className="text-xs font-medium text-gray-600 dark:text-life-200">Columns</legend>
            <p className="text-xs text-gray-500 dark:text-life-300">The title is always there.</p>
            <ul className="grid grid-cols-2 gap-x-4 sm:grid-cols-4">
              {COLUMNS.map(([id, label]) => (
                <li key={id}><label className={`flex ${control} items-center gap-2 text-sm text-gray-800 dark:text-life-50`}>
                  <input type="checkbox" checked={picked[id]} onChange={(e) => setPicked({ ...picked, [id]: e.target.checked })} className="h-5 w-5 flex-none accent-life-600" /> {label}
                </label></li>
              ))}
            </ul>
          </fieldset>
          <fieldset>
            <legend className="text-xs font-medium text-gray-600 dark:text-life-200">Group by</legend>
            {[['none', 'Nothing: one list'], ['type', 'Type (films, books and so on)'], ['place', 'Where it is kept']].map(([id, label]) => (
              <label key={id} className={`flex ${control} items-center gap-2 text-sm text-gray-800 dark:text-life-50`}>
                <input type="radio" name="group" checked={group === id} onChange={() => setGroup(id)} className="h-5 w-5 flex-none accent-life-600" /> {label}
              </label>
            ))}
          </fieldset>
          <label className={`flex ${control} items-center gap-2 text-sm text-gray-800 dark:text-life-50`}>
            <input type="checkbox" checked={total} onChange={(e) => setTotal(e.target.checked)} className="h-5 w-5 flex-none accent-life-600" /> A total at the bottom
          </label>
          <p className="text-xs text-gray-600 dark:text-life-200" role="status">
            {none ? 'Nothing matches those filters.' : `${plural(shown.length, 'title', 'titles')}: ${describe}.`}{waiting ? ' Looking up where each one is kept…' : ''}
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={none || waiting} onClick={() => window.print()} className={`${buttonClass} ${control}`}>Print or save as PDF</button>
            <button type="button" disabled={none || waiting || saving} onClick={save} className={`${quietButtonClass} ${control}`}>{saving ? 'Making it…' : 'Save as spreadsheet'}</button>
          </div>
          {problem && <p className="text-sm text-red-600" role="alert">{problem}</p>}
        </section>
      </div>

      {/* The sheet itself: black on white whatever the page's colours. */}
      <div className="list-sheet space-y-4 rounded-xl bg-card print:bg-white p-4 text-black sm:p-6" aria-label="The list">
        <header>
          <h2 className="text-lg font-bold">Collection</h2>
          <p className="text-sm text-gray-700" data-filters>{describe} · sorted by: {SORTS.find(([id]) => id === sort)?.[1]}</p>
          <p className="text-sm text-gray-700">Made on {dayText()}</p>
        </header>
        {none && <p className="text-sm text-gray-600">Nothing matches those filters.</p>}
        {groups.map((g) => (
          <section key={g.name ?? 'all'} aria-label={g.name ?? 'The list'} data-group={g.name ?? undefined}>
            {g.name !== null && <h3 className="border-b-2 border-gray-800 pb-0.5 font-semibold">{g.name} <span className="text-xs font-normal text-gray-700">{plural(g.rows.length, 'title', 'titles')}</span></h3>}
            {g.rows.length > 0 && (
              <table className="w-full text-left text-xs sm:text-sm">
                <thead><tr className="text-[11px] text-gray-700">
                  {columns.map((id) => <th key={id} scope="col" className={`py-1 font-medium ${id === 'cost' || id === 'worth' ? 'text-right' : 'pr-2'}`}>{LABELS[id]}</th>)}
                </tr></thead>
                <tbody>
                  {g.rows.map((m) => (
                    <tr key={m.id} className="border-t border-gray-300 align-top" data-row>
                      {columns.map((id) => <td key={id} data-label={LABELS[id]} className={cellClass(id)}>{text(m, id)}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        ))}
        {total && !none && (
          <p className="border-t-2 border-gray-800 pt-1 text-sm font-semibold" data-total>
            Total: {plural(totals.titles, 'title', 'titles')}
            {picked.cost ? ` · cost ${dollarsText(totals.cost_cents)}` : ''}{picked.worth ? ` · worth ${dollarsText(totals.worth_cents)}` : ''}
          </p>
        )}
        {total && !none && picked.worth && <p className="text-xs text-gray-700">A copy is counted at the value you gave it, or at what it cost when no value was given.</p>}
      </div>
    </div>
  );
}
