import { useState } from 'react';
import axios from 'axios';
import { Field, inputClass, buttonClass, quietButtonClass, errorMessage } from './ui';
import { money } from './Budget';

const dayName = (day) => new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const monthName = (month) => new Date(`${month}-01T12:00:00`).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
const touch = 'min-h-[44px]';

/**
 * Bring in a statement: the CSV a bank or card offers for download, chosen or pasted. It is read on this
 * Life Is, looked over line by line, and what is kept becomes spending in the month each line fell in.
 * Life Is never connects to a bank, and nothing here is sent anywhere else.
 */
export default function Statement({ categories, currency, onDone }) {
  const [text, setText] = useState('');
  const [seen, setSeen] = useState(null);
  const [picks, setPicks] = useState({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);

  const choose = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5_000_000) { setError('That file is larger than 5 MB, which is more than a statement should be. Download a shorter stretch of time and try again.'); return; }
    setError('');
    setText(await file.text());
    setSeen(null);
  };
  const look = async (spendingIs) => {
    setError('');
    setBusy(true);
    try {
      const { data } = await axios.post('/api/money/statement/read', { text, spending_is: spendingIs ?? null });
      const start = {};
      data.rows.forEach((r, i) => { start[i] = { keep: r.kind === 'spent' && !r.already, category: r.suggested_category_id ? String(r.suggested_category_id) : '' }; });
      setPicks(start);
      setSeen(data);
    } catch (err) { setError(errorMessage(err, "Couldn't read that")); } finally { setBusy(false); }
  };
  const set = (i, change) => setPicks({ ...picks, [i]: { ...picks[i], ...change } });
  const kept = seen ? seen.rows.map((r, i) => i).filter((i) => picks[i]?.keep && !seen.rows[i].already) : [];
  const bring = async () => {
    setError('');
    setBusy(true);
    try {
      const chosen = {};
      kept.forEach((i) => { chosen[i] = picks[i].category ? Number(picks[i].category) : null; });
      const body = { text, keep: kept, categories: chosen, suggest: false };
      if (seen.spending_is) body.spending_is = seen.spending_is;
      setDone((await axios.post('/api/money/statement', body)).data);
    } catch (err) { setError(errorMessage(err, "Couldn't bring it in")); } finally { setBusy(false); }
  };

  if (done) {
    const where = done.months.map((m) => `${m.added} in ${monthName(m.month)}`).join(', ');
    return (
      <div className="space-y-3">
        <p role="status" data-statement-done className="rounded-lg bg-life-50 px-3 py-2 text-sm text-life-800 dark:bg-life-700 dark:text-life-50">
          {done.added === 0 ? 'Nothing new was added' : `Brought in ${done.added} ${done.added === 1 ? 'line' : 'lines'}${where ? `: ${where}` : ''}`}
          {done.already > 0 && `. ${done.already} ${done.already === 1 ? 'was' : 'were'} already in Life Is`}
          {done.left_out > 0 && `. ${done.left_out} left out`}.
        </p>
        <div className="flex justify-end"><button type="button" onClick={() => onDone(done)} className={`${buttonClass} ${touch}`}>Done</button></div>
      </div>
    );
  }

  const spent = seen ? seen.rows.map((r, i) => [r, i]).filter(([r]) => r.kind === 'spent' && !r.already) : [];
  const received = seen ? seen.rows.map((r, i) => [r, i]).filter(([r]) => r.kind === 'received' && !r.already) : [];
  const already = seen ? seen.rows.filter((r) => r.already) : [];
  const row = ([r, i]) => (
    <li key={i} className="py-1" data-statement-row>
      <label className={`flex cursor-pointer items-start gap-2 ${touch}`}>
        <span className="flex h-11 w-9 shrink-0 items-center justify-center"><input type="checkbox" checked={Boolean(picks[i]?.keep)} onChange={(e) => set(i, { keep: e.target.checked })} className="h-5 w-5 accent-life-600" aria-label={`Bring in ${r.label}`} /></span>
        <span className="min-w-0 flex-1 py-2.5">
          <span className="flex items-baseline justify-between gap-2 text-sm text-gray-800 dark:text-life-50">
            <span className="min-w-0 break-words">{r.label}</span>
            <span className="shrink-0 tabular-nums">{money(r.cents, currency)}</span>
          </span>
          <span className="block text-xs text-gray-500 dark:text-life-300">{dayName(r.day)}{r.hint ? ` · ${r.hint}` : ''}</span>
        </span>
      </label>
      <div className="mb-1 ml-11">
        <select value={picks[i]?.category ?? ''} onChange={(e) => set(i, { category: e.target.value })} aria-label={`Category for ${r.label}`} className={`${inputClass} ${touch}`}>
          <option value="">No category (only you see it)</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}{c.mine ? (c.shared_with.length ? ' (shared)' : '') : ` (shared by ${c.owner})`}</option>)}
        </select>
      </div>
    </li>
  );

  return (
    <form onSubmit={(e) => { e.preventDefault(); look(null); }} className="space-y-3">
      <p className="text-sm text-gray-600 dark:text-life-200">
        Download the CSV from your bank's or card's website (look for Download or Export on the activity page), then choose it here or paste it.
        It is read here, on your own Life Is, and sent nowhere. Life Is never connects to your bank and never asks for a login.
      </p>
      <Field label="A file (.csv)"><input type="file" accept=".csv,.txt,text/csv,text/plain" onChange={choose} className={`${touch} block w-full py-2 text-sm text-gray-700 dark:text-life-100`} /></Field>
      <Field label="Or paste it here">
        <textarea rows={4} value={text} onChange={(e) => { setText(e.target.value); setSeen(null); }} placeholder={'Date,Description,Amount\n03/02/2046,Market,-20.00'} className={inputClass} />
      </Field>
      {!seen && <div className="flex justify-end"><button type="submit" disabled={busy || !text.trim()} className={`${buttonClass} ${touch}`}>{busy ? 'Reading…' : 'Look it over'}</button></div>}

      {seen && (
        <div className="space-y-3">
          <div className="rounded-lg bg-life-50 p-3 text-sm text-life-800 dark:bg-life-700 dark:text-life-50" data-statement-summary>
            <p className="font-medium">
              {seen.rows.length} {seen.rows.length === 1 ? 'line' : 'lines'}, {dayName(seen.first_day)} to {dayName(seen.last_day)}{seen.first_day.slice(0, 4) === seen.last_day.slice(0, 4) ? `, ${seen.last_day.slice(0, 4)}` : ''}. Spent: {money(seen.spent_cents, currency)}.
            </p>
            {seen.skipped > 0 && <p className="text-xs text-gray-600 dark:text-life-200">{seen.skipped} {seen.skipped === 1 ? 'line' : 'lines'} that weren't purchases (totals, blank lines) passed over.</p>}
            {already.length > 0 && <p className="text-xs text-gray-600 dark:text-life-200">{already.length} already in Life Is.</p>}
            {new Set(seen.rows.map((r) => r.day.slice(0, 7))).size > 1 && <p className="text-xs text-gray-600 dark:text-life-200">This spans more than one month. Each line goes in the month of its own day.</p>}
          </div>
          {seen.decided_by === 'columns' && <p className="text-xs text-gray-500 dark:text-life-300">This file has separate Debit and Credit columns, so which lines are spending is not a guess.</p>}
          {seen.decided_by === 'type' && <p className="text-xs text-gray-500 dark:text-life-300">The file's own Type column says which lines are spending and which are money in.</p>}
          {seen.guessed && (
            <div className="rounded-lg border border-life-200 p-3 text-sm text-gray-700 dark:border-life-700 dark:text-life-100" data-statement-sign>
              <p>The file doesn't say which lines are spending, so I took amounts with {seen.spending_is === 'negative' ? 'a minus sign' : 'no minus sign'} to be money you spent. If that looks backwards, switch it.</p>
              <button type="button" disabled={busy} onClick={() => look(seen.spending_is === 'negative' ? 'positive' : 'negative')} className={`${quietButtonClass} ${touch} mt-2`}>Switch it around</button>
            </div>
          )}

          <section>
            <h3 className="text-sm font-semibold text-life-800 dark:text-life-50">Spent ({spent.length})</h3>
            {spent.length === 0 && <p className="text-sm text-gray-500 dark:text-life-300">No new spending in this file.</p>}
            <ul className="max-h-[40vh] divide-y divide-life-100 overflow-y-auto overscroll-contain dark:divide-life-700" data-statement-spent>{spent.map(row)}</ul>
          </section>
          {received.length > 0 && (
            <section>
              <h3 className="text-sm font-semibold text-life-800 dark:text-life-50">Money that came in ({received.length})</h3>
              <p className="text-xs text-gray-500 dark:text-life-300">Deposits, refunds and card payments aren't spending, so they are left out. Check one only if it really was.</p>
              <ul className="max-h-[30vh] divide-y divide-life-100 overflow-y-auto overscroll-contain dark:divide-life-700" data-statement-received>{received.map(row)}</ul>
            </section>
          )}
          {already.length > 0 && (
            <section>
              <h3 className="text-sm font-semibold text-life-800 dark:text-life-50">Already in Life Is ({already.length})</h3>
              <ul className="max-h-[20vh] divide-y divide-life-100 overflow-y-auto text-sm text-gray-500 dark:divide-life-700 dark:text-life-300" data-statement-already>
                {already.map((r, i) => <li key={i} className="flex justify-between gap-2 py-1.5"><span className="min-w-0 break-words">{dayName(r.day)} · {r.label}</span><span className="shrink-0 tabular-nums">{money(r.cents, currency)}</span></li>)}
              </ul>
            </section>
          )}
        </div>
      )}
      {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
      {seen && (
        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => setSeen(null)} className={`${quietButtonClass} ${touch}`}>Back</button>
          <button type="button" disabled={busy || kept.length === 0} onClick={bring} className={`${buttonClass} ${touch}`}>{busy ? 'Bringing them in…' : `Bring in ${kept.length}`}</button>
        </div>
      )}
    </form>
  );
}
