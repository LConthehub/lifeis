/** Spending against a plan, private unless a category is shared by name. */
import { beforeEach, expect, it } from 'vitest';
import type { Db } from '../src/db.ts';
import { migrate } from '../src/migrations.ts';
import { money } from '../src/money.ts';
import { projects } from '../src/projects.ts';
import { memoryDb } from './memoryDb.ts';

let db: Db;
let ana: number;
let ben: number;
let cal: number;
const clock = Object.assign(() => new Date(Date.UTC(2046, 2, 5, 10, 0, 0)), { today: () => '2046-03-05' });
const person = async (name: string) => (await db.run("INSERT INTO users (username, password_hash, created_at) VALUES (?, 'x', 'now')", [name])).lastId;
const of = (who: number) => money(db, who, clock);

beforeEach(async () => {
  db = memoryDb();
  await migrate(db);
  ana = await person('ana'); ben = await person('ben'); cal = await person('cal');
});

it('a month says what was planned, what was spent, and what is left in each category', async () => {
  const groceries = await of(ana).addCategory({ name: 'Groceries', monthly_cents: 60000 });
  const fun = await of(ana).addCategory({ name: 'Fun', monthly_cents: 10000 });
  await of(ana).addEntry({ label: 'Market', cents: 8250, category_id: groceries.id });
  await of(ana).addEntry({ label: 'Cinema', cents: 12000, category_id: fun.id, day: '2046-03-02' });
  await of(ana).addEntry({ label: 'Parking', cents: 500 }); // in no category
  await of(ana).addEntry({ label: 'Last month', cents: 99900, category_id: groceries.id, day: '2046-02-27' });
  const march = await of(ana).month();
  expect(march.month).toBe('2046-03');
  expect(march.categories.map((c) => [c.name, c.monthly_cents, c.spent, c.left, c.mine])).toEqual([['Groceries', 60000, 8250, 51750, true], ['Fun', 10000, 12000, -2000, true]]);
  expect([march.uncategorised, march.total]).toEqual([500, { planned: 70000, spent: 20750, left: 49250 }]);
  expect(march.entries.map((e) => [e.label, e.category, e.day])).toEqual([['Parking', null, '2046-03-05'], ['Market', 'Groceries', '2046-03-05'], ['Cinema', 'Fun', '2046-03-02']]);
  expect((await of(ana).month('2046-02')).categories[0]).toMatchObject({ spent: 99900, left: -39900 });
  expect((await of(ana).month('nonsense')).month).toBe('2046-03');

  await expect(of(ana).addEntry({ label: '', cents: 100 })).rejects.toMatchObject({ status: 400 });
  await expect(of(ana).addEntry({ label: 'x', cents: -5 })).rejects.toMatchObject({ status: 422 });
  await expect(of(ana).addCategory({ name: ' ' })).rejects.toMatchObject({ status: 400 });
});

it('what was paid on projects shows in the month, without being written twice', async () => {
  const making = projects(db, ana, clock);
  let dress = await making.createProject({ name: 'Shirt dress' });
  dress = await making.addCost(dress.id, { label: 'Linen', planned_cents: 4500 });
  dress = await making.addCost(dress.id, { label: 'Buttons', planned_cents: 800 });
  await making.payCost(dress.costs[0]!.id, 5200);
  const march = await of(ana).month();
  expect(march.projects).toEqual({ spent: 5200, lines: [{ project_id: dress.id, project: 'Shirt dress', label: 'Linen', cents: 5200, day: '2046-03-05' }] });
  expect(march.total.spent).toBe(5200);
  expect((await of(ben).month()).projects.spent).toBe(0); // someone else's projects are theirs
});

it('is private unless a category is shared by name, and then only that category', async () => {
  const house = await of(ana).addCategory({ name: 'House', monthly_cents: 50000, shared_with: [ben] });
  const gift = await of(ana).addCategory({ name: "Ben's birthday", monthly_cents: 20000 });
  await of(ana).addEntry({ label: 'Paint', cents: 4000, category_id: house.id });
  await of(ana).addEntry({ label: 'Watch', cents: 15000, category_id: gift.id });
  await of(ana).addEntry({ label: 'Coffee', cents: 400 });

  // Ben sees the house and what was spent on it, and nothing of the surprise or Ana's loose spending.
  let bens = await of(ben).month();
  expect(bens.categories.map((c) => [c.name, c.spent, c.mine, c.owner])).toEqual([['House', 4000, false, 'ana']]);
  expect(bens.entries.map((e) => [e.label, e.by, e.mine])).toEqual([['Paint', 'ana', false]]);
  expect([bens.uncategorised, bens.total.spent]).toEqual([0, 4000]);
  expect(JSON.stringify(bens)).not.toMatch(/Watch|birthday|Coffee/);
  // Cal sees none of it.
  const cals = await of(cal).month();
  expect([cals.categories, cals.entries]).toEqual([[], []]);
  expect(cals.people.map((p) => p.username)).toEqual(['ana', 'ben']);

  // Ben can add to the house, and Ana sees it. He can't put anything in the surprise, or change the plan.
  await of(ben).addEntry({ label: 'Brushes', cents: 1200, category_id: house.id });
  expect((await of(ana).month()).categories[0]).toMatchObject({ spent: 5200, shared_with: [{ id: ben, username: 'ben' }] });
  await expect(of(ben).addEntry({ label: 'Peek', cents: 1, category_id: gift.id })).rejects.toMatchObject({ status: 404 });
  await expect(of(ben).updateCategory(house.id, { monthly_cents: 1 })).rejects.toMatchObject({ status: 403 });
  await expect(of(ben).updateCategory(gift.id, { name: 'Found it' })).rejects.toMatchObject({ status: 404 });
  await expect(of(cal).addEntry({ label: 'Mine', cents: 1, category_id: house.id })).rejects.toMatchObject({ status: 404 });
  // Ben can change his own line but not Ana's; Ana, whose category it is, can change either.
  bens = await of(ben).month();
  const [brushes, paint] = [bens.entries.find((e) => e.label === 'Brushes')!, bens.entries.find((e) => e.label === 'Paint')!];
  await of(ben).updateEntry(brushes.id, { label: 'Brushes and tape', cents: 1500, category_id: house.id });
  await expect(of(ben).removeEntry(paint.id)).rejects.toMatchObject({ status: 404 });
  await of(ana).removeEntry(brushes.id);
  expect((await of(ana).month()).categories[0]!.spent).toBe(4000);

  // Sharing stops when Ana says so, and a stranger to this Life Is can't be shared with.
  await of(ana).updateCategory(house.id, { shared_with: [] });
  expect((await of(ben).month()).categories).toEqual([]);
  await expect(of(ana).updateCategory(house.id, { shared_with: [9999] })).rejects.toMatchObject({ status: 400 });
});

it('removing a category keeps what was spent, and it goes back to being only its writer\'s', async () => {
  const house = await of(ana).addCategory({ name: 'House', monthly_cents: 50000, shared_with: [ben] });
  await of(ana).addEntry({ label: 'Paint', cents: 4000, category_id: house.id });
  await of(ben).addEntry({ label: 'Brushes', cents: 1200, category_id: house.id });
  await of(ana).removeCategory(house.id);
  expect((await of(ana).month()).entries.map((e) => e.label)).toEqual(['Paint']);
  expect((await of(ben).month()).entries.map((e) => e.label)).toEqual(['Brushes']);
  expect((await of(ana).month()).total).toEqual({ planned: 0, spent: 4000, left: -4000 });
});
