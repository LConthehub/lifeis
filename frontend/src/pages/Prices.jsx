import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import Modal, { Field, inputClass, buttonClass, quietButtonClass, cardClass, errorMessage, fromDateInput } from '../components/ui';

const money = (cents, sign) => `${cents < 0 ? '−' : ''}${sign}${(Math.abs(cents) / 100).toFixed(2)}`;
const valueOf = (p, t) => (t.basis === 'per' ? p.per_cents : p.cents);
const priced = (p, t, sign) => `${money(valueOf(p, t), sign)}${t.basis === 'per' ? ` / ${t.per}` : ''}`;
const dayText = (day, year = true) => fromDateInput(day).toLocaleDateString(undefined, { day: 'numeric', month: 'short', ...(year ? { year: 'numeric' } : {}) });
const monthText = (month) => fromDateInput(`${month}-01`).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

/** What things have cost, over time: each ingredient's prices compared like for like, and spending by month. */
export default function Prices() {
  const [data, setData] = useState(null);
  const [open, setOpen] = useState(null);
  useEffect(() => { axios.get('/api/shopping/trends').then(({ data: d }) => setData(d)).catch(() => setData({ currency: '$', trends: [], spending: [] })); }, []);
  const [shops, setShops] = useState([]);
  const [shop, setShop] = useState(null);
  useEffect(() => { axios.get('/api/shopping/stores').then(({ data: d }) => setShops(d)).catch(() => {}); }, []);
  if (!data) return null;
  const sign = data.currency;
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-life-800 dark:text-life-50">Prices</h1>
      {data.trends.length === 0 ? (
        <div className={`${cardClass} text-center text-sm text-gray-500 dark:text-life-200`}>
          Nothing yet. On the <Link to="/groceries" className="underline">grocery list</Link>, type what each thing costs as it goes in the trolley. This page then shows how its price moves, where it was cheapest, and what you spend each month.
        </div>
      ) : (
        <>
          {data.spending.length > 0 && (
            <section className={cardClass}>
              <h2 className="mb-2 font-semibold text-life-800 dark:text-life-50">Spent on groceries</h2>
              <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {data.spending.slice(0, 4).map((m) => (
                  <li key={m.month} className="rounded-lg bg-life-50/70 px-3 py-2 dark:bg-life-700/60">
                    <span className="block text-xs text-gray-600 dark:text-life-200">{monthText(m.month)}</span>
                    <span className="block text-2xl font-semibold text-life-700 dark:text-life-50">{money(m.cents, sign)}</span>
                    <span className="block text-xs text-gray-500 dark:text-life-300">{m.lines} {m.lines === 1 ? 'thing' : 'things'} priced</span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-[11px] text-gray-400 dark:text-life-400">Only what was given a price on the list, so a month's figure is as complete as the prices typed in.</p>
            </section>
          )}
          <section className={`${cardClass} !p-0`}>
            <table className="w-full text-sm">
              <caption className="sr-only">Each thing's latest price, how it changed, and where it was cheapest</caption>
              <thead>
                <tr className="text-left text-xs text-gray-500 dark:text-life-300">
                  <th scope="col" className="px-4 py-2 font-medium">Thing</th>
                  <th scope="col" className="px-2 py-2 text-right font-medium">Latest</th>
                  <th scope="col" className="hidden px-2 py-2 text-right font-medium sm:table-cell">Since last time</th>
                  <th scope="col" className="hidden px-4 py-2 font-medium md:table-cell">Cheapest</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-life-50 dark:divide-life-700">
                {data.trends.map((t) => (
                  <tr key={t.name} className="hover:bg-life-50 dark:hover:bg-life-700">
                    <th scope="row" className="px-4 py-2 text-left font-normal">
                      <button type="button" onClick={() => setOpen(t)} className="text-left text-gray-800 hover:underline dark:text-life-50">
                        {t.name} <span className="text-xs text-gray-500 dark:text-life-300">{t.times} {t.times === 1 ? 'price' : 'prices'}</span>
                      </button>
                    </th>
                    <td className="px-2 py-2 text-right tabular-nums text-gray-800 dark:text-life-50">{priced(t.latest, t, sign)}</td>
                    <td className="hidden px-2 py-2 text-right tabular-nums sm:table-cell"><Change cents={t.change_cents} sign={sign} /></td>
                    <td className="hidden px-4 py-2 text-gray-600 dark:text-life-200 md:table-cell">{t.times > 1 ? `${priced(t.lowest, t, sign)}${t.lowest.store ? ` at ${t.lowest.store}` : ''}` : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
          <p className="text-xs text-gray-500 dark:text-life-300">Where a thing was always bought by the same measure (2 lb, 5 lb), its prices are compared for one of that measure. Otherwise by the price as bought.</p>
        </>
      )}
      <section className={cardClass}>
        <div className="mb-2 flex items-baseline gap-2">
          <h2 className="flex-1 font-semibold text-life-800 dark:text-life-50">Your shops</h2>
          <button type="button" onClick={() => setShop({})} className="text-sm text-life-600 hover:underline dark:text-life-200">+ Add a shop</button>
        </div>
        {shops.length === 0 ? <p className="text-sm text-gray-400 dark:text-life-400">None yet. Add the shops you use, or just type one in "Shopping at" on the grocery list and it joins this list.</p> : (
          <ul className="divide-y divide-life-50 dark:divide-life-700">
            {shops.map((s) => (
              <li key={s.id}>
                <button type="button" onClick={() => setShop(s)} className="flex w-full items-baseline gap-2 py-1.5 text-left text-sm hover:underline">
                  <span className="flex-1 text-gray-800 dark:text-life-50">{s.name}{s.note && <span className="ml-2 text-xs text-gray-500 dark:text-life-300">{s.note}</span>}</span>
                  <span className="text-xs text-gray-500 dark:text-life-300">{s.prices === 0 ? 'no prices yet' : `${s.prices} ${s.prices === 1 ? 'price' : 'prices'}, last ${dayText(s.last_on, false)}`}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      {shop && <Modal title={shop.id ? shop.name : 'A shop'} onClose={() => setShop(null)}><ShopForm shop={shop} onDone={(list) => { setShops(list); setShop(null); axios.get('/api/shopping/trends').then(({ data: d }) => setData(d)).catch(() => {}); }} /></Modal>}
      {open && <Modal title={open.name} wide onClose={() => setOpen(null)}><TrendView trend={open} sign={sign} /></Modal>}
    </div>
  );
}

/** Up, down or the same, said in words and an arrow as well as shown. */
function Change({ cents, sign }) {
  if (cents === null) return <span className="text-gray-400 dark:text-life-400">first price</span>;
  if (cents === 0) return <span className="text-gray-500 dark:text-life-300">the same</span>;
  return <span className="text-gray-800 dark:text-life-50"><span aria-hidden="true">{cents > 0 ? '▲' : '▼'}</span> {cents > 0 ? 'up' : 'down'} {money(Math.abs(cents), sign)}</span>;
}

function TrendView({ trend: t, sign }) {
  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-600 dark:text-life-100">
        {t.basis === 'per' ? `Price for one ${t.per}.` : 'Price as bought.'} {t.times > 1 && <>Cheapest was {priced(t.lowest, t, sign)}{t.lowest.store ? ` at ${t.lowest.store}` : ''} on {dayText(t.lowest.day)}.</>}
      </p>
      {t.points.length > 1 && <PriceChart trend={t} sign={sign} />}
      {t.shops.length > 1 && (
        <div>
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-life-700 dark:text-life-200">By shop, latest price at each</h3>
          <ul className="flex flex-wrap gap-2">
            {t.shops.map((p, i) => (
              <li key={p.store} className="rounded-lg bg-life-50/70 px-3 py-1.5 text-sm dark:bg-life-700/60">
                <span className="text-gray-800 dark:text-life-50">{p.store}</span> <span className="font-semibold tabular-nums text-life-700 dark:text-life-50">{priced(p, t, sign)}</span>
                {i === 0 && <span className="ml-1 rounded bg-life-100 px-1.5 text-[11px] text-life-700">cheapest</span>}
                <span className="block text-[11px] text-gray-500 dark:text-life-300">{dayText(p.day)}{p.amount ? ` · ${p.amount}` : ''}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <table className="w-full text-sm">
        <caption className="sr-only">Every price, newest first</caption>
        <thead><tr className="text-left text-xs text-gray-500 dark:text-life-300"><th scope="col" className="py-1 font-medium">Day</th><th scope="col" className="py-1 font-medium">Where</th><th scope="col" className="py-1 text-right font-medium">Paid</th>{t.basis === 'per' && <th scope="col" className="py-1 text-right font-medium">For one {t.per}</th>}</tr></thead>
        <tbody className="divide-y divide-life-50 dark:divide-life-700">
          {[...t.points].reverse().map((p, i) => (
            <tr key={`${p.day}-${i}`}>
              <td className="py-1.5 text-gray-800 dark:text-life-50">{dayText(p.day)}</td>
              <td className="py-1.5 text-gray-600 dark:text-life-200">{p.store || ''}</td>
              <td className="py-1.5 text-right tabular-nums text-gray-800 dark:text-life-50">{money(p.cents, sign)}{p.amount && <span className="text-gray-500 dark:text-life-300"> for {p.amount}</span>}</td>
              {t.basis === 'per' && <td className="py-1.5 text-right tabular-nums text-gray-800 dark:text-life-50">{money(p.per_cents, sign)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * One thing's price over time: a single line, with a dot for each time it was bought. The latest and the
 * cheapest are labelled; the rest are read by pointing at a dot. The table beneath has every figure.
 */
function PriceChart({ trend: t, sign }) {
  const [at, setAt] = useState(null);
  const W = 640, H = 200, left = 52, right = 20, top = 22, bottom = 28;
  const values = t.points.map((p) => valueOf(p, t));
  const times = t.points.map((p) => fromDateInput(p.day).getTime());
  const [t0, t1] = [Math.min(...times), Math.max(...times)];
  // The scale runs a little past the prices on each side, on round figures, and doesn't pretend to start at nothing.
  const step = [1, 2, 5, 10, 20, 25, 50, 100, 200, 500, 1000, 2000, 5000].find((s) => (Math.max(...values) - Math.min(...values)) / s <= 3) || 10000;
  const low = Math.max(0, Math.floor((Math.min(...values) - step / 2) / step) * step);
  const high = Math.max(low + step, Math.ceil((Math.max(...values) + step / 2) / step) * step);
  const x = (time) => (t1 === t0 ? (left + W - right) / 2 : left + ((time - t0) / (t1 - t0)) * (W - left - right));
  const y = (v) => top + (1 - (v - low) / (high - low)) * (H - top - bottom);
  const dots = t.points.map((p, i) => ({ p, i, cx: x(times[i]), cy: y(values[i]), v: values[i] }));
  const ticks = [];
  for (let v = low; v <= high + 0.5; v += step) ticks.push(v);
  const lowest = dots.reduce((a, b) => (b.v < a.v ? b : a));
  const latest = dots[dots.length - 1];
  const labelled = lowest.i === latest.i ? [latest] : [lowest, latest];
  const shown = at === null ? null : dots[at];
  return (
    <figure className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${t.name}: ${t.times} prices from ${dayText(t.points[0].day)} to ${dayText(latest.p.day)}, latest ${priced(latest.p, t, sign)}`} className="w-full text-life-600 dark:text-life-300">
        {ticks.map((v) => (
          <g key={v}>
            <line x1={left} x2={W - right} y1={y(v)} y2={y(v)} className="stroke-gray-200 dark:stroke-life-700" strokeWidth="1" />
            <text x={left - 8} y={y(v) + 4} textAnchor="end" className="fill-gray-500 text-[11px] dark:fill-life-300">{money(v, sign)}</text>
          </g>
        ))}
        <text x={left} y={H - 8} className="fill-gray-500 text-[11px] dark:fill-life-300">{dayText(t.points[0].day)}</text>
        {t1 !== t0 && <text x={W - right} y={H - 8} textAnchor="end" className="fill-gray-500 text-[11px] dark:fill-life-300">{dayText(latest.p.day)}</text>}
        <polyline points={dots.map((d) => `${d.cx},${d.cy}`).join(' ')} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {dots.map((d) => <circle key={d.i} cx={d.cx} cy={d.cy} r={at === d.i ? 6 : 4.5} fill="currentColor" className="stroke-white dark:stroke-life-800" strokeWidth="2" />)}
        {labelled.map((d) => (
          <text key={`label-${d.i}`} x={Math.min(Math.max(d.cx, left + 30), W - right - 30)} y={d.cy - 11} textAnchor="middle" className="fill-gray-800 text-[12px] font-medium dark:fill-life-50">
            {money(d.v, sign)}{d.i === lowest.i && dots.length > 2 ? ' lowest' : ''}
          </text>
        ))}
        {/* What's pointed at is a good deal larger than the dot. */}
        {dots.map((d) => (
          <circle key={`hit-${d.i}`} cx={d.cx} cy={d.cy} r="18" fill="transparent" tabIndex="0" role="button"
            aria-label={`${dayText(d.p.day)}: ${priced(d.p, t, sign)}${d.p.store ? ` at ${d.p.store}` : ''}`}
            onMouseEnter={() => setAt(d.i)} onMouseLeave={() => setAt(null)} onFocus={() => setAt(d.i)} onBlur={() => setAt(null)} onClick={() => setAt(d.i)} className="cursor-pointer outline-none" />
        ))}
      </svg>
      {shown && (
        <div role="status" className="pointer-events-none absolute z-10 -translate-x-1/2 rounded-lg bg-gray-900 px-2.5 py-1.5 text-xs text-white shadow-lg"
          style={{ left: `${Math.min(Math.max((shown.cx / W) * 100, 16), 84)}%`, top: `${(shown.cy / H) * 100}%`, marginTop: 12 }}>
          <span className="block font-semibold">{priced(shown.p, t, sign)}</span>
          <span className="block text-white/80">{[dayText(shown.p.day), shown.p.store, shown.p.amount && `${money(shown.p.cents, sign)} for ${shown.p.amount}`].filter(Boolean).join(' · ')}</span>
        </div>
      )}
      <figcaption className="sr-only">Every figure is in the table below.</figcaption>
    </figure>
  );
}

function ShopForm({ shop, onDone }) {
  const [form, setForm] = useState({ name: shop.name || '', note: shop.note || '' });
  const [error, setError] = useState('');
  const submit = async (e) => {
    e.preventDefault();
    const body = { name: form.name, note: form.note || null };
    try { onDone((shop.id ? await axios.put(`/api/shopping/stores/${shop.id}`, body) : await axios.post('/api/shopping/stores', body)).data); } catch (err) { setError(errorMessage(err, "Couldn't save")); }
  };
  const remove = async () => onDone((await axios.delete(`/api/shopping/stores/${shop.id}`)).data);
  return (
    <form onSubmit={submit} className="space-y-3">
      <Field label="Its name *"><input required autoFocus={!shop.id} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Aldi on Main St" className={inputClass} /></Field>
      <Field label="A note"><input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="needs the card, closes at 8…" className={inputClass} /></Field>
      {shop.id && <p className="text-xs text-gray-500 dark:text-life-300">Renaming it renames it on every price and coupon. Removing it only takes it off this list: what you paid there stays.</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex items-center justify-between">
        {shop.id ? <button type="button" onClick={remove} className={quietButtonClass}>Take off the list</button> : <span />}
        <button type="submit" className={buttonClass}>Save</button>
      </div>
    </form>
  );
}
