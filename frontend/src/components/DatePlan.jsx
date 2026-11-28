import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { cardClass, errorMessage, fromDateInput, inputClass, quietButtonClass } from './ui';

const DRAFT_API = '/api/plans/holidays/from-date';

/**
 * A birthday or other yearly date on the calendar, opened as a plan. It shows the starting points and the parts a plan
 * has, but nothing is saved while the person only looks. The moment they check a part, pick a starting point or add
 * something to do, the date becomes a yearly plan (the server does that) and the page moves to that plan's address.
 */
export default function DatePlan({ eventId, parts }) {
  const navigate = useNavigate();
  const [draft, setDraft] = useState(undefined);
  const [starts, setStarts] = useState([]);
  const [task, setTask] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    axios.get(`${DRAFT_API}/${eventId}`).then(({ data }) => {
      if (data.plan_id) navigate(`/plans/${data.plan_id}`, { replace: true });
      else setDraft(data);
    }).catch(() => setDraft(null));
    axios.get('/api/plans/starts').then(({ data }) => setStarts(data)).catch(() => setStarts([]));
  }, [eventId, navigate]);
  if (draft === undefined) return null;
  if (draft === null) return <p className="text-sm text-gray-500 dark:text-life-300">That date isn't here anymore. It may have been deleted. <Link to="/plans" className="underline">All plans</Link></p>;

  const begin = async (body) => {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const { data } = await axios.post(`${DRAFT_API}/${eventId}`, body);
      navigate(`/plans/${data.id}`, { replace: true });
    } catch (err) { setError(errorMessage(err, "Couldn't start the plan")); setBusy(false); }
  };
  const when = fromDateInput(draft.day).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const addTask = (e) => { e.preventDefault(); if (task.trim()) begin({ parts: [], task }); };
  return (
    <div className="space-y-4">
      <Link to="/plans" className="text-sm text-life-600 hover:underline dark:text-life-200">← Plans</Link>
      <div>
        <h1 className="text-2xl font-semibold text-life-800 dark:text-life-50">{draft.name}</h1>
        <p className="text-sm text-gray-600 dark:text-life-200">{when}</p>
        <p className="text-sm text-gray-600 dark:text-life-200">Yearly{draft.years ? ` · turning ${draft.years}` : ''}</p>
        {draft.note && <p className="mt-1 whitespace-pre-wrap text-sm text-gray-700 dark:text-life-100">{draft.note}</p>}
      </div>
      <p className="rounded-lg bg-life-50 px-3 py-2 text-sm text-gray-700 dark:bg-life-800 dark:text-life-100">
        Nothing is saved yet. Pick a starting point, check a part or add something to do, and this date becomes a yearly plan.
      </p>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {starts.length > 0 && (
        <section className={cardClass} aria-label="Starting points">
          <h2 className="mb-2 font-semibold text-life-800 dark:text-life-50">Start from</h2>
          <div className="grid grid-cols-2 gap-2">
            {starts.filter((s) => !s.longer).map((s) => (
              <button key={s.key} type="button" disabled={busy} onClick={() => begin({ start: s.key })}
                className="min-h-[44px] rounded-lg border border-life-200 px-3 text-left text-sm text-gray-700 hover:bg-life-50 dark:border-life-600 dark:text-life-100 dark:hover:bg-life-800">
                <span className="block font-medium">{s.label}</span>
                <span className="block text-xs text-gray-500 dark:text-life-300">{s.parts.join(', ')}</span>
              </button>
            ))}
          </div>
        </section>
      )}
      <section className={cardClass} aria-label="Parts of this plan">
        <h2 className="mb-1 font-semibold text-life-800 dark:text-life-50">Parts of this plan</h2>
        <p className="text-sm text-gray-600 dark:text-life-200">Check what this plan needs.</p>
        <ul>
          {parts.map(([key, label]) => (
            <li key={key}>
              <label className="flex min-h-[44px] items-center gap-3 text-sm text-gray-800 dark:text-life-50">
                <input type="checkbox" checked={false} disabled={busy} onChange={() => begin({ parts: [key] })} className="h-5 w-5 accent-life-600" />
                <span className="flex-1">{label}</span>
              </label>
            </li>
          ))}
        </ul>
      </section>
      <section className={cardClass} aria-label="Something to do">
        <h2 className="mb-2 font-semibold text-life-800 dark:text-life-50">Helpers and tasks</h2>
        <form onSubmit={addTask} className="flex gap-2">
          <input value={task} onChange={(e) => setTask(e.target.value)} placeholder="Something to do" aria-label="Something to do" className={inputClass} />
          <button type="submit" disabled={busy} className={`${quietButtonClass} min-h-[44px]`}>Add</button>
        </form>
      </section>
      <p className="text-xs text-gray-500 dark:text-life-300">The date stays on <Link to="/calendar" className="underline">the calendar</Link> as it is.</p>
    </div>
  );
}
