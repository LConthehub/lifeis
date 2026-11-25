import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import { Checklists } from '../components/Routines';
import { buttonClass, cardClass } from '../components/ui';
import PrintFrame, { PrintStyleChoice } from '../print/PrintFrame';

const START_KEY = 'lifeis.weekStartsOn';
/** Which day the week starts on, kept on this device: Sunday, as American calendars have it, unless it was changed. */
const savedStart = () => { try { return localStorage.getItem(START_KEY) === 'monday' ? 'monday' : 'sunday'; } catch { return 'sunday'; } };
const saveStart = (value) => { try { localStorage.setItem(START_KEY, value); } catch { /* the page works without it */ } };

const at = (day) => new Date(`${day}T12:00:00`);
const longDay = (day) => at(day).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const dollars = (cents) => `$${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
const keyOf = (g) => (g.member_id !== null ? `m${g.member_id}` : g.who ?? 'anyone');
const nameOf = (g) => g.who ?? 'Anyone';

/** A square to tick with a pencil. */
const Box = ({ day }) => <span data-box={day} className="inline-block h-[18px] w-[18px] border-2 border-black align-middle print:h-6 print:w-6" />;

/** One person's chores: a row for each, and a box in each day it falls due. The heading rows repeat if the table runs over a page. */
function Part({ group, days, pointCents }) {
  const when = `${longDay(days[0])} to ${longDay(days[6])}`;
  return (
    <div className="break-inside-auto" data-part={nameOf(group)}>
      <table className="w-full table-fixed border-collapse text-left text-xs print:text-sm">
        <caption className="sr-only">{nameOf(group)}: chores for {when}. A box on each day the chore is due.</caption>
        <colgroup><col className="w-[27%]" /><col className="w-[8%]" />{days.map((d) => <col key={d} className="w-[9.3%]" />)}</colgroup>
        <thead>
          <tr><th colSpan={9} scope="colgroup" className="border-b-2 border-black pb-0.5 pt-2 text-base font-bold print:text-lg">{nameOf(group)}</th></tr>
          <tr className="text-[10px] print:text-xs">
            <th scope="col" className="border-b border-black py-1 pr-1 font-semibold">Chore</th>
            <th scope="col" className="border-b border-black py-1 text-center font-semibold">Points</th>
            {days.map((d) => (
              <th key={d} scope="col" className="border-b border-black py-1 text-center font-semibold">
                {at(d).toLocaleDateString(undefined, { weekday: 'short' })}<br /><span className="font-normal">{at(d).getMonth() + 1}/{at(d).getDate()}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {group.chores.length === 0 && <tr><td colSpan={9} className="py-2 italic">No chores this week.</td></tr>}
          {group.chores.map((c) => (
            <tr key={c.id} className="break-inside-avoid border-b border-gray-400" data-chore={c.name}>
              <th scope="row" className="break-words py-1.5 pr-1 align-middle font-normal [overflow-wrap:anywhere]">{c.name}</th>
              <td className="text-center align-middle">{c.points ?? ''}</td>
              {c.anytime
                ? <td colSpan={7} className="text-center align-middle"><Box day="week" /> <span className="ml-1">any day this week</span></td>
                : days.map((d) => (
                  <td key={d} className="border-l border-gray-300 py-1.5 text-center align-middle">
                    {c.days.includes(d) && <><Box day={d} /><span className="sr-only">due {at(d).toLocaleDateString(undefined, { weekday: 'long' })}</span></>}
                  </td>
                ))}
            </tr>
          ))}
        </tbody>
      </table>
      {group.member_id !== null && (
        <p className="mt-2 break-inside-avoid text-sm print:text-base" data-points-line>
          Points this week: <span className="inline-block w-16 border-b border-black align-baseline">&nbsp;</span>
          {pointCents ? <> × {dollars(pointCents)} = $<span className="inline-block w-16 border-b border-black align-baseline">&nbsp;</span></> : null}
        </p>
      )}
    </div>
  );
}

/**
 * A chore chart for the fridge: a sheet for a week, the chores of each child (and of anyone) as rows, a box in
 * each day a chore is due. Black on white whatever the page's colors, and the only thing that prints.
 */
export default function ChoreChart() {
  const [week, setWeek] = useState('this');
  const [startOn, setStartOn] = useState(savedStart);
  const [chart, setChart] = useState(null);
  const [off, setOff] = useState([]);            // the people left out
  const [layout, setLayout] = useState('all');   // 'all' on one page, or 'each' on a page of their own
  // The routines made for the household's children, to tick today. They are not on the printed sheet.
  const [routines, setRoutines] = useState([]);
  useEffect(() => { axios.get('/api/routines/members').then(({ data }) => setRoutines(data)).catch(() => setRoutines([])); }, []);
  useEffect(() => {
    let live = true;
    axios.get('/api/things/upkeep/chart', { params: { week, start_on: startOn } }).then(({ data }) => { if (live) setChart(data); }).catch(() => { if (live) setChart(false); });
    return () => { live = false; };
  }, [week, startOn]);
  if (chart === null) return null;
  if (chart === false) return <p className="text-sm text-gray-600 dark:text-life-200">The chart couldn't be made just now.</p>;

  const chosen = chart.groups.filter((g) => !off.includes(keyOf(g)));
  const sheets = layout === 'each' ? chosen.map((g) => [g]) : (chosen.length ? [chosen] : []);
  const title = (groups) => (groups.length === 1 ? `${nameOf(groups[0])}'s chore chart` : 'Chore chart');
  const range = `${at(chart.days[0]).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })} to ${at(chart.days[6]).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}`;
  const choose = (value) => { setStartOn(value); saveStart(value); };
  const toggle = (g) => setOff(off.includes(keyOf(g)) ? off.filter((k) => k !== keyOf(g)) : [...off, keyOf(g)]);
  const nothing = chart.groups.every((g) => g.chores.length === 0);
  const pill = (active) => `min-h-[44px] rounded-full px-4 py-2 text-sm ${active ? 'bg-life-600 text-white' : 'bg-card text-life-700 ring-1 ring-life-100 hover:bg-life-50 dark:bg-life-800 dark:text-life-100 dark:ring-life-700'}`;

  return (
    <div className="space-y-4">
      {/* Only the sheet prints, on landscape paper. */}
      <style>{'@media print { @page { size: landscape; margin: 0.5in; } .chart-sheet { padding: 0 !important; border: 0 !important; } }'}</style>
      <div className="space-y-3 print:hidden">
        <Link to="/things/upkeep" className="text-sm text-life-600 hover:underline dark:text-life-200">← Upkeep</Link>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="mr-auto text-xl font-semibold text-life-800 dark:text-life-50">Chore chart</h1>
          <button type="button" disabled={sheets.length === 0} onClick={() => window.print()} className={`${buttonClass} min-h-[44px]`}>Print</button>
        </div>
        <PrintStyleChoice />
        <p className="text-sm text-gray-600 dark:text-life-100">A sheet for the fridge: each person's chores, with a box to check on each day one is due. Points and what they are worth are on it for you to add up.</p>

        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Which week">
          <button type="button" onClick={() => setWeek('this')} aria-pressed={week === 'this'} className={pill(week === 'this')}>This week</button>
          <button type="button" onClick={() => setWeek('next')} aria-pressed={week === 'next'} className={pill(week === 'next')}>Next week</button>
          <label className="ml-auto flex items-center gap-2 text-sm text-gray-700 dark:text-life-100">Week starts on
            <select value={startOn} onChange={(e) => choose(e.target.value)} className="min-h-[44px] rounded-lg border border-life-200 bg-card px-3 text-sm text-gray-800 dark:border-life-700 dark:bg-life-800 dark:text-life-50">
              <option value="sunday">Sunday</option><option value="monday">Monday</option>
            </select>
          </label>
        </div>

        {chart.groups.length > 0 && (
          <fieldset className="space-y-1">
            <legend className="text-xs font-medium text-gray-600 dark:text-life-200">Whose chores</legend>
            <div className="flex flex-wrap gap-x-4">
              {chart.groups.map((g) => (
                <label key={keyOf(g)} className="flex min-h-[44px] cursor-pointer items-center gap-2 text-sm text-gray-800 dark:text-life-50">
                  <input type="checkbox" checked={!off.includes(keyOf(g))} onChange={() => toggle(g)} className="h-5 w-5 accent-life-600" />
                  {g.member_id === null && g.who === null ? 'Anyone (not given to anyone)' : g.who}
                </label>
              ))}
            </div>
          </fieldset>
        )}

        <div className="flex flex-wrap gap-2" role="group" aria-label="Pages">
          <button type="button" onClick={() => setLayout('all')} aria-pressed={layout === 'all'} className={pill(layout === 'all')}>Everyone on one page</button>
          <button type="button" onClick={() => setLayout('each')} aria-pressed={layout === 'each'} className={pill(layout === 'each')}>One page per child</button>
        </div>
        {nothing && (
          <div className={`${cardClass} text-sm text-gray-600 dark:text-life-100`}>
            There are no chores to put on a sheet yet. Add some in <Link to="/things/upkeep" className="underline">Upkeep</Link>, say how often, and give each to a child.
          </div>
        )}
        {!nothing && sheets.length === 0 && <p className="text-sm text-gray-600 dark:text-life-100">Pick at least one person to print.</p>}
        {routines.length > 0 && (
          <div className="space-y-3" data-section="member-routines">
            <h2 className="text-lg font-semibold text-life-800 dark:text-life-50">Routines to tick today</h2>
            <div className="grid gap-3 md:grid-cols-2"><Checklists times={routines} setTimes={setRoutines} /></div>
          </div>
        )}
      </div>

      {sheets.map((groups, i) => (
        <PrintFrame key={groups.map(keyOf).join('|')} phrase="Life is shared" title={title(groups)} sub={range} className="chart-sheet break-after-page rounded-xl bg-card print:bg-white p-3 text-black last:break-after-auto sm:p-6 print:break-after-page print:last:break-after-auto" aria-label={`${title(groups)}, ${range}`} data-sheet={i}>
          <div className="space-y-5">
            {groups.map((g) => <Part key={keyOf(g)} group={g} days={chart.days} pointCents={chart.point_cents} />)}
          </div>
        </PrintFrame>
      ))}
    </div>
  );
}
