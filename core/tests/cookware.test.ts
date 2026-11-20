/** A recipe knows what it's cooked in, and the week says when a meal needs more of something than you own. */
import { beforeEach, expect, it } from 'vitest';
import type { Db } from '../src/db.ts';
import { inventory, type Inventory, type Kind } from '../src/inventory.ts';
import { kitchen, type Kitchen } from '../src/kitchen.ts';
import { life } from '../src/life.ts';
import { migrate } from '../src/migrations.ts';
import { memoryDb } from './memoryDb.ts';

let db: Db;
let owner: number;
let k: Kitchen;
let things: Inventory;
const THURSDAY = '2046-11-22';

async function person(name: string): Promise<number> {
  return (await db.run("INSERT INTO users (username, password_hash, created_at) VALUES (?, 'x', 'now')", [name])).lastId;
}

beforeEach(async () => {
  db = memoryDb();
  await migrate(db);
  owner = await person('owner');
  k = kitchen(db, owner);
  things = inventory(db, owner);
});

const problem = (status: number) => expect.objectContaining({ name: 'Problem', status });
const kindNamed = (kinds: Kind[], name: string) => kinds.find((kind) => kind.name === name)!;

async function cupboard() {
  const kinds = await things.addStarter('cookware');
  const iron = kindNamed(kinds, 'Cast iron');
  const maker = String(iron.fields.find((f) => f.name === 'Maker')!.id);
  const shelf = (await things.createPlace({ name: 'Pot rack' }))[0]!.id;
  return {
    skillet: await things.createItem({ kind_id: iron.id, name: 'Griswold #8 skillet', place_id: shelf, values: { [maker]: 'Griswold' } }), // one of a kind: no count
    dish: await things.createItem({ kind_id: kindNamed(kinds, 'Baking dishes').id, name: '8x8 baking dish', quantity: 2 }),
    pot: await things.createItem({ kind_id: kindNamed(kinds, 'Pots and pans').id, name: 'Stock pot', quantity: 1 }),
  };
}

it('the cookware set comes with kinds for cast iron and the rest, and is offered when Life Is asks', async () => {
  const kinds = await things.addStarter('cookware');
  expect(kinds.map((kind) => kind.name)).toEqual(['Baking dishes', 'Cast iron', 'Kitchen tools', 'Pots and pans']);
  expect(kindNamed(kinds, 'Cast iron').fields.map((f) => f.name)).toEqual(expect.arrayContaining(['Maker', 'Made', 'Size', 'Last seasoned', 'Care notes']));
  const other = await person('other');
  const saved = await life(db, other).saveProfile(['cookware']);
  expect([saved.sections, saved.added]).toEqual([['eating', 'keeping'], ['Baking dishes', 'Cast iron', 'Kitchen tools', 'Pots and pans']]);
});

it('a recipe says what it is cooked in, from your things or by name', async () => {
  const { skillet, dish } = await cupboard();
  let cornbread = await k.createRecipe({ title: 'Cornbread', servings: 8, ingredients_text: '2 cups cornmeal', equipment: [
    { item_id: skillet.id, note: 'preheated' }, { item_id: dish.id, quantity: 2 }, { label: ' Wire rack ' },
  ] });
  expect(cornbread.equipment.map((e) => [e.label, e.quantity, e.have, e.place, e.note])).toEqual([
    ['Griswold #8 skillet', 1, 1, 'Pot rack', 'preheated'], // owned, with no count: one
    ['8x8 baking dish', 2, 2, null, null],
    ['Wire rack', 1, null, null, null], // not one of your things: just a name
  ]);
  // More servings change the amounts of ingredients, never the pans.
  expect((await k.getRecipe(cornbread.id, 16)).equipment.map((e) => e.quantity)).toEqual([1, 2, 1]);

  // Changing the recipe without sending equipment keeps it; sending it replaces it; sending none clears it.
  cornbread = await k.updateRecipe(cornbread.id, { title: 'Skillet cornbread', ingredients_text: '2 cups cornmeal' });
  expect(cornbread.equipment).toHaveLength(3);
  cornbread = await k.updateRecipe(cornbread.id, { title: 'Skillet cornbread', equipment: [{ item_id: skillet.id }] });
  expect(cornbread.equipment.map((e) => e.label)).toEqual(['Griswold #8 skillet']);
  expect((await k.updateRecipe(cornbread.id, { title: 'Skillet cornbread', equipment: [] })).equipment).toEqual([]);

  // Renaming the thing renames it on the recipe; removing the thing leaves its name there.
  cornbread = await k.updateRecipe(cornbread.id, { title: 'Skillet cornbread', equipment: [{ item_id: skillet.id }] });
  await things.updateItem(skillet.id, { name: 'The good skillet' });
  expect((await k.getRecipe(cornbread.id)).equipment[0]).toMatchObject({ label: 'The good skillet', have: 1 });
  await things.deleteItem(skillet.id);
  expect((await k.getRecipe(cornbread.id)).equipment[0]).toMatchObject({ label: 'Griswold #8 skillet', item_id: null, have: null });

  await expect(k.createRecipe({ title: 'x', equipment: [{ item_id: 9999 }] })).rejects.toEqual(problem(404));
  await expect(k.createRecipe({ title: 'x', equipment: [{ label: ' ' }] })).rejects.toEqual(problem(400));
  await expect(k.createRecipe({ title: 'x', equipment: [{ label: 'Tin', quantity: 0 }] })).rejects.toEqual(problem(400));
  expect((await k.listRecipes()).map((r) => r.title)).toEqual(['Skillet cornbread']); // the refused ones left nothing behind
});

it('the week says when one meal needs more of something than you own', async () => {
  const { dish, pot, skillet } = await cupboard();
  const withDish = (title: string, quantity = 1) => k.createRecipe({ title, equipment: [{ item_id: dish.id, quantity }] });
  const stuffing = await withDish('Stuffing');
  const brownies = await withDish('Brownies');
  const casserole = await withDish('Green bean casserole', 2);
  const stock = await k.createRecipe({ title: 'Stock', equipment: [{ item_id: pot.id }, { label: 'Fat separator' }] });
  const eggs = await k.createRecipe({ title: 'Eggs', equipment: [{ item_id: skillet.id }] });
  const hash = await k.createRecipe({ title: 'Hash', equipment: [{ item_id: skillet.id }] });

  // An ordinary day: the skillet does breakfast and dinner, and two dishes cover two recipes.
  await k.addPlan({ day: THURSDAY, meal: 'breakfast', recipe_id: eggs.id });
  await k.addPlan({ day: THURSDAY, meal: 'dinner', recipe_id: hash.id });
  await k.addPlan({ day: THURSDAY, meal: 'dinner', recipe_id: stuffing.id });
  await k.addPlan({ day: THURSDAY, meal: 'dinner', recipe_id: brownies.id });
  expect(await k.equipmentCheck(THURSDAY, 1)).toEqual([]);

  // The holiday dinner grows: four 8x8 dishes at once, and you have two. And something you don't own at all.
  const big = await k.addPlan({ day: THURSDAY, meal: 'dinner', recipe_id: casserole.id });
  await k.addPlan({ day: THURSDAY, meal: 'dinner', recipe_id: stock.id });
  await k.addPlan({ day: THURSDAY, meal: 'breakfast', recipe_id: hash.id }); // two skillet dishes at breakfast, one skillet
  expect((await k.equipmentCheck(THURSDAY, 1)).map((s) => [s.meal, s.label, s.need, s.have, s.short, s.recipes])).toEqual([
    ['breakfast', 'Griswold #8 skillet', 2, 1, 1, ['Eggs', 'Hash']],
    ['dinner', '8x8 baking dish', 4, 2, 2, ['Stuffing', 'Brownies', 'Green bean casserole']],
    ['dinner', 'Fat separator', 1, null, 1, ['Stock']],
  ]);
  // Another day isn't counted with it, and neither is a meal already cooked.
  await k.addPlan({ day: '2046-11-23', meal: 'dinner', recipe_id: stuffing.id });
  expect((await k.equipmentCheck(THURSDAY, 7)).filter((s) => s.day !== THURSDAY)).toEqual([]);
  await k.cooked(big.id);
  expect((await k.equipmentCheck(THURSDAY, 1)).find((s) => s.label === '8x8 baking dish')).toBeUndefined();

  // Buying two more dishes settles it.
  await k.deletePlan((await k.listPlan(THURSDAY, 1)).find((m) => m.recipe_id === stock.id)!.id);
  await things.updateItem(dish.id, { name: '8x8 baking dish', quantity: 4 });
  expect((await k.equipmentCheck(THURSDAY, 1)).map((s) => s.label)).toEqual(['Griswold #8 skillet']);
  await expect(k.equipmentCheck(THURSDAY, 100)).rejects.toEqual(problem(400));
});

it("someone else's things can't be put on a recipe, and their week isn't checked against yours", async () => {
  const { dish } = await cupboard();
  const mine = await k.createRecipe({ title: 'Brownies', equipment: [{ item_id: dish.id, quantity: 5 }] });
  await k.addPlan({ day: THURSDAY, recipe_id: mine.id });
  const other = kitchen(db, await person('other'));
  await expect(other.createRecipe({ title: 'Theirs', equipment: [{ item_id: dish.id }] })).rejects.toEqual(problem(404));
  expect(await other.equipmentCheck(THURSDAY, 7)).toEqual([]);
  expect((await k.equipmentCheck(THURSDAY, 7))[0]).toMatchObject({ label: '8x8 baking dish', need: 5, have: 2, short: 3 });
});
