import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import Icon from '../components/Icon';
import axios from 'axios';
import Picture from '../components/Picture';
import PlacePicker from '../components/PlacePicker';
import { shrink } from '../components/shrink';
import Modal, { Field, inputClass, buttonClass, quietButtonClass, cardClass, errorMessage, toDateInput } from '../components/ui';
import { ItemForm, goneText } from './Things';
import { DueBadge } from './Upkeep';
import Records from '../components/Records';
import { ThingRecalls } from '../components/Recalls';
import { lastUsedText, todayHere } from '../ago';

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
const HISTORY_ICONS = { added: 'plan', moved: 'moved', used: 'session' };

export function HistoryList({ history }) {
  if (!history.length) return <p className="text-sm text-gray-500 dark:text-life-300">Nothing yet.</p>;
  return (
    <ol className="space-y-2" aria-label="History">
      {history.map((h) => (
        <li key={h.id} className="flex gap-2 text-sm">
          <span aria-hidden="true" className="w-5 text-center"><Icon of={HISTORY_ICONS[h.what]} size={16} /></span>
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
  const [modal, setModal] = useState(null);       // 'edit', 'use' or 'gone'
  const [jobs, setJobs] = useState([]);
  const [routines, setRoutines] = useState([]);
  const [error, setError] = useState('');
  const [quick, setQuick] = useState(null);       // { rec, details }: the use the last tap recorded, while it can still be taken back
  const picker = useRef(null);

  const load = useCallback(() => {
    axios.get(`/api/things/items/${id}`).then(({ data }) => setItem(data)).catch(() => setItem(null));
    axios.get(`/api/things/items/${id}/history`).then(({ data }) => setHistory(data)).catch(() => setHistory([]));
  }, [id]);
  useEffect(() => {
    load();
    axios.get('/api/things/kinds').then(({ data }) => setKinds(data)).catch(() => {});
    axios.get('/api/things/places').then(({ data }) => setPlaces(data)).catch(() => {});
    axios.get(`/api/routines/for-thing/${id}`).then(({ data }) => setRoutines(data)).catch(() => setRoutines([]));
    axios.get('/api/things/upkeep').then(({ data }) => setJobs(data.filter((j) => j.item?.id === id || j.tools.some((x) => x.id === id) || j.supplies.some((x) => x.item_id === id)))).catch(() => {});
  }, [load, id]);

  if (item === undefined) return null;
  if (item === null) return <p className="text-sm text-gray-600 dark:text-life-200">That thing isn't here anymore. It may have been deleted. <Link to="/things" className="underline">All things</Link></p>;

  const move = async (placeId) => {
    setError('');
    try { setItem((await axios.post(`/api/things/items/${id}/move`, { place_id: placeId === '' ? null : placeId })).data); load(); } catch (err) { setError(errorMessage(err, "Couldn't move it")); }
  };
  const photo = async (file) => {
    if (!file) return;
    setError('');
    try { setItem((await axios.put(`/api/things/items/${id}/photo`, { data: await shrink(file) })).data); } catch (err) { setError(errorMessage(err, "The photo couldn't be kept")); }
  };
  const takeBack = async () => {
    setError('');
    try { setItem((await axios.delete(`/api/things/items/${id}/gone`)).data); load(); } catch (err) { setError(errorMessage(err, "Couldn't undo that")); }
  };
  const usedIt = async () => {
    setError('');
    try { const { data } = await axios.post(`/api/things/items/${id}/uses`, {}); setHistory(data); setQuick({ rec: Math.max(...data.map((h) => h.id)), details: false }); } catch (err) { setError(errorMessage(err, "Couldn't save that")); }
  };
  const undoUsed = async () => {
    setError('');
    try { setHistory((await axios.delete(`/api/things/uses/${quick.rec}`)).data); setQuick(null); } catch (err) { setError(errorMessage(err, "Couldn't undo that")); }
  };
  const lastUsed = history.filter((h) => h.what === 'used').map((h) => h.day).sort().pop() ?? null;
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
              {item.icon ? <span className="text-3xl" aria-hidden="true">{item.icon}</span> : <Icon of="scan" size={32} />}Add a photo
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
            {!item.gone && <button type="button" onClick={usedIt} className={buttonClass}><Icon of="session" /> I used it</button>}
            <button type="button" onClick={() => setModal('edit')} className={quietButtonClass}>Change</button>
          </div>
          {!item.gone && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-0 text-sm" data-did>
              {quick ? (
                <>
                  <span role="status" className="text-gray-700 dark:text-life-100">Used it today</span>
                  <button type="button" onClick={undoUsed} className="inline-flex min-h-[44px] items-center text-life-600 underline dark:text-life-200">Undo</button>
                  {!quick.details && <button type="button" onClick={() => setModal('use')} className="inline-flex min-h-[44px] items-center text-life-600 underline dark:text-life-200">Add details</button>}
                </>
              ) : (
                <span className="text-xs text-gray-500 dark:text-life-300" data-last-done>{lastUsedText(lastUsed, todayHere())}</span>
              )}
            </div>
          )}
          {item.gone && (
            <div className="space-y-2 rounded-lg bg-honey-100 px-3 py-2 text-sm text-honey-700" role="status" data-gone>
              <p>No longer have it: {goneText(item.gone)}</p>
              <button type="button" onClick={takeBack} className="min-h-[44px] rounded-xl border border-honey-700 px-3 text-sm">I have it again</button>
            </div>
          )}
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
            {[`Asset ${item.asset_no}`, item.insured && 'Insured', item.barcode && `Barcode ${item.barcode}`, item.code ? 'Has its Life Is sticker' : null].filter(Boolean).join(' · ')}
            {' '}<Link to={`/things/stickers?ids=${id}`} className="text-life-600 underline dark:text-life-200">{item.code ? 'Print its sticker again' : 'Print a sticker for it'}</Link>
          </p>
          {item.own_fields.length > 0 && (
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm" aria-label="Your own fields">
              {item.own_fields.map((f) => (
                <div key={f.name} className="contents"><dt className="text-xs font-medium text-gray-600 dark:text-life-200">{f.name}</dt><dd className="break-words text-gray-800 dark:text-life-50">{f.value}</dd></div>
              ))}
            </dl>
          )}
          {item.note && <p className="whitespace-pre-line text-sm text-gray-700 dark:text-life-100">{item.note}</p>}
          {!item.gone && <button type="button" onClick={() => setModal('gone')} className={`${quietButtonClass} min-h-[44px]`}>No longer have it</button>}
          {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
        </section>
      </div>

      <ThingRecalls itemId={id} key={`${id}-${item.updated_at}`} />

      <Records item={item} onChanged={(saved) => (saved ? setItem(saved) : load())} />

      {item.guard && <Sharing item={item} />}

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

      {routines.length > 0 && (
        <section className={cardClass} aria-label="Used in" data-section="used-in">
          <h2 className="mb-1 font-semibold text-life-800 dark:text-life-50">Used in</h2>
          <ul className="divide-y divide-life-50 dark:divide-life-700">
            {routines.map((r) => (
              <li key={`${r.routine_id}-${r.time}`}><Link to="/routines" className="flex min-h-[44px] items-center text-sm text-gray-800 hover:underline dark:text-life-50">{r.title}</Link></li>
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
      {modal === 'gone' && (
        <Modal title={`No longer have ${item.name}`} onClose={() => setModal(null)}>
          <GoneForm item={item} onDone={(saved) => { setItem(saved); setModal(null); load(); }} />
        </Modal>
      )}
      {modal === 'use' && (
        <Modal title={`Using ${item.name}`} onClose={() => setModal(null)}>
          <UseForm item={item} replace={quick?.rec ?? null} onDone={(h) => { setHistory(h); setQuick(quick ? { rec: Math.max(...h.map((e) => e.id)), details: true } : null); setModal(null); }} />
        </Modal>
      )}
    </div>
  );
}

/** Who can see a gun or ammunition: only the person who keeps it, and the people picked here. Each pick is kept as it is made. */
function Sharing({ item }) {
  const [state, setState] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { axios.get(`/api/things/items/${item.id}/sharing`).then(({ data }) => setState(data)).catch(() => setState(false)); }, [item.id]);
  if (state === null || state === false) return null;
  const toggle = async (id) => {
    setError('');
    const people = state.people.includes(id) ? state.people.filter((p) => p !== id) : [...state.people, id];
    try { setState({ ...state, ...(await axios.put(`/api/things/items/${item.id}/sharing`, { people })).data }); } catch (err) { setError(errorMessage(err, "Couldn't change who sees it")); }
  };
  return (
    <section className={`${cardClass} space-y-1`} aria-label="Who can see this" data-sharing>
      <h2 className="font-semibold text-life-800 dark:text-life-50">Who can see this</h2>
      <p className="text-sm text-gray-600 dark:text-life-100">
        {state.people.length === 0 ? 'Only you. It is kept out of search, the Home page and every report, and nobody else in the house can see it.'
          : 'You, and the people checked below. They can look at it, with its photo and serial number, but not change it.'}
      </p>
      {state.choices.length === 0 ? <p className="text-sm text-gray-500 dark:text-life-300">Nobody else has signed in here.</p> : (
        <ul>
          {state.choices.map((c) => (
            <li key={c.id}><label className="flex min-h-[44px] items-center gap-2 text-sm text-gray-800 dark:text-life-50">
              <input type="checkbox" checked={state.people.includes(c.id)} onChange={() => toggle(c.id)} className="h-5 w-5 flex-none accent-life-600" /> {c.name}
            </label></li>
          ))}
        </ul>
      )}
      {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
    </section>
  );
}

/** Dollars as typed ("1,200", "$50.5") to whole cents; null when nothing is typed, NaN when it is not an amount. */
const centsOf = (text) => {
  const t = String(text).replace(/[$,\s]/g, '');
  if (t === '') return null;
  return /^\d+(\.\d{0,2})?$/.test(t) ? Math.round(Number(t) * 100) : Number.NaN;
};

/** "No longer have it": how it went, on which day, to whom (in your own words) and for how much. It stays on file and can be undone. */
function GoneForm({ item, onDone }) {
  const [form, setForm] = useState({ how: 'sold', day: toDateInput(new Date()), to: '', price: '' });
  const [error, setError] = useState('');
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const submit = async (e) => {
    e.preventDefault();
    const cents = form.how === 'sold' ? centsOf(form.price) : null;
    if (Number.isNaN(cents)) { setError('An amount is a number, like 250 or 79.99'); return; }
    try { onDone((await axios.post(`/api/things/items/${item.id}/gone`, { how: form.how, day: form.day, to: form.to || null, price_cents: cents })).data); } catch (err) { setError(errorMessage(err, "Couldn't keep that")); }
  };
  return (
    <form onSubmit={submit} className="space-y-3">
      <p className="text-sm text-gray-600 dark:text-life-200">It leaves your lists and totals, but the record is kept. You can undo this from its page.</p>
      <div className="grid grid-cols-2 gap-3">
        <Field label="What happened">
          <select value={form.how} onChange={set('how')} className={`${inputClass} min-h-[44px]`}>
            <option value="sold">Sold</option><option value="given">Given away</option>{!item.guard && <option value="thrown">Thrown out</option>}<option value="stolen">Stolen</option>
          </select>
        </Field>
        <Field label="Which day"><input type="date" required value={form.day} onChange={set('day')} className={`${inputClass} min-h-[44px]`} /></Field>
      </div>
      <Field label={item.guard ? 'Who to, or a note (a name, a report number)' : 'Who to (if you want to say)'}><input value={form.to} onChange={set('to')} maxLength={200} placeholder={item.guard ? 'a name, a report number…' : 'a neighbor, the thrift store…'} className={`${inputClass} min-h-[44px]`} /></Field>
      {form.how === 'sold' && <Field label="Sold for (dollars)"><input inputMode="decimal" value={form.price} onChange={set('price')} placeholder="50" className={`${inputClass} min-h-[44px]`} /></Field>}
      {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
      <div className="flex justify-end"><button type="submit" className={`${buttonClass} min-h-[44px]`}>Keep it</button></div>
    </form>
  );
}

/** A time it was used: the day, the project (whose activity comes with it) or just an activity, and a note. */
function UseForm({ item, onDone, replace = null }) {
  const [projects, setProjects] = useState([]);
  const [form, setForm] = useState({ day: toDateInput(new Date()), project_id: '', activity: item.activities.length === 1 ? item.activities[0] : '', note: '' });
  const [error, setError] = useState('');
  const cleared = useRef(false);
  useEffect(() => { axios.get('/api/projects').then(({ data }) => setProjects(data.filter((p) => !['done', 'dropped'].includes(p.status)))).catch(() => {}); }, []);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const submit = async (e) => {
    e.preventDefault();
    try {
      // Filling in a one-tap use replaces it: take the quick one back first, so there is one record for one use.
      if (replace && !cleared.current) { await axios.delete(`/api/things/uses/${replace}`); cleared.current = true; }
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
