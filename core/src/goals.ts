/**
 * A plan's, holiday's, trip's or project's own goal, and what it adds up to.
 *
 * What is known in Life Is is added up, never copied: the food of a plan (priced from the last store prices, shopping.ts),
 * the gifts of a holiday with their prices, the costs of a project (or of a project on a plan), and the lines the person
 * types here. Things with no price are counted and said so ("3 things have no price yet"); they add nothing to the total.
 *
 * Whoever sees a plan sees its goal. A line hidden from a person (a gift for them, until the day has passed, or a typed
 * line hidden from them) is left out of the list and out of the total they see.
 *
 * Money is whole cents. Nothing here leaves the device.
 */
import { budget, type Goal, type Safe } from './budget.ts';
import type { Db } from './db.ts';
import { fmt, monthlyAsk } from './goalFigures.ts';
import { Problem } from './problem.ts';
import { shopping } from './shopping.ts';
import { clean, stamp, todayOf, type Clock } from './small.ts';

export type CostSource = 'food' | 'gifts' | 'project' | 'typed';
export type CostLine = {
  key: string; source: CostSource; label: string;
  /** What it comes to; 0 when nothing is priced yet. */
  cents: number;
  /** How many things in this line have no price yet. */
  unknown: number;
  /** A typed line's own id, to change or remove it. */
  line_id: number | null;
};
export type CostView = { lines: CostLine[]; total: number; unknown: number; unknown_words: string | null };
export type GoalPanel = {
  subject: { kind: 'plan' | 'project'; id: number; name: string; /** The day it is for (a plan's first day, a project's due day). */ day: string | null; over: boolean };
  currency: string;
  cost: CostView;
  goal: Goal | null;
  safe: Safe;
  /** With no goal yet: what setting one at the cost, by the day, would ask of this month, and what would be safe to spend then. */
  if_set: { target: number; by_day: string; ask: number; safe: number; words: string } | null;
};
export type LineInput = { label?: string | null; cents?: number | null; hidden_from?: number | null };
export type StartInput = { plan_id?: number | null; project_id?: number | null; target_cents?: number | null; by_day?: string | null };

const MOST = 100_000_000_00;
export const unknownWords = (n: number) => (n === 0 ? null : `${n} ${n === 1 ? 'thing has' : 'things have'} no price yet`);

export function goals(db: Db, owner: number, clock: Clock = () => new Date()) {
  const today = () => todayOf(clock);
  const tools = () => budget(db, owner, clock);

  async function ownGoal(id: number): Promise<{ id: number }> {
    const found = await db.get<{ id: number }>('SELECT id FROM money_goals WHERE id = ? AND owner_id = ?', [id, owner]);
    if (!found) throw new Problem(404, 'Not found');
    return found;
  }
  function checkedLine(input: LineInput) {
    const label = clean(input.label, 200);
    if (!label) throw new Problem(400, 'Say what it is');
    const cents = input.cents ?? null;
    if (cents !== null && (!Number.isInteger(cents) || cents < 0 || cents > MOST)) throw new Problem(422, 'The price should be an amount of money, not below zero');
    return { label, cents };
  }
  async function personOk(id: number | null | undefined): Promise<number | null> {
    if (id === null || id === undefined) return null;
    if (!(await db.get('SELECT 1 AS x FROM users WHERE id = ?', [id]))) throw new Problem(400, "That person isn't in this Life Is");
    return id;
  }

  /** What a plan or project adds up to, for one person: what they may not see is not in it. */
  async function costOf(subject: { kind: 'plan' | 'project'; id: number; end: string | null }, goalId: number | null, viewer: number): Promise<CostView> {
    const lines: CostLine[] = [];
    const costsOfProject = async (projectId: number, one: boolean, name: string) => {
      const rows = await db.all<{ id: number; label: string; planned_cents: number | null; actual_cents: number | null }>(
        'SELECT c.id, c.label, c.planned_cents, c.actual_cents FROM project_costs c JOIN projects p ON p.id = c.project_id WHERE c.project_id = ? AND p.owner_id = ? ORDER BY c.sort_order, c.id', [projectId, owner]);
      if (one) {
        if (rows.length === 0) return;
        lines.push({ key: `project:${projectId}`, source: 'project', label: `Project: ${name}`, cents: rows.reduce((n, r) => n + (r.actual_cents ?? r.planned_cents ?? 0), 0),
          unknown: rows.filter((r) => r.actual_cents === null && r.planned_cents === null).length, line_id: null });
      } else {
        for (const r of rows) lines.push({ key: `cost:${r.id}`, source: 'project', label: r.label, cents: r.actual_cents ?? r.planned_cents ?? 0, unknown: r.actual_cents === null && r.planned_cents === null ? 1 : 0, line_id: null });
      }
    };
    if (subject.kind === 'plan') {
      const food = await shopping(db, owner, clock).planCost(subject.id);
      if (food.ingredients > 0) lines.push({ key: 'food', source: 'food', label: 'Food, from store prices', cents: food.cents, unknown: food.unpriced.length, line_id: null });
      // A gift for a person who signs in to Life Is stays a surprise to them until the day has passed (holidays.ts): not in their list, not in their total.
      for (const g of await db.all<{ id: number; who: string; idea: string; cents: number | null; for_user: number | null }>(
        'SELECT id, who, idea, cents, for_user FROM holiday_gifts WHERE plan_id = ? ORDER BY sort_order, id', [subject.id])) {
        if (g.for_user !== null && g.for_user === viewer && (subject.end ?? '9999') >= today()) continue;
        lines.push({ key: `gift:${g.id}`, source: 'gifts', label: `Gift for ${g.who}: ${g.idea}`, cents: g.cents ?? 0, unknown: g.cents === null ? 1 : 0, line_id: null });
      }
      for (const p of await db.all<{ ref_id: number; label: string }>("SELECT ref_id, label FROM plan_items WHERE plan_id = ? AND kind = 'project' AND ref_id IS NOT NULL ORDER BY sort_order, id", [subject.id])) {
        await costsOfProject(p.ref_id, true, p.label);
      }
    } else {
      await costsOfProject(subject.id, false, '');
    }
    if (goalId !== null) {
      for (const l of await db.all<{ id: number; label: string; cents: number | null; hidden_from: number | null }>(
        'SELECT id, label, cents, hidden_from FROM money_goal_lines WHERE goal_id = ? ORDER BY id', [goalId])) {
        if (l.hidden_from !== null && l.hidden_from === viewer) continue;
        lines.push({ key: `line:${l.id}`, source: 'typed', label: l.label, cents: l.cents ?? 0, unknown: l.cents === null ? 1 : 0, line_id: l.id });
      }
    }
    const unknown = lines.reduce((n, l) => n + l.unknown, 0);
    return { lines, total: lines.reduce((n, l) => n + l.cents, 0), unknown, unknown_words: unknownWords(unknown) };
  }

  return {
    /**
     * A plan's goal as the person `viewer` sees it (the owner when left out): its cost added up, its goal when it has one, and the
     * month's safe-to-spend number. With no goal, what one at the cost would do to this month.
     */
    async forPlan(planId: number, viewer = owner): Promise<GoalPanel> {
      const plan = await db.get<{ id: number; name: string; start_day: string; end_day: string }>('SELECT id, name, start_day, end_day FROM plans WHERE id = ? AND owner_id = ?', [planId, owner]);
      if (!plan) throw new Problem(404, 'Not found');
      const mine = await db.get<{ id: number }>('SELECT id FROM money_goals WHERE plan_id = ? AND owner_id = ?', [planId, owner]);
      return this.panel({ kind: 'plan', id: plan.id, name: plan.name, day: plan.start_day, end: plan.end_day }, mine?.id ?? null, viewer);
    },
    /** A project's goal: the first one made for it. */
    async forProject(projectId: number, viewer = owner): Promise<GoalPanel> {
      const project = await db.get<{ id: number; name: string; due_on: string | null; status: string }>('SELECT id, name, due_on, status FROM projects WHERE id = ? AND owner_id = ?', [projectId, owner]);
      if (!project) throw new Problem(404, 'Not found');
      const mine = await db.get<{ id: number }>('SELECT id FROM money_goals WHERE project_id = ? AND owner_id = ? ORDER BY id LIMIT 1', [projectId, owner]);
      return this.panel({ kind: 'project', id: project.id, name: project.name, day: project.due_on, end: project.status === 'done' || project.status === 'dropped' ? '0000-00-00' : null }, mine?.id ?? null, viewer);
    },
    async panel(subject: { kind: 'plan' | 'project'; id: number; name: string; day: string | null; end: string | null }, goalId: number | null, viewer: number): Promise<GoalPanel> {
      const cost = await costOf(subject, goalId, viewer);
      const b = tools();
      const month = today().slice(0, 7);
      const safe = await b.safe(month);
      const goal = goalId !== null ? await b.goal(goalId) : null;
      const over = subject.end !== null && subject.end < today();
      let ifSet: GoalPanel['if_set'] = null;
      if (!goal && cost.total > 0 && !over && subject.day && subject.day >= today()) {
        const ask = monthlyAsk(cost.total, 0, subject.day, month);
        ifSet = { target: cost.total, by_day: subject.day, ask, safe: safe.safe - ask, words: `With a goal of ${fmt(safe.currency, cost.total)} by ${subject.day}, this month asks ${fmt(safe.currency, ask)} and ${fmt(safe.currency, Math.max(0, safe.safe - ask))} would be safe to spend${safe.safe - ask < 0 ? ' (short)' : ''}.` };
      }
      return { subject: { kind: subject.kind, id: subject.id, name: subject.name, day: subject.day, over }, currency: safe.currency, cost, goal, safe, if_set: ifSet };
    },

    /**
     * Make the goal for a plan or project: named for it, by its day, and aimed at what it adds up to unless an amount is given.
     * A plan has one goal; so does a project made this way.
     */
    async start(input: StartInput): Promise<{ id: number }> {
      if ((input.plan_id ?? null) === null && (input.project_id ?? null) === null) throw new Problem(400, 'Say which plan or project');
      const isPlan = input.plan_id != null;
      const subject = isPlan
        ? await db.get<{ id: number; name: string; day: string | null }>('SELECT id, name, start_day AS day FROM plans WHERE id = ? AND owner_id = ?', [input.plan_id!, owner])
        : await db.get<{ id: number; name: string; day: string | null }>('SELECT id, name, due_on AS day FROM projects WHERE id = ? AND owner_id = ?', [input.project_id!, owner]);
      if (!subject) throw new Problem(404, 'Not found');
      if (!isPlan && await db.get('SELECT id FROM money_goals WHERE project_id = ? AND owner_id = ?', [subject.id, owner])) throw new Problem(409, 'That project already has a goal');
      const target = input.target_cents ?? (await costOf({ kind: isPlan ? 'plan' : 'project', id: subject.id, end: null }, null, owner)).total;
      if (!(target > 0)) throw new Problem(422, 'Say how much to aim for: the cost is not known yet');
      return tools().addGoal({ name: subject.name, target_cents: target, by_day: input.by_day === undefined ? subject.day : input.by_day, ...(isPlan ? { plan_id: subject.id } : { project_id: subject.id }) });
    },

    // ----- the goal's own lines -----
    async addLine(goalId: number, input: LineInput): Promise<{ id: number }> {
      await ownGoal(goalId);
      const l = checkedLine(input);
      const hidden = await personOk(input.hidden_from);
      return { id: (await db.run('INSERT INTO money_goal_lines (goal_id, label, cents, hidden_from, created_at) VALUES (?, ?, ?, ?, ?)', [goalId, l.label, l.cents, hidden, stamp(clock())])).lastId };
    },
    async updateLine(lineId: number, input: LineInput): Promise<void> {
      const found = await db.get<{ id: number }>('SELECT l.id FROM money_goal_lines l JOIN money_goals g ON g.id = l.goal_id WHERE l.id = ? AND g.owner_id = ?', [lineId, owner]);
      if (!found) throw new Problem(404, 'Not found');
      const l = checkedLine(input);
      await db.run('UPDATE money_goal_lines SET label = ?, cents = ? WHERE id = ?', [l.label, l.cents, lineId]);
      if (input.hidden_from !== undefined) await db.run('UPDATE money_goal_lines SET hidden_from = ? WHERE id = ?', [await personOk(input.hidden_from), lineId]);
    },
    async removeLine(lineId: number): Promise<void> {
      const found = await db.get<{ id: number }>('SELECT l.id FROM money_goal_lines l JOIN money_goals g ON g.id = l.goal_id WHERE l.id = ? AND g.owner_id = ?', [lineId, owner]);
      if (!found) throw new Problem(404, 'Not found');
      await db.run('DELETE FROM money_goal_lines WHERE id = ?', [lineId]);
    },
  };
}
export type GoalTools = ReturnType<typeof goals>;
