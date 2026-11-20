import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import axios from 'axios';
import Modal, { Field, inputClass, buttonClass, quietButtonClass, cardClass, errorMessage, toDateInput, fromDateInput } from '../components/ui';

const ENTRY_ICONS = { meal: '🍽', session: '🧵', media: '🎞' };
// What a plan can hold besides its checklist, where each is listed, and how one of them is named.
const HOLDS = {
  recipe: { title: 'Food', add: 'a recipe', icon: '🍽', from: '/api/kitchen/recipes', name: (r) => r.title },
  thing: { title: 'Things to have ready', add: 'one of your things', icon: '📦', from: '/api/things/items', name: (t) => `${t.name} (${t.amount}${t.place ? `, ${t.place}` : ''})` },
  media: { title: 'To watch, hear or read', add: 'something from the collection', icon: '🎞', from: '/api/media', name: (m) => `${m.title}${m.year ? ` (${m.year})` : ''}` },
  project: { title: 'Projects', add: 'a project', icon: '🧵', from: '/api/projects', name: (p) => p.name },
};

const dayText = (day, long = false) => fromDateInput(day).toLocaleDateString(undefined, long ? { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' } : { day: 'numeric', month: 'short', year: 'numeric' });
const daysText = (p, long = false) => (p.end_day === p.start_day ? dayText(p.start_day, long) : `${dayText(p.start_day)} to ${dayText(p.end_day)}`);
export const photoAddress = (photo) => `/api/plans/photos/${photo.id ?? photo}`;

/** Makes a picked photo small enough to keep: at most 1600 across, as a JPEG. Done here, on the device. */
async function shrink(file) {
  const picture = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const scale = Math.min(1, 1600 / Math.max(picture.width, picture.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(picture.width * scale);
  canvas.height = Math.round(picture.height * scale);
  canvas.getContext('2d').drawImage(picture, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.85).split(',')[1];
}

/** Plans ahead, and the ones to look back on. */
export default function PlansPage() {
  const [plans, setPlans] = useState(null);
  const [adding, setAdding] = useState(false);
  const navigate = useNavigate();
  useEffect(() => { axios.get('/api/plans').then(({ data }) => setPlans(data)).catch(() => setPlans([])); }, []);
  if (!plans) return null;
  const now = plans.filter((p) => p.when === 'now');
  const ahead = plans.filter((p) => p.when === 'ahead').reverse();
  const past = plans.filter((p) => p.when === 'past');
  const years = [...new Set(past.map((p) => p.start_day.slice(0, 4)))];
  const tile = (p) => (
    <li key={p.id}>
      <Link to={`/plans/${p.id}`} className={`${cardClass} flex h-full gap-3 hover:ring-life-300`}>
        {p.cover_photo ? <img src={photoAddress(p.cover_photo)} alt="" loading="lazy" className="h-16 w-16 flex-none rounded-lg object-cover" />
          : <span aria-hidden="true" className="flex h-16 w-16 flex-none items-center justify-center rounded-lg bg-life-50 text-2xl dark:bg-life-700">✨</span>}
        <span className="min-w-0 flex-1">
          <span className="block font-medium text-life-800 dark:text-life-50">{p.name}</span>
          <span className="block text-xs text-gray-500 dark:text-life-300">{daysText(p)}</span>
          <span className="mt-1 block text-xs text-gray-600 dark:text-life-200">
            {[p.when !== 'past' && p.tasks_left > 0 && `${p.tasks_left} still to do`, p.photos > 0 && `${p.photos} ${p.photos === 1 ? 'photo' : 'photos'}`, p.note].filter(Boolean).join(' · ')}
          </span>
        </span>
      </Link>
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
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-xl font-semibold text-life-800 dark:text-life-50">Plans and memories</h1>
        <button type="button" onClick={() => setAdding(true)} className={buttonClass}>+ New</button>
      </div>
      {plans.length === 0 && (
        <div className={`${cardClass} text-center text-sm text-gray-500 dark:text-life-200`}>
          A plan is anything with a day and things that belong to it: a holiday with its menu, dishes and films, or one afternoon's sewing.
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
  const [error, setError] = useState('');
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const submit = async (e) => {
    e.preventDefault();
    const body = { name: form.name, start_day: form.start_day, end_day: form.end_day || null, note: form.note || null, story: plan.story ?? null };
    try { onDone((plan.id ? await axios.put(`/api/plans/${plan.id}`, body) : await axios.post('/api/plans', body)).data); } catch (err) { setError(errorMessage(err, "Couldn't save")); }
  };
  return (
    <form onSubmit={submit} className="space-y-3">
      <Field label="What it is *"><input required autoFocus={!plan.id} value={form.name} onChange={set('name')} placeholder="e.g. Thanksgiving, Saturday sewing" className={inputClass} /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Day *"><input required type="date" value={form.start_day} onChange={set('start_day')} className={inputClass} /></Field>
        <Field label="Until (if longer)"><input type="date" min={form.start_day} value={form.end_day} onChange={set('end_day')} className={inputClass} /></Field>
      </div>
      <Field label="What it's for"><textarea rows={2} value={form.note} onChange={set('note')} className={inputClass} /></Field>
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
  if (plan === undefined) return null;
  if (plan === null) return <p className="text-sm text-gray-500 dark:text-life-300">That plan isn't there. <Link to="/plans" className="underline">All plans</Link></p>;

  const act = async (work) => { setError(''); try { setPlan((await work()).data); } catch (err) { setError(errorMessage(err, "Couldn't do that")); } };
  const tasks = plan.items_list.filter((i) => i.kind === 'task');
  const short = plan.items_list.filter((i) => i.short);
  const remove = async () => {
    if (!window.confirm(`Remove ${plan.name}, with its checklist and photos? What it points at (recipes, things, titles) stays.`)) return;
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
                      <span aria-hidden="true">{hold.icon}</span>
                      <span className="flex-1">
                        {i.link ? <Link to={i.link} className="text-gray-800 hover:underline dark:text-life-50">{i.label}</Link> : <span className="text-gray-500 dark:text-life-300">{i.label}</span>}
                        {i.quantity !== null && <span className="ml-1 text-gray-500 dark:text-life-300">× {i.quantity}</span>}
                        {[i.detail, i.note].filter(Boolean).length > 0 && <span className="block text-xs text-gray-500 dark:text-life-300">{[i.detail, i.note].filter(Boolean).join(' · ')}</span>}
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
                    <span aria-hidden="true">{ENTRY_ICONS[e.kind]}</span>
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
  useEffect(() => { axios.get(hold.from).then(({ data }) => setChoices(data)).catch(() => setChoices([])); }, [hold.from]);
  if (!choices) return null;
  const taken = new Set(plan.items_list.filter((i) => i.kind === kind).map((i) => i.ref_id));
  const free = choices.filter((c) => !taken.has(c.id));
  if (free.length === 0) return <p className="text-sm text-gray-600 dark:text-life-100">{choices.length === 0 ? `There's nothing to choose from yet. Add ${hold.add} on its own page first.` : "Everything there is, is already part of this plan."}</p>;
  const submit = async (e) => {
    e.preventDefault();
    try {
      onDone((await axios.post(`/api/plans/${plan.id}/items`, { kind, ref_id: Number(ref), quantity: kind === 'thing' && quantity !== '' ? Number(quantity) : null, note: note || null })).data);
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
      <Field label="A note"><input value={note} onChange={(e) => setNote(e.target.value)} className={inputClass} /></Field>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="text-right"><button type="submit" className={buttonClass}>Add</button></div>
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
      <p className="text-sm text-gray-600 dark:text-life-100">A new plan with the same food, things, titles and checklist (unticked). This one stays as it is, with its story and photos.</p>
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
        <button type="button" disabled={Boolean(busy)} onClick={() => picker.current.click()} className="text-sm text-life-600 hover:underline dark:text-life-200">{busy || '+ From this device'}</button>
      </div>
      {error && <p className="mb-2 text-sm text-red-600">{error}</p>}
      {plan.photos_list.length === 0 ? <p className="text-sm text-gray-400 dark:text-life-400">None yet. A photo picked from this device is made smaller and kept here with the plan.</p> : (
        <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
          {plan.photos_list.map((p) => (
            <li key={p.id}>
              <button type="button" onClick={() => onOpen(p)} className="block w-full overflow-hidden rounded-lg ring-1 ring-life-100 hover:ring-life-400 dark:ring-life-700">
                <img src={photoAddress(p)} alt={p.caption || 'A photo from this plan'} loading="lazy" className="aspect-square w-full object-cover" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function PhotoView({ photo, onDone }) {
  const [caption, setCaption] = useState(photo.caption || '');
  const save = async () => onDone((await axios.put(`/api/plans/photos/${photo.id}`, { caption: caption || null })).data);
  const remove = async () => onDone((await axios.delete(`/api/plans/photos/${photo.id}`)).data);
  return (
    <div className="space-y-3">
      <img src={photoAddress(photo)} alt={photo.caption || ''} className="max-h-[60vh] w-full rounded-lg object-contain" />
      <Field label="What it shows"><input value={caption} onChange={(e) => setCaption(e.target.value)} className={inputClass} /></Field>
      <div className="flex items-center justify-between">
        <button type="button" onClick={remove} className="text-sm text-red-600 hover:underline">{photo.source === 'kept' ? 'Delete this photo' : 'Take it off the plan (it stays in your library)'}</button>
        <button type="button" onClick={save} className={buttonClass}>Save</button>
      </div>
    </div>
  );
}
