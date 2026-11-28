import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import Icon from '../components/Icon';
import axios from 'axios';
import Picture from '../components/Picture';
import { shrink } from '../components/shrink';
import Modal, { Field, inputClass, buttonClass, quietButtonClass, cardClass, errorMessage, toDateInput } from '../components/ui';
import { DueBadge, scheduleText } from './Upkeep';
import { PetRoutines } from './Routines';
import { BulkBar, PickBox, SelectButton, TagChips, TagFilter, TagPicker, saveTags, useSelecting } from '../components/tags';

const ICONS = { dog: 'dog', cat: 'cat', rabbit: 'rabbit', bird: 'bird', fish: 'fish' };
const iconOf = (pet) => ICONS[pet.species] ?? 'pet';
const SPECIES = ['Dog', 'Cat', 'Rabbit', 'Bird', 'Fish', 'Hamster', 'Guinea pig', 'Horse', 'Reptile', 'Ferret'];

/** How old, in words: "4 years", "7 months", "3 weeks". */
export function ageText(born) {
  if (!born) return null;
  const from = new Date(`${born}T12:00:00`);
  const now = new Date();
  let months = (now.getFullYear() - from.getFullYear()) * 12 + now.getMonth() - from.getMonth() - (now.getDate() < from.getDate() ? 1 : 0);
  if (months >= 24) return `${Math.floor(months / 12)} years`;
  if (months >= 12) return `1 year${months > 12 ? `, ${months - 12} month${months === 13 ? '' : 's'}` : ''}`;
  if (months >= 2) return `${months} months`;
  const weeks = Math.max(0, Math.floor((now - from) / (7 * 86400000)));
  return weeks >= 2 ? `${weeks} weeks` : 'a newborn';
}
/** A pet's care without their name in front. */
const careName = (job, pet) => (job.name.startsWith(`${pet.name}: `) ? job.name.slice(pet.name.length + 2) : job.name);

/** Your pets, each with what's next for them. */
export default function PetsPage() {
  const [pets, setPets] = useState(null);
  const [adding, setAdding] = useState(false);
  const [tag, setTag] = useState('');
  const sel = useSelecting();
  const navigate = useNavigate();
  const load = useCallback(() => { axios.get('/api/things/pets', { params: { tag: tag || undefined } }).then(({ data }) => setPets(data)).catch(() => setPets([])); }, [tag]);
  useEffect(() => { load(); }, [load]);
  if (!pets) return null;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-xl font-semibold text-life-800 dark:text-life-50">Pets</h1>
        <button type="button" onClick={() => setAdding(true)} className={buttonClass}>+ Add a pet</button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <TagFilter value={tag} onChange={setTag} />
        {(pets.length > 0 || tag) && <SelectButton sel={sel} />}
      </div>
      <BulkBar sel={sel} kind="pet" list={pets.map((p) => p.id)} noun="pets" onDone={load} />
      {pets.length === 0 && tag ? <p className={`${cardClass} text-center text-sm text-gray-500 dark:text-life-200`}>Nothing matches.</p> : pets.length === 0 ? (
        <p className={`${cardClass} text-sm text-gray-600 dark:text-life-100`}>
          Who they are, their vet and microchip number, how their weight goes, and their care: vaccinations, flea treatment, the vet.
          Life Is reminds you when each is due and keeps every time it was done.
        </p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {pets.map((p) => (
            <li key={p.id}>
              <div className={`${cardClass} flex h-full flex-col gap-2 hover:ring-life-300`}>
              <div className="flex items-center gap-2">
              <PickBox sel={sel} id={p.id} name={p.name} />
              <Link to={`/things/pets/${p.id}`} className="flex min-w-0 flex-1 items-center gap-3">
                {p.photo ? <Picture src={`/api/things/pets/${p.id}/photo`} alt="" className="h-16 w-16 shrink-0 rounded-full object-cover" />
                  : <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-life-50 text-3xl dark:bg-life-700" aria-hidden="true"><Icon of={iconOf(p)} size={32} /></span>}
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold text-life-800 dark:text-life-50">{p.name}</span>
                  <span className="block text-xs text-gray-500 dark:text-life-300">{[p.breed ?? (p.species && p.species[0].toUpperCase() + p.species.slice(1)), ageText(p.born_on)].filter(Boolean).join(' · ')}</span>
                  {p.next && <span className={`mt-0.5 block text-xs ${p.care_due ? 'text-honey-700' : 'text-gray-500 dark:text-life-300'}`}>
                    {p.next.name}: {p.next.state === 'overdue' ? `late by ${-p.next.days_left} day${p.next.days_left === -1 ? '' : 's'}` : p.next.days_left === 0 ? 'due today' : `in ${p.next.days_left} days`}
                  </span>}
                </span>
              </Link>
              </div>
              <TagChips tags={p.tag_list} />
              </div>
            </li>
          ))}
        </ul>
      )}
      {adding && <Modal title="A pet" onClose={() => setAdding(false)}><PetForm pet={{}} onDone={(p) => navigate(`/things/pets/${p.id}`)} /></Modal>}
    </div>
  );
}

/** One pet: who they are, their care and when each is due, and how their weight goes. */
export function PetPage() {
  const id = Number(useParams().id);
  const navigate = useNavigate();
  const [pet, setPet] = useState(undefined);
  const [offered, setOffered] = useState([]);
  const [modal, setModal] = useState(null);       // 'edit', { care }, or { done: job }
  const [error, setError] = useState('');
  const picker = useRef(null);
  const load = useCallback(() => {
    axios.get(`/api/things/pets/${id}`).then(({ data }) => setPet(data)).catch(() => setPet(null));
    axios.get(`/api/things/pets/${id}/care`).then(({ data }) => setOffered(data)).catch(() => {});
  }, [id]);
  useEffect(() => { load(); }, [load]);
  if (pet === undefined) return null;
  if (pet === null) return <p className="text-sm text-gray-600 dark:text-life-200">That pet isn't here anymore. It may have been deleted. <Link to="/things/pets" className="underline">All pets</Link></p>;

  const photo = async (file) => {
    if (!file) return;
    try { setPet((await axios.put(`/api/things/pets/${id}/photo`, { data: await shrink(file) })).data); } catch (err) { setError(errorMessage(err, "The photo couldn't be kept")); }
  };
  const done = async (job) => { await axios.post(`/api/things/upkeep/${job.id}/done`, {}); load(); };
  const remove = async () => {
    if (!window.confirm(`Remove ${pet.name}, with their care, routines and weights?`)) return;
    await axios.delete(`/api/things/pets/${id}`);
    navigate('/things/pets');
  };

  return (
    <div className="space-y-4">
      <Link to="/things/pets" className="text-sm text-life-600 hover:underline dark:text-life-200">← Pets</Link>
      <section className={`${cardClass} flex flex-wrap items-start gap-4`}>
        <input ref={picker} type="file" accept="image/*" className="hidden" onChange={(e) => photo(e.target.files?.[0])} />
        <button type="button" onClick={() => picker.current?.click()} aria-label={pet.photo ? `Another photo of ${pet.name}` : `Add a photo of ${pet.name}`} className="shrink-0">
          {pet.photo ? <Picture src={`/api/things/pets/${id}/photo?v=${pet.weights.length}${pet.care.length}`} alt={pet.name} className="h-24 w-24 rounded-full object-cover" />
            : <span className="flex h-24 w-24 flex-col items-center justify-center rounded-full border-2 border-dashed border-life-200 text-xs text-life-600 dark:border-life-700 dark:text-life-200"><Icon of={iconOf(pet)} size={32} />photo</span>}
        </button>
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-start gap-2">
            <h1 className="mr-auto text-xl font-semibold text-life-800 dark:text-life-50">{pet.name}</h1>
            <button type="button" onClick={() => setModal('edit')} className={quietButtonClass}>Change</button>
          </div>
          <p className="text-sm text-gray-600 dark:text-life-100">{[pet.breed, pet.species && pet.species[0].toUpperCase() + pet.species.slice(1), ageText(pet.born_on)].filter(Boolean).join(' · ') || 'Say what kind of animal they are, and when they were born.'}</p>
          <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
            {[['Vet', [pet.vet_name, pet.vet_phone].filter(Boolean).join(' · '), pet.vet_phone], ['Microchip', pet.microchip], ['Food', pet.food]].filter(([, v]) => v).map(([label, value, phone]) => (
              <div key={label}><dt className="text-xs text-gray-500 dark:text-life-300">{label}</dt>
                <dd className="text-gray-800 dark:text-life-50">{phone ? <>{pet.vet_name && `${pet.vet_name} · `}<a href={`tel:${phone.replace(/[^0-9+]/g, '')}`} className="underline">{phone}</a></> : value}</dd></div>
            ))}
          </dl>
          {pet.note && <p className="whitespace-pre-line text-sm text-gray-700 dark:text-life-100">{pet.note}</p>}
          {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
        </div>
      </section>

      <section className={cardClass} aria-label="Care">
        <div className="mb-1 flex items-baseline gap-2">
          <h2 className="flex-1 font-semibold text-life-800 dark:text-life-50">Care</h2>
          <button type="button" onClick={() => setModal({ care: { name: '', every_n: 1, every_unit: 'year' } })} className="text-sm text-life-600 hover:underline dark:text-life-200">+ Something else</button>
        </div>
        {pet.care.length === 0 ? <p className="text-sm text-gray-500 dark:text-life-300">Nothing yet. Pick from below what {pet.name} needs.</p> : (
          <ul className="divide-y divide-life-50 dark:divide-life-700">
            {pet.care.map((j) => (
              <li key={j.id} className="flex items-center gap-2 py-2">
                <Link to={`/things/upkeep/${j.id}`} className="min-w-0 flex-1">
                  <span className="block text-sm text-gray-800 hover:underline dark:text-life-50">{careName(j, pet)}</span>
                  <span className="block text-xs text-gray-500 dark:text-life-300">{scheduleText(j)}{j.last_done && j.last_done.day ? ` · last ${j.last_done.day}` : ''}</span>
                </Link>
                <DueBadge job={j} />
                <button type="button" onClick={() => done(j)} aria-label={`${careName(j, pet)} done`} className="shrink-0 rounded-full border border-life-200 px-2.5 py-1 text-xs text-life-700 hover:bg-life-50 dark:border-life-700 dark:text-life-100"><Icon of="done" size={14} /> Done</button>
              </li>
            ))}
          </ul>
        )}
        {offered.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5 border-t border-life-50 pt-3 dark:border-life-700" role="group" aria-label="Care to add">
            {offered.map((c) => (
              <button key={c.name} type="button" onClick={() => setModal({ care: c })} className="rounded-full bg-life-50 px-2.5 py-1 text-xs text-life-700 hover:bg-life-100 dark:bg-life-700 dark:text-life-100">+ {c.name}</button>
            ))}
          </div>
        )}
      </section>

      <Link to={`/medicines?pet=${pet.id}`} className="inline-flex min-h-[44px] items-center text-sm text-life-600 underline dark:text-life-200" data-medicines-link>Medicines for {pet.name}</Link>

      <PetRoutines pet={pet} />

      <Weights pet={pet} onChanged={setPet} onRemoved={load} />
      <p className="text-right"><button type="button" onClick={remove} className="text-xs text-red-600 hover:underline">Remove {pet.name}</button></p>

      {modal === 'edit' && <Modal title={pet.name} onClose={() => setModal(null)}><PetForm pet={pet} onDone={(p) => { setPet(p); setModal(null); }} /></Modal>}
      {modal?.care && <Modal title={`Care for ${pet.name}`} onClose={() => setModal(null)}><CareForm pet={pet} care={modal.care} onDone={(p) => { setPet(p); setModal(null); load(); }} /></Modal>}
    </div>
  );
}

function Weights({ pet, onChanged, onRemoved }) {
  const last = pet.weights[0];
  const [value, setValue] = useState('');
  const [unit, setUnit] = useState(last?.unit ?? 'lb');
  const [error, setError] = useState('');
  const add = async (e) => {
    e.preventDefault();
    setError('');
    try { onChanged((await axios.post(`/api/things/pets/${pet.id}/weights`, { value: Number(value), unit })).data); setValue(''); } catch (err) { setError(errorMessage(err, "Couldn't keep that")); }
  };
  const remove = async (w) => { await axios.delete(`/api/things/pets/weights/${w.id}`).catch(() => {}); onRemoved(); };
  const before = pet.weights[1];
  const change = last && before && last.unit === before.unit ? Math.round((last.value - before.value) * 100) / 100 : null;
  return (
    <section className={`${cardClass} space-y-2`} aria-label="Weight">
      <h2 className="font-semibold text-life-800 dark:text-life-50">Weight
        {last && <span className="ml-2 text-sm font-normal text-gray-600 dark:text-life-200">{last.value} {last.unit}{change ? ` (${change > 0 ? 'up' : 'down'} ${Math.abs(change)} since ${before.day})` : ''}</span>}
      </h2>
      <form onSubmit={add} className="flex flex-wrap items-center gap-2">
        <input type="number" required min="0" step="any" value={value} onChange={(e) => setValue(e.target.value)} aria-label="Weight today" placeholder="Today" className={`${inputClass} !w-28`} />
        <select value={unit} onChange={(e) => setUnit(e.target.value)} aria-label="Unit" className={`${inputClass} !w-20`}>{['lb', 'kg', 'oz', 'g'].map((u) => <option key={u}>{u}</option>)}</select>
        <button type="submit" className={quietButtonClass}>Add</button>
      </form>
      {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
      {pet.weights.length > 0 && (
        <ul className="divide-y divide-life-50 text-sm dark:divide-life-700" aria-label="Weights">
          {pet.weights.slice(0, 8).map((w) => (
            <li key={w.id} className="flex items-baseline gap-2 py-1">
              <span className="w-28 text-gray-500 dark:text-life-300">{w.day}</span>
              <span className="flex-1 text-gray-800 dark:text-life-50">{w.value} {w.unit}</span>
              <button type="button" onClick={() => remove(w)} aria-label={`Remove the weight on ${w.day}`} className="text-xs text-gray-400 hover:text-red-600">✕</button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function PetForm({ pet, onDone }) {
  const [form, setForm] = useState({ name: pet.name || '', species: pet.species || '', breed: pet.breed || '', born_on: pet.born_on || '', microchip: pet.microchip || '',
    vet_name: pet.vet_name || '', vet_phone: pet.vet_phone || '', food: pet.food || '', note: pet.note || '' });
  const [tags, setTags] = useState(pet.tag_list || []);
  const [error, setError] = useState('');
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const submit = async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(Object.entries(form).map(([k, v]) => [k, v === '' && k !== 'name' ? null : v]));
    try { const { data } = pet.id ? await axios.put(`/api/things/pets/${pet.id}`, body) : await axios.post('/api/things/pets', body); data.tag_list = await saveTags('pet', data.id, tags); onDone(data); } catch (err) { setError(errorMessage(err, "Couldn't save")); }
  };
  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Their name *"><input required autoFocus={!pet.id} value={form.name} onChange={set('name')} className={inputClass} /></Field>
        <Field label="What they are"><input list="pet-species" value={form.species} onChange={set('species')} placeholder="Dog, cat, rabbit…" className={inputClass} /></Field>
        <datalist id="pet-species">{SPECIES.map((s) => <option key={s} value={s} />)}</datalist>
        <Field label="Breed"><input value={form.breed} onChange={set('breed')} className={inputClass} /></Field>
        <Field label="Born (a guess is fine)"><input type="date" value={form.born_on} onChange={set('born_on')} max={toDateInput(new Date())} className={inputClass} /></Field>
        <Field label="Vet"><input value={form.vet_name} onChange={set('vet_name')} className={inputClass} /></Field>
        <Field label="Vet's phone"><input type="tel" value={form.vet_phone} onChange={set('vet_phone')} className={inputClass} /></Field>
      </div>
      <Field label="Microchip number"><input value={form.microchip} onChange={set('microchip')} className={inputClass} /></Field>
      <Field label="Food: what, how much, when"><input value={form.food} onChange={set('food')} placeholder="Two cups, morning and evening" className={inputClass} /></Field>
      <Field label="Notes"><textarea rows={2} value={form.note} onChange={set('note')} placeholder="allergies, medicines, what scares them" className={inputClass} /></Field>
      <TagPicker value={tags} onChange={setTags} />
      {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
      <div className="flex justify-end"><button type="submit" className={buttonClass}>Save</button></div>
    </form>
  );
}

/** Care to add: what, how often, and when it was last done, so the next time is right from the start. */
function CareForm({ pet, care, onDone }) {
  const [form, setForm] = useState({ name: care.name || '', every_n: care.every_n ?? 1, every_unit: care.every_unit || 'year', last_done: '' });
  const [error, setError] = useState('');
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const submit = async (e) => {
    e.preventDefault();
    try {
      onDone((await axios.post(`/api/things/pets/${pet.id}/care`, { name: form.name, every_n: Number(form.every_n), every_unit: form.every_unit, kind: care.kind ?? 'job', last_done: form.last_done || null })).data);
    } catch (err) { setError(errorMessage(err, "Couldn't add that")); }
  };
  return (
    <form onSubmit={submit} className="space-y-3">
      <Field label="What *"><input required autoFocus={!care.name} value={form.name} onChange={set('name')} placeholder="Ear drops, a bath, the groomer" className={inputClass} /></Field>
      <div className="flex flex-wrap items-center gap-2 text-sm text-gray-700 dark:text-life-100">
        Every
        <input type="number" required min="1" step="1" value={form.every_n} onChange={set('every_n')} aria-label="How many" className={`${inputClass} !w-20`} />
        <select value={form.every_unit} onChange={set('every_unit')} aria-label="Days, weeks, months or years" className={`${inputClass} !w-28`}>
          {[['day', 'days'], ['week', 'weeks'], ['month', 'months'], ['year', 'years']].map(([u, many]) => <option key={u} value={u}>{many}</option>)}
        </select>
      </div>
      <Field label="Last done (left empty: it's due now)"><input type="date" value={form.last_done} onChange={set('last_done')} max={toDateInput(new Date())} className={inputClass} /></Field>
      {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
      <div className="flex justify-end"><button type="submit" className={buttonClass}>Add it</button></div>
    </form>
  );
}
