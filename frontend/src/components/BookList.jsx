import { useState } from 'react';
import axios from 'axios';
import { Field, inputClass, buttonClass, quietButtonClass, errorMessage } from './ui';

const ON = [['', 'What the list says of each'], ['eBook', 'eBooks'], ['Kindle', 'Kindle'], ['Apple Books', 'Apple Books'], ['Google Play Books', 'Google Play Books'], ['Kobo', 'Kobo'], ['Audiobook', 'Audiobooks'], ['Audible', 'Audible'], ['Paperback', 'Paperbacks'], ['Hardcover', 'Hardcovers']];

/**
 * Bring in a list of books: a file from Goodreads or a spreadsheet, or lines typed in. It is looked over
 * first, so what will happen is said before anything is added. Nothing is looked up or sent anywhere else.
 */
export default function BookList({ format = '', onDone }) {
  const [text, setText] = useState('');
  const [seen, setSeen] = useState(null);
  const [form, setForm] = useState({ format: format === 'eBook' ? 'eBook' : format === 'Audiobook' ? 'Audiobook' : '', to_read_as_wanted: true, log_read: true });
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
    try { setSeen((await axios.post('/api/media/list/read', { text })).data); } catch (err) { setError(errorMessage(err, "Couldn't read that")); } finally { setBusy(false); }
  };
  const bring = async () => {
    setError('');
    setBusy(true);
    try {
      setDone((await axios.post('/api/media/list', { text, format: form.format || null, otherwise: format || 'eBook', to_read_as_wanted: form.to_read_as_wanted, log_read: form.log_read })).data);
    } catch (err) { setError(errorMessage(err, "Couldn't bring it in")); } finally { setBusy(false); }
  };
  if (done) {
    const parts = [`${done.added} new ${done.added === 1 ? 'book' : 'books'}`, done.copies > done.added - done.wanted && `${done.copies} copies added`, done.wanted > 0 && `${done.wanted} wanted`, done.logged > 0 && `${done.logged} read on their day`, done.already > 0 && `${done.already} you already had`].filter(Boolean);
    return (
      <div className="space-y-3">
        <p role="status" className="rounded-lg bg-life-50 px-3 py-2 text-sm text-life-800 dark:bg-life-700 dark:text-life-50">Brought in: {parts.join(', ')}.</p>
        <div className="text-right"><button type="button" onClick={() => onDone(done)} className={buttonClass}>Done</button></div>
      </div>
    );
  }
  return (
    <form onSubmit={look} className="space-y-3">
      <p className="text-sm text-gray-600 dark:text-life-200">
        For the libraries nothing can read for you: Kindle, Apple Books, Google Play Books. Choose a list saved from Goodreads
        (My Books, then Import and export), StoryGraph or a spreadsheet with a Title column, or type one book to a line.
        Nothing is looked up or sent anywhere, and a book you already have isn't added twice.
      </p>
      <Field label="A file (.csv)"><input type="file" accept=".csv,.txt,text/csv,text/plain" onChange={choose} className="block w-full text-sm text-gray-700 dark:text-life-100" /></Field>
      <Field label="Or the list itself">
        <textarea rows={5} value={text} onChange={(e) => { setText(e.target.value); setSeen(null); }} placeholder={'Dune by Frank Herbert\nKindred by Octavia E. Butler'} className={inputClass} />
      </Field>
      {seen && (
        <div className="space-y-3 rounded-lg bg-life-50 p-3 text-sm dark:bg-life-700">
          <p className="font-medium text-life-800 dark:text-life-50">{seen.count} {seen.count === 1 ? 'book' : 'books'} found{seen.skipped ? `, ${seen.skipped} lines with no title left out` : ''}.</p>
          <ul className="text-xs text-gray-600 dark:text-life-200">
            {seen.first.map((b, i) => <li key={i} className="truncate">{b.title}{b.creator ? `, ${b.creator}` : ''}{b.format ? ` · ${b.format}` : ''}</li>)}
            {seen.count > seen.first.length && <li>and {seen.count - seen.first.length} more</li>}
          </ul>
          <Field label="They are on">
            <select value={form.format} onChange={(e) => setForm({ ...form, format: e.target.value })} className={inputClass}>
              {ON.filter(([value]) => value || seen.says_format > 0).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </Field>
          {seen.to_read > 0 && (
            <label className="flex items-start gap-2 text-gray-700 dark:text-life-100">
              <input type="checkbox" checked={form.to_read_as_wanted} onChange={(e) => setForm({ ...form, to_read_as_wanted: e.target.checked })} className="mt-1 accent-life-600" />
              <span>The {seen.to_read} on the to-read shelf are books I want, not ones I have</span>
            </label>
          )}
          {seen.dated > 0 && (
            <label className="flex items-start gap-2 text-gray-700 dark:text-life-100">
              <input type="checkbox" checked={form.log_read} onChange={(e) => setForm({ ...form, log_read: e.target.checked })} className="mt-1 accent-life-600" />
              <span>Note the day each was read ({seen.dated} have one)</span>
            </label>
          )}
        </div>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex justify-end gap-2">
        {seen ? <button type="button" disabled={busy} onClick={bring} className={buttonClass}>{busy ? 'Bringing them in…' : `Bring in ${seen.count}`}</button>
          : <button type="submit" disabled={busy || !text.trim()} className={seen ? quietButtonClass : buttonClass}>{busy ? 'Reading…' : 'Look it over'}</button>}
      </div>
    </form>
  );
}
