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
import { inventory } from './inventory.ts';
import { Problem } from './problem.ts';
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
  { key: 'when_where', label: 'When and where', ready: false },
  { key: 'traditions', label: 'Traditions', ready: false },
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
  /** Which recipe, thing, title or project. Not for a task. */
  ref_id?: number | null;
  /** A task's words. For the rest, left out: the name of what it points at is used. */
  label?: string | null;
  /** How many of a thing are needed. */
  quantity?: number | null;
  note?: string | null;
  done?: boolean;
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
  /** The page of what it points at; null for a task, or when that has since been removed. */
  link: string | null;
  /** For a thing: what you're short of, in words, or null when there's enough. */
  short: string | null;
  /** For a thing: where it's kept. For a title: the formats you have it on. */
  detail: string | null;
  /** For a recipe: the meal it is on the week, or null when it's only noted on the plan. */
  on_week: OnWeek | null;
};
export type PlanPhoto = { id: number; source: 'kept' | 'immich'; caption: string | null };
export type PlanWhen = 'ahead' | 'now' | 'past';
export type PlanSummary = {
  id: number; name: string; start_day: string; end_day: string; when: PlanWhen; note: string | null;
  items: number; tasks_left: number; photos: number; cover_photo: number | null; tag_list: TagRef[];
  /** The parts it shows, in order. */
  parts: PlanPart[];
};
export type Plan = PlanSummary & { story: string | null; items_list: PlanItem[]; photos_list: PlanPhoto[]; /** What the calendar holds for its days, once they've come. */ happened: Entry[] };

const MAX_DAYS = 62;
const MEALS = ['breakfast', 'lunch', 'dinner', 'snack'];
/** How long before a plan's first day its food may be made. */
export const EARLY_DAYS = 7;
const MAX_PHOTOS = 80;
export const MAX_PHOTO_BYTES = 3_000_000;
const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

type Slot = { day: string; meal: string; servings: number | null };
type PlanRow = { id: number; name: string; start_day: string; end_day: string; note: string | null; story: string | null };
type ItemRow = { id: number; plan_id: number; kind: PlanItemKind; ref_id: number | null; label: string; quantity: number | null; note: string | null; done: number; meal_plan_id: number | null };
const ITEM_COLUMNS = 'id, plan_id, kind, ref_id, label, quantity, note, done, meal_plan_id';


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
    const found = await q.get<PlanRow>('SELECT id, name, start_day, end_day, note, story FROM plans WHERE id = ? AND owner_id = ?', [id, owner]);
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

  async function itemValues(q: Queries, input: PlanItemInput): Promise<{ kind: PlanItemKind; ref: number | null; label: string; quantity: number | null; note: string | null }> {
    if (!PLAN_ITEM_KINDS.includes(input.kind as PlanItemKind)) throw new Problem(400, "That isn't something a plan holds");
    const kind = input.kind as PlanItemKind;
    const quantity = input.quantity ?? null;
    if (quantity !== null && !(Number.isFinite(quantity) && quantity > 0)) throw new Problem(400, 'How many is a number above nothing');
    if (kind === 'task') {
      const label = clean(input.label, 300);
      if (!label) throw new Problem(400, 'Say what needs doing');
      return { kind, ref: null, label, quantity: null, note: clean(input.note, 1000) };
    }
    if (input.ref_id == null) throw new Problem(400, 'Choose what to add');
    return { kind, ref: input.ref_id, label: await pointedAt(q, kind, input.ref_id), quantity: kind === 'thing' ? quantity : null, note: clean(input.note, 1000) };
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
    const has = (kind: PlanItemKind) => rows.some((r) => r.kind === kind);
    const recipes = has('recipe') ? await names('recipes', 'title') : new Map<number, string>();
    const projectNames = has('project') ? await names('projects', 'name') : new Map<number, string>();
    const things = has('thing') ? new Map((await inventory(db, owner, clock).listItems()).map((item) => [item.id, item])) : new Map();
    const titles = has('media') ? new Map((await q.all<{ id: number; title: string; formats: string | null }>(
      `SELECT m.id, m.title, (SELECT GROUP_CONCAT(DISTINCT c.format) FROM media_copies c WHERE c.media_id = m.id) AS formats FROM media m WHERE m.owner_id = ?`, [owner])).map((r) => [r.id, r])) : new Map();

    return rows.map((r): PlanItem => {
      const meal = r.meal_plan_id !== null ? meals.get(r.meal_plan_id) : undefined;
      const base = { id: r.id, kind: r.kind, ref_id: r.ref_id, quantity: r.quantity, note: r.note, done: r.done === 1, short: null as string | null, detail: null as string | null,
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

  const photosOf = (q: Queries, planId: number) =>
    q.all<{ id: number; source: 'kept' | 'immich'; caption: string | null }>('SELECT id, source, caption FROM plan_photos WHERE plan_id = ? ORDER BY sort_order, id', [planId]);

  async function summaries(where: string, args: Value[]): Promise<PlanSummary[]> {
    const rows = await db.all<PlanRow & { items: number; tasks_left: number; photos: number; cover_photo: number | null; parts: string | null; kinds: string | null }>(
      `SELECT p.id, p.name, p.start_day, p.end_day, p.note, p.story, p.parts,
         (SELECT GROUP_CONCAT(DISTINCT i.kind) FROM plan_items i WHERE i.plan_id = p.id) AS kinds,
         (SELECT COUNT(*) FROM plan_items i WHERE i.plan_id = p.id) AS items,
         (SELECT COUNT(*) FROM plan_items i WHERE i.plan_id = p.id AND i.kind = 'task' AND i.done = 0) AS tasks_left,
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
    return { ...summary!, story: found.story, items_list: await itemsOf(db, id), photos_list: await photosOf(db, id), happened };
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
        const made = await tx.run('INSERT INTO plans (owner_id, name, start_day, end_day, note, story, parts, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, (SELECT parts FROM plans WHERE id = ?), ?, ?)', [owner, ...values, id, now(), now()]);
        const moved = dayNumber(input.start_day) - dayNumber(old.start_day);
        for (const item of await tx.all<ItemRow>(`SELECT ${ITEM_COLUMNS} FROM plan_items WHERE plan_id = ? ORDER BY sort_order, id`, [id])) {
          // Food that was on the week goes on the new week, the same number of days in.
          const meal = item.meal_plan_id !== null ? await tx.get<Slot>('SELECT day, meal, servings FROM meal_plan WHERE id = ? AND owner_id = ?', [item.meal_plan_id, owner]) : undefined;
          const stillThere = item.kind === 'recipe' && item.ref_id !== null && await tx.get('SELECT id FROM recipes WHERE id = ? AND owner_id = ?', [item.ref_id, owner]);
          const mealId = meal && stillThere ? await putOnWeek(tx, item.ref_id!, { day: addDays(meal.day, moved), meal: meal.meal, servings: meal.servings }) : null;
          await tx.run('INSERT INTO plan_items (plan_id, kind, ref_id, label, quantity, note, done, sort_order, meal_plan_id) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)',
            [made.lastId, item.kind, item.ref_id, item.label, item.quantity, item.note, item.id, mealId]);
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
        await tx.run('INSERT INTO plan_items (plan_id, kind, ref_id, label, quantity, note, done, sort_order, meal_plan_id) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)',
          [planId, v.kind, v.ref, v.label, v.quantity, v.note, last + 1, slot ? await putOnWeek(tx, v.ref!, slot) : null]);
        // Something added to a part the plan doesn't show (from a recipe's page, say) checks that part.
        const saved = (await tx.get<{ parts: string | null }>('SELECT parts FROM plans WHERE id = ?', [planId]))!.parts;
        const part = PART_OF_ITEM[v.kind];
        if (saved !== null && !saved.split(',').includes(part)) {
          await tx.run('UPDATE plans SET parts = ? WHERE id = ?', [partsChecked([...saved.split(',').filter(Boolean), part]).join(','), planId]);
        }
      }).then(() => whole(planId));
    },

    /**
     * Tick it, reword a task, change how many are needed or the note, or, for a recipe, say when it's eaten
     * and for how many: a day puts it on the week's meals (or moves it there), and no day takes it off again.
     */
    async updateItem(itemId: number, input: { label?: string | null; quantity?: number | null; note?: string | null; done?: boolean; day?: string | null; meal?: string | null; servings?: number | null }): Promise<Plan> {
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
      const label = old.kind === 'task' && input.label !== undefined ? clean(input.label, 300) : old.label;
      if (!label) throw new Problem(400, 'Say what needs doing');
      const quantity = input.quantity === undefined ? old.quantity : input.quantity;
      if (quantity !== null && !(Number.isFinite(quantity) && quantity > 0)) throw new Problem(400, 'How many is a number above nothing');
      await db.run('UPDATE plan_items SET label = ?, quantity = ?, note = ?, done = ? WHERE id = ?',
        [label, old.kind === 'thing' ? quantity : null, input.note === undefined ? old.note : clean(input.note, 1000), (input.done ?? old.done === 1) ? 1 : 0, itemId]);
      return whole(planId);
    },

    /** Take something off the plan. A recipe's meal on the week goes with it, unless it's been cooked. */
    async removeItem(itemId: number): Promise<Plan> {
      const planId = await planOfItem(db, itemId);
      await atomic(db, async (tx) => {
        await offWeek(tx, (await tx.get<{ meal_plan_id: number | null }>('SELECT meal_plan_id FROM plan_items WHERE id = ?', [itemId]))!.meal_plan_id);
        await tx.run('DELETE FROM plan_items WHERE id = ?', [itemId]);
      });
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
