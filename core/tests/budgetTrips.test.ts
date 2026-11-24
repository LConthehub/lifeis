/** Budget with projects and grocery trips: one entry for a paid project cost, a list split by store, and a bank charge that is a trip already written down. */
import { beforeEach, expect, it } from 'vitest';
import { budget } from '../src/budget.ts';
import type { Db } from '../src/db.ts';
import { kitchen, type Kitchen } from '../src/kitchen.ts';
import { MIGRATIONS, migrate } from '../src/migrations.ts';
import { money } from '../src/money.ts';
import { projects } from '../src/projects.ts';
import { shopping, type ShoppingOf } from '../src/shopping.ts';
import { trips } from '../src/trips.ts';
import { memoryDb } from './memoryDb.ts';

let db: Db;
let me: number;
let k: Kitchen;
let shop: ShoppingOf;
const clock = Object.assign(() => new Date(Date.UTC(2046, 2, 5, 17, 0, 0)), { today: () => '2046-03-05' });
const person = async (name: string) => (await db.run("INSERT INTO users (username, password_hash, created_at) VALUES (?, 'x', 'now')", [name])).lastId;

beforeEach(async () => {
  db = memoryDb();
  await migrate(db);
  me = await person('me');
  k = kitchen(db, me, clock);
  shop = shopping(db, me, clock);
});

const idOf = async (label: string) => (await k.listGrocery()).find((g) => g.label.toLowerCase().includes(label))!.id;
/** Buy a thing at a store at a price, a week ago, so it is a price "last time" there. */
async function boughtBefore(label: string, store: string, cents: number, day = '2046-02-20') {
  await k.addGrocery({ label });
  const id = await idOf(label);
  const line = (await db.get<{ ingredient_id: number }>('SELECT ingredient_id FROM grocery WHERE id = ?', [id]))!;
  await db.run("INSERT INTO prices (owner_id, ingredient_id, label, cents, store, day, assumed, created_at) VALUES (?, ?, ?, ?, ?, ?, 0, 'now')", [me, line.ingredient_id, label, cents, store, day]);
  await db.run('DELETE FROM grocery WHERE id = ?', [id]);
}

it('a paid project cost is one spending entry: in the month, the budget and the project, counted once', async () => {
  const making = projects(db, me, clock);
  let dress = await making.createProject({ name: 'Shirt dress', status: 'active', due_on: '2046-05-10' });
  dress = await making.addCost(dress.id, { label: 'Linen', planned_cents: 4500 });
  dress = await making.addCost(dress.id, { label: 'Buttons', planned_cents: 800 });
  dress = await making.payCost(dress.costs[0]!.id, 5200);

  expect(await db.all("SELECT label, cents, day, project_id, project_cost_id FROM money_entries")).toEqual([{ label: 'Linen', cents: 5200, day: '2046-03-05', project_id: dress.id, project_cost_id: dress.costs[0]!.id }]);
  const march = await money(db, me, clock).month();
  expect(march.projects).toEqual({ spent: 5200, lines: [{ project_id: dress.id, project: 'Shirt dress', label: 'Linen', cents: 5200, day: '2046-03-05' }] });
  expect([march.entries, march.uncategorised, march.total.spent]).toEqual([[], 0, 5200]); // not listed a second time as a plain entry
  const plan = budget(db, me, clock);
  expect((await plan.month()).projects).toEqual({ spent: 5200, coming: 0 });
  expect((await plan.month()).spent).toBe(5200);
  const year = await plan.year();
  expect([year.totals.spent, year.totals.projects, year.months[2]!.projects]).toEqual([5200, 5200, 5200]);
  // The buttons are planned and not paid: coming in the month the project is due, and in no other, and not counted as spent.
  expect((await plan.month('2046-05')).projects).toEqual({ spent: 0, coming: 800 });
  expect((await money(db, me, clock).month('2046-05')).coming).toEqual({ cents: 800, lines: [{ project_id: dress.id, project: 'Shirt dress', label: 'Buttons', cents: 800, month: '2046-05' }] });
  expect((await plan.month('2046-04')).projects.coming).toBe(0);
  expect(year.months[4]!.coming).toBe(800);

  // The entry is changed from the project only; changing the cost changes it, and un-paying or removing the cost takes it away.
  const entry = (await db.get<{ id: number }>('SELECT id FROM money_entries'))!.id;
  await expect(money(db, me, clock).removeEntry(entry)).rejects.toMatchObject({ status: 409 });
  await expect(money(db, me, clock).updateEntry(entry, { label: 'x', cents: 1 })).rejects.toMatchObject({ status: 409 });
  dress = await making.updateCost(dress.costs[0]!.id, { actual_cents: 5000 });
  expect((await money(db, me, clock).month()).projects.spent).toBe(5000);
  dress = await making.unpayCost(dress.costs[0]!.id);
  expect((await money(db, me, clock).month()).total.spent).toBe(0);
  dress = await making.payCost(dress.costs[0]!.id, 5000);
  dress = await making.removeCost(dress.costs[0]!.id);
  expect(await db.all('SELECT id FROM money_entries')).toEqual([]);
  // Deleting a project takes what it spent with it, as before.
  dress = await making.addCost(dress.id, { label: 'Zip', planned_cents: 300 });
  await making.payCost(dress.costs[dress.costs.length - 1]!.id);
  await making.deleteProject(dress.id);
  expect(await db.all('SELECT id FROM money_entries')).toEqual([]);
});

it('paid costs from before are given their entries once, and not doubled', async () => {
  const old = memoryDb();
  for (const m of MIGRATIONS.filter((x) => x.number <= 43)) for (const statement of m.statements) await old.run(statement);
  await old.run('PRAGMA user_version = 43');
  const who = (await old.run("INSERT INTO users (username, password_hash, created_at) VALUES ('old', 'x', 'now')")).lastId;
  const p = (await old.run("INSERT INTO projects (owner_id, name, status, created_at, updated_at) VALUES (?, 'Shelf', 'active', 'now', 'now')", [who])).lastId;
  await old.run("INSERT INTO project_costs (project_id, label, planned_cents, actual_cents, paid_on, sort_order) VALUES (?, 'Boards', 6000, 6400, '2046-02-11', 0)", [p]);
  await old.run("INSERT INTO project_costs (project_id, label, planned_cents, sort_order) VALUES (?, 'Paint', 2000, 1)", [p]);
  expect(await migrate(old)).toBe(MIGRATIONS[MIGRATIONS.length - 1]!.number);
  expect(await migrate(old)).toBe(MIGRATIONS[MIGRATIONS.length - 1]!.number);
  expect(await old.all('SELECT label, cents, day, project_id FROM money_entries')).toEqual([{ label: 'Boards', cents: 6400, day: '2046-02-11', project_id: p }]);
  const february = await money(old, who, clock).month('2046-02');
  expect([february.projects.spent, february.total.spent]).toEqual([6400, 6400]);
});

it('a project can be saved up for, and a cost paid from the savings', async () => {
  const making = projects(db, me, clock);
  const plan = budget(db, me, clock);
  let desk = await making.createProject({ name: 'Standing desk', status: 'planned' });
  desk = await making.addCost(desk.id, { label: 'Frame', planned_cents: 40000 });
  desk = await making.addCost(desk.id, { label: 'Top', planned_cents: 20000 });
  const goal = await plan.addGoal({ name: 'Desk fund', target_cents: 60000 });
  await plan.putAside(goal.id, { cents: 25000, day: '2046-02-01' });
  expect(desk.budget.saved).toBeNull();
  desk = await making.linkGoal(desk.id, goal.id);
  expect(desk.budget.saved).toEqual({ cents: 25000, target: 60000, goals: [{ id: goal.id, name: 'Desk fund', saved: 25000, target: 60000 }] });
  expect((await plan.goal(goal.id)).project).toBe('Standing desk');

  // The frame costs more than is saved: the savings give what they have. The top is paid in full from the pocket.
  desk = await making.payCost(desk.costs[0]!.id, 40000, true);
  expect(desk.costs[0]!.drawn_cents).toBe(25000);
  expect(desk.budget.saved!.cents).toBe(0);
  expect((await plan.month()).saved.total).toBe(-25000); // taken out of the goal this month, as the cost is spent
  desk = await making.payCost(desk.costs[1]!.id, 20000, false);
  expect(desk.costs[1]!.drawn_cents).toBe(0);
  expect((await plan.month()).projects.spent).toBe(60000);
  // Un-paying gives the money back to the goal.
  desk = await making.unpayCost(desk.costs[0]!.id);
  expect(desk.budget.saved!.cents).toBe(25000);
  desk = await making.linkGoal(desk.id, null);
  expect(desk.budget.saved).toBeNull();
  await expect(making.linkGoal(desk.id, 999)).rejects.toMatchObject({ status: 404 });
  const goalFor = await plan.addGoal({ name: 'Another', target_cents: 100, project_id: desk.id });
  expect((await plan.goal(goalFor.id)).project_id).toBe(desk.id);
  await expect(plan.addGoal({ name: 'Nope', target_cents: 100, project_id: 999 })).rejects.toMatchObject({ status: 404 });
});

it('says how far over its plan a project is', async () => {
  const making = projects(db, me, clock);
  let shelf = await making.createProject({ name: 'Shelf', status: 'active' });
  shelf = await making.addCost(shelf.id, { label: 'Boards', planned_cents: 6000 });
  shelf = await making.addCost(shelf.id, { label: 'Paint', planned_cents: 2000 });
  expect(shelf.budget.over).toBe(0);
  shelf = await making.payCost(shelf.costs[0]!.id, 7500);
  expect([shelf.budget.over, shelf.budget.left]).toEqual([1500, -1500]);
  expect((await making.listProjects())[0]!.budget).toMatchObject({ over: 1500 }); // what Home reads
  shelf = await making.payCost(shelf.costs[1]!.id, 1000);
  expect(shelf.budget.over).toBe(500);
  shelf = await making.unpayCost(shelf.costs[0]!.id);
  expect(shelf.budget.over).toBe(0);
});

it('a list is split by store with an estimate for each, one tap moves a line, and nothing moves by itself', async () => {
  await db.run("INSERT INTO money_categories (owner_id, name, monthly_cents, created_at) VALUES (?, 'Groceries', 60000, 'now')", [me]);
  await boughtBefore('milk', 'Kroger', 349);
  await boughtBefore('milk', 'Aldi', 229, '2046-02-27');
  await boughtBefore('eggs', 'Aldi', 300);
  await boughtBefore('coffee', 'Kroger', 899);
  await k.addGrocery({ label: 'milk' });
  await k.addGrocery({ label: 'eggs' });
  await k.addGrocery({ label: 'coffee' });
  await k.addGrocery({ label: 'candles' }); // never priced, no store
  const [milk, eggs, coffee, candles] = [await idOf('milk'), await idOf('eggs'), await idOf('coffee'), await idOf('candles')];
  const line = (s: Awaited<ReturnType<typeof shop.summary>>, id: number) => s.lines.find((l) => l.id === id)!;

  let s = await shop.summary();
  // Milk was bought last at Aldi (the newer price), so it goes there; nothing says it is cheaper elsewhere than Aldi.
  expect([line(s, milk).likely_store, line(s, milk).estimate_cents, line(s, milk).cheaper]).toEqual(['Aldi', 229, null]);
  expect(s.stops).toEqual([
    { store: 'Aldi', lines: 2, open: 2, done: 0, estimate_cents: 529, unknown: 0 },
    { store: 'Kroger', lines: 1, open: 1, done: 0, estimate_cents: 899, unknown: 0 },
    { store: null, lines: 1, open: 1, done: 0, estimate_cents: 0, unknown: 1 },
  ]);
  // Whose usual store is Kroger: milk is there, and Aldi is cheaper by $1.20 for the same thing.
  await shop.setUsual(milk, { store: 'Kroger' });
  s = await shop.summary();
  expect([line(s, milk).likely_store, line(s, milk).estimate_cents, line(s, milk).cheaper]).toEqual(['Kroger', 349, { store: 'Aldi', saves_cents: 120 }]);
  expect(s.stops.find((x) => x.store === 'Kroger')).toMatchObject({ lines: 2, estimate_cents: 1248 });
  expect(line(s, coffee).cheaper).toBeNull(); // priced at one store only: nothing to compare

  // One tap: this line goes to Aldi for this trip. The thing's usual store is left alone.
  s = await shop.moveLine(milk, 'Aldi');
  expect([line(s, milk).likely_store, line(s, milk).moved_to, line(s, milk).estimate_cents]).toEqual(['Aldi', 'Aldi', 229]);
  expect((await db.get<{ usual_store: string }>('SELECT usual_store FROM ingredients WHERE name LIKE ?', ['milk%']))!.usual_store).toBe('Kroger');
  expect(s.stops.find((x) => x.store === 'Aldi')).toMatchObject({ lines: 2, estimate_cents: 529 });
  s = await shop.moveLine(milk, null);
  expect(line(s, milk).moved_to).toBeNull();
  await expect(shop.moveLine(99999, 'Aldi')).rejects.toMatchObject({ status: 404 });

  // The whole list against what is left in the grocery category this month.
  expect(s.grocery_budget).toMatchObject({ name: 'Groceries', planned_cents: 60000, spent_cents: 0, left_cents: 60000, estimate_cents: 1248 + 300 });
  expect(s.grocery_budget!.after_cents).toBe(60000 - 1548);
});

it('done shopping at a store asks for the receipt, makes one entry per store, and the bank charge is not counted again', async () => {
  const groceries = (await db.run("INSERT INTO money_categories (owner_id, name, monthly_cents, created_at) VALUES (?, 'Groceries', 60000, 'now')", [me])).lastId;
  await boughtBefore('milk', 'Aldi', 229);
  await boughtBefore('coffee', 'Kroger', 899);
  await k.addGrocery({ label: 'milk' });
  await k.addGrocery({ label: 'coffee' });
  await k.addGrocery({ label: 'candles' });
  const [milk, coffee, candles] = [await idOf('milk'), await idOf('coffee'), await idOf('candles')];
  await k.tickGrocery(milk, { done: true, put_away: false });
  await k.tickGrocery(coffee, { done: true, put_away: false });
  await shop.setStore('Aldi');
  await shop.setPrice(milk, 241); // typed on the way: it cost more than last time
  await shop.setStore('Kroger');
  await shop.setPrice(coffee, 899, true); // last time's price standing in
  const tr = trips(db, me, clock);

  const aldi = await tr.plan('Aldi');
  expect([aldi.estimate_cents, aldi.lines.map((l) => [l.label, l.cents]), aldi.unpriced]).toEqual([241, [['milk', 241]], 0]);
  expect(aldi.parts).toEqual([{ key: 'groceries', label: 'Groceries', cents: 241, lines: 1, category_id: groceries, project_id: null }]);
  await expect(tr.finish({ store: '', total_cents: 100 })).rejects.toMatchObject({ status: 400 });
  await expect(tr.finish({ store: 'Aldi', total_cents: -1 })).rejects.toMatchObject({ status: 422 });
  await expect(tr.finish({ store: 'Aldi', total_cents: 500, parts: [{ cents: 100 }] })).rejects.toMatchObject({ status: 400 });

  const doneAldi = await tr.finish({ store: 'Aldi', total_cents: 263 }); // the receipt had tax the estimate did not
  expect(doneAldi).toMatchObject({ store: 'Aldi', total_cents: 263, estimate_cents: 241, entries: 1, got: 1 });
  const doneKroger = await tr.finish({ store: 'Kroger', total_cents: 899 });
  expect(doneKroger.entries).toBe(1);
  // The two stores are two entries, in the grocery category; what was got is off the list and still in the price history.
  expect(await db.all('SELECT label, cents, category_id FROM money_entries ORDER BY id')).toEqual([
    { label: 'Groceries at Aldi', cents: 263, category_id: groceries }, { label: 'Groceries at Kroger', cents: 899, category_id: groceries }]);
  expect((await k.listGrocery()).map((g) => g.id)).toEqual([candles]);
  expect((await shop.stores()).map((x) => x.name)).toEqual(['Aldi', 'Kroger']);
  expect((await shop.summary()).grocery_budget).toMatchObject({ spent_cents: 1162, left_cents: 60000 - 1162 });
  expect((await money(db, me, clock).month()).total.spent).toBe(1162);

  // The bank brings in the same charges two days later: the same store and amount, close in time. They are the trips, not new spending.
  const bank = (txn: string, label: string, cents: number, day: string) => ({ label, cents, day, keep: true, bank: { account: 'ACT-1', txn } });
  const spending = money(db, me, clock);
  const first = await spending.bringIn([
    bank('T1', 'ALDI 72 SPRINGFIELD', 263, '2046-03-07'), bank('T2', 'KROGER #455', 899, '2046-03-06'),
    bank('T3', 'ALDI 72 SPRINGFIELD', 1234, '2046-03-07'), // a different amount: a new purchase
    bank('T4', 'CORNER CAFE', 263, '2046-03-07'), // the same amount, another place
  ]);
  expect([first.added, first.already]).toEqual([2, 2]);
  expect((await spending.month()).total.spent).toBe(1162 + 1234 + 263);
  // The same reading again counts nothing twice either: the trips are tied to their bank lines now.
  const again = await spending.bringIn([bank('T1', 'ALDI 72 SPRINGFIELD', 263, '2046-03-07'), bank('T2', 'KROGER #455', 899, '2046-03-06')]);
  expect([again.added, again.already]).toEqual([0, 2]);
  expect(await db.all('SELECT bank_txn FROM money_entries WHERE trip_id IS NOT NULL ORDER BY id')).toEqual([{ bank_txn: 'T1' }, { bank_txn: 'T2' }]);
  // A second charge for the same amount at Aldi, a week on, is a new trip.
  expect((await spending.bringIn([bank('T5', 'ALDI 72 SPRINGFIELD', 263, '2046-03-14')])).added).toBe(1);
  // A statement file (no bank ids) looks over the same way: a trip not yet matched shows as already written down.
  const tr2 = await tr.finish({ store: 'Aldi', total_cents: 777 });
  expect(tr2.entries).toBe(1);
  expect((await spending.lookOver([{ label: 'ALDI 72', cents: 777, day: '2046-03-06' }]))[0]).toMatchObject({ already: true });
  expect((await spending.lookOver([{ label: 'ALDI 72', cents: 778, day: '2046-03-06' }]))[0]).toMatchObject({ already: false });
  expect((await spending.lookOver([{ label: 'ALDI 72', cents: 777, day: '2046-03-30' }]))[0]).toMatchObject({ already: false });
  // Taking a trip's entry away takes the trip away: the charge would be new again.
  const gone = (await db.get<{ id: number }>('SELECT id FROM money_entries WHERE cents = 777'))!.id;
  await spending.removeEntry(gone);
  expect((await spending.lookOver([{ label: 'ALDI 72', cents: 777, day: '2046-03-06' }]))[0]).toMatchObject({ already: false });
});

it('a charge from a bank service, with its own ids, is recognized as a trip too', async () => {
  // SimpleFIN's reading brings its lines in through this same door (money.ts bringIn, with `bank` set).
  await boughtBefore('rice', 'Costco', 1500);
  await k.addGrocery({ label: 'rice' });
  const rice = await idOf('rice');
  await k.tickGrocery(rice, { done: true, put_away: false });
  await shop.setStore('Costco');
  await shop.setPrice(rice, 1500);
  await trips(db, me, clock).finish({ store: 'Costco', total_cents: 1500 });
  const done = await money(db, me, clock).bringIn([{ label: 'COSTCO WHSE #12', cents: 1500, day: '2046-03-05', keep: true, bank: { account: 'A', txn: 'X1' } }]);
  expect([done.added, done.already]).toEqual([0, 1]);
});

it('a receipt is split from what its things belong to, the person adjusts it, and a project part is a paid cost on the project', async () => {
  const groceries = (await db.run("INSERT INTO money_categories (owner_id, name, monthly_cents, created_at) VALUES (?, 'Groceries', 60000, 'now')", [me])).lastId;
  const house = (await db.run("INSERT INTO money_categories (owner_id, name, monthly_cents, created_at) VALUES (?, 'House', 20000, 'now')", [me])).lastId;
  const making = projects(db, me, clock);
  let bench = await making.createProject({ name: 'Garden bench', status: 'active' });
  bench = await making.addLine(bench.id, { label: 'wood stain' });
  await k.addGrocery({ label: 'rice' });
  await k.addGrocery({ label: 'dish soap' });
  await k.addGrocery({ label: 'wood stain' });
  await k.addGrocery({ label: 'oats' });
  const [rice, soap, stain, oats] = [await idOf('rice'), await idOf('soap'), await idOf('stain'), await idOf('oats')];
  await db.run("UPDATE ingredients SET aisle = 'Household' WHERE id = (SELECT ingredient_id FROM grocery WHERE id = ?)", [soap]);
  await db.run('UPDATE grocery SET from_plan = 1 WHERE id = ?', [oats]); // from the week's menu
  await shop.setStore('Target');
  for (const [id, cents] of [[rice, 300], [soap, 400], [stain, 1200], [oats, 200]] as const) {
    await k.tickGrocery(id, { done: true, put_away: false });
    await shop.setPrice(id, cents);
  }
  const tr = trips(db, me, clock);
  const plan = await tr.plan('Target');
  expect(plan.lines.map((l) => [l.label, l.belongs])).toEqual([['rice', 'groceries'], ['dish soap', 'household'], ['wood stain', 'project'], ['oats', 'menu']]);
  expect(plan.parts.map((p) => [p.key, p.label, p.cents, p.category_id, p.project_id])).toEqual([
    ['menu', "The week's meals", 200, groceries, null], ['groceries', 'Groceries', 300, groceries, null], ['household', 'Household', 400, house, null], [`project:${bench.id}`, 'Garden bench supplies', 1200, null, bench.id]]);

  // The person adjusts the amounts (tax made it $21.40, and the household part came to a bit more). Amounts that do not add up are refused.
  await expect(tr.finish({ store: 'Target', total_cents: 2140, parts: [{ cents: 200 }, { cents: 300 }] })).rejects.toMatchObject({ status: 400 });
  const parts = [{ label: "The week's meals", cents: 200, category_id: groceries }, { label: 'Groceries', cents: 300, category_id: groceries }, { label: 'Household', cents: 440, category_id: house }, { label: 'Garden bench supplies', cents: 1200, project_id: bench.id }];
  const fine = await tr.finish({ store: 'Target', total_cents: 2140, parts });
  expect([fine.entries, fine.got]).toEqual([4, 4]);
  expect(await db.all('SELECT label, cents, category_id, project_id FROM money_entries WHERE project_id IS NULL ORDER BY id')).toEqual([
    { label: "Target: The week's meals", cents: 200, category_id: groceries, project_id: null }, { label: 'Target: Groceries', cents: 300, category_id: groceries, project_id: null },
    { label: 'Target: Household', cents: 440, category_id: house, project_id: null }]);
  const month = await money(db, me, clock).month();
  expect([month.projects.spent, month.total.spent]).toEqual([1200, 2140]);
  const after = await making.getProject(bench.id);
  expect(after.costs.map((c) => [c.label, c.actual_cents, c.paid_on])).toEqual([['Target: Garden bench supplies', 1200, '2046-03-05']]);
  expect(after.budget.spent).toBe(1200);
  // One bank charge for the whole receipt is that one trip.
  const bank = await money(db, me, clock).bringIn([{ label: 'TARGET 00012', cents: 2140, day: '2046-03-06', keep: true, bank: { account: 'A', txn: 'T9' } }]);
  expect([bank.added, bank.already]).toEqual([0, 1]);
  expect((await money(db, me, clock).month()).total.spent).toBe(2140);
  // A category that is not the person's cannot be used for a part.
  const other = await person('other');
  const theirs = (await db.run("INSERT INTO money_categories (owner_id, name, monthly_cents, created_at) VALUES (?, 'Secret', 1, 'now')", [other])).lastId;
  await expect(tr.finish({ store: 'Target', total_cents: 100, parts: [{ cents: 100, category_id: theirs }] })).rejects.toMatchObject({ status: 404 });
});
