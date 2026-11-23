/** Prep reminders: "thaw the chicken the night before", worked out from when a meal is eaten, and sent at that time. */
import { beforeEach, expect, it } from 'vitest';
import type { Answer, Fetcher } from '../src/connections.ts';
import type { Db } from '../src/db.ts';
import { kitchen } from '../src/kitchen.ts';
import { LATEST, migrate } from '../src/migrations.ts';
import { clockWords, prep, prepAsText, prepDue, prepFromText, prepTime, whenWords } from '../src/prep.ts';
import { reminders } from '../src/reminders.ts';
import { memoryDb } from './memoryDb.ts';

let db: Db;
let owner: number;
let time = new Date(2046, 2, 5, 10, 0, 0);
const clock = Object.assign(() => time, { today: () => '2046-03-05' });
const problem = (status: number) => expect.objectContaining({ name: 'Problem', status });

let posted: { url: string; body: string }[];
const fetcher: Fetcher = async (url, _headers, send) => {
  posted.push({ url, body: send?.body ?? '' });
  return { status: 200, type: 'text/plain', json: async () => ({}), bytes: async () => new Uint8Array() } as Answer;
};

async function person(name: string): Promise<number> {
  return (await db.run("INSERT INTO users (username, password_hash, created_at) VALUES (?, 'x', 'now')", [name])).lastId;
}

beforeEach(async () => {
  db = memoryDb();
  expect(await migrate(db)).toBe(LATEST);
  owner = await person('owner');
  time = new Date(2046, 2, 5, 10, 0, 0);
  posted = [];
});

it('works out the night before, the morning of and hours before, across midnight, month ends and year ends', () => {
  expect(prepTime({ rule: 'night_before', at: '20:00' }, '2046-03-06', '18:00')).toEqual({ day: '2046-03-05', time: '20:00' });
  expect(prepTime({ rule: 'night_before' }, '2046-03-06', '18:00')).toEqual({ day: '2046-03-05', time: '20:00' }); // the usual time
  expect(prepTime({ rule: 'morning_of', at: '07:00' }, '2046-03-06', '18:00')).toEqual({ day: '2046-03-06', time: '07:00' });
  expect(prepTime({ rule: 'hours_before', hours: 3 }, '2046-03-06', '18:00')).toEqual({ day: '2046-03-06', time: '15:00' });
  // Across midnight: 3 hours before a 1 am snack-time dinner is the evening before.
  expect(prepTime({ rule: 'hours_before', hours: 3 }, '2046-03-06', '01:30')).toEqual({ day: '2046-03-05', time: '22:30' });
  // Across the end of a month and of a year, and a leap day.
  expect(prepTime({ rule: 'night_before', at: '21:00' }, '2046-04-01', '18:00')).toEqual({ day: '2046-03-31', time: '21:00' });
  expect(prepTime({ rule: 'hours_before', hours: 30 }, '2047-01-01', '12:00')).toEqual({ day: '2046-12-31', time: '06:00' });
  expect(prepTime({ rule: 'night_before', at: '20:00' }, '2048-03-01', '18:00')).toEqual({ day: '2048-02-29', time: '20:00' });
  expect(prepTime({ rule: 'hours_before', hours: 72 }, '2046-03-01', '08:00')).toEqual({ day: '2046-02-26', time: '08:00' });
});

it('says a time and a when the way a person would', () => {
  expect([clockWords('20:00'), clockWords('07:30'), clockWords('12:00'), clockWords('00:15')]).toEqual(['8 pm', '7:30 am', 'noon', '12:15 am']);
  expect(whenWords({ day: '2046-03-05', time: '20:00' }, '2046-03-05')).toBe('tonight 8 pm');
  expect(whenWords({ day: '2046-03-06', time: '07:00' }, '2046-03-05')).toBe('tomorrow morning 7 am');
  expect(whenWords({ day: '2046-03-05', time: '07:00' }, '2046-03-05')).toBe('this morning 7 am');
  expect(whenWords({ day: '2046-03-08', time: '15:00' }, '2046-03-05')).toBe('Thursday 3 pm');
});

it('steps are written to a download and read back', () => {
  const steps = [
    { words: 'Thaw the chicken', rule: 'night_before' as const, at: '20:00', hours: null },
    { words: 'Start the beans', rule: 'morning_of' as const, at: '07:30', hours: null },
    { words: 'Take the butter out', rule: 'hours_before' as const, at: null, hours: 3 },
  ];
  expect(prepFromText(prepAsText(steps))).toEqual([
    { words: 'Thaw the chicken', rule: 'night_before', at: '20:00' },
    { words: 'Start the beans', rule: 'morning_of', at: '07:30' },
    { words: 'Take the butter out', rule: 'hours_before', hours: 3 },
  ]);
  expect(prepFromText('nonsense\n99 hours before: too long')).toEqual([]);
});

it('a recipe keeps its prep steps, and every meal it is planned for gets them, with a time to eat that can change', async () => {
  const k = kitchen(db, owner, clock);
  const chicken = (await k.createRecipe({ title: 'Roast chicken', ingredients_text: '1 chicken' })).id;
  const mine = prep(db, owner, clock);
  expect((await mine.setRecipeSteps(chicken, [{ words: 'Thaw the chicken', rule: 'night_before', at: '20:00' }, { words: 'Salt it', rule: 'hours_before', hours: 3 }])).map((s) => s.when))
    .toEqual(['the night before at 8 pm', '3 hours before']);
  const dinner = (await k.addPlan({ day: '2046-03-06', meal: 'dinner', recipe_id: chicken })).id;
  const lunch = (await k.addPlan({ day: '2046-03-07', meal: 'lunch', recipe_id: chicken })).id;

  const week = await mine.forMeals('2046-03-05', '2046-03-11');
  expect(week.map((c) => [c.meal_id, c.words, c.due_day, c.due_time, c.label])).toEqual([
    [dinner, 'Thaw the chicken', '2046-03-05', '20:00', 'tonight 8 pm'],
    [dinner, 'Salt it', '2046-03-06', '15:00', 'tomorrow 3 pm'],
    [lunch, 'Thaw the chicken', '2046-03-06', '20:00', 'tomorrow night 8 pm'],
    [lunch, 'Salt it', '2046-03-07', '09:00', 'Wednesday 9 am'],
  ]);

  // A meal's own time to eat moves what is counted from it; its one-off steps are added to the recipe's.
  const set = await mine.setMeal(dinner, { eat_time: '19:30', steps: [{ words: 'Make the stock', rule: 'morning_of', at: '09:00' }] });
  expect([set.eat_time, set.default_eat_time, set.steps.map((s) => s.words), set.recipe_steps.length]).toEqual(['19:30', '18:00', ['Make the stock'], 2]);
  const again = await mine.forMeals('2046-03-06', '2046-03-06');
  expect(again.map((c) => [c.words, c.source, c.due_time])).toEqual([['Thaw the chicken', 'recipe', '20:00'], ['Make the stock', 'meal', '09:00'], ['Salt it', 'recipe', '16:30']]);
  await expect(mine.setMeal(dinner, { eat_time: '7pm' })).rejects.toEqual(problem(400));
  await expect(mine.setMeal(dinner, { steps: [{ words: 'x', rule: 'hours_before', hours: 100 }] })).rejects.toEqual(problem(400));
  expect((await mine.setMeal(dinner, { eat_time: null })).eat_time).toBeNull();

  // Another person's meals and recipes are out of reach.
  const other = await person('other');
  await expect(prep(db, other, clock).setRecipeSteps(chicken, [])).rejects.toEqual(problem(404));
  await expect(prep(db, other, clock).meal(dinner)).rejects.toEqual(problem(404));
  expect(await prep(db, other, clock).forMeals('2046-03-05', '2046-03-11')).toEqual([]);
});

it('a step already past is not shown, and Home sees tonight and tomorrow morning', async () => {
  const k = kitchen(db, owner, clock);
  const r = (await k.createRecipe({ title: 'Bread', ingredients_text: '1 cup flour' })).id;
  await prep(db, owner, clock).setRecipeSteps(r, [{ words: 'Feed the starter', rule: 'morning_of', at: '06:00' }, { words: 'Mix the dough', rule: 'night_before', at: '20:00' }]);
  await k.addPlan({ day: '2046-03-05', meal: 'dinner', recipe_id: r }); // today: 6 am has gone, last night's has gone
  await k.addPlan({ day: '2046-03-06', meal: 'breakfast', recipe_id: r }); // tomorrow: tonight 8 pm, tomorrow 6 am
  const soon = await prep(db, owner, clock).due('2046-03-05', '2046-03-06');
  expect(soon.map((c) => [c.words, c.due_day, c.due_time])).toEqual([['Mix the dough', '2046-03-05', '20:00'], ['Feed the starter', '2046-03-06', '06:00']]);
});

it('a moved meal moves its reminders and a removed one takes them away', async () => {
  const k = kitchen(db, owner, clock);
  const r = (await k.createRecipe({ title: 'Stew', ingredients_text: '1 lb beef' })).id;
  const mine = prep(db, owner, clock);
  await mine.setRecipeSteps(r, [{ words: 'Brown the beef', rule: 'morning_of', at: '09:00' }]);
  const meal = (await k.addPlan({ day: '2046-03-06', meal: 'dinner', recipe_id: r })).id;
  await mine.setMeal(meal, { steps: [{ words: 'Soak the beans', rule: 'night_before', at: '21:00' }] });
  expect((await mine.forMeals('2046-03-05', '2046-03-20')).map((c) => c.due_day)).toEqual(['2046-03-05', '2046-03-06']);
  await db.run('UPDATE meal_plan SET day = ? WHERE id = ?', ['2046-03-12', meal]); // the meal moves
  expect((await mine.forMeals('2046-03-05', '2046-03-20')).map((c) => c.due_day)).toEqual(['2046-03-11', '2046-03-12']);
  await k.deletePlan(meal); // and goes
  expect(await mine.forMeals('2046-03-05', '2046-03-20')).toEqual([]);
  expect(await db.get('SELECT 1 AS x FROM prep_steps WHERE meal_plan_id = ?', [meal])).toBeUndefined(); // its own steps went with it
  expect((await mine.recipeSteps(r)).length).toBe(1); // the recipe's stayed
  // A meal already cooked has nothing left to prepare.
  const done = (await k.addPlan({ day: '2046-03-08', meal: 'dinner', recipe_id: r })).id;
  await db.run('UPDATE meal_plan SET cooked_on = ? WHERE id = ?', ['2046-03-08', done]);
  expect(await mine.forMeals('2046-03-05', '2046-03-20')).toEqual([]);
});

it('sends each step once, at its time, in the person\'s own time zone, and never late', async () => {
  const k = kitchen(db, owner, clock);
  const r = (await k.createRecipe({ title: 'Roast chicken', ingredients_text: '1 chicken' })).id;
  await prep(db, owner, clock).setRecipeSteps(r, [{ words: 'Thaw the chicken', rule: 'night_before', at: '20:00' }]);
  await k.addPlan({ day: '2046-03-06', meal: 'dinner', recipe_id: r });
  const tools = { fetcher };
  await reminders(db, owner, clock, tools).save({ ntfy: { server: 'https://ntfy.example.org', topic: 'abcdef123456', detail: 'full' }, zone: 'Asia/Tokyo' });
  // 8 pm in Tokyo on the 5th is 11:00 UTC.
  expect(await prepDue(db, new Date(Date.UTC(2046, 2, 5, 10, 59)), tools)).toEqual([]);
  const sent = await prepDue(db, new Date(Date.UTC(2046, 2, 5, 11, 0)), tools);
  expect(sent).toEqual([{ user: owner, sent: ['ntfy'], problems: [] }]);
  expect(posted).toHaveLength(1);
  expect(posted[0]!.body).toContain('Thaw the chicken');
  expect(posted[0]!.body).toContain('Roast chicken at 6 pm');
  // Once only, however many times it is looked at.
  expect(await prepDue(db, new Date(Date.UTC(2046, 2, 5, 11, 1)), tools)).toEqual([]);
  expect(posted).toHaveLength(1);

  // A second meal whose step went by more than a quarter of an hour ago is not sent late.
  await k.addPlan({ day: '2046-03-07', meal: 'dinner', recipe_id: r });
  expect(await prepDue(db, new Date(Date.UTC(2046, 2, 6, 11, 20)), tools)).toEqual([]);
  expect(posted).toHaveLength(1);
  // One just inside the window still goes.
  expect((await prepDue(db, new Date(Date.UTC(2046, 2, 6, 11, 10)), tools)).length).toBe(1);
  expect(posted).toHaveLength(2);
});

it('sends nothing to a person who has no way of being reminded, and follows a meal that moved', async () => {
  const k = kitchen(db, owner, clock);
  const r = (await k.createRecipe({ title: 'Soup', ingredients_text: '1 onion' })).id;
  await prep(db, owner, clock).setRecipeSteps(r, [{ words: 'Soak the beans', rule: 'night_before', at: '20:00' }]);
  const meal = (await k.addPlan({ day: '2046-03-06', meal: 'dinner', recipe_id: r })).id;
  const tools = { fetcher };
  const at = (day: number) => new Date(Date.UTC(2046, 2, day, 20, 0)); // UTC is the server's own zone here
  await reminders(db, owner, clock, tools).save({ zone: 'UTC' });
  expect(await prepDue(db, at(5), tools)).toEqual([]); // nothing turned on
  await reminders(db, owner, clock, tools).save({ ntfy: { server: 'https://ntfy.example.org', topic: 'abcdef123456', detail: 'count' } });
  await db.run('UPDATE meal_plan SET day = ? WHERE id = ?', ['2046-03-09', meal]); // moved: the old time brings nothing
  expect(await prepDue(db, at(5), tools)).toEqual([]);
  expect(posted).toHaveLength(0);
  expect((await prepDue(db, at(8), tools)).length).toBe(1);
  expect(posted).toHaveLength(1);
});
