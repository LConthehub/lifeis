/**
 * Routines: checklists for parts of the day. A routine ("Skincare") has one or more named times ("Morning",
 * "Evening"), each with an optional clock time and its own steps.
 *
 * Whose: a routine belongs to one person with a sign-in (`for_user`), to a household member without one
 * (`for_member`, like the children on the chore chart), or to everyone (neither). A person's own routines show
 * only on their front page; a household member's show on the chore chart (and can earn chore points); everyone's
 * show for all.
 *
 * Step days: each step is every day (the usual), on chosen weekdays, or on one night of a cycle whose length the
 * routine sets (a four-night skin cycle). A cycle waits for you: it moves on only when that time was finished,
 * so skipping Tuesday and Wednesday is still the same cycle night on Thursday.
 *
 * A time is finished for a day when every step that falls on that day is ticked. Which days each time was finished
 * is kept, and read back as "5 of the last 7 days" (never a streak).
 *
 * A step can name a thing (an item); the thing's page then says where it is used, and from the step the thing can
 * be marked running low, which puts it on the grocery list the way upkeep does.
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

export const STEP_RULES = ['daily', 'weekdays', 'cycle'] as const;
export type StepRule = (typeof STEP_RULES)[number];
/** Weekdays go by number, Monday 1 to Sunday 7. */
export const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

export const MAX_ROUTINES = 60;
export const MAX_TIMES = 6;
export const MAX_STEPS = 30;
export const MAX_WAIT_SECONDS = 3600;
/** How far back a day may be ticked or un-ticked. */
export const TICK_DAYS_BACK = 7;

export type StepInput = {
  /** Present when it is an existing step being changed (so what was ticked today stays ticked). */
  id?: number | null;
  words: string;
  rule?: StepRule | null;
  /** Monday 1 to Sunday 7, for `weekdays`. */
  weekdays?: number[] | null;
  /** Which night of the cycle, for `cycle`. */
  night?: number | null;
  /** A thing (an item) the step uses. */
  item_id?: number | null;
  /** A timer to wait after the step, in seconds ("let the serum dry"). */
  wait_seconds?: number | null;
};
export type TimeInput = { id?: number | null; name: string; at?: string | null; steps?: StepInput[] };
export type RoutineInput = {
  name: string;
  /** A person with a sign-in. Neither this nor `for_member`: everyone. */
  for_user?: number | null;
  for_member?: number | null;
  /** How many nights the cycle has, 2 to 14, or none. */
  cycle_length?: number | null;
  /** What finishing one time of it is worth to a household member, in chore points. */
  points?: number | null;
  note?: string | null;
  times?: TimeInput[];
};

export type Step = {
  id: number; words: string; rule: StepRule; weekdays: number[]; night: number | null;
  item_id: number | null; item: string | null; wait_seconds: number | null;
  /** When it falls, in words: "every day", "Mon and Thu", "night 2 of 4". */
  days: string;
};
export type Time = { id: number; name: string; at: string | null; at_words: string | null; steps: Step[]; /** Days finished of the last 7, today included. */ last7: number };
export type Routine = {
  id: number; name: string; owner_id: number;
  /** Whether it is the viewer's own to change. */
  mine: boolean;
  for_user: number | null; for_member: number | null;
  who_kind: 'me' | 'person' | 'member' | 'everyone';
  /** "You", "Sam", "Everyone". */
  who: string;
  cycle_length: number | null; points: number | null; note: string | null;
  times: Time[];
  tag_list: TagRef[];
};

/** One time of one routine on one day: the steps that fall that day, and which are ticked. */
export type DayStep = Step & { ticked: boolean };
export type DayTime = {
  id: number; routine_id: number; routine: string; name: string;
  /** How to head it: the routine's name, then the time's unless they are the same word. */
  title: string;
  who_kind: Routine['who_kind']; who: string; member_id: number | null;
  day: string; at: string | null; at_words: string | null;
  /** Which night of the cycle this day is, or null without a cycle. */
  night: number | null; cycle_length: number | null;
  points: number | null;
  steps: DayStep[];
  total: number; done: number; finished: boolean; last7: number;
};

export type Starter = { slug: string; name: string; about: string; cycle_length: number | null; times: { name: string; steps: StepInput[] }[] };

const everyDay = (words: string, extra: Partial<StepInput> = {}): StepInput => ({ words, rule: 'daily', ...extra });
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

/** When a step falls, in words. */
export function daysWords(step: { rule: StepRule; weekdays: number[]; night: number | null }, cycle: number | null): string {
  if (step.rule === 'weekdays') return weekdaysWords(step.weekdays);
  if (step.rule === 'cycle') return cycle ? `night ${step.night} of ${cycle}` : `night ${step.night}`;
  return 'every day';
}

/** Whether a step falls on a day, given which night of the cycle that day is. */
export function fallsOn(step: { rule: StepRule; weekdays: number[]; night: number | null }, day: string, night: number | null): boolean {
  if (step.rule === 'weekdays') return step.weekdays.includes(isoWeekday(day));
  if (step.rule === 'cycle') return night !== null && step.night === night;
  return true;
}

/** A step's days as a short text for a download: "every day", "Mon Thu", "night 2". */
export function daysAsText(step: { rule: StepRule; weekdays: number[]; night: number | null }): string {
  if (step.rule === 'weekdays') return step.weekdays.map((d) => DAY_NAMES[d - 1]).join(' ');
  if (step.rule === 'cycle') return `night ${step.night}`;
  return 'every day';
}

/** Read back from `daysAsText`. Anything not understood is every day. */
export function daysFromText(text: string): Pick<StepInput, 'rule' | 'weekdays' | 'night'> {
  const night = /^\s*night\s+(\d{1,2})\s*$/i.exec(text);
  if (night && Number(night[1]) >= 1 && Number(night[1]) <= 14) return { rule: 'cycle', night: Number(night[1]) };
  const found = [...new Set(text.toLowerCase().split(/[^a-z]+/).map((w) => DAY_NAMES.findIndex((d) => d.toLowerCase() === w.slice(0, 3)) + 1).filter((n) => n > 0))];
  if (found.length && /[a-z]/i.test(text) && !/every/i.test(text)) return { rule: 'weekdays', weekdays: found };
  return { rule: 'daily' };
}

// ---------- reading ----------

type RoutineRow = {
  id: number; owner_id: number; name: string; for_user: number | null; for_member: number | null; cycle_length: number | null;
  points: number | null; note: string | null; user_name: string | null; member_name: string | null;
};
type StepRow = { id: number; words: string; rule: StepRule; weekdays: string | null; night: number | null; item_id: number | null; item: string | null; wait_seconds: number | null };

const BASE = `SELECT r.id, r.owner_id, r.name, r.for_user, r.for_member, r.cycle_length, r.points, r.note, ${shown('fu')} AS user_name, hm.name AS member_name
  FROM routines r LEFT JOIN users fu ON fu.id = r.for_user LEFT JOIN household_members hm ON hm.id = r.for_member`;
/** What a person may see and tick: their own, ones made for them, and everyone's. */
const VISIBLE = '(r.owner_id = ? OR r.for_user = ? OR (r.for_user IS NULL AND r.for_member IS NULL))';

const asStep = (r: StepRow, cycle: number | null): Step => {
  const weekdays = weekdaysOf(r.weekdays);
  return { id: r.id, words: r.words, rule: r.rule, weekdays, night: r.night, item_id: r.item_id, item: r.item, wait_seconds: r.wait_seconds, days: daysWords({ rule: r.rule, weekdays, night: r.night }, cycle) };
};

const minutesOf = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));

export function routines(db: Db, viewer: number, clock: Clock = () => new Date()) {
  const today = () => todayOf(clock);
  const now = () => stamp(clock());

  async function last7Of(q: Queries, timeId: number, day: string): Promise<number> {
    return (await q.get<{ n: number }>('SELECT COUNT(*) AS n FROM routine_finished WHERE time_id = ? AND day >= ? AND day <= ?', [timeId, addDays(day, -6), day]))?.n ?? 0;
  }

  async function whole(q: Queries, row: RoutineRow, day: string): Promise<Routine> {
    const times: Time[] = [];
    for (const t of await q.all<{ id: number; name: string; at_time: string | null }>('SELECT id, name, at_time FROM routine_times WHERE routine_id = ? ORDER BY sort_order, id', [row.id])) {
      const steps = await q.all<StepRow>(
        `SELECT s.id, s.words, s.rule, s.weekdays, s.night, s.item_id, i.name AS item, s.wait_seconds FROM routine_steps s LEFT JOIN items i ON i.id = s.item_id
         WHERE s.time_id = ? ORDER BY s.sort_order, s.id`, [t.id]);
      times.push({ id: t.id, name: t.name, at: t.at_time, at_words: t.at_time ? clockWords(t.at_time) : null, steps: steps.map((s) => asStep(s, row.cycle_length)), last7: await last7Of(q, t.id, day) });
    }
    const kind = row.for_member !== null ? 'member' : row.for_user === viewer ? 'me' : row.for_user !== null ? 'person' : 'everyone';
    return {
      id: row.id, name: row.name, owner_id: row.owner_id, mine: row.owner_id === viewer, for_user: row.for_user, for_member: row.for_member, who_kind: kind,
      who: kind === 'member' ? row.member_name ?? 'Household' : kind === 'me' ? 'You' : kind === 'person' ? row.user_name ?? 'Someone' : 'Everyone',
      cycle_length: row.cycle_length, points: row.points, note: row.note, times, tag_list: [],
    };
  }

  /** A routine the viewer may see, or a 404. */
  async function seen(q: Queries, id: number): Promise<RoutineRow> {
    const row = (await q.all<RoutineRow>(`${BASE} WHERE r.id = ? AND ${VISIBLE}`, [id, viewer, viewer]))[0];
    if (!row) throw new Problem(404, 'Not found');
    return row;
  }
  /** A routine the viewer owns, or a 404. */
  async function owned(q: Queries, id: number): Promise<RoutineRow> {
    const row = (await q.all<RoutineRow>(`${BASE} WHERE r.id = ? AND r.owner_id = ?`, [id, viewer]))[0];
    if (!row) throw new Problem(404, 'Not found');
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
    const ticked = new Set<number>();
    if (due.length) {
      for (const k of await q.all<{ step_id: number }>(`SELECT step_id FROM routine_ticks WHERE day = ? AND step_id IN (${due.map(() => '?').join(',')})`, [day, ...due.map((s) => s.id)])) ticked.add(k.step_id);
    }
    const done = due.filter((s) => ticked.has(s.id)).length;
    return {
      id: t.id, routine_id: r.id, routine: r.name, name: t.name, title: labelKey(r.name) === labelKey(t.name) ? r.name : `${r.name}: ${t.name}`,
      who_kind: r.who_kind, who: r.who, member_id: r.for_member, day, at: t.at, at_words: t.at_words, night, cycle_length: r.cycle_length, points: r.for_member !== null ? r.points : null,
      steps: due.map((s) => ({ ...s, ticked: ticked.has(s.id) })), total: due.length, done, finished: due.length > 0 && done === due.length, last7: t.last7,
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
    return { ...view, last7: await last7Of(q, t.id, day) };
  }

  /** The day for ticking: today, or up to a week back. */
  function tickDay(given: string | null | undefined): string {
    const day = given ?? today();
    dayNumber(day);
    if (day > today()) throw new Problem(400, "A day that hasn't come yet can't be ticked");
    if (day < addDays(today(), -TICK_DAYS_BACK)) throw new Problem(400, `Only the last ${TICK_DAYS_BACK} days can be changed`);
    return day;
  }

  // ---------- checking what was sent ----------

  async function tidy(q: Queries, owner: number, input: RoutineInput, existing: RoutineRow | null) {
    const name = clean(input.name, 80);
    if (!name) throw new Problem(400, 'Give the routine a name, like "Morning"');
    const forUser = input.for_user ?? null;
    const forMember = input.for_member ?? null;
    if (forUser !== null && forMember !== null) throw new Problem(400, 'A routine is for one person, or for everyone');
    if (forUser !== null && !(await q.get('SELECT 1 AS one FROM users WHERE id = ?', [forUser]))) throw new Problem(404, "That person isn't here");
    if (forMember !== null && !(await q.get('SELECT 1 AS one FROM household_members WHERE id = ? AND owner_id = ?', [forMember, owner]))) throw new Problem(404, "That person isn't in your household");
    const cycle = input.cycle_length ?? null;
    if (cycle !== null && !(Number.isInteger(cycle) && cycle >= 2 && cycle <= 14)) throw new Problem(400, 'A cycle is 2 to 14 nights long');
    const points = input.points ?? null;
    if (points !== null && !(Number.isInteger(points) && points >= 0 && points <= 1000)) throw new Problem(400, 'Points are a whole number, up to 1000');
    const times = input.times !== undefined ? input.times : existing === null ? [] : null;
    if (times === null) return { name, forUser, forMember, cycle, points: forMember !== null ? points : null, note: clean(input.note, 1000), times: null };
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
        if (!STEP_RULES.includes(rule)) throw new Problem(400, 'A step is every day, on some weekdays, or on a night of the cycle');
        let weekdays: number[] | null = null;
        let night: number | null = null;
        if (rule === 'weekdays') {
          weekdays = [...new Set(s.weekdays ?? [])].sort((a, b) => a - b);
          if (weekdays.length === 0 || !weekdays.every((d) => Number.isInteger(d) && d >= 1 && d <= 7)) throw new Problem(400, `Pick the days for "${words}"`);
        } else if (rule === 'cycle') {
          if (!cycle) throw new Problem(400, `Say how many nights the cycle has before giving "${words}" a night`);
          night = s.night ?? null;
          if (night === null || !Number.isInteger(night) || night < 1 || night > cycle) throw new Problem(400, `Pick a night from 1 to ${cycle} for "${words}"`);
        }
        const itemId = s.item_id ?? null;
        if (itemId !== null && !(await q.get('SELECT 1 AS one FROM items WHERE id = ? AND owner_id = ?', [itemId, owner]))) throw new Problem(404, 'That thing is not in your things');
        const wait = s.wait_seconds ?? null;
        if (wait !== null && !(Number.isInteger(wait) && wait >= 1 && wait <= MAX_WAIT_SECONDS)) throw new Problem(400, 'A wait is from 1 second to an hour');
        tidySteps.push({ id: s.id ?? null, words, rule, weekdays, night, item_id: itemId, wait_seconds: wait });
      }
      out.push({ id: t.id ?? null, name: timeName, at, steps: tidySteps });
    }
    return { name, forUser, forMember, cycle, points: forMember !== null ? points : null, note: clean(input.note, 1000), times: out };
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
        const values: Value[] = [s.words, s.rule, s.weekdays ? s.weekdays.join(',') : null, s.night, s.item_id, s.wait_seconds, n];
        if (s.id !== null && haveSteps.has(s.id)) {
          await q.run('UPDATE routine_steps SET words = ?, rule = ?, weekdays = ?, night = ?, item_id = ?, wait_seconds = ?, sort_order = ? WHERE id = ?', [...values, s.id]);
          keepSteps.add(s.id);
        } else {
          keepSteps.add((await q.run('INSERT INTO routine_steps (time_id, words, rule, weekdays, night, item_id, wait_seconds, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [timeId, ...values])).lastId);
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
      'INSERT INTO routines (owner_id, name, for_user, for_member, cycle_length, points, note, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [viewer, t.name, t.forUser, t.forMember, t.cycle, t.points, t.note, next + 1, at, at]);
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
        await tx.run('UPDATE routines SET name = ?, for_user = ?, for_member = ?, cycle_length = ?, points = ?, note = ?, updated_at = ? WHERE id = ?',
          [t.name, t.forUser, t.forMember, t.cycle, t.points, t.note, now(), id]);
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
    async starters(): Promise<(Starter & { have: boolean })[]> {
      const kept = new Set((await db.all<{ name: string }>('SELECT name FROM routines WHERE owner_id = ?', [viewer])).map((r) => labelKey(r.name)));
      return ROUTINE_STARTERS.map((s) => ({ ...s, have: kept.has(labelKey(s.name)) }));
    },

    /** Copies a ready-made routine to the viewer, for them. It is theirs to change. */
    async addStarter(slug: string, forUser?: number | null, forMember?: number | null): Promise<Routine> {
      const s = ROUTINE_STARTERS.find((x) => x.slug === slug);
      if (!s) throw new Problem(404, 'Not found');
      const made = await this.create({
        name: s.name, cycle_length: s.cycle_length,
        for_user: forMember != null ? null : forUser ?? viewer, for_member: forMember ?? null,
        times: s.times.map((t) => ({ name: t.name, steps: t.steps.map((x) => ({ ...x })) })),
      });
      return made;
    },

    /**
     * What is on today for the viewer's own front page: routines for them and for everyone, each time with the
     * steps that fall today. A time with nothing today (a Sunday-only reset on a Tuesday) is left out.
     */
    async today(dayGiven?: string | null): Promise<DayTime[]> {
      const day = dayGiven ?? today();
      dayNumber(day);
      const rows = await db.all<RoutineRow>(`${BASE} WHERE ${VISIBLE} AND r.for_member IS NULL AND (r.for_user = ? OR r.for_user IS NULL) ORDER BY r.sort_order, r.name COLLATE NOCASE, r.id`, [viewer, viewer, viewer]);
      const out: DayTime[] = [];
      for (const row of rows) {
        const r = await whole(db, row, day);
        for (const t of r.times) { const v = await timeDay(db, r, t, day); if (v.total > 0) out.push(v); }
      }
      // In the order the person set them out (Morning before Evening), not by the clock: not every time has one.
      return out;
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
      if (!found) throw new Problem(404, 'Not found');
      const day = dayGiven ?? today();
      dayNumber(day);
      const r = await whole(db, await seen(db, found.routine_id), day);
      const t = r.times.find((x) => x.id === timeId)!;
      return timeDay(db, r, t, day);
    },

    /** Tick a step (or take the tick back). Free to do for good: it is how a routine is used, not made. */
    async tick(stepId: number, done: boolean, dayGiven?: string | null): Promise<DayTime> {
      const day = tickDay(dayGiven);
      return atomic(db, async (tx) => {
        const found = await tx.get<{ time_id: number; routine_id: number }>('SELECT s.time_id, t.routine_id FROM routine_steps s JOIN routine_times t ON t.id = s.time_id WHERE s.id = ?', [stepId]);
        if (!found) throw new Problem(404, 'Not found');
        const r = await whole(tx, await seen(tx, found.routine_id), day);
        const t = r.times.find((x) => x.id === found.time_id)!;
        const view = await timeDay(tx, r, t, day);
        if (!view.steps.some((s) => s.id === stepId)) throw new Problem(400, "That step isn't for that day");
        if (done) await tx.run('INSERT OR IGNORE INTO routine_ticks (step_id, day, by_user) VALUES (?, ?, ?)', [stepId, day, viewer]);
        else await tx.run('DELETE FROM routine_ticks WHERE step_id = ? AND day = ?', [stepId, day]);
        return refinish(tx, r, t, day);
      });
    },

    /** Finish a whole time at once (every step that falls that day ticked), or clear it. */
    async finish(timeId: number, done: boolean, dayGiven?: string | null): Promise<DayTime> {
      const day = tickDay(dayGiven);
      return atomic(db, async (tx) => {
        const found = await tx.get<{ routine_id: number }>('SELECT routine_id FROM routine_times WHERE id = ?', [timeId]);
        if (!found) throw new Problem(404, 'Not found');
        const r = await whole(tx, await seen(tx, found.routine_id), day);
        const t = r.times.find((x) => x.id === timeId)!;
        const view = await timeDay(tx, r, t, day);
        if (done) {
          for (const s of view.steps) await tx.run('INSERT OR IGNORE INTO routine_ticks (step_id, day, by_user) VALUES (?, ?, ?)', [s.id, day, viewer]);
        } else if (t.steps.length) {
          await tx.run(`DELETE FROM routine_ticks WHERE day = ? AND step_id IN (${t.steps.map(() => '?').join(',')})`, [day, ...t.steps.map((s) => s.id)]);
        }
        return refinish(tx, r, t, day);
      });
    },

    /**
     * The thing a step names is running low: it goes on the grocery list (once; not if it is already on it), and
     * if it has a "running low" amount, what is kept is brought down to it so the thing shows as low.
     */
    async low(stepId: number): Promise<{ name: string; added: boolean; already: boolean }> {
      const found = await db.get<{ routine_id: number; item_id: number | null }>('SELECT t.routine_id, s.item_id FROM routine_steps s JOIN routine_times t ON t.id = s.time_id WHERE s.id = ?', [stepId]);
      if (!found) throw new Problem(404, 'Not found');
      const row = await seen(db, found.routine_id);
      if (found.item_id === null) throw new Problem(400, 'This step has no thing to run low on');
      const item = await db.get<{ id: number; name: string; quantity: number | null; low_at: number | null }>('SELECT id, name, quantity, low_at FROM items WHERE id = ? AND owner_id = ?', [found.item_id, row.owner_id]);
      if (!item) throw new Problem(404, 'That thing is gone');
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
      if (!(await db.get('SELECT 1 AS one FROM items WHERE id = ? AND owner_id = ?', [itemId, viewer]))) throw new Problem(404, 'Not found');
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
