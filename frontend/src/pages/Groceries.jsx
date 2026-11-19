import { useCallback, useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import axios from 'axios';
import { inputClass, buttonClass, quietButtonClass, cardClass, errorMessage } from '../components/ui';

/** The grocery list, by aisle. Ticking something off puts it in the pantry. */
export default function Groceries() {
  const { state } = useLocation();
  const [items, setItems] = useState(null);
  const [text, setText] = useState('');
  const [putAway, setPutAway] = useState(true);
  const [message, setMessage] = useState(state?.added != null
    ? `${state.added} thing${state.added === 1 ? '' : 's'} from the week's meals.${state.check?.length ? ` You have some ${state.check.join(', ')}: check there's enough.` : ''}` : '');
  const load = useCallback(() => { axios.get('/api/kitchen/grocery').then(({ data }) => setItems(data)).catch(() => setItems([])); }, []);
  useEffect(() => { load(); }, [load]);
  if (!items) return null;
  const add = async (e) => {
    e.preventDefault();
    try {
      const { data } = await axios.post('/api/kitchen/grocery', { label: text });
      setItems(data);
      setText('');
    } catch (err) {
      setMessage(errorMessage(err, "Couldn't add it"));
    }
  };
  const tick = async (g) => { const { data } = await axios.post(`/api/kitchen/grocery/${g.id}/tick`, { done: !g.done, put_away: putAway }); setItems(data); };
  const remove = async (g) => { await axios.delete(`/api/kitchen/grocery/${g.id}`).catch(() => {}); load(); };
  const clearDone = async () => { const { data } = await axios.post('/api/kitchen/grocery/clear-done'); setItems(data); };
  const low = async () => {
    const { data } = await axios.post('/api/kitchen/grocery/from-pantry-low');
    setItems(data.items);
    setMessage(data.added ? `Added ${data.added} thing${data.added === 1 ? '' : 's'} running low in the pantry.` : 'Nothing in the pantry is running low.');
  };
  const open = items.filter((g) => !g.done);
  const done = items.filter((g) => g.done);
  const aisles = [...new Set(open.map((g) => g.aisle || 'Everything else'))];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-xl font-semibold text-life-800 dark:text-life-50">Groceries</h1>
        <button type="button" onClick={low} className={quietButtonClass}>Add what's running low</button>
      </div>
      {message && <p className="rounded-lg bg-life-50 px-3 py-2 text-sm text-life-800 dark:bg-life-800 dark:text-life-100">{message}</p>}
      <form onSubmit={add} className="flex gap-2">
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Add something: 2 lb chicken thighs" aria-label="Add to the list" className={inputClass} />
        <button type="submit" disabled={!text.trim()} className={buttonClass}>Add</button>
      </form>
      <div className={cardClass}>
        {open.length === 0 ? <p className="py-4 text-center text-sm text-gray-500 dark:text-life-200">Nothing to buy. Plan the week and press "Make the grocery list", or add things here.</p> : aisles.map((aisle) => (
          <div key={aisle} className="mb-3 last:mb-0">
            {aisles.length > 1 && <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-life-600 dark:text-life-300">{aisle}</h2>}
            <ul className="divide-y divide-life-50 dark:divide-life-700">
              {open.filter((g) => (g.aisle || 'Everything else') === aisle).map((g) => (
                <li key={g.id} className="flex items-center gap-3 py-2">
                  <input type="checkbox" checked={false} onChange={() => tick(g)} aria-label={`Got ${g.label}`} className="h-5 w-5 accent-life-600" />
                  <span className="flex-1 text-sm">
                    <span className="text-gray-800 dark:text-life-50">{g.label}</span>
                    {g.amount && <span className="ml-2 text-gray-500 dark:text-life-300">{g.amount}</span>}
                    {g.note && <span className="block text-xs text-gray-400">{g.note}</span>}
                  </span>
                  <button type="button" onClick={() => remove(g)} className="text-xs text-gray-400 hover:text-red-600" aria-label={`Remove ${g.label}`}>✕</button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-life-200">
        <input type="checkbox" checked={putAway} onChange={(e) => setPutAway(e.target.checked)} className="accent-life-600" /> Ticking something off adds it to the pantry
      </label>
      {done.length > 0 && (
        <div className={cardClass}>
          <div className="mb-1 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-500 dark:text-life-300">Got it ({done.length})</h2>
            <button type="button" onClick={clearDone} className="text-xs text-life-600 hover:underline dark:text-life-200">Clear these</button>
          </div>
          <ul>
            {done.map((g) => (
              <li key={g.id} className="flex items-center gap-3 py-1">
                <input type="checkbox" checked onChange={() => tick(g)} aria-label={`Not got ${g.label}`} className="h-5 w-5 accent-life-600" />
                <span className="text-sm text-gray-400 line-through">{g.label} {g.amount}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
