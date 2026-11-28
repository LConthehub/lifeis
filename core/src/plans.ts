/**
 * Plans, and the memories they become.
 *
 * A plan is something with a name and its days: a holiday, a party, an afternoon's sewing. It can be made
 * ahead, or written down afterwards. What belongs to it is drawn from everywhere else and only pointed at,
 * never copied: recipes from the kitchen, things you keep (with how many are needed, so it can say what
 * you're short of), titles from the collection, a project, and a checklist of its own.
 *
 * One thing a plan does change elsewhere: a recipe can be put on the week's meals for one of the plan's days
 * (or the days just before, for what's made ahead), so the grocery list and the pans it needs follow. That
 * meal then belongs to the plan: it moves when the plan moves, and goes when the recipe is taken off the
 * plan or the plan is removed. A meal that has been cooked is history, and is never moved or removed.
 *
 * Once its days have come, a plan also shows what happened on them, gathered from the calendar (what was
 * cooked, worked on, watched), and keeps your own words about how it went and your photos. Nothing is
 * thrown away when it's over: past plans are there to look back on, and to start next year's from.
 *
 * A photo is either kept here (one picked from a phone or computer) or only linked (one that lives in a
 * photo library such as Immich, which is asked for it each time it's shown; see photos.ts).
 */
import { calendar, type Entry } from './calendar.ts';
import { atomic, type Db, type Queries, type Value } from './db.ts';
import { RULE_COLUMN_NAMES, ruleFromColumns, ruleWords, thawDays, type DateRule, type RuleColumns } from './holidayDates.ts';
import { inventory } from './inventory.ts';
import { Problem } from './problem.ts';
import { upkeep } from './upkeep.ts';
import { attachTags, onlyTagged, unlink, type TagRef } from './tags.ts';
import { addDays, clean, dayNumber, dayOrNull, stamp, todayOf, type Clock } from './small.ts';
import { pictureType } from './small.ts';
export { pictureType };

export const PLAN_ITEM_KINDS = ['task', 'recipe', 'thing', 'media', 'project'] as const;

/**
 * The parts a plan can use, in the order they show. A plan checks the ones it needs, so a birthday is not asked
 * about decorations and a trip is not asked about cards. `ready` parts can be checked now; the rest come with the
 * holiday and trip pages joining plans.
 */
export const PLAN_PARTS = [
  { key: 'food', label: 'Food', ready: true },
  { key: 'guests', label: 'Guests', ready: true },
  { key: 'cards', label: 'Cards', ready: true },
  { key: 'gifts', label: 'Gifts', ready: true },
  { key: 'decorations', label: 'Decorations', ready: true },
  { key: 'budget', label: 'Budget', ready: true },
  { key: 'more_days', label: 'More than one day', ready: true },
  { key: 'when_where', label: 'When and where', ready: true },
  { key: 'traditions', label: 'Traditions', ready: true },
  { key: 'tasks', label: 'Helpers and tasks', ready: true },
  { key: 'bring', label: 'Bring list', ready: true },
  { key: 'seasons', label: 'Seasons and licenses', ready: true },
  { key: 'harvest', label: 'Harvest log', ready: true },
  { key: 'after_trip', label: 'After the trip', ready: true },
  { key: 'media', label: 'To watch, hear or read', ready: true },
  { key: 'projects', label: 'Projects', ready: true },
] as const;
export type PlanPart = (typeof PLAN_PARTS)[number]['key'];
const PART_KEYS: readonly string[] = PLAN_PARTS.map((p) => p.key);
/** Which part holds each kind of item. */
const PART_OF_ITEM: Record<PlanItemKind, PlanPart> = { task: 'tasks', recipe: 'food', thing: 'bring', media: 'media', project: 'projects' };
/** What a new plan shows, unless it says otherwise. */
const FIRST_PARTS: PlanPart[] = ['food', 'budget', 'tasks', 'bring'];

/**
 * Starting points for a new plan: each checks the parts that kind of plan usually needs, so nobody starts from a
 * blank list. Any part can be checked or taken off afterwards.
 */
export const PLAN_STARTS: readonly { key: string; label: string; parts: PlanPart[]; longer: boolean }[] = [
  { key: 'trip', label: 'A trip', parts: ['food', 'budget', 'more_days', 'bring', 'after_trip'], longer: true },
  { key: 'gathering', label: 'A gathering', parts: ['food', 'guests', 'budget', 'tasks'], longer: false },
  { key: 'birthday', label: 'A birthday', parts: ['food', 'guests', 'gifts', 'budget', 'tasks'], longer: false },
  { key: 'other', label: 'Something else', parts: FIRST_PARTS, longer: false },
];
/** The starting points with their parts in words, for the page that offers them. */
export const planStarts = () => PLAN_STARTS.map((s) => ({ key: s.key, label: s.label, longer: s.longer, parts: s.parts.map((key) => PLAN_PARTS.find((p) => p.key === key)!.label) }));

/** The parts asked for, checked: known keys only, each once, in the order they show. */
export function partsChecked(parts: readonly string[]): PlanPart[] {
  for (const p of parts) if (!PART_KEYS.includes(p)) throw new Problem(400, `${p} isn't one of a plan's parts`);
  return PLAN_PARTS.map((p) => p.key).filter((key) => parts.includes(key));
}
/** A plan's parts: those it saved, or for a plan from before parts, the ones it has something in. */
function partsOf(saved: string | null, kinds: string[], days: number): PlanPart[] {
  if (saved !== null) return PLAN_PARTS.map((p) => p.key).filter((key) => saved.split(',').includes(key));
  // Budget too: every plan had its goal box before parts.
  const used = new Set<string>(['budget', ...kinds.map((k) => PART_OF_ITEM[k as PlanItemKind]).filter(Boolean)]);
  if (days > 1) used.add('more_days');
  if (used.size === 0) for (const p of FIRST_PARTS) used.add(p);
  return PLAN_PARTS.map((p) => p.key).filter((key) => used.has(key));
}
export type PlanItemKind = (typeof PLAN_ITEM_KINDS)[number];

export type PlanInput = {
  name: string;
  /** The day, or the first of several, as 2046-03-05. */
  start_day: string;
  end_day?: string | null;
  /** What it's for, written ahead. */
  note?: string | null;
  /** How it went, written afterwards. */
  story?: string | null;
  /** The parts it uses, for a new plan. Left out: Food, Budget, Helpers and tasks and Bring list, and More than one day when it is. */
  parts?: string[] | null;
  /** A starting point (trip, gathering, birthday, other) that checks the parts for it, when `parts` is left out. */
  start?: string | null;
};
export type PlanItemInput = {
  kind: string;
  /** For a task: an upkeep job to put on the plan as a line that links to it (the label is the job's name). */
  job_id?: number | null;
  /** Which recipe, thing, title or project. Not for a task. */
  ref_id?: number | null;
  /** A task's words. For the rest, left out: the name of what it points at is used. */
  label?: string | null;
  /** How many of a thing are needed. */
  quantity?: number | null;
  note?: string | null;
  done?: boolean;
  /** For a recipe that starts frozen: how many pounds, so the countdown says when to thaw it. */
  thaw_pounds?: number | null;
  /** For a recipe: the day to put it on the week's meals, and which meal. Left out: it isn't put on the week. */
  day?: string | null;
  meal?: string | null;
  /** How many it's being made for, when it goes on the week. Left out: as many as the recipe says. */
  servings?: number | null;
};
/** Where a plan's recipe sits on the week's meals, and for how many (null: as many as the recipe says). */
export type OnWeek = { day: string; meal: string; cooked: boolean; servings: number | null };
export type PlanItem = {
  id: number; kind: PlanItemKind; ref_id: number | null; label: string; quantity: number | null; note: string | null; done: boolean;
  /** For a task that is an upkeep job: which job. Its line is done when the job is marked done, and checking it marks the job done. */
  job_id: number | null;
  /** The page of what it points at; null for a task, or when that has since been removed. */
  link: string | null;
  /** For a thing: what you're short of, in words, or null when there's enough. */
  short: string | null;
  /** For a thing: where it's kept. For a title: the formats you have it on. */
  detail: string | null;
  /** For a recipe: the meal it is on the week, or null when it's only noted on the plan. */
  on_week: OnWeek | null;
  /** For a recipe that starts frozen: its weight in pounds. */
  thaw_pounds: number | null;
};
/** Food that is bought or brought, not cooked from a recipe. thaw_pounds is set for something that starts frozen. */
export type FoodLine = { id: number; label: string; brought_by: string | null; thaw_pounds: number | null; done: boolean };
export type FoodKind = 'meal' | 'refreshments';
export const FOOD_KINDS: readonly FoodKind[] = ['meal', 'refreshments'];
export type PlanPhoto = { id: number; source: 'kept' | 'immich'; caption: string | null };
/** A line of what is always done on a plan ("Grandpa carves"), checked off for the year. */
export type Tradition = { id: number; words: string; done: boolean };
export type PlanWhen = 'ahead' | 'now' | 'past';
export type PlanSummary = {
  id: number; name: string; start_day: string; end_day: string; when: PlanWhen; note: string | null;
  items: number; tasks_left: number; photos: number; cover_photo: number | null; tag_list: TagRef[];
  /** The parts it shows, in order. */
  parts: PlanPart[];
  /** When it starts and ends on its day (18:30), and where, in the person's own words. Null until set. */
  start_time: string | null; end_time: string | null; place: string | null;
};
/** For a plan that comes back every year: what it is a year of, how it finds its day, and its other years, newest first. */
export type PlanYearly = {
  holiday_id: number; name: string; rule: DateRule; rule_words: string; lead_weeks: number; year: number;
  years: { plan_id: number; year: number; day: string }[];
  /** No year of it is today or still ahead, so the next one can be started from the latest. */
  next_due: boolean;
};
export type Plan = PlanSummary & {
  story: string | null; items_list: PlanItem[]; photos_list: PlanPhoto[]; /** What the calendar holds for its days, once they've come. */ happened: Entry[];
  /** Set when it comes back every year (see holidays.ts); null for a one-time plan. */
  yearly: PlanYearly | null;
  /** When the food is served (18:00), or null before it is set. */
  served_at: string | null;
  /** A meal, or refreshments. */
  food_kind: FoodKind;
  /** Food that is bought or brought. */
  food_lines: FoodLine[];
  /** What is always done, in short lines, in the order kept. */
  traditions: Tradition[];
};

const MAX_DAYS = 62;
const MEALS = ['breakfast', 'lunch', 'dinner', 'snack'];
/** How long before a plan's first day its food may be made. */
export const EARLY_DAYS = 7;
const MAX_PHOTOS = 80;
const MAX_FOOD_LINES = 100;
const MAX_TRADITIONS = 100;
const timeOk = (t: unknown): t is string => typeof t === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(t);
export const MAX_PHOTO_BYTES = 3_000_000;
const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

type Slot = { day: string; meal: string; servings: number | null };
type PlanRow = { id: number; name: string; start_day: string; end_day: string; note: string | null; story: string | null; served_at: string | null; food_kind: FoodKind | null; start_time: string | null; end_time: string | null; place: string | null };
type ItemRow = { id: number; plan_id: number; kind: PlanItemKind; ref_id: number | null; label: string; quantity: number | null; note: string | null; done: number; meal_plan_id: number | null; thaw_pounds: number | null; job_id: number | null; job_seen: number };
const ITEM_COLUMNS = 'id, plan_id, kind, ref_id, label, quantity, note, done, meal_plan_id, thaw_pounds, job_id, job_seen';


export function plans(db: Db, owner: number, clock: Clock = () => new Date()) {
  const now = () => stamp(clock());
  const when = (row: { start_day: string; end_day: string }): PlanWhen => {
    const today = todayOf(clock);
    return row.end_day < today ? 'past' : row.start_day > today ? 'ahead' : 'now';
  };

  function checked(input: PlanInput): Value[] {
    const name = clean(input.name, 200);
    if (!name) throw new Problem(400, 'Give it a name');
    dayNumber(input.start_day);
    const end = dayOrNull(input.end_day) ?? input.start_day;
    if (dayNumber(end) < dayNumber(input.start_day)) throw new Problem(400, "It can't end before it starts");
    if (dayNumber(end) - dayNumber(input.start_day) >= MAX_DAYS) throw new Problem(400, `A plan runs for ${MAX_DAYS} days at most`);
    return [name, input.start_day, end, clean(input.note, 5000), clean(input.story, 20_000)];
  }

  async function row(q: Queries, id: number): Promise<PlanRow> {
    const found = await q.get<PlanRow>('SELECT id, name, start_day, end_day, note, story, served_at, food_kind, start_time, end_time, place FROM plans WHERE id = ? AND owner_id = ?', [id, owner]);
    if (!found) throw new Problem(404, "That plan isn't here anymore. It may have been deleted.");
    return found;
  }

  /** The name of what an item points at, checking it is the person's own. */
  async function pointedAt(q: Queries, kind: PlanItemKind, ref: number): Promise<string> {
    const table = { recipe: ['recipes', 'title'], thing: ['items', 'name'], media: ['media', 'title'], project: ['projects', 'name'] }[kind as Exclude<PlanItemKind, 'task'>];
    const found = await q.get<{ label: string }>(`SELECT ${table[1]} AS label FROM ${table[0]} WHERE id = ? AND owner_id = ?`, [ref, owner]);
    if (!found) throw new Problem(404, "That isn't there to add");
    return found.label;
  }

  async function itemValues(q: Queries, input: PlanItemInput): Promise<{ kind: PlanItemKind; ref: number | null; label: string; quantity: number | null; note: string | null; job: number | null }> {
    if (!PLAN_ITEM_KINDS.includes(input.kind as PlanItemKind)) throw new Problem(400, "That isn't something a plan holds");
    const kind = input.kind as PlanItemKind;
    const quantity = input.quantity ?? null;
    if (quantity !== null && !(Number.isFinite(quantity) && quantity > 0)) throw new Problem(400, 'How many is a number above nothing');
    if (kind === 'task' && input.job_id != null) {
      // An upkeep job: its name is the line, and it has to be one the person can see.
      const job = await q.get<{ id: number; name: string }>('SELECT id, name FROM upkeep_jobs WHERE id = ? AND (owner_id = ? OR assigned_to = ?)', [input.job_id, owner, owner]);
      if (!job) throw new Problem(404, "That job isn't there to add");
      return { kind, ref: null, label: job.name, quantity: null, note: clean(input.note, 1000), job: job.id };
    }
    if (kind === 'task') {
      const label = clean(input.label, 300);
      if (!label) throw new Problem(400, 'Say what needs doing');
      return { kind, ref: null, label, quantity: null, note: clean(input.note, 1000), job: null };
    }
    if (input.ref_id == null) throw new Problem(400, 'Choose what to add');
    return { kind, ref: input.ref_id, label: await pointedAt(q, kind, input.ref_id), quantity: kind === 'thing' ? quantity : null, note: clean(input.note, 1000), job: null };
  }

  /** The day and meal asked for, checked against the plan's days; null when the recipe isn't to go on the week. */
  function slotFor(plan: { start_day: string; end_day: string }, day: string | null | undefined, meal: string | null | undefined, servings?: number | null): Slot | null {
    if (!day) return null;
    if (servings != null && !(servings > 0 && servings <= 1000)) throw new Problem(400, 'Servings is a number above 0');
    const wanted = meal ?? 'dinner';
    if (!MEALS.includes(wanted)) throw new Problem(400, 'Pick one: breakfast, lunch, dinner or a snack.');
    if (dayNumber(day) < dayNumber(plan.start_day) - EARLY_DAYS || dayNumber(day) > dayNumber(plan.end_day)) {
      throw new Problem(400, `Choose one of the plan's days, or one of the ${EARLY_DAYS} before it`);
    }
    return { day, meal: wanted, servings: servings ?? null };
  }
  const putOnWeek = async (q: Queries, recipeId: number, slot: Slot): Promise<number> =>
    (await q.run('INSERT INTO meal_plan (owner_id, day, meal, recipe_id, title, servings, created_at) VALUES (?, ?, ?, ?, NULL, ?, ?)', [owner, slot.day, slot.meal, recipeId, slot.servings, now()])).lastId;
  /** Take a plan's meal off the week, unless it has been cooked: that happened, and stays. */
  const offWeek = (q: Queries, mealId: number | null) =>
    (mealId === null ? Promise.resolve() : q.run('DELETE FROM meal_plan WHERE id = ? AND owner_id = ? AND cooked_on IS NULL', [mealId, owner]).then(() => {}));

  /** A plan's items as they stand now: names refreshed from what they point at, and what's short said. */
  async function itemsOf(q: Queries, planId: number): Promise<PlanItem[]> {
    const rows = await q.all<ItemRow>(`SELECT ${ITEM_COLUMNS} FROM plan_items WHERE plan_id = ? ORDER BY sort_order, id`, [planId]);
    const meals = new Map((await q.all<{ id: number; day: string; meal: string; cooked_on: string | null; servings: number | null }>(
      'SELECT m.id, m.day, m.meal, m.cooked_on, m.servings FROM meal_plan m JOIN plan_items i ON i.meal_plan_id = m.id WHERE i.plan_id = ? AND m.owner_id = ?', [planId, owner])).map((m) => [m.id, m]));
    const names = async (table: string, column: string) =>
      new Map((await q.all<{ id: number; label: string }>(`SELECT id, ${column} AS label FROM ${table} WHERE owner_id = ?`, [owner])).map((r) => [r.id, r.label]));
    // Upkeep jobs on the plan: their names now, and whether each has been marked done since the line was added.
    const jobIds = [...new Set(rows.filter((r) => r.kind === 'task' && r.job_id !== null).map((r) => r.job_id!))];
    const jobNames = new Map<number, string>();
    const jobLast = new Map<number, number>();
    if (jobIds.length > 0) {
      const marks = jobIds.map(() => '?').join(', ');
      for (const j of await q.all<{ id: number; name: string }>(`SELECT j.id, j.name FROM upkeep_jobs j WHERE j.id IN (${marks}) AND (j.owner_id = ? OR j.assigned_to = ?)`, [...jobIds, owner, owner])) jobNames.set(j.id, j.name);
      for (const d of await q.all<{ job_id: number; last: number }>(`SELECT job_id, MAX(id) AS last FROM upkeep_done WHERE job_id IN (${marks}) GROUP BY job_id`, jobIds)) jobLast.set(d.job_id, d.last);
    }
    const has = (kind: PlanItemKind) => rows.some((r) => r.kind === kind);
    const recipes = has('recipe') ? await names('recipes', 'title') : new Map<number, string>();
    const projectNames = has('project') ? await names('projects', 'name') : new Map<number, string>();
    const things = has('thing') ? new Map((await inventory(db, owner, clock).listItems()).map((item) => [item.id, item])) : new Map();
    const titles = has('media') ? new Map((await q.all<{ id: number; title: string; formats: string | null }>(
      `SELECT m.id, m.title, (SELECT GROUP_CONCAT(DISTINCT c.format) FROM media_copies c WHERE c.media_id = m.id) AS formats FROM media m WHERE m.owner_id = ?`, [owner])).map((r) => [r.id, r])) : new Map();

    return rows.map((r): PlanItem => {
      const meal = r.meal_plan_id !== null ? meals.get(r.meal_plan_id) : undefined;
      if (r.kind === 'task' && r.job_id !== null && jobNames.has(r.job_id)) {
        return { id: r.id, kind: r.kind, ref_id: null, quantity: null, note: r.note, done: (jobLast.get(r.job_id) ?? 0) > r.job_seen, thaw_pounds: null, short: null, detail: null, on_week: null,
          job_id: r.job_id, label: jobNames.get(r.job_id)!, link: `/things/upkeep/${r.job_id}` };
      }
      const base = { id: r.id, kind: r.kind, ref_id: r.ref_id, quantity: r.quantity, note: r.note, done: r.done === 1, thaw_pounds: r.thaw_pounds, job_id: null as number | null, short: null as string | null, detail: null as string | null,
        on_week: meal ? { day: meal.day, meal: meal.meal, cooked: meal.cooked_on !== null, servings: meal.servings } : null };
      if (r.kind === 'task' || r.ref_id === null) return { ...base, label: r.label, link: null };
      if (r.kind === 'recipe') return { ...base, label: recipes.get(r.ref_id) ?? r.label, link: recipes.has(r.ref_id) ? `/recipes/${r.ref_id}` : null };
      if (r.kind === 'project') return { ...base, label: projectNames.get(r.ref_id) ?? r.label, link: projectNames.has(r.ref_id) ? `/projects/${r.ref_id}` : null };
      if (r.kind === 'media') {
        const title = titles.get(r.ref_id);
        return { ...base, label: title?.title ?? r.label, link: title ? `/media/${r.ref_id}` : null, detail: title?.formats?.split(',').join(', ') ?? null };
      }
      const thing = things.get(r.ref_id);
      if (!thing) return { ...base, label: r.label, link: null, short: "it's no longer among your things" };
      const need = r.quantity ?? 1;
      const short = thing.quantity !== null && thing.quantity < need ? `needs ${need}${thing.unit ? ` ${thing.unit}` : ''}, and you have ${thing.amount}` : null;
      return { ...base, label: thing.name, link: '/things', short, detail: thing.place };
    });
  }

  const foodOf = async (q: Queries, planId: number): Promise<FoodLine[]> =>
    (await q.all<{ id: number; label: string; brought_by: string | null; thaw_pounds: number | null; done: number }>(
      'SELECT id, label, brought_by, thaw_pounds, done FROM plan_food WHERE plan_id = ? ORDER BY sort_order, id', [planId])).map((f) => ({ ...f, done: f.done === 1 }));
  const traditionsOf = async (q: Queries, planId: number): Promise<Tradition[]> =>
    (await q.all<{ id: number; words: string; done: number }>('SELECT id, words, done FROM plan_traditions WHERE plan_id = ? ORDER BY sort_order, id', [planId])).map((r) => ({ ...r, done: r.done === 1 }));
  const planOfTradition = async (q: Queries, id: number): Promise<number> => {
    const found = await q.get<{ plan_id: number }>('SELECT t.plan_id FROM plan_traditions t JOIN plans p ON p.id = t.plan_id WHERE t.id = ? AND p.owner_id = ?', [id, owner]);
    if (!found) throw new Problem(404, "That tradition isn't here anymore. It may have been deleted.");
    return found.plan_id;
  };
  const planOfFood = async (q: Queries, foodId: number): Promise<number> => {
    const found = await q.get<{ plan_id: number }>('SELECT f.plan_id FROM plan_food f JOIN plans p ON p.id = f.plan_id WHERE f.id = ? AND p.owner_id = ?', [foodId, owner]);
    if (!found) throw new Problem(404, "That food isn't here anymore. It may have been deleted.");
    return found.plan_id;
  };
  /** Checks a part the plan doesn't show yet, when something is added to it. */
  async function showPart(tx: Queries, planId: number, part: PlanPart): Promise<void> {
    const saved = (await tx.get<{ parts: string | null }>('SELECT parts FROM plans WHERE id = ?', [planId]))!.parts;
    if (saved !== null && !saved.split(',').includes(part)) {
      await tx.run('UPDATE plans SET parts = ? WHERE id = ?', [partsChecked([...saved.split(',').filter(Boolean), part]).join(','), planId]);
    }
  }
  /** A weight in pounds for something that starts frozen, or null for none. */
  const weightChecked = (pounds: number | null | undefined): number | null => {
    if (pounds === null || pounds === undefined) return null;
    thawDays(pounds);
    if (pounds < 1) throw new Problem(400, 'A frozen thing weighs between 1 and 60 pounds');
    return pounds;
  };

  const photosOf = (q: Queries, planId: number) =>
    q.all<{ id: number; source: 'kept' | 'immich'; caption: string | null }>('SELECT id, source, caption FROM plan_photos WHERE plan_id = ? ORDER BY sort_order, id', [planId]);

  async function summaries(where: string, args: Value[]): Promise<PlanSummary[]> {
    const rows = await db.all<PlanRow & { items: number; tasks_left: number; photos: number; cover_photo: number | null; parts: string | null; kinds: string | null }>(
      `SELECT p.id, p.name, p.start_day, p.end_day, p.note, p.story, p.parts, p.start_time, p.end_time, p.place,
         (SELECT GROUP_CONCAT(DISTINCT i.kind) FROM plan_items i WHERE i.plan_id = p.id) AS kinds,
         (SELECT COUNT(*) FROM plan_items i WHERE i.plan_id = p.id) AS items,
         (SELECT COUNT(*) FROM plan_items i WHERE i.plan_id = p.id AND i.kind = 'task' AND CASE WHEN i.job_id IS NULL THEN i.done = 0 ELSE NOT EXISTS (SELECT 1 FROM upkeep_done d WHERE d.job_id = i.job_id AND d.id > i.job_seen) END) AS tasks_left,
         (SELECT COUNT(*) FROM plan_photos f WHERE f.plan_id = p.id) AS photos,
         (SELECT f.id FROM plan_photos f WHERE f.plan_id = p.id ORDER BY f.sort_order, f.id LIMIT 1) AS cover_photo
       FROM plans p WHERE p.owner_id = ? ${where} ORDER BY p.start_day DESC, p.id DESC`, [owner, ...args]);
    return (await attachTags(db, owner, 'plan', rows)).map(({ story: _story, parts, kinds, ...r }) => ({
      ...r, when: when(r), parts: partsOf(parts, kinds ? kinds.split(',') : [], dayNumber(r.end_day) - dayNumber(r.start_day) + 1),
    }));
  }

  async function whole(id: number): Promise<Plan> {
    const found = await row(db, id);
    const [summary] = await summaries('AND p.id = ?', [id]);
    const today = todayOf(clock);
    // What happened is only what has happened: the plan's days up to today, and never the plan itself.
    const lastSeen = found.end_day < today ? found.end_day : today;
    const happened = found.start_day <= today
      ? (await calendar(db, owner, clock).between(found.start_day, dayNumber(lastSeen) - dayNumber(found.start_day) + 1)).filter((e) => ['meal', 'session', 'media'].includes(e.kind))
      : [];
    return { ...summary!, story: found.story, items_list: await itemsOf(db, id), photos_list: await photosOf(db, id), happened, yearly: await yearlyOf(id),
      served_at: found.served_at, food_kind: found.food_kind ?? 'meal', food_lines: await foodOf(db, id), traditions: await traditionsOf(db, id) };
  }

  /** What a plan is a year of, when it comes back every year. */
  async function yearlyOf(id: number): Promise<PlanYearly | null> {
    const h = await db.get<RuleColumns & { holiday_id: number; name: string; lead_weeks: number; year: number }>(
      `SELECT h.id AS holiday_id, h.name, ${RULE_COLUMN_NAMES.split(', ').map((c) => `h.${c}`).join(', ')}, h.lead_weeks, y.year
       FROM holiday_years y JOIN holidays h ON h.id = y.holiday_id WHERE y.plan_id = ? AND h.owner_id = ?`, [id, owner]);
    if (!h) return null;
    const years = await db.all<{ plan_id: number; year: number; day: string }>(
      'SELECT y.plan_id, y.year, p.start_day AS day FROM holiday_years y JOIN plans p ON p.id = y.plan_id WHERE y.holiday_id = ? AND p.owner_id = ? ORDER BY y.year DESC', [h.holiday_id, owner]);
    const rule = ruleFromColumns(h);
    return { holiday_id: h.holiday_id, name: h.name, rule, rule_words: ruleWords(rule), lead_weeks: h.lead_weeks, year: h.year, years, next_due: !years.some((y) => y.day >= todayOf(clock)) };
  }

  const planOfItem = async (q: Queries, itemId: number): Promise<number> => {
    const found = await q.get<{ plan_id: number }>('SELECT i.plan_id FROM plan_items i JOIN plans p ON p.id = i.plan_id WHERE i.id = ? AND p.owner_id = ?', [itemId, owner]);
    if (!found) throw new Problem(404, "That plan item isn't here anymore. It may have been deleted.");
    return found.plan_id;
  };
  const planOfPhoto = async (q: Queries, photoId: number): Promise<number> => {
    const found = await q.get<{ plan_id: number }>('SELECT f.plan_id FROM plan_photos f JOIN plans p ON p.id = f.plan_id WHERE f.id = ? AND p.owner_id = ?', [photoId, owner]);
    if (!found) throw new Problem(404, "That plan item isn't here anymore. It may have been deleted.");
    return found.plan_id;
  };
  async function roomForPhoto(q: Queries, planId: number): Promise<number> {
    await row(q, planId);
    const count = (await q.get<{ n: number; last: number | null }>('SELECT COUNT(*) AS n, MAX(sort_order) AS last FROM plan_photos WHERE plan_id = ?', [planId]))!;
    if (count.n >= MAX_PHOTOS) throw new Problem(400, `A plan holds ${MAX_PHOTOS} photos at most`);
    return (count.last ?? 0) + 1;
  }

  return {
    /** Every plan, newest first: those ahead and under way, and the ones to look back on. */
    list: async (find: { tag?: number | null } = {}) => onlyTagged(db, owner, 'plan', await summaries('', []), find.tag),
    get: whole,

    async create(input: PlanInput): Promise<Plan> {
      const values = checked(input);
      const longer = values[2] !== values[1];
      const start = input.start == null ? null : PLAN_STARTS.find((s) => s.key === input.start);
      if (start === undefined) throw new Problem(400, 'Pick one: a trip, a gathering, a birthday or something else.');
      // A starting point's More than one day goes by the days given, like a plan with none.
      const first = start ? start.parts.filter((p) => p !== 'more_days') : FIRST_PARTS;
      const parts = partsChecked(input.parts ?? [...first, ...(longer ? ['more_days'] : [])]).join(',');
      const made = await db.run('INSERT INTO plans (owner_id, name, start_day, end_day, note, story, parts, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [owner, ...values, parts, now(), now()]);
      return whole(made.lastId);
    },

    /** Choose the parts a plan shows. What is in a part taken off is kept, and shows again when it is checked. */
    async setParts(id: number, parts: string[]): Promise<Plan> {
      await row(db, id);
      await db.run('UPDATE plans SET parts = ?, updated_at = ? WHERE id = ? AND owner_id = ?', [partsChecked(parts).join(','), now(), id, owner]);
      return whole(id);
    },

    /** Change a plan. Moved to other days, its meals on the week move with it. */
    update(id: number, input: PlanInput): Promise<Plan> {
      const values = checked(input);
      return atomic(db, async (tx) => {
        const old = await row(tx, id);
        await tx.run('UPDATE plans SET name = ?, start_day = ?, end_day = ?, note = ?, story = ?, updated_at = ? WHERE id = ? AND owner_id = ?', [...values, now(), id, owner]);
        const moved = dayNumber(input.start_day) - dayNumber(old.start_day);
        if (moved !== 0) {
          for (const meal of await tx.all<{ id: number; day: string }>(
            'SELECT m.id, m.day FROM meal_plan m JOIN plan_items i ON i.meal_plan_id = m.id WHERE i.plan_id = ? AND m.owner_id = ? AND m.cooked_on IS NULL', [id, owner])) {
            await tx.run('UPDATE meal_plan SET day = ? WHERE id = ?', [addDays(meal.day, moved), meal.id]);
          }
        }
      }).then(() => whole(id));
    },

    /** Remove a plan, with its checklist, its photos, and its meals still to be cooked. What it pointed at is untouched. */
    remove(id: number): Promise<void> {
      return atomic(db, async (tx) => {
        if (!(await tx.get('SELECT id FROM plans WHERE id = ? AND owner_id = ?', [id, owner]))) return;
        for (const item of await tx.all<{ meal_plan_id: number | null }>('SELECT meal_plan_id FROM plan_items WHERE plan_id = ?', [id])) await offWeek(tx, item.meal_plan_id);
        await tx.run('DELETE FROM plans WHERE id = ? AND owner_id = ?', [id, owner]);
        // Its goal stays, with what was put toward it: it just belongs to nothing now.
        await tx.run('UPDATE money_goals SET plan_id = NULL WHERE plan_id = ? AND owner_id = ?', [id, owner]);
        await unlink(tx, 'plan', id);
      });
    },

    /**
     * Start a new plan from an old one: the same things, on new days. The checklist starts unticked; the
     * story and the photos stay with the old one, where they happened.
     */
    copy(id: number, input: { name?: string | null; start_day: string }): Promise<Plan> {
      return atomic(db, async (tx) => {
        const old = await row(tx, id);
        const length = dayNumber(old.end_day) - dayNumber(old.start_day);
        const values = checked({ name: clean(input.name, 200) ?? old.name, start_day: input.start_day, end_day: addDays(input.start_day, length), note: old.note });
        const made = await tx.run('INSERT INTO plans (owner_id, name, start_day, end_day, note, story, parts, served_at, food_kind, start_time, end_time, place, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, (SELECT parts FROM plans WHERE id = ?), ?, ?, ?, ?, ?, ?, ?)', [owner, ...values, id, old.served_at, old.food_kind, old.start_time, old.end_time, old.place, now(), now()]);
        const moved = dayNumber(input.start_day) - dayNumber(old.start_day);
        for (const item of await tx.all<ItemRow>(`SELECT ${ITEM_COLUMNS} FROM plan_items WHERE plan_id = ? ORDER BY sort_order, id`, [id])) {
          // Food that was on the week goes on the new week, the same number of days in.
          const meal = item.meal_plan_id !== null ? await tx.get<Slot>('SELECT day, meal, servings FROM meal_plan WHERE id = ? AND owner_id = ?', [item.meal_plan_id, owner]) : undefined;
          const stillThere = item.kind === 'recipe' && item.ref_id !== null && await tx.get('SELECT id FROM recipes WHERE id = ? AND owner_id = ?', [item.ref_id, owner]);
          const mealId = meal && stillThere ? await putOnWeek(tx, item.ref_id!, { day: addDays(meal.day, moved), meal: meal.meal, servings: meal.servings }) : null;
          // An upkeep job goes along as a line that starts not done: it counts from the latest time the job was marked done.
          const job = item.kind === 'task' ? item.job_id : null;
          const seenNow = job !== null ? (await tx.get<{ last: number | null }>('SELECT MAX(id) AS last FROM upkeep_done WHERE job_id = ?', [job]))!.last ?? 0 : 0;
          await tx.run('INSERT INTO plan_items (plan_id, kind, ref_id, label, quantity, note, done, sort_order, meal_plan_id, thaw_pounds, job_id, job_seen) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)',
            [made.lastId, item.kind, item.ref_id, item.label, item.quantity, item.note, item.id, mealId, item.thaw_pounds, job, seenNow]);
        }
        for (const f of await tx.all<{ label: string; brought_by: string | null; thaw_pounds: number | null; sort_order: number }>(
          'SELECT label, brought_by, thaw_pounds, sort_order FROM plan_food WHERE plan_id = ? ORDER BY sort_order, id', [id])) {
          await tx.run('INSERT INTO plan_food (plan_id, label, brought_by, thaw_pounds, done, sort_order) VALUES (?, ?, ?, ?, 0, ?)', [made.lastId, f.label, f.brought_by, f.thaw_pounds, f.sort_order]);
        }
        // What is always done carries over, not yet done.
        for (const r of await tx.all<{ words: string; sort_order: number }>('SELECT words, sort_order FROM plan_traditions WHERE plan_id = ? ORDER BY sort_order, id', [id])) {
          await tx.run('INSERT INTO plan_traditions (plan_id, words, done, sort_order) VALUES (?, ?, 0, ?)', [made.lastId, r.words, r.sort_order]);
        }
        return made.lastId;
      }).then(whole);
    },

    // ---------- what belongs to it ----------

    addItem(planId: number, input: PlanItemInput): Promise<Plan> {
      return atomic(db, async (tx) => {
        const plan = await row(tx, planId);
        const v = await itemValues(tx, input);
        if (v.ref !== null && await tx.get('SELECT id FROM plan_items WHERE plan_id = ? AND kind = ? AND ref_id = ?', [planId, v.kind, v.ref])) throw new Problem(409, "That's already part of it");
        const slot = v.kind === 'recipe' ? slotFor(plan, input.day, input.meal, input.servings) : null;
        const last = (await tx.get<{ last: number | null }>('SELECT MAX(sort_order) AS last FROM plan_items WHERE plan_id = ?', [planId]))!.last ?? 0;
        if (v.job !== null && await tx.get("SELECT id FROM plan_items WHERE plan_id = ? AND kind = 'task' AND job_id = ?", [planId, v.job])) throw new Problem(409, "That job is already part of it");
        const seenNow = v.job !== null ? (await tx.get<{ last: number | null }>('SELECT MAX(id) AS last FROM upkeep_done WHERE job_id = ?', [v.job]))!.last ?? 0 : 0;
        await tx.run('INSERT INTO plan_items (plan_id, kind, ref_id, label, quantity, note, done, sort_order, meal_plan_id, thaw_pounds, job_id, job_seen) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)',
          [planId, v.kind, v.ref, v.label, v.quantity, v.note, last + 1, slot ? await putOnWeek(tx, v.ref!, slot) : null, v.kind === 'recipe' ? weightChecked(input.thaw_pounds) : null, v.job, seenNow]);
        // Something added to a part the plan doesn't show (from a recipe's page, say) checks that part.
        await showPart(tx, planId, PART_OF_ITEM[v.kind]);
      }).then(() => whole(planId));
    },

    // ---------- when and where ----------

    /**
     * Set when a plan starts and ends on its day, and where it is, in the person's own words (nothing is looked up or sent).
     * A time is written 18:30; an end time needs a start time, and on a one-day plan comes after it. Left out means leave it.
     */
    async setWhenWhere(planId: number, c: { start_time?: string | null; end_time?: string | null; place?: string | null }): Promise<Plan> {
      const old = await row(db, planId);
      const start = c.start_time === undefined ? old.start_time : c.start_time;
      const end = c.end_time === undefined ? old.end_time : c.end_time;
      for (const t of [start, end]) if (t !== null && !timeOk(t)) throw new Problem(400, 'A time is written like 18:30');
      if (end !== null && start === null) throw new Problem(400, 'Say when it starts first');
      if (end !== null && start !== null && old.start_day === old.end_day && end <= start) throw new Problem(400, 'It has to end after it starts');
      const place = c.place === undefined ? old.place : clean(c.place, 200);
      await atomic(db, async (tx) => {
        await tx.run('UPDATE plans SET start_time = ?, end_time = ?, place = ?, updated_at = ? WHERE id = ? AND owner_id = ?', [start, end, place, now(), planId, owner]);
        await showPart(tx, planId, 'when_where');
      });
      return whole(planId);
    },

    // ---------- food ----------

    /** When the food is served and whether it is a meal or refreshments. A new time is when the plan's meals on the week are eaten. */
    async setFood(planId: number, c: { served_at?: string | null; food_kind?: string | null }): Promise<Plan> {
      const old = await row(db, planId);
      const served = c.served_at === undefined ? old.served_at : c.served_at;
      if (served !== null && !timeOk(served)) throw new Problem(400, 'A time is written like 18:00');
      const kind = c.food_kind === undefined || c.food_kind === null ? (old.food_kind ?? 'meal') : c.food_kind;
      if (!FOOD_KINDS.includes(kind as FoodKind)) throw new Problem(400, 'Pick one: a meal or refreshments.');
      await atomic(db, async (tx) => {
        await tx.run('UPDATE plans SET served_at = ?, food_kind = ?, updated_at = ? WHERE id = ? AND owner_id = ?', [served, kind, now(), planId, owner]);
        if (served !== null && served !== old.served_at) {
          await tx.run('UPDATE meal_plan SET eat_time = ? WHERE owner_id = ? AND id IN (SELECT meal_plan_id FROM plan_items WHERE plan_id = ? AND meal_plan_id IS NOT NULL)', [served, owner, planId]);
        }
        await showPart(tx, planId, 'food');
      });
      return whole(planId);
    },

    /** Add food that is bought or brought. A weight makes it a frozen thing to thaw. */
    async addFood(planId: number, input: { label?: string | null; brought_by?: string | null; thaw_pounds?: number | null }): Promise<Plan> {
      await row(db, planId);
      const label = clean(input.label, 200);
      if (!label) throw new Problem(400, 'Say what the food is');
      const pounds = weightChecked(input.thaw_pounds);
      await atomic(db, async (tx) => {
        const count = (await tx.get<{ n: number; last: number | null }>('SELECT COUNT(*) AS n, MAX(sort_order) AS last FROM plan_food WHERE plan_id = ?', [planId]))!;
        if (count.n >= MAX_FOOD_LINES) throw new Problem(400, `A plan holds ${MAX_FOOD_LINES} lines of food at most`);
        await tx.run('INSERT INTO plan_food (plan_id, label, brought_by, thaw_pounds, done, sort_order) VALUES (?, ?, ?, ?, 0, ?)', [planId, label, clean(input.brought_by, 100), pounds, (count.last ?? 0) + 1]);
        await showPart(tx, planId, 'food');
      });
      return whole(planId);
    },

    async updateFood(foodId: number, input: { label?: string | null; brought_by?: string | null; thaw_pounds?: number | null; done?: boolean }): Promise<Plan> {
      const planId = await planOfFood(db, foodId);
      const old = (await db.get<{ label: string; brought_by: string | null; thaw_pounds: number | null; done: number }>('SELECT label, brought_by, thaw_pounds, done FROM plan_food WHERE id = ?', [foodId]))!;
      const label = input.label === undefined ? old.label : clean(input.label, 200);
      if (!label) throw new Problem(400, 'Say what the food is');
      const pounds = input.thaw_pounds === undefined ? old.thaw_pounds : weightChecked(input.thaw_pounds);
      await db.run('UPDATE plan_food SET label = ?, brought_by = ?, thaw_pounds = ?, done = ? WHERE id = ?',
        [label, input.brought_by === undefined ? old.brought_by : clean(input.brought_by, 100), pounds, (input.done ?? old.done === 1) ? 1 : 0, foodId]);
      return whole(planId);
    },

    async removeFood(foodId: number): Promise<Plan> {
      const planId = await planOfFood(db, foodId);
      await db.run('DELETE FROM plan_food WHERE id = ?', [foodId]);
      await db.run('DELETE FROM holiday_ticks WHERE plan_id = ? AND key = ?', [planId, `f${foodId}`]);
      return whole(planId);
    },

    /**
     * Tick it, reword a task, change how many are needed or the note, or, for a recipe, say when it's eaten
     * and for how many: a day puts it on the week's meals (or moves it there), and no day takes it off again.
     */
    async updateItem(itemId: number, input: { label?: string | null; quantity?: number | null; note?: string | null; done?: boolean; day?: string | null; meal?: string | null; servings?: number | null; thaw_pounds?: number | null }): Promise<Plan> {
      const planId = await planOfItem(db, itemId);
      const old = (await db.get<ItemRow>(`SELECT ${ITEM_COLUMNS} FROM plan_items WHERE id = ?`, [itemId]))!;
      if (input.day !== undefined && old.kind === 'recipe' && old.ref_id !== null) {
        const slot = slotFor(await row(db, planId), input.day, input.meal, input.servings);
        await atomic(db, async (tx) => {
          const meal = old.meal_plan_id !== null ? await tx.get<{ id: number; cooked_on: string | null }>('SELECT id, cooked_on FROM meal_plan WHERE id = ? AND owner_id = ?', [old.meal_plan_id, owner]) : undefined;
          if (meal?.cooked_on) throw new Problem(409, "That meal has been cooked, so it stays where it was");
          if (!slot) {
            await offWeek(tx, old.meal_plan_id);
            await tx.run('UPDATE plan_items SET meal_plan_id = NULL WHERE id = ?', [itemId]);
          } else if (meal) {
            await tx.run('UPDATE meal_plan SET day = ?, meal = ?, servings = ? WHERE id = ?', [slot.day, slot.meal, slot.servings, meal.id]);
          } else {
            await pointedAt(tx, 'recipe', old.ref_id!);
            await tx.run('UPDATE plan_items SET meal_plan_id = ? WHERE id = ?', [await putOnWeek(tx, old.ref_id!, slot), itemId]);
          }
        });
      }
      // A line that is an upkeep job: checking it marks the job done, the way Upkeep does; unchecking only stops the line
      // counting what was done so far. The job and what it has done are never taken back from here.
      if (old.kind === 'task' && old.job_id !== null && input.done !== undefined) {
        const last = (await db.get<{ last: number | null }>('SELECT MAX(id) AS last FROM upkeep_done WHERE job_id = ?', [old.job_id]))!.last ?? 0;
        const isDone = last > old.job_seen;
        if (input.done && !isDone) await upkeep(db, owner, clock).done(old.job_id, {});
        else if (!input.done && isDone) await db.run('UPDATE plan_items SET job_seen = ? WHERE id = ?', [last, itemId]);
      }
      const label = old.kind === 'task' && old.job_id === null && input.label !== undefined ? clean(input.label, 300) : old.label;
      if (!label) throw new Problem(400, 'Say what needs doing');
      const quantity = input.quantity === undefined ? old.quantity : input.quantity;
      if (quantity !== null && !(Number.isFinite(quantity) && quantity > 0)) throw new Problem(400, 'How many is a number above nothing');
      const thaw = input.thaw_pounds === undefined ? old.thaw_pounds : weightChecked(input.thaw_pounds);
      await db.run('UPDATE plan_items SET label = ?, quantity = ?, note = ?, done = ?, thaw_pounds = ? WHERE id = ?',
        [label, old.kind === 'thing' ? quantity : null, input.note === undefined ? old.note : clean(input.note, 1000), (input.done ?? old.done === 1) ? 1 : 0, old.kind === 'recipe' ? thaw : null, itemId]);
      return whole(planId);
    },

    /** Take something off the plan. A recipe's meal on the week goes with it, unless it's been cooked. */
    async removeItem(itemId: number): Promise<Plan> {
      const planId = await planOfItem(db, itemId);
      await atomic(db, async (tx) => {
        await offWeek(tx, (await tx.get<{ meal_plan_id: number | null }>('SELECT meal_plan_id FROM plan_items WHERE id = ?', [itemId]))!.meal_plan_id);
        await tx.run('DELETE FROM plan_items WHERE id = ?', [itemId]);
        await tx.run('DELETE FROM holiday_ticks WHERE plan_id = ? AND key = ?', [planId, `t${itemId}`]);
      });
      return whole(planId);
    },

    // ---------- traditions ----------

    /** Add a line of what is always done. Checks the Traditions part when the plan does not show it. */
    async addTradition(planId: number, words: string | null | undefined): Promise<Plan> {
      await row(db, planId);
      const text = clean(words, 200);
      if (!text) throw new Problem(400, 'Say what is always done');
      await atomic(db, async (tx) => {
        const count = (await tx.get<{ n: number; last: number | null }>('SELECT COUNT(*) AS n, MAX(sort_order) AS last FROM plan_traditions WHERE plan_id = ?', [planId]))!;
        if (count.n >= MAX_TRADITIONS) throw new Problem(400, `A plan holds ${MAX_TRADITIONS} traditions at most`);
        await tx.run('INSERT INTO plan_traditions (plan_id, words, done, sort_order) VALUES (?, ?, 0, ?)', [planId, text, (count.last ?? 0) + 1]);
        await showPart(tx, planId, 'traditions');
      });
      return whole(planId);
    },

    /** Reword a line, or check it off or not. */
    async updateTradition(id: number, input: { words?: string | null; done?: boolean }): Promise<Plan> {
      const planId = await planOfTradition(db, id);
      const old = (await db.get<{ words: string; done: number }>('SELECT words, done FROM plan_traditions WHERE id = ?', [id]))!;
      const text = input.words === undefined ? old.words : clean(input.words, 200);
      if (!text) throw new Problem(400, 'Say what is always done');
      await db.run('UPDATE plan_traditions SET words = ?, done = ? WHERE id = ?', [text, (input.done ?? old.done === 1) ? 1 : 0, id]);
      return whole(planId);
    },

    /** Move a line one place up or down the list. */
    async moveTradition(id: number, direction: string): Promise<Plan> {
      if (direction !== 'up' && direction !== 'down') throw new Problem(400, 'Move it up or down');
      const planId = await planOfTradition(db, id);
      await atomic(db, async (tx) => {
        const lines = await tx.all<{ id: number }>('SELECT id FROM plan_traditions WHERE plan_id = ? ORDER BY sort_order, id', [planId]);
        const at = lines.findIndex((l) => l.id === id);
        const to = direction === 'up' ? at - 1 : at + 1;
        if (to < 0 || to >= lines.length) return;
        [lines[at], lines[to]] = [lines[to]!, lines[at]!];
        for (const [n, l] of lines.entries()) await tx.run('UPDATE plan_traditions SET sort_order = ? WHERE id = ?', [n + 1, l.id]);
      });
      return whole(planId);
    },

    async removeTradition(id: number): Promise<Plan> {
      const planId = await planOfTradition(db, id);
      await db.run('DELETE FROM plan_traditions WHERE id = ?', [id]);
      return whole(planId);
    },

    // ---------- photos ----------

    /** Keep a photo with the plan: one picked from a phone or computer. */
    async keepPhoto(planId: number, bytes: Uint8Array, caption?: string | null): Promise<Plan> {
      const type = pictureType(bytes);
      if (!type || !PHOTO_TYPES.includes(type)) throw new Problem(400, "That isn't a photo Life Is can keep (JPEG, PNG or WebP)");
      if (bytes.length > MAX_PHOTO_BYTES) throw new Problem(400, 'That photo is too large to keep');
      const order = await roomForPhoto(db, planId);
      await db.run('INSERT INTO plan_photos (plan_id, source, type, bytes, caption, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [planId, 'kept', type, bytes, clean(caption, 300), order, now()]);
      return whole(planId);
    },

    /** Link a photo that lives in a photo library. Only which one is kept; the picture stays there. */
    async linkPhoto(planId: number, source: 'immich', assetId: string, caption?: string | null): Promise<Plan> {
      if (!/^[0-9a-fA-F-]{8,64}$/.test(assetId)) throw new Problem(400, "That isn't a photo from the library");
      const order = await roomForPhoto(db, planId);
      if (await db.get('SELECT id FROM plan_photos WHERE plan_id = ? AND source = ? AND asset_id = ?', [planId, source, assetId])) return whole(planId);
      await db.run('INSERT INTO plan_photos (plan_id, source, asset_id, caption, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?)', [planId, source, assetId, clean(caption, 300), order, now()]);
      return whole(planId);
    },

    /** A photo, for showing: its bytes when it's kept here, or which library photo it is when it's linked. */
    async photo(photoId: number): Promise<{ source: 'kept'; type: string; bytes: Uint8Array } | { source: 'immich'; asset_id: string }> {
      await planOfPhoto(db, photoId);
      const found = (await db.get<{ source: 'kept' | 'immich'; type: string | null; bytes: Uint8Array | null; asset_id: string | null }>(
        'SELECT source, type, bytes, asset_id FROM plan_photos WHERE id = ?', [photoId]))!;
      return found.source === 'kept' ? { source: 'kept', type: found.type!, bytes: found.bytes! } : { source: 'immich', asset_id: found.asset_id! };
    },

    async captionPhoto(photoId: number, caption: string | null): Promise<Plan> {
      const planId = await planOfPhoto(db, photoId);
      await db.run('UPDATE plan_photos SET caption = ? WHERE id = ?', [clean(caption, 300), photoId]);
      return whole(planId);
    },

    /** Take a photo off the plan. A kept one is deleted; a linked one stays in its library. */
    async removePhoto(photoId: number): Promise<Plan> {
      const planId = await planOfPhoto(db, photoId);
      await db.run('DELETE FROM plan_photos WHERE id = ?', [photoId]);
      return whole(planId);
    },
  };
}

export type Plans = ReturnType<typeof plans>;
