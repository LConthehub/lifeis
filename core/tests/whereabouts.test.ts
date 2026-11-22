/** A whole home inventoried: where each thing has been, what it's used for, its stickers, and scanning. */
import { beforeEach, expect, it } from 'vitest';
import type { Db } from '../src/db.ts';
import { inventory, type Inventory } from '../src/inventory.ts';
import { media } from '../src/media.ts';
import { LATEST, migrate } from '../src/migrations.ts';
import { projects } from '../src/projects.ts';
import { whatIsThis } from '../src/whereabouts.ts';
import { memoryDb } from './memoryDb.ts';

let db: Db;
let owner: number;
let things: Inventory;
let kind: number;
let time = new Date(2046, 2, 5, 10, 0, 0);
const clock = () => time;
const problem = (status: number) => expect.objectContaining({ name: 'Problem', status });

async function person(name: string): Promise<number> {
  return (await db.run("INSERT INTO users (username, password_hash, created_at) VALUES (?, 'x', 'now')", [name])).lastId;
}
async function place(name: string, parent: number | null = null): Promise<number> {
  const all = await things.createPlace({ name, parent_id: parent });
  return all.filter((p) => p.name === name && p.parent_id === parent).at(-1)!.id;
}

beforeEach(async () => {
  db = memoryDb();
  expect(await migrate(db)).toBe(LATEST);
  owner = await person('owner');
  time = new Date(2046, 2, 5, 10, 0, 0);
  things = inventory(db, owner, clock);
  kind = (await things.createKind({ name: 'Household', icon: '🏠' }))[0]!.id;
});

it('a thing remembers where it came in, and every move after, with places as they were named then', async () => {
  const room = await place("Leo's room");
  const shelf = await place('Bookshelf', room);
  const garage = await place('Garage');
  const lamp = await things.createItem({ kind_id: kind, name: 'Lava lamp', place_id: shelf });
  time = new Date(2046, 2, 9, 18, 0, 0);
  await things.moveItem(lamp.id, garage, 'too bright at night');
  await things.moveItem(lamp.id, garage); // already there: nothing new
  time = new Date(2046, 2, 12, 9, 0, 0);
  await things.updateItem(lamp.id, { name: 'Lava lamp', place_id: null });
  await things.updatePlace(shelf, { name: 'Tall shelf', parent_id: room }); // a rename later doesn't rewrite the past

  expect((await things.itemHistory(lamp.id)).map((h) => [h.what, h.day, h.from_place, h.to_place, h.note])).toEqual([
    ['moved', '2046-03-12', 'Garage', null, null],
    ['moved', '2046-03-09', "Leo's room › Bookshelf", 'Garage', 'too bright at night'],
    ['added', '2046-03-05', null, "Leo's room › Bookshelf", null],
  ]);
  await expect(things.moveItem(lamp.id, 9999)).rejects.toEqual(problem(404));
});

it('a use is logged with its project, which also says the activity, or an activity on its own', async () => {
  const making = projects(db, owner, clock);
  const drill = await things.createItem({ kind_id: kind, name: 'Drill', activities: ['DIY', 'diy', ' ', 'Woodwork'] });
  expect(drill.activities).toEqual(['DIY', 'Woodwork']);
  const shed = await making.createProject({ name: 'Shed shelves', activity: 'Woodwork' });
  await things.logUse(drill.id, { project_id: shed.id, note: 'pilot holes' });
  const history = await things.logUse(drill.id, { day: '2046-03-01', activity: 'Repairs' });
  expect(history.map((h) => [h.what, h.day, h.project, h.activity, h.note])).toEqual([
    ['used', '2046-03-05', 'Shed shelves', 'Woodwork', 'pilot holes'],
    ['added', '2046-03-05', null, null, null],
    ['used', '2046-03-01', null, 'Repairs', null],
  ]);
  await expect(things.logUse(drill.id, { day: 'soon' })).rejects.toEqual(problem(400));
  await expect(things.logUse(drill.id, { project_id: 9999 })).rejects.toEqual(problem(404));
});

it('activities gather what things are for and what projects are, without minding case', async () => {
  const making = projects(db, owner, clock);
  await things.createItem({ kind_id: kind, name: 'Sewing machine', activities: ['Sewing'] });
  await things.createItem({ kind_id: kind, name: 'Pinking shears', activities: ['sewing', 'Quilting'] });
  await making.createProject({ name: 'Linen dress', activity: 'SEWING' });
  expect(await things.listActivities()).toEqual([
    { name: 'Quilting', things: 1, projects: 0, jobs: 0 },
    { name: 'Sewing', things: 2, projects: 1, jobs: 0 },
  ]);
  const sewing = await things.activity('sewing');
  expect([sewing.name, sewing.things.map((t) => t.name), sewing.projects.map((p) => p.name)]).toEqual(['Sewing', ['Pinking shears', 'Sewing machine'], ['Linen dress']]);
});

it('stickers: a thing keeps its code; a blank sticker becomes the code of what it is put on', async () => {
  const lamp = await things.createItem({ kind_id: kind, name: 'Lamp' });
  const [first] = await things.thingStickers([lamp.id]);
  const [again] = await things.thingStickers([lamp.id]);
  expect(first!.code).toMatch(/^[2-9A-HJ-NP-Z]{10}$/);
  expect(again!.code).toBe(first!.code);

  const blanks = await things.blankCodes(3);
  expect(new Set(blanks).size).toBe(3);
  const kite = await things.createItem({ kind_id: kind, name: 'Kite', code: blanks[0]!.toLowerCase() });
  expect(kite.code).toBe(blanks[0]);
  await expect(things.createItem({ kind_id: kind, name: 'Another kite', code: blanks[0] })).rejects.toEqual(problem(409));
  await expect(things.createItem({ kind_id: kind, name: 'Odd', code: 'not-a-code' })).rejects.toEqual(problem(400));
});

it('a photo is kept only when it is one, and replaced by the next', async () => {
  const lamp = await things.createItem({ kind_id: kind, name: 'Lamp' });
  expect(lamp.photo).toBe(false);
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
  expect((await things.setPhoto(lamp.id, jpeg)).photo).toBe(true);
  expect((await things.photo(lamp.id))!.type).toBe('image/jpeg');
  await expect(things.setPhoto(lamp.id, new Uint8Array([1, 2, 3]))).rejects.toEqual(problem(400));
  expect((await things.removePhoto(lamp.id)).photo).toBe(false);
});

it('a scan says what it is: a place, a thing by its sticker or box, copies by barcode, a blank sticker, or unknown', async () => {
  const shelf = await place('Shelf');
  const [placeSticker] = await things.stickers();
  const blender = await things.createItem({ kind_id: kind, name: 'Blender', barcode: '0 12345-67890 5' });
  const [blenderSticker] = await things.thingStickers([blender.id]);
  const books = media(db, owner, clock);
  const dune = await books.create({ type: 'book', title: 'Dune' }, { format: 'Paperback', barcode: '9780441172719', place_id: shelf });

  expect(await whatIsThis(db, owner, `https://life.example/p/${placeSticker!.code}`)).toEqual({ kind: 'place', place: { id: shelf, name: 'Shelf', path: 'Shelf' } });
  expect(await whatIsThis(db, owner, placeSticker!.code)).toMatchObject({ kind: 'place' });
  expect(await whatIsThis(db, owner, `https://life.example/t/${blenderSticker!.code}`)).toMatchObject({ kind: 'thing', item: { name: 'Blender' } });
  expect(await whatIsThis(db, owner, '012345678905')).toMatchObject({ kind: 'thing', item: { name: 'Blender' } });
  expect(await whatIsThis(db, owner, '978-0-441-17271-9')).toEqual({ kind: 'copies', copies: [
    { copy_id: dune.copies[0]!.id, media_id: dune.id, title: 'Dune', type: 'book', format: 'Paperback', place_id: shelf, place: 'Shelf' },
  ] });
  expect(await whatIsThis(db, owner, 'https://life.example/t/ABCDEFGHJK')).toEqual({ kind: 'new-sticker', code: 'ABCDEFGHJK' });
  expect(await whatIsThis(db, owner, '9780140449136')).toEqual({ kind: 'unknown', barcode: '9780140449136', isbn: true });
  expect(await whatIsThis(db, owner, '5012345678900')).toEqual({ kind: 'unknown', barcode: '5012345678900', isbn: false });

  // Someone else's stickers and barcodes are nothing to this person.
  const other = await person('other');
  expect(await whatIsThis(db, other, '012345678905')).toMatchObject({ kind: 'unknown' });
  expect(await whatIsThis(db, other, `https://life.example/t/${blenderSticker!.code}`)).toMatchObject({ kind: 'unknown' });
  await expect(whatIsThis(db, other, `https://life.example/p/${placeSticker!.code}`)).rejects.toEqual(problem(404));
});

it("a copy of a book or film keeps the same history as a thing", async () => {
  const shelf = await place('Shelf');
  const loft = await place('Loft');
  const books = media(db, owner, clock);
  const dune = await books.create({ type: 'book', title: 'Dune' }, { format: 'Paperback', place_id: shelf });
  const copy = dune.copies[0]!.id;
  time = new Date(2046, 2, 6, 10, 0, 0);
  await books.moveCopy(copy, loft);
  await books.updateCopy(copy, { format: 'Paperback', place_id: shelf });
  expect((await books.copyHistory(copy)).map((h) => [h.what, h.from_place, h.to_place])).toEqual([
    ['moved', 'Loft', 'Shelf'], ['moved', 'Shelf', 'Loft'], ['added', null, 'Shelf'],
  ]);
});
