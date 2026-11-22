/** Upkeep: jobs that come round again, by the calendar or by a reading, and what doing one does. */
import { beforeEach, describe, expect, it } from 'vitest';
import { calendar } from '../src/calendar.ts';
import type { Db } from '../src/db.ts';
import { inventory, type Inventory } from '../src/inventory.ts';
import { kitchen } from '../src/kitchen.ts';
import { LATEST, migrate } from '../src/migrations.ts';
import { money } from '../src/money.ts';
import { addInterval, dueOf, upkeep, type Upkeep } from '../src/upkeep.ts';
import { memoryDb } from './memoryDb.ts';

let db: Db;
let owner: number;
let things: Inventory;
let jobs: Upkeep;
let kind: number;
let time = new Date(2046, 2, 5, 10, 0, 0);
const clock = () => time;
const problem = (status: number) => expect.objectContaining({ name: 'Problem', status });

async function person(name: string): Promise<number> {
  return (await db.run("INSERT INTO users (username, password_hash, created_at) VALUES (?, 'x', 'now')", [name])).lastId;
}

beforeEach(async () => {
  db = memoryDb();
  expect(await migrate(db)).toBe(LATEST);
  owner = await person('owner');
  time = new Date(2046, 2, 5, 10, 0, 0);
  things = inventory(db, owner, clock);
  jobs = upkeep(db, owner, clock);
  kind = (await things.createKind({ name: 'Household', icon: '🏠' }))[0]!.id;
});

describe('when a job is next due', () => {
  it('a month on from the 31st is the end of the next month', () => {
    expect([addInterval('2046-01-31', 1, 'month'), addInterval('2046-11-30', 3, 'month'), addInterval('2048-02-29', 1, 'year'), addInterval('2046-03-05', 2, 'week')])
      .toEqual(['2046-02-28', '2047-02-28', '2049-02-28', '2046-03-19']);
  });
  it('by time: late, due, soon or later, with soon shorter for jobs that come round often', () => {
    const every3m = { every_n: 3, every_unit: 'month' as const, every_reading: null, first_due: null };
    expect(dueOf(every3m, { day: '2045-12-01', reading: null }, null, '2046-03-05')).toMatchObject({ state: 'overdue', next_day: '2046-03-01', days_left: -4 });
    expect(dueOf(every3m, { day: '2045-12-15', reading: null }, null, '2046-03-05')).toMatchObject({ state: 'soon', days_left: 10 });
    expect(dueOf(every3m, { day: '2046-02-01', reading: null }, null, '2046-03-05')).toMatchObject({ state: 'later' });
    const weekly = { every_n: 1, every_unit: 'week' as const, every_reading: null, first_due: null };
    expect(dueOf(weekly, { day: '2046-03-01', reading: null }, null, '2046-03-05').state).toBe('later'); // 3 days off, but a week's "soon" is 2
    expect(dueOf(every3m, null, null, '2046-03-05')).toMatchObject({ state: 'due', next_day: '2046-03-05' }); // never done: due now
  });
  it('by reading, or whichever comes first', () => {
    const oil = { every_n: 6, every_unit: 'month' as const, every_reading: 5000, first_due: null };
    // 4,700 miles on and only two months: due soon by the miles.
    expect(dueOf(oil, { day: '2046-01-05', reading: 40000 }, 44700, '2046-03-05')).toMatchObject({ state: 'soon', next_reading: 45000, reading_left: 300 });
    expect(dueOf(oil, { day: '2046-01-05', reading: 40000 }, 45200, '2046-03-05')).toMatchObject({ state: 'overdue', reading_left: -200 });
    // Hardly driven, but six months gone: due by time.
    expect(dueOf(oil, { day: '2045-09-01', reading: 40000 }, 40500, '2046-03-05').state).toBe('overdue');
  });
});

it('a job is kept with its tools, supplies and the thing it is for, and starts from when it was last done', async () => {
  const car = await things.createItem({ kind_id: kind, name: 'Car' });
  const wrench = await things.createItem({ kind_id: kind, name: 'Filter wrench', activities: ['Car'] });
  const oil = await things.createItem({ kind_id: kind, name: 'Motor oil', quantity: 10, unit: 'qt', low_at: 6 });
  const job = await jobs.create({
    name: 'Change the oil', activity: 'Car', item_id: car.id, every_n: 6, every_unit: 'month', every_reading: 5000, reading_unit: 'miles',
    tools: [wrench.id, wrench.id], supplies: [{ item_id: oil.id, quantity: 5, unit: 'qt' }], last_done: { day: '2046-01-05', reading: 40000 },
  });
  expect([job.item?.name, job.tools.map((t) => t.name), job.supplies.map((s) => [s.name, s.amount, s.have])]).toEqual(['Car', ['Filter wrench'], [['Motor oil', '5 quart', '10 quart']]]);
  expect(job.due).toMatchObject({ next_day: '2046-07-05', next_reading: 45000, latest_reading: 40000 });

  // The car's miles, read without doing the job, move it closer.
  expect((await jobs.reading(job.id, 44600)).due).toMatchObject({ state: 'soon', reading_left: 400 });
  await expect(jobs.create({ name: 'Bad', every_n: 3 })).rejects.toEqual(problem(400));
  await expect(jobs.create({ name: 'Bad', every_n: 1, every_unit: 'fortnight' })).rejects.toEqual(problem(400));
  await expect(jobs.create({ name: 'Bad', tools: [9999] })).rejects.toEqual(problem(404));
});

it('doing a job: tools note the use, supplies come out of stock, low ones go to the list, the cost to spending', async () => {
  const filter = await things.createItem({ kind_id: kind, name: 'Furnace filter 16x25', quantity: 2, low_at: 1 });
  const ladder = await things.createItem({ kind_id: kind, name: 'Step ladder', activities: ['Painting'] });
  const job = await jobs.create({ name: 'Change the furnace filter', activity: 'Home maintenance', every_n: 3, every_unit: 'month', tools: [ladder.id], supplies: [{ item_id: filter.id, quantity: 1 }] });
  const bills = await money(db, owner, clock).addCategory({ name: 'House', monthly_cents: 20000 });

  const result = await jobs.done(job.id, { minutes: 10, cost_cents: 1899, note: 'MERV 11', spend: { category_id: bills.id } });
  expect(result.job.due).toMatchObject({ state: 'later', next_day: '2046-06-05' });
  expect(result.done.map((d) => [d.day, d.by, d.minutes, d.cost_cents, d.money_entry_id !== null])).toEqual([['2046-03-05', 'owner', 10, 1899, true]]);
  expect(result.to_buy).toEqual(['Furnace filter 16x25']);
  expect((await things.getItem(filter.id)).quantity).toBe(1);
  expect((await kitchen(db, owner, clock).listGrocery()).map((g) => g.label)).toEqual(['Furnace filter 16x25']);
  expect((await things.itemHistory(ladder.id))[0]).toMatchObject({ what: 'used', job: 'Change the furnace filter', job_id: job.id, activity: 'Home maintenance' });
  expect((await money(db, owner, clock).month('2046-03')).entries.map((e: { label: string; cents: number }) => [e.label, e.cents])).toEqual([['Change the furnace filter', 1899]]);

  // Done again: the last filter goes, and it isn't put on the list twice.
  time = new Date(2046, 5, 6, 10, 0, 0);
  const again = await jobs.done(job.id, {});
  expect([again.to_buy, (await things.getItem(filter.id)).quantity]).toEqual([[], 0]);
  // Taken back, the time before counts again.
  expect((await jobs.undo(again.done[0]!.id)).due.next_day).toBe('2046-06-05');
});

it('a supply measured another way than it is kept is left to change by hand', async () => {
  const salt = await things.createItem({ kind_id: kind, name: 'Softener salt', quantity: 3, unit: 'bag' });
  const job = await jobs.create({ name: 'Top up the softener', every_n: 1, every_unit: 'month', supplies: [{ item_id: salt.id, quantity: 20, unit: 'lb' }] });
  expect((await jobs.done(job.id, {})).check_by_hand).toEqual(['Softener salt']);
  expect((await things.getItem(salt.id)).quantity).toBe(3);
});

it('a job given to someone else is theirs to see and do, but only its owner changes it', async () => {
  const partner = await person('partner');
  const theirs = upkeep(db, partner, clock);
  const job = await jobs.create({ name: 'Clean the gutters', every_n: 6, every_unit: 'month', assigned_to: partner });
  expect((await theirs.list()).map((j) => [j.name, j.mine, j.owner, j.assigned_to?.name])).toEqual([['Clean the gutters', false, 'owner', 'partner']]);
  expect((await theirs.done(job.id, {})).done[0]!.by).toBe('partner');
  await expect(theirs.update(job.id, { name: 'Mine now' })).rejects.toEqual(problem(403));
  await expect(theirs.remove(job.id)).rejects.toEqual(problem(403));

  const stranger = upkeep(db, await person('stranger'), clock);
  expect(await stranger.list()).toEqual([]);
  await expect(stranger.get(job.id)).rejects.toEqual(problem(404));
  await expect(stranger.done(job.id, {})).rejects.toEqual(problem(404));
});

it('the calendar shows a job on the day it comes round, and anything late on today', async () => {
  await jobs.create({ name: 'Test the alarms', every_n: 1, every_unit: 'month', last_done: { day: '2046-02-08' } });
  await jobs.create({ name: 'Flush the water heater', every_n: 1, every_unit: 'year', last_done: { day: '2045-01-10' } });
  const days = (await calendar(db, owner, clock).between('2046-03-05', 7)).filter((e) => e.kind === 'upkeep');
  expect(days.map((e) => [e.day, e.title, e.detail])).toEqual([
    ['2046-03-05', 'Flush the water heater', 'late by 54 days'],
    ['2046-03-08', 'Test the alarms', null],
  ]);
});
