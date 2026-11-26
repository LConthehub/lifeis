/** One tap on a thing records a use; Undo takes back that use and nothing else. A chore with no schedule can be tapped done. */
import { beforeEach, expect, it } from 'vitest';
import type { Db } from '../src/db.ts';
import { inventory } from '../src/inventory.ts';
import { LATEST, migrate } from '../src/migrations.ts';
import { upkeep } from '../src/upkeep.ts';
import { memoryDb } from './memoryDb.ts';

let db: Db;
let ana: number;
let bo: number;
const clock = () => new Date('2046-03-05T10:00:00Z');
const problem = (status: number) => expect.objectContaining({ name: 'Problem', status });

async function person(name: string): Promise<number> {
  return (await db.run("INSERT INTO users (username, password_hash, created_at, is_admin) VALUES (?, 'x', 'now', 0)", [name])).lastId;
}

beforeEach(async () => {
  db = memoryDb();
  expect(await migrate(db)).toBe(LATEST);
  ana = await person('ana');
  bo = await person('bo');
});

it('undoUse takes back one use, keeps the rest of the history, and is the owner alone', async () => {
  const things = inventory(db, ana, clock);
  const kind = (await things.createKind({ name: 'Appliances' }))[0]!.id;
  const thing = await things.createItem({ name: 'Water filter', kind_id: kind });
  await things.logUse(thing.id, { note: 'with details' });
  const after = await things.logUse(thing.id, {});
  const uses = after.filter((h) => h.what === 'used');
  expect(uses).toHaveLength(2);
  const quick = Math.max(...uses.map((h) => h.id));
  await expect(inventory(db, bo, clock).undoUse(quick)).rejects.toEqual(problem(404));
  const back = await things.undoUse(quick);
  expect(back.filter((h) => h.what === 'used')).toHaveLength(1);
  expect(back.some((h) => h.note === 'with details')).toBe(true);
  expect(back).toHaveLength(after.length - 1);
  await expect(things.undoUse(quick)).rejects.toEqual(problem(404));
});

it('undoUse refuses an entry that is not a use', async () => {
  const things = inventory(db, ana, clock);
  const kind = (await things.createKind({ name: 'Appliances' }))[0]!.id;
  const thing = await things.createItem({ name: 'Kettle', kind_id: kind });
  const first = (await things.itemHistory(thing.id))[0]!;
  expect(first.what).not.toBe('used');
  await expect(things.undoUse(first.id)).rejects.toEqual(problem(404));
});

it('a chore with no schedule can be saved, shows no due date, and one tap records today', async () => {
  const jobs = upkeep(db, ana, clock);
  const chore = await jobs.create({ name: 'Wipe the counters', kind: 'chore' });
  expect(chore.every).toBeNull();
  expect(chore.due).toMatchObject({ state: 'unscheduled', next_day: null, days_left: null });
  expect(chore.last_done).toBeNull();
  const done = await jobs.done(chore.id, {});
  expect(done.job.last_done?.day).toBe('2046-03-05');
  const undone = await jobs.undo(done.done[0]!.id);
  expect(undone.last_done).toBeNull();
});
