/** "Did it": one tap records today on a thing; a chore or job with no schedule can be saved and tapped too. */
import { beforeEach, expect, it } from 'vitest';
import type { Db } from '../src/db.ts';
import { inventory } from '../src/inventory.ts';
import { LATEST, migrate } from '../src/migrations.ts';
import { upkeep } from '../src/upkeep.ts';
import { memoryDb } from './memoryDb.ts';

let db: Db;
let ana: number;
let bo: number;
let clockDay = '2046-03-05';
const clock = () => new Date(`${clockDay}T10:00:00Z`);
const problem = (status: number) => expect.objectContaining({ name: 'Problem', status });

async function person(name: string): Promise<number> {
  return (await db.run("INSERT INTO users (username, password_hash, created_at, is_admin) VALUES (?, 'x', 'now', 0)", [name])).lastId;
}

beforeEach(async () => {
  db = memoryDb();
  expect(await migrate(db)).toBe(LATEST);
  ana = await person('ana');
  bo = await person('bo');
  clockDay = '2046-03-05';
});

it('a thing says nothing was done until Did it is tapped, then today and how many times', async () => {
  const things = inventory(db, ana, clock);
  const kind = (await things.createKind({ name: 'Appliances' }))[0]!.id;
  const thing = await things.createItem({ name: 'Water filter', kind_id: kind });
  expect(await things.didSummary(thing.id)).toEqual({ last_day: null, last_id: null, times: 0 });
  const first = await things.didIt(thing.id);
  expect(first).toMatchObject({ last_day: '2046-03-05', times: 1 });
  clockDay = '2046-03-08';
  const second = await things.didIt(thing.id);
  expect(second).toMatchObject({ last_day: '2046-03-08', times: 2 });
  // A day given is kept; the latest day is still the last.
  expect((await things.didIt(thing.id, '2046-03-01')).last_day).toBe('2046-03-08');
  await expect(things.didIt(thing.id, 'someday')).rejects.toEqual(problem(400));
});

it('undo takes back one record, and only the owner can record or undo', async () => {
  const things = inventory(db, ana, clock);
  const kind = (await things.createKind({ name: 'Appliances' }))[0]!.id;
  const thing = await things.createItem({ name: 'Smoke alarm', kind_id: kind });
  const one = await things.didIt(thing.id);
  clockDay = '2046-03-09';
  const two = await things.didIt(thing.id);
  const other = inventory(db, bo, clock);
  await expect(other.didIt(thing.id)).rejects.toEqual(problem(404));
  await expect(other.didSummary(thing.id)).rejects.toEqual(problem(404));
  await expect(other.undoDid(two.last_id!)).rejects.toEqual(problem(404));
  const back = await things.undoDid(two.last_id!);
  expect(back).toEqual({ last_day: '2046-03-05', last_id: one.last_id, times: 1 });
  await expect(things.undoDid(two.last_id!)).rejects.toEqual(problem(404));
});

it('records go with the thing when it is deleted', async () => {
  const things = inventory(db, ana, clock);
  const kind = (await things.createKind({ name: 'Appliances' }))[0]!.id;
  const thing = await things.createItem({ name: 'Kettle', kind_id: kind });
  await things.didIt(thing.id);
  await things.deleteItem(thing.id);
  expect(await db.get('SELECT 1 AS one FROM item_did')).toBeUndefined();
});

it('a chore with no schedule can be saved, shows no due date, and one tap records today', async () => {
  const jobs = upkeep(db, ana, clock);
  const chore = await jobs.create({ name: 'Wipe the counters', kind: 'chore' });
  expect(chore.every).toBeNull();
  expect(chore.due).toMatchObject({ state: 'unscheduled', next_day: null, days_left: null });
  expect(chore.last_done).toBeNull();
  const done = await jobs.done(chore.id, {});
  expect(done.job.last_done?.day).toBe('2046-03-05');
  expect(done.job.due.next_day).toBeNull();
  const undone = await jobs.undo(done.done[0]!.id);
  expect(undone.last_done).toBeNull();
});
