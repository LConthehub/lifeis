import { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import { buttonClass, cardClass, errorMessage, inputClass, quietButtonClass } from '../components/ui';

/**
 * Jottings: a person's own scratch list for stray thoughts, newest first, each with the day it was jotted. A jotting
 * can be checked off, reworded or removed; checked ones fold away. Only this person ever sees them: there is no
 * sharing switch, not even for the person in charge.
 */

const control = `${inputClass} min-h-[44px]`;
const dayText = (day) => {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
};

function Line({ jotting, onChanged, onError }) {
  const [rewording, setRewording] = useState(false);
  const [text, setText] = useState(jotting.text);
  const [sure, setSure] = useState(false);
  const change = async (body) => {
    onError('');
    try { onChanged((await axios.put(`/api/jottings/${jotting.id}`, body)).data); } catch (err) { onError(errorMessage(err, "Couldn't change that")); }
  };
  const save = async (e) => {
    e.preventDefault();
    if (!text.trim()) return;
    await change({ text });
    setRewording(false);
  };
  const remove = async () => {
    onError('');
    try { await axios.delete(`/api/jottings/${jotting.id}`); onChanged(null, jotting.id); } catch (err) { onError(errorMessage(err, "Couldn't remove that")); }
  };
  return (
    <li className={`${cardClass} space-y-2`} data-jotting={jotting.id} data-done={jotting.done ? 'true' : undefined}>
      {rewording ? (
        <form onSubmit={save} className="space-y-2">
          <input value={text} onChange={(e) => setText(e.target.value)} maxLength={500} aria-label="Reword this jotting" className={control} autoFocus />
          <div className="flex flex-wrap gap-2">
            <button type="submit" className={`${buttonClass} min-h-[44px]`}>Save</button>
            <button type="button" onClick={() => { setText(jotting.text); setRewording(false); }} className={`${quietButtonClass} min-h-[44px]`}>Cancel</button>
          </div>
        </form>
      ) : (
        <>
          <div className="flex items-start gap-3">
            <label className="flex min-h-[44px] min-w-[44px] cursor-pointer items-center justify-center">
              <input type="checkbox" checked={jotting.done} onChange={(e) => change({ done: e.target.checked })} aria-label={`Check off: ${jotting.text}`} className="h-5 w-5 accent-life-600" />
            </label>
            <div className="min-w-0 flex-1 py-2">
              <p className={`break-words text-sm ${jotting.done ? 'text-gray-500 line-through dark:text-life-300' : 'text-gray-800 dark:text-life-50'}`}>{jotting.text}</p>
              <p className="text-xs text-gray-500 dark:text-life-300">{dayText(jotting.day)}</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-x-2">
            <button type="button" onClick={() => setRewording(true)} className="min-h-[44px] px-2 text-sm text-life-600 underline dark:text-life-200">Reword</button>
            {!sure && <button type="button" onClick={() => setSure(true)} className="min-h-[44px] px-2 text-sm text-red-700 hover:underline dark:text-red-300">Remove</button>}
            {sure && <button type="button" onClick={remove} className="min-h-[44px] rounded-xl bg-red-600 px-3 text-sm font-semibold text-white">Yes, remove it</button>}
          </div>
        </>
      )}
    </li>
  );
}

export default function JottingsPage() {
  const [list, setList] = useState(null);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const load = useCallback(() => { axios.get('/api/jottings').then(({ data }) => setList(data)).catch(() => setList([])); }, []);
  useEffect(() => { load(); }, [load]);
  if (list === null) return null;

  const add = async (e) => {
    e.preventDefault();
    if (!text.trim()) return;
    setError('');
    try { await axios.post('/api/jottings', { text }); setText(''); load(); } catch (err) { setError(errorMessage(err, "Couldn't jot that down")); }
  };
  // A changed jotting keeps its place by the newest first order the server gives, so ask again.
  const changed = (next, removedId) => { if (removedId !== undefined) setList((before) => before.filter((j) => j.id !== removedId)); else if (next) load(); };
  const open = list.filter((j) => !j.done);
  const checked = list.filter((j) => j.done);

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-life-800 dark:text-life-50">Jottings</h1>
      <p className="text-sm text-gray-600 dark:text-life-100" data-jottings-private>Only you can see these. Nobody else can, not even the person in charge. They are in your own full download, and come back in with it.</p>
      <form onSubmit={add} className="flex flex-wrap gap-2">
        <input value={text} onChange={(e) => setText(e.target.value)} maxLength={500} placeholder="A thought, then Enter" aria-label="Jot it down" className={`${control} min-w-0 flex-1`} />
        <button type="submit" className={`${buttonClass} min-h-[44px]`}>Add</button>
      </form>
      {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
      {open.length === 0 && <p className={`${cardClass} text-sm text-gray-600 dark:text-life-100`}>{checked.length ? 'Nothing open. Everything is checked off.' : 'Nothing jotted yet. A stray thought goes here, newest first.'}</p>}
      <ul className="space-y-3">
        {open.map((j) => <Line key={j.id} jotting={j} onChanged={changed} onError={setError} />)}
      </ul>
      {checked.length > 0 && (
        <details className="space-y-3" data-checked-jottings>
          <summary className="min-h-[44px] cursor-pointer py-2 text-sm text-life-600 underline dark:text-life-200">Checked off ({checked.length})</summary>
          <ul className="mt-3 space-y-3">
            {checked.map((j) => <Line key={j.id} jotting={j} onChanged={changed} onError={setError} />)}
          </ul>
        </details>
      )}
    </div>
  );
}
