import { useState } from 'react';
import axios from 'axios';
import { Field, buttonClass, quietButtonClass, cardClass, errorMessage } from './ui';
import { zipEntries } from './unpackRecipes';

// What the server (and the phone's own routes) are sent at once, with room to spare: a few pictures at a time.
const SENT_AT_ONCE = 4 * 1024 * 1024;
const MOST_TEXT = 5.5 * 1024 * 1024;
// One picture is sent whole, as text 4/3 as long, in a request the server reads up to 8 MB of.
const MOST_ONE = 5.5 * 1024 * 1024;
const touch = 'min-h-[44px]';

const pad = (n) => String(n).padStart(2, '0');
const today = () => { const now = new Date(); return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`; };
const megabytes = (bytes) => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`);
const plural = (n, one, many) => `${n} ${n === 1 ? one : many ?? one + 's'}`;

function base64(bytes) {
  let text = '';
  for (let at = 0; at < bytes.length; at += 0x8000) text += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  return btoa(text);
}

/** A refusal that came back as bytes (the zip route answers in bytes) read as the words it holds. */
function whyNot(err, fallback) {
  const data = err?.response?.data;
  if (data && typeof data === 'object' && !(data instanceof ArrayBuffer) && !ArrayBuffer.isView(data)) return errorMessage(err, fallback);
  try {
    const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : data;
    const said = JSON.parse(new TextDecoder().decode(bytes))?.detail;
    if (typeof said === 'string') return said;
  } catch { /* not words */ }
  return fallback;
}

const nameFromHeader = (headers) => /filename="([^"]+)"/.exec(headers?.['content-disposition'] ?? headers?.['Content-Disposition'] ?? '')?.[1];

/** Every record, picture and paper in open files: one zip, made here and handed to the person's own device. */
export function DownloadEverything() {
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState('');
  const [error, setError] = useState('');

  const download = async () => {
    setBusy(true); setError(''); setSaid('');
    try {
      const { data, headers } = await axios.get('/api/export/everything.zip', { responseType: 'arraybuffer' });
      const bytes = new Uint8Array(data);
      const name = nameFromHeader(headers) ?? `lifeis-everything-${today()}.zip`;
      const { handOver } = await import('../device/handOver.js');
      await handOver(bytes, name);
      setSaid(`Made ${name} (${megabytes(bytes.length)}). It was made here and sent nowhere. Open README.txt inside it first.`);
    } catch (err) { setError(whyNot(err, "Couldn't make the download")); }
    setBusy(false);
  };

  return (
    <section className={cardClass}>
      <h2 className="mb-1 font-semibold text-life-800 dark:text-life-50">Download everything</h2>
      <p className="text-sm text-gray-600 dark:text-life-100">One zip of open files you can read anywhere: a spreadsheet for each kind of record (recipes, things, upkeep, pets, spending and the rest), your pictures and papers in folders, and your recipes in the format other recipe apps read. It holds only your own, never a password or a key, and goes nowhere but to your own device.</p>
      {said && <p className="mt-2 break-words rounded-lg bg-life-50 px-3 py-2 text-sm text-life-800 dark:bg-life-800 dark:text-life-50" role="status">{said}</p>}
      {error && <p className="mt-2 text-sm text-red-600" role="alert">{error}</p>}
      <div className="mt-3"><button type="button" onClick={download} disabled={busy} className={`${buttonClass} ${touch}`}>{busy ? 'Making the zip…' : 'Download everything'}</button></div>
    </section>
  );
}

/** Reads a chosen zip: the spreadsheets as text, and a way to fetch any file in it. Nothing leaves the device by opening it. */
async function openDownload(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let entries;
  try { entries = zipEntries(bytes).filter((e) => !e.name.endsWith('/') && !e.name.startsWith('__MACOSX/')); } catch { throw new Error("That isn't a zip file. Choose the zip you got from “Download everything”."); }
  const files = {};
  let size = 0;
  const found = new Map();
  for (const entry of entries) {
    found.set(entry.name, entry);
    // Without the folder a zip may have been opened into, so a picture is found by the name the spreadsheet gives it.
    const shorter = entry.name.replace(/^[^/]*\//, '');
    if (!found.has(shorter)) found.set(shorter, entry);
    if (/\.(csv)$/i.test(entry.name) || /(^|\/)readme\.txt$/i.test(entry.name)) {
      const text = new TextDecoder('utf-8').decode(await entry.read()).replace(/^﻿/, '');
      size += text.length;
      files[entry.name] = text;
    }
  }
  if (Object.keys(files).length === 0) throw new Error("That zip doesn't hold a download from Life Is. Choose the zip you got from “Download everything”.");
  if (size > MOST_TEXT) throw new Error("That download's spreadsheets are too large to bring in at once. Bring in a smaller one.");
  return { files, find: (name) => found.get(name) ?? found.get(name.replace(/^[^/]*\//, '')) };
}

/** Sends the pictures and papers that belong to what came in, a few at a time. Returns how many were kept and how many were not. */
async function sendPictures(pending, find, onProgress) {
  let kept = 0;
  let left = 0;
  let batch = [];
  let weight = 0;
  const flush = async () => {
    if (!batch.length) return;
    const { data } = await axios.post('/api/export/pictures', { pictures: batch });
    kept += data.kept; left += data.left;
    batch = []; weight = 0;
    onProgress(kept + left);
  };
  for (const one of pending) {
    const entry = find(one.file);
    if (!entry) { left += 1; continue; }
    const bytes = await entry.read();
    // One picture too large to send in a single request is left out and counted, never cut short.
    if (bytes.length > MOST_ONE) { left += 1; continue; }
    if (weight + bytes.length > SENT_AT_ONCE) await flush();
    batch.push({ as: one.as, id: one.id, kind: one.kind, name: one.name, data: base64(bytes) });
    weight += bytes.length;
    if (batch.length >= 30) await flush();
  }
  await flush();
  return { kept, left };
}

const counts = (k) => [
  k.fresh > 0 && `${k.fresh} new`,
  k.already > 0 && `${k.already} already here`,
].filter(Boolean).join(', ') || 'nothing new';

/** Brings the records in a download into this Life Is, kind by kind. Never overwrites, never deletes. */
export function BringInFromDownload() {
  const [opened, setOpened] = useState(null);
  const [looked, setLooked] = useState(null);
  const [picked, setPicked] = useState({});
  const [report, setReport] = useState(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');

  const choose = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError(''); setReport(null); setLooked(null); setOpened(null); setBusy(true);
    try {
      const open = await openDownload(file);
      const { data } = await axios.post('/api/export/look', { files: open.files });
      setOpened({ ...open, name: file.name });
      setLooked(data);
      // What would add something is ticked to begin with.
      setPicked(Object.fromEntries(data.kinds.filter((k) => k.importable && k.fresh > 0).map((k) => [k.key, true])));
    } catch (err) { setError(err?.response ? whyNot(err, "Couldn't read that file") : err.message || "Couldn't read that file"); }
    setBusy(false);
  };

  const chosen = looked ? looked.kinds.filter((k) => k.importable && picked[k.key]).map((k) => k.key) : [];
  const bring = async () => {
    setBusy(true); setError(''); setProgress('');
    try {
      const { data } = await axios.post('/api/export/bring-in', { files: opened.files, kinds: chosen });
      let pictures = null;
      if (data.pending.length) {
        setProgress(`Bringing in ${plural(data.pending.length, 'picture or paper')}…`);
        pictures = await sendPictures(data.pending, opened.find, (n) => setProgress(`Bringing in pictures and papers: ${n} of ${data.pending.length}…`));
      }
      setReport({ kinds: data.kinds, pictures, wanted: data.pending.length });
      setLooked(null); setOpened(null);
    } catch (err) { setError(err?.response ? whyNot(err, "Couldn't bring that in") : err.message || "Couldn't bring that in"); }
    setProgress('');
    setBusy(false);
  };
  const again = () => { setReport(null); setLooked(null); setOpened(null); setError(''); };

  return (
    <section className={cardClass}>
      <h2 className="mb-1 font-semibold text-life-800 dark:text-life-50">Bring in from a download</h2>
      <p className="text-sm text-gray-600 dark:text-life-100">Choose a zip made by “Download everything” (from this Life Is or another) and pick which kinds to bring in. Nothing you have is ever overwritten or deleted: a record that matches one you already have is left as it is, and only what is new is added. Bringing in the same file twice adds nothing the second time.</p>
      {error && <p className="mt-2 break-words text-sm text-red-600" role="alert">{error}</p>}

      {!looked && !report && (
        <div className="mt-3">
          <Field label="A download from Life Is (a .zip file)">
            <input type="file" accept=".zip,application/zip" onChange={choose} disabled={busy} className={`block w-full ${touch} text-sm file:mr-3 file:min-h-[44px] file:rounded-lg file:border file:border-life-200 file:bg-white file:px-3 file:text-sm file:text-life-700`} />
          </Field>
          {busy && <p className="mt-2 text-sm text-gray-600 dark:text-life-100" role="status">Reading it…</p>}
        </div>
      )}

      {looked && (
        <div className="mt-3 space-y-3">
          <p className="break-words text-sm text-gray-700 dark:text-life-100">{opened.name}{looked.made_on ? `, made on ${looked.made_on}` : ''}. It holds:</p>
          <ul className="space-y-1" aria-label="What the download holds">
            {looked.kinds.filter((k) => k.importable && k.found > 0).map((k) => (
              <li key={k.key}>
                <label className={`flex ${touch} items-start gap-3 rounded-lg px-1 py-2 hover:bg-life-50 dark:hover:bg-life-700`}>
                  <input type="checkbox" checked={Boolean(picked[k.key])} onChange={(e) => setPicked({ ...picked, [k.key]: e.target.checked })} className="mt-0.5 h-5 w-5 flex-none" />
                  <span className="min-w-0 text-sm">
                    <span className="block break-words font-medium text-gray-800 dark:text-life-50">{k.label}</span>
                    <span className="block break-words text-gray-600 dark:text-life-100">{plural(k.found, 'record')}: {counts(k)}{k.unlinked > 0 ? `; ${plural(k.unlinked, 'comes', 'come')} without a link that can't be rebuilt` : ''}{k.pictures > 0 ? `; ${plural(k.pictures, 'picture or paper')}` : ''}</span>
                    {k.note && <span className="block break-words text-gray-500 dark:text-life-200">{k.note}</span>}
                    {k.skipped.length > 0 && <span className="block break-words text-honey-700">Can't be read: {k.skipped.join(' ')}</span>}
                  </span>
                </label>
              </li>
            ))}
          </ul>
          {looked.kinds.every((k) => !k.importable || k.found === 0) && <p className="text-sm text-gray-600 dark:text-life-100">There is nothing in this download that can be brought in.</p>}
          {looked.kinds.some((k) => !k.importable && k.found > 0) && (
            <p className="break-words text-sm text-gray-500 dark:text-life-200">Also in the download, for you to read and keep, but not yet able to be brought back in: {looked.kinds.filter((k) => !k.importable && k.found > 0).map((k) => `${k.label} (${k.found})`).join('; ')}.</p>
          )}
          <p className="rounded-lg bg-life-50 px-3 py-2 text-sm text-life-800 dark:bg-life-800 dark:text-life-50">The counts are what choosing everything would do. Anything already here is left exactly as it is.</p>
          {progress && <p className="text-sm text-gray-600 dark:text-life-100" role="status">{progress}</p>}
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" onClick={again} disabled={busy} className={`${quietButtonClass} ${touch}`}>Cancel</button>
            <button type="button" onClick={bring} disabled={busy || chosen.length === 0} className={`${buttonClass} ${touch}`}>{busy ? 'Bringing it in…' : chosen.length ? `Bring in ${plural(chosen.length, 'kind')}` : 'Choose what to bring in'}</button>
          </div>
        </div>
      )}

      {report && (
        <div className="mt-3 space-y-2" role="status" aria-label="What was brought in">
          <ul className="space-y-2">
            {report.kinds.map((k) => (
              <li key={k.key} className="break-words text-sm" data-kind={k.key}>
                <span className="font-medium text-gray-800 dark:text-life-50">{k.label}: </span>
                {k.ok
                  ? <span className="text-gray-700 dark:text-life-100">{k.fresh} added, {k.already} already here{k.unlinked > 0 ? `, ${plural(k.unlinked, 'came', 'came')} without a link that could not be rebuilt` : ''}{k.skipped.length ? `. Not read: ${k.skipped.join(' ')}` : ''}{k.note ? `. ${k.note}` : ''}</span>
                  : <span className="text-red-600">did not come in. {k.problem}</span>}
              </li>
            ))}
          </ul>
          {report.pictures && <p className="text-sm text-gray-700 dark:text-life-100">Pictures and papers: {report.pictures.kept} kept{report.pictures.left ? `, ${report.pictures.left} not kept (too large, not a picture, or the record already had one)` : ''}.</p>}
          {report.kinds.every((k) => k.ok && k.fresh === 0) && <p className="text-sm text-gray-700 dark:text-life-100">Nothing new: everything in it was already here.</p>}
          <button type="button" onClick={again} className={`${quietButtonClass} ${touch}`}>Bring in another file</button>
        </div>
      )}
    </section>
  );
}

/** The two together, with what separates them from the backup in a sentence. */
export default function YourFiles({ hasBackup }) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-600 dark:text-life-100">{hasBackup ? 'A backup restores a whole Life Is exactly as it was, and only Life Is can read it. ' : ''}A download is open files you can read anywhere, with every picture and paper, and you bring it back in part by part.</p>
      <DownloadEverything />
      <BringInFromDownload />
    </div>
  );
}
