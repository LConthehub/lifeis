/**
 * What is free and what the one-time unlock covers, when Life Is keeps everything on the device.
 *
 * Free for good: the kitchen (recipes, the week, groceries, the pantry, prices) and backups.
 * Covered by the unlock: everything else kept on the device (routines included: making and changing them. Ticking a
 * step, or finishing a time, lives under /api/routine-day and stays free after the trial, so a routine can always be used). Each of those can be tried for a week, counted
 * from the first time something is written in one of them.
 *
 * The promise that matters: when the trial ends, nothing that was entered is hidden or taken away. Those
 * parts can still be read, searched and backed up; they just can't be changed until Life Is is unlocked.
 *
 * None of this applies to a Life Is someone hosts themselves, or to the app when it is connected to one.
 * Nothing here talks to a shop: whether it has been unlocked, and when the trial began, are handed in.
 */
import { ACTION_LIST } from './actions.ts';

export const TRIAL_DAYS = 7;
export const PRICE = '$14.99';
/** The first part of an address (/api/<this>/…) for each part the unlock covers. */
export const PAID_PARTS = ['things', 'projects', 'plans', 'calendar', 'media', 'mail', 'money', 'assistant', 'routines'] as const;

export type Held = { trial_started: string | null; unlocked: boolean };
export type Access = {
  /** unlocked: paid for. unstarted: nothing covered has been written yet. trial: within the trial's days. ended: after them. */
  state: 'unlocked' | 'unstarted' | 'trial' | 'ended';
  /** Whole days of trial left, counting today. 0 once it has ended; null when unlocked. */
  days_left: number | null;
  trial_days: number;
  price: string;
};

const DAY = 86_400_000;

export function accessNow(held: Held, now: Date): Access {
  const base = { trial_days: TRIAL_DAYS, price: PRICE };
  if (held.unlocked) return { state: 'unlocked', days_left: null, ...base };
  const began = held.trial_started ? Date.parse(held.trial_started) : NaN;
  if (Number.isNaN(began)) return { state: 'unstarted', days_left: TRIAL_DAYS, ...base };
  // A clock set back before the trial began doesn't lengthen it.
  const left = Math.ceil((began + TRIAL_DAYS * DAY - Math.max(now.getTime(), began)) / DAY);
  return left > 0 ? { state: 'trial', days_left: left, ...base } : { state: 'ended', days_left: 0, ...base };
}

/** Whether an address belongs to a part the unlock covers. */
export function isPaidPath(path: string): boolean {
  const part = /^\/api\/([a-z-]+)/.exec(path)?.[1];
  // A short request from Siri, Google or a link belongs to the part of Life Is it touches.
  const action = /^\/api\/actions\/([a-z-]+)/.exec(path)?.[1];
  if (action) return ACTION_LIST.find((a) => a.id === action)?.part !== 'kitchen';
  // Bringing a download back in writes into every part at once, so it counts as a change to the paid parts.
  // Downloading everything, and looking a file over, stay free: your data is always yours to take.
  if (/^\/api\/export\/(bring-in|pictures)$/.test(path)) return true;
  // Tags reach into every part. Tagging a recipe, and making a tag name for it, stay free with the kitchen;
  // tagging anything else, tagging many at once, and renaming, nesting, merging or deleting tags are covered.
  if (part === 'tags') return !/^\/api\/tags(\/on\/recipe\/[0-9]+)?$/.test(path);
  return (PAID_PARTS as readonly string[]).includes(part ?? '');
}

export const ENDED_MESSAGE = `The free trial of this part of Life Is has ended. Everything you entered is still here to read and to back up. Unlocking Life Is (${PRICE}, once) lets you change it again.`;

/**
 * What to do with one request: 'go', 'start' (go, and the trial begins now), or 'read_only' (refuse: the
 * trial has ended and this would change something).
 */
export function decide(access: Access, method: string, path: string): 'go' | 'start' | 'read_only' {
  if (access.state === 'unlocked' || !isPaidPath(path) || method === 'GET') return 'go';
  if (access.state === 'unstarted') return 'start';
  return access.state === 'ended' ? 'read_only' : 'go';
}
