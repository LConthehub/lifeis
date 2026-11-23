import { useCallback, useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import axios from 'axios';
import ArrangeAisles from '../components/ArrangeAisles';
import PasteList from '../components/PasteList';
import Scanner from '../components/Scanner';
import ShareList from '../components/ShareList';
import { lookUpProduct } from '../components/productLookup';
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
  const [sizes, setSizes] = useState({});           // sizes being typed, by line
  const [putAway, setPutAway] = useState(true);
  // How the list is laid out: by aisle, or by the store each thing is got at. Remembered on this device.
  const [by, setBy] = useState(() => { try { return window.localStorage.getItem('grocery-by') === 'shop' ? 'shop' : 'aisle'; } catch { return 'aisle'; } });
  // By store: whether to show only where you are (with what can be got anywhere). Remembered on this device.
  const [justHere, setJustHere] = useState(() => { try { return window.localStorage.getItem('grocery-just-here') === '1'; } catch { return false; } });
  const onlyHere = (on) => { setJustHere(on); try { window.localStorage.setItem('grocery-just-here', on ? '1' : '0'); } catch { /* remembered for this visit only */ } };
  const layOut = (how) => { setBy(how); try { window.localStorage.setItem('grocery-by', how); } catch { /* remembered for this visit only */ } };
  const [modal, setModal] = useState(null);
  const [message, setMessage] = useState(state?.added != null
    ? `${state.added} thing${state.added === 1 ? '' : 's'} from the week's meals.${state.check?.length ? ` You have some ${state.check.join(', ')}: check there's enough.` : ''}` : '');
  const loadShop = useCallback(() => axios.get('/api/shopping').then(({ data }) => setShop(data)).catch(() => {}), []);
  const load = useCallback(() => { axios.get('/api/kitchen/grocery').then(({ data }) => setItems(data)).catch(() => setItems([])); loadShop(); }, [loadShop]);
  useEffect(() => { load(); }, [load]);
  if (!items || !shop) return null;

  const sign = shop.currency;
  const lineOf = (g) => shop.lines.find((l) => l.id === g.id) || { price_cents: null, size: '', assumed: false, last: null, coupons: [], usual_store: null, usual_size: '', likely_store: null };
  const add = async (e) => {
    e.preventDefault();
    try {
      const { data } = await axios.post('/api/kitchen/grocery', { label: text });
      setItems(data); setText(''); loadShop();
    } catch (err) { setMessage(errorMessage(err, "Couldn't add it")); }
  };
  const price = async (g, cents, assumed = false, size = null) => {
    try { setShop((await axios.put(`/api/shopping/prices/${g.id}`, { cents, assumed, size: size || null })).data); } catch (err) { setMessage(errorMessage(err, "Couldn't save that price")); loadShop(); }
  };
  // Into the cart: with the price typed, or else last time's standing in. Out of it: the price goes too.
  const tick = async (g) => {
    const { data } = await axios.post(`/api/kitchen/grocery/${g.id}/tick`, { done: !g.done, put_away: putAway });
    setItems(data);
    if (g.done) { await price(g, null); return; }
    const mine = centsOf(typed[g.id] ?? '');
    const last = lineOf(g).last;
    const size = (sizes[g.id] ?? '').trim();
    if (mine !== null) await price(g, mine, false, size); else if (last) await price(g, last.cents, true, size); else loadShop();
    setTyped((all) => ({ ...all, [g.id]: undefined }));
    setSizes((all) => ({ ...all, [g.id]: undefined }));
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
  // The heading each thing sits under. By store, where you are now comes first and "any store" last.
  const groupOf = (g) => (by === 'shop' ? lineOf(g).likely_store || 'Any store' : g.aisle || 'Everything else');
  const here = (shop.store || '').toLowerCase();
  // By aisle at a store with an order of its own: the aisles run in that order, any not in it after, as before.
  const walk = shop.aisle_order ? shop.aisle_order.map((a) => a.toLowerCase()) : [];
  const walked = (a) => { const i = walk.indexOf(a.toLowerCase()); return i < 0 ? 1e9 : i; };
  const aisles = [...new Set(open.map(groupOf))].sort((a, b) => (by !== 'shop' ? walked(a) - walked(b)
    : (b.toLowerCase() === here) - (a.toLowerCase() === here) || (a === 'Any store') - (b === 'Any store') || a.localeCompare(b)));
  const isHere = (group) => group.toLowerCase() === here;
  const canNarrow = by === 'shop' && aisles.some(isHere) && aisles.some((a) => !isHere(a) && a !== 'Any store');
  const shownGroups = canNarrow && justHere ? aisles.filter((a) => isHere(a) || a === 'Any store') : aisles;
  const elsewhere = open.filter((g) => !shownGroups.includes(groupOf(g))).length;
  const t = shop.totals;
  const anyMoney = t.trolley_cents > 0 || t.left_cents > 0 || shop.coupons.length > 0;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-xl font-semibold text-life-800 dark:text-life-50">Groceries</h1>
        <button type="button" onClick={() => setModal({ scan: true })} className={quietButtonClass}>📷 Scan</button>
        <button type="button" onClick={low} className={quietButtonClass}>Add what's running low</button>
        {items.length > 0 && <button type="button" onClick={() => setModal({ share: true })} className={`${quietButtonClass} min-h-[44px]`}>Share the list</button>}
      </div>
      {message && <p className="rounded-lg bg-life-50 px-3 py-2 text-sm text-life-800 dark:bg-life-800 dark:text-life-100">{message}</p>}

      {/* The running total: stays in sight while the list scrolls. */}
      {items.length > 0 && (
        <div className="sticky top-14 z-20 rounded-2xl bg-life-700 px-4 py-3 text-white shadow-lg sm:top-24" aria-live="polite">
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <p className="mr-auto"><span className="text-xs uppercase tracking-wide text-white/70">In the buggy</span> <span className="text-2xl font-semibold" data-total="trolley">{money(t.trolley_cents, sign)}</span></p>
            {t.coupons_cents > 0 && <p className="text-sm">coupons −{money(t.coupons_cents, sign)} · <span className="font-semibold" data-total="to-pay">to pay {money(t.to_pay_cents, sign)}</span></p>}
          </div>
          <p className="text-xs text-white/80">
            {open.length === 0 ? 'Everything is in.' : t.left_cents > 0 ? `About ${money(t.left_cents, sign)} still to get, going by last time` : 'Type a price as each thing goes in'}
            {open.length > 0 && t.left_unknown > 0 && t.left_cents > 0 && `, and ${t.left_unknown} with no price yet`}
            {t.trolley_unpriced > 0 && ` · ${t.trolley_unpriced} in the buggy with no price`}
          </p>
        </div>
      )}

      <div className="flex flex-wrap items-end gap-2">
        <form onSubmit={add} className="flex w-full min-w-0 gap-2 sm:w-auto sm:flex-1">
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Add something: 2 lb chicken thighs" aria-label="Add to the list" className={inputClass} />
          <button type="submit" disabled={!text.trim()} className={buttonClass}>Add</button>
        </form>
        <button type="button" onClick={() => setModal({ paste: true })} className="min-h-[44px] px-1 text-sm text-life-600 underline dark:text-life-200">Paste a list</button>
        <label className="w-full text-xs text-gray-600 dark:text-life-200 sm:w-40">Shopping at
          <input key={shop.store || ''} list="my-shops" defaultValue={shop.store || ''} onBlur={saveStore} placeholder="which store" aria-label="Shopping at" className={`${inputClass} mt-0.5`} />
        </label>
        <datalist id="my-shops">{shop.stores.map((name) => <option key={name} value={name} />)}</datalist>
      </div>

      {open.length > 1 && (
        <div className="flex items-center gap-1.5 text-sm" role="group" aria-label="How the list is laid out">
          <span className="text-xs text-gray-500 dark:text-life-300">Laid out</span>
          {[['aisle', 'by aisle'], ['shop', 'by store']].map(([how, label]) => (
            <button key={how} type="button" onClick={() => layOut(how)} aria-pressed={by === how}
              className={`rounded-full px-3 py-1 ${by === how ? 'bg-life-600 text-white' : 'bg-card text-life-700 ring-1 ring-life-100 hover:bg-life-50 dark:bg-life-800 dark:text-life-100 dark:ring-life-700'}`}>{label}</button>
          ))}
          {canNarrow && (
            <label className="ml-auto flex cursor-pointer items-center gap-1.5 text-xs text-gray-600 dark:text-life-200">
              <input type="checkbox" checked={justHere} onChange={(e) => onlyHere(e.target.checked)} className="accent-life-600" />
              Just {shop.store}
            </label>
          )}
        </div>
      )}
      {by === 'aisle' && shop.store_id !== null && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500 dark:text-life-300">
          <button type="button" onClick={() => setModal({ arrange: true })} className={`${quietButtonClass} min-h-[44px]`}>Arrange aisles for {shop.store}</button>
          {shop.aisle_order ? <span>In {shop.store}'s order.</span> : <span>The usual order.</span>}
        </div>
      )}
      <div className={cardClass}>
        {open.length === 0 ? <p className="py-4 text-center text-sm text-gray-500 dark:text-life-200">Nothing to buy. Plan the week and press "Make the grocery list", or add things here.</p> : shownGroups.map((aisle) => (
          <div key={aisle} className="mb-3 last:mb-0">
            {(aisles.length > 1 || by === 'shop') && <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-life-600 dark:text-life-300">{aisle}{by === 'shop' && aisle.toLowerCase() === here && <span className="ml-2 normal-case text-gray-500 dark:text-life-300">where you are</span>}</h2>}
            <ul className="divide-y divide-life-50 dark:divide-life-700">
              {open.filter((g) => groupOf(g) === aisle).map((g) => {
                const l = lineOf(g);
                return (
                  <li key={g.id} className="flex items-center gap-3 py-2">
                    <input type="checkbox" checked={false} onChange={() => tick(g)} aria-label={`Got ${g.label}`} className="h-5 w-5 accent-life-600" />
                    <span className="min-w-0 flex-1 text-sm">
                      {g.ingredient_id
                        ? <button type="button" onClick={() => setModal({ usual: g })} aria-label={`${g.label}: where and what size`} className="text-left text-gray-800 hover:underline dark:text-life-50">{g.label}</button>
                        : <span className="text-gray-800 dark:text-life-50">{g.label}</span>}
                      {(g.amount || l.usual_size) && <span className="ml-2 text-gray-500 dark:text-life-300">{g.amount || l.usual_size}</span>}
                      {by !== 'shop' && l.usual_store && <span className="ml-2 rounded bg-life-50 px-1.5 text-[11px] text-life-700 dark:bg-life-700 dark:text-life-100">{l.usual_store}</span>}
                      {l.coupons.length > 0 && <span className="ml-2 rounded bg-honey-100 px-1.5 text-[11px] text-honey-700">🎟 coupon</span>}
                      {g.note && <span className="block text-xs text-gray-400">{g.note}</span>}
                      {l.last && (
                        <button type="button" onClick={() => setModal({ history: g })} className="block text-xs text-gray-500 hover:underline dark:text-life-300">
                          last time {money(l.last.cents, sign)}{l.last.amount ? ` for ${l.last.amount}` : ''}{l.last.store ? ` · ${l.last.store}` : ''} · {shortDay(l.last.day)}
                        </button>
                      )}
                    </span>
                    {/* The list gives no amount, so the size is whatever was picked up: a 30 oz tin, a dozen. */}
                    {!g.amount && (
                      <input value={sizes[g.id] ?? ''} onChange={(e) => setSizes({ ...sizes, [g.id]: e.target.value })} placeholder={l.usual_size || l.last?.amount || 'size'}
                        aria-label={`Size of ${g.label}`} className={`${inputClass} !w-16 !px-2 text-center`} />
                    )}
                    <input inputMode="decimal" value={typed[g.id] ?? ''} onChange={(e) => setTyped({ ...typed, [g.id]: e.target.value })} placeholder={l.last ? (l.last.cents / 100).toFixed(2) : 'price'}
                      aria-label={`Price of ${g.label}`} className={`${inputClass} !w-20 text-right`} />
                    <button type="button" onClick={() => remove(g)} className="text-xs text-gray-400 hover:text-red-600" aria-label={`Remove ${g.label}`}>✕</button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
        {elsewhere > 0 && <p className="mt-2 text-xs text-gray-500 dark:text-life-300">{elsewhere} more for other stores. Uncheck "Just {shop.store}" to see {elsewhere === 1 ? 'it' : 'them'}.</p>}
      </div>
      <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-life-200">
        <input type="checkbox" checked={putAway} onChange={(e) => setPutAway(e.target.checked)} className="accent-life-600" /> Checking something off adds it to the pantry
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
                  <span className="flex-1 text-sm text-gray-400"><span className="line-through">{g.label} {g.amount}</span>{!g.amount && l.size && <span className="ml-1 text-xs">{l.size}</span>}</span>
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
                    {[c.ingredient ? `for ${c.ingredient}` : 'for the whole trip', c.store && `at ${c.store}`, c.code && `code ${c.code}`, c.note].filter(Boolean).join(' · ')}
                  </span>
                </button>
                {c.used_on ? <span className="text-xs text-life-700 dark:text-life-200">−{money(c.worth_cents, sign)}</span>
                  : runsOut(c) && <span className={`rounded px-1.5 text-[11px] ${c.days_left <= 2 ? 'bg-honey-100 text-honey-700' : 'text-gray-500 dark:text-life-300'}`}>{runsOut(c)}</span>}
              </li>
            ))}
          </ul>
        )}
        {shop.coupons.length > 0 && <p className="mt-1 text-xs text-gray-500 dark:text-life-300">Check one to use it on today's trip.</p>}
      </div>

      {anyMoney && (
        <label className="flex items-center gap-2 text-xs text-gray-500 dark:text-life-300">Prices are shown in
          <select value={sign} onChange={async (e) => setShop((await axios.put('/api/shopping/settings', { currency: e.target.value })).data)} aria-label="Money sign" className="rounded border border-life-200 bg-card px-1 py-0.5 text-gray-800 dark:border-life-700 dark:bg-life-800 dark:text-life-50">
            {[...new Set([sign, '$', '£', '€', 'kr', '¥', '₹', 'R'])].map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
      )}

      {modal?.price && (
        <Modal title={modal.price.label} onClose={() => setModal(null)}>
          <PriceForm line={lineOf(modal.price)} fixedSize={modal.price.amount} sign={sign} onSave={async (cents, size) => { await price(modal.price, cents, false, size); setModal(null); }} />
        </Modal>
      )}
      {modal?.scan && (
        <Modal title="Scan a grocery" onClose={() => { setModal(null); load(); }}>
          <ScanGrocery open={open} sign={sign} putAway={putAway} onChanged={load} />
        </Modal>
      )}
      {modal?.arrange && (
        <Modal title={`Aisles at ${shop.store}`} onClose={() => setModal(null)}>
          <ArrangeAisles shop={shop} onSaved={(data) => { setShop(data); setModal(null); }} />
        </Modal>
      )}
      {modal?.share && (
        <Modal title="Share the list" onClose={() => setModal(null)}>
          <ShareList items={items} lines={shop.lines} store={shop.store} startGrouping={by === 'shop' ? 'store' : 'aisle'} />
        </Modal>
      )}
      {modal?.paste && (
        <Modal title="Paste a list" onClose={() => setModal(null)}>
          <PasteList onDone={(data) => {
            setItems(data.items); setModal(null); loadShop();
            setMessage(`Added ${data.added} thing${data.added === 1 ? '' : 's'}${data.already ? `, and ${data.already} ${data.already === 1 ? 'was' : 'were'} already on the list` : ''}.`);
          }} />
        </Modal>
      )}
      {modal?.usual && (
        <Modal title={modal.usual.label} onClose={() => setModal(null)}>
          <UsualForm line={lineOf(modal.usual)} hasAmount={Boolean(modal.usual.amount)} onSave={async (body) => { setShop((await axios.put(`/api/shopping/usual/${modal.usual.id}`, body)).data); setModal(null); }} />
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

function PriceForm({ line, fixedSize, sign, onSave }) {
  const [text, setText] = useState(line.price_cents === null ? '' : (line.price_cents / 100).toFixed(2));
  const [size, setSize] = useState(line.size || line.last?.amount || '');
  const cents = centsOf(text);
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSave(text.trim() === '' ? null : cents, fixedSize ? null : size); }} className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Field label={`What it cost (${sign})`}><input autoFocus inputMode="decimal" value={text} onChange={(e) => setText(e.target.value)} className={inputClass} /></Field>
        {fixedSize ? <Field label="For"><input value={fixedSize} disabled className={inputClass} /></Field>
          : <Field label="The size you bought"><input value={size} onChange={(e) => setSize(e.target.value)} placeholder="30 oz, 2 lb, 6" className={inputClass} /></Field>}
      </div>
      {!fixedSize && <p className="text-xs text-gray-500 dark:text-life-300">With a size, stores and package sizes can be compared for one ounce, pound or each.</p>}
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
            <option value="">The whole trip</option>
            {lines.map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}
          </select>
        </Field>
      ) : <p className="text-xs text-gray-500 dark:text-life-300">{coupon.ingredient ? `For ${coupon.ingredient}.` : 'For the whole trip.'}</p>}
      <div className="grid grid-cols-2 gap-3">
        <Field label="It takes off">
          <select value={form.kind} onChange={set('kind')} className={inputClass}><option value="money">An amount ({sign})</option><option value="percent">A percentage (%)</option></select>
        </Field>
        <Field label={form.kind === 'money' ? `How much (${sign}) *` : 'How much (%) *'}><input required inputMode="decimal" value={form.value} onChange={set('value')} placeholder={form.kind === 'money' ? '2.00' : '10'} className={inputClass} /></Field>
        <Field label="Only at"><input list="my-shops" value={form.store} onChange={set('store')} placeholder="any store" className={inputClass} /></Field>
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

/**
 * Scan something in the store. Known and on the list: type its price and it goes in the cart. Not seen
 * before: say which thing on the list it is (or add it), and it's known from then on.
 */
function ScanGrocery({ open, sign, putAway, onChanged }) {
  const [round, setRound] = useState(0);
  const [seen, setSeen] = useState(null);           // what the last scan turned out to be
  const [product, setProduct] = useState(null);     // its name from the lookup, when that's on
  const [text, setText] = useState('');
  const [which, setWhich] = useState('');
  const [name, setName] = useState('');
  const [size, setSize] = useState('');
  const [done, setDone] = useState('');
  const [error, setError] = useState('');
  const again = () => { setSeen(null); setProduct(null); setText(''); setWhich(''); setName(''); setSize(''); setError(''); setRound(round + 1); };
  const look = useCallback(async (code) => {
    setDone(''); setError('');
    try {
      const { data } = await axios.get('/api/shopping/scan', { params: { code } });
      setSeen(data);
      setSize(data.ingredient?.size || data.last?.amount || '');
      if (!data.ingredient) {
        // A new product: if looking groceries up is on, ask what it's called, to save typing.
        const found = await lookUpProduct(data.barcode);
        if (found) { setProduct(found); setName(found.name); setSize(found.size || ''); }
      }
    } catch (err) { setError(errorMessage(err, "Couldn't look that up")); setSeen({ failed: true }); }
  }, []);
  if (!seen) return <div className="space-y-2">{done && <p className="rounded-lg bg-life-100 px-3 py-2 text-sm text-life-800">{done}</p>}<Scanner key={round} onCode={look} label="Point the camera at the barcode on the package" /></div>;
  const another = <button type="button" onClick={again} className={quietButtonClass}>Scan another</button>;
  if (seen.failed) return <div className="space-y-3"><p className="text-sm text-red-600">{error}</p>{another}</div>;

  const inTrolley = async (line, barcode) => {
    try {
      await axios.post(`/api/kitchen/grocery/${line.id}/tick`, { done: true, put_away: putAway });
      const cents = centsOf(text);
      const bought = line.amount ? null : size.trim() || null;   // the list's own amount stands when it has one
      if (cents !== null) await axios.put(`/api/shopping/prices/${line.id}`, { cents, barcode, size: bought });
      else if (seen.last) await axios.put(`/api/shopping/prices/${line.id}`, { cents: seen.last.cents, assumed: true, barcode, size: bought });
      onChanged();
      setDone(`${line.label} is in the buggy${cents !== null ? ` at ${money(cents, sign)}` : seen.last ? ` (≈ ${money(seen.last.cents, sign)}, last time's price)` : ''}.`);
      again();
    } catch (err) { setError(errorMessage(err, "Couldn't do that")); }
  };
  const addToList = async (label) => {
    const { data } = await axios.post('/api/kitchen/grocery', { label });
    onChanged();
    // The line just added is the newest one still to get.
    return data.filter((g) => !g.done).reduce((a, b) => (b.id > a.id ? b : a));
  };
  // Say what a new barcode is: one of the lines, or something new that goes on the list.
  const teach = async (e) => {
    e.preventDefault();
    setError('');
    try {
      const line = which === '' ? await addToList(name) : { id: Number(which) };
      const label = product ? [product.name, product.brand, product.size].filter(Boolean).join(', ') : null;
      setSeen((await axios.put('/api/shopping/scan', { code: seen.barcode, grocery_id: line.id, product: label, size: size.trim() || null })).data);
    } catch (err) { setError(errorMessage(err, "Couldn't save that")); }
  };

  if (!seen.ingredient) {
    return (
      <form onSubmit={teach} className="space-y-3">
        <p className="text-sm text-gray-800 dark:text-life-50">Life Is hasn't seen this one before (<span className="font-mono">{seen.barcode}</span>). Say what it is once, and it's known from then on.</p>
        {product && <p className="rounded-lg bg-life-50 px-3 py-2 text-sm text-gray-800 dark:bg-life-700 dark:text-life-50"><span className="block text-xs text-gray-500 dark:text-life-300">Open Food Facts says it's</span>{[product.name, product.brand, product.size].filter(Boolean).join(' · ')}</p>}
        <Field label="It's this, on the list">
          <select value={which} onChange={(e) => setWhich(e.target.value)} className={inputClass}>
            <option value="">Something not on the list yet</option>
            {open.filter((g) => g.ingredient_id).map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}
          </select>
        </Field>
        {which === '' && <Field label="What to call it on the list *"><input required value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. coffee" className={inputClass} /></Field>}
        <Field label="The size on the package"><input value={size} onChange={(e) => setSize(e.target.value)} placeholder="30 oz, 400 g, 6" className={inputClass} /></Field>
        {which === '' && <p className="text-xs text-gray-500 dark:text-life-300">Use the everyday name ("coffee", not the brand), so recipes and the pantry know it as the same thing. It's added to the list.</p>}
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex items-center justify-end gap-2">{another}<button type="submit" className={buttonClass}>That's what it is</button></div>
      </form>
    );
  }
  const what = <p className="text-sm text-gray-800 dark:text-life-50"><span className="font-medium">{seen.ingredient.name}</span>{(seen.ingredient.product || seen.ingredient.size) && <span className="block text-xs text-gray-500 dark:text-life-300">{[seen.ingredient.product, seen.ingredient.size].filter(Boolean).join(' · ')}</span>}</p>;
  const lastLine = seen.last && <p className="text-xs text-gray-500 dark:text-life-300">Last time {money(seen.last.cents, sign)}{seen.last.amount ? ` for ${seen.last.amount}` : ''}{seen.last.store ? ` at ${seen.last.store}` : ''}, {shortDay(seen.last.day)}.</p>;
  if (seen.line?.done) return <div className="space-y-3">{what}<p className="text-sm text-gray-600 dark:text-life-100">That's already in the buggy.</p>{lastLine}{another}</div>;
  if (!seen.line) {
    return (
      <div className="space-y-3">
        {what}{lastLine}
        <p className="text-sm text-gray-600 dark:text-life-100">It isn't on the list.</p>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex items-center justify-end gap-2">{another}
          <button type="button" onClick={async () => { const line = await addToList(seen.ingredient.name); setSeen({ ...seen, line: { id: line.id, label: line.label, amount: line.amount, done: false } }); }} className={buttonClass}>Add it to the list</button>
        </div>
      </div>
    );
  }
  return (
    <form onSubmit={(e) => { e.preventDefault(); inTrolley(seen.line, seen.barcode); }} className="space-y-3">
      {what}
      <p className="text-sm text-gray-600 dark:text-life-100">On the list{seen.line.amount ? `: ${seen.line.amount}` : ''}.</p>
      <div className="grid grid-cols-2 gap-3">
        <Field label={`What it costs (${sign})`}><input autoFocus inputMode="decimal" value={text} onChange={(e) => setText(e.target.value)} placeholder={seen.last ? (seen.last.cents / 100).toFixed(2) : 'price'} className={inputClass} /></Field>
        {!seen.line.amount && <Field label="Size"><input value={size} onChange={(e) => setSize(e.target.value)} placeholder="30 oz" className={inputClass} /></Field>}
      </div>
      {lastLine}
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex items-center justify-end gap-2">{another}<button type="submit" className={buttonClass}>In the buggy</button></div>
    </form>
  );
}

/** Where a thing is usually bought, and in what size. Kept for the thing, so it holds every time it's on the list. */
function UsualForm({ line, hasAmount, onSave }) {
  const [form, setForm] = useState({ store: line.usual_store || '', size: line.usual_size || '' });
  const [error, setError] = useState('');
  const submit = async (e) => {
    e.preventDefault();
    try { await onSave({ store: form.store.trim() || null, size: form.size.trim() || null }); } catch (err) { setError(errorMessage(err, "Couldn't save")); }
  };
  return (
    <form onSubmit={submit} className="space-y-3">
      <Field label="Usually bought at"><input list="my-shops" value={form.store} onChange={(e) => setForm({ ...form, store: e.target.value })} placeholder={line.likely_store ? `last time: ${line.likely_store}` : 'any store'} className={inputClass} /></Field>
      <Field label="Usual size"><input value={form.size} onChange={(e) => setForm({ ...form, size: e.target.value })} placeholder="30 oz, 3 lb, 6" className={inputClass} /></Field>
      <p className="text-xs text-gray-500 dark:text-life-300">
        This is remembered for the thing itself, so it's here every time it's on the list. The store lets the list be laid out by store.
        The size shows on the list when a line gives no amount{hasAmount ? ' (this one does, so its own amount is used)' : ''}, and is the size a price is taken to be for unless you type another.
      </p>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="text-right"><button type="submit" className={buttonClass}>Save</button></div>
    </form>
  );
}
