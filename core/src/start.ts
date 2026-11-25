/**
 * The two-minute start: a few short questions, asked once to a brand-new household, that set Life Is up for
 * them so the first page is not an empty one.
 *
 * Who lives here (the children become household members for chores; pets are made; adults are only named),
 * what they want help with (the same profile `life.ts` keeps, so sections show and hide exactly as before),
 * the usual upkeep to begin with (ready-made sets, `upkeep.ts`), and, if they want it, a few examples to look at.
 *
 * Every step is saved when it is finished, and each can be done twice without adding anything twice. How far
 * they got, and exactly which examples were made, is kept in the person's settings (no table of its own), so
 * "Clear the examples" takes away those and only those, and keeps any the person has since changed.
 *
 * Who is asked: only a brand-new person (nothing of theirs in any part of Life Is yet, and the question about
 * what to look after not yet answered). That also keeps it out of anything a trial could have ended on, and
 * out of the demo, which is full from the start. Nothing here reaches outside Life Is.
 */
import { calendar } from './calendar.ts';
import type { Db } from './db.ts';
import { inventory } from './inventory.ts';
import { kitchen } from './kitchen.ts';
import { AREAS, life } from './life.ts';
import { pets } from './pets.ts';
import { Problem } from './problem.ts';
import { vehiclesOf } from './recalls.ts';
import { addDays, clean, dayNumber, labelKey, todayOf, type Clock } from './small.ts';
import { readySets, upkeep } from './upkeep.ts';

const SETTING = 'start_setup';

export type Status = 'open' | 'closed' | 'finished' | 'skipped' | 'dismissed';
export type PetKind = 'dog' | 'cat' | 'other';
export const PET_KINDS: readonly PetKind[] = ['dog', 'cat', 'other'];

/** What a person can ask for help with, in their words, and the interests of life.ts each one turns on. */
export const WANTS: { key: string; label: string; about: string; areas: string[]; first: boolean }[] = [
  { key: 'meals', label: 'Meals and groceries', about: 'Recipes, the week’s dinners and the grocery list.', areas: ['eating'], first: true },
  { key: 'things', label: 'What we own and where it is', about: 'Things by room, shelf and bin.', areas: ['keeping'], first: true },
  { key: 'house', label: 'Keeping up the house and car', about: 'Filters, alarms, oil changes, bills and renewals.', areas: ['keeping'], first: true },
  { key: 'money', label: 'Money for the month', about: 'A plan for each kind of spending, and what is left.', areas: ['spending'], first: false },
  { key: 'calendar', label: 'The family calendar', about: 'Appointments, birthdays and plans.', areas: ['planning'], first: false },
  { key: 'projects', label: 'Projects and hobbies', about: 'Anything made or done over more than a day.', areas: ['making'], first: false },
  { key: 'media', label: 'Books, films and music', about: 'What you own, and what you have watched, read or heard.', areas: ['enjoying'], first: false },
];
/**
 * The one question asked first: what bugs a person most at home. It sets the parts that start checked, the first
 * step on the Start here card, and the card Home opens on.
 */
export const PROBLEMS: { key: string; label: string; wants: string[]; step: string; card: string }[] = [
  { key: 'meals', label: 'Meals: what to cook and what to buy', wants: ['meals'], step: 'recipe', card: 'kitchen' },
  { key: 'clutter', label: 'Clutter: too much stuff, no homes for it', wants: ['things'], step: 'room', card: 'things' },
  { key: 'bills', label: 'Bills and things that come due', wants: ['house', 'money'], step: 'bill', card: 'upkeep' },
  { key: 'calendar', label: 'The calendar: who is where, and when', wants: ['calendar'], step: 'calendar', card: 'days' },
  { key: 'chores', label: 'Chores: who does what', wants: ['house'], step: 'chore', card: 'upkeep' },
  { key: 'tracking', label: 'Keeping track of things we own', wants: ['things', 'house'], step: 'room', card: 'things' },
];
const HOBBIES = AREAS.filter((area) => area.group === 'doing').map(({ key, label }) => ({ key, label }));

type Examples = {
  made_on: string;
  recipes: { id: number; title: string; updated_at: string; fingerprint: string }[];
  meals: { id: number; day: string; meal: string; recipe_id: number; servings: number | null }[];
  groceries: { id: number; label: string; quantity: number | null; unit: string | null }[];
  /** Things, upkeep jobs and calendar dates, each with what its row held when made, so a change is seen. */
  things?: { id: number; name: string; fingerprint: string }[];
  jobs?: { id: number; name: string; fingerprint: string }[];
  events?: { id: number; name: string; fingerprint: string }[];
};
type Made = { members: number; pets: number; jobs: number; recipes: number };
type Saved = {
  status: Status;
  /** The step to show next. */
  step: number;
  began: string;
  adults: string[];
  children: string[];
  pets: { kind: PetKind; name: string }[];
  wants: string[];
  hobbies: string[];
  has_car: boolean | null;
  sets: string[];
  sample: boolean;
  examples: Examples | null;
  made: Made;
  /** The getting-started card was put away. */
  hidden: boolean;
  /** What bugs them most at home (a key of PROBLEMS), 'none' when they passed it by, null when not yet asked. */
  problem: string | null;
  /** The steps on the Start here card, chosen once, and the ones seen done (they stay ticked). */
  steps: string[] | null;
  done: string[];
};

/** One small thing on the Start here card, about two minutes, ticked when the real thing has been done. */
export type Step = { key: string; label: string; to: string; minutes: number; done: boolean };
export type ExampleCounts = { recipes: number; meals: number; groceries: number; things: number; jobs: number; events: number };
export type WeeklyState = { channel: boolean; on: boolean; active: boolean; ask: boolean; picks: { key: string; label: string; to: string }[] };
export type StartState = {
  /** What the first sign-in shows: the guided start, the long checklist (not a new household), or nothing. */
  first_run: 'guide' | 'checklist' | 'quiet';
  status: Status | 'new' | 'none';
  step: number;
  answers: { adults: string[]; children: string[]; pets: { kind: PetKind; name: string }[]; wants: string[]; hobbies: string[]; has_car: boolean | null; sets: string[]; sample: boolean; problem: string | null };
  options: { wants: typeof WANTS; hobbies: typeof HOBBIES; problems: { key: string; label: string; wants: string[] }[]; sets: { slug: string; name: string; about: string; jobs: number }[] };
  /** The small card on the front page, if one is wanted. */
  card: null | { kind: 'finish'; step: number } | { kind: 'started'; steps: Step[]; examples: ExampleCounts | null };
  /** After finishing: what was set up, in a sentence, and where to go first. */
  summary: string | null;
  landing: { to: string; label: string } | null;
};
export type Cleared = { removed: ExampleCounts; kept: { title: string; why: string }[]; message: string };

const blank = (): Saved => ({
  status: 'open', step: 1, began: '', adults: [], children: [], pets: [], wants: [], hobbies: [], has_car: null, sets: [], sample: false,
  examples: null, made: { members: 0, pets: 0, jobs: 0, recipes: 0 }, hidden: false, problem: null, steps: null, done: [],
});
/** Where a brand-new person might already have something of their own, by table (all have an owner_id). */
const PARTS = ['recipes', 'meal_plan', 'grocery', 'pantry', 'items', 'upkeep_jobs', 'pets', 'household_members', 'events', 'projects', 'media', 'plans', 'money_categories', 'money_entries'];
const WEEKLY = 'weekly_question';
const COPY_KEY = 'last_copy_made';
/** How many weeks the weekly question goes before it asks, once, whether to keep it. */
const WEEKS_BEFORE_ASKING = 2;
type Weekly = { stopped: boolean; sent: number; asked: boolean; answered: boolean; last: string | null };
const NO_EXAMPLES: ExampleCounts = { recipes: 0, meals: 0, groceries: 0, things: 0, jobs: 0, events: 0 };

/** The card Home opens on for what bugs the person most, or null when they were not asked or passed it by. */
export async function problemCard(db: Db, owner: number): Promise<string | null> {
  const row = await db.get<{ value: string | null }>('SELECT value FROM user_settings WHERE user_id = ? AND key = ?', [owner, SETTING]);
  try {
    const key = (JSON.parse(row?.value ?? 'null') as { problem?: string } | null)?.problem;
    return PROBLEMS.find((p) => p.key === key)?.card ?? null;
  } catch { return null; }
}

const SAMPLE_RECIPES = [
  {
    title: 'Sheet-pan sausage and vegetables', servings: 4, prep_minutes: 15, cook_minutes: 40, tags: ['example', 'weeknight'],
    description: 'One pan, few dishes to wash, and it works with whatever vegetables are in the drawer.',
    ingredients_text: '1 lb smoked sausage, sliced into coins\n1 lb baby potatoes, halved\n2 bell peppers, cut in chunks\n1 red onion, cut in wedges\n2 tbsp olive oil\n1 tsp garlic powder\n1 tsp paprika\n1/2 tsp salt\n1/4 tsp black pepper',
    steps_text: 'Heat the oven to 425°F with a rack in the middle.\nToss the potatoes with half the oil, the salt and the pepper on a large sheet pan. Roast for 15 minutes.\nAdd the sausage, peppers and onion with the rest of the oil, the garlic powder and the paprika. Stir it all together.\nRoast 20 to 25 minutes more, stirring once, until the potatoes are tender and the edges are browned.',
    notes: 'Serve as it is, or over rice.',
  },
  {
    title: 'Slow-cooker beef chili', servings: 6, prep_minutes: 20, cook_minutes: 360, tags: ['example', 'slow cooker'],
    description: 'Put it on in the morning and dinner is ready when you are.',
    ingredients_text: '1 1/2 lb ground beef\n1 onion, diced\n3 cloves garlic, minced\n1 can (15 oz) kidney beans, drained\n1 can (15 oz) black beans, drained\n1 can (28 oz) crushed tomatoes\n1 cup beef broth\n2 tbsp chili powder\n1 tbsp ground cumin\n1 tsp salt\nShredded cheddar, to serve\nSour cream, to serve',
    steps_text: 'Brown the beef with the onion in a skillet over medium-high heat, about 8 minutes. Drain off the fat.\nStir in the garlic, chili powder and cumin and cook for 1 minute.\nPut the beef mixture, beans, tomatoes, broth and salt in the slow cooker and stir.\nCook on low for 6 to 8 hours, or on high for 3 to 4.\nTaste, add salt if it needs it, and serve with cheddar and sour cream.',
    notes: 'It is better the next day. It freezes well.',
  },
  {
    title: 'Baked macaroni and cheese', servings: 6, prep_minutes: 15, cook_minutes: 35, tags: ['example', 'comfort'],
    description: 'Creamy inside, golden on top.',
    ingredients_text: '1 lb elbow macaroni\n4 tbsp butter\n1/4 cup flour\n3 cups whole milk\n3 cups shredded sharp cheddar\n1 tsp salt\n1/2 tsp mustard powder\n1/2 cup breadcrumbs',
    steps_text: 'Heat the oven to 350°F and butter a 9 by 13 inch baking dish.\nBoil the macaroni 2 minutes less than the package says, then drain.\nMelt 3 tablespoons of the butter in a large pot over medium heat. Whisk in the flour and cook for 1 minute.\nWhisk in the milk a little at a time. Stir until it thickens, about 5 minutes.\nTake it off the heat and stir in 2 1/2 cups of the cheese, the salt and the mustard powder.\nFold in the macaroni and pour it into the dish.\nMelt the last tablespoon of butter, mix it with the breadcrumbs, and scatter it over the top with the rest of the cheese.\nBake for 25 minutes, until bubbling and golden.',
    notes: 'A little hot sauce at the table is good on it.',
  },
];
const SAMPLE_DINNERS = [0, 1, 2];
const SAMPLE_GROCERIES = ['1 lb smoked sausage', '2 bell peppers', '1 lb baby potatoes', '1 lb elbow macaroni', '1 gallon whole milk', '2 cups shredded cheddar'];

const SAMPLE_THINGS = [{ name: 'Example: Step stool', quantity: 1 }, { name: 'Example: Cordless drill', quantity: 1 }, { name: 'Example: Box of light bulbs', quantity: 1, low_at: 2 }];
const SAMPLE_JOBS = [{ name: 'Example: Water the porch plants', every_n: 1, every_unit: 'week', after: 2 }, { name: 'Example: Take out the trash cans', every_n: 1, every_unit: 'week', after: 3 }];

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const sayList = (parts: string[]) => (parts.length < 2 ? parts.join('') : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`);
/** Names as typed: trimmed, the empty ones dropped, the same name once. */
function names(list: unknown, most: number, long: number): string[] {
  if (list === undefined || list === null) return [];
  if (!Array.isArray(list) || list.some((n) => typeof n !== 'string')) throw new Problem(400, 'Names are words');
  const out: string[] = [];
  for (const n of list as string[]) {
    const said = clean(n, long);
    if (said && !out.some((o) => labelKey(o) === labelKey(said))) out.push(said);
  }
  if (out.length > most) throw new Problem(400, `That is more than ${most} names`);
  return out;
}

export function start(db: Db, owner: number, clock: Clock = () => new Date()) {
  const today = () => todayOf(clock);

  async function read(): Promise<Saved | null> {
    const row = await db.get<{ value: string | null }>('SELECT value FROM user_settings WHERE user_id = ? AND key = ?', [owner, SETTING]);
    if (!row?.value) return null;
    try {
      const found = JSON.parse(row.value) as Partial<Saved>;
      return { ...blank(), ...found, made: { ...blank().made, ...(found.made ?? {}) } };
    } catch {
      return null;
    }
  }
  async function write(saved: Saved): Promise<void> {
    await db.run(
      `INSERT INTO user_settings (user_id, key, value) VALUES (?, ?, ?)
       ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value`, [owner, SETTING, JSON.stringify(saved)]);
  }
  const has = async (table: string, where = '', args: (string | number)[] = []) =>
    Boolean(await db.get(`SELECT 1 AS yes FROM ${table} WHERE owner_id = ? ${where} LIMIT 1`, [owner, ...args]));

  /** Nothing of theirs anywhere in Life Is yet. */
  async function brandNew(): Promise<boolean> {
    for (const part of PARTS) if (await has(part)) return false;
    return true;
  }

  async function weeklyRead(): Promise<Weekly> {
    const row = await db.get<{ value: string | null }>('SELECT value FROM user_settings WHERE user_id = ? AND key = ?', [owner, WEEKLY]);
    try { return { stopped: false, sent: 0, asked: false, answered: false, last: null, ...(JSON.parse(row?.value ?? '{}') as Partial<Weekly>) }; } catch { return { stopped: false, sent: 0, asked: false, answered: false, last: null }; }
  }
  async function weeklyWrite(w: Weekly): Promise<void> {
    await db.run(`INSERT INTO user_settings (user_id, key, value) VALUES (?, ?, ?) ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value`, [owner, WEEKLY, JSON.stringify(w)]);
  }
  /** Whether the weekly question can go: the person finished the start, and has chosen a way for reminders to reach them (the phone's own notices count). */
  async function hasChannel(): Promise<boolean> {
    if ((await read())?.status !== 'finished') return false;
    const row = await db.get<{ value: string | null }>('SELECT value FROM user_settings WHERE user_id = ? AND key = ?', [owner, 'reminders']);
    try {
      const s = JSON.parse(row?.value ?? '{}') as { email?: boolean; ntfy?: unknown; push?: boolean; phone?: boolean };
      return Boolean(s.email || s.ntfy || s.push || s.phone);
    } catch { return false; }
  }

  /** The record to change: the one kept, or a fresh one for a person who is brand new. Anyone else is refused. */
  async function working(): Promise<Saved> {
    const saved = await read();
    if (saved) {
      if (saved.status === 'finished' || saved.status === 'skipped' || saved.status === 'dismissed') throw new Problem(409, 'Setting up has already been finished');
      return saved;
    }
    if (!(await brandNew()) || (await life(db, owner, clock).getProfile()).areas !== null) throw new Problem(409, 'The two-minute start is only for a household that is just beginning');
    return { ...blank(), began: today() };
  }

  const owns = (saved: Saved) => saved.examples;
  const counts = (examples: Examples | null): ExampleCounts | null =>
    (examples ? { recipes: examples.recipes.length, meals: examples.meals.length, groceries: examples.groceries.length,
      things: examples.things?.length ?? 0, jobs: examples.jobs?.length ?? 0, events: examples.events?.length ?? 0 } : null);

  const fingerprint = (r: { title: string; description: string | null; servings: number | null; prep_minutes: number | null; cook_minutes: number | null; source_url: string | null;
    notes: string | null; tags: string[]; ingredients_text: string; steps_text: string; equipment: { label: string }[] }) =>
    JSON.stringify([r.title, r.description, r.servings, r.prep_minutes, r.cook_minutes, r.source_url, r.notes, r.tags, r.ingredients_text, r.steps_text, r.equipment.map((e) => e.label)]);

  type Def = { key: string; label: string; to: string; wants: string[] | null; show?: (saved: Saved) => boolean; done: (saved: Saved) => Promise<boolean> };
  const ids = (list?: { id: number }[]) => (list ?? []).map((x) => x.id);
  /** Whether the person has a row of their own: one that is not an example made at the start. */
  const theirs = (table: string, skip: number[], where = '') => has(table, `${where} ${skip.length ? `AND id NOT IN (${skip.join(',')})` : ''}`);
  const DEFS: Def[] = [
    { key: 'recipe', label: 'Add a recipe you cook', to: '/recipes', wants: ['meals'], done: (s) => theirs('recipes', ids(s.examples?.recipes)) },
    { key: 'plan', label: 'Plan tonight’s dinner', to: '/week', wants: ['meals'], done: (s) => theirs('meal_plan', ids(s.examples?.meals)) },
    { key: 'room', label: 'Add a few things from one room', to: '/things/places', wants: ['things'], done: (s) => theirs('items', ids(s.examples?.things)) },
    { key: 'chart', label: 'Print a chore chart', to: '/things/upkeep/chart', wants: null, show: (s) => s.children.length > 0, done: () => has('upkeep_jobs', "AND kind = 'chore'") },
    { key: 'chore', label: 'Add a chore', to: '/things/upkeep', wants: ['house'], show: (s) => s.children.length === 0, done: () => has('upkeep_jobs', "AND kind = 'chore'") },
    // Recall alerts are in Life Is (recalls.ts); a car counts once it has a make, model and year.
    { key: 'car', label: 'Add your car to get recall alerts', to: '/things', wants: ['house'], show: (s) => s.has_car !== false, done: async () => (await vehiclesOf(db, owner, clock)).vehicles.length > 0 },
    { key: 'bill', label: 'Add a bill that comes round', to: '/things/upkeep', wants: ['house', 'money'], done: () => has('upkeep_jobs', "AND kind IN ('bill', 'renewal')") },
    { key: 'money', label: 'Set this month’s budget', to: '/money', wants: ['money'], done: () => has('money_categories') },
    { key: 'calendar', label: 'Put a birthday on the calendar', to: '/calendar', wants: ['calendar'], done: (s) => theirs('events', ids(s.examples?.events)) },
    { key: 'project', label: 'Start a project', to: '/projects', wants: ['projects'], done: () => has('projects') },
    { key: 'media', label: 'Add a book, film or album', to: '/media', wants: ['media'], done: () => has('media') },
    { key: 'backup', label: 'Save a backup file', to: '/settings/data', wants: null, done: async () => Boolean(await db.get('SELECT 1 AS yes FROM user_settings WHERE user_id = ? AND key = ?', [owner, COPY_KEY])) },
  ];
  const LEAD: Record<string, string> = Object.fromEntries(PROBLEMS.map((p) => [p.key, p.step]));

  /** Three to five steps for the answers given: what bugs them first, then what they asked for, then a backup. */
  function pickSteps(saved: Saved): string[] {
    const all = saved.wants.length === 0;
    const fits = DEFS.filter((d) => (d.show?.(saved) ?? true) && (all || d.wants === null || d.wants.some((w) => saved.wants.includes(w))));
    const lead = saved.problem ? (saved.problem === 'chores' && saved.children.length > 0 ? 'chart' : LEAD[saved.problem]) : undefined;
    const keys = [...(lead ? [lead] : []), ...fits.map((d) => d.key)];
    const out = [...new Set(keys)].slice(0, 5);
    for (const d of DEFS) if (out.length < 3 && !out.includes(d.key) && (d.show?.(saved) ?? true)) out.push(d.key);
    return out;
  }
  const stepOf = async (saved: Saved, def: Def): Promise<Step> => ({ key: def.key, label: def.label, to: def.to, minutes: 2, done: saved.done.includes(def.key) || (await def.done(saved)) });

  /** The Start here steps, each ticked when the real thing has been done. Steps once seen done stay done. */
  async function steps(saved: Saved): Promise<{ list: Step[]; changed: boolean }> {
    let changed = false;
    if (!saved.steps) { saved.steps = pickSteps(saved); changed = true; }
    const list: Step[] = [];
    for (const key of saved.steps) {
      const def = DEFS.find((d) => d.key === key);
      if (!def) continue;
      const step = await stepOf(saved, def);
      if (step.done && !saved.done.includes(key)) { saved.done.push(key); changed = true; }
      list.push(step);
    }
    return { list, changed };
  }
  /** What is still missing, for the weekly question: the steps first, then anything else not yet done. Three at most. */
  async function missing(saved: Saved): Promise<{ key: string; label: string; to: string }[]> {
    const order = [...new Set([...(saved.steps ?? pickSteps(saved)), ...DEFS.filter((d) => d.show?.(saved) ?? true).map((d) => d.key)])];
    const out: { key: string; label: string; to: string }[] = [];
    for (const key of order) {
      const def = DEFS.find((d) => d.key === key)!;
      if (!(await stepOf(saved, def)).done) out.push({ key, label: def.label, to: def.to });
      if (out.length === 3) break;
    }
    return out;
  }

  function landing(saved: Saved): { to: string; label: string } {
    const wants = new Set(saved.wants);
    if (wants.has('meals')) return { to: '/recipes', label: 'Open your recipes' };
    if (wants.has('house')) return { to: '/things/upkeep', label: 'Open your upkeep' };
    if (wants.has('things')) return { to: '/things', label: 'Open your things' };
    if (wants.has('money')) return { to: '/money', label: 'Open this month’s money' };
    if (wants.has('calendar')) return { to: '/calendar', label: 'Open the calendar' };
    if (wants.has('projects')) return { to: '/projects', label: 'Open your projects' };
    if (wants.has('media')) return { to: '/media', label: 'Open your collection' };
    return { to: '/', label: 'Go to the front page' };
  }

  function summary(saved: Saved): string {
    const made = saved.made;
    const parts = [
      made.members > 0 && `${plural(made.members, 'person', 'people')} added for chores`,
      made.pets > 0 && plural(made.pets, 'pet'),
      made.jobs > 0 && plural(made.jobs, 'upkeep job'),
      made.recipes > 0 && `${plural(made.recipes, 'example recipe')} with this week’s dinners`,
    ].filter((part): part is string => Boolean(part));
    return parts.length ? `You’re set up with ${sayList(parts)}, and the parts you asked for are showing.` : 'You’re set up, and the parts you asked for are showing.';
  }

  async function state(): Promise<StartState> {
    const saved = await read();
    const areas = (await life(db, owner, clock).getProfile()).areas;
    const options = { wants: WANTS, hobbies: HOBBIES, problems: PROBLEMS.map(({ key, label, wants }) => ({ key, label, wants })), sets: readySets(today()).map((s) => ({ slug: s.slug, name: s.name, about: s.about, jobs: s.jobs.length })) };
    const shown = saved ?? { ...blank(), began: today() };
    const answers = { adults: shown.adults, children: shown.children, pets: shown.pets, wants: shown.wants, hobbies: shown.hobbies, has_car: shown.has_car, sets: shown.sets, sample: shown.sample, problem: shown.problem };
    const open = saved ? saved.status === 'open' : areas === null && (await brandNew());
    const firstRun: StartState['first_run'] = areas !== null ? 'quiet' : open ? 'guide' : saved ? 'quiet' : 'checklist';
    let card: StartState['card'] = null;
    if (saved && (saved.status === 'open' || saved.status === 'closed')) card = { kind: 'finish', step: saved.step };
    else if (saved && saved.status === 'finished') {
      let list: Step[] = [];
      if (!saved.hidden) {
        const got = await steps(saved);
        if (got.changed) await write(saved);
        list = got.list;
      }
      // Examples that are still there stay on offer to be cleared, even once the steps are done or put away.
      const left = list.some((step) => !step.done);
      if (left || owns(saved)) card = { kind: 'started', steps: left ? list : [], examples: counts(saved.examples) };
    }
    return {
      first_run: firstRun, status: saved?.status ?? (open ? 'new' : 'none'), step: shown.step, answers, options, card,
      summary: saved?.status === 'finished' ? summary(saved) : null, landing: saved?.status === 'finished' ? landing(saved) : null,
    };
  }

  /** The whole row as it is now, to tell later whether the person has changed it. */
  const stamp = async (table: string, id: number) => JSON.stringify(await db.get(`SELECT * FROM ${table} WHERE id = ?`, [id]));

  async function sample(saved: Saved): Promise<void> {
    if (saved.examples) return;
    const k = kitchen(db, owner, clock);
    // Kept in mind as each is made, so one that fails part way can still be cleared.
    const examples: Examples = { made_on: today(), recipes: [], meals: [], groceries: [], things: [], jobs: [], events: [] };
    saved.examples = examples;
    // Only for the parts they picked; nothing picked means everything shows, so every part gets a few.
    const wants = (key: string) => saved.wants.length === 0 || saved.wants.includes(key);
    const made: { id: number; title: string }[] = [];
    if (wants('meals')) for (const input of SAMPLE_RECIPES) {
      const recipe = await k.createRecipe(input);
      examples.recipes.push({ id: recipe.id, title: recipe.title, updated_at: recipe.updated_at, fingerprint: fingerprint(recipe) });
      made.push({ id: recipe.id, title: recipe.title });
    }
    // The first on tonight, the next two on the days after.
    if (made.length > 0) for (const [i, offset] of SAMPLE_DINNERS.entries()) {
      const meal = await k.addPlan({ day: addDays(today(), offset), meal: 'dinner', recipe_id: made[i]!.id });
      examples.meals.push({ id: meal.id, day: meal.day, meal: meal.meal, recipe_id: made[i]!.id, servings: meal.servings });
    }
    if (made.length > 0) for (const label of SAMPLE_GROCERIES) {
      const before = new Set((await k.listGrocery()).map((g) => g.id));
      // A line that joins one already on the list is theirs, not an example: only new rows are kept in mind.
      for (const g of (await k.addGrocery({ label })).filter((row) => !before.has(row.id))) {
        examples.groceries.push({ id: g.id, label: g.label, quantity: g.quantity, unit: g.unit });
      }
    }
    saved.made.recipes = Math.max(saved.made.recipes, examples.recipes.length);
    if (wants('things')) {
      const stuff = inventory(db, owner, clock);
      const kind = (await stuff.listKinds()).find((k) => labelKey(k.name) === 'household') ?? (await stuff.createKind({ name: 'Household', icon: '🏠' })).find((k) => labelKey(k.name) === 'household')!;
      for (const input of SAMPLE_THINGS) {
        const thing = await stuff.createItem({ kind_id: kind.id, ...input });
        examples.things!.push({ id: thing.id, name: thing.name, fingerprint: await stamp('items', thing.id) });
      }
    }
    if (wants('house')) {
      const jobs = upkeep(db, owner, clock);
      for (const { after, ...input } of SAMPLE_JOBS) {
        const job = await jobs.create({ ...input, first_due: addDays(today(), after) });
        examples.jobs!.push({ id: job.id, name: job.name, fingerprint: await stamp('upkeep_jobs', job.id) });
      }
    }
    if (wants('calendar')) {
      const dates = calendar(db, owner, clock);
      for (const input of [{ title: 'Example: Dentist visit', day: addDays(today(), 3), time: '15:00' }, { title: 'Example: Family birthday dinner', day: addDays(today(), 9), yearly: true }]) {
        const event = await dates.createEvent(input);
        examples.events!.push({ id: event.id, name: event.title, fingerprint: await stamp('events', event.id) });
      }
    }
  }

  /** Take back the examples that are still exactly as they were made, and say which were kept. */
  async function clear(saved: Saved): Promise<Cleared> {
    const examples = saved.examples;
    if (!examples) return { removed: { ...NO_EXAMPLES }, kept: [], message: 'There are no examples to clear.' };
    const k = kitchen(db, owner, clock);
    const removed: ExampleCounts = { ...NO_EXAMPLES };
    const kept: Cleared['kept'] = [];

    for (const m of examples.meals) {
      const row = await db.get<{ day: string; meal: string; recipe_id: number | null; title: string | null; servings: number | null; cooked_on: string | null }>(
        'SELECT day, meal, recipe_id, title, servings, cooked_on FROM meal_plan WHERE id = ? AND owner_id = ?', [m.id, owner]);
      if (!row) continue;
      if (row.day !== m.day || row.meal !== m.meal || row.recipe_id !== m.recipe_id || row.servings !== m.servings || row.title !== null || row.cooked_on !== null) continue;
      await k.deletePlan(m.id);
      removed.meals += 1;
    }
    for (const g of examples.groceries) {
      const row = await db.get<{ label: string; quantity: number | null; unit: string | null }>('SELECT label, quantity, unit FROM grocery WHERE id = ? AND owner_id = ?', [g.id, owner]);
      if (!row) continue;
      if (row.label !== g.label || row.quantity !== g.quantity || row.unit !== g.unit) continue;
      await k.deleteGrocery(g.id);
      removed.groceries += 1;
    }
    for (const r of examples.recipes) {
      const now = await k.getRecipe(r.id).catch(() => null);
      if (!now) continue;
      if (now.updated_at !== r.updated_at || fingerprint(now) !== r.fingerprint) { kept.push({ title: now.title, why: 'you have changed it' }); continue; }
      const inMeals = await db.get('SELECT 1 AS yes FROM meal_plan WHERE owner_id = ? AND recipe_id = ?', [owner, r.id]);
      const inPlans = await db.get("SELECT 1 AS yes FROM plan_items i JOIN plans p ON p.id = i.plan_id WHERE p.owner_id = ? AND i.kind = 'recipe' AND i.ref_id = ?", [owner, r.id]);
      if (inMeals || inPlans) { kept.push({ title: now.title, why: 'it is in one of your plans' }); continue; }
      await k.deleteRecipe(r.id);
      removed.recipes += 1;
    }
    // Things, upkeep jobs and calendar dates: gone only while they are exactly as they were made.
    const sweep = async (list: { id: number; name: string; fingerprint: string }[] | undefined, table: string, column: string, extra: string, drop: (id: number) => Promise<void>, count: 'things' | 'jobs' | 'events') => {
      for (const one of list ?? []) {
        const row = await db.get<{ name: string; used: number }>(`SELECT ${column} AS name, ${extra} AS used FROM ${table} WHERE id = ? AND owner_id = ?`, [one.id, owner]);
        if (!row) continue;
        if ((await stamp(table, one.id)) !== one.fingerprint) { kept.push({ title: row.name, why: 'you have changed it' }); continue; }
        if (row.used) { kept.push({ title: row.name, why: 'you have used it' }); continue; }
        await drop(one.id);
        removed[count] += 1;
      }
    };
    await sweep(examples.things, 'items', 'name', 'EXISTS (SELECT 1 FROM upkeep_tools t WHERE t.item_id = items.id) + EXISTS (SELECT 1 FROM upkeep_jobs j WHERE j.item_id = items.id)', (id) => inventory(db, owner, clock).deleteItem(id), 'things');
    await sweep(examples.jobs, 'upkeep_jobs', 'name', 'EXISTS (SELECT 1 FROM upkeep_done d WHERE d.job_id = upkeep_jobs.id)', (id) => upkeep(db, owner, clock).remove(id), 'jobs');
    await sweep(examples.events, 'events', 'title', '0', (id) => calendar(db, owner, clock).deleteEvent(id), 'events');
    saved.examples = null;
    saved.sample = false;
    const gone = [removed.recipes > 0 && plural(removed.recipes, 'recipe'), removed.meals > 0 && plural(removed.meals, 'dinner'), removed.groceries > 0 && plural(removed.groceries, 'grocery line'),
      removed.things > 0 && plural(removed.things, 'thing'), removed.jobs > 0 && plural(removed.jobs, 'upkeep job'), removed.events > 0 && plural(removed.events, 'calendar date')]
      .filter((part): part is string => Boolean(part));
    const keptWords = kept.map((one) => `Kept “${one.title}” because ${one.why}.`).join(' ');
    const message = [gone.length ? `Cleared the examples: ${sayList(gone)}.` : kept.length ? 'Nothing was cleared.' : 'The examples were already gone.', keptWords].filter(Boolean).join(' ');
    return { removed, kept, message };
  }

  return {
    state,
    brandNew,

    /** What bugs them most at home, asked before anything else. Passing it by (nothing, or 'none') is fine. */
    async problem(input: unknown): Promise<StartState> {
      const saved = await working();
      const key = typeof input === 'string' ? input : '';
      if (key && key !== 'none' && !PROBLEMS.some((p) => p.key === key)) throw new Problem(400, "That isn't one of the choices");
      saved.problem = key || 'none';
      await write(saved);
      return state();
    },

    /** Who lives here. The adults are only named (no sign-ins); the children become household members; pets are made. */
    async people(input: { adults?: unknown; children?: unknown; pets?: unknown }): Promise<StartState> {
      const saved = await working();
      const adults = names(input.adults, 6, 60);
      const children = names(input.children, 10, 60);
      const wantedPets = (input.pets === undefined || input.pets === null ? [] : input.pets) as unknown;
      if (!Array.isArray(wantedPets)) throw new Problem(400, 'Pets are a list');
      if (wantedPets.length > 8) throw new Problem(400, 'That is more than 8 pets');
      const petList: Saved['pets'] = [];
      for (const p of wantedPets as { kind?: unknown; name?: unknown }[]) {
        if (typeof p !== 'object' || p === null || !PET_KINDS.includes(p.kind as PetKind)) throw new Problem(400, 'A pet is a dog, a cat or something else');
        const name = clean(typeof p.name === 'string' ? p.name : '', 80);
        if (name) petList.push({ kind: p.kind as PetKind, name });
      }
      const jobs = upkeep(db, owner, clock);
      const have = new Set((await jobs.members()).map((m) => labelKey(m.name)));
      for (const name of children) {
        if (have.has(labelKey(name))) continue;
        await jobs.addMember(name);
        saved.made.members += 1;
      }
      const animals = pets(db, owner, clock);
      const there = (await animals.list()).map((p) => `${labelKey(p.name)}|${p.species ?? ''}`);
      for (const pet of petList) {
        const key = `${labelKey(pet.name)}|${pet.kind === 'other' ? '' : pet.kind}`;
        if (there.includes(key)) continue;
        await animals.create({ name: pet.name, species: pet.kind === 'other' ? null : pet.kind });
        there.push(key);
        saved.made.pets += 1;
      }
      Object.assign(saved, { adults, children, pets: petList, step: Math.max(saved.step, 2), status: 'open' as Status });
      await write(saved);
      return state();
    },

    /** What they want help with: the profile life.ts keeps, so sections show and hide as they always have. */
    async interests(input: { wants?: unknown; hobbies?: unknown }): Promise<StartState> {
      const saved = await working();
      const wants = input.wants === undefined ? [] : input.wants;
      const hobbies = input.hobbies === undefined ? [] : input.hobbies;
      if (!Array.isArray(wants) || !Array.isArray(hobbies)) throw new Problem(400, 'Choices are a list');
      if (wants.some((w) => !WANTS.some((o) => o.key === w))) throw new Problem(400, "One of those isn't something to help with");
      if (hobbies.some((h) => !HOBBIES.some((o) => o.key === h))) throw new Problem(400, "One of those isn't a hobby Life Is knows");
      const chosen = WANTS.filter((o) => wants.includes(o.key)).map((o) => o.key);
      const liked = chosen.includes('projects') ? HOBBIES.filter((o) => hobbies.includes(o.key)).map((o) => o.key) : [];
      const profile = life(db, owner, clock);
      // What they ticked for themselves in Settings, outside these choices, is kept.
      const earlier = (await profile.getProfile()).areas ?? [];
      const keep = earlier.filter((key) => !WANTS.some((o) => o.areas.includes(key)) && !HOBBIES.some((o) => o.key === key));
      const areas = [...new Set([...WANTS.filter((o) => chosen.includes(o.key)).flatMap((o) => o.areas), ...liked, ...keep])];
      await profile.saveProfile(areas);
      Object.assign(saved, { wants: chosen, hobbies: liked, step: chosen.includes('house') ? 3 : 4, status: 'open' as Status });
      await write(saved);
      return state();
    },

    /** The usual upkeep: the ready-made sets they chose. A job they already have, by name, is left alone. */
    async upkeep(input: { sets?: unknown; has_car?: unknown }): Promise<StartState> {
      const saved = await working();
      const wanted = input.sets === undefined ? [] : input.sets;
      if (!Array.isArray(wanted) || wanted.some((s) => typeof s !== 'string')) throw new Problem(400, 'Sets are a list');
      if (input.has_car !== undefined && input.has_car !== null && typeof input.has_car !== 'boolean') throw new Problem(400, 'Yes or no, is there a car');
      const all = readySets(today()).map((s) => s.slug);
      if ((wanted as string[]).some((s) => !all.includes(s))) throw new Problem(404, 'There is no such set');
      const slugs = all.filter((s) => (wanted as string[]).includes(s));
      const jobs = upkeep(db, owner, clock);
      for (const slug of slugs) saved.made.jobs += (await jobs.addSet(slug)).added;
      // A car: its kinds of things come ready, so it can be entered with a make, model and year for recall alerts.
      if (input.has_car === true) await inventory(db, owner, clock).addStarter('car');
      Object.assign(saved, { sets: slugs, has_car: (input.has_car as boolean | null | undefined) ?? null, step: 4, status: 'open' as Status });
      await write(saved);
      return state();
    },

    /** The examples to look at: on makes them (once); off takes back any made earlier that are still untouched. */
    async examples(on: boolean): Promise<StartState> {
      const saved = await working();
      try {
        if (on) await sample(saved);
        else if (saved.examples) await clear(saved);
        saved.sample = on && saved.examples !== null;
        saved.step = 4;
        saved.status = 'open';
      } finally {
        await write(saved);
      }
      return state();
    },

    /** The last step is done. */
    async finish(): Promise<StartState> {
      const saved = await working();
      saved.status = 'finished';
      saved.step = 4;
      await write(saved);
      return state();
    },

    /** Finish early, from any step: what was chosen stays; what was not asked leaves everything showing. */
    async finishNow(): Promise<StartState> {
      const saved = await working();
      const profile = life(db, owner, clock);
      if ((await profile.getProfile()).areas === null) await profile.saveProfile([]);
      saved.status = 'finished';
      await write(saved);
      return state();
    },

    /** "Skip, show me everything": no more of the start, and no card. What was done stays. */
    async skip(): Promise<StartState> {
      const saved = (await read()) ?? { ...blank(), began: today() };
      if (saved.status !== 'finished') {
        saved.status = 'skipped';
        await write(saved);
      }
      return state();
    },

    /** The dialog was closed part way: kept as it is, at this step, for the front page to pick up from. */
    async close(step: number): Promise<StartState> {
      const saved = await working();
      saved.status = 'closed';
      if (Number.isInteger(step) && step >= 1 && step <= 4) saved.step = step;
      await write(saved);
      return state();
    },

    /** Put the card away: "Finish setting up" for good, or the getting-started tips. */
    async dismiss(): Promise<StartState> {
      const saved = await read();
      if (!saved) return state();
      if (saved.status === 'open' || saved.status === 'closed') saved.status = 'dismissed';
      else saved.hidden = true;
      await write(saved);
      return state();
    },

    /** The weekly question as it stands, for Home. It is only ever on for a person with a reminder channel. */
    async weekly(): Promise<WeeklyState> {
      const w = await weeklyRead();
      const channel = await hasChannel();
      const on = channel && !w.stopped;
      const since = w.last ? dayNumber(today()) - dayNumber(w.last) : null;
      const active = on && since !== null && since >= 0 && since < 7;
      const ask = active && w.asked && !w.answered;
      return { channel, on, active, ask, picks: active && !ask ? await missing((await read()) ?? { ...blank(), began: today() }) : [] };
    },

    /** The Monday line for the morning reminder: the question with what is missing, or, after the second week, whether to keep it. */
    async weeklyLine(): Promise<{ title: string; detail: string; ask: boolean } | null> {
      const w = await weeklyRead();
      if (w.stopped || !(await hasChannel())) return null;
      const day = today();
      if (new Date(`${day}T12:00:00Z`).getUTCDay() !== 1 || w.last === day) return null;
      if (w.sent >= WEEKS_BEFORE_ASKING && !w.asked) {
        return { title: 'Keep the weekly question?', detail: 'Each Monday it asks what you want to get done that week. Open Life Is to keep it or stop it.', ask: true };
      }
      const picks = await missing((await read()) ?? { ...blank(), began: today() });
      return picks.length ? { title: 'What do you want to get done this week?', detail: picks.map((p) => p.label).join(' · '), ask: false } : null;
    },

    /** The Monday line went out: counted, so after the second week the question is asked once. */
    async weeklySent(day: string, ask: boolean): Promise<void> {
      const w = await weeklyRead();
      w.sent += 1;
      w.last = day;
      if (ask) w.asked = true;
      await weeklyWrite(w);
    },

    /** Keep the weekly question going, or stop it. */
    async weeklyAnswer(answer: unknown): Promise<WeeklyState> {
      if (answer !== 'keep' && answer !== 'stop') throw new Problem(400, 'Keep it or stop it');
      const w = await weeklyRead();
      w.answered = true;
      w.stopped = answer === 'stop';
      await weeklyWrite(w);
      return this.weekly();
    },

    /** Remove the examples made at the start, and only those. One changed since is kept, and named. */
    async clearExamples(): Promise<Cleared & { state: StartState }> {
      const saved = await read();
      if (!saved) return { removed: { ...NO_EXAMPLES }, kept: [], message: 'There are no examples to clear.', state: await state() };
      const done = await clear(saved);
      await write(saved);
      return { ...done, state: await state() };
    },
  };
}

export type Start = ReturnType<typeof start>;
