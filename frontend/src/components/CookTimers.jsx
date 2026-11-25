import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import { onDevice } from '../where';
import { errorMessage } from './ui';

/**
 * Timers in the cooking view. They run on the server (so one still goes off, and reaches the phone and the Watch,
 * when this page is closed or the phone is locked) and are counted down here for the eyes. On the phone app that keeps
 * everything on the phone there is no server: the timers are kept here and the phone's own notification is
 * scheduled for the end, through phoneReminders.js.
 */

const pad = (n) => String(n).padStart(2, '0');
export const clockOf = (seconds) => {
  const s = Math.max(0, seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
};
/** 12 -> "12 min", 90 -> "1 hr 30 min". */
export const minutesWords = (m) => (m < 60 ? `${m} min` : `${Math.floor(m / 60)} hr${m % 60 ? ` ${m % 60} min` : ''}`);
const shortName = (words) => {
  const one = String(words || '').replace(/\s+/g, ' ').trim().replace(/[.!:;,\s]+$/, '');
  if (!one) return 'Timer';
  if (one.length <= 40) return one;
  const cut = one.slice(0, 40);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), 20))}...`;
};

/** A short beep, three times, made with Web Audio (no sound files). Quiet where the browser will not allow it. */
function beep(ctx) {
  try {
    if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    for (let i = 0; i < 3; i += 1) {
      const start = ctx.currentTime + i * 0.35;
      const tone = ctx.createOscillator();
      const gain = ctx.createGain();
      tone.type = 'sine';
      tone.frequency.value = 880;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.4, start + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.25);
      tone.connect(gain).connect(ctx.destination);
      tone.start(start);
      tone.stop(start + 0.28);
    }
  } catch { /* no sound: the notice on the screen is still there */ }
}

let localCount = 0;

/** What the cooking view needs to run timers. `recipeId` is where a tapped notification leads. */
export function useCookTimers(recipeId) {
  const [timers, setTimers] = useState([]);          // { id, label, endsAt (ms, on this page's clock) }
  const [done, setDone] = useState([]);              // { id, label }: ended, with the notice still showing
  const [, tick] = useState(0);
  const [ways, setWays] = useState(null);            // { push, ntfy } when asked of the server; null while unknown
  const local = onDevice();
  const audio = useRef(null);

  /** Made on a tap, because browsers only allow sound after one. */
  const unlock = () => {
    try {
      if (!audio.current) audio.current = new (window.AudioContext || window.webkitAudioContext)();
      if (audio.current.state === 'suspended') audio.current.resume().catch(() => {});
    } catch { /* no sound on this browser */ }
  };

  const fromServer = useCallback((t) => ({ id: t.id, label: t.label, endsAt: Date.now() + t.seconds_left * 1000 }), []);

  const load = useCallback(() => {
    if (local) return;
    axios.get('/api/cooking/timers').then(({ data }) => {
      setTimers(data.map(fromServer));
    }).catch(() => {});
  }, [local, fromServer]);

  useEffect(() => {
    load();
    if (!local) axios.get('/api/reminders').then(({ data }) => setWays({ push: Boolean(data.settings.push), ntfy: Boolean(data.settings.ntfy) })).catch(() => setWays(null));
    const back = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', back);
    // After a reload the page has had no tap yet, and browsers keep sound quiet until one: the first tap anywhere in the view allows it.
    document.addEventListener('pointerdown', unlock);
    return () => { document.removeEventListener('visibilitychange', back); document.removeEventListener('pointerdown', unlock); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load, local]);

  // One beat a second: shows the time left, and notices a timer that has run out.
  const timersRef = useRef([]);
  useEffect(() => { timersRef.current = timers; }, [timers]);
  useEffect(() => {
    const beat = setInterval(() => {
      const now = Date.now();
      const over = timersRef.current.filter((t) => t.endsAt <= now);
      if (over.length) {
        timersRef.current = timersRef.current.filter((t) => t.endsAt > now);
        setTimers(timersRef.current);
        setDone((was) => [...was, ...over.map((t) => ({ id: t.id, label: t.label }))]);
        beep(audio.current);
        try { navigator.vibrate?.([300, 150, 300, 150, 300]); } catch { /* not everywhere */ }
      }
      tick((n) => n + 1);
    }, 1000);
    return () => clearInterval(beat);
  }, []);

  const noticeOnPhone = async (id, label, endsAt) => {
    try {
      const { scheduleTimerNotice } = await import('../device/phoneReminders.js');
      await scheduleTimerNotice(id, label, new Date(endsAt), recipeId);
    } catch { /* the notice on the page still works */ }
  };

  const start = async (label, minutes) => {
    unlock();
    const name = shortName(label);
    if (local) {
      localCount += 1;
      const one = { id: 3000 + (localCount % 20), label: name, endsAt: Date.now() + minutes * 60_000 };
      setTimers((before) => [...before.filter((t) => t.id !== one.id), one]);
      noticeOnPhone(one.id, name, one.endsAt);
      return null;
    }
    try {
      const { data } = await axios.post('/api/cooking/timers', { label: name, minutes, recipe_id: recipeId ?? null });
      setTimers((before) => [...before, fromServer(data)]);
      return null;
    } catch (err) { return errorMessage(err, "That timer couldn't be started."); }
  };

  const stop = async (id) => {
    setTimers((before) => before.filter((t) => t.id !== id));
    if (local) { import('../device/phoneReminders.js').then((m) => m.cancelTimerNotice(id)).catch(() => {}); return; }
    axios.delete(`/api/cooking/timers/${id}`).catch(() => {});
  };

  const more = async (id) => {
    if (local) {
      const found = timers.find((t) => t.id === id);
      if (!found) return;
      const endsAt = found.endsAt + 60_000;
      setTimers((before) => before.map((t) => (t.id === id ? { ...t, endsAt } : t)));
      noticeOnPhone(id, found.label, endsAt);
      return;
    }
    try {
      const { data } = await axios.post(`/api/cooking/timers/${id}/more`, { minutes: 1 });
      setTimers((before) => before.map((t) => (t.id === id ? fromServer(data) : t)));
    } catch { load(); }
  };

  const dismiss = (id) => setDone((was) => was.filter((d) => d.id !== id));

  return { timers, done, local, ways, start, stop, more, dismiss, unlock };
}

const buttonClass = 'min-h-[44px] rounded-full border-2 border-life-500 px-4 text-base font-semibold text-life-700 dark:border-life-300 dark:text-life-100';

/** The running timers as a strip at the top of the cooking view, and the notice for one that has ended. */
export function TimerStrip({ cook }) {
  const { timers, done, local, ways } = cook;
  const now = Date.now();
  const noWay = !local && ways && !ways.push && !ways.ntfy;
  return (
    <>
      {done.length > 0 && (
        <div role="alert" className="fixed inset-x-0 top-0 z-[60] space-y-2 bg-honey-100 p-3 shadow-lg dark:bg-honey-700" data-timer-done>
          {done.map((d) => (
            <div key={d.id} className="mx-auto flex max-w-2xl items-center gap-3">
              <p className="mr-auto min-w-0 break-words text-xl font-semibold text-gray-900 dark:text-white">Timer done: {d.label}</p>
              <button type="button" onClick={() => cook.dismiss(d.id)} className="min-h-[44px] shrink-0 rounded-full bg-life-700 px-5 text-base font-semibold text-white">OK</button>
            </div>
          ))}
        </div>
      )}
      {timers.length > 0 && (
        <section aria-label="Timers" data-timers className="sticky top-0 z-10 -mx-4 space-y-2 border-b border-life-200 bg-card px-4 py-2 shadow-sm dark:border-life-600 dark:bg-life-800">
          <ul className="space-y-2">
            {[...timers].sort((a, b) => a.endsAt - b.endsAt).map((t) => (
              <li key={t.id} data-timer className="flex flex-wrap items-center gap-2">
                <span className="w-full min-w-0 break-words text-base text-gray-900 dark:text-life-50">{t.label}</span>
                <span className="mr-auto font-mono text-2xl font-semibold tabular-nums text-life-700 dark:text-life-100" aria-label={`${clockOf(Math.ceil((t.endsAt - now) / 1000))} left`}>{clockOf(Math.ceil((t.endsAt - now) / 1000))}</span>
                <button type="button" onClick={() => cook.more(t.id)} className={buttonClass} aria-label={`Add 1 minute to ${t.label}`}>+1 min</button>
                <button type="button" onClick={() => cook.stop(t.id)} className={buttonClass} aria-label={`Stop the timer for ${t.label}`}>Stop</button>
              </li>
            ))}
          </ul>
          <p className="text-sm text-gray-600 dark:text-life-200">
            {local
              ? 'The phone shows a notice when a timer ends, even if the app is closed.'
              : 'Timers are kept in memory. If Life Is restarts, running timers are lost.'}
            {noWay && <> To get a notice on your phone and Watch, turn on browser notifications or ntfy in <Link to="/settings/reminders#reminders" className="underline">Settings</Link>.</>}
          </p>
        </section>
      )}
    </>
  );
}

/** Under a step: the one-tap button when the step names a time, and a small Timer button to type minutes. */
export function StepTimer({ step, name, cook }) {
  const [typing, setTyping] = useState(false);
  const [minutes, setMinutes] = useState('');
  const [problem, setProblem] = useState('');
  const go = async (m) => {
    setProblem('');
    const said = await cook.start(name, m);
    if (said) setProblem(said); else { setTyping(false); setMinutes(''); }
  };
  const typed = Number(minutes);
  const ok = Number.isFinite(typed) && typed >= 1 && typed <= 1440;
  return (
    <div className="flex flex-wrap items-center gap-2 pb-2 pl-16 pr-3">
      {step.timer_minutes ? <button type="button" onClick={() => go(step.timer_minutes)} className={`${buttonClass} bg-life-50 dark:bg-life-700`}>Start {minutesWords(step.timer_minutes)} timer</button> : null}
      {!typing && <button type="button" onClick={() => setTyping(true)} className={buttonClass} aria-label={`Set a timer for step: ${name}`}>Timer</button>}
      {typing && (
        <form className="flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); if (ok) go(Math.round(typed)); }}>
          <input type="number" inputMode="numeric" min="1" max="1440" value={minutes} onChange={(e) => setMinutes(e.target.value)} autoFocus
            aria-label="Minutes" placeholder="Minutes" className="min-h-[44px] w-28 rounded-xl border-2 border-life-300 bg-card px-3 text-base text-gray-900 dark:border-life-500 dark:bg-life-900 dark:text-life-50" />
          <button type="submit" disabled={!ok} className="min-h-[44px] rounded-full bg-life-700 px-5 text-base font-semibold text-white disabled:opacity-50">Start</button>
          <button type="button" onClick={() => setTyping(false)} className={buttonClass}>Cancel</button>
        </form>
      )}
      {problem && <span role="alert" className="text-sm text-red-700 dark:text-red-300">{problem}</span>}
    </div>
  );
}
