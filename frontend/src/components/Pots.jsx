import { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import Modal, { Field, inputClass, buttonClass, quietButtonClass, cardClass, errorMessage } from './ui';
import { money, toCents } from './Budget';

const pad = (n) => String(n).padStart(2, '0');
const today = () => { const now = new Date(); return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`; };
const dayText = (day) => new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

/**
 * Savings pots, shown beside the goals: money set aside for something, with no target. A pot takes dated lines in and out.
 * Life Is only keeps the score; no money moves. Private to the person unless they share a pot by name.
 */
export default function PotsSection() {
  const [data, setData] = useState(null);
  const [modal, setModal] = useState(null);
  const [error, setError] = useState('');
  const load = useCallback(() => { axios.get('/api/pots').then(({ data: d }) => setData(d)).catch(() => {}); }, []);
  useEffect(() => { load(); }, [load]);
  if (!data) return null;
  const sign = data.currency;
  const done = () => { setModal(null); load(); };
  const removeLine = async (line) => {
    setError('');
    try { await axios.delete(`/api/pots/lines/${line.id}`); load(); } catch (err) { setError(errorMessage(err, "Couldn't remove that")); }
  };
  return (
    <section className="space-y-3" data-pots>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="mr-auto text-lg font-semibold text-life-800 dark:text-life-50">Savings pots</h2>
        {data.pots.length > 0 && <span className="text-sm tabular-nums text-gray-600 dark:text-life-100" data-pots-total>{money(data.total, sign)} in pots</span>}
        <button type="button" onClick={() => setModal({ pot: {} })} className={`${buttonClass} min-h-[44px]`}>+ A pot</button>
      </div>
      {data.pots.length === 0 && <div className={`${cardClass} text-center text-sm text-gray-500 dark:text-life-200`}>No pots yet. A pot is money you set aside for something, like the car, gifts or a trip, with no target needed.</div>}
      {data.pots.map((p) => (
        <div key={p.id} className={`${cardClass} ${p.closed_on ? 'opacity-75' : ''}`} data-pot={p.name}>
          <div className="flex flex-wrap items-baseline gap-x-2">
            <h3 className="mr-auto font-semibold text-life-800 dark:text-life-50">{p.name}{p.closed_on && <span className="ml-2 text-xs font-normal text-gray-500 dark:text-life-300">closed {dayText(p.closed_on)}</span>}</h3>
            <span className="tabular-nums text-gray-800 dark:text-life-50" data-pot-balance>{money(p.balance, sign)}</span>
          </div>
          <p className="text-xs text-gray-500 dark:text-life-300">
            {!p.mine ? `Shared with you by ${p.owner}` : p.shared_with.length ? `Shared with ${p.shared_with.map((x) => x.name).join(', ')}` : 'Only you see this'}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {!p.closed_on && <button type="button" onClick={() => setModal({ line: p, out: false })} aria-label={`Put money in ${p.name}`} className={`${buttonClass} min-h-[44px]`}>Put money in</button>}
            {!p.closed_on && <button type="button" onClick={() => setModal({ line: p, out: true })} disabled={p.balance === 0} aria-label={`Take money out of ${p.name}`} className={`${quietButtonClass} min-h-[44px]`}>Take money out</button>}
            {p.mine && <button type="button" onClick={() => setModal({ pot: p })} aria-label={`Change ${p.name}`} className={`${quietButtonClass} min-h-[44px]`}>Change</button>}
          </div>
          {p.lines.length > 0 && (
            <ul className="mt-2 divide-y divide-life-100 text-sm dark:divide-life-800">
              {p.lines.map((l) => (
                <li key={l.id} className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 py-2 text-gray-600 dark:text-life-100">{dayText(l.day)}{l.note ? `: ${l.note}` : ''}{!l.mine && l.by ? <span className="text-xs text-gray-500 dark:text-life-300"> ({l.by})</span> : null}</span>
                  <span className={`tabular-nums ${l.cents < 0 ? 'text-red-600' : 'text-gray-800 dark:text-life-50'}`}>{l.cents < 0 ? 'out ' : ''}{money(Math.abs(l.cents), sign)}</span>
                  {(p.mine || l.mine) && <button type="button" aria-label={`Remove the ${dayText(l.day)} line for ${p.name}`} onClick={() => removeLine(l)} className="flex h-11 w-11 items-center justify-center text-gray-400 hover:text-red-600">✕</button>}
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
      {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
      {modal?.pot && <Modal title={modal.pot.id ? modal.pot.name : 'A savings pot'} onClose={() => setModal(null)}><PotForm pot={modal.pot} people={data.people} onDone={done} /></Modal>}
      {modal?.line && <Modal title={`${modal.out ? 'Take money out of' : 'Put money in'} ${modal.line.name}`} onClose={() => setModal(null)}><LineForm pot={modal.line} out={modal.out} onDone={done} /></Modal>}
    </section>
  );
}

function PotForm({ pot, people, onDone }) {
  const [name, setName] = useState(pot.name || '');
  const [shared, setShared] = useState((pot.shared_with || []).map((p) => p.id));
  const [error, setError] = useState('');
  const toggle = (id) => setShared(shared.includes(id) ? shared.filter((x) => x !== id) : [...shared, id]);
  const send = async (request) => { setError(''); try { await request(); onDone(); } catch (err) { setError(errorMessage(err, "Couldn't save that")); } };
  const submit = (e) => {
    e.preventDefault();
    const body = { name, shared_with: shared };
    send(() => (pot.id ? axios.put(`/api/pots/${pot.id}`, body) : axios.post('/api/pots', body)));
  };
  return (
    <form onSubmit={submit} className="space-y-3">
      <Field label="What it is for *"><input required autoFocus={!pot.id} value={name} onChange={(e) => setName(e.target.value)} placeholder="The car, gifts, a trip…" className={inputClass} /></Field>
      {people.length > 0 ? (
        <fieldset>
          <legend className="text-sm font-medium text-gray-700 dark:text-life-100">Who sees it</legend>
          <p className="mb-1 text-xs text-gray-500 dark:text-life-300">Only you, unless you check someone. They see this pot and can put money in and take it out. They can't rename it, close it or see another pot of yours.</p>
          {people.map((p) => (
            <label key={p.id} className="flex min-h-[44px] items-center gap-2 text-sm text-gray-800 dark:text-life-50">
              <input type="checkbox" checked={shared.includes(p.id)} onChange={() => toggle(p.id)} className="h-5 w-5" /> {p.name}
            </label>
          ))}
        </fieldset>
      ) : <p className="text-xs text-gray-500 dark:text-life-300">Only you see this.</p>}
      <p className="text-xs text-gray-500 dark:text-life-300">This only keeps the score of what you set aside. It does not move any money.</p>
      {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          {pot.id && <button type="button" onClick={() => send(() => axios.put(`/api/pots/${pot.id}`, { closed: !pot.closed_on }))} className={`${quietButtonClass} min-h-[44px]`}>{pot.closed_on ? 'Open it again' : 'Close it'}</button>}
          {pot.id && <button type="button" onClick={() => { if (window.confirm(`Remove the pot ${pot.name}? Its lines are removed from the record too. No money moves.`)) send(() => axios.delete(`/api/pots/${pot.id}`)); }} className="min-h-[44px] px-2 text-sm text-red-600 hover:underline">Remove</button>}
        </div>
        <button type="submit" className={`${buttonClass} min-h-[44px]`}>Save</button>
      </div>
    </form>
  );
}

function LineForm({ pot, out, onDone }) {
  const [amount, setAmount] = useState('');
  const [day, setDay] = useState(today());
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const submit = async (e) => {
    e.preventDefault();
    setError('');
    const cents = toCents(amount);
    try { await axios.post(`/api/pots/${pot.id}/lines`, { day, note: note || null, cents: cents === null ? null : (out ? -cents : cents) }); onDone(); } catch (err) { setError(errorMessage(err, "Couldn't save that")); }
  };
  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Field label="How much *"><input required autoFocus inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className={inputClass} /></Field>
        <Field label="On"><input type="date" value={day} onChange={(e) => setDay(e.target.value)} className={inputClass} /></Field>
      </div>
      <Field label="A note"><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="tax refund, new tires" className={inputClass} /></Field>
      <p className="text-xs text-gray-500 dark:text-life-300">This only changes what Life Is says is in the pot. It does not move any money.</p>
      {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
      <div className="flex justify-end"><button type="submit" className={`${buttonClass} min-h-[44px]`}>{out ? 'Take it out' : 'Put it in'}</button></div>
    </form>
  );
}
