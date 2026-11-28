import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import axios from 'axios';
import Picture from '../components/Picture';
import { shrink } from '../components/shrink';
import SubChips, { ROUTINE_CHIPS } from '../components/SubChips';
import Modal, { Field, inputClass, buttonClass, quietButtonClass, cardClass, errorMessage } from '../components/ui';

/**
 * Medicines: a private list for a person, a child or a pet. Life Is only keeps what is typed here and reminds. It never gives
 * medical advice, checks a dose or suggests anything about a medicine. A medicine shows as a step in a routine, where checking
 * it is taking it (core/src/medicines.ts). Everything is worked out on the server.
 */

const box = `${inputClass} min-h-[44px]`;
const pickClass = 'flex min-h-[44px] cursor-pointer items-center gap-2 rounded-lg text-sm text-gray-800 dark:text-life-50';
const tel = (phone) => `tel:${phone.replace(/[^0-9+]/g, '')}`;
const subjectKey = (s) => (s.kind === 'me' ? 'me' : `${s.kind}-${s.id}`);
const medicineKey = (m) => (m.for_kind === 'me' ? 'me' : `${m.for_kind}-${m.for_id}`);

/** "Mon, Mar 5 at 8:02 AM": when a dose was taken, from the moment kept with it (or only the day for one brought in without it). */
function doseWhen(d) {
  const at = d.at ? new Date(d.at) : null;
  if (at && !Number.isNaN(at.getTime())) return at.toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const [y, m, day] = d.day.split('-').map(Number);
  return new Date(y, m - 1, day).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
}

/** How many are left, and what that means in days, in the person's own count. */
function leftText(m) {
  if (m.left === null) return null;
  if (m.days_left === null) return `${m.left} left`;
  const days = m.days_left === 0 ? 'runs out today' : m.days_left === 1 ? 'about 1 day' : `about ${m.days_left} days`;
  return `${m.left} left, ${days}`;
}

export default function MedicinesPage() {
  const [params, setParams] = useSearchParams();
  const [data, setData] = useState(null);
  const [modal, setModal] = useState(null);
  const [error, setError] = useState('');
  const load = useCallback(() => { axios.get('/api/medicines').then(({ data: d }) => setData(d)).catch(() => setData(false)); }, []);
  useEffect(() => { load(); }, [load]);
  if (data === null) return null;
  if (data === false) return <p className="text-sm text-gray-600 dark:text-life-200">The medicines couldn't be loaded. Try again in a moment.</p>;

  const key = params.get('pet') ? `pet-${params.get('pet')}` : params.get('member') ? `member-${params.get('member')}` : 'me';
  const subject = data.subjects.find((s) => subjectKey(s) === key) ?? data.subjects[0];
  const shown = data.mine.filter((m) => medicineKey(m) === subjectKey(subject));
  const choose = (s) => setParams(s.kind === 'me' ? {} : { [s.kind]: s.id });
  const names = async (on) => {
    setError('');
    setData((d) => ({ ...d, show_names: on }));
    try { await axios.put('/api/medicines/settings', { show_names: on }); } catch (err) { setData((d) => ({ ...d, show_names: !on })); setError(errorMessage(err, "Couldn't change that")); }
  };

  return (
    <div className="space-y-4">
      <SubChips items={ROUTINE_CHIPS} label="Routines, measures and medicines" />
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-xl font-semibold text-life-800 dark:text-life-50">Medicines</h1>
        <button type="button" onClick={() => setModal({ medicine: null })} className={`${buttonClass} min-h-[44px]`}>+ Add a medicine</button>
      </div>
      <p className="text-sm text-gray-600 dark:text-life-100" data-medicines-about>
        A list you keep yourself, and a reminder from your routines. Only you see your list. Share one medicine with someone in the house and they can look at it, not change it.
        Life Is does not give medical advice, check a dose or suggest anything about a medicine.
      </p>

      <section className={`${cardClass} space-y-1`} aria-label="Reminders" data-medicines-names>
        <label className={pickClass}>
          <input type="checkbox" checked={data.show_names} onChange={(e) => names(e.target.checked)} className="h-5 w-5 flex-none accent-life-600" />
          Show medicine names in my reminders
        </label>
        <p className="text-xs text-gray-600 dark:text-life-200">
          {data.show_names
            ? 'A reminder on your lock screen or in a message names the medicine. This is only for you.'
            : 'A reminder says only something like "Morning routine: 1 step" and never the name of a medicine. This is only for you.'}
        </p>
        {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
      </section>

      {data.subjects.length > 1 && (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Whose list">
          {data.subjects.map((s) => {
            const on = subjectKey(s) === subjectKey(subject);
            return (
              <button key={subjectKey(s)} type="button" aria-pressed={on} onClick={() => choose(s)}
                className={`min-h-[44px] rounded-full px-4 text-sm ${on ? 'bg-life-600 text-white' : 'bg-card text-life-700 ring-1 ring-life-100 dark:bg-life-800 dark:text-life-100 dark:ring-life-700'}`}>{s.name}</button>
            );
          })}
        </div>
      )}

      {shown.length === 0 ? (
        <p className={`${cardClass} text-sm text-gray-600 dark:text-life-100`}>
          {subject.kind === 'me' ? 'Nothing here yet.' : `Nothing here yet for ${subject.name}.`} Add a medicine with its name, the dose in your own words, when it is taken, and how many are left.
          Put it in a routine and it shows there as a step to check off. A week before the number left would run out, you get a reminder.
        </p>
      ) : (
        <ul className="space-y-3">
          {shown.map((m) => <li key={m.id}><MedicineCard m={m} people={data.people} onEdit={() => setModal({ medicine: m })} onChanged={load} /></li>)}
        </ul>
      )}

      {data.shared.length > 0 && (
        <section className="space-y-2" aria-label="Shared with you" data-medicines-shared>
          <h2 className="font-semibold text-life-800 dark:text-life-50">Shared with you</h2>
          <ul className="space-y-3">
            {data.shared.map((m) => <li key={m.id}><MedicineCard m={m} people={[]} onChanged={load} /></li>)}
          </ul>
        </section>
      )}

      {modal && (
        <Modal title={modal.medicine ? modal.medicine.name : `A medicine for ${subject.name === 'You' ? 'you' : subject.name}`} onClose={() => setModal(null)}>
          <MedicineForm medicine={modal.medicine} subject={subject} subjects={data.subjects} onDone={() => { setModal(null); load(); }} />
        </Modal>
      )}
    </div>
  );
}

function Line({ label, children }) {
  if (!children) return null;
  return <div><dt className="text-xs text-gray-500 dark:text-life-300">{label}</dt><dd className="break-words text-gray-800 dark:text-life-50">{children}</dd></div>;
}

function MedicineCard({ m, people, onEdit, onChanged }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const [showPhoto, setShowPhoto] = useState(false);
  const [sharedWith, setSharedWith] = useState(m.people);
  useEffect(() => { setSharedWith(m.people); }, [m.people]);
  const refill = async () => {
    setError('');
    let amount = null;
    if (!m.fill_size) {
      const said = window.prompt('How many does the refill hold?');
      if (said === null) return;
      amount = Number(said);
      if (!Number.isInteger(amount) || amount < 1) { setError('A refill is a whole number, 1 or more'); return; }
    }
    try { await axios.post(`/api/medicines/${m.id}/refilled`, amount === null ? {} : { amount }); onChanged(); } catch (err) { setError(errorMessage(err, "Couldn't keep that")); }
  };
  const toggle = async (id) => {
    setError('');
    const next = sharedWith.includes(id) ? sharedWith.filter((p) => p !== id) : [...sharedWith, id];
    const before = sharedWith;
    setSharedWith(next);
    try { setSharedWith((await axios.put(`/api/medicines/${m.id}/sharing`, { people: next })).data.people); } catch (err) { setSharedWith(before); setError(errorMessage(err, "Couldn't change who sees it")); }
  };
  const left = leftText(m);
  return (
    <section className={`${cardClass} space-y-2`} data-medicine={m.name} aria-label={m.name}>
      <div className="flex flex-wrap items-baseline gap-x-2">
        <h2 className="mr-auto min-w-0 break-words font-semibold text-life-800 dark:text-life-50">{m.name}</h2>
        {!m.mine && <span className="text-xs text-gray-500 dark:text-life-300">Kept by {m.keeper}{m.for_kind !== 'me' ? `, for ${m.for_name}` : ''}</span>}
      </div>
      {m.dose && <p className="break-words text-sm text-gray-800 dark:text-life-50">{m.dose}</p>}
      {m.when_taken && <p className="break-words text-sm text-gray-600 dark:text-life-100">{m.when_taken}</p>}
      {left && <p className={`text-sm ${m.refill_soon ? 'font-semibold text-honey-700' : 'text-gray-700 dark:text-life-100'}`} data-left>{left}{m.refill_soon ? ' · time to ask for a refill' : ''}</p>}
      <p className="text-xs text-gray-600 dark:text-life-200">
        {m.times.length ? `In ${m.times.map((t) => t.title).join(' and ')}. ` : 'Not in a routine, so nothing reminds you. '}
        {m.taken_today > 0 ? `Taken ${m.taken_today === 1 ? 'once' : `${m.taken_today} times`} today.` : m.times.length ? 'Not taken yet today.' : ''}
      </p>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className={`${quietButtonClass} min-h-[44px]`}>{open ? 'Hide the rest' : 'More'}</button>
        {m.mine && <button type="button" onClick={onEdit} className={`${quietButtonClass} min-h-[44px]`}>Change</button>}
        {m.mine && m.left !== null && <button type="button" onClick={refill} className={`${quietButtonClass} min-h-[44px]`}>Got a refill{m.fill_size ? ` (+${m.fill_size})` : ''}</button>}
      </div>
      {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
      {open && (
        <div className="space-y-3 border-t border-life-50 pt-3 dark:border-life-700">
          <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-2">
            <Line label="What it is for">{m.reason}</Line>
            <Line label="Prescriber">{(m.prescriber_name || m.prescriber_phone) && <>{m.prescriber_name}{m.prescriber_name && m.prescriber_phone ? ' · ' : ''}{m.prescriber_phone && <a href={tel(m.prescriber_phone)} className="inline-flex min-h-[44px] items-center underline">{m.prescriber_phone}</a>}</>}</Line>
            <Line label="Pharmacy">{(m.pharmacy_name || m.pharmacy_phone) && <>{m.pharmacy_name}{m.pharmacy_name && m.pharmacy_phone ? ' · ' : ''}{m.pharmacy_phone && <a href={tel(m.pharmacy_phone)} className="inline-flex min-h-[44px] items-center underline">{m.pharmacy_phone}</a>}</>}</Line>
            <Line label="Notes"><span className="whitespace-pre-line">{m.note}</span></Line>
          </dl>
          {m.photo && (
            <button type="button" onClick={() => setShowPhoto(true)} aria-label={`The photo of the label of ${m.name}`} className="block">
              <Picture src={`/api/medicines/${m.id}/photo`} alt={`The label of ${m.name}`} className="h-24 w-24 rounded-xl object-cover" />
            </button>
          )}
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-life-600 dark:text-life-300">Doses taken</h3>
            {m.doses.length === 0 ? <p className="text-sm text-gray-500 dark:text-life-300">None yet. Check it in its routine when it is taken.</p> : (
              <ul className="text-sm text-gray-800 dark:text-life-50" data-doses>
                {m.doses.map((d, i) => <li key={`${d.day}-${i}`} className="py-0.5">{doseWhen(d)}{d.by && d.by !== 'you' ? ` · ${d.by}` : ''}</li>)}
              </ul>
            )}
          </div>
          {m.mine && (
            <fieldset className="space-y-0.5" data-sharing>
              <legend className="text-xs font-semibold uppercase tracking-wide text-life-600 dark:text-life-300">Who can see this</legend>
              <p className="text-sm text-gray-600 dark:text-life-100">{sharedWith.length === 0 ? 'Only you.' : 'You, and the people checked below. They can look at it, with its photo, and not change it.'}</p>
              {people.length === 0 ? <p className="text-sm text-gray-500 dark:text-life-300">Nobody else has signed in here.</p> : people.map((p) => (
                <label key={p.id} className={pickClass}>
                  <input type="checkbox" checked={sharedWith.includes(p.id)} onChange={() => toggle(p.id)} className="h-5 w-5 flex-none accent-life-600" /> {p.name}
                </label>
              ))}
            </fieldset>
          )}
        </div>
      )}
      {showPhoto && (
        <Modal title={`The label of ${m.name}`} onClose={() => setShowPhoto(false)}>
          <Picture src={`/api/medicines/${m.id}/photo`} alt={`The label of ${m.name}`} className="max-h-[70vh] w-full rounded-xl object-contain" />
        </Modal>
      )}
    </section>
  );
}

const textOrNull = (v) => (v.trim() === '' ? null : v.trim());
const numberOrNull = (v) => (v === '' ? null : Number(v));

function MedicineForm({ medicine, subject, subjects, onDone }) {
  const editing = Boolean(medicine);
  const [who, setWho] = useState(medicine ? subjectKey(subjects.find((s) => medicineKey(medicine) === subjectKey(s)) ?? subject) : subjectKey(subject));
  const target = subjects.find((s) => subjectKey(s) === who) ?? subject;
  const [form, setForm] = useState({
    name: medicine?.name ?? '', dose: medicine?.dose ?? '', when_taken: medicine?.when_taken ?? '', left: medicine?.left ?? '', per_dose: medicine?.per_dose ?? 1, fill_size: medicine?.fill_size ?? '',
    prescriber_name: medicine?.prescriber_name ?? '', prescriber_phone: medicine?.prescriber_phone ?? '', pharmacy_name: medicine?.pharmacy_name ?? '', pharmacy_phone: medicine?.pharmacy_phone ?? '',
    reason: medicine?.reason ?? '', note: medicine?.note ?? '',
  });
  const [times, setTimes] = useState(() => medicine?.times.map((t) => t.id) ?? []);
  const [make, setMake] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const picker = useRef(null);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const mine = (target.times ?? []);
  // The ones this medicine is already in stay offered even if they are no longer the person's own (they are checked).
  const offered = [...mine, ...(medicine?.times ?? []).filter((t) => !mine.some((x) => x.id === t.id))];
  const quick = ['Morning', 'Evening'].filter((n) => !offered.some((t) => t.title === `Medicines: ${n}`));
  const flip = (list, set1, value) => set1(list.includes(value) ? list.filter((x) => x !== value) : [...list, value]);

  const submit = async (e) => {
    e.preventDefault();
    setError(''); setBusy(true);
    try {
      const body = {
        name: form.name, dose: textOrNull(form.dose), when_taken: textOrNull(form.when_taken), left: numberOrNull(form.left), per_dose: numberOrNull(form.per_dose) ?? 1, fill_size: numberOrNull(form.fill_size),
        prescriber_name: textOrNull(form.prescriber_name), prescriber_phone: textOrNull(form.prescriber_phone), pharmacy_name: textOrNull(form.pharmacy_name), pharmacy_phone: textOrNull(form.pharmacy_phone),
        reason: textOrNull(form.reason), note: textOrNull(form.note), times: times.filter((id) => offered.some((t) => t.id === id)), make,
      };
      if (!editing) { body.for_pet = target.kind === 'pet' ? target.id : null; body.for_member = target.kind === 'member' ? target.id : null; }
      const { data } = editing ? await axios.put(`/api/medicines/${medicine.id}`, body) : await axios.post('/api/medicines', body);
      const file = picker.current?.files?.[0];
      if (file) await axios.put(`/api/medicines/${data.id}/photo`, { data: await shrink(file) });
      onDone(data);
    } catch (err) { setError(errorMessage(err, "Couldn't save")); } finally { setBusy(false); }
  };
  const removePhoto = async () => {
    try { await axios.delete(`/api/medicines/${medicine.id}/photo`); onDone(); } catch (err) { setError(errorMessage(err, "Couldn't take the photo away")); }
  };
  const remove = async () => {
    if (!window.confirm(`Remove ${medicine.name}, with the doses taken and its place in your routines?`)) return;
    try { await axios.delete(`/api/medicines/${medicine.id}`); onDone(); } catch (err) { setError(errorMessage(err, "Couldn't remove it")); }
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      {!editing && subjects.length > 1 && (
        <Field label="For">
          <select value={who} onChange={(e) => { setWho(e.target.value); setTimes([]); setMake([]); }} className={box}>
            {subjects.map((s) => <option key={subjectKey(s)} value={subjectKey(s)}>{s.name}</option>)}
          </select>
        </Field>
      )}
      <Field label="Name *"><input required autoFocus value={form.name} onChange={set('name')} className={box} /></Field>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Dose, in your own words"><input value={form.dose} onChange={set('dose')} placeholder="10 mg, one tablet" className={box} /></Field>
        <Field label="When it is taken, in your own words"><input value={form.when_taken} onChange={set('when_taken')} placeholder="With breakfast" className={box} /></Field>
      </div>

      <fieldset className="space-y-2 rounded-xl bg-life-50/70 p-3 dark:bg-life-700/60">
        <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-life-600 dark:text-life-300">Refills</legend>
        <div className="grid grid-cols-3 gap-3">
          <Field label="How many are left"><input type="number" inputMode="numeric" min="0" step="1" value={form.left} onChange={set('left')} className={box} /></Field>
          <Field label="Used each dose"><input type="number" inputMode="numeric" min="1" max="99" step="1" value={form.per_dose} onChange={set('per_dose')} className={box} /></Field>
          <Field label="A refill adds"><input type="number" inputMode="numeric" min="1" step="1" value={form.fill_size} onChange={set('fill_size')} className={box} /></Field>
        </div>
        <p className="text-xs text-gray-600 dark:text-life-200">Count them your own way: tablets, drops, spoonfuls. Each time you check the medicine in a routine, the number left comes down. A week before it would run out, Life Is reminds you. Leave it empty to not count.</p>
      </fieldset>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Prescriber"><input value={form.prescriber_name} onChange={set('prescriber_name')} className={box} /></Field>
        <Field label="Prescriber's phone"><input type="tel" value={form.prescriber_phone} onChange={set('prescriber_phone')} className={box} /></Field>
        <Field label="Pharmacy"><input value={form.pharmacy_name} onChange={set('pharmacy_name')} className={box} /></Field>
        <Field label="Pharmacy's phone"><input type="tel" value={form.pharmacy_phone} onChange={set('pharmacy_phone')} className={box} /></Field>
      </div>
      <Field label="What it is for"><input value={form.reason} onChange={set('reason')} className={box} /></Field>
      <Field label="Notes"><textarea rows={2} value={form.note} onChange={set('note')} className={inputClass} /></Field>

      <fieldset className="space-y-0.5" data-medicine-times>
        <legend className="text-xs font-medium text-gray-600 dark:text-life-200">Show it as a step in a routine</legend>
        {offered.map((t) => (
          <label key={t.id} className={pickClass}>
            <input type="checkbox" checked={times.includes(t.id)} onChange={() => flip(times, setTimes, t.id)} className="h-5 w-5 flex-none accent-life-600" /> {t.title}
          </label>
        ))}
        {quick.map((n) => (
          <label key={n} className={pickClass}>
            <input type="checkbox" checked={make.includes(n)} onChange={() => flip(make, setMake, n)} className="h-5 w-5 flex-none accent-life-600" /> {n}, in a routine called Medicines
          </label>
        ))}
        <p className="text-xs text-gray-600 dark:text-life-200">The step is in the routine {target.kind === 'me' ? 'on your front page' : `of ${target.name}`}, where one tap on it means taken.</p>
      </fieldset>

      <Field label={medicine?.photo ? 'A different photo of the label' : 'A photo of the label'}>
        <input ref={picker} type="file" accept="image/*" className={`${inputClass} min-h-[44px]`} />
      </Field>
      {medicine?.photo && <button type="button" onClick={removePhoto} className="min-h-[44px] text-sm text-red-700 underline dark:text-red-300">Take the photo away</button>}

      {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
      <div className="flex flex-wrap items-center gap-2">
        {editing && <button type="button" onClick={remove} className="min-h-[44px] text-sm text-red-700 underline dark:text-red-300">Remove</button>}
        <button type="submit" disabled={busy} className={`${buttonClass} ml-auto min-h-[44px]`}>Save</button>
      </div>
    </form>
  );
}
