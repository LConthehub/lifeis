/**
 * Life is budgeted: what comes in, the bills that go out, what is planned and spent, and what is put aside.
 *
 * Income (a paycheck, a pension, a gift on one date) has an amount and how often it comes, and is shown as an
 * amount for a month. A savings goal has a target, perhaps a day to reach it, and the money put toward it, each
 * with a day (taking money out is a negative amount). Both are the person's own: nobody else sees them.
 *
 * Bills are NOT kept here. They are upkeep jobs of kind "bill" (core/src/upkeep.ts), with a cost and how often
 * they come round. The budget reads them, and adding a bill from here makes one of those jobs. Marking a bill
 * paid is upkeep's; when that put the cost into spending, the budget leaves that entry out of "spent", because
 * the bill is already counted as a bill.
 *
 * What a month leaves over: income, less the bills due that month, less spending (for this month and months
 * to come, the larger of what was planned in the categories and what was spent; for a month gone by, what was
 * spent), less what was put into goals. Categories and what was spent in
 * them follow the same sharing as in money.ts: a shared category counts for everyone it is shared with.
 *
 * A goal can belong to a plan (a holiday's or trip's year is a plan), to a project, or to nothing. Spending tagged to a
 * plan comes out of its own goal and is left out of the month's spending, so it is counted once. What a month asks
 * of a goal is shown beside it, to check off when set aside; a goal that has fallen behind asks more of the months
 * left, and says so. "Safe to spend" is the month's income, less bills, less what goals ask this month, less what
 * was spent so far.
 *
 * Money is whole cents. An amount "per month" is rounded to the nearest cent.
 */
import { atomic, type Db, type Queries } from './db.ts';
import { Problem } from './problem.ts';
import { goalEntryIds, fmt, monthlyAsk, pace, planSpending, progressOf, type Progress } from './goalFigures.ts';
import { spendingByTag, span, type TagSpend } from './tags.ts';
import { upkeep, addInterval, type Job } from './upkeep.ts';
import { clean, dayNumber, dayOrNull, stamp, todayOf, type Clock } from './small.ts';

export const INCOME_EVERY = ['weekly', 'biweekly', 'twice_monthly', 'monthly', 'yearly', 'once'] as const;
export type IncomeEvery = (typeof INCOME_EVERY)[number];
export type IncomeInput = { name?: string | null; cents?: number | null; every?: string | null; start_day?: string | null; end_day?: string | null };
export type IncomeLine = { id: number; name: string; cents: number; every: IncomeEvery; start_day: string | null; end_day: string | null; per_month: number };
export type GoalInput = { name?: string | null; target_cents?: number | null; by_day?: string | null; /** A project this is saved up for. Left out: unchanged. */ project_id?: number | null; /** A plan this is for (only when making a goal). */ plan_id?: number | null };
export type Saved = { id: number; day: string; cents: number };
/** Asked once when what a goal was for is over: where the leftover goes, or what covers a shortfall. Nothing moves until it is answered. */
export type GoalQuestion = { kind: 'leftover' | 'short'; cents: number; words: string };
export type Goal = {
  id: number; name: string; target_cents: number; by_day: string | null;
  /** The project it is saved up for, when it is. */
  project_id: number | null; project: string | null;
  /** The plan (a holiday's or trip's year too) it is for, when it is. */
  plan_id: number | null; plan: string | null;
  /** What has been spent against it (spending tagged to its plan). */
  spent: number;
  /** What it asks of this month, how much was put toward it this month, and whether that covers the ask (to check off). */
  ask: number; set_aside: number; checked: boolean;
  /** The even share a month if it had never fallen behind, how far behind it is now, and whether that raised this month's ask. */
  even: number | null; behind: number; raised: boolean;
  progress: Progress;
  question: GoalQuestion | null; settled_on: string | null;
  saved: number; left: number; done: boolean;
  /** What it takes each month from now to the day, when there is a day. Null with no day, or once it has passed. */
  per_month: number | null;
  /** The day has passed and it is not reached. */
  late: boolean;
  puts: Saved[];
};
export type BillLine = { job_id: number; name: string; cents: number; every: { n: number; unit: string } | null; per_month: number; next_day: string | null; autopay: boolean; needs_date: boolean };
export type BillInput = { name?: string | null; cents?: number | null; every_n?: number | null; every_unit?: string | null; first_due?: string | null; autopay?: boolean };
/** The month's income, less bills, less what goals ask this month, less what was spent so far. Spending counted against a plan's goal is not counted again. */
export type Safe = {
  month: string; currency: string; income: number; bills: number;
  goals: { total: number; lines: { id: number; name: string; cents: number }[] };
  spent: number; safe: number; words: string;
};
export type Budget = {
  month: string;
  currency: string;
  income: { total: number; lines: { id: number; name: string; cents: number; every: IncomeEvery }[] };
  bills: { total: number; lines: { job_id: number; name: string; day: string; cents: number; autopay: boolean }[]; unscheduled: { job_id: number; name: string }[] };
  planned: { total: number; categories: { id: number; name: string; cents: number; spent: number }[] };
  /** What was spent this month (bills paid through spending and nothing else left out), projects included. */
  spent: number;
  /** Of what was spent, what went on projects (entries tagged with a project), and what is planned on them and not yet paid ("coming", not counted). */
  projects: { spent: number; coming: number };
  /** What the month is counted as spending: the larger of planned and spent, or only what was spent once the month is past. */
  spending: number;
  /** The month is before this one. */
  past: boolean;
  saved: { total: number; goals: { id: number; name: string; cents: number }[] };
  left_over: number;
  /** Spending counted against plans' goals this month: in the goals, not in "spent". */
  goals_spent: number;
  safe: Safe;
  by_tag: TagSpend[];
};
export type YearMonth = { month: string; income: number; bills: number; planned: number; spent: number; /** Of spent: what went on projects. */ projects: number; /** Planned on projects, not yet paid. */ coming: number; spending: number; saved: number; left: number };
export type Year = {
  year: string; currency: string; months: YearMonth[];
  totals: { income: number; bills: number; planned: number; spent: number; projects: number; coming: number; spending: number; saved: number; left: number };
  by_tag: TagSpend[];
};

const MOST = 100_000_000_00;
const MONTH_DAYS = 365.25 / 12;
/** How many times a month each way of coming in happens, on average. */
const TIMES: Record<IncomeEvery, number> = { weekly: 52 / 12, biweekly: 26 / 12, twice_monthly: 2, monthly: 1, yearly: 1 / 12, once: 0 };
const pad = (n: number) => String(n).padStart(2, '0');
const lastOf = (month: string) => `${month}-${pad(new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate())}`;
/** A day-of-month put into a month, the 31st of a short month being its last day. */
const dayIn = (month: string, dom: number) => { const last = lastOf(month); return `${month}-${pad(Math.min(dom, Number(last.slice(8))))}`; };
const monthsOf = (year: string) => Array.from({ length: 12 }, (_, i) => `${year}-${pad(i + 1)}`);

export const perMonth = (cents: number, every: IncomeEvery): number => Math.round(cents * TIMES[every]);

/** What a bill that comes round every `n` days, weeks, months or years comes to for a month, on average. */
export function billPerMonth(cents: number, every: { n: number; unit: string } | null): number {
  if (!every) return 0;
  const months = every.n * ({ day: 1 / MONTH_DAYS, week: 7 / MONTH_DAYS, month: 1, year: 12 } as Record<string, number>)[every.unit]!;
  return Math.round(cents / months);
}

/**
 * What came in during one month ("2046-03") from one income. Weekly and every-two-weeks count real paydays when
 * there is a start day to count from, and the average month when there is not. A start or end day bounds it.
 */
export function incomeIn(i: Pick<IncomeLine, 'cents' | 'every' | 'start_day' | 'end_day'>, month: string): number {
  const first = `${month}-01`;
  const last = lastOf(month);
  if ((i.end_day && i.end_day < first) || (i.start_day && i.start_day > last)) return 0;
  const lo = i.start_day && i.start_day > first ? i.start_day : first;
  const hi = i.end_day && i.end_day < last ? i.end_day : last;
  const within = (day: string) => day >= lo && day <= hi;
  switch (i.every) {
    case 'once': return i.start_day && i.start_day.slice(0, 7) === month ? i.cents : 0;
    case 'weekly': case 'biweekly': {
      if (!i.start_day) return perMonth(i.cents, i.every);
      const step = i.every === 'weekly' ? 7 : 14;
      const from = dayNumber(i.start_day);
      const count = Math.floor((dayNumber(hi) - from) / step) - Math.ceil((dayNumber(lo) - from) / step) + 1;
      return Math.max(0, count) * i.cents;
    }
    case 'twice_monthly': return ([`${month}-01`, `${month}-15`].filter(within).length) * i.cents;
    case 'monthly': return within(dayIn(month, i.start_day ? Number(i.start_day.slice(8)) : 1)) ? i.cents : 0;
    case 'yearly':
      if (!i.start_day) return perMonth(i.cents, 'yearly');
      return Number(month.slice(5)) === Number(i.start_day.slice(5, 7)) && within(dayIn(month, Number(i.start_day.slice(8)))) ? i.cents : 0;
  }
}

/** The days a bill is due between two days (included): its date, and every round of it before and after. */
export function billDates(every: { n: number; unit: string } | null, anchor: string | null, from: string, to: string, floor: string): string[] {
  if (!anchor) return [];
  const lowest = from > floor ? from : floor;
  if (!every) return anchor >= lowest && anchor <= to ? [anchor] : [];
  const unit = every.unit as 'day' | 'week' | 'month' | 'year';
  const out: string[] = [];
  for (let k = 0, guard = 0; guard < 5000; k += 1, guard += 1) {
    const day = addInterval(anchor, k * every.n, unit);
    if (day > to) break;
    if (day >= lowest) out.push(day);
  }
  for (let k = -1, guard = 0; guard < 5000; k -= 1, guard += 1) {
    const day = addInterval(anchor, k * every.n, unit);
    if (day < lowest) break;
    if (day <= to) out.unshift(day);
  }
  return out;
}

function cents(value: number | null | undefined, what: string, allowNegative = false): number {
  if (value === null || value === undefined || !Number.isFinite(value) || !Number.isInteger(value) || (!allowNegative && value < 0) || Math.abs(value) > MOST) {
    throw new Problem(422, `${what} should be an amount of money${allowNegative ? '' : ', not below zero'}`);
  }
  return value;
}

export function budget(db: Db, owner: number, clock: Clock = () => new Date()) {
  const now = () => stamp(clock());
  const today = () => todayOf(clock);

  // Plain `?` marks only: the person twice, as in money.ts.
  const SEEN = 'SELECT c.id FROM money_categories c WHERE c.owner_id = ? OR EXISTS (SELECT 1 FROM money_shares s WHERE s.category_id = c.id AND s.user_id = ?)';
  /** Entries paid through a bill are the bill's, not spending. */
  const BILL_PAID = "SELECT d.money_entry_id FROM upkeep_done d JOIN upkeep_jobs j ON j.id = d.job_id WHERE j.kind = 'bill' AND d.money_entry_id IS NOT NULL";

  async function currency(): Promise<string> {
    return (await db.get<{ value: string | null }>("SELECT value FROM user_settings WHERE user_id = ? AND key = 'shopping_currency'", [owner]))?.value ?? '$';
  }

  // ---------- income ----------
  const lineOf = (r: { id: number; name: string; cents: number; every: IncomeEvery; start_day: string | null; end_day: string | null }): IncomeLine => ({ ...r, per_month: perMonth(r.cents, r.every) });
  async function incomes(q: Queries): Promise<IncomeLine[]> {
    return (await q.all<Omit<IncomeLine, 'per_month'>>('SELECT id, name, cents, every, start_day, end_day FROM money_income WHERE owner_id = ? ORDER BY name COLLATE NOCASE, id', [owner])).map(lineOf);
  }
  function checkedIncome(input: IncomeInput) {
    const name = clean(input.name, 80);
    if (!name) throw new Problem(400, 'Say what it is: a paycheck, a pension, a gift');
    const every = input.every as IncomeEvery;
    if (!INCOME_EVERY.includes(every)) throw new Problem(400, 'Say how often it comes: every week, every two weeks, twice a month, every month, every year, or one time');
    const start = dayOrNull(input.start_day);
    const end = dayOrNull(input.end_day);
    if (every === 'once' && !start) throw new Problem(400, 'Pick the day a one-time amount comes in');
    if (start && end && end < start) throw new Problem(400, 'The last day is before the first day');
    return { name, every, cents: cents(input.cents, 'The amount'), start, end: every === 'once' ? null : end };
  }
  async function ownIncome(q: Queries, id: number) {
    if (!(await q.get('SELECT id FROM money_income WHERE id = ? AND owner_id = ?', [id, owner]))) throw new Problem(404, 'Not found');
  }

  // ---------- goals ----------
  async function goalList(q: Queries, only?: number): Promise<Goal[]> {
    const rows = await q.all<{ id: number; name: string; target_cents: number; by_day: string | null; project_id: number | null; project: string | null; project_status: string | null; plan_id: number | null; plan_name: string | null; plan_end: string | null; settled_on: string | null; created_at: string }>(
      `SELECT g.id, g.name, g.target_cents, g.by_day, g.project_id, p.name AS project, p.status AS project_status, g.plan_id, pl.name AS plan_name, pl.end_day AS plan_end, g.settled_on, g.created_at
       FROM money_goals g LEFT JOIN projects p ON p.id = g.project_id AND p.owner_id = g.owner_id LEFT JOIN plans pl ON pl.id = g.plan_id AND pl.owner_id = g.owner_id
       WHERE g.owner_id = ? ${only !== undefined ? 'AND g.id = ?' : ''} ORDER BY g.by_day IS NULL, g.by_day, g.name COLLATE NOCASE, g.id`, only !== undefined ? [owner, only] : [owner]);
    const puts = await q.all<Saved & { goal_id: number }>(
      'SELECT s.id, s.goal_id, s.day, s.cents FROM money_goal_saved s JOIN money_goals g ON g.id = s.goal_id WHERE g.owner_id = ? ORDER BY s.day DESC, s.id DESC', [owner]);
    const here = today();
    const thisMonth = here.slice(0, 7);
    const sign = await currency();
    const spends = await planSpending(q, owner);
    return rows.map((g) => {
      const mine = puts.filter((p) => p.goal_id === g.id).map(({ id, day, cents: c }) => ({ id, day, cents: c }));
      const saved = mine.reduce((n, p) => n + p.cents, 0);
      const left = Math.max(0, g.target_cents - saved);
      const late = g.by_day !== null && g.by_day < here && left > 0;
      const savedBefore = mine.filter((p) => p.day < `${thisMonth}-01`).reduce((n, p) => n + p.cents, 0);
      const setAside = mine.filter((p) => p.day >= `${thisMonth}-01` && p.day <= lastOf(thisMonth)).reduce((n, p) => n + p.cents, 0);
      const ask = monthlyAsk(g.target_cents, savedBefore, g.by_day, thisMonth, late);
      const { even, behind: slip } = pace(g.target_cents, g.by_day, g.created_at.slice(0, 7), thisMonth, savedBefore);
      const behind = left > 0 && !late ? slip : 0;
      const spent = (spends.get(g.id) ?? []).reduce((n, e) => n + e.cents, 0);
      const rest = saved - spent;
      const ended = (g.plan_id !== null && g.plan_end !== null && g.plan_end < here) || (g.project_id !== null && (g.project_status === 'done' || g.project_status === 'dropped'));
      const what = g.plan_name ?? g.project ?? g.name;
      const question: GoalQuestion | null = ended && g.settled_on === null && rest !== 0
        ? (rest > 0
          ? { kind: 'leftover', cents: rest, words: `${what} is over. ${fmt(sign, rest)} is left in its goal. Where should it go?` }
          : { kind: 'short', cents: -rest, words: `${what} is over, and ${fmt(sign, -rest)} more was spent than was set aside. What should cover it?` })
        : null;
      let per: number | null = null;
      if (g.by_day !== null && left > 0 && !late) {
        // Months from this one to the day's, counting this one; the day's own month is the last to put something in.
        const months = Math.max(1, (Number(g.by_day.slice(0, 4)) - Number(here.slice(0, 4))) * 12 + Number(g.by_day.slice(5, 7)) - Number(here.slice(5, 7)) + 1);
        per = Math.ceil(left / months);
      }
      return {
        id: g.id, name: g.name, target_cents: g.target_cents, by_day: g.by_day, project_id: g.project_id, project: g.project, plan_id: g.plan_id, plan: g.plan_name, spent,
        ask, set_aside: setAside, checked: ask > 0 && setAside >= ask, even, behind, raised: even !== null && behind > 0 && ask > even,
        progress: progressOf(sign, { target: g.target_cents, put: saved, spent, behind }), question, settled_on: g.settled_on,
        saved, left, done: left === 0, per_month: per, late, puts: mine,
      };
    });
  }
  async function ownGoal(q: Queries, id: number) {
    if (!(await q.get('SELECT id FROM money_goals WHERE id = ? AND owner_id = ?', [id, owner]))) throw new Problem(404, 'Not found');
  }
  function checkedGoal(input: GoalInput) {
    const name = clean(input.name, 80);
    if (!name) throw new Problem(400, 'Give the goal a name');
    const target = cents(input.target_cents, 'The target');
    if (target <= 0) throw new Problem(422, 'The target should be more than zero');
    return { name, target, by: dayOrNull(input.by_day) };
  }
  /** A plan of the person's own, or null for none. One plan has one goal. */
  async function ownPlan(q: Queries, id: number | null | undefined): Promise<number | null> {
    if (id === null || id === undefined) return null;
    if (!(await q.get('SELECT id FROM plans WHERE id = ? AND owner_id = ?', [id, owner]))) throw new Problem(404, 'Not found');
    if (await q.get('SELECT id FROM money_goals WHERE plan_id = ? AND owner_id = ?', [id, owner])) throw new Problem(409, 'That plan already has a goal');
    return id;
  }
  /** Put money in or out of a goal. Taking out more than is in it is refused. */
  async function putIn(tx: Queries, id: number, amount: number, day: string | null | undefined) {
    await ownGoal(tx, id);
    const have = (await tx.get<{ n: number }>('SELECT COALESCE(SUM(cents), 0) AS n FROM money_goal_saved WHERE goal_id = ?', [id]))!.n;
    if (have + amount < 0) throw new Problem(422, "There isn't that much in it to take out");
    return { id: (await tx.run('INSERT INTO money_goal_saved (goal_id, day, cents, created_at) VALUES (?, ?, ?, ?)', [id, dayOrNull(day) ?? today(), amount, now()])).lastId };
  }
  /** A project of the person's own, or null for none. */
  async function ownProject(q: Queries, id: number | null | undefined): Promise<number | null> {
    if (id === null || id === undefined) return null;
    if (!(await q.get('SELECT id FROM projects WHERE id = ? AND owner_id = ?', [id, owner]))) throw new Problem(404, 'Not found');
    return id;
  }

  // ---------- bills, read from upkeep ----------
  type BillJob = { job: Job; floor: string };
  async function billJobs(): Promise<BillJob[]> {
    const jobs = (await upkeep(db, owner, clock).list()).filter((j) => j.kind === 'bill');
    if (jobs.length === 0) return [];
    const made = new Map((await db.all<{ id: number; created_at: string }>(`SELECT id, created_at FROM upkeep_jobs WHERE id IN (${jobs.map(() => '?').join(',')})`, jobs.map((j) => j.id))).map((r) => [r.id, r.created_at]));
    // A bill is counted from the month it was written down: Life Is does not guess what came before.
    return jobs.map((job) => ({ job, floor: `${(made.get(job.id) ?? today()).slice(0, 7)}-01` }));
  }
  const dueOf = (b: BillJob, from: string, to: string) => billDates(b.job.every, b.job.due.next_day, from, to, b.floor);

  // ---------- one period's figures ----------
  async function categories(): Promise<{ id: number; name: string; monthly_cents: number }[]> {
    return db.all<{ id: number; name: string; monthly_cents: number }>(`SELECT c.id, c.name, c.monthly_cents FROM money_categories c WHERE c.id IN (${SEEN}) ORDER BY c.sort_order, c.id`, [owner, owner]);
  }
  /** What was spent, by month, in a stretch of days: entries in categories seen and the person's own in none. What was paid on a project is an entry too. */
  const notIn = (ids: Set<number>, column: string) => (ids.size > 0 ? ` AND ${column} NOT IN (${[...ids].map(() => '?').join(',')})` : '');
  async function spentByMonth(from: string, to: string): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    const goalIds = await goalEntryIds(db, owner);
    const add = (rows: { m: string; n: number }[]) => { for (const r of rows) out.set(r.m, (out.get(r.m) ?? 0) + r.n); };
    add(await db.all<{ m: string; n: number }>(
      `SELECT SUBSTR(e.day, 1, 7) AS m, SUM(e.cents) AS n FROM money_entries e
       WHERE e.day BETWEEN ? AND ? AND ((e.category_id IS NULL AND e.owner_id = ?) OR e.category_id IN (${SEEN})) AND e.id NOT IN (${BILL_PAID})${notIn(goalIds, 'e.id')} GROUP BY m`, [from, to, owner, owner, owner, ...goalIds]));
    return out;
  }
  /** Of what was spent, by month, what went on projects. */
  async function onProjectsByMonth(from: string, to: string): Promise<Map<string, number>> {
    const rows = await db.all<{ m: string; n: number }>(
      'SELECT SUBSTR(e.day, 1, 7) AS m, SUM(e.cents) AS n FROM money_entries e WHERE e.owner_id = ? AND e.project_id IS NOT NULL AND e.day BETWEEN ? AND ? GROUP BY m', [owner, from, to]);
    return new Map(rows.map((r) => [r.m, r.n]));
  }
  /**
   * What is planned on projects and not yet paid, by the month each project is due. A project with no day is counted
   * in this month, and one whose day has passed too: it is still to be paid. Only projects still going.
   */
  async function comingByMonth(): Promise<Map<string, number>> {
    const here = today().slice(0, 7);
    const out = new Map<string, number>();
    for (const r of await db.all<{ due_on: string | null; n: number }>(
      `SELECT p.due_on, SUM(k.planned_cents) AS n FROM project_costs k JOIN projects p ON p.id = k.project_id
       WHERE p.owner_id = ? AND k.paid_on IS NULL AND k.planned_cents > 0 AND p.status NOT IN ('done', 'dropped') GROUP BY p.due_on`, [owner])) {
      const month = r.due_on && r.due_on.slice(0, 7) > here ? r.due_on.slice(0, 7) : here;
      out.set(month, (out.get(month) ?? 0) + r.n);
    }
    return out;
  }
  async function savedByGoal(from: string, to: string): Promise<{ id: number; name: string; cents: number; month: string }[]> {
    return db.all<{ id: number; name: string; cents: number; month: string }>(
      `SELECT g.id, g.name, SUM(s.cents) AS cents, SUBSTR(s.day, 1, 7) AS month FROM money_goal_saved s JOIN money_goals g ON g.id = s.goal_id
       WHERE g.owner_id = ? AND s.day BETWEEN ? AND ? GROUP BY g.id, month ORDER BY g.name COLLATE NOCASE`, [owner, from, to]);
  }

  /** What the goals ask of a month: for this month or one to come, each goal's share; for a month gone by, what was put toward them. */
  async function goalAsks(month: string): Promise<Safe['goals']> {
    const here = today().slice(0, 7);
    const lines: Safe['goals']['lines'] = [];
    for (const g of await goalList(db)) {
      // This month: what was asked, or more when more was already put by (that money has gone out of the month either way).
      const cents = month < here
        ? g.puts.filter((p) => p.day.slice(0, 7) === month).reduce((n, p) => n + p.cents, 0)
        : month === here ? Math.max(g.ask, g.set_aside)
        : monthlyAsk(g.target_cents, g.puts.filter((p) => p.day < `${month}-01`).reduce((n, p) => n + p.cents, 0), g.by_day, month, g.late);
      if (cents !== 0) lines.push({ id: g.id, name: g.name, cents });
    }
    return { total: lines.reduce((n, l) => n + l.cents, 0), lines };
  }
  async function safeOf(month: string, income: number, bills: number, spent: number): Promise<Safe> {
    const sign = await currency();
    const goals = await goalAsks(month);
    const safe = income - bills - goals.total - spent;
    return { month, currency: sign, income, bills, goals, spent, safe, words: safe < 0 ? `Over by ${fmt(sign, -safe)}` : `${fmt(sign, safe)} safe to spend` };
  }

  return {
    // ----- income -----
    income: () => incomes(db),
    async addIncome(input: IncomeInput): Promise<{ id: number }> {
      const c = checkedIncome(input);
      const made = await db.run('INSERT INTO money_income (owner_id, name, cents, every, start_day, end_day, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [owner, c.name, c.cents, c.every, c.start, c.end, now()]);
      return { id: made.lastId };
    },
    async updateIncome(id: number, input: IncomeInput): Promise<void> {
      const c = checkedIncome(input);
      await atomic(db, async (tx) => {
        await ownIncome(tx, id);
        await tx.run('UPDATE money_income SET name = ?, cents = ?, every = ?, start_day = ?, end_day = ? WHERE id = ?', [c.name, c.cents, c.every, c.start, c.end, id]);
      });
    },
    async removeIncome(id: number): Promise<void> {
      await ownIncome(db, id);
      await db.run('DELETE FROM money_income WHERE id = ?', [id]);
    },

    // ----- goals -----
    goals: () => goalList(db),
    async goal(id: number): Promise<Goal> {
      await ownGoal(db, id);
      return (await goalList(db, id))[0]!;
    },
    async addGoal(input: GoalInput): Promise<{ id: number }> {
      const g = checkedGoal(input);
      const project = await ownProject(db, input.project_id);
      const plan = await ownPlan(db, input.plan_id);
      return { id: (await db.run('INSERT INTO money_goals (owner_id, name, target_cents, by_day, project_id, plan_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [owner, g.name, g.target, g.by, project, plan, now()])).lastId };
    },
    async updateGoal(id: number, input: GoalInput): Promise<void> {
      const g = checkedGoal(input);
      await ownGoal(db, id);
      await db.run('UPDATE money_goals SET name = ?, target_cents = ?, by_day = ? WHERE id = ?', [g.name, g.target, g.by, id]);
      if (input.project_id !== undefined) await db.run('UPDATE money_goals SET project_id = ? WHERE id = ?', [await ownProject(db, input.project_id), id]);
    },
    /** Removing a goal removes what was put toward it from the record. Nothing is spent by it. */
    async removeGoal(id: number): Promise<void> {
      await ownGoal(db, id);
      await db.run('DELETE FROM money_goals WHERE id = ?', [id]);
    },
    /** Put money toward a goal, or take some out (a negative amount). Taking out more than is in it is refused. */
    async putAside(id: number, input: { day?: string | null; cents?: number | null }): Promise<{ id: number }> {
      const amount = cents(input.cents, 'The amount', true);
      if (amount === 0) throw new Problem(422, 'The amount should not be zero');
      return atomic(db, (tx) => putIn(tx, id, amount, input.day));
    },
    /**
     * Answer the question asked once when a plan or project is over. Nothing moves until this is called. A leftover can be
     * given back to the month ("return"), moved to another goal ("move", with `to_goal_id`), or left where it is ("leave").
     * A shortfall can be covered from another goal ("cover", with `from_goal_id`) or left to the month ("leave").
     */
    async settleGoal(id: number, input: { action?: string | null; to_goal_id?: number | null; from_goal_id?: number | null }): Promise<void> {
      await ownGoal(db, id);
      const goal = (await goalList(db, id))[0]!;
      const q = goal.question;
      if (!q) throw new Problem(409, 'Nothing is waiting to be answered for that goal');
      const other = input.action === 'move' ? input.to_goal_id : input.action === 'cover' ? input.from_goal_id : null;
      await atomic(db, async (tx) => {
        if (q.kind === 'leftover' && input.action === 'return') await putIn(tx, id, -q.cents, null);
        else if (q.kind === 'leftover' && input.action === 'move') {
          if (!other || other === id) throw new Problem(400, 'Pick the goal it should go to');
          await ownGoal(tx, other);
          await putIn(tx, id, -q.cents, null);
          await putIn(tx, other, q.cents, null);
        } else if (q.kind === 'short' && input.action === 'cover') {
          if (!other || other === id) throw new Problem(400, 'Pick the goal that should cover it');
          await ownGoal(tx, other);
          await putIn(tx, other, -q.cents, null);
          await putIn(tx, id, q.cents, null);
        } else if (input.action !== 'leave') throw new Problem(400, 'Choose what to do with it');
        await tx.run('UPDATE money_goals SET settled_on = ? WHERE id = ?', [today(), id]);
      });
    },
    async removeSaved(savedId: number): Promise<void> {
      const row = await db.get<{ goal_id: number }>('SELECT s.goal_id FROM money_goal_saved s JOIN money_goals g ON g.id = s.goal_id WHERE s.id = ? AND g.owner_id = ?', [savedId, owner]);
      if (!row) throw new Problem(404, 'Not found');
      await db.run('DELETE FROM money_goal_saved WHERE id = ?', [savedId]);
    },

    // ----- bills -----
    /** Every bill job, with what it comes to for a month. The jobs stay upkeep's: change one there. */
    async bills(): Promise<BillLine[]> {
      return (await billJobs()).map(({ job }) => ({
        job_id: job.id, name: job.name, cents: job.amount_cents ?? 0, every: job.every, per_month: job.amount_cents ? billPerMonth(job.amount_cents, job.every) : 0,
        next_day: job.due.next_day, autopay: job.autopay, needs_date: job.due.needs_date === true,
      }));
    },
    /** Add a bill: an upkeep job of kind "bill". */
    async addBill(input: BillInput): Promise<{ id: number }> {
      const amount = cents(input.cents, 'The amount');
      const job = await upkeep(db, owner, clock).create({
        name: input.name ?? '', kind: 'bill', amount_cents: amount, activity: 'Home', autopay: input.autopay === true,
        every_n: input.every_n ?? null, every_unit: input.every_unit ?? null, first_due: input.first_due ?? null,
      });
      return { id: job.id };
    },

    // ----- the month, and the year -----
    async month(given?: string | null): Promise<Budget> {
      const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(given ?? '') ? given! : today().slice(0, 7);
      const [from, to] = [`${month}-01`, lastOf(month)];
      const income = (await incomes(db)).map((i) => ({ id: i.id, name: i.name, cents: incomeIn(i, month), every: i.every })).filter((i) => i.cents > 0);
      const lines: Budget['bills']['lines'] = [];
      const unscheduled: Budget['bills']['unscheduled'] = [];
      for (const b of await billJobs()) {
        if (!b.job.amount_cents) continue;
        const days = dueOf(b, from, to);
        if (!b.job.due.next_day) unscheduled.push({ job_id: b.job.id, name: b.job.name });
        for (const day of days) lines.push({ job_id: b.job.id, name: b.job.name, day, cents: b.job.amount_cents, autopay: b.job.autopay });
      }
      lines.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : a.name.localeCompare(b.name)));
      const cats = await categories();
      const spentHere = (await spentByMonth(from, to)).get(month) ?? 0;
      const onProjects = (await onProjectsByMonth(from, to)).get(month) ?? 0;
      const coming = month >= today().slice(0, 7) ? (await comingByMonth()).get(month) ?? 0 : 0;
      const goalIds = await goalEntryIds(db, owner);
      const goalsSpent = [...(await planSpending(db, owner)).values()].flat().filter((e) => e.day >= from && e.day <= to).reduce((n, e) => n + e.cents, 0);
      const inCategory = await db.all<{ category_id: number; n: number }>(
        `SELECT category_id, SUM(cents) AS n FROM money_entries WHERE category_id IN (${SEEN}) AND day BETWEEN ? AND ? AND id NOT IN (${BILL_PAID})${notIn(goalIds, 'id')} GROUP BY category_id`, [owner, owner, from, to, ...goalIds]);
      const planned = cats.reduce((n, c) => n + c.monthly_cents, 0);
      const puts = (await savedByGoal(from, to)).filter((g) => g.cents !== 0);
      const total = (xs: { cents: number }[]) => xs.reduce((n, x) => n + x.cents, 0);
      const past = month < today().slice(0, 7);
      const spending = past ? spentHere : Math.max(planned, spentHere);
      const bills = total(lines);
      const incomeTotal = total(income);
      const saved = total(puts);
      return {
        month, currency: await currency(),
        income: { total: incomeTotal, lines: income },
        bills: { total: bills, lines, unscheduled },
        planned: { total: planned, categories: cats.map((c) => ({ id: c.id, name: c.name, cents: c.monthly_cents, spent: inCategory.find((x) => x.category_id === c.id)?.n ?? 0 })) },
        spent: spentHere, projects: { spent: onProjects, coming }, spending, past,
        saved: { total: saved, goals: puts.map((g) => ({ id: g.id, name: g.name, cents: g.cents })) },
        left_over: incomeTotal - bills - spending - saved,
        goals_spent: goalsSpent,
        safe: await safeOf(month, incomeTotal, bills, spentHere),
        by_tag: await spendingByTag(db, owner, from, to),
      };
    },

    /** The month's safe-to-spend number and its four lines. This month when left out. */
    async safe(given?: string | null): Promise<Safe> {
      return (await this.month(given)).safe;
    },

    /** Twelve months of income, bills, spending and saving, and what each leaves over. A year is "2046"; this one when left out. */
    async year(given?: string | null): Promise<Year> {
      const year = /^\d{4}$/.test(given ?? '') ? given! : today().slice(0, 4);
      const [from, to] = [`${year}-01-01`, `${year}-12-31`];
      const incs = await incomes(db);
      const bills = await billJobs();
      const planned = (await categories()).reduce((n, c) => n + c.monthly_cents, 0);
      const thisMonth = today().slice(0, 7);
      const spent = await spentByMonth(from, to);
      const onProjects = await onProjectsByMonth(from, to);
      const coming = await comingByMonth();
      const puts = await savedByGoal(from, to);
      const months = monthsOf(year).map((month): YearMonth => {
        const income = incs.reduce((n, i) => n + incomeIn(i, month), 0);
        const owed = bills.reduce((n, b) => n + (b.job.amount_cents ? dueOf(b, `${month}-01`, lastOf(month)).length * b.job.amount_cents : 0), 0);
        const s = spent.get(month) ?? 0;
        const saved = puts.filter((p) => p.month === month).reduce((n, p) => n + p.cents, 0);
        const spending = month < thisMonth ? s : Math.max(planned, s);
        return { month, income, bills: owed, planned, spent: s, projects: onProjects.get(month) ?? 0, coming: month >= thisMonth ? coming.get(month) ?? 0 : 0, spending, saved, left: income - owed - spending - saved };
      });
      const sum = (key: keyof Omit<YearMonth, 'month'>) => months.reduce((n, m) => n + m[key], 0);
      return {
        year, currency: await currency(), months,
        totals: { income: sum('income'), bills: sum('bills'), planned: sum('planned'), spent: sum('spent'), projects: sum('projects'), coming: sum('coming'), spending: sum('spending'), saved: sum('saved'), left: sum('left') },
        by_tag: await spendingByTag(db, owner, from, to),
      };
    },

    /** Spending by tag for a month ("2046-03") or a year ("2046"). */
    async byTag(period?: string | null): Promise<TagSpend[]> {
      const p = /^\d{4}(-(0[1-9]|1[0-2]))?$/.test(period ?? '') ? period! : today().slice(0, 7);
      const [from, to] = span(p);
      return spendingByTag(db, owner, from, to);
    },
  };
}
export type BudgetTools = ReturnType<typeof budget>;
