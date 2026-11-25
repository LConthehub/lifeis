import { useRef, useState } from 'react';
import axios from 'axios';
import { Link } from 'react-router-dom';
import { buttonClass, quietButtonClass, cardClass, errorMessage } from './ui';
import { zipEntries } from './unpackRecipes';

const control = 'min-h-[44px]';
const MAX_ZIP = 50 * 1024 * 1024;
const MAX_TEXT = 5 * 1024 * 1024;
const isZip = (b) => b[0] === 0x50 && b[1] === 0x4b;
const text = (bytes) => new TextDecoder('utf-8').decode(bytes).replace(/^﻿/, '');

/** Opens the files here, in the page: a zip from Letterboxd, or its CSV files one by one. Returns { "path": "text" }. */
export async function readLetterboxdFiles(fileList) {
  const files = {};
  let size = 0;
  const add = (name, body) => {
    size += body.length;
    if (size > MAX_TEXT) throw new Error('Those files hold more than 5 MB of text, which is more than a Letterboxd download should');
    files[name] = body;
  };
  for (const file of fileList) {
    if (file.size > MAX_ZIP) throw new Error(`${file.name} is too large`);
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (isZip(bytes)) {
      for (const entry of zipEntries(bytes)) {
        if (/\.csv$/i.test(entry.name)) add(entry.name, text(await entry.read()));
      }
    } else add(file.name, text(bytes));
  }
  return files;
}

const said = (c, one, many) => `${c.found} ${c.found === 1 ? one : many}: ${c.new} new, ${c.already} already here`;
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** Bring in a Letterboxd download: read here, counts shown first, saved only when the person says so. */
export default function LetterboxdIn({ onDone }) {
  const [files, setFiles] = useState(null);
  const [report, setReport] = useState(null);
  const [saved, setSaved] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const input = useRef(null);
  const pick = async (e) => {
    const chosen = [...e.target.files];
    e.target.value = '';
    if (chosen.length === 0) return;
    setError(''); setReport(null); setSaved(null); setBusy(true);
    try {
      const read = await readLetterboxdFiles(chosen);
      setFiles(read);
      setReport((await axios.post('/api/media/letterboxd/read', { files: read })).data);
    } catch (err) { setError(errorMessage(err, err?.message || 'Those files could not be read')); }
    setBusy(false);
  };
  const save = async () => {
    setError(''); setBusy(true);
    try {
      setSaved((await axios.post('/api/media/letterboxd', { files })).data);
      setReport(null); setFiles(null);
      onDone?.();
    } catch (err) { setError(errorMessage(err, 'That could not be saved')); }
    setBusy(false);
  };
  const made = saved ? saved.lists.filter((l) => l.made).length : 0;
  return (
    <section className={`${cardClass} space-y-3`} aria-label="Bring in from Letterboxd" data-letterboxd-in>
      <h2 className="text-sm font-semibold text-life-800 dark:text-life-50">Bring in from Letterboxd</h2>
      <p className="text-xs text-gray-600 dark:text-life-200">
        On Letterboxd, open Settings, then Data, and choose Export your data. Pick the zip you get, or its files one by one. The files are read here and nothing is sent to Letterboxd or anywhere else. You see what is in them before anything is saved.
      </p>
      <div>
        <input ref={input} type="file" accept=".zip,.csv,application/zip,text/csv" multiple onChange={pick} className="sr-only" aria-label="Letterboxd files" data-letterboxd-file />
        <button type="button" onClick={() => input.current?.click()} disabled={busy} className={`${quietButtonClass} ${control}`}>{busy ? 'Reading…' : 'Choose the Letterboxd files'}</button>
      </div>
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      {report && (
        <div className="space-y-2 rounded-xl border border-life-100 p-3 dark:border-life-700" data-letterboxd-review role="region" aria-label="What is in the files">
          <h3 className="text-sm font-semibold text-life-800 dark:text-life-50">This is what is in them</h3>
          <ul className="space-y-1 text-sm text-gray-800 dark:text-life-50">
            <li>{said(report.films, 'film', 'films')}</li>
            <li>{said(report.days, 'day watched', 'days watched')}</li>
            <li>{said(report.ratings, 'rating', 'ratings')}</li>
            <li>{said(report.reviews, 'review', 'reviews')}</li>
            <li>{said(report.watchlist, 'film on your watchlist', 'films on your watchlist')}</li>
            {report.lists.map((l) => <li key={l.name}>List {l.name}: {plural(l.found, 'film', 'films')}, {l.new} new{l.made ? ' (a new list)' : ''}</li>)}
          </ul>
          <p className="text-xs text-gray-600 dark:text-life-200">
            None of these films is counted in your Collection: you do not own them. They are kept as titles that are watched or on a list. Half stars and reviews are kept as they are.
            {report.day_from_log > 0 && ` ${plural(report.day_from_log, 'film has', 'films have')} no day in your diary, so the day you logged ${report.day_from_log === 1 ? 'it' : 'them'} on Letterboxd is used.`}
            {report.skipped > 0 && ` ${plural(report.skipped, 'line was', 'lines were')} skipped.`}
          </p>
          {report.left_alone.length > 0 && <p className="text-xs text-gray-600 dark:text-life-200">Left alone: {report.left_alone.join(', ')}.</p>}
          <p className="text-xs text-gray-600 dark:text-life-200">Bringing the same files in again adds nothing.</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={save} disabled={busy} className={`${buttonClass} ${control}`}>Bring it in</button>
            <button type="button" onClick={() => { setReport(null); setFiles(null); }} className={`${quietButtonClass} ${control}`}>Cancel</button>
          </div>
        </div>
      )}
      {saved && (
        <p className="text-sm text-gray-800 dark:text-life-50" role="status" data-letterboxd-done>
          Brought in: {plural(saved.films.new, 'new film', 'new films')}, {plural(saved.days.new, 'day watched', 'days watched')}, {plural(saved.ratings.new, 'rating', 'ratings')}, {plural(saved.reviews.new, 'review', 'reviews')}, {plural(made, 'new list', 'new lists')}.{' '}
          <Link to="/media/lists" className="inline-flex min-h-[44px] items-center underline">See the lists</Link>
        </p>
      )}
    </section>
  );
}
