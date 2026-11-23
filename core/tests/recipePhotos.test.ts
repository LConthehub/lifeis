/** A recipe's picture: kept, asked for, replaced, taken away, private to its owner, and carried by a backup and a file of recipes. */
import { beforeEach, expect, it } from 'vitest';
import { makeBackup, restoreBackup } from '../src/backup.ts';
import type { Db } from '../src/db.ts';
import { kitchen, type Kitchen } from '../src/kitchen.ts';
import { MAX_THING_PHOTO } from '../src/inventory.ts';
import { LATEST, migrate } from '../src/migrations.ts';
import { readRecipeFile } from '../src/recipeFiles.ts';
import { memoryDb } from './memoryDb.ts';

const clock = Object.assign(() => new Date(Date.UTC(2046, 2, 5, 10, 0, 0)), { today: () => '2046-03-05' });
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...Array.from({ length: 300 }, (_, i) => (i * 7) % 256)]);
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, ...Array.from({ length: 300 }, (_, i) => (i * 11) % 256)]);
const WEBP = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 1, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 9, 9, 9, 9]);
const problem = (status: number) => expect.objectContaining({ name: 'Problem', status });

let db: Db;
let mine: Kitchen;
let theirs: Kitchen;
let ownerId: number;

beforeEach(async () => {
  db = memoryDb();
  expect(await migrate(db)).toBe(LATEST);
  ownerId = (await db.run("INSERT INTO users (username, password_hash, created_at) VALUES ('me', 'x', 'now')")).lastId;
  const other = (await db.run("INSERT INTO users (username, password_hash, created_at) VALUES ('you', 'x', 'now')")).lastId;
  mine = kitchen(db, ownerId, clock);
  theirs = kitchen(db, other, clock);
});

it('keeps a picture, says so in the list and the recipe, and gives it back as it was', async () => {
  const soup = await mine.createRecipe({ title: 'Soup', ingredients_text: '1 leek' });
  expect(soup.has_photo).toBe(false);
  expect((await mine.listRecipes())[0]!.has_photo).toBe(false);
  expect(await mine.photo(soup.id)).toBeNull();

  const after = await mine.setPhoto(soup.id, PNG);
  expect(after.has_photo).toBe(true);
  expect(after.photo_added_at).toMatch(/^2046-03-05/); // when it was added is kept
  expect((await mine.listRecipes())[0]!.has_photo).toBe(true);
  expect((await mine.getRecipe(soup.id)).has_photo).toBe(true);
  const back = (await mine.photo(soup.id))!;
  expect(back.type).toBe('image/png');
  expect(Array.from(back.bytes)).toEqual(Array.from(PNG));
  // Words are not touched by a picture.
  expect(after.ingredients_text).toBe('1 leek');
});

it('keeps JPEG, PNG and WebP by what the bytes are, and one picture at a time', async () => {
  const r = await mine.createRecipe({ title: 'Pie' });
  expect((await mine.setPhoto(r.id, JPEG)).has_photo).toBe(true);
  expect((await mine.photo(r.id))!.type).toBe('image/jpeg');
  await mine.setPhoto(r.id, WEBP);
  expect((await mine.photo(r.id))!.type).toBe('image/webp');
  await mine.setPhoto(r.id, PNG); // in place of the last
  expect((await mine.photo(r.id))!.type).toBe('image/png');
  expect((await db.get<{ n: number }>('SELECT COUNT(*) AS n FROM recipe_photos'))!.n).toBe(1);
});

it('refuses what is not a picture, and what is too large', async () => {
  const r = await mine.createRecipe({ title: 'Pie' });
  const notOne = new TextEncoder().encode('<svg onload="alert(1)"></svg> just some text, not a picture');
  await expect(mine.setPhoto(r.id, notOne)).rejects.toEqual(problem(400));
  await expect(mine.setPhoto(r.id, Uint8Array.from([0x25, 0x50, 0x44, 0x46, 1, 2, 3]))).rejects.toEqual(problem(400)); // a PDF
  await expect(mine.setPhoto(r.id, new Uint8Array(0))).rejects.toEqual(problem(400));
  const huge = new Uint8Array(MAX_THING_PHOTO + 1);
  huge.set(PNG);
  await expect(mine.setPhoto(r.id, huge)).rejects.toEqual(problem(400));
  expect((await mine.getRecipe(r.id)).has_photo).toBe(false);
});

it('takes the picture away, and the recipe stays', async () => {
  const r = await mine.createRecipe({ title: 'Pie', steps_text: 'Bake.' });
  await mine.setPhoto(r.id, PNG);
  const without = await mine.removePhoto(r.id);
  expect(without.has_photo).toBe(false);
  expect(without.steps_text).toBe('Bake.');
  expect(await mine.photo(r.id)).toBeNull();
  expect((await mine.removePhoto(r.id)).has_photo).toBe(false); // taking away none is not an error
});

it("never lets another person see, change or remove a recipe's picture", async () => {
  const r = await mine.createRecipe({ title: 'Secret sauce' });
  await mine.setPhoto(r.id, PNG);
  await expect(theirs.photo(r.id)).rejects.toEqual(problem(404));
  await expect(theirs.setPhoto(r.id, JPEG)).rejects.toEqual(problem(404));
  await expect(theirs.removePhoto(r.id)).rejects.toEqual(problem(404));
  expect(await theirs.listRecipes()).toEqual([]);
  expect((await mine.photo(r.id))!.type).toBe('image/png'); // untouched
});

it('goes with the recipe when it is deleted, and a deleted recipe takes nothing else', async () => {
  const a = await mine.createRecipe({ title: 'A' });
  const b = await mine.createRecipe({ title: 'B' });
  await mine.setPhoto(a.id, PNG);
  await mine.setPhoto(b.id, JPEG);
  await mine.deleteRecipe(a.id);
  expect((await db.all<{ recipe_id: number }>('SELECT recipe_id FROM recipe_photos')).map((p) => p.recipe_id)).toEqual([b.id]);
});

it('survives a backup and a restore, bytes and all', async () => {
  const r = await mine.createRecipe({ title: 'Grandmother’s soup', ingredients_text: '3 leeks' });
  await mine.setPhoto(r.id, JPEG);
  const file = await makeBackup(db, 'correct horse battery', clock);

  const into = memoryDb();
  await migrate(into);
  const other = (await into.run("INSERT INTO users (username, password_hash, created_at) VALUES ('someone', 'x', 'now')")).lastId;
  await kitchen(into, other, clock).createRecipe({ title: 'Only here' });
  await into.run('PRAGMA foreign_keys = OFF');
  await restoreBackup(into, file, 'correct horse battery');
  const there = kitchen(into, ownerId, clock);
  const list = await there.listRecipes();
  expect(list.map((x) => [x.title, x.has_photo])).toEqual([['Grandmother’s soup', true]]);
  const back = (await there.photo(list[0]!.id))!;
  expect(back.type).toBe('image/jpeg');
  expect(Array.from(back.bytes)).toEqual(Array.from(JPEG));
});

const paprika = (name: string, ingredients: string) => ({ name, ingredients, directions: 'Mix.' });

it('reads a Paprika recipe with its picture beside it, and keeps the recipe word for word', () => {
  const { recipes } = readRecipeFile({ sources: [
    { name: 'a', data: { ...paprika('Pancakes', '2 cups flour'), photo_data: 'AAAA'.repeat(10) }, photo: PNG },
    { name: 'b', data: paprika('Soup', '1 leek'), has_photo: true },
    { name: 'c', data: paprika('Toast', '1 slice bread') },
  ] });
  expect(recipes.map((r) => [r.name, r.pictured, r.photo === PNG])).toEqual([['Pancakes', true, true], ['Soup', true, false], ['Toast', false, false]]);
  // The picture never rides inside the original, even where an old page left it there.
  expect(recipes[0]!.input.original_text).not.toContain('photo_data');
});

it('keeps a Paprika picture with a new recipe, and gives none to a recipe already there', async () => {
  await mine.createRecipe({ title: 'Soup', ingredients_text: '1 leek' });
  const file = { sources: [
    { name: 'a', data: paprika('Pancakes', '2 cups flour'), photo: PNG, has_photo: true },
    { name: 'b', data: paprika('Soup', '1 leek'), photo: JPEG, has_photo: true },
    { name: 'c', data: paprika('Toast', '1 slice bread'), photo: new TextEncoder().encode('not a picture at all, only words') },
    { name: 'd', data: paprika('Stew', '1 onion') },
  ] };
  const look = await mine.lookOverRecipeFile({ sources: file.sources.map(({ photo: _photo, ...s }) => s) });
  expect([look.found, look.already, look.fresh, look.pictures]).toEqual([4, 1, 3, 1]);

  const done = await mine.bringInRecipeFile(file);
  expect([done.added, done.already, done.pictures]).toEqual([3, 1, 1]);
  const kept = Object.fromEntries((await mine.listRecipes()).map((r) => [r.title, r.has_photo]));
  expect(kept).toEqual({ Pancakes: true, Soup: false, Toast: false, Stew: false });
  const pancakes = (await mine.listRecipes()).find((r) => r.title === 'Pancakes')!;
  expect((await mine.photo(pancakes.id))!.type).toBe('image/png');
  // Bringing it in again adds nothing, and no picture.
  const again = await mine.bringInRecipeFile(file);
  expect([again.added, again.already, again.pictures]).toEqual([0, 4, 0]);
});
