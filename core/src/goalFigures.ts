/**
 * The figures behind goals (budget.ts), kept apart so they can be tested on their own.
 *
 * A goal is money set aside for something by a day. It can belong to a plan (a holiday's or a trip's year is a
 * plan), to a project, or to nothing. Spending tagged to a plan comes out of the plan's own goal, so it is left out
 * of the month's spending (it is counted once: in the goal).
 *
 * All money is whole cents. A month is "2046-03".
 */
import type { Queries } from './db.ts';
import { addDays } from './small.ts';

/** Spending counts toward a plan's goal if it was made this long before the plan's first day, or this long after its last. */
export const SPEND_BEFORE = 200;
export const SPEND_AFTER = 100;

const monthNumber = (month: string) => Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1;
/** How many months from `a` to `b` (both "2046-03" or longer days); below zero when `b` is the earlier. */
export const monthsFrom = (a: string, b: string) => monthNumber(b) - monthNumber(a);

/** Money in words: "$120", "$12.50". The sign is the person's currency mark. */
export function fmt(sign: string, cents: number): string {
  const dollars = Math.abs(cents) / 100;
  const body = Number.isInteger(dollars) ? dollars.toLocaleString('en-US') : dollars.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${cents < 0 ? '-' : ''}${sign}${body}`;
}

/**
 * What a goal asks of a month: what is left to put by after what was put by before that month, spread over the
 * months from this one to the day's (this one and the day's own both counted). Nothing when it has no day, is full, or the day has passed.
 */
export function monthlyAsk(target: number, savedBefore: number, byDay: string | null, month: string, late = false): number {
  if (!byDay || late || savedBefore >= target) return 0;
  const months = monthsFrom(month, byDay.slice(0, 7)) + 1;
  return months < 1 ? 0 : Math.ceil((target - savedBefore) / months);
}

/**
 * How far behind an even pace a goal is at the start of this month: the even share per month from the month it
 * was made to the day's, times the months gone by, less what was put by before this month. `even` is that share.
 */
export function pace(target: number, byDay: string | null, madeMonth: string, thisMonth: string, savedBefore: number): { even: number | null; behind: number } {
  if (!byDay) return { even: null, behind: 0 };
  const all = Math.max(1, monthsFrom(madeMonth, byDay.slice(0, 7)) + 1);
  const gone = Math.max(0, Math.min(monthsFrom(madeMonth, thisMonth), all));
  const even = Math.ceil(target / all);
  return { even, behind: Math.max(0, Math.min(target, even * gone) - savedBefore) };
}

export type ProgressState = 'done' | 'over' | 'behind' | 'on_track';
/** What the bar under a goal says: always in plain words, never only a picture. */
export type Progress = { state: ProgressState; put: number; spent: number; target: number; behind: number; over: number; words: string };

export function progressOf(sign: string, g: { target: number; put: number; spent: number; behind: number }): Progress {
  const over = Math.max(0, g.spent - g.target);
  if (over > 0) return { state: 'over', ...g, over, words: `${fmt(sign, g.spent)} of ${fmt(sign, g.target)}, over by ${fmt(sign, over)}` };
  if (g.put >= g.target) return { state: 'done', ...g, over: 0, words: `${fmt(sign, g.put)} of ${fmt(sign, g.target)}, done` };
  if (g.behind > 0) return { state: 'behind', ...g, over: 0, words: `${fmt(sign, g.put)} of ${fmt(sign, g.target)}, behind by ${fmt(sign, g.behind)}` };
  return { state: 'on_track', ...g, over: 0, words: `${fmt(sign, g.put)} of ${fmt(sign, g.target)}, on track` };
}

export type GoalSpend = { id: number; cents: number; day: string };

/**
 * What was spent against each plan's goal: spending entries carrying a tag of the plan (or one inside it), or the
 * tag of the holiday or trip the plan is a year of, made close to the plan's days. Only the person's own entries.
 * Keyed by goal.
 */
export async function planSpending(q: Queries, owner: number): Promise<Map<number, GoalSpend[]>> {
  const out = new Map<number, GoalSpend[]>();
  const goals = await q.all<{ id: number; plan_id: number; start_day: string; end_day: string }>(
    'SELECT g.id, g.plan_id, p.start_day, p.end_day FROM money_goals g JOIN plans p ON p.id = g.plan_id AND p.owner_id = g.owner_id WHERE g.owner_id = ? AND g.plan_id IS NOT NULL', [owner]);
  if (goals.length === 0) return out;
  const parents = new Map((await q.all<{ id: number; parent_id: number | null }>('SELECT id, parent_id FROM tags WHERE owner_id = ?', [owner])).map((t) => [t.id, t.parent_id]));
  const inside = (root: number) => {
    const set = new Set<number>([root]);
    for (let grew = true; grew;) {
      grew = false;
      for (const [id, parent] of parents) if (parent !== null && set.has(parent) && !set.has(id)) { set.add(id); grew = true; }
    }
    return set;
  };
  for (const g of goals) {
    const roots = [
      ...(await q.all<{ tag_id: number }>("SELECT l.tag_id FROM tag_links l JOIN tags t ON t.id = l.tag_id WHERE l.kind = 'plan' AND l.target_id = ? AND t.owner_id = ?", [g.plan_id, owner])).map((r) => r.tag_id),
      ...(await q.all<{ tag_id: number }>('SELECT h.tag_id FROM holiday_years y JOIN holidays h ON h.id = y.holiday_id WHERE y.plan_id = ? AND h.tag_id IS NOT NULL', [g.plan_id])).map((r) => r.tag_id),
      ...(await q.all<{ tag_id: number }>('SELECT t.tag_id FROM outdoor_trip_years y JOIN outdoor_trips t ON t.id = y.trip_id WHERE y.plan_id = ? AND t.tag_id IS NOT NULL', [g.plan_id])).map((r) => r.tag_id),
    ];
    const tags = new Set<number>();
    for (const r of roots) for (const id of inside(r)) tags.add(id);
    if (tags.size === 0) { out.set(g.id, []); continue; }
    out.set(g.id, await q.all<GoalSpend>(
      `SELECT DISTINCT e.id, e.cents, e.day FROM tag_links l JOIN money_entries e ON e.id = l.target_id
       WHERE l.kind = 'spending' AND e.owner_id = ? AND l.tag_id IN (${[...tags].map(() => '?').join(',')}) AND e.day BETWEEN ? AND ? ORDER BY e.day, e.id`,
      [owner, ...tags, addDays(g.start_day, -SPEND_BEFORE), addDays(g.end_day, SPEND_AFTER)]));
  }
  return out;
}

/** The ids of every spending entry counted against a goal: the month's spending leaves these out. */
export async function goalEntryIds(q: Queries, owner: number): Promise<Set<number>> {
  const ids = new Set<number>();
  for (const list of (await planSpending(q, owner)).values()) for (const e of list) ids.add(e.id);
  return ids;
}
