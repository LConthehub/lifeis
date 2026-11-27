import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import Icon from '../components/Icon';
import axios from 'axios';
import SubChips, { PLAN_CHIPS } from '../components/SubChips';
import { shrink } from '../components/shrink';
import Picture from '../components/Picture';
import { PlanGoal } from '../components/Goals';
import { BulkBar, PickBox, SelectButton, TagChips, TagFilter, TagPicker, saveTags, useSelecting } from '../components/tags';
import Modal, { Field, inputClass, buttonClass, quietButtonClass, cardClass, errorMessage, toDateInput, fromDateInput } from '../components/ui';

const ENTRY_ICONS = { meal: 'meal', session: 'session', media: 'media' };
// What a plan can hold besides its checklist, where each is listed, and how one of them is named.
const HOLDS = {
  recipe: { title: 'Food', add: 'a recipe', icon: 'meal', from: '/api/kitchen/recipes', name: (r) => r.title },
  thing: { title: 'Things to have ready', add: 'one of your things', icon: 'thing', from: '/api/things/items', name: (t) => `${t.name} (${t.amount}${t.place ? `, ${t.place}` : ''})` },
  media: { title: 'To watch, hear or read', add: 'something from the collection', icon: 'media', from: '/api/media', name: (m) => `${m.title}${m.year ? ` (${m.year})` : ''}` },
  project: { title: 'Projects', add: 'a project', icon: 'project', from: '/api/projects', name: (p) => p.name },
};

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


/** Plans ahead, and the ones to look back on. */
export default function PlansPage() {
  const [plans, setPlans] = useState(null);
  const [adding, setAdding] = useState(false);
  const [tag, setTag] = useState('');
  const sel = useSelecting();
  const navigate = useNavigate();
  const load = useCallback(() => { axios.get('/api/plans', { params: { tag: tag || undefined } }).then(({ data }) => setPlans(data)).catch(() => setPlans([])); }, [tag]);
  useEffect(() => { load(); }, [load]);
  if (!plans) return null;
  const now = plans.filter((p) => p.when === 'now');
  const ahead = plans.filter((p) => p.when === 'ahead').reverse();
  const past = plans.filter((p) => p.when === 'past');
  const years = [...new Set(past.map((p) => p.start_day.slice(0, 4)))];
  const tile = (p) => (
    <li key={p.id}>
      <div className={`${cardClass} flex h-full flex-col gap-2 hover:ring-life-300`}>
      <div className="flex gap-2">
      <PickBox sel={sel} id={p.id} name={p.name} />
      <Link to={`/plans/${p.id}`} className="flex min-w-0 flex-1 gap-3">
        {p.cover_photo ? <Picture src={photoAddress(p.cover_photo)} alt="" loading="lazy" className="h-16 w-16 flex-none rounded-lg object-cover" />
          : <span aria-hidden="true" className="flex h-16 w-16 flex-none items-center justify-center rounded-lg bg-life-50 text-2xl dark:bg-life-700"><Icon of="plan" size={28} /></span>}
        <span className="min-w-0 flex-1">
          <span className="block font-medium text-life-800 dark:text-life-50">{p.name}</span>
          <span className="block text-xs text-gray-500 dark:text-life-300">{daysText(p)}</span>
          <span className="mt-1 block text-xs text-gray-600 dark:text-life-200">
            {[p.when !== 'past' && p.tasks_left > 0 && `${p.tasks_left} still to do`, p.photos > 0 && `${p.photos} ${p.photos === 1 ? 'photo' : 'photos'}`, p.note].filter(Boolean).join(' · ')}
          </span>
        </span>
      </Link>
      </div>
      <TagChips tags={p.tag_list} />
      </div>
    </li>
  );
  const group = (title, list) => list.length > 0 && (
    <section className="space-y-2">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-life-700 dark:text-life-200">{title}</h2>
      <ul className="grid gap-3 sm:grid-cols-2">{list.map(tile)}</ul>
    </section>
  );
  return (
    <div className="space-y-5">
      <SubChips items={PLAN_CHIPS} label="Plans, holidays and trips" />
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-xl font-semibold text-life-800 dark:text-life-50">Plans and memories</h1>
        <button type="button" onClick={() => setAdding(true)} className={buttonClass}>+ New</button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <TagFilter value={tag} onChange={setTag} />
        {(plans.length > 0 || tag) && <SelectButton sel={sel} />}
      </div>
      <BulkBar sel={sel} kind="plan" list={plans.map((p) => p.id)} noun="plans" onDone={load} />
      {plans.length === 0 && tag && <div className={`${cardClass} text-center text-sm text-gray-500 dark:text-life-200`}>Nothing matches.</div>}
      {plans.length === 0 && !tag && (
        <div className={`${cardClass} text-center text-sm text-gray-500 dark:text-life-200`}>
          A plan is anything with a day and things that belong to it: a vacation with its menu, dishes and films, or one afternoon's sewing.
          Make one ahead, or write one down afterwards. Either way it stays here to look back on.
        </div>
      )}
      {group('Now', now)}
      {group('Coming up', ahead)}
      {years.map((year) => <div key={year}>{group(`Looking back: ${year}`, past.filter((p) => p.start_day.startsWith(year)))}</div>)}
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
  const [tags, setTags] = useState(plan.tag_list || []);
  const [error, setError] = useState('');
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const submit = async (e) => {
    e.preventDefault();
    const body = { name: form.name, start_day: form.start_day, end_day: form.end_day || null, note: form.note || null, story: plan.story ?? null };
    try { const { data } = plan.id ? await axios.put(`/api/plans/${plan.id}`, body) : await axios.post('/api/plans', body); data.tag_list = await saveTags('plan', data.id, tags); onDone(data); } catch (err) { setError(errorMessage(err, "Couldn't save")); }
  };
  return (
    <form onSubmit={submit} className="space-y-3">
      <Field label="What it is *"><input required autoFocus={!plan.id} value={form.name} onChange={set('name')} placeholder="e.g. Thanksgiving, Saturday sewing" className={inputClass} /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Day *"><input required type="date" value={form.start_day} onChange={set('start_day')} className={inputClass} /></Field>
        <Field label="Until (if longer)"><input type="date" min={form.start_day} value={form.end_day} onChange={set('end_day')} className={inputClass} /></Field>
      </div>
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
  if (plan === undefined) return null;
  if (plan === null) return <p className="text-sm text-gray-500 dark:text-life-300">That plan isn't here anymore. It may have been deleted. <Link to="/plans" className="underline">All plans</Link></p>;

  const act = async (work) => { setError(''); try { setPlan((await work()).data); } catch (err) { setError(errorMessage(err, "Couldn't do that")); } };
  const tasks = plan.items_list.filter((i) => i.kind === 'task');
  const short = plan.items_list.filter((i) => i.short);
  const remove = async () => {
    if (!window.confirm(`Remove ${plan.name}, with its checklist and photos? Its meals still to be cooked come off the week. What it points at (recipes, things, titles) stays.`)) return;
    await axios.delete(`/api/plans/${plan.id}`).catch(() => {});
    navigate('/plans');
  };
  const BADGE = { ahead: 'Coming up', now: 'Now', past: 'A memory' };
  return (
    <div className="space-y-4">
      <Link to="/plans" className="text-sm text-life-600 hover:underline dark:text-life-200">← Plans and memories</Link>
      <div className="flex flex-wrap items-start gap-2">
        <div className="mr-auto">
          <h1 className="text-2xl font-semibold text-life-800 dark:text-life-50">{plan.name} <span className="ml-1 rounded bg-life-100 px-1.5 align-middle text-[11px] font-normal text-life-700">{BADGE[plan.when]}</span></h1>
          <p className="text-sm text-gray-600 dark:text-life-200">{daysText(plan, true)}</p>
          {plan.note && <p className="mt-1 whitespace-pre-wrap text-sm text-gray-700 dark:text-life-100">{plan.note}</p>}
        </div>
        <button type="button" onClick={() => setModal('edit')} className={quietButtonClass}>Change</button>
        <button type="button" onClick={() => setModal('again')} className={quietButtonClass}>Do it again</button>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {cost && cost.ingredients > 0 && plan.when !== 'past' && (
        <div className="rounded-lg bg-life-50 px-3 py-2 text-sm text-gray-700 dark:bg-life-800 dark:text-life-100" data-plan-cost>
          {cost.priced === 0 ? <p>No prices yet for this plan's food. Type prices as you shop and a rough cost shows here.</p> : (
            <p><span className="font-semibold text-life-800 dark:text-life-50">The food: about {cost.currency}{(cost.cents / 100).toFixed(2)}</span>, going by the last price of {cost.priced} of its {cost.ingredients} ingredients.</p>
          )}
          {cost.priced > 0 && cost.unpriced.length > 0 && <p className="mt-0.5 text-xs">No price yet for: {cost.unpriced.slice(0, 10).join(', ')}{cost.unpriced.length > 10 ? ` and ${cost.unpriced.length - 10} more` : ''}.</p>}
          {cost.priced > 0 && <p className="mt-0.5 text-xs text-gray-500 dark:text-life-300">Rough: one of each at the size you last bought, with nothing taken off for what's already in the pantry.</p>}
        </div>
      )}
      <PlanGoal kind="plan" id={plan.id} />
      {short.length > 0 && plan.when !== 'past' && (
        <ul className="space-y-1 rounded-lg bg-honey-100 px-3 py-2 text-sm text-honey-700">
          {short.map((i) => <li key={i.id}>{i.label}: {i.short}</li>)}
        </ul>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        <section className={cardClass}>
          <h2 className="mb-2 font-semibold text-life-800 dark:text-life-50">Checklist {tasks.length > 0 && <span className="text-sm font-normal text-gray-500 dark:text-life-300">{tasks.filter((t) => t.done).length} of {tasks.length}</span>}</h2>
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
        </section>

        {Object.entries(HOLDS).map(([kind, hold]) => {
          const mine = plan.items_list.filter((i) => i.kind === kind);
          return (
            <section key={kind} className={cardClass}>
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

      {plan.when !== 'ahead' && <Story plan={plan} onSaved={setPlan} />}
      <Photos plan={plan} onChanged={setPlan} onOpen={(photo) => setModal({ photo })} />

      <button type="button" onClick={remove} className="text-sm text-red-600 hover:underline">Remove this plan</button>

      {modal === 'edit' && <Modal title={plan.name} onClose={() => setModal(null)}><PlanForm plan={plan} onDone={(p) => { setPlan(p); setModal(null); }} /></Modal>}
      {modal === 'again' && <Modal title={`${plan.name}, again`} onClose={() => setModal(null)}><AgainForm plan={plan} onDone={(p) => { setModal(null); navigate(`/plans/${p.id}`); }} /></Modal>}
      {modal?.add && <Modal title={`Add ${HOLDS[modal.add].add}`} onClose={() => setModal(null)}><Picker kind={modal.add} plan={plan} onDone={(p) => { setPlan(p); setModal(null); }} /></Modal>}
      {modal?.eaten && <Modal title={modal.eaten.label} onClose={() => setModal(null)}><EatenForm plan={plan} item={modal.eaten} onDone={(p) => { setPlan(p); setModal(null); }} /></Modal>}
      {modal?.photo && <Modal title="Photo" wide onClose={() => setModal(null)}><PhotoView photo={modal.photo} onDone={(p) => { setPlan(p); setModal(null); }} /></Modal>}
    </div>
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
  const [eaten, setEaten] = useState({ day: plan.start_day, meal: 'dinner', servings: '' });
  useEffect(() => { axios.get(hold.from).then(({ data }) => setChoices(data)).catch(() => setChoices([])); }, [hold.from]);
  if (!choices) return null;
  const taken = new Set(plan.items_list.filter((i) => i.kind === kind).map((i) => i.ref_id));
  const free = choices.filter((c) => !taken.has(c.id));
  if (free.length === 0) return <p className="text-sm text-gray-600 dark:text-life-100">{choices.length === 0 ? `There's nothing to choose from yet. Add ${hold.add} on its own page first.` : "Everything there is, is already part of this plan."}</p>;
  const submit = async (e) => {
    e.preventDefault();
    try {
      onDone((await axios.post(`/api/plans/${plan.id}/items`, { kind, ref_id: Number(ref), quantity: kind === 'thing' && quantity !== '' ? Number(quantity) : null, note: note || null,
        ...(kind === 'recipe' && eaten.day ? { day: eaten.day, meal: eaten.meal, servings: eaten.servings === '' ? null : Number(eaten.servings) } : {}) })).data);
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
          <WhenEaten plan={plan} day={eaten.day} meal={eaten.meal} servings={eaten.servings} onChange={(day, meal, servings) => setEaten({ day, meal, servings })} />
          <p className="text-xs text-gray-500 dark:text-life-300">On the week, it counts toward the grocery list and the pans and dishes that meal needs. It moves if the plan moves.</p>
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
