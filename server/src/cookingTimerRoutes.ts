/**
 * The addresses for cooking timers (/api/cooking/timers) and the sending when one ends. The timers themselves are
 * in cookTimers.ts. A person sees and stops only their own.
 *
 * A finished timer goes out the person's own ways that reach a phone and a watch: browser push and ntfy. Never
 * email (a note to yourself an hour late is no use), and nothing else leaves the computer.
 */
import { reminders, type Db, type Digest, type Fetcher, type PushSender } from '../../core/src/index.ts';
import type { CookTimer, CookTimers } from './cookTimers.ts';
import { Refusal, read, type Route } from './http.ts';

export type TimerSending = { fetcher?: Fetcher; push?: PushSender; clock: () => Date; onError: (problem: unknown) => void };

/** What a finished timer says, and how: in full for browser push (locked) and for ntfy unless counts only were chosen. */
function finished(t: CookTimer, now: Date): Digest {
  const title = `Timer done: ${t.label}`;
  const link = t.recipe_id ? `/recipes/${t.recipe_id}` : '/recipes';
  const body = 'Your cooking timer has ended.';
  return {
    day: '', lines: [], title, text: body,
    single: { title, body, link, hidden: { title: 'Timer done', body: 'A cooking timer has ended.' } },
  };
}

/** Sends a finished timer by browser push and ntfy, whichever the person turned on. Says nothing when neither is. */
export function sendFinished(db: Db, tools: TimerSending) {
  return async (timer: CookTimer): Promise<void> => {
    const mine = reminders(db, timer.user, tools.clock, { fetcher: tools.fetcher, push: tools.push });
    const s = await mine.settings();
    const note = finished(timer, tools.clock());
    for (const [on, channel] of [[s.push, 'push'], [s.ntfy !== null, 'ntfy']] as const) {
      if (!on) continue;
      const result = await mine.send(note, channel);
      for (const problem of result.problems) tools.onError(new Error(`Timer for person ${timer.user}: ${problem}`));
    }
  };
}

export function cookingTimerRoutes(timers: CookTimers): Route[] {
  const ID = '([0-9]{1,15})';
  return [
    ['GET', /^\/api\/cooking\/timers$/, async (c) => ({ json: timers.list(c.user.id) })],
    ['POST', /^\/api\/cooking\/timers$/, async (c) => {
      const minutes = read.maybeNumber(c.body, 'minutes');
      if (minutes === null) throw new Refusal(422, 'Say how many minutes');
      return { status: 201, json: timers.start(c.user.id, read.maybeText(c.body, 'label') ?? '', read.maybeWhole(c.body, 'recipe_id'), minutes) };
    }],
    ['POST', new RegExp(`^/api/cooking/timers/${ID}/more$`), async (c) => {
      const found = timers.extend(c.user.id, c.id, read.maybeNumber(c.body, 'minutes') ?? 1);
      if (!found) throw new Refusal(404, 'Not found');
      return { json: found };
    }],
    ['DELETE', new RegExp(`^/api/cooking/timers/${ID}$`), async (c) => {
      // A timer that already ended is gone: stopping it is not an error.
      timers.stop(c.user.id, c.id);
      return { status: 204 };
    }],
  ];
}
