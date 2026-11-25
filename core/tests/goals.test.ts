/** Goals on plans: the safe number, a plan's spending counted once, the suggested month and catching up, hidden gifts, and the end-of-plan question. */
import { beforeEach, expect, it } from 'vitest';
import { budget } from '../src/budget.ts';
import type { Db } from '../src/db.ts';
import { goals } from '../src/goals.ts';
import { holidays } from '../src/holidays.ts';
import { migrate } from '../src/migrations.ts';
import { money } from '../src/money.ts';
import { plans } from '../src/plans.ts';
import { tags } from '../src/tags.ts';
import { upkeep } from '../src/upkeep.ts';
import { memoryDb } from './memoryDb.ts';

let db: Db;
let ana: number;
let ben: number;
let day = '2046-03-05';
const clock = Object.assign(() => new Date(`${day}T10:00:00`), { today: () => day });
const person = async (name: string) => (await db.run("INSERT INTO users (username, password_hash, created_at) VALUES (?, 'x', 'now')", [name])).lastId;
const b = (who = ana) => budget(db, who, clock);
const g = (who = ana) => goals(db, who, clock);
const saved = async (goalId: number) => (await db.get<{ n: number }>('SELECT COALESCE(SUM(cents), 0) AS n FROM money_goal_saved WHERE goal_id = ?', [goalId]))!.n;
const putCount = async () => (await db.get<{ n: number }>('SELECT COUNT(*) AS n FROM money_goal_saved'))!.n;

/** Ana earns $4,000 on the 1st, pays $1,200 rent on the 1st, and has a beach week in June. */
async function setUp() {
  await b().addIncome({ name: 'Paycheck', cents: 400000, every: 'monthly', start_day: '2046-01-01' });
  await upkeep(db, ana, clock).create({ name: 'Rent', kind: 'bill', amount_cents: 120000, every_n: 1, every_unit: 'month', first_due: '2046-03-01' });
  const plan = await plans(db, ana, clock).create({ name: 'Beach week', start_day: '2046-06-10', end_day: '2046-06-14' });
  const tag = await tags(db, ana, clock).create('Beach');
  await tags(db, ana, clock).set('plan', plan.id, [tag.id]);
  return { plan: plan.id, tag: tag.id };
}
const spendOn = async (label: string, cents: number, tag?: number, on = day) => {
  const made = await money(db, ana, clock).addEntry({ label, cents, day: on });
  if (tag !== undefined) await tags(db, ana, clock).set('spending', made.id, [tag]);
  return made.id;
};

beforeEach(async () => {
  db = memoryDb();
  await migrate(db);
  ana = await person('ana'); ben = await person('ben');
  day = '2046-03-05';
});

it('safe to spend is income, less bills, less what goals ask this month, less what was spent so far', async () => {
  const { plan } = await setUp();
  await g().start({ plan_id: plan, target_cents: 100000 }); // March to June is four months: $250 a month
  await spendOn('Groceries', 30000);
  const safe = (await b().month()).safe;
  expect(safe).toMatchObject({ income: 400000, bills: 120000, spent: 30000, goals: { total: 25000, lines: [{ name: 'Beach week', cents: 25000 }] } });
  expect(safe.safe).toBe(400000 - 120000 - 25000 - 30000);
  expect(safe.words).toBe('$2,250 safe to spend');
  expect((await b().safe()).safe).toBe(225000);
  // Setting the $250 aside does not make it safe again: the goal still asked for it.
  await b().putAside((await b().goals())[0]!.id, { cents: 25000 });
  expect((await b().safe()).safe).toBe(225000);
  // Over: spending more than there is.
  await spendOn('Big thing', 300000);
  expect(await b().safe()).toMatchObject({ safe: -75000, words: 'Over by $750' });
  // Nobody else's.
  expect(await b(ben).safe()).toMatchObject({ income: 0, bills: 0, spent: 0, safe: 0 });
});

it('spending tagged to a plan comes out of its goal and is not counted again in the month', async () => {
  const { plan, tag } = await setUp();
  const goal = await g().start({ plan_id: plan, target_cents: 100000 });
  const cat = await money(db, ana, clock).addCategory({ name: 'Fun', monthly_cents: 20000 });
  const own = await money(db, ana, clock).addEntry({ label: 'Cinema', cents: 3000, category_id: cat.id });
  void own;
  const swim = await spendOn('Beach umbrella', 8000, tag);
  await tags(db, ana, clock).set('spending', swim, [tag]);
  const month = await b().month();
  expect(month.spent).toBe(3000); // the umbrella is in the goal, not here
  expect(month.goals_spent).toBe(8000);
  expect(month.safe.spent).toBe(3000);
  expect((await b().goal(goal.id))).toMatchObject({ spent: 8000 });
  // The Money page's category and month amounts leave it out too.
  const spending = await money(db, ana, clock).month();
  expect(spending.total.spent).toBe(3000);
  expect(spending.categories[0]!.spent).toBe(3000);
  // A tagged entry made a year later is not this plan's.
  await spendOn('Next summer', 5000, tag, '2047-08-01');
  expect((await b().goal(goal.id)).spent).toBe(8000);
  // A tag inside the plan's tag counts too.
  const inner = await tags(db, ana, clock).create('Sunscreen', tag);
  await spendOn('Sunscreen', 1200, inner.id);
  expect((await b().goal(goal.id)).spent).toBe(9200);
  expect((await b().month()).spent).toBe(3000);
  // A year of months counts it once as well.
  expect((await b().year('2046')).months[2]!.spent).toBe(3000);
});

it('suggests an amount for each month, to check off, and raises it when behind', async () => {
  const { plan } = await setUp();
  const made = await g().start({ plan_id: plan, target_cents: 100000 });
  let goal = await b().goal(made.id);
  expect(goal).toMatchObject({ ask: 25000, set_aside: 0, checked: false, behind: 0, raised: false, even: 25000 });
  expect(goal.progress.words).toBe('$0 of $1,000, on track');
  // Setting it aside checks it off.
  await b().putAside(made.id, { cents: 25000 });
  goal = await b().goal(made.id);
  expect(goal).toMatchObject({ ask: 25000, set_aside: 25000, checked: true });
  // April, on track: the same again.
  day = '2046-04-05';
  goal = await b().goal(made.id);
  expect(goal).toMatchObject({ ask: 25000, checked: false, behind: 0, raised: false });
  expect(goal.progress).toMatchObject({ state: 'on_track', words: '$250 of $1,000, on track' });
  // May with April skipped: behind by one month's share, and the months left ask more, and say so.
  day = '2046-05-05';
  goal = await b().goal(made.id);
  expect(goal).toMatchObject({ behind: 25000, even: 25000, ask: 37500, raised: true }); // $750 over May and June
  expect(goal.progress).toMatchObject({ state: 'behind', words: '$250 of $1,000, behind by $250' });
  expect((await b().safe()).goals.lines).toEqual([{ id: made.id, name: 'Beach week', cents: 37500 }]);
  // Catching up all at once is done.
  await b().putAside(made.id, { cents: 75000 });
  goal = await b().goal(made.id);
  expect(goal.progress).toMatchObject({ state: 'done', words: '$1,000 of $1,000, done' });
  expect(goal).toMatchObject({ ask: 37500, set_aside: 75000, checked: true });
  expect((await b().safe()).goals.total).toBe(75000); // the money that went out counts, not only what was asked
  // A later month with the plan's day passed asks nothing more.
  day = '2046-06-20';
  expect((await b().goal(made.id)).ask).toBe(0); // the plan's day has passed
});

it('says over when more was spent than the goal, and money in whole cents', async () => {
  const { plan, tag } = await setUp();
  const made = await g().start({ plan_id: plan, target_cents: 40000 });
  await b().putAside(made.id, { cents: 12050 });
  await spendOn('Cabin', 41500, tag);
  expect((await b().goal(made.id)).progress).toMatchObject({ state: 'over', over: 1500, words: '$415 of $400, over by $15' });
  expect((await b().goal((await b().goals())[0]!.id)).saved).toBe(12050);
  await expect(g().start({ plan_id: plan, target_cents: 100 })).rejects.toMatchObject({ status: 409 }); // one goal for a plan
  await expect(b().addGoal({ name: 'Half', target_cents: 1050.5 })).rejects.toMatchObject({ status: 422 });
});

it('adds a plan up from what is known and what is typed, says what has no price, and keeps it to the owner', async () => {
  const { plan } = await setUp();
  const made = await g().start({ plan_id: plan, target_cents: 50000 });
  await g().addLine(made.id, { label: 'Cabin', cents: 30000 });
  await g().addLine(made.id, { label: 'Ferry', cents: null });
  await g().addLine(made.id, { label: 'Kayak rental' });
  const panel = await g().forPlan(plan);
  expect(panel.cost).toMatchObject({ total: 30000, unknown: 2, unknown_words: '2 things have no price yet' });
  expect(panel.cost.lines.map((l) => l.label)).toEqual(['Cabin', 'Ferry', 'Kayak rental']);
  await g().addLine(made.id, { label: 'Ferry back' });
  await g().removeLine(panel.cost.lines[1]!.line_id!);
  expect((await g().forPlan(plan)).cost.unknown_words).toBe('2 things have no price yet');
  await expect(g().addLine(made.id, { label: 'x', cents: -1 })).rejects.toMatchObject({ status: 422 });
  await expect(g(ben).addLine(made.id, { label: 'x', cents: 1 })).rejects.toMatchObject({ status: 404 });
  await expect(g(ben).forPlan(plan)).rejects.toMatchObject({ status: 404 });
  // The safe number is on the plan.
  expect(panel.safe.safe).toBe((await b().safe()).safe);
});

it('with no goal yet, says what one at the cost would do to the month', async () => {
  const { plan } = await setUp();
  const first = await g().forPlan(plan);
  expect(first.goal).toBeNull();
  expect(first.if_set).toBeNull(); // nothing is priced yet
  const year = await plans(db, ana, clock).get(plan);
  expect(year.name).toBe('Beach week');
  await expect(g().start({ plan_id: plan })).rejects.toMatchObject({ status: 422 }); // no cost known, no amount given
});

it('a gift hidden from someone is left out of the list and the total for that person only', async () => {
  const made = await holidays(db, ana, clock).create({ name: 'Midwinter', rule: { kind: 'fixed', month: 12, day: 20 } });
  const plan = made.years[0]!.plan_id;
  const hol = holidays(db, ana, clock);
  await hol.addGift(plan, { who: 'Maya', idea: 'A scarf' });
  await hol.addGift(plan, { for_user: ben, idea: 'A watch' });
  await hol.addGift(plan, { who: 'Sam', idea: 'Something small' });
  const gifts = (await hol.year(plan)).gifts;
  await hol.updateGift(gifts[0]!.id, { cents: 2500 });
  await hol.updateGift(gifts[1]!.id, { cents: 9000 });
  const goal = await g().start({ plan_id: plan, target_cents: 50000 });
  await g().addLine(goal.id, { label: 'Wrapping paper', cents: 1000 });
  await g().addLine(goal.id, { label: 'Surprise for Ben', cents: 5000, hidden_from: ben });
  const mine = await g(ana).forPlan(plan, ana);
  expect(mine.cost.total).toBe(2500 + 9000 + 1000 + 5000);
  expect(mine.cost.unknown_words).toBe('1 thing has no price yet');
  // What Ben sees of the same plan: no watch, no surprise, and a total without them.
  const his = await g(ana).forPlan(plan, ben);
  expect(his.cost.lines.map((l) => l.label)).toEqual(['Gift for Maya: A scarf', 'Gift for Sam: Something small', 'Wrapping paper']);
  expect(his.cost.total).toBe(2500 + 1000);
  expect(JSON.stringify(his)).not.toContain('watch');
  expect(JSON.stringify(his)).not.toContain('Surprise');
  // Once the day has passed it is no longer a surprise.
  day = '2046-12-21';
  expect((await g(ana).forPlan(plan, ben)).cost.lines.map((l) => l.label)).toContain('Gift for ben: A watch');
});

it('goals made before carry over unchanged in meaning', async () => {
  await setUp();
  // A row as the version before this one wrote it: no plan, never settled.
  const old = (await db.run("INSERT INTO money_goals (owner_id, name, target_cents, by_day, created_at) VALUES (?, 'Roof', 50000, '2046-09-30', '2046-01-10T10:00:00+00:00')", [ana])).lastId;
  await db.run("INSERT INTO money_goal_saved (goal_id, day, cents, created_at) VALUES (?, '2046-02-01', 10000, 'now')", [old]);
  const goal = await b().goal(old);
  expect(goal).toMatchObject({ name: 'Roof', target_cents: 50000, saved: 10000, left: 40000, done: false, late: false, per_month: 5715, plan_id: null, plan: null, project_id: null, spent: 0, question: null });
  const cushion = await b().addGoal({ name: 'Cushion', target_cents: 90000 });
  expect(await b().goal(cushion.id)).toMatchObject({ per_month: null, ask: 0, behind: 0, progress: { state: 'on_track', words: '$0 of $900, on track' } });
  // The month's "put into goals" is as it was.
  await b().putAside(old, { cents: 2000, day: '2046-03-02' });
  expect((await b().month()).saved).toMatchObject({ total: 2000, goals: [{ name: 'Roof', cents: 2000 }] });
});

it('when a plan is over it asks once where the leftover goes, and nothing moves until it is answered', async () => {
  const { plan, tag } = await setUp();
  const made = await g().start({ plan_id: plan, target_cents: 100000 });
  const other = await b().addGoal({ name: 'Cushion', target_cents: 500000 });
  await b().putAside(made.id, { cents: 60000, day: '2046-04-01' });
  await spendOn('Cabin', 45000, tag, '2046-06-01');
  expect((await b().goal(made.id)).question).toBeNull(); // not over yet
  day = '2046-06-20';
  const before = await putCount();
  const asked = (await b().goal(made.id)).question!;
  expect(asked).toMatchObject({ kind: 'leftover', cents: 15000, words: 'Beach week is over. $150 is left in its goal. Where should it go?' });
  await b().month(); await b().goals(); await g().forPlan(plan);
  expect(await putCount()).toBe(before); // asking moved nothing
  expect(await saved(made.id)).toBe(60000);
  // Moving it to another goal.
  await expect(b().settleGoal(made.id, { action: 'move' })).rejects.toMatchObject({ status: 400 });
  expect(await saved(made.id)).toBe(60000);
  await b().settleGoal(made.id, { action: 'move', to_goal_id: other.id });
  expect(await saved(made.id)).toBe(45000);
  expect(await saved(other.id)).toBe(15000);
  const answered = await b().goal(made.id);
  expect(answered.question).toBeNull();
  expect(answered.settled_on).toBe('2046-06-20');
  await expect(b().settleGoal(made.id, { action: 'leave' })).rejects.toMatchObject({ status: 409 }); // asked once
});

it('asks what covers a shortfall, and "leave it" moves nothing', async () => {
  const { plan, tag } = await setUp();
  const made = await g().start({ plan_id: plan, target_cents: 100000 });
  const cushion = await b().addGoal({ name: 'Cushion', target_cents: 500000 });
  await b().putAside(cushion.id, { cents: 100000 });
  await b().putAside(made.id, { cents: 20000, day: '2046-04-01' });
  await spendOn('Cabin', 50000, tag, '2046-06-01');
  day = '2046-06-20';
  expect((await b().goal(made.id)).question).toMatchObject({ kind: 'short', cents: 30000 });
  await b().settleGoal(made.id, { action: 'cover', from_goal_id: cushion.id });
  expect([await saved(made.id), await saved(cushion.id)]).toEqual([50000, 70000]);
  // The other answer: leave it to the month, and nothing moves.
  const second = await plans(db, ana, clock).create({ name: 'Lake day', start_day: '2046-06-01', end_day: '2046-06-01' });
  const lake = await g().start({ plan_id: second.id, target_cents: 10000 });
  await tags(db, ana, clock).set('plan', second.id, [tag]);
  await b().putAside(lake.id, { cents: 1000, day: '2046-05-01' });
  const counted = await putCount();
  await b().settleGoal(lake.id, { action: 'leave' });
  expect(await putCount()).toBe(counted);
  expect((await b().goal(lake.id)).question).toBeNull();
});

it('a goal stays when its plan is removed, and belongs to nothing', async () => {
  const { plan } = await setUp();
  const made = await g().start({ plan_id: plan, target_cents: 10000 });
  await b().putAside(made.id, { cents: 3000 });
  await plans(db, ana, clock).remove(plan);
  expect(await b().goal(made.id)).toMatchObject({ plan_id: null, plan: null, saved: 3000 });
});
