import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import { cardClass, errorMessage, inputClass } from './ui';

/**
 * "Jot it down": one line on Home for a stray thought. Type it and press Enter. It is added to the signed-in person's
 * own jottings, which nobody else can see. Shows the last few they have not checked off, and a way to all of them.
 */
export default function JotLine() {
  const [list, setList] = useState(null);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => { axios.get('/api/jottings').then(({ data }) => setList(data)).catch(() => setList([])); }, []);
  useEffect(() => { load(); }, [load]);

  const add = async (e) => {
    e.preventDefault();
    if (!text.trim() || busy) return;
    setBusy(true);
    setError('');
    try {
      await axios.post('/api/jottings', { text });
      setText('');
      load();
    } catch (err) { setError(errorMessage(err, "Couldn't jot that down")); } finally { setBusy(false); }
  };

  const open = (list ?? []).filter((j) => !j.done);
  return (
    <section className={cardClass} aria-label="Jot it down" data-card="jot">
      <form onSubmit={add} className="space-y-2">
        <label htmlFor="jot-line" className="block font-semibold text-life-800 dark:text-life-50">Jot it down</label>
        <input id="jot-line" value={text} onChange={(e) => setText(e.target.value)} maxLength={500} enterKeyHint="done" autoComplete="off"
          placeholder="A thought, then Enter" className={`${inputClass} min-h-[44px]`} />
      </form>
      {error && <p className="mt-2 text-sm text-red-600" role="alert">{error}</p>}
      {open.length > 0 && (
        <ul className="mt-2 space-y-1" data-jot-latest>
          {open.slice(0, 3).map((j) => <li key={j.id} className="break-words text-sm text-gray-800 dark:text-life-50">{j.text}</li>)}
        </ul>
      )}
      <Link to="/jottings" className="mt-1 inline-flex min-h-[44px] items-center text-sm text-life-600 underline dark:text-life-200">
        {open.length > 0 ? `All your jottings (${open.length} open)` : 'Your jottings'}
      </Link>
    </section>
  );
}
