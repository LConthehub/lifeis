import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import Modal, { Field, inputClass, buttonClass, quietButtonClass, cardClass, errorMessage } from '../components/ui';
import { money, toCents } from '../components/Budget';

const pad = (n) => String(n).padStart(2, '0');
const today = () => { const now = new Date(); return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`; };
const dayText = (day) => new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
/** Dollars without cents, for the year's table. */
const whole = (cents, sign = '$') => `${cents < 0 ? '-' : ''}${sign}${Math.round(Math.abs(cents) / 100).toLocaleString()}`;
const monthShort = (month) => new Date(`${month}-01T12:00:00`).toLocaleDateString(undefined, { month: 'short' });
const monthLong = (month) => new Date(`${month}-01T12:00:00`).toLocaleDateString(undefined, { month: 'long' });
const decimal = (cents) => (Math.abs(cents) / 100).toFixed(2);

export const EVERY = [['weekly', 'Every week'], ['biweekly', 'Every two weeks'], ['twice_monthly', 'Twice a month'], ['monthly', 'Every month'], ['yearly', 'Every year'], ['once', 'One time, on a date']];
const everyText = (every) => (EVERY.find(([k]) => k === every) || [null, every])[1];
const UNITS = [['week', 'weeks'], ['month', 'months'], ['year', 'years']];
const billEvery = (e) => (!e ? 'one time' : e.n === 1 ? `every ${e.unit}` : `every ${e.n} ${e.unit}s`);

/** How the month's figures read: money, red when it is short. */
function Left({ cents, sign }) {
  return <span className={cents < 0 ? 'font-semibold text-red-600' : 'font-semibold text-gray-800 dark:text-life-50'}>{money(Math.abs(cents), sign)}</span>;
}

/** Spending by tag, nested the way the tags are. A tag opens its own page. */
export function ByTag({ tags, sign, empty }) {
  if (!tags || tags.length === 0) return <p className="text-sm text-gray-500 dark:text-life-300">{empty}</p>;
  return (
    <ul className="divide-y divide-life-100 dark:divide-life-800" data-by-tag>
      {tags.map((t) => (
        <li key={t.id} className="flex items-center gap-2 text-sm" style={{ paddingLeft: `${t.depth * 1.25}rem` }}>
          <Link to={`/tags/${t.id}`} className="flex min-h-[44px] min-w-0 flex-1 items-center text-gray-800 hover:underline dark:text-life-50"><span className="truncate">{t.depth > 0 ? '↳ ' : ''}{t.name}</span></Link>
          <span className="tabular-nums text-gray-800 dark:text-life-50">{money(t.cents, sign)}</span>
        </li>
      ))}
    </ul>
  );
}

/** The budget part of the month page: what comes in, what is due, what is planned and put aside, and what is left. */
export function MonthBudget({ month }) {
  const [b, setB] = useState(null);
  useEffect(() => { setB(null); axios.get('/api/money/budget', { params: { month } }).then(({ data }) => setB(data)).catch(() => {}); }, [month]);
  if (!b) return null;
  const sign = b.currency;
  const row = (label, cents, extra) => (
    <div className="flex items-baseline justify-between gap-2 py-1.5"><dt className="text-sm text-gray-600 dark:text-life-100">{label}</dt><dd className="tabular-nums text-sm text-gray-800 dark:text-life-50">{extra}{money(cents, sign)}</dd></div>
  );
  return (
    <section className={cardClass} data-budget-month>
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <h2 className="mr-auto font-semibold text-life-800 dark:text-life-50">The month's budget</h2>
        <Link to="/money/income" className="inline-flex min-h-[44px] items-center text-sm text-life-600 hover:underline dark:text-life-200">Income and bills</Link>
      </div>
      <dl className="divide-y divide-life-100 dark:divide-life-800">
        {row('Income', b.income.total, '+ ')}
        {row('Bills due', b.bills.total, '− ')}
        {row(b.past ? 'Spent' : 'Planned spending', b.spending, '− ')}
        {(b.projects.spent > 0 || b.projects.coming > 0) && (
          <div className="flex items-baseline justify-between gap-2 py-1.5 pl-4" data-projects-line>
            <dt className="text-sm text-gray-600 dark:text-life-100">Projects <span className="text-xs text-gray-500 dark:text-life-300">paid, already in the spending{b.projects.coming > 0 ? `; ${money(b.projects.coming, sign)} coming` : ''}</span></dt>
            <dd className="tabular-nums text-sm text-gray-800 dark:text-life-50">{money(b.projects.spent, sign)}</dd>
          </div>
        )}
        {row('Put into goals', b.saved.total, '− ')}
        <div className="flex items-baseline justify-between gap-2 py-2"><dt className="text-sm font-semibold text-life-800 dark:text-life-50">{b.left_over < 0 ? 'Short by' : 'Left over'}</dt><dd className="tabular-nums" data-left-over><Left cents={b.left_over} sign={sign} /></dd></div>
      </dl>
      <p className="text-xs text-gray-500 dark:text-life-300">{b.past ? `This month is over, so spending is what was spent (${money(b.spent, sign)}).` : `Spending counts the larger of what is planned in the categories (${money(b.planned.total, sign)}) and what was spent (${money(b.spent, sign)}).`} It leaves out a bill you paid through spending, since the bill is counted already.</p>

      <h3 className="mt-3 text-sm font-semibold text-life-800 dark:text-life-50">Coming in</h3>
      {b.income.lines.length === 0 ? <p className="text-sm text-gray-500 dark:text-life-300">Nothing comes in this month. <Link to="/money/income" className="underline">Add income</Link></p> : (
        <ul className="text-sm">{b.income.lines.map((i) => <li key={i.id} className="flex justify-between gap-2 py-1"><span>{i.name} <span className="text-xs text-gray-500 dark:text-life-300">{everyText(i.every).toLowerCase()}</span></span><span className="tabular-nums">{money(i.cents, sign)}</span></li>)}</ul>
      )}
      <h3 className="mt-3 text-sm font-semibold text-life-800 dark:text-life-50">Bills due</h3>
      {b.bills.lines.length === 0 ? <p className="text-sm text-gray-500 dark:text-life-300">No bills fall in this month. <Link to="/money/income" className="underline">Add a bill</Link></p> : (
        <ul className="text-sm">{b.bills.lines.map((l, i) => (
          <li key={`${l.job_id}-${i}`} className="flex items-center justify-between gap-2">
            <Link to={`/things/upkeep/${l.job_id}`} className="flex min-h-[44px] min-w-0 flex-1 items-center gap-2 hover:underline"><span className="w-12 shrink-0 text-xs text-gray-500 dark:text-life-300">{l.day.slice(5).replace('-', '/')}</span><span className="truncate">{l.name}{l.autopay ? ' (pays itself)' : ''}</span></Link>
            <span className="tabular-nums">{money(l.cents, sign)}</span>
          </li>
        ))}</ul>
      )}
      {b.bills.unscheduled.length > 0 && <p className="mt-1 text-xs text-gray-500 dark:text-life-300">No date yet, so not counted: {b.bills.unscheduled.map((u, i) => <span key={u.job_id}>{i ? ', ' : ''}<Link to={`/things/upkeep/${u.job_id}`} className="underline">{u.name}</Link></span>)}.</p>}
      <h3 className="mt-3 text-sm font-semibold text-life-800 dark:text-life-50">Put into goals</h3>
      {b.saved.goals.length === 0 ? <p className="text-sm text-gray-500 dark:text-life-300">Nothing this month. <Link to="/money/goals" className="underline">Savings goals</Link></p> : (
        <ul className="text-sm">{b.saved.goals.map((g) => <li key={g.id} className="flex items-center justify-between gap-2"><Link to="/money/goals" className="flex min-h-[44px] items-center hover:underline">{g.name}</Link><span className="tabular-nums">{money(g.cents, sign)}</span></li>)}</ul>
      )}
      <h3 className="mt-3 text-sm font-semibold text-life-800 dark:text-life-50">Spending by tag</h3>
      <ByTag tags={b.by_tag} sign={sign} empty="No spending with a tag this month. Add a tag to what you spend and it shows here." />
    </section>
  );
}

const yearStep = (year, by) => String(Number(year) + by);

/** Twelve months side by side (a list of months on a phone), with the totals. */
export function YearPage() {
  const [year, setYear] = useState(today().slice(0, 4));
  const [data, setData] = useState(null);
  useEffect(() => { setData(null); axios.get('/api/money/year', { params: { year } }).then(({ data: d }) => setData(d)).catch(() => {}); }, [year]);
  if (!data) return null;
  const sign = data.currency;
  const nowMonth = today().slice(0, 7);
  const rows = [['Income', 'income'], ['Bills', 'bills'], ['Spending', 'spending'], ['Projects (in spending)', 'projects'], ['Projects coming', 'coming'], ['Saving', 'saved'], ['Left over', 'left']];
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-life-800 dark:text-life-50">The year</h1>
      <div className="flex items-center justify-between gap-2">
        <button type="button" onClick={() => setYear(yearStep(year, -1))} className={`${quietButtonClass} min-h-[44px] min-w-[44px]`} aria-label="The year before">‹</button>
        <p className="font-medium text-life-800 dark:text-life-50" data-year>{data.year}</p>
        <button type="button" onClick={() => setYear(yearStep(year, 1))} className={`${quietButtonClass} min-h-[44px] min-w-[44px]`} aria-label="The year after">›</button>
      </div>

      <section className={`${cardClass} hidden md:block`} aria-label="The year, month by month" data-year-table>
        <div className="overflow-x-auto">
          <table className="w-full text-right text-xs tabular-nums">
            <thead>
              <tr className="text-gray-500 dark:text-life-300">
                <th scope="col" className="py-2 pr-2 text-left font-medium"><span className="sr-only">Money</span></th>
                {data.months.map((m) => <th key={m.month} scope="col" className={`px-1 py-2 font-medium ${m.month === nowMonth ? 'text-life-700 dark:text-life-50' : ''}`}>{monthShort(m.month)}</th>)}
                <th scope="col" className="pl-2 py-2 font-semibold text-gray-700 dark:text-life-100">Year</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-life-100 dark:divide-life-700">
              {rows.map(([label, key]) => (
                <tr key={key} className={key === 'left' ? 'font-semibold' : ''}>
                  <th scope="row" className="py-2 pr-2 text-left font-medium text-gray-700 dark:text-life-100">{label}</th>
                  {data.months.map((m) => <td key={m.month} className={`px-1 py-2 ${key === 'left' && m.left < 0 ? 'text-red-600' : 'text-gray-800 dark:text-life-50'}`}>{whole(m[key], sign)}</td>)}
                  <td className={`pl-2 py-2 font-semibold ${key === 'left' && data.totals.left < 0 ? 'text-red-600' : 'text-gray-800 dark:text-life-50'}`}>{whole(data.totals[key], sign)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <ul className="space-y-2 md:hidden" aria-label="The year, month by month" data-year-list>
        {data.months.map((m) => (
          <li key={m.month} className={`${cardClass} !p-3`} data-year-month={m.month}>
            <p className="mb-1 font-medium text-life-800 dark:text-life-50">{monthLong(m.month)}{m.month === nowMonth ? ' (now)' : ''}</p>
            <dl className="grid grid-cols-2 gap-x-3 text-sm">
              {rows.map(([label, key]) => (
                <div key={key} className="flex items-baseline justify-between gap-2 py-0.5"><dt className="text-gray-500 dark:text-life-300">{label}</dt><dd className={`tabular-nums ${key === 'left' && m.left < 0 ? 'font-semibold text-red-600' : 'text-gray-800 dark:text-life-50'}`}>{whole(m[key], sign)}</dd></div>
              ))}
            </dl>
          </li>
        ))}
      </ul>

      <dl className={`${cardClass} grid grid-cols-2 gap-x-3 text-sm sm:grid-cols-4`} data-year-totals>
        {rows.map(([label, key]) => (
          <div key={key} className="py-1"><dt className="text-xs text-gray-500 dark:text-life-300">{label}, whole year</dt><dd className={`font-semibold tabular-nums ${key === 'left' && data.totals.left < 0 ? 'text-red-600' : 'text-gray-800 dark:text-life-50'}`}>{money(data.totals[key], sign)}</dd></div>
        ))}
      </dl>
      <p className="text-xs text-gray-500 dark:text-life-300">Bills count from the month each was written down. From this month on, spending counts the larger of what is planned and what was spent, so months to come show your plan. Months gone by count only what was spent.</p>

      <section className={cardClass}>
        <h2 className="mb-1 font-semibold text-life-800 dark:text-life-50">Spending by tag in {data.year}</h2>
        <ByTag tags={data.by_tag} sign={sign} empty="No spending with a tag this year yet." />
      </section>
    </div>
  );
}

/** A progress bar: how much of a goal is saved. */
function Progress({ part, whole: all, done }) {
  const pct = all > 0 ? Math.max(0, Math.min(100, Math.round((part / all) * 100))) : 0;
  return (
    <div className="mt-1 h-2 overflow-hidden rounded-full bg-life-100 dark:bg-life-800" role="img" aria-label={`${pct}% saved`}>
      <div className={`h-full rounded-full ${done ? 'bg-green-600' : 'bg-life-500'}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

/** Savings goals: what is saved, what is left, what a month takes, and the money put toward each. */
export function GoalsPage() {
  const [goals, setGoals] = useState(null);
  const [sign, setSign] = useState('$');
  const [modal, setModal] = useState(null);
  const [error, setError] = useState('');
  const load = useCallback(() => {
    axios.get('/api/money/goals').then(({ data }) => setGoals(data)).catch(() => {});
    axios.get('/api/money/budget').then(({ data }) => setSign(data.currency)).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);
  if (!goals) return null;
  const done = () => { setModal(null); load(); };
  const removePut = async (put) => {
    setError('');
    try { await axios.delete(`/api/money/goals/saved/${put.id}`); load(); } catch (err) { setError(errorMessage(err, "Couldn't remove that")); }
  };
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-xl font-semibold text-life-800 dark:text-life-50">Savings goals</h1>
        <button type="button" onClick={() => setModal({ goal: {} })} className={`${buttonClass} min-h-[44px]`}>+ A goal</button>
      </div>
      {goals.length === 0 && <div className={`${cardClass} text-center text-sm text-gray-500 dark:text-life-200`}>No goals yet. Add one for something you are saving toward: a trip, a new roof, a cushion for a rainy day.</div>}
      {goals.map((g) => (
        <section key={g.id} className={cardClass} data-goal={g.name}>
          <div className="flex flex-wrap items-baseline gap-x-2">
            <h2 className="mr-auto font-semibold text-life-800 dark:text-life-50">{g.name}{g.project && <Link to={`/projects/${g.project_id}`} className="ml-2 text-xs font-normal text-life-600 underline dark:text-life-200">for {g.project}</Link>}</h2>
            <span className="text-sm tabular-nums text-gray-600 dark:text-life-100">{money(g.saved, sign)} of {money(g.target_cents, sign)}</span>
          </div>
          <Progress part={g.saved} whole={g.target_cents} done={g.done} />
          <p className="mt-2 text-sm text-gray-700 dark:text-life-100" data-goal-left>
            {g.done ? 'Reached.' : <>{money(g.left, sign)} left.</>}
            {g.by_day && !g.done && (g.late ? <> The day, {dayText(g.by_day)}, has passed.</> : <> To reach it by {dayText(g.by_day)}, put in <span className="font-semibold">{money(g.per_month, sign)}</span> a month.</>)}
            {g.by_day && g.done && <> Aimed for {dayText(g.by_day)}.</>}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" onClick={() => setModal({ put: g })} className={`${buttonClass} min-h-[44px]`}>Put money in</button>
            <button type="button" onClick={() => setModal({ take: g })} className={`${quietButtonClass} min-h-[44px]`} disabled={g.saved === 0}>Take money out</button>
            <button type="button" onClick={() => setModal({ goal: g })} className={`${quietButtonClass} min-h-[44px]`} aria-label={`Change ${g.name}`}>Change</button>
          </div>
          {g.puts.length > 0 && (
            <ul className="mt-2 divide-y divide-life-100 text-sm dark:divide-life-800">
              {g.puts.map((p) => (
                <li key={p.id} className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 py-2 text-gray-600 dark:text-life-100">{dayText(p.day)}</span>
                  <span className={`tabular-nums ${p.cents < 0 ? 'text-red-600' : 'text-gray-800 dark:text-life-50'}`}>{p.cents < 0 ? 'out ' : ''}{money(Math.abs(p.cents), sign)}</span>
                  <button type="button" aria-label={`Remove the ${dayText(p.day)} entry for ${g.name}`} onClick={() => removePut(p)} className="flex h-11 w-11 items-center justify-center text-gray-400 hover:text-red-600">✕</button>
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
      {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
      {modal?.goal && <Modal title={modal.goal.id ? modal.goal.name : 'A savings goal'} onClose={() => setModal(null)}><GoalForm goal={modal.goal} onDone={done} /></Modal>}
      {modal?.put && <Modal title={`Put money toward ${modal.put.name}`} onClose={() => setModal(null)}><PutForm goal={modal.put} out={false} onDone={done} /></Modal>}
      {modal?.take && <Modal title={`Take money out of ${modal.take.name}`} onClose={() => setModal(null)}><PutForm goal={modal.take} out onDone={done} /></Modal>}
    </div>
  );
}

function GoalForm({ goal, onDone }) {
  const [form, setForm] = useState({ name: goal.name || '', target: goal.id ? decimal(goal.target_cents) : '', by_day: goal.by_day || '' });
  const [error, setError] = useState('');
  const set = (name) => (e) => setForm({ ...form, [name]: e.target.value });
  const send = async (request) => { setError(''); try { await request(); onDone(); } catch (err) { setError(errorMessage(err, "Couldn't save that")); } };
  const submit = (e) => {
    e.preventDefault();
    const body = { name: form.name, target_cents: toCents(form.target), by_day: form.by_day || null };
    send(() => (goal.id ? axios.put(`/api/money/goals/${goal.id}`, body) : axios.post('/api/money/goals', body)));
  };
  return (
    <form onSubmit={submit} className="space-y-3">
      <Field label="What for *"><input required autoFocus={!goal.id} value={form.name} onChange={set('name')} placeholder="A trip, a new roof…" className={inputClass} /></Field>
      <Field label="How much it takes *"><input required inputMode="decimal" value={form.target} onChange={set('target')} className={inputClass} /></Field>
      <Field label="Reach it by (if there is a day)"><input type="date" value={form.by_day} onChange={set('by_day')} className={inputClass} /></Field>
      {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
      <div className="flex justify-between gap-2">
        {goal.id ? <button type="button" onClick={() => { if (window.confirm(`Remove the goal ${goal.name}? What was put toward it is removed from the record too. No money moves.`)) send(() => axios.delete(`/api/money/goals/${goal.id}`)); }} className="min-h-[44px] text-sm text-red-600 hover:underline">Remove</button> : <span />}
        <button type="submit" className={`${buttonClass} min-h-[44px]`}>Save</button>
      </div>
    </form>
  );
}

function PutForm({ goal, out, onDone }) {
  const [amount, setAmount] = useState('');
  const [day, setDay] = useState(today());
  const [error, setError] = useState('');
  const submit = async (e) => {
    e.preventDefault();
    setError('');
    const cents = toCents(amount);
    try { await axios.post(`/api/money/goals/${goal.id}/saved`, { day, cents: cents === null ? null : (out ? -cents : cents) }); onDone(); } catch (err) { setError(errorMessage(err, "Couldn't save that")); }
  };
  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Field label="How much *"><input required autoFocus inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className={inputClass} /></Field>
        <Field label="On"><input type="date" value={day} onChange={(e) => setDay(e.target.value)} className={inputClass} /></Field>
      </div>
      {out && <p className="text-xs text-gray-500 dark:text-life-300">This only changes what Life Is says is saved. It does not move any money.</p>}
      {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
      <div className="flex justify-end"><button type="submit" className={`${buttonClass} min-h-[44px]`}>{out ? 'Take it out' : 'Put it in'}</button></div>
    </form>
  );
}

/** What comes in, and the bills that go out (which are upkeep jobs: this reads them, and can add one). */
export function IncomePage() {
  const [income, setIncome] = useState(null);
  const [bills, setBills] = useState(null);
  const [sign, setSign] = useState('$');
  const [modal, setModal] = useState(null);
  const load = useCallback(() => {
    axios.get('/api/money/income').then(({ data }) => setIncome(data)).catch(() => {});
    axios.get('/api/money/bills').then(({ data }) => setBills(data)).catch(() => {});
    axios.get('/api/money/budget').then(({ data }) => setSign(data.currency)).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);
  if (!income || !bills) return null;
  const done = () => { setModal(null); load(); };
  const incomeMonth = income.reduce((n, i) => n + i.per_month, 0);
  const billsMonth = bills.reduce((n, b) => n + b.per_month, 0);
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-life-800 dark:text-life-50">Income and bills</h1>
      <section className={cardClass} data-income>
        <div className="mb-1 flex flex-wrap items-center gap-2">
          <h2 className="mr-auto font-semibold text-life-800 dark:text-life-50">What comes in</h2>
          <button type="button" onClick={() => setModal({ income: {} })} className={`${buttonClass} min-h-[44px]`}>+ Income</button>
        </div>
        {income.length === 0 && <p className="text-sm text-gray-500 dark:text-life-300">Nothing yet. Add a paycheck, a pension, or anything else that comes in, and how often.</p>}
        <ul className="divide-y divide-life-100 dark:divide-life-800">
          {income.map((i) => (
            <li key={i.id} className="flex items-center gap-2 text-sm">
              <button type="button" onClick={() => setModal({ income: i })} aria-label={`Change ${i.name}`} className="min-h-[44px] min-w-0 flex-1 py-1 text-left hover:underline">
                <span className="block font-medium text-gray-800 dark:text-life-50">{i.name}</span>
                <span className="block text-xs text-gray-500 dark:text-life-300">{money(i.cents, sign)}, {everyText(i.every).toLowerCase()}{i.start_day ? `, from ${dayText(i.start_day)}` : ''}{i.end_day ? ` to ${dayText(i.end_day)}` : ''}</span>
              </button>
              <span className="text-right tabular-nums text-gray-800 dark:text-life-50">{i.every === 'once' ? 'one time' : `${money(i.per_month, sign)} a month`}</span>
            </li>
          ))}
        </ul>
        {income.length > 0 && <p className="mt-2 text-sm text-gray-700 dark:text-life-100" data-income-month>All of it comes to about <span className="font-semibold">{money(incomeMonth, sign)}</span> a month.</p>}
      </section>

      <section className={cardClass} data-bills>
        <div className="mb-1 flex flex-wrap items-center gap-2">
          <h2 className="mr-auto font-semibold text-life-800 dark:text-life-50">Bills</h2>
          <button type="button" onClick={() => setModal({ bill: true })} className={`${buttonClass} min-h-[44px]`}>+ Bill</button>
        </div>
        <p className="mb-1 text-xs text-gray-500 dark:text-life-300">Bills are kept in Upkeep, so there is one list. Open one to change it or mark it paid.</p>
        {bills.length === 0 && <p className="text-sm text-gray-500 dark:text-life-300">No bills yet. Add one here and it is added to Upkeep too.</p>}
        <ul className="divide-y divide-life-100 dark:divide-life-800">
          {bills.map((b) => (
            <li key={b.job_id} className="flex items-center gap-2 text-sm">
              <Link to={`/things/upkeep/${b.job_id}`} className="block min-h-[44px] min-w-0 flex-1 py-1 hover:underline">
                <span className="block font-medium text-gray-800 dark:text-life-50">{b.name}{b.autopay ? ' (pays itself)' : ''}</span>
                <span className="block text-xs text-gray-500 dark:text-life-300">{b.cents ? money(b.cents, sign) : 'No amount yet'}, {billEvery(b.every)}{b.needs_date ? ', no date yet' : b.next_day ? `, next ${dayText(b.next_day)}` : ''}</span>
              </Link>
              <span className="text-right tabular-nums text-gray-800 dark:text-life-50">{money(b.per_month, sign)} a month</span>
            </li>
          ))}
        </ul>
        {bills.length > 0 && <p className="mt-2 text-sm text-gray-700 dark:text-life-100" data-bills-month>Your bills come to about <span className="font-semibold">{money(billsMonth, sign)}</span> a month.</p>}
      </section>
      {modal?.income && <Modal title={modal.income.id ? modal.income.name : 'Something that comes in'} onClose={() => setModal(null)}><IncomeForm income={modal.income} onDone={done} /></Modal>}
      {modal?.bill && <Modal title="A bill" onClose={() => setModal(null)}><BillForm onDone={done} /></Modal>}
    </div>
  );
}

function IncomeForm({ income, onDone }) {
  const [form, setForm] = useState({ name: income.name || '', amount: income.id ? decimal(income.cents) : '', every: income.every || 'monthly', start_day: income.start_day || '', end_day: income.end_day || '' });
  const [error, setError] = useState('');
  const set = (name) => (e) => setForm({ ...form, [name]: e.target.value });
  const send = async (request) => { setError(''); try { await request(); onDone(); } catch (err) { setError(errorMessage(err, "Couldn't save that")); } };
  const submit = (e) => {
    e.preventDefault();
    const body = { name: form.name, cents: toCents(form.amount), every: form.every, start_day: form.start_day || null, end_day: form.every === 'once' ? null : (form.end_day || null) };
    send(() => (income.id ? axios.put(`/api/money/income/${income.id}`, body) : axios.post('/api/money/income', body)));
  };
  const once = form.every === 'once';
  return (
    <form onSubmit={submit} className="space-y-3">
      <Field label="What *"><input required autoFocus={!income.id} value={form.name} onChange={set('name')} placeholder="Paycheck, pension…" className={inputClass} /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="How much *"><input required inputMode="decimal" value={form.amount} onChange={set('amount')} className={inputClass} /></Field>
        <Field label="How often"><select value={form.every} onChange={set('every')} className={`${inputClass} min-h-[44px]`}>{EVERY.map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></Field>
      </div>
      <div className={once ? '' : 'grid grid-cols-2 gap-3'}>
        <Field label={once ? 'The day it comes in *' : 'First day'}><input type="date" required={once} value={form.start_day} onChange={set('start_day')} className={inputClass} /></Field>
        {!once && <Field label="Last day (if it ends)"><input type="date" value={form.end_day} onChange={set('end_day')} className={inputClass} /></Field>}
      </div>
      {(form.every === 'weekly' || form.every === 'biweekly') && <p className="text-xs text-gray-500 dark:text-life-300">Give a first payday to count the real paydays in each month. Without one, a month gets the average.</p>}
      {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
      <div className="flex justify-between gap-2">
        {income.id ? <button type="button" onClick={() => send(() => axios.delete(`/api/money/income/${income.id}`))} className="min-h-[44px] text-sm text-red-600 hover:underline">Remove</button> : <span />}
        <button type="submit" className={`${buttonClass} min-h-[44px]`}>Save</button>
      </div>
    </form>
  );
}

function BillForm({ onDone }) {
  const [form, setForm] = useState({ name: '', amount: '', n: '1', unit: 'month', first_due: today(), autopay: false });
  const [error, setError] = useState('');
  const set = (name) => (e) => setForm({ ...form, [name]: e.target.value });
  const submit = async (e) => {
    e.preventDefault();
    setError('');
    try {
      await axios.post('/api/money/bills', { name: form.name, cents: toCents(form.amount), every_n: Number(form.n) || 1, every_unit: form.unit, first_due: form.first_due || null, autopay: form.autopay });
      onDone();
    } catch (err) { setError(errorMessage(err, "Couldn't save that")); }
  };
  return (
    <form onSubmit={submit} className="space-y-3">
      <Field label="Which bill *"><input required autoFocus value={form.name} onChange={set('name')} placeholder="Rent, electricity…" className={inputClass} /></Field>
      <Field label="How much each time *"><input required inputMode="decimal" value={form.amount} onChange={set('amount')} className={inputClass} /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Comes every"><input type="number" min="1" value={form.n} onChange={set('n')} className={inputClass} /></Field>
        <Field label="Unit"><select value={form.unit} onChange={set('unit')} className={`${inputClass} min-h-[44px]`}>{UNITS.map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></Field>
      </div>
      <Field label="Next due on"><input type="date" value={form.first_due} onChange={set('first_due')} className={inputClass} /></Field>
      <label className="flex min-h-[44px] items-center gap-2 text-sm text-gray-800 dark:text-life-50"><input type="checkbox" checked={form.autopay} onChange={(e) => setForm({ ...form, autopay: e.target.checked })} className="accent-life-600" /> It pays itself</label>
      <p className="text-xs text-gray-500 dark:text-life-300">This adds the bill to Upkeep. Open it there to change it or mark it paid.</p>
      {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
      <div className="flex justify-end"><button type="submit" className={`${buttonClass} min-h-[44px]`}>Add the bill</button></div>
    </form>
  );
}
