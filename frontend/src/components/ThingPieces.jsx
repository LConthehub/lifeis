import { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { Link } from 'react-router-dom';
import Modal, { Field, inputClass, buttonClass, quietButtonClass, cardClass, errorMessage } from './ui';

const STATE_WORDS = { here: 'Here', missing: 'Missing', broken: 'Broken' };
const UNITS = ['day', 'week', 'month', 'year'];

/** "Nov 25", and the year too when it is not this year. */
function shortDay(day) {
  const date = new Date(`${day}T12:00:00`);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString(undefined, sameYear ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' });
}
const pieceWord = (n) => `${n} piece${n === 1 ? '' : 's'}`;

/** What the last check found, in a few words. */
export function checkedText(view) {
  if (!view.checked_on) return 'Not checked yet';
  const missing = view.checked_missing ?? 0;
  return `Last checked ${shortDay(view.checked_on)}: ${missing === 0 ? 'all here' : `${missing} missing`}`;
}

/**
 * A thing's pieces: the small parts that go missing. They are listed as light lines, can be checked one by one, put on the shopping list
 * when missing or broken, and replaced every so often as their own Upkeep job. `offer` goes up by one when the page wants the check
 * offered (a lent thing came back); `lent` is who has it, when the thing is out.
 */
export default function ThingPieces({ item, lent = null, onBack, offer = 0, onChanged }) {
  const [view, setView] = useState(null);
  const [modal, setModal] = useState(null);       // 'check', or { piece } for the form (piece null: a new one)
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const id = item.id;
  const changed = (v) => { setView(v); onChanged?.(); };

  useEffect(() => { axios.get(`/api/things/items/${id}/pieces`).then(({ data }) => setView(data)).catch(() => setView(false)); }, [id]);
  const offered = useRef(0);
  useEffect(() => {
    if (offer > offered.current && view && view.pieces.length > 0) { offered.current = offer; setModal('check'); }
  }, [offer, view]);

  if (view === null || view === false) return null;
  if (item.gone) return null;
  const { pieces } = view;

  const shop = async (piece) => {
    setError(''); setNote('');
    try {
      const { data } = await axios.post(`/api/things/pieces/${piece.id}/shop`);
      setView(data.pieces);
      setNote(data.added ? `${piece.name} is on your shopping list.` : `${piece.name} is already on your shopping list.`);
    } catch (err) { setError(errorMessage(err, "Couldn't put that on the list")); }
  };

  return (
    <section className={`${cardClass} space-y-2`} aria-label="Pieces" data-pieces>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="mr-auto font-semibold text-life-800 dark:text-life-50">Pieces</h2>
        {pieces.length > 0 && <button type="button" onClick={() => setModal('check')} className={`${buttonClass} min-h-[44px]`}>Check the pieces</button>}
        <button type="button" onClick={() => setModal({ piece: null })} className={`${quietButtonClass} min-h-[44px]`}>Add a piece</button>
      </div>
      {lent && pieces.length > 0 && (
        <div className="space-y-1 rounded-lg bg-life-50 px-3 py-2 text-sm text-life-800 dark:bg-life-700 dark:text-life-50" data-lent>
          <p>Lent to {lent}.</p>
          <button type="button" onClick={onBack} className={`${quietButtonClass} min-h-[44px]`}>It's back: check the pieces</button>
        </div>
      )}
      {pieces.length === 0 ? (
        <p className="text-sm text-gray-600 dark:text-life-200">Some things have small parts that go missing. List them here, and check now and then that they are all there.</p>
      ) : (
        <>
          <p className={`text-sm ${view.missing ? 'font-medium text-honey-700' : 'text-gray-600 dark:text-life-200'}`} data-pieces-summary>
            {view.missing > 0 && <span data-pieces-missing>{pieceWord(view.missing)} {view.broken === view.missing ? 'broken' : view.broken ? 'missing or broken' : 'missing'}. </span>}
            <span className="font-normal text-gray-600 dark:text-life-200" data-pieces-checked>{checkedText(view)}</span>
          </p>
          <ul className="divide-y divide-life-50 dark:divide-life-700">
            {pieces.map((p) => (
              <li key={p.id} className="py-1.5 text-sm" data-piece={p.id}>
                <div className="min-w-0">
                  <p className="break-words text-gray-800 dark:text-life-50">
                    {p.name}{p.quantity > 1 ? ` × ${p.quantity}` : ''}
                    {p.state !== 'here' && <span className="ml-2 whitespace-nowrap rounded-full bg-honey-100 px-2 py-0.5 text-xs text-honey-700" data-piece-state>{STATE_WORDS[p.state]}</span>}
                  </p>
                  <p className="break-words text-xs text-gray-500 dark:text-life-300">
                    {[p.place, p.every && `Replace every ${p.every.n} ${p.every.unit}${p.every.n === 1 ? '' : 's'}`].filter(Boolean).join(' · ')}
                    {p.job_id && <>{p.place || p.every ? ' · ' : ''}<Link to={`/things/upkeep/${p.job_id}`} className="underline">Its Upkeep job</Link></>}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-x-3">
                {p.state !== 'here' && <button type="button" onClick={() => shop(p)} className={`${quietButtonClass} min-h-[44px]`}>Add to shopping</button>}
                <button type="button" onClick={() => setModal({ piece: p })} className="inline-flex min-h-[44px] items-center px-2 text-life-600 underline dark:text-life-200" aria-label={`Change ${p.name}`}>Change</button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
      {note && <p className="text-sm text-gray-700 dark:text-life-100" role="status" data-pieces-note>{note}</p>}
      {error && <p className="text-sm text-red-600" role="alert">{error}</p>}

      {modal === 'check' && (
        <Modal title={`Check the pieces of ${item.name}`} onClose={() => setModal(null)}>
          <CheckForm pieces={pieces} onDone={(v) => { setView(v); setModal(null); setNote(''); }} itemId={id} />
        </Modal>
      )}
      {modal && modal !== 'check' && (
        <Modal title={modal.piece ? `Change ${modal.piece.name}` : 'Add a piece'} onClose={() => setModal(null)}>
          <PieceForm itemId={id} piece={modal.piece} onDone={(v) => { changed(v); setModal(null); }} />
        </Modal>
      )}
    </section>
  );
}

/** Go through the pieces with a check box each: what is checked is here, what is not is marked missing. */
function CheckForm({ pieces, itemId, onDone }) {
  const [here, setHere] = useState(() => new Set());
  const [error, setError] = useState('');
  const left = pieces.filter((p) => !here.has(p.id));
  const all = left.length === 0;
  const toggle = (pid) => setHere((was) => { const next = new Set(was); if (next.has(pid)) next.delete(pid); else next.add(pid); return next; });
  const submit = async (e) => {
    e.preventDefault();
    try { onDone((await axios.post(`/api/things/items/${itemId}/pieces/check`, { here: [...here] })).data); } catch (err) { setError(errorMessage(err, "Couldn't keep that")); }
  };
  return (
    <form onSubmit={submit} className="space-y-3">
      <p className="text-sm text-gray-600 dark:text-life-200">Check each piece you can find. What you leave unchecked is marked missing.</p>
      <ul>
        {pieces.map((p) => (
          <li key={p.id}>
            <label className="flex min-h-[44px] items-center gap-3 text-sm text-gray-800 dark:text-life-50">
              <input type="checkbox" checked={here.has(p.id)} onChange={() => toggle(p.id)} className="h-5 w-5 flex-none accent-life-600" />
              <span className="min-w-0 break-words">{p.name}{p.quantity > 1 ? ` × ${p.quantity}` : ''}{p.place ? <span className="text-xs text-gray-500 dark:text-life-300"> · {p.place}</span> : null}
                {p.state !== 'here' && <span className="text-xs text-honey-700"> · was {p.state}</span>}</span>
            </label>
          </li>
        ))}
      </ul>
      <p className={`text-sm font-medium ${all ? 'text-life-700 dark:text-life-100' : 'text-gray-700 dark:text-life-100'}`} role="status" data-check-status>
        {all ? `All ${pieceWord(pieces.length)} here` : `${pieces.length - left.length} of ${pieces.length} here`}
      </p>
      {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
      <div className="flex justify-end">
        <button type="submit" className={`${buttonClass} min-h-[44px]`}>{all ? 'Done' : `Mark ${left.length} missing and save`}</button>
      </div>
    </form>
  );
}

/** One piece: its name, how many, where it is kept, whether it is here, and how often it is replaced. */
function PieceForm({ itemId, piece, onDone }) {
  const [form, setForm] = useState({
    name: piece?.name ?? '', quantity: String(piece?.quantity ?? 1), place: piece?.place ?? '', state: piece?.state ?? 'here',
    replace: Boolean(piece?.every), n: String(piece?.every?.n ?? 6), unit: piece?.every?.unit ?? 'month',
  });
  const [error, setError] = useState('');
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const submit = async (e) => {
    e.preventDefault();
    const body = { name: form.name, quantity: Number(form.quantity) || 1, place: form.place || null, state: form.state, every_n: form.replace ? Number(form.n) : null, every_unit: form.replace ? form.unit : null };
    try {
      const { data } = piece ? await axios.put(`/api/things/pieces/${piece.id}`, body) : await axios.post(`/api/things/items/${itemId}/pieces`, body);
      onDone(data);
    } catch (err) { setError(errorMessage(err, "Couldn't keep that")); }
  };
  const remove = async () => {
    try { onDone((await axios.delete(`/api/things/pieces/${piece.id}`)).data); } catch (err) { setError(errorMessage(err, "Couldn't take that away")); }
  };
  return (
    <form onSubmit={submit} className="space-y-3">
      <Field label="What it is"><input required autoFocus value={form.name} onChange={set('name')} maxLength={120} placeholder="Piercing pin, lid, tray…" className={`${inputClass} min-h-[44px]`} /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="How many"><input type="number" min="1" step="1" inputMode="numeric" value={form.quantity} onChange={set('quantity')} className={`${inputClass} min-h-[44px]`} /></Field>
        <Field label="Is it here?">
          <select value={form.state} onChange={set('state')} className={`${inputClass} min-h-[44px]`}>
            {Object.entries(STATE_WORDS).map(([key, word]) => <option key={key} value={key}>{word}</option>)}
          </select>
        </Field>
      </div>
      <Field label="Where it is kept (if you want to say)"><input value={form.place} onChange={set('place')} maxLength={120} placeholder="in the lid, the drawer…" className={`${inputClass} min-h-[44px]`} /></Field>
      <label className="flex min-h-[44px] items-center gap-3 text-sm text-gray-800 dark:text-life-50">
        <input type="checkbox" checked={form.replace} onChange={(e) => setForm({ ...form, replace: e.target.checked })} className="h-5 w-5 flex-none accent-life-600" /> Replace it every so often
      </label>
      {form.replace && (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Replace every"><input type="number" min="1" step="1" inputMode="numeric" value={form.n} onChange={set('n')} className={`${inputClass} min-h-[44px]`} /></Field>
          <Field label="Days, weeks, months or years">
            <select value={form.unit} onChange={set('unit')} className={`${inputClass} min-h-[44px]`}>{UNITS.map((u) => <option key={u} value={u}>{u}s</option>)}</select>
          </Field>
          <p className="col-span-2 text-xs text-gray-500 dark:text-life-300">This makes its own Upkeep job, so you are reminded when it is time.</p>
        </div>
      )}
      {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
      <div className="flex flex-wrap justify-between gap-2">
        {piece ? <button type="button" onClick={remove} className={`${quietButtonClass} min-h-[44px]`}>Take it off the list</button> : <span />}
        <button type="submit" className={`${buttonClass} min-h-[44px]`}>Keep it</button>
      </div>
    </form>
  );
}
