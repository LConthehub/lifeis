import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import axios from 'axios';
import SubChips, { THING_CHIPS } from '../components/SubChips';
import Picture from '../components/Picture';
import { shrink } from '../components/shrink';
import Modal, { Field, inputClass as baseInput, buttonClass as baseButton, quietButtonClass as baseQuiet, cardClass, errorMessage } from '../components/ui';
import { askedText } from './Upkeep';

// Every control is at least 44px tall, so a thumb finds it.
const inputClass = `${baseInput} min-h-[44px]`;
const buttonClass = `${baseButton} min-h-[44px]`;
const quietButtonClass = `${baseQuiet} min-h-[44px]`;

export const dayText = (day) => new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
export const dollars = (cents) => (cents / 100).toLocaleString(undefined, { style: 'currency', currency: 'USD' });
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const ordinal = (n) => { const ends = ['th', 'st', 'nd', 'rd']; const v = n % 100; return `${n}${ends[(v - 20) % 10] || ends[v] || ends[0]}`; };
export const photoAddress = (id) => `/api/things/renting/photos/${id}`;
const ROOM_IDEAS = ['Kitchen', 'Bathroom', 'Bedroom', 'Living room', 'Entry'];

/** How far off the end of the lease or a notice is, in plain words. */
function leftText(days) {
  if (days === null) return '';
  if (days < 0) return `${plural(-days, 'day')} ago`;
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  return days < 60 ? `in ${plural(days, 'day')}` : `in ${plural(Math.round(days / 30.44), 'month')}`;
}

/** The lease, the landlord's repairs, and the move-in and move-out record, kept for one person who rents. */
export default function RentingPage() {
  const [data, setData] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [modal, setModal] = useState(null);                    // 'lease' or 'repair'
  const load = useCallback(() => {
    axios.get('/api/things/renting').then((r) => setData(r.data)).catch(() => setData({ lease: {}, rooms: [] }));
    axios.get('/api/things/upkeep').then((r) => setJobs(r.data.filter((j) => j.landlord))).catch(() => setJobs([]));
  }, []);
  useEffect(() => { load(); }, [load]);
  if (!data) return null;
  const { lease, rooms } = data;
  const hasLease = Boolean(lease.start_day || lease.end_day || lease.rent_day || lease.deposit_cents != null || lease.landlord_name || lease.landlord_contact || lease.notice_day);

  return (
    <div className="space-y-4">
      <SubChips items={THING_CHIPS} label="Things" />
      <h1 className="text-xl font-semibold text-life-800 dark:text-life-50">Renting</h1>
      <p className="text-sm text-gray-600 dark:text-life-100">Your lease, repairs the landlord has to make, and a room by room record of how the place looked when you moved in and out. It is only for you. Life Is sends nothing to your landlord: you send any note yourself.</p>

      <section className={`${cardClass} space-y-2`} aria-label="The lease">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="mr-auto font-semibold text-life-800 dark:text-life-50">The lease</h2>
          <button type="button" onClick={() => setModal('lease')} className={quietButtonClass}>{hasLease ? 'Change the lease' : 'Add the lease'}</button>
        </div>
        {!hasLease ? <p className="text-sm text-gray-500 dark:text-life-300">Nothing yet. Add its first and last day, and Life Is reminds you before it ends.</p> : (
          <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
            {lease.start_day && <Row term="Starts" text={dayText(lease.start_day)} />}
            {lease.end_day && <Row term="Ends" text={`${dayText(lease.end_day)} (${leftText(lease.end_days)})`} />}
            {lease.rent_day && <Row term="Rent is due" text={`the ${ordinal(lease.rent_day)} of the month`} />}
            {lease.deposit_cents != null && <Row term="Deposit" text={dollars(lease.deposit_cents)} />}
            {lease.landlord_name && <Row term="Landlord" text={lease.landlord_name} />}
            {lease.landlord_contact && <Row term="How to reach them" text={lease.landlord_contact} />}
            {lease.notice_day && <Row term={lease.notice_label || 'Notice due'} text={`${dayText(lease.notice_day)} (${leftText(lease.notice_days)})`} />}
          </dl>
        )}
        <p className="text-xs text-gray-500 dark:text-life-300">Life Is reminds you in your morning reminder, before the lease ends and before a notice day. It is a reminder of what you typed here, not advice about your lease.</p>
      </section>

      <section className={`${cardClass} space-y-2`} aria-label="Repairs for the landlord">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="mr-auto font-semibold text-life-800 dark:text-life-50">Repairs for the landlord</h2>
          <button type="button" onClick={() => setModal('repair')} className={quietButtonClass}>Add a repair</button>
        </div>
        {jobs.length === 0 ? <p className="text-sm text-gray-500 dark:text-life-300">None yet. Add what is broken, and Life Is writes a dated note you can send.</p> : (
          <ul className="divide-y divide-life-50 dark:divide-life-700">
            {jobs.map((j) => (
              <li key={j.id}>
                <Link to={`/things/upkeep/${j.id}`} className="flex min-h-[44px] flex-wrap items-center gap-x-3 py-1.5 text-sm">
                  <span className="min-w-0 flex-1 text-gray-800 hover:underline dark:text-life-50">{j.name}</span>
                  <span className={`text-xs ${j.asked_days != null ? 'font-semibold text-honey-700' : 'text-gray-500 dark:text-life-300'}`}>
                    {j.asked_days != null ? askedText(j.asked_days) : j.fixed_on ? `Fixed ${dayText(j.fixed_on)}` : 'Not asked yet'}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Record rooms={rooms} onChange={(next) => setData({ ...data, rooms: next })} />

      {modal === 'lease' && <Modal title="The lease" onClose={() => setModal(null)}><LeaseForm lease={lease} onDone={(next) => { setData({ ...data, lease: next }); setModal(null); }} /></Modal>}
      {modal === 'repair' && <Modal title="Add a repair" onClose={() => setModal(null)}><RepairForm /></Modal>}
    </div>
  );
}

const Row = ({ term, text }) => (
  <div className="flex gap-2"><dt className="shrink-0 text-gray-500 dark:text-life-300">{term}</dt><dd className="min-w-0 break-words text-gray-800 dark:text-life-50">{text}</dd></div>
);

function LeaseForm({ lease, onDone }) {
  const [form, setForm] = useState({
    start_day: lease.start_day || '', end_day: lease.end_day || '', rent_day: lease.rent_day ?? '', deposit: lease.deposit_cents != null ? (lease.deposit_cents / 100).toFixed(2) : '',
    landlord_name: lease.landlord_name || '', landlord_contact: lease.landlord_contact || '', notice_day: lease.notice_day || '', notice_label: lease.notice_label || '',
  });
  const [error, setError] = useState('');
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const submit = async (e) => {
    e.preventDefault();
    const cents = form.deposit.trim() === '' ? null : Math.round(Number(form.deposit.replace(/[^0-9.]/g, '')) * 100);
    try {
      onDone((await axios.put('/api/things/renting/lease', {
        start_day: form.start_day || null, end_day: form.end_day || null, rent_day: form.rent_day === '' ? null : Number(form.rent_day), deposit_cents: cents,
        landlord_name: form.landlord_name || null, landlord_contact: form.landlord_contact || null, notice_day: form.notice_day || null, notice_label: form.notice_label || null,
      })).data);
    } catch (err) { setError(errorMessage(err, "Couldn't keep the lease")); }
  };
  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="The lease starts"><input type="date" value={form.start_day} onChange={set('start_day')} className={inputClass} /></Field>
        <Field label="The lease ends"><input type="date" value={form.end_day} onChange={set('end_day')} className={inputClass} /></Field>
        <Field label="Rent is due on day (1 to 31)"><input type="number" min="1" max="31" step="1" value={form.rent_day} onChange={set('rent_day')} className={inputClass} /></Field>
        <Field label="Deposit"><input inputMode="decimal" value={form.deposit} onChange={set('deposit')} placeholder="0.00" className={inputClass} /></Field>
        <Field label="Landlord's name"><input value={form.landlord_name} onChange={set('landlord_name')} className={inputClass} /></Field>
        <Field label="How to reach them (as you would type it)"><input value={form.landlord_contact} onChange={set('landlord_contact')} className={inputClass} /></Field>
        <Field label="A notice is due on"><input type="date" value={form.notice_day} onChange={set('notice_day')} className={inputClass} /></Field>
        <Field label="What the notice is for"><input value={form.notice_label} onChange={set('notice_label')} placeholder="Say if we are staying" className={inputClass} /></Field>
      </div>
      <p className="text-xs text-gray-500 dark:text-life-300">You pick the notice day yourself from your lease. Life Is only reminds you of it.</p>
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      <div className="flex justify-end"><button type="submit" className={buttonClass}>Keep the lease</button></div>
    </form>
  );
}

/** A repair is an Upkeep job marked as the landlord's. After keeping it, the note to the landlord is next. */
function RepairForm() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: '', note: '' });
  const [error, setError] = useState('');
  const submit = async (e) => {
    e.preventDefault();
    try {
      const { data } = await axios.post('/api/things/upkeep', { name: form.name, note: form.note || null, landlord: true });
      navigate(`/things/upkeep/${data.id}?ask=1`);
    } catch (err) { setError(errorMessage(err, "Couldn't keep that")); }
  };
  return (
    <form onSubmit={submit} className="space-y-3">
      <Field label="What needs fixing *"><input required autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Leaking kitchen tap" className={inputClass} /></Field>
      <Field label="What is wrong, in your words"><textarea rows={3} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} className={inputClass} /></Field>
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      <div className="flex justify-end"><button type="submit" className={buttonClass}>Next: write the note</button></div>
    </form>
  );
}

/** The move-in and move-out record: each room has a note and photos for the day you moved in and the day you moved out, side by side. */
function Record({ rooms, onChange }) {
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const add = async (text) => {
    if (!text.trim()) return;
    try { onChange((await axios.post('/api/things/renting/rooms', { name: text })).data); setName(''); setError(''); } catch (err) { setError(errorMessage(err, "Couldn't add the room")); }
  };
  return (
    <section className="space-y-3" aria-label="Move-in and move-out record">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="mr-auto font-semibold text-life-800 dark:text-life-50">Move-in and move-out record</h2>
        {rooms.length > 0 && <Link to="/things/renting/print" className={`${quietButtonClass} inline-flex items-center`}>Print the record</Link>}
      </div>
      {rooms.length === 0 && <p className="text-sm text-gray-600 dark:text-life-100">Go room by room. Write what it looks like and add your own photos when you move in. Do the same when you move out, and the two sit side by side.</p>}
      {rooms.map((room) => <RoomCard key={room.id} room={room} onChange={onChange} />)}
      <form onSubmit={(e) => { e.preventDefault(); add(name); }} className={`${cardClass} flex flex-wrap items-end gap-2`}>
        <div className="min-w-0 flex-1 basis-40"><Field label="Add a room"><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Kitchen" className={inputClass} /></Field></div>
        <button type="submit" className={buttonClass}>Add the room</button>
        {rooms.length === 0 && (
          <div className="flex basis-full flex-wrap gap-1.5" aria-label="Rooms to start with">
            {ROOM_IDEAS.map((r) => <button key={r} type="button" onClick={() => add(r)} className={`${quietButtonClass} !px-3`}>{r}</button>)}
          </div>
        )}
      </form>
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
    </section>
  );
}

function RoomCard({ room, onChange }) {
  const remove = async () => { if (window.confirm(`Remove ${room.name}, with its notes and photos?`)) onChange((await axios.delete(`/api/things/renting/rooms/${room.id}`)).data); };
  return (
    <section className={`${cardClass} space-y-2`} aria-label={room.name} data-room={room.name}>
      <div className="flex items-center gap-2">
        <h3 className="mr-auto font-semibold text-life-800 dark:text-life-50">{room.name}</h3>
        <button type="button" onClick={remove} className="min-h-[44px] px-2 text-xs text-red-600 hover:underline" aria-label={`Remove ${room.name}`}>Remove</button>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Visit room={room} phase="in" title="Move-in" onChange={onChange} />
        <Visit room={room} phase="out" title="Move-out" onChange={onChange} />
      </div>
    </section>
  );
}

/** One visit to a room: how it looked, and the photos taken. */
function Visit({ room, phase, title, onChange }) {
  const key = phase === 'in' ? 'in_note' : 'out_note';
  const [note, setNote] = useState(room[key] || '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const picker = useRef(null);
  const photos = room.photos.filter((p) => p.phase === phase);
  const keepNote = async () => {
    if (note === (room[key] || '')) return;
    try { onChange((await axios.put(`/api/things/renting/rooms/${room.id}`, { [key]: note || null })).data); setError(''); } catch (err) { setError(errorMessage(err, "Couldn't keep the note")); }
  };
  const addPhotos = async (e) => {
    const files = [...e.target.files];
    e.target.value = '';
    setBusy(true);
    setError('');
    let latest = null;
    for (const file of files) {
      try { latest = (await axios.post(`/api/things/renting/rooms/${room.id}/photos`, { phase, data: await shrink(file) })).data; } catch (err) { setError(errorMessage(err, `${file.name} couldn't be added`)); }
    }
    setBusy(false);
    if (latest) onChange(latest);
  };
  const removePhoto = async (p) => { if (window.confirm(`Remove the photo of ${dayText(p.day)}?`)) onChange((await axios.delete(`/api/things/renting/photos/${p.id}`)).data); };
  return (
    <div className="min-w-0 space-y-2" data-visit={phase}>
      <h4 className="text-sm font-semibold text-gray-700 dark:text-life-100">{title}</h4>
      <textarea rows={4} value={note} onChange={(e) => setNote(e.target.value)} onBlur={keepNote} aria-label={`${room.name}: how it looked at ${title.toLowerCase()}`} placeholder="Scratches, stains, what works" className={`${inputClass} text-xs`} />
      <ul className="space-y-2">
        {photos.map((p) => (
          <li key={p.id} className="relative">
            <Picture src={photoAddress(p.id)} alt={`${room.name} at ${title.toLowerCase()}, ${dayText(p.day)}`} className="block max-h-48 w-full rounded-lg object-cover" />
            <span className="mt-0.5 block text-xs text-gray-600 dark:text-life-200">{dayText(p.day)}</span>
            <button type="button" onClick={() => removePhoto(p)} aria-label={`Remove the photo of ${dayText(p.day)}`} className="absolute right-1 top-1 flex h-11 w-11 items-center justify-center rounded-full bg-black/50 text-lg text-white">×</button>
          </li>
        ))}
      </ul>
      <input ref={picker} type="file" accept="image/*" multiple onChange={addPhotos} className="hidden" aria-label={`Choose photos for ${room.name} at ${title.toLowerCase()}`} />
      <button type="button" disabled={busy} onClick={() => picker.current?.click()} className={`${quietButtonClass} w-full`}>{busy ? 'Adding…' : 'Add a photo'}</button>
      {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
