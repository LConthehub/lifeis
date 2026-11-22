/** What is free on the device, the week's trial of the rest, and what happens when it ends. */
import { expect, it } from 'vitest';
import { accessNow, decide, isPaidPath, ENDED_MESSAGE } from '../src/access.ts';

const at = (iso: string) => new Date(iso);
const BEGAN = '2046-03-01T09:00:00.000Z';

it('counts fourteen days from when the trial began, and not before it begins', () => {
  expect(accessNow({ trial_started: null, unlocked: false }, at('2046-03-01T09:00:00Z'))).toMatchObject({ state: 'unstarted', days_left: 7, price: '$14.99' });
  expect(accessNow({ trial_started: BEGAN, unlocked: false }, at('2046-03-01T09:00:01Z'))).toMatchObject({ state: 'trial', days_left: 7 });
  expect(accessNow({ trial_started: BEGAN, unlocked: false }, at('2046-03-07T08:00:00Z'))).toMatchObject({ state: 'trial', days_left: 2 });
  expect(accessNow({ trial_started: BEGAN, unlocked: false }, at('2046-03-08T08:59:59Z'))).toMatchObject({ state: 'trial', days_left: 1 });
  expect(accessNow({ trial_started: BEGAN, unlocked: false }, at('2046-03-08T09:00:00Z'))).toMatchObject({ state: 'ended', days_left: 0 });
  // Setting the clock back doesn't buy more than the fourteen days.
  expect(accessNow({ trial_started: BEGAN, unlocked: false }, at('2040-01-01T00:00:00Z'))).toMatchObject({ state: 'trial', days_left: 7 });
  expect(accessNow({ trial_started: 'nonsense', unlocked: false }, at('2046-03-01T09:00:00Z')).state).toBe('unstarted');
  expect(accessNow({ trial_started: BEGAN, unlocked: true }, at('2050-01-01T00:00:00Z'))).toMatchObject({ state: 'unlocked', days_left: null });
});

it('keeps the kitchen and backups free, whatever the trial says', () => {
  for (const free of ['/api/kitchen/recipes', '/api/shopping/prices', '/api/device/backup', '/api/device/restore', '/api/home', '/api/life', '/api/health']) expect(isPaidPath(free)).toBe(false);
  for (const paid of ['/api/things/items', '/api/projects/3/costs', '/api/plans', '/api/calendar/events', '/api/media', '/api/mail/accounts', '/api/money/entries', '/api/assistant/ask']) expect(isPaidPath(paid)).toBe(true);
  const ended = accessNow({ trial_started: BEGAN, unlocked: false }, at('2046-06-01T00:00:00Z'));
  expect(decide(ended, 'POST', '/api/kitchen/recipes')).toBe('go');
  expect(decide(ended, 'POST', '/api/device/backup')).toBe('go');
});

it('begins the trial at the first thing written, and afterwards only stops changes, never reading', () => {
  const fresh = accessNow({ trial_started: null, unlocked: false }, at(BEGAN));
  expect(decide(fresh, 'GET', '/api/things/items')).toBe('go'); // looking doesn't start the clock
  expect(decide(fresh, 'POST', '/api/things/items')).toBe('start');
  const trying = accessNow({ trial_started: BEGAN, unlocked: false }, at('2046-03-05T00:00:00Z'));
  expect(decide(trying, 'POST', '/api/projects')).toBe('go');
  const ended = accessNow({ trial_started: BEGAN, unlocked: false }, at('2046-06-01T00:00:00Z'));
  expect(decide(ended, 'GET', '/api/projects/3')).toBe('go');
  for (const method of ['POST', 'PUT', 'DELETE']) expect(decide(ended, method, '/api/projects/3')).toBe('read_only');
  const paid = accessNow({ trial_started: BEGAN, unlocked: true }, at('2046-06-01T00:00:00Z'));
  expect(decide(paid, 'DELETE', '/api/projects/3')).toBe('go');
  expect(ENDED_MESSAGE).toMatch(/still here to read/);
});
