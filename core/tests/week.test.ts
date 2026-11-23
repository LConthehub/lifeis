/** The week: copying it onto another week, and week templates kept with the person's settings. */
import { beforeEach, expect, it } from 'vitest';
import type { Db } from '../src/db.ts';
import { kitchen, type Kitchen } from '../src/kitchen.ts';
import { migrate } from '../src/migrations.ts';
import { memoryDb } from './memoryDb.ts';

const MONDAY = '2046-03-05';
const day = (offset: number) => new Date(Date.UTC(2046, 2, 5 + offset)).toISOString().slice(0, 10);

let db: Db;
let owner: number;
let k: Kitchen;
let soup: number;
let curry: number;

async function person(name: string): Promise<number> {
  return (await db.run("INSERT INTO users (username, password_hash, created_at) VALUES (?, 'x', 'now')", [name])).lastId;
}
const problem = (status: number) => expect.objectContaining({ name: 'Problem', status });
const recipe = (title: string, servings = 4) => k.createRecipe({ title, servings, ingredients_text: '1 onion', steps_text: 'Cook it.' }).then((r) => r.id);
const brief = async (start: string) => (await k.listPlan(start, 7)).map((m) => `${m.day.slice(5)} ${m.meal} ${m.recipe_title ?? m.title}${m.servings ? ` x${m.servings}` : ''}${m.cooked_on ? ' cooked' : ''}`);

beforeEach(async () => {
  db = memoryDb();
  await migrate(db);
  owner = await person('owner');
  k = kitchen(db, owner, () => new Date(2046, 2, 5, 10, 0, 0));
  soup = await recipe('Soup');
  curry = await recipe('Curry', 2);
  const cooked = await k.addPlan({ day: MONDAY, meal: 'dinner', recipe_id: soup, servings: 6 });
  await k.addPlan({ day: day(1), meal: 'dinner', recipe_id: curry });
  await k.addPlan({ day: day(2), meal: 'lunch', title: 'Leftovers' });
  await k.cooked(cooked.id);
});

it('copies a week onto the same days of another, beside what is there, never cooked, with the servings as they were', async () => {
  await k.addPlan({ day: day(7), meal: 'dinner', title: 'Takeout' });
  expect(await brief(MONDAY)).toEqual(['03-05 dinner Soup x6 cooked', '03-06 dinner Curry', '03-07 lunch Leftovers']);

  const result = await k.copyWeek(MONDAY, day(7));
  expect(result).toEqual({ added: 3, already: 0, days_with_meals: 1, missing: [] });
  expect(await brief(day(7))).toEqual(['03-12 dinner Takeout', '03-12 dinner Soup x6', '03-13 dinner Curry', '03-14 lunch Leftovers']);
  // The week copied from is as it was, the cooked meal still cooked.
  expect(await brief(MONDAY)).toEqual(['03-05 dinner Soup x6 cooked', '03-06 dinner Curry', '03-07 lunch Leftovers']);
});

it('copying again adds nothing twice, and says so', async () => {
  await k.copyWeek(MONDAY, day(7));
  expect(await k.copyWeek(MONDAY, day(7))).toEqual({ added: 0, already: 3, days_with_meals: 3, missing: [] });
  expect(await k.listPlan(day(7), 7)).toHaveLength(3);
});

it('refuses to copy a week onto itself, and an empty week copies nothing', async () => {
  await expect(k.copyWeek(MONDAY, MONDAY)).rejects.toEqual(problem(400));
  expect(await k.copyWeek(day(28), day(35))).toEqual({ added: 0, already: 0, days_with_meals: 0, missing: [] });
});

it('copies backwards and forwards by the same distance, and only the days asked for', async () => {
  await k.copyWeek(MONDAY, day(-7));
  expect(await brief(day(-7))).toEqual(['02-26 dinner Soup x6', '02-27 dinner Curry', '02-28 lunch Leftovers']);
  expect(await k.copyWeek(MONDAY, day(14), 2)).toMatchObject({ added: 2 });
  expect(await brief(day(14))).toEqual(['03-19 dinner Soup x6', '03-20 dinner Curry']);
});

it('keeps a week as a template by name, and puts it on any week', async () => {
  const list = await k.saveTemplate(MONDAY, 'School week');
  expect(list).toHaveLength(1);
  expect(list[0]).toMatchObject({ name: 'School week', missing: [] });
  expect(list[0]!.meals.map((m) => [m.weekday, m.meal, m.recipe_title ?? m.title, m.servings])).toEqual([[0, 'dinner', 'Soup', 6], [1, 'dinner', 'Curry', null], [2, 'lunch', 'Leftovers', null]]);

  await k.addPlan({ day: day(15), meal: 'dinner', title: 'Takeout' });
  expect(await k.useTemplate(list[0]!.id, day(14))).toEqual({ added: 3, already: 0, days_with_meals: 1, missing: [] });
  expect(await brief(day(14))).toEqual(['03-19 dinner Soup x6', '03-20 dinner Takeout', '03-20 dinner Curry', '03-21 lunch Leftovers']);
  // None of it is cooked, though the week it came from had one that was.
  expect((await k.listPlan(day(14), 7)).some((m) => m.cooked_on)).toBe(false);
});

it('lists, renames and deletes templates, and will not keep two of one name or an empty week', async () => {
  const [one] = await k.saveTemplate(MONDAY, 'School week');
  await expect(k.saveTemplate(MONDAY, 'school WEEK')).rejects.toEqual(problem(409));
  await expect(k.saveTemplate(MONDAY, '  ')).rejects.toEqual(problem(400));
  await expect(k.saveTemplate(day(28), 'Empty')).rejects.toEqual(problem(400));
  const two = (await k.saveTemplate(MONDAY, 'Holiday')).find((t) => t.name === 'Holiday')!;
  expect((await k.listTemplates()).map((t) => t.name)).toEqual(['Holiday', 'School week']);

  expect((await k.renameTemplate(one!.id, 'Term time')).map((t) => t.name)).toEqual(['Holiday', 'Term time']);
  await expect(k.renameTemplate(one!.id, 'holiday')).rejects.toEqual(problem(409));
  await expect(k.renameTemplate(999, 'x')).rejects.toEqual(problem(404));
  expect((await k.deleteTemplate(two.id)).map((t) => t.name)).toEqual(['Term time']);
  expect((await k.saveTemplate(MONDAY, 'Again')).map((t) => t.name)).toEqual(['Again', 'Term time']);
  expect(await db.get("SELECT 1 AS there FROM user_settings WHERE key = 'week_templates'")).toBeTruthy();
  await k.deleteTemplate(one!.id);
  await k.deleteTemplate((await k.listTemplates())[0]!.id);
  expect(await k.listTemplates()).toEqual([]);
  expect(await db.get("SELECT 1 AS there FROM user_settings WHERE key = 'week_templates'")).toBeUndefined();
  await expect(k.useTemplate(1, day(7))).rejects.toEqual(problem(404));
});

it("a template with a recipe that has been deleted says so, and the rest still goes on the week", async () => {
  const [t] = await k.saveTemplate(MONDAY, 'School week');
  await k.deleteRecipe(curry);
  const [after] = await k.listTemplates();
  expect(after!.missing).toEqual(['Curry']);
  expect(after!.meals.filter((m) => m.missing).map((m) => m.recipe_title)).toEqual(['Curry']);

  expect(await k.useTemplate(t!.id, day(21))).toEqual({ added: 2, already: 0, days_with_meals: 0, missing: ['Curry'] });
  expect(await brief(day(21))).toEqual(['03-26 dinner Soup x6', '03-28 lunch Leftovers']);
});

it("templates are one person's own", async () => {
  const [t] = await k.saveTemplate(MONDAY, 'School week');
  const other = kitchen(db, await person('other'), () => new Date(2046, 2, 5, 10, 0, 0));
  expect(await other.listTemplates()).toEqual([]);
  await expect(other.useTemplate(t!.id, day(7))).rejects.toEqual(problem(404));
});
