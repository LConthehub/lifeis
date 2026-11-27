/** Short requests from Siri, Google or a link: one thing each, answered in a sentence, with the pages' permissions. */
import { beforeEach, expect, it } from 'vitest';
import { actions, centsFrom, ACTION_LIST } from '../src/actions.ts';
import { accessNow, decide } from '../src/access.ts';
import type { Db } from '../src/db.ts';
import { inventory } from '../src/inventory.ts';
import { kitchen } from '../src/kitchen.ts';
import { migrate } from '../src/migrations.ts';
import { money } from '../src/money.ts';
import { memoryDb } from './memoryDb.ts';

let db: Db;
let ana: number;
let ben: number;
const clock = Object.assign(() => new Date(Date.UTC(2046, 2, 5, 10, 0, 0)), { today: () => '2046-03-05' });
const person = async (name: string) => (await db.run("INSERT INTO users (username, password_hash, created_at) VALUES (?, 'x', 'now')", [name])).lastId;
const problem = (status: number) => expect.objectContaining({ name: 'Problem', status });

beforeEach(async () => {
  db = memoryDb();
  await migrate(db);
  ana = await person('ana'); ben = await person('ben');
});

it('each action says what it does, what someone might say, and which part it belongs to', () => {
  expect(ACTION_LIST.map((a) => [a.id, a.does, a.part])).toEqual([
    ['add-to-groceries', 'writes', 'kitchen'], ['whats-for-dinner', 'reads', 'kitchen'], ['record-spending', 'writes', 'money'],
    ['whats-left', 'reads', 'money'], ['where-is', 'reads', 'things']]);
  for (const a of ACTION_LIST) expect(a.says.length).toBeGreaterThan(0);
  expect([centsFrom('12'), centsFrom('$12.50'), centsFrom('12,50'), centsFrom('1,200')]).toEqual([1200, 1250, 1250, 120000]);
  expect(() => centsFrom('lots')).toThrow(/how much/);
});

it('adds to groceries and says how long the list is; asks what is for dinner', async () => {
  const me = actions(db, ana, clock);
  expect(await me.run('add-to-groceries', { item: 'eggs' }, 'POST')).toEqual({ say: 'Added eggs to your grocery list. It is the only thing on it.', open: '/groceries' });
  expect((await me.run('add-to-groceries', { item: '2 litres milk' }, 'POST')).say).toMatch(/There are 2 things on it/);
  await expect(me.run('add-to-groceries', { item: '  ' }, 'POST')).rejects.toEqual(problem(400));
  expect((await me.run('whats-for-dinner', {}, 'GET')).say).toBe('Nothing is planned for today yet.');
  const soup = await kitchen(db, ana, clock).createRecipe({ title: 'Leek soup', ingredients_text: '3 leeks', steps_text: 'Simmer.', tags: [] });
  await kitchen(db, ana, clock).addPlan({ day: '2046-03-05', meal: 'dinner', recipe_id: soup.id });
  expect((await me.run('whats-for-dinner', {}, 'GET')).say).toBe('Dinner tonight is Leek soup.');
});

it('writes down spending in the category it names, says what is left, and keeps to what is shared', async () => {
  const groceries = await money(db, ana, clock).addCategory({ name: 'Groceries', monthly_cents: 40000 });
  await money(db, ben, clock).addCategory({ name: 'Secret', monthly_cents: 1000 });
  const me = actions(db, ana, clock);
  expect((await me.run('record-spending', { amount: '$12.50', what: 'groceries' }, 'POST')).say).toBe('Written down: $12.50 for groceries, in Groceries. $387.50 left in it this month.');
  expect((await me.run('record-spending', { amount: '4', what: 'parking' }, 'POST')).say).toBe('Written down: $4.00 for parking.');
  await expect(me.run('record-spending', { amount: '4', what: 'x', category: 'Secret' }, 'POST')).rejects.toThrow(/no category called Secret/);
  expect((await me.run('whats-left', { category: 'groceries' }, 'GET')).say).toBe('$387.50 left in Groceries this month.');
  expect((await me.run('whats-left', {}, 'GET')).say).toBe('$383.50 left this month, of $400.00 planned.');
  expect((await money(db, ana, clock).month()).categories.find((c) => c.id === groceries.id)!.spent).toBe(1250);
});

it('finds where a thing is kept', async () => {
  const things = inventory(db, ana, clock);
  const kinds = await things.addStarter('cookware');
  const shelf = (await things.createPlace({ name: 'Pantry shelf' })).find((p) => p.name === 'Pantry shelf')!;
  await things.createItem({ kind_id: kinds[0]!.id, name: '8x8 baking dish', place_id: shelf.id });
  const me = actions(db, ana, clock);
  expect((await me.run('where-is', { thing: 'baking dish' }, 'GET')).say).toBe('8x8 baking dish: Pantry shelf.');
  expect((await me.run('where-is', { thing: 'kayak' }, 'GET')).say).toBe("kayak isn't in your things.");
  expect((await actions(db, ben, clock).run('where-is', { thing: 'baking dish' }, 'GET')).say).toMatch(/isn't in your things/);
});

it('asking never changes anything, and a change must be sent as one', async () => {
  const me = actions(db, ana, clock);
  await expect(me.run('add-to-groceries', { item: 'eggs' }, 'GET')).rejects.toEqual(problem(400));
  await expect(me.run('where-is', { thing: 'x' }, 'POST')).rejects.toEqual(problem(400));
  await expect(me.run('launch-rockets', {}, 'POST')).rejects.toEqual(problem(404));
  // In the app after its trial: the kitchen's actions still work; spending can be asked about, not added to.
  const ended = accessNow({ trial_started: '2046-01-01T00:00:00Z', unlocked: false }, new Date('2046-03-05T00:00:00Z'));
  expect(decide(ended, 'POST', '/api/actions/add-to-groceries')).toBe('go');
  expect(decide(ended, 'POST', '/api/actions/record-spending')).toBe('read_only');
  expect(decide(ended, 'GET', '/api/actions/whats-left')).toBe('go');
});
