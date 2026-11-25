import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import { money, toCents } from './Budget';
import { inputClass, buttonClass, quietButtonClass, cardClass, errorMessage } from './ui';

/*
 * Goals on plans, holidays, trips and projects, and the safe-to-spend number.
 * A goal is one thing, whether it belongs to a plan, a project or nothing. The bar is flat on purpose (no art, no
 * gradients) and always has its plain words under it: see docs/progress-bar-spec.md.
 */

const BAR = { done: 'bg-green-600', over: 'bg-red-600', behind: 'bg-amber-600', on_track: 'bg-life-500' };

/** A flat bar with its words under it. `progress` is what the server says about the goal. */
export function GoalProgress({ progress, name }) {
  const shown = progress.state === 'over' ? progress.spent : progress.put;
  const pct = progress.target > 0 ? Math.max(0, Math.min(100, Math.round((shown / progress.target) * 100))) : 0;
  return (
    <div data-progress={progress.state}>
      <div className="h-2 w-full bg-life-100 dark:bg-life-700" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={`${name || 'Goal'}, ${pct} percent`}>
        <div className={`h-full ${BAR[progress.state] || BAR.on_track}`} style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-1 text-sm text-gray-700 dark:text-life-100" data-progress-words>{progress.words}</p>
    </div>
  );
}

/** The month's safe-to-spend number. Tap it for the four lines it comes from. */
export function SafeToSpend({ safe }) {
  const [open, setOpen] = useState(false);
  const sign = safe.currency;
  const line = (label, cents, mark) => (
    <div className="flex items-baseline justify-between gap-2 py-1"><dt className="text-sm text-gray-600 dark:text-life-100">{label}</dt><dd className="tabular-nums text-sm text-gray-800 dark:text-life-50">{mark}{money(cents, sign)}</dd></div>
  );
  return (
    <div className="rounded-xl bg-life-50 px-3 py-1 dark:bg-life-900" data-safe>
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex min-h-[44px] w-full items-center justify-between gap-2 text-left">
        <span className="text-sm font-medium text-life-800 dark:text-life-50">{safe.safe < 0 ? 'Over what is safe by' : 'Safe to spend'}</span>
        <span className={`text-xl font-semibold tabular-nums ${safe.safe < 0 ? 'text-red-600' : 'text-life-800 dark:text-life-50'}`} data-safe-number>{money(Math.abs(safe.safe), sign)}</span>
      </button>
      {!open && <p className="pb-1 text-xs text-gray-500 dark:text-life-300">Tap to see how it adds up.</p>}
      {open && (
        <dl className="divide-y divide-life-100 pb-1 dark:divide-life-800" data-safe-lines>
          {line('Income this month', safe.income, '+ ')}
          {line('Bills', safe.bills, '− ')}
          {line('Goals ask this month', safe.goals.total, '− ')}
          {line('Spent so far', safe.spent, '− ')}
          <div className="flex items-baseline justify-between gap-2 py-1"><dt className="text-sm font-semibold text-life-800 dark:text-life-50">{safe.safe < 0 ? 'Over by' : 'Safe to spend'}</dt><dd className="tabular-nums text-sm font-semibold text-life-800 dark:text-life-50">{money(Math.abs(safe.safe), sign)}</dd></div>
          {safe.goals.lines.length > 0 && <div className="pt-1 text-xs text-gray-500 dark:text-life-300">Goals: {safe.goals.lines.map((g) => `${g.name} ${money(g.cents, sign)}`).join(', ')}. Spending counted against a plan's own goal is not counted again here.</div>}
        </dl>
      )}
    </div>
  );
}

/** What is asked once when a plan or project is over: where a leftover goes, or what covers a shortfall. Nothing moves until a button is pressed. */
export function GoalQuestion({ goal, sign = '$', onDone }) {
  const [others, setOthers] = useState([]);
  const [pick, setPick] = useState('');
  const [error, setError] = useState('');
  useEffect(() => { axios.get('/api/money/goals').then(({ data }) => setOthers(data.filter((g) => g.id !== goal.id))).catch(() => {}); }, [goal.id]);
  const q = goal.question;
  const answer = async (body) => {
    setError('');
    try { await axios.post(`/api/money/goals/${goal.id}/settle`, body); onDone(); } catch (err) { setError(errorMessage(err, "Couldn't do that")); }
  };
  const leftover = q.kind === 'leftover';
  return (
    <div className="rounded-xl bg-honey-100 px-3 py-2 text-sm text-honey-700" data-goal-question={q.kind}>
      <p className="font-medium">{q.words}</p>
      <p className="text-xs">Nothing moves until you choose. It is only asked this once.</p>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        {leftover && <button type="button" onClick={() => answer({ action: 'return' })} className={`${quietButtonClass} min-h-[44px]`}>Give {money(q.cents, sign)} back to the month</button>}
        {others.length > 0 && (
          <>
            <select aria-label={leftover ? 'Move it to this goal' : 'Cover it from this goal'} value={pick} onChange={(e) => setPick(e.target.value)} className={`${inputClass} !w-auto min-h-[44px]`}>
              <option value="">{leftover ? 'Another goal…' : 'Take it from a goal…'}</option>
              {others.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
            <button type="button" disabled={!pick} onClick={() => answer(leftover ? { action: 'move', to_goal_id: Number(pick) } : { action: 'cover', from_goal_id: Number(pick) })} className={`${quietButtonClass} min-h-[44px]`}>{leftover ? 'Move it there' : 'Cover it'}</button>
          </>
        )}
        <button type="button" onClick={() => answer({ action: 'leave' })} className={`${quietButtonClass} min-h-[44px]`}>{leftover ? 'Leave it in the goal' : 'Leave it to the month'}</button>
      </div>
      {error && <p className="mt-1 text-red-600" role="alert">{error}</p>}
    </div>
  );
}

/** The goal of a plan (a holiday's or trip's year too) or a project: what it adds up to, the goal, what this month asks, and the safe number. */
export function PlanGoal({ kind, id, onlyWithGoal = false, onChange }) {
  const [panel, setPanel] = useState(null);
  const [line, setLine] = useState({ label: '', price: '' });
  const [target, setTarget] = useState('');
  const [error, setError] = useState('');
  const load = useCallback(() => axios.get(`/api/money/goals/for-${kind}/${id}`).then(({ data }) => setPanel(data)).catch(() => setPanel(false)), [kind, id]);
  useEffect(() => { setPanel(null); load(); }, [load]);
  if (!panel || (onlyWithGoal && !panel.goal)) return null;
  const sign = panel.currency;
  const { goal, cost } = panel;
  const act = async (request) => {
    setError('');
    try { await request; await load(); if (onChange) onChange(); } catch (err) { setError(errorMessage(err, "Couldn't do that")); }
  };
  const start = () => act(axios.post('/api/money/goals/start', { [`${kind}_id`]: id, ...(toCents(target) ? { target_cents: toCents(target) } : {}) }));
  const addLine = (e) => {
    e.preventDefault();
    if (!line.label.trim()) return;
    act(axios.post(`/api/money/goals/${goal.id}/lines`, { label: line.label, cents: toCents(line.price) })).then(() => setLine({ label: '', price: '' }));
  };
  return (
    <section className={`${cardClass} space-y-3`} aria-label="Goal and cost" data-plan-goal>
      <h2 className="font-semibold text-life-800 dark:text-life-50">Goal and cost</h2>

      {cost.lines.length > 0 ? (
        <ul className="divide-y divide-life-100 text-sm dark:divide-life-800" data-cost-lines>
          {cost.lines.map((l) => (
            <li key={l.key} className="flex items-center gap-2" data-cost-line={l.source}>
              <span className="min-w-0 flex-1 py-2 text-gray-800 dark:text-life-50">{l.label}</span>
              <span className="tabular-nums text-gray-700 dark:text-life-100">{l.unknown > 0 && l.cents === 0 ? 'no price yet' : money(l.cents, sign)}</span>
              {l.line_id !== null && kind === 'plan' && <button type="button" aria-label={`Remove ${l.label}`} onClick={() => act(axios.delete(`/api/money/goals/lines/${l.line_id}`))} className="flex h-11 w-11 items-center justify-center text-gray-400 hover:text-red-600">✕</button>}
            </li>
          ))}
        </ul>
      ) : <p className="text-sm text-gray-500 dark:text-life-300">Nothing priced yet. Food from its recipes, gifts with prices and project costs are added up here{kind === 'plan' ? ', and you can type lines of your own once it has a goal' : ''}.</p>}
      <p className="text-sm text-gray-800 dark:text-life-50" data-cost-total>It adds up to <span className="font-semibold">{money(cost.total, sign)}</span>.{cost.unknown_words && <> <span data-cost-unknown>{cost.unknown_words}.</span></>}</p>

      {goal && kind === 'plan' && (
        <form onSubmit={addLine} className="flex flex-wrap items-end gap-2" aria-label="Add a line of your own">
          <label className="min-w-[8rem] flex-1 text-xs text-gray-600 dark:text-life-200">A cost of your own<input value={line.label} onChange={(e) => setLine({ ...line, label: e.target.value })} placeholder="Cabin, ferry…" className={`${inputClass} mt-1 min-h-[44px]`} /></label>
          <label className="w-28 text-xs text-gray-600 dark:text-life-200">Price<input inputMode="decimal" value={line.price} onChange={(e) => setLine({ ...line, price: e.target.value })} placeholder="not known" className={`${inputClass} mt-1 min-h-[44px]`} /></label>
          <button type="submit" className={`${quietButtonClass} min-h-[44px]`}>Add</button>
        </form>
      )}

      {goal ? (
        <div className="space-y-2" data-plan-goal-box>
          <GoalProgress progress={goal.progress} name={goal.name} />
          <p className="text-xs text-gray-500 dark:text-life-300">The goal is {money(goal.target_cents, sign)}{goal.by_day ? `, by ${goal.by_day}` : ''}. {goal.spent > 0 ? `${money(goal.spent, sign)} has been spent from it. ` : ''}<Link to="/money/goals" className="underline">Goals</Link></p>
          {goal.ask > 0 && (
            <div className="flex flex-wrap items-center gap-2" data-goal-ask>
              <button type="button" aria-pressed={goal.checked} disabled={goal.checked} onClick={() => act(axios.post(`/api/money/goals/${goal.id}/saved`, { cents: goal.ask }))} className={`${goal.checked ? quietButtonClass : buttonClass} min-h-[44px]`}>
                {goal.checked ? `Set aside this month: ${money(goal.set_aside, sign)}` : `Set aside ${money(goal.ask, sign)} this month`}
              </button>
              {goal.raised && <span className="text-sm text-amber-700 dark:text-amber-300" data-goal-raised>You are {money(goal.behind, sign)} behind, so each month now asks {money(goal.ask, sign)} instead of {money(goal.even, sign)}.</span>}
            </div>
          )}
          {goal.question && <GoalQuestion goal={goal} sign={sign} onDone={() => { load(); if (onChange) onChange(); }} />}
        </div>
      ) : !panel.subject.over && (
        <div className="space-y-2" data-plan-goal-none>
          {panel.if_set && <p className="text-sm text-gray-700 dark:text-life-100" data-if-set>{panel.if_set.words}</p>}
          <div className="flex flex-wrap items-end gap-2">
            <label className="w-36 text-xs text-gray-600 dark:text-life-200">Goal amount<input inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} placeholder={cost.total > 0 ? (cost.total / 100).toFixed(2) : 'amount'} className={`${inputClass} mt-1 min-h-[44px]`} /></label>
            <button type="button" onClick={start} className={`${buttonClass} min-h-[44px]`} data-start-goal>Start a goal</button>
          </div>
        </div>
      )}

      <SafeToSpend safe={panel.safe} />
      {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
    </section>
  );
}
