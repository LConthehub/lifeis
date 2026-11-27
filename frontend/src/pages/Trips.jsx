import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import axios from 'axios';
import SubChips, { PLAN_CHIPS } from '../components/SubChips';
import Icon from '../components/Icon';
import { money } from '../components/Budget';
import { PlanGoal } from '../components/Goals';
import Modal, { Field, inputClass, buttonClass, quietButtonClass, cardClass, errorMessage, fromDateInput, toDateInput } from '../components/ui';
import { Heading, Hint, Remove, Tick } from './Holidays';

const API = '/api/plans/trips';
const field = `${inputClass} min-h-[44px]`;
const button = `${buttonClass} min-h-[44px]`;
const quiet = `${quietButtonClass} min-h-[44px]`;
const PARTS = [['camping', 'Camping'], ['fishing', 'Fishing'], ['hunting', 'Hunting']];
const AFTER = [['', 'Nothing'], ['dry', 'Dry it'], ['clean', 'Clean it'], ['repair', 'Repair it (to Upkeep)'], ['replace', 'Replace it (to the shopping list)']];
const MEALS = [['breakfast', 'Breakfast'], ['lunch', 'Lunch'], ['dinner', 'Dinner'], ['snack', 'Snack']];
const dayText = (day, long = false) => fromDateInput(day).toLocaleDateString(undefined, long ? { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' } : { day: 'numeric', month: 'short', year: 'numeric' });
const dollars = (cents) => (cents === null || cents === undefined ? '' : (cents / 100).toFixed(2));
const cents = (text) => (String(text).trim() === '' ? null : Math.round(Number(text) * 100));
const numberOrNull = (text) => (String(text).trim() === '' ? null : Number(text));
const partWord = (parts) => parts.map((p) => PARTS.find(([k]) => k === p)[1]).join(', ');
/** Every day from `from` to `to`, as 2046-06-13. */
const daysBetween = (from, to) => { const out = []; for (let d = fromDateInput(from), n = 0; toDateInput(d) <= to && n < 120; d.setDate(d.getDate() + 1), n += 1) out.push(toDateInput(d)); return out; };
const addDays = (day, n) => { const d = fromDateInput(day); d.setDate(d.getDate() + n); return toDateInput(d); };

// ==================== the list of trips ====================

/** Outdoor trips: one trip that comes back each year. Only the ones you add. */
export default function TripsPage() {
  const [list, setList] = useState(null);
  const [shared, setShared] = useState([]);
  const [adding, setAdding] = useState(false);
  const navigate = useNavigate();
  const load = useCallback(() => {
    axios.get(API).then(({ data }) => setList(data)).catch(() => setList([]));
    axios.get(`${API}/shared`).then(({ data }) => setShared(data)).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);
  if (!list) return null;
  const open = (t) => navigate(t.years[0] ? `/plans/trips/${t.id}/${t.years[0].plan_id}` : `/plans/trips/${t.id}`);
  return (
    <div className="space-y-5">
      <SubChips items={PLAN_CHIPS} label="Plans, holidays and trips" />
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-xl font-semibold text-life-800 dark:text-life-50">Outdoor trips</h1>
        <button type="button" onClick={() => setAdding(true)} className={button}>+ Add a trip</button>
      </div>
      {list.length === 0 && (
        <div className={`${cardClass} text-sm text-gray-600 dark:text-life-100`}>
          An outdoor trip is a plan that comes back each year. Turn on the parts you need: camping, fishing, hunting. Each year starts from last year's:
          the bring list, the menu, the seasons and your notes. Places are only words. Nothing is looked up on a map or sent anywhere.
        </div>
      )}
      <ul className="grid gap-3 sm:grid-cols-2">
        {list.map((t) => (
          <li key={t.id}>
            <button type="button" onClick={() => open(t)} className={`${cardClass} flex h-full min-h-[44px] w-full flex-col gap-1 text-left hover:ring-life-300`}>
              <span className="flex items-center gap-2 font-medium text-life-800 dark:text-life-50"><Icon of="trip" /> {t.name}</span>
              <span className="text-xs text-gray-500 dark:text-life-300">
                {t.parts.length ? partWord(t.parts) : 'A plain trip'}{t.latest ? ` · ${dayText(t.latest.day)}` : ''}{t.years.length > 1 ? ` · ${t.years.length} years kept` : ''}{t.private ? ' · private' : ''}
              </span>
              {t.next && <span className="text-sm text-gray-700 dark:text-life-100">{t.next}</span>}
            </button>
          </li>
        ))}
      </ul>
      {shared.length > 0 && (
        <section className={`${cardClass} space-y-2`} aria-label="Shared with you">
          <Heading icon="guests">Shared with you</Heading>
          <Hint>Trips other people in the house have left shared: the name, the days and what was caught.</Hint>
          <ul className="divide-y divide-life-100 dark:divide-life-700">
            {shared.map((s) => (
              <li key={s.trip_id} className="py-2 text-sm text-gray-800 dark:text-life-50">
                <span className="font-medium">{s.name}</span> <span className="text-xs text-gray-500 dark:text-life-300">· {s.who} · {dayText(s.first_day)}{s.last_day !== s.first_day ? ` to ${dayText(s.last_day)}` : ''}</span>
                {s.catches.length > 0 && <span className="block text-xs text-gray-600 dark:text-life-200">Caught: {s.catches.map((c) => `${c.fish}${c.length_inches ? ` ${c.length_inches} in` : ''}`).join(', ')}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}
      {adding && (
        <Modal title="Add a trip" onClose={() => setAdding(false)}>
          <TripForm onDone={(t) => { setAdding(false); open(t); }} />
        </Modal>
      )}
    </div>
  );
}

/** A trip's name, the parts turned on and whether it is private. A new trip also asks for its days. */
function TripForm({ trip, onDone }) {
  const [form, setForm] = useState({ name: trip?.name ?? '', parts: trip?.parts ?? ['camping'], private: trip?.private ?? false, day: toDateInput(new Date()), end_day: '' });
  const [error, setError] = useState('');
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const toggle = (p) => setForm({ ...form, parts: form.parts.includes(p) ? form.parts.filter((x) => x !== p) : [...form.parts, p] });
  const submit = async (e) => {
    e.preventDefault();
    try {
      const body = { name: form.name, parts: form.parts, private: form.private };
      if (!trip) { body.day = form.day; if (form.end_day) body.end_day = form.end_day; }
      const { data } = trip ? await axios.put(`${API}/${trip.id}`, body) : await axios.post(API, body);
      onDone(data);
    } catch (err) { setError(errorMessage(err, "Couldn't save")); }
  };
  return (
    <form onSubmit={submit} className="space-y-3">
      <Field label="Name *"><input required autoFocus value={form.name} onChange={set('name')} placeholder="e.g. Lake weekend" className={field} /></Field>
      <fieldset className="space-y-1">
        <legend className="text-xs font-medium text-gray-600 dark:text-life-200">Parts to turn on</legend>
        {PARTS.map(([key, word]) => <Tick key={key} checked={form.parts.includes(key)} onChange={() => toggle(key)} label={word}>{word}</Tick>)}
        <Hint>Another kind of trip, a hike or a boat day, can leave them all off and use the plain trip for now.</Hint>
      </fieldset>
      {!trip && (
        <div className="grid grid-cols-2 gap-3">
          <Field label="First day"><input type="date" required value={form.day} onChange={set('day')} className={field} /></Field>
          <Field label="Last day"><input type="date" value={form.end_day} min={form.day} onChange={set('end_day')} className={field} /></Field>
        </div>
      )}
      <div>
        <Tick checked={form.private} onChange={(v) => setForm({ ...form, private: v })} label="Keep this trip private">Keep this trip private</Tick>
        <Hint>Left shared, the people in your house see its name, its days and what was caught. Hunting is never shown to anyone.</Hint>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex justify-end"><button type="submit" className={button}>{trip ? 'Save' : 'Add it'}</button></div>
    </form>
  );
}

// ==================== one trip, one year ====================

export function TripPage() {
  const { id, planId } = useParams();
  const navigate = useNavigate();
  const [trip, setTrip] = useState(undefined);
  const [year, setYear] = useState(null);
  const [options, setOptions] = useState({ things: [] });
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);
  const load = useCallback(async () => {
    try {
      const { data: t } = await axios.get(`${API}/${id}`);
      setTrip(t);
      const wanted = planId ? Number(planId) : t.years.find((y) => y.day >= toDateInput(new Date()))?.plan_id ?? t.latest?.plan_id;
      setYear(wanted ? (await axios.get(`${API}/years/${wanted}`)).data : null);
    } catch { setTrip(null); }
  }, [id, planId]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { axios.get(`${API}/options`).then(({ data }) => setOptions(data)).catch(() => {}); }, [year?.plan_id]);
  if (trip === undefined) return null;
  if (trip === null) return <p className="text-sm text-gray-500 dark:text-life-300">That trip isn't there. <Link to="/plans/trips" className="underline">All trips</Link></p>;

  /** Does something that answers with the year, and shows what came back. */
  const act = async (work) => {
    setError('');
    try { const done = await work(); if (done?.data?.plan_id) { setYear(done.data); return done.data; } await load(); } catch (err) { setError(errorMessage(err, "Couldn't do that")); }
    return null;
  };
  const start = async (body) => {
    setError('');
    try { const { data } = await axios.post(`${API}/${id}/years`, body); navigate(`/plans/trips/${id}/${data.plan_id}`); await load(); } catch (err) { setError(errorMessage(err, "Couldn't start it")); }
  };
  const removeTrip = async () => {
    if (!window.confirm(`Stop keeping ${trip.name}? Each of its years stays as a plan, to look back on.`)) return;
    await axios.delete(`${API}/${id}`).catch(() => {});
    navigate('/plans/trips');
  };
  const upcoming = trip.years.some((y) => y.day >= toDateInput(new Date()));
  return (
    <div className="space-y-4">
      <Link to="/plans/trips" className="text-sm text-life-600 hover:underline dark:text-life-200">← Outdoor trips</Link>
      <div className="flex flex-wrap items-start gap-2">
        <div className="mr-auto">
          <h1 className="text-2xl font-semibold text-life-800 dark:text-life-50">{trip.name}{year ? ` ${year.year}` : ''}</h1>
          <p className="text-sm text-gray-600 dark:text-life-200">
            {trip.parts.length ? partWord(trip.parts) : 'A plain trip'}{year ? ` · ${dayText(year.day, true)}${year.end_day !== year.day ? ` to ${dayText(year.end_day)}` : ''}` : ''}{trip.private ? ' · private' : ''}
          </p>
        </div>
        <button type="button" onClick={() => setEditing(true)} className={quiet}>Change</button>
      </div>
      {trip.years.length > 0 && (
        <nav aria-label="Years" className="flex flex-wrap gap-1.5">
          {trip.years.map((y) => (
            <Link key={y.plan_id} to={`/plans/trips/${id}/${y.plan_id}`} aria-current={year && y.plan_id === year.plan_id ? 'page' : undefined}
              className={`flex min-h-[44px] items-center rounded-full px-3 text-sm ${year && y.plan_id === year.plan_id ? 'bg-life-600 text-white' : 'bg-life-50 text-life-700 hover:bg-life-100 dark:bg-life-700 dark:text-life-50'}`}>{y.year}</Link>
          ))}
        </nav>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
      {!upcoming && year && <NextYear year={year} start={start} />}
      {year && <YearBody key={year.plan_id} year={year} options={options} act={act} reload={load} />}
      <p className="pt-4"><button type="button" onClick={removeTrip} className="min-h-[44px] text-sm text-red-700 hover:underline dark:text-red-300">Stop keeping this trip</button></p>
      {editing && (
        <Modal title={`Change ${trip.name}`} onClose={() => setEditing(false)}>
          <TripForm trip={trip} onDone={() => { setEditing(false); load(); }} />
        </Modal>
      )}
    </div>
  );
}

/** When the last year is over: start the next from it, on the same days a year on unless the person changes them. */
function NextYear({ year, start }) {
  const [day, setDay] = useState(`${Number(year.day.slice(0, 4)) + 1}${year.day.slice(4)}`);
  const [end, setEnd] = useState('');
  return (
    <section className={`${cardClass} space-y-2`} aria-label="Plan next year">
      <Heading icon="plan">Plan next year's trip</Heading>
      <Hint>Starts from this year's: the same bring list with nothing packed, the menu on new days, the seasons a year on, and your notes.</Hint>
      <div className="grid grid-cols-2 gap-3">
        <Field label="First day"><input type="date" value={day} onChange={(e) => setDay(e.target.value)} className={field} /></Field>
        <Field label="Last day (blank: as long as this year)"><input type="date" value={end} min={day} onChange={(e) => setEnd(e.target.value)} className={field} /></Field>
      </div>
      <button type="button" onClick={() => start({ day, ...(end ? { end_day: end } : {}) })} className={button}>Start next year's trip</button>
    </section>
  );
}

function YearBody({ year, options, act, reload }) {
  const put = (path, body) => act(() => axios.put(`${API}/${path}`, body));
  const post = (path, body) => act(() => axios.post(`${API}/${path}`, body));
  const del = (path) => act(() => axios.delete(`${API}/${path}`));
  const parts = year.trip.parts;
  const has = (p) => parts.includes(p);
  return (
    <div className="space-y-4">
      {year.last_notes && (
        <section className={`${cardClass} border-l-4 border-honey-300`}>
          <Heading icon="reminder">You left yourself a note</Heading>
          <p className="whitespace-pre-wrap text-sm text-gray-800 dark:text-life-50">{year.last_notes}</p>
        </section>
      )}
      <Basics year={year} put={put} />
      {year.checks.licenses.length > 0 && <Licenses year={year} />}
      {has('camping') && <Booking year={year} put={put} />}
      <BringList year={year} options={options} post={post} put={put} del={del} />
      {has('camping') && <Menu year={year} act={act} post={post} del={del} />}
      {(has('fishing') || has('hunting')) && <Seasons year={year} post={post} del={del} />}
      {has('fishing') && <Tackle year={year} post={post} />}
      {has('fishing') && <Catches year={year} options={options} post={post} put={put} del={del} />}
      {has('fishing') && year.worked.length > 0 && <Worked year={year} />}
      {has('hunting') && <Ammo year={year} />}
      {has('hunting') && <Harvest year={year} post={post} del={del} />}
      {year.gear.length > 0 && <After year={year} put={put} />}
      <Cost year={year} />
      <PlanGoal kind="plan" id={year.plan_id} />
      <Ending year={year} post={post} reload={reload} />
    </div>
  );
}

/** The days, the water, a budget. */
function Basics({ year, put }) {
  const save = (patch) => put(`years/${year.plan_id}`, patch);
  return (
    <section className={`${cardClass} space-y-3`} aria-label="The trip">
      <Heading icon="plan">The trip</Heading>
      <div className="grid grid-cols-2 gap-3">
        <Field label="First day"><input type="date" key={year.day} defaultValue={year.day} onBlur={(e) => e.target.value && e.target.value !== year.day && save({ day: e.target.value })} className={field} /></Field>
        <Field label="Last day"><input type="date" key={year.end_day} defaultValue={year.end_day} onBlur={(e) => e.target.value && e.target.value !== year.end_day && save({ end_day: e.target.value })} className={field} /></Field>
        {year.trip.parts.includes('fishing') && (
          <Field label="The water, in words"><input key={year.water ?? 'none'} defaultValue={year.water ?? ''} placeholder="Lake name, river, pond" onBlur={(e) => (e.target.value || null) !== year.water && save({ water: e.target.value || null })} className={field} /></Field>
        )}
        <Field label="Budget"><input type="number" min="0" step="0.01" key={year.budget_cents ?? 'none'} defaultValue={dollars(year.budget_cents)} placeholder="none" onBlur={(e) => cents(e.target.value) !== year.budget_cents && save({ budget_cents: cents(e.target.value) })} className={field} /></Field>
      </div>
      <Hint>The trip shows on your calendar by its name and days. Places are only words here: nothing is looked up or sent.</Hint>
    </section>
  );
}

/** What each license says about the trip's days. */
function Licenses({ year }) {
  return (
    <section className={`${cardClass} space-y-1`} aria-label="License check">
      <Heading icon="warranty">License check</Heading>
      <ul className="space-y-1">
        {year.checks.licenses.map((l) => (
          <li key={l.part} className={`text-sm ${l.ok ? 'text-gray-800 dark:text-life-50' : 'text-red-700 dark:text-red-300'}`}>{l.ok ? '✓ ' : '! '}{l.words}</li>
        ))}
      </ul>
      <Link to="/things/licenses" className="inline-flex min-h-[44px] items-center text-xs text-life-600 hover:underline dark:text-life-200">Licenses →</Link>
    </section>
  );
}

/** The site booking, typed in. It shows on the calendar. */
function Booking({ year, put }) {
  const b = year.booking;
  const save = (patch) => put(`years/${year.plan_id}`, patch);
  const text = (name, label, placeholder) => (
    <Field label={label}><input key={b[name] ?? 'none'} defaultValue={b[name] ?? ''} placeholder={placeholder} onBlur={(e) => (e.target.value || null) !== b[name] && save({ [name]: e.target.value || null })} className={field} /></Field>
  );
  const date = (name, label) => (
    <Field label={label}><input type="date" key={b[name] ?? 'none'} defaultValue={b[name] ?? ''} onBlur={(e) => (e.target.value || null) !== b[name] && save({ [name]: e.target.value || null })} className={field} /></Field>
  );
  return (
    <section className={`${cardClass} space-y-3`} aria-label="Campsite booking">
      <Heading icon="place">Campsite booking</Heading>
      <div className="grid grid-cols-2 gap-3">
        {text('campground', 'Campground', 'Name')}
        {text('site', 'Site', 'e.g. 14')}
        {text('confirmation', 'Confirmation number', '')}
        <span />
        {date('check_in', 'Check-in')}
        {date('check_out', 'Check-out')}
      </div>
      <Hint>Typed in by you. Check-in and check-out show on the calendar. Next year remembers the campground and site, not the confirmation number.</Hint>
    </section>
  );
}

/** The bring list: pack it, then see what came back and what each piece needs. */
function BringList({ year, options, post, put, del }) {
  const parts = year.trip.parts;
  const [part, setPart] = useState(parts[0] ?? 'camping');
  const [pick, setPick] = useState('');
  const [label, setLabel] = useState('');
  const [quantity, setQuantity] = useState('');
  const [caliber, setCaliber] = useState('');
  const [said, setSaid] = useState('');
  if (parts.length === 0) return null;
  const onList = new Set(year.gear.filter((g) => g.part === part).map((g) => g.thing_id));
  const packed = year.gear.filter((g) => g.packed).length;
  const add = async (e) => {
    e.preventDefault();
    if (!pick && !label.trim()) return;
    await post(`years/${year.plan_id}/gear`, { part, ...(pick ? { thing_id: Number(pick) } : {}), ...(label.trim() ? { label } : {}), ...(quantity ? { quantity: Number(quantity) } : {}), ...(part === 'hunting' && caliber ? { caliber } : {}) });
    setPick(''); setLabel(''); setQuantity(''); setCaliber('');
  };
  const fill = async (p) => {
    const done = await post(`years/${year.plan_id}/fill-gear`, { part: p });
    setSaid(done ? (done.added === 0 ? 'Nothing new to add: all your gear of that kind is on the list.' : `Added ${done.added}.`) : '');
  };
  return (
    <section className={`${cardClass} space-y-2`} aria-label="Bring list">
      <Heading icon="bring" aside={year.gear.length > 0 ? <span className="text-xs text-gray-500 dark:text-life-300">{packed} of {year.gear.length} packed</span> : null}>Bring list</Heading>
      {year.gear.length === 0 && <Hint>Start from your gear, or add things one at a time. Next year starts from this list with nothing packed.</Hint>}
      {parts.map((p) => {
        const rows = year.gear.filter((g) => g.part === p);
        return (
          <div key={p} className="space-y-1">
            {parts.length > 1 && <h3 className="text-xs font-semibold uppercase tracking-wide text-life-700 dark:text-life-200">{PARTS.find(([k]) => k === p)[1]}</h3>}
            <ul className="divide-y divide-life-100 dark:divide-life-700">
              {rows.map((g) => (
                <li key={g.id} className="flex items-center gap-1">
                  <Tick checked={g.packed} label={`${g.label} is packed`} onChange={(v) => put(`gear/${g.id}`, { packed: v })}>
                    <span className={g.packed ? 'text-gray-400 line-through' : ''}>
                      {g.label}{g.quantity ? ` × ${g.quantity}` : ''}{g.caliber ? ` (${g.caliber})` : ''}
                      {g.low && <span className="ml-2 rounded bg-honey-100 px-1.5 text-[11px] text-honey-700">running low</span>}
                      {(g.have || g.place) && <span className="block text-xs text-gray-500 dark:text-life-300">{[g.have ? `You have ${g.have}` : null, g.place ? `kept in ${g.place}` : null].filter(Boolean).join(' · ')}</span>}
                    </span>
                  </Tick>
                  <Remove label={`Take ${g.label} off the list`} onClick={() => del(`gear/${g.id}`)} />
                </li>
              ))}
            </ul>
            <button type="button" onClick={() => fill(p)} className={quiet}>Add my {p} gear</button>
          </div>
        );
      })}
      {said && <p className="text-xs text-gray-600 dark:text-life-200" role="status">{said}</p>}
      <form onSubmit={add} className="space-y-2 border-t border-life-100 pt-3 dark:border-life-700">
        {parts.length > 1 && (
          <Field label="For which part"><select value={part} onChange={(e) => { setPart(e.target.value); setPick(''); }} className={field}>{parts.map((p) => <option key={p} value={p}>{PARTS.find(([k]) => k === p)[1]}</option>)}</select></Field>
        )}
        <select value={pick} onChange={(e) => setPick(e.target.value)} aria-label="One of your things" className={field}>
          <option value="">One of your things…</option>
          {options.things.filter((t) => !onList.has(t.id)).map((t) => <option key={t.id} value={t.id}>{t.name} ({t.kind})</option>)}
        </select>
        <div className="grid grid-cols-3 gap-2">
          <input value={label} onChange={(e) => setLabel(e.target.value)} aria-label="Something else to bring" placeholder="Or something else" className={`${field} col-span-2`} />
          <input type="number" min="0" step="any" value={quantity} onChange={(e) => setQuantity(e.target.value)} aria-label="How many" placeholder="How many" className={field} />
        </div>
        {part === 'hunting' && <input value={caliber} onChange={(e) => setCaliber(e.target.value)} aria-label="Caliber, for ammunition" placeholder="Caliber, if this is ammunition (.308, 12 gauge)" className={field} />}
        <button type="submit" className={quiet}>Add to the list</button>
      </form>
    </section>
  );
}

/** The camp menu: recipes on the days they are eaten, then onto the grocery list; the cooler and stove checked. */
function Menu({ year, act, post, del }) {
  const [recipes, setRecipes] = useState([]);
  const [pick, setPick] = useState('');
  const [day, setDay] = useState(year.day);
  const [meal, setMeal] = useState('dinner');
  const [said, setSaid] = useState('');
  useEffect(() => { axios.get('/api/kitchen/recipes').then(({ data }) => setRecipes(data)).catch(() => {}); }, []);
  const have = new Set(year.menu.map((i) => i.ref_id));
  const days = daysBetween(addDays(year.day, -7), year.end_day);
  const add = async (e) => {
    e.preventDefault();
    if (!pick) return;
    await post(`years/${year.plan_id}/meals`, { recipe_id: Number(pick), day, meal });
    setPick('');
  };
  const toList = async () => {
    const done = await act(() => axios.post(`${API}/years/${year.plan_id}/groceries`));
    if (done) setSaid(done.added === 0 ? 'Nothing to add: the pantry has it all, or the menu is empty.' : `Put ${done.added} ${done.added === 1 ? 'thing' : 'things'} on the grocery list, less what the pantry has.`);
  };
  const check = year.checks.kitchen;
  return (
    <section className={`${cardClass} space-y-2`} aria-label="Camp menu">
      <Heading icon="meal" aside={<Link to={`/plans/${year.plan_id}`} className="text-xs text-life-600 hover:underline dark:text-life-200">The full plan, checklist and photos →</Link>}>Camp menu</Heading>
      {year.menu.length === 0 && <p className="text-sm text-gray-600 dark:text-life-100">Nothing on the menu yet. Pick from your recipes and say when it is eaten.</p>}
      <ul className="divide-y divide-life-100 dark:divide-life-700">
        {year.menu.map((i) => (
          <li key={i.id} className="flex items-center gap-1">
            <span className="min-w-0 flex-1 py-2 text-sm">
              {i.link ? <Link to={i.link} className="text-life-700 hover:underline dark:text-life-100">{i.label}</Link> : i.label}
              {i.on_week && <span className="text-xs text-gray-500 dark:text-life-300"> · {dayText(i.on_week.day)}, {i.on_week.meal}</span>}
            </span>
            <Remove label={`Take ${i.label} off the menu`} onClick={() => del(`meals/${i.id}`)} />
          </li>
        ))}
      </ul>
      <form onSubmit={add} className="space-y-2">
        <select value={pick} onChange={(e) => setPick(e.target.value)} aria-label="Recipe for the menu" className={field}>
          <option value="">Add a recipe…</option>
          {recipes.filter((r) => !have.has(r.id)).map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}
        </select>
        <div className="grid grid-cols-2 gap-2">
          <select value={day} onChange={(e) => setDay(e.target.value)} aria-label="Day it is eaten" className={field}>{days.map((d) => <option key={d} value={d}>{dayText(d)}</option>)}</select>
          <select value={meal} onChange={(e) => setMeal(e.target.value)} aria-label="Meal" className={field}>{MEALS.map(([k, w]) => <option key={k} value={k}>{w}</option>)}</select>
        </div>
        <button type="submit" className={quiet} disabled={!pick}>Add to the menu</button>
      </form>
      <div className="space-y-2 border-t border-life-100 pt-3 dark:border-life-700">
        <button type="button" onClick={toList} className={button}>Put the menu on the grocery list</button>
        {said && <p className="text-sm text-gray-700 dark:text-life-100" role="status">{said}</p>}
        <Hint>Fills the grocery list from the meals on these days, less what the pantry has. <Link to="/groceries" className="underline">Grocery list</Link></Hint>
      </div>
      {check && (
        <ul className="space-y-1 text-sm" aria-label="Cooler and stove">
          <li className={check.cooler ? 'text-gray-800 dark:text-life-50' : 'text-red-700 dark:text-red-300'}>{check.cooler ? `Cooler: you have ${check.cooler}.` : 'Cooler: none among your things. Add one under Things.'}</li>
          <li className={check.stove ? 'text-gray-800 dark:text-life-50' : 'text-red-700 dark:text-red-300'}>{check.stove ? `Stove: you have ${check.stove}.` : 'Stove: none among your things. Add one under Things.'}</li>
          {check.equipment.map((e) => <li key={`${e.day}${e.meal}${e.label}`} className="text-red-700 dark:text-red-300">{e.label}: {e.recipes.join(', ')} needs {e.need} and you have {e.have ?? 0} ({dayText(e.day)}, {e.meal}).</li>)}
        </ul>
      )}
    </section>
  );
}

/** Dates you type, with a reminder before opening day. */
function Seasons({ year, post, del }) {
  const parts = year.trip.parts.filter((p) => p !== 'camping');
  const [form, setForm] = useState({ part: parts[0], label: '', opens_on: '', closes_on: '', remind_days: 7 });
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const add = async (e) => {
    e.preventDefault();
    await post(`years/${year.plan_id}/seasons`, { part: form.part, label: form.label, opens_on: form.opens_on, ...(form.closes_on ? { closes_on: form.closes_on } : {}), remind_days: Number(form.remind_days) });
    setForm({ ...form, label: '', opens_on: '', closes_on: '' });
  };
  return (
    <section className={`${cardClass} space-y-2`} aria-label="Seasons">
      <Heading icon="date">Seasons</Heading>
      {year.seasons.length === 0 && <Hint>Type the dates from the rules you read: when a season opens and closes. Life Is reminds you before opening day. Next year's dates start a year on, so check them.</Hint>}
      <ul className="divide-y divide-life-100 dark:divide-life-700">
        {year.seasons.map((s) => (
          <li key={s.id} className="flex items-center gap-1">
            <span className="min-w-0 flex-1 py-2 text-sm text-gray-800 dark:text-life-50">
              {s.label} <span className="text-xs text-gray-500 dark:text-life-300">· {parts.length > 1 ? `${s.part} · ` : ''}opens {dayText(s.opens_on)}{s.closes_on ? `, closes ${dayText(s.closes_on)}` : ''}
                {s.days_to_open > 0 ? ` · in ${s.days_to_open} ${s.days_to_open === 1 ? 'day' : 'days'}` : ''} · reminder {s.remind_days} days before</span>
            </span>
            <Remove label={`Remove the season ${s.label}`} onClick={() => del(`seasons/${s.id}`)} />
          </li>
        ))}
      </ul>
      <form onSubmit={add} className="space-y-2">
        <div className="grid grid-cols-2 gap-2">
          <input required value={form.label} onChange={set('label')} aria-label="Season name" placeholder="Name, e.g. Walleye opener" className={`${field} col-span-2`} />
          {parts.length > 1 && <select value={form.part} onChange={set('part')} aria-label="Season for" className={`${field} col-span-2`}>{parts.map((p) => <option key={p} value={p}>{p === 'fishing' ? 'Fishing' : 'Hunting'}</option>)}</select>}
          <Field label="Opens"><input type="date" required value={form.opens_on} onChange={set('opens_on')} className={field} /></Field>
          <Field label="Closes"><input type="date" value={form.closes_on} min={form.opens_on} onChange={set('closes_on')} className={field} /></Field>
          <Field label="Remind me, days before"><input type="number" min="0" max="120" value={form.remind_days} onChange={set('remind_days')} className={field} /></Field>
        </div>
        <button type="submit" className={quiet}>Add the season</button>
      </form>
    </section>
  );
}

/** Line, hooks, weights and lures with a "running low" count reached. */
function Tackle({ year, post }) {
  const low = year.checks.tackle_low;
  const [said, setSaid] = useState('');
  if (low.length === 0) return null;
  const send = async () => { const done = await post(`years/${year.plan_id}/tackle-to-list`, {}); if (done) setSaid(done.added === 0 ? 'Already on the grocery list.' : `Put ${done.added} on the grocery list.`); };
  return (
    <section className={`${cardClass} space-y-1`} aria-label="Tackle running low">
      <Heading icon="warning">Tackle running low</Heading>
      <ul className="text-sm text-gray-800 dark:text-life-50">{low.map((t) => <li key={t.id} className="py-1">{t.name} <span className="text-xs text-gray-500 dark:text-life-300">· you have {t.amount}</span></li>)}</ul>
      <button type="button" onClick={send} className={quiet}>Put it on the grocery list</button>
      {said && <p className="text-xs text-gray-600 dark:text-life-200" role="status">{said}</p>}
    </section>
  );
}

/** The catch log: fish and water in words, the lure from your tackle, kept or released. */
function Catches({ year, options, post, put, del }) {
  const empty = { fish: '', day: year.day, water: year.water ?? '', length: '', weight: '', kept: false, lure_thing: '', lure: '' };
  const [form, setForm] = useState(empty);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const tackle = options.things.filter((t) => t.kind === 'Fishing tackle');
  const add = async (e) => {
    e.preventDefault();
    await post(`years/${year.plan_id}/catches`, {
      fish: form.fish, day: form.day, water: form.water || null, length_inches: numberOrNull(form.length), weight_lb: numberOrNull(form.weight), kept: form.kept,
      ...(form.lure_thing ? { lure_thing_id: Number(form.lure_thing) } : {}), ...(form.lure ? { lure: form.lure } : {}),
    });
    setForm({ ...empty, day: form.day, water: form.water });
  };
  return (
    <section className={`${cardClass} space-y-2`} aria-label="Catch log">
      <Heading icon="fish" aside={year.catches.length > 0 ? <span className="text-xs text-gray-500 dark:text-life-300">{year.catches.length} this year</span> : null}>Catch log</Heading>
      {year.catches.length === 0 && <Hint>Write down each fish: what it was, where, how big, and what you caught it on. Past years stay here.</Hint>}
      <ul className="divide-y divide-life-100 dark:divide-life-700">
        {year.catches.map((c) => (
          <li key={c.id} className="flex items-center gap-1" data-catch>
            <span className="min-w-0 flex-1 py-2 text-sm text-gray-800 dark:text-life-50">
              <strong>{c.fish}</strong> <span className="text-xs text-gray-500 dark:text-life-300">· {dayText(c.day)}{c.water ? ` · ${c.water}` : ''}</span>
              <span className="block text-xs text-gray-600 dark:text-life-200">
                {[c.length_inches ? `${c.length_inches} in` : null, c.weight_lb ? `${c.weight_lb} lb` : null, c.kept ? 'kept' : 'released', c.lure ? `on ${c.lure}` : null, c.frozen ? 'in the freezer' : null].filter(Boolean).join(' · ')}
              </span>
            </span>
            {c.kept && !c.frozen && <button type="button" onClick={() => post(`catches/${c.id}/freezer`, {})} aria-label={`Put the ${c.fish} in the freezer`} className={quiet}>To the freezer</button>}
            <Remove label={`Remove the ${c.fish} from the log`} onClick={() => del(`catches/${c.id}`)} />
          </li>
        ))}
      </ul>
      {year.catch_years.length > 0 && (
        <details className="text-sm">
          <summary className="flex min-h-[44px] cursor-pointer items-center text-life-700 dark:text-life-100">By year</summary>
          <ul className="space-y-1 pb-2 text-gray-700 dark:text-life-100">{year.catch_years.map((y) => <li key={y.year}>{y.year}: {y.count} {y.count === 1 ? 'fish' : 'fish'}, {y.kept} kept, {y.released} released{y.biggest_inches ? `, longest ${y.biggest_inches} in` : ''}</li>)}</ul>
        </details>
      )}
      <form onSubmit={add} className="space-y-2 border-t border-life-100 pt-3 dark:border-life-700">
        <div className="grid grid-cols-2 gap-2">
          <input required value={form.fish} onChange={set('fish')} aria-label="Fish" placeholder="Fish, e.g. walleye" className={`${field} col-span-2`} />
          <Field label="Day"><input type="date" value={form.day} onChange={set('day')} aria-label="Day caught" className={field} /></Field>
          <Field label="Water"><input value={form.water} onChange={set('water')} aria-label="Water" placeholder="In words" className={field} /></Field>
          <input type="number" min="0" step="any" value={form.length} onChange={set('length')} aria-label="Length (inches)" placeholder="Length, inches" className={field} />
          <input type="number" min="0" step="any" value={form.weight} onChange={set('weight')} aria-label="Weight (pounds)" placeholder="Weight, pounds" className={field} />
        </div>
        <select value={form.lure_thing} onChange={set('lure_thing')} aria-label="Lure from your tackle" className={field}>
          <option value="">Lure or bait from your tackle…</option>
          {tackle.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <input value={form.lure} onChange={set('lure')} aria-label="Or the lure in words" placeholder="Or the lure or bait in words" className={field} />
        <Tick checked={form.kept} onChange={(v) => setForm({ ...form, kept: v })} label="Kept">Kept (not released)</Tick>
        <button type="submit" className={button}>Log the catch</button>
      </form>
    </section>
  );
}

/** What worked, from your own log: for each water and season, the lures that caught fish. */
function Worked({ year }) {
  return (
    <section className={`${cardClass} space-y-1`} aria-label="What worked">
      <Heading icon="trophy">What worked</Heading>
      <Hint>From your own log{year.water ? `, on ${year.water}` : ''}: the lures that caught fish, by water and season.</Hint>
      <ul className="space-y-2">
        {year.worked.map((w) => (
          <li key={`${w.water}${w.season}`} className="text-sm text-gray-800 dark:text-life-50">
            <strong>{w.water}</strong> in {w.season}: {w.lures.map((l) => `${l.lure} (${l.count})`).join(', ')}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The ammunition on hand for each caliber on the bring list. */
function Ammo({ year }) {
  if (year.checks.ammo.length === 0) return null;
  return (
    <section className={`${cardClass} space-y-1`} aria-label="Ammunition check">
      <Heading icon="warning">Ammunition check</Heading>
      <ul className="space-y-1 text-sm">{year.checks.ammo.map((a) => <li key={a.caliber} className={a.short ? 'text-red-700 dark:text-red-300' : 'text-gray-800 dark:text-life-50'}><strong>{a.caliber}</strong>: {a.words}</li>)}</ul>
    </section>
  );
}

/** The harvest log: the animal in words, the tag number, and meat to the freezer. Private to its person. */
function Harvest({ year, post, del }) {
  const empty = { animal: '', day: year.day, place: '', tag_number: '', weight: '' };
  const [form, setForm] = useState(empty);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const add = async (e) => {
    e.preventDefault();
    await post(`years/${year.plan_id}/harvest`, { animal: form.animal, day: form.day, place: form.place || null, tag_number: form.tag_number || null, weight_lb: numberOrNull(form.weight) });
    setForm({ ...empty, day: form.day });
  };
  return (
    <section className={`${cardClass} space-y-2`} aria-label="Harvest log">
      <Heading icon="lock">Harvest log</Heading>
      <Hint>Private to you. Other people in the house see only the trip's name and days.</Hint>
      <ul className="divide-y divide-life-100 dark:divide-life-700">
        {year.harvest.map((h) => (
          <li key={h.id} className="flex items-center gap-1">
            <span className="min-w-0 flex-1 py-2 text-sm text-gray-800 dark:text-life-50">
              <strong>{h.animal}</strong> <span className="text-xs text-gray-500 dark:text-life-300">· {dayText(h.day)}{h.place ? ` · ${h.place}` : ''}</span>
              <span className="block text-xs text-gray-600 dark:text-life-200">{[h.tag_number ? `Tag ${h.tag_number}` : null, h.weight_lb ? `${h.weight_lb} lb` : null, h.frozen ? 'in the freezer' : null].filter(Boolean).join(' · ')}</span>
            </span>
            {!h.frozen && <button type="button" onClick={() => post(`harvest/${h.id}/freezer`, {})} aria-label={`Put the ${h.animal} meat in the freezer`} className={quiet}>To the freezer</button>}
            <Remove label={`Remove the ${h.animal} from the log`} onClick={() => del(`harvest/${h.id}`)} />
          </li>
        ))}
      </ul>
      <form onSubmit={add} className="space-y-2 border-t border-life-100 pt-3 dark:border-life-700">
        <div className="grid grid-cols-2 gap-2">
          <input required value={form.animal} onChange={set('animal')} aria-label="Animal" placeholder="Animal, in your words" className={`${field} col-span-2`} />
          <input type="date" value={form.day} onChange={set('day')} aria-label="Day of the harvest" className={field} />
          <input value={form.place} onChange={set('place')} aria-label="Place, in words" placeholder="Place, in words" className={field} />
          <input value={form.tag_number} onChange={set('tag_number')} aria-label="Tag number" placeholder="Tag number" className={field} />
          <input type="number" min="0" step="any" value={form.weight} onChange={set('weight')} aria-label="Weight of the animal (pounds)" placeholder="Weight, pounds" className={field} />
        </div>
        <button type="submit" className={button}>Log the harvest</button>
      </form>
    </section>
  );
}

/** After the trip: what came back, and what each piece needs: dry, clean, repair (to Upkeep) or replace (to the shopping list). */
function After({ year, put }) {
  return (
    <section className={`${cardClass} space-y-2`} aria-label="After the trip">
      <Heading icon="packed">After the trip</Heading>
      <Hint>Check off what came back, and say what each piece needs. A repair goes to Upkeep. A replacement goes on the grocery list.</Hint>
      <ul className="divide-y divide-life-100 dark:divide-life-700">
        {year.gear.map((g) => (
          <li key={g.id} className="space-y-1 py-1">
            <Tick checked={g.returned} label={`${g.label} is back`} onChange={(v) => put(`gear/${g.id}`, { returned: v })}>{g.label}</Tick>
            <div className="flex flex-wrap items-center gap-2 pl-8">
              <select value={g.after_trip ?? ''} onChange={(e) => put(`gear/${g.id}`, { after_trip: e.target.value || null })} aria-label={`What ${g.label} needs after the trip`} className={`${field} w-auto max-w-full`}>
                {AFTER.map(([k, w]) => <option key={k} value={k}>{w}</option>)}
              </select>
              {(g.after_trip === 'dry' || g.after_trip === 'clean') && <Tick checked={g.after_done} label={`${g.label} is ${g.after_trip === 'dry' ? 'dry' : 'clean'}`} onChange={(v) => put(`gear/${g.id}`, { after_done: v })}>{g.after_trip === 'dry' ? 'Dry' : 'Clean'}</Tick>}
              {g.after_trip === 'repair' && g.job_id && <Link to="/things/upkeep" className="inline-flex min-h-[44px] items-center text-xs text-life-600 underline dark:text-life-200">In Upkeep</Link>}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** What the trip came to, from spending tagged to it. */
function Cost({ year }) {
  const { budget } = year;
  const over = budget.target_cents !== null && budget.spent_cents > budget.target_cents;
  return (
    <section className={`${cardClass} space-y-1`} aria-label="Trip cost">
      <Heading icon="receipt">What it cost</Heading>
      <p className="text-sm text-gray-800 dark:text-life-50">
        <strong className={over ? 'text-red-700 dark:text-red-300' : ''}>{money(budget.spent_cents)}</strong> spent{budget.target_cents !== null ? ` of ${money(budget.target_cents)}` : ''}
        {budget.count > 0 ? ` · ${budget.count} ${budget.count === 1 ? 'entry' : 'entries'}` : ''}
      </p>
      <Hint>Adds up spending you tag {budget.tag ? `"${budget.tag}"` : 'with the trip\'s name'}, around the days of the trip.</Hint>
    </section>
  );
}

/** How it went, and what next year should remember. */
function Ending({ year, post, reload }) {
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
      <Field label="What should next year remember?"><textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Bring a second tarp. The south sites flood." className={inputClass} /></Field>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => post(`years/${year.plan_id}/finish`, { notes: notes || null })} className={year.when === 'past' && !year.notes_done ? button : quiet}>{year.notes_done ? 'Save the note' : 'Finish this year'}</button>
        {saved && <span className="text-xs text-gray-500 dark:text-life-300">{saved}</span>}
      </div>
      <Hint>Your note comes up at the top of next year's trip. Nothing is deleted.</Hint>
    </section>
  );
}
