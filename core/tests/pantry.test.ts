/** The pantry: recipes for what is about to run out, and putting scanned things in it. */
import { beforeEach, expect, it, vi } from 'vitest';
import type { Fetcher } from '../src/connections.ts';
import type { Db } from '../src/db.ts';
import { kitchen, type Kitchen } from '../src/kitchen.ts';
import { lookups } from '../src/lookups.ts';
import { migrate } from '../src/migrations.ts';
import { shopping } from '../src/shopping.ts';
import { memoryDb } from './memoryDb.ts';

const day = (offset: number) => new Date(Date.UTC(2046, 2, 5 + offset)).toISOString().slice(0, 10);
const clock = () => new Date(2046, 2, 5, 10, 0, 0);

let db: Db;
let owner: number;
let k: Kitchen;

async function person(name: string): Promise<number> {
  return (await db.run("INSERT INTO users (username, password_hash, created_at) VALUES (?, 'x', 'now')", [name])).lastId;
}
const problem = (status: number) => expect.objectContaining({ name: 'Problem', status });
const recipe = (title: string, ingredients: string[]) => k.createRecipe({ title, servings: 4, ingredients_text: ingredients.join('\n'), steps_text: 'Cook it.' });

beforeEach(async () => {
  db = memoryDb();
  await migrate(db);
  owner = await person('owner');
  k = kitchen(db, owner, clock);
});

it('suggests recipes for what is about to go off, the ones using most of it first, then the ones the pantry already half has', async () => {
  await k.savePantry({ name: 'cream', quantity: 1, unit: 'cup', expires_on: day(2) });
  await k.savePantry({ name: 'spinach', quantity: 1, unit: 'bag', expires_on: day(4) });
  await k.savePantry({ name: 'yogurt', quantity: 1, unit: 'tub', expires_on: day(-1) });   // already past its date
  await k.savePantry({ name: 'milk', quantity: 1, unit: 'l', expires_on: day(10) });       // not soon
  await k.savePantry({ name: 'onion', quantity: 3 });
  await k.savePantry({ name: 'flour', quantity: 500, unit: 'g' });
  await k.savePantry({ name: 'old kale', quantity: 0, expires_on: day(1) });               // none left: nothing to use up
  await recipe('Cream cake', ['1 cup cream', '2 cups sugar', '3 eggs']);
  await recipe('Cream soup', ['1 cup cream', '1 onion']);
  await recipe('Spinach pie', ['1 bag spinach', '1 cup cream', '2 cups flour']);
  await recipe('Bread', ['3 cups flour', '1 packet yeast']);
  await recipe('Milk pudding', ['1 l milk', '1 cup sugar']);
  await recipe('Kale chips', ['1 bunch old kale']);

  const out = await k.useItUp();
  expect(out.soon).toEqual([{ name: 'yogurt', days_left: -1 }, { name: 'cream', days_left: 2 }, { name: 'spinach', days_left: 4 }]);
  expect(out.suggestions.map((s) => [s.title, s.uses, s.have_others, s.other_total])).toEqual([
    ['Spinach pie', ['cream', 'spinach'], 1, 1],      // uses two of them
    ['Cream soup', ['cream'], 1, 1],                  // one, and has the onion
    ['Cream cake', ['cream'], 0, 2],                  // one, and has neither of the rest
  ]);
});

it('looks further ahead or not at all, and says nothing when nothing is going off', async () => {
  await k.savePantry({ name: 'milk', quantity: 1, unit: 'l', expires_on: day(10) });
  await recipe('Milk pudding', ['1 l milk']);
  expect(await k.useItUp()).toEqual({ soon: [], suggestions: [] });
  expect((await k.useItUp(14)).suggestions.map((s) => s.title)).toEqual(['Milk pudding']);
  await expect(k.useItUp(-1)).rejects.toEqual(problem(400));
});

it('names what is going off even when no recipe uses it', async () => {
  await k.savePantry({ name: 'cream', quantity: 1, unit: 'cup', expires_on: day(1) });
  expect(await k.useItUp()).toEqual({ soon: [{ name: 'cream', days_left: 1 }], suggestions: [] });
});

it('a barcode learned on the grocery list adds to the pantry, in the size it comes in, and again on a second scan', async () => {
  await k.addGrocery({ label: 'flour' });
  const line = (await k.listGrocery())[0]!;
  await shopping(db, owner, clock).learn('5012345678900', line.id, 'Brand flour', '2 lb');

  const seen = await k.scanForPantry('5012345678900');
  expect(seen.ingredient).toMatchObject({ name: 'flour', product: 'Brand flour', size: '2 lb' });
  expect(seen.in_pantry).toBeNull();

  expect((await k.addScanned({ code: '5012345678900' })).item).toMatchObject({ name: 'flour', quantity: 2, unit: 'lb' });
  expect((await k.scanForPantry('5012345678900')).in_pantry).toMatchObject({ name: 'flour', amount: '2 lb' });
  const more = await k.addScanned({ code: '5012345678900', quantity: 1, unit: 'lb' });
  expect(more).toMatchObject({ learned: false, item: { quantity: 3, unit: 'lb' } });
  // "Some" is said by an amount of null; it doesn't change what is known.
  expect((await k.addScanned({ code: '5012345678900', quantity: null })).item).toMatchObject({ quantity: 3 });
  await expect(k.addScanned({ code: '5012345678900', quantity: 0 })).rejects.toEqual(problem(400));
});

it('a barcode not seen before is named once, with an ingredient of yours or a new one, and is known from then on', async () => {
  expect((await k.scanForPantry('4006381333931')).ingredient).toBeNull();
  await expect(k.addScanned({ code: '4006381333931' })).rejects.toEqual(problem(400));
  expect(await k.listPantry()).toMatchObject({ items: [] });

  const coffee = await k.addScanned({ code: '4006381333931', name: 'coffee', size: '12 oz', product: 'Brand coffee' });
  expect(coffee).toMatchObject({ learned: true, item: { name: 'coffee', quantity: 12, unit: 'oz' } });
  expect((await k.scanForPantry('4006381333931')).ingredient).toMatchObject({ name: 'coffee', size: '12 oz' });

  // A second product that is the same ingredient: chosen from the list, with an amount typed.
  const id = (await k.listIngredients()).find((i) => i.name === 'coffee')!.id;
  const second = await k.addScanned({ code: '4006381333948', ingredient_id: id, quantity: 8, unit: 'oz' });
  expect(second.item).toMatchObject({ name: 'coffee', quantity: 20, unit: 'oz' });
  await expect(k.addScanned({ code: '4006381333955', ingredient_id: 99999 })).rejects.toEqual(problem(404));
  await expect(k.scanForPantry('x')).rejects.toEqual(problem(400));
});

it('scanning into the pantry asks nobody outside, and a look-up that is off never reaches out', async () => {
  const fetcher = vi.fn() as unknown as Fetcher & ReturnType<typeof vi.fn>;
  await k.scanForPantry('4006381333931');
  await k.addScanned({ code: '4006381333931', name: 'coffee' });
  const finder = lookups(db, owner, clock, fetcher);
  expect((await finder.status()).groceries).toBe(false);
  await expect(finder.product('4006381333931')).rejects.toEqual(problem(400));
  expect(fetcher).not.toHaveBeenCalled();

  // Only once the person has turned grocery look-ups on is anyone asked, and only the number.
  fetcher.mockResolvedValue({ status: 404, json: async () => ({}) });
  await finder.setGroceries(true);
  expect(await finder.product('4006381333931')).toBeNull();
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(String(fetcher.mock.calls[0]![0])).toContain('4006381333931');
});
