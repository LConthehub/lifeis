/**
 * Use Life Is from your AI app: an AI app (Claude, or any app that speaks the open connector standard) that a
 * person has allowed to look at part of their Life Is and, if they ticked it, to add a few safe things.
 *
 * What a connection may reach is chosen by the person, part by part (the kitchen, the calendar, things, projects,
 * lists, money), and each tool reads only for its own part. Whatever is ticked, these are never reached: guns and
 * ammunition, measures, gift ideas and spending made for gifts, passwords and keys, the house manual, mail, and
 * notes on the calendar. Calendars the person follows show as "busy" and nothing more. Only what the person can
 * already see is ever read.
 *
 * With "It may add things" ticked, and the part ticked too, it can add a grocery line, a calendar event, a
 * reminder, or a title on one of the person's own lists. It never changes or deletes. Each added row says
 * "Added by <the connection's name>" in its note, every call is written to a log the person can read, and an add
 * can be undone (that removes exactly the rows it added, if they are still there).
 *
 * The person in charge has one household switch (off at first); turning it off ends every connection at once.
 * A connection that is not used for 90 days ends by itself. This file holds the rules and the reading and
 * adding; signing in (OAuth) and the web address are the server's.
 */
import { atomic, type Db } from './db.ts';
import { calendar } from './calendar.ts';
import { goalEntryIds } from './goalFigures.ts';
import { placePaths } from './inventory.ts';
import { kitchen } from './kitchen.ts';
import { mediaLists } from './mediaLists.ts';
import { money } from './money.ts';
import { Problem } from './problem.ts';
import { projects } from './projects.ts';
import { addDays, clean, dayNumber, labelKey, stamp, todayOf, type Clock } from './small.ts';
import { readWhen } from './voice.ts';

export type SectionId = 'kitchen' | 'calendar' | 'things' | 'projects' | 'lists' | 'money';

export const CONNECTOR_SERVICE = {
  name: 'Use Life Is from your AI app' as const,
  sends: 'Only when the AI app asks: what Life Is holds in the sections you check for that connection goes to the company that makes that AI app, through that company\'s servers. ' +
    'With "It may add things" checked, it can add a grocery line, a calendar event, a reminder or a title on a list, and it never changes or deletes anything. ' +
    'Nothing is sent at any other time.',
};

export const CONNECTOR_SECTIONS: readonly { id: SectionId; title: string; says: string; warning?: string }[] = [
  { id: 'kitchen', title: 'Kitchen', says: "Recipes, the pantry, the grocery list and the week's meals." },
  { id: 'calendar', title: 'Calendar', says: 'Events and plans coming up. Calendars you follow show only as busy.' },
  { id: 'things', title: 'Things', says: 'What you own and where it is kept.' },
  { id: 'projects', title: 'Projects', says: 'Projects still going, what they use, and their budgets.' },
  { id: 'lists', title: 'Lists', says: 'Your lists of films, shows, music, books and games.' },
  { id: 'money', title: 'Money', says: "This month's spending: what was bought, how much, and the budget for each category.",
    warning: 'This is your spending, with names and amounts. Check it only if you are comfortable with the company that makes the AI app seeing it.' },
];
const SECTION_IDS = CONNECTOR_SECTIONS.map((s) => s.id) as readonly SectionId[];
const titleOf = (id: SectionId) => CONNECTOR_SECTIONS.find((s) => s.id === id)!.title;

export const CONNECTOR_NEVER = 'Never included, whatever you check: guns and ammunition, measures, checkups, daily check-ins, the incident log, gift ideas and spending made for gifts, passwords and keys, the house manual, mail, and notes on the calendar.';
export const CONNECTOR_ADDS = 'With "It may add things" checked, it can add only a grocery line, a calendar event, a reminder, or a title on one of your own lists. It never changes or deletes anything, and you can undo what it added.';

/** A connection that has not been used for this many days ends by itself. */
export const UNUSED_DAYS = 90;
export const MOST_CONNECTIONS = 10;
/** Past this many characters, the longest lists in an answer are shortened, and the AI app is told. */
export const RESULT_LIMIT = 120_000;
export const HOUSEHOLD_KEY = 'ai_connector';
/** The log keeps a line this many days. */
const LOG_DAYS = 90;
const LOG_SHOWN = 100;
const DAY_MS = 86_400_000;

export type ConnectionInfo = {
  id: number; name: string; app_name: string; sections: SectionId[]; may_add: boolean;
  created_at: string; last_used_on: string | null;
  /** The day it ends if it is not used again. */
  ends_on: string;
};
export type LogLine = { id: number; at: string; connection: string; kind: 'read' | 'add'; what: string; can_undo: boolean; undone: boolean };
export type ConnectorStatus = {
  household_on: boolean; service: typeof CONNECTOR_SERVICE; sections: typeof CONNECTOR_SECTIONS; never: string; adds: string; unused_days: number;
  connections: ConnectionInfo[]; log: LogLine[];
};
export type Live = { id: number; owner: number; name: string; sections: SectionId[]; may_add: boolean };
export type ToolInfo = {
  name: string; title: string; description: string; inputSchema: object;
  annotations: { readOnlyHint: boolean; destructiveHint: false; openWorldHint: false };
};

// ---------- the household switch, and checking what was sent ----------

export async function householdOn(db: Db): Promise<boolean> {
  return (await db.get<{ value: string | null }>('SELECT value FROM settings WHERE key = ?', [HOUSEHOLD_KEY]))?.value === '1';
}

/** Tidies and checks what the approval page or Settings sent. */
export function checkConnection(input: { name?: string | null; sections?: string[]; may_add?: boolean }): { name: string; sections: SectionId[]; may_add: boolean } {
  const name = clean(input.name, 60);
  if (!name) throw new Problem(400, 'Give this connection a name, such as "Claude on my iPad"');
  const asked = input.sections ?? [];
  if (!Array.isArray(asked)) throw new Problem(400, 'Say which sections it may look at');
  for (const s of asked) if (!(SECTION_IDS as readonly unknown[]).includes(s)) throw new Problem(400, 'That is not a section a connection can be given');
  return { name, sections: SECTION_IDS.filter((id) => asked.includes(id)), may_add: input.may_add === true };
}

const baseDay = (row: { created_at: string; last_used_on: string | null }) => row.last_used_on ?? row.created_at.slice(0, 10);
/** The day a connection ends if it is not used again. */
const endsOn = (row: { created_at: string; last_used_on: string | null }) => addDays(baseDay(row), UNUSED_DAYS);

/** Whether a connection row is still live today: not ended, and used (or made) less than UNUSED_DAYS ago. It ends on `ends_on`. */
export function stillLive(row: { ended_at: string | null; created_at: string; last_used_on: string | null }, today: string): boolean {
  return row.ended_at === null && dayNumber(today) < dayNumber(endsOn(row));
}

const parseSections = (list: string | null): SectionId[] => SECTION_IDS.filter((id) => (list ?? '').split(',').includes(id));

// ---------- the tools ----------

type Args = Record<string, unknown>;
type Ctx = { db: Db; clock: Clock; live: Live; today: string };
type Done = { text: string; what: string; added?: { kind: 'grocery' | 'event' | 'list_item'; ids: string[] } };
type ToolDef = ToolInfo & { section: SectionId; add: boolean; run(ctx: Ctx, args: Args): Promise<Done> };

const object = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object', properties, required, additionalProperties: false });
const READ = { readOnlyHint: true, destructiveHint: false, openWorldHint: false } as const;
const ADD = { readOnlyHint: false, destructiveHint: false, openWorldHint: false } as const;

function text(args: Args, key: string, limit: number, required = false): string | null {
  const given = args[key];
  if (given !== undefined && given !== null && typeof given !== 'string') throw new Problem(400, `"${key}" must be text`);
  const value = clean(given as string | null | undefined, limit);
  if (required && !value) throw new Problem(400, `"${key}" is needed`);
  return value;
}
function whole(args: Args, key: string, fallback: number, least: number, most: number): number {
  const given = args[key];
  if (given === undefined || given === null) return fallback;
  if (typeof given !== 'number' || !Number.isInteger(given) || given < least || given > most) throw new Problem(400, `"${key}" is a whole number from ${least} to ${most}`);
  return given;
}

/** Arrays inside an answer, so the longest can be shortened. */
function arraysIn(value: unknown, depth = 0, found: unknown[][] = []): unknown[][] {
  if (depth > 4 || value === null || typeof value !== 'object') return found;
  if (Array.isArray(value)) { found.push(value); for (const v of value) arraysIn(v, depth + 1, found); }
  else for (const v of Object.values(value)) arraysIn(v, depth + 1, found);
  return found;
}
/** The answer as text no longer than the limit: the longest lists are halved until it fits, and a note says so. */
function fit(out: Record<string, unknown>, limit = RESULT_LIMIT): string {
  let json = JSON.stringify(out);
  for (let rounds = 0; json.length > limit && rounds < 200; rounds += 1) {
    const longest = arraysIn(out).filter((a) => a.length > 1).sort((a, b) => JSON.stringify(b).length - JSON.stringify(a).length)[0];
    if (!longest) break;
    longest.length = Math.ceil(longest.length / 2);
    out.note = 'Some lists were shortened to fit; say so if the answer might be in what was left out.';
    json = JSON.stringify(out);
  }
  return json.length > limit ? JSON.stringify({ note: 'The answer was too long to send.' }) : json;
}
const answer = (today: string, data: Record<string, unknown>) => fit({ today, ...data });

/** Things of a kind with a guard (guns and ammunition): their ids and names, never to be named in an answer. */
async function guarded(db: Db, owner: number): Promise<{ ids: Set<number>; names: Set<string> }> {
  const rows = await db.all<{ id: number; name: string }>('SELECT i.id, i.name FROM items i JOIN kinds k ON k.id = i.kind_id WHERE i.owner_id = ? AND k.guard IS NOT NULL', [owner]);
  return { ids: new Set(rows.map((r) => r.id)), names: new Set(rows.map((r) => labelKey(r.name))) };
}

const joined = (names: string[]) => names.join(', ');
const marked = (name: string) => `Added by ${name}`;

const TOOLS: ToolDef[] = [
  {
    name: 'get_grocery_list', section: 'kitchen', add: false, title: 'Read the grocery list', annotations: READ,
    description: 'What is still to buy on the grocery list.', inputSchema: object({}),
    async run({ db, clock, live, today }) {
      const items = (await kitchen(db, live.owner, clock).listGrocery()).filter((g) => !g.done)
        .map((g) => ({ item: [g.amount, g.label].filter(Boolean).join(' '), ...(g.note ? { note: g.note } : {}) }));
      return { text: answer(today, { grocery_list: items }), what: 'Read the grocery list' };
    },
  },
  {
    name: 'get_meals', section: 'kitchen', add: false, title: 'Read the planned meals', annotations: READ,
    description: 'The meals planned from today, by day. Say how many days (1 to 14; 7 if left out).',
    inputSchema: object({ days: { type: 'integer', minimum: 1, maximum: 14, description: 'How many days from today' } }),
    async run({ db, clock, live, today }, args) {
      const days = whole(args, 'days', 7, 1, 14);
      const meals = (await kitchen(db, live.owner, clock).listPlan(today, days)).map((m) => ({ day: m.day, meal: m.meal, what: m.recipe_title ?? m.title ?? 'A meal', ...(m.cooked_on ? { cooked: true } : {}) }));
      return { text: answer(today, { meals }), what: "Read the week's meals" };
    },
  },
  {
    name: 'get_pantry', section: 'kitchen', add: false, title: 'Read the pantry', annotations: READ,
    description: 'What is in the pantry, with amounts and use-by days.', inputSchema: object({}),
    async run({ db, clock, live, today }) {
      const items = (await kitchen(db, live.owner, clock).listPantry()).items
        .map((p) => ({ name: p.name, ...(p.quantity !== null ? { amount: p.amount } : {}), ...(p.expires_on ? { use_by: p.expires_on } : {}), ...(p.low ? { running_low: true } : {}) }));
      return { text: answer(today, { pantry: items }), what: 'Read the pantry' };
    },
  },
  {
    name: 'find_recipes', section: 'kitchen', add: false, title: 'Find recipes', annotations: READ,
    description: 'Recipes with their ingredients. Give words to look for in a title or an ingredient, or leave it out to list them all. When three or fewer match, the steps come too.',
    inputSchema: object({ query: { type: 'string', description: 'Words to look for in a title or an ingredient' } }),
    async run({ db, clock, live, today }, args) {
      const query = text(args, 'query', 100);
      const found = (await kitchen(db, live.owner, clock).listRecipes({ q: query })).slice(0, 60);
      const lines = found.length === 0 ? [] : await db.all<{ recipe_id: number; part: string; text: string }>(
        `SELECT recipe_id, part, text FROM recipe_lines WHERE recipe_id IN (${found.map(() => '?').join(',')}) AND is_heading = 0 ORDER BY recipe_id, sort_order`, found.map((r) => r.id));
      const recipes = found.map((r) => ({
        title: r.title, ...(r.tags.length ? { tags: r.tags.join(', ') } : {}), ...(r.description ? { description: r.description.slice(0, 300) } : {}),
        ...(r.servings !== null ? { servings: r.servings } : {}),
        ingredients: lines.filter((l) => l.recipe_id === r.id && l.part === 'ingredients').map((l) => l.text).slice(0, 40),
        ...(found.length <= 3 ? { steps: lines.filter((l) => l.recipe_id === r.id && l.part === 'steps').map((l) => l.text).slice(0, 40) } : {}),
      }));
      return { text: answer(today, { recipes }), what: query ? `Looked up recipes for "${query}"` : 'Looked through the recipes' };
    },
  },
  {
    name: 'get_calendar', section: 'calendar', add: false, title: 'Read the calendar', annotations: READ,
    description: 'What is on the calendar from today: events and plans, and meals, chores and project dates when those sections are allowed too. Calendars the person follows show only as busy. Say how many days (1 to 31; 14 if left out).',
    inputSchema: object({ days: { type: 'integer', minimum: 1, maximum: 31, description: 'How many days from today' } }),
    async run({ db, clock, live, today }, args) {
      const days = whole(args, 'days', 14, 1, 31);
      // Chores that belong to a gun or ammunition are left out.
      const hidden = new Set((await db.all<{ id: number }>('SELECT j.id FROM upkeep_jobs j JOIN items i ON i.id = j.item_id JOIN kinds k ON k.id = i.kind_id WHERE k.guard IS NOT NULL')).map((r) => `/things/upkeep/${r.id}`));
      // What the calendar borrows from another part (meals, project dates, chores) shows only when that part is ticked too.
      const part: Record<string, SectionId> = { meal: 'kitchen', use_by: 'kitchen', session: 'projects', due: 'projects', media: 'lists', upkeep: 'things' };
      const own = ['event', 'outside', 'plan'];
      const entries = (await calendar(db, live.owner, clock).between(today, days))
        .filter((e) => !(e.link && hidden.has(e.link)))
        .filter((e) => own.includes(e.kind) || (part[e.kind] !== undefined && live.sections.includes(part[e.kind]!)))
        .map((e) => e.kind === 'outside'
          ? { day: e.day, ...(e.time ? { time: e.time } : {}), what: 'busy' }
          : { day: e.day, ...(e.time ? { time: e.time } : {}), kind: e.kind, title: e.title, ...(e.kind === 'plan' || e.kind === 'meal' ? (e.detail ? { detail: e.detail } : {}) : {}) });
      return { text: answer(today, { from: today, days, calendar: entries }), what: 'Read the calendar' };
    },
  },
  {
    name: 'find_things', section: 'things', add: false, title: 'Find things you own', annotations: READ,
    description: 'The things the person keeps, with the amount and where each is. Give words to look for in a name or kind, or leave it out to list them all.',
    inputSchema: object({ query: { type: 'string', description: 'Words to look for in a name or kind' } }),
    async run({ db, live, today }, args) {
      const query = text(args, 'query', 100);
      const places = placePaths(await db.all('SELECT id, parent_id, name, note FROM places WHERE owner_id = ?', [live.owner]));
      const rows = await db.all<{ name: string; kind: string; quantity: number | null; unit: string | null; place_id: number | null }>(
        'SELECT i.name, k.name AS kind, i.quantity, i.unit, i.place_id FROM items i JOIN kinds k ON k.id = i.kind_id WHERE i.owner_id = ? AND i.gone_on IS NULL AND k.guard IS NULL ORDER BY k.name, i.name', [live.owner]);
      const key = query ? labelKey(query) : '';
      const things = rows.filter((t) => !key || labelKey(`${t.name} ${t.kind}`).includes(key))
        .map((t) => ({ name: t.name, kind: t.kind, ...(t.quantity !== null ? { amount: [t.quantity, t.unit].filter((x) => x !== null).join(' ') } : {}), ...(t.place_id !== null && places.has(t.place_id) ? { where: places.get(t.place_id) } : {}) }));
      return { text: answer(today, { things }), what: query ? `Looked through your things for "${query}"` : 'Looked through your things' };
    },
  },
  {
    name: 'get_projects', section: 'projects', add: false, title: 'Read projects', annotations: READ,
    description: 'Projects still going: status, when wanted by, what each uses, and its budget in cents.', inputSchema: object({}),
    async run({ db, clock, live, today }) {
      const making = projects(db, live.owner, clock);
      const never = await guarded(db, live.owner);
      const open = (await making.listProjects()).filter((p) => !['done', 'dropped'].includes(p.status)).slice(0, 40);
      const out = await Promise.all(open.map(async (p) => {
        const whole = await making.getProject(p.id);
        return {
          name: p.name, status: p.status, ...(p.activity ? { activity: p.activity } : {}), ...(p.due_on ? { wanted_by: p.due_on } : {}),
          uses: whole.lines.filter((l) => !(l.item_id !== null && never.ids.has(l.item_id)) && !never.names.has(labelKey(l.label)))
            .map((l) => ({ what: l.label, ...(l.amount ? { amount: l.amount } : {}), ...(l.short ? { short_by: l.short_text } : {}), ...(l.used_on ? { used: true } : {}) })),
          ...(whole.costs.length ? { budget: { planned_cents: whole.budget.planned, spent_cents: whole.budget.spent, left_cents: whole.budget.left } } : {}),
        };
      }));
      return { text: answer(today, { projects: out }), what: 'Read your projects' };
    },
  },
  {
    name: 'get_lists', section: 'lists', add: false, title: 'Read lists', annotations: READ,
    description: 'The lists of titles (films, shows, music, books, games) the person can see, with what is on each.', inputSchema: object({}),
    async run({ db, clock, live, today }) {
      const lists = mediaLists(db, live.owner, clock);
      const out = [];
      for (const l of (await lists.all()).slice(0, 40)) {
        const whole = await lists.get(l.id);
        out.push({ name: l.name, ...(l.mine ? {} : { belongs_to: l.owner_name }), titles: whole.entries.slice(0, 300).map((e) => ({ title: e.title, type: e.type, ...(e.creator ? { by: e.creator } : {}), ...(e.year ? { year: e.year } : {}), ...(e.note ? { note: e.note } : {}) })) });
      }
      return { text: answer(today, { lists: out }), what: 'Read your lists' };
    },
  },
  {
    name: 'get_spending', section: 'money', add: false, title: 'Read spending', annotations: READ,
    description: 'Spending for one month (this month if left out): each category with its budget, what was spent and what is left, then what was bought. All amounts are in cents.',
    inputSchema: object({ month: { type: 'string', description: 'A month written like 2046-03' } }),
    async run({ db, clock, live, today }, args) {
      const asked = text(args, 'month', 7);
      if (asked !== null && !/^\d{4}-(0[1-9]|1[0-2])$/.test(asked)) throw new Problem(400, '"month" is written like 2046-03');
      const month = await money(db, live.owner, clock).month(asked);
      // Spending made for a gift stays out, and so does what it added to the totals.
      const gifts = new Set((await db.all<{ entry_id: number }>('SELECT entry_id FROM holiday_gifts WHERE entry_id IS NOT NULL')).map((r) => r.entry_id));
      const counted = await goalEntryIds(db, live.owner);
      let noCategory = month.uncategorised;
      let total = month.total.spent;
      const taken = new Map<number, number>();
      for (const e of month.entries) {
        if (!gifts.has(e.id) || counted.has(e.id)) continue;
        if (e.category_id === null) noCategory -= e.cents; else taken.set(e.category_id, (taken.get(e.category_id) ?? 0) + e.cents);
        total -= e.cents;
      }
      const data = {
        month: month.month, currency: month.currency, amounts_are: 'cents',
        categories: month.categories.map((c) => ({ name: c.name, planned: c.monthly_cents, spent: c.spent - (taken.get(c.id) ?? 0), left: c.left + (taken.get(c.id) ?? 0) })),
        in_no_category: noCategory, paid_on_projects: month.projects.spent, total_spent: total, total_planned: month.total.planned,
        spent_on: month.entries.filter((e) => !gifts.has(e.id)).map((e) => ({ day: e.day, what: e.label, cents: e.cents, ...(e.category ? { category: e.category } : {}) })),
      };
      return { text: answer(today, data), what: `Read your spending for ${month.month}` };
    },
  },

  // ---------- adds ----------
  {
    name: 'add_groceries', section: 'kitchen', add: true, title: 'Add to the grocery list', annotations: ADD,
    description: 'Put things on the grocery list, each written as a person would type it, such as "2 lb chicken thighs". What is already on the list is left alone.',
    inputSchema: object({ items: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 40, description: 'What to buy' } }, ['items']),
    async run({ db, clock, live }, args) {
      const given = args.items;
      if (!Array.isArray(given) || given.length === 0 || given.some((x) => typeof x !== 'string')) throw new Problem(400, '"items" is a list of things to buy');
      if (given.length > 40) throw new Problem(400, 'Add at most 40 things at a time');
      const texts = (given as string[]).map((x) => clean(x, 200)).filter((x): x is string => x !== null);
      if (texts.length === 0) throw new Problem(400, '"items" is a list of things to buy');
      const kept = kitchen(db, live.owner, clock);
      const before = new Set((await kept.listGrocery()).map((g) => g.id));
      const done = await kept.addGroceries(texts);
      const fresh = done.items.filter((g) => !before.has(g.id));
      const label = marked(live.name);
      for (const g of fresh) await db.run('UPDATE grocery SET note = ? WHERE id = ? AND owner_id = ?', [g.note ? `${g.note} · ${label}` : label, g.id, live.owner]);
      if (fresh.length === 0) return { text: 'Those were already on the grocery list. Nothing was added.', what: `Tried to add to the grocery list: ${joined(texts)} (already there)` };
      const names = fresh.map((g) => [g.amount, g.label].filter(Boolean).join(' '));
      const already = done.already ? ` ${done.already === 1 ? 'One was' : `${done.already} were`} already there.` : '';
      return {
        text: `Added to the grocery list: ${joined(names)}.${already}`, what: `Added to the grocery list: ${joined(names)}`,
        added: { kind: 'grocery', ids: fresh.map((g) => String(g.id)) },
      };
    },
  },
  {
    name: 'add_event', section: 'calendar', add: true, title: 'Add a calendar event', annotations: ADD,
    description: 'Put an event on the calendar. Days are written like 2046-03-05 and a time like 18:30; with no time it is for the whole day.',
    inputSchema: object({
      title: { type: 'string' }, day: { type: 'string', description: 'The day, like 2046-03-05' },
      end_day: { type: 'string', description: 'The last day, for an event over several days' }, time: { type: 'string', description: 'When it starts, like 18:30' },
    }, ['title', 'day']),
    async run({ db, clock, live }, args) {
      const title = text(args, 'title', 200, true)!;
      const day = text(args, 'day', 10, true)!;
      const end_day = text(args, 'end_day', 10);
      const time = text(args, 'time', 5);
      return addEvent(db, clock, live, { title, day, end_day, time }, 'Added to the calendar');
    },
  },
  {
    name: 'add_reminder', section: 'calendar', add: true, title: 'Add a reminder', annotations: ADD,
    description: 'Put a reminder on the calendar. "when" is said as people say it: "tomorrow at 3 PM", "friday", "2046-03-05", "in 3 days". Left out, it is for today.',
    inputSchema: object({ text: { type: 'string', description: 'What to be reminded of' }, when: { type: 'string', description: 'When, such as "tomorrow at 3 PM"' } }, ['text']),
    async run({ db, clock, live, today }, args) {
      const words = text(args, 'text', 200, true)!;
      const at = readWhen(text(args, 'when', 60), today);
      return addEvent(db, clock, live, { title: words, day: at.day, end_day: null, time: at.time }, 'Added a reminder');
    },
  },
  {
    name: 'add_to_list', section: 'lists', add: true, title: 'Add a title to a list', annotations: ADD,
    description: "Put a title on one of the person's own lists, found by the list's name. The type is film, show, music, book, game or other.",
    inputSchema: object({
      list: { type: 'string', description: "The name of one of the person's own lists" }, title: { type: 'string' },
      type: { type: 'string', enum: ['film', 'show', 'music', 'book', 'game', 'other'] },
    }, ['list', 'title', 'type']),
    async run({ db, clock, live }, args) {
      const wanted = text(args, 'list', 80, true)!;
      const title = text(args, 'title', 300, true)!;
      const type = text(args, 'type', 20, true)!;
      const lists = mediaLists(db, live.owner, clock);
      const list = (await lists.all()).find((l) => l.mine && labelKey(l.name) === labelKey(wanted));
      if (!list) throw new Problem(400, `You have no list called "${wanted}". Lists of yours: ${joined((await lists.all()).filter((l) => l.mine).map((l) => l.name))}.`);
      const on = await lists.get(list.id);
      if (on.entries.some((e) => e.type === type && labelKey(e.title) === labelKey(title))) {
        return { text: `"${title}" was already on ${list.name}. Nothing was added.`, what: `Tried to add to the list ${list.name}: ${title} (already there)` };
      }
      const after = await lists.add(list.id, { title, type, note: marked(live.name) });
      const mine = after.entries.find((e) => e.type === type && labelKey(e.title) === labelKey(title));
      if (!mine) throw new Problem(400, `That could not be added to ${list.name}`);
      return {
        text: `Added to the list ${list.name}: ${title}.`, what: `Added to the list ${list.name}: ${title}`,
        added: { kind: 'list_item', ids: [`${list.id}:${mine.media_id}`] },
      };
    },
  },
];

/** One event or reminder, unless the same one is already there. The note says who added it. */
async function addEvent(db: Db, clock: Clock, live: Live, input: { title: string; day: string; end_day: string | null; time: string | null }, verb: string): Promise<Done> {
  dayNumber(input.day);
  const same = (await db.all<{ title: string; time: string | null }>('SELECT title, time FROM events WHERE owner_id = ? AND day = ?', [live.owner, input.day]))
    .some((e) => labelKey(e.title) === labelKey(input.title) && (e.time ?? '') === (input.time ?? ''));
  const when = `${input.day}${input.time ? ` at ${input.time}` : ''}`;
  if (same) return { text: `${input.title} was already on the calendar for ${when}. Nothing was added.`, what: `Tried to add to the calendar: ${input.title}, ${when} (already there)` };
  const made = await calendar(db, live.owner, clock).createEvent({ ...input, note: marked(live.name) });
  return { text: `${verb}: ${input.title}, ${when}.`, what: `${verb}: ${input.title}, ${when}`, added: { kind: 'event', ids: [String(made.id)] } };
}

const asInfo = (t: ToolDef): ToolInfo => ({ name: t.name, title: t.title, description: t.description, inputSchema: t.inputSchema, annotations: t.annotations });

/** The tools this connection may see: reads for its sections, adds only with "may add" and the section too. */
export function connectionTools(live: Pick<Live, 'sections' | 'may_add'>): ToolInfo[] {
  return TOOLS.filter((t) => live.sections.includes(t.section) && (!t.add || live.may_add)).map(asInfo);
}

// ---------- the log ----------

const cutoff = (clock: Clock) => stamp(new Date(clock().getTime() - LOG_DAYS * DAY_MS));

async function writeLog(db: Db, clock: Clock, live: Live, kind: 'read' | 'add', what: string, added?: Done['added']): Promise<void> {
  await db.run('DELETE FROM ai_log WHERE at < ?', [cutoff(clock)]);
  await db.run('INSERT INTO ai_log (connection_id, owner_id, at, kind, what, added_kind, added_ids) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [live.id, live.owner, stamp(clock()), kind, what.slice(0, 500), added?.kind ?? null, added ? added.ids.join(',') : null]);
}

/**
 * Runs one tool for a connection, writes its log line, and returns text: JSON for a read, a sentence for an add.
 * Never longer than RESULT_LIMIT. Problem 403 when the section or the add tick does not allow it, 400 for bad
 * arguments, 404 for a tool that is not there.
 */
export async function callTool(db: Db, clock: Clock, live: Live, tool: string, args: Record<string, unknown>): Promise<string> {
  const def = TOOLS.find((t) => t.name === tool);
  if (!def) throw new Problem(404, `There is no tool called ${tool}`);
  if (!live.sections.includes(def.section)) throw new Problem(403, `This connection was not allowed to use ${titleOf(def.section)}. Change what it may use in Settings, under Connections.`);
  if (def.add && !live.may_add) throw new Problem(403, 'This connection may not add things. Check "It may add things" for it in Settings, under Connections.');
  if (args === null || typeof args !== 'object' || Array.isArray(args)) throw new Problem(400, 'The arguments must be an object');
  const today = todayOf(clock);
  const done = await def.run({ db, clock, live, today }, args);
  await db.run('UPDATE ai_connections SET last_used_on = ? WHERE id = ?', [today, live.id]);
  await writeLog(db, clock, live, def.add ? 'add' : 'read', done.what, done.added);
  return done.text.length > RESULT_LIMIT ? done.text.slice(0, RESULT_LIMIT) : done.text;
}

// ---------- one person's connections ----------

type Row = {
  id: number; owner_id: number; app_name: string; name: string; sections: string; may_add: number;
  created_at: string; last_used_on: string | null; ended_at: string | null;
};
const CLEARED = 'code_hash = NULL, code_challenge = NULL, code_redirect = NULL, code_expires_at = NULL, access_hash = NULL, access_expires_at = NULL, refresh_hash = NULL, old_refresh_hash = NULL, old_refresh_until = NULL';

export function connector(db: Db, owner: number, clock: Clock = () => new Date()) {
  const today = () => todayOf(clock);

  const info = (r: Row): ConnectionInfo => ({
    id: r.id, name: r.name, app_name: r.app_name, sections: parseSections(r.sections), may_add: r.may_add === 1,
    created_at: r.created_at, last_used_on: r.last_used_on, ends_on: endsOn(r),
  });
  const COLUMNS = 'id, owner_id, app_name, name, sections, may_add, created_at, last_used_on, ended_at';

  /** One of this person's own connections that has not ended. Anyone else's is not there. */
  async function mine(id: number): Promise<Row> {
    const row = await db.get<Row>(`SELECT ${COLUMNS} FROM ai_connections WHERE id = ? AND owner_id = ?`, [id, owner]);
    if (!row) throw new Problem(404, "That connection isn't here anymore. It may have been deleted.");
    if (!stillLive(row, today())) throw new Problem(409, 'That connection has ended');
    return row;
  }

  return {
    async status(): Promise<ConnectorStatus> {
      // A connection nobody used for a long time ends here, if nothing else has ended it yet.
      const all = await db.all<Row>(`SELECT ${COLUMNS} FROM ai_connections WHERE owner_id = ? AND ended_at IS NULL ORDER BY id`, [owner]);
      for (const r of all) if (!stillLive(r, today())) await db.run(`UPDATE ai_connections SET ended_at = ?, ${CLEARED} WHERE id = ?`, [stamp(clock()), r.id]);
      const live = all.filter((r) => stillLive(r, today()));
      const log = await db.all<{ id: number; at: string; connection: string; kind: string; what: string; added_ids: string | null; undone_at: string | null }>(
        `SELECT l.id, l.at, c.name AS connection, l.kind, l.what, l.added_ids, l.undone_at FROM ai_log l JOIN ai_connections c ON c.id = l.connection_id
         WHERE l.owner_id = ? AND l.at >= ? ORDER BY l.id DESC LIMIT ?`, [owner, cutoff(clock), LOG_SHOWN]);
      return {
        household_on: await householdOn(db), service: CONNECTOR_SERVICE, sections: CONNECTOR_SECTIONS, never: CONNECTOR_NEVER, adds: CONNECTOR_ADDS, unused_days: UNUSED_DAYS,
        connections: live.map(info),
        log: log.map((l): LogLine => ({
          id: l.id, at: l.at, connection: l.connection, kind: l.kind === 'add' ? 'add' : 'read', what: l.what,
          can_undo: l.kind === 'add' && l.added_ids !== null && l.undone_at === null, undone: l.undone_at !== null,
        })),
      };
    },

    /** The person in charge's switch. Turning it off ends every connection of everyone, at once. */
    async setHousehold(on: boolean, isAdmin: boolean): Promise<void> {
      if (!isAdmin) throw new Problem(403, 'Only the person in charge can turn this on or off');
      await atomic(db, async (tx) => {
        await tx.run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [HOUSEHOLD_KEY, on ? '1' : '0']);
        if (!on) await tx.run(`UPDATE ai_connections SET ended_at = ?, ${CLEARED} WHERE ended_at IS NULL`, [stamp(clock())]);
      });
    },

    async update(id: number, input: { name?: string | null; sections?: string[]; may_add?: boolean }): Promise<ConnectionInfo> {
      const row = await mine(id);
      const next = checkConnection({
        name: input.name === undefined || input.name === null ? row.name : input.name,
        sections: input.sections === undefined ? parseSections(row.sections) : input.sections,
        may_add: input.may_add === undefined ? row.may_add === 1 : input.may_add,
      });
      await db.run('UPDATE ai_connections SET name = ?, sections = ?, may_add = ? WHERE id = ? AND owner_id = ?', [next.name, next.sections.join(','), next.may_add ? 1 : 0, id, owner]);
      return info((await db.get<Row>(`SELECT ${COLUMNS} FROM ai_connections WHERE id = ?`, [id]))!);
    },

    /** Ends a connection now. The row stays, so the log still names it. */
    async cutOff(id: number): Promise<void> {
      const row = await db.get<Row>(`SELECT ${COLUMNS} FROM ai_connections WHERE id = ? AND owner_id = ?`, [id, owner]);
      if (!row) throw new Problem(404, "That connection isn't here anymore. It may have been deleted.");
      await db.run(`UPDATE ai_connections SET ended_at = COALESCE(ended_at, ?), ${CLEARED} WHERE id = ? AND owner_id = ?`, [stamp(clock()), id, owner]);
    },

    /** Takes back what an add put in: exactly those rows, and only if they are still there and are this person's. */
    async undo(logId: number): Promise<void> {
      const line = await db.get<{ id: number; kind: string; added_kind: string | null; added_ids: string | null; undone_at: string | null }>(
        'SELECT id, kind, added_kind, added_ids, undone_at FROM ai_log WHERE id = ? AND owner_id = ?', [logId, owner]);
      if (!line) throw new Problem(404, "That action isn't here anymore. It may have been deleted.");
      if (line.undone_at !== null) throw new Problem(409, 'That was already undone');
      if (line.kind !== 'add' || !line.added_ids || !line.added_kind) throw new Problem(409, 'There is nothing to undo on that line');
      const ids = line.added_ids.split(',');
      if (line.added_kind === 'grocery') {
        const kept = kitchen(db, owner, clock);
        for (const id of ids) if (await db.get('SELECT id FROM grocery WHERE id = ? AND owner_id = ?', [Number(id), owner])) await kept.deleteGrocery(Number(id));
      } else if (line.added_kind === 'event') {
        const cal = calendar(db, owner, clock);
        for (const id of ids) if (await db.get('SELECT id FROM events WHERE id = ? AND owner_id = ?', [Number(id), owner])) await cal.deleteEvent(Number(id));
      } else if (line.added_kind === 'list_item') {
        const lists = mediaLists(db, owner, clock);
        for (const id of ids) {
          const [listId, mediaId] = id.split(':').map(Number) as [number, number];
          const list = await db.get<{ builtin: string | null }>('SELECT builtin FROM media_lists WHERE id = ? AND owner_id = ?', [listId, owner]);
          if (!list) continue;
          const there = list.builtin === 'wanted'
            ? await db.get('SELECT id FROM media WHERE id = ? AND owner_id = ? AND wanted = 1', [mediaId, owner])
            : await db.get('SELECT id FROM media_list_items WHERE list_id = ? AND media_id = ?', [listId, mediaId]);
          if (there) await lists.take(listId, mediaId);
        }
      }
      await db.run('UPDATE ai_log SET undone_at = ? WHERE id = ? AND owner_id = ?', [stamp(clock()), logId, owner]);
    },
  };
}
