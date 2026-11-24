import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import axios from 'axios';
import { buttonClass, cardClass, quietButtonClass, errorMessage } from './ui';

/**
 * Routines as they are used: a checklist to tick (on the front page and the chore chart), and "Go through it",
 * one big step at a time with an optional wait timer. What each time holds, and which steps fall today, is worked
 * out on the server (core/src/routines.ts). Ticking is free for good, even after the trial of the paid parts.
 */

/** "2 of 5 done". */
export const doneText = (t) => `${t.done} of ${t.total} done`;
/** "5 of the last 7 days". */
export const lastText = (t) => `${t.last7} of the last 7 days`;
/** A wait in words: "1 min", "30 sec". */
export const waitText = (s) => (s % 60 === 0 ? `${s / 60} min` : s < 60 ? `${s} sec` : `${Math.floor(s / 60)} min ${s % 60} sec`);
const clock = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

/** Ticks one step, or takes the tick back. Gives the time as it now is. */
const tickStep = (step, done) => axios.put(`/api/routine-day/steps/${step.id}`, { done }).then(({ data }) => data);
const finishTime = (time, done) => axios.put(`/api/routine-day/times/${time.id}`, { done }).then(({ data }) => data);

/** Marks the thing a step names as running low (on the grocery list), and says so. */
function RunningLow({ step }) {
  const [said, setSaid] = useState('');
  if (!step.item_id) return null;
  const mark = async () => {
    try {
      const { data } = await axios.post(`/api/routine-day/steps/${step.id}/low`);
      setSaid(data.added ? `${data.name} is on your grocery list` : `${data.name} is already on your list`);
    } catch (err) { setSaid(errorMessage(err, "Couldn't do that")); }
  };
  return (
    <span className="flex flex-wrap items-center gap-2">
      <button type="button" onClick={mark} className="min-h-[44px] rounded-lg px-2 text-sm text-life-700 underline dark:text-life-100" data-low={step.item}>{step.item} running low</button>
      {said && <span role="status" className="text-xs text-gray-600 dark:text-life-200">{said}</span>}
    </span>
  );
}

/** One time of a routine, with the steps that fall today as boxes to tick. */
export function TimeChecklist({ time, onChange, onGo }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = async (work) => {
    setBusy(true); setError('');
    try { onChange(await work()); } catch (err) { setError(errorMessage(err, "Couldn't save that")); } finally { setBusy(false); }
  };
  return (
    <section className={cardClass} data-routine-time={time.title} aria-label={time.title}>
      <div className="flex flex-wrap items-baseline gap-x-2">
        <h2 className="mr-auto min-w-0 break-words font-semibold text-life-800 dark:text-life-50">{time.title}</h2>
        {time.at_words && <span className="text-xs text-gray-500 dark:text-life-300">{time.at_words}</span>}
      </div>
      <p className="text-sm text-gray-700 dark:text-life-100">
        <span data-done>{doneText(time)}</span>
        <span className="text-xs text-gray-500 dark:text-life-300"> · {lastText(time)}{time.night ? ` · night ${time.night} of ${time.cycle_length}` : ''}{time.who_kind === 'member' || time.who_kind === 'person' ? ` · for ${time.who}` : ''}</span>
      </p>
      <ul className="mt-1">
        {time.steps.map((s) => (
          <li key={s.id}>
            <button type="button" role="checkbox" aria-checked={s.ticked} disabled={busy} onClick={() => run(() => tickStep(s, !s.ticked))}
              className="flex min-h-[44px] w-full items-center gap-3 rounded-xl py-1 text-left hover:bg-life-50 dark:hover:bg-life-700">
              <span aria-hidden="true" className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border-2 text-sm font-bold ${s.ticked ? 'border-life-600 bg-life-600 text-white' : 'border-life-400 text-transparent dark:border-life-300'}`}>✓</span>
              <span className={`min-w-0 flex-1 break-words text-sm text-gray-800 dark:text-life-50 ${s.ticked ? 'text-gray-500 line-through dark:text-life-300' : ''}`}>{s.words}</span>
              {s.wait_seconds && <span className="shrink-0 text-xs text-gray-500 dark:text-life-300">wait {waitText(s.wait_seconds)}</span>}
            </button>
            <RunningLow step={s} />
          </li>
        ))}
      </ul>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" onClick={onGo} className={`${buttonClass} min-h-[44px]`}>Go through it</button>
        {time.finished
          ? <button type="button" disabled={busy} onClick={() => run(() => finishTime(time, false))} className={`${quietButtonClass} min-h-[44px]`}>Start over</button>
          : <button type="button" disabled={busy} onClick={() => run(() => finishTime(time, true))} className={`${quietButtonClass} min-h-[44px]`}>Tick them all</button>}
      </div>
    </section>
  );
}

/**
 * One big step at a time. "Done" ticks the step and moves on; "Back" and "Skip" move without ticking. A step with
 * a wait has a timer that is only for looking at: it does not stop anything.
 */
export function GoThrough({ time: start, onChange, onClose }) {
  const [time, setTime] = useState(start);
  const first = Math.max(0, start.steps.findIndex((s) => !s.ticked));
  const [at, setAt] = useState(start.steps.every((s) => s.ticked) ? start.steps.length : first);
  const [left, setLeft] = useState(null);       // seconds of a wait still to run, or null when none is running
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const step = time.steps[at];
  const over = at >= time.steps.length;

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(time); };
    document.addEventListener('keydown', onKey);
    const was = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = was; };
  }, [onClose, time]);

  // A new step starts with no timer running.
  useEffect(() => { setLeft(null); }, [at]);
  const ticking = useRef(null);
  useEffect(() => {
    if (left === null || left <= 0) return undefined;
    ticking.current = setTimeout(() => setLeft((n) => (n === null ? null : n - 1)), 1000);
    return () => clearTimeout(ticking.current);
  }, [left]);

  const done = async (tick) => {
    setBusy(true); setError('');
    try {
      let now = time;
      if (tick && step && !step.ticked) now = await tickStep(step, true);
      setTime(now); onChange(now);
      setAt((n) => n + 1);
    } catch (err) { setError(errorMessage(err, "Couldn't save that")); } finally { setBusy(false); }
  };
  const untick = async () => {
    setBusy(true); setError('');
    try { const now = await tickStep(step, false); setTime(now); onChange(now); } catch (err) { setError(errorMessage(err, "Couldn't save that")); } finally { setBusy(false); }
  };
  const big = 'min-h-[56px] rounded-full px-6 text-lg font-semibold';

  // Drawn on the page itself (like Modal), so the frosted panel the page sits in does not hold it under the header.
  return createPortal(
    <div role="dialog" aria-modal="true" aria-label={`Going through ${time.title}`} data-go-through
      className="fixed inset-0 z-50 overflow-y-auto overflow-x-hidden bg-card text-gray-900 dark:bg-life-800 dark:text-life-50">
      <div className="mx-auto flex min-h-full max-w-xl flex-col gap-5 px-4 pb-8 pt-4">
        <div className="flex items-start gap-3">
          <h1 className="mr-auto min-w-0 break-words text-xl font-semibold text-life-800 dark:text-life-50">{time.title}</h1>
          <button type="button" onClick={() => onClose(time)} className="min-h-[48px] shrink-0 rounded-full border-2 border-life-500 px-5 text-base font-semibold text-life-700 dark:text-life-100">Close</button>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-life-100 dark:bg-life-700" aria-hidden="true">
          <div className="h-full bg-life-600" style={{ width: `${Math.round((Math.min(at, time.steps.length) / Math.max(1, time.steps.length)) * 100)}%` }} />
        </div>
        {!over && step && (
          <>
            <p className="text-sm text-gray-600 dark:text-life-200" data-step-count>Step {at + 1} of {time.steps.length}{time.night ? ` · night ${time.night} of ${time.cycle_length}` : ''}</p>
            <div className="flex flex-1 flex-col justify-center gap-4" data-step>
              <p className={`break-words text-3xl font-semibold leading-snug ${step.ticked ? 'text-gray-500 line-through dark:text-life-300' : 'text-gray-900 dark:text-life-50'}`}>{step.words}</p>
              {step.wait_seconds && (
                <div className="space-y-2 rounded-2xl bg-life-50/70 p-3 dark:bg-life-700/60" data-wait>
                  <p className="text-base text-gray-800 dark:text-life-50">Wait {waitText(step.wait_seconds)} after this step.</p>
                  {left === null
                    ? <button type="button" onClick={() => setLeft(step.wait_seconds)} className="min-h-[56px] rounded-full border-2 border-life-500 px-6 text-lg font-semibold text-life-700 dark:text-life-100">Start the timer</button>
                    : <p className="flex flex-wrap items-center gap-3 text-2xl font-semibold text-life-800 dark:text-life-50" role="timer" aria-live="off" data-timer>
                      {left > 0 ? clock(left) : <span>Time is up</span>}
                      <button type="button" onClick={() => setLeft(null)} className="min-h-[44px] rounded-lg px-3 text-base font-normal text-life-700 underline dark:text-life-100">{left > 0 ? 'Skip the wait' : 'Clear'}</button>
                    </p>}
                </div>
              )}
              <RunningLow step={step} />
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className="flex flex-wrap gap-3">
              <button type="button" disabled={at === 0 || busy} onClick={() => setAt((n) => Math.max(0, n - 1))} className={`${big} border-2 border-life-300 text-life-700 disabled:opacity-40 dark:text-life-100`}>Back</button>
              {step.ticked
                ? <button type="button" disabled={busy} onClick={untick} className={`${big} border-2 border-life-300 text-life-700 dark:text-life-100`}>Not done</button>
                : <button type="button" disabled={busy} onClick={() => done(false)} className={`${big} border-2 border-life-300 text-life-700 dark:text-life-100`}>Skip</button>}
              <button type="button" disabled={busy} onClick={() => done(true)} className={`${big} flex-1 bg-gradient-to-br from-life-500 to-life-700 text-white shadow-md`}>{step.ticked ? 'Next' : 'Done'}</button>
            </div>
          </>
        )}
        {over && (
          <div className="flex flex-1 flex-col justify-center gap-4" data-finished-screen>
            <p className="text-3xl font-semibold text-life-800 dark:text-life-50">{time.finished ? 'All done' : `${doneText(time)}`}</p>
            <p className="text-base text-gray-700 dark:text-life-100">{lastText(time)}</p>
            {!time.finished && <p className="text-sm text-gray-600 dark:text-life-200">Some steps were skipped. You can go back to them, or close and tick them later.</p>}
            <div className="flex flex-wrap gap-3">
              <button type="button" onClick={() => setAt(Math.max(0, time.steps.findIndex((s) => !s.ticked)))} disabled={time.finished} className={`${big} border-2 border-life-300 text-life-700 disabled:opacity-40 dark:text-life-100`}>Go back to the skipped</button>
              <button type="button" onClick={() => onClose(time)} className={`${big} flex-1 bg-gradient-to-br from-life-500 to-life-700 text-white shadow-md`}>Close</button>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

/** A list of times to tick, with "Go through it" for each. `times` is what /api/routine-day (or a chart's) gave. */
export function Checklists({ times, setTimes }) {
  const [going, setGoing] = useState(null);
  const change = (next) => setTimes((before) => before.map((t) => (t.id === next.id ? next : t)));
  const open = times.find((t) => t.id === going);
  return (
    <>
      {times.map((t) => <TimeChecklist key={t.id} time={t} onChange={change} onGo={() => setGoing(t.id)} />)}
      {open && <GoThrough key={open.id} time={open} onChange={change} onClose={(last) => { change(last); setGoing(null); }} />}
    </>
  );
}

/** The front page's card: today's routines for this person and for everyone. Nothing shows when none falls today. */
export function RoutinesCard() {
  const [times, setTimes] = useState(null);
  const load = useCallback(() => { axios.get('/api/routine-day').then(({ data }) => setTimes(data)).catch(() => setTimes([])); }, []);
  useEffect(() => { load(); }, [load]);
  if (times === null) return null;
  if (times.length === 0) {
    return (
      <section className={cardClass} data-section="routines">
        <div className="flex items-baseline gap-2"><h2 className="flex-1 font-semibold text-life-800 dark:text-life-50">Routines</h2><Link to="/routines" className="text-xs text-life-600 hover:underline dark:text-life-200">Routines →</Link></div>
        <p className="text-sm text-gray-500 dark:text-life-300">Nothing to tick today.</p>
      </section>
    );
  }
  return <div className="contents" data-section="routines"><Checklists times={times} setTimes={setTimes} /></div>;
}
