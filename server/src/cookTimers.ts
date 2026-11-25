/**
 * Cooking timers, kept in this server's memory (nothing in the database). Each one is set to go off with
 * setTimeout when it is started, so it is on time and does not wait for the minute loop. A restart of the server
 * loses the running ones. A person only ever sees and stops their own.
 */
import { MOST_TIMER_MINUTES, Problem } from '../../core/src/index.ts';

export type CookTimer = { id: number; user: number; label: string; recipe_id: number | null; ends_at: number };
/** What a page is told about a timer. `seconds_left` is used rather than a clock time, so a page with a slow clock still counts right. */
export type TimerView = { id: number; label: string; recipe_id: number | null; ends_at: number; seconds_left: number };

export const MOST_TIMERS = 20;

export type TimerTools = {
  /** Called when a timer ends (it is already gone from the list). Never throws into the timer. */
  notify: (timer: CookTimer) => Promise<void>;
  now?: () => number;
  /** Runs a function after some milliseconds; gives back a way to cancel it. */
  later?: (run: () => void, ms: number) => () => void;
};

const realLater = (run: () => void, ms: number) => {
  const handle = setTimeout(run, ms);
  handle.unref();
  return () => clearTimeout(handle);
};

export function cookTimers(tools: TimerTools) {
  const now = tools.now ?? (() => Date.now());
  const later = tools.later ?? realLater;
  const running = new Map<number, { timer: CookTimer; cancel: () => void }>();
  let counter = 0;

  const view = (t: CookTimer): TimerView => ({ id: t.id, label: t.label, recipe_id: t.recipe_id, ends_at: t.ends_at, seconds_left: Math.max(0, Math.ceil((t.ends_at - now()) / 1000)) });

  function arm(timer: CookTimer): void {
    const cancel = later(() => {
      running.delete(timer.id);
      tools.notify(timer).catch((problem) => console.error(problem));
    }, Math.max(0, timer.ends_at - now()));
    running.set(timer.id, { timer, cancel });
  }

  const minutesOk = (minutes: number) => {
    if (!Number.isFinite(minutes) || minutes < 1 || minutes > MOST_TIMER_MINUTES) throw new Problem(400, `A timer runs from 1 minute to ${MOST_TIMER_MINUTES / 60} hours`);
    return Math.round(minutes);
  };

  return {
    start(user: number, label: string, recipeId: number | null, minutes: number): TimerView {
      const mine = [...running.values()].filter((r) => r.timer.user === user).length;
      if (mine >= MOST_TIMERS) throw new Problem(400, `Keep it to ${MOST_TIMERS} timers at once`);
      const name = label.replace(/\s+/g, ' ').trim().slice(0, 120) || 'Timer';
      const timer: CookTimer = { id: ++counter, user, label: name, recipe_id: recipeId, ends_at: now() + minutesOk(minutes) * 60_000 };
      arm(timer);
      return view(timer);
    },

    list(user: number): TimerView[] {
      return [...running.values()].filter((r) => r.timer.user === user).map((r) => view(r.timer)).sort((a, b) => a.ends_at - b.ends_at || a.id - b.id);
    },

    /** Stops a timer; true if it was this person's and still running. */
    stop(user: number, id: number): boolean {
      const one = running.get(id);
      if (!one || one.timer.user !== user) return false;
      one.cancel();
      running.delete(id);
      return true;
    },

    /** Adds minutes to a running timer; null if it isn't this person's or has already ended. */
    extend(user: number, id: number, minutes: number): TimerView | null {
      const one = running.get(id);
      if (!one || one.timer.user !== user) return null;
      one.cancel();
      const timer = { ...one.timer, ends_at: one.timer.ends_at + minutesOk(minutes) * 60_000 };
      arm(timer);
      return view(timer);
    },
  };
}

export type CookTimers = ReturnType<typeof cookTimers>;
