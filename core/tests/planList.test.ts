/** The Plans page's one list: plans, holidays and trips by year, and birthdays with no plan, by date. */
import { beforeEach, expect, it } from 'vitest';
import { calendar } from '../src/calendar.ts';
import type { Db } from '../src/db.ts';
import { holidays } from '../src/holidays.ts';
import { LATEST, migrate } from '../src/migrations.ts';
import { outdoorTrips } from '../src/outdoorTrips.ts';
import { planList } from '../src/planList.ts';
import { plans } from '../src/plans.ts';
import { memoryDb } from './memoryDb.ts';

let db: Db;
let owner: number;
let day = '2026-10-01';
const clock = Object.assign(() => new Date(`${day}T10:00:00`), { today: () => day });
const THANKSGIVING = { name: 'Thanksgiving', rule: { kind: 'weekday', month: 11, weekday: 4, nth: 4 } } as const;

beforeEach(async () => {
  db = memoryDb();
  expect(await migrate(db)).toBe(LATEST);
  owner = (await db.run("INSERT INTO users (username, password_hash, created_at) VALUES ('owner', 'x', 'now')")).lastId;
  day = '2026-10-01';
});

it('puts plans, a holiday, a trip and an unplanned birthday in one list, each once, by date', async () => {
  await plans(db, owner, clock).create({ name: 'Memorial lunch', start_day: '2026-10-10' });
  await plans(db, owner, clock).create({ name: 'Yard sale', start_day: '2026-03-07' });
  await holidays(db, owner, clock).create(THANKSGIVING);
  await outdoorTrips(db, owner, clock).create({ name: 'Beach week', parts: ['fishing'], day: '2027-06-12', end_day: '2027-06-19' });
  await calendar(db, owner, clock).createEvent({ title: "Hank's birthday", day: '1990-10-20', yearly: true });

  const list = await planList(db, owner, clock).list();
  expect(list.map((l) => [l.name, l.band, l.kind, l.yearly, l.small])).toEqual([
    ['Memorial lunch', 'soon', 'gathering', false, false],
    ["Hank's birthday", 'soon', 'birthday', true, true],
    ['Thanksgiving', 'soon', 'gathering', true, false],
    ['Beach week 2027', 'later', 'trip', true, false],
    ['Yard sale', 'past', 'gathering', false, false],
  ]);
  expect(list.find((l) => l.name === 'Thanksgiving')).toMatchObject({ start_day: '2026-11-26', days_until: 56, not_started: false });
  expect(list.find((l) => l.kind === 'birthday')).toMatchObject({ start_day: '2026-10-20', years: 36, link: expect.stringMatching(/^\/plans\/date-\d+$/) });
  expect(list.find((l) => l.kind === 'trip')!.link).toMatch(/^\/plans\/\d+$/);
  // A holiday's year is a plan, so its line opens the plan page.
  expect(list.find((l) => l.name === 'Thanksgiving')!.link).toMatch(/^\/plans\/\d+$/);
});

it('shows last year of a holiday under Past and this year, not started, on its next date', async () => {
  day = '2025-11-01';
  await holidays(db, owner, clock).create(THANKSGIVING);
  day = '2026-10-01';
  const list = await planList(db, owner, clock).list();
  expect(list.map((l) => [l.name, l.band, l.not_started, l.start_day])).toEqual([
    ['Thanksgiving', 'soon', true, '2026-11-26'],
    ['Thanksgiving 2025', 'past', false, '2025-11-27'],
  ]);
});

it('leaves out a birthday that has been made into a holiday', async () => {
  const e = await calendar(db, owner, clock).createEvent({ title: "Loretta's birthday", day: '1992-12-02', yearly: true });
  await holidays(db, owner, clock).fromEvent(e.id);
  const list = await planList(db, owner, clock).list();
  expect(list.filter((l) => l.name.startsWith("Loretta's birthday")).map((l) => l.kind)).toEqual(['gathering']);
});

it('counts a plan under way as 0 days off', async () => {
  await plans(db, owner, clock).create({ name: 'Painting week', start_day: '2026-09-28', end_day: '2026-10-03' });
  expect((await planList(db, owner, clock).list())[0]).toMatchObject({ band: 'soon', days_until: 0 });
});

it('carries a plan\'s time and place to its line', async () => {
  const p = await plans(db, owner, clock).create({ name: 'Craft afternoon', start_day: '2026-10-05', parts: ['food'] });
  await plans(db, owner, clock).setWhenWhere(p.id, { start_time: '14:00', place: 'The library' });
  await plans(db, owner, clock).create({ name: 'Quiet day', start_day: '2026-10-06' });
  const list = await planList(db, owner, clock).list();
  expect(list.find((l) => l.name === 'Craft afternoon')).toMatchObject({ time: '14:00', place: 'The library' });
  expect(list.find((l) => l.name === 'Quiet day')).toMatchObject({ time: null, place: null });
});
