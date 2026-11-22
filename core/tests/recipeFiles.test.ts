/**
 * Recipes from other apps' files, and a grocery list pasted in. The unpacking of a Paprika zip happens in the
 * page (e2e/specs/bring-in.mjs checks it with a real file); these are the readings and the keeping.
 */
import { beforeEach, expect, it } from 'vitest';
import { isPaidPath } from '../src/access.ts';
import type { Db } from '../src/db.ts';
import { kitchen, type Kitchen } from '../src/kitchen.ts';
import { LATEST, migrate } from '../src/migrations.ts';
import { minutesFrom, readGroceryList, readRecipeFile, type FileSource } from '../src/recipeFiles.ts';
import { memoryDb } from './memoryDb.ts';

let db: Db;
let k: Kitchen;

beforeEach(async () => {
  db = memoryDb();
  expect(await migrate(db)).toBe(LATEST);
  const owner = (await db.run("INSERT INTO users (username, password_hash, created_at) VALUES ('owner', 'x', 'now')", [])).lastId;
  k = kitchen(db, owner);
});

const PANCAKES = {
  name: 'Buttermilk  Pancakes', ingredients: '1 1/2 cups   all-purpose flour\n2 TBSP sugar\n\n1 egg, beaten\n1 1/4 cups buttermilk',
  directions: 'Whisk the dry things together.\n\nAdd the egg & buttermilk;  stir until just combined.\nCook on a hot griddle.',
  notes: 'Grandma said: never overmix.', description: 'Fluffy.  Really.', servings: 'Serves 4', prep_time: '10 min', cook_time: '1 hr 15 min',
  total_time: '1 hr 25 min', source: 'Grandma', source_url: 'https://example.com/pancakes', categories: ['Breakfast', 'Kid Friendly'],
  rating: 5, nutritional_info: '200 calories', created: '2023-01-02 10:00:00', photo_data: 'AAAA'.repeat(50), uid: 'ABC-123',
};
const OTHER_PANCAKES = { name: 'buttermilk pancakes', ingredients: '2 cups spelt flour\n1 tsp baking powder', directions: 'Mix. Fry.' };
const SOUP = { name: 'Tomato Soup', ingredients: '1 can tomatoes\n1 cup stock', directions: 'Simmer.', servings: '6-8', categories: [] };
const source = (data: unknown, name = 'x'): FileSource => ({ name, data });

it('reads Paprika recipes with every field where it belongs, and the words exactly as written', () => {
  const { recipes, failed } = readRecipeFile({ sources: [source(PANCAKES)] });
  expect(failed).toEqual([]);
  const r = recipes[0]!.input;
  expect(r.title).toBe('Buttermilk  Pancakes');
  expect(r.ingredients_text).toBe(PANCAKES.ingredients); // odd spacing, capitals and the blank line untouched
  expect(r.steps_text).toBe(PANCAKES.directions);
  expect(r.notes).toBe('Grandma said: never overmix.');
  expect(r.description).toBe('Fluffy.  Really.');
  expect(r.servings).toBe(4);
  expect(r.prep_minutes).toBe(10);
  expect(r.cook_minutes).toBe(75);
  expect(r.source_url).toBe('https://example.com/pancakes');
  expect(r.tags).toEqual(['Breakfast', 'Kid Friendly']);
  // Everything else it said is kept in the original; only the picture is left out.
  const original = JSON.parse(r.original_text!);
  expect(original.rating).toBe(5);
  expect(original.nutritional_info).toBe('200 calories');
  expect(original.total_time).toBe('1 hr 25 min');
  expect(original.photo_data).toBeUndefined();
  expect(readRecipeFile({ sources: [source({ ...SOUP, source: 'A book' })] }).recipes[0]!.input.source_url).toBe('A book');
  expect(readRecipeFile({ sources: [source(SOUP)] }).recipes[0]!.input.servings).toBe(6);
});

it('reads times as people and apps write them', () => {
  expect(minutesFrom('1 hr 15 min')).toBe(75);
  expect(minutesFrom('45 minutes')).toBe(45);
  expect(minutesFrom('PT1H15M')).toBe(75);
  expect(minutesFrom('pt45m')).toBe(45);
  expect(minutesFrom('1h')).toBe(60);
  expect(minutesFrom('1:30')).toBe(90);
  expect(minutesFrom('1 1/2 hours')).toBe(90);
  expect(minutesFrom('2 hours 5 mins')).toBe(125);
  expect(minutesFrom('1 day')).toBe(1440);
  expect(minutesFrom('30')).toBe(30);
  expect(minutesFrom('overnight')).toBeNull();
  expect(minutesFrom('')).toBeNull();
  expect(minutesFrom(undefined)).toBeNull();
  expect(minutesFrom('PT')).toBeNull();
});

it('reads schema.org JSON as one recipe, a list, or a graph, with keywords and categories as tags', () => {
  const one = { '@context': 'https://schema.org', '@type': 'Recipe', name: 'Flapjacks', recipeIngredient: ['2 cups oats', '1 cup butter'],
    recipeInstructions: [{ '@type': 'HowToStep', text: 'Melt.' }, { '@type': 'HowToStep', text: 'Bake.' }], recipeYield: '12 bars',
    prepTime: 'PT10M', cookTime: 'PT1H5M', url: 'https://example.com/flapjacks', keywords: 'snack, oats', recipeCategory: ['Dessert', 'snack'], description: 'Chewy.' };
  const read = (data: unknown) => readRecipeFile({ sources: [source(data)] });
  const r = read(one).recipes[0]!.input;
  expect([r.title, r.servings, r.prep_minutes, r.cook_minutes, r.source_url, r.description]).toEqual(['Flapjacks', 12, 10, 65, 'https://example.com/flapjacks', 'Chewy.']);
  expect(r.ingredients_text).toBe('2 cups oats\n1 cup butter');
  expect(r.steps_text).toBe('Melt.\n\nBake.');
  expect(r.tags).toEqual(['snack', 'oats', 'Dessert']);
  expect(read([one, { ...one, name: 'Granola' }]).recipes.map((x) => x.name)).toEqual(['Flapjacks', 'Granola']);
  expect(read({ '@context': 'https://schema.org', '@graph': [{ '@type': 'WebSite', name: 'Site' }, one] }).recipes.map((x) => x.name)).toEqual(['Flapjacks']);
});

it('names what could not be read and carries on', () => {
  const { recipes, failed } = readRecipeFile({
    sources: [source(SOUP), source({ ingredients: 'salt' }, 'Nameless.paprikarecipe'), source('just a string', 'odd.json'), source({ unrelated: true }, 'other.json')],
    unreadable: [{ name: 'Broken.paprikarecipe', why: 'It was damaged' }],
  });
  expect(recipes.map((x) => x.name)).toEqual(['Tomato Soup']);
  expect(failed.map((x) => x.name)).toEqual(['Broken.paprikarecipe', 'Nameless.paprikarecipe', 'odd.json', 'other.json']);
  expect(failed[1]!.why).toBe('It has no name');
  expect(() => readRecipeFile({ sources: Array.from({ length: 2001 }, (_, i) => source({ ...SOUP, name: `Soup ${i}` })) })).toThrow(/2,000 recipes/);
});

it('brings in a Paprika file, tells what is already there, and adds nothing the second time', async () => {
  await k.createRecipe({ title: 'Tomato soup', ingredients_text: ' 1 CAN tomatoes\n2 cups water' });
  const file = { sources: [source(PANCAKES), source(OTHER_PANCAKES), source(SOUP), source({ name: ' ', ingredients: 'x' }, 'Blank.paprikarecipe')] };
  const look = await k.lookOverRecipeFile(file);
  // The soup has the same name and first ingredient as the one kept (spacing and capitals don't matter), the pancakes differ.
  expect(look).toMatchObject({ found: 4, already: 1, fresh: 2, first: ['Buttermilk  Pancakes', 'buttermilk pancakes', 'Tomato Soup'] });
  expect(look.failed).toEqual([{ name: 'Blank.paprikarecipe', why: 'It has no name' }]);
  expect(await k.listRecipes()).toHaveLength(1); // looking over keeps nothing

  expect(await k.bringInRecipeFile(file)).toMatchObject({ found: 4, added: 2, already: 1 });
  const titles = (await k.listRecipes()).map((r) => r.title);
  expect(titles).toEqual(['Buttermilk  Pancakes', 'buttermilk pancakes', 'Tomato soup']);

  const kept = await k.getRecipe((await k.listRecipes())[0]!.id);
  expect(kept.ingredients_text).toBe(PANCAKES.ingredients.replace('\n\n', '\n'));
  expect(kept.steps.map((s) => s.text)).toEqual(['Whisk the dry things together.', 'Add the egg & buttermilk;  stir until just combined.\nCook on a hot griddle.']);
  expect(kept.ingredients[0]!.text).toBe('1 1/2 cups   all-purpose flour');
  expect([kept.notes, kept.description, kept.servings, kept.prep_minutes, kept.cook_minutes, kept.tags]).toEqual(['Grandma said: never overmix.', 'Fluffy.  Really.', 4, 10, 75, ['breakfast', 'kid friendly']]);

  const again = await k.bringInRecipeFile(file);
  expect(again).toMatchObject({ added: 0, already: 3 });
  expect(await k.listRecipes()).toHaveLength(3);
  expect(await k.lookOverRecipeFile(file)).toMatchObject({ already: 3, fresh: 0 });
});

it('a recipe twice in one file is brought in once, and one that would be refused is named, not a reason to stop', async () => {
  const file = { sources: [source(SOUP), source({ ...SOUP, name: 'tomato  soup' }), source({ ...SOUP, name: 'Huge', ingredients: 'x'.repeat(200_001) }, 'Huge.paprikarecipe')] };
  const done = await k.bringInRecipeFile(file);
  expect(done).toMatchObject({ added: 1, already: 1 });
  expect(done.failed).toEqual([{ name: 'Huge', why: 'That recipe is too long' }]);
});

it("moves a recipe between two copies of Life Is: the export's recipe.json and original.txt come back as they were", async () => {
  await k.createRecipe({ title: 'Lasagne', description: 'Layers.', servings: 6, prep_minutes: 30, cook_minutes: 50, source_url: 'Nonna', tags: ['italian'],
    ingredients_text: '# For the sauce\n2 tbsp olive oil\n1 onion, finely chopped', steps_text: '# Sauce\n\nSoften the onion.\n\nSimmer.', original_text: 'Lasagne\nthe pasted text\n' });
  const files = await k.exportRecipes();
  const json = JSON.parse(files.find((f) => f.path.endsWith('recipe.json'))!.text);
  const original = files.find((f) => f.path.endsWith('original.txt'))!.text;

  const other = kitchen(db, (await db.run("INSERT INTO users (username, password_hash, created_at) VALUES ('second', 'x', 'now')", [])).lastId);
  expect(await other.bringInRecipeFile({ sources: [{ name: 'Lasagne', data: json, original }] })).toMatchObject({ added: 1, already: 0 });
  const [a, b] = [await k.getRecipe((await k.listRecipes())[0]!.id), await other.getRecipe((await other.listRecipes())[0]!.id)];
  for (const field of ['title', 'description', 'servings', 'prep_minutes', 'cook_minutes', 'source_url', 'tags', 'ingredients_text', 'steps_text', 'original_text'] as const) {
    expect(b[field], field).toEqual(a[field]);
  }
});

// ---------- a grocery list pasted in ----------

it('reads a pasted list: marks off, blank lines and headings out, one thing a line', () => {
  const pasted = [
    'Groceries', 'Produce:', '- apples', '• 2 lb chicken thighs', '1. bread', '2) [ ] oat milk', '☐ eggs', '[x] butter', '   ', '## Dairy', '# Frozen', '* * peas', '---', '3 limes', '1.5 lb flour',
  ].join('\r\n');
  expect(readGroceryList(pasted)).toEqual(['Groceries', 'apples', '2 lb chicken thighs', 'bread', 'oat milk', 'eggs', 'butter', 'peas', '3 limes', '1.5 lb flour']);
});

it('splits a line on commas only when it plainly lists short things', () => {
  expect(readGroceryList('milk, eggs, bread')).toEqual(['milk', 'eggs', 'bread']);
  expect(readGroceryList('milk, eggs, and bread')).toEqual(['milk', 'eggs', 'bread']);
  expect(readGroceryList('2 eggs, 1 lb butter')).toEqual(['2 eggs', '1 lb butter']);
  expect(readGroceryList('milk, 2 eggs')).toEqual(['milk', '2 eggs']);
  for (const one of ['tomatoes, diced', 'olive oil, extra virgin', '1 cup flour, sifted', 'onions, 2 lbs', 'cheese, finely grated', 'chicken, cut into pieces',
    'peppers (red, green), sliced', 'a long sentence about what to get, because the kids want it, and the dog too, maybe']) {
    expect(readGroceryList(one), one).toEqual([one]);
  }
  expect(readGroceryList('milk,')).toEqual(['milk']);
  expect(() => readGroceryList('Produce:\n\n')).toThrow(/nothing to buy/);
  expect(() => readGroceryList(Array.from({ length: 301 }, (_, i) => `thing ${i}`).join('\n'))).toThrow(/300 things/);
  expect(readGroceryList(Array.from({ length: 300 }, (_, i) => `thing ${i}`).join('\n'))).toHaveLength(300);
});

it('looks a pasted list over, then adds it by the same path as a typed line, skipping what is on the list', async () => {
  await k.addGrocery({ label: '2 lb chicken thighs' });
  await k.addGrocery({ label: 'Eggs' });
  const bought = (await k.addGrocery({ label: 'bread' })).find((g) => g.label === 'bread')!;
  await k.tickGrocery(bought.id, { done: true, put_away: false });

  const pasted = '- chicken thigh\n- [ ] 3 limes\n3 eggs\nbread\nmilk, butter\nmilk';
  const look = await k.lookOverGroceries(pasted);
  expect(look.lines.map((l) => [l.text, l.label, l.amount, l.already])).toEqual([
    ['chicken thigh', 'chicken thigh', null, true],
    ['3 limes', 'limes', '3', false],
    ['3 eggs', 'eggs', '3', true], // the same thing as "Eggs", not yet bought
    ['bread', 'bread', null, false], // bought already, so it may be wanted again
    ['milk', 'milk', null, false],
    ['butter', 'butter', null, false],
    ['milk', 'milk', null, true], // twice in the paste
  ]);
  expect((await k.listGrocery())).toHaveLength(3); // nothing added yet

  const done = await k.addGroceries(look.lines.filter((l) => l.text !== 'butter').map((l) => l.text));
  expect([done.added, done.already]).toEqual([3, 3]);
  const open = done.items.filter((g) => !g.done).map((g) => `${g.label}|${g.amount}`).sort();
  expect(open).toEqual(['Eggs|', 'bread|', 'chicken thighs|2 lb', 'limes|3', 'milk|'].sort());
  expect((await k.addGroceries(['limes', 'milk']))).toMatchObject({ added: 0, already: 2 });
});

it('keeps the new routes free in the phone app after its trial, like the rest of the kitchen', () => {
  for (const path of ['/api/kitchen/recipes/file', '/api/kitchen/recipes/file/read', '/api/kitchen/grocery/paste', '/api/kitchen/grocery/paste/read']) {
    expect(isPaidPath(path), path).toBe(false);
  }
});
