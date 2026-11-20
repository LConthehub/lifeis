import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import axios from 'axios';
import Modal, { Field, inputClass, buttonClass, quietButtonClass, cardClass, errorMessage, toDateInput, fromDateInput } from '../components/ui';

const MEALS = ['breakfast', 'lunch', 'dinner', 'snack'];
const cap = (s) => s[0].toUpperCase() + s.slice(1);

function startOfWeek(d) {
  const day = new Date(d);
  day.setDate(day.getDate() - ((day.getDay() + 6) % 7));    // weeks start on Monday
  return day;
}

/** The week's meals, a day at a time, and the button that turns them into a grocery list. */
export default function Week() {
  const [start, setStart] = useState(() => startOfWeek(new Date()));
  const [meals, setMeals] = useState(null);
  const [adding, setAdding] = useState(null);
  const [message, setMessage] = useState('');
  // Meals whose recipes need more of a pan or dish than there is.
  const [short, setShort] = useState([]);
  const navigate = useNavigate();
  const startText = toDateInput(start);
  const load = useCallback(() => {
    axios.get('/api/kitchen/plan', { params: { start: startText, days: 7 } }).then(({ data }) => setMeals(data)).catch(() => setMeals([]));
    axios.get('/api/kitchen/equipment', { params: { start: startText, days: 7 } }).then(({ data }) => setShort(data)).catch(() => setShort([]));
  }, [startText]);
  useEffect(() => { load(); }, [load]);
  const move = (days) => { const d = new Date(start); d.setDate(d.getDate() + days); setStart(d); };
  const days = [...Array(7)].map((_, i) => { const d = new Date(start); d.setDate(d.getDate() + i); return d; });
  const today = toDateInput(new Date());
  const cooked = async (m) => {
    const { data } = await axios.post(`/api/kitchen/plan/${m.id}/cooked`).catch((err) => ({ data: { error: errorMessage(err, "Couldn't save") } }));
    setMessage(data.error || (data.check_by_hand?.length ? `Taken out of the pantry. Check these by hand: ${data.check_by_hand.join(', ')}.` : 'Taken out of the pantry.'));
    load();
  };
  const remove = async (m) => { await axios.delete(`/api/kitchen/plan/${m.id}`).catch(() => {}); load(); };
  const shop = async () => {
    try {
      const { data } = await axios.post('/api/kitchen/grocery/from-plan', { start: startText, days: 7 });
      navigate('/groceries', { state: { check: data.check, added: data.added } });
    } catch (err) {
      setMessage(errorMessage(err, "Couldn't make the list"));
    }
  };
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-xl font-semibold text-life-800 dark:text-life-50">The week</h1>
        <button type="button" onClick={() => move(-7)} className={quietButtonClass} aria-label="Week before">←</button>
        <button type="button" onClick={() => setStart(startOfWeek(new Date()))} className={quietButtonClass}>This week</button>
        <button type="button" onClick={() => move(7)} className={quietButtonClass} aria-label="Week after">→</button>
        <button type="button" onClick={shop} className={buttonClass}>Make the grocery list</button>
      </div>
      <p className="text-xs text-gray-500 dark:text-life-300">The grocery list is what these meals need, for the servings you planned, minus what's in your pantry.</p>
      {message && <p className="rounded-lg bg-life-50 px-3 py-2 text-sm text-life-800 dark:bg-life-800 dark:text-life-100">{message}</p>}
      {short.length > 0 && (
        <div className="rounded-lg bg-honey-100 px-3 py-2 text-sm text-honey-700">
          <p className="font-medium">Not enough to cook these at once:</p>
          <ul className="mt-1 space-y-0.5">
            {short.map((s) => (
              <li key={`${s.day}-${s.meal}-${s.label}`}>
                {fromDateInput(s.day).toLocaleDateString(undefined, { weekday: 'long' })} {s.meal}: {s.need} × {s.label}
                {s.have === null ? ", which isn't in your things" : `, and you have ${s.have}`} ({s.recipes.join(', ')})
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {days.map((d) => {
          const key = toDateInput(d);
          const todays = (meals || []).filter((m) => m.day === key);
          return (
            <section key={key} className={`${cardClass} ${key === today ? 'ring-2 ring-life-400' : ''}`}>
              <div className="mb-2 flex items-center justify-between">
                <h2 className="font-semibold text-life-800 dark:text-life-50">{d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}</h2>
                <button type="button" onClick={() => setAdding(key)} className="text-sm text-life-600 hover:underline dark:text-life-200">+ Add</button>
              </div>
              {todays.length === 0 ? <p className="text-xs text-gray-400">Nothing planned.</p> : (
                <ul className="space-y-2">
                  {todays.map((m) => (
                    <li key={m.id} className="flex items-start gap-2">
                      <span className="w-16 shrink-0 pt-0.5 text-xs text-gray-500 dark:text-life-300">{cap(m.meal)}</span>
                      <span className="flex-1 text-sm">
                        {m.recipe_id ? <Link to={`/recipes/${m.recipe_id}`} className="font-medium text-life-800 hover:underline dark:text-life-50">{m.recipe_title}</Link> : <span className="text-gray-800 dark:text-life-50">{m.title}</span>}
                        {m.servings && <span className="text-xs text-gray-500 dark:text-life-300"> · {m.servings} servings</span>}
                        {m.cooked_on && <span className="ml-1 text-xs text-life-600 dark:text-life-300">· cooked ✓</span>}
                      </span>
                      {m.recipe_id && !m.cooked_on && <button type="button" onClick={() => cooked(m)} className="text-xs text-life-600 hover:underline dark:text-life-200" title="Take what it used out of the pantry">Cooked</button>}
                      <button type="button" onClick={() => remove(m)} className="text-xs text-gray-400 hover:text-red-600" aria-label="Remove">✕</button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>
      {adding && (
        <Modal title={fromDateInput(adding).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })} onClose={() => setAdding(null)}>
          <AddMeal day={adding} onDone={() => { setAdding(null); load(); }} />
        </Modal>
      )}
    </div>
  );
}

function AddMeal({ day, onDone }) {
  const [recipes, setRecipes] = useState([]);
  const [form, setForm] = useState({ meal: 'dinner', recipe_id: '', title: '', servings: '' });
  const [error, setError] = useState('');
  useEffect(() => { axios.get('/api/kitchen/recipes').then(({ data }) => setRecipes(data)).catch(() => {}); }, []);
  const submit = async (e) => {
    e.preventDefault();
    try {
      await axios.post('/api/kitchen/plan', { day, meal: form.meal, recipe_id: form.recipe_id ? Number(form.recipe_id) : null, title: form.title,
        servings: form.servings === '' ? null : Number(form.servings) });
      onDone();
    } catch (err) {
      setError(errorMessage(err, "Couldn't add it"));
    }
  };
  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Meal">
          <select value={form.meal} onChange={(e) => setForm({ ...form, meal: e.target.value })} className={inputClass}>
            {MEALS.map((m) => <option key={m} value={m}>{cap(m)}</option>)}
          </select>
        </Field>
        <Field label="Servings"><input type="number" min="0.5" step="0.5" value={form.servings} onChange={(e) => setForm({ ...form, servings: e.target.value })} placeholder="As written" className={inputClass} /></Field>
      </div>
      <Field label="A recipe">
        <select value={form.recipe_id} onChange={(e) => setForm({ ...form, recipe_id: e.target.value })} className={inputClass}>
          <option value="">No recipe</option>
          {recipes.map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}
        </select>
      </Field>
      {!form.recipe_id && <Field label="Or just say what it is"><input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Leftovers, eating out, takeaway" className={inputClass} /></Field>}
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex justify-end"><button type="submit" className={buttonClass}>Add</button></div>
    </form>
  );
}
