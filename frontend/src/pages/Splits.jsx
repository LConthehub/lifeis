import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import axios from 'axios';
import Modal, { Field, inputClass, buttonClass, quietButtonClass, cardClass, errorMessage } from '../components/ui';
import { money, toCents } from '../components/Budget';

const pad = (n) => String(n).padStart(2, '0');
const today = () => { const now = new Date(); return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`; };
const dayText = (day) => new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const decimal = (cents) => (cents / 100).toFixed(2);
const MODES = [['equal', 'Equal share'], ['amount', 'An amount'], ['percent', 'A percent']];

/** Splitting a bill or a purchase. Life Is only keeps score: it never moves money. Pay outside Life Is, then tap Settled. */
export default function Splits() {
  const [data, setData] = useState(null);
  const [modal, setModal] = useState(null);
  const [error, setError] = useState('');
  const [params, setParams] = useSearchParams();
  const load = useCallback(() => { axios.get('/api/splits').then(({ data: d }) => setData(d)).catch(() => {}); }, []);
  useEffect(() => { load(); }, [load]);
  // A purchase in Spending or a bill in Upkeep sends the person here with its id: the form opens already filled in.
  useEffect(() => {
    const entry = params.get('entry');
    const bill = params.get('bill');
    if (!entry && !bill) return;
    setParams({}, { replace: true });
    axios.get('/api/splits/start', { params: entry ? { entry } : { bill } }).then(({ data: start }) => setModal({ form: { start } })).catch((err) => setError(errorMessage(err, "Couldn't start a split from that")));
  }, [params, setParams]);
  if (!data) return null;
  const sign = data.currency;
  const done = () => { setModal(null); load(); };
  const act = async (request, fallback) => { setError(''); try { await request(); load(); } catch (err) { setError(errorMessage(err, fallback)); } };
  const name = (who, you) => (you ? 'You' : who);
  const open = data.splits.filter((s) => s.open);
  const closed = data.splits.filter((s) => !s.open);

  const card = (s) => (
    <section key={s.id} className={cardClass} data-split={s.what}>
      <div className="flex flex-wrap items-baseline gap-x-2">
        <h2 className="mr-auto font-semibold text-life-800 dark:text-life-50">{s.what}</h2>
        <span className="tabular-nums text-sm text-gray-600 dark:text-life-100">{money(s.total_cents, sign)}</span>
      </div>
      <p className="text-xs text-gray-500 dark:text-life-300">
        {dayText(s.day)}. {s.shares.find((x) => x.paid)?.you ? 'You paid.' : `${s.paid_by} paid.`}{!s.mine && <> Made by {s.by}.</>}{s.note ? ` ${s.note}` : ''}
      </p>
      <ul className="mt-1 divide-y divide-life-100 text-sm dark:divide-life-800">
        {s.shares.map((x) => (
          <li key={x.id} className="flex flex-wrap items-center gap-x-2 py-1" data-share={x.who}>
            <span className="min-w-0 flex-1 py-2 text-gray-800 dark:text-life-50">{name(x.who, x.you)}{x.typed && <span className="text-xs text-gray-500 dark:text-life-300"> (a name only)</span>}</span>
            <span className="tabular-nums text-gray-700 dark:text-life-100">{money(x.cents, sign)}</span>
            {x.paid && <span className="text-xs text-gray-500 dark:text-life-300">paid it</span>}
            {x.owes && x.settled_on === null && (x.can_settle
              ? <button type="button" onClick={() => act(() => axios.post(`/api/splits/shares/${x.id}/settle`, { settled: true }), "Couldn't mark that")} aria-label={`Settled: ${name(x.who, x.you)}, ${s.what}`} className={`${quietButtonClass} min-h-[44px]`}>Settled</button>
              : <span className="text-xs text-gray-500 dark:text-life-300">owes</span>)}
            {x.owes && x.settled_on !== null && (
              <span className="flex items-center gap-1 text-xs text-gray-500 dark:text-life-300">settled {dayText(x.settled_on)}
                {x.can_settle && <button type="button" onClick={() => act(() => axios.post(`/api/splits/shares/${x.id}/settle`, { settled: false }), "Couldn't take that back")} aria-label={`Not settled after all: ${name(x.who, x.you)}, ${s.what}`} className="min-h-[44px] px-2 underline">Undo</button>}
              </span>
            )}
          </li>
        ))}
      </ul>
      {s.mine && (
        <div className="mt-1 flex flex-wrap gap-2">
          <button type="button" onClick={() => setModal({ form: { split: s } })} aria-label={`Change ${s.what}`} className={`${quietButtonClass} min-h-[44px]`}>Change</button>
          <button type="button" onClick={() => { if (window.confirm(`Remove the split ${s.what}? Nothing is paid or refunded; the record is just taken off.`)) act(() => axios.delete(`/api/splits/${s.id}`), "Couldn't remove that"); }} aria-label={`Remove ${s.what}`} className="min-h-[44px] px-2 text-sm text-red-600 hover:underline">Remove</button>
        </div>
      )}
    </section>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-xl font-semibold text-life-800 dark:text-life-50">Splits</h1>
        <button type="button" onClick={() => setModal({ form: {} })} className={`${buttonClass} min-h-[44px]`}>+ A split</button>
      </div>
      <p className="text-sm text-gray-600 dark:text-life-100">Life Is only keeps score. It never moves money. Pay each other outside Life Is, then tap Settled on what you paid or were paid.</p>

      <section className={cardClass} data-owes>
        <h2 className="font-semibold text-life-800 dark:text-life-50">Who owes whom</h2>
        <p className="text-sm text-gray-700 dark:text-life-100" data-owe-summary>
          {data.you_owe > 0 ? <>You owe <span className="font-semibold tabular-nums">{money(data.you_owe, sign)}</span> in all.</> : data.you_are_owed > 0 ? <>You are owed <span className="font-semibold tabular-nums">{money(data.you_are_owed, sign)}</span> in all.</> : 'Nothing is owed. All square.'}
        </p>
        {data.payments.length > 0 && (
          <>
            <p className="mt-1 text-xs text-gray-500 dark:text-life-300">The fewest payments that would settle everything:</p>
            <ul className="divide-y divide-life-100 text-sm dark:divide-life-800" data-payments>
              {data.payments.map((p, i) => (
                <li key={i} className="flex items-center justify-between gap-2 py-2" data-payment>
                  <span className="min-w-0 text-gray-800 dark:text-life-50">{p.from_you ? 'You pay' : `${p.from} pays`} {p.to_you ? 'you' : p.to}</span>
                  <span className="tabular-nums font-medium text-gray-800 dark:text-life-50">{money(p.cents, sign)}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      {data.splits.length === 0 && <div className={`${cardClass} text-center text-sm text-gray-500 dark:text-life-200`}>No splits yet. Add one here, or tap Split on a purchase in Spending or a bill in Upkeep.</div>}
      {open.map(card)}
      {closed.length > 0 && <h2 className="text-sm font-semibold text-life-800 dark:text-life-50">All settled</h2>}
      {closed.map(card)}

      {data.history.length > 0 && (
        <section className={cardClass} data-history>
          <h2 className="font-semibold text-life-800 dark:text-life-50">Settled lately</h2>
          <ul className="divide-y divide-life-100 text-sm dark:divide-life-800">
            {data.history.map((h) => (
              <li key={h.id} className="flex items-center justify-between gap-2 py-2">
                <span className="min-w-0 text-gray-700 dark:text-life-100">{h.what}: {h.from} paid {h.to}<span className="text-xs text-gray-500 dark:text-life-300"> on {dayText(h.settled_on)}</span></span>
                <span className="tabular-nums text-gray-800 dark:text-life-50">{money(h.cents, sign)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
      {modal?.form && <Modal title={modal.form.split ? modal.form.split.what : 'Split something'} wide onClose={() => setModal(null)}><SplitForm {...modal.form} data={data} onDone={done} /></Modal>}
    </div>
  );
}

/** One person in the form: someone who signs in, or a typed name. */
function startRows(data, split) {
  const me = { key: `u${data.me.id}`, user_id: data.me.id, label: 'You', you: true, in: !split, mode: 'equal', value: '', paid: !split };
  const others = data.people.map((p) => ({ key: `u${p.id}`, user_id: p.id, label: p.name, in: false, mode: 'equal', value: '', paid: false }));
  const rows = [me, ...others];
  if (!split) return rows;
  const out = rows.map((r) => ({ ...r }));
  for (const x of split.shares) {
    const found = x.user_id !== null ? out.find((r) => r.user_id === x.user_id) : null;
    const row = { in: true, mode: 'amount', value: decimal(x.cents), paid: x.paid };
    if (found) Object.assign(found, row);
    else out.push({ key: `n${x.who}`, name: x.who, label: x.who, typed: true, ...row });
  }
  return out;
}

function SplitForm({ start = null, split = null, data, onDone }) {
  const sign = data.currency;
  const first = split ?? start ?? {};
  const [form, setForm] = useState({ what: split ? split.what : first.what || '', total: split ? decimal(split.total_cents) : first.total_cents ? decimal(first.total_cents) : '', day: split ? split.day : first.day || today(), note: split?.note || '' });
  const [rows, setRows] = useState(() => startRows(data, split));
  const [typed, setTyped] = useState('');
  const [preview, setPreview] = useState(null);
  const [hint, setHint] = useState('');
  const [error, setError] = useState('');
  const set = (name) => (e) => setForm({ ...form, [name]: e.target.value });
  const change = (key, patch) => setRows((list) => list.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const paidBy = (key) => setRows((list) => list.map((r) => ({ ...r, paid: r.key === key })));
  const here = rows.filter((r) => r.in);
  const body = () => ({
    what: form.what, total_cents: toCents(form.total), day: form.day, note: form.note || null, entry_id: first.entry_id ?? null, job_id: first.job_id ?? null,
    people: here.map((r) => ({
      ...(r.typed ? { name: r.name } : { user_id: r.user_id }), mode: r.mode, paid: r.paid,
      ...(r.mode === 'amount' ? { cents: toCents(r.value) } : {}), ...(r.mode === 'percent' ? { percent: r.value === '' ? null : Number(r.value) } : {}),
    })),
  });
  // What each person would get, worked out by Life Is as the form is filled in.
  const shape = JSON.stringify([form.total, here.map((r) => [r.key, r.mode, r.value, r.paid])]);
  useEffect(() => {
    const ok = here.length >= 2 && here.some((r) => r.paid) && toCents(form.total) > 0;
    if (!ok) { setPreview(null); setHint(here.length < 2 ? 'Check at least two people.' : !here.some((r) => r.paid) ? 'Say who paid.' : ''); return undefined; }
    let current = true;
    const timer = setTimeout(() => {
      axios.post('/api/splits/preview', body()).then(({ data: p }) => { if (current) { setPreview(p); setHint(''); } }).catch((err) => { if (current) { setPreview(null); setHint(errorMessage(err, '')); } });
    }, 250);
    return () => { current = false; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shape]);
  const addTyped = () => {
    const name = typed.trim();
    if (!name || rows.some((r) => r.label.toLowerCase() === name.toLowerCase())) return;
    setRows([...rows, { key: `n${name}`, name, label: name, typed: true, in: true, mode: 'equal', value: '', paid: false }]);
    setTyped('');
  };
  const submit = async (e) => {
    e.preventDefault();
    setError('');
    try {
      if (split) await axios.put(`/api/splits/${split.id}`, body()); else await axios.post('/api/splits', body());
      onDone();
    } catch (err) { setError(errorMessage(err, "Couldn't save that")); }
  };
  const shareOf = (r) => preview?.shares.find((x) => x.who === (r.you ? data.me.name : r.label));
  return (
    <form onSubmit={submit} className="space-y-3">
      <Field label="What it was *"><input required autoFocus={!split} value={form.what} onChange={set('what')} placeholder="Pizza night, the electric bill…" className={`${inputClass} min-h-[44px]`} /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="The whole thing came to *"><input required inputMode="decimal" value={form.total} onChange={set('total')} className={`${inputClass} min-h-[44px]`} /></Field>
        <Field label="On"><input type="date" value={form.day} onChange={set('day')} className={`${inputClass} min-h-[44px]`} /></Field>
      </div>
      <fieldset>
        <legend className="text-sm font-medium text-gray-700 dark:text-life-100">Who is in it, and who paid</legend>
        <p className="mb-1 text-xs text-gray-500 dark:text-life-300">Everyone starts with an equal share. Give someone an amount or a percent if it is not equal. A name you type is only a label: that person cannot sign in or see anything.</p>
        <ul className="divide-y divide-life-100 dark:divide-life-800">
          {rows.map((r) => (
            <li key={r.key} className="py-1" data-person={r.label}>
              <div className="flex items-center gap-2">
                <label className="flex min-h-[44px] flex-1 items-center gap-2 text-sm text-gray-800 dark:text-life-50">
                  <input type="checkbox" checked={r.in} onChange={(e) => change(r.key, { in: e.target.checked, paid: e.target.checked ? r.paid : false })} className="h-5 w-5" /> {r.label}{r.typed && <span className="text-xs text-gray-500 dark:text-life-300"> (a name only)</span>}
                </label>
                {r.in && shareOf(r) && <span className="tabular-nums text-sm text-gray-700 dark:text-life-100" data-share-preview>{money(shareOf(r).cents, sign)}</span>}
                {r.typed && <button type="button" onClick={() => setRows(rows.filter((x) => x.key !== r.key))} aria-label={`Take ${r.label} out`} className="flex h-11 w-11 items-center justify-center text-gray-400 hover:text-red-600">✕</button>}
              </div>
              {r.in && (
                <div className="flex flex-wrap items-center gap-2 pb-1 pl-7">
                  <select value={r.mode} onChange={(e) => change(r.key, { mode: e.target.value })} aria-label={`How ${r.label} shares`} className={`${inputClass} min-h-[44px] !w-auto`}>
                    {MODES.map(([k, t]) => <option key={k} value={k}>{t}</option>)}
                  </select>
                  {r.mode !== 'equal' && <input inputMode="decimal" value={r.value} onChange={(e) => change(r.key, { value: e.target.value })} aria-label={r.mode === 'amount' ? `Amount for ${r.label}` : `Percent for ${r.label}`} placeholder={r.mode === 'amount' ? '0.00' : '%'} className={`${inputClass} min-h-[44px] !w-24`} />}
                  <label className="flex min-h-[44px] items-center gap-1 text-sm text-gray-700 dark:text-life-100"><input type="radio" name="paid" checked={r.paid} onChange={() => paidBy(r.key)} className="h-5 w-5" /> Paid it</label>
                </div>
              )}
            </li>
          ))}
        </ul>
        <div className="mt-1 flex gap-2">
          <input value={typed} onChange={(e) => setTyped(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTyped(); } }} aria-label="A name to type in" placeholder="Someone who does not sign in" className={`${inputClass} min-h-[44px]`} />
          <button type="button" onClick={addTyped} disabled={!typed.trim()} className={`${quietButtonClass} min-h-[44px]`}>Add</button>
        </div>
        {here.some((r) => r.mode !== 'equal') && <button type="button" onClick={() => setRows(rows.map((r) => ({ ...r, mode: 'equal', value: '' })))} className="mt-1 min-h-[44px] text-sm text-life-600 underline dark:text-life-200">Share equally again</button>}
      </fieldset>
      <p className={`text-xs ${hint ? 'text-amber-700 dark:text-amber-300' : 'text-gray-500 dark:text-life-300'}`} data-split-words>{hint || preview?.words || ''}</p>
      <Field label="A note"><input value={form.note} onChange={set('note')} className={`${inputClass} min-h-[44px]`} /></Field>
      {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
      <div className="flex justify-end"><button type="submit" className={`${buttonClass} min-h-[44px]`}>Save</button></div>
    </form>
  );
}
