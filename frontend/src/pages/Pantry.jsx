import { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import ScanToPantry from '../components/ScanToPantry';
import UseItUp from '../components/UseItUp';
import Art from '../components/Art';
import Modal, { Field, inputClass, buttonClass, quietButtonClass, cardClass, errorMessage } from '../components/ui';

const LOCATIONS = [['fridge', 'Fridge'], ['freezer', 'Freezer'], ['pantry', 'Cabinet'], ['spices', 'Spices'], ['other', 'Elsewhere']];
const BLANK = { name: '', quantity: '', unit: '', location: 'pantry', expires_on: '', low_at: '' };

/** What's in the house, where, how much, and what's running out or going off. */
export default function Pantry() {
  const [data, setData] = useState(null);
  const [editing, setEditing] = useState(null);
  const [q, setQ] = useState('');
  const [scanning, setScanning] = useState(false);
  const load = useCallback(() => { axios.get('/api/kitchen/pantry').then(({ data: d }) => setData(d)).catch(() => setData({ items: [], low: [], expiring: [] })); }, []);
  useEffect(() => { load(); }, [load]);
  if (!data) return null;
  const shown = data.items.filter((p) => !q || p.name.toLowerCase().includes(q.toLowerCase()));
  const edit = (p) => setEditing({ ...BLANK, ...p, quantity: p.quantity ?? '', unit: p.unit || '', location: p.location || 'pantry',
    expires_on: p.expires_on || '', low_at: p.low_at ?? '' });
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-xl font-semibold text-life-800 dark:text-life-50">Pantry</h1>
        <button type="button" onClick={() => setScanning(true)} className={`${quietButtonClass} min-h-[44px]`}>📷 Scan to add</button>
        <button type="button" onClick={() => setEditing({ ...BLANK })} className={`${buttonClass} min-h-[44px]`}>+ Add</button>
      </div>
      {(data.low.length > 0 || data.expiring.length > 0) && (
        <p className="rounded-lg bg-honey-100 px-3 py-2 text-sm text-honey-700">
          {data.low.length > 0 && <>Running low: {data.low.join(', ')}. </>}
          {data.expiring.length > 0 && <>Use soon: {data.expiring.join(', ')}.</>}
        </p>
      )}
      <UseItUp key={data.items.map((p) => `${p.id}${p.expires_on}`).join()} />
      {data.items.length > 6 && <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find something" aria-label="Find in the pantry" className={`${inputClass} max-w-sm`} />}
      {data.items.length === 0 ? (
        <div className={`${cardClass} text-center text-sm text-gray-500 dark:text-life-200`}><Art slot="empty" className="mx-auto mb-2 block h-12 w-12" />Nothing here yet. Add what you have, or check things off the grocery list and they land here.</div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {LOCATIONS.map(([id, label]) => {
            const here = shown.filter((p) => (p.location || 'pantry') === id);
            if (here.length === 0) return null;
            return (
              <section key={id} className={cardClass}>
                <h2 className="mb-1 font-semibold text-life-800 dark:text-life-50">{label}</h2>
                <ul className="divide-y divide-life-50 dark:divide-life-700">
                  {here.map((p) => (
                    <li key={p.id}>
                      <button type="button" onClick={() => edit(p)} className="flex w-full items-center gap-2 py-2 text-left">
                        <span className="flex-1 text-sm text-gray-800 dark:text-life-50">{p.name}</span>
                        {p.low && <span className="rounded bg-honey-100 px-1.5 text-[11px] text-honey-700">low</span>}
                        {p.days_left != null && p.days_left <= 3 && <span className="rounded bg-red-100 px-1.5 text-[11px] text-red-700">{p.days_left < 0 ? 'past its date' : p.days_left === 0 ? 'today' : `${p.days_left} days`}</span>}
                        <span className="text-sm text-gray-500 dark:text-life-300">{p.amount}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}
      {scanning && (
        <Modal title="Scan to add to the pantry" onClose={() => { setScanning(false); load(); }}>
          <ScanToPantry onChanged={load} />
        </Modal>
      )}
      {editing && (
        <Modal title={editing.id ? editing.name : 'Add to the pantry'} onClose={() => setEditing(null)}>
          <PantryForm item={editing} onDone={() => { setEditing(null); load(); }} />
        </Modal>
      )}
    </div>
  );
}

function PantryForm({ item, onDone }) {
  const [form, setForm] = useState(item);
  const [error, setError] = useState('');
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const submit = async (e) => {
    e.preventDefault();
    try {
      await axios.put('/api/kitchen/pantry', { name: form.name, quantity: form.quantity === '' ? null : Number(form.quantity), unit: form.unit || null,
        location: form.location, expires_on: form.expires_on || null, low_at: form.low_at === '' ? null : Number(form.low_at) });
      onDone();
    } catch (err) {
      setError(errorMessage(err, "Couldn't save"));
    }
  };
  const remove = async () => { await axios.delete(`/api/kitchen/pantry/${form.id}`).catch(() => {}); onDone(); };
  return (
    <form onSubmit={submit} className="space-y-3">
      <Field label="What *"><input required autoFocus={!form.id} readOnly={!!form.id} value={form.name} onChange={set('name')} placeholder="e.g. Flour" className={inputClass} /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="How much (empty: some)"><input type="number" min="0" step="any" value={form.quantity} onChange={set('quantity')} className={inputClass} /></Field>
        <Field label="Unit"><input list="pantry-units" value={form.unit} onChange={set('unit')} placeholder="g, lb, cup, can…" className={inputClass} /></Field>
      </div>
      <datalist id="pantry-units">{['g', 'kg', 'oz', 'lb', 'ml', 'l', 'cup', 'tbsp', 'tsp', 'can', 'jar', 'bag', 'box', 'package'].map((u) => <option key={u} value={u} />)}</datalist>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Where">
          <select value={form.location} onChange={set('location')} className={inputClass}>{LOCATIONS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select>
        </Field>
        <Field label="Use by"><input type="date" value={form.expires_on} onChange={set('expires_on')} className={inputClass} /></Field>
        <Field label="Low at"><input type="number" min="0" step="any" value={form.low_at} onChange={set('low_at')} className={inputClass} /></Field>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex items-center justify-between">
        {form.id ? <button type="button" onClick={remove} className="text-sm text-red-600 hover:underline">Remove</button> : <span />}
        <button type="submit" className={buttonClass}>Save</button>
      </div>
    </form>
  );
}
