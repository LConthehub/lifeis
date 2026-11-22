import { useState } from 'react';
import axios from 'axios';
import { inputClass, buttonClass, cardClass, errorMessage } from './ui';

/** Money as people write it ("45", "45.5", "1,200.00") to whole cents, or null when nothing was typed. */
export function toCents(typed) {
  const plain = String(typed ?? '').replace(/[^\d.]/g, '');
  if (!plain || Number.isNaN(Number(plain))) return null;
  return Math.round(Number(plain) * 100);
}
export const money = (cents, sign = '$') => `${cents < 0 ? '-' : ''}${sign}${(Math.abs(cents) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** What a project is planned to cost, line by line, and what each came to once paid. */
export default function Budget({ project, onChange }) {
  const { costs, budget } = project;
  const sign = budget.currency;
  const [label, setLabel] = useState('');
  const [planned, setPlanned] = useState('');
  const [paying, setPaying] = useState(null); // { id, amount }
  const [error, setError] = useState('');
  const act = async (request) => {
    setError('');
    try { onChange((await request).data); return true; } catch (err) { setError(errorMessage(err, "Couldn't save that")); return false; }
  };
  const add = async (e) => {
    e.preventDefault();
    if (await act(axios.post(`/api/projects/${project.id}/costs`, { label, planned_cents: toCents(planned) }))) { setLabel(''); setPlanned(''); }
  };
  const pay = async (e) => {
    e.preventDefault();
    if (await act(axios.post(`/api/projects/costs/${paying.id}/pay`, { actual_cents: toCents(paying.amount) }))) setPaying(null);
  };

  return (
    <section className={cardClass} data-budget>
      <h2 className="mb-1 font-semibold text-life-800 dark:text-life-50">What it costs</h2>
      {costs.length === 0 && <p className="text-sm text-gray-500 dark:text-life-300">Nothing yet. Add what you expect to spend, then mark each one paid as you go.</p>}
      <ul className="divide-y divide-life-100 dark:divide-life-800">
        {costs.map((c) => (
          <li key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
            <span className={`min-w-0 flex-1 ${c.paid_on ? 'text-gray-500 dark:text-life-300' : 'text-gray-800 dark:text-life-50'}`}>
              {c.label}
              {c.note && <span className="block text-xs text-gray-500 dark:text-life-300">{c.note}</span>}
            </span>
            {paying?.id === c.id ? (
              <form onSubmit={pay} className="flex items-center gap-1.5">
                <input autoFocus inputMode="decimal" aria-label={`What ${c.label} came to`} value={paying.amount} onChange={(e) => setPaying({ id: c.id, amount: e.target.value })} className={`${inputClass} !w-24`} />
                <button type="submit" className="text-life-600 hover:underline dark:text-life-200">Paid</button>
                <button type="button" onClick={() => setPaying(null)} className="text-gray-500 hover:underline">Cancel</button>
              </form>
            ) : c.paid_on ? (
              <>
                <span className="tabular-nums text-gray-800 dark:text-life-50">{money(c.actual_cents, sign)} <span className="text-xs text-gray-500 dark:text-life-300">paid{c.planned_cents !== null && c.planned_cents !== c.actual_cents ? `, planned ${money(c.planned_cents, sign)}` : ''}</span></span>
                <button type="button" onClick={() => act(axios.post(`/api/projects/costs/${c.id}/unpay`))} className="text-xs text-gray-500 hover:underline">Not paid</button>
              </>
            ) : (
              <>
                <span className="tabular-nums text-gray-600 dark:text-life-100">{c.planned_cents === null ? 'no amount yet' : money(c.planned_cents, sign)}</span>
                <button type="button" onClick={() => setPaying({ id: c.id, amount: c.planned_cents === null ? '' : (c.planned_cents / 100).toFixed(2) })} className="text-life-600 hover:underline dark:text-life-200">Mark paid</button>
                <button type="button" aria-label={`Remove ${c.label}`} onClick={() => act(axios.delete(`/api/projects/costs/${c.id}`))} className="text-gray-400 hover:text-red-600">✕</button>
              </>
            )}
          </li>
        ))}
      </ul>
      {costs.length > 0 && (
        <dl className="mt-2 grid grid-cols-3 gap-2 rounded-lg bg-life-50 px-3 py-2 text-center text-sm dark:bg-life-800" data-budget-totals>
          <div><dt className="text-xs text-gray-500 dark:text-life-300">Planned</dt><dd className="font-medium tabular-nums text-gray-800 dark:text-life-50">{money(budget.planned, sign)}</dd></div>
          <div><dt className="text-xs text-gray-500 dark:text-life-300">Spent so far</dt><dd className="font-medium tabular-nums text-gray-800 dark:text-life-50">{money(budget.spent, sign)}</dd></div>
          <div><dt className="text-xs text-gray-500 dark:text-life-300">{budget.left < 0 ? 'Over by' : 'Left'}</dt><dd className={`font-medium tabular-nums ${budget.left < 0 ? 'text-red-600' : 'text-gray-800 dark:text-life-50'}`}>{money(Math.abs(budget.left), sign)}</dd></div>
        </dl>
      )}
      <form onSubmit={add} className="mt-3 flex flex-wrap items-end gap-2">
        <input required aria-label="What the money is for" placeholder="What for" value={label} onChange={(e) => setLabel(e.target.value)} className={`${inputClass} min-w-0 flex-1`} />
        <input inputMode="decimal" aria-label="Planned cost" placeholder="Planned" value={planned} onChange={(e) => setPlanned(e.target.value)} className={`${inputClass} !w-28`} />
        <button type="submit" className={buttonClass}>Add</button>
      </form>
      {error && <p className="mt-2 text-sm text-red-600" role="alert">{error}</p>}
    </section>
  );
}
