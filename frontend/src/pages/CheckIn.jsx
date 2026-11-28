import { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import SubChips, { ROUTINE_CHIPS } from '../components/SubChips';
import { Field, inputClass, buttonClass, quietButtonClass, cardClass, errorMessage } from '../components/ui';

/**
 * The daily check-in: ten seconds a day. Sleep (hours), water (glasses), energy (1 to 5) and one optional line, each of
 * them optional. One entry a day, and it can be changed. The last four weeks show as plain rows with flat bars, all in
 * one color. No scores, no streaks, no advice, no good or bad. Only this person ever sees it.
 */

const control = `${inputClass} min-h-[44px]`;
const today = () => new Date().toLocaleDateString('en-CA');
const dayText = (day) => {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
};

/** A flat bar: `value` out of `most`, one color, with the number beside it. */
function Bar({ label, value, most, text }) {
  const share = value === null ? 0 : Math.max(0, Math.min(1, value / most));
  return (
    <div className="min-w-0" data-bar={label}>
      <p className="text-[11px] text-gray-600 dark:text-life-200">{label}: <span className="text-gray-800 dark:text-life-50">{value === null ? 'not kept' : text}</span></p>
      <div className="mt-0.5 h-2 w-full rounded-sm bg-life-100 dark:bg-life-700" role="img" aria-label={`${label} ${value === null ? 'not kept' : text}`}>
        <div className="h-2 rounded-sm bg-life-500 dark:bg-life-300" style={{ width: `${share * 100}%` }} />
      </div>
    </div>
  );
}

export default function CheckInPage() {
  const [data, setData] = useState(null);
  const [day, setDay] = useState(today());
  const [sleep, setSleep] = useState('');
  const [water, setWater] = useState('');
  const [energy, setEnergy] = useState(null);
  const [line, setLine] = useState('');
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  const load = useCallback(() => axios.get('/api/check-ins').then(({ data: d }) => { setData(d); return d; }).catch(() => { setData({ today: today(), days: 28, entries: [] }); return null; }), []);
  useEffect(() => { load(); }, [load]);
  // Show what is already kept for the chosen day.
  const kept = data?.entries.find((e) => e.day === day);
  useEffect(() => {
    setSleep(kept?.sleep_hours ?? ''); setWater(kept?.water ?? ''); setEnergy(kept?.energy ?? null); setLine(kept?.line ?? '');
  }, [kept?.id, kept?.sleep_hours, kept?.water, kept?.energy, kept?.line, day]);
  if (data === null) return null;

  const save = async (e) => {
    e.preventDefault();
    setError(''); setSaved('');
    const body = { day, sleep_hours: sleep === '' ? null : Number(sleep), water: water === '' ? null : Number(water), energy, line: line.trim() || null };
    try { await axios.put('/api/check-ins', body); await load(); setSaved(`Kept for ${dayText(day)}.`); } catch (err) { setError(errorMessage(err, "Couldn't keep that")); }
  };
  const remove = async (d) => {
    setError(''); setSaved('');
    try { await axios.delete(`/api/check-ins/${d}`); await load(); } catch (err) { setError(errorMessage(err, "Couldn't remove it")); }
  };
  const mostWater = Math.max(8, ...data.entries.map((e) => e.water ?? 0));

  return (
    <div className="space-y-4">
      <SubChips items={ROUTINE_CHIPS} label="Routines, measures and your private records" />
      <h1 className="text-xl font-semibold text-life-800 dark:text-life-50">Check-in</h1>
      <p className="text-sm text-gray-600 dark:text-life-100" data-private>Only you can see this. Nobody else can, not even the person in charge. It is in your own full download, and comes back in with it. Keep as much or as little as you like. Life Is adds nothing up and says nothing about it.</p>

      <form onSubmit={save} className={`${cardClass} space-y-3`} aria-label="Check in">
        <Field label="Day"><input type="date" value={day} max={data.today} onChange={(e) => { setDay(e.target.value || data.today); setSaved(''); }} aria-label="Day" className={`${control} !w-auto`} /></Field>
        <div className="flex flex-wrap gap-3">
          <Field label="Sleep (hours)"><input type="number" inputMode="decimal" min="0" max="24" step="0.25" value={sleep} onChange={(e) => setSleep(e.target.value)} aria-label="Sleep in hours" className={`${control} !w-28`} /></Field>
          <Field label="Water (glasses)"><input type="number" inputMode="numeric" min="0" max="99" step="1" value={water} onChange={(e) => setWater(e.target.value)} aria-label="Water in glasses" className={`${control} !w-28`} /></Field>
        </div>
        <fieldset>
          <legend className="text-xs font-medium text-gray-600 dark:text-life-200">Energy, 1 (low) to 5 (high)</legend>
          <div className="mt-1 flex flex-wrap gap-2">
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} type="button" aria-pressed={energy === n} aria-label={`Energy ${n}`} onClick={() => setEnergy(energy === n ? null : n)}
                className={`min-h-[44px] min-w-[44px] rounded-xl border px-3 text-sm ${energy === n ? 'border-life-600 bg-life-600 text-white' : 'border-life-200 text-life-700 hover:bg-life-50 dark:border-life-700 dark:text-life-100 dark:hover:bg-life-800'}`}>{n}</button>
            ))}
          </div>
        </fieldset>
        <Field label="One line (if you like)"><input value={line} maxLength={300} onChange={(e) => setLine(e.target.value)} aria-label="One line" className={control} /></Field>
        {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
        {saved && <p className="text-sm text-gray-700 dark:text-life-100" role="status">{saved}</p>}
        <div className="flex flex-wrap items-center gap-2">
          {kept && <button type="button" onClick={() => remove(kept.day)} className="min-h-[44px] px-3 text-sm text-red-700 hover:underline dark:text-red-300" aria-label={`Remove the check-in for ${dayText(kept.day)}`}>Remove this day</button>}
          <button type="submit" className={`${buttonClass} ml-auto min-h-[44px]`}>{kept ? 'Change this day' : 'Keep it'}</button>
        </div>
      </form>

      <section className="space-y-2" aria-label="The last four weeks">
        <h2 className="text-sm font-semibold text-life-700 dark:text-life-100">The last four weeks</h2>
        {data.entries.length === 0 && <p className={`${cardClass} text-sm text-gray-600 dark:text-life-100`}>Nothing kept yet. Days you do not check in are simply not listed.</p>}
        <ul className="space-y-2">
          {data.entries.map((e) => (
            <li key={e.id} className={`${cardClass} space-y-2 !p-3`} data-entry={e.day}>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="mr-auto text-sm font-semibold text-life-800 dark:text-life-50">{dayText(e.day)}</h3>
                <button type="button" onClick={() => { setDay(e.day); setSaved(''); window.scrollTo({ top: 0 }); }} className={`${quietButtonClass} min-h-[44px]`} aria-label={`Change ${dayText(e.day)}`}>Change</button>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <Bar label="Sleep" value={e.sleep_hours} most={12} text={`${e.sleep_hours} h`} />
                <Bar label="Water" value={e.water} most={mostWater} text={`${e.water}`} />
                <Bar label="Energy" value={e.energy} most={5} text={`${e.energy} of 5`} />
              </div>
              {e.line && <p className="break-words text-sm text-gray-800 dark:text-life-50" data-line>{e.line}</p>}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
