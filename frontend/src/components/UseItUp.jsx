import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import { Field, inputClass, buttonClass, quietButtonClass, cardClass, errorMessage, toDateInput } from './ui';

const MEALS = [['dinner', 'Dinner'], ['lunch', 'Lunch'], ['breakfast', 'Breakfast'], ['snack', 'Snack']];
/** "the cream and the spinach" */
const theList = (names) => {
  const named = names.map((n) => `the ${n.toLowerCase()}`);
  return named.length < 2 ? named.join('') : `${named.slice(0, -1).join(', ')} and ${named[named.length - 1]}`;
};
const nextDays = () => [...Array(14)].map((_, i) => {
  const d = new Date(); d.setDate(d.getDate() + i);
  return [toDateInput(d), `${i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : d.toLocaleDateString(undefined, { weekday: 'long' })}, ${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`];
});

/** Recipes for what is about to run out (use-by within five days, or past), each with a way to put it on the week. */
export default function UseItUp() {
  const [data, setData] = useState(null);
  const [choosing, setChoosing] = useState(null);
  const [form, setForm] = useState({ day: toDateInput(new Date()), meal: 'dinner' });
  const [said, setSaid] = useState('');
  useEffect(() => { axios.get('/api/kitchen/use-it-up', { params: { days: 5 } }).then(({ data: d }) => setData(d)).catch(() => setData({ soon: [], suggestions: [] })); }, []);
  if (!data || data.soon.length === 0) return null;
  const put = async (e, s) => {
    e.preventDefault();
    try {
      await axios.post('/api/kitchen/plan', { day: form.day, meal: form.meal, recipe_id: s.recipe_id, servings: null });
      const label = nextDays().find(([d]) => d === form.day)?.[1] ?? form.day;
      setSaid(`${s.title} is on the week for ${label}.`); setChoosing(null);
    } catch (err) { setSaid(errorMessage(err, "Couldn't put it on the week")); }
  };
  return (
    <section className={cardClass} data-use-it-up>
      <h2 className="font-semibold text-life-800 dark:text-life-50">Use it up</h2>
      <p className="mb-2 text-xs text-gray-500 dark:text-life-300">Going off within five days: {data.soon.map((s) => `${s.name} (${s.days_left < 0 ? 'past its date' : s.days_left === 0 ? 'today' : s.days_left === 1 ? 'tomorrow' : `${s.days_left} days`})`).join(', ')}.</p>
      {said && <p className="mb-2 rounded-lg bg-life-50 px-3 py-2 text-sm text-life-800 dark:bg-life-700 dark:text-life-50" role="status">{said}</p>}
      {data.suggestions.length === 0 ? <p className="text-sm text-gray-500 dark:text-life-300">None of your recipes uses {theList(data.soon.map((s) => s.name))} yet.</p> : (
        <ul className="divide-y divide-life-50 dark:divide-life-700">
          {data.suggestions.map((s) => (
            <li key={s.recipe_id} className="space-y-1 py-2">
              <p className="text-sm"><Link to={`/recipes/${s.recipe_id}`} className="font-medium text-life-800 hover:underline dark:text-life-50">{s.title}</Link></p>
              <p className="text-xs text-gray-600 dark:text-life-200">Uses {theList(s.uses)}{s.other_total > 0 ? `. You have ${s.have_others} of its ${s.other_total} other ingredient${s.other_total === 1 ? '' : 's'}.` : '.'}</p>
              {choosing === s.recipe_id ? (
                <form onSubmit={(e) => put(e, s)} className="grid grid-cols-2 gap-2">
                  <Field label="Day"><select value={form.day} onChange={(e) => setForm({ ...form, day: e.target.value })} className={`${inputClass} min-h-[44px]`}>{nextDays().map(([d, label]) => <option key={d} value={d}>{label}</option>)}</select></Field>
                  <Field label="Meal"><select value={form.meal} onChange={(e) => setForm({ ...form, meal: e.target.value })} className={`${inputClass} min-h-[44px]`}>{MEALS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></Field>
                  <div className="col-span-2 flex justify-end gap-2">
                    <button type="button" onClick={() => setChoosing(null)} className={`${quietButtonClass} min-h-[44px]`}>Not now</button>
                    <button type="submit" className={`${buttonClass} min-h-[44px]`}>Put it on the week</button>
                  </div>
                </form>
              ) : <button type="button" onClick={() => setChoosing(s.recipe_id)} className={`${quietButtonClass} min-h-[44px]`} aria-label={`Put ${s.title} on the week`}>Put it on the week</button>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
