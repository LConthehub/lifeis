import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import Icon from '../components/Icon';
import axios from 'axios';
import { shrink } from '../components/shrink';
import Picture from '../components/Picture';
import { PlanGoal } from '../components/Goals';
import { Basics, Budget, Countdown, Decor, Ending, Gifts, GivenToYou, Heading, Hint, LastNote, NextYear, People, Remove, RuleFields, Shopping, ruleBody, ruleStart } from './Holidays';
import { After, Harvest, Licenses, Seasons } from './Trips';
import { BulkBar, PickBox, SelectButton, TagFilter, TagPicker, saveTags, useSelecting } from '../components/tags';
import Modal, { Field, inputClass, buttonClass, quietButtonClass, cardClass, errorMessage, toDateInput, fromDateInput } from '../components/ui';

const ENTRY_ICONS = { meal: 'meal', session: 'session', media: 'media' };
// What a plan can hold besides its checklist, where each is listed, and how one of them is named.
const HOLDS = {
  recipe: { part: 'food', title: 'Food', add: 'a recipe', icon: 'meal', from: '/api/kitchen/recipes', name: (r) => r.title },
  thing: { part: 'bring', title: 'Bring list', add: 'one of your things', icon: 'thing', from: '/api/things/items', name: (t) => `${t.name} (${t.amount}${t.place ? `, ${t.place}` : ''})` },
  media: { part: 'media', title: 'To watch, hear or read', add: 'something from the collection', icon: 'media', from: '/api/media', name: (m) => `${m.title}${m.year ? ` (${m.year})` : ''}` },
  project: { part: 'projects', title: 'Projects', add: 'a project', icon: 'project', from: '/api/projects', name: (p) => p.name },
};

/** The parts a plan can check now, in the order they show. More come as holidays and trips join plans. */
const PARTS = [['food', 'Food'], ['guests', 'Guests'], ['cards', 'Cards'], ['gifts', 'Gifts'], ['decorations', 'Decorations'], ['budget', 'Budget'], ['more_days', 'More than one day'], ['tasks', 'Helpers and tasks'], ['bring', 'Bring list'], ['seasons', 'Seasons and licenses'], ['harvest', 'Harvest log'], ['after_trip', 'After the trip'], ['media', 'To watch, hear or read'], ['projects', 'Projects']];
const partOrder = (key) => PARTS.findIndex(([k]) => k === key);
const GATHERING = ['guests', 'cards', 'gifts', 'decorations'];
const OUTDOOR = ['seasons', 'harvest', 'after_trip'];
const HOLIDAY_API = '/api/plans/holidays';
const TRIP_API = '/api/plans/trips';

/**
 * What guests, cards, gifts, decorations and a yearly plan's holiday sections need: the plan's view from the server, who
 * can be picked, and the ways to change it. Asked for when the plan has one of those parts or comes back every year.
 * `reloadPlan` runs when a change reaches the plan itself (its day, finishing the year).
 */
function useGathering(plan, reloadPlan) {
  const planId = plan?.id;
  const needed = Boolean(plan && (plan.yearly || plan.parts.includes('food') || GATHERING.some((p) => plan.parts.includes(p))));
  const yearKey = plan?.yearly ? plan.yearly.holiday_id : 0;
  const day = plan?.start_day;
  // The countdown follows the plan's recipes and food: ask again when they, or the time it is served, change.
  const recipesKey = plan ? plan.items_list.filter((i) => i.kind === 'recipe').map((i) => `${i.ref_id}:${i.thaw_pounds ?? ''}`).join(',') : '';
  const foodKey = plan ? `${plan.served_at ?? ''}|${plan.food_kind}|${plan.food_lines.map((f) => `${f.id}:${f.label}:${f.thaw_pounds ?? ''}`).join(',')}` : '';
  const [view, setView] = useState(null);
  const [options, setOptions] = useState(null);
  const [error, setError] = useState('');
  const load = useCallback(() => {
    if (!needed) { setView(null); return; }
    axios.get(`${HOLIDAY_API}/gathering/${planId}`).then(({ data }) => setView(data)).catch(() => setView(null));
  }, [planId, needed, yearKey, day, recipesKey, foodKey]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (needed && !options) axios.get(`${HOLIDAY_API}/options`).then(({ data }) => setOptions(data)).catch(() => setOptions({ members: [], users: [], boxes: [], dates: [] }));
  }, [needed, options]);
  const act = async (work, touchesPlan = false) => {
    setError('');
    try { setView((await work()).data); if (touchesPlan) reloadPlan(); } catch (err) { setError(errorMessage(err, "Couldn't do that")); }
  };
  // A change to the plan's own day, or finishing the year, changes the plan too.
  const touches = (path, body) => (path === `years/${planId}` && Boolean(body?.day)) || path.endsWith('/finish');
  const post = (path, body) => act(() => axios.post(`${HOLIDAY_API}/${path}`, body), touches(path, body));
  const put = (path, body) => act(() => axios.put(`${HOLIDAY_API}/${path}`, body), touches(path, body));
  const del = (path) => act(() => axios.delete(`${HOLIDAY_API}/${path}`));
  // A view made before the plan became yearly (or stopped being yearly) is not the one to show.
  const current = view && view.plan_id === planId && Boolean(plan.yearly) === (view.holiday !== null);
  return { view: current ? view : null, options, error, act, post, put, del };
}

/**
 * Guests, cards, gifts and decorations on any plan, using the same sections as a holiday's year. A plan that comes back
 * every year also gets the holiday's own sections, each by its part. Each sits in the plan's grid in its part's place.
 */
function Gathering({ plan, g }) {
  const { view, options, error, act, post, put, del } = g;
  if (!view || !options) return null;
  const uses = (part) => plan.parts.includes(part);
  const box = (part, child) => <div style={{ order: partOrder(part) }}>{child}</div>;
  const yearly = view.holiday !== null;
  return (
    <>
      {error && <p className="text-sm text-red-600" style={{ order: 0 }}>{error}</p>}
      {yearly && <div style={{ order: -1 }}><Basics year={view} put={put} parts={plan.parts} /></div>}
      {uses('guests') && box('guests', <People year={view} options={options} post={post} put={put} del={del} role="guest" />)}
      {uses('cards') && box('cards', <People year={view} options={options} post={post} put={put} del={del} role="card" />)}
      {uses('gifts') && box('gifts', <Gifts year={view} options={options} post={post} put={put} del={del} />)}
      {uses('decorations') && box('decorations', yearly ? (
        <div className="space-y-3">
          <Shopping year={view} put={put} />
          <Decor year={view} options={options} post={post} put={put} del={del} act={act} mode="up" />
          <Decor year={view} options={options} post={post} put={put} del={del} act={act} mode="down" />
        </div>
      ) : <Decor year={view} options={options} post={post} put={put} del={del} act={act} mode={plan.when === 'past' ? 'down' : 'up'} />)}
      {yearly && uses('budget') && box('budget', <Budget year={view} />)}
    </>
  );
}
/**
 * Seasons and licenses, the harvest log and After the trip on any plan, using the same sections as a trip's year. A plan
 * that is not a trip's year has no trip parts, so seasons offer fishing or hunting and After the trip goes by its Bring list.
 */
function Outdoor({ plan }) {
  const [view, setView] = useState(null);
  const [error, setError] = useState('');
  // The Bring list can change on this page: ask again when the things on it do.
  const bringKey = plan.items_list.filter((i) => i.kind === 'thing').map((i) => `${i.id}:${i.label}`).join(',');
  const load = useCallback(() => { axios.get(`${TRIP_API}/outdoor/${plan.id}`).then(({ data }) => setView(data)).catch(() => setView(null)); }, [plan.id]);
  useEffect(() => { load(); }, [load, bringKey]);
  if (!view) return null;
  const act = async (work) => { setError(''); try { setView((await work()).data); } catch (err) { setError(errorMessage(err, "Couldn't do that")); } };
  const post = (path, body) => act(() => axios.post(`${TRIP_API}/${path}`, body));
  const put = (path, body) => act(() => axios.put(`${TRIP_API}/${path}`, body));
  const del = (path) => act(() => axios.delete(`${TRIP_API}/${path}`));
  const uses = (part) => plan.parts.includes(part);
  const box = (part, child) => <div style={{ order: partOrder(part) }}>{child}</div>;
  // A trip's year has its parts turned on in the trip: say so where it is off.
  const off = (what, part) => <section className={cardClass} aria-label={what}><h2 className="font-semibold text-life-800 dark:text-life-50">{what}</h2><p className="text-sm text-gray-600 dark:text-life-200">Turn on {part} for this trip first, on the Trips page.</p></section>;
  const tripParts = view.trip ? view.trip.parts : null;
  const firstWithChecks = uses('seasons') ? 'seasons' : 'harvest';
  return (
    <>
      {error && <p className="text-sm text-red-600" style={{ order: 0 }}>{error}</p>}
      {view.checks.licenses.length > 0 && (uses('seasons') || uses('harvest')) && box(firstWithChecks, <Licenses year={view} />)}
      {uses('seasons') && box('seasons', tripParts && !tripParts.includes('fishing') && !tripParts.includes('hunting') ? off('Seasons', 'fishing or hunting') : <Seasons year={view} post={post} del={del} />)}
      {uses('harvest') && box('harvest', tripParts && !tripParts.includes('hunting') ? off('Harvest log', 'hunting') : <Harvest year={view} post={post} del={del} />)}
      {uses('after_trip') && box('after_trip', <After year={view} put={put} />)}
    </>
  );
}
const ITEM_PART = { task: 'tasks', recipe: 'food', thing: 'bring', media: 'media', project: 'projects' };

const dayText = (day, long = false) => fromDateInput(day).toLocaleDateString(undefined, long ? { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' } : { day: 'numeric', month: 'short', year: 'numeric' });
const daysText = (p, long = false) => (p.end_day === p.start_day ? dayText(p.start_day, long) : `${dayText(p.start_day)} to ${dayText(p.end_day)}`);
const MEALS = [['breakfast', 'Breakfast'], ['lunch', 'Lunch'], ['dinner', 'Dinner'], ['snack', 'A snack']];
const EARLY_DAYS = 7;
/** The days a plan's food can go on the week: its own, and the week before for what's made ahead. */
function mealDays(plan) {
  const first = fromDateInput(plan.start_day);
  const last = fromDateInput(plan.end_day);
  const days = [];
  for (let n = -EARLY_DAYS; ; n += 1) {
    const d = new Date(first); d.setDate(d.getDate() + n);
    if (d > last) break;
    const label = d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' });
    days.push([toDateInput(d), n < 0 ? `${label} (${-n} ${n === -1 ? 'day' : 'days'} before)` : label]);
  }
  return days.sort((a, b) => (a[0] >= plan.start_day) - (b[0] >= plan.start_day) || (a[0] < plan.start_day ? (a[0] < b[0] ? 1 : -1) : (a[0] < b[0] ? -1 : 1)));
}
const onWeekText = (w) => `${fromDateInput(w.day).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })} ${w.meal}${w.servings ? ` · for ${w.servings}` : ''}${w.cooked ? ' · cooked' : ''}`;

/** When a plan's recipe is eaten: a day and a meal puts it on the week's meals; "not on the week" only notes it. */
function WhenEaten({ plan, day, meal, servings, onChange }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <div className="col-span-2"><Field label="On the week's meals">
        <select value={day} onChange={(e) => onChange(e.target.value, meal, servings)} className={inputClass}>
          {mealDays(plan).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          <option value="">Not on the week: just note it here</option>
        </select>
      </Field></div>
      <Field label="Which meal">
        <select value={meal} disabled={!day} onChange={(e) => onChange(day, e.target.value, servings)} className={inputClass}>
          {MEALS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </Field>
      <Field label="How many it's for">
        <input type="number" min="1" max="1000" step="any" value={servings} disabled={!day} onChange={(e) => onChange(day, meal, e.target.value)} placeholder="as the recipe says" className={inputClass} />
      </Field>
    </div>
  );
}

export const photoAddress = (photo) => `/api/plans/photos/${photo.id ?? photo}`;


const KINDS = [['all', 'All'], ['yearly', 'Yearly'], ['trip', 'Trips'], ['gathering', 'Gatherings']];
const LINE_ICONS = { trip: 'trip', gathering: 'plan', birthday: 'birthday' };
const awayText = (line) => (line.band === 'past' ? null : line.days_until === 0 ? 'now' : line.days_until === 1 ? 'tomorrow' : `in ${line.days_until} days`);
/** "Dec 15", or "Dec 15, 2027" outside this year; a span says "Dec 15 to 17" or "Dec 30 to Jan 2". */
const spanText = (l) => {
  const thisYear = String(new Date().getFullYear());
  const one = (day, withYear) => fromDateInput(day).toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(withYear ? { year: 'numeric' } : {}) });
  const yearShown = l.start_day.slice(0, 4) !== thisYear || l.end_day.slice(0, 4) !== thisYear;
  if (l.end_day === l.start_day) return one(l.start_day, yearShown);
  const end = l.end_day.slice(0, 7) === l.start_day.slice(0, 7) ? String(Number(l.end_day.slice(8))) : one(l.end_day, false);
  return `${one(l.start_day, false)} to ${end}${yearShown ? `, ${l.end_day.slice(0, 4)}` : ''}`;
};
const shortDay = (day) => fromDateInput(day).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });

/**
 * Every plan in one list by date: one-time plans, each year of a holiday or trip, and birthdays with no plan
 * yet as small lines. Chips narrow it to what comes back every year, trips, or gatherings.
 */
export default function PlansPage() {
  const [lines, setLines] = useState(null);
  const [tagged, setTagged] = useState(null);
  const [kind, setKind] = useState('all');
  const [adding, setAdding] = useState(false);
  const [tag, setTag] = useState('');
  const sel = useSelecting();
  const navigate = useNavigate();
  const load = useCallback(() => {
    axios.get('/api/plans/all').then(({ data }) => setLines(data)).catch(() => setLines([]));
    if (tag) axios.get('/api/plans', { params: { tag } }).then(({ data }) => setTagged(new Set(data.map((p) => `plan-${p.id}`)))).catch(() => setTagged(new Set()));
    else setTagged(null);
  }, [tag]);
  useEffect(() => { load(); }, [load]);
  if (!lines) return null;
  const shown = lines.filter((l) => (kind === 'all' || (kind === 'yearly' ? l.yearly : l.kind === kind)) && (!tagged || tagged.has(l.key)));
  // Only one-time plans can be picked together: a yearly plan's years are kept as they are.
  const plainOf = (l) => (!l.yearly && /^\/plans\/\d+$/.test(l.link) && /^plan-\d+$/.test(l.key) ? Number(l.key.slice(5)) : null);
  const plainIds = lines.map(plainOf).filter((n) => n !== null);
  const row = (l) => {
    const planId = plainOf(l);
    if (l.small) return (
      <li key={l.key}>
        <Link to={l.link} className="flex min-h-[44px] items-center gap-3 rounded-lg px-3 text-sm text-gray-700 hover:bg-life-50 dark:text-life-100 dark:hover:bg-life-800">
          <span aria-hidden="true" className="flex w-10 justify-center"><Icon of="birthday" /></span>
          <span className="min-w-0 flex-1">{l.name}{l.years && <span className="ml-2 text-xs text-gray-500 dark:text-life-300">{l.years} {l.years === 1 ? 'year' : 'years'}</span>}</span>
          <span className="text-right text-xs text-gray-500 dark:text-life-300">{shortDay(l.start_day)}<span className="block">{awayText(l)}</span></span>
        </Link>
      </li>
    );
    return (
      <li key={l.key}>
        <div className={`${cardClass} flex items-center gap-3 hover:ring-life-300`}>
          {planId !== null && <PickBox sel={sel} id={planId} name={l.name} />}
          <Link to={l.link} className="flex min-w-0 flex-1 items-center gap-3">
            {l.cover_photo ? <Picture src={photoAddress(l.cover_photo)} alt="" loading="lazy" className="h-12 w-12 flex-none rounded-lg object-cover" />
              : <span aria-hidden="true" className="flex h-12 w-12 flex-none items-center justify-center rounded-lg bg-life-50 dark:bg-life-700"><Icon of={LINE_ICONS[l.kind]} size={22} /></span>}
            <span className="min-w-0 flex-1">
              <span className="block font-medium text-life-800 dark:text-life-50">{l.name}</span>
              <span className="block text-xs text-gray-500 dark:text-life-300">
                {[spanText(l), l.yearly && 'Yearly'].filter(Boolean).join(' · ')}
              </span>
              {(l.next || l.not_started) && <span className="mt-0.5 block text-xs text-gray-700 dark:text-life-100">{l.not_started ? 'Not started yet: start from last year' : l.next}</span>}
            </span>
            {awayText(l) && <span className="flex-none text-xs text-gray-500 dark:text-life-300">{awayText(l)}</span>}
          </Link>
        </div>
      </li>
    );
  };
  const group = (title, list) => list.length > 0 && (
    <section className="space-y-2" aria-label={title}>
      <h2 className="text-xs font-semibold uppercase tracking-wide text-life-700 dark:text-life-200">{title}</h2>
      <ul className="space-y-2">{list.map(row)}</ul>
    </section>
  );
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-xl font-semibold text-life-800 dark:text-life-50">Plans</h1>
        <button type="button" onClick={() => setAdding(true)} className={buttonClass}>+ New</button>
      </div>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Show">
        {KINDS.map(([key, text]) => (
          <button key={key} type="button" aria-pressed={kind === key} onClick={() => setKind(key)}
            className={`flex min-h-[44px] items-center rounded-full px-3 py-1 text-sm ${kind === key ? 'bg-life-600 text-white' : 'bg-card text-life-700 ring-1 ring-life-100 hover:bg-life-50 dark:bg-life-800 dark:text-life-100 dark:ring-life-700'}`}>{text}</button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <TagFilter value={tag} onChange={setTag} />
        {plainIds.length > 0 && <SelectButton sel={sel} />}
        <span className="ml-auto text-xs"><Link to="/plans/holidays" className="text-life-700 hover:underline dark:text-life-100">Holidays</Link> · <Link to="/plans/trips" className="text-life-700 hover:underline dark:text-life-100">Trips</Link></span>
      </div>
      <BulkBar sel={sel} kind="plan" list={plainIds} noun="plans" onDone={load} />
      {shown.length === 0 && (tag || kind !== 'all') && <div className={`${cardClass} text-center text-sm text-gray-500 dark:text-life-200`}>Nothing matches.</div>}
      {lines.length === 0 && !tag && (
        <div className={`${cardClass} text-center text-sm text-gray-500 dark:text-life-200`}>
          A plan is anything with a day and things that belong to it: a trip, a lunch, Thanksgiving or a birthday.
          Make one ahead, or write one down afterwards. Either way it stays here to look back on.
        </div>
      )}
      {group('Coming up', shown.filter((l) => l.band === 'soon'))}
      {group('Later', shown.filter((l) => l.band === 'later'))}
      {group('Past', shown.filter((l) => l.band === 'past'))}
      {adding && (
        <Modal title="A plan, or a memory" onClose={() => setAdding(false)}>
          <PlanForm plan={{ start_day: toDateInput(new Date()) }} onDone={(p) => navigate(`/plans/${p.id}`)} />
        </Modal>
      )}
    </div>
  );
}

function PlanForm({ plan, onDone }) {
  const [form, setForm] = useState({ name: plan.name || '', start_day: plan.start_day, end_day: plan.end_day && plan.end_day !== plan.start_day ? plan.end_day : '', note: plan.note || '' });
  const [longer, setLonger] = useState(Boolean(plan.parts?.includes('more_days') || (plan.end_day && plan.end_day !== plan.start_day)));
  const [tags, setTags] = useState(plan.tag_list || []);
  const [error, setError] = useState('');
  // A new plan picks a starting point, which checks the parts that kind of plan usually needs.
  const [starts, setStarts] = useState([]);
  const [start, setStart] = useState('other');
  useEffect(() => { if (!plan.id) axios.get('/api/plans/starts').then(({ data }) => setStarts(data)).catch(() => setStarts([])); }, [plan.id]);
  const picked = starts.find((s) => s.key === start);
  // A trip turns on More than one day; another pick turns it back off unless an end day is already typed.
  const pick = (s) => { setStart(s.key); setLonger(s.longer || Boolean(form.end_day)); };
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const submit = async (e) => {
    e.preventDefault();
    const body = { name: form.name, start_day: form.start_day, end_day: (longer && form.end_day) || null, note: form.note || null, story: plan.story ?? null, ...(plan.id || starts.length === 0 ? {} : { start }) };
    try { const { data } = plan.id ? await axios.put(`/api/plans/${plan.id}`, body) : await axios.post('/api/plans', body); data.tag_list = await saveTags('plan', data.id, tags); onDone(data); } catch (err) { setError(errorMessage(err, "Couldn't save")); }
  };
  return (
    <form onSubmit={submit} className="space-y-3">
      {!plan.id && starts.length > 0 && (
        <fieldset className="space-y-1">
          <legend className="text-sm font-medium text-gray-700 dark:text-life-100">What kind of plan</legend>
          <div className="grid grid-cols-2 gap-2">
            {starts.map((s) => (
              <label key={s.key} className={`flex min-h-[44px] cursor-pointer items-center gap-2 rounded-lg border px-3 text-sm ${start === s.key ? 'border-life-600 bg-life-50 font-semibold text-life-800 dark:bg-life-700 dark:text-life-50' : 'border-life-200 text-gray-700 dark:border-life-600 dark:text-life-100'}`}>
                <input type="radio" name="plan-start" checked={start === s.key} onChange={() => pick(s)} className="h-5 w-5 accent-life-600" /> {s.label}
              </label>
            ))}
          </div>
          {picked && <p className="text-xs text-gray-500 dark:text-life-300">Starts with: {picked.parts.join(', ')}. You can change the parts later.</p>}
        </fieldset>
      )}
      <Field label="What it is *"><input required autoFocus={!plan.id} value={form.name} onChange={set('name')} placeholder="e.g. Thanksgiving, Saturday sewing" className={inputClass} /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={longer ? 'From *' : 'Day *'}><input required type="date" value={form.start_day} onChange={set('start_day')} className={inputClass} /></Field>
        {longer && <Field label="Until"><input type="date" min={form.start_day} value={form.end_day} onChange={set('end_day')} className={inputClass} /></Field>}
      </div>
      {!plan.id && (
        <label className="flex min-h-[44px] items-center gap-2 text-sm text-gray-700 dark:text-life-100">
          <input type="checkbox" checked={longer} onChange={(e) => setLonger(e.target.checked)} className="h-5 w-5 accent-life-600" /> More than one day
        </label>
      )}
      <Field label="What it's for"><textarea rows={2} value={form.note} onChange={set('note')} className={inputClass} /></Field>
      <TagPicker value={tags} onChange={setTags} />
      {!plan.id && <p className="text-xs text-gray-500 dark:text-life-300">A day that has already gone is fine: that's a memory, written down afterwards.</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="text-right"><button type="submit" className={buttonClass}>Save</button></div>
    </form>
  );
}

/** One plan: what belongs to it, what happened on its days, your words about it, and its photos. */
export function PlanPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [plan, setPlan] = useState(undefined);
  const [modal, setModal] = useState(null);
  const [error, setError] = useState('');
  const load = useCallback(() => { axios.get(`/api/plans/${id}`).then(({ data }) => setPlan(data)).catch(() => setPlan(null)); }, [id]);
  useEffect(() => { load(); }, [load]);
  // Roughly what the food will cost, asked again whenever the plan's recipes change.
  const [cost, setCost] = useState(null);
  const recipesKey = plan ? plan.items_list.filter((i) => i.kind === 'recipe').map((i) => i.ref_id).join(',') : '';
  useEffect(() => {
    if (!recipesKey) { setCost(null); return; }
    axios.get(`/api/plans/${id}/cost`).then(({ data }) => setCost(data)).catch(() => setCost(null));
  }, [id, recipesKey]);
  const g = useGathering(plan ?? undefined, load);
  if (plan === undefined) return null;
  if (plan === null) return <p className="text-sm text-gray-500 dark:text-life-300">That plan isn't here anymore. It may have been deleted. <Link to="/plans" className="underline">All plans</Link></p>;

  const act = async (work) => { setError(''); try { setPlan((await work()).data); return true; } catch (err) { setError(errorMessage(err, "Couldn't do that")); return false; } };
  const tasks = plan.items_list.filter((i) => i.kind === 'task');
  const uses = (part) => plan.parts.includes(part);
  const short = plan.items_list.filter((i) => i.short);
  const remove = async () => {
    if (!window.confirm(`Remove ${plan.name}, with its checklist and photos? Its meals still to be cooked come off the week. What it points at (recipes, things, titles) stays.`)) return;
    await axios.delete(`/api/plans/${plan.id}`).catch(() => {});
    navigate('/plans');
  };
  const BADGE = { ahead: 'Coming up', now: 'Now', past: 'A memory' };
  const yearly = plan.yearly;
  const startNext = async (day) => {
    setError('');
    try { const { data } = await axios.post(`${HOLIDAY_API}/${yearly.holiday_id}/years`, day ? { day } : {}); navigate(`/plans/${data.plan_id}`); } catch (err) { setError(errorMessage(err, "Couldn't start it")); }
  };
  return (
    <div className="space-y-4">
      <Link to="/plans" className="text-sm text-life-600 hover:underline dark:text-life-200">← Plans</Link>
      <div className="flex flex-wrap items-start gap-2">
        <div className="mr-auto">
          <h1 className="text-2xl font-semibold text-life-800 dark:text-life-50">{plan.name} <span className="ml-1 rounded bg-life-100 px-1.5 align-middle text-[11px] font-normal text-life-700">{BADGE[plan.when]}</span></h1>
          <p className="text-sm text-gray-600 dark:text-life-200">{daysText(plan, true)}</p>
          {yearly && <p className="text-sm text-gray-600 dark:text-life-200">Yearly · {yearly.rule_words}{g.view?.turns ? ` · ${g.view.turns} years` : ''}</p>}
          {plan.note && <p className="mt-1 whitespace-pre-wrap text-sm text-gray-700 dark:text-life-100">{plan.note}</p>}
        </div>
        <button type="button" onClick={() => setModal('edit')} className={`${quietButtonClass} min-h-[44px]`}>Change</button>
        <button type="button" onClick={() => setModal('parts')} className={`${quietButtonClass} min-h-[44px]`}>Parts</button>
        <button type="button" onClick={() => setModal('yearly')} className={`${quietButtonClass} min-h-[44px]`}>Every year</button>
        {!yearly && <button type="button" onClick={() => setModal('again')} className={`${quietButtonClass} min-h-[44px]`}>Do it again</button>}
      </div>
      {yearly && yearly.years.length > 1 && (
        <nav aria-label="Years" className="flex flex-wrap gap-1.5">
          {yearly.years.map((y) => (
            <Link key={y.plan_id} to={`/plans/${y.plan_id}`} aria-current={y.plan_id === plan.id ? 'page' : undefined}
              className={`flex min-h-[44px] items-center rounded-full px-3 text-sm ${y.plan_id === plan.id ? 'bg-life-600 text-white' : 'bg-life-50 text-life-700 hover:bg-life-100 dark:bg-life-700 dark:text-life-50'}`}>{y.year}</Link>
          ))}
        </nav>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
      {yearly && <GivenToYou only={yearly.name} />}
      {yearly && yearly.next_due && <NextYear name={yearly.name} manual={yearly.rule.kind === 'manual'} start={startNext} />}
      {yearly && g.view && <LastNote year={g.view} />}
      {cost && cost.ingredients > 0 && plan.when !== 'past' && (uses('food') || uses('budget')) && (
        <div className="rounded-lg bg-life-50 px-3 py-2 text-sm text-gray-700 dark:bg-life-800 dark:text-life-100" data-plan-cost>
          {cost.priced === 0 ? <p>No prices yet for this plan's food. Type prices as you shop and a rough cost shows here.</p> : (
            <p><span className="font-semibold text-life-800 dark:text-life-50">The food: about {cost.currency}{(cost.cents / 100).toFixed(2)}</span>, going by the last price of {cost.priced} of its {cost.ingredients} ingredients.</p>
          )}
          {cost.priced > 0 && cost.unpriced.length > 0 && <p className="mt-0.5 text-xs">No price yet for: {cost.unpriced.slice(0, 10).join(', ')}{cost.unpriced.length > 10 ? ` and ${cost.unpriced.length - 10} more` : ''}.</p>}
          {cost.priced > 0 && <p className="mt-0.5 text-xs text-gray-500 dark:text-life-300">Rough: one of each at the size you last bought, with nothing taken off for what's already in the pantry.</p>}
        </div>
      )}
      {uses('budget') && <PlanGoal kind="plan" id={plan.id} />}
      {short.length > 0 && plan.when !== 'past' && uses('bring') && (
        <ul className="space-y-1 rounded-lg bg-honey-100 px-3 py-2 text-sm text-honey-700">
          {short.map((i) => <li key={i.id}>{i.label}: {i.short}</li>)}
        </ul>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        <Gathering plan={plan} g={g} />
        {OUTDOOR.some(uses) && <Outdoor plan={plan} />}
        {uses('tasks') && <section className={cardClass} style={{ order: partOrder('tasks') }}>
          <h2 className="mb-2 font-semibold text-life-800 dark:text-life-50">Helpers and tasks {tasks.length > 0 && <span className="text-sm font-normal text-gray-500 dark:text-life-300">{tasks.filter((t) => t.done).length} of {tasks.length}</span>}</h2>
          <ul className="space-y-1">
            {tasks.map((t) => (
              <li key={t.id} className="flex items-start gap-2 text-sm">
                <label className="flex flex-1 cursor-pointer items-start gap-2 text-gray-800 dark:text-life-50">
                  <input type="checkbox" checked={t.done} onChange={() => act(() => axios.put(`/api/plans/items/${t.id}`, { done: !t.done }))} className="mt-0.5 accent-life-600" />
                  <span className={t.done ? 'text-gray-400 line-through' : ''}>{t.label}</span>
                </label>
                <button type="button" onClick={() => act(() => axios.delete(`/api/plans/items/${t.id}`))} aria-label={`Remove ${t.label}`} className="text-gray-400 hover:text-red-600">×</button>
              </li>
            ))}
          </ul>
          <AddTask onAdd={(label) => act(() => axios.post(`/api/plans/${plan.id}/items`, { kind: 'task', label }))} />
        </section>}

        {uses('food') && (
          <div style={{ order: partOrder('food') }} className="space-y-3">
            <FoodCard plan={plan} act={act} onAdd={() => setModal({ add: 'recipe' })} onWhen={(item) => setModal({ eaten: item })} />
            {g.view && g.view.countdown.served_at && <Countdown year={g.view} put={g.put} post={g.post} del={g.del} />}
          </div>
        )}
        {Object.entries(HOLDS).filter(([kind, hold]) => kind !== 'recipe' && uses(hold.part)).map(([kind, hold]) => {
          const mine = plan.items_list.filter((i) => i.kind === kind);
          return (
            <section key={kind} className={cardClass} style={{ order: partOrder(hold.part) }}>
              <div className="mb-2 flex items-baseline gap-2">
                <h2 className="flex-1 font-semibold text-life-800 dark:text-life-50">{hold.title}</h2>
                <button type="button" onClick={() => setModal({ add: kind })} className="text-sm text-life-600 hover:underline dark:text-life-200">+ Add</button>
              </div>
              {mine.length === 0 ? <p className="text-sm text-gray-400 dark:text-life-400">Nothing yet.</p> : (
                <ul className="space-y-1.5">
                  {mine.map((i) => (
                    <li key={i.id} className="flex items-start gap-2 text-sm">
                      <Icon of={hold.icon} />
                      <span className="flex-1">
                        {i.link ? <Link to={i.link} className="text-gray-800 hover:underline dark:text-life-50">{i.label}</Link> : <span className="text-gray-500 dark:text-life-300">{i.label}</span>}
                        {i.quantity !== null && <span className="ml-1 text-gray-500 dark:text-life-300">× {i.quantity}</span>}
                        {[i.detail, i.note].filter(Boolean).length > 0 && <span className="block text-xs text-gray-500 dark:text-life-300">{[i.detail, i.note].filter(Boolean).join(' · ')}</span>}
                        {kind === 'recipe' && i.link && (
                          <button type="button" onClick={() => setModal({ eaten: i })} className="block text-xs text-life-600 hover:underline dark:text-life-200">
                            {i.on_week ? <><Icon of="date" /> {onWeekText(i.on_week)}</> : 'Not on the week yet: put it on'}
                          </button>
                        )}
                        {i.short && <span className="block text-xs text-honey-700">{i.short}</span>}
                      </span>
                      <button type="button" onClick={() => act(() => axios.delete(`/api/plans/items/${i.id}`))} aria-label={`Take ${i.label} off the plan`} className="text-gray-400 hover:text-red-600">×</button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>

      {plan.when !== 'ahead' && (
        <section className={cardClass}>
          <h2 className="mb-1 font-semibold text-life-800 dark:text-life-50">What happened</h2>
          <p className="mb-2 text-xs text-gray-500 dark:text-life-300">Gathered from its {plan.end_day === plan.start_day ? 'day' : 'days'}: what was eaten, worked on, watched, read and heard.</p>
          {plan.happened.length === 0 ? <p className="text-sm text-gray-400 dark:text-life-400">Nothing was recorded on {plan.end_day === plan.start_day ? 'that day' : 'those days'}.</p> : (
            <ul className="space-y-1">
              {plan.happened.map((e, i) => (
                <li key={`${e.kind}-${i}`}>
                  <Link to={e.link || '/calendar'} className="flex items-baseline gap-2 text-sm hover:underline">
                    <Icon of={ENTRY_ICONS[e.kind]} />
                    <span className="flex-1 text-gray-800 dark:text-life-50">{e.title}{e.detail && <span className="ml-2 text-xs text-gray-500 dark:text-life-300">{e.detail}</span>}</span>
                    {plan.end_day !== plan.start_day && <span className="text-xs text-gray-500 dark:text-life-300">{fromDateInput(e.day).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' })}</span>}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {yearly ? (g.view && <Ending key={plan.id} year={g.view} past={g.view.when === 'past'} post={g.post} reload={load} />) : plan.when !== 'ahead' && <Story plan={plan} onSaved={setPlan} />}
      <Photos plan={plan} onChanged={setPlan} onOpen={(photo) => setModal({ photo })} />

      <button type="button" onClick={remove} className="text-sm text-red-600 hover:underline">Remove this plan</button>

      {modal === 'edit' && <Modal title={plan.name} onClose={() => setModal(null)}><PlanForm plan={plan} onDone={(p) => { setPlan(p); setModal(null); }} /></Modal>}
      {modal === 'parts' && <Modal title="Parts of this plan" onClose={() => setModal(null)}><PartsForm plan={plan} onDone={(p) => { setPlan(p); setModal(null); }} /></Modal>}
      {modal === 'yearly' && <Modal title={`${plan.name}, every year`} onClose={() => setModal(null)}><YearlyForm plan={plan} onDone={(p) => { if (p) setPlan(p); else load(); setModal(null); }} /></Modal>}
      {modal === 'again' && <Modal title={`${plan.name}, again`} onClose={() => setModal(null)}><AgainForm plan={plan} onDone={(p) => { setModal(null); navigate(`/plans/${p.id}`); }} /></Modal>}
      {modal?.add && <Modal title={`Add ${HOLDS[modal.add].add}`} onClose={() => setModal(null)}><Picker kind={modal.add} plan={plan} onDone={(p) => { setPlan(p); setModal(null); }} /></Modal>}
      {modal?.eaten && <Modal title={modal.eaten.label} onClose={() => setModal(null)}><EatenForm plan={plan} item={modal.eaten} onDone={(p) => { setPlan(p); setModal(null); }} /></Modal>}
      {modal?.photo && <Modal title="Photo" wide onClose={() => setModal(null)}><PhotoView photo={modal.photo} onDone={(p) => { setPlan(p); setModal(null); }} /></Modal>}
    </div>
  );
}

const tall = `${inputClass} min-h-[44px]`;
const tallQuiet = `${quietButtonClass} min-h-[44px]`;
const FOOD_KINDS = [['meal', 'A meal'], ['refreshments', 'Refreshments']];

/** Which meal a recipe goes on when nobody says: refreshments are a snack; a meal goes by the time it is served. */
function mealFor(plan) {
  if (plan.food_kind === 'refreshments') return 'snack';
  const t = plan.served_at;
  if (!t) return 'dinner';
  return t < '10:30' ? 'breakfast' : t < '15:00' ? 'lunch' : 'dinner';
}

/** A recipe that starts frozen: how many pounds, so the countdown says when to put it in the refrigerator. */
function Frozen({ item, save }) {
  const [open, setOpen] = useState(false);
  if (item.thaw_pounds === null && !open) return <button type="button" onClick={() => setOpen(true)} className="min-h-[44px] text-xs text-life-600 hover:underline dark:text-life-200">Starts frozen</button>;
  return (
    <label className="flex min-h-[44px] flex-wrap items-center gap-2 text-xs text-gray-600 dark:text-life-200">
      Starts frozen, in pounds
      <input type="number" min="1" max="60" step="0.5" autoFocus={open} defaultValue={item.thaw_pounds ?? ''} placeholder="none" aria-label={`${item.label}: pounds, frozen`}
        onBlur={(e) => { const v = e.target.value === '' ? null : Number(e.target.value); if (v !== item.thaw_pounds) save(v); }} className={`${tall} w-24`} />
    </label>
  );
}

/**
 * Food on any plan: when it is served and whether it is a meal or refreshments, the recipes (put on that day's meals and
 * the grocery list), and food that is bought or brought, with who brings it. Anything frozen gets a step to thaw it in
 * the countdown below.
 */
function FoodCard({ plan, act, onAdd, onWhen }) {
  const recipes = plan.items_list.filter((i) => i.kind === 'recipe');
  const [form, setForm] = useState({ label: '', who: '', pounds: '' });
  const setFood = (patch) => act(() => axios.put(`/api/plans/${plan.id}/food`, patch));
  const add = async (e) => {
    e.preventDefault();
    const ok = await act(() => axios.post(`/api/plans/${plan.id}/food-lines`, { label: form.label, brought_by: form.who.trim() || null, thaw_pounds: form.pounds === '' ? null : Number(form.pounds) }));
    if (ok) setForm({ label: '', who: '', pounds: '' });
  };
  const frozen = recipes.some((r) => r.thaw_pounds !== null) || plan.food_lines.some((f) => f.thaw_pounds !== null);
  return (
    <section className={`${cardClass} space-y-3`} aria-label="Food">
      <Heading icon="meal">Food</Heading>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Served at">
          <input type="time" key={plan.served_at ?? 'none'} defaultValue={plan.served_at ?? ''}
            onBlur={(e) => (e.target.value || null) !== plan.served_at && setFood({ served_at: e.target.value || null })} className={tall} />
        </Field>
        <Field label="It is">
          <select value={plan.food_kind} aria-label="A meal or refreshments" onChange={(e) => setFood({ food_kind: e.target.value })} className={tall}>
            {FOOD_KINDS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </Field>
      </div>
      {frozen && !plan.served_at && <Hint>Set when it is served and Life Is says when to put what is frozen in the refrigerator.</Hint>}

      <div>
        <div className="mb-1 flex items-center gap-2">
          <h3 className="flex-1 text-sm font-semibold text-life-800 dark:text-life-50">Recipes</h3>
          <button type="button" onClick={onAdd} className="min-h-[44px] px-2 text-sm text-life-600 hover:underline dark:text-life-200">+ Add a recipe</button>
        </div>
        {recipes.length === 0 ? <p className="text-sm text-gray-400 dark:text-life-400">No recipes yet.</p> : (
          <ul className="divide-y divide-life-100 dark:divide-life-700">
            {recipes.map((i) => (
              <li key={i.id} className="py-1 text-sm">
                <div className="flex items-start gap-2">
                  <span className="flex min-h-[44px] flex-1 items-center gap-2">
                    <Icon of="meal" />
                    <span className="min-w-0 flex-1">
                      {i.link ? <Link to={i.link} className="text-gray-800 hover:underline dark:text-life-50">{i.label}</Link> : <span className="text-gray-500 dark:text-life-300">{i.label}</span>}
                      {[i.detail, i.note].filter(Boolean).length > 0 && <span className="block text-xs text-gray-500 dark:text-life-300">{[i.detail, i.note].filter(Boolean).join(' · ')}</span>}
                    </span>
                  </span>
                  <Remove label={`Take ${i.label} off the plan`} onClick={() => act(() => axios.delete(`/api/plans/items/${i.id}`))} />
                </div>
                {i.link && (
                  <button type="button" onClick={() => onWhen(i)} className="flex min-h-[44px] items-center gap-1 text-left text-xs text-life-600 hover:underline dark:text-life-200">
                    {i.on_week ? <><Icon of="date" /> {onWeekText(i.on_week)}</> : 'Not on the week yet: put it on'}
                  </button>
                )}
                {i.link && <Frozen item={i} save={(v) => act(() => axios.put(`/api/plans/items/${i.id}`, { thaw_pounds: v }))} />}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <h3 className="mb-1 text-sm font-semibold text-life-800 dark:text-life-50">Bought or brought</h3>
        {plan.food_lines.length === 0 && <Hint>Anything that is not cooked from a recipe: a cake from the store, a dish someone brings. Check it off when it is here.</Hint>}
        <ul className="divide-y divide-life-100 dark:divide-life-700">
          {plan.food_lines.map((f) => (
            <li key={f.id} className="flex items-center gap-1" data-food-line>
              <label className="flex min-h-[44px] flex-1 cursor-pointer items-center gap-3 text-sm text-gray-800 dark:text-life-50">
                <input type="checkbox" checked={f.done} onChange={(e) => act(() => axios.put(`/api/plans/food-lines/${f.id}`, { done: e.target.checked }))} aria-label={`${f.label} is here`} className="h-5 w-5 flex-none accent-life-600" />
                <span className={`min-w-0 flex-1 ${f.done ? 'text-gray-400 line-through' : ''}`}>
                  {f.label}
                  {[f.brought_by ? `${f.brought_by} brings it` : null, f.thaw_pounds !== null ? `${f.thaw_pounds} lb, frozen` : null].filter(Boolean).length > 0 && (
                    <span className="block text-xs text-gray-500 dark:text-life-300">{[f.brought_by ? `${f.brought_by} brings it` : null, f.thaw_pounds !== null ? `${f.thaw_pounds} lb, frozen` : null].filter(Boolean).join(' · ')}</span>
                  )}
                </span>
              </label>
              <Remove label={`Remove ${f.label}`} onClick={() => act(() => axios.delete(`/api/plans/food-lines/${f.id}`))} />
            </li>
          ))}
        </ul>
        <form onSubmit={add} className="mt-2 space-y-2">
          <Field label="What is it"><input required value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="Apple pie" className={tall} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Who brings it (if anyone)"><input value={form.who} onChange={(e) => setForm({ ...form, who: e.target.value })} className={tall} /></Field>
            <Field label="Frozen, in pounds (if it is)"><input type="number" min="1" max="60" step="0.5" value={form.pounds} onChange={(e) => setForm({ ...form, pounds: e.target.value })} className={tall} /></Field>
          </div>
          <div className="text-right"><button type="submit" className={tallQuiet}>Add the food</button></div>
        </form>
      </div>
    </section>
  );
}

/**
 * Make a one-time plan come back every year, or change how a yearly plan finds its day. A yearly plan can also stop:
 * each of its years stays as a plan.
 */
function YearlyForm({ plan, onDone }) {
  const y = plan.yearly;
  const [form, setForm] = useState(() => ruleStart(y ? y.rule : null, y?.lead_weeks, plan.start_day));
  const [error, setError] = useState('');
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const submit = async (e) => {
    e.preventDefault();
    try {
      if (y) { await axios.put(`${HOLIDAY_API}/${y.holiday_id}`, { name: y.name, ...ruleBody(form) }); onDone(null); }
      else onDone((await axios.post(`${HOLIDAY_API}/from-plan`, { plan_id: plan.id, ...ruleBody(form) })).data);
    } catch (err) { setError(errorMessage(err, "Couldn't save")); }
  };
  const stop = async () => {
    if (!window.confirm(`Stop keeping ${y.name} as a yearly plan? Each of its years stays as a plan, to look back on.`)) return;
    try { await axios.delete(`${HOLIDAY_API}/${y.holiday_id}`); onDone(null); } catch (err) { setError(errorMessage(err, "Couldn't stop it")); }
  };
  return (
    <form onSubmit={submit} className="space-y-3">
      <p className="text-sm text-gray-600 dark:text-life-100">
        {y ? 'This plan comes back each year. Change how its day is found, or when to start planning.'
          : 'This plan becomes the first year of a yearly plan. Each year starts from the one before: the same parts and lists, with nothing checked off.'}
      </p>
      <RuleFields form={form} set={set} />
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex flex-wrap items-center justify-between gap-2">
        {y ? <button type="button" onClick={stop} className="min-h-[44px] text-sm text-red-700 hover:underline dark:text-red-300">Stop coming back every year</button> : <span />}
        <button type="submit" className={`${buttonClass} min-h-[44px]`}>{y ? 'Save' : 'Make it yearly'}</button>
      </div>
    </form>
  );
}

/** Check the parts a plan uses. A part taken off keeps what is in it, and shows it again when checked. */
function PartsForm({ plan, onDone }) {
  const [chosen, setChosen] = useState(plan.parts);
  const [error, setError] = useState('');
  const count = (part) => plan.items_list.filter((i) => ITEM_PART[i.kind] === part).length;
  const hidden = PARTS.filter(([key]) => plan.parts.includes(key) && !chosen.includes(key) && count(key) > 0);
  const save = async (e) => {
    e.preventDefault();
    try { onDone((await axios.put(`/api/plans/${plan.id}/parts`, { parts: chosen })).data); } catch (err) { setError(errorMessage(err, "Couldn't save")); }
  };
  return (
    <form onSubmit={save} className="space-y-3">
      <p className="text-sm text-gray-600 dark:text-life-200">Check what this plan needs. Parts left unchecked are hidden.</p>
      <ul>
        {PARTS.map(([key, label]) => (
          <li key={key}>
            <label className="flex min-h-[44px] items-center gap-3 text-sm text-gray-800 dark:text-life-50">
              <input type="checkbox" checked={chosen.includes(key)} onChange={(e) => setChosen(e.target.checked ? [...chosen, key] : chosen.filter((k) => k !== key))} className="h-5 w-5 accent-life-600" />
              <span className="flex-1">{label}</span>
              {count(key) > 0 && <span className="text-xs text-gray-500 dark:text-life-300">{count(key)} in it</span>}
            </label>
          </li>
        ))}
      </ul>
      {hidden.length > 0 && <p className="rounded-lg bg-life-50 px-3 py-2 text-xs text-gray-700 dark:bg-life-800 dark:text-life-100">What is in {hidden.map(([, l]) => l).join(' and ')} is kept, and shows again if you check it later.</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="text-right"><button type="submit" className={buttonClass}>Save</button></div>
    </form>
  );
}

function AddTask({ onAdd }) {
  const [label, setLabel] = useState('');
  const submit = (e) => { e.preventDefault(); if (label.trim()) { onAdd(label); setLabel(''); } };
  return (
    <form onSubmit={submit} className="mt-2 flex gap-2">
      <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Something to do" aria-label="Something to do" className={inputClass} />
      <button type="submit" className={quietButtonClass}>Add</button>
    </form>
  );
}

function Picker({ kind, plan, onDone }) {
  const hold = HOLDS[kind];
  const [choices, setChoices] = useState(null);
  const [ref, setRef] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [eaten, setEaten] = useState({ day: plan.start_day, meal: mealFor(plan), servings: '' });
  // A recipe goes on that day's meals and the grocery list unless this is unchecked, which only notes it on the plan.
  const [onWeek, setOnWeek] = useState(true);
  useEffect(() => { axios.get(hold.from).then(({ data }) => setChoices(data)).catch(() => setChoices([])); }, [hold.from]);
  if (!choices) return null;
  const taken = new Set(plan.items_list.filter((i) => i.kind === kind).map((i) => i.ref_id));
  const free = choices.filter((c) => !taken.has(c.id));
  if (free.length === 0) return <p className="text-sm text-gray-600 dark:text-life-100">{choices.length === 0 ? `There's nothing to choose from yet. Add ${hold.add} on its own page first.` : "Everything there is, is already part of this plan."}</p>;
  const submit = async (e) => {
    e.preventDefault();
    try {
      onDone((await axios.post(`/api/plans/${plan.id}/items`, { kind, ref_id: Number(ref), quantity: kind === 'thing' && quantity !== '' ? Number(quantity) : null, note: note || null,
        ...(kind === 'recipe' && onWeek && eaten.day ? { day: eaten.day, meal: eaten.meal, servings: eaten.servings === '' ? null : Number(eaten.servings) } : {}) })).data);
    } catch (err) { setError(errorMessage(err, "Couldn't add it")); }
  };
  return (
    <form onSubmit={submit} className="space-y-3">
      <Field label="Which *">
        <select required value={ref} onChange={(e) => setRef(e.target.value)} className={inputClass}>
          <option value="">Choose…</option>
          {free.map((c) => <option key={c.id} value={c.id}>{hold.name(c)}</option>)}
        </select>
      </Field>
      {kind === 'thing' && <Field label="How many are needed"><input type="number" min="0" step="any" value={quantity} onChange={(e) => setQuantity(e.target.value)} className={inputClass} /></Field>}
      {kind === 'recipe' && (
        <>
          <label className="flex min-h-[44px] items-center gap-3 text-sm text-gray-800 dark:text-life-50">
            <input type="checkbox" checked={onWeek} onChange={(e) => setOnWeek(e.target.checked)} className="h-5 w-5 flex-none accent-life-600" />
            Put it on that day's meals and the grocery list
          </label>
          {onWeek && <WhenEaten plan={plan} day={eaten.day} meal={eaten.meal} servings={eaten.servings} onChange={(day, meal, servings) => setEaten({ day, meal, servings })} />}
          <p className="text-xs text-gray-500 dark:text-life-300">{onWeek ? 'On the week, it counts toward the grocery list and the pans and dishes that meal needs. It moves if the plan moves.' : 'Unchecked, it is only noted on the plan. You can put it on the week later.'}</p>
        </>
      )}
      <Field label="A note"><input value={note} onChange={(e) => setNote(e.target.value)} className={inputClass} /></Field>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="text-right"><button type="submit" className={buttonClass}>Add</button></div>
    </form>
  );
}

function EatenForm({ plan, item, onDone }) {
  const [eaten, setEaten] = useState({ day: item.on_week?.day ?? plan.start_day, meal: item.on_week?.meal ?? 'dinner', servings: item.on_week?.servings ?? '' });
  const [error, setError] = useState('');
  if (item.on_week?.cooked) return <p className="text-sm text-gray-700 dark:text-life-100">This was cooked on {onWeekText(item.on_week).replace(' · cooked', '')}. That's done, so it stays where it was.</p>;
  const save = async (e) => {
    e.preventDefault();
    try { onDone((await axios.put(`/api/plans/items/${item.id}`, { day: eaten.day || null, meal: eaten.meal, servings: eaten.servings === '' ? null : Number(eaten.servings) })).data); } catch (err) { setError(errorMessage(err, "Couldn't change it")); }
  };
  return (
    <form onSubmit={save} className="space-y-3">
      <WhenEaten plan={plan} day={eaten.day} meal={eaten.meal} servings={eaten.servings} onChange={(day, meal, servings) => setEaten({ day, meal, servings })} />
      <p className="text-xs text-gray-500 dark:text-life-300">{item.on_week ? 'Changing this moves the meal on the week. "Not on the week" takes it off there and keeps it noted here.' : 'This puts it on the week\'s meals, so the grocery list and the pans it needs follow.'}</p>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="text-right"><button type="submit" className={buttonClass}>Save</button></div>
    </form>
  );
}

function AgainForm({ plan, onDone }) {
  const [form, setForm] = useState({ name: plan.name, start_day: toDateInput(new Date()) });
  const [error, setError] = useState('');
  const submit = async (e) => {
    e.preventDefault();
    try { onDone((await axios.post(`/api/plans/${plan.id}/copy`, form)).data); } catch (err) { setError(errorMessage(err, "Couldn't start it")); }
  };
  return (
    <form onSubmit={submit} className="space-y-3">
      <p className="text-sm text-gray-600 dark:text-life-100">A new plan with the same food, things, titles and checklist (unchecked). Food that was on the week goes on the new week, the same days in. This one stays as it is, with its story and photos.</p>
      <Field label="Call the new one"><input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputClass} /></Field>
      <Field label="Its first day"><input required type="date" value={form.start_day} onChange={(e) => setForm({ ...form, start_day: e.target.value })} className={inputClass} /></Field>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="text-right"><button type="submit" className={buttonClass}>Start it</button></div>
    </form>
  );
}

function Story({ plan, onSaved }) {
  const [story, setStory] = useState(plan.story || '');
  const [saved, setSaved] = useState(false);
  const save = async () => {
    const { data } = await axios.put(`/api/plans/${plan.id}`, { name: plan.name, start_day: plan.start_day, end_day: plan.end_day, note: plan.note, story: story || null });
    onSaved(data); setSaved(true);
  };
  return (
    <section className={cardClass}>
      <h2 className="mb-2 font-semibold text-life-800 dark:text-life-50">How it went</h2>
      <textarea rows={4} value={story} onChange={(e) => { setStory(e.target.value); setSaved(false); }} placeholder="In your own words, for when you look back." aria-label="How it went" className={inputClass} />
      <div className="mt-2 flex items-center justify-end gap-2">
        {saved && <span className="text-xs text-gray-500 dark:text-life-300">Saved</span>}
        <button type="button" onClick={save} disabled={story === (plan.story || '')} className={buttonClass}>Save</button>
      </div>
    </section>
  );
}

function Photos({ plan, onChanged, onOpen }) {
  const picker = useRef(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [library, setLibrary] = useState(null);
  const [choosing, setChoosing] = useState(false);
  useEffect(() => { axios.get('/api/photos').then(({ data }) => setLibrary(data)).catch(() => {}); }, []);
  const add = async (e) => {
    const files = [...e.target.files];
    e.target.value = '';
    setError('');
    let latest = null;
    for (const [n, file] of files.entries()) {
      setBusy(`Adding ${n + 1} of ${files.length}…`);
      try { latest = (await axios.post(`/api/plans/${plan.id}/photos`, { data: await shrink(file) })).data; } catch (err) { setError(errorMessage(err, `${file.name} couldn't be added`)); }
    }
    setBusy('');
    if (latest) onChanged(latest);
  };
  return (
    <section className={cardClass}>
      <div className="mb-2 flex items-baseline gap-2">
        <h2 className="flex-1 font-semibold text-life-800 dark:text-life-50">Photos</h2>
        <input ref={picker} type="file" accept="image/*" multiple onChange={add} className="hidden" aria-label="Choose photos" />
        {library?.connected && <button type="button" onClick={() => setChoosing(true)} className="text-sm text-life-600 hover:underline dark:text-life-200">+ From Immich</button>}
        <button type="button" disabled={Boolean(busy)} onClick={() => picker.current.click()} className="text-sm text-life-600 hover:underline dark:text-life-200">{busy || '+ From this device'}</button>
      </div>
      {error && <p className="mb-2 text-sm text-red-600">{error}</p>}
      {plan.photos_list.length === 0 ? (
        <p className="text-sm text-gray-400 dark:text-life-400">
          None yet. A photo picked from this device is made smaller and kept here with the plan.
          {library?.available && !library.connected && <> If your photos are in Immich, <Link to="/settings" className="underline">connect it in Settings</Link> and link them instead, without copying.</>}
        </p>
      ) : (
        <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
          {plan.photos_list.map((p) => (
            <li key={p.id}>
              <button type="button" onClick={() => onOpen(p)} className="block w-full overflow-hidden rounded-lg ring-1 ring-life-100 hover:ring-life-400 dark:ring-life-700">
                <Picture src={photoAddress(p)} alt={p.caption || 'A photo from this plan'} loading="lazy" className="aspect-square w-full object-cover" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {choosing && <Modal title="Photos from Immich" wide onClose={() => setChoosing(false)}><LibraryPicker plan={plan} onDone={(p) => { setChoosing(false); if (p) onChanged(p); }} /></Modal>}
    </section>
  );
}

function PhotoView({ photo, onDone }) {
  const [caption, setCaption] = useState(photo.caption || '');
  const save = async () => onDone((await axios.put(`/api/plans/photos/${photo.id}`, { caption: caption || null })).data);
  const remove = async () => onDone((await axios.delete(`/api/plans/photos/${photo.id}`)).data);
  return (
    <div className="space-y-3">
      <Picture src={photoAddress(photo)} alt={photo.caption || ''} className="max-h-[60vh] w-full rounded-lg object-contain" />
      <Field label="What it shows"><input value={caption} onChange={(e) => setCaption(e.target.value)} className={inputClass} /></Field>
      <div className="flex items-center justify-between">
        <button type="button" onClick={remove} className="text-sm text-red-600 hover:underline">{photo.source === 'kept' ? 'Delete this photo' : 'Take it off the plan (it stays in your library)'}</button>
        <button type="button" onClick={save} className={buttonClass}>Save</button>
      </div>
    </div>
  );
}

/** The photos your library has from the plan's days. Check the ones that belong; they are linked, not copied. */
function LibraryPicker({ plan, onDone }) {
  const [photos, setPhotos] = useState(null);
  const [chosen, setChosen] = useState([]);
  const [error, setError] = useState('');
  useEffect(() => {
    axios.get(`/api/plans/${plan.id}/library`).then(({ data }) => setPhotos(data)).catch((err) => { setPhotos([]); setError(errorMessage(err, "Your library couldn't be read")); });
  }, [plan.id]);
  if (!photos) return <p className="text-sm text-gray-500 dark:text-life-300">Asking your library…</p>;
  const toggle = (id) => setChosen((list) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]));
  const link = async () => {
    try { onDone((await axios.post(`/api/plans/${plan.id}/photos/linked`, { ids: chosen })).data); } catch (err) { setError(errorMessage(err, "Couldn't link them")); }
  };
  const fresh = photos.filter((p) => !p.linked);
  return (
    <div className="space-y-3">
      {error && <p className="text-sm text-red-600">{error}</p>}
      {!error && photos.length === 0 && <p className="text-sm text-gray-600 dark:text-life-100">Your library has no photos taken on {plan.end_day === plan.start_day ? 'that day' : 'those days'}.</p>}
      {photos.length > 0 && (
        <>
          <p className="text-sm text-gray-600 dark:text-life-100">Taken on {plan.end_day === plan.start_day ? 'its day' : 'its days'}. Check the ones that belong here. They stay in Immich; the plan only remembers which they are.</p>
          <ul className="grid max-h-[55vh] grid-cols-3 gap-2 overflow-y-auto sm:grid-cols-4 md:grid-cols-5">
            {photos.map((p) => (
              <li key={p.id}>
                <label className={`relative block cursor-pointer overflow-hidden rounded-lg ring-2 ${chosen.includes(p.id) ? 'ring-life-500' : 'ring-transparent'} ${p.linked ? 'opacity-50' : ''}`}>
                  <Picture src={`/api/photos/thumb?id=${p.id}`} alt={`${p.name}, taken ${p.taken.replace('T', ' at ')}`} loading="lazy" className="aspect-square w-full object-cover" />
                  <input type="checkbox" disabled={p.linked} checked={p.linked || chosen.includes(p.id)} onChange={() => toggle(p.id)} className="absolute left-1.5 top-1.5 h-4 w-4 accent-life-600" />
                  <span className="absolute inset-x-0 bottom-0 bg-black/50 px-1 text-center text-[10px] text-white">{p.linked ? 'already here' : p.taken.slice(11)}</span>
                </label>
              </li>
            ))}
          </ul>
          <div className="flex items-center justify-end gap-2">
            {fresh.length > 1 && <button type="button" onClick={() => setChosen(fresh.map((p) => p.id))} className={quietButtonClass}>Check all</button>}
            <button type="button" disabled={chosen.length === 0} onClick={link} className={buttonClass}>Link {chosen.length || ''}</button>
          </div>
        </>
      )}
    </div>
  );
}
