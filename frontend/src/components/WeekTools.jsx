import { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import { Field, inputClass, buttonClass, quietButtonClass, errorMessage, toDateInput, fromDateInput } from './ui';

/** The Monday of the week a day is in. */
export const mondayOf = (d) => { const day = new Date(d); day.setDate(day.getDate() - ((day.getDay() + 6) % 7)); return day; };
const plusDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const weekName = (d) => `the week of ${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
const meals = (n) => `${n} meal${n === 1 ? '' : 's'}`;

/** What copying or using a template did, in a sentence or two: how many were added, how many days already had something. */
export function copiedMessage(result, weekStart) {
  if (result.added === 0 && result.already === 0 && result.missing?.length === 0) return 'There was nothing to copy.';
  const parts = [result.added === 0 ? `Nothing was added to ${weekName(weekStart)}` : `Added ${meals(result.added)} to ${weekName(weekStart)}`];
  if (result.days_with_meals > 0 && result.added > 0) parts.push(`${result.days_with_meals} of those days already had something, and what was there was kept`);
  if (result.already > 0) parts.push(`${meals(result.already)} ${result.already === 1 ? 'was' : 'were'} already there, so ${result.already === 1 ? 'it was' : 'they were'} not added twice`);
  if (result.missing?.length) parts.push(`${result.missing.join(', ')} ${result.missing.length === 1 ? 'is' : 'are'} not in your recipes any more, so left out`);
  return `${parts.join('. ')}.`;
}

/** "Copy this week to…": this week's meals added beside whatever another week already has. */
export function CopyWeek({ start, onDone }) {
  const [pick, setPick] = useState(toDateInput(plusDays(start, 7)));
  const [error, setError] = useState('');
  const target = mondayOf(fromDateInput(pick));
  const same = toDateInput(target) === toDateInput(start);
  const go = async (e) => {
    e.preventDefault();
    try {
      const { data } = await axios.post('/api/kitchen/plan/copy', { from: toDateInput(start), to: toDateInput(target) });
      onDone(copiedMessage(data, target), target);
    } catch (err) { setError(errorMessage(err, "Couldn't copy the week")); }
  };
  return (
    <form onSubmit={go} className="space-y-3">
      <p className="text-sm text-gray-700 dark:text-life-100">Every meal of {weekName(start)} is added to the same days of another week. Meals already there stay, and copies are never marked as cooked.</p>
      <div className="flex flex-wrap gap-2">
        {[['Next week', 7], ['In two weeks', 14], ['Last week', -7]].map(([label, n]) => (
          <button key={label} type="button" onClick={() => setPick(toDateInput(plusDays(start, n)))} className={`${quietButtonClass} min-h-[44px]`}>{label}</button>
        ))}
      </div>
      <Field label="Or any day in the week to copy to"><input type="date" value={pick} onChange={(e) => setPick(e.target.value)} className={`${inputClass} min-h-[44px]`} /></Field>
      <p className="text-sm text-gray-600 dark:text-life-200">Copying to {weekName(target)}.</p>
      {same && <p className="text-sm text-red-600">That is the week you are looking at. Choose another.</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex justify-end"><button type="submit" disabled={same || !pick} className={`${buttonClass} min-h-[44px]`}>Copy the meals</button></div>
    </form>
  );
}

/** Weeks kept under a name: save the one shown, use one on any week, rename, delete. */
export function Templates({ start, onDone }) {
  const [list, setList] = useState(null);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [pick, setPick] = useState(toDateInput(start));
  const [renaming, setRenaming] = useState(null);
  const [asking, setAsking] = useState(null);
  const load = useCallback(() => axios.get('/api/kitchen/plan/templates').then(({ data }) => setList(data)).catch(() => setList([])), []);
  useEffect(() => { load(); }, [load]);
  const target = mondayOf(fromDateInput(pick));
  const fail = (err, what) => setError(errorMessage(err, what));
  const save = async (e) => {
    e.preventDefault(); setError('');
    try { const { data } = await axios.post('/api/kitchen/plan/templates', { start: toDateInput(start), name }); setList(data); setName(''); } catch (err) { fail(err, "Couldn't save it"); }
  };
  const use = async (t) => {
    setError('');
    try { const { data } = await axios.post(`/api/kitchen/plan/templates/${t.id}/use`, { start: toDateInput(target) }); onDone(copiedMessage(data, target), target); } catch (err) { fail(err, "Couldn't use it"); }
  };
  const rename = async (e) => {
    e.preventDefault(); setError('');
    try { const { data } = await axios.put(`/api/kitchen/plan/templates/${renaming.id}`, { name: renaming.name }); setList(data); setRenaming(null); } catch (err) { fail(err, "Couldn't rename it"); }
  };
  const remove = async (t) => { try { const { data } = await axios.delete(`/api/kitchen/plan/templates/${t.id}`); setList(data); setAsking(null); } catch (err) { fail(err, "Couldn't delete it"); } };
  if (!list) return null;
  return (
    <div className="space-y-4">
      <form onSubmit={save} className="space-y-2">
        <Field label={`Save ${weekName(start)} as a template`}>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="School week, Holiday" className={`${inputClass} min-h-[44px]`} />
        </Field>
        <button type="submit" disabled={!name.trim()} className={`${buttonClass} min-h-[44px]`}>Save this week as a template</button>
      </form>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="border-t border-life-100 pt-3 dark:border-life-700">
        <h3 className="mb-1 text-sm font-semibold text-life-800 dark:text-life-50">Use a template</h3>
        {list.length === 0 ? <p className="text-sm text-gray-500 dark:text-life-300">None yet. Plan a week you like, then save it here to use again.</p> : (
          <>
            <Field label="On the week of (pick any day in it)"><input type="date" value={pick} onChange={(e) => setPick(e.target.value)} className={`${inputClass} min-h-[44px]`} /></Field>
            <ul className="mt-2 divide-y divide-life-50 dark:divide-life-700">
              {list.map((t) => (
                <li key={t.id} className="space-y-1 py-2" data-template={t.name}>
                  {renaming?.id === t.id ? (
                    <form onSubmit={rename} className="flex gap-2">
                      <input value={renaming.name} onChange={(e) => setRenaming({ ...renaming, name: e.target.value })} aria-label="New name" className={`${inputClass} min-h-[44px]`} />
                      <button type="submit" className={`${buttonClass} min-h-[44px]`}>Save</button>
                    </form>
                  ) : (
                    <p className="text-sm"><span className="font-medium text-gray-800 dark:text-life-50">{t.name}</span> <span className="text-xs text-gray-500 dark:text-life-300">· {meals(t.meals.length)}</span></p>
                  )}
                  {t.missing.length > 0 && <p className="text-xs text-honey-700">{t.missing.join(', ')} {t.missing.length === 1 ? 'is' : 'are'} not in your recipes any more. The rest still goes on the week.</p>}
                  <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={() => use(t)} className={`${quietButtonClass} min-h-[44px]`} aria-label={`Use ${t.name}`}>Use it</button>
                    <button type="button" onClick={() => setRenaming({ id: t.id, name: t.name })} className={`${quietButtonClass} min-h-[44px]`} aria-label={`Rename ${t.name}`}>Rename</button>
                    {asking === t.id
                      ? <button type="button" onClick={() => remove(t)} className="min-h-[44px] rounded-lg border border-red-300 px-3 text-sm text-red-700" aria-label={`Really delete ${t.name}`}>Really delete</button>
                      : <button type="button" onClick={() => setAsking(t.id)} className={`${quietButtonClass} min-h-[44px]`} aria-label={`Delete ${t.name}`}>Delete</button>}
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
