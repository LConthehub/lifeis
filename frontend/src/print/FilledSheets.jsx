/**
 * Four pages printed filled in, each from the person's own data, each on ONE letter page:
 *   WeekSheet      Monday to Sunday: each day's calendar, dinner and what is due
 *   MealWeekSheet  the week's meals with the grocery list beside them
 *   RoutineSheet   the morning and evening routine, as lines with a box to check by hand
 *   ForgetSheet    today's "Don't forget" lines
 * Too much for one sheet: the least important lines (the last ones) are left off and the sheet says "and 4 more".
 * Nothing to print: blank lines to write on. The sheets are drawn only on paper (hidden on screen), in the print frame.
 */
import { createPortal } from 'react-dom';
import PrintFrame from './PrintFrame';
import { toDateInput } from '../components/ui';

const MEALS = ['breakfast', 'lunch', 'dinner', 'snack'];
const cap = (s) => s[0].toUpperCase() + s.slice(1);
const at = (day) => new Date(`${day}T12:00:00`);

/** "6:30 pm" from "18:30". */
export function clockWords(time) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(time ?? '');
  if (!m) return '';
  const h = Number(m[1]);
  return `${h % 12 || 12}:${m[2]} ${h < 12 ? 'am' : 'pm'}`;
}

/**
 * Keeps a list to `max` lines. When there is more, the last lines go and the final line says how many were left off
 * ("and 4 more"), so the line that says it is counted in `max`.
 */
export function trimTo(list, max) {
  if (list.length <= max) return { shown: list, more: 0 };
  return { shown: list.slice(0, Math.max(0, max - 1)), more: list.length - Math.max(0, max - 1) };
}
export const moreWords = (n) => `and ${n} more`;

/** The sheet's own page rules, and the screen's page gone from paper so the sheet alone is printed. */
function PageRules() {
  return (
    <style>{`
      @page { size: letter; margin: 0.5in; }
      @media print {
        main { display: none !important; }
        .filled-print { width: 7.5in; height: 10in; overflow: hidden; break-inside: avoid; }
        .filled-print .pf { height: 10in; overflow: hidden; }
        .fp-body { height: 7.7in; overflow: hidden; }
        .fp-line { border-bottom: 1px solid var(--pf-ink); height: 0.24in; }
        .fp-cell { overflow: hidden; font-size: 9.5pt; line-height: 0.2in; padding: 0.02in 0.06in; }
        .fp-cell p { margin: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .fp-more { font-style: italic; }
        .fp-box { display: inline-block; flex: none; width: 0.2in; height: 0.2in; border: 1.5px solid var(--pf-ink); border-radius: 2px; }
        .fp-row { display: flex; align-items: flex-end; gap: 0.12in; height: 0.3in; }
        .fp-row > span.fp-write { flex: 1; min-width: 0; border-bottom: 1px solid var(--pf-ink); height: 0.26in; line-height: 0.24in; font-size: 11.5pt; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
        .fp-h { margin: 0 0 0.06in; padding-bottom: 0.02in; border-bottom: 1.5px solid #f2ce47; font-size: 13pt; font-weight: 700; color: var(--pf-choc); }
      }
    `}</style>
  );
}

/** A sheet: drawn beside <main>, only on paper. */
function Sheet({ way, phrase, title, sub, children }) {
  return createPortal(
    <div className="filled-print hidden print:block" data-way={way}>
      <PageRules />
      <PrintFrame phrase={phrase} title={title} sub={sub} data-sheet={way} aria-label={title}>
        <div className="fp-body">{children}</div>
      </PrintFrame>
    </div>,
    document.getElementById('print-root') ?? document.body,
  );
}

/** Lines to write on, for a part with nothing in it. */
const Blank = ({ n = 2 }) => <>{[...Array(n)].map((_, i) => <div key={i} className="fp-line" data-blank />)}</>;

/** One cell's lines: the list kept to `max`, then "and N more", then blank lines up to `min` so there is room to write. */
function Lines({ items, max, min = 0 }) {
  const { shown, more } = trimTo(items, max);
  const blanks = Math.max(0, min - shown.length - (more ? 1 : 0));
  return (
    <>
      {shown.map((t, i) => <p key={i}>{t}</p>)}
      {more > 0 && <p className="fp-more" data-more>{moreWords(more)}</p>}
      {blanks > 0 && <Blank n={blanks} />}
    </>
  );
}

const CALENDAR_KINDS = ['event', 'outside', 'plan', 'session'];
const DUE_KINDS = ['due', 'upkeep', 'use_by'];
const entryWords = (e) => [clockWords(e.time), e.title].filter(Boolean).join(' ');

/** The week, Monday to Sunday: what is on, what is for dinner and what is due, a row for each day. `entries` are the calendar's for the week from `start`. */
export function WeekSheet({ start, entries }) {
  const days = [...Array(7)].map((_, i) => { const d = new Date(start); d.setDate(d.getDate() + i); return d; });
  const last = days[6];
  const sub = `${days[0].toLocaleDateString('en-US', { month: 'long', day: 'numeric' })} to ${last.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`;
  return (
    <Sheet way="week" phrase="Life is on track" title="The week" sub={sub}>
      <table className="w-full table-fixed border-collapse" style={{ fontSize: '9.5pt' }}>
        <colgroup><col style={{ width: '0.9in' }} /><col style={{ width: '3.1in' }} /><col style={{ width: '1.5in' }} /><col style={{ width: '2in' }} /></colgroup>
        <thead>
          <tr className="text-left" style={{ height: '0.25in' }}>
            {['Day', 'On the calendar', 'Dinner', 'Due'].map((h) => <th key={h} scope="col" className="border-b-2 border-black font-semibold" style={{ padding: '0 0.06in' }}>{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {days.map((d) => {
            const key = toDateInput(d);
            const of = (kinds) => entries.filter((e) => e.day === key && kinds.includes(e.kind));
            const dinner = entries.filter((e) => e.day === key && e.kind === 'meal' && e.detail === 'dinner').map((e) => e.title);
            return (
              <tr key={key} data-day={key} style={{ height: '1.05in' }} className="align-top">
                <th scope="row" className="border-b border-gray-500 text-left align-top" style={{ padding: '0.04in 0.06in', fontSize: '10.5pt' }}>
                  {d.toLocaleDateString('en-US', { weekday: 'short' })}<br /><span className="font-normal">{d.getMonth() + 1}/{d.getDate()}</span>
                </th>
                <td className="fp-cell border-b border-l border-gray-500" data-cell="calendar"><Lines items={of(CALENDAR_KINDS).map(entryWords)} max={4} min={2} /></td>
                <td className="fp-cell border-b border-l border-gray-500" data-cell="dinner"><Lines items={dinner} max={2} min={1} /></td>
                <td className="fp-cell border-b border-l border-gray-500" data-cell="due"><Lines items={of(DUE_KINDS).map((e) => e.title)} max={4} min={2} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Sheet>
  );
}

/** The meal week, with the grocery list beside it. `meals` are the plan's for the week, `groceries` the list's lines not yet checked. */
export function MealWeekSheet({ start, meals, groceries }) {
  const days = [...Array(7)].map((_, i) => { const d = new Date(start); d.setDate(d.getDate() + i); return d; });
  const sub = `${days[0].toLocaleDateString('en-US', { month: 'long', day: 'numeric' })} to ${days[6].toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`;
  const wanted = groceries.map((g) => [g.label, g.amount].filter(Boolean).join(', '));
  const { shown, more } = trimTo(wanted, 22);
  const blanks = Math.max(0, 12 - shown.length - (more ? 1 : 0));
  return (
    <Sheet way="meals" phrase="Life is cooking" title="Meals and groceries" sub={sub}>
      <div style={{ display: 'flex', gap: '0.25in', height: '100%' }}>
        <div style={{ width: '4.4in', flex: 'none' }}>
          <h3 className="fp-h font-display">Meals</h3>
          {days.map((d) => {
            const key = toDateInput(d);
            const lines = meals.filter((m) => m.day === key)
              .sort((a, b) => MEALS.indexOf(a.meal) - MEALS.indexOf(b.meal))
              .map((m) => `${cap(m.meal)}: ${m.recipe_title || m.title || 'A meal'}`);
            return (
              <div key={key} data-day={key} className="fp-cell border-b border-gray-500" style={{ height: '0.98in', display: 'flex', gap: '0.08in' }}>
                <b style={{ width: '0.55in', flex: 'none', fontSize: '10.5pt' }}>{d.toLocaleDateString('en-US', { weekday: 'short' })}<br /><span className="font-normal">{d.getMonth() + 1}/{d.getDate()}</span></b>
                <div style={{ flex: 1, minWidth: 0 }}><Lines items={lines} max={4} min={2} /></div>
              </div>
            );
          })}
        </div>
        <div style={{ flex: 1, minWidth: 0 }} data-part="groceries">
          <h3 className="fp-h font-display">Groceries</h3>
          {shown.map((t, i) => <div key={i} className="fp-row" data-grocery><span className="fp-box" /><span className="fp-write">{t}</span></div>)}
          {more > 0 && <p className="fp-more" data-more style={{ fontSize: '10.5pt', margin: '0.04in 0' }}>{moreWords(more)}</p>}
          {[...Array(blanks)].map((_, i) => <div key={`b${i}`} className="fp-row" data-blank><span className="fp-box" /><span className="fp-write" /></div>)}
        </div>
      </div>
    </Sheet>
  );
}

/** Pick the morning and evening times from today's routines: by name, else the first two with steps. Each is { name, steps: [words] }. */
export function morningAndEvening(times) {
  const own = times.filter((t) => t.who_kind !== 'pet' && t.who_kind !== 'member' && t.steps.length > 0);
  const stepsOf = (t) => t.steps.map((s) => s.words);
  let morning = own.find((t) => /morning|wake/i.test(`${t.name} ${t.title}`));
  let evening = own.find((t) => t !== morning && /evening|night|bed/i.test(`${t.name} ${t.title}`));
  const rest = own.filter((t) => t !== morning && t !== evening);
  if (!morning) morning = rest.shift();
  if (!evening) evening = rest.shift();
  const left = morning ?? null;
  const right = evening ?? null;
  return [
    { name: 'Morning', steps: left ? stepsOf(left) : [] },
    { name: 'Evening', steps: right ? stepsOf(right) : [] },
  ];
}

/** The morning and evening routine as lines with a box to check by hand. `times` are today's routine times. */
export function RoutineSheet({ times }) {
  const parts = morningAndEvening(times);
  const sub = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  return (
    <Sheet way="routines" phrase="Life is in order" title="Morning and evening" sub={sub}>
      <div style={{ display: 'flex', gap: '0.3in' }}>
        {parts.map((p) => {
          const { shown, more } = trimTo(p.steps, 19);
          const blanks = Math.max(0, 8 - shown.length - (more ? 1 : 0));
          return (
            <div key={p.name} style={{ flex: 1, minWidth: 0 }} data-part={p.name.toLowerCase()}>
              <h3 className="fp-h font-display">{p.name}</h3>
              {shown.map((w, i) => <div key={i} className="fp-row" data-step><span className="fp-box" /><span className="fp-write">{w}</span></div>)}
              {more > 0 && <p className="fp-more" data-more style={{ fontSize: '10.5pt', margin: '0.04in 0' }}>{moreWords(more)}</p>}
              {[...Array(blanks)].map((_, i) => <div key={`b${i}`} className="fp-row" data-blank><span className="fp-box" /><span className="fp-write" /></div>)}
            </div>
          );
        })}
      </div>
    </Sheet>
  );
}

/** Today's "Don't forget": its lines with a box each, then blank lines to write more. */
export function ForgetSheet({ lines }) {
  const sub = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  const { shown, more } = trimTo(lines.map((l) => l.text), 8);
  const blanks = Math.max(0, 10 - shown.length - (more ? 1 : 0));
  return (
    <Sheet way="forget" phrase="Life is in order" title="Don't forget" sub={sub}>
      {shown.map((t, i) => <div key={i} className="fp-row" data-line style={{ height: '0.55in' }}><span className="fp-box" style={{ width: '0.3in', height: '0.3in' }} /><span className="fp-write" style={{ fontSize: '15pt', height: '0.48in', lineHeight: '0.46in' }}>{t}</span></div>)}
      {more > 0 && <p className="fp-more" data-more style={{ fontSize: '12pt', margin: '0.06in 0' }}>{moreWords(more)}</p>}
      {[...Array(blanks)].map((_, i) => <div key={`b${i}`} className="fp-row" data-blank style={{ height: '0.55in' }}><span className="fp-box" style={{ width: '0.3in', height: '0.3in' }} /><span className="fp-write" style={{ height: '0.48in' }} /></div>)}
    </Sheet>
  );
}
