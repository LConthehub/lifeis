/** One search across everything a person keeps. */
import { beforeEach, expect, it } from 'vitest';
import type { Db } from '../src/db.ts';
import { inventory } from '../src/inventory.ts';
import { kitchen } from '../src/kitchen.ts';
import { media } from '../src/media.ts';
import { LATEST, migrate } from '../src/migrations.ts';
import { projects } from '../src/projects.ts';
import { search } from '../src/search.ts';
import { upkeep } from '../src/upkeep.ts';
import { memoryDb } from './memoryDb.ts';

let db: Db;
let owner: number;
const clock = () => new Date(2046, 2, 5, 10, 0, 0);

async function person(name: string): Promise<number> {
  return (await db.run("INSERT INTO users (username, password_hash, created_at) VALUES (?, 'x', 'now')", [name])).lastId;
}

beforeEach(async () => {
  db = memoryDb();
  expect(await migrate(db)).toBe(LATEST);
  owner = await person('owner');
  const things = inventory(db, owner, clock);
  const kind = (await things.createKind({ name: 'Fabric', icon: '🧶' }))[0]!.id;
  const room = (await things.createPlace({ name: 'Sewing room' }))[0]!.id;
  const shelf = (await things.createPlace({ name: 'Shelf', parent_id: room })).find((p) => p.name === 'Shelf')!.id;
  await things.createItem({ kind_id: kind, name: 'Linen, blue', place_id: shelf, activities: ['Sewing'] });
  await things.createItem({ kind_id: kind, name: '100% wool', note: 'for the blue coat' });
  await kitchen(db, owner, clock).createRecipe({ title: 'Blueberry muffins', ingredients_text: '1 cup blueberries', tags: ['breakfast'] });
  await media(db, owner, clock).create({ type: 'book', title: 'The Blue Sword', creator: 'Robin McKinley' }, { format: 'Paperback', place_id: shelf, lent_to: 'Sam' });
  await projects(db, owner, clock).createProject({ name: 'Blue linen dress', activity: 'Sewing' });
  await upkeep(db, owner, clock).create({ name: 'Oil the sewing machine', activity: 'Sewing', every_n: 6, every_unit: 'month' });
});

it('finds every kind of thing, each leading to its own page', async () => {
  const found = await search(db, owner, 'blue');
  expect(found.map((r) => [r.kind, r.title, r.detail, r.link])).toEqual([
    ['recipe', 'Blueberry muffins', 'Recipe · breakfast', '/recipes/1'],
    ['project', 'Blue linen dress', 'Project · Sewing · idea', '/projects/1'],
    ['thing', 'Linen, blue', 'Fabric · 📍 Sewing room › Shelf', '/things/1'],
    ['title', 'The Blue Sword', 'Robin McKinley · with Sam', '/media/1'],
    ['thing', '100% wool', 'Fabric', '/things/2'], // found by its note
  ]);
});

it('every word has to be there, in any order, and a place is found by its whole path', async () => {
  expect((await search(db, owner, 'blue linen')).map((r) => r.title)).toEqual(['Blue linen dress', 'Linen, blue']);
  expect((await search(db, owner, 'shelf sewing')).map((r) => [r.kind, r.title, r.detail])).toEqual([['place', 'Shelf', 'Place · Sewing room › Shelf']]);
  expect((await search(db, owner, 'sewing')).map((r) => r.kind).sort()).toEqual(['job', 'place', 'place', 'project', 'thing']); // the fabric, by what it's for
  expect((await search(db, owner, 'sam')).map((r) => r.title)).toEqual(['The Blue Sword']); // who has it
  expect((await search(db, owner, 'blue', 'title')).map((r) => r.title)).toEqual(['The Blue Sword']);
  expect(await search(db, owner, '   ')).toEqual([]);
});

it('a % or _ typed is looked for as itself, and nobody finds anyone else’s', async () => {
  expect((await search(db, owner, '100%')).map((r) => r.title)).toEqual(['100% wool']);
  expect(await search(db, owner, '_')).toEqual([]);
  expect(await search(db, await person('other'), 'blue')).toEqual([]);
  await expect(search(db, owner, 'x'.repeat(101))).rejects.toMatchObject({ name: 'Problem', status: 400 });
  await expect(search(db, owner, 'blue', 'secrets' as never)).rejects.toMatchObject({ name: 'Problem', status: 400 });
});
