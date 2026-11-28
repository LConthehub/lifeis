import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import axios from 'axios';
import Modal, { Field, buttonClass, cardClass, errorMessage, fromDateInput, inputClass, quietButtonClass, toDateInput } from '../components/ui';
import PlacePicker from '../components/PlacePicker';
import Picture from '../components/Picture';
import { shrink } from '../components/shrink';
import { WaterRow, dayWords, waterWords } from '../components/GardenBits';

const touch = 'min-h-[44px]';
const Oops = ({ children }) => (children ? <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{children}</p> : null);
const Quiet = ({ children }) => <p className="text-sm text-gray-500 dark:text-life-300">{children}</p>;
const Heading = ({ children, aside }) => (
  <div className="mb-2 flex items-baseline gap-2">
    <h2 className="flex-1 font-semibold text-life-800 dark:text-life-50">{children}</h2>
    {aside}
  </div>
);
const totalsText = (totals) => (totals.length === 0 ? 'nothing yet' : totals.map((t) => `${t.amount}${t.unit ? ` ${t.unit}` : ''}`).join(', '));
/** A frost date kept as month and day, as a day this year for a date box, and back. */
const asDate = (md, year) => (md ? `${year}-${md}` : '');
const monthDay = (md) => (md ? fromDateInput(`2024-${md}`).toLocaleDateString(undefined, { month: 'long', day: 'numeric' }) : 'not set');
const photoAddress = (photo) => `/api/garden/photos/${photo.id ?? photo}`;

/** Load what the garden page needs, and the places and people a plant can be given to. */
function useGarden() {
  const [garden, setGarden] = useState(null);
  const [places, setPlaces] = useState([]);
  const [people, setPeople] = useState([]);
  const load = useCallback(() => axios.get('/api/garden').then(({ data }) => setGarden(data)).catch(() => setGarden(false)), []);
  useEffect(() => {
    load();
    axios.get('/api/things/places').then(({ data }) => setPlaces(data)).catch(() => {});
    axios.get('/api/things/upkeep/members').then(({ data }) => setPeople(data)).catch(() => {});
  }, [load]);
  return { garden, load, places, setPlaces, people };
}

/** The garden: frost dates, what needs water, every plant by kind, seed packets and the year's harvest. */
export default function Garden() {
  const { garden, load, places, setPlaces, people } = useGarden();
  const [adding, setAdding] = useState(false);
  if (garden === null) return null;
  if (garden === false) return <Quiet>The garden didn't load. Try again in a moment.</Quiet>;
  const due = garden.plants.filter((p) => p.water?.due);
  const rained = garden.plants.filter((p) => p.water?.skipped_for_rain);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-2xl font-semibold text-life-800 dark:text-life-50">Garden</h1>
        <button type="button" onClick={() => setAdding(true)} className={`${buttonClass} ${touch}`}>Add a plant</button>
      </div>

      <FrostBox garden={garden} onChanged={load} />

      <section className={cardClass} aria-label="Watering">
        <Heading>Watering</Heading>
        {due.length === 0 && rained.length === 0 && <Quiet>{garden.plants.some((p) => p.water) ? 'Nothing needs water today.' : 'Give a plant a number of days between waterings and it shows here when it is due.'}</Quiet>}
        <ul className="space-y-3">
          {due.map((p) => <WaterRow key={p.id} plant={p} onWatered={load}><Link to={`/garden/${p.id}`} className="font-medium text-gray-800 hover:underline dark:text-life-50">{p.name}</Link></WaterRow>)}
        </ul>
        {rained.length > 0 && (
          <ul className="mt-3 space-y-1 text-sm text-gray-700 dark:text-life-100" aria-label="Watered by rain">
            {rained.map((p) => <li key={p.id}><Link to={`/garden/${p.id}`} className="hover:underline">{p.name}</Link><span className="block text-xs text-gray-600 dark:text-life-200">{p.water.rain.says}. Next watering {dayWords(p.water.due_on)}.</span></li>)}
          </ul>
        )}
      </section>

      {garden.kinds.map((k) => {
        const here = garden.plants.filter((p) => p.kind === k.key);
        return (
          <section key={k.key} className={cardClass} aria-label={k.name}>
            <Heading>{k.name}</Heading>
            {here.length === 0 ? <Quiet>{k.about}</Quiet> : (
              <ul className="divide-y divide-life-100 dark:divide-life-700">
                {here.map((p) => (
                  <li key={p.id}>
                    <Link to={`/garden/${p.id}`} className="flex min-h-[44px] items-center gap-2 py-1.5 hover:underline">
                      <span className="min-w-0 flex-1">
                        <span className="block text-gray-800 dark:text-life-50">{p.name}</span>
                        <span className="block text-xs text-gray-600 dark:text-life-200">{p.place ?? 'No place yet'} · {waterWords(p.water)}</span>
                      </span>
                      {p.cover_photo && <Picture src={photoAddress(p.cover_photo)} alt="" loading="lazy" className="h-10 w-10 flex-none rounded-lg object-cover" />}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}

      <Seeds garden={garden} places={places} setPlaces={setPlaces} onChanged={load} />

      <section className={cardClass} aria-label="This year's harvest">
        <Heading>{garden.harvests.year} harvest</Heading>
        {garden.harvests.plants.length === 0 ? <Quiet>Log a harvest on a plant and the season's totals show here.</Quiet> : (
          <>
            <p className="text-sm text-gray-800 dark:text-life-50">Altogether: {totalsText(garden.harvests.totals)}</p>
            <ul className="mt-1 text-sm text-gray-700 dark:text-life-100">
              {garden.harvests.plants.map((p) => <li key={p.id}><Link to={`/garden/${p.id}`} className="hover:underline">{p.name}</Link>: {totalsText(p.totals)}</li>)}
            </ul>
          </>
        )}
      </section>

      {adding && <Modal title="Add a plant" onClose={() => setAdding(false)}><PlantForm garden={garden} places={places} setPlaces={setPlaces} people={people} onDone={() => { setAdding(false); load(); }} /></Modal>}
    </div>
  );
}

/** The usual last spring frost and first fall frost: worked out from the town's last ten years, or typed. */
function FrostBox({ garden, onChanged }) {
  const year = new Date().getFullYear();
  const { frost, weather } = garden;
  const [spring, setSpring] = useState(asDate(frost.last_spring, year));
  const [fall, setFall] = useState(asDate(frost.first_fall, year));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [said, setSaid] = useState('');
  useEffect(() => { setSpring(asDate(frost.last_spring, year)); setFall(asDate(frost.first_fall, year)); }, [frost.last_spring, frost.first_fall, year]);
  const run = async (work, words) => {
    setBusy(true); setError(''); setSaid('');
    try { await work(); setSaid(words); onChanged(); } catch (err) { setError(errorMessage(err, "Couldn't do that")); }
    setBusy(false);
  };
  return (
    <section className={cardClass} aria-label="Frost dates">
      <Heading>Frost dates</Heading>
      <p className="text-sm text-gray-700 dark:text-life-100">
        Planting times are weeks before or after your last spring frost and first fall frost.
        {frost.how === 'weather' && ` These were worked out from your town's last ten years${frost.worked_out_on ? ` on ${dayWords(frost.worked_out_on)}` : ''}.`}
        {frost.how === 'typed' && ' You typed these.'}
      </p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Field label={`Last spring frost (${monthDay(frost.last_spring)})`}><input type="date" value={spring} onChange={(e) => setSpring(e.target.value)} aria-label="Last spring frost" className={`${inputClass} ${touch}`} /></Field>
        <Field label={`First fall frost (${monthDay(frost.first_fall)})`}><input type="date" value={fall} onChange={(e) => setFall(e.target.value)} aria-label="First fall frost" className={`${inputClass} ${touch}`} /></Field>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" disabled={busy} onClick={() => run(() => axios.put('/api/garden/frost', { last_spring: spring || null, first_fall: fall || null }), 'Saved.')} className={`${buttonClass} ${touch}`}>Save these dates</button>
        {weather.on && <button type="button" disabled={busy} onClick={() => run(() => axios.post('/api/garden/frost/work-out'), 'Worked out from your town.')} className={`${quietButtonClass} ${touch}`}>Work them out from the weather</button>}
      </div>
      {weather.on
        ? <p className="mt-2 text-xs text-gray-500 dark:text-life-300">Working them out asks {weather.service.name} for the lowest temperature of each day of the last ten years at {weather.place}. {weather.service.sends}</p>
        : <p className="mt-2 text-xs text-gray-500 dark:text-life-300">Turn on the weather in Settings and Life Is can work these out from your town's last ten years. Until then, type them. Nothing is sent anywhere.</p>}
      {said && <p className="mt-2 text-sm text-life-700 dark:text-life-100" role="status">{said}</p>}
      <div className="mt-2"><Oops>{error}</Oops></div>
    </section>
  );
}

/** Seed packets are things too, kept in a place. */
function Seeds({ garden, places, setPlaces, onChanged }) {
  const [name, setName] = useState('');
  const [place, setPlace] = useState(null);
  const [error, setError] = useState('');
  const add = async (e) => {
    e.preventDefault();
    setError('');
    try { await axios.post('/api/garden/seeds', { name, place_id: place, quantity: 1 }); setName(''); onChanged(); } catch (err) { setError(errorMessage(err, "Couldn't add that")); }
  };
  return (
    <section className={cardClass} aria-label="Seed packets">
      <Heading>Seed packets</Heading>
      {garden.seeds.length === 0 ? <Quiet>Keep your seed packets here, in the drawer or box they live in, and the garden card tells you when each can go in.</Quiet> : (
        <ul className="divide-y divide-life-100 text-sm dark:divide-life-700">
          {garden.seeds.map((s) => <li key={s.id} className="py-1.5"><Link to={`/things/${s.id}`} className="text-gray-800 hover:underline dark:text-life-50">{s.name}</Link><span className="block text-xs text-gray-600 dark:text-life-200">{s.place ?? 'No place yet'}{s.crop ? ` · ${s.crop}` : ''}</span></li>)}
        </ul>
      )}
      <form onSubmit={add} className="mt-3 space-y-2">
        <Field label="Add a seed packet"><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Okra seeds" className={`${inputClass} ${touch}`} /></Field>
        <Field label="Where it is kept"><PlacePicker value={place} places={places} onChange={setPlace} onPlaces={setPlaces} /></Field>
        <Oops>{error}</Oops>
        <button type="submit" disabled={!name.trim()} className={`${quietButtonClass} ${touch}`}>Add seed packet</button>
      </form>
    </section>
  );
}

/** Adding a plant, or changing one. Watering can be given to a child, who earns points for it as for any chore. */
function PlantForm({ garden, places, setPlaces, people, plant, onDone }) {
  const [name, setName] = useState(plant?.name ?? '');
  const [crop, setCrop] = useState(plant?.crop ?? '');
  const [kind, setKind] = useState(plant?.kind ?? 'veg');
  const [place, setPlace] = useState(plant?.place_id ?? null);
  const [outdoor, setOutdoor] = useState(plant ? plant.outdoor : true);
  const [planted, setPlanted] = useState(plant?.planted_on ?? '');
  const [every, setEvery] = useState(plant ? (plant.water_every ?? '') : '3');
  const [member, setMember] = useState(plant?.member ? String(plant.member.id) : '');
  const [points, setPoints] = useState(plant?.points ?? '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const pickCrop = (key) => {
    setCrop(key);
    const found = garden.crops.find((c) => c.key === key);
    if (!found) return;
    setKind(found.kind);
    setOutdoor(found.kind !== 'house');
    if (!plant) setEvery(String(found.water));
    if (!name.trim()) setName(found.name);
  };
  const save = async (e) => {
    e.preventDefault();
    setBusy(true); setError('');
    const body = {
      name, kind, crop: crop || null, place_id: place, outdoor, planted_on: planted || null,
      water_every: every === '' ? null : Number(every), assigned_member: member ? Number(member) : null, points: member && points !== '' ? Number(points) : null,
    };
    try {
      const { data } = plant ? await axios.put(`/api/garden/plants/${plant.id}`, body) : await axios.post('/api/garden/plants', body);
      onDone(data);
    } catch (err) { setError(errorMessage(err, "Couldn't save that")); setBusy(false); }
  };
  return (
    <form onSubmit={save} className="space-y-3">
      <Field label="What is it?">
        <select value={crop} onChange={(e) => pickCrop(e.target.value)} className={`${inputClass} ${touch}`} aria-label="What is it?">
          <option value="">Another plant, or let Life Is guess from the name</option>
          {garden.kinds.map((k) => <optgroup key={k.key} label={k.name}>{garden.crops.filter((c) => c.kind === k.key).map((c) => <option key={c.key} value={c.key}>{c.name}</option>)}</optgroup>)}
        </select>
      </Field>
      <Field label="Its name"><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Tomatoes, back bed" className={`${inputClass} ${touch}`} aria-label="Its name" /></Field>
      <Field label="Kind of plant">
        <select value={kind} onChange={(e) => setKind(e.target.value)} className={`${inputClass} ${touch}`} aria-label="Kind of plant">{garden.kinds.map((k) => <option key={k.key} value={k.key}>{k.name}</option>)}</select>
      </Field>
      <Field label="Where it is (a bed, a pot, the side yard)"><PlacePicker value={place} places={places} onChange={setPlace} onPlaces={setPlaces} /></Field>
      <label className={`flex ${touch} items-center gap-2 text-sm text-gray-800 dark:text-life-50`}><input type="checkbox" checked={outdoor} onChange={(e) => setOutdoor(e.target.checked)} className="h-5 w-5 accent-life-600" /> It lives outdoors (rain counts as watering)</label>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Planted on"><input type="date" value={planted} onChange={(e) => setPlanted(e.target.value)} className={`${inputClass} ${touch}`} aria-label="Planted on" /></Field>
        <Field label="Water every (days)"><input type="number" min="1" max="365" inputMode="numeric" value={every} onChange={(e) => setEvery(e.target.value)} placeholder="Not by hand" className={`${inputClass} ${touch}`} aria-label="Water every (days)" /></Field>
      </div>
      {every !== '' && people.length > 0 && (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Give the watering to">
            <select value={member} onChange={(e) => setMember(e.target.value)} className={`${inputClass} ${touch}`} aria-label="Give the watering to"><option value="">Anyone</option>{people.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select>
          </Field>
          {member && <Field label="Points for each time"><input type="number" min="0" max="1000" inputMode="numeric" value={points} onChange={(e) => setPoints(e.target.value)} className={`${inputClass} ${touch}`} aria-label="Points for each time" /></Field>}
        </div>
      )}
      <Oops>{error}</Oops>
      <div className="flex justify-end"><button type="submit" disabled={busy || !name.trim()} className={`${buttonClass} ${touch}`}>{plant ? 'Save' : 'Add the plant'}</button></div>
    </form>
  );
}

/** One plant: where it is, watering, how it did last time, the harvest log with season totals, and its photos. */
export function PlantPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { garden, load: loadGarden, places, setPlaces, people } = useGarden();
  const [plant, setPlant] = useState(null);
  const [editing, setEditing] = useState(false);
  const [lastTime, setLastTime] = useState(null);
  const reload = useCallback(() => axios.get(`/api/garden/plants/${id}`).then(({ data }) => setPlant(data)).catch(() => setPlant(false)), [id]);
  useEffect(() => { reload(); }, [reload]);
  if (plant === null || garden === null) return null;
  if (!plant || !garden) return <Quiet>That plant isn't here anymore. <Link to="/garden" className="underline">Back to the garden</Link></Quiet>;
  const today = toDateInput(new Date());
  const plantedAgain = async () => {
    const { data } = await axios.post(`/api/garden/plants/${id}/planted`, { day: today });
    setPlant(data.plant);
    setLastTime(data.last_time);
  };
  const remove = async () => {
    if (!window.confirm(`Remove ${plant.name}, with its watering, harvests and photos?`)) return;
    await axios.delete(`/api/garden/plants/${id}`);
    navigate('/garden');
  };
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Link to="/garden" className="text-sm text-life-600 hover:underline dark:text-life-200">← Garden</Link>
        <h1 className="mr-auto basis-full text-2xl font-semibold text-life-800 dark:text-life-50">{plant.name}</h1>
      </div>
      <section className={cardClass} aria-label="About this plant">
        <p className="text-sm text-gray-800 dark:text-life-50">{plant.kind_name}{plant.crop_name ? ` · ${plant.crop_name}` : ''} · {plant.outdoor ? 'outdoors' : 'indoors'}</p>
        <p className="text-sm text-gray-700 dark:text-life-100">{plant.place ? <>In <strong>{plant.place}</strong></> : 'No place yet'}{plant.planted_on ? ` · planted ${dayWords(plant.planted_on)}` : ''}</p>
        {plant.water ? (
          <ul className="mt-3"><WaterRow plant={plant} onWatered={(p) => { setPlant(p); }} /></ul>
        ) : <p className="mt-2 text-sm text-gray-600 dark:text-life-200">Not watered by hand.</p>}
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" onClick={plantedAgain} className={`${quietButtonClass} ${touch}`}>Planted today</button>
          <button type="button" onClick={() => setEditing(true)} className={`${quietButtonClass} ${touch}`}>Change</button>
          <button type="button" onClick={remove} className={`${quietButtonClass} ${touch} text-red-700`}>Remove</button>
        </div>
        {lastTime && <p className="mt-3 rounded-lg bg-honey-100 px-3 py-2 text-sm text-honey-700" role="status" data-last-time>Last time: {lastTime}</p>}
        {plant.water?.rain && <Quiet>Rain counts as watering for plants outdoors: half an inch or more.</Quiet>}
      </section>

      <HowItDid plant={plant} onChanged={setPlant} />
      <Harvests plant={plant} onChanged={setPlant} />
      <Photos plant={plant} library={garden.photos} onChanged={setPlant} />
      {editing && <Modal title={`Change ${plant.name}`} onClose={() => setEditing(false)}><PlantForm garden={garden} places={places} setPlaces={setPlaces} people={people} plant={plant} onDone={(p) => { setEditing(false); setPlant(p); loadGarden(); }} /></Modal>}
    </div>
  );
}

/** What was written at the end of the season: it is shown again the next time the plant goes in. */
function HowItDid({ plant, onChanged }) {
  const [text, setText] = useState(plant.how_it_did ?? '');
  const [saved, setSaved] = useState('');
  const save = async () => { onChanged((await axios.put(`/api/garden/plants/${plant.id}/how-it-did`, { text: text || null })).data); setSaved('Saved. It is shown the next time you plant this.'); };
  return (
    <section className={cardClass} aria-label="How it did">
      <Heading>How it did</Heading>
      <Field label="Write down how it did: what worked, what to change"><textarea value={text} onChange={(e) => { setText(e.target.value); setSaved(''); }} rows={3} className={inputClass} aria-label="How it did" /></Field>
      <div className="mt-2 flex items-center justify-end gap-3">
        {saved && <span className="text-sm text-life-700 dark:text-life-100" role="status">{saved}</span>}
        <button type="button" onClick={save} className={`${quietButtonClass} ${touch}`}>Save the note</button>
      </div>
    </section>
  );
}

/** The harvest log, with each season's totals. Logging one offers to put it in the pantry. */
function Harvests({ plant, onChanged }) {
  const [amount, setAmount] = useState('');
  const [unit, setUnit] = useState('lb');
  const [note, setNote] = useState('');
  const [pantry, setPantry] = useState(false);
  const [said, setSaid] = useState('');
  const [error, setError] = useState('');
  const log = async (e) => {
    e.preventDefault();
    setError(''); setSaid('');
    try {
      const { data } = await axios.post(`/api/garden/plants/${plant.id}/harvests`, { amount: amount === '' ? null : Number(amount), unit: unit || null, note: note || null, pantry });
      onChanged(data.plant);
      setSaid(data.pantry ?? 'Logged.');
      setAmount(''); setNote('');
    } catch (err) { setError(errorMessage(err, "Couldn't log that")); }
  };
  const remove = async (harvest) => onChanged((await axios.delete(`/api/garden/harvests/${harvest.id}`)).data);
  return (
    <section className={cardClass} aria-label="Harvests">
      <Heading>Harvests</Heading>
      {plant.seasons.length > 0 && (
        <ul className="mb-3 text-sm text-gray-800 dark:text-life-50" aria-label="Season totals">
          {plant.seasons.map((s) => <li key={s.year}><strong>{s.year}</strong>: {s.totals.map((t) => `${t.amount}${t.unit ? ` ${t.unit}` : ''} (${t.times} ${t.times === 1 ? 'time' : 'times'})`).join(', ')}</li>)}
        </ul>
      )}
      <form onSubmit={log} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="How much"><input type="number" min="0" step="any" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className={`${inputClass} ${touch}`} aria-label="How much" /></Field>
          <Field label="Unit"><input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="lb, pods, bunches" className={`${inputClass} ${touch}`} aria-label="Unit" /></Field>
        </div>
        <Field label="Note (optional)"><input value={note} onChange={(e) => setNote(e.target.value)} className={`${inputClass} ${touch}`} aria-label="Harvest note" /></Field>
        <label className={`flex ${touch} items-center gap-2 text-sm text-gray-800 dark:text-life-50`}><input type="checkbox" checked={pantry} onChange={(e) => setPantry(e.target.checked)} className="h-5 w-5 accent-life-600" /> Put it in the pantry</label>
        <Oops>{error}</Oops>
        {said && <p className="text-sm text-life-700 dark:text-life-100" role="status">{said}</p>}
        <button type="submit" className={`${buttonClass} ${touch}`}>Log the harvest</button>
      </form>
      {plant.harvests.length > 0 && (
        <ul className="mt-3 divide-y divide-life-100 text-sm dark:divide-life-700">
          {plant.harvests.map((h) => (
            <li key={h.id} className="flex min-h-[44px] items-center gap-2">
              <span className="min-w-0 flex-1 text-gray-800 dark:text-life-50">{dayWords(h.day)}: {h.amount ?? 'some'}{h.unit ? ` ${h.unit}` : ''}{h.note ? <span className="block text-xs text-gray-600 dark:text-life-200">{h.note}</span> : null}</span>
              <button type="button" onClick={() => remove(h)} aria-label={`Remove the harvest of ${h.day}`} className="min-h-[44px] px-2 text-xs text-red-700 hover:underline">Remove</button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** The person's own photos of the plant, kept here or linked from Immich (which stay there). */
function Photos({ plant, library, onChanged }) {
  const picker = useRef(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [choosing, setChoosing] = useState(false);
  const [open, setOpen] = useState(null);
  const [connected, setConnected] = useState(false);
  useEffect(() => { if (library) axios.get('/api/photos').then(({ data }) => setConnected(Boolean(data.connected))).catch(() => {}); }, [library]);
  const add = async (e) => {
    const files = [...e.target.files];
    e.target.value = '';
    setError('');
    let latest = null;
    for (const [n, file] of files.entries()) {
      setBusy(`Adding ${n + 1} of ${files.length}…`);
      try { latest = (await axios.post(`/api/garden/plants/${plant.id}/photos`, { data: await shrink(file) })).data; } catch (err) { setError(errorMessage(err, `${file.name} couldn't be added`)); }
    }
    setBusy('');
    if (latest) onChanged(latest);
  };
  return (
    <section className={cardClass} aria-label="Photos">
      <Heading aside={(
        <>
          <input ref={picker} type="file" accept="image/*" multiple onChange={add} className="hidden" aria-label="Choose photos" />
          {connected && <button type="button" onClick={() => setChoosing(true)} className={`${touch} px-2 text-sm text-life-600 hover:underline dark:text-life-200`}>+ From Immich</button>}
          <button type="button" disabled={Boolean(busy)} onClick={() => picker.current.click()} className={`${touch} px-2 text-sm text-life-600 hover:underline dark:text-life-200`}>{busy || '+ From this device'}</button>
        </>
      )}>Photos</Heading>
      <Oops>{error}</Oops>
      {plant.photos_list.length === 0 ? <Quiet>Your own photos of this plant, kept here. Nothing is added by Life Is.</Quiet> : (
        <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
          {plant.photos_list.map((p) => (
            <li key={p.id}><button type="button" onClick={() => setOpen(p)} className="block w-full overflow-hidden rounded-lg ring-1 ring-life-100 hover:ring-life-400 dark:ring-life-700"><Picture src={photoAddress(p)} alt={p.caption || `A photo of ${plant.name}`} loading="lazy" className="aspect-square w-full object-cover" /></button></li>
          ))}
        </ul>
      )}
      {choosing && <Modal title="Photos from Immich" wide onClose={() => setChoosing(false)}><LibraryPicker plant={plant} onDone={(p) => { setChoosing(false); if (p) onChanged(p); }} /></Modal>}
      {open && <Modal title={open.caption || plant.name} onClose={() => setOpen(null)}><PhotoView photo={open} onDone={(p) => { setOpen(null); onChanged(p); }} /></Modal>}
    </section>
  );
}

function PhotoView({ photo, onDone }) {
  const [caption, setCaption] = useState(photo.caption || '');
  return (
    <div className="space-y-3">
      <Picture src={photoAddress(photo)} alt={photo.caption || ''} className="max-h-[60vh] w-full rounded-lg object-contain" />
      <Field label="What it shows"><input value={caption} onChange={(e) => setCaption(e.target.value)} className={`${inputClass} ${touch}`} /></Field>
      <div className="flex items-center justify-between">
        <button type="button" onClick={async () => onDone((await axios.delete(`/api/garden/photos/${photo.id}`)).data)} className={`${touch} text-sm text-red-600 hover:underline`}>{photo.source === 'kept' ? 'Delete this photo' : 'Take it off (it stays in your library)'}</button>
        <button type="button" onClick={async () => onDone((await axios.put(`/api/garden/photos/${photo.id}`, { caption: caption || null })).data)} className={`${buttonClass} ${touch}`}>Save</button>
      </div>
    </div>
  );
}

/** The library's photos from a stretch of days. Check the ones that belong; they are linked, not copied. */
function LibraryPicker({ plant, onDone }) {
  const [from, setFrom] = useState(plant.planted_on ?? toDateInput(new Date(Date.now() - 60 * 86400000)));
  const [photos, setPhotos] = useState(null);
  const [chosen, setChosen] = useState([]);
  const [error, setError] = useState('');
  useEffect(() => {
    setPhotos(null);
    axios.get(`/api/garden/plants/${plant.id}/library`, { params: { from } }).then(({ data }) => setPhotos(data)).catch((err) => { setPhotos([]); setError(errorMessage(err, "Your library couldn't be read")); });
  }, [plant.id, from]);
  const toggle = (id) => setChosen((list) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]));
  const link = async () => {
    try { onDone((await axios.post(`/api/garden/plants/${plant.id}/photos/linked`, { ids: chosen })).data); } catch (err) { setError(errorMessage(err, "Couldn't link them")); }
  };
  return (
    <div className="space-y-3">
      <Field label="Photos taken since"><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={`${inputClass} ${touch}`} /></Field>
      <Oops>{error}</Oops>
      {!photos ? <Quiet>Asking your library…</Quiet> : photos.length === 0 ? <Quiet>Your library has no photos from those days.</Quiet> : (
        <>
          <p className="text-sm text-gray-600 dark:text-life-100">Check the ones that belong here. They stay in Immich; Life Is only remembers which they are.</p>
          <ul className="grid max-h-[50vh] grid-cols-3 gap-2 overflow-y-auto sm:grid-cols-4 md:grid-cols-5">
            {photos.map((p) => (
              <li key={p.id}>
                <label className={`relative block cursor-pointer overflow-hidden rounded-lg ring-2 ${chosen.includes(p.id) ? 'ring-life-500' : 'ring-transparent'} ${p.linked ? 'opacity-50' : ''}`}>
                  <Picture src={`/api/photos/thumb?id=${p.id}`} alt={`${p.name}, taken ${p.taken.replace('T', ' at ')}`} loading="lazy" className="aspect-square w-full object-cover" />
                  <input type="checkbox" disabled={p.linked} checked={p.linked || chosen.includes(p.id)} onChange={() => toggle(p.id)} className="absolute left-1.5 top-1.5 h-5 w-5 accent-life-600" />
                </label>
              </li>
            ))}
          </ul>
          <div className="flex justify-end"><button type="button" disabled={chosen.length === 0} onClick={link} className={`${buttonClass} ${touch}`}>Link {chosen.length || ''}</button></div>
        </>
      )}
    </div>
  );
}
