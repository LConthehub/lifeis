/** What a person wants Life Is to look after: asked once, theirs to change, and never taking anything away. */
import { beforeEach, expect, it } from 'vitest';
import type { Db } from '../src/db.ts';
import { inventory } from '../src/inventory.ts';
import { life, sectionsFor, type Life } from '../src/life.ts';
import { migrate } from '../src/migrations.ts';
import { memoryDb } from './memoryDb.ts';

let db: Db;
let owner: number;
let mine: Life;
const EVERYTHING = ['eating', 'planning', 'keeping', 'making', 'enjoying', 'spending'];

beforeEach(async () => {
  db = memoryDb();
  await migrate(db);
  owner = (await db.run("INSERT INTO users (username, password_hash, created_at) VALUES ('owner', 'x', 'now')")).lastId;
  mine = life(db, owner);
});

it('until it is answered, and if it is skipped, everything shows', async () => {
  const asked = await mine.getProfile();
  expect([asked.areas, asked.sections]).toEqual([null, EVERYTHING]);
  expect(asked.options.map((o) => o.key)).toEqual(['eating', 'keeping', 'making', 'planning', 'enjoying', 'spending', 'cookware', 'clothing', 'sewing', 'knitting', 'woodworking', 'gardening', 'home', 'car', 'art', 'electronics', 'music', 'outdoors', 'writing']);
  const skipped = await mine.saveProfile([]);
  expect([skipped.areas, skipped.sections, skipped.added]).toEqual([[], EVERYTHING, []]);
  expect((await mine.getProfile()).areas).toEqual([]); // answered: not asked again
});

it('the sections that show are the ones the ticks need', () => {
  expect(sectionsFor(['eating'])).toEqual(['eating']);
  expect(sectionsFor(['sewing'])).toEqual(['keeping', 'making']); // something you make needs its things and its projects
  expect(sectionsFor(['making', 'eating'])).toEqual(['eating', 'making']);
  expect(sectionsFor(['gardening', 'eating'])).toEqual(['eating', 'keeping', 'making']);
  expect(sectionsFor(['enjoying', 'planning'])).toEqual(['planning', 'enjoying']);
});

it('ticking something you make adds its ready-made kinds, once, and unticking takes nothing away', async () => {
  const things = inventory(db, owner);
  await things.createKind({ name: 'Fabric', fields: [{ name: 'My own field', type: 'text' }] });
  const saved = await mine.saveProfile(['sewing', 'eating']);
  expect([saved.areas, saved.sections]).toEqual([['eating', 'sewing'], ['eating', 'keeping', 'making']]);
  expect(saved.added).toEqual(['Notions', 'Sewing patterns']); // the Fabric they already had is left exactly as it was
  expect((await things.listKinds()).find((k) => k.name === 'Fabric')!.fields.map((f) => f.name)).toEqual(['My own field']);
  expect((await mine.saveProfile(['sewing', 'eating'])).added).toEqual([]);

  const less = await mine.saveProfile(['eating']);
  expect([less.sections, less.added]).toEqual([['eating'], []]);
  expect((await things.listKinds()).map((k) => k.name)).toEqual(['Fabric', 'Notions', 'Sewing patterns']); // out of sight, still there

  await expect(mine.saveProfile(['eating', 'alchemy'])).rejects.toMatchObject({ name: 'Problem', status: 400 });
  expect((await mine.getProfile()).areas).toEqual(['eating']);
});

it("each person answers for themselves", async () => {
  await mine.saveProfile(['gardening']);
  const other = (await db.run("INSERT INTO users (username, password_hash, created_at) VALUES ('other', 'x', 'now')")).lastId;
  expect((await life(db, other).getProfile()).areas).toBeNull();
  expect(await inventory(db, other).listKinds()).toEqual([]);
});
