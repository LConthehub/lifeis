import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import SubChips, { ROUTINE_CHIPS } from '../components/SubChips';
import Modal, { Field, inputClass, buttonClass, quietButtonClass, cardClass, errorMessage } from '../components/ui';

/**
 * The incident log: dated entries only this person can see, for something like a break-in, a dispute or a problem with a
 * landlord. When it happened, what happened, who was there, and what was kept (a note of photos, messages or papers, in
 * words). An entry can be changed or taken away for 24 hours after it is written, and after that only added to, so the
 * record holds up later. The page says so. Only this person ever sees it, not even the person in charge.
 */

const control = `${inputClass} min-h-[44px]`;
const today = () => new Date().toLocaleDateString('en-CA');
export const dayText = (day) => {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
};
/** A moment kept as a UTC stamp, said in the person's own time. */
export const momentText = (stamp) => new Date(stamp).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
export const LOCK_RULE = 'An entry can be changed or taken away for 24 hours after you write it. After that it can only be added to. Nothing you add can be changed. That keeps the record sound if you need it later.';

function EntryForm({ entry, onDone, onGone }) {
  const [on, setOn] = useState(entry?.happened_on ?? today());
  const [time, setTime] = useState(entry?.happened_time ?? '');
  const [what, setWhat] = useState(entry?.what ?? '');
  const [who, setWho] = useState(entry?.who ?? '');
  const [kept, setKept] = useState(entry?.kept ?? '');
  const [error, setError] = useState('');
  const [sure, setSure] = useState(false);
  const save = async (e) => {
    e.preventDefault();
    setError('');
    const body = { happened_on: on, happened_time: time.trim() || null, what, who: who.trim() || null, kept: kept.trim() || null };
    try { onDone(entry ? (await axios.put(`/api/incidents/${entry.id}`, body)).data : (await axios.post('/api/incidents', body)).data); } catch (err) { setError(errorMessage(err, "Couldn't save")); }
  };
  const remove = async () => {
    try { await axios.delete(`/api/incidents/${entry.id}`); onGone(); } catch (err) { setError(errorMessage(err, "Couldn't remove it")); }
  };
  return (
    <form onSubmit={save} className="space-y-4">
      <p className="rounded-xl bg-life-50 p-3 text-sm text-gray-700 dark:bg-life-900 dark:text-life-100" data-lock-rule>{LOCK_RULE}</p>
      <div className="flex flex-wrap gap-3">
        <Field label="Day it happened"><input type="date" max={today()} value={on} onChange={(e) => setOn(e.target.value)} aria-label="Day it happened" className={`${control} !w-auto`} /></Field>
        <Field label="Time (if you know)"><input value={time} maxLength={40} onChange={(e) => setTime(e.target.value)} placeholder="about 9 pm" aria-label="Time" className={`${control} !w-40`} /></Field>
      </div>
      <Field label="What happened"><textarea value={what} onChange={(e) => setWhat(e.target.value)} rows={5} aria-label="What happened" className={`${inputClass} min-h-[44px]`} /></Field>
      <Field label="Who was there"><textarea value={who} onChange={(e) => setWho(e.target.value)} rows={2} aria-label="Who was there" className={`${inputClass} min-h-[44px]`} /></Field>
      <Field label="What you kept (photos, messages or papers, and where they are)"><textarea value={kept} onChange={(e) => setKept(e.target.value)} rows={3} aria-label="What you kept" className={`${inputClass} min-h-[44px]`} /></Field>
      {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
      <div className="flex flex-wrap items-center gap-2">
        {entry && !sure && <button type="button" onClick={() => setSure(true)} className="min-h-[44px] px-3 text-sm text-red-700 hover:underline dark:text-red-300">Delete this entry</button>}
        {entry && sure && <button type="button" onClick={remove} className="min-h-[44px] rounded-xl bg-red-600 px-4 text-sm font-semibold text-white">Yes, delete it and what was added to it</button>}
        <button type="submit" className={`${buttonClass} ml-auto min-h-[44px]`}>Save</button>
      </div>
    </form>
  );
}

function AddTo({ entry, onChanged }) {
  const [open, setOpen] = useState(false);
  const [words, setWords] = useState('');
  const [error, setError] = useState('');
  const add = async (e) => {
    e.preventDefault();
    setError('');
    try { onChanged((await axios.post(`/api/incidents/${entry.id}/additions`, { words })).data); setWords(''); setOpen(false); } catch (err) { setError(errorMessage(err, "Couldn't add that")); }
  };
  if (!open) return <button type="button" onClick={() => setOpen(true)} className={`${quietButtonClass} min-h-[44px]`} aria-label={`Add to the entry of ${dayText(entry.happened_on)}`}>Add to this entry</button>;
  return (
    <form onSubmit={add} className="w-full space-y-2">
      <label className="block text-xs text-gray-600 dark:text-life-200">What to add. It is kept as you write it, with the time, and cannot be changed after.
        <textarea value={words} onChange={(e) => setWords(e.target.value)} rows={3} aria-label={`What to add to the entry of ${dayText(entry.happened_on)}`} className={`${inputClass} mt-0.5 min-h-[44px]`} />
      </label>
      {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="submit" className={`${buttonClass} min-h-[44px]`}>Keep this addition</button>
        <button type="button" onClick={() => { setOpen(false); setWords(''); }} className={`${quietButtonClass} min-h-[44px]`}>Cancel</button>
      </div>
    </form>
  );
}

export default function IncidentLogPage() {
  const [list, setList] = useState(null);
  const [modal, setModal] = useState(null);
  const load = useCallback(() => { axios.get('/api/incidents').then(({ data }) => setList(data)).catch(() => setList([])); }, []);
  useEffect(() => { load(); }, [load]);
  if (list === null) return null;
  const swap = (next) => setList((before) => before.map((x) => (x.id === next.id ? next : x)));
  const done = () => { setModal(null); load(); };
  const shown = [...list].reverse();
  return (
    <div className="space-y-4">
      <SubChips items={ROUTINE_CHIPS} label="Routines, measures and your private records" />
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-xl font-semibold text-life-800 dark:text-life-50">Incident log</h1>
        <button type="button" onClick={() => setModal({ entry: null })} className={`${buttonClass} min-h-[44px]`}>+ New entry</button>
      </div>
      <p className="text-sm text-gray-600 dark:text-life-100" data-private>Only you can see this. Nobody else can, not even the person in charge. It is in your own full download, and comes back in with it. Life Is keeps what you write and gives no advice.</p>
      <p className={`${cardClass} text-sm text-gray-800 dark:text-life-50`} data-lock-rule>{LOCK_RULE}</p>
      {list.length > 0 && <Link to="/incident-log/print" className={`${quietButtonClass} inline-flex min-h-[44px] items-center`}>Print the whole log</Link>}
      {list.length === 0 && <p className={`${cardClass} text-sm text-gray-600 dark:text-life-100`}>No entries yet. Write one when something happens: when, what happened, who was there, and what you kept.</p>}
      <ul className="space-y-3">
        {shown.map((x) => (
          <li key={x.id} className={`${cardClass} space-y-2`} data-entry={x.happened_on} data-locked={x.locked ? 'yes' : 'no'}>
            <div className="min-w-0">
              <h2 className="break-words font-semibold text-life-800 dark:text-life-50">{dayText(x.happened_on)}{x.happened_time ? `, ${x.happened_time}` : ''}</h2>
              <p className="text-xs text-gray-600 dark:text-life-200" data-written>
                Written {momentText(x.written_at)}. {x.locked ? 'It can only be added to now.' : `You can change or delete it until ${momentText(x.changeable_until)}.`}
              </p>
            </div>
            <p className="whitespace-pre-wrap break-words text-sm text-gray-800 dark:text-life-50" data-what>{x.what}</p>
            {x.who && <p className="whitespace-pre-wrap break-words text-sm text-gray-700 dark:text-life-100"><span className="font-medium">Who was there:</span> {x.who}</p>}
            {x.kept && <p className="whitespace-pre-wrap break-words text-sm text-gray-700 dark:text-life-100"><span className="font-medium">What I kept:</span> {x.kept}</p>}
            {x.additions.length > 0 && (
              <ul className="space-y-2 border-l-2 border-life-200 pl-3 dark:border-life-700" aria-label="Added later">
                {x.additions.map((a) => (
                  <li key={a.id} className="text-sm" data-addition>
                    <p className="text-xs text-gray-600 dark:text-life-200">Added {momentText(a.written_at)}</p>
                    <p className="whitespace-pre-wrap break-words text-gray-800 dark:text-life-50">{a.words}</p>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex flex-wrap gap-2">
              <AddTo entry={x} onChanged={swap} />
              {!x.locked && <button type="button" onClick={() => setModal({ entry: x })} className={`${quietButtonClass} min-h-[44px]`} aria-label={`Change the entry of ${dayText(x.happened_on)}`}>Change</button>}
            </div>
          </li>
        ))}
      </ul>
      {modal && (
        <Modal title={modal.entry ? 'Change this entry' : 'New entry'} onClose={() => setModal(null)}>
          <EntryForm entry={modal.entry} onDone={done} onGone={done} />
        </Modal>
      )}
    </div>
  );
}
