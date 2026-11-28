/** Food on any plan: when it is served, food that is bought or brought, what starts frozen, and the countdown back from the time. */
import { beforeEach, expect, it } from 'vitest';
import type { Db } from '../src/db.ts';
import { holidays } from '../src/holidays.ts';
import { kitchen } from '../src/kitchen.ts';
import { LATEST, MIGRATIONS, migrate } from '../src/migrations.ts';
import { plans, type Plans } from '../src/plans.ts';
import { memoryDb } from './memoryDb.ts';

let db: Db;
let owner: number;
let mine: Plans;
let time: Date;
const clock = () => time;
const problem = (status: number) => expect.objectContaining({ name: 'Problem', status });

async function person(name: string): Promise<number> {
  return (await db.run("INSERT INTO users (username, password_hash, created_at) VALUES (?, 'x', 'now')", [name])).lastId;
}

beforeEach(async () => {
  db = memoryDb();
  await migrate(db);
  owner = await person('owner');
  time = new Date(2046, 2, 5, 10, 0, 0); // Monday 5 March
  mine = plans(db, owner, clock);
});

type Countdown = Awaited<ReturnType<ReturnType<typeof holidays>['year']>>['countdown'];
const gathering = () => holidays(db, owner, clock);

it('any plan has a time it is served, a meal or refreshments, and food that is bought or brought', async () => {
  const plan = await mine.create({ name: 'Backyard lunch', start_day: '2046-03-10', start: 'gathering' });
  expect([plan.served_at, plan.food_kind, plan.food_lines]).toEqual([null, 'meal', []]);
  await expect(mine.setFood(plan.id, { served_at: '12pm' })).rejects.toEqual(problem(400));
  await expect(mine.setFood(plan.id, { food_kind: 'feast' })).rejects.toEqual(problem(400));
  expect((await mine.setFood(plan.id, { served_at: '12:30', food_kind: 'refreshments' })).food_kind).toBe('refreshments');
  expect((await mine.setFood(plan.id, { served_at: null })).served_at).toBeNull();
  await mine.setFood(plan.id, { served_at: '12:30' });
  // Left out, it stays.
  const now = await mine.get(plan.id);
  expect([now.served_at, now.food_kind]).toEqual(['12:30', 'refreshments']);

  await expect(mine.addFood(plan.id, { label: ' ' })).rejects.toEqual(problem(400));
  await expect(mine.addFood(plan.id, { label: 'Ham', thaw_pounds: 61 })).rejects.toEqual(problem(400));
  await expect(mine.addFood(plan.id, { label: 'Ham', thaw_pounds: 0.5 })).rejects.toEqual(problem(400));
  await mine.addFood(plan.id, { label: 'Cookies', brought_by: 'Maya' });
  const ham = (await mine.addFood(plan.id, { label: 'Ham', thaw_pounds: 8 })).food_lines[1]!;
  expect((await mine.get(plan.id)).food_lines.map((f) => [f.label, f.brought_by, f.thaw_pounds, f.done])).toEqual([['Cookies', 'Maya', null, false], ['Ham', null, 8, false]]);
  const done = await mine.updateFood(ham.id, { done: true, brought_by: 'Sam' });
  expect(done.food_lines[1]).toMatchObject({ done: true, brought_by: 'Sam', thaw_pounds: 8 });
  expect((await mine.updateFood(ham.id, { thaw_pounds: null })).food_lines[1]!.thaw_pounds).toBeNull();
  expect((await mine.removeFood(ham.id)).food_lines.map((f) => f.label)).toEqual(['Cookies']);
  await expect(plans(db, await person('other'), clock).removeFood(ham.id)).rejects.toEqual(problem(404));
  await expect(plans(db, await person('other2'), clock).addFood(plan.id, { label: 'x' })).rejects.toEqual(problem(404));
  for (let n = 0; n < 99; n += 1) await mine.addFood(plan.id, { label: `Dish ${n}` });
  await expect(mine.addFood(plan.id, { label: 'One too many' })).rejects.toEqual(problem(400));
});

it('adding food to a plan that lacks the Food part checks it', async () => {
  const plan = await mine.create({ name: 'Walk', start_day: '2046-03-10', parts: ['tasks'] });
  expect((await mine.addFood(plan.id, { label: 'Sandwiches' })).parts).toContain('food');
  const other = await mine.create({ name: 'Walk 2', start_day: '2046-03-11', parts: ['tasks'] });
  expect((await mine.setFood(other.id, { served_at: '10:00' })).parts).toContain('food');
});

it('the meals of a plan on the week are eaten when it is served, and a recipe can start frozen', async () => {
  const roast = (await kitchen(db, owner, clock).createRecipe({ title: 'Pork roast', ingredients_text: '1 roast' })).id;
  const plan = await mine.create({ name: 'Sunday supper', start_day: '2046-03-11', start: 'gathering' });
  const item = (await mine.addItem(plan.id, { kind: 'recipe', ref_id: roast, day: '2046-03-11', meal: 'dinner', thaw_pounds: 6 })).items_list[0]!;
  expect([item.thaw_pounds, item.on_week!.day]).toEqual([6, '2046-03-11']);
  await mine.setFood(plan.id, { served_at: '18:00' });
  expect((await db.get<{ eat_time: string }>('SELECT eat_time FROM meal_plan WHERE recipe_id = ?', [roast]))!.eat_time).toBe('18:00');
  await expect(mine.updateItem(item.id, { thaw_pounds: 100 })).rejects.toEqual(problem(400));
  // A task has no weight.
  const task = (await mine.addItem(plan.id, { kind: 'task', label: 'Set the table', thaw_pounds: 5 })).items_list[1]!;
  expect(task.thaw_pounds).toBeNull();
});

it('a plain plan counts back from when it is served, with a thaw step for each frozen thing', async () => {
  const roast = (await kitchen(db, owner, clock).createRecipe({ title: 'Pork roast', ingredients_text: '1 roast', cook_minutes: 120 })).id;
  const plan = await mine.create({ name: 'Sunday supper', start_day: '2046-03-11', start: 'gathering' });
  await mine.addItem(plan.id, { kind: 'recipe', ref_id: roast, thaw_pounds: 9 });
  const ham = (await mine.addFood(plan.id, { label: 'Ham', thaw_pounds: 14 })).food_lines[0]!;
  const before = (await gathering().gathering(plan.id)) as { countdown: Countdown };
  expect(before.countdown).toMatchObject({ served_at: null, steps: [], thaw: [{ label: 'Ham', days: 4 }, { label: 'Pork roast', days: 3 }] });

  await mine.setFood(plan.id, { served_at: '18:00', food_kind: 'refreshments' });
  const view = (await gathering().gathering(plan.id)) as { holiday: null; countdown: Countdown };
  expect(view.holiday).toBeNull();
  expect(view.countdown.food_kind).toBe('refreshments');
  expect(view.countdown.steps.map((s) => `${s.due_day} ${s.due_time} ${s.words}`)).toEqual([
    '2046-03-07 09:00 Put the 14 lb Ham in the refrigerator to thaw', // 14 lb: 4 days
    '2046-03-08 09:00 Put the 9 lb Pork roast in the refrigerator to thaw', // 9 lb: 3 days
    '2046-03-11 16:00 Start cooking Pork roast', // 120 minutes before 6 pm
  ]);
  expect(view.countdown.steps[0]!.detail).toContain('USDA: thawing in the refrigerator');

  // Steps of your own, and ticks, work on any plan the person owns.
  const withStep = (await gathering().addStep(plan.id, { words: 'Set the table', rule: 'hours_before', hours: 1 })) as { countdown: Countdown };
  expect(withStep.countdown.steps.find((s) => s.words === 'Set the table')).toMatchObject({ due_day: '2046-03-11', due_time: '17:00' });
  const ticked = (await gathering().tick(plan.id, `f${ham.id}`, true)) as { countdown: Countdown };
  expect(ticked.countdown.steps.find((s) => s.key === `f${ham.id}`)!.done).toBe(true);
  const itemId = (await mine.get(plan.id)).items_list[0]!.id;
  const again = (await gathering().tick(plan.id, `t${itemId}`, true)) as { countdown: Countdown };
  expect(again.countdown.steps.filter((s) => s.done)).toHaveLength(2);
  await expect(gathering().tick(plan.id, 'x1', true)).rejects.toEqual(problem(400));
  await expect(holidays(db, await person('stranger'), clock).tick(plan.id, `f${ham.id}`, true)).rejects.toEqual(problem(404));

  // Taking the food off the plan takes its tick with it.
  await mine.removeFood(ham.id);
  expect((await db.all('SELECT key FROM holiday_ticks WHERE plan_id = ?', [plan.id])).map((r) => r.key)).toEqual([`t${itemId}`]);

  // Reminders cover a plan that is not a year too.
  expect((await gathering().countdownDue('2046-03-08', '2046-03-08')).map((d) => d.words)).toEqual([]); // the roast's thaw was ticked
  const set = await gathering().countdownDue('2046-03-11', '2046-03-11');
  expect(set.map((d) => [d.words, d.what, d.eat_time])).toEqual([
    ['Start cooking Pork roast', 'Sunday supper refreshments', '18:00'], ['Set the table', 'Sunday supper refreshments', '18:00'],
  ]);
});

it('the next time starts with the same time served, food and weights, nothing checked', async () => {
  const plan = await mine.create({ name: 'Supper', start_day: '2046-03-11', start: 'gathering' });
  await mine.setFood(plan.id, { served_at: '17:30', food_kind: 'refreshments' });
  const roast = (await kitchen(db, owner, clock).createRecipe({ title: 'Roast', ingredients_text: '1 roast' })).id;
  await mine.addItem(plan.id, { kind: 'recipe', ref_id: roast, thaw_pounds: 5 });
  const line = (await mine.addFood(plan.id, { label: 'Turkey', brought_by: 'Uncle', thaw_pounds: 14 })).food_lines[0]!;
  await mine.updateFood(line.id, { done: true });
  const next = await mine.copy(plan.id, { start_day: '2047-03-10' });
  expect([next.served_at, next.food_kind, next.items_list[0]!.thaw_pounds]).toEqual(['17:30', 'refreshments', 5]);
  expect(next.food_lines.map((f) => [f.label, f.brought_by, f.thaw_pounds, f.done])).toEqual([['Turkey', 'Uncle', 14, false]]);
  expect((await mine.get(plan.id)).food_lines[0]!.done).toBe(true); // the old one stays as it was
});

it("a holiday year's dinner time and turkey carry over as the time served and a Turkey line that thaws", async () => {
  // A database as version 64 left it: a year with a dinner time, a turkey weight and its thaw ticked, and one with none.
  const old = memoryDb();
  for (const m of MIGRATIONS.filter((x) => x.number <= 64)) for (const statement of m.statements) await old.run(statement);
  await old.run('PRAGMA user_version = 64');
  const who = (await old.run("INSERT INTO users (username, password_hash, created_at) VALUES ('old', 'x', 'now')")).lastId;
  const hol = (await old.run("INSERT INTO holidays (owner_id, name, rule, lead_weeks, created_at, updated_at) VALUES (?, 'Gathering', 'manual', 6, 'now', 'now')", [who])).lastId;
  const year = async (name: string, day: string, y: number, dinner: string | null, pounds: number | null) => {
    const p = (await old.run("INSERT INTO plans (owner_id, name, start_day, end_day, parts, created_at, updated_at) VALUES (?, ?, ?, ?, 'food', 'now', 'now')", [who, name, day, day])).lastId;
    await old.run('INSERT INTO holiday_years (plan_id, holiday_id, year, dinner_time, turkey_pounds) VALUES (?, ?, ?, ?, ?)', [p, hol, y, dinner, pounds]);
    return p;
  };
  const a = await year('Gathering 2045', '2045-11-23', 2045, '17:00', 16);
  const b = await year('Gathering 2046', '2046-11-22', 2046, null, null);
  await old.run("INSERT INTO holiday_ticks (plan_id, key) VALUES (?, 'thaw')", [a]);
  await old.run("INSERT INTO holiday_ticks (plan_id, key) VALUES (?, 'c7')", [a]);
  expect(await migrate(old)).toBe(LATEST);
  const there = await plans(old, who, clock).get(a);
  expect([there.served_at, there.food_kind, there.food_lines.map((f) => [f.label, f.thaw_pounds, f.done])]).toEqual(['17:00', 'meal', [['Turkey', 16, false]]]);
  const quiet = await plans(old, who, clock).get(b);
  expect([quiet.served_at, quiet.food_lines]).toEqual([null, []]);
  // The thaw that was ticked is ticked on the new line; other ticks stay.
  const line = there.food_lines[0]!.id;
  expect((await old.all('SELECT key FROM holiday_ticks WHERE plan_id = ? ORDER BY key', [a])).map((r) => r.key)).toEqual(['c7', `f${line}`]);
  const view = await holidays(old, who, () => new Date(2045, 10, 1, 10, 0, 0)).year(a);
  expect(view.countdown.steps.find((s) => s.key === `f${line}`)).toMatchObject({ done: true, words: 'Put the 16 lb Turkey in the refrigerator to thaw' });
});
