/** The budget: income, bills read from upkeep, savings goals, the month and the year, and spending by tag. */
import { beforeEach, expect, it } from 'vitest';
import type { Db } from '../src/db.ts';
import { billDates, billPerMonth, budget, incomeIn, perMonth } from '../src/budget.ts';
import { migrate } from '../src/migrations.ts';
import { money } from '../src/money.ts';
import { tags } from '../src/tags.ts';
import { upkeep } from '../src/upkeep.ts';
import { memoryDb } from './memoryDb.ts';

let db: Db;
let ana: number;
let ben: number;
const clock = Object.assign(() => new Date(Date.UTC(2046, 2, 5, 10, 0, 0)), { today: () => '2046-03-05' });
const person = async (name: string) => (await db.run("INSERT INTO users (username, password_hash, created_at) VALUES (?, 'x', 'now')", [name])).lastId;
const of = (who: number) => budget(db, who, clock);

beforeEach(async () => {
  db = memoryDb();
  await migrate(db);
  ana = await person('ana'); ben = await person('ben');
});

it('turns each way of coming in into an amount for a month', () => {
  expect(perMonth(120000, 'monthly')).toBe(120000);
  expect(perMonth(60000, 'twice_monthly')).toBe(120000);
  expect(perMonth(30000, 'weekly')).toBe(130000);
  expect(perMonth(100000, 'biweekly')).toBe(216667);
  expect(perMonth(1200000, 'yearly')).toBe(100000);
  expect(perMonth(50000, 'once')).toBe(0);
  expect(billPerMonth(120000, { n: 1, unit: 'year' })).toBe(10000);
  expect(billPerMonth(30000, { n: 3, unit: 'month' })).toBe(10000);
  expect(billPerMonth(700, { n: 1, unit: 'week' })).toBe(3044);
  expect(billPerMonth(500, null)).toBe(0);
});

it('counts what really comes in during a month, with start and end days', () => {
  const pay = (every: 'weekly' | 'biweekly' | 'twice_monthly' | 'monthly' | 'yearly' | 'once', extra: { start_day?: string | null; end_day?: string | null } = {}) =>
    ({ cents: 10000, every, start_day: extra.start_day ?? null, end_day: extra.end_day ?? null });
  // Fridays from 2046-03-02: the 2nd, 9th, 16th, 23rd and 30th.
  expect(incomeIn(pay('weekly', { start_day: '2046-03-02' }), '2046-03')).toBe(50000);
  expect(incomeIn(pay('weekly', { start_day: '2046-03-02' }), '2046-04')).toBe(40000); // 6, 13, 20, 27
  expect(incomeIn(pay('weekly', { start_day: '2046-03-02' }), '2046-02')).toBe(0);
  expect(incomeIn(pay('weekly', { start_day: '2046-03-02', end_day: '2046-03-15' }), '2046-03')).toBe(20000);
  expect(incomeIn(pay('weekly'), '2046-03')).toBe(43333); // no start day: the average month
  expect(incomeIn(pay('biweekly', { start_day: '2046-03-02' }), '2046-03')).toBe(30000); // 2, 16, 30
  expect(incomeIn(pay('biweekly', { start_day: '2046-03-02' }), '2046-04')).toBe(20000); // 13, 27
  expect(incomeIn(pay('twice_monthly'), '2046-03')).toBe(20000);
  expect(incomeIn(pay('twice_monthly', { start_day: '2046-03-10' }), '2046-03')).toBe(10000); // only the 15th
  expect(incomeIn(pay('monthly', { start_day: '2046-01-31' }), '2046-02')).toBe(10000); // the 31st is February's last day
  expect(incomeIn(pay('monthly', { start_day: '2046-03-10' }), '2046-02')).toBe(0);
  expect(incomeIn(pay('monthly', { start_day: '2046-01-10', end_day: '2046-03-09' }), '2046-03')).toBe(0);
  expect(incomeIn(pay('yearly', { start_day: '2046-06-20' }), '2046-06')).toBe(10000);
  expect(incomeIn(pay('yearly', { start_day: '2046-06-20' }), '2046-07')).toBe(0);
  expect(incomeIn(pay('yearly'), '2046-07')).toBe(833);
  expect(incomeIn(pay('once', { start_day: '2046-03-20' }), '2046-03')).toBe(10000);
  expect(incomeIn(pay('once', { start_day: '2046-03-20' }), '2046-04')).toBe(0);
});

it('keeps income, checks it, and keeps it private', async () => {
  const pay = await of(ana).addIncome({ name: 'Paycheck', cents: 150000, every: 'biweekly', start_day: '2046-03-02' });
  await of(ana).addIncome({ name: 'Tax refund', cents: 80000, every: 'once', start_day: '2046-03-20' });
  expect((await of(ana).income()).map((i) => [i.name, i.every, i.per_month])).toEqual([['Paycheck', 'biweekly', 325000], ['Tax refund', 'once', 0]]);
  await of(ana).updateIncome(pay.id, { name: 'Paycheck', cents: 160000, every: 'biweekly', start_day: '2046-03-02' });
  expect((await of(ana).income())[0]!.cents).toBe(160000);
  expect(await of(ben).income()).toEqual([]);
  await expect(of(ben).updateIncome(pay.id, { name: 'Mine now', cents: 1, every: 'monthly' })).rejects.toMatchObject({ status: 404 });
  await expect(of(ben).removeIncome(pay.id)).rejects.toMatchObject({ status: 404 });
  await expect(of(ana).addIncome({ name: '', cents: 1, every: 'monthly' })).rejects.toMatchObject({ status: 400 });
  await expect(of(ana).addIncome({ name: 'x', cents: 1, every: 'daily' })).rejects.toMatchObject({ status: 400 });
  await expect(of(ana).addIncome({ name: 'x', cents: 1, every: 'once' })).rejects.toMatchObject({ status: 400 });
  await expect(of(ana).addIncome({ name: 'x', cents: -1, every: 'monthly' })).rejects.toMatchObject({ status: 422 });
  await expect(of(ana).addIncome({ name: 'x', cents: 1, every: 'monthly', start_day: '2046-03-10', end_day: '2046-03-01' })).rejects.toMatchObject({ status: 400 });
  await of(ana).removeIncome(pay.id);
  expect((await of(ana).income()).length).toBe(1);
});

it('a savings goal says what is saved, what is left, and what a month takes', async () => {
  const trip = await of(ana).addGoal({ name: 'Trip', target_cents: 120000, by_day: '2046-08-31' }); // March to August: 6 months
  const cushion = await of(ana).addGoal({ name: 'Cushion', target_cents: 50000 });
  await of(ana).putAside(trip.id, { day: '2046-02-10', cents: 30000 });
  await of(ana).putAside(trip.id, { cents: 15000 });
  await of(ana).putAside(trip.id, { day: '2046-03-06', cents: -5000 });
  let goal = await of(ana).goal(trip.id);
  expect([goal.saved, goal.left, goal.per_month, goal.done, goal.late]).toEqual([40000, 80000, 13334, false, false]);
  expect(goal.puts.map((p) => [p.day, p.cents])).toEqual([['2046-03-06', -5000], ['2046-03-05', 15000], ['2046-02-10', 30000]]);
  expect((await of(ana).goals()).map((g) => g.name)).toEqual(['Trip', 'Cushion']); // the one with a day first
  expect((await of(ana).goal(cushion.id)).per_month).toBeNull();
  await of(ana).putAside(trip.id, { cents: 80000 });
  goal = await of(ana).goal(trip.id);
  expect([goal.saved, goal.left, goal.done, goal.per_month]).toEqual([120000, 0, true, null]);
  // A day that has passed with money still to go.
  const old = await of(ana).addGoal({ name: 'Old', target_cents: 1000, by_day: '2046-01-01' });
  expect(await of(ana).goal(old.id)).toMatchObject({ late: true, per_month: null, left: 1000 });
  // The last month counts: a goal due this month needs it all this month.
  const soon = await of(ana).addGoal({ name: 'Soon', target_cents: 9000, by_day: '2046-03-31' });
  expect((await of(ana).goal(soon.id)).per_month).toBe(9000);

  await expect(of(ana).putAside(cushion.id, { cents: -1 })).rejects.toMatchObject({ status: 422 });
  await expect(of(ana).putAside(cushion.id, { cents: 0 })).rejects.toMatchObject({ status: 422 });
  await expect(of(ana).addGoal({ name: 'Free', target_cents: 0 })).rejects.toMatchObject({ status: 422 });
  await expect(of(ben).goal(trip.id)).rejects.toMatchObject({ status: 404 });
  await expect(of(ben).putAside(trip.id, { cents: 100 })).rejects.toMatchObject({ status: 404 });
  expect(await of(ben).goals()).toEqual([]);
  const put = goal.puts[0]!;
  await expect(of(ben).removeSaved(put.id)).rejects.toMatchObject({ status: 404 });
  await of(ana).removeSaved(put.id);
  expect((await of(ana).goal(trip.id)).puts.length).toBe(goal.puts.length - 1);
  await of(ana).removeGoal(trip.id);
  expect((await db.get<{ n: number }>('SELECT COUNT(*) AS n FROM money_goal_saved WHERE goal_id = ?', [trip.id]))!.n).toBe(0);
});

it('lists the bill jobs from upkeep, and a bill added in the budget is one of those jobs', async () => {
  const jobs = upkeep(db, ana, clock);
  await jobs.create({ name: 'Rent', kind: 'bill', amount_cents: 120000, every_n: 1, every_unit: 'month', first_due: '2046-03-01' });
  await jobs.create({ name: 'Insurance', kind: 'bill', amount_cents: 60000, every_n: 6, every_unit: 'month', first_due: '2046-04-15' });
  await jobs.create({ name: 'Car tabs', kind: 'renewal', amount_cents: 9000, every_n: 1, every_unit: 'year', first_due: '2046-03-10' }); // a renewal is not a bill
  await jobs.create({ name: 'Furnace filter', every_n: 3, every_unit: 'month' });
  const made = await of(ana).addBill({ name: 'Phone', cents: 4500, every_n: 1, every_unit: 'month', first_due: '2046-03-20', autopay: true });
  expect((await jobs.get(made.id))).toMatchObject({ kind: 'bill', amount_cents: 4500, autopay: true });
  const bills = await of(ana).bills();
  expect(bills.map((b) => [b.name, b.cents, b.per_month]).sort((a, b) => String(a[0]).localeCompare(String(b[0])))).toEqual([['Insurance', 60000, 10000], ['Phone', 4500, 4500], ['Rent', 120000, 120000]]);
  await expect(of(ana).addBill({ name: '', cents: 100 })).rejects.toMatchObject({ status: 400 });
  await expect(of(ana).addBill({ name: 'Water', cents: 100, every_n: 2 })).rejects.toMatchObject({ status: 400 });
  expect((await of(ben).bills())).toEqual([]);
});

it('finds the days a bill is due, before and after its date', () => {
  expect(billDates({ n: 1, unit: 'month' }, '2046-03-31', '2046-02-01', '2046-02-28', '2000-01-01')).toEqual(['2046-02-28']);
  expect(billDates({ n: 2, unit: 'week' }, '2046-03-05', '2046-03-01', '2046-03-31', '2000-01-01')).toEqual(['2046-03-05', '2046-03-19']);
  expect(billDates({ n: 1, unit: 'week' }, '2046-03-05', '2046-03-01', '2046-03-31', '2046-03-10')).toEqual(['2046-03-12', '2046-03-19', '2046-03-26']);
  expect(billDates(null, '2046-03-05', '2046-03-01', '2046-03-31', '2000-01-01')).toEqual(['2046-03-05']);
  expect(billDates(null, '2046-04-05', '2046-03-01', '2046-03-31', '2000-01-01')).toEqual([]);
  expect(billDates({ n: 1, unit: 'month' }, null, '2046-03-01', '2046-03-31', '2000-01-01')).toEqual([]);
});

async function household() {
  const spend = money(db, ana, clock);
  const groceries = await spend.addCategory({ name: 'Groceries', monthly_cents: 60000 });
  const fun = await spend.addCategory({ name: 'Fun', monthly_cents: 10000 });
  const jobs = upkeep(db, ana, clock);
  await jobs.create({ name: 'Rent', kind: 'bill', amount_cents: 120000, every_n: 1, every_unit: 'month', first_due: '2046-03-01' });
  await jobs.create({ name: 'Insurance', kind: 'bill', amount_cents: 60000, every_n: 6, every_unit: 'month', first_due: '2046-03-15' });
  await of(ana).addIncome({ name: 'Paycheck', cents: 150000, every: 'biweekly', start_day: '2046-03-02' }); // 2, 16, 30 in March
  const trip = await of(ana).addGoal({ name: 'Trip', target_cents: 300000 });
  await of(ana).putAside(trip.id, { day: '2046-03-03', cents: 20000 });
  await of(ana).putAside(trip.id, { day: '2046-03-20', cents: 10000 });
  await of(ana).putAside(trip.id, { day: '2046-04-02', cents: 5000 });
  return { spend, groceries, fun, trip };
}

it('a month says what comes in, what is due, what is planned and saved, and what is left over', async () => {
  const { spend, groceries, fun } = await household();
  await spend.addEntry({ label: 'Market', cents: 8250, category_id: groceries.id });
  await spend.addEntry({ label: 'Cinema', cents: 12000, category_id: fun.id });
  await spend.addEntry({ label: 'Parking', cents: 500 });
  const march = await of(ana).month();
  expect(march.month).toBe('2046-03');
  expect(march.income).toMatchObject({ total: 450000, lines: [{ name: 'Paycheck', cents: 450000, every: 'biweekly' }] });
  expect(march.bills.lines.map((b) => [b.name, b.day, b.cents])).toEqual([['Rent', '2046-03-01', 120000], ['Insurance', '2046-03-15', 60000]]);
  expect(march.bills.total).toBe(180000);
  expect(march.planned).toMatchObject({ total: 70000, categories: [{ name: 'Groceries', cents: 60000, spent: 8250 }, { name: 'Fun', cents: 10000, spent: 12000 }] });
  expect([march.spent, march.spending]).toEqual([20750, 70000]);
  expect(march.saved).toMatchObject({ total: 30000, goals: [{ name: 'Trip', cents: 30000 }] });
  expect(march.left_over).toBe(450000 - 180000 - 70000 - 30000);
  // Insurance is every six months: not due in April, and rent is.
  const april = await of(ana).month('2046-04');
  expect(april.bills.lines.map((b) => b.name)).toEqual(['Rent']);
  expect(april.income.total).toBe(300000);
  expect(april.saved.total).toBe(5000);
  // Overspending counts for more than the plan.
  await spend.addEntry({ label: 'Big shop', cents: 70000, category_id: groceries.id });
  expect((await of(ana).month()).spending).toBe(90750);
  // The existing month view is as it was.
  expect((await spend.month()).total).toEqual({ planned: 70000, spent: 90750, left: -20750 });
});

it('paying a bill through spending does not count the bill twice', async () => {
  const jobs = upkeep(db, ana, clock);
  const rent = await jobs.create({ name: 'Rent', kind: 'bill', amount_cents: 120000, every_n: 1, every_unit: 'month', first_due: '2046-03-01' });
  await jobs.done(rent.id, { day: '2046-03-01', spend: {} });
  const spend = money(db, ana, clock);
  expect((await spend.month()).total.spent).toBe(120000); // spending shows it, as it always did
  const march = await of(ana).month();
  expect([march.bills.total, march.spent]).toEqual([120000, 0]);
  await spend.addEntry({ label: 'Coffee', cents: 400 });
  expect((await of(ana).month()).spent).toBe(400);
});

it('a year has twelve months side by side, and the totals', async () => {
  const { spend, groceries } = await household();
  await spend.addEntry({ label: 'Market', cents: 90000, category_id: groceries.id }); // over the plan in March
  const year = await of(ana).year();
  expect(year.year).toBe('2046');
  expect(year.months.map((m) => m.month)).toEqual(['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'].map((m) => `2046-${m}`));
  const [jan, march, april] = [year.months[0]!, year.months[2]!, year.months[3]!];
  // Bills only count from the month they were written down: nothing for January.
  expect([jan.income, jan.bills, jan.saved]).toEqual([0, 0, 0]);
  expect(march).toMatchObject({ income: 450000, bills: 180000, planned: 70000, spent: 90000, spending: 90000, saved: 30000, left: 450000 - 180000 - 90000 - 30000 });
  expect(april).toMatchObject({ income: 300000, bills: 120000, spent: 0, spending: 70000, saved: 5000 });
  const sum = (key: 'income' | 'bills' | 'saved' | 'left') => year.months.reduce((n, m) => n + m[key], 0);
  expect(year.totals).toMatchObject({ income: sum('income'), bills: sum('bills'), saved: sum('saved'), left: sum('left') });
  expect(year.totals.bills).toBe(120000 * 10 + 60000 * 2); // rent March to December; insurance in March and September
  // Another year, and nonsense for the year, which falls back to this one.
  expect((await of(ana).year('2047')).months.every((m) => m.saved === 0)).toBe(true);
  expect((await of(ana).year('x')).year).toBe('2046');
});

it('income, goals and bills are the person\'s own, while a shared category counts for both', async () => {
  const house = await money(db, ana, clock).addCategory({ name: 'House', monthly_cents: 50000, shared_with: [ben] });
  await money(db, ana, clock).addCategory({ name: 'Secret', monthly_cents: 99900 });
  await money(db, ana, clock).addEntry({ label: 'Paint', cents: 4000, category_id: house.id });
  await money(db, ben, clock).addEntry({ label: 'Brushes', cents: 1200, category_id: house.id });
  await of(ana).addIncome({ name: 'Pay', cents: 100000, every: 'monthly' });
  await of(ana).addGoal({ name: 'Gift', target_cents: 1000 });
  const bens = await of(ben).month();
  expect(bens.planned).toMatchObject({ total: 50000, categories: [{ name: 'House', cents: 50000, spent: 5200 }] });
  expect([bens.income.total, bens.saved.total, bens.spent]).toEqual([0, 0, 5200]);
  expect(JSON.stringify(bens)).not.toMatch(/Secret|Gift|Pay/);
  expect((await of(ana).month()).planned.total).toBe(149900);
  expect((await of(ben).year()).totals.planned).toBe(50000 * 12);
});

it('spending by tag, children included, for a month, a year and all time', async () => {
  const spend = money(db, ana, clock);
  const labels = tags(db, ana, clock);
  const kitchen = await labels.create('Kitchen');
  const appliances = await labels.create('Appliances', kitchen.id);
  const other = await labels.create('Trips');
  const a = await spend.addEntry({ label: 'Blender', cents: 8000 });
  const b = await spend.addEntry({ label: 'Pans', cents: 5000, day: '2046-01-10' });
  const c = await spend.addEntry({ label: 'Old mixer', cents: 3000, day: '2045-06-10' });
  const d = await spend.addEntry({ label: 'Train', cents: 2000 });
  const both = await spend.addEntry({ label: 'Toaster', cents: 1000 });
  await labels.set('spending', a.id, [appliances.id]);
  await labels.set('spending', b.id, [kitchen.id]);
  await labels.set('spending', c.id, [appliances.id]);
  await labels.set('spending', d.id, [other.id]);
  await labels.set('spending', both.id, [kitchen.id, appliances.id]); // under both: once
  const march = await of(ana).byTag('2046-03');
  expect(march.map((t) => [t.path, t.cents, t.count, t.depth])).toEqual([['Kitchen', 9000, 2, 0], ['Kitchen > Appliances', 9000, 2, 1], ['Trips', 2000, 1, 0]]);
  const year = await of(ana).byTag('2046');
  expect(year.find((t) => t.path === 'Kitchen')).toMatchObject({ cents: 14000, count: 3 });
  expect(year.find((t) => t.path === 'Kitchen > Appliances')).toMatchObject({ cents: 9000 });
  // The tag's own page.
  expect((await labels.page(kitchen.id)).spending).toEqual({ currency: '$', count: 4, month: 9000, year: 14000, all: 17000 });
  expect((await labels.page(appliances.id)).spending).toEqual({ currency: '$', count: 3, month: 9000, year: 9000, all: 12000 });
  expect((await labels.page(other.id)).spending).toEqual({ currency: '$', count: 1, month: 2000, year: 2000, all: 2000 });
  // Someone else's tags see none of it.
  expect(await of(ben).byTag('2046')).toEqual([]);
  expect((await of(ana).month()).by_tag.length).toBe(3);
  expect((await of(ana).year()).by_tag.find((t) => t.path === 'Trips')!.cents).toBe(2000);
});
