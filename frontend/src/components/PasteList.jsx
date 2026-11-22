import { useState } from 'react';
import axios from 'axios';
import { Field, inputClass, buttonClass, errorMessage } from './ui';

/**
 * A list copied from Notes, a text message or an email, added to the grocery list in one go. It is looked over
 * first: each line shows what it will become, a line can be taken off, and what is already on the list is left
 * out. Each line then goes in as if it had been typed, so "2 lb chicken thighs" is an amount and a thing.
 */
export default function PasteList({ onDone }) {
  const [text, setText] = useState('');
  const [lines, setLines] = useState(null);      // [{ text, label, amount, already }]
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const look = async (e) => {
    e.preventDefault();
    setError(''); setBusy(true);
    try { setLines((await axios.post('/api/kitchen/grocery/paste/read', { text })).data.lines); } catch (err) { setError(errorMessage(err, "Couldn't read that list")); }
    setBusy(false);
  };
  const add = async () => {
    setError(''); setBusy(true);
    try {
      const { data } = await axios.post('/api/kitchen/grocery/paste', { lines: fresh.map((l) => l.text) });
      onDone({ ...data, already: data.already + there.length }); // what was left out in the look-over counts too
    } catch (err) { setError(errorMessage(err, "Couldn't add them")); setBusy(false); }
  };
  const fresh = (lines || []).filter((l) => !l.already);
  const there = (lines || []).filter((l) => l.already);
  if (lines) {
    return (
      <div className="space-y-3">
        <p className="text-sm font-medium text-life-800 dark:text-life-50" data-preview="count">
          {fresh.length === 0 ? 'Nothing new to add.' : `${fresh.length} to add`}{there.length > 0 ? `, ${there.length} already on your list` : ''}.
        </p>
        {fresh.length > 0 && (
          <ul className="divide-y divide-life-50 rounded-lg bg-life-50/60 px-3 dark:divide-life-700 dark:bg-life-800" aria-label="What will be added">
            {fresh.map((l, i) => (
              <li key={`${i}-${l.text}`} className="flex items-center gap-2 text-sm">
                <span className="min-w-0 flex-1 break-words py-2 text-gray-800 dark:text-life-50">{l.label}{l.amount && <span className="ml-2 text-gray-500 dark:text-life-300">{l.amount}</span>}{l.note && <span className="block text-xs text-gray-400">{l.note}</span>}</span>
                <button type="button" onClick={() => setLines(lines.filter((x) => x !== l))} aria-label={`Leave off ${l.label}`}
                  className="flex h-11 w-11 shrink-0 items-center justify-center text-gray-400 hover:text-red-600">✕</button>
              </li>
            ))}
          </ul>
        )}
        {there.length > 0 && <p className="break-words text-xs text-gray-500 dark:text-life-300">Already on the list, so left out: {there.map((l) => l.label).join(', ')}.</p>}
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex items-center justify-between gap-2">
          <button type="button" onClick={() => setLines(null)} className="min-h-[44px] px-2 text-sm text-life-700 underline dark:text-life-200">Back to the list</button>
          <button type="button" onClick={add} disabled={busy || fresh.length === 0} className={`${buttonClass} min-h-[44px]`}>{busy ? 'Adding…' : `Add ${fresh.length}`}</button>
        </div>
      </div>
    );
  }
  return (
    <form onSubmit={look} className="space-y-3">
      <p className="text-sm text-gray-600 dark:text-life-100">
        Paste a list from Notes, a text message or an email, one thing to a line. Dashes, bullets, numbers and check boxes are dropped, and so are
        blank lines and headings that end in a colon. A line like "milk, eggs, bread" is three things; "tomatoes, diced" is one.
      </p>
      <Field label="The list">
        <textarea rows={9} autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder={'Produce:\n- apples\n- 2 lb chicken thighs\n[ ] milk, eggs, bread'} className={inputClass} />
      </Field>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex justify-end"><button type="submit" disabled={busy || !text.trim()} className={`${buttonClass} min-h-[44px]`}>{busy ? 'Reading…' : 'Look it over'}</button></div>
    </form>
  );
}
