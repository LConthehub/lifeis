import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import axios from 'axios';
import Picture from '../components/Picture';
import PlacePicker from '../components/PlacePicker';
import { shrink } from '../components/shrink';
import Modal, { Field, inputClass, buttonClass, quietButtonClass, cardClass, errorMessage, toDateInput } from '../components/ui';
import { ItemForm } from './Things';
import { DueBadge } from './Upkeep';
import Records from '../components/Records';
import { ThingRecalls } from '../components/Recalls';

const dayText = (day) => new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

/** One line of a thing's (or a copy's) history, in words. */
export function historyLine(h) {
  if (h.what === 'added') return h.to_place ? `Added, in ${h.to_place}` : 'Added';
  if (h.what === 'moved') {
    if (!h.to_place) return `Taken out of ${h.from_place}`;
    return h.from_place ? `Moved from ${h.from_place} to ${h.to_place}` : `Put in ${h.to_place}`;
  }
  const what = [h.project && `for ${h.project}`, h.activity && !h.project?.includes(h.activity) && `(${h.activity})`].filter(Boolean).join(' ');
  return `Used${what ? ` ${what}` : ''}`;
}
const HISTORY_ICONS = { added: '✨', moved: '↪', used: '🛠' };

export function HistoryList({ history }) {
  if (!history.length) return <p className="text-sm text-gray-500 dark:text-life-300">Nothing yet.</p>;
  return (
    <ol className="space-y-2" aria-label="History">
      {history.map((h) => (
        <li key={h.id} className="flex gap-2 text-sm">
          <span aria-hidden="true" className="w-5 text-center">{HISTORY_ICONS[h.what]}</span>
          <span className="flex-1 text-gray-800 dark:text-life-50">
            {h.what === 'used' && h.project_id ? <>Used for <Link to={`/projects/${h.project_id}`} className="underline">{h.project}</Link></>
              : h.what === 'used' && h.job ? <>Used for {h.job_id ? <Link to={`/things/upkeep/${h.job_id}`} className="underline">{h.job}</Link> : h.job}</>
                : historyLine(h)}
            {h.note && <span className="block text-xs text-gray-500 dark:text-life-300">{h.note}</span>}
          </span>
          <span className="whitespace-nowrap text-xs text-gray-500 dark:text-life-300">{dayText(h.day)}</span>
        </li>
      ))}
    </ol>
  );
}

/**
 * One thing: its photo, where it is (and moving it), what it's for, its sticker, and its history: where it
 * has been, and every time it was used.
 */
export default function Thing() {
  const id = Number(useParams().id);
  const navigate = useNavigate();
  const [item, setItem] = useState(undefined);
  const [history, setHistory] = useState([]);
  const [kinds, setKinds] = useState([]);
  const [places, setPlaces] = useState([]);
  const [modal, setModal] = useState(null);       // 'edit' or 'use'
  const [jobs, setJobs] = useState([]);
  const [error, setError] = useState('');
  const picker = useRef(null);

  const load = useCallback(() => {
    axios.get(`/api/things/items/${id}`).then(({ data }) => setItem(data)).catch(() => setItem(null));
    axios.get(`/api/things/items/${id}/history`).then(({ data }) => setHistory(data)).catch(() => setHistory([]));
  }, [id]);
  useEffect(() => {
    load();
    axios.get('/api/things/kinds').then(({ data }) => setKinds(data)).catch(() => {});
    axios.get('/api/things/places').then(({ data }) => setPlaces(data)).catch(() => {});
    axios.get('/api/things/upkeep').then(({ data }) => setJobs(data.filter((j) => j.item?.id === id || j.tools.some((x) => x.id === id) || j.supplies.some((x) => x.item_id === id)))).catch(() => {});
  }, [load, id]);

  if (item === undefined) return null;
  if (item === null) return <Navigate to="/things" replace />;

  const move = async (placeId) => {
    setError('');
    try { setItem((await axios.post(`/api/things/items/${id}/move`, { place_id: placeId === '' ? null : placeId })).data); load(); } catch (err) { setError(errorMessage(err, "Couldn't move it")); }
  };
  const photo = async (file) => {
    if (!file) return;
    setError('');
    try { setItem((await axios.put(`/api/things/items/${id}/photo`, { data: await shrink(file) })).data); } catch (err) { setError(errorMessage(err, "The photo couldn't be kept")); }
  };
  const removePhoto = async () => { setItem((await axios.delete(`/api/things/items/${id}/photo`)).data); };

  return (
    <div className="space-y-4">
      <Link to="/things" className="text-sm text-life-600 hover:underline dark:text-life-200">← Things</Link>
      <div className="grid gap-4 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <section className={`${cardClass} space-y-3`}>
          {item.photo ? (
            <Picture src={`/api/things/items/${id}/photo?v=${encodeURIComponent(item.updated_at)}${history.length}`} alt={item.name} className="max-h-80 w-full rounded-xl object-contain" />
          ) : (
            <button type="button" onClick={() => picker.current?.click()} className="flex h-36 w-full flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed md:aspect-[4/3] md:h-auto border-life-200 text-sm text-life-600 dark:border-life-700 dark:text-life-200">
              <span className="text-3xl" aria-hidden="true">{item.icon || '📷'}</span>Add a photo
            </button>
          )}
          <input ref={picker} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => photo(e.target.files?.[0])} />
          {item.photo && (
            <div className="flex gap-2 text-xs">
              <button type="button" onClick={() => picker.current?.click()} className="text-life-600 hover:underline dark:text-life-200">Another photo</button>
              <button type="button" onClick={removePhoto} className="text-gray-500 hover:underline dark:text-life-300">Remove it</button>
            </div>
          )}
        </section>

        <section className={`${cardClass} space-y-3`}>
          <div className="flex flex-wrap items-start gap-2">
            <div className="mr-auto">
              <h1 className="text-xl font-semibold text-life-800 dark:text-life-50">{item.name}</h1>
              <p className="text-xs text-gray-500 dark:text-life-300">{[item.icon && `${item.icon} ${item.kind}`, item.amount !== 'some' && item.amount].filter(Boolean).join(' · ') || item.kind}</p>
            </div>
            <button type="button" onClick={() => setModal('use')} className={buttonClass}>🛠 I used it</button>
            <button type="button" onClick={() => setModal('edit')} className={quietButtonClass}>Change</button>
          </div>
          <Field label="Where it is">
            <PlacePicker value={item.place_id ?? ''} places={places} onPlaces={setPlaces} onChange={move} />
          </Field>
          <div className="text-sm">
            <span className="text-xs font-medium text-gray-600 dark:text-life-200">What it's for</span>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {item.activities.length ? item.activities.map((a) => <Link key={a} to={`/things/activities?name=${encodeURIComponent(a)}`} className="rounded-full bg-life-50 px-2.5 py-0.5 text-life-700 hover:bg-life-100 dark:bg-life-700 dark:text-life-100">{a}</Link>)
                : <button type="button" onClick={() => setModal('edit')} className="text-xs text-life-600 underline dark:text-life-200">Say what it's for</button>}
            </div>
          </div>
          <p className="text-xs text-gray-500 dark:text-life-300">
            {[item.barcode && `Barcode ${item.barcode}`, item.code ? 'Has its Life Is sticker' : null].filter(Boolean).join(' · ')}
            {' '}<Link to={`/things/stickers?ids=${id}`} className="text-life-600 underline dark:text-life-200">{item.code ? 'Print its sticker again' : 'Print a sticker for it'}</Link>
          </p>
          {item.note && <p className="whitespace-pre-line text-sm text-gray-700 dark:text-life-100">{item.note}</p>}
          {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
        </section>
      </div>

      <ThingRecalls itemId={id} key={`${id}-${item.updated_at}`} />

      <Records item={item} onChanged={(saved) => (saved ? setItem(saved) : load())} />

      {jobs.length > 0 && (
        <section className={cardClass} aria-label="Upkeep">
          <h2 className="mb-1 font-semibold text-life-800 dark:text-life-50">Upkeep</h2>
          <ul className="divide-y divide-life-50 dark:divide-life-700">
            {jobs.map((j) => (
              <li key={j.id} className="flex items-center gap-2 py-1.5 text-sm">
                <Link to={`/things/upkeep/${j.id}`} className="flex-1 text-gray-800 hover:underline dark:text-life-50">{j.name}
                  <span className="text-xs text-gray-500 dark:text-life-300"> · {j.item?.id === id ? 'for this' : 'needs this'}</span></Link>
                <DueBadge job={j} />
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className={cardClass}>
        <h2 className="mb-2 font-semibold text-life-800 dark:text-life-50">Its history</h2>
        <HistoryList history={history} />
      </section>

      {modal === 'edit' && (
        <Modal title={`Change ${item.name}`} onClose={() => setModal(null)}>
          <ItemForm item={item} kinds={kinds} places={places} onPlaces={setPlaces} onDone={() => { setModal(null); axios.get(`/api/things/items/${id}`).then(({ data }) => { setItem(data); load(); }).catch(() => navigate('/things')); }} />
        </Modal>
      )}
      {modal === 'use' && (
        <Modal title={`Using ${item.name}`} onClose={() => setModal(null)}>
          <UseForm item={item} onDone={(h) => { setHistory(h); setModal(null); }} />
        </Modal>
      )}
    </div>
  );
}

/** A time it was used: the day, the project (whose activity comes with it) or just an activity, and a note. */
function UseForm({ item, onDone }) {
  const [projects, setProjects] = useState([]);
  const [form, setForm] = useState({ day: toDateInput(new Date()), project_id: '', activity: item.activities.length === 1 ? item.activities[0] : '', note: '' });
  const [error, setError] = useState('');
  useEffect(() => { axios.get('/api/projects').then(({ data }) => setProjects(data.filter((p) => !['done', 'dropped'].includes(p.status)))).catch(() => {}); }, []);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const submit = async (e) => {
    e.preventDefault();
    try {
      onDone((await axios.post(`/api/things/items/${item.id}/uses`, { day: form.day, project_id: form.project_id === '' ? null : Number(form.project_id), activity: form.activity || null, note: form.note || null })).data);
    } catch (err) { setError(errorMessage(err, "Couldn't keep that")); }
  };
  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Field label="When"><input type="date" required value={form.day} onChange={set('day')} className={inputClass} /></Field>
        <Field label="For a project">
          <select value={form.project_id} onChange={set('project_id')} className={inputClass}>
            <option value="">No project</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}{p.activity ? ` (${p.activity})` : ''}</option>)}
          </select>
        </Field>
      </div>
      {form.project_id === '' && (
        <Field label="For an activity">
          <input list="use-activities" value={form.activity} onChange={set('activity')} placeholder="Gardening, Repairs…" className={inputClass} />
          <datalist id="use-activities">{item.activities.map((a) => <option key={a} value={a} />)}</datalist>
        </Field>
      )}
      <Field label="A note"><input value={form.note} onChange={set('note')} placeholder="what it was for, how it went" className={inputClass} /></Field>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex justify-end"><button type="submit" className={buttonClass}>Keep it</button></div>
    </form>
  );
}
