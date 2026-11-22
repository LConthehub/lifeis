import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import axios from 'axios';
import Picture from '../components/Picture';
import { shrink } from '../components/shrink';
import { buttonClass, cardClass, errorMessage, quietButtonClass } from '../components/ui';

const FIELD = 'min-h-11 w-full rounded-lg border border-life-200 bg-white px-3 py-2 text-base text-gray-800 focus:border-life-500 focus:outline-none focus:ring-2 focus:ring-life-200 dark:border-life-700 dark:bg-life-800 dark:text-life-50';
const dollars = (cents) => (cents == null ? '' : (cents / 100).toFixed(2));
/** Dollars as typed ("1,200", "$50.5") to whole cents; null when empty, NaN when it is not an amount. */
const centsOf = (text) => {
  const t = String(text).replace(/[$,\s]/g, '');
  if (t === '') return null;
  return /^\d+(\.\d{0,2})?$/.test(t) ? Math.round(Number(t) * 100) : Number.NaN;
};
const hasValue = (t) => t.records.value_cents !== null || t.records.price_cents !== null;
const isDone = (t) => t.photo && hasValue(t);

/**
 * Walking through one room with a phone in hand: what is kept there (and on its shelves), what each thing still
 * lacks (a photo, a value, a serial number), and a way to put each right on the spot. Everything is kept as soon
 * as it is typed or taken: there is no Save at the end.
 */
export default function WalkThrough() {
  const placeId = Number(useParams().id);
  const [places, setPlaces] = useState(null);
  const [things, setThings] = useState(null);
  const [rooms, setRooms] = useState([]);

  const loadRooms = useCallback(() => axios.get('/api/things/report').then(({ data }) => setRooms(data.choices)).catch(() => {}), []);
  useEffect(() => {
    setThings(null);
    axios.get('/api/things/places').then(({ data }) => setPlaces(data)).catch(() => setPlaces([]));
    axios.get('/api/things/items', { params: { place_id: placeId } }).then(({ data }) => setThings(data)).catch(() => setThings(false));
    loadRooms();
  }, [placeId, loadRooms]);

  const replace = (made) => setThings((list) => list.map((t) => (t.id === made.id ? made : t)));
  const total = things ? things.length : 0;
  const done = things ? things.filter(isDone).length : 0;
  const complete = total > 0 && done === total;
  useEffect(() => { if (complete) loadRooms(); }, [complete, loadRooms]);

  if (!places || things === null) return null;
  const place = places.find((p) => p.id === placeId);
  if (!place) return <p className="text-sm text-gray-500 dark:text-life-300">That place isn't there any more. <Link to="/things/places" className="underline">All places</Link></p>;
  if (things === false) return <p className="text-sm text-gray-600 dark:text-life-200">The things here couldn't be listed just now.</p>;

  // The next room that still needs something: not this one (nor the room this shelf is in), the one lacking most first.
  let top = place;
  for (let steps = 0; top.parent_id !== null && steps < 12; steps += 1) top = places.find((p) => p.id === top.parent_id) ?? top;
  const next = rooms.filter((r) => r.id !== 0 && r.id !== top.id && r.id !== placeId && r.incomplete > 0).sort((a, b) => b.incomplete - a.incomplete || a.name.localeCompare(b.name))[0];

  return (
    <div className="space-y-4">
      <Link to={`/things/places/${placeId}`} className="inline-flex min-h-11 items-center text-sm text-life-600 hover:underline dark:text-life-200">← {place.name}</Link>
      <div>
        <h1 className="text-xl font-semibold text-life-800 dark:text-life-50">Walk through {place.name}</h1>
        {place.path !== place.name && <p className="text-xs text-gray-500 dark:text-life-300">{place.path}</p>}
        <p className="mt-1 text-sm text-gray-600 dark:text-life-100">
          Go thing by thing: take its photo, type what it is worth and its serial number. Each is kept the moment you are done with it. Nothing leaves this Life Is.
        </p>
      </div>

      <section className={`${cardClass} space-y-2`} aria-label="How far along this room is">
        <p className="text-sm font-medium text-gray-800 dark:text-life-50" role="status" data-progress>
          {total === 0 ? 'Nothing is kept in this room yet.' : `${done} of ${total} ${total === 1 ? 'thing' : 'things'} in this room ${total === 1 ? 'has' : 'have'} a photo and a value.`}
        </p>
        {total > 0 && <div className="h-2 overflow-hidden rounded-full bg-life-100 dark:bg-life-700" aria-hidden="true"><div className="h-full bg-life-600" style={{ width: `${Math.round((done / total) * 100)}%` }} /></div>}
        {complete && (
          <div className="space-y-2" data-complete>
            <p className="text-sm font-medium text-life-700 dark:text-life-200">This room is done: every thing has a photo and a value.</p>
            {next
              ? <Link to={`/things/places/${next.id}/walk`} className={`${buttonClass} inline-flex min-h-11 items-center`}>Next: {next.name} ({next.incomplete} to go)</Link>
              : <p className="text-sm text-gray-700 dark:text-life-100">Every room is done. <Link to="/things/report" className="underline">See the home inventory</Link></p>}
          </div>
        )}
        <Link to={`/things/places/${placeId}/fill`} className={`${quietButtonClass} inline-flex min-h-11 items-center`}>📷 Add something else in this room</Link>
      </section>

      {total > 0 && (
        <ul className="space-y-3" aria-label="Things to check">
          {things.map((t) => <Thing key={t.id} thing={t} place={place} onChange={replace} />)}
        </ul>
      )}
    </div>
  );
}

/** One thing: what it lacks, and the three ways to put that right. */
function Thing({ thing, place, onChange }) {
  const [worth, setWorth] = useState(dollars(thing.records.value_cents));
  const [serial, setSerial] = useState(thing.records.serial ?? '');
  const [note, setNote] = useState({ text: '', bad: false });
  const [version, setVersion] = useState(0);
  const [busy, setBusy] = useState(false);
  const picker = useRef(null);
  const latest = useRef(thing);
  latest.current = thing;

  const kept = (made, text) => { latest.current = made; onChange(made); setNote({ text, bad: false }); };
  const failed = (err, what) => setNote({ text: `${what} didn't save. ${errorMessage(err, 'Try again in a moment.')}`, bad: true });

  /** Keep one of its records, with everything else about it as it is. */
  const keepRecord = async (records, text) => {
    const t = latest.current;
    const { data } = await axios.put(`/api/things/items/${t.id}`, { name: t.name, quantity: t.quantity, unit: t.unit, place_id: t.place_id, low_at: t.low_at, note: t.note, values: t.values, records });
    kept(data, text);
  };
  const saveWorth = async () => {
    const cents = centsOf(worth);
    if (Number.isNaN(cents)) { setNote({ text: 'An amount is a number, like 79.99.', bad: true }); return; }
    if (cents === latest.current.records.value_cents) return;
    try { await keepRecord({ value_cents: cents }, 'Worth saved.'); setWorth(dollars(cents)); } catch (err) { failed(err, 'The worth'); }
  };
  const saveSerial = async () => {
    const text = serial.trim() || null;
    if (text === latest.current.records.serial) return;
    try { await keepRecord({ serial: text }, 'Serial number saved.'); setSerial(text ?? ''); } catch (err) { failed(err, 'The serial number'); }
  };
  const photo = async (file) => {
    if (!file) return;
    setBusy(true); setNote({ text: '', bad: false });
    try {
      const { data } = await axios.put(`/api/things/items/${thing.id}/photo`, { data: await shrink(file) });
      setVersion((v) => v + 1);
      kept(data, 'Photo saved.');
    } catch (err) { failed(err, 'The photo'); }
    setBusy(false);
    if (picker.current) picker.current.value = '';
  };

  const missing = [!thing.photo && 'No photo', !hasValue(thing) && 'No value', !thing.records.serial && 'No serial number'].filter(Boolean);
  const where = thing.place && thing.place !== place.path ? thing.place.slice(place.path.length + 3) : null;
  const enter = (e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } };

  return (
    <li className={`${cardClass} space-y-2`} data-thing={thing.name} data-done={isDone(thing)}>
      <div className="flex items-start gap-3">
        {thing.photo && <Picture key={version} src={`/api/things/items/${thing.id}/photo?v=${version}`} alt={`Photo of ${thing.name}`} className="h-14 w-14 shrink-0 rounded-lg object-cover" />}
        <div className="min-w-0 flex-1">
          <p className="break-words font-medium text-gray-800 dark:text-life-50"><Link to={`/things/${thing.id}`} className="hover:underline">{thing.name}</Link></p>
          {where && <p className="text-xs text-gray-500 dark:text-life-300">{where}</p>}
          <p className={`text-xs ${missing.length ? 'text-honey-700' : 'text-life-700 dark:text-life-200'}`} data-missing>{missing.length ? missing.join(' · ') : 'Nothing missing'}</p>
        </div>
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        <div>
          <input ref={picker} type="file" accept="image/*" capture="environment" className="hidden" aria-label={`Photo file for ${thing.name}`} onChange={(e) => photo(e.target.files?.[0])} />
          <button type="button" disabled={busy} onClick={() => picker.current?.click()} aria-label={`${thing.photo ? 'Take a new photo of' : 'Take or choose a photo of'} ${thing.name}`} className={`${quietButtonClass} min-h-11 w-full`}>
            {busy ? 'Keeping it…' : thing.photo ? '📷 New photo' : '📷 Take a photo'}
          </button>
        </div>
        <label className="block text-xs font-medium text-gray-600 dark:text-life-200">Worth now ($)
          <input inputMode="decimal" value={worth} onChange={(e) => setWorth(e.target.value)} onBlur={saveWorth} onKeyDown={enter} aria-label={`What ${thing.name} is worth now, in dollars`}
            placeholder={thing.records.price_cents !== null ? `cost ${dollars(thing.records.price_cents)}` : '0.00'} className={FIELD} />
        </label>
        <label className="block text-xs font-medium text-gray-600 dark:text-life-200">Serial number
          <input value={serial} onChange={(e) => setSerial(e.target.value)} onBlur={saveSerial} onKeyDown={enter} aria-label={`The serial number of ${thing.name}`}
            autoCapitalize="characters" autoCorrect="off" spellCheck="false" className={`${FIELD} font-mono`} />
        </label>
      </div>
      {note.text && <p className={`text-sm ${note.bad ? 'text-red-600' : 'text-life-700 dark:text-life-200'}`} role={note.bad ? 'alert' : 'status'}>{note.text}</p>}
    </li>
  );
}
