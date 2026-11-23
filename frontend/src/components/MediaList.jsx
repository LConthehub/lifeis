import { useState } from 'react';
import axios from 'axios';
import { Field, inputClass, buttonClass, errorMessage } from './ui';

const KINDS = [['film', 'Film'], ['show', 'Show'], ['music', 'Music'], ['book', 'Book'], ['game', 'Game'], ['other', 'Something else']];
const NAME = { film: ['film', 'films'], show: ['show', 'shows'], music: ['music', 'music'], book: ['book', 'books'], game: ['game', 'games'], other: ['other', 'other'] };

/**
 * Bring in a list of anything: films, shows, music, books, games. A file saved from the old collection app
 * (or any spreadsheet) with a header row, or lines typed in. It is looked over first, and the look-over says which
 * columns were understood and which are left out, so what will happen is clear before anything is added. Nothing
 * is looked up or sent anywhere, and a title already in the collection isn't added twice.
 */
export default function MediaList({ type = 'film', onDone }) {
  const [text, setText] = useState('');
  const [seen, setSeen] = useState(null);
  const [form, setForm] = useState({ type, otherwise: '', wanted_as_wanted: true });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  const choose = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5_000_000) { setError('That file is too large'); return; }
    setText(await file.text());
    setSeen(null);
  };
  const look = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try { setSeen((await axios.post('/api/media/list/read', { text, any: true, type: form.type })).data); } catch (err) { setError(errorMessage(err, "Couldn't read that")); } finally { setBusy(false); }
  };
  const bring = async () => {
    setError('');
    setBusy(true);
    try {
      setDone((await axios.post('/api/media/list', { text, any: true, type: form.type, otherwise: form.otherwise.trim() || null, wanted_as_wanted: form.wanted_as_wanted })).data);
    } catch (err) { setError(errorMessage(err, "Couldn't bring it in")); } finally { setBusy(false); }
  };
  if (done) {
    const parts = [`${done.added} new ${done.added === 1 ? 'title' : 'titles'}`, done.copies > 0 && `${done.copies} ${done.copies === 1 ? 'copy' : 'copies'} added`, done.wanted > 0 && `${done.wanted} wanted`, done.already > 0 && `${done.already} you already had`].filter(Boolean);
    return (
      <div className="space-y-3">
        <p role="status" className="rounded-lg bg-life-50 px-3 py-2 text-sm text-life-800 dark:bg-life-700 dark:text-life-50">Brought in: {parts.join(', ')}.</p>
        <div className="text-right"><button type="button" onClick={() => onDone(done)} className={`${buttonClass} min-h-[44px]`}>Done</button></div>
      </div>
    );
  }
  const kinds = seen ? Object.entries(seen.types).map(([id, n]) => `${n} ${(NAME[id] ?? [id, id])[n === 1 ? 0 : 1]}`).join(', ') : '';
  return (
    <form onSubmit={look} className="space-y-3">
      <p className="text-sm text-gray-600 dark:text-life-200">
        Choose a list saved as a .csv from your old collection app or a spreadsheet, with a first line naming its columns (Title is needed;
        Type, Director, Artist, Author, Year, Format, Barcode, Price paid, Value, Notes and Wanted are used when they are there),
        or type one title to a line. Nothing is looked up or sent anywhere, and a title you already have isn't added twice.
      </p>
      <Field label="A file (.csv)"><input type="file" accept=".csv,.txt,text/csv,text/plain" onChange={choose} className="block min-h-[44px] w-full text-sm text-gray-700 dark:text-life-100" /></Field>
      <Field label="Or the list itself">
        <textarea rows={5} value={text} onChange={(e) => { setText(e.target.value); setSeen(null); }} placeholder={'Alien by Ridley Scott\nRumours by Fleetwood Mac'} className={inputClass} />
      </Field>
      <div className="space-y-1">
        <span id="list-kind" className="block text-xs font-medium text-gray-600 dark:text-life-200">A line that doesn't say what kind it is, is a</span>
        <select aria-labelledby="list-kind" value={form.type} onChange={(e) => { setForm({ ...form, type: e.target.value }); setSeen(null); }} className={`${inputClass} min-h-[44px]`}>
          {KINDS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
        </select>
      </div>
      {seen && (
        <div className="space-y-3 rounded-lg bg-life-50 p-3 text-sm dark:bg-life-700" data-look-over>
          <p className="font-medium text-life-800 dark:text-life-50">{seen.count} {seen.count === 1 ? 'title' : 'titles'} found ({kinds}){seen.skipped ? `, ${seen.skipped} lines with no title left out` : ''}.</p>
          {seen.columns ? (
            <div className="space-y-2 text-xs text-gray-700 dark:text-life-100">
              <div data-understood>
                <p className="font-medium">Columns understood</p>
                <ul>{seen.columns.understood.map((c) => <li key={c.column}>{c.column} <span aria-hidden="true">→</span><span className="sr-only">is read as</span> {c.as}</li>)}</ul>
              </div>
              <div data-ignored>
                <p className="font-medium">Columns ignored</p>
                {seen.columns.ignored.length === 0 ? <p>None. Every column was used.</p> : <ul>{seen.columns.ignored.map((c) => <li key={c}>{c}</li>)}</ul>}
              </div>
            </div>
          ) : <p className="text-xs text-gray-600 dark:text-life-200">This is a plain list, one title to a line, so there are no columns.</p>}
          <ul className="text-xs text-gray-600 dark:text-life-200">
            {seen.first.map((b, i) => <li key={i} className="truncate">{b.title}{b.creator ? `, ${b.creator}` : ''}{b.format ? ` · ${b.format}` : ''}{b.wanted ? ' · wanted' : ''}</li>)}
            {seen.count > seen.first.length && <li>and {seen.count - seen.first.length} more</li>}
          </ul>
          <Field label="When a line doesn't say what it's on, it's on">
            <input value={form.otherwise} onChange={(e) => setForm({ ...form, otherwise: e.target.value })} placeholder="Not said" className={`${inputClass} min-h-[44px]`} />
          </Field>
          {seen.wanted > 0 && (
            <label className="flex min-h-[44px] items-start gap-2 text-gray-700 dark:text-life-100">
              <input type="checkbox" checked={form.wanted_as_wanted} onChange={(e) => setForm({ ...form, wanted_as_wanted: e.target.checked })} className="mt-1 h-5 w-5 accent-life-600" />
              <span>The {seen.wanted} marked wanted are ones I want, not ones I have</span>
            </label>
          )}
        </div>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex justify-end gap-2">
        {seen ? <button type="button" disabled={busy} onClick={bring} className={`${buttonClass} min-h-[44px]`}>{busy ? 'Bringing them in…' : `Bring in ${seen.count}`}</button>
          : <button type="submit" disabled={busy || !text.trim()} className={`${buttonClass} min-h-[44px]`}>{busy ? 'Reading…' : 'Look it over'}</button>}
      </div>
    </form>
  );
}
