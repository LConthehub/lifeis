import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import PlacePicker from '../components/PlacePicker';
import Modal, { Field, inputClass, buttonClass, quietButtonClass, cardClass, errorMessage } from '../components/ui';

const STATES = [['packing', 'Being packed', '📦'], ['packed', 'Packed', '✅'], ['moved', 'Moved', '🚚'], ['unpacked', 'Unpacked', '🏠']];
const stateOf = (id) => STATES.find(([s]) => s === id);
const TONES = { packing: 'bg-honey-100 text-honey-700', packed: 'bg-life-100 text-life-700', moved: 'bg-life-100 text-life-700', unpacked: 'bg-gray-100 text-gray-600' };

/**
 * Moving house, or packing things away: numbered boxes made in one go, each filled by scanning, each saying
 * which room it's going to and how far along it is, and unpacked into its new home in one step.
 */
export default function PackingPage() {
  const [packing, setPacking] = useState(null);
  const [places, setPlaces] = useState([]);
  const [form, setForm] = useState({ count: '10', destination: '' });
  const [unpacking, setUnpacking] = useState(null);
  const [open, setOpen] = useState(null);
  const [said, setSaid] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    axios.get('/api/things/packing').then(({ data }) => setPacking(data)).catch(() => setPacking(false));
    axios.get('/api/things/places').then(({ data }) => setPlaces(data)).catch(() => {});
  }, []);
  if (packing === null) return null;
  if (packing === false) return <p className="text-sm text-gray-600 dark:text-life-200">Packing couldn't be opened just now.</p>;

  const make = async (e) => {
    e.preventDefault();
    setError('');
    try { setPacking((await axios.post('/api/things/packing/boxes', { count: Number(form.count), destination: form.destination || null })).data); setSaid(''); } catch (err) { setError(errorMessage(err, "Couldn't make them")); }
  };
  const set = async (box, state) => { setPacking((await axios.put(`/api/things/packing/boxes/${box.id}`, { state })).data); };
  const rooms = [...new Set(packing.boxes.map((b) => b.destination || ''))].sort((a, b) => (a === '') - (b === '') || a.localeCompare(b));
  const total = packing.boxes.length;
  const next = (state) => STATES[Math.min(STATES.findIndex(([s]) => s === state) + 1, 2)]; // packing → packed → moved; unpacking is its own step

  return (
    <div className="space-y-4">
      <Link to="/things/places" className="text-sm text-life-600 hover:underline dark:text-life-200">← Places</Link>
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-xl font-semibold text-life-800 dark:text-life-50">Packing</h1>
        {total > 0 && <Link to={`/things/places/stickers?boxes=1`} className={quietButtonClass}>Print the boxes' stickers</Link>}
      </div>
      <p className="text-sm text-gray-600 dark:text-life-100">
        For moving house or packing things away. Make numbered boxes, stick each one's sticker on it, and scan things in as you pack.
        After that, search tells you which box anything is in, and a box unpacks into its new home in one step.
      </p>

      <form onSubmit={make} className={`${cardClass} flex flex-wrap items-end gap-3`} aria-label="Make boxes">
        <label className="block space-y-1 text-xs font-medium text-gray-600 dark:text-life-200">How many boxes
          <input type="number" required min="1" max="100" step="1" value={form.count} onChange={(e) => setForm({ ...form, count: e.target.value })} className={`${inputClass} !w-24`} />
        </label>
        <label className="block min-w-0 flex-1 space-y-1 text-xs font-medium text-gray-600 dark:text-life-200">Going to (a room)
          <input list="box-rooms" value={form.destination} onChange={(e) => setForm({ ...form, destination: e.target.value })} placeholder="Kitchen, Main bedroom, Storage" className={inputClass} />
          <datalist id="box-rooms">{rooms.filter(Boolean).map((r) => <option key={r} value={r} />)}</datalist>
        </label>
        <button type="submit" className={buttonClass}>Make them</button>
        {error && <p className="w-full text-sm text-red-600" role="alert">{error}</p>}
      </form>

      {total > 0 && (
        <p className="text-sm text-gray-700 dark:text-life-100" data-progress>
          {total} box{total === 1 ? '' : 'es'}, {packing.things} thing{packing.things === 1 ? '' : 's'} in them: {STATES.filter(([s]) => packing.counts[s]).map(([s, label]) => `${packing.counts[s]} ${label.toLowerCase()}`).join(', ')}.
        </p>
      )}
      {said && <p className="text-sm text-life-700 dark:text-life-100" role="status">{said}</p>}

      {rooms.map((room) => (
        <section key={room || 'none'} className={cardClass} aria-label={room ? `Boxes for ${room}` : 'Boxes going nowhere yet'}>
          <h2 className="mb-1 font-semibold text-life-800 dark:text-life-50">{room ? `For ${room}` : 'Not going anywhere yet'}</h2>
          <ul className="divide-y divide-life-50 dark:divide-life-700">
            {packing.boxes.filter((b) => (b.destination || '') === room).map((b) => (
              <li key={b.id} className="py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <button type="button" onClick={() => setOpen(open === b.id ? null : b.id)} aria-expanded={open === b.id} className="min-w-0 flex-1 text-left">
                    <span className="block text-sm font-medium text-gray-800 dark:text-life-50">{b.name}</span>
                    <span className="block text-xs text-gray-500 dark:text-life-300">{b.contents.length ? `${b.contents.length} thing${b.contents.length === 1 ? '' : 's'}: ${b.contents.slice(0, 3).map((c) => c.name).join(', ')}${b.contents.length > 3 ? '…' : ''}` : 'empty'}</span>
                  </button>
                  <span className={`rounded px-1.5 py-0.5 text-[11px] ${TONES[b.state]}`} data-box-state={b.state}>{stateOf(b.state)[2]} {stateOf(b.state)[1]}</span>
                </div>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {b.state === 'packing' && <Link to={`/things/places/${b.id}/fill`} className={quietButtonClass}>📷 Pack it</Link>}
                  {b.state !== 'unpacked' && b.state !== 'moved' && <button type="button" onClick={() => set(b, next(b.state)[0])} className={quietButtonClass}>Mark {next(b.state)[1].toLowerCase()}</button>}
                  {b.state !== 'unpacked' && b.state !== 'packing' && <button type="button" onClick={() => setUnpacking(b)} className={quietButtonClass}>Unpack it…</button>}
                  {b.state !== 'packing' && <button type="button" onClick={() => set(b, 'packing')} className="px-1 text-xs text-gray-500 hover:underline dark:text-life-300">open it again</button>}
                </div>
                {open === b.id && (
                  <ul className="mt-2 space-y-0.5 rounded-lg bg-life-50 p-2 text-sm dark:bg-life-700" aria-label={`In ${b.name}`}>
                    {b.contents.length === 0 && <li className="text-gray-500 dark:text-life-300">Nothing in it yet.</li>}
                    {b.contents.map((c) => <li key={`${c.kind}${c.id}`}><Link to={c.kind === 'thing' ? `/things/${c.id}` : `/media/${c.id}`} className="text-gray-800 hover:underline dark:text-life-50">{c.name}</Link></li>)}
                    <li className="pt-1 text-xs"><Link to={`/things/places/${b.id}`} className="text-life-600 underline dark:text-life-200">Open the box's page</Link></li>
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}

      {unpacking && (
        <Modal title={`Unpack ${unpacking.name}`} onClose={() => setUnpacking(null)}>
          <UnpackForm box={unpacking} places={places.filter((p) => p.id !== unpacking.id)} onPlaces={setPlaces}
            onDone={(data) => { setPacking(data); setSaid(`${unpacking.name} is unpacked: ${data.moved} thing${data.moved === 1 ? '' : 's'} put away.`); setUnpacking(null); }} />
        </Modal>
      )}
    </div>
  );
}

function UnpackForm({ box, places, onPlaces, onDone }) {
  const [to, setTo] = useState('');
  const [error, setError] = useState('');
  const submit = async (e) => {
    e.preventDefault();
    if (to === '') { setError('Choose where its things go'); return; }
    try { onDone((await axios.post(`/api/things/packing/boxes/${box.id}/unpack`, { place_id: Number(to) })).data); } catch (err) { setError(errorMessage(err, "Couldn't unpack it")); }
  };
  return (
    <form onSubmit={submit} className="space-y-3">
      <p className="text-sm text-gray-600 dark:text-life-100">
        {box.contents.length ? `Its ${box.contents.length} thing${box.contents.length === 1 ? '' : 's'} all go to one place${box.destination ? ` (it was packed for ${box.destination})` : ''}. Each remembers it came out of ${box.name}.`
          : 'It is empty, so this only marks it unpacked.'} Anything that belongs elsewhere can be moved from its own page after.
      </p>
      <Field label="Where its things go"><PlacePicker value={to} places={places} onPlaces={onPlaces} onChange={setTo} /></Field>
      {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
      <div className="flex justify-end"><button type="submit" className={buttonClass}>Unpack it</button></div>
    </form>
  );
}
