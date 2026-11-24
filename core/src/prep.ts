/**
 * Prep reminders: "thaw the chicken the night before". A prep step is some words and a "when" worked out from
 * the time a meal is eaten:
 *   - the night before, at a time ("the night before at 8 pm"),
 *   - the morning of, at a time ("the morning of at 7 am"),
 *   - some hours before ("3 hours before dinner").
 *
 * A step is kept on a recipe (it applies every time the recipe is planned) or on one planned meal (a one-off).
 * A planned meal may have its own time to eat; without one it is breakfast 8 am, lunch noon, dinner 6 pm and a
 * snack 3 pm.
 *
 * `prepTime` is the one place a step becomes a dated time. Anything else that counts back from a time (a
 * holiday meal countdown, say) gives it a day, a time and a rule and gets a day and a time back.
 *
 * Times are the person's own wall clock (their time zone, the way the morning reminders handle it), kept as
 * a day and "HH:MM", so nothing here needs to turn a wall clock into an instant.
 *
 * Reminders go out through the ways the person already turned on for the morning round (email, ntfy, browser),
 * at the worked-out time. A step whose time has already gone is never sent late, and one belonging to a meal
 * that was moved or removed follows it.
 */
import type { Db, Queries } from './db.ts';
import { atomic } from './db.ts';
import { Problem } from './problem.ts';
import { holidays } from './holidays.ts';
import { reminders, zoneNow, type Channel, type Digest, type ReminderTools } from './reminders.ts';
import { addDays, clean, dayNumber, stamp, todayOf, type Clock } from './small.ts';

export const PREP_RULES = ['night_before', 'morning_of', 'hours_before'] as const;
export type PrepRule = (typeof PREP_RULES)[number];
export type Meal = 'breakfast' | 'lunch' | 'dinner' | 'snack';

/** When each meal is eaten unless the planned meal says otherwise. */
export const EAT_DEFAULTS: Record<Meal, string> = { breakfast: '08:00', lunch: '12:00', dinner: '18:00', snack: '15:00' };
const NIGHT_AT = '20:00';
const MORNING_AT = '07:00';
const MAX_STEPS = 20;
/** A reminder whose time went by this many minutes ago is still sent (the server looks once a minute); older is dropped. */
export const GRACE_MINUTES = 15;

export type PrepStepInput = { words: string; rule: PrepRule; at?: string | null; hours?: number | null };
export type PrepStep = { id: number; words: string; rule: PrepRule; at: string | null; hours: number | null; /** In words: "the night before at 8 pm". */ when: string };
export type Moment = { day: string; time: string };
export type Coming = {
  /** Stays the same for the same step, meal and time; used to send each reminder once. */
  key: string;
  meal_id: number;
  meal_day: string;
  meal: Meal;
  /** What is being eaten. */
  what: string;
  eat_time: string;
  words: string;
  /** 'recipe' for a step kept on the recipe, 'meal' for a one-off on the planned meal. */
  source: 'recipe' | 'meal';
  due_day: string;
  due_time: string;
  /** "tonight 8 pm", "tomorrow morning 7 am". */
  label: string;
};

const timeOk = (t: unknown): t is string => typeof t === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(t);
const minutesOf = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
const pad = (n: number) => String(n).padStart(2, '0');

/**
 * The day and time a step is due, for a meal eaten on `day` at `eat` ("HH:MM"). "Hours before" counts back
 * across midnight, month ends and year ends; "the night before" is the evening of the day before.
 */
export function prepTime(step: { rule: PrepRule; at?: string | null; hours?: number | null }, day: string, eat: string): Moment {
  if (step.rule === 'night_before') return { day: addDays(day, -1), time: timeOk(step.at) ? step.at : NIGHT_AT };
  if (step.rule === 'morning_of') return { day, time: timeOk(step.at) ? step.at : MORNING_AT };
  const back = Math.round(step.hours ?? 1) * 60;
  const total = minutesOf(eat) - back;
  const dayShift = Math.floor(total / 1440);
  const within = total - dayShift * 1440;
  return { day: addDays(day, dayShift), time: `${pad(Math.floor(within / 60))}:${pad(within % 60)}` };
}

/** Minutes since the start of day number 0, for comparing two moments. */
export const momentMinutes = (m: Moment) => dayNumber(m.day) * 1440 + minutesOf(m.time);

/** "8 pm", "7:30 am", "noon". */
export function clockWords(time: string): string {
  const h = Number(time.slice(0, 2));
  const m = time.slice(3, 5);
  if (h === 12 && m === '00') return 'noon';
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}${m === '00' ? '' : `:${m}`} ${h < 12 ? 'am' : 'pm'}`;
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Where a due moment is, said the way a person would: "tonight 8 pm", "tomorrow morning 7 am", "Thursday 3 pm". */
export function whenWords(due: Moment, today: string): string {
  const at = clockWords(due.time);
  const hour = Number(due.time.slice(0, 2));
  const gap = dayNumber(due.day) - dayNumber(today);
  if (gap === 0) return hour >= 17 ? `tonight ${at}` : hour < 12 ? `this morning ${at}` : `today ${at}`;
  if (gap === 1) return hour < 12 ? `tomorrow morning ${at}` : hour >= 17 ? `tomorrow night ${at}` : `tomorrow ${at}`;
  if (gap === -1) return `yesterday ${at}`;
  return `${WEEKDAYS[new Date(`${due.day}T00:00:00Z`).getUTCDay()]} ${at}`;
}

/** A step's rule in words: "the night before at 8 pm", "the morning of at 7 am", "3 hours before". */
export function ruleWords(step: { rule: PrepRule; at?: string | null; hours?: number | null }): string {
  if (step.rule === 'night_before') return `the night before at ${clockWords(timeOk(step.at) ? step.at : NIGHT_AT)}`;
  if (step.rule === 'morning_of') return `the morning of at ${clockWords(timeOk(step.at) ? step.at : MORNING_AT)}`;
  const n = Math.round(step.hours ?? 1);
  return `${n} ${n === 1 ? 'hour' : 'hours'} before`;
}

/** Steps as lines of text for the download: "night before 20:00: Thaw the chicken". */
export function prepAsText(steps: { words: string; rule: PrepRule; at: string | null; hours: number | null }[]): string {
  return steps.map((s) => {
    const rule = s.rule === 'night_before' ? `night before ${timeOk(s.at) ? s.at : NIGHT_AT}`
      : s.rule === 'morning_of' ? `morning of ${timeOk(s.at) ? s.at : MORNING_AT}` : `${Math.round(s.hours ?? 1)} hours before`;
    return `${rule}: ${s.words.replace(/\s*\n\s*/g, ' ')}`;
  }).join('\n');
}

/** Steps read back from `prepAsText`. A line that isn't understood is left out. */
export function prepFromText(text: string): PrepStepInput[] {
  const out: PrepStepInput[] = [];
  for (const line of text.replace(/\r/g, '').split('\n')) {
    const m = /^\s*(?:(night before|morning of)\s+([01]\d|2[0-3]):([0-5]\d)|(\d{1,2})\s+hours?\s+before)\s*:\s*(.+?)\s*$/i.exec(line);
    if (!m) continue;
    const words = clean(m[5], 300);
    if (!words) continue;
    if (m[1]) out.push({ words, rule: m[1].toLowerCase() === 'night before' ? 'night_before' : 'morning_of', at: `${m[2]}:${m[3]}` });
    else if (Number(m[4]) >= 1 && Number(m[4]) <= 72) out.push({ words, rule: 'hours_before', hours: Number(m[4]) });
    if (out.length >= MAX_STEPS) break;
  }
  return out;
}

/** Checks one step a person typed and gives it back tidy. */
export function tidyStep(raw: PrepStepInput): PrepStepInput {
  const words = clean(raw.words, 300);
  if (!words) throw new Problem(400, 'Say what to do, like "Thaw the chicken"');
  if (!PREP_RULES.includes(raw.rule)) throw new Problem(400, 'Pick the night before, the morning of, or some hours before');
  if (raw.rule === 'hours_before') {
    const hours = Number(raw.hours);
    if (!Number.isInteger(hours) || hours < 1 || hours > 72) throw new Problem(400, 'Hours before is a whole number from 1 to 72');
    return { words, rule: raw.rule, at: null, hours };
  }
  const at = raw.at ?? (raw.rule === 'night_before' ? NIGHT_AT : MORNING_AT);
  if (!timeOk(at)) throw new Problem(400, 'Pick a time of day, like 20:00');
  return { words, rule: raw.rule, at, hours: null };
}

type StepRow = { id: number; words: string; rule: PrepRule; at_time: string | null; hours: number | null };
const asStep = (r: StepRow): PrepStep => ({ id: r.id, words: r.words, rule: r.rule, at: r.at_time, hours: r.hours, when: ruleWords({ rule: r.rule, at: r.at_time, hours: r.hours }) });

export function prep(db: Db, owner: number, clock: Clock = () => new Date()) {
  /** The person's own now: the day and time on their wall clock. */
  async function localNow(): Promise<Moment> {
    const zone = (await reminders(db, owner, clock).settings()).zone;
    if (zone) { const n = zoneNow(clock(), zone); return { day: n.day, time: n.time }; }
    const at = clock();
    return { day: todayOf(clock), time: `${pad(at.getHours())}:${pad(at.getMinutes())}` };
  }

  async function steps(q: Queries, column: 'recipe_id' | 'meal_plan_id', id: number): Promise<PrepStep[]> {
    return (await q.all<StepRow>(`SELECT id, words, rule, at_time, hours FROM prep_steps WHERE owner_id = ? AND ${column} = ? ORDER BY sort_order, id`, [owner, id])).map(asStep);
  }

  async function replace(q: Queries, column: 'recipe_id' | 'meal_plan_id', id: number, list: PrepStepInput[]): Promise<void> {
    if (!Array.isArray(list)) throw new Problem(400, 'Prep steps come as a list');
    if (list.length > MAX_STEPS) throw new Problem(400, `Keep it to ${MAX_STEPS} prep steps`);
    const tidy = list.map(tidyStep);
    await q.run(`DELETE FROM prep_steps WHERE owner_id = ? AND ${column} = ?`, [owner, id]);
    for (const [i, s] of tidy.entries()) {
      await q.run(`INSERT INTO prep_steps (owner_id, ${column}, words, rule, at_time, hours, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [owner, id, s.words, s.rule, s.at ?? null, s.hours ?? null, i]);
    }
  }

  type MealRow = { id: number; day: string; meal: Meal; recipe_id: number | null; title: string | null; recipe_title: string | null; eat_time: string | null };
  const mealRows = (from: string, to: string) => db.all<MealRow>(
    `SELECT m.id, m.day, m.meal, m.recipe_id, m.title, r.title AS recipe_title, m.eat_time FROM meal_plan m LEFT JOIN recipes r ON r.id = m.recipe_id
     WHERE m.owner_id = ? AND m.day >= ? AND m.day <= ? AND m.cooked_on IS NULL ORDER BY m.day, m.id`, [owner, from, to]);

  /** Every step of the meals eaten between two days, worked out. Past ones are left out unless `past` says otherwise. */
  async function coming(from: string, to: string, today: string, past: Moment | null): Promise<Coming[]> {
    const out: Coming[] = [];
    for (const m of await mealRows(from, to)) {
      const eat = timeOk(m.eat_time) ? m.eat_time : EAT_DEFAULTS[m.meal];
      const rows = await db.all<StepRow & { source: 'recipe' | 'meal' }>(
        `SELECT id, words, rule, at_time, hours, 'meal' AS source FROM prep_steps WHERE owner_id = ? AND meal_plan_id = ?
         UNION ALL SELECT id, words, rule, at_time, hours, 'recipe' AS source FROM prep_steps WHERE owner_id = ? AND recipe_id = ? AND ? IS NOT NULL
         ORDER BY source DESC, id`, [owner, m.id, owner, m.recipe_id, m.recipe_id]);
      for (const r of rows) {
        const due = prepTime({ rule: r.rule, at: r.at_time, hours: r.hours }, m.day, eat);
        if (past && momentMinutes(due) < momentMinutes(past)) continue;
        out.push({
          key: `${m.id}|${r.source}${r.id}|${due.day}T${due.time}`, meal_id: m.id, meal_day: m.day, meal: m.meal, what: m.recipe_title ?? m.title ?? m.meal,
          eat_time: eat, words: r.words, source: r.source, due_day: due.day, due_time: due.time, label: whenWords(due, today),
        });
      }
    }
    return out.sort((a, b) => momentMinutes({ day: a.due_day, time: a.due_time }) - momentMinutes({ day: b.due_day, time: b.due_time }) || a.meal_id - b.meal_id);
  }

  /** A planned meal's time to eat and its own prep steps (the recipe's are listed apart, as they belong to the recipe). */
  async function mealOf(mealId: number): Promise<{ meal_id: number; meal: Meal; eat_time: string | null; default_eat_time: string; steps: PrepStep[]; recipe_steps: PrepStep[] }> {
    const m = await db.get<{ id: number; meal: Meal; recipe_id: number | null; eat_time: string | null }>('SELECT id, meal, recipe_id, eat_time FROM meal_plan WHERE id = ? AND owner_id = ?', [mealId, owner]);
    if (!m) throw new Problem(404, 'Not found');
    return {
      meal_id: m.id, meal: m.meal, eat_time: m.eat_time, default_eat_time: EAT_DEFAULTS[m.meal],
      steps: await steps(db, 'meal_plan_id', m.id), recipe_steps: m.recipe_id ? await steps(db, 'recipe_id', m.recipe_id) : [],
    };
  }

  return {
    localNow,

    recipeSteps: (recipeId: number) => steps(db, 'recipe_id', recipeId),

    /** Replace a recipe's prep steps. */
    async setRecipeSteps(recipeId: number, list: PrepStepInput[]): Promise<PrepStep[]> {
      return atomic(db, async (tx) => {
        if (!(await tx.get('SELECT 1 AS one FROM recipes WHERE id = ? AND owner_id = ?', [recipeId, owner]))) throw new Problem(404, 'Not found');
        await replace(tx, 'recipe_id', recipeId, list);
        return steps(tx, 'recipe_id', recipeId);
      });
    },

    meal: mealOf,

    /** Change a planned meal's time to eat (null goes back to the usual) and/or replace its own prep steps. */
    async setMeal(mealId: number, change: { eat_time?: string | null; steps?: PrepStepInput[] }) {
      await atomic(db, async (tx) => {
        if (!(await tx.get('SELECT 1 AS one FROM meal_plan WHERE id = ? AND owner_id = ?', [mealId, owner]))) throw new Problem(404, 'Not found');
        if (change.eat_time !== undefined) {
          if (change.eat_time !== null && !timeOk(change.eat_time)) throw new Problem(400, 'Pick a time of day, like 18:00');
          await tx.run('UPDATE meal_plan SET eat_time = ? WHERE id = ?', [change.eat_time, mealId]);
        }
        if (change.steps !== undefined) await replace(tx, 'meal_plan_id', mealId, change.steps);
      });
      return mealOf(mealId);
    },

    /** The prep for the meals eaten from one day to another, ones still to come first. For the week page. */
    async forMeals(from: string, to: string): Promise<Coming[]> {
      dayNumber(from); dayNumber(to);
      const now = await localNow();
      return coming(from, to, now.day, now);
    },

    /** The prep falling due from one day to another (on the person's wall clock), ones still to come. For Home and the phone. */
    async due(from: string, to: string, keepPast = false): Promise<Coming[]> {
      dayNumber(from); dayNumber(to);
      const now = await localNow();
      // A step is due at most 72 hours before its meal.
      return (await coming(from, addDays(to, 4), now.day, keepPast ? null : now)).filter((c) => c.due_day >= from && c.due_day <= to);
    },
  };
}

export type Prep = ReturnType<typeof prep>;

/**
 * Looked at every minute, like the morning round: for each person who has a way of being reminded turned on,
 * any prep step whose time has just come is sent (once). One whose time went by more than a quarter of an hour
 * ago is not sent late. Returns who was sent what, for the log.
 */
export async function prepDue(db: Db, now: Date, tools: ReminderTools): Promise<{ user: number; sent: Channel[]; problems: string[] }[]> {
  const out: { user: number; sent: Channel[]; problems: string[] }[] = [];
  for (const row of await db.all<{ user_id: number }>("SELECT DISTINCT user_id FROM user_settings WHERE key = 'reminders' AND value IS NOT NULL")) {
    const clock: Clock = () => now;
    const theirs = reminders(db, row.user_id, clock, tools);
    const s = await theirs.settings();
    if (!s.email && !s.ntfy && !s.push) continue;
    let here: { day: string; time: string };
    try { here = zoneNow(now, s.zone); } catch { continue; }
    const mine = prep(db, row.user_id, Object.assign(() => now, { today: () => here.day }));
    const nowMinutes = momentMinutes(here);
    const ready: Coming[] = [];
    for (const c of await mine.due(here.day, here.day, true)) {
      const late = nowMinutes - momentMinutes({ day: c.due_day, time: c.due_time });
      if (late < 0 || late > GRACE_MINUTES) continue;
      const made = await db.run('INSERT OR IGNORE INTO prep_sent (owner_id, key, sent_at) VALUES (?, ?, ?)', [row.user_id, c.key, stamp(now)]);
      if (made.changes > 0) ready.push(c);
    }
    // Remembering is only needed for a while: forget what went out over a week ago.
    await db.run('DELETE FROM prep_sent WHERE owner_id = ? AND sent_at < ?', [row.user_id, stamp(new Date(now.getTime() - 7 * 86_400_000))]);
    // A holiday's countdown (counted back from dinner) goes the same way, once each.
    const holiday: { words: string; what: string; eat_time: string; link: string }[] = [];
    for (const c of await holidays(db, row.user_id, Object.assign(() => now, { today: () => here.day })).countdownDue(here.day, here.day)) {
      const late = nowMinutes - momentMinutes({ day: c.due_day, time: c.due_time });
      if (late < 0 || late > GRACE_MINUTES) continue;
      const made = await db.run('INSERT OR IGNORE INTO prep_sent (owner_id, key, sent_at) VALUES (?, ?, ?)', [row.user_id, c.key, stamp(now)]);
      if (made.changes > 0) holiday.push(c);
    }
    if (!ready.length && !holiday.length) continue;
    const lines = [...ready.map((c) => ({ words: c.words, what: c.what, eat_time: c.eat_time, link: '/week' })), ...holiday].map((c) => ({
      kind: 'dates' as const, icon: '📌', title: c.words, detail: `for ${c.what} at ${clockWords(c.eat_time)}`, link: c.link, urgent: false,
    }));
    const digest: Digest = { day: here.day, lines, title: lines.length === 1 ? lines[0]!.title : `${lines.length} things to get ready`, text: '' };
    digest.text = lines.map((l) => `• ${l.title}: ${l.detail}`).join('\n') + (s.origin ? `\n\nSee the week: ${s.origin}/week` : '');
    out.push({ user: row.user_id, ...(await theirs.send(digest)) });
  }
  return out;
}
