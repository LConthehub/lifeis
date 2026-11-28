import { useEffect, useState } from 'react';
import axios from 'axios';
import { Field, inputClass, quietButtonClass, cardClass } from './ui';

const tall = `${inputClass} min-h-[44px]`;
const iconButton = 'flex h-11 w-11 flex-none items-center justify-center rounded-lg text-gray-500 hover:bg-life-50 hover:text-life-800 disabled:opacity-30 dark:text-life-300 dark:hover:bg-life-800';

const dueWords = (due) => (due.state === 'overdue' ? 'late' : due.state === 'unscheduled' ? '' : due.days_left === null ? '' : due.days_left === 0 ? 'due today' : due.days_left > 0 ? `due in ${due.days_left} ${due.days_left === 1 ? 'day' : 'days'}` : '');

/**
 * Choose one of your upkeep jobs to put on the plan as a line that links to it. The job stays in Upkeep: marking it done
 * there shows the line done here, and checking the line marks the job done. Taking the line off never removes the job.
 */
export function JobPicker({ plan, onPick }) {
  const [jobs, setJobs] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { axios.get('/api/things/upkeep').then(({ data }) => setJobs(data)).catch(() => setJobs([])); }, []);
  if (!jobs) return null;
  const taken = new Set(plan.items_list.filter((i) => i.job_id !== null).map((i) => i.job_id));
  const free = jobs.filter((j) => !taken.has(j.id));
  if (free.length === 0) return <p className="text-sm text-gray-600 dark:text-life-100">{jobs.length === 0 ? "You have no upkeep jobs yet. Add one in Upkeep first." : 'Every one of your upkeep jobs is already on this plan.'}</p>;
  return (
    <div className="space-y-2">
      <p className="text-sm text-gray-600 dark:text-life-100">Pick a job. It goes on the plan as a line that links to it. Checking the line marks the job done in Upkeep, and the other way round.</p>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <ul className="max-h-[55vh] divide-y divide-life-100 overflow-y-auto dark:divide-life-700">
        {free.map((j) => (
          <li key={j.id}>
            <button type="button" onClick={async () => { const ok = await onPick(j.id); if (!ok) setError("Couldn't add it"); }} className="flex min-h-[44px] w-full items-center gap-2 px-1 text-left text-sm text-gray-800 hover:bg-life-50 dark:text-life-50 dark:hover:bg-life-800">
              <span className="min-w-0 flex-1">{j.name}</span>
              {dueWords(j.due) && <span className="flex-none text-xs text-gray-500 dark:text-life-300">{dueWords(j.due)}</span>}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** A plan's times as words: "15:30 to 18:00", "15:30", or nothing. */
export const timesText = (plan) => (plan.start_time ? (plan.end_time ? `${plan.start_time} to ${plan.end_time}` : plan.start_time) : '');

/**
 * When and where: a start time, an optional end time and a place, all in the person's own words. Nothing is looked up,
 * mapped or sent. Each is saved when its box is left.
 */
export function WhenWhere({ plan, act }) {
  const save = (patch) => act(() => axios.put(`/api/plans/${plan.id}/when-where`, patch));
  const timeBox = (field, label) => (
    <Field label={label}>
      <input type="time" key={`${field}:${plan[field] ?? 'none'}`} defaultValue={plan[field] ?? ''} disabled={field === 'end_time' && !plan.start_time}
        onBlur={(e) => (e.target.value || null) !== plan[field] && save({ [field]: e.target.value || null })} className={tall} />
    </Field>
  );
  return (
    <section className={`${cardClass} space-y-3`} aria-label="When and where">
      <h2 className="font-semibold text-life-800 dark:text-life-50">When and where</h2>
      <div className="grid grid-cols-2 gap-3">
        {timeBox('start_time', 'Starts at')}
        {timeBox('end_time', 'Ends at (if you know)')}
      </div>
      <Field label="Where">
        <input key={plan.place ?? 'none'} defaultValue={plan.place ?? ''} maxLength={200} placeholder="In your own words: Aunt Ruth's back yard"
          onBlur={(e) => (e.target.value.trim() || null) !== plan.place && save({ place: e.target.value })} className={tall} />
      </Field>
      <p className="text-xs text-gray-500 dark:text-life-300">Kept here as you write it. Nothing is looked up or sent anywhere.</p>
    </section>
  );
}

/**
 * Traditions: short lines of what is always done ("Grandpa carves"). Add, reword (change the words and leave the box),
 * reorder, check off for this year, and remove. On a yearly plan, next year starts with the same lines, unchecked.
 */
export function Traditions({ plan, act }) {
  const [words, setWords] = useState('');
  const lines = plan.traditions;
  const add = async (e) => {
    e.preventDefault();
    if (!words.trim()) return;
    if (await act(() => axios.post(`/api/plans/${plan.id}/traditions`, { words }))) setWords('');
  };
  return (
    <section className={cardClass} aria-label="Traditions">
      <h2 className="mb-1 font-semibold text-life-800 dark:text-life-50">
        Traditions {lines.length > 0 && <span className="text-sm font-normal text-gray-500 dark:text-life-300">{lines.filter((l) => l.done).length} of {lines.length}</span>}
      </h2>
      {lines.length === 0 && <p className="mb-2 text-sm text-gray-500 dark:text-life-300">The things you always do, in a few words: "Grandpa carves", "Kids pick the movie".{plan.yearly ? ' Next year starts with the same lines, unchecked.' : ''}</p>}
      <ul>
        {lines.map((l, n) => (
          <li key={`${l.id}:${l.words}`} className="flex flex-wrap items-center gap-1" data-tradition>
            <input type="checkbox" checked={l.done} onChange={(e) => act(() => axios.put(`/api/plans/traditions/${l.id}`, { done: e.target.checked }))} aria-label={`${l.words} is done`} className="m-3 h-5 w-5 flex-none accent-life-600" />
            <input defaultValue={l.words} maxLength={200} aria-label={`Reword ${l.words}`}
              onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== l.words) act(() => axios.put(`/api/plans/traditions/${l.id}`, { words: v })); else e.target.value = l.words; }}
              className={`${tall} min-w-0 flex-1 basis-32 ${l.done ? 'text-gray-400 line-through' : ''}`} />
            <span className="flex flex-none">
              <button type="button" disabled={n === 0} onClick={() => act(() => axios.post(`/api/plans/traditions/${l.id}/move`, { direction: 'up' }))} aria-label={`Move ${l.words} up`} className={iconButton}>↑</button>
              <button type="button" disabled={n === lines.length - 1} onClick={() => act(() => axios.post(`/api/plans/traditions/${l.id}/move`, { direction: 'down' }))} aria-label={`Move ${l.words} down`} className={iconButton}>↓</button>
              <button type="button" onClick={() => act(() => axios.delete(`/api/plans/traditions/${l.id}`))} aria-label={`Remove ${l.words}`} className={`${iconButton} hover:text-red-600`}>×</button>
            </span>
          </li>
        ))}
      </ul>
      <form onSubmit={add} className="mt-2 flex gap-2">
        <input value={words} onChange={(e) => setWords(e.target.value)} maxLength={200} placeholder="Something you always do" aria-label="Something you always do" className={tall} />
        <button type="submit" className={`${quietButtonClass} min-h-[44px]`}>Add</button>
      </form>
    </section>
  );
}

