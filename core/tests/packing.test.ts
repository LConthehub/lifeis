/** Moving and packing: numbered boxes, how far along each is, and unpacking in one step. */
import { beforeEach, expect, it } from 'vitest';
import type { Db } from '../src/db.ts';
import { inventory, type Inventory } from '../src/inventory.ts';
import { media } from '../src/media.ts';
import { LATEST, migrate } from '../src/migrations.ts';
import { packing } from '../src/packing.ts';
import { search } from '../src/search.ts';
import { memoryDb } from './memoryDb.ts';

let db: Db;
let owner: number;
let things: Inventory;
let kind: number;
const clock = () => new Date(2046, 2, 5, 10, 0, 0);
const problem = (status: number) => expect.objectContaining({ name: 'Problem', status });

async function person(name: string): Promise<number> {
  return (await db.run("INSERT INTO users (username, password_hash, created_at) VALUES (?, 'x', 'now')", [name])).lastId;
}

beforeEach(async () => {
  db = memoryDb();
  expect(await migrate(db)).toBe(LATEST);
  owner = await person('owner');
  things = inventory(db, owner, clock);
  kind = (await things.createKind({ name: 'Kitchen things' }))[0]!.id;
});

it('boxes are made in one go, numbered on from the last, and say where they are going', async () => {
  const move = packing(db, owner, clock);
  let p = await move.makeBoxes({ count: 3, destination: 'Kitchen' });
  expect(p.boxes.map((b) => [b.name, b.state, b.destination])).toEqual([['Box 1', 'packing', 'Kitchen'], ['Box 2', 'packing', 'Kitchen'], ['Box 3', 'packing', 'Kitchen']]);
  const garage = (await things.createPlace({ name: 'Garage' })).find((x) => x.name === 'Garage')!.id;
  p = await move.makeBoxes({ count: 9, destination: 'Bedroom', parent_id: garage });
  expect(p.boxes.map((b) => b.name).slice(-3)).toEqual(['Box 10', 'Box 11', 'Box 12']); // in number order, not 1, 10, 11, 2
  expect(p.boxes.at(-1)!.path).toBe('Garage › Box 12');
  expect(p.counts).toEqual({ packing: 12, packed: 0, moved: 0, unpacked: 0 });
  await expect(move.makeBoxes({ count: 0 })).rejects.toEqual(problem(400));
  await expect(move.makeBoxes({ count: 500 })).rejects.toEqual(problem(400));
  await expect(packing(db, await person('other'), clock).setBox(p.boxes[0]!.id, { state: 'packed' })).rejects.toEqual(problem(404));
});

it('a box lists what is in it, is found by search, and unpacks into its new home in one step', async () => {
  const move = packing(db, owner, clock);
  const box = (await move.makeBoxes({ count: 1, destination: 'Kitchen' })).boxes[0]!;
  const kettle = await things.createItem({ kind_id: kind, name: 'Kettle', place_id: box.id });
  await things.createItem({ kind_id: kind, name: 'Toaster', place_id: box.id });
  const book = await media(db, owner, clock).create({ type: 'book', title: 'Salt Fat Acid Heat' }, { format: 'Hardcover', place_id: box.id });

  let p = await move.setBox(box.id, { state: 'packed' });
  expect(p.boxes[0]!.contents.map((c) => [c.kind, c.name])).toEqual([['thing', 'Kettle'], ['thing', 'Toaster'], ['title', 'Salt Fat Acid Heat']]);
  expect([p.counts.packed, p.things]).toEqual([1, 3]);
  expect((await search(db, owner, 'kettle')).map((r) => r.detail)).toEqual(['Kitchen things · 📍 Box 1']); // which box has the kettle?
  await expect(move.setBox(box.id, { state: 'lost' })).rejects.toEqual(problem(400));

  const cupboard = (await things.createPlace({ name: 'New kitchen cupboard' })).find((x) => x.name === 'New kitchen cupboard')!.id;
  const done = await move.unpack(box.id, cupboard);
  expect([done.moved, done.boxes[0]!.state, done.boxes[0]!.contents]).toEqual([3, 'unpacked', []]);
  expect((await things.getItem(kettle.id)).place).toBe('New kitchen cupboard');
  expect((await things.itemHistory(kettle.id))[0]).toMatchObject({ what: 'moved', from_place: 'Box 1', to_place: 'New kitchen cupboard', note: 'unpacked' });
  expect((await media(db, owner, clock).get(book.id)).copies[0]!.place).toBe('New kitchen cupboard');
  await expect(move.unpack(box.id, box.id)).rejects.toEqual(problem(400));
  await expect(move.unpack(cupboard, box.id)).rejects.toEqual(problem(400)); // a cupboard isn't a box

  // Any place can become a box, and stop being one, keeping what's in it.
  expect((await move.setBox(cupboard, { destination: 'Storage' })).boxes.map((b) => [b.name, b.state])).toContainEqual(['New kitchen cupboard', 'packing']);
  expect((await move.notABox(cupboard)).boxes.map((b) => b.name)).toEqual(['Box 1']);
  expect((await things.getItem(kettle.id)).place).toBe('New kitchen cupboard');
});
