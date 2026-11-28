/**
 * Switching a connection off without losing its setup. The check box on a Settings card turns a connection off at
 * once and keeps what was saved (accounts, links, keys), so checking it again needs no typing. While it is off,
 * nothing is asked of the outside: every call a connection makes goes through here first.
 *
 * Kept as one small setting per kind and person, so it needs no table of its own.
 */
import type { Db } from './db.ts';
import { Problem } from './problem.ts';

export const PAUSABLE = ['mail', 'calendars', 'photos'] as const;
export type Pausable = typeof PAUSABLE[number];
export type PausedKinds = Record<Pausable, boolean>;

const key = (what: Pausable) => `paused_${what}`;

/** For a query on followed calendars (aliased f) with the owner as its last `?`: true while that person has switched them off. */
export const PAUSED_CALENDARS = "EXISTS (SELECT 1 FROM user_settings p WHERE p.user_id = ? AND p.key = 'paused_calendars' AND p.value = '1')";

export async function isPaused(db: Db, owner: number, what: Pausable): Promise<boolean> {
  const row = await db.get<{ value: string | null }>('SELECT value FROM user_settings WHERE user_id = ? AND key = ?', [owner, key(what)]);
  return row?.value === '1';
}

export async function pausedKinds(db: Db, owner: number): Promise<PausedKinds> {
  const out = {} as PausedKinds;
  for (const what of PAUSABLE) out[what] = await isPaused(db, owner, what);
  return out;
}

export async function setPaused(db: Db, owner: number, what: Pausable, paused: boolean): Promise<PausedKinds> {
  if (!PAUSABLE.includes(what)) throw new Problem(400, 'That cannot be switched off this way');
  if (paused) await db.run(`INSERT INTO user_settings (user_id, key, value) VALUES (?, ?, '1') ON CONFLICT(user_id, key) DO UPDATE SET value = '1'`, [owner, key(what)]);
  else await db.run('DELETE FROM user_settings WHERE user_id = ? AND key = ?', [owner, key(what)]);
  return pausedKinds(db, owner);
}

/** The same call, refused with a plain reason while that connection is switched off. */
export function unlessPaused<A extends unknown[], R>(db: Db, owner: number, what: Pausable, call: (...args: A) => Promise<R>): (...args: A) => Promise<R> {
  return async (...args: A) => {
    if (await isPaused(db, owner, what)) throw new Problem(400, 'This is turned off in Settings. Check its box there to use it again.');
    return call(...args);
  };
}

/** Every method of a set of calls, each refused while switched off. */
export function unlessPausedAll<T extends { [name: string]: (...args: never[]) => Promise<unknown> }>(db: Db, owner: number, what: Pausable, calls: T): T {
  return Object.fromEntries(Object.entries(calls).map(([name, call]) => [name, unlessPaused(db, owner, what, call as (...args: unknown[]) => Promise<unknown>)])) as unknown as T;
}
