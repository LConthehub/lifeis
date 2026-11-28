/** A thing's pieces: listed, checked, put on the shopping list, replaced every so often, found by search, and kept through a download. */
import { beforeEach, expect, it } from 'vitest';
import type { Db } from '../src/db.ts';
import { bringInDownload, exportEverything, KINDS, splitDownload } from '../src/exportAll.ts';
import { inventory, type Inventory } from '../src/inventory.ts';
import { LATEST, migrate } from '../src/migrations.ts';
import { pieces, type PiecesOf } from '../src/pieces.ts';
import { search } from '../src/search.ts';
import { upkeep } from '../src/upkeep.ts';
import { memoryDb } from './memoryDb.ts';

let db: Db;
let owner: number;
let things: Inventory;
let parts: PiecesOf;
let cooker: number;
let day = '2046-03-05';
const clock = Object.assign(() => new Date(2046, 2, 5, 10, 0, 0), { today: () => day });
const problem = (status: number) => expect.objectContaining({ name: 'Problem', status });

async function person(name: string): Promise<number> {
  return (await db.run("INSERT INTO users (username, password_hash, created_at) VALUES (?, 'x', 'now')", [name])).lastId;
}

beforeEach(async () => {
  db = memoryDb();
  expect(await migrate(db)).toBe(LATEST);
  day = '2046-03-05';
  owner = await person('owner');
  things = inventory(db, owner, clock);
  parts = pieces(db, owner, clock);
  const kind = (await things.createKind({ name: 'Kitchen' }))[0]!.id;
  cooker = (await things.createItem({ kind_id: kind, name: 'Egg cooker' })).id;
});

const states = async (id = cooker) => (await parts.list(id)).pieces.map((p) => [p.name, p.state]);

it('a thing lists its pieces as light lines, and they never fill the Things list', async () => {
  await parts.add(cooker, { name: 'Piercing pin' });
  await parts.add(cooker, { name: 'Lid', quantity: 2, place: 'Cupboard above the sink' });
  const view = await parts.list(cooker);
  expect(view.pieces.map((p) => [p.name, p.quantity, p.place, p.state])).toEqual([['Piercing pin', 1, null, 'here'], ['Lid', 2, 'Cupboard above the sink', 'here']]);
  expect([view.missing, view.checked_on]).toEqual([0, null]);
  expect((await things.listItems()).map((t) => t.name)).toEqual(['Egg cooker']);
  expect((await things.listKinds())[0]!.items).toBe(1);
  await expect(parts.add(cooker, { name: '  ' })).rejects.toEqual(problem(400));
  await expect(parts.add(cooker, { name: 'Tray', quantity: 0 })).rejects.toEqual(problem(400));
  await expect(parts.add(cooker, { name: 'Tray', state: 'lost' })).rejects.toEqual(problem(400));
  await expect(parts.add(9999, { name: 'Tray' })).rejects.toEqual(problem(404));
});

it('checking the pieces marks the ones not found as missing, and the thing remembers the day', async () => {
  const pin = (await parts.add(cooker, { name: 'Piercing pin' })).pieces[0]!;
  const lid = (await parts.add(cooker, { name: 'Lid' })).pieces[1]!;
  await expect(parts.check(cooker, [])).resolves.toMatchObject({ missing: 2 });

  let view = await parts.check(cooker, [pin.id, lid.id]);
  expect(view).toMatchObject({ missing: 0, checked_on: '2046-03-05', checked_missing: 0 });
  expect(await states()).toEqual([['Piercing pin', 'here'], ['Lid', 'here']]);

  day = '2046-03-12';
  view = await parts.check(cooker, [lid.id]);
  expect(view).toMatchObject({ missing: 1, checked_on: '2046-03-12', checked_missing: 1 });
  expect(await states()).toEqual([['Piercing pin', 'missing'], ['Lid', 'here']]);

  // Found again at the next check.
  view = await parts.check(cooker, [pin.id, lid.id]);
  expect(view).toMatchObject({ missing: 0, checked_missing: 0 });
  await expect(parts.check(9999, [])).rejects.toEqual(problem(404));
});

it('a broken piece stays broken through a check, and counts as not here', async () => {
  const pin = (await parts.add(cooker, { name: 'Piercing pin', state: 'broken' })).pieces[0]!;
  expect(await parts.list(cooker)).toMatchObject({ missing: 1, broken: 1 });
  await parts.check(cooker, [pin.id]);
  expect(await states()).toEqual([['Piercing pin', 'broken']]);
  const fixed = await parts.update(pin.id, { name: 'Piercing pin', state: 'here' });
  expect(fixed.missing).toBe(0);
});

it('a thing with no pieces has nothing to check', async () => {
  await expect(parts.check(cooker, [])).rejects.toEqual(problem(400));
});

it('a missing piece goes on the shopping list once, with the thing it is for', async () => {
  const pin = (await parts.add(cooker, { name: 'Piercing pin', state: 'missing' })).pieces[0]!;
  const first = await parts.shop(pin.id);
  expect(first.added).toBe(true);
  const again = await parts.shop(pin.id);
  expect(again.added).toBe(false);
  const lines = await db.all<{ label: string; note: string | null; done: number }>('SELECT label, note, done FROM grocery WHERE owner_id = ?', [owner]);
  expect(lines).toEqual([{ label: 'Piercing pin', note: 'for Egg cooker', done: 0 }]);
  // Once bought, it can be put on the list again.
  await db.run('UPDATE grocery SET done = 1');
  expect((await parts.shop(pin.id)).added).toBe(true);
});

it('a piece that is replaced every so often becomes its own Upkeep job, and the job follows it', async () => {
  const jobs = upkeep(db, owner, clock);
  const made = (await parts.add(cooker, { name: 'Piercing pin', every: { n: 6, unit: 'month' } })).pieces[0]!;
  expect(made.every).toEqual({ n: 6, unit: 'month' });
  const job = await jobs.get(made.job_id!);
  expect([job.name, job.item?.name, job.every, job.first_due]).toEqual(['Egg cooker: new Piercing pin', 'Egg cooker', { n: 6, unit: 'month' }, '2046-09-05']);

  await parts.update(made.id, { name: 'Pin', every: { n: 1, unit: 'year' } });
  const renamed = await jobs.get(made.job_id!);
  expect([renamed.name, renamed.every]).toEqual(['Egg cooker: new Pin', { n: 1, unit: 'year' }]);
  expect(await jobs.list()).toHaveLength(1);

  // Saving it again without saying how often leaves the job as it is.
  await parts.update(made.id, { name: 'Pin' });
  expect((await jobs.list()).map((j) => j.name)).toEqual(['Egg cooker: new Pin']);

  // No longer replaced on a schedule: the job goes.
  const cleared = await parts.update(made.id, { name: 'Pin', every: null });
  expect(cleared.pieces[0]).toMatchObject({ every: null, job_id: null });
  expect(await jobs.list()).toEqual([]);

  // Taking the piece away takes its job too.
  const again = (await parts.update(made.id, { name: 'Pin', every: { n: 2, unit: 'week' } })).pieces[0]!;
  expect(await jobs.list()).toHaveLength(1);
  await parts.remove(again.id);
  expect(await jobs.list()).toEqual([]);
  await expect(parts.add(cooker, { name: 'Pin', every: { n: 0, unit: 'week' } })).rejects.toEqual(problem(400));
  await expect(parts.add(cooker, { name: 'Pin', every: { n: 2, unit: 'fortnight' } })).rejects.toEqual(problem(400));
});

it("one person cannot see or change another person's pieces", async () => {
  const pin = (await parts.add(cooker, { name: 'Piercing pin' })).pieces[0]!;
  const other = await person('other');
  const theirs = pieces(db, other, clock);
  await expect(theirs.list(cooker)).rejects.toEqual(problem(404));
  await expect(theirs.update(pin.id, { name: 'Mine' })).rejects.toEqual(problem(404));
  await expect(theirs.remove(pin.id)).rejects.toEqual(problem(404));
  await expect(theirs.shop(pin.id)).rejects.toEqual(problem(404));
  await expect(theirs.check(cooker, [pin.id])).rejects.toEqual(problem(404));
});

it('search finds the thing by a piece, and never lists the piece on its own', async () => {
  await parts.add(cooker, { name: 'Piercing pin' });
  const found = await search(db, owner, 'piercing');
  expect(found.map((r) => [r.kind, r.title, r.link])).toEqual([['thing', 'Egg cooker', `/things/${cooker}`]]);
  expect(found[0]!.detail).toContain('piece: Piercing pin');
  expect(await search(db, owner, 'zzz')).toEqual([]);
});

it('pieces go out in the download and come back, with what was last checked; an older download still comes back', async () => {
  const pin = (await parts.add(cooker, { name: 'Piercing pin', every: { n: 6, unit: 'month' } })).pieces[0]!;
  await parts.add(cooker, { name: 'Lid', quantity: 2, place: 'Cupboard' });
  await parts.check(cooker, [pin.id]);
  const { files } = await splitDownload((await exportEverything(db, owner, clock)).bytes);
  expect(Object.keys(files)).toContain('thing-pieces.csv');

  const bob = await person('bob');
  const all = KINDS.filter((k) => k.importable).map((k) => k.key);
  const done = await bringInDownload(db, bob, files, all, clock);
  for (const kind of done.kinds) expect(kind.ok, `${kind.key}: ${kind.problem}`).toBe(true);
  const theirs = (await inventory(db, bob, clock).listItems()).find((t) => t.name === 'Egg cooker')!;
  const view = await pieces(db, bob, clock).list(theirs.id);
  expect(view.pieces.map((p) => [p.name, p.quantity, p.place, p.state, p.every])).toEqual([
    ['Piercing pin', 1, null, 'here', { n: 6, unit: 'month' }], ['Lid', 2, 'Cupboard', 'missing', null]]);
  expect([view.checked_on, view.checked_missing]).toEqual(['2046-03-05', 1]);
  // The piece is joined to the one Upkeep job it has, not to a second.
  expect(view.pieces[0]!.job_id).not.toBeNull();
  expect((await upkeep(db, bob, clock).list()).filter((j) => j.name === 'Egg cooker: new Piercing pin')).toHaveLength(1);
  // Ana's own pieces are untouched.
  expect((await parts.list(cooker)).pieces).toHaveLength(2);

  // A download from before pieces has no such file.
  delete files['thing-pieces.csv'];
  const carol = await person('carol');
  const older = await bringInDownload(db, carol, files, all, clock);
  for (const kind of older.kinds) expect(kind.ok, `${kind.key}: ${kind.problem}`).toBe(true);
  const eggs = (await inventory(db, carol, clock).listItems()).find((t) => t.name === 'Egg cooker')!;
  expect((await pieces(db, carol, clock).list(eggs.id)).pieces).toEqual([]);
});

it('taking a thing away takes its pieces with it', async () => {
  await parts.add(cooker, { name: 'Piercing pin' });
  await things.deleteItem(cooker);
  expect((await db.get<{ n: number }>('SELECT COUNT(*) AS n FROM item_pieces'))!.n).toBe(0);
});
