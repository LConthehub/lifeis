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
  for (const free of ['/api/kitchen/recipes', '/api/device/backup', '/api/device/restore', '/api/home', '/api/life', '/api/health']) expect(isPaidPath(free)).toBe(false);
  for (const paid of ['/api/things/items', '/api/projects/3/costs', '/api/plans', '/api/calendar/events', '/api/media', '/api/mail/accounts', '/api/money/entries', '/api/assistant/ask']) expect(isPaidPath(paid)).toBe(true);
  const ended = accessNow({ trial_started: BEGAN, unlocked: false }, at('2046-06-01T00:00:00Z'));
  expect(decide(ended, 'POST', '/api/kitchen/recipes')).toBe('go');
  expect(decide(ended, 'POST', '/api/device/backup')).toBe('go');
});

it('keeps tagging recipes free, and covers tagging the rest', () => {
  for (const free of ['/api/tags', '/api/tags/on/recipe/12']) expect(isPaidPath(free)).toBe(false);
  for (const paid of ['/api/tags/on/thing/3', '/api/tags/on/spending/9', '/api/tags/bulk', '/api/tags/4', '/api/tags/4/merge']) expect(isPaidPath(paid)).toBe(true);
  const ended = accessNow({ trial_started: BEGAN, unlocked: false }, at('2046-06-01T00:00:00Z'));
  expect(decide(ended, 'PUT', '/api/tags/on/recipe/12')).toBe('go');
  expect(decide(ended, 'GET', '/api/tags/4')).toBe('go');
  expect(decide(ended, 'PUT', '/api/tags/on/thing/3')).toBe('read_only');
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

it('covers making and changing routines, and keeps ticking them free after the trial', () => {
  for (const paid of ['/api/routines', '/api/routines/4', '/api/routines/starters', '/api/tags/on/routine/4']) expect(isPaidPath(paid)).toBe(true);
  for (const free of ['/api/routine-day', '/api/routine-day/steps/7', '/api/routine-day/times/3', '/api/routine-day/steps/7/low']) expect(isPaidPath(free)).toBe(false);
  const ended = accessNow({ trial_started: BEGAN, unlocked: false }, at('2046-06-01T00:00:00Z'));
  // After the trial: reading is still fine, making and changing are not, and ticking (and un-ticking) is.
  expect(decide(ended, 'GET', '/api/routines')).toBe('go');
  expect([decide(ended, 'POST', '/api/routines'), decide(ended, 'PUT', '/api/routines/4'), decide(ended, 'DELETE', '/api/routines/4'), decide(ended, 'POST', '/api/routines/starters')]).toEqual(['read_only', 'read_only', 'read_only', 'read_only']);
  expect([decide(ended, 'PUT', '/api/routine-day/steps/7'), decide(ended, 'PUT', '/api/routine-day/times/3'), decide(ended, 'POST', '/api/routine-day/steps/7/low')]).toEqual(['go', 'go', 'go']);
  // Ticking never begins the trial; making a routine does.
  const fresh = accessNow({ trial_started: null, unlocked: false }, at(BEGAN));
  expect([decide(fresh, 'PUT', '/api/routine-day/steps/7'), decide(fresh, 'POST', '/api/routines')]).toEqual(['go', 'start']);
});

it('covers changing the house manual, home lab, shopping, cooking, keys and recalls once the trial has ended, and keeps reading and the download free', () => {
  const six = ['/api/manual/entries', '/api/manual/entries/4', '/api/manual/share', '/api/home-services', '/api/home-services/2/pin', '/api/shopping/prices', '/api/shopping/trips/3',
    '/api/cooking/timers', '/api/keys', '/api/keys/5', '/api/recalls/check', '/api/recalls/vehicles/2'];
  for (const path of six) expect(isPaidPath(path)).toBe(true);
  const ended = accessNow({ trial_started: BEGAN, unlocked: false }, at('2046-06-01T00:00:00Z'));
  for (const path of six) {
    expect(decide(ended, 'GET', path)).toBe('go');
    for (const method of ['POST', 'PUT', 'DELETE']) expect(decide(ended, method, path)).toBe('read_only');
  }
  // The download of everything is always free, and so are the kitchen and backups.
  expect(decide(ended, 'GET', '/api/export/everything.zip')).toBe('go');
  expect(decide(ended, 'POST', '/api/kitchen/recipes')).toBe('go');
  // Before the trial begins, adding to one of them begins it; after unlocking, nothing is refused.
  expect(decide(accessNow({ trial_started: null, unlocked: false }, at(BEGAN)), 'POST', '/api/manual/entries')).toBe('start');
  expect(decide(accessNow({ trial_started: BEGAN, unlocked: true }, at('2046-06-01T00:00:00Z')), 'POST', '/api/manual/entries')).toBe('go');
});
