/**
 * Routines: checklists for parts of the day. A routine ("Skincare") has one or more named times ("Morning",
 * "Evening"), each with an optional clock time and its own steps.
 *
 * Whose: a routine belongs to one person with a sign-in (`for_user`), to a household member without one
 * (`for_member`, like the children on the chore chart), to a pet (`for_pet`), or to everyone (none of them). A
 * person's own routines show only on their front page; a household member's show on the chore chart (and can earn
 * chore points); everyone's, and a pet's, show for all (a pet's with the pet's name, and on the pet's page).
 *
 * Each tick keeps who ticked it and when, so anyone else who can see the routine reads "Done at 7:10 by Sam" and
 * nobody does the step twice.
 *
 * Step days: each step is every day (the usual), on chosen weekdays, every few days (every other day, every 3 days: counted
 * from a start day on the calendar, so a missed day is missed and nothing piles up), or on one night of a cycle whose length the
 * routine sets (a four-night skin cycle). A cycle waits for you: it moves on only when that time was finished,
 * so skipping Tuesday and Wednesday is still the same cycle night on Thursday.
 *
 * A time is finished for a day when every step that falls on that day is ticked. Which days each time was finished
 * is kept, and read back as "5 of the last 7 days" (never a streak).
 *
 * A step can name a thing (an item); the thing's page then says where it is used, and from the step the thing can
 * be marked running low, which puts it on the grocery list the way upkeep does.
 *
 * Workouts: a routine has a kind, plain (as before) or workout. A workout step can carry numbers (sets and reps, a weight, minutes, a
 * distance, with the units the person typed). A tick keeps the numbers it was made with, and each numbered step reads "last time" from the
 * latest earlier tick that has numbers. A new workout is its maker's own unless they say whose; it is shared the way any routine is.
 * `history` looks back: days of the last 7, a month of days, each numbered step's last times. No streaks, points or judging.
 *
 * A time with a clock time sends a reminder at that time, in the person's zone, by the ways they already turned on
 * for reminders (see `routinesDue`, and prep.ts which it follows).
 */
import { atomic, type Db, type Queries, type Value } from './db.ts';
import { shown } from './displayName.ts';
import { kitchen } from './kitchen.ts';
import { clockWords, GRACE_MINUTES } from './prep.ts';
import { Problem } from './problem.ts';
import { reminders, zoneNow, type Channel, type Digest, type ReminderTools } from './reminders.ts';
import { addDays, clean, dayNumber, labelKey, stamp, todayOf, type Clock } from './small.ts';
import { attachTags, onlyTagged, unlink, type TagRef } from './tags.ts';

export const STEP_RULES = ['daily', 'weekdays', 'cycle', 'every'] as const;
/** How many days apart an "every few days" step can be. */
export const EVERY_MIN = 2;
export const EVERY_MAX = 30;
export type StepRule = (typeof STEP_RULES)[number];
/** Weekdays go by number, Monday 1 to Sunday 7. */
export const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

export const MAX_ROUTINES = 60;
export const MAX_TIMES = 6;
export const MAX_STEPS = 30;
export const MAX_WAIT_SECONDS = 3600;
/** How far back a day may be ticked or un-ticked. */
export const TICK_DAYS_BACK = 7;

export const ROUTINE_KINDS = ['plain', 'workout'] as const;
export type RoutineKind = (typeof ROUTINE_KINDS)[number];
export const ROUTINE_WEIGHT_UNITS = ['lb', 'kg'] as const;
export const ROUTINE_DISTANCE_UNITS = ['mi', 'km'] as const;

/**
 * The numbers a workout step can carry: sets and reps, a weight, minutes, a distance. All optional; a step with none is a
 * plain checklist step. The units are the ones the person chose, kept with the numbers.
 */
export type Numbers = {
  sets: number | null; reps: number | null; weight: number | null; weight_unit: string | null;
  minutes: number | null; distance: number | null; distance_unit: string | null;
};
export const NO_NUMBERS: Numbers = { sets: null, reps: null, weight: null, weight_unit: null, minutes: null, distance: null, distance_unit: null };
const NUMBER_COLUMNS = 'sets, reps, weight, weight_unit, minutes, distance, distance_unit';
const ANY_NUMBER = '(sets IS NOT NULL OR reps IS NOT NULL OR weight IS NOT NULL OR minutes IS NOT NULL OR distance IS NOT NULL)';
const numbersOf = (r: Numbers): Numbers => ({ sets: r.sets, reps: r.reps, weight: r.weight, weight_unit: r.weight_unit, minutes: r.minutes, distance: r.distance, distance_unit: r.distance_unit });
const numberValues = (n: Numbers): Value[] => [n.sets, n.reps, n.weight, n.weight_unit, n.minutes, n.distance, n.distance_unit];
export const hasNumbers = (n: Numbers): boolean => n.sets !== null || n.reps !== null || n.weight !== null || n.minutes !== null || n.distance !== null;

/** "3 x 10 at 25 lb", "20 min", "2 mi, 20 min". Nothing when there are no numbers. */
export function numbersWords(n: Numbers): string {
  const head = n.sets !== null && n.reps !== null ? `${n.sets} x ${n.reps}` : n.sets !== null ? `${n.sets} ${n.sets === 1 ? 'set' : 'sets'}` : n.reps !== null ? `${n.reps} ${n.reps === 1 ? 'rep' : 'reps'}` : null;
  const weight = n.weight !== null ? `${n.weight} ${n.weight_unit ?? 'lb'}` : null;
  const parts = [head && weight ? `${head} at ${weight}` : head ?? weight, n.minutes !== null ? `${n.minutes} min` : null, n.distance !== null ? `${n.distance} ${n.distance_unit ?? 'mi'}` : null];
  return parts.filter((p) => p !== null).join(', ');
}

/** Checks what was sent for a step's numbers (blank is fine). */
export function tidyNumbers(given: Partial<Numbers> | null | undefined, words: string): Numbers {
  const g = given ?? {};
  const whole = (v: unknown, what: string) => {
    if (v === null || v === undefined || v === '') return null;
    if (!(typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 999)) throw new Problem(400, `${what} for "${words}" is a whole number from 1 to 999`);
    return v;
  };
  const amount = (v: unknown, most: number, what: string) => {
    if (v === null || v === undefined || v === '') return null;
    if (!(typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= most)) throw new Problem(400, `${what} for "${words}" is a number more than 0`);
    return Math.round(v * 100) / 100;
  };
  const weight = amount(g.weight, 10000, 'The weight');
  const distance = amount(g.distance, 10000, 'The distance');
  const unit = (v: unknown, list: readonly string[], fallback: string, what: string) => {
    if (v === null || v === undefined || v === '') return fallback;
    if (typeof v !== 'string' || !list.includes(v)) throw new Problem(400, `${what} is ${list.join(' or ')}`);
    return v;
  };
  return {
    sets: whole(g.sets, 'The sets'), reps: whole(g.reps, 'The reps'),
    weight, weight_unit: weight !== null ? unit(g.weight_unit, ROUTINE_WEIGHT_UNITS, 'lb', 'A weight') : null,
    minutes: amount(g.minutes, 1440, 'The minutes'),
    distance, distance_unit: distance !== null ? unit(g.distance_unit, ROUTINE_DISTANCE_UNITS, 'mi', 'A distance') : null,
  };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "Mon" for a day in the last week, else "Nov 3". */
function dayLabel(day: string, today: string): string {
  const back = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${day}T00:00:00Z`)) / 86_400_000);
  if (back >= 0 && back <= 6) return DAY_NAMES[isoWeekday(day) - 1]!;
  return `${MONTHS[Number(day.slice(5, 7)) - 1]} ${Number(day.slice(8, 10))}`;
}

export type StepInput = {
  /** Present when it is an existing step being changed (so what was ticked today stays ticked). */
  id?: number | null;
  /** The numbers a step of a workout carries (what it usually is). Ignored for a plain routine. */
  nums?: Partial<Numbers> | null;
  words: string;
  rule?: StepRule | null;
  /** Monday 1 to Sunday 7, for `weekdays`. */
  weekdays?: number[] | null;
  /** Which night of the cycle, for `cycle`. */
  night?: number | null;
  /** For `every`: how many days apart (2 to 30), and the day it counts from (today when not said). */
  every?: number | null;
  start?: string | null;
  /** A thing (an item) the step uses. */
  item_id?: number | null;
  /** A timer to wait after the step, in seconds ("let the serum dry"). */
  wait_seconds?: number | null;
};
export type TimeInput = { id?: number | null; name: string; at?: string | null; steps?: StepInput[] };
export type RoutineInput = {
  name: string;
  /** 'plain' (the usual) or 'workout' (steps can carry numbers, and each shows what was done last time). Kept as it is when not sent. */
  kind?: RoutineKind | null;
  /** A person with a sign-in. Neither this nor `for_member`: everyone. */
  for_user?: number | null;
  for_member?: number | null;
  /** One of the owner's pets. Only one of `for_user`, `for_member` and `for_pet`. */
  for_pet?: number | null;
  /** How many nights the cycle has, 2 to 14, or none. */
  cycle_length?: number | null;
  /** What finishing one time of it is worth to a household member, in chore points. */
  points?: number | null;
  note?: string | null;
  times?: TimeInput[];
};

export type Step = {
  id: number; words: string; rule: StepRule; weekdays: number[]; night: number | null;
  /** For `every`: days apart, and the day it counts from. */
  every: number | null; start: string | null;
  item_id: number | null; item: string | null; wait_seconds: number | null;
  /** The numbers it carries (what it usually is), and whether it carries any. */
  nums: Numbers; tracks: boolean;
  /** When it falls, in words: "every day", "Mon and Thu", "night 2 of 4". */
  days: string;
};
export type Time = { id: number; name: string; at: string | null; at_words: string | null; steps: Step[]; /** Days finished of the last 7, today included. */ last7: number; /** The latest day it was finished (a workout: the latest day anything in it was done), or null. */ last_done: string | null };
export type Routine = {
  id: number; name: string; owner_id: number; kind: RoutineKind;
  /** Whether it is the viewer's own to change. */
  mine: boolean;
  for_user: number | null; for_member: number | null; for_pet: number | null;
  who_kind: 'me' | 'person' | 'member' | 'pet' | 'everyone';
  /** "You", "Sam", "Everyone". */
  who: string;
  cycle_length: number | null; points: number | null; note: string | null;
  times: Time[];
  tag_list: TagRef[];
};

/** One time of one routine on one day: the steps that fall that day, and which are ticked. */
export type DayStep = Step & {
  ticked: boolean;
  /** Who ticked it ("you" for the viewer, else their name) and when (a UTC stamp), when ticked. */
  by: string | null; at: string | null;
  /** Last time, for a step that carries numbers: the latest earlier day it was ticked with numbers, and them in words ("3 x 10 at 25 lb, Mon"). */
  last: { day: string; words: string; text: string } | null;
  /** What the numbers start as today: last time's, else the step's own. */
  prefill: Numbers;
  /** The numbers kept when it was ticked, and in words. */
  kept: Numbers | null; kept_words: string | null;
};
export type DayTime = {
  id: number; routine_id: number; routine: string; kind: RoutineKind; name: string;
  /** How to head it: the routine's name, then the time's unless they are the same word. */
  title: string;
  who_kind: Routine['who_kind']; who: string; member_id: number | null; pet_id: number | null;
  day: string; at: string | null; at_words: string | null;
  /** Which night of the cycle this day is, or null without a cycle. */
  night: number | null; cycle_length: number | null;
  points: number | null;
  steps: DayStep[];
  total: number; done: number; finished: boolean; last7: number; last_done: string | null;
  /** Closed on the viewer's front page for this day (Close for today). Only set by today(). */
  closed?: boolean;
};

export const HISTORY_DAYS = 30;
export const HISTORY_STEP_TIMES = 6;
export type RoutineHistory = {
  id: number; name: string; kind: RoutineKind;
  /** How many of the last 7 days (today included) anything in it was done. */
  last7: number; last7_text: string;
  /** The last 30 days, oldest first: whether anything was done that day. */
  days: { day: string; done: boolean }[];
  /** Each step that carries numbers, with its last few times (newest first). */
  steps: { id: number; words: string; entries: { day: string; label: string; words: string }[] }[];
};

/** A step of a ready-made routine. `feed` marks the step that uses the pet's food, so a thing can be linked to it. */
export type StarterStep = StepInput & { feed?: boolean };
export type Starter = { slug: string; name: string; about: string; cycle_length: number | null; /** The kind of pet it is for, when it is for a pet. */ pet?: 'dog' | 'cat'; times: { name: string; steps: StarterStep[] }[] };

const everyDay = (words: string, extra: Partial<StarterStep> = {}): StarterStep => ({ words, rule: 'daily', ...extra });
const onNight = (night: number, words: string, extra: Partial<StepInput> = {}): StepInput => ({ words, rule: 'cycle', night, ...extra });

/** Plain steps to start from. Nothing medical: they are only words, and every part can be changed. */
export const ROUTINE_STARTERS: Starter[] = [
  { slug: 'morning', name: 'Morning', about: 'Get up and get going.', cycle_length: null, times: [{ name: 'Morning', steps: [
    everyDay('Make the bed'), everyDay('Brush your teeth'), everyDay('Get dressed'), everyDay('Eat breakfast'), everyDay('Pack your bag'),
  ] }] },
  { slug: 'bedtime', name: 'Bedtime', about: 'Wind down and get ready for sleep.', cycle_length: null, times: [{ name: 'Bedtime', steps: [
    everyDay('Tidy up'), everyDay('Put on pajamas'), everyDay('Brush your teeth'), everyDay("Lay out tomorrow's clothes"), everyDay('Lights out'),
  ] }] },
  { slug: 'after-school', name: 'After school', about: 'The first hour at home.', cycle_length: null, times: [{ name: 'After school', steps: [
    everyDay('Put your bag away'), everyDay('Have a snack'), everyDay('Do your homework'), everyDay("Pack tomorrow's bag"),
  ] }] },
  { slug: 'weekly-reset', name: 'Weekly reset', about: 'One Sunday to get the house and the week ready.', cycle_length: null, times: [{ name: 'Weekly reset', steps: [
    { words: "Plan the week's meals", rule: 'weekdays', weekdays: [7] }, { words: 'Wash the sheets', rule: 'weekdays', weekdays: [7] },
    { words: 'Clear out the fridge', rule: 'weekdays', weekdays: [7] }, { words: 'Take out the trash and recycling', rule: 'weekdays', weekdays: [7] },
    { words: 'Look at the week ahead', rule: 'weekdays', weekdays: [7] },
  ] }] },
  { slug: 'skincare', name: 'Skincare', about: 'A morning and an evening.', cycle_length: null, times: [
    { name: 'Morning', steps: [everyDay('Wash your face'), everyDay('Moisturizer'), everyDay('Sunscreen')] },
    { name: 'Evening', steps: [everyDay('Wash your face'), everyDay('Moisturizer')] },
  ] },
  { slug: 'dog-daily', name: 'Dog, daily', about: 'Food, water and walks.', cycle_length: null, pet: 'dog', times: [
    { name: 'Morning', steps: [everyDay('Feed', { feed: true }), everyDay('Fresh water'), everyDay('Walk')] },
    { name: 'Evening', steps: [everyDay('Feed', { feed: true }), everyDay('Walk')] },
  ] },
  { slug: 'cat-daily', name: 'Cat, daily', about: 'Food, water and the litter box.', cycle_length: null, pet: 'cat', times: [
    { name: 'Morning', steps: [everyDay('Feed', { feed: true }), everyDay('Fresh water')] },
    { name: 'Evening', steps: [everyDay('Feed', { feed: true }), everyDay('Litter box')] },
  ] },
  { slug: 'skin-cycle', name: '4-night skin cycle', about: 'One step a night for four nights, then round again. It only moves on when you finish the evening.', cycle_length: 4, times: [{ name: 'Evening', steps: [
    everyDay('Wash your face'),
    onNight(1, 'Exfoliate', { wait_seconds: 60 }), onNight(2, 'Retinoid', { wait_seconds: 60 }), onNight(3, 'Recover'), onNight(4, 'Recover'),
    everyDay('Moisturizer'),
  ] }] },
];

// ---------- days and words ----------

/** Monday 1 to Sunday 7. */
export function isoWeekday(day: string): number {
  dayNumber(day);
  const d = new Date(`${day}T00:00:00Z`).getUTCDay();
  return d === 0 ? 7 : d;
}

const timeOk = (t: unknown): t is string => typeof t === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(t);
const weekdaysOf = (text: string | null): number[] => (text ?? '').split(',').map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= 7);

/** "Mon", "Mon and Thu", "Mon, Wed and Fri". */
export function weekdaysWords(days: number[]): string {
  const names = [...new Set(days)].sort((a, b) => a - b).map((d) => DAY_NAMES[d - 1]!);
  if (names.length === 7) return 'every day';
  return names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

type Days = { rule: StepRule; weekdays: number[]; night: number | null; every?: number | null; start?: string | null };

/** "every other day", "every 3 days". */
export function everyWords(every: number): string {
  return every === 2 ? 'every other day' : `every ${every} days`;
}

/** When a step falls, in words. */
export function daysWords(step: Days, cycle: number | null): string {
  if (step.rule === 'every' && step.every) return everyWords(step.every);
  if (step.rule === 'weekdays') return weekdaysWords(step.weekdays);
  if (step.rule === 'cycle') return cycle ? `night ${step.night} of ${cycle}` : `night ${step.night}`;
  return 'every day';
}

/** Whether a step falls on a day, given which night of the cycle that day is. */
export function fallsOn(step: Days, day: string, night: number | null): boolean {
  if (step.rule === 'every' && step.every && step.start) {
    // On the start day, then every N days after it. Before the start day it is not due. A missed day is just missed.
    const gap = dayNumber(day) - dayNumber(step.start);
    return gap >= 0 && gap % step.every === 0;
  }
  if (step.rule === 'weekdays') return step.weekdays.includes(isoWeekday(day));
  if (step.rule === 'cycle') return night !== null && step.night === night;
  return true;
}

/** A step's days as a short text for a download: "every day", "Mon Thu", "night 2". */
export function daysAsText(step: Days): string {
  if (step.rule === 'every' && step.every && step.start) return `${everyWords(step.every)} from ${step.start}`;
  if (step.rule === 'weekdays') return step.weekdays.map((d) => DAY_NAMES[d - 1]).join(' ');
  if (step.rule === 'cycle') return `night ${step.night}`;
  return 'every day';
}

/** Read back from `daysAsText`. Anything not understood is every day. */
export function daysFromText(text: string): Pick<StepInput, 'rule' | 'weekdays' | 'night' | 'every' | 'start'> {
  const every = /^\s*every\s+(other|\d{1,2})\s*days?\s+from\s+(\d{4}-\d{2}-\d{2})\s*$/i.exec(text);
  if (every) {
    const n = every[1]!.toLowerCase() === 'other' ? 2 : Number(every[1]);
    let real = n >= EVERY_MIN && n <= EVERY_MAX;
    try { dayNumber(every[2]!); } catch { real = false; }
    if (real) return { rule: 'every', every: n, start: every[2]! };
  }
  const night = /^\s*night\s+(\d{1,2})\s*$/i.exec(text);
  if (night && Number(night[1]) >= 1 && Number(night[1]) <= 14) return { rule: 'cycle', night: Number(night[1]) };
  const found = [...new Set(text.toLowerCase().split(/[^a-z]+/).map((w) => DAY_NAMES.findIndex((d) => d.toLowerCase() === w.slice(0, 3)) + 1).filter((n) => n > 0))];
  if (found.length && /[a-z]/i.test(text) && !/every/i.test(text)) return { rule: 'weekdays', weekdays: found };
  return { rule: 'daily' };
}

// ---------- reading ----------

type RoutineRow = {
  id: number; owner_id: number; name: string; kind: RoutineKind; for_user: number | null; for_member: number | null; for_pet: number | null; cycle_length: number | null;
  points: number | null; note: string | null; user_name: string | null; member_name: string | null; pet_name: string | null;
};
type StepRow = { id: number; words: string; rule: StepRule; weekdays: string | null; night: number | null; every_days: number | null; every_from: string | null; item_id: number | null; item: string | null; wait_seconds: number | null } & Numbers;

const BASE = `SELECT r.id, r.owner_id, r.name, r.kind, r.for_user, r.for_member, r.for_pet, r.cycle_length, r.points, r.note, ${shown('fu')} AS user_name, hm.name AS member_name, pt.name AS pet_name
  FROM routines r LEFT JOIN users fu ON fu.id = r.for_user LEFT JOIN household_members hm ON hm.id = r.for_member LEFT JOIN pets pt ON pt.id = r.for_pet`;
/** What a person may see and tick: their own, ones made for them, and everyone's (a pet's routine is everyone's). */
const VISIBLE = '(r.owner_id = ? OR r.for_user = ? OR (r.for_user IS NULL AND r.for_member IS NULL))';

const asStep = (r: StepRow, cycle: number | null): Step => {
  const weekdays = weekdaysOf(r.weekdays);
  // A step that repeats is kept as rule 'daily' with its count and start day (see migration 61).
  const every = r.every_days && r.every_from ? r.every_days : null;
  const rule: StepRule = every ? 'every' : r.rule;
  const start = every ? r.every_from : null;
  return { id: r.id, words: r.words, rule, weekdays, night: r.night, every, start, item_id: r.item_id, item: r.item, wait_seconds: r.wait_seconds, nums: numbersOf(r), tracks: hasNumbers(r), days: daysWords({ rule, weekdays, night: r.night, every, start }, cycle) };
};

const minutesOf = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));

export function routines(db: Db, viewer: number, clock: Clock = () => new Date()) {
  const today = () => todayOf(clock);
  const now = () => stamp(clock());

  async function last7Of(q: Queries, timeId: number, day: string, workout = false): Promise<number> {
    // A workout counts the days anything in it was done: a day with half the steps still counts.
    if (workout) return (await q.get<{ n: number }>('SELECT COUNT(DISTINCT k.day) AS n FROM routine_ticks k JOIN routine_steps s ON s.id = k.step_id WHERE s.time_id = ? AND k.day >= ? AND k.day <= ?', [timeId, addDays(day, -6), day]))?.n ?? 0;
    return (await q.get<{ n: number }>('SELECT COUNT(*) AS n FROM routine_finished WHERE time_id = ? AND day >= ? AND day <= ?', [timeId, addDays(day, -6), day]))?.n ?? 0;
  }

  async function lastDoneOf(q: Queries, timeId: number, workout = false): Promise<string | null> {
    const found = workout
      ? await q.get<{ day: string | null }>('SELECT MAX(k.day) AS day FROM routine_ticks k JOIN routine_steps s ON s.id = k.step_id WHERE s.time_id = ?', [timeId])
      : await q.get<{ day: string | null }>('SELECT MAX(day) AS day FROM routine_finished WHERE time_id = ?', [timeId]);
    return found?.day ?? null;
  }

  async function whole(q: Queries, row: RoutineRow, day: string): Promise<Routine> {
    const times: Time[] = [];
    for (const t of await q.all<{ id: number; name: string; at_time: string | null }>('SELECT id, name, at_time FROM routine_times WHERE routine_id = ? ORDER BY sort_order, id', [row.id])) {
      const steps = await q.all<StepRow>(
        `SELECT s.id, s.words, s.rule, s.weekdays, s.night, s.every_days, s.every_from, s.item_id, i.name AS item, s.wait_seconds, s.sets, s.reps, s.weight, s.weight_unit, s.minutes, s.distance, s.distance_unit FROM routine_steps s LEFT JOIN items i ON i.id = s.item_id
         WHERE s.time_id = ? ORDER BY s.sort_order, s.id`, [t.id]);
      times.push({ id: t.id, name: t.name, at: t.at_time, at_words: t.at_time ? clockWords(t.at_time) : null, steps: steps.map((s) => asStep(s, row.cycle_length)), last7: await last7Of(q, t.id, day, row.kind === 'workout'), last_done: await lastDoneOf(q, t.id, row.kind === 'workout') });
    }
    const kind = row.for_pet !== null ? 'pet' : row.for_member !== null ? 'member' : row.for_user === viewer ? 'me' : row.for_user !== null ? 'person' : 'everyone';
    return {
      id: row.id, name: row.name, owner_id: row.owner_id, kind: row.kind, mine: row.owner_id === viewer, for_user: row.for_user, for_member: row.for_member, for_pet: row.for_pet, who_kind: kind,
      who: kind === 'pet' ? row.pet_name ?? 'Pet' : kind === 'member' ? row.member_name ?? 'Household' : kind === 'me' ? 'You' : kind === 'person' ? row.user_name ?? 'Someone' : 'Everyone',
      cycle_length: row.cycle_length, points: row.points, note: row.note, times, tag_list: [],
    };
  }

  /** A routine the viewer may see, or a 404. */
  async function seen(q: Queries, id: number): Promise<RoutineRow> {
    const row = (await q.all<RoutineRow>(`${BASE} WHERE r.id = ? AND ${VISIBLE}`, [id, viewer, viewer]))[0];
    if (!row) throw new Problem(404, "That routine isn't here anymore. It may have been deleted.");
    return row;
  }
  /** A routine the viewer owns, or a 404. */
  async function owned(q: Queries, id: number): Promise<RoutineRow> {
    const row = (await q.all<RoutineRow>(`${BASE} WHERE r.id = ? AND r.owner_id = ?`, [id, viewer]))[0];
    if (!row) throw new Problem(404, "That routine isn't here anymore. It may have been deleted.");
    return row;
  }

  // ---------- the cycle ----------

  /**
   * Which night of the cycle a day is for a time. The night after the last one finished before the day; a night
   * with nothing at all that day is passed over, so a cycle can never get stuck on an empty night. A day already
   * finished keeps the night it was finished on.
   */
  async function nightOf(q: Queries, cycle: number | null, time: Time, day: string): Promise<number | null> {
    if (!cycle) return null;
    const finished = await q.get<{ night: number | null }>('SELECT night FROM routine_finished WHERE time_id = ? AND day = ?', [time.id, day]);
    if (finished?.night) return finished.night;
    const last = await q.get<{ night: number | null }>('SELECT night FROM routine_finished WHERE time_id = ? AND day < ? AND night IS NOT NULL ORDER BY day DESC LIMIT 1', [time.id, day]);
    const first = last?.night ? (last.night % cycle) + 1 : 1;
    let night = first;
    for (let tried = 0; tried < cycle; tried += 1) {
      if (time.steps.some((s) => fallsOn(s, day, night))) return night;
      night = (night % cycle) + 1;
    }
    return first;
  }

  /** One time on one day, with what falls that day and what is ticked. */
  async function timeDay(q: Queries, r: Routine, t: Time, day: string): Promise<DayTime> {
    const night = await nightOf(q, r.cycle_length, t, day);
    const due = t.steps.filter((s) => fallsOn(s, day, night));
    const ticked = new Map<number, { by: string | null; at: string | null; nums: Numbers }>();
    if (due.length) {
      for (const k of await q.all<{ step_id: number; by_user: number | null; by_name: string | null; ticked_at: string | null } & Numbers>(
        `SELECT k.step_id, k.by_user, ${shown('bu')} AS by_name, k.ticked_at, k.sets, k.reps, k.weight, k.weight_unit, k.minutes, k.distance, k.distance_unit FROM routine_ticks k LEFT JOIN users bu ON bu.id = k.by_user
         WHERE k.day = ? AND k.step_id IN (${due.map(() => '?').join(',')})`, [day, ...due.map((s) => s.id)])) {
        ticked.set(k.step_id, { by: k.by_user === viewer ? 'you' : k.by_name, at: k.ticked_at, nums: numbersOf(k) });
      }
    }
    const steps: DayStep[] = [];
    for (const s of due) {
      const t = ticked.get(s.id);
      let last: DayStep['last'] = null;
      let lastNums: Numbers | null = null;
      if (s.tracks) {
        const prev = await q.get<{ day: string } & Numbers>(`SELECT day, ${NUMBER_COLUMNS} FROM routine_ticks WHERE step_id = ? AND day < ? AND ${ANY_NUMBER} ORDER BY day DESC LIMIT 1`, [s.id, day]);
        if (prev) { lastNums = numbersOf(prev); const words = numbersWords(lastNums); last = { day: prev.day, words, text: `${words}, ${dayLabel(prev.day, today())}` }; }
      }
      const kept = t && s.tracks && hasNumbers(t.nums) ? t.nums : null;
      steps.push({ ...s, ticked: Boolean(t), by: t?.by ?? null, at: t?.at ?? null, last, prefill: lastNums ?? s.nums, kept, kept_words: kept ? numbersWords(kept) : null });
    }
    const done = due.filter((s) => ticked.has(s.id)).length;
    return {
      id: t.id, routine_id: r.id, routine: r.name, kind: r.kind, name: t.name,
      title: r.for_pet !== null ? `${r.who}: ${t.name}` : labelKey(r.name) === labelKey(t.name) ? r.name : `${r.name}: ${t.name}`,
      who_kind: r.who_kind, who: r.who, member_id: r.for_member, pet_id: r.for_pet, day, at: t.at, at_words: t.at_words, night, cycle_length: r.cycle_length, points: r.for_member !== null ? r.points : null,
      steps, total: due.length, done, finished: due.length > 0 && done === due.length, last7: t.last7, last_done: t.last_done,
    };
  }

  /** Keeps the record of which days were finished right after a tick: finished when every step of the day is ticked. */
  async function refinish(q: Queries, r: Routine, t: Time, day: string): Promise<DayTime> {
    const view = await timeDay(q, r, t, day);
    if (view.finished) {
      await q.run('INSERT OR IGNORE INTO routine_finished (time_id, day, night, points, by_user) VALUES (?, ?, ?, ?, ?)',
        [t.id, day, view.night, r.for_member !== null ? r.points : null, viewer]);
    } else {
      await q.run('DELETE FROM routine_finished WHERE time_id = ? AND day = ?', [t.id, day]);
    }
    return { ...view, last7: await last7Of(q, t.id, day, r.kind === 'workout'), last_done: await lastDoneOf(q, t.id, r.kind === 'workout') };
  }

  /**
   * Ticks a step for a day. A step that carries numbers keeps them with the tick: the ones sent, or (when none were sent) what
   * they start as. Ticking again with numbers changes the ones kept.
   */
  async function keepTick(q: Queries, s: DayStep, day: string, given: Partial<Numbers> | null | undefined): Promise<void> {
    const nums = !s.tracks ? NO_NUMBERS : given === undefined ? s.prefill : tidyNumbers(given, s.words);
    const made = await q.run(`INSERT OR IGNORE INTO routine_ticks (step_id, day, by_user, ticked_at, ${NUMBER_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [s.id, day, viewer, now(), ...numberValues(nums)]);
    if (made.changes === 0 && s.tracks && given !== undefined) {
      await q.run('UPDATE routine_ticks SET sets = ?, reps = ?, weight = ?, weight_unit = ?, minutes = ?, distance = ?, distance_unit = ? WHERE step_id = ? AND day = ?', [...numberValues(nums), s.id, day]);
    }
  }

  /** The day for ticking: today, or up to a week back. */
  function tickDay(given: string | null | undefined): string {
    const day = given ?? today();
    dayNumber(day);
    if (day > today()) throw new Problem(400, "A day that hasn't come yet can't be checked off");
    if (day < addDays(today(), -TICK_DAYS_BACK)) throw new Problem(400, `Only the last ${TICK_DAYS_BACK} days can be changed`);
    return day;
  }

  // ---------- checking what was sent ----------

  async function tidy(q: Queries, owner: number, input: RoutineInput, existing: RoutineRow | null) {
    const name = clean(input.name, 80);
    if (!name) throw new Problem(400, 'Give the routine a name, like "Morning"');
    const kind = input.kind ?? existing?.kind ?? 'plain';
    if (!ROUTINE_KINDS.includes(kind)) throw new Problem(400, 'A routine is a plain one or a workout');
    // A new workout is the maker's own unless they said whose it is: private to start with, and shared the way any routine is.
    const unsaid = input.for_user === undefined && input.for_member === undefined && input.for_pet === undefined;
    const forUser = unsaid && kind === 'workout' && existing === null ? owner : input.for_user ?? null;
    const forMember = input.for_member ?? null;
    const forPet = input.for_pet ?? null;
    if ([forUser, forMember, forPet].filter((x) => x !== null).length > 1) throw new Problem(400, 'A routine is for one person, one pet, or for everyone');
    if (forPet !== null && !(await q.get('SELECT 1 AS one FROM pets WHERE id = ? AND owner_id = ?', [forPet, owner]))) throw new Problem(404, "That pet isn't yours");
    if (forUser !== null && !(await q.get('SELECT 1 AS one FROM users WHERE id = ?', [forUser]))) throw new Problem(404, "That person isn't here");
    if (forMember !== null && !(await q.get('SELECT 1 AS one FROM household_members WHERE id = ? AND owner_id = ?', [forMember, owner]))) throw new Problem(404, "That person isn't in your household");
    const cycle = input.cycle_length ?? null;
    if (cycle !== null && !(Number.isInteger(cycle) && cycle >= 2 && cycle <= 14)) throw new Problem(400, 'A cycle is 2 to 14 nights long');
    const points = input.points ?? null;
    if (points !== null && !(Number.isInteger(points) && points >= 0 && points <= 1000)) throw new Problem(400, 'Points are a whole number, up to 1000');
    const times = input.times !== undefined ? input.times : existing === null ? [] : null;
    if (times === null) return { name, kind, forUser, forMember, forPet, cycle, points: forMember !== null ? points : null, note: clean(input.note, 1000), times: null };
    if (times.length < 1) throw new Problem(400, 'Add at least one time, like "Morning"');
    if (times.length > MAX_TIMES) throw new Problem(400, `A routine holds ${MAX_TIMES} times at most`);
    const seenNames = new Set<string>();
    const out = [];
    for (const t of times) {
      const timeName = clean(t.name, 40);
      if (!timeName) throw new Problem(400, 'Give each time a name, like "Morning"');
      if (seenNames.has(labelKey(timeName))) throw new Problem(409, `There are two times called ${timeName}`);
      seenNames.add(labelKey(timeName));
      const at = t.at ? t.at : null;
      if (at !== null && !timeOk(at)) throw new Problem(400, 'Pick a time of day, like 07:30');
      const steps = t.steps ?? [];
      if (steps.length < 1) throw new Problem(400, `Add at least one step to ${timeName}`);
      if (steps.length > MAX_STEPS) throw new Problem(400, `Keep ${timeName} to ${MAX_STEPS} steps`);
      const tidySteps = [];
      for (const s of steps) {
        const words = clean(s.words, 200);
        if (!words) throw new Problem(400, 'Say what each step is, like "Brush your teeth"');
        const rule = s.rule ?? 'daily';
        if (!STEP_RULES.includes(rule)) throw new Problem(400, 'A step is every day, on some weekdays, every few days, or on a night of the cycle');
        let weekdays: number[] | null = null;
        let night: number | null = null;
        let every: number | null = null;
        let start: string | null = null;
        if (rule === 'every') {
          every = s.every ?? null;
          if (every === null || !Number.isInteger(every) || every < EVERY_MIN || every > EVERY_MAX) throw new Problem(400, `Pick how many days apart, from ${EVERY_MIN} to ${EVERY_MAX}, for "${words}"`);
          start = s.start || today();
          dayNumber(start);
        } else if (rule === 'weekdays') {
          weekdays = [...new Set(s.weekdays ?? [])].sort((a, b) => a - b);
          if (weekdays.length === 0 || !weekdays.every((d) => Number.isInteger(d) && d >= 1 && d <= 7)) throw new Problem(400, `Pick the days for "${words}"`);
        } else if (rule === 'cycle') {
          if (!cycle) throw new Problem(400, `Say how many nights the cycle has before giving "${words}" a night`);
          night = s.night ?? null;
          if (night === null || !Number.isInteger(night) || night < 1 || night > cycle) throw new Problem(400, `Pick a night from 1 to ${cycle} for "${words}"`);
        }
        const itemId = s.item_id ?? null;
        if (itemId !== null && !(await q.get('SELECT 1 AS one FROM items WHERE id = ? AND owner_id = ?', [itemId, owner]))) throw new Problem(404, "That thing isn't in your things.");
        const wait = s.wait_seconds ?? null;
        if (wait !== null && !(Number.isInteger(wait) && wait >= 1 && wait <= MAX_WAIT_SECONDS)) throw new Problem(400, 'A wait is from 1 second to an hour');
        tidySteps.push({ id: s.id ?? null, words, rule, weekdays, night, every, start, item_id: itemId, wait_seconds: wait, nums: kind === 'workout' ? tidyNumbers(s.nums, words) : NO_NUMBERS });
      }
      out.push({ id: t.id ?? null, name: timeName, at, steps: tidySteps });
    }
    return { name, kind, forUser, forMember, forPet, cycle, points: forMember !== null ? points : null, note: clean(input.note, 1000), times: out };
  }

  type Tidy = Awaited<ReturnType<typeof tidy>>;

  /** Writes the times and steps of a routine. Ones that already exist keep their ids (and what was ticked on them). */
  async function writeTimes(q: Queries, routineId: number, times: NonNullable<Tidy['times']>): Promise<void> {
    const haveTimes = new Set((await q.all<{ id: number }>('SELECT id FROM routine_times WHERE routine_id = ?', [routineId])).map((t) => t.id));
    const keepTimes = new Set<number>();
    for (const [i, t] of times.entries()) {
      let timeId: number;
      if (t.id !== null && haveTimes.has(t.id)) {
        timeId = t.id;
        await q.run('UPDATE routine_times SET name = ?, at_time = ?, sort_order = ? WHERE id = ?', [t.name, t.at, i, timeId]);
      } else {
        timeId = (await q.run('INSERT INTO routine_times (routine_id, name, at_time, sort_order) VALUES (?, ?, ?, ?)', [routineId, t.name, t.at, i])).lastId;
      }
      keepTimes.add(timeId);
      const haveSteps = new Set((await q.all<{ id: number }>('SELECT id FROM routine_steps WHERE time_id = ?', [timeId])).map((s) => s.id));
      const keepSteps = new Set<number>();
      for (const [n, s] of t.steps.entries()) {
        const values: Value[] = [s.words, s.rule === 'every' ? 'daily' : s.rule, s.weekdays ? s.weekdays.join(',') : null, s.night, s.every, s.start, s.item_id, s.wait_seconds, n, ...numberValues(s.nums)];
        if (s.id !== null && haveSteps.has(s.id)) {
          await q.run('UPDATE routine_steps SET words = ?, rule = ?, weekdays = ?, night = ?, every_days = ?, every_from = ?, item_id = ?, wait_seconds = ?, sort_order = ?, sets = ?, reps = ?, weight = ?, weight_unit = ?, minutes = ?, distance = ?, distance_unit = ? WHERE id = ?', [...values, s.id]);
          keepSteps.add(s.id);
        } else {
          keepSteps.add((await q.run('INSERT INTO routine_steps (time_id, words, rule, weekdays, night, every_days, every_from, item_id, wait_seconds, sort_order, sets, reps, weight, weight_unit, minutes, distance, distance_unit) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [timeId, ...values])).lastId);
        }
      }
      for (const id of haveSteps) if (!keepSteps.has(id)) await q.run('DELETE FROM routine_steps WHERE id = ?', [id]);
    }
    for (const id of haveTimes) if (!keepTimes.has(id)) await q.run('DELETE FROM routine_times WHERE id = ?', [id]);
  }

  /** After the steps changed, today's record of what was finished is worked out again. */
  async function settleToday(q: Queries, id: number): Promise<void> {
    const row = (await q.all<RoutineRow>(`${BASE} WHERE r.id = ?`, [id]))[0]!;
    const r = await whole(q, row, today());
    for (const t of r.times) await refinish(q, r, t, today());
  }

  async function create(q: Queries, input: RoutineInput, at: string): Promise<number> {
    const count = (await q.get<{ n: number }>('SELECT COUNT(*) AS n FROM routines WHERE owner_id = ?', [viewer]))?.n ?? 0;
    if (count >= MAX_ROUTINES) throw new Problem(400, `Life Is keeps ${MAX_ROUTINES} routines at most`);
    const t = await tidy(q, viewer, input, null);
    const next = (await q.get<{ n: number | null }>('SELECT MAX(sort_order) AS n FROM routines WHERE owner_id = ?', [viewer]))?.n ?? -1;
    const made = await q.run(
      'INSERT INTO routines (owner_id, name, kind, for_user, for_member, for_pet, cycle_length, points, note, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [viewer, t.name, t.kind, t.forUser, t.forMember, t.forPet, t.cycle, t.points, t.note, next + 1, at, at]);
    await writeTimes(q, made.lastId, t.times!);
    return made.lastId;
  }

  async function oneWhole(q: Queries, id: number): Promise<Routine> {
    const row = await seen(q, id);
    const r = await whole(q, row, today());
    r.tag_list = (await attachTags(q, viewer, 'routine', [r]))[0]!.tag_list;
    return r;
  }

  return {
    /** The routines the viewer can see: their own, ones made for them, and everyone's. */
    async list(find: { tag?: number | null } = {}): Promise<Routine[]> {
      const rows = await db.all<RoutineRow>(`${BASE} WHERE ${VISIBLE} ORDER BY r.sort_order, r.name COLLATE NOCASE, r.id`, [viewer, viewer]);
      const built: Routine[] = [];
      for (const row of rows) built.push(await whole(db, row, today()));
      return attachTags(db, viewer, 'routine', await onlyTagged(db, viewer, 'routine', built, find.tag));
    },

    get: (id: number) => oneWhole(db, id),

    async create(input: RoutineInput): Promise<Routine> {
      const id = await atomic(db, async (tx) => {
        const made = await create(tx, input, now());
        await settleToday(tx, made);
        return made;
      });
      return oneWhole(db, id);
    },

    /** Changes a routine. Times and steps that are sent with their ids keep them (and what was ticked); the rest are taken out. */
    async update(id: number, input: RoutineInput): Promise<Routine> {
      await atomic(db, async (tx) => {
        const row = await owned(tx, id);
        const t = await tidy(tx, viewer, input, row);
        await tx.run('UPDATE routines SET name = ?, kind = ?, for_user = ?, for_member = ?, for_pet = ?, cycle_length = ?, points = ?, note = ?, updated_at = ? WHERE id = ?',
          [t.name, t.kind, t.forUser, t.forMember, t.forPet, t.cycle, t.points, t.note, now(), id]);
        if (t.times) await writeTimes(tx, id, t.times);
        await settleToday(tx, id);
      });
      return oneWhole(db, id);
    },

    /** Takes a routine away, with its steps and what was ticked. Its tags go too. */
    async remove(id: number): Promise<void> {
      await atomic(db, async (tx) => {
        await owned(tx, id);
        await tx.run('DELETE FROM routines WHERE id = ?', [id]);
        await unlink(tx, 'routine', id);
      });
    },

    /** The ready-made routines, and whether each is already kept. */
    async starters(forPet?: number | null): Promise<(Starter & { have: boolean })[]> {
      // A pet's ready-made routines are kept for that pet; the rest are kept by name for the viewer.
      const kept = new Set((await db.all<{ name: string }>('SELECT name FROM routines WHERE owner_id = ? AND for_pet IS ?', [viewer, forPet ?? null])).map((r) => labelKey(r.name)));
      return ROUTINE_STARTERS.map((s) => ({ ...s, have: kept.has(labelKey(s.name)) }));
    },

    /** Copies a ready-made routine to the viewer, for them. It is theirs to change. */
    async addStarter(slug: string, forUser?: number | null, forMember?: number | null, forPet?: number | null, food?: number | null): Promise<Routine> {
      const s = ROUTINE_STARTERS.find((x) => x.slug === slug);
      if (!s) throw new Problem(404, "That ready-made routine isn't one Life Is has.");
      if (s.pet && forPet == null) throw new Problem(400, `${s.name} is for a pet: pick which one`);
      const made = await this.create({
        name: s.name, cycle_length: s.cycle_length,
        for_user: forMember != null || forPet != null ? null : forUser ?? viewer, for_member: forPet != null ? null : forMember ?? null, for_pet: forPet ?? null,
        // The step that feeds the pet can use their food (a thing), so it can be marked running low from there.
        times: s.times.map((t) => ({ name: t.name, steps: t.steps.map(({ feed, ...x }) => ({ ...x, item_id: feed && food != null ? food : null })) })),
      });
      return made;
    },

    /**
     * What is on today for the viewer's own front page: routines for them and for everyone, each time with the
     * steps that fall today. A time with nothing today (a Sunday-only reset on a Tuesday) is left out.
     */
    async today(dayGiven?: string | null, pet?: number | null): Promise<DayTime[]> {
      const day = dayGiven ?? today();
      dayNumber(day);
      const rows = await db.all<RoutineRow>(`${BASE} WHERE ${VISIBLE} AND r.for_member IS NULL AND (r.for_user = ? OR r.for_user IS NULL)${pet != null ? ' AND r.for_pet = ?' : ''} ORDER BY r.sort_order, r.name COLLATE NOCASE, r.id`,
        pet != null ? [viewer, viewer, viewer, pet] : [viewer, viewer, viewer]);
      const out: DayTime[] = [];
      for (const row of rows) {
        const r = await whole(db, row, day);
        for (const t of r.times) { const v = await timeDay(db, r, t, day); if (v.total > 0) out.push(v); }
      }
      const closed = new Set((await db.all<{ time_id: number }>('SELECT time_id FROM routine_closed WHERE user_id = ? AND day = ?', [viewer, day])).map((x) => x.time_id));
      // In the order the person set them out (Morning before Evening), not by the clock: not every time has one.
      return out.map((v) => ({ ...v, closed: closed.has(v.id) }));
    },

    /** Close for today: takes a time off the viewer's own front page for a day, on every device. Nothing in it changes. */
    async close(timeId: number, dayGiven?: string | null): Promise<{ closed: true }> {
      const day = dayGiven ?? today();
      dayNumber(day);
      const found = await db.get<{ routine_id: number }>('SELECT routine_id FROM routine_times WHERE id = ?', [timeId]);
      if (!found) throw new Problem(404, "That time isn't here anymore. It may have been deleted.");
      await seen(db, found.routine_id);
      await db.run('INSERT OR IGNORE INTO routine_closed (user_id, time_id, day) VALUES (?, ?, ?)', [viewer, timeId, day]);
      await db.run('DELETE FROM routine_closed WHERE user_id = ? AND day < ?', [viewer, addDays(day, -7)]);
      return { closed: true };
    },

    /** What is on today for the household members' routines (the viewer's own): for the chore chart. */
    async forMembers(dayGiven?: string | null): Promise<DayTime[]> {
      const day = dayGiven ?? today();
      dayNumber(day);
      const rows = await db.all<RoutineRow>(`${BASE} WHERE r.owner_id = ? AND r.for_member IS NOT NULL ORDER BY hm.name COLLATE NOCASE, r.sort_order, r.id`, [viewer]);
      const out: DayTime[] = [];
      for (const row of rows) {
        const r = await whole(db, row, day);
        for (const t of r.times) { const v = await timeDay(db, r, t, day); if (v.total > 0) out.push(v); }
      }
      return out;
    },

    /** One time on a day, wherever it is shown. */
    async time(timeId: number, dayGiven?: string | null): Promise<DayTime> {
      const found = await db.get<{ routine_id: number }>('SELECT routine_id FROM routine_times WHERE id = ?', [timeId]);
      if (!found) throw new Problem(404, "That time isn't here anymore. It may have been deleted.");
      const day = dayGiven ?? today();
      dayNumber(day);
      const r = await whole(db, await seen(db, found.routine_id), day);
      const t = r.times.find((x) => x.id === timeId)!;
      return timeDay(db, r, t, day);
    },

    /** Tick a step (or take the tick back). Free to do for good: it is how a routine is used, not made. */
    async tick(stepId: number, done: boolean, dayGiven?: string | null, nums?: Partial<Numbers> | null): Promise<DayTime> {
      const day = tickDay(dayGiven);
      return atomic(db, async (tx) => {
        const found = await tx.get<{ time_id: number; routine_id: number }>('SELECT s.time_id, t.routine_id FROM routine_steps s JOIN routine_times t ON t.id = s.time_id WHERE s.id = ?', [stepId]);
        if (!found) throw new Problem(404, "That step isn't here anymore. It may have been deleted.");
        const r = await whole(tx, await seen(tx, found.routine_id), day);
        const t = r.times.find((x) => x.id === found.time_id)!;
        const view = await timeDay(tx, r, t, day);
        const step = view.steps.find((s) => s.id === stepId);
        if (!step) throw new Problem(400, "That step isn't for that day");
        if (done) await keepTick(tx, step, day, nums);
        else await tx.run('DELETE FROM routine_ticks WHERE step_id = ? AND day = ?', [stepId, day]);
        return refinish(tx, r, t, day);
      });
    },

    /** Finish a whole time at once (every step that falls that day ticked), or clear it. */
    async finish(timeId: number, done: boolean, dayGiven?: string | null): Promise<DayTime> {
      const day = tickDay(dayGiven);
      return atomic(db, async (tx) => {
        const found = await tx.get<{ routine_id: number }>('SELECT routine_id FROM routine_times WHERE id = ?', [timeId]);
        if (!found) throw new Problem(404, "That time isn't here anymore. It may have been deleted.");
        const r = await whole(tx, await seen(tx, found.routine_id), day);
        const t = r.times.find((x) => x.id === timeId)!;
        const view = await timeDay(tx, r, t, day);
        if (done) {
          for (const s of view.steps) await keepTick(tx, s, day, undefined);
        } else if (t.steps.length) {
          await tx.run(`DELETE FROM routine_ticks WHERE day = ? AND step_id IN (${t.steps.map(() => '?').join(',')})`, [day, ...t.steps.map((s) => s.id)]);
        }
        return refinish(tx, r, t, day);
      });
    },

    /**
     * Looking back at a routine, for a workout's page: how many of the last 7 days anything in it was done, a month of days
     * (done or not, nothing more said), and for each step that carries numbers its last few times. No streaks, no judging.
     */
    async history(id: number): Promise<RoutineHistory> {
      const row = await seen(db, id);
      const day = today();
      const r = await whole(db, row, day);
      const steps = r.times.flatMap((t) => t.steps);
      const since = addDays(day, -(HISTORY_DAYS - 1));
      const did = new Set<string>();
      if (steps.length) {
        for (const k of await db.all<{ day: string }>(`SELECT DISTINCT day FROM routine_ticks WHERE day >= ? AND day <= ? AND step_id IN (${steps.map(() => '?').join(',')})`, [since, day, ...steps.map((s) => s.id)])) did.add(k.day);
      }
      const days = Array.from({ length: HISTORY_DAYS }, (_, i) => { const d = addDays(since, i); return { day: d, done: did.has(d) }; });
      const tracked = [];
      for (const s of steps.filter((x) => x.tracks)) {
        const entries = (await db.all<{ day: string } & Numbers>(`SELECT day, ${NUMBER_COLUMNS} FROM routine_ticks WHERE step_id = ? AND ${ANY_NUMBER} ORDER BY day DESC LIMIT ${HISTORY_STEP_TIMES}`, [s.id]))
          .map((k) => ({ day: k.day, label: dayLabel(k.day, day), words: numbersWords(numbersOf(k)) }));
        tracked.push({ id: s.id, words: s.words, entries });
      }
      const last7 = days.slice(-7).filter((d) => d.done).length;
      return { id: row.id, name: row.name, kind: row.kind, last7, last7_text: `${last7} of the last 7 days`, days, steps: tracked };
    },

    /**
     * The thing a step names is running low: it goes on the grocery list (once; not if it is already on it), and
     * if it has a "running low" amount, what is kept is brought down to it so the thing shows as low.
     */
    async low(stepId: number): Promise<{ name: string; added: boolean; already: boolean }> {
      const found = await db.get<{ routine_id: number; item_id: number | null }>('SELECT t.routine_id, s.item_id FROM routine_steps s JOIN routine_times t ON t.id = s.time_id WHERE s.id = ?', [stepId]);
      if (!found) throw new Problem(404, "That step isn't here anymore. It may have been deleted.");
      const row = await seen(db, found.routine_id);
      if (found.item_id === null) throw new Problem(400, 'This step has no thing to run low on');
      const item = await db.get<{ id: number; name: string; quantity: number | null; low_at: number | null }>('SELECT id, name, quantity, low_at FROM items WHERE id = ? AND owner_id = ?', [found.item_id, row.owner_id]);
      if (!item) throw new Problem(404, "That thing isn't here anymore.");
      if (item.low_at !== null && item.quantity !== null && item.quantity > item.low_at) {
        await db.run('UPDATE items SET quantity = ?, updated_at = ? WHERE id = ?', [item.low_at, now(), item.id]);
      }
      const shop = kitchen(db, row.owner_id, clock);
      const listed = new Set((await shop.listGrocery()).filter((g) => !g.done).map((g) => labelKey(g.label)));
      if (listed.has(labelKey(item.name))) return { name: item.name, added: false, already: true };
      await shop.addGrocery({ label: item.name });
      return { name: item.name, added: true, already: false };
    },

    /** Where a thing is used, for its page: "Skincare: Evening". */
    async usedIn(itemId: number): Promise<{ routine_id: number; routine: string; time: string; title: string }[]> {
      if (!(await db.get('SELECT 1 AS one FROM items WHERE id = ? AND owner_id = ?', [itemId, viewer]))) throw new Problem(404, "That thing isn't here anymore. It may have been deleted.");
      const rows = await db.all<{ routine_id: number; routine: string; time: string }>(
        `SELECT DISTINCT r.id AS routine_id, r.name AS routine, t.name AS time, r.sort_order, t.sort_order AS time_order, t.id AS time_id
         FROM routine_steps s JOIN routine_times t ON t.id = s.time_id JOIN routines r ON r.id = t.routine_id
         WHERE s.item_id = ? AND ${VISIBLE} ORDER BY r.sort_order, r.id, t.sort_order, t.id`, [itemId, viewer, viewer]);
      return rows.map((x) => ({ routine_id: x.routine_id, routine: x.routine, time: x.time, title: labelKey(x.routine) === labelKey(x.time) ? x.routine : `${x.routine}: ${x.time}` }));
    },

    /**
     * The times with a clock time that fall due from one day to another for the viewer's own front page, not yet
     * finished. For the reminders, and for the phone to schedule its own.
     */
    async coming(from: string, to: string): Promise<{ key: string; routine_id: number; time_id: number; title: string; day: string; at: string; steps: number }[]> {
      dayNumber(from); dayNumber(to);
      const out = [];
      for (let day = from, guard = 0; day <= to && guard < 4; day = addDays(day, 1), guard += 1) {
        for (const v of await this.today(day)) {
          if (!v.at || v.finished) continue;
          out.push({ key: `${v.id}|${day}`, routine_id: v.routine_id, time_id: v.id, title: v.title, day, at: v.at, steps: v.total - v.done });
        }
      }
      return out.sort((a, b) => (a.day + a.at).localeCompare(b.day + b.at));
    },
  };
}

export type Routines = ReturnType<typeof routines>;

/**
 * Looked at every minute, like the prep reminders: for each person with a way of being reminded turned on, any
 * time of a routine whose clock time has just come (and is not yet finished) is sent once. One that went by more
 * than a quarter of an hour ago is not sent late. Household members' routines have no one to send to.
 */
export async function routinesDue(db: Db, now: Date, tools: ReminderTools): Promise<{ user: number; sent: Channel[]; problems: string[] }[]> {
  const out: { user: number; sent: Channel[]; problems: string[] }[] = [];
  for (const row of await db.all<{ user_id: number }>("SELECT DISTINCT user_id FROM user_settings WHERE key = 'reminders' AND value IS NOT NULL")) {
    const clock: Clock = () => now;
    const theirs = reminders(db, row.user_id, clock, tools);
    const s = await theirs.settings();
    if (!s.email && !s.ntfy && !s.push) continue;
    let here: { day: string; time: string };
    try { here = zoneNow(now, s.zone); } catch { continue; }
    const mine = routines(db, row.user_id, Object.assign(() => now, { today: () => here.day }));
    const nowMinutes = minutesOf(here.time);
    const ready = [];
    for (const c of await mine.coming(here.day, here.day)) {
      const late = nowMinutes - minutesOf(c.at);
      if (late < 0 || late > GRACE_MINUTES) continue;
      const made = await db.run('INSERT OR IGNORE INTO routine_sent (user_id, key, sent_at) VALUES (?, ?, ?)', [row.user_id, c.key, stamp(now)]);
      if (made.changes > 0) ready.push(c);
    }
    await db.run('DELETE FROM routine_sent WHERE user_id = ? AND sent_at < ?', [row.user_id, stamp(new Date(now.getTime() - 7 * 86_400_000))]);
    if (!ready.length) continue;
    const lines = ready.map((c) => ({
      kind: 'dates' as const, icon: '📌', title: c.title, detail: `${c.steps} ${c.steps === 1 ? 'step' : 'steps'} to do`, link: '/', urgent: false,
    }));
    const digest: Digest = { day: here.day, lines, title: lines.length === 1 ? lines[0]!.title : `${lines.length} routines to do`, text: '' };
    digest.text = lines.map((l) => `• ${l.title}: ${l.detail}`).join('\n') + (s.origin ? `\n\nSee them: ${s.origin}/` : '');
    out.push({ user: row.user_id, ...(await theirs.send(digest)) });
  }
  return out;
}
