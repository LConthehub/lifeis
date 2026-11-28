import { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import SubChips, { ROUTINE_CHIPS } from '../components/SubChips';
import Modal, { Field, inputClass, buttonClass, quietButtonClass, cardClass, errorMessage } from '../components/ui';
import { dollarsField, dollarsText } from '../components/collectionTools';

/**
 * Checkups: a person's own list (the dentist, the eyes, bloodwork, the vet for a pet). A name, how often, and the day of
 * the last one. Life Is works out the next one and says what is overdue or coming soon. It gives no advice about when
 * anyone should go. Only this person ever sees them: there is no sharing switch, not even for the person in charge.
 */

const control = `${inputClass} min-h-[44px]`;
const today = () => new Date().toLocaleDateString('en-CA');
const dayText = (day) => {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
};
const plural = (n, one) => `${n} ${n === 1 ? one : `${one}s`}`;
const every = (c) => `Every ${c.every_n === 1 ? '' : `${c.every_n} `}${c.every_unit}${c.every_n === 1 ? '' : 's'}`;
const when = (c) => {
  if (c.days_left === null) return 'No last day yet, so no next one';
  const next = dayText(c.next_on);
  if (c.days_left < 0) return `Next: ${next}, ${plural(-c.days_left, 'day')} late`;
  if (c.days_left === 0) return `Next: ${next}, today`;
  return `Next: ${next}, in ${plural(c.days_left, 'day')}`;
};
const GROUPS = [
  ['overdue', 'Overdue', ['overdue']],
  ['soon', 'Due soon', ['due', 'soon']],
  ['later', 'Later', ['later']],
  ['unknown', 'No last day yet', ['unknown']],
];

function CheckupForm({ checkup, onDone, onGone }) {
  const [name, setName] = useState(checkup?.name ?? '');
  const [n, setN] = useState(checkup?.every_n ?? 6);
  const [unit, setUnit] = useState(checkup?.every_unit ?? 'month');
  const [last, setLast] = useState(checkup?.last_on ?? '');
  const [note, setNote] = useState(checkup?.note ?? '');
  const [cost, setCost] = useState(dollarsField(checkup?.cost_cents));
  const [error, setError] = useState('');
  const [sure, setSure] = useState(false);
  const save = async (e) => {
    e.preventDefault();
    setError('');
    const cents = cost.trim() === '' ? null : Math.round(Number(cost.replace(/[$,\s]/g, '')) * 100);
    if (cents !== null && (!Number.isFinite(cents) || cents < 0)) { setError('A cost is a number of dollars, like 150 or 89.50'); return; }
    const body = { name, every_n: Number(n), every_unit: unit, last_on: last || null, note: note.trim() || null, cost_cents: cents };
    try { onDone(checkup ? (await axios.put(`/api/checkups/${checkup.id}`, body)).data : (await axios.post('/api/checkups', body)).data); } catch (err) { setError(errorMessage(err, "Couldn't save")); }
  };
  const remove = async () => {
    try { await axios.delete(`/api/checkups/${checkup.id}`); onGone(); } catch (err) { setError(errorMessage(err, "Couldn't remove it")); }
  };
  return (
    <form onSubmit={save} className="space-y-4">
      <Field label="Name"><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Dentist" aria-label="Name of the checkup" className={control} /></Field>
      <div className="flex items-end gap-2">
        <Field label="How often: every"><input type="number" inputMode="numeric" min="1" max="999" value={n} onChange={(e) => setN(e.target.value)} aria-label="How many" className={`${control} !w-24`} /></Field>
        <Field label="Unit">
          <select value={unit} onChange={(e) => setUnit(e.target.value)} aria-label="Weeks, months or years" className={`${control} !w-auto`}>
            <option value="week">weeks</option><option value="month">months</option><option value="year">years</option>
          </select>
        </Field>
      </div>
      <Field label="Day of the last one (leave empty if there was none)"><input type="date" max={today()} value={last} onChange={(e) => setLast(e.target.value)} aria-label="Day of the last one" className={control} /></Field>
      <Field label="Note (if you like)"><textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} aria-label="Note" className={`${inputClass} min-h-[44px]`} /></Field>
      <Field label="Cost in dollars (if you like)"><input type="text" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="150.00" aria-label="Cost" className={control} /></Field>
      {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
      <div className="flex flex-wrap items-center gap-2">
        {checkup && !sure && <button type="button" onClick={() => setSure(true)} className="min-h-[44px] px-3 text-sm text-red-700 hover:underline dark:text-red-300">Delete this checkup</button>}
        {checkup && sure && <button type="button" onClick={remove} className="min-h-[44px] rounded-xl bg-red-600 px-4 text-sm font-semibold text-white">Yes, delete it</button>}
        <button type="submit" className={`${buttonClass} ml-auto min-h-[44px]`}>Save</button>
      </div>
    </form>
  );
}

export default function CheckupsPage() {
  const [list, setList] = useState(null);
  const [modal, setModal] = useState(null);
  const [error, setError] = useState('');
  const load = useCallback(() => { axios.get('/api/checkups').then(({ data }) => setList(data)).catch(() => setList([])); }, []);
  useEffect(() => { load(); }, [load]);
  if (list === null) return null;
  const done = () => { setModal(null); load(); };
  const markDone = async (c) => {
    setError('');
    try { await axios.post(`/api/checkups/${c.id}/done`, { day: today() }); load(); } catch (err) { setError(errorMessage(err, "Couldn't mark it done")); }
  };
  return (
    <div className="space-y-4">
      <SubChips items={ROUTINE_CHIPS} label="Routines, measures and your private records" />
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-xl font-semibold text-life-800 dark:text-life-50">Checkups</h1>
        <button type="button" onClick={() => setModal({ checkup: null })} className={`${buttonClass} min-h-[44px]`}>+ New checkup</button>
      </div>
      <p className="text-sm text-gray-600 dark:text-life-100" data-private>Only you can see these. Nobody else can, not even the person in charge. They are in your own full download, and come back in with it. A checkup coming due shows as a line in your morning reminder, if you have turned that on. Life Is keeps what you type and reminds you. It gives no advice.</p>
      {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
      {list.length === 0 && <p className={`${cardClass} text-sm text-gray-600 dark:text-life-100`}>No checkups yet. Add one: a name, how often, and the day of the last one. Life Is works out the next one.</p>}
      {GROUPS.map(([id, title, states]) => {
        const rows = list.filter((c) => states.includes(c.state));
        if (rows.length === 0) return null;
        return (
          <section key={id} className="space-y-2" aria-label={title} data-group={id}>
            <h2 className="text-sm font-semibold text-life-700 dark:text-life-100">{title}</h2>
            <ul className="space-y-3">
              {rows.map((c) => (
                <li key={c.id} className={`${cardClass} space-y-2`} data-checkup={c.name} data-state={c.state}>
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="min-w-0 flex-1">
                      <h3 className="break-words font-semibold text-life-800 dark:text-life-50">{c.name}</h3>
                      <p className="text-xs text-gray-600 dark:text-life-200">{every(c)}{c.last_on ? ` · last: ${dayText(c.last_on)}` : ''}</p>
                      <p className="text-sm text-gray-800 dark:text-life-50" data-next>{when(c)}</p>
                      {c.cost_cents !== null && <p className="text-xs text-gray-600 dark:text-life-200" data-cost>Cost: {dollarsText(c.cost_cents)}</p>}
                      {c.note && <p className="mt-1 whitespace-pre-wrap break-words text-xs text-gray-600 dark:text-life-200" data-note>{c.note}</p>}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={() => markDone(c)} className={`${buttonClass} min-h-[44px]`} aria-label={`Mark ${c.name} done today`}>Done today</button>
                    <button type="button" onClick={() => setModal({ checkup: c })} className={`${quietButtonClass} min-h-[44px]`} aria-label={`Change ${c.name}`}>Change</button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
      {modal && (
        <Modal title={modal.checkup ? `Change ${modal.checkup.name}` : 'New checkup'} onClose={() => setModal(null)}>
          <CheckupForm checkup={modal.checkup} onDone={done} onGone={done} />
        </Modal>
      )}
    </div>
  );
}
