/**
 * Holidays: a plan that comes back each year, with decorations, a meal countdown, gifts and cards.
 *
 * A holiday is only what the person adds (Life Is suggests none). It knows how to find its day (see
 * holidayDates.ts) and keeps one ordinary plan for each year (plans.ts), so a year has its menu, its photos
 * and its story the way any plan does, and past years stay to look back on. A year's own lists hang off its
 * plan: who came, who gets a card, gifts, decorations by spot, and countdown steps. A new year starts from
 * the last one: the same guests, cards, decorations and steps, nothing ticked, what broke or ran out last
 * year as this year's shopping list.
 *
 * Reused, not copied: recipes and their prep reminders (prep.ts), things and the boxes (places) they are
 * kept in (inventory.ts), tags and spending (tags.ts), photos (plan_photos), and the morning round
 * (reminders.ts). A holiday made from a birthday or anniversary already on the calendar keeps pointing at it.
 *
 * Gifts for a person who signs in to Life Is are never shown to them until the holiday has passed: a year is
 * only ever read by its owner, the spending a gift makes has no category (so no one a category is shared with
 * sees it), and what a person was given is only shown to them after the day (`given`).
 */
import { atomic, type Db, type Queries } from './db.ts';
import { checkedRule, dateInYear, nextDate, ruleWords, thawDays, THAW_SOURCE, type DateRule } from './holidayDates.ts';
import { inventory } from './inventory.ts';
import { plans as plansOf, type Plan } from './plans.ts';
import { clockWords, momentMinutes, prep, prepTime, tidyStep, whenWords, type Moment, type PrepStepInput } from './prep.ts';
import { Problem } from './problem.ts';
import { addDays, clean, dayNumber, dayOrNull, labelKey, stamp, todayOf, type Clock } from './small.ts';
import { spendingByTag } from './tags.ts';

export const GIFT_STATES = ['idea', 'bought', 'wrapped', 'given'] as const;
export type GiftState = (typeof GIFT_STATES)[number];
export type Fix = 'broke' | 'out';
export type Stage = 'quiet' | 'start' | 'planning' | 'take_down' | 'notes' | 'next_date';

/** The parts a holiday's first year starts with. Any can be taken off, and later years keep what the last one had. */
export const HOLIDAY_PARTS = ['food', 'guests', 'cards', 'gifts', 'decorations', 'budget', 'tasks'];
const THAW_AT = '09:00';
const MAX_ROWS = 300;
/** Spending counts toward a year if it was made this long before the day, or this long after. */
const SPEND_BEFORE = 200;
const SPEND_AFTER = 100;
/** A holiday stops asking for things this many days after its day. */
const QUIET_AFTER = 60;

export type HolidayInput = { name: string; rule: DateRule; /** The first year's day. Needed when the person sets it each year. */ day?: string | null; lead_weeks?: number | null };
export type YearChange = {
  day?: string | null; dinner_time?: string | null; turkey_pounds?: number | null; put_up_on?: string | null; take_down_on?: string | null;
  budget_cents?: number | null; notes_next?: string | null;
};
export type PersonInput = { name?: string | null; user_id?: number | null; member_id?: number | null; note?: string | null };
export type GiftInput = { who?: string | null; for_user?: number | null; for_member?: number | null; idea?: string | null; status?: string | null; cents?: number | null; note?: string | null };
export type DecorInput = {
  spot?: string | null; label?: string | null; thing_id?: number | null; box_id?: number | null; note?: string | null;
  put_up?: boolean; taken_down?: boolean; boxed?: boolean; fix?: Fix | null; need_done?: boolean;
};

export type YearOf = { plan_id: number; year: number; day: string };
export type HolidaySummary = {
  id: number; name: string; rule: DateRule; rule_words: string; lead_weeks: number; first_year: number | null; from_calendar: boolean;
  years: YearOf[];
  /** The latest year, or null when none has been made. */
  latest: (YearOf & { when: 'ahead' | 'now' | 'past' }) | null;
  stage: Stage;
  /** What is next, in words, when there is something. */
  next: string | null;
};
export type Person = { id: number; name: string; user_id: number | null; member_id: number | null; done: boolean; note: string | null };
export type Gift = {
  id: number; who: string; for_user: number | null; for_member: number | null; idea: string; status: GiftState; cents: number | null; note: string | null;
  /** What this person was given in earlier years of this holiday. */
  before: { year: number; idea: string }[];
};
export type Decor = {
  id: number; spot: string; label: string; thing_id: number | null; /** Where it is kept: the thing's place, or its box. */ box: string | null;
  put_up: boolean; taken_down: boolean; boxed: boolean; fix: Fix | null; need: Fix | null; need_done: boolean; note: string | null;
};
export type Spot = { name: string; items: Decor[]; photos: number[]; last_year: { photos: number[]; year: number | null } };
export type CountdownStep = {
  key: string; source: 'thaw' | 'step' | 'recipe' | 'cook'; words: string; what: string | null; detail: string | null;
  due_day: string; due_time: string; label: string; done: boolean; late: boolean;
  /** The step's own id, for the ones the person wrote. */
  step_id: number | null;
  /** A recipe that is also on the week's meals has its steps reminded there, so the countdown doesn't remind them twice. */
  reminded_on_week: boolean;
};
export type YearView = {
  holiday: { id: number; name: string; rule_words: string; lead_weeks: number; years: YearOf[]; from_calendar: boolean };
  plan_id: number; year: number; day: string; when: 'ahead' | 'now' | 'past';
  /** The age, or years since, for a birthday or anniversary made into a holiday. */
  turns: number | null;
  dinner_time: string | null; turkey_pounds: number | null; put_up_on: string | null; take_down_on: string | null; taken_down_on: string | null;
  budget_cents: number | null; notes_next: string | null; notes_done: boolean;
  /** What the person wrote for next year at the end of last year's. */
  last_notes: string | null;
  previous: YearOf | null;
  plan: Plan;
  guests: Person[]; cards: Person[]; gifts: Gift[];
  spots: Spot[];
  /** What broke or ran out last year, still to buy this year. */
  shopping: Decor[];
  countdown: { dinner_time: string | null; steps: CountdownStep[]; thaw: { pounds: number; days: number; source: string } | null };
  budget: { tag: string | null; spent_cents: number; count: number; target_cents: number | null };
  stage: Stage;
};
/**
 * Guests, cards, gifts and decorations work on any plan, not only a holiday's year: a birthday has gifts, a
 * memorial lunch has guests. For a plan that is not a holiday's year, this is what those parts show.
 */
export type GatheringView = {
  holiday: null; plan_id: number; day: string; when: 'ahead' | 'now' | 'past';
  guests: Person[]; cards: Person[]; gifts: Gift[]; spots: Spot[];
};

export type HolidayCard = {
  holiday_id: number; plan_id: number | null; name: string; year: number | null; day: string | null; days_until: number | null; stage: Stage;
  /** What is next, in words. */
  next: string | null; link: string;
};

type HolidayRow = {
  id: number; name: string; rule: 'fixed' | 'weekday' | 'manual'; month: number | null; day_of_month: number | null; weekday: number | null; nth: number | null;
  lead_weeks: number; event_id: number | null; first_year: number | null; tag_id: number | null;
};
type YearRow = {
  plan_id: number; holiday_id: number; year: number; dinner_time: string | null; turkey_pounds: number | null; put_up_on: string | null; take_down_on: string | null;
  taken_down_on: string | null; budget_cents: number | null; notes_next: string | null; notes_done: number;
};
type PlanRow = { id: number; name: string; start_day: string; end_day: string };
const HOLIDAY_COLUMNS = 'id, name, rule, month, day_of_month, weekday, nth, lead_weeks, event_id, first_year, tag_id';
const YEAR_COLUMNS = 'plan_id, holiday_id, year, dinner_time, turkey_pounds, put_up_on, take_down_on, taken_down_on, budget_cents, notes_next, notes_done';

const ruleOf = (h: HolidayRow): DateRule =>
  h.rule === 'fixed' ? { kind: 'fixed', month: h.month!, day: h.day_of_month! } : h.rule === 'weekday' ? { kind: 'weekday', month: h.month!, weekday: h.weekday!, nth: h.nth! } : { kind: 'manual' };
const timeOk = (t: unknown): t is string => typeof t === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(t);
const pad = (n: number) => String(n).padStart(2, '0');
const pounds = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(1)} lb`;

/** A moment some minutes earlier (or later, below zero), across midnight. */
function shifted(m: Moment, minutes: number): Moment {
  const total = momentMinutes(m) - minutes;
  const days = Math.floor(total / 1440);
  const within = total - days * 1440;
  return { day: addDays('1970-01-01', days), time: `${pad(Math.floor(within / 60))}:${pad(within % 60)}` };
}

export function holidays(db: Db, owner: number, clock: Clock = () => new Date()) {
  const now = () => stamp(clock());
  const today = () => todayOf(clock);
  const plans = () => plansOf(db, owner, clock);

  async function holidayRow(q: Queries, id: number): Promise<HolidayRow> {
    const found = await q.get<HolidayRow>(`SELECT ${HOLIDAY_COLUMNS} FROM holidays WHERE id = ? AND owner_id = ?`, [id, owner]);
    if (!found) throw new Problem(404, "That holiday isn't here anymore. It may have been deleted.");
    return found;
  }
  async function yearRow(q: Queries, planId: number): Promise<YearRow> {
    const found = await q.get<YearRow>(
      `SELECT ${YEAR_COLUMNS.split(', ').map((c) => `y.${c}`).join(', ')} FROM holiday_years y JOIN plans p ON p.id = y.plan_id WHERE y.plan_id = ? AND p.owner_id = ?`, [planId, owner]);
    if (!found) throw new Problem(404, "That holiday isn't here anymore. It may have been deleted.");
    return found;
  }
  const planRow = async (q: Queries, planId: number): Promise<PlanRow> => (await q.get<PlanRow>('SELECT id, name, start_day, end_day FROM plans WHERE id = ? AND owner_id = ?', [planId, owner]))!;
  async function yearsOf(q: Queries, holidayId: number): Promise<YearOf[]> {
    return q.all<YearOf>(
      `SELECT y.plan_id, y.year, p.start_day AS day FROM holiday_years y JOIN plans p ON p.id = y.plan_id WHERE y.holiday_id = ? AND p.owner_id = ? ORDER BY y.year DESC`, [holidayId, owner]);
  }
  const whenOf = (day: string, end: string): 'ahead' | 'now' | 'past' => (end < today() ? 'past' : day > today() ? 'ahead' : 'now');

  /** The tag spending is tagged with to count toward the holiday: found by name at the top, or made. */
  async function tagFor(q: Queries, name: string): Promise<number> {
    const key = labelKey(name);
    const have = await q.get<{ id: number }>('SELECT id FROM tags WHERE owner_id = ? AND parent_id IS NULL AND key = ? ORDER BY id LIMIT 1', [owner, key])
      ?? await q.get<{ id: number }>('SELECT id FROM tags WHERE owner_id = ? AND key = ? ORDER BY id LIMIT 1', [owner, key]);
    if (have) return have.id;
    return (await q.run('INSERT INTO tags (owner_id, name, key, parent_id, created_at) VALUES (?, ?, ?, NULL, ?)', [owner, clean(name, 60)!.replace(/>/g, ' '), key, now()])).lastId;
  }

  // ---------- making a year ----------

  /** Copies what a year keeps of its own from the last one: nothing ticked, and what broke becomes this year's shopping. */
  async function copyOwn(tx: Queries, from: YearRow, fromDay: string, to: number, toDay: string): Promise<void> {
    const moved = dayNumber(toDay) - dayNumber(fromDay);
    for (const p of await tx.all<{ role: string; name: string; user_id: number | null; member_id: number | null; note: string | null; sort_order: number }>(
      'SELECT role, name, user_id, member_id, note, sort_order FROM holiday_people WHERE plan_id = ? ORDER BY sort_order, id', [from.plan_id])) {
      await tx.run('INSERT INTO holiday_people (plan_id, role, name, user_id, member_id, done, note, sort_order) VALUES (?, ?, ?, ?, ?, 0, ?, ?)', [to, p.role, p.name, p.user_id, p.member_id, p.note, p.sort_order]);
    }
    for (const g of await tx.all<{ who: string; for_user: number | null; for_member: number | null; idea: string; note: string | null; sort_order: number }>(
      "SELECT who, for_user, for_member, idea, note, sort_order FROM holiday_gifts WHERE plan_id = ? AND status = 'idea' ORDER BY sort_order, id", [from.plan_id])) {
      await tx.run("INSERT INTO holiday_gifts (plan_id, who, for_user, for_member, idea, status, note, sort_order) VALUES (?, ?, ?, ?, ?, 'idea', ?, ?)", [to, g.who, g.for_user, g.for_member, g.idea, g.note, g.sort_order]);
    }
    for (const d of await tx.all<{ spot: string; label: string; thing_id: number | null; box_id: number | null; fix: Fix | null; need: Fix | null; need_done: number; note: string | null; sort_order: number }>(
      'SELECT spot, label, thing_id, box_id, fix, need, need_done, note, sort_order FROM holiday_decor WHERE plan_id = ? ORDER BY sort_order, id', [from.plan_id])) {
      // What the take-down found is this year's to buy; what last year already asked for and nobody bought stays asked for.
      const need = d.fix ?? (d.need_done === 1 ? null : d.need);
      await tx.run('INSERT INTO holiday_decor (plan_id, spot, label, thing_id, box_id, need, note, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [to, d.spot, d.label, d.thing_id, d.box_id, need, d.note, d.sort_order]);
    }
    for (const s of await tx.all<{ words: string; rule: string | null; at_time: string | null; hours: number | null; sort_order: number }>(
      'SELECT words, rule, at_time, hours, sort_order FROM holiday_steps WHERE plan_id = ? ORDER BY sort_order, id', [from.plan_id])) {
      await tx.run('INSERT INTO holiday_steps (plan_id, words, rule, at_time, hours, done, sort_order) VALUES (?, ?, ?, ?, ?, 0, ?)', [to, s.words, s.rule, s.at_time, s.hours, s.sort_order]);
    }
    const shift = (d: string | null) => (d ? addDays(d, moved) : null);
    await tx.run('INSERT INTO holiday_years (plan_id, holiday_id, year, dinner_time, turkey_pounds, put_up_on, take_down_on, budget_cents) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [to, from.holiday_id, Number(toDay.slice(0, 4)), from.dinner_time, from.turkey_pounds, shift(from.put_up_on), shift(from.take_down_on), from.budget_cents]);
  }

  /** Makes the year whose day is `day`: from the latest one when there is one, else a fresh plan. */
  async function makeYear(h: HolidayRow, day: string): Promise<number> {
    const year = Number(day.slice(0, 4));
    const have = await db.get<{ plan_id: number }>('SELECT y.plan_id FROM holiday_years y JOIN plans p ON p.id = y.plan_id WHERE y.holiday_id = ? AND y.year = ? AND p.owner_id = ?', [h.id, year, owner]);
    if (have) return have.plan_id;
    const name = `${h.name} ${year}`;
    const last = (await db.get<YearRow>(`SELECT ${YEAR_COLUMNS} FROM holiday_years WHERE holiday_id = ? AND year < ? ORDER BY year DESC LIMIT 1`, [h.id, year]));
    const planId = last
      ? (await plans().copy(last.plan_id, { name, start_day: day })).id
      : (await plans().create({ name, start_day: day, parts: HOLIDAY_PARTS })).id;
    await atomic(db, async (tx) => {
      if (last) await copyOwn(tx, last, (await planRow(tx, last.plan_id)).start_day, planId, day);
      else await tx.run('INSERT INTO holiday_years (plan_id, holiday_id, year, put_up_on, take_down_on) VALUES (?, ?, ?, ?, ?)', [planId, h.id, year, addDays(day, -7), addDays(day, 3)]);
    });
    return planId;
  }

  // ---------- reading a year ----------

  async function peopleOf(planId: number, role: 'guest' | 'card'): Promise<Person[]> {
    return (await db.all<{ id: number; name: string; user_id: number | null; member_id: number | null; done: number; note: string | null }>(
      'SELECT id, name, user_id, member_id, done, note FROM holiday_people WHERE plan_id = ? AND role = ? ORDER BY sort_order, id', [planId, role])).map((p) => ({ ...p, done: p.done === 1 }));
  }

  async function giftsOf(planId: number, h: HolidayRow | null, year: number): Promise<Gift[]> {
    const rows = await db.all<{ id: number; who: string; for_user: number | null; for_member: number | null; idea: string; status: GiftState; cents: number | null; note: string | null }>(
      'SELECT id, who, for_user, for_member, idea, status, cents, note FROM holiday_gifts WHERE plan_id = ? ORDER BY sort_order, id', [planId]);
    const earlier = h === null ? [] : await db.all<{ year: number; who: string; for_user: number | null; for_member: number | null; idea: string }>(
      `SELECT y.year, g.who, g.for_user, g.for_member, g.idea FROM holiday_gifts g JOIN holiday_years y ON y.plan_id = g.plan_id JOIN plans p ON p.id = g.plan_id
       WHERE y.holiday_id = ? AND y.year < ? AND p.owner_id = ? AND g.status != 'idea' ORDER BY y.year DESC, g.id`, [h.id, year, owner]);
    return rows.map((g) => ({
      ...g,
      before: earlier.filter((e) => (g.for_user !== null && e.for_user === g.for_user) || (g.for_member !== null && e.for_member === g.for_member) || labelKey(e.who) === labelKey(g.who))
        .map((e) => ({ year: e.year, idea: e.idea })),
    }));
  }

  async function decorOf(planId: number): Promise<Decor[]> {
    const rows = await db.all<{ id: number; spot: string; label: string; thing_id: number | null; box_id: number | null; put_up: number; taken_down: number; boxed: number; fix: Fix | null; need: Fix | null; need_done: number; note: string | null }>(
      'SELECT id, spot, label, thing_id, box_id, put_up, taken_down, boxed, fix, need, need_done, note FROM holiday_decor WHERE plan_id = ? ORDER BY sort_order, id', [planId]);
    if (rows.length === 0) return [];
    const inv = inventory(db, owner, clock);
    const where = new Map((await inv.listPlaces()).map((p) => [p.id, p.path]));
    const things = new Map((await inv.listItems()).map((t) => [t.id, t]));
    return rows.map(({ box_id, put_up, taken_down, boxed, need_done, ...r }) => {
      const thing = r.thing_id !== null ? things.get(r.thing_id) : undefined;
      return { ...r, label: thing?.name ?? r.label, box: thing?.place ?? (box_id !== null ? where.get(box_id) ?? null : null),
        put_up: put_up === 1, taken_down: taken_down === 1, boxed: boxed === 1, need_done: need_done === 1 };
    });
  }

  async function photosBySpot(planId: number): Promise<Map<string, number[]>> {
    const out = new Map<string, number[]>();
    for (const p of await db.all<{ id: number; spot: string }>('SELECT id, spot FROM plan_photos WHERE plan_id = ? AND spot IS NOT NULL ORDER BY sort_order, id', [planId])) {
      out.set(p.spot, [...(out.get(p.spot) ?? []), p.id]);
    }
    return out;
  }

  async function spotsOf(planId: number, previous: YearOf | null, decor: Decor[]): Promise<Spot[]> {
    const mine = await photosBySpot(planId);
    const last = previous ? await photosBySpot(previous.plan_id) : new Map<string, number[]>();
    const names = [...new Set([...decor.map((d) => d.spot), ...mine.keys()])];
    return names.map((name) => ({
      name, items: decor.filter((d) => d.spot === name), photos: mine.get(name) ?? [],
      last_year: { photos: last.get(name) ?? [], year: previous?.year ?? null },
    }));
  }

  /** Spending tagged to the holiday around this year's day, counting tags inside the holiday's tag too. */
  /**
   * Spending tagged with the holiday in the months around the day. A gift bought on a year's page counts toward
   * that year whatever day it was bought (next Thanksgiving's gift bought the day after this one), and never
   * toward another year.
   */
  async function budgetOf(h: HolidayRow, planId: number, day: string, target: number | null): Promise<YearView['budget']> {
    if (h.tag_id === null) return { tag: null, spent_cents: 0, count: 0, target_cents: target };
    const from = addDays(day, -SPEND_BEFORE);
    const to = addDays(day, SPEND_AFTER);
    const found = (await spendingByTag(db, owner, from, to)).find((t) => t.id === h.tag_id);
    const gifts = await db.all<{ plan_id: number; cents: number; day: string }>(
      `SELECT g.plan_id, e.cents, e.day FROM holiday_gifts g JOIN holiday_years y ON y.plan_id = g.plan_id
       JOIN money_entries e ON e.id = g.entry_id AND e.owner_id = ?
       JOIN tag_links l ON l.kind = 'spending' AND l.target_id = e.id AND l.tag_id = ?
       WHERE y.holiday_id = ?`, [owner, h.tag_id, h.id]);
    let cents = found?.cents ?? 0;
    let count = found?.count ?? 0;
    for (const g of gifts) {
      const inWindow = g.day >= from && g.day <= to;
      if (g.plan_id === planId && !inWindow) { cents += g.cents; count += 1; }
      if (g.plan_id !== planId && inWindow) { cents -= g.cents; count -= 1; }
    }
    return { tag: found?.path ?? (await db.get<{ name: string }>('SELECT name FROM tags WHERE id = ?', [h.tag_id]))?.name ?? null, spent_cents: cents, count, target_cents: target };
  }

  /** The meal countdown: each step counted back from when dinner is. */
  async function countdownOf(planId: number, y: YearRow, day: string): Promise<YearView['countdown']> {
    const thaw = y.turkey_pounds ? { pounds: y.turkey_pounds, days: thawDays(y.turkey_pounds), source: THAW_SOURCE } : null;
    if (!y.dinner_time) return { dinner_time: null, steps: [], thaw };
    const eat = y.dinner_time;
    const here = await prep(db, owner, clock).localNow();
    const ticked = new Set((await db.all<{ key: string }>('SELECT key FROM holiday_ticks WHERE plan_id = ?', [planId])).map((r) => r.key));
    const steps: CountdownStep[] = [];
    const add = (s: Omit<CountdownStep, 'label' | 'late' | 'due_day' | 'due_time'> & { due: Moment }) => {
      const { due, ...rest } = s;
      steps.push({ ...rest, due_day: due.day, due_time: due.time, label: whenWords(due, today()), late: !rest.done && momentMinutes(due) < momentMinutes(here) });
    };
    if (thaw) {
      add({ key: 'thaw', source: 'thaw', step_id: null, what: null, reminded_on_week: false, done: ticked.has('thaw'), due: { day: addDays(day, -thaw.days), time: THAW_AT },
        words: `Put the ${pounds(thaw.pounds)} turkey in the refrigerator to thaw`,
        detail: `${thaw.days} ${thaw.days === 1 ? 'day' : 'days'}: about 1 day for each 4 pounds, to be safe. ${THAW_SOURCE}` });
    }
    for (const s of await db.all<{ id: number; words: string; rule: PrepStepInput['rule'] | null; at_time: string | null; hours: number | null; done: number }>(
      'SELECT id, words, rule, at_time, hours, done FROM holiday_steps WHERE plan_id = ? ORDER BY sort_order, id', [planId])) {
      add({ key: `s${s.id}`, source: 'step', step_id: s.id, what: null, detail: null, reminded_on_week: false, done: s.done === 1, words: s.words,
        due: prepTime({ rule: s.rule ?? 'morning_of', at: s.at_time, hours: s.hours }, day, eat) });
    }
    for (const r of await db.all<{ ref_id: number; title: string; meal_plan_id: number | null; cook_minutes: number | null }>(
      `SELECT i.ref_id, r.title, i.meal_plan_id, r.cook_minutes FROM plan_items i JOIN recipes r ON r.id = i.ref_id AND r.owner_id = ?
       WHERE i.plan_id = ? AND i.kind = 'recipe' ORDER BY i.sort_order, i.id`, [owner, planId])) {
      for (const s of await db.all<{ id: number; words: string; rule: PrepStepInput['rule']; at_time: string | null; hours: number | null }>(
        'SELECT id, words, rule, at_time, hours FROM prep_steps WHERE owner_id = ? AND recipe_id = ? ORDER BY sort_order, id', [owner, r.ref_id])) {
        const key = `r${r.ref_id}:${s.id}`;
        add({ key, source: 'recipe', step_id: null, what: r.title, detail: null, reminded_on_week: r.meal_plan_id !== null, done: ticked.has(key), words: s.words, due: prepTime(s, day, eat) });
      }
      if (r.cook_minutes) {
        const key = `c${r.ref_id}`;
        add({ key, source: 'cook', step_id: null, what: r.title, detail: `about ${r.cook_minutes} minutes to cook`, reminded_on_week: false, done: ticked.has(key),
          words: `Start cooking ${r.title}`, due: shifted({ day, time: eat }, r.cook_minutes) });
      }
    }
    steps.sort((a, b) => momentMinutes({ day: a.due_day, time: a.due_time }) - momentMinutes({ day: b.due_day, time: b.due_time }));
    return { dinner_time: eat, steps, thaw };
  }

  /** Where a holiday stands today, and what Home should say about it. */
  async function standing(h: HolidayRow, years: YearOf[]): Promise<{ stage: Stage; next: string | null; year: (YearOf & { end: string }) | null }> {
    const day = today();
    const rows = years.map((y) => ({ ...y, end: y.day })).sort((a, b) => (a.day < b.day ? -1 : 1));
    const ahead = rows.find((y) => y.day >= day);
    const latest = rows[rows.length - 1] ?? null;
    const lead = h.lead_weeks * 7;
    if (ahead) {
      if (dayNumber(ahead.day) - dayNumber(day) > lead) return { stage: 'quiet', next: null, year: ahead };
      const y = await yearRow(db, ahead.plan_id);
      const steps = (await countdownOf(ahead.plan_id, y, ahead.day)).steps.filter((s) => !s.done);
      const undone = (await db.get<{ n: number }>('SELECT COUNT(*) AS n FROM holiday_decor WHERE plan_id = ? AND put_up = 0', [ahead.plan_id]))!.n;
      const tasks = (await db.get<{ n: number }>("SELECT COUNT(*) AS n FROM plan_items WHERE plan_id = ? AND kind = 'task' AND done = 0", [ahead.plan_id]))!.n;
      const next = steps[0] ? `${steps[0].words}: ${steps[0].label}`
        : undone > 0 && y.put_up_on ? `${undone} ${undone === 1 ? 'decoration' : 'decorations'} to put up${y.put_up_on >= day ? ` by ${y.put_up_on}` : ''}`
        : tasks > 0 ? `${tasks} ${tasks === 1 ? 'thing' : 'things'} left on the checklist` : 'Everything is ready';
      return { stage: 'planning', next, year: ahead };
    }
    if (latest && dayNumber(day) - dayNumber(latest.day) <= QUIET_AFTER) {
      const y = await yearRow(db, latest.plan_id);
      const left = (await db.get<{ n: number; total: number }>('SELECT COALESCE(SUM(CASE WHEN taken_down = 0 OR boxed = 0 THEN 1 ELSE 0 END), 0) AS n, COUNT(*) AS total FROM holiday_decor WHERE plan_id = ?', [latest.plan_id]))!;
      if (left.total > 0 && y.taken_down_on === null && left.n > 0) return { stage: 'take_down', next: `${left.n} ${left.n === 1 ? 'decoration' : 'decorations'} to take down and put back in their boxes`, year: latest };
      if (y.notes_done === 0) return { stage: 'notes', next: 'What should next year remember?', year: latest };
      if (h.rule === 'manual') return { stage: 'next_date', next: `When is next year's ${h.name}?`, year: latest };
    }
    if (h.rule !== 'manual' && !ahead) {
      const upcoming = nextDate(ruleOf(h), day);
      if (upcoming && dayNumber(upcoming) - dayNumber(day) <= lead) return { stage: 'start', next: `Start this year's from last year's`, year: latest };
    }
    return { stage: 'quiet', next: null, year: latest };
  }

  async function summaryOf(h: HolidayRow): Promise<HolidaySummary> {
    const years = await yearsOf(db, h.id);
    const latest = years[0] ? { ...years[0], when: whenOf(years[0].day, years[0].day) } : null;
    const where = await standing(h, years);
    return { id: h.id, name: h.name, rule: ruleOf(h), rule_words: ruleWords(ruleOf(h)), lead_weeks: h.lead_weeks, first_year: h.first_year, from_calendar: h.event_id !== null,
      years, latest, stage: where.stage, next: where.next };
  }

  /** The plan, checked to be this person's; any plan, holiday year or not. */
  async function ownPlan(q: Queries, planId: number): Promise<PlanRow> {
    const found = await q.get<PlanRow>('SELECT id, name, start_day, end_day FROM plans WHERE id = ? AND owner_id = ?', [planId, owner]);
    if (!found) throw new Problem(404, "That plan isn't here anymore. It may have been deleted.");
    return found;
  }
  const isYear = async (q: Queries, planId: number) => Boolean(await q.get('SELECT 1 AS x FROM holiday_years WHERE plan_id = ?', [planId]));

  /** Guests, cards, gifts and decorations of a plan that is not a holiday's year. */
  async function gatheringView(planId: number): Promise<GatheringView> {
    const plan = await plans().get(planId);
    return {
      holiday: null, plan_id: planId, day: plan.start_day, when: plan.when,
      guests: await peopleOf(planId, 'guest'), cards: await peopleOf(planId, 'card'), gifts: await giftsOf(planId, null, 0),
      spots: await spotsOf(planId, null, await decorOf(planId)),
    };
  }
  /** What a change hands back: the year of a holiday, or the gathering parts of any other plan. */
  const viewOf = async (planId: number): Promise<YearView | GatheringView> => ((await isYear(db, planId)) ? yearView(planId) : gatheringView(planId));

  async function yearView(planId: number): Promise<YearView> {
    const y = await yearRow(db, planId);
    const h = await holidayRow(db, y.holiday_id);
    const plan = await plans().get(planId);
    const years = await yearsOf(db, h.id);
    const previous = years.find((v) => v.year < y.year) ?? null;
    const decor = await decorOf(planId);
    const last = previous ? await yearRow(db, previous.plan_id) : null;
    return {
      holiday: { id: h.id, name: h.name, rule_words: ruleWords(ruleOf(h)), lead_weeks: h.lead_weeks, years, from_calendar: h.event_id !== null },
      plan_id: planId, year: y.year, day: plan.start_day, when: plan.when,
      turns: h.first_year !== null && y.year > h.first_year ? y.year - h.first_year : null,
      dinner_time: y.dinner_time, turkey_pounds: y.turkey_pounds, put_up_on: y.put_up_on, take_down_on: y.take_down_on, taken_down_on: y.taken_down_on,
      budget_cents: y.budget_cents, notes_next: y.notes_next, notes_done: y.notes_done === 1, last_notes: last?.notes_next ?? null, previous,
      plan, guests: await peopleOf(planId, 'guest'), cards: await peopleOf(planId, 'card'), gifts: await giftsOf(planId, h, y.year),
      spots: await spotsOf(planId, previous, decor), shopping: decor.filter((d) => d.need !== null),
      countdown: await countdownOf(planId, y, plan.start_day), budget: await budgetOf(h, planId, plan.start_day, y.budget_cents),
      stage: (await standing(h, years)).stage,
    };
  }

  const countRows = async (table: string, planId: number) => (await db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table} WHERE plan_id = ?`, [planId]))!.n;
  const roomFor = async (table: string, planId: number): Promise<number> => {
    if ((await countRows(table, planId)) >= MAX_ROWS) throw new Problem(400, `That list holds ${MAX_ROWS} at most`);
    return ((await db.get<{ last: number | null }>(`SELECT MAX(sort_order) AS last FROM ${table} WHERE plan_id = ?`, [planId]))!.last ?? 0) + 1;
  };

  /** A person from the household, by sign-in or without one, checked to be this person's to name. */
  async function whoIs(input: { user_id?: number | null; member_id?: number | null }): Promise<{ name: string | null; user_id: number | null; member_id: number | null }> {
    if (input.user_id != null && input.member_id != null) throw new Problem(400, 'Choose one person');
    if (input.user_id != null) {
      const u = await db.get<{ name: string }>(`SELECT COALESCE(NULLIF(TRIM((SELECT s.value FROM user_settings s WHERE s.user_id = u.id AND s.key = 'display_name')), ''), u.username) AS name FROM users u WHERE u.id = ?`, [input.user_id]);
      if (!u) throw new Problem(404, "That person isn't here");
      return { name: u.name, user_id: input.user_id, member_id: null };
    }
    if (input.member_id != null) {
      const m = await db.get<{ name: string }>('SELECT name FROM household_members WHERE id = ? AND owner_id = ?', [input.member_id, owner]);
      if (!m) throw new Problem(404, "That person isn't in your household");
      return { name: m.name, user_id: null, member_id: input.member_id };
    }
    return { name: null, user_id: null, member_id: null };
  }

  const planOf = async (table: string, id: number): Promise<number> => {
    const found = await db.get<{ plan_id: number }>(`SELECT t.plan_id FROM ${table} t JOIN plans p ON p.id = t.plan_id WHERE t.id = ? AND p.owner_id = ?`, [id, owner]);
    if (!found) throw new Problem(404, "That plan isn't here anymore. It may have been deleted.");
    return found.plan_id;
  };

  /** Gives a gift its spending entry (no category, tagged to the holiday), changes it, or takes it away. */
  async function syncGift(tx: Queries, planId: number, id: number): Promise<void> {
    const g = (await tx.get<{ idea: string; for_user: number | null; status: GiftState; cents: number | null; entry_id: number | null }>('SELECT idea, for_user, status, cents, entry_id FROM holiday_gifts WHERE id = ?', [id]))!;
    // A holiday's gift is named after the holiday and tagged with it; any other plan's, after the plan, untagged.
    const h = (await isYear(tx, planId)) ? await holidayRow(tx, (await yearRow(tx, planId)).holiday_id) : { name: (await ownPlan(tx, planId)).name, tag_id: null };
    const spent = g.status !== 'idea' && g.cents !== null;
    // A gift for someone who signs in is not named in the label, and the entry has no category.
    const label = g.for_user !== null ? `${h.name} gift` : `${h.name} gift: ${g.idea}`.slice(0, 200);
    if (!spent) {
      if (g.entry_id !== null) { await tx.run('DELETE FROM tag_links WHERE kind = ? AND target_id = ?', ['spending', g.entry_id]); await tx.run('DELETE FROM money_entries WHERE id = ? AND owner_id = ?', [g.entry_id, owner]); await tx.run('UPDATE holiday_gifts SET entry_id = NULL WHERE id = ?', [id]); }
      return;
    }
    if (g.entry_id !== null && await tx.get('SELECT 1 AS x FROM money_entries WHERE id = ? AND owner_id = ?', [g.entry_id, owner])) {
      await tx.run('UPDATE money_entries SET label = ?, cents = ? WHERE id = ? AND owner_id = ?', [label, g.cents, g.entry_id, owner]);
      return;
    }
    const made = await tx.run('INSERT INTO money_entries (owner_id, category_id, label, cents, day, note, created_at) VALUES (?, NULL, ?, ?, ?, NULL, ?)', [owner, label, g.cents, today(), now()]);
    if (h.tag_id !== null) await tx.run('INSERT OR IGNORE INTO tag_links (tag_id, kind, target_id) VALUES (?, ?, ?)', [h.tag_id, 'spending', made.lastId]);
    await tx.run('UPDATE holiday_gifts SET entry_id = ? WHERE id = ?', [made.lastId, id]);
  }

  /** When something changes what broke at the take-down and next year's page is already there, it hears of it. */
  async function passOnNeed(tx: Queries, planId: number, spot: string, label: string, fix: Fix | null): Promise<void> {
    if (!(await isYear(tx, planId))) return;
    const y = await yearRow(tx, planId);
    const next = await tx.get<{ plan_id: number }>('SELECT plan_id FROM holiday_years WHERE holiday_id = ? AND year > ? ORDER BY year LIMIT 1', [y.holiday_id, y.year]);
    if (!next) return;
    await tx.run('UPDATE holiday_decor SET need = ?, need_done = 0 WHERE plan_id = ? AND spot = ? AND label = ?', [fix, next.plan_id, spot, label]);
  }

  return {
    /** Who and what a person can pick from: people in the household (with and without a sign-in) and the boxes. */
    /** Guests, cards, gifts and decorations of any plan; for a holiday's year, its whole year. */
    async gathering(planId: number): Promise<YearView | GatheringView> {
      await ownPlan(db, planId);
      return viewOf(planId);
    },

    async options(): Promise<{ members: { id: number; name: string }[]; users: { id: number; name: string }[]; boxes: { id: number; path: string }[]; dates: { id: number; title: string; day: string }[] }> {
      return {
        /** Birthdays, anniversaries and other yearly dates on the calendar that are not holidays yet. */
        dates: await db.all('SELECT id, title, day FROM events WHERE owner_id = ? AND yearly = 1 AND id NOT IN (SELECT event_id FROM holidays WHERE event_id IS NOT NULL) ORDER BY SUBSTR(day, 6), title COLLATE NOCASE, id', [owner]),
        members: await db.all('SELECT id, name FROM household_members WHERE owner_id = ? ORDER BY name COLLATE NOCASE, id', [owner]),
        users: await db.all(`SELECT u.id, COALESCE(NULLIF(TRIM((SELECT s.value FROM user_settings s WHERE s.user_id = u.id AND s.key = 'display_name')), ''), u.username) AS name FROM users u WHERE u.id != ? ORDER BY name COLLATE NOCASE, u.id`, [owner]),
        boxes: (await inventory(db, owner, clock).listPlaces()).map((p) => ({ id: p.id, path: p.path })),
      };
    },

    async list(): Promise<HolidaySummary[]> {
      const out: HolidaySummary[] = [];
      for (const h of await db.all<HolidayRow>(`SELECT ${HOLIDAY_COLUMNS} FROM holidays WHERE owner_id = ? ORDER BY name COLLATE NOCASE, id`, [owner])) out.push(await summaryOf(h));
      return out;
    },

    async get(id: number): Promise<HolidaySummary> { return summaryOf(await holidayRow(db, id)); },

    /** Add a holiday, with its first year. */
    async create(input: HolidayInput & { event_id?: number | null; first_year?: number | null }): Promise<HolidaySummary> {
      const name = clean(input.name, 100);
      if (!name) throw new Problem(400, 'Give the holiday a name');
      const rule = checkedRule(input.rule);
      const lead = input.lead_weeks ?? 6;
      if (!Number.isInteger(lead) || lead < 1 || lead > 26) throw new Problem(400, 'Start planning 1 to 26 weeks ahead');
      const first = rule.kind === 'manual' ? dayOrNull(input.day) : (input.day ? dayOrNull(input.day) : nextDate(rule, today()));
      if (first === null) throw new Problem(400, 'Say what day it is this year');
      const id = await atomic(db, async (tx) => {
        const tag = await tagFor(tx, name);
        return (await tx.run(
          `INSERT INTO holidays (owner_id, name, rule, month, day_of_month, weekday, nth, lead_weeks, event_id, first_year, tag_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [owner, name, rule.kind, rule.kind === 'manual' ? null : rule.month, rule.kind === 'fixed' ? rule.day : null, rule.kind === 'weekday' ? rule.weekday : null,
            rule.kind === 'weekday' ? rule.nth : null, lead, input.event_id ?? null, input.first_year ?? null, tag, now(), now()])).lastId;
      });
      await makeYear(await holidayRow(db, id), first);
      return this.get(id);
    },

    /** Turn a birthday, anniversary or other yearly date on the calendar into a holiday: the same date every year, its age still shown. */
    async fromEvent(eventId: number): Promise<HolidaySummary> {
      const e = await db.get<{ id: number; title: string; day: string; yearly: number }>('SELECT id, title, day, yearly FROM events WHERE id = ? AND owner_id = ?', [eventId, owner]);
      if (!e) throw new Problem(404, "That event isn't here anymore. It may have been deleted.");
      if (e.yearly !== 1) throw new Problem(400, 'Only a date that comes every year can become a holiday');
      if (await db.get('SELECT 1 AS x FROM holidays WHERE owner_id = ? AND event_id = ?', [owner, eventId])) throw new Problem(409, 'That date is already a holiday');
      return this.create({ name: e.title, rule: { kind: 'fixed', month: Number(e.day.slice(5, 7)), day: Number(e.day.slice(8, 10)) }, event_id: eventId, first_year: Number(e.day.slice(0, 4)) });
    },

    /**
     * Make a plan come back every year. It becomes the first year of a yearly plan named after it, and each later
     * year starts from the one before: the same parts and lists, nothing checked off. Stopping (`remove`) leaves
     * every year as a plan.
     */
    async makeYearly(planId: number, input: { rule: DateRule; lead_weeks?: number | null }): Promise<Plan> {
      const plan = await ownPlan(db, planId);
      if (await isYear(db, planId)) throw new Problem(409, 'That plan already comes back every year');
      if (await db.get('SELECT 1 AS x FROM outdoor_trip_years WHERE plan_id = ?', [planId])) throw new Problem(409, 'That is a year of a trip, which already comes back with its trip');
      const rule = checkedRule(input.rule);
      const lead = input.lead_weeks ?? 6;
      if (!Number.isInteger(lead) || lead < 1 || lead > 26) throw new Problem(400, 'Start planning 1 to 26 weeks ahead');
      const year = Number(plan.start_day.slice(0, 4));
      // "Thanksgiving 2026" comes back as Thanksgiving: each year's plan carries its own year.
      const name = clean(plan.name.replace(new RegExp(`\\s+${year}$`), ''), 100) ?? plan.name.slice(0, 100);
      await atomic(db, async (tx) => {
        const made = await tx.run(
          `INSERT INTO holidays (owner_id, name, rule, month, day_of_month, weekday, nth, lead_weeks, event_id, first_year, tag_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?)`,
          [owner, name, rule.kind, rule.kind === 'manual' ? null : rule.month, rule.kind === 'fixed' ? rule.day : null, rule.kind === 'weekday' ? rule.weekday : null,
            rule.kind === 'weekday' ? rule.nth : null, lead, await tagFor(tx, name), now(), now()]);
        await tx.run('INSERT INTO holiday_years (plan_id, holiday_id, year) VALUES (?, ?, ?)', [planId, made.lastId, year]);
      });
      return plans().get(planId);
    },

    async update(id: number, input: { name?: string | null; rule?: DateRule; lead_weeks?: number | null }): Promise<HolidaySummary> {
      const h = await holidayRow(db, id);
      const name = input.name === undefined ? h.name : clean(input.name, 100);
      if (!name) throw new Problem(400, 'Give the holiday a name');
      const rule = input.rule ? checkedRule(input.rule) : ruleOf(h);
      const lead = input.lead_weeks ?? h.lead_weeks;
      if (!Number.isInteger(lead) || lead < 1 || lead > 26) throw new Problem(400, 'Start planning 1 to 26 weeks ahead');
      await db.run('UPDATE holidays SET name = ?, rule = ?, month = ?, day_of_month = ?, weekday = ?, nth = ?, lead_weeks = ?, updated_at = ? WHERE id = ? AND owner_id = ?',
        [name, rule.kind, rule.kind === 'manual' ? null : rule.month, rule.kind === 'fixed' ? rule.day : null, rule.kind === 'weekday' ? rule.weekday : null, rule.kind === 'weekday' ? rule.nth : null, lead, now(), id, owner]);
      return this.get(id);
    },

    /** Stop keeping a holiday. Its years stay as plans, to look back on. */
    async remove(id: number): Promise<void> {
      await holidayRow(db, id);
      await db.run('DELETE FROM holidays WHERE id = ? AND owner_id = ?', [id, owner]);
    },

    /**
     * Start a year from the last one (or fresh, when there is none). The day is worked out unless the person sets
     * it each year. Asked twice for the same year, it gives back the one already made.
     */
    async startYear(holidayId: number, input: { day?: string | null } = {}): Promise<YearView> {
      const h = await holidayRow(db, holidayId);
      const rule = ruleOf(h);
      let day = dayOrNull(input.day);
      if (day === null) {
        if (rule.kind === 'manual') throw new Problem(400, "Say what day it is this year");
        // One is already on its way: that is this year's.
        const coming = (await yearsOf(db, h.id)).filter((y) => y.day >= today()).pop();
        if (coming) return yearView(coming.plan_id);
        const last = (await yearsOf(db, h.id))[0];
        const wanted = last ? dateInYear(rule, last.year + 1) : null;
        // Years were skipped: start the next one coming, not one already past.
        day = wanted && wanted >= today() ? wanted : nextDate(rule, today());
      }
      return yearView(await makeYear(h, day!));
    },

    year: yearView,

    /** Change what a year keeps: dinner time, the turkey, the days to put up and take down, its budget, notes for next year. */
    async setYear(planId: number, c: YearChange): Promise<YearView> {
      const y = await yearRow(db, planId);
      const p = await planRow(db, planId);
      const dinner = c.dinner_time === undefined ? y.dinner_time : c.dinner_time;
      if (dinner !== null && !timeOk(dinner)) throw new Problem(400, 'A time is written like 18:00');
      const turkey = c.turkey_pounds === undefined ? y.turkey_pounds : c.turkey_pounds;
      if (turkey !== null) thawDays(turkey);
      const budget = c.budget_cents === undefined ? y.budget_cents : c.budget_cents;
      if (budget !== null && !(Number.isInteger(budget) && budget >= 0)) throw new Problem(400, 'A budget is an amount of money');
      const putUp = c.put_up_on === undefined ? y.put_up_on : dayOrNull(c.put_up_on);
      const takeDown = c.take_down_on === undefined ? y.take_down_on : dayOrNull(c.take_down_on);
      if (c.day != null && c.day !== p.start_day) {
        dayNumber(c.day);
        const full = await plans().get(planId);
        await plans().update(planId, { name: full.name, start_day: c.day, end_day: addDays(c.day, dayNumber(p.end_day) - dayNumber(p.start_day)), note: full.note, story: full.story });
      }
      await db.run('UPDATE holiday_years SET dinner_time = ?, turkey_pounds = ?, put_up_on = ?, take_down_on = ?, budget_cents = ?, notes_next = ? WHERE plan_id = ?',
        [dinner, turkey, putUp, takeDown, budget, c.notes_next === undefined ? y.notes_next : clean(c.notes_next, 5000), planId]);
      // Dinner is when the year's meals on the week are eaten, so their own prep reminders count back from it.
      if (dinner !== null && dinner !== y.dinner_time) {
        const pr = prep(db, owner, clock);
        for (const m of await db.all<{ meal_plan_id: number }>('SELECT meal_plan_id FROM plan_items WHERE plan_id = ? AND meal_plan_id IS NOT NULL', [planId])) await pr.setMeal(m.meal_plan_id, { eat_time: dinner }).catch(() => {});
      }
      return yearView(planId);
    },

    /** Say what next year should remember, and finish this year. The next year is started from this one, unless the day is set each year. */
    async finish(planId: number, notes: string | null): Promise<YearView> {
      const y = await yearRow(db, planId);
      await db.run('UPDATE holiday_years SET notes_next = ?, notes_done = 1 WHERE plan_id = ?', [clean(notes, 5000) ?? y.notes_next, planId]);
      const h = await holidayRow(db, y.holiday_id);
      const rule = ruleOf(h);
      if (rule.kind !== 'manual') {
        const next = dateInYear(rule, y.year + 1);
        if (next) await makeYear(h, next);
      }
      return yearView(planId);
    },

    // ---------- guests and cards ----------

    async addPerson(planId: number, role: 'guest' | 'card', input: PersonInput): Promise<YearView | GatheringView> {
      await ownPlan(db, planId);
      if (role !== 'guest' && role !== 'card') throw new Problem(400, 'Pick guests or cards.');
      const who = await whoIs(input);
      const name = clean(input.name, 100) ?? who.name;
      if (!name) throw new Problem(400, 'Say who');
      if (await db.get('SELECT 1 AS x FROM holiday_people WHERE plan_id = ? AND role = ? AND LOWER(name) = LOWER(?)', [planId, role, name])) throw new Problem(409, "They're already on the list");
      await db.run('INSERT INTO holiday_people (plan_id, role, name, user_id, member_id, done, note, sort_order) VALUES (?, ?, ?, ?, ?, 0, ?, ?)',
        [planId, role, name, who.user_id, who.member_id, clean(input.note, 500), await roomFor('holiday_people', planId)]);
      return viewOf(planId);
    },
    async updatePerson(id: number, input: { done?: boolean; note?: string | null; name?: string | null }): Promise<YearView | GatheringView> {
      const planId = await planOf('holiday_people', id);
      const old = (await db.get<{ done: number; note: string | null; name: string }>('SELECT done, note, name FROM holiday_people WHERE id = ?', [id]))!;
      const name = input.name === undefined ? old.name : clean(input.name, 100);
      if (!name) throw new Problem(400, 'Say who');
      await db.run('UPDATE holiday_people SET done = ?, note = ?, name = ? WHERE id = ?', [(input.done ?? old.done === 1) ? 1 : 0, input.note === undefined ? old.note : clean(input.note, 500), name, id]);
      return viewOf(planId);
    },
    async removePerson(id: number): Promise<YearView | GatheringView> {
      const planId = await planOf('holiday_people', id);
      await db.run('DELETE FROM holiday_people WHERE id = ?', [id]);
      return viewOf(planId);
    },

    // ---------- gifts ----------

    async addGift(planId: number, input: GiftInput): Promise<YearView | GatheringView> {
      await ownPlan(db, planId);
      const who = await whoIs({ user_id: input.for_user, member_id: input.for_member });
      const name = clean(input.who, 100) ?? who.name;
      const idea = clean(input.idea, 300);
      if (!name) throw new Problem(400, 'Say who it is for');
      if (!idea) throw new Problem(400, 'Say what the idea is');
      await db.run('INSERT INTO holiday_gifts (plan_id, who, for_user, for_member, idea, status, cents, note, sort_order) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)',
        [planId, name, who.user_id, who.member_id, idea, 'idea', clean(input.note, 500), await roomFor('holiday_gifts', planId)]);
      return viewOf(planId);
    },
    async updateGift(id: number, input: GiftInput): Promise<YearView | GatheringView> {
      const planId = await planOf('holiday_gifts', id);
      const old = (await db.get<{ who: string; idea: string; status: GiftState; cents: number | null; note: string | null }>('SELECT who, idea, status, cents, note FROM holiday_gifts WHERE id = ?', [id]))!;
      const status = input.status === undefined || input.status === null ? old.status : (GIFT_STATES as readonly string[]).includes(input.status) ? input.status as GiftState : null;
      if (status === null) throw new Problem(400, 'Pick one: an idea, bought, wrapped or given.');
      const cents = input.cents === undefined ? old.cents : input.cents;
      if (cents !== null && !(Number.isInteger(cents) && cents >= 0)) throw new Problem(400, 'What it cost is an amount of money');
      const idea = input.idea === undefined ? old.idea : clean(input.idea, 300);
      const who = input.who === undefined ? old.who : clean(input.who, 100);
      if (!idea || !who) throw new Problem(400, 'Say who it is for and what the idea is');
      await atomic(db, async (tx) => {
        await tx.run('UPDATE holiday_gifts SET who = ?, idea = ?, status = ?, cents = ?, note = ? WHERE id = ?', [who, idea, status, cents, input.note === undefined ? old.note : clean(input.note, 500), id]);
        await syncGift(tx, planId, id);
      });
      return viewOf(planId);
    },
    async removeGift(id: number): Promise<YearView | GatheringView> {
      const planId = await planOf('holiday_gifts', id);
      await atomic(db, async (tx) => {
        await tx.run("UPDATE holiday_gifts SET status = 'idea' WHERE id = ?", [id]);
        await syncGift(tx, planId, id);
        await tx.run('DELETE FROM holiday_gifts WHERE id = ?', [id]);
      });
      return viewOf(planId);
    },

    // ---------- decorations ----------

    async addDecor(planId: number, input: DecorInput): Promise<YearView | GatheringView> {
      await ownPlan(db, planId);
      const spot = clean(input.spot, 100);
      if (!spot) throw new Problem(400, 'Say where it goes: a room or a spot');
      let label = clean(input.label, 200);
      if (input.thing_id != null) {
        const t = await db.get<{ name: string }>('SELECT name FROM items WHERE id = ? AND owner_id = ?', [input.thing_id, owner]);
        if (!t) throw new Problem(404, "That isn't among your things");
        label = label ?? t.name;
      }
      if (!label) throw new Problem(400, 'Say what it is');
      if (input.box_id != null && !(await db.get('SELECT 1 AS x FROM places WHERE id = ? AND owner_id = ?', [input.box_id, owner]))) throw new Problem(404, "That box isn't there");
      await db.run('INSERT INTO holiday_decor (plan_id, spot, label, thing_id, box_id, note, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [planId, spot, label, input.thing_id ?? null, input.box_id ?? null, clean(input.note, 500), await roomFor('holiday_decor', planId)]);
      return viewOf(planId);
    },
    async updateDecor(id: number, input: DecorInput): Promise<YearView | GatheringView> {
      const planId = await planOf('holiday_decor', id);
      const o = (await db.get<{ spot: string; label: string; box_id: number | null; put_up: number; taken_down: number; boxed: number; fix: Fix | null; need_done: number; note: string | null }>(
        'SELECT spot, label, box_id, put_up, taken_down, boxed, fix, need_done, note FROM holiday_decor WHERE id = ?', [id]))!;
      const spot = input.spot === undefined ? o.spot : clean(input.spot, 100);
      const label = input.label === undefined ? o.label : clean(input.label, 200);
      if (!spot || !label) throw new Problem(400, 'Say what it is and where it goes');
      if (input.fix !== undefined && input.fix !== null && input.fix !== 'broke' && input.fix !== 'out') throw new Problem(400, 'Pick one: it broke, or it ran out.');
      const box = input.box_id === undefined ? o.box_id : input.box_id;
      if (box !== null && !(await db.get('SELECT 1 AS x FROM places WHERE id = ? AND owner_id = ?', [box, owner]))) throw new Problem(404, "That box isn't there");
      const fix = input.fix === undefined ? o.fix : input.fix;
      const down = input.taken_down ?? o.taken_down === 1;
      await atomic(db, async (tx) => {
        await tx.run('UPDATE holiday_decor SET spot = ?, label = ?, box_id = ?, put_up = ?, taken_down = ?, boxed = ?, fix = ?, need_done = ?, note = ? WHERE id = ?',
          [spot, label, box, (input.put_up ?? o.put_up === 1) ? 1 : 0, down ? 1 : 0, (down ? (input.boxed ?? o.boxed === 1) : false) ? 1 : 0, fix, (input.need_done ?? o.need_done === 1) ? 1 : 0,
            input.note === undefined ? o.note : clean(input.note, 500), id]);
        if (fix !== o.fix) await passOnNeed(tx, planId, spot, label, fix);
      });
      return viewOf(planId);
    },
    async removeDecor(id: number): Promise<YearView | GatheringView> {
      const planId = await planOf('holiday_decor', id);
      await db.run('DELETE FROM holiday_decor WHERE id = ?', [id]);
      return viewOf(planId);
    },
    /** Everything is down and back in its box: the take-down is finished. */
    async finishTakeDown(planId: number): Promise<YearView | GatheringView> {
      await ownPlan(db, planId);
      await db.run('UPDATE holiday_decor SET taken_down = 1, boxed = 1 WHERE plan_id = ?', [planId]);
      await db.run('UPDATE holiday_years SET taken_down_on = ? WHERE plan_id = ?', [today(), planId]);
      return viewOf(planId);
    },
    /** A photo of one spot, kept with the year's photos under the spot's name: next year's put-up list shows it. */
    async keepSpotPhoto(planId: number, spot: string, bytes: Uint8Array): Promise<YearView | GatheringView> {
      await ownPlan(db, planId);
      const name = clean(spot, 100);
      if (!name) throw new Problem(400, 'Say which spot it is of');
      await plans().keepPhoto(planId, bytes, name);
      await db.run('UPDATE plan_photos SET spot = ? WHERE id = (SELECT MAX(id) FROM plan_photos WHERE plan_id = ?)', [name, planId]);
      return viewOf(planId);
    },

    // ---------- the countdown ----------

    async addStep(planId: number, input: PrepStepInput): Promise<YearView> {
      await yearRow(db, planId);
      const s = tidyStep(input);
      await db.run('INSERT INTO holiday_steps (plan_id, words, rule, at_time, hours, done, sort_order) VALUES (?, ?, ?, ?, ?, 0, ?)',
        [planId, s.words, s.rule, s.at ?? null, s.hours ?? null, await roomFor('holiday_steps', planId)]);
      return yearView(planId);
    },
    async removeStep(id: number): Promise<YearView> {
      const planId = await planOf('holiday_steps', id);
      await db.run('DELETE FROM holiday_steps WHERE id = ?', [id]);
      return yearView(planId);
    },
    /** Tick a countdown step (by its key) or take the tick off. */
    async tick(planId: number, key: string, done: boolean): Promise<YearView> {
      await yearRow(db, planId);
      const own = /^s(\d{1,15})$/.exec(key);
      if (own) {
        await planOf('holiday_steps', Number(own[1]));
        await db.run('UPDATE holiday_steps SET done = ? WHERE id = ?', [done ? 1 : 0, Number(own[1])]);
      } else if (/^(thaw|r\d{1,15}:\d{1,15}|c\d{1,15})$/.test(key)) {
        await db.run(done ? 'INSERT OR IGNORE INTO holiday_ticks (plan_id, key) VALUES (?, ?)' : 'DELETE FROM holiday_ticks WHERE plan_id = ? AND key = ?', [planId, key]);
      } else throw new Problem(400, "That isn't a step");
      return yearView(planId);
    },

    // ---------- Home, reminders ----------

    /** What Home says: each holiday that has something to say now. */
    async cards(): Promise<HolidayCard[]> {
      const out: HolidayCard[] = [];
      for (const h of await db.all<HolidayRow>(`SELECT ${HOLIDAY_COLUMNS} FROM holidays WHERE owner_id = ? ORDER BY id`, [owner])) {
        const years = await yearsOf(db, h.id);
        const s = await standing(h, years);
        if (s.stage === 'quiet') continue;
        const y = s.year;
        out.push({ holiday_id: h.id, plan_id: y?.plan_id ?? null, name: h.name, year: y?.year ?? null, day: y?.day ?? null,
          days_until: y ? Math.max(0, dayNumber(y.day) - dayNumber(today())) : null, stage: s.stage, next: s.next,
          link: y && s.stage !== 'start' ? `/plans/${y.plan_id}` : `/plans/holidays/${h.id}` });
      }
      return out.sort((a, b) => (a.days_until ?? 9999) - (b.days_until ?? 9999));
    },

    /** The morning round's lines for today: time to start planning, the day to put up, the day to take down. */
    async digestLines(): Promise<{ title: string; detail: string; link: string; urgent: boolean }[]> {
      const day = today();
      const out: { title: string; detail: string; link: string; urgent: boolean }[] = [];
      for (const r of await db.all<{ holiday_id: number; name: string; lead_weeks: number; plan_id: number; start_day: string; put_up_on: string | null; take_down_on: string | null }>(
        `SELECT h.id AS holiday_id, h.name, h.lead_weeks, y.plan_id, p.start_day, y.put_up_on, y.take_down_on FROM holiday_years y JOIN holidays h ON h.id = y.holiday_id JOIN plans p ON p.id = y.plan_id
         WHERE h.owner_id = ? AND p.start_day >= ? AND p.start_day <= ? ORDER BY p.start_day`, [owner, addDays(day, -30), addDays(day, 26 * 7 + 1)])) {
        const link = `/plans/${r.plan_id}`;
        if (addDays(r.start_day, -r.lead_weeks * 7) === day) out.push({ title: `Time to start planning ${r.name}`, detail: `${r.lead_weeks} weeks to go`, link, urgent: false });
        const left = async (col: 'put_up' | 'taken_down') => (await db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM holiday_decor WHERE plan_id = ? AND ${col} = 0`, [r.plan_id]))!.n;
        if (r.put_up_on === day && (await left('put_up')) > 0) out.push({ title: `Put up the ${r.name} decorations`, detail: `${await left('put_up')} still to put up`, link, urgent: true });
        if (r.take_down_on === day && (await left('taken_down')) > 0) out.push({ title: `Take down the ${r.name} decorations`, detail: `${await left('taken_down')} still to take down`, link, urgent: true });
      }
      return out;
    },

    /**
     * Countdown steps falling due from one day to another that nothing else reminds: not done, and not a recipe's
     * step when that recipe is also on the week's meals (the week's own reminders have it).
     */
    async countdownDue(from: string, to: string): Promise<{ key: string; words: string; what: string; eat_time: string; due_day: string; due_time: string; link: string }[]> {
      const out: { key: string; words: string; what: string; eat_time: string; due_day: string; due_time: string; link: string }[] = [];
      for (const r of await db.all<{ plan_id: number; day: string; holiday_id: number; name: string }>(
        `SELECT y.plan_id, p.start_day AS day, h.id AS holiday_id, h.name FROM holiday_years y JOIN holidays h ON h.id = y.holiday_id JOIN plans p ON p.id = y.plan_id
         WHERE h.owner_id = ? AND y.dinner_time IS NOT NULL AND p.start_day >= ? AND p.start_day <= ? ORDER BY p.start_day`, [owner, from, addDays(to, 70)])) {
        const c = await countdownOf(r.plan_id, await yearRow(db, r.plan_id), r.day);
        for (const s of c.steps) {
          if (s.done || s.reminded_on_week || s.due_day < from || s.due_day > to) continue;
          out.push({ key: `holiday|${r.plan_id}|${s.key}|${s.due_day}T${s.due_time}`, words: s.words, what: `${r.name} dinner`, eat_time: c.dinner_time!, due_day: s.due_day, due_time: s.due_time, link: `/plans/${r.plan_id}` });
        }
      }
      return out;
    },
  };
}

export type Holidays = ReturnType<typeof holidays>;

/**
 * What other people gave this person, for them to see once the day has passed. Until then it shows nothing, so a
 * gift stays a surprise, whoever else can read the holiday. Only gifts marked as given count.
 */
export async function givenTo(db: Db, viewer: number, clock: Clock = () => new Date()): Promise<{ holiday: string; year: number; day: string; idea: string }[]> {
  return db.all(
    `SELECT h.name AS holiday, y.year, p.start_day AS day, g.idea FROM holiday_gifts g JOIN holiday_years y ON y.plan_id = g.plan_id JOIN holidays h ON h.id = y.holiday_id
     JOIN plans p ON p.id = g.plan_id WHERE g.for_user = ? AND g.status = 'given' AND p.end_day < ? ORDER BY p.start_day DESC, g.id`, [viewer, todayOf(clock)]);
}

/** A time, for the people who read it: "6 pm". */
export const dinnerWords = (time: string | null) => (time ? clockWords(time) : null);
