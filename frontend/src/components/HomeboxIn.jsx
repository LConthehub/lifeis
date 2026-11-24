import { useState } from 'react';
import axios from 'axios';
import Modal, { Field, inputClass, buttonClass, quietButtonClass, errorMessage } from './ui';

const touch = 'min-h-[44px]';
const many = (n, one, more) => `${n} ${n === 1 ? one : more}`;

/**
 * Bring in the CSV that HomeBox exports. It is read on this Life Is, looked over (how many things, which kinds,
 * how many places and tags are new), and nothing is kept until the person says so. Nothing is sent anywhere else.
 */
function HomeboxForm({ onDone }) {
  const [text, setText] = useState('');
  const [seen, setSeen] = useState(null);
  const [done, setDone] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const choose = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5_000_000) { setError('That file is larger than 5 MB. Export fewer things from HomeBox and try again.'); return; }
    setError('');
    setText(await file.text());
    setSeen(null);
  };
  const look = async () => {
    setError('');
    setBusy(true);
    try { setSeen((await axios.post('/api/things/homebox/read', { text })).data); } catch (err) { setError(errorMessage(err, "Couldn't read that")); } finally { setBusy(false); }
  };
  const bring = async () => {
    setError('');
    setBusy(true);
    try { setDone((await axios.post('/api/things/homebox', { text })).data); } catch (err) { setError(errorMessage(err, "Couldn't bring it in")); } finally { setBusy(false); }
  };

  if (done) {
    return (
      <div className="space-y-3">
        <p role="status" data-homebox-done className="rounded-lg bg-life-50 px-3 py-2 text-sm text-life-800 dark:bg-life-700 dark:text-life-50">
          {done.added === 0 ? 'Nothing new was added' : `Brought in ${many(done.added, 'thing', 'things')}`}
          {done.already > 0 && `. ${done.already} ${done.already === 1 ? 'was' : 'were'} already in Life Is`}
          {done.skipped > 0 && `. ${many(done.skipped, 'row', 'rows')} with no name left out`}.
        </p>
        <div className="flex justify-end"><button type="button" onClick={() => onDone(done)} className={`${buttonClass} ${touch}`}>Done</button></div>
      </div>
    );
  }

  return (
    <form onSubmit={(e) => { e.preventDefault(); look(); }} className="space-y-3">
      <p className="text-sm text-gray-600 dark:text-life-200">
        In HomeBox, export your inventory as a CSV file, then choose it here or paste it. It is read here, on your own Life Is, and sent nowhere.
        You see what is in it before anything is kept.
      </p>
      <Field label="A file (.csv)"><input type="file" accept=".csv,.txt,text/csv,text/plain" onChange={choose} className={`${touch} block w-full py-2 text-sm text-gray-700 dark:text-life-100`} /></Field>
      <Field label="Or paste it here">
        <textarea rows={4} value={text} onChange={(e) => { setText(e.target.value); setSeen(null); }} placeholder={'HB.location,HB.labels,HB.name\nGarage,Tools,Drill'} className={inputClass} />
      </Field>
      {!seen && <div className="flex justify-end"><button type="submit" disabled={busy || !text.trim()} className={`${buttonClass} ${touch}`}>{busy ? 'Reading…' : 'Look it over'}</button></div>}

      {seen && (
        <div className="space-y-3" data-homebox-review>
          <div className="rounded-lg bg-life-50 p-3 text-sm text-life-800 dark:bg-life-700 dark:text-life-50">
            <p className="font-medium">{many(seen.found, 'thing', 'things')} in the file. {seen.fresh === 0 ? 'None of them are new.' : `${seen.fresh} would be added.`}</p>
            {seen.already > 0 && <p className="text-xs text-gray-600 dark:text-life-200">{seen.already} already in Life Is.</p>}
            {seen.skipped > 0 && <p className="text-xs text-gray-600 dark:text-life-200">{many(seen.skipped, 'row', 'rows')} with no name will be left out.</p>}
          </div>
          {seen.fresh > 0 && (
            <>
              <section>
                <h3 className="text-sm font-semibold text-life-800 dark:text-life-50">Kinds</h3>
                <ul className="divide-y divide-life-100 text-sm text-gray-800 dark:divide-life-700 dark:text-life-50" data-homebox-kinds>
                  {seen.kinds.map((k) => (
                    <li key={k.name} className="flex justify-between gap-2 py-1.5">
                      <span className="min-w-0 break-words">{k.icon ? `${k.icon} ` : ''}{k.name}{k.is_new && <span className="text-xs text-gray-500 dark:text-life-300"> (new kind)</span>}</span>
                      <span className="shrink-0 tabular-nums">{k.things}</span>
                    </li>
                  ))}
                </ul>
              </section>
              <ul className="space-y-1 text-sm text-gray-800 dark:text-life-50" data-homebox-counts>
                <li>Places: {seen.places.total}, {seen.places.fresh} new. A place inside a place stays inside it.</li>
                <li>Tags: {seen.tags.total}, {seen.tags.fresh} new. Each HomeBox label becomes a tag.</li>
                {seen.gone > 0 && <li>{many(seen.gone, 'thing', 'things')} that HomeBox says {seen.gone === 1 ? 'was' : 'were'} sold will go under "No longer have".</li>}
                {seen.with_own_fields > 0 && <li>{many(seen.with_own_fields, 'thing', 'things')} with fields of their own (custom fields, warranty details).</li>}
              </ul>
              {seen.asset_changed > 0 && (
                <div className="rounded-lg border border-life-200 p-3 text-sm text-gray-700 dark:border-life-700 dark:text-life-100" data-homebox-assets>
                  <p>{many(seen.asset_changed, 'asset number was', 'asset numbers were')} already taken here, so {seen.asset_changed === 1 ? 'that thing takes' : 'those things take'} the next free number:</p>
                  <ul className="mt-1 text-xs">
                    {seen.asset_changes.map((c) => <li key={c.name + c.wanted} className="break-words">{c.name}: {c.wanted} becomes {c.given}</li>)}
                  </ul>
                  {seen.asset_changed > seen.asset_changes.length && <p className="mt-1 text-xs">And {seen.asset_changed - seen.asset_changes.length} more.</p>}
                </div>
              )}
            </>
          )}
        </div>
      )}
      {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
      {seen && (
        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => setSeen(null)} className={`${quietButtonClass} ${touch}`}>Back</button>
          <button type="button" disabled={busy || seen.fresh === 0} onClick={bring} className={`${buttonClass} ${touch}`}>{busy ? 'Bringing in…' : `Bring in ${seen.fresh}`}</button>
        </div>
      )}
    </form>
  );
}

/** The button and the window it opens. `onDone` runs when the person is finished, so the page can load what came in. */
export default function HomeboxIn({ onDone, className = quietButtonClass }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={`${className} ${touch}`}>Bring in from HomeBox</button>
      {open && <Modal title="Bring in from HomeBox" wide onClose={() => { setOpen(false); onDone(); }}><HomeboxForm onDone={() => { setOpen(false); onDone(); }} /></Modal>}
    </>
  );
}
