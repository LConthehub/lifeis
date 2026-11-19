/**
 * The kitchen: recipes kept word for word, the pantry, the week's meals and the grocery list that subtracts
 * the pantry. These are backend/tests/test_kitchen.py's tests, asked of the TypeScript kitchen.
 */
import { beforeEach, expect, it } from 'vitest';
import type { Db } from '../src/db';
import { kitchen, type Kitchen } from '../src/kitchen';
import { LATEST, migrate } from '../src/migrations';
import { memoryDb } from './memoryDb';

const MONDAY = '2046-03-05';
const day = (offset: number) => new Date(Date.UTC(2046, 2, 5 + offset)).toISOString().slice(0, 10);

let db: Db;
let k: Kitchen;

async function person(name: string): Promise<number> {
  return (await db.run("INSERT INTO users (username, password_hash, created_at) VALUES (?, 'x', 'now')", [name])).lastId;
}

beforeEach(async () => {
  db = memoryDb();
  expect(await migrate(db)).toBe(LATEST);
  k = kitchen(db, await person('owner'));
});

const LASAGNE_INGREDIENTS = `# For the sauce
2 tbsp olive oil
1 onion, finely chopped
2-3 cloves garlic
1 lb ground beef
1 (28 oz) can crushed tomatoes
Salt to taste

# To build
12 lasagne sheets
2 cups ricotta
1 1/2 cups grated mozzarella`;

const LASAGNE_STEPS = `Warm the oil over medium heat. Add the onion and cook it slowly, 10 minutes, until soft and sweet, not brown: this is where the flavour comes from, so don't rush it.

Add the garlic for one minute, then the beef. Break it up and brown it well.

# Layering
Spread a thin layer of sauce, then sheets, ricotta, sauce. Repeat three times; finish with sauce and mozzarella.

Bake at 190°C (375°F) for 45 minutes, covered for the first 25. Rest it 15 minutes before cutting, or it falls apart.`;

const lasagne = (kit: Kitchen = k, servings = 6) => kit.createRecipe({
  title: 'Lasagne', servings, ingredients_text: LASAGNE_INGREDIENTS, steps_text: LASAGNE_STEPS, tags: ['Dinner', 'freezes well'],
});

const problem = (status: number) => expect.objectContaining({ name: 'Problem', status });

// ---------- recipes word for word ----------

it('a recipe is kept exactly as written', async () => {
  const r = await lasagne();
  // Every line and every step, word for word, with the section headings where they were.
  expect(r.ingredients_text).toBe(LASAGNE_INGREDIENTS.replace('\n\n', '\n'));
  expect(r.steps_text).toBe(LASAGNE_STEPS.replace('# Layering\n', '# Layering\n\n'));
  expect(r.steps.filter((s) => s.is_heading).map((s) => s.text)).toEqual(['Layering']);
  expect(r.steps.filter((s) => !s.is_heading)).toHaveLength(4);
  expect(r.steps[0]!.text).toContain("this is where the flavour comes from, so don't rush it.");
  expect(r.tags).toEqual(['dinner', 'freezes well']);
  let beef = r.ingredients.find((l) => l.text.includes('beef'))!;
  expect([beef.ingredient, beef.quantity, beef.unit]).toEqual(['ground beef', 1, 'lb']);

  // Scaling shows new amounts beside the lines, and never touches the lines.
  const big = await k.getRecipe(r.id, 9);
  beef = big.ingredients.find((l) => l.text.includes('beef'))!;
  expect([beef.text, beef.scaled]).toEqual(['1 lb ground beef', '1 1/2 lb']);
  expect(big.steps_text).toBe(r.steps_text);
  expect(big.ingredients.find((l) => l.text === 'Salt to taste')!.scaled).toBeNull();

  // Editing keeps the original pasted text.
  const pasted = (await k.importRecipes('Toast\n\nIngredients\n2 slices bread\nButter\n\nMethod\nToast it.\nButter it.')).recipes[0]!;
  const edited = await k.updateRecipe(pasted.id, { title: 'Better toast', ingredients_text: '2 slices bread', steps_text: 'Toast it well.' });
  expect(edited.title).toBe('Better toast');
  expect(edited.original_text).toMatch(/^Toast\n\nIngredients/);

  expect((await k.listRecipes({ q: 'ricotta' })).map((x) => x.title)).toEqual(['Lasagne']);
  expect((await k.listRecipes({ tag: 'freezes well' })).map((x) => x.title)).toEqual(['Lasagne']);
  await expect(k.createRecipe({ title: ' ' })).rejects.toEqual(problem(400));
  await expect(k.createRecipe({ title: 'x', servings: 0 })).rejects.toEqual(problem(400));
  expect((await k.listRecipes()).map((x) => x.title)).toEqual(['Better toast', 'Lasagne']); // the refused ones left nothing behind
});

it('pasted text is split without being rewritten', async () => {
  const text = "Grandma's Biscuits\nMakes 12\n\nIngredients:\n2 cups flour\n1 tbsp baking powder\n\nDirections:\nMix.\nCut in the butter until it looks like coarse crumbs.\n\nNotes:\nCold butter is everything.";
  let r = (await k.importRecipes(text)).recipes[0]!;
  expect([r.title, r.servings, r.description]).toEqual(["Grandma's Biscuits", 12, 'Makes 12']);
  expect(r.ingredients_text).toBe('2 cups flour\n1 tbsp baking powder');
  expect(r.steps.map((s) => s.text)).toEqual(['Mix.', 'Cut in the butter until it looks like coarse crumbs.']);
  expect([r.notes, r.original_text]).toEqual(['Cold butter is everything.', text]);

  // No headings: amounts first, then steps.
  r = (await k.importRecipes('Rice\n1 cup rice\n2 cups water\nRinse the rice.\n\nSimmer 18 minutes.')).recipes[0]!;
  expect(r.ingredients_text).toBe('1 cup rice\n2 cups water');
  expect(r.steps.map((s) => s.text)).toEqual(['Rinse the rice.', 'Simmer 18 minutes.']);
});

it('schema.org JSON comes in and goes out as Nextcloud Cookbook folders', async () => {
  const data = {
    '@context': 'https://schema.org', '@type': 'Recipe', name: 'Pho', recipeYield: '4 servings', prepTime: 'PT30M', cookTime: 'PT3H',
    recipeIngredient: ['2 lb beef bones', '1 onion, charred'], keywords: 'soup, weekend',
    recipeInstructions: [
      { '@type': 'HowToSection', name: 'Broth', itemListElement: [{ '@type': 'HowToStep', text: 'Blanch the bones.' }] },
      { '@type': 'HowToStep', text: 'Serve with herbs.' },
    ],
  };
  const r = (await k.importRecipes(JSON.stringify(data))).recipes[0]!;
  expect([r.title, r.servings, r.prep_minutes, r.cook_minutes]).toEqual(['Pho', 4, 30, 180]);
  expect(r.steps_text).toBe('# Broth\n\nBlanch the bones.\n\nServe with herbs.');
  expect(r.tags).toEqual(['soup', 'weekend']);
  expect(JSON.parse(r.original_text!).name).toBe('Pho');
  await lasagne();
  await lasagne(); // a second of the same name gets a folder of its own

  const files = new Map((await k.exportRecipes()).map((f) => [f.path, f.text]));
  expect([...files.keys()].sort()).toEqual([
    'Recipes/Lasagne (2)/recipe.json', 'Recipes/Lasagne/recipe.json', 'Recipes/Pho/original.txt', 'Recipes/Pho/recipe.json']);
  const out = JSON.parse(files.get('Recipes/Pho/recipe.json')!);
  expect([out['@type'], out.recipeYield, out.cookTime]).toEqual(['Recipe', 4, 'PT3H0M']);
  // A section runs to the next heading, so the step after it is part of it on the way out.
  expect(out.recipeInstructions).toEqual([{ '@type': 'HowToSection', name: 'Broth', itemListElement: [
    { '@type': 'HowToStep', text: 'Blanch the bones.' }, { '@type': 'HowToStep', text: 'Serve with herbs.' }] }]);
  const lz = JSON.parse(files.get('Recipes/Lasagne/recipe.json')!);
  expect(lz.recipeIngredient[0]).toBe('# For the sauce');
  expect(lz.recipeIngredient).toContain('1 lb ground beef');
  await expect(k.importRecipes('{not json')).rejects.toEqual(problem(400));
  await expect(k.importRecipes('{"@type": "Thing"}')).rejects.toEqual(problem(400));
});

// ---------- pantry, plan and groceries together ----------

it('the grocery list is what the week needs minus the pantry', async () => {
  const r = await lasagne();
  const soup = await k.createRecipe({ title: 'Soup', servings: 2, ingredients_text: '1 onion\n500 ml stock\n1 tsp salt' });
  await k.addPlan({ day: MONDAY, recipe_id: r.id, servings: 12 }); // doubled
  await k.addPlan({ day: day(2), recipe_id: soup.id });
  await k.addPlan({ day: day(3), title: 'Leftovers' });
  await k.addPlan({ day: day(9), recipe_id: soup.id }); // next week: not counted

  await k.savePantry({ name: 'ground beef', quantity: 500, unit: 'g', location: 'freezer' });
  await k.savePantry({ name: 'Onions', quantity: 1 }); // one onion; the week needs three
  await k.savePantry({ name: 'olive oil' }); // "some": not bought, but named
  await k.savePantry({ name: 'salt', quantity: 1, unit: 'kg' });
  await k.savePantry({ name: 'ricotta', quantity: 1, unit: 'lb' }); // weight; the recipe says cups
  await k.addGrocery({ label: '2 lb chicken thighs' }); // typed in by hand: stays

  const out = await k.groceryFromPlan(MONDAY);
  let items = new Map(out.items.map((i) => [i.label, i]));
  expect(out.check).toEqual(['olive oil']);
  expect(items.has('olive oil')).toBe(false);
  expect(items.get('ground beef')!.unit).toBe('lb');
  expect(Math.abs(items.get('ground beef')!.quantity! - (2 - 500 / 453.592))).toBeLessThan(0.01);
  expect(items.get('onion')!.quantity).toBe(2); // 2 for the lasagne, 1 for soup, 1 in the pantry
  expect(items.get('ricotta')!.quantity).toBe(4);
  expect(items.get('ricotta')!.note).toContain('other units');
  expect(items.has('salt')).toBe(false); // "to taste" and 1 tsp: a kilo covers it
  expect([items.get('garlic')!.quantity, items.get('garlic')!.unit]).toEqual([6, 'clove']);
  expect([items.get('chicken thighs')!.from_plan, items.get('chicken thighs')!.amount]).toEqual([false, '2 lb']);
  expect([items.get('stock')!.quantity, items.get('stock')!.unit]).toEqual([500, 'ml']);

  // Running it again after changing the week replaces the plan's items and leaves the hand-typed one.
  const soupDay = (await k.listPlan(MONDAY)).find((m) => m.recipe_id === soup.id)!;
  await k.deletePlan(soupDay.id);
  items = new Map((await k.groceryFromPlan(MONDAY)).items.map((i) => [i.label, i]));
  expect(items.has('stock')).toBe(false);
  expect(items.get('onion')!.quantity).toBe(1);
  expect(items.has('chicken thighs')).toBe(true);

  // Ticking off with "put away" fills the pantry; cooking takes it out again.
  await k.tickGrocery(items.get('ground beef')!.id, { done: true });
  const beef = async () => (await k.listPantry()).items.find((p) => p.name === 'ground beef')!;
  expect((await beef()).unit).toBe('g');
  expect(Math.abs((await beef()).quantity! - 2 * 453.592)).toBeLessThan(0.5);
  const lasagneDay = (await k.listPlan(MONDAY)).find((m) => m.recipe_id === r.id)!;
  expect((await k.cooked(lasagneDay.id)).check_by_hand).toContain('ricotta'); // cups can't come out of pounds
  expect(Math.abs((await beef()).quantity!)).toBeLessThan(0.5);
  await expect(k.cooked(lasagneDay.id)).rejects.toEqual(problem(409));
  // A cooked meal isn't shopped for again.
  const again = (await k.groceryFromPlan(MONDAY)).items.filter((i) => !i.done).map((i) => i.label);
  expect(again).not.toContain('ground beef');

  expect((await k.clearDone()).every((i) => !i.done)).toBe(true);
});

it('low pantry items go on the list once', async () => {
  const inTwoDays = new Date(Date.now() + 2 * 86_400_000);
  const expires = `${inTwoDays.getFullYear()}-${String(inTwoDays.getMonth() + 1).padStart(2, '0')}-${String(inTwoDays.getDate()).padStart(2, '0')}`;
  await k.savePantry({ name: 'coffee', quantity: 1, unit: 'bag', low_at: 1 });
  const rice = await k.savePantry({ name: 'rice', quantity: 5, unit: 'lb', low_at: 1, expires_on: expires });
  expect(rice.days_left).toBe(2);
  const pantry = await k.listPantry();
  expect([pantry.low, pantry.expiring]).toEqual([['coffee'], ['rice']]);
  expect((await k.groceryFromLow()).added).toBe(1);
  expect((await k.groceryFromLow()).added).toBe(0);
  await expect(k.savePantry({ name: 'x', location: 'garage' })).rejects.toEqual(problem(400));
  await expect(k.savePantry({ name: 'x', expires_on: '2046-02-30' })).rejects.toEqual(problem(400));
});

it('an ingredient can be renamed and given an aisle, but not into another one', async () => {
  await k.savePantry({ name: 'Tomatoes', quantity: 2 });
  await k.savePantry({ name: 'basil' });
  const tomato = (await k.listIngredients()).find((i) => i.name === 'Tomatoes')!;
  expect(await k.updateIngredient(tomato.id, { aisle: 'Produce' })).toEqual({ id: tomato.id, name: 'Tomatoes', aisle: 'Produce' });
  expect(await k.updateIngredient(tomato.id, { name: 'Plum tomatoes' })).toEqual({ id: tomato.id, name: 'Plum tomatoes', aisle: 'Produce' });
  await expect(k.updateIngredient(tomato.id, { name: 'Basil' })).rejects.toEqual(problem(409));
  await expect(k.updateIngredient(9999, { name: 'x' })).rejects.toEqual(problem(404));
});

it('each person has their own kitchen', async () => {
  const r = await lasagne();
  const other = kitchen(db, await person('other'));
  await expect(other.getRecipe(r.id)).rejects.toEqual(problem(404));
  expect(await other.listRecipes()).toEqual([]);
  await expect(other.addPlan({ day: MONDAY, recipe_id: r.id })).rejects.toEqual(problem(404));
  await other.deleteRecipe(r.id);
  expect((await k.getRecipe(r.id)).title).toBe('Lasagne');
});

it('the times kept are the ones the clock gives', async () => {
  const then = kitchen(db, await person('early'), () => new Date(2046, 2, 5, 18, 30, 0));
  const r = await then.createRecipe({ title: 'Tea' });
  expect(r.created_at).toBe(new Date(2046, 2, 5, 18, 30, 0).toISOString().slice(0, 19) + '+00:00');
  const meal = await then.addPlan({ day: MONDAY, title: 'Out' });
  await then.cooked(meal.id);
  expect((await then.listPlan(MONDAY))[0]!.cooked_on).toBe('2046-03-05');
  await expect(then.listPlan(MONDAY, 63)).rejects.toEqual(problem(400));
  await expect(then.listPlan('5 March')).rejects.toEqual(problem(400));
});
