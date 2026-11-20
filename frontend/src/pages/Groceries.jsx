import { useCallback, useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import axios from 'axios';
import Modal, { Field, inputClass, buttonClass, quietButtonClass, cardClass, errorMessage, fromDateInput } from '../components/ui';

/** Cents as money: 349 is $3.49. */
const money = (cents, sign) => `${sign}${(cents / 100).toFixed(2)}`;
/** What was typed as a price, in cents; null when it isn't one. "3.49", "3,49" and "$3.49" are all 349. */
const centsOf = (typed) => {
  const tidy = String(typed).replace(/[^\d.,]/g, '').replace(',', '.');
  const value = Number.parseFloat(tidy);
  return tidy && Number.isFinite(value) && value >= 0 ? Math.round(value * 100) : null;
};
const shortDay = (day) => fromDateInput(day).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
const couponWorth = (c, sign) => (c.percent_off !== null ? `${c.percent_off}% off` : `${money(c.cents_off, sign)} off`);
const runsOut = (c) => (c.days_left === null ? null : c.days_left < 0 ? 'ran out' : c.days_left === 0 ? 'last day today' : c.days_left === 1 ? 'runs out tomorrow' : `until ${shortDay(c.expires_on)}`);

/** The grocery list, by aisle, with what things cost as you shop. Ticking something off puts it in the pantry. */
export default function Groceries() {
  const { state } = useLocation();
  const [items, setItems] = useState(null);
  const [shop, setShop] = useState(null);
  const [text, setText] = useState('');
  const [typed, setTyped] = useState({});           // prices being typed, by line
  const [putAway, setPutAway] = useState(true);
  const [modal, setModal] = useState(null);
  const [message, setMessage] = useState(state?.added != null
    ? `${state.added} thing${state.added === 1 ? '' : 's'} from the week's meals.${state.check?.length ? ` You have some ${state.check.join(', ')}: check there's enough.` : ''}` : '');
  const loadShop = useCallback(() => axios.get('/api/shopping').then(({ data }) => setShop(data)).catch(() => {}), []);
  const load = useCallback(() => { axios.get('/api/kitchen/grocery').then(({ data }) => setItems(data)).catch(() => setItems([])); loadShop(); }, [loadShop]);
  useEffect(() => { load(); }, [load]);
  if (!items || !shop) return null;

  const sign = shop.currency;
  const lineOf = (g) => shop.lines.find((l) => l.id === g.id) || { price_cents: null, assumed: false, last: null, coupons: [] };
  const add = async (e) => {
    e.preventDefault();
    try {
      const { data } = await axios.post('/api/kitchen/grocery', { label: text });
      setItems(data); setText(''); loadShop();
    } catch (err) { setMessage(errorMessage(err, "Couldn't add it")); }
  };
  const price = async (g, cents, assumed = false) => { const { data } = await axios.put(`/api/shopping/prices/${g.id}`, { cents, assumed }); setShop(data); };
  // Into the trolley: with the price typed, or else last time's standing in. Out of it: the price goes too.
  const tick = async (g) => {
    const { data } = await axios.post(`/api/kitchen/grocery/${g.id}/tick`, { done: !g.done, put_away: putAway });
    setItems(data);
    if (g.done) { await price(g, null); return; }
    const mine = centsOf(typed[g.id] ?? '');
    const last = lineOf(g).last;
    if (mine !== null) await price(g, mine); else if (last) await price(g, last.cents, true); else loadShop();
    setTyped((all) => ({ ...all, [g.id]: undefined }));
  };
  const remove = async (g) => { await axios.delete(`/api/kitchen/grocery/${g.id}`).catch(() => {}); load(); };
  const clearDone = async () => { const { data } = await axios.post('/api/kitchen/grocery/clear-done'); setItems(data); loadShop(); };
  const low = async () => {
    const { data } = await axios.post('/api/kitchen/grocery/from-pantry-low');
    setItems(data.items); loadShop();
    setMessage(data.added ? `Added ${data.added} thing${data.added === 1 ? '' : 's'} running low in the pantry.` : 'Nothing in the pantry is running low.');
  };
  const saveStore = async (e) => { if ((e.target.value.trim() || null) !== shop.store) setShop((await axios.put('/api/shopping/settings', { store: e.target.value.trim() || null })).data); };
  const use = async (c) => setShop((await axios.post(`/api/shopping/coupons/${c.id}/use`, { using: !c.used_on })).data);

  const open = items.filter((g) => !g.done);
  const done = items.filter((g) => g.done);
  const aisles = [...new Set(open.map((g) => g.aisle || 'Everything else'))];
  const t = shop.totals;
  const anyMoney = t.trolley_cents > 0 || t.left_cents > 0 || shop.coupons.length > 0;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-xl font-semibold text-life-800 dark:text-life-50">Groceries</h1>
        <button type="button" onClick={low} className={quietButtonClass}>Add what's running low</button>
      </div>
      {message && <p className="rounded-lg bg-life-50 px-3 py-2 text-sm text-life-800 dark:bg-life-800 dark:text-life-100">{message}</p>}

      {/* The running total: stays in sight while the list scrolls. */}
      {items.length > 0 && (
        <div className="sticky top-14 z-20 rounded-2xl bg-life-700 px-4 py-3 text-white shadow-lg sm:top-24" aria-live="polite">
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <p className="mr-auto"><span className="text-xs uppercase tracking-wide text-white/70">In the trolley</span> <span className="text-2xl font-semibold" data-total="trolley">{money(t.trolley_cents, sign)}</span></p>
            {t.coupons_cents > 0 && <p className="text-sm">coupons −{money(t.coupons_cents, sign)} · <span className="font-semibold" data-total="to-pay">to pay {money(t.to_pay_cents, sign)}</span></p>}
          </div>
          <p className="text-xs text-white/80">
            {open.length === 0 ? 'Everything is in.' : t.left_cents > 0 ? `About ${money(t.left_cents, sign)} still to get, going by last time` : 'Type a price as each thing goes in'}
            {open.length > 0 && t.left_unknown > 0 && t.left_cents > 0 && `, and ${t.left_unknown} with no price yet`}
            {t.trolley_unpriced > 0 && ` · ${t.trolley_unpriced} in the trolley with no price`}
          </p>
        </div>
      )}

      <div className="flex flex-wrap items-end gap-2">
        <form onSubmit={add} className="flex w-full min-w-0 gap-2 sm:w-auto sm:flex-1">
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Add something: 2 lb chicken thighs" aria-label="Add to the list" className={inputClass} />
          <button type="submit" disabled={!text.trim()} className={buttonClass}>Add</button>
        </form>
        <label className="w-full text-xs text-gray-600 dark:text-life-200 sm:w-40">Shopping at
          <input defaultValue={shop.store || ''} onBlur={saveStore} placeholder="which shop" aria-label="Shopping at" className={`${inputClass} mt-0.5`} />
        </label>
      </div>

      <div className={cardClass}>
        {open.length === 0 ? <p className="py-4 text-center text-sm text-gray-500 dark:text-life-200">Nothing to buy. Plan the week and press "Make the grocery list", or add things here.</p> : aisles.map((aisle) => (
          <div key={aisle} className="mb-3 last:mb-0">
            {aisles.length > 1 && <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-life-600 dark:text-life-300">{aisle}</h2>}
            <ul className="divide-y divide-life-50 dark:divide-life-700">
              {open.filter((g) => (g.aisle || 'Everything else') === aisle).map((g) => {
                const l = lineOf(g);
                return (
                  <li key={g.id} className="flex items-center gap-3 py-2">
                    <input type="checkbox" checked={false} onChange={() => tick(g)} aria-label={`Got ${g.label}`} className="h-5 w-5 accent-life-600" />
                    <span className="min-w-0 flex-1 text-sm">
                      <span className="text-gray-800 dark:text-life-50">{g.label}</span>
                      {g.amount && <span className="ml-2 text-gray-500 dark:text-life-300">{g.amount}</span>}
                      {l.coupons.length > 0 && <span className="ml-2 rounded bg-honey-100 px-1.5 text-[11px] text-honey-700">🎟 coupon</span>}
                      {g.note && <span className="block text-xs text-gray-400">{g.note}</span>}
                      {l.last && (
                        <button type="button" onClick={() => setModal({ history: g })} className="block text-xs text-gray-500 hover:underline dark:text-life-300">
                          last time {money(l.last.cents, sign)}{l.last.amount ? ` for ${l.last.amount}` : ''}{l.last.store ? ` · ${l.last.store}` : ''} · {shortDay(l.last.day)}
                        </button>
                      )}
                    </span>
                    <input inputMode="decimal" value={typed[g.id] ?? ''} onChange={(e) => setTyped({ ...typed, [g.id]: e.target.value })} placeholder={l.last ? (l.last.cents / 100).toFixed(2) : 'price'}
                      aria-label={`Price of ${g.label}`} className={`${inputClass} !w-20 text-right`} />
                    <button type="button" onClick={() => remove(g)} className="text-xs text-gray-400 hover:text-red-600" aria-label={`Remove ${g.label}`}>✕</button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
      <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-life-200">
        <input type="checkbox" checked={putAway} onChange={(e) => setPutAway(e.target.checked)} className="accent-life-600" /> Ticking something off adds it to the pantry
      </label>

      {done.length > 0 && (
        <div className={cardClass}>
          <div className="mb-1 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-500 dark:text-life-300">Got it ({done.length})</h2>
            <button type="button" onClick={clearDone} className="text-xs text-life-600 hover:underline dark:text-life-200">Clear these</button>
          </div>
          <ul>
            {done.map((g) => {
              const l = lineOf(g);
              return (
                <li key={g.id} className="flex items-center gap-3 py-1">
                  <input type="checkbox" checked onChange={() => tick(g)} aria-label={`Not got ${g.label}`} className="h-5 w-5 accent-life-600" />
                  <span className="flex-1 text-sm text-gray-400 line-through">{g.label} {g.amount}</span>
                  <button type="button" onClick={() => setModal({ price: g })} aria-label={`Price of ${g.label}`}
                    className={`rounded px-1.5 text-sm ${l.price_cents === null ? 'text-life-600 underline dark:text-life-200' : l.assumed ? 'bg-honey-100 text-honey-700' : 'text-gray-700 dark:text-life-100'}`}>
                    {l.price_cents === null ? 'add price' : `${l.assumed ? '≈ ' : ''}${money(l.price_cents, sign)}`}
                  </button>
                </li>
              );
            })}
          </ul>
          {done.some((g) => lineOf(g).assumed) && <p className="mt-1 text-xs text-gray-500 dark:text-life-300">≈ is last time's price standing in. Tap it to put in what it really cost.</p>}
        </div>
      )}

      <div className={cardClass}>
        <div className="mb-2 flex items-baseline gap-2">
          <h2 className="flex-1 font-semibold text-life-800 dark:text-life-50">Coupons</h2>
          <button type="button" onClick={() => setModal({ coupon: {} })} className="text-sm text-life-600 hover:underline dark:text-life-200">+ Add a coupon</button>
        </div>
        {shop.coupons.length === 0 ? <p className="text-sm text-gray-400 dark:text-life-400">None. Add one and the list shows which thing it's for; using it takes it off the total.</p> : (
          <ul className="divide-y divide-life-50 dark:divide-life-700">
            {shop.coupons.map((c) => (
              <li key={c.id} className="flex items-start gap-3 py-2">
                <input type="checkbox" checked={Boolean(c.used_on)} onChange={() => use(c)} disabled={!c.used_on && c.days_left !== null && c.days_left < 0} aria-label={`Using ${c.label} today`} className="mt-0.5 h-5 w-5 accent-life-600" />
                <button type="button" onClick={() => setModal({ coupon: c })} className="min-w-0 flex-1 text-left text-sm">
                  <span className={c.days_left !== null && c.days_left < 0 ? 'text-gray-400 line-through' : 'text-gray-800 dark:text-life-50'}>{c.label}</span>
                  <span className="ml-2 font-medium text-life-700 dark:text-life-200">{couponWorth(c, sign)}</span>
                  <span className="block text-xs text-gray-500 dark:text-life-300">
                    {[c.ingredient ? `for ${c.ingredient}` : 'for the whole shop', c.store && `at ${c.store}`, c.code && `code ${c.code}`, c.note].filter(Boolean).join(' · ')}
                  </span>
                </button>
                {c.used_on ? <span className="text-xs text-life-700 dark:text-life-200">−{money(c.worth_cents, sign)}</span>
                  : runsOut(c) && <span className={`rounded px-1.5 text-[11px] ${c.days_left <= 2 ? 'bg-honey-100 text-honey-700' : 'text-gray-500 dark:text-life-300'}`}>{runsOut(c)}</span>}
              </li>
            ))}
          </ul>
        )}
        {shop.coupons.length > 0 && <p className="mt-1 text-xs text-gray-500 dark:text-life-300">Tick one to use it on today's shop.</p>}
      </div>

      {anyMoney && (
        <label className="flex items-center gap-2 text-xs text-gray-500 dark:text-life-300">Prices are shown in
          <select value={sign} onChange={async (e) => setShop((await axios.put('/api/shopping/settings', { currency: e.target.value })).data)} aria-label="Money sign" className="rounded border border-life-200 bg-white px-1 py-0.5 text-gray-800 dark:border-life-700 dark:bg-life-800 dark:text-life-50">
            {[...new Set([sign, '$', '£', '€', 'kr', '¥', '₹', 'R'])].map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
      )}

      {modal?.price && (
        <Modal title={modal.price.label} onClose={() => setModal(null)}>
          <PriceForm line={lineOf(modal.price)} sign={sign} onSave={async (cents) => { await price(modal.price, cents); setModal(null); }} />
        </Modal>
      )}
      {modal?.history && <Modal title={`${modal.history.label}: what it has cost`} onClose={() => setModal(null)}><History line={modal.history} sign={sign} /></Modal>}
      {modal?.coupon && (
        <Modal title={modal.coupon.id ? modal.coupon.label : 'A coupon'} onClose={() => setModal(null)}>
          <CouponForm coupon={modal.coupon} sign={sign} lines={open.filter((g) => g.ingredient_id)} store={shop.store} onDone={(data) => { setShop(data); setModal(null); }} />
        </Modal>
      )}
    </div>
  );
}

function PriceForm({ line, sign, onSave }) {
  const [text, setText] = useState(line.price_cents === null ? '' : (line.price_cents / 100).toFixed(2));
  const cents = centsOf(text);
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSave(text.trim() === '' ? null : cents); }} className="space-y-3">
      <Field label={`What it cost (${sign})`}><input autoFocus inputMode="decimal" value={text} onChange={(e) => setText(e.target.value)} className={inputClass} /></Field>
      {line.assumed && <p className="text-xs text-gray-500 dark:text-life-300">This is last time's price, standing in. Saving it here records it as what you paid today.</p>}
      <div className="flex items-center justify-between">
        <button type="button" onClick={() => onSave(null)} className="text-sm text-red-600 hover:underline">No price</button>
        <button type="submit" disabled={text.trim() !== '' && cents === null} className={buttonClass}>Save</button>
      </div>
    </form>
  );
}

function History({ line, sign }) {
  const [rows, setRows] = useState(null);
  useEffect(() => { axios.get(`/api/shopping/prices/${line.id}/history`).then(({ data }) => setRows(data)).catch(() => setRows([])); }, [line.id]);
  if (!rows) return null;
  if (rows.length === 0) return <p className="text-sm text-gray-600 dark:text-life-100">No prices yet.</p>;
  const lowest = Math.min(...rows.map((r) => r.cents));
  return (
    <ul className="divide-y divide-life-50 dark:divide-life-700">
      {rows.map((r, i) => (
        <li key={`${r.day}-${i}`} className="flex items-baseline gap-2 py-1.5 text-sm">
          <span className="w-20 font-medium text-gray-800 dark:text-life-50">{money(r.cents, sign)}</span>
          <span className="flex-1 text-gray-600 dark:text-life-200">{[r.amount && `for ${r.amount}`, r.store].filter(Boolean).join(' · ')}</span>
          {rows.length > 1 && r.cents === lowest && <span className="rounded bg-life-100 px-1.5 text-[11px] text-life-700">lowest</span>}
          <span className="text-xs text-gray-500 dark:text-life-300">{fromDateInput(r.day).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}</span>
        </li>
      ))}
    </ul>
  );
}

function CouponForm({ coupon, sign, lines, store, onDone }) {
  const [form, setForm] = useState({
    label: coupon.label || '', grocery_id: '', kind: coupon.percent_off != null ? 'percent' : 'money',
    value: coupon.percent_off != null ? String(coupon.percent_off) : coupon.cents_off != null ? (coupon.cents_off / 100).toFixed(2) : '',
    store: coupon.store ?? store ?? '', code: coupon.code || '', expires_on: coupon.expires_on || '', note: coupon.note || '',
  });
  const [error, setError] = useState('');
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const submit = async (e) => {
    e.preventDefault();
    const body = {
      label: form.label, grocery_id: form.grocery_id === '' ? null : Number(form.grocery_id), cents_off: form.kind === 'money' ? centsOf(form.value) : null,
      percent_off: form.kind === 'percent' ? Number(form.value) : null, store: form.store || null, code: form.code || null, expires_on: form.expires_on || null, note: form.note || null,
    };
    try { onDone((coupon.id ? await axios.put(`/api/shopping/coupons/${coupon.id}`, body) : await axios.post('/api/shopping/coupons', body)).data); } catch (err) { setError(errorMessage(err, "Couldn't save")); }
  };
  const remove = async () => onDone((await axios.delete(`/api/shopping/coupons/${coupon.id}`)).data);
  return (
    <form onSubmit={submit} className="space-y-3">
      <Field label="What it says *"><input required autoFocus={!coupon.id} value={form.label} onChange={set('label')} placeholder="e.g. $2 off any coffee" className={inputClass} /></Field>
      {!coupon.id ? (
        <Field label="What it's for">
          <select value={form.grocery_id} onChange={set('grocery_id')} className={inputClass}>
            <option value="">The whole shop</option>
            {lines.map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}
          </select>
        </Field>
      ) : <p className="text-xs text-gray-500 dark:text-life-300">{coupon.ingredient ? `For ${coupon.ingredient}.` : 'For the whole shop.'}</p>}
      <div className="grid grid-cols-2 gap-3">
        <Field label="It takes off">
          <select value={form.kind} onChange={set('kind')} className={inputClass}><option value="money">An amount ({sign})</option><option value="percent">A percentage (%)</option></select>
        </Field>
        <Field label={form.kind === 'money' ? `How much (${sign}) *` : 'How much (%) *'}><input required inputMode="decimal" value={form.value} onChange={set('value')} placeholder={form.kind === 'money' ? '2.00' : '10'} className={inputClass} /></Field>
        <Field label="Only at"><input value={form.store} onChange={set('store')} placeholder="any shop" className={inputClass} /></Field>
        <Field label="Good until"><input type="date" value={form.expires_on} onChange={set('expires_on')} className={inputClass} /></Field>
        <Field label="Code, if it has one"><input value={form.code} onChange={set('code')} className={inputClass} /></Field>
        <Field label="A note"><input value={form.note} onChange={set('note')} placeholder="in the app, in the drawer…" className={inputClass} /></Field>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex items-center justify-between">
        {coupon.id ? <button type="button" onClick={remove} className="text-sm text-red-600 hover:underline">Remove</button> : <span />}
        <button type="submit" className={buttonClass}>Save</button>
      </div>
    </form>
  );
}
