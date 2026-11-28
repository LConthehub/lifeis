import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import axios from 'axios';
import SubChips, { PLAN_CHIPS } from '../components/SubChips';
import Icon from '../components/Icon';
import Picture from '../components/Picture';
import { shrink } from '../components/shrink';
import { money } from '../components/Budget';
import Modal, { Field, inputClass, buttonClass, quietButtonClass, cardClass, errorMessage, fromDateInput, toDateInput } from '../components/ui';
import { photoAddress } from './Plans';

const API = '/api/plans/holidays';
const field = `${inputClass} min-h-[44px]`;
const button = `${buttonClass} min-h-[44px]`;
const quiet = `${quietButtonClass} min-h-[44px]`;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const NTHS = [[1, 'First'], [2, 'Second'], [3, 'Third'], [4, 'Fourth'], [-1, 'Last']];
const GIFT_STATES = [['idea', 'An idea'], ['bought', 'Bought'], ['wrapped', 'Wrapped'], ['given', 'Given']];
const dayText = (day, long = false) => fromDateInput(day).toLocaleDateString(undefined, long ? { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' } : { day: 'numeric', month: 'short', year: 'numeric' });
const timeText = (t) => { const h = Number(t.slice(0, 2)); return `${h % 12 === 0 ? 12 : h % 12}${t.slice(3) === '00' ? '' : `:${t.slice(3)}`} ${h < 12 ? 'am' : 'pm'}`; };
const dollars = (cents) => (cents === null || cents === undefined ? '' : (cents / 100).toFixed(2));
const cents = (text) => (String(text).trim() === '' ? null : Math.round(Number(text) * 100));

/** A row you tick, with a tap target at least 44 pixels tall. */
export function Tick({ checked, onChange, children, label, disabled = false }) {
  return (
    <label className={`flex min-h-[44px] flex-1 items-center gap-3 text-sm text-gray-800 dark:text-life-50 ${disabled ? 'opacity-50' : 'cursor-pointer'}`}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} aria-label={label} className="h-5 w-5 flex-none accent-life-600" />
      <span className="min-w-0 flex-1">{children}</span>
    </label>
  );
}

export const Heading = ({ icon, children, aside }) => (
  <div className="mb-2 flex flex-wrap items-center gap-2">
    <h2 className="flex flex-1 items-center gap-2 font-semibold text-life-800 dark:text-life-50"><Icon of={icon} /> {children}</h2>
    {aside}
  </div>
);
export const Hint = ({ children }) => <p className="text-xs text-gray-500 dark:text-life-300">{children}</p>;
export const Remove = ({ onClick, label }) => <button type="button" onClick={onClick} aria-label={label} className="flex h-11 w-11 flex-none items-center justify-center rounded-full text-lg text-gray-400 hover:bg-life-50 hover:text-red-600 dark:hover:bg-life-700">×</button>;

// ==================== the list of holidays ====================

/**
 * What other people gave you at a holiday. The server says nothing until the day has passed, so this part is only
 * there afterward. On a holiday's page, only what was given at a holiday of that name.
 */
export function GivenToYou({ only }) {
  const [given, setGiven] = useState([]);
  useEffect(() => { axios.get(`${API}/given-to-me`).then(({ data }) => setGiven(data)).catch(() => {}); }, []);
  const shown = only ? given.filter((g) => g.holiday.toLowerCase() === only.toLowerCase()) : given;
  if (shown.length === 0) return null;
  return (
    <section className={`${cardClass} space-y-2`} aria-label="Given to you">
      <Heading icon="gift">Given to you</Heading>
      <ul className="divide-y divide-life-100 dark:divide-life-700">
        {shown.map((g, i) => (
          <li key={i} className="py-2 text-sm text-gray-800 dark:text-life-50">{g.idea}<span className="block text-xs text-gray-500 dark:text-life-300">{g.holiday} {g.year} · {dayText(g.day)}</span></li>
        ))}
      </ul>
    </section>
  );
}

/** Holidays: what returns each year. Only the ones you add. */
export default function HolidaysPage() {
  const [list, setList] = useState(null);
  const [options, setOptions] = useState(null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const load = useCallback(() => {
    axios.get(API).then(({ data }) => setList(data)).catch(() => setList([]));
    axios.get(`${API}/options`).then(({ data }) => setOptions(data)).catch(() => setOptions({ dates: [], members: [], users: [], boxes: [] }));
  }, []);
  useEffect(() => { load(); }, [load]);
  if (!list) return null;
  const open = (h) => navigate(h.latest ? `/plans/${h.latest.plan_id}` : `/plans/holidays/${h.id}`);
  const fromDate = async (event) => {
    setError('');
    try { open((await axios.post(`${API}/from-event`, { event_id: event.id })).data); } catch (err) { setError(errorMessage(err, "Couldn't make that a holiday")); }
  };
  return (
    <div className="space-y-5">
      <SubChips items={PLAN_CHIPS} label="Plans, holidays and trips" />
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-xl font-semibold text-life-800 dark:text-life-50">Holidays</h1>
        <button type="button" onClick={() => setAdding(true)} className={button}>+ Add a holiday</button>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <GivenToYou />
      {list.length === 0 && (
        <div className={`${cardClass} text-sm text-gray-600 dark:text-life-100`}>
          A holiday is a plan that comes back each year. Add the ones you keep. Life Is suggests none. Each year gets its own copy, started from last year's:
          the menu, who came, the cards and gifts, and where the decorations go. Past years stay here to look back on.
        </div>
      )}
      <ul className="grid gap-3 sm:grid-cols-2">
        {list.map((h) => (
          <li key={h.id}>
            <button type="button" onClick={() => open(h)} className={`${cardClass} flex h-full w-full min-h-[44px] flex-col gap-1 text-left hover:ring-life-300`}>
              <span className="flex items-center gap-2 font-medium text-life-800 dark:text-life-50"><Icon of="holiday" /> {h.name}</span>
              <span className="text-xs text-gray-500 dark:text-life-300">{h.rule_words}{h.latest ? ` · ${dayText(h.latest.day)}` : ''}{h.years.length > 1 ? ` · ${h.years.length} years kept` : ''}</span>
              {h.next && <span className="text-sm text-gray-700 dark:text-life-100">{h.next}</span>}
            </button>
          </li>
        ))}
      </ul>
      {options && options.dates.length > 0 && (
        <section className={cardClass}>
          <Heading icon="birthday">From your calendar</Heading>
          <Hint>A birthday, an anniversary or another yearly date can become a holiday with one tap: the same date every year, with its own gifts, menu, guests, decor and notes each year. The date stays on the calendar.</Hint>
          <ul className="mt-2 divide-y divide-life-100 dark:divide-life-700">
            {options.dates.map((e) => (
              <li key={e.id} className="flex items-center gap-2">
                <span className="min-w-0 flex-1 py-2 text-sm text-gray-800 dark:text-life-50">{e.title}<span className="block text-xs text-gray-500 dark:text-life-300">{fromDateInput(e.day).toLocaleDateString(undefined, { day: 'numeric', month: 'long' })} each year</span></span>
                <button type="button" onClick={() => fromDate(e)} aria-label={`Make ${e.title} a holiday`} className={quiet}>Make a holiday</button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {adding && (
        <Modal title="Add a holiday" onClose={() => setAdding(false)}>
          <HolidayForm onDone={(h) => { setAdding(false); open(h); }} />
        </Modal>
      )}
    </div>
  );
}

/** The rule's own words for a form: what its fields start as, from a holiday's rule or from a plan's first day. */
export function ruleStart(rule, lead_weeks, startDay) {
  if (rule) return { kind: rule.kind, month: rule.month ?? 11, day_of_month: rule.day ?? 1, weekday: rule.weekday ?? 4, nth: rule.nth ?? 4, lead_weeks: lead_weeks ?? 6 };
  if (!startDay) return { kind: 'weekday', month: 11, day_of_month: 1, weekday: 4, nth: 4, lead_weeks: 6 };
  const d = fromDateInput(startDay);
  return { kind: 'fixed', month: d.getMonth() + 1, day_of_month: d.getDate(), weekday: d.getDay(), nth: d.getDate() > 28 ? -1 : Math.ceil(d.getDate() / 7), lead_weeks: 6 };
}

/** What the server wants for a rule from the form's fields. */
export function ruleBody(form) {
  const body = { rule: form.kind, lead_weeks: Number(form.lead_weeks) };
  if (form.kind !== 'manual') body.month = Number(form.month);
  if (form.kind === 'fixed') body.day_of_month = Number(form.day_of_month);
  if (form.kind === 'weekday') { body.weekday = Number(form.weekday); body.nth = Number(form.nth); }
  return body;
}

/** How a holiday finds its day (the same date, a weekday rule, or set each year) and how early to start. Used by the holiday form and by Every year on a plan. */
export function RuleFields({ form, set, askDay = false }) {
  return (
    <>
      <Field label="Its day">
        <select value={form.kind} onChange={set('kind')} className={field}>
          <option value="weekday">A weekday of a month (the fourth Thursday of November)</option>
          <option value="fixed">The same date every year (December 25)</option>
          <option value="manual">I'll set it each year</option>
        </select>
      </Field>
      {form.kind === 'weekday' && (
        <div className="grid grid-cols-3 gap-3">
          <Field label="Which"><select value={form.nth} onChange={set('nth')} className={field}>{NTHS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
          <Field label="Weekday"><select value={form.weekday} onChange={set('weekday')} className={field}>{WEEKDAYS.map((l, v) => <option key={l} value={v}>{l}</option>)}</select></Field>
          <Field label="of"><select value={form.month} onChange={set('month')} className={field}>{MONTHS.map((l, v) => <option key={l} value={v + 1}>{l}</option>)}</select></Field>
        </div>
      )}
      {form.kind === 'fixed' && (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Month"><select value={form.month} onChange={set('month')} className={field}>{MONTHS.map((l, v) => <option key={l} value={v + 1}>{l}</option>)}</select></Field>
          <Field label="Day"><input type="number" min="1" max="31" value={form.day_of_month} onChange={set('day_of_month')} className={field} /></Field>
        </div>
      )}
      {form.kind === 'manual' && askDay && <Field label="This year's day"><input type="date" required value={form.day} onChange={set('day')} className={field} /></Field>}
      {form.kind === 'manual' && <Hint>Life Is asks for next year's day when this year's is finished.</Hint>}
      <Field label="Start planning this many weeks ahead"><input type="number" min="1" max="26" value={form.lead_weeks} onChange={set('lead_weeks')} className={field} /></Field>
    </>
  );
}

/** A holiday's name and how it finds its day: the same date, a weekday rule, or set each year. */
function HolidayForm({ holiday, onDone }) {
  const [form, setForm] = useState({ ...ruleStart(holiday?.rule ?? null, holiday?.lead_weeks, null), name: holiday?.name ?? '', day: toDateInput(new Date()) });
  const [error, setError] = useState('');
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const submit = async (e) => {
    e.preventDefault();
    const body = { name: form.name, ...ruleBody(form) };
    if (!holiday && form.kind === 'manual') body.day = form.day;
    try {
      const { data } = holiday ? await axios.put(`${API}/${holiday.id}`, body) : await axios.post(API, body);
      onDone(data);
    } catch (err) { setError(errorMessage(err, "Couldn't save")); }
  };
  return (
    <form onSubmit={submit} className="space-y-3">
      <Field label="Name *"><input required autoFocus value={form.name} onChange={set('name')} placeholder="e.g. Thanksgiving" className={field} /></Field>
      <RuleFields form={form} set={set} askDay={!holiday} />
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex justify-end"><button type="submit" className={button}>{holiday ? 'Save' : 'Add it'}</button></div>
    </form>
  );
}

// ==================== one holiday ====================

/**
 * A holiday's address. Each of its years is a plan, so this sends you to the plan page of the upcoming year (else the
 * latest). Only a holiday with no year yet still shows a small page here: its name, its rule, and a button to start it.
 */
export function HolidayPage() {
  const { id, planId } = useParams();
  if (planId) return <Navigate to={`/plans/${planId}`} replace />;
  return <HolidayStart key={id} id={id} />;
}

function HolidayStart({ id }) {
  const navigate = useNavigate();
  const [holiday, setHoliday] = useState(undefined);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);
  const load = useCallback(() => { axios.get(`${API}/${id}`).then(({ data }) => setHoliday(data)).catch(() => setHoliday(null)); }, [id]);
  useEffect(() => { load(); }, [load]);
  if (holiday === undefined) return null;
  if (holiday === null) return <p className="text-sm text-gray-500 dark:text-life-300">That holiday isn't here anymore. It may have been deleted. <Link to="/plans/holidays" className="underline">All holidays</Link></p>;
  const wanted = holiday.years.find((y) => y.day >= toDateInput(new Date()))?.plan_id ?? holiday.latest?.plan_id;
  if (wanted) return <Navigate to={`/plans/${wanted}`} replace />;
  const start = async (day) => {
    setError('');
    try { const { data } = await axios.post(`${API}/${id}/years`, day ? { day } : {}); navigate(`/plans/${data.plan_id}`); } catch (err) { setError(errorMessage(err, "Couldn't start it")); }
  };
  const removeHoliday = async () => {
    if (!window.confirm(`Stop keeping ${holiday.name} as a holiday? Each of its years stays as a plan, to look back on.`)) return;
    await axios.delete(`${API}/${id}`).catch(() => {});
    navigate('/plans/holidays');
  };
  return (
    <div className="space-y-4">
      <Link to="/plans/holidays" className="text-sm text-life-600 hover:underline dark:text-life-200">← Holidays</Link>
      <div className="flex flex-wrap items-start gap-2">
        <div className="mr-auto">
          <h1 className="text-2xl font-semibold text-life-800 dark:text-life-50">{holiday.name}</h1>
          <p className="text-sm text-gray-600 dark:text-life-200">{holiday.rule_words}</p>
        </div>
        <button type="button" onClick={() => setEditing(true)} className={quiet}>Change</button>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <GivenToYou only={holiday.name} />
      <p className="text-sm text-gray-600 dark:text-life-100">No year has been started yet.</p>
      <NextYear name={holiday.name} manual={holiday.rule.kind === 'manual'} start={start} />
      <p className="pt-4"><button type="button" onClick={removeHoliday} className="min-h-[44px] text-sm text-red-700 hover:underline dark:text-red-300">Stop keeping this holiday</button></p>
      {editing && (
        <Modal title={`Change ${holiday.name}`} onClose={() => setEditing(false)}>
          <HolidayForm holiday={holiday} onDone={() => { setEditing(false); load(); }} />
        </Modal>
      )}
    </div>
  );
}

/** When the last year is over: start the next from it, or ask for its day when the day is set each year. */
export function NextYear({ name, manual, start }) {
  const [day, setDay] = useState(toDateInput(new Date()));
  return (
    <section className={`${cardClass} space-y-2`} aria-label="Start the next year">
      <Heading icon="plan">{manual ? `When is this year's ${name}?` : `Start this year's ${name}`}</Heading>
      <Hint>{manual ? "You set its day each year. Next year's starts from this one: the same guests, cards, decorations and countdown, with nothing checked off." : "Starts from last year's: the same guests, cards, decorations and countdown, with nothing checked off, and what broke or ran out last year on the shopping list."}</Hint>
      {manual && <Field label="The day"><input type="date" value={day} onChange={(e) => setDay(e.target.value)} className={field} /></Field>}
      <button type="button" onClick={() => start(manual ? day : null)} className={button}>Start it</button>
    </section>
  );
}

/** The note you left yourself at the end of last year. */
export function LastNote({ year }) {
  if (!year.last_notes) return null;
  return (
    <section className={`${cardClass} border-l-4 border-honey-300`}>
      <Heading icon="reminder">You left yourself a note</Heading>
      <p className="whitespace-pre-wrap text-sm text-gray-800 dark:text-life-50">{year.last_notes}</p>
    </section>
  );
}

/** The day, the budget, when the decorations go up and come down. (When the food is served is in the Food card.) */
export function Basics({ year, put, parts }) {
  const save = (patch) => put(`years/${year.plan_id}`, patch);
  const uses = (part) => parts.includes(part);
  return (
    <section className={`${cardClass} space-y-3`} aria-label="The day">
      <Heading icon="plan">The day</Heading>
      <div className="grid grid-cols-2 gap-3">
        <Field label="The day"><input type="date" key={year.day} defaultValue={year.day} onBlur={(e) => e.target.value && e.target.value !== year.day && save({ day: e.target.value })} className={field} /></Field>
        {uses('budget') && <Field label="Budget"><input type="number" min="0" step="0.01" key={year.budget_cents ?? 'none'} defaultValue={dollars(year.budget_cents)} placeholder="none" onBlur={(e) => cents(e.target.value) !== year.budget_cents && save({ budget_cents: cents(e.target.value) })} className={field} /></Field>}
        {uses('decorations') && <Field label="Put the decorations up on"><input type="date" key={year.put_up_on ?? 'none'} defaultValue={year.put_up_on ?? ''} onBlur={(e) => (e.target.value || null) !== year.put_up_on && save({ put_up_on: e.target.value || null })} className={field} /></Field>}
        {uses('decorations') && <Field label="Take them down on"><input type="date" key={year.take_down_on ?? 'none'} defaultValue={year.take_down_on ?? ''} onBlur={(e) => (e.target.value || null) !== year.take_down_on && save({ take_down_on: e.target.value || null })} className={field} /></Field>}
      </div>
      {uses('decorations') && <Hint>You get a reminder the morning of each of those days if something is left to do.</Hint>}
    </section>
  );
}

/** Everything counted back from when the food is served: each recipe's prep steps, what thaws, steps of your own. */
export function Countdown({ year, put, post, del }) {
  const { countdown } = year;
  // Words for a meal say dinner; for refreshments, "served".
  const meal = countdown.food_kind === 'meal';
  const RULES = [['night_before', 'The night before'], ['morning_of', 'The morning of'], ['hours_before', meal ? 'Hours before dinner' : 'Hours before it is served']];
  const [form, setForm] = useState({ words: '', rule: 'morning_of', at: '09:00', hours: 2 });
  const add = async (e) => {
    e.preventDefault();
    await post(`years/${year.plan_id}/steps`, { words: form.words, rule: form.rule, at: form.rule === 'hours_before' ? null : form.at, hours: form.rule === 'hours_before' ? Number(form.hours) : null });
    setForm({ ...form, words: '' });
  };
  return (
    <section className={`${cardClass} space-y-2`} aria-label={meal ? 'Dinner countdown' : 'Countdown'}>
      <Heading icon="timer">{meal ? 'Dinner countdown' : 'Countdown'}{countdown.served_at ? `: ${meal ? 'dinner' : 'served'} at ${timeText(countdown.served_at)}` : ''}</Heading>
      {!countdown.served_at && <p className="text-sm text-gray-600 dark:text-life-100">Set when it is served, above, and Life Is works back from it: each recipe's prep reminders, its cooking time, what thaws, and steps of your own.</p>}
      {countdown.thaw.map((t) => (
        <p key={t.label} className="rounded-lg bg-life-50/70 p-2 text-sm text-gray-800 dark:bg-life-700/60 dark:text-life-50">
          A frozen {t.pounds} lb {t.label} needs {t.days} {t.days === 1 ? 'day' : 'days'} in the refrigerator: 24 hours for each 4 pounds, rounded up to be safe. <span className="text-xs text-gray-500 dark:text-life-300">{t.source}</span>
        </p>
      ))}
      <ul className="divide-y divide-life-100 dark:divide-life-700">
        {countdown.steps.map((s) => (
          <li key={s.key} className="flex items-center gap-1" data-countdown-step>
            <Tick checked={s.done} label={`${s.words} is done`} onChange={(done) => put(`years/${year.plan_id}/ticks`, { key: s.key, done })}>
              <span className={s.done ? 'text-gray-400 line-through' : ''}>
                <span className="block text-xs font-medium text-life-700 dark:text-life-200">{s.label}{s.late && <span className="ml-2 rounded bg-honey-100 px-1.5 text-[11px] text-honey-700">late</span>}</span>
                {s.words}{s.what && <span className="text-gray-500 dark:text-life-300"> · {s.what}</span>}
                {s.detail && <span className="block text-xs text-gray-500 dark:text-life-300">{s.detail}</span>}
              </span>
            </Tick>
            {s.step_id && <Remove label={`Remove the step ${s.words}`} onClick={() => del(`steps/${s.step_id}`)} />}
          </li>
        ))}
      </ul>
      <form onSubmit={add} className="space-y-2 pt-2">
        <Field label="A step of your own"><input required value={form.words} onChange={(e) => setForm({ ...form, words: e.target.value })} placeholder="Make the gravy" className={field} /></Field>
        <div className="flex flex-wrap items-end gap-2">
          <select value={form.rule} onChange={(e) => setForm({ ...form, rule: e.target.value })} aria-label="When" className={`${field} w-auto`}>{RULES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          {form.rule === 'hours_before'
            ? <input type="number" min="1" max="72" value={form.hours} onChange={(e) => setForm({ ...form, hours: e.target.value })} aria-label={meal ? 'Hours before dinner' : 'Hours before it is served'} className={`${field} w-20`} />
            : <input type="time" value={form.at} onChange={(e) => setForm({ ...form, at: e.target.value })} aria-label="Time of day" className={`${field} w-auto`} />}
          <button type="submit" className={quiet}>Add the step</button>
        </div>
      </form>
    </section>
  );
}

/** Who came, or who gets a card: names from the household, or typed. */
export function People({ year, options, post, put, del, role }) {
  const list = role === 'guest' ? year.guests : year.cards;
  const [pick, setPick] = useState('');
  const [name, setName] = useState('');
  const add = async (e) => {
    e.preventDefault();
    const [kind, who] = pick.split(':');
    await post(`years/${year.plan_id}/people`, { role, name: name || null, ...(kind === 'user' ? { user_id: Number(who) } : kind === 'member' ? { member_id: Number(who) } : {}) });
    setPick(''); setName('');
  };
  const done = list.filter((p) => p.done).length;
  // A holiday's year says who came; any other plan just has guests.
  const title = role === 'guest' ? (year.holiday === null ? 'Guests' : 'Who came') : 'Cards';
  return (
    <section className={`${cardClass} space-y-2`} aria-label={title}>
      <Heading icon={role === 'guest' ? 'guests' : 'email'} aside={list.length > 0 ? <span className="text-xs text-gray-500 dark:text-life-300">{done} of {list.length} {role === 'guest' ? 'came' : 'sent'}</span> : null}>{title}</Heading>
      {list.length === 0 && <Hint>{role === 'guest' ? 'Add who is invited, and check each one off as they come. Next year starts with the same list.' : 'Add who gets a card, and check each one off as you send it.'}</Hint>}
      <ul className="divide-y divide-life-100 dark:divide-life-700">
        {list.map((p) => (
          <li key={p.id} className="flex items-center gap-1">
            <Tick checked={p.done} label={`${p.name} ${role === 'guest' ? 'came' : 'was sent a card'}`} onChange={(v) => put(`people/${p.id}`, { done: v })}>{p.name}</Tick>
            <Remove label={`Remove ${p.name}`} onClick={() => del(`people/${p.id}`)} />
          </li>
        ))}
      </ul>
      <form onSubmit={add} className="flex flex-wrap gap-2">
        <select value={pick} onChange={(e) => setPick(e.target.value)} aria-label={`${title}: pick someone from your household`} className={`${field} w-auto flex-1`}>
          <option value="">Someone else…</option>
          {options.members.map((m) => <option key={`m${m.id}`} value={`member:${m.id}`}>{m.name}</option>)}
          {options.users.map((u) => <option key={`u${u.id}`} value={`user:${u.id}`}>{u.name} (signs in)</option>)}
        </select>
        {!pick && <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" aria-label={`${title}: a name`} className={`${field} flex-1`} />}
        <button type="submit" className={quiet} disabled={!pick && !name.trim()}>Add</button>
      </form>
    </section>
  );
}

/** Gift ideas through the year, bought, wrapped, given, and what was given before. */
export function Gifts({ year, options, post, put, del }) {
  const [pick, setPick] = useState('');
  const [who, setWho] = useState('');
  const [idea, setIdea] = useState('');
  const add = async (e) => {
    e.preventDefault();
    const [kind, one] = pick.split(':');
    await post(`years/${year.plan_id}/gifts`, { who: who || null, idea, ...(kind === 'user' ? { for_user: Number(one) } : kind === 'member' ? { for_member: Number(one) } : {}) });
    setIdea(''); setWho(''); setPick('');
  };
  return (
    <section className={`${cardClass} space-y-2`} aria-label="Gifts">
      <Heading icon="gift">Gifts</Heading>
      {year.gifts.length === 0 && <Hint>Write an idea down whenever it comes, all year. Ideas not used carry over to next year.</Hint>}
      <ul className="divide-y divide-life-100 dark:divide-life-700">
        {year.gifts.map((g) => (
          <li key={g.id} className="space-y-1 py-2" data-gift>
            <div className="flex items-start gap-1">
              <span className="min-w-0 flex-1 text-sm text-gray-800 dark:text-life-50"><strong>{g.who}</strong>: {g.idea}
                {g.for_user !== null && <span className="block text-xs text-gray-500 dark:text-life-300">They sign in to Life Is, so this is hidden from them until the day has passed.</span>}
                {g.before.length > 0 && <span className="block text-xs text-gray-500 dark:text-life-300">Given before: {g.before.map((b) => `${b.year} ${b.idea}`).join(', ')}</span>}
              </span>
              <Remove label={`Remove the gift idea ${g.idea}`} onClick={() => del(`gifts/${g.id}`)} />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <select value={g.status} onChange={(e) => put(`gifts/${g.id}`, { status: e.target.value })} aria-label={`Where the gift ${g.idea} is`} className={`${field} w-auto`}>
                {GIFT_STATES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
              {g.status !== 'idea' && (
                <label className="flex items-center gap-1 text-sm text-gray-700 dark:text-life-100">Cost
                  <input type="number" min="0" step="0.01" key={g.cents ?? 'none'} defaultValue={dollars(g.cents)} aria-label={`What ${g.idea} cost`} onBlur={(e) => cents(e.target.value) !== g.cents && put(`gifts/${g.id}`, { cents: cents(e.target.value) })} className={`${field} w-28`} />
                </label>
              )}
            </div>
          </li>
        ))}
      </ul>
      <form onSubmit={add} className="space-y-2">
        <div className="flex flex-wrap gap-2">
          <select value={pick} onChange={(e) => setPick(e.target.value)} aria-label="Who the gift is for" className={`${field} w-auto flex-1`}>
            <option value="">Someone else…</option>
            {options.members.map((m) => <option key={`m${m.id}`} value={`member:${m.id}`}>{m.name}</option>)}
            {options.users.map((u) => <option key={`u${u.id}`} value={`user:${u.id}`}>{u.name} (signs in)</option>)}
          </select>
          {!pick && <input value={who} onChange={(e) => setWho(e.target.value)} placeholder="Who is it for?" aria-label="Who the gift is for, by name" className={`${field} flex-1`} />}
        </div>
        <div className="flex gap-2">
          <input required value={idea} onChange={(e) => setIdea(e.target.value)} placeholder="The idea" aria-label="The gift idea" className={field} />
          <button type="submit" className={quiet} disabled={!idea.trim() || (!pick && !who.trim())}>Add</button>
        </div>
      </form>
    </section>
  );
}

/** What it came to, from spending tagged with the holiday's tag. */
export function Budget({ year }) {
  const { budget } = year;
  const over = budget.target_cents !== null && budget.spent_cents > budget.target_cents;
  return (
    <section className={`${cardClass} space-y-1`} aria-label="Budget">
      <Heading icon="receipt">Budget</Heading>
      <p className="text-sm text-gray-800 dark:text-life-50">
        <strong className={over ? 'text-red-700 dark:text-red-300' : ''}>{money(budget.spent_cents)}</strong> spent{budget.target_cents !== null ? ` of ${money(budget.target_cents)}` : ''}
        {budget.count > 0 ? ` · ${budget.count} ${budget.count === 1 ? 'entry' : 'entries'}` : ''}
      </p>
      <Hint>Counts spending tagged {budget.tag ? `"${budget.tag}"` : 'with the holiday\'s name'} in the year around the day. A gift you mark as bought, with its cost, is counted too.</Hint>
    </section>
  );
}

/** What broke or ran out last year, to buy for this one. */
export function Shopping({ year, put }) {
  if (year.shopping.length === 0) return null;
  return (
    <section className={`${cardClass} space-y-1`} aria-label="To buy">
      <Heading icon="cart">To buy for this year</Heading>
      <Hint>From last year's take-down: what broke or ran out.</Hint>
      <ul className="divide-y divide-life-100 dark:divide-life-700">
        {year.shopping.map((d) => (
          <li key={d.id}><Tick checked={d.need_done} label={`${d.label} is bought`} onChange={(v) => put(`decor/${d.id}`, { need_done: v })}>
            <span className={d.need_done ? 'text-gray-400 line-through' : ''}>{d.label} <span className="text-xs text-gray-500 dark:text-life-300">· {d.need === 'broke' ? 'broke' : 'ran out'} last year · {d.spot}</span></span>
          </Tick></li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Decorations by spot. "Put up": each spot with last year's photo and this year's, the things that go there and the
 * box each is kept in. "Take down": tick each one down and back in its box, and mark what broke or ran out.
 */
export function Decor({ year, options, post, put, del, act, mode }) {
  const up = mode === 'up';
  const [things, setThings] = useState([]);
  const [form, setForm] = useState({ spot: '', label: '', thing: '', box: '' });
  const [error, setError] = useState('');
  const picker = useRef(null);
  const [photoFor, setPhotoFor] = useState('');
  useEffect(() => { if (up) axios.get('/api/things/items').then(({ data }) => setThings(data)).catch(() => {}); }, [up]);
  const all = year.spots.flatMap((s) => s.items);
  const left = all.filter((d) => (up ? !d.put_up : !d.taken_down || !d.boxed)).length;
  const add = async (e) => {
    e.preventDefault();
    await post(`years/${year.plan_id}/decor`, { spot: form.spot, label: form.label || null, thing_id: form.thing ? Number(form.thing) : null, box_id: form.box ? Number(form.box) : null });
    setForm({ ...form, label: '', thing: '', box: '' });
  };
  const addPhoto = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !photoFor) return;
    setError('');
    try { await act(async () => axios.post(`${API}/years/${year.plan_id}/spot-photos`, { spot: photoFor, data: await shrink(file) })); } catch (err) { setError(errorMessage(err, "That photo couldn't be added")); }
  };
  return (
    <section className={`${cardClass} space-y-3`} aria-label={up ? 'Put up' : 'Take down'} data-decor={mode}>
      <Heading icon={up ? 'home' : 'box'} aside={all.length > 0 ? <span className="text-xs text-gray-500 dark:text-life-300">{left === 0 ? 'All done' : `${left} left`}</span> : null}>{up ? 'Decorations: put up' : 'Take down'}</Heading>
      {all.length === 0 && up && <Hint>Add each decoration and where it goes: a room or a spot. A decoration can be one of your things, kept in a box (a place). Take a photo of each spot this year, and next year's list shows it.</Hint>}
      {all.length === 0 && !up && <Hint>Nothing to take down yet. Add decorations above first.</Hint>}
      {error && <p className="text-sm text-red-600">{error}</p>}
      {year.spots.map((s) => (
        <div key={s.name} className="space-y-1 rounded-xl bg-life-50/50 p-2 dark:bg-life-700/40" data-spot={s.name}>
          <h3 className="text-sm font-semibold text-life-800 dark:text-life-50">{s.name}</h3>
          {up && (
            <div className="flex flex-wrap items-end gap-2">
              {s.last_year.photos.map((p) => (
                <figure key={p} className="m-0"><Picture src={photoAddress(p)} alt={`${s.name} in ${s.last_year.year}`} loading="lazy" className="h-24 w-24 rounded-lg object-cover" /><figcaption className="text-[11px] text-gray-500 dark:text-life-300">Last year</figcaption></figure>
              ))}
              {s.photos.map((p) => (
                <figure key={p} className="m-0"><Picture src={photoAddress(p)} alt={`${s.name} this year`} loading="lazy" className="h-24 w-24 rounded-lg object-cover" /><figcaption className="text-[11px] text-gray-500 dark:text-life-300">This year</figcaption></figure>
              ))}
              {s.last_year.photos.length === 0 && s.last_year.year && <span className="text-xs text-gray-500 dark:text-life-300">No photo of this spot from {s.last_year.year}.</span>}
              <button type="button" onClick={() => { setPhotoFor(s.name); picker.current?.click(); }} aria-label={`Add a photo of ${s.name}`} className={quiet}><Icon of="scan" /> Photo</button>
            </div>
          )}
          <ul className="divide-y divide-life-100 dark:divide-life-700">
            {s.items.map((d) => (
              <li key={d.id} className="py-1" data-decor-item>
                {up ? (
                  <div className="flex items-center gap-1">
                    <Tick checked={d.put_up} label={`${d.label} is up`} onChange={(v) => put(`decor/${d.id}`, { put_up: v })}>
                      <span className={d.put_up ? 'text-gray-400 line-through' : ''}>{d.label}</span>
                      {d.box && <span className="block text-xs text-gray-500 dark:text-life-300">Kept in {d.box}</span>}
                    </Tick>
                    <Remove label={`Remove ${d.label}`} onClick={() => del(`decor/${d.id}`)} />
                  </div>
                ) : (
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-x-4">
                      <Tick checked={d.taken_down} label={`${d.label} is down`} onChange={(v) => put(`decor/${d.id}`, { taken_down: v })}>{d.label}</Tick>
                      <Tick checked={d.boxed} disabled={!d.taken_down} label={`${d.label} is back in its box`} onChange={(v) => put(`decor/${d.id}`, { boxed: v })}>Back in its box{d.box ? `: ${d.box}` : ''}</Tick>
                    </div>
                    <div role="group" aria-label={`How ${d.label} is`} className="flex flex-wrap gap-1.5 pb-1">
                      {[[null, 'Fine'], ['broke', 'Broke'], ['out', 'Ran out']].map(([v, l]) => (
                        <button key={l} type="button" aria-pressed={d.fix === v} onClick={() => put(`decor/${d.id}`, { fix: v })}
                          className={`min-h-[44px] rounded-full px-4 text-sm ${d.fix === v ? (v ? 'bg-honey-100 font-semibold text-honey-700 ring-1 ring-honey-300' : 'bg-life-100 font-semibold text-life-800') : 'bg-white text-gray-600 ring-1 ring-life-200 dark:bg-life-800 dark:text-life-100 dark:ring-life-700'}`}>{l}</button>
                      ))}
                      {d.fix && <span className="flex items-center text-xs text-gray-500 dark:text-life-300">On next year's shopping list</span>}
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
      <input ref={picker} type="file" accept="image/*" onChange={addPhoto} className="hidden" aria-label="Choose a photo of the spot" />
      {up && (
        <form onSubmit={add} className="space-y-2">
          <p className="text-xs font-medium text-gray-600 dark:text-life-200">Add a decoration</p>
          <div className="flex flex-wrap gap-2">
            <input required list={`spots-${year.plan_id}`} value={form.spot} onChange={(e) => setForm({ ...form, spot: e.target.value })} placeholder="Where" aria-label="Where it goes" className={`${field} flex-1`} />
            <datalist id={`spots-${year.plan_id}`}>{year.spots.map((s) => <option key={s.name} value={s.name} />)}</datalist>
            <select value={form.thing} onChange={(e) => setForm({ ...form, thing: e.target.value })} aria-label="One of your things" className={`${field} flex-1`}>
              <option value="">Not one of my things</option>
              {things.map((t) => <option key={t.id} value={t.id}>{t.name}{t.place ? ` (${t.place})` : ''}</option>)}
            </select>
          </div>
          {!form.thing && (
            <div className="flex flex-wrap gap-2">
              <input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="What it is" aria-label="What it is" className={`${field} flex-1`} />
              <select value={form.box} onChange={(e) => setForm({ ...form, box: e.target.value })} aria-label="The box it is kept in" className={`${field} flex-1`}>
                <option value="">Kept in…</option>
                {options.boxes.map((b) => <option key={b.id} value={b.id}>{b.path}</option>)}
              </select>
            </div>
          )}
          <button type="submit" className={quiet} disabled={!form.spot.trim() || (!form.thing && !form.label.trim())}>Add it</button>
        </form>
      )}
      {!up && all.length > 0 && <button type="button" onClick={() => post(`years/${year.plan_id}/take-down-done`, {})} className={button}>Everything is down and boxed</button>}
    </section>
  );
}

/** How it went, notes for next year, and finishing the year, which starts the next one. */
export function Ending({ year, past, post, reload }) {
  const [story, setStory] = useState(year.plan.story ?? '');
  const [notes, setNotes] = useState(year.notes_next ?? '');
  const [saved, setSaved] = useState('');
  const keepStory = async () => {
    const p = year.plan;
    await axios.put(`/api/plans/${p.id}`, { name: p.name, start_day: p.start_day, end_day: p.end_day, note: p.note, story: story || null });
    setSaved('Saved');
    reload();
  };
  return (
    <section className={`${cardClass} space-y-3`} aria-label="How it went">
      <Heading icon="plan">How it went</Heading>
      <Field label="A note on how it went"><textarea rows={3} value={story} onChange={(e) => { setStory(e.target.value); setSaved(''); }} onBlur={keepStory} className={inputClass} /></Field>
      <Field label="What should next year remember?"><textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Less stuffing. Start the pie the day before." className={inputClass} /></Field>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => post(`years/${year.plan_id}/finish`, { notes: notes || null })} className={past && !year.notes_done ? button : quiet}>
          {year.notes_done ? 'Save the note' : 'Finish this year'}
        </button>
        {saved && <span className="text-xs text-gray-500 dark:text-life-300">{saved}</span>}
      </div>
      <Hint>{year.notes_done ? 'This year is finished. Next year was started from it.' : 'Finishing keeps your note for next year and starts next year from this one. Nothing is deleted.'}</Hint>
    </section>
  );
}
