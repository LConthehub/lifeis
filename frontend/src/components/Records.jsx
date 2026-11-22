import { useCallback, useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { shrink } from './shrink';
import { Field, inputClass, buttonClass, quietButtonClass, cardClass, errorMessage } from './ui';
import { inApp } from '../where';

export const money = (cents) => (cents == null ? '' : (cents / 100).toLocaleString(undefined, { style: 'currency', currency: 'USD' }));
const dayText = (day) => new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
const centsOf = (text) => (String(text).trim() === '' ? null : Math.round(Number(String(text).replace(/[^0-9.]/g, '')) * 100));
const KINDS = [['receipt', '🧾 Receipt'], ['manual', '📖 Manual'], ['warranty', '🛡 Warranty'], ['other', '📄 Something else']];
const base64 = (buffer) => { let s = ''; const b = new Uint8Array(buffer); for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(s); };

/** How long a warranty has left, in words, and whether that's pressing. */
export function warrantyText(item) {
  const d = item.warranty_days;
  if (d === null) return null;
  if (d < 0) return { text: `Warranty ended ${dayText(item.records.warranty_until)}`, tone: 'text-gray-500 dark:text-life-300' };
  return { text: d === 0 ? 'Warranty ends today' : d <= 60 ? `Warranty ends in ${d} day${d === 1 ? '' : 's'}` : `Under warranty until ${dayText(item.records.warranty_until)}`,
    tone: d <= 30 ? 'text-honey-700' : 'text-life-700 dark:text-life-200' };
}

/**
 * A thing's home records: what it cost and where it came from, the numbers that identify it, its warranty,
 * what it's worth now, and its papers (a receipt, the manual). What an insurer or a repair shop asks for.
 */
export default function Records({ item, onChanged }) {
  const [editing, setEditing] = useState(false);
  const [papers, setPapers] = useState([]);
  const [kind, setKind] = useState('receipt');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const picker = useRef(null);
  const load = useCallback(() => { axios.get(`/api/things/items/${item.id}/documents`).then(({ data }) => setPapers(data)).catch(() => setPapers([])); }, [item.id]);
  useEffect(() => { load(); }, [load]);
  const r = item.records;
  const any = Object.values(r).some((v) => v !== null);
  const warranty = warrantyText(item);

  const add = async (file) => {
    if (!file) return;
    setBusy(true); setError('');
    try {
      // A photo is made smaller first; a PDF is kept as it is.
      const data = file.type === 'application/pdf' ? base64(await file.arrayBuffer()) : await shrink(file);
      setPapers((await axios.post(`/api/things/items/${item.id}/documents`, { kind, name: file.name, data })).data);
      onChanged?.();
    } catch (err) { setError(errorMessage(err, "That couldn't be kept")); }
    setBusy(false);
    if (picker.current) picker.current.value = '';
  };
  const remove = async (paper) => {
    if (!window.confirm(`Remove "${paper.name}"?`)) return;
    await axios.delete(`/api/things/documents/${paper.id}`).catch(() => {});
    load(); onChanged?.();
  };
  const open = async (paper) => {
    // In the app a paper is asked for the way everything is, and shown from memory.
    if (!inApp()) { window.open(`/api/things/documents/${paper.id}`, '_blank', 'noopener'); return; }
    const { data } = await axios.get(`/api/things/documents/${paper.id}`, { responseType: 'arraybuffer' });
    window.open(URL.createObjectURL(new Blob([data], { type: paper.type })), '_blank');
  };

  return (
    <section className={`${cardClass} space-y-3`} aria-label="Records">
      <div className="flex items-baseline gap-2">
        <h2 className="flex-1 font-semibold text-life-800 dark:text-life-50">Records</h2>
        {!editing && <button type="button" onClick={() => setEditing(true)} className="text-sm text-life-600 hover:underline dark:text-life-200">{any ? 'Change' : 'Add'}</button>}
      </div>
      {editing ? <RecordsForm item={item} onDone={(saved) => { setEditing(false); if (saved) onChanged?.(saved); }} /> : any ? (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm sm:grid-cols-3">
          {[['Bought', [r.bought_on && dayText(r.bought_on), r.bought_at].filter(Boolean).join(', ')], ['Paid', money(r.price_cents)], ['Worth now', money(r.value_cents)],
            ['Model', r.model], ['Serial number', r.serial]].filter(([, v]) => v).map(([label, value]) => (
            <div key={label}><dt className="text-xs text-gray-500 dark:text-life-300">{label}</dt><dd className="break-words text-gray-800 dark:text-life-50">{value}</dd></div>
          ))}
          {warranty && <div className="col-span-2 sm:col-span-3"><dd className={`text-sm ${warranty.tone}`}>🛡 {warranty.text}</dd></div>}
        </dl>
      ) : <p className="text-sm text-gray-500 dark:text-life-300">What it cost, its serial number and its warranty: what an insurer or a repair shop asks for.</p>}

      <div className="space-y-2 border-t border-life-50 pt-3 dark:border-life-700">
        <h3 className="text-xs font-medium text-gray-600 dark:text-life-200">Its papers</h3>
        {papers.length > 0 && (
          <ul className="space-y-1" aria-label="Papers">
            {papers.map((p) => (
              <li key={p.id} className="flex items-baseline gap-2 text-sm">
                <button type="button" onClick={() => open(p)} className="min-w-0 flex-1 truncate text-left text-life-700 hover:underline dark:text-life-100">{KINDS.find(([k]) => k === p.kind)[1].split(' ')[0]} {p.name}</button>
                <span className="text-xs text-gray-500 dark:text-life-300">{p.size > 1e6 ? `${(p.size / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(p.size / 1000))} KB`}</span>
                <button type="button" onClick={() => remove(p)} aria-label={`Remove ${p.name}`} className="text-xs text-gray-400 hover:text-red-600">✕</button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <select value={kind} onChange={(e) => setKind(e.target.value)} aria-label="What kind of paper" className={`${inputClass} !w-auto`}>
            {KINDS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
          </select>
          <input ref={picker} type="file" accept="application/pdf,image/*" className="hidden" aria-label="The paper's file" onChange={(e) => add(e.target.files?.[0])} />
          <button type="button" disabled={busy} onClick={() => picker.current?.click()} className={quietButtonClass}>{busy ? 'Keeping it…' : '+ Add a photo or PDF'}</button>
        </div>
        {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
      </div>
    </section>
  );
}

function RecordsForm({ item, onDone }) {
  const r = item.records;
  const [form, setForm] = useState({
    bought_on: r.bought_on || '', bought_at: r.bought_at || '', price: r.price_cents != null ? (r.price_cents / 100).toFixed(2) : '',
    value: r.value_cents != null ? (r.value_cents / 100).toFixed(2) : '', model: r.model || '', serial: r.serial || '', warranty_until: r.warranty_until || '',
  });
  const [error, setError] = useState('');
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const submit = async (e) => {
    e.preventDefault();
    const records = { bought_on: form.bought_on || null, bought_at: form.bought_at || null, price_cents: centsOf(form.price), value_cents: centsOf(form.value),
      model: form.model || null, serial: form.serial || null, warranty_until: form.warranty_until || null };
    if ([records.price_cents, records.value_cents].some((c) => c !== null && Number.isNaN(c))) { setError('An amount is a number, like 79.99'); return; }
    try { onDone((await axios.put(`/api/things/items/${item.id}`, { name: item.name, quantity: item.quantity, unit: item.unit, place_id: item.place_id, low_at: item.low_at, note: item.note, values: item.values, records })).data); }
    catch (err) { setError(errorMessage(err, "Couldn't save")); }
  };
  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Bought on"><input type="date" value={form.bought_on} onChange={set('bought_on')} className={inputClass} /></Field>
        <Field label="Bought at"><input value={form.bought_at} onChange={set('bought_at')} placeholder="The store, or who from" className={inputClass} /></Field>
        <Field label="What it cost"><input inputMode="decimal" value={form.price} onChange={set('price')} placeholder="0.00" className={inputClass} /></Field>
        <Field label="Worth now (if different)"><input inputMode="decimal" value={form.value} onChange={set('value')} placeholder="0.00" className={inputClass} /></Field>
        <Field label="Model"><input value={form.model} onChange={set('model')} className={inputClass} /></Field>
        <Field label="Serial number"><input value={form.serial} onChange={set('serial')} className={inputClass} /></Field>
        <Field label="Warranty until"><input type="date" value={form.warranty_until} onChange={set('warranty_until')} className={inputClass} /></Field>
      </div>
      {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={() => onDone(null)} className={quietButtonClass}>Cancel</button>
        <button type="submit" className={buttonClass}>Save</button>
      </div>
    </form>
  );
}
