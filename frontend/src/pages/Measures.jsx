import { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import SubChips, { ROUTINE_CHIPS } from '../components/SubChips';
import Modal, { Field, inputClass, buttonClass, quietButtonClass, cardClass, errorMessage } from '../components/ui';

/**
 * Measures: a person's own numbers over time, like a weight, a waist, a resting pulse or the minutes read. They make
 * their own (a name and a unit), add dated entries, and see the latest ones as a plain list. A target is shown only
 * if they added one. Life Is suggests nothing and judges nothing here: no "good" or "bad", no arrows, no colors for
 * up or down. Only this person ever sees them: there is no sharing switch, not even for the person in charge.
 */

const control = `${inputClass} min-h-[44px]`;
const today = () => new Date().toLocaleDateString('en-CA');
const dayText = (day) => {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
};
const withUnit = (value, unit) => (unit ? `${value} ${unit}` : String(value));

function MeasureForm({ measure, onDone, onGone }) {
  const [name, setName] = useState(measure?.name ?? '');
  const [unit, setUnit] = useState(measure?.unit ?? '');
  const [target, setTarget] = useState(measure?.target ?? '');
  const [error, setError] = useState('');
  const [sure, setSure] = useState(false);
  const save = async (e) => {
    e.preventDefault();
    setError('');
    const body = { name, unit: unit.trim() || null, target: target === '' ? null : Number(target) };
    try { onDone((measure ? await axios.put(`/api/measures/${measure.id}`, body) : await axios.post('/api/measures', body)).data); } catch (err) { setError(errorMessage(err, "Couldn't save")); }
  };
  const remove = async () => {
    try { await axios.delete(`/api/measures/${measure.id}`); onGone(); } catch (err) { setError(errorMessage(err, "Couldn't remove it")); }
  };
  return (
    <form onSubmit={save} className="space-y-4">
      <Field label="Name"><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Weight" aria-label="Name of the measure" className={control} /></Field>
      <Field label="Unit (if it has one)"><input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="lb" aria-label="Unit" className={control} /></Field>
      <Field label="Target (only if you want one)">
        <input type="number" inputMode="decimal" step="any" value={target} onChange={(e) => setTarget(e.target.value)} aria-label="Target" className={control} />
      </Field>
      {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
      <div className="flex flex-wrap items-center gap-2">
        {measure && !sure && <button type="button" onClick={() => setSure(true)} className="min-h-[44px] px-3 text-sm text-red-700 hover:underline dark:text-red-300">Delete this measure</button>}
        {measure && sure && <button type="button" onClick={remove} className="min-h-[44px] rounded-xl bg-red-600 px-4 text-sm font-semibold text-white">Yes, delete it and its entries</button>}
        <button type="submit" className={`${buttonClass} ml-auto min-h-[44px]`}>Save</button>
      </div>
    </form>
  );
}

function Entries({ measure, onChanged }) {
  const [value, setValue] = useState('');
  const [day, setDay] = useState(today());
  const [error, setError] = useState('');
  const add = async (e) => {
    e.preventDefault();
    setError('');
    try {
      onChanged((await axios.post(`/api/measures/${measure.id}/entries`, { value: Number(value), day: day || null })).data);
      setValue('');
    } catch (err) { setError(errorMessage(err, "Couldn't keep that")); }
  };
  const remove = async (entry) => {
    try { onChanged((await axios.delete(`/api/measures/entries/${entry.id}`)).data); } catch (err) { setError(errorMessage(err, "Couldn't remove it")); }
  };
  return (
    <>
      <form onSubmit={add} className="flex flex-wrap items-end gap-2">
        <label className="block text-xs text-gray-600 dark:text-life-200">{measure.unit ? `Today, in ${measure.unit}` : 'Number'}
          <input type="number" inputMode="decimal" required step="any" value={value} onChange={(e) => setValue(e.target.value)} aria-label={`New entry for ${measure.name}`} className={`${control} mt-0.5 !w-28`} />
        </label>
        <label className="block text-xs text-gray-600 dark:text-life-200">Day
          <input type="date" value={day} onChange={(e) => setDay(e.target.value)} aria-label={`Day of the entry for ${measure.name}`} className={`${control} mt-0.5 !w-auto`} />
        </label>
        <button type="submit" className={`${quietButtonClass} min-h-[44px]`} aria-label={`Add the entry to ${measure.name}`}>Add</button>
      </form>
      {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
      {measure.entries.length > 0 && (
        <ul className="divide-y divide-life-50 text-sm dark:divide-life-700" aria-label={`Recent entries for ${measure.name}`}>
          {measure.entries.slice(0, 10).map((e) => (
            <li key={e.id} className="flex items-center gap-2" data-entry>
              <span className="w-28 shrink-0 text-gray-600 dark:text-life-200">{dayText(e.day)}</span>
              <span className="min-w-0 flex-1 break-words py-2 text-gray-800 dark:text-life-50">{withUnit(e.value, measure.unit)}</span>
              <button type="button" onClick={() => remove(e)} aria-label={`Remove the entry on ${e.day}`} className="min-h-[44px] min-w-[44px] text-xs text-gray-500 hover:text-red-600 dark:text-life-300">Remove</button>
            </li>
          ))}
        </ul>
      )}
      {measure.entry_count > 10 && <p className="text-xs text-gray-500 dark:text-life-300">The latest 10 of {measure.entry_count} entries. All of them are in your download.</p>}
    </>
  );
}

export default function MeasuresPage() {
  const [list, setList] = useState(null);
  const [modal, setModal] = useState(null);
  const load = useCallback(() => { axios.get('/api/measures').then(({ data }) => setList(data)).catch(() => setList([])); }, []);
  useEffect(() => { load(); }, [load]);
  if (list === null) return null;
  const swap = (next) => setList((before) => before.map((m) => (m.id === next.id ? next : m)));
  const done = () => { setModal(null); load(); };
  return (
    <div className="space-y-4">
      <SubChips items={ROUTINE_CHIPS} label="Routines and measures" />
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-xl font-semibold text-life-800 dark:text-life-50">Measures</h1>
        <button type="button" onClick={() => setModal({ measure: null })} className={`${buttonClass} min-h-[44px]`}>+ New measure</button>
      </div>
      <p className="text-sm text-gray-600 dark:text-life-100" data-measures-private>Only you can see these. Nobody else can, not even the person in charge. They are in your own full download, and come back in with it.</p>
      {list.length === 0 && <p className={`${cardClass} text-sm text-gray-600 dark:text-life-100`}>No measures yet. Make your own: a name, and a unit if it has one. Then add an entry whenever you like.</p>}
      <ul className="space-y-3">
        {list.map((m) => (
          <li key={m.id} className={`${cardClass} space-y-2`} data-measure={m.name}>
            <div className="flex flex-wrap items-center gap-2">
              <div className="min-w-0 flex-1">
                <h2 className="break-words font-semibold text-life-800 dark:text-life-50">{m.name}</h2>
                {m.target !== null && <p className="text-xs text-gray-600 dark:text-life-200" data-target>Target: {withUnit(m.target, m.unit)}</p>}
              </div>
              <button type="button" onClick={() => setModal({ measure: m })} className={`${quietButtonClass} min-h-[44px]`} aria-label={`Change ${m.name}`}>Change</button>
            </div>
            <Entries measure={m} onChanged={swap} />
          </li>
        ))}
      </ul>
      {modal && (
        <Modal title={modal.measure ? `Change ${modal.measure.name}` : 'New measure'} onClose={() => setModal(null)}>
          <MeasureForm measure={modal.measure} onDone={done} onGone={done} />
        </Modal>
      )}
    </div>
  );
}
