import { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import Icon from './Icon';
import { cardClass, quietButtonClass, fromDateInput } from './ui';

const money = (cents, sign) => `${sign}${(cents / 100).toFixed(2)}`;
const dayText = (day) => fromDateInput(day).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

/**
 * Money to ask a store for: something bought where the store gives a price adjustment, still inside its window, and then seen cheaper
 * there (a later receipt, or the store's savings book). It shows nothing when there is none. Nothing is looked up online.
 */
export default function AskBack() {
  const [data, setData] = useState(null);
  const load = useCallback(() => { axios.get('/api/shopping/drops').then(({ data: d }) => setData(d)).catch(() => setData(null)); }, []);
  useEffect(() => { load(); }, [load]);
  if (!data || data.drops.length === 0) return null;
  const sign = data.currency;
  const asked = async (d) => { await axios.post(`/api/shopping/drops/${d.id}/claim`); load(); };
  return (
    <section className={cardClass} data-ask-back aria-label="Ask for money back">
      <h2 className="mb-1 font-semibold text-life-800 dark:text-life-50"><Icon of="receipt" size={18} /> Ask for money back</h2>
      <ul className="divide-y divide-life-100 dark:divide-life-700">
        {data.drops.map((d) => (
          <li key={d.id} className="py-2 text-sm" data-drop={d.item}>
            <p className="text-gray-800 dark:text-life-50">Ask {d.store} for <span className="font-semibold">{money(d.ask_cents, sign)}</span> back on {d.item}.</p>
            <p className="text-xs text-gray-600 dark:text-life-200">
              You paid {money(d.paid_cents, sign)} on {dayText(d.bought_on)}; {d.because === 'receipt' ? `it was ${money(d.now_cents, sign)} on ${dayText(d.seen_on)}` : `its savings book has it ${money(d.ask_cents, sign)} off now`}.
              {' '}{d.days_left === 0 ? 'Last day to ask is today.' : `${d.days_left} ${d.days_left === 1 ? 'day' : 'days'} left to ask (until ${dayText(d.claim_by)}).`}
            </p>
            <button type="button" onClick={() => asked(d)} className={`${quietButtonClass} mt-1 min-h-[44px]`} data-asked>I asked</button>
          </li>
        ))}
      </ul>
    </section>
  );
}
