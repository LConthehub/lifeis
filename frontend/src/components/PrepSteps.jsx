import { useEffect, useState } from 'react';
import axios from 'axios';
import Modal, { Field, inputClass, buttonClass, quietButtonClass, cardClass, errorMessage } from './ui';

/**
 * Prep reminders: "Thaw the chicken", and when, counted back from when the meal is eaten. Kept on a recipe (so
 * every time it is planned) or on one planned meal. The times are worked out on the server (core/src/prep.ts).
 */

const RULES = [
  { value: 'night_before', label: 'The night before' },
  { value: 'morning_of', label: 'The morning of' },
  { value: 'hours_before', label: 'Hours before' },
];
const blank = () => ({ words: '', rule: 'night_before', at: '20:00', hours: '' });
const fromServer = (s) => ({ words: s.words, rule: s.rule, at: s.at || (s.rule === 'morning_of' ? '07:00' : '20:00'), hours: s.hours ?? '' });
const toServer = (s) => ({ words: s.words, rule: s.rule, at: s.rule === 'hours_before' ? null : s.at, hours: s.rule === 'hours_before' ? Number(s.hours) : null });

/** The list of steps, each with its words, when, and a way to remove it. */
export function PrepEditor({ steps, onChange }) {
  const change = (i, patch) => onChange(steps.map((s, at) => (at === i ? { ...s, ...patch } : s)));
  const pick = (i, rule) => change(i, { rule, at: rule === 'morning_of' ? '07:00' : '20:00', hours: rule === 'hours_before' ? (steps[i].hours || 3) : '' });
  return (
    <div className="space-y-3">
      {steps.length === 0 && <p className="text-sm text-gray-500 dark:text-life-300">No prep steps yet.</p>}
      {steps.map((s, i) => (
        <div key={i} className="space-y-2 rounded-lg bg-life-50/70 p-2 dark:bg-life-700/60" data-prep-step>
          <input value={s.words} onChange={(e) => change(i, { words: e.target.value })} placeholder="Thaw the chicken" aria-label="What to do" className={inputClass} />
          <div className="flex flex-wrap items-center gap-2">
            <select value={s.rule} onChange={(e) => pick(i, e.target.value)} aria-label="When" className={`${inputClass} w-auto min-h-[44px]`}>
              {RULES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
            {s.rule === 'hours_before'
              ? <label className="flex items-center gap-1 text-sm">
                <input type="number" min="1" max="72" step="1" value={s.hours} onChange={(e) => change(i, { hours: e.target.value })} aria-label="Hours before" className={`${inputClass} w-20 min-h-[44px]`} /> hours before
              </label>
              : <label className="flex items-center gap-1 text-sm">
                at <input type="time" value={s.at} onChange={(e) => change(i, { at: e.target.value })} aria-label="Time of day" className={`${inputClass} w-auto min-h-[44px]`} />
              </label>}
            <button type="button" onClick={() => onChange(steps.filter((_, at) => at !== i))} className="ml-auto min-h-[44px] px-3 text-sm text-red-700 hover:underline dark:text-red-300">Remove</button>
          </div>
        </div>
      ))}
      <button type="button" onClick={() => onChange([...steps, blank()])} className={`${quietButtonClass} min-h-[44px]`}>+ Add a prep step</button>
    </div>
  );
}

/** A recipe's prep steps, and a way to change them. They apply every time the recipe is planned. */
export function RecipePrep({ recipeId }) {
  const [steps, setSteps] = useState(null);
  const [editing, setEditing] = useState(false);
  const load = () => axios.get(`/api/prep/recipes/${recipeId}`).then(({ data }) => setSteps(data)).catch(() => setSteps([]));
  useEffect(() => { load(); }, [recipeId]); // eslint-disable-line react-hooks/exhaustive-deps
  if (steps === null) return null;
  return (
    <section className={cardClass} data-section="prep">
      <div className="mb-1 flex items-center gap-2">
        <h2 className="flex-1 font-semibold text-life-800 dark:text-life-50">Prep reminders</h2>
        <button type="button" onClick={() => setEditing(true)} className={`${quietButtonClass} min-h-[44px]`}>{steps.length ? 'Change' : 'Add'}</button>
      </div>
      {steps.length === 0
        ? <p className="text-sm text-gray-500 dark:text-life-300">Things to do ahead, like thawing the chicken the night before. Each time this recipe is on the week, Life Is reminds you.</p>
        : <ul className="space-y-1 text-sm text-gray-800 dark:text-life-50">{steps.map((s) => <li key={s.id}>{s.words}: <span className="text-gray-600 dark:text-life-200">{s.when}</span></li>)}</ul>}
      {editing && (
        <Modal title="Prep reminders" onClose={() => setEditing(false)}>
          <SaveSteps start={steps.map(fromServer)} address={`/api/prep/recipes/${recipeId}`} onSaved={(saved) => { setSteps(saved); setEditing(false); }}
            hint="Counted back from when the meal is eaten. They go to you each time this recipe is on the week." />
        </Modal>
      )}
    </section>
  );
}

function SaveSteps({ start, address, onSaved, hint }) {
  const [steps, setSteps] = useState(start);
  const [error, setError] = useState('');
  const save = async (e) => {
    e.preventDefault();
    try {
      const { data } = await axios.put(address, { steps: steps.map(toServer) });
      onSaved(data);
    } catch (err) { setError(errorMessage(err, "Couldn't save")); }
  };
  return (
    <form onSubmit={save} className="space-y-3">
      <p className="text-xs text-gray-500 dark:text-life-300">{hint}</p>
      <PrepEditor steps={steps} onChange={setSteps} />
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex justify-end"><button type="submit" className={`${buttonClass} min-h-[44px]`}>Save</button></div>
    </form>
  );
}

/** One planned meal: when it is eaten, and prep just for this time (the recipe's own steps are shown but changed on the recipe). */
export function MealPrep({ meal, onDone }) {
  const [info, setInfo] = useState(null);
  const [eat, setEat] = useState('');
  const [steps, setSteps] = useState([]);
  const [error, setError] = useState('');
  useEffect(() => {
    axios.get(`/api/prep/meals/${meal.id}`).then(({ data }) => { setInfo(data); setEat(data.eat_time || ''); setSteps(data.steps.map(fromServer)); }).catch(() => setError("Couldn't load this meal"));
  }, [meal.id]);
  const save = async (e) => {
    e.preventDefault();
    try {
      await axios.put(`/api/prep/meals/${meal.id}`, { eat_time: eat || null, steps: steps.map(toServer) });
      onDone();
    } catch (err) { setError(errorMessage(err, "Couldn't save")); }
  };
  if (!info) return error ? <p className="text-sm text-red-600">{error}</p> : null;
  return (
    <form onSubmit={save} className="space-y-3">
      <Field label="Time to eat">
        <div className="flex items-center gap-2">
          <input type="time" value={eat} onChange={(e) => setEat(e.target.value)} aria-label="Time to eat" className={`${inputClass} w-auto min-h-[44px]`} />
          {eat && <button type="button" onClick={() => setEat('')} className="min-h-[44px] px-2 text-sm text-life-600 hover:underline dark:text-life-200">Use the usual</button>}
        </div>
        <span className="text-xs text-gray-500 dark:text-life-300">Left empty, it is {info.default_eat_time} (the usual for {info.meal}). Prep is counted back from this.</span>
      </Field>
      {info.recipe_steps.length > 0 && (
        <div className="text-sm">
          <p className="font-medium text-life-800 dark:text-life-50">From the recipe</p>
          <ul className="mt-1 space-y-0.5 text-gray-700 dark:text-life-100">{info.recipe_steps.map((s) => <li key={s.id}>{s.words}: {s.when}</li>)}</ul>
        </div>
      )}
      <p className="font-medium text-life-800 dark:text-life-50">Just for this time</p>
      <PrepEditor steps={steps} onChange={setSteps} />
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex justify-end"><button type="submit" className={`${buttonClass} min-h-[44px]`}>Save</button></div>
    </form>
  );
}
