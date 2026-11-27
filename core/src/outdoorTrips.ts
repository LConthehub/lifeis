/**
 * Outdoor trips: one trip that comes back each year, with parts you turn on (camping, fishing, hunting).
 *
 * A trip is only what the person adds. Like a holiday (holidays.ts) it keeps one ordinary plan for each year
 * (plans.ts), so a year has its menu, its photos and its story, and past years stay to look back on. A new year
 * starts from the last one: the same bring list with nothing packed, the same camp menu on new days, the seasons
 * moved a year on, and the notes the person left for it.
 *
 * What each part keeps, hung off the year's plan:
 *   camping  a bring list from the camping gear (things), a camp menu from recipes that goes to the grocery
 *            list, the cooler and stove checked against what is owned, a typed-in site booking shown on the
 *            calendar, and after the trip what each piece needs: dry, clean, repair (a job in Upkeep) or
 *            replace (the shopping list).
 *   fishing  a catch log (with the lure from the person's tackle), tackle running low, "what worked" for each
 *            water and season from the person's own log, fish to the freezer, a license check, and seasons.
 *   hunting  a bring list, a license and tag check, an ammunition check for each caliber, a harvest log, meat
 *            to the freezer (no animal is assumed), and seasons. Everything in it is private to its person:
 *            the people in the house see only the trip's name and days.
 *
 * Places are words only: nothing is looked up, mapped or sent anywhere.
 *
 * Reused, not copied: things and what is running low (inventory.ts), recipes, the week's meals and the grocery
 * list (kitchen.ts), the pantry and freezer (kitchen.ts), jobs (upkeep.ts), the calendar, licenses, tags and
 * spending (tags.ts), and the morning round (reminders.ts).
 *
 * Guns and ammunition (the "Hunting and shooting" set in Things, private to the person) feed the hunting part: the
 * bring list is filled from the kinds "Firearms" and "Hunting gear" (or things for the activity Hunting), a gun's
 * caliber or gauge adds an ammunition line to bring, and the ammunition check counts the rounds kept for each caliber.
 * Nothing about a gun leaves the person's own trip, and a hunting part is never shown to anyone else.
 */
import { atomic, type Db, type Queries } from './db.ts';
import { dateInYear } from './holidayDates.ts';
import { inventory, type Inventory, type Item } from './inventory.ts';
import { kitchen } from './kitchen.ts';
import type { EquipmentShortage } from './kitchenTypes.ts';
import { licenses } from './licenses.ts';
import { plans as plansOf, type Plan, type PlanItem } from './plans.ts';
import { Problem } from './problem.ts';
import { addDays, clean, dayNumber, dayOrNull, labelKey, stamp, todayOf, type Clock } from './small.ts';
import { spendingByTag } from './tags.ts';
import { upkeep } from './upkeep.ts';

export const PARTS = ['camping', 'fishing', 'hunting'] as const;
export type Part = (typeof PARTS)[number];
export const AFTER_TRIP = ['dry', 'clean', 'repair', 'replace'] as const;
export type AfterTrip = (typeof AFTER_TRIP)[number];

const MAX_ROWS = 400;
/** Spending counts toward a year if it was made this long before the first day, or this long after the last. */
const SPEND_BEFORE = 90;
const SPEND_AFTER = 45;

/** Where a part's bring list can be filled from: things of these kinds, or for these activities. */
export const GEAR_SOURCES: { part: Part; kinds: string[]; activities: string[] }[] = [
  { part: 'camping', kinds: ['Camping gear'], activities: ['Camping'] },
  { part: 'fishing', kinds: ['Fishing tackle'], activities: ['Fishing'] },
  { part: 'hunting', kinds: ['Hunting gear', 'Firearms'], activities: ['Hunting'] },
];

/**
 * How many rounds of a caliber are on hand, or null when none are kept. The ammunition records answer first (their
 * caliber or gauge, as typed: ".308" finds ".308 Win"); other things whose name has the caliber in it count after that.
 */
export async function ammoOnHand(inv: Inventory, caliber: string): Promise<number | null> {
  const key = labelKey(caliber);
  if (!key) return null;
  const kept = (await inv.ammoByCaliber()).filter((a) => labelKey(a.caliber).includes(key) || key.includes(labelKey(a.caliber)));
  if (kept.length > 0) return kept.reduce((n, a) => n + a.rounds, 0);
  const found = (await inv.listItems()).filter((t) => labelKey(t.name).includes(key) && t.quantity !== null);
  return found.length === 0 ? null : found.reduce((n, t) => n + (t.quantity ?? 0), 0);
}

export type TripInput = { name: string; parts?: string[]; private?: boolean; day?: string | null; end_day?: string | null };
export type YearChange = {
  day?: string | null; end_day?: string | null; water?: string | null; campground?: string | null; site?: string | null; confirmation?: string | null;
  check_in?: string | null; check_out?: string | null; budget_cents?: number | null; notes_next?: string | null;
};
export type GearInput = { part?: string | null; thing_id?: number | null; label?: string | null; quantity?: number | null; caliber?: string | null; note?: string | null };
export type GearChange = { packed?: boolean; returned?: boolean; after_trip?: string | null; after_done?: boolean; quantity?: number | null; note?: string | null };
export type SeasonInput = { part?: string | null; label?: string | null; opens_on?: string | null; closes_on?: string | null; remind_days?: number | null; note?: string | null };
export type CatchInput = {
  fish?: string | null; day?: string | null; water?: string | null; length_inches?: number | null; weight_lb?: number | null; kept?: boolean;
  lure_thing_id?: number | null; lure?: string | null; note?: string | null;
};
export type HarvestInput = { animal?: string | null; day?: string | null; place?: string | null; tag_number?: string | null; weight_lb?: number | null; note?: string | null };

export type YearOf = { plan_id: number; year: number; day: string };
export type TripSummary = {
  id: number; name: string; parts: Part[]; private: boolean; years: YearOf[];
  latest: (YearOf & { end_day: string; when: 'ahead' | 'now' | 'past' }) | null;
  /** Said in words: the next thing, or how many things are left to pack. */
  next: string | null;
};
export type Gear = {
  id: number; part: Part; thing_id: number | null; label: string; quantity: number | null; caliber: string | null; packed: boolean; returned: boolean;
  after_trip: AfterTrip | null; after_done: boolean; job_id: number | null; note: string | null;
  /** What the thing is, when it is one of the person's: how many there are, whether it is running low, where it is kept. */
  have: string | null; low: boolean; place: string | null;
};
export type Season = { id: number; part: 'fishing' | 'hunting'; label: string; opens_on: string; closes_on: string | null; remind_days: number; note: string | null; days_to_open: number };
export type Catch = {
  id: number; fish: string; day: string; water: string | null; length_inches: number | null; weight_lb: number | null; kept: boolean;
  lure_thing_id: number | null; lure: string | null; frozen: boolean; note: string | null;
};
export type Harvest = { id: number; animal: string; day: string; place: string | null; tag_number: string | null; weight_lb: number | null; frozen: boolean; note: string | null };
export type LicenseCheck = { part: 'fishing' | 'hunting'; kind: 'fishing' | 'hunting'; found: string | null; expires_on: string | null; ok: boolean; words: string };
export type AmmoCheck = { caliber: string; bringing: number; have: number | null; short: number | null; words: string };
export type TackleLow = { id: number; name: string; amount: string };
export type Worked = { water: string; season: string; lures: { lure: string; count: number; fish: string[] }[] };
export type CatchYear = { year: number; count: number; kept: number; released: number; biggest_inches: number | null };
export type KitchenCheck = { cooler: string | null; stove: string | null; equipment: EquipmentShortage[] };
export type YearView = {
  trip: { id: number; name: string; parts: Part[]; private: boolean; years: YearOf[] };
  plan_id: number; year: number; day: string; end_day: string; when: 'ahead' | 'now' | 'past';
  water: string | null;
  booking: { campground: string | null; site: string | null; confirmation: string | null; check_in: string | null; check_out: string | null };
  budget_cents: number | null; notes_next: string | null; notes_done: boolean; last_notes: string | null; previous: YearOf | null;
  plan: Plan;
  /** The recipes on the camp menu, with the day and meal each is on. */
  menu: PlanItem[];
  gear: Gear[]; seasons: Season[]; catches: Catch[]; harvest: Harvest[];
  checks: { kitchen: KitchenCheck | null; tackle_low: TackleLow[]; licenses: LicenseCheck[]; ammo: AmmoCheck[] };
  worked: Worked[]; catch_years: CatchYear[];
  budget: { tag: string | null; spent_cents: number; count: number; target_cents: number | null };
};
export type SharedTrip = { trip_id: number; name: string; who: string; first_day: string; last_day: string; parts: Part[]; catches: { fish: string; day: string; length_inches: number | null; kept: boolean }[] };

type TripRow = { id: number; name: string; camping: number; fishing: number; hunting: number; private: number; tag_id: number | null };
type YearRow = {
  plan_id: number; trip_id: number; year: number; water: string | null; campground: string | null; site: string | null; confirmation: string | null;
  check_in: string | null; check_out: string | null; event_id: number | null; budget_cents: number | null; notes_next: string | null; notes_done: number;
};
type GearRow = {
  id: number; part: Part; thing_id: number | null; label: string; quantity: number | null; caliber: string | null; packed: number; returned: number;
  after_trip: AfterTrip | null; after_done: number; job_id: number | null; note: string | null;
};
const TRIP_COLUMNS = 'id, name, camping, fishing, hunting, private, tag_id';
const YEAR_COLUMNS = 'plan_id, trip_id, year, water, campground, site, confirmation, check_in, check_out, event_id, budget_cents, notes_next, notes_done';
const GEAR_COLUMNS = 'id, part, thing_id, label, quantity, caliber, packed, returned, after_trip, after_done, job_id, note';

const partsOf = (t: TripRow): Part[] => PARTS.filter((p) => t[p] === 1);
const seasonOf = (day: string) => { const m = Number(day.slice(5, 7)); return m >= 3 && m <= 5 ? 'spring' : m >= 6 && m <= 8 ? 'summer' : m >= 9 && m <= 11 ? 'fall' : 'winter'; };
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
/** The same date a year on (or `n` years): the 29th of February is kept on the 28th in years without one. */
const yearsOn = (day: string, n: number) => dateInYear({ kind: 'fixed', month: Number(day.slice(5, 7)), day: Number(day.slice(8, 10)) }, Number(day.slice(0, 4)) + n)!;

export function outdoorTrips(db: Db, owner: number, clock: Clock = () => new Date()) {
  const now = () => stamp(clock());
  const today = () => todayOf(clock);
  const plans = () => plansOf(db, owner, clock);
  const things = () => inventory(db, owner, clock);
  const whenOf = (day: string, end: string): 'ahead' | 'now' | 'past' => (end < today() ? 'past' : day > today() ? 'ahead' : 'now');

  async function tripRow(q: Queries, id: number): Promise<TripRow> {
    const found = await q.get<TripRow>(`SELECT ${TRIP_COLUMNS} FROM outdoor_trips WHERE id = ? AND owner_id = ?`, [id, owner]);
    if (!found) throw new Problem(404, "That trip isn't here anymore. It may have been deleted.");
    return found;
  }
  async function yearRow(q: Queries, planId: number): Promise<YearRow> {
    const found = await q.get<YearRow>(
      `SELECT ${YEAR_COLUMNS.split(', ').map((c) => `y.${c}`).join(', ')} FROM outdoor_trip_years y JOIN plans p ON p.id = y.plan_id WHERE y.plan_id = ? AND p.owner_id = ?`, [planId, owner]);
    if (!found) throw new Problem(404, "That trip isn't here anymore. It may have been deleted.");
    return found;
  }
  async function yearsOf(q: Queries, tripId: number): Promise<YearOf[]> {
    return q.all<YearOf>('SELECT y.plan_id, y.year, p.start_day AS day FROM outdoor_trip_years y JOIN plans p ON p.id = y.plan_id WHERE y.trip_id = ? AND p.owner_id = ? ORDER BY y.year DESC', [tripId, owner]);
  }
  const planOf = async (table: string, id: number): Promise<number> => {
    const found = await db.get<{ plan_id: number }>(`SELECT t.plan_id FROM ${table} t JOIN plans p ON p.id = t.plan_id WHERE t.id = ? AND p.owner_id = ?`, [id, owner]);
    if (!found) throw new Problem(404, "That trip isn't here anymore. It may have been deleted.");
    return found.plan_id;
  };
  const roomFor = async (table: string, planId: number): Promise<void> => {
    if (((await db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table} WHERE plan_id = ?`, [planId]))!.n) >= MAX_ROWS) throw new Problem(400, `That list holds ${MAX_ROWS} at most`);
  };
  const nextOrder = async (planId: number): Promise<number> => ((await db.get<{ last: number | null }>('SELECT MAX(sort_order) AS last FROM outdoor_gear WHERE plan_id = ?', [planId]))!.last ?? 0) + 1;
  const partsChecked = (parts: string[] | undefined, fallback: TripRow | null): { camping: number; fishing: number; hunting: number } => {
    if (parts === undefined && fallback) return { camping: fallback.camping, fishing: fallback.fishing, hunting: fallback.hunting };
    const asked = parts ?? [];
    for (const p of asked) if (!(PARTS as readonly string[]).includes(p)) throw new Problem(400, 'Pick one: camping, fishing or hunting.');
    return { camping: asked.includes('camping') ? 1 : 0, fishing: asked.includes('fishing') ? 1 : 0, hunting: asked.includes('hunting') ? 1 : 0 };
  };
  const partChecked = (trip: TripRow, part: string | null | undefined): Part => {
    if (!part || !(PARTS as readonly string[]).includes(part)) throw new Problem(400, 'Pick one: camping, fishing or hunting.');
    if (trip[part as Part] !== 1) throw new Problem(400, `Turn on ${part} for this trip first`);
    return part as Part;
  };
  const lengthOk = (n: number | null | undefined, what: string) => {
    if (n != null && !(Number.isFinite(n) && n >= 0 && n < 100_000)) throw new Problem(400, `${what} is a number, 0 or more`);
  };

  /** The tag spending is tagged with to count toward the trip: found by name at the top, or made. */
  async function tagFor(q: Queries, name: string): Promise<number> {
    const key = labelKey(name);
    const have = await q.get<{ id: number }>('SELECT id FROM tags WHERE owner_id = ? AND parent_id IS NULL AND key = ? ORDER BY id LIMIT 1', [owner, key])
      ?? await q.get<{ id: number }>('SELECT id FROM tags WHERE owner_id = ? AND key = ? ORDER BY id LIMIT 1', [owner, key]);
    if (have) return have.id;
    return (await q.run('INSERT INTO tags (owner_id, name, key, parent_id, created_at) VALUES (?, ?, ?, NULL, ?)', [owner, clean(name, 60)!.replace(/>/g, ' '), key, now()])).lastId;
  }

  // ---------- making a year ----------

  /** Copies what a year keeps from the last one: the bring list unpacked, the seasons a year on, the place in words. */
  async function copyOwn(tx: Queries, from: YearRow, to: number, toDay: string): Promise<void> {
    for (const [i, g] of (await tx.all<GearRow>(`SELECT ${GEAR_COLUMNS} FROM outdoor_gear WHERE plan_id = ? ORDER BY sort_order, id`, [from.plan_id])).entries()) {
      await tx.run('INSERT INTO outdoor_gear (plan_id, part, thing_id, label, quantity, caliber, note, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [to, g.part, g.thing_id, g.label, g.quantity, g.caliber, g.note, i + 1]);
    }
    const years = Number(toDay.slice(0, 4)) - from.year;
    for (const s of await tx.all<{ part: string; label: string; opens_on: string; closes_on: string | null; remind_days: number; note: string | null }>(
      'SELECT part, label, opens_on, closes_on, remind_days, note FROM outdoor_seasons WHERE plan_id = ? ORDER BY id', [from.plan_id])) {
      await tx.run('INSERT INTO outdoor_seasons (plan_id, part, label, opens_on, closes_on, remind_days, note) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [to, s.part, s.label, yearsOn(s.opens_on, years), s.closes_on ? yearsOn(s.closes_on, years) : null, s.remind_days, s.note]);
    }
    await tx.run('INSERT INTO outdoor_trip_years (plan_id, trip_id, year, water, campground, site, budget_cents) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [to, from.trip_id, Number(toDay.slice(0, 4)), from.water, from.campground, from.site, from.budget_cents]);
  }

  async function makeYear(t: TripRow, day: string, endDay?: string | null): Promise<number> {
    const year = Number(day.slice(0, 4));
    const have = await db.get<{ plan_id: number }>('SELECT y.plan_id FROM outdoor_trip_years y JOIN plans p ON p.id = y.plan_id WHERE y.trip_id = ? AND y.year = ? AND p.owner_id = ?', [t.id, year, owner]);
    if (have) return have.plan_id;
    const name = `${t.name} ${year}`;
    const last = await db.get<YearRow>(`SELECT ${YEAR_COLUMNS} FROM outdoor_trip_years WHERE trip_id = ? AND year < ? ORDER BY year DESC LIMIT 1`, [t.id, year]);
    let planId: number;
    if (last) {
      planId = (await plans().copy(last.plan_id, { name, start_day: day })).id;
      if (endDay) { const p = await plans().get(planId); await plans().update(planId, { name: p.name, start_day: day, end_day: endDay, note: p.note, story: p.story }); }
    } else planId = (await plans().create({ name, start_day: day, end_day: endDay ?? undefined })).id;
    await atomic(db, async (tx) => {
      if (last) await copyOwn(tx, last, planId, day);
      else await tx.run('INSERT INTO outdoor_trip_years (plan_id, trip_id, year) VALUES (?, ?, ?)', [planId, t.id, year]);
    });
    return planId;
  }

  // ---------- reading a year ----------

  async function gearOf(planId: number): Promise<Gear[]> {
    const rows = await db.all<GearRow>(`SELECT ${GEAR_COLUMNS} FROM outdoor_gear WHERE plan_id = ? ORDER BY sort_order, id`, [planId]);
    if (rows.length === 0) return [];
    const mine = new Map((await things().listItems({ guarded: true })).map((t) => [t.id, t]));
    return rows.map(({ packed, returned, after_done, ...g }) => {
      const t = g.thing_id !== null ? mine.get(g.thing_id) : undefined;
      return { ...g, label: t?.name ?? g.label, packed: packed === 1, returned: returned === 1, after_done: after_done === 1, have: t ? t.amount : null, low: t?.low ?? false, place: t?.place ?? null };
    });
  }
  async function seasonsOf(planId: number): Promise<Season[]> {
    return (await db.all<Omit<Season, 'days_to_open'>>('SELECT id, part, label, opens_on, closes_on, remind_days, note FROM outdoor_seasons WHERE plan_id = ? ORDER BY opens_on, id', [planId]))
      .map((s) => ({ ...s, days_to_open: dayNumber(s.opens_on) - dayNumber(today()) }));
  }
  async function catchesOf(planId: number): Promise<Catch[]> {
    return (await db.all<Omit<Catch, 'kept' | 'frozen'> & { kept: number; frozen: number }>(
      'SELECT id, fish, day, water, length_inches, weight_lb, kept, lure_thing_id, lure, frozen, note FROM outdoor_catch WHERE plan_id = ? ORDER BY day, id', [planId]))
      .map((c) => ({ ...c, kept: c.kept === 1, frozen: c.frozen === 1 }));
  }
  async function harvestOf(planId: number): Promise<Harvest[]> {
    return (await db.all<Omit<Harvest, 'frozen'> & { frozen: number }>('SELECT id, animal, day, place, tag_number, weight_lb, frozen, note FROM outdoor_harvest WHERE plan_id = ? ORDER BY day, id', [planId]))
      .map((h) => ({ ...h, frozen: h.frozen === 1 }));
  }

  /** The cooler and the stove, found among what the person owns, and what the menu's recipes need more of than there is. */
  async function kitchenCheck(day: string, end: string): Promise<KitchenCheck> {
    const all = await things().listItems();
    const find = (word: string) => {
      const hit = all.find((t) => t.name.toLowerCase().includes(word)) ?? all.find((t) => Object.values(t.values).join(' ').toLowerCase().includes(word) && t.kind === 'Camping gear');
      return hit ? hit.name : null;
    };
    return { cooler: find('cooler'), stove: find('stove'), equipment: await kitchen(db, owner, clock).equipmentCheck(day, dayNumber(end) - dayNumber(day) + 1) };
  }

  /** Tackle with a "running low" amount that has been reached: line, hooks, weights, lures. */
  async function tackleLow(): Promise<TackleLow[]> {
    return (await things().listItems({ low: true })).filter((t) => t.kind === 'Fishing tackle').map((t) => ({ id: t.id, name: t.name, amount: t.amount }));
  }

  async function licenseChecks(trip: TripRow, day: string, end: string): Promise<LicenseCheck[]> {
    const out: LicenseCheck[] = [];
    const list = await licenses(db, owner, clock).list();
    const want: ['fishing' | 'hunting', RegExp][] = [['fishing', /fish|angl/i], ['hunting', /hunt|tag|deer|elk|turkey|waterfowl|duck|bear|moose/i]];
    for (const [part, pattern] of want) {
      if (trip[part] !== 1) continue;
      const mine = list.filter((l) => pattern.test(l.name));
      if (mine.length === 0) { out.push({ part, kind: part, found: null, expires_on: null, ok: false, words: `No ${part} license is kept in Licenses yet.` }); continue; }
      // The one that lasts longest is the one to go by.
      const best = [...mine].sort((a, b) => (b.expires_on ?? '9999') < (a.expires_on ?? '9999') ? -1 : 1)[0]!;
      const ok = best.expires_on === null || best.expires_on >= end;
      out.push({ part, kind: part, found: best.name, expires_on: best.expires_on, ok,
        words: ok ? `${best.name}${best.expires_on ? ` is good through ${best.expires_on}` : ' has no end day'}.` : `${best.name} ends ${best.expires_on}, before the trip is over (${end}). Renew it first.` });
      void day;
    }
    return out;
  }

  async function ammoChecks(gear: Gear[]): Promise<AmmoCheck[]> {
    const out: AmmoCheck[] = [];
    for (const g of gear.filter((x) => x.part === 'hunting' && x.caliber)) {
      const have = await ammoOnHand(things(), g.caliber!);
      const bringing = g.quantity ?? 0;
      const short = have === null ? null : Math.max(0, bringing - have);
      out.push({ caliber: g.caliber!, bringing, have, short,
        words: have === null ? `No ${g.caliber} ammunition is kept in Things yet. Add it under Ammunition.` : short! > 0 ? `You bring ${bringing} and have ${have}: ${short} short.` : `You bring ${bringing} and have ${have}.` });
    }
    return out;
  }

  /** What worked: for each water and season, the lures that caught fish, from the person's whole log. */
  async function workedOf(water: string | null): Promise<Worked[]> {
    const rows = await db.all<{ water: string; day: string; fish: string; lure: string | null; lure_name: string | null }>(
      `SELECT c.water, c.day, c.fish, c.lure, i.name AS lure_name FROM outdoor_catch c JOIN plans p ON p.id = c.plan_id LEFT JOIN items i ON i.id = c.lure_thing_id
       WHERE p.owner_id = ? AND c.water IS NOT NULL AND (c.lure IS NOT NULL OR i.name IS NOT NULL) ORDER BY c.day`, [owner]);
    const groups = new Map<string, { water: string; season: string; lures: Map<string, { lure: string; count: number; fish: Set<string> }> }>();
    for (const r of rows) {
      if (water && labelKey(r.water) !== labelKey(water)) continue;
      const season = seasonOf(r.day);
      const key = `${labelKey(r.water)}|${season}`;
      const g = groups.get(key) ?? { water: r.water, season, lures: new Map() };
      const name = r.lure_name ?? r.lure!;
      const l = g.lures.get(labelKey(name)) ?? { lure: name, count: 0, fish: new Set<string>() };
      l.count += 1;
      l.fish.add(r.fish);
      g.lures.set(labelKey(name), l);
      groups.set(key, g);
    }
    return [...groups.values()].map((g) => ({ water: g.water, season: g.season,
      lures: [...g.lures.values()].sort((a, b) => b.count - a.count || a.lure.localeCompare(b.lure)).map((l) => ({ lure: l.lure, count: l.count, fish: [...l.fish] })) }))
      .sort((a, b) => a.water.localeCompare(b.water) || a.season.localeCompare(b.season));
  }

  async function catchYears(tripId: number): Promise<CatchYear[]> {
    return (await db.all<{ year: number; count: number; kept: number; biggest: number | null }>(
      `SELECT y.year, COUNT(c.id) AS count, COALESCE(SUM(c.kept), 0) AS kept, MAX(c.length_inches) AS biggest FROM outdoor_trip_years y JOIN plans p ON p.id = y.plan_id
       JOIN outdoor_catch c ON c.plan_id = y.plan_id WHERE y.trip_id = ? AND p.owner_id = ? GROUP BY y.year ORDER BY y.year DESC`, [tripId, owner]))
      .map((r) => ({ year: r.year, count: r.count, kept: r.kept, released: r.count - r.kept, biggest_inches: r.biggest }));
  }

  /** Spending tagged to the trip around this year's days. */
  async function budgetOf(t: TripRow, day: string, end: string, target: number | null): Promise<YearView['budget']> {
    if (t.tag_id === null) return { tag: null, spent_cents: 0, count: 0, target_cents: target };
    const found = (await spendingByTag(db, owner, addDays(day, -SPEND_BEFORE), addDays(end, SPEND_AFTER))).find((x) => x.id === t.tag_id);
    return { tag: found?.path ?? (await db.get<{ name: string }>('SELECT name FROM tags WHERE id = ?', [t.tag_id]))?.name ?? null, spent_cents: found?.cents ?? 0, count: found?.count ?? 0, target_cents: target };
  }

  async function next(t: TripRow, years: YearOf[]): Promise<TripSummary['next']> {
    const ahead = [...years].sort((a, b) => (a.day < b.day ? -1 : 1)).find((y) => y.day >= today());
    if (!ahead) return null;
    const left = (await db.get<{ n: number }>('SELECT COUNT(*) AS n FROM outdoor_gear WHERE plan_id = ? AND packed = 0', [ahead.plan_id]))!.n;
    const days = dayNumber(ahead.day) - dayNumber(today());
    const when = days === 0 ? 'starts today' : days === 1 ? 'starts tomorrow' : `in ${plural(days, 'day')}`;
    return `${when}${left > 0 ? `, ${left} left to pack` : ''}`;
  }

  async function summaryOf(t: TripRow): Promise<TripSummary> {
    const years = await yearsOf(db, t.id);
    const top = years[0];
    const latest = top ? { ...top, end_day: (await db.get<{ end_day: string }>('SELECT end_day FROM plans WHERE id = ?', [top.plan_id]))!.end_day, when: 'ahead' as 'ahead' | 'now' | 'past' } : null;
    if (latest) latest.when = whenOf(latest.day, latest.end_day);
    return { id: t.id, name: t.name, parts: partsOf(t), private: t.private === 1, years, latest, next: await next(t, years) };
  }

  async function yearView(planId: number): Promise<YearView> {
    const y = await yearRow(db, planId);
    const t = await tripRow(db, y.trip_id);
    const plan = await plans().get(planId);
    const years = await yearsOf(db, t.id);
    const previous = years.find((v) => v.year < y.year) ?? null;
    const last = previous ? await yearRow(db, previous.plan_id) : null;
    const gear = await gearOf(planId);
    const parts = partsOf(t);
    return {
      trip: { id: t.id, name: t.name, parts, private: t.private === 1, years },
      plan_id: planId, year: y.year, day: plan.start_day, end_day: plan.end_day, when: plan.when,
      water: y.water, booking: { campground: y.campground, site: y.site, confirmation: y.confirmation, check_in: y.check_in, check_out: y.check_out },
      budget_cents: y.budget_cents, notes_next: y.notes_next, notes_done: y.notes_done === 1, last_notes: last?.notes_next ?? null, previous,
      plan, menu: plan.items_list.filter((i) => i.kind === 'recipe'),
      gear: gear.filter((g) => t[g.part] === 1), seasons: (await seasonsOf(planId)).filter((s) => t[s.part] === 1),
      catches: t.fishing === 1 ? await catchesOf(planId) : [], harvest: t.hunting === 1 ? await harvestOf(planId) : [],
      checks: {
        kitchen: t.camping === 1 ? await kitchenCheck(plan.start_day, plan.end_day) : null,
        tackle_low: t.fishing === 1 ? await tackleLow() : [],
        licenses: await licenseChecks(t, plan.start_day, plan.end_day),
        ammo: t.hunting === 1 ? await ammoChecks(gear) : [],
      },
      worked: t.fishing === 1 ? await workedOf(y.water) : [], catch_years: t.fishing === 1 ? await catchYears(t.id) : [],
      budget: await budgetOf(t, plan.start_day, plan.end_day, y.budget_cents),
    };
  }

  /** The booking on the calendar: made, changed or taken away to match what was typed. A private trip shows only its name. */
  async function syncBooking(tx: Queries, planId: number): Promise<void> {
    const y = await yearRow(tx, planId);
    const t = await tripRow(tx, y.trip_id);
    const title = t.private === 1 ? t.name : `${t.name}: ${y.campground ?? 'check in'}`;
    const note = t.private === 1 ? null : [y.site ? `Site ${y.site}` : null, y.confirmation ? `Confirmation ${y.confirmation}` : null].filter(Boolean).join('. ') || null;
    if (!y.check_in) {
      if (y.event_id !== null) { await tx.run('DELETE FROM events WHERE id = ? AND owner_id = ?', [y.event_id, owner]); await tx.run('UPDATE outdoor_trip_years SET event_id = NULL WHERE plan_id = ?', [planId]); }
      return;
    }
    const end = y.check_out && y.check_out >= y.check_in ? y.check_out : null;
    const exists = y.event_id !== null && await tx.get('SELECT 1 AS x FROM events WHERE id = ? AND owner_id = ?', [y.event_id, owner]);
    if (exists) {
      await tx.run('UPDATE events SET title = ?, day = ?, end_day = ?, note = ?, updated_at = ? WHERE id = ? AND owner_id = ?', [title, y.check_in, end, note, now(), y.event_id, owner]);
      return;
    }
    const made = await tx.run('INSERT INTO events (owner_id, title, day, end_day, time, note, yearly, created_at, updated_at) VALUES (?, ?, ?, ?, NULL, ?, 0, ?, ?)', [owner, title, y.check_in, end, note, now(), now()]);
    await tx.run('UPDATE outdoor_trip_years SET event_id = ? WHERE plan_id = ?', [made.lastId, planId]);
  }

  /** Puts kept fish or meat in the freezer: the pantry's freezer shelf, one more of it. */
  async function toFreezer(name: string): Promise<void> {
    const k = kitchen(db, owner, clock);
    const have = (await k.listPantry()).items.find((i) => labelKey(i.name) === labelKey(name));
    await k.savePantry({ name, quantity: (have?.quantity ?? 0) + 1, unit: have?.unit ?? null, location: 'freezer', expires_on: have?.expires_on ?? null, low_at: have?.low_at ?? null });
  }

  return {
    /** The things a trip can use: every one of the person's things, for the pickers. */
    async options(): Promise<{ things: { id: number; name: string; kind: string; amount: string; low: boolean }[] }> {
      return { things: (await things().listItems({ guarded: true })).map((t: Item) => ({ id: t.id, name: t.name, kind: t.kind, amount: t.amount, low: t.low })) };
    },

    async list(): Promise<TripSummary[]> {
      const out: TripSummary[] = [];
      for (const t of await db.all<TripRow>(`SELECT ${TRIP_COLUMNS} FROM outdoor_trips WHERE owner_id = ? ORDER BY name COLLATE NOCASE, id`, [owner])) out.push(await summaryOf(t));
      return out;
    },
    async get(id: number): Promise<TripSummary> { return summaryOf(await tripRow(db, id)); },

    /** Add a trip, with its first year. */
    async create(input: TripInput): Promise<TripSummary> {
      const name = clean(input.name, 100);
      if (!name) throw new Problem(400, 'Give the trip a name');
      const parts = partsChecked(input.parts ?? [], null);
      const day = dayOrNull(input.day);
      if (!day) throw new Problem(400, 'Say what day it starts');
      const end = dayOrNull(input.end_day) ?? day;
      if (end < day) throw new Problem(400, "It can't end before it starts");
      const id = await atomic(db, async (tx) => (await tx.run(
        'INSERT INTO outdoor_trips (owner_id, name, camping, fishing, hunting, private, tag_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [owner, name, parts.camping, parts.fishing, parts.hunting, input.private ? 1 : 0, await tagFor(tx, name), now(), now()])).lastId);
      await makeYear(await tripRow(db, id), day, end);
      return this.get(id);
    },

    /** Change a trip: its name, the parts turned on, whether it is private. */
    async update(id: number, input: { name?: string | null; parts?: string[]; private?: boolean }): Promise<TripSummary> {
      const t = await tripRow(db, id);
      const name = input.name === undefined ? t.name : clean(input.name, 100);
      if (!name) throw new Problem(400, 'Give the trip a name');
      const parts = partsChecked(input.parts, t);
      await db.run('UPDATE outdoor_trips SET name = ?, camping = ?, fishing = ?, hunting = ?, private = ?, updated_at = ? WHERE id = ? AND owner_id = ?',
        [name, parts.camping, parts.fishing, parts.hunting, (input.private ?? t.private === 1) ? 1 : 0, now(), id, owner]);
      for (const y of await yearsOf(db, id)) await atomic(db, (tx) => syncBooking(tx, y.plan_id));
      return this.get(id);
    },

    /** Stop keeping a trip. Its years stay as plans, to look back on. */
    async remove(id: number): Promise<void> {
      await tripRow(db, id);
      await db.run('DELETE FROM outdoor_trips WHERE id = ? AND owner_id = ?', [id, owner]);
    },

    /** Start a year from the last one: the same days a year on, unless a day is given. Asked twice, it gives back the one made. */
    async startYear(tripId: number, input: { day?: string | null; end_day?: string | null } = {}): Promise<YearView> {
      const t = await tripRow(db, tripId);
      let day = dayOrNull(input.day);
      let end = dayOrNull(input.end_day);
      if (day === null) {
        const coming = (await yearsOf(db, t.id)).filter((y) => y.day >= today()).pop();
        if (coming) return yearView(coming.plan_id);
        const last = (await yearsOf(db, t.id))[0];
        if (!last) throw new Problem(400, 'Say what day it starts');
        const p = await db.get<{ start_day: string; end_day: string }>('SELECT start_day, end_day FROM plans WHERE id = ?', [last.plan_id]);
        let n = 1;
        while (yearsOn(p!.start_day, n) < today() && n < 5) n += 1;
        day = yearsOn(p!.start_day, n);
        end = end ?? addDays(day, dayNumber(p!.end_day) - dayNumber(p!.start_day));
      }
      return yearView(await makeYear(t, day, end));
    },

    year: yearView,

    /** Change what a year keeps: its days, the water, the site booking, its budget, notes for next year. */
    async setYear(planId: number, c: YearChange): Promise<YearView> {
      const y = await yearRow(db, planId);
      const full = await plans().get(planId);
      if (c.day != null || c.end_day != null) {
        const start = c.day ?? full.start_day;
        const end = c.end_day ?? (c.day != null ? addDays(c.day, dayNumber(full.end_day) - dayNumber(full.start_day)) : full.end_day);
        if (start !== full.start_day || end !== full.end_day) await plans().update(planId, { name: full.name, start_day: start, end_day: end, note: full.note, story: full.story });
      }
      const budget = c.budget_cents === undefined ? y.budget_cents : c.budget_cents;
      if (budget !== null && !(Number.isInteger(budget) && budget >= 0)) throw new Problem(400, 'A budget is an amount of money');
      const checkIn = c.check_in === undefined ? y.check_in : dayOrNull(c.check_in);
      const checkOut = c.check_out === undefined ? y.check_out : dayOrNull(c.check_out);
      if (checkIn && checkOut && checkOut < checkIn) throw new Problem(400, "Check-out can't be before check-in");
      const text = (v: string | null | undefined, old: string | null, limit: number) => (v === undefined ? old : clean(v, limit));
      await atomic(db, async (tx) => {
        await tx.run('UPDATE outdoor_trip_years SET water = ?, campground = ?, site = ?, confirmation = ?, check_in = ?, check_out = ?, budget_cents = ?, notes_next = ? WHERE plan_id = ?',
          [text(c.water, y.water, 200), text(c.campground, y.campground, 200), text(c.site, y.site, 100), text(c.confirmation, y.confirmation, 100), checkIn, checkOut, budget, text(c.notes_next, y.notes_next, 5000), planId]);
        await syncBooking(tx, planId);
      });
      return yearView(planId);
    },

    /** Keep the note for next year and finish this one. */
    async finish(planId: number, notes: string | null): Promise<YearView> {
      const y = await yearRow(db, planId);
      await db.run('UPDATE outdoor_trip_years SET notes_next = ?, notes_done = 1 WHERE plan_id = ?', [clean(notes, 5000) ?? y.notes_next, planId]);
      return yearView(planId);
    },

    // ---------- the bring list ----------

    async addGear(planId: number, input: GearInput): Promise<YearView> {
      const y = await yearRow(db, planId);
      const t = await tripRow(db, y.trip_id);
      const part = partChecked(t, input.part);
      await roomFor('outdoor_gear', planId);
      let label = clean(input.label, 200);
      if (input.thing_id != null) {
        const found = await db.get<{ name: string }>('SELECT name FROM items WHERE id = ? AND owner_id = ?', [input.thing_id, owner]);
        if (!found) throw new Problem(404, "That isn't among your things");
        label = label ?? found.name;
        if (await db.get('SELECT 1 AS x FROM outdoor_gear WHERE plan_id = ? AND part = ? AND thing_id = ?', [planId, part, input.thing_id])) throw new Problem(409, "That's already on the list");
      }
      if (!label) throw new Problem(400, 'Say what to bring');
      if (input.quantity != null && !(Number.isFinite(input.quantity) && input.quantity > 0 && input.quantity < 1e7)) throw new Problem(400, 'How many is a number above nothing');
      const caliber = part === 'hunting' ? clean(input.caliber, 40) : null;
      await db.run('INSERT INTO outdoor_gear (plan_id, part, thing_id, label, quantity, caliber, note, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [planId, part, input.thing_id ?? null, label, input.quantity ?? null, caliber, clean(input.note, 500), await nextOrder(planId)]);
      return yearView(planId);
    },
    /** Fills a part's bring list from what the person owns of its kinds, skipping what is on it. */
    async fillGear(planId: number, partName: string): Promise<YearView & { added: number }> {
      const y = await yearRow(db, planId);
      const part = partChecked(await tripRow(db, y.trip_id), partName);
      const source = GEAR_SOURCES.find((s) => s.part === part)!;
      const have = new Set((await db.all<{ thing_id: number | null }>('SELECT thing_id FROM outdoor_gear WHERE plan_id = ? AND part = ?', [planId, part])).map((r) => r.thing_id));
      let added = 0;
      const calibers = new Set((await db.all<{ caliber: string | null }>('SELECT caliber FROM outdoor_gear WHERE plan_id = ? AND part = ? AND caliber IS NOT NULL', [planId, part])).map((r) => labelKey(r.caliber ?? '')));
      const guns = part === 'hunting' ? new Map((await things().guns()).filter((g) => !g.gone).map((g) => [g.id, g.caliber])) : new Map<number, string | null>();
      for (const t of await things().listItems({ guarded: true })) {
        const fits = source.kinds.some((k) => labelKey(k) === labelKey(t.kind)) || t.activities.some((a) => source.activities.some((s) => labelKey(s) === labelKey(a)));
        if (!fits || have.has(t.id)) continue;
        await roomFor('outdoor_gear', planId);
        await db.run('INSERT INTO outdoor_gear (plan_id, part, thing_id, label, quantity, note, sort_order) VALUES (?, ?, ?, ?, NULL, NULL, ?)', [planId, part, t.id, t.name, await nextOrder(planId)]);
        added += 1;
        // A gun's caliber or gauge puts ammunition for it on the list, to say how many to bring (the ammunition check counts what is kept).
        const caliber = clean(guns.get(t.id), 40);
        if (caliber && !calibers.has(labelKey(caliber))) {
          calibers.add(labelKey(caliber));
          await roomFor('outdoor_gear', planId);
          await db.run('INSERT INTO outdoor_gear (plan_id, part, thing_id, label, quantity, caliber, note, sort_order) VALUES (?, ?, NULL, ?, NULL, ?, NULL, ?)', [planId, part, `${caliber} ammunition`, caliber, await nextOrder(planId)]);
          added += 1;
        }
      }
      return { ...(await yearView(planId)), added };
    },
    async updateGear(id: number, c: GearChange): Promise<YearView> {
      const planId = await planOf('outdoor_gear', id);
      const o = (await db.get<GearRow>(`SELECT ${GEAR_COLUMNS} FROM outdoor_gear WHERE id = ?`, [id]))!;
      if (c.after_trip != null && !(AFTER_TRIP as readonly string[]).includes(c.after_trip)) throw new Problem(400, 'Pick one: dry, clean, repair or replace.');
      const after = c.after_trip === undefined ? o.after_trip : (c.after_trip as AfterTrip | null);
      if (c.quantity != null && !(Number.isFinite(c.quantity) && c.quantity > 0 && c.quantity < 1e7)) throw new Problem(400, 'How many is a number above nothing');
      const returned = c.returned ?? o.returned === 1;
      await atomic(db, async (tx) => {
        await tx.run('UPDATE outdoor_gear SET packed = ?, returned = ?, after_trip = ?, after_done = ?, quantity = ?, note = ? WHERE id = ?',
          [(c.packed ?? o.packed === 1) ? 1 : 0, returned ? 1 : 0, after, (after !== o.after_trip ? false : (c.after_done ?? o.after_done === 1)) ? 1 : 0,
            c.quantity === undefined ? o.quantity : c.quantity, c.note === undefined ? o.note : clean(c.note, 500), id]);
      });
      // A repair goes to Upkeep once; a replacement goes on the shopping list once.
      if (after === 'repair' && o.job_id === null) {
        const y = await yearRow(db, planId);
        const t = await tripRow(db, y.trip_id);
        const job = await upkeep(db, owner, clock).create({ name: `Repair: ${o.label}`, activity: o.part === 'camping' ? 'Camping' : o.part === 'fishing' ? 'Fishing' : 'Hunting',
          item_id: o.thing_id, first_due: today(), note: `Found after ${t.name} ${y.year}.` });
        await db.run('UPDATE outdoor_gear SET job_id = ? WHERE id = ?', [job.id, id]);
      }
      if (after === 'replace' && o.after_trip !== 'replace') await kitchen(db, owner, clock).addGroceries([`${o.label} (replace)`]);
      return yearView(planId);
    },
    async removeGear(id: number): Promise<YearView> {
      const planId = await planOf('outdoor_gear', id);
      await db.run('DELETE FROM outdoor_gear WHERE id = ?', [id]);
      return yearView(planId);
    },
    /** Low tackle goes on the shopping list, once each. */
    async tackleToList(planId: number): Promise<YearView & { added: number }> {
      const y = await yearRow(db, planId);
      await tripRow(db, y.trip_id);
      const r = await kitchen(db, owner, clock).addGroceries((await tackleLow()).map((t) => t.name));
      return { ...(await yearView(planId)), added: r.added };
    },

    // ---------- the camp menu ----------

    /** A recipe on the menu, eaten on one of the trip's days (or the week before, for what is made ahead): it goes on the week's meals. */
    async addMeal(planId: number, input: { recipe_id: number; day?: string | null; meal?: string | null; servings?: number | null }): Promise<YearView> {
      await yearRow(db, planId);
      const plan = await plans().get(planId);
      await plans().addItem(planId, { kind: 'recipe', ref_id: input.recipe_id, day: dayOrNull(input.day) ?? plan.start_day, meal: input.meal ?? 'dinner', servings: input.servings ?? null });
      return yearView(planId);
    },
    async removeMeal(itemId: number): Promise<YearView> {
      const found = await db.get<{ plan_id: number }>('SELECT i.plan_id FROM plan_items i JOIN plans p ON p.id = i.plan_id JOIN outdoor_trip_years y ON y.plan_id = p.id WHERE i.id = ? AND p.owner_id = ?', [itemId, owner]);
      if (!found) throw new Problem(404, "That meal isn't here anymore. It may have been deleted.");
      await plans().removeItem(itemId);
      return yearView(found.plan_id);
    },
    /** The menu's food, less what the pantry has, onto the grocery list. */
    async menuToGroceries(planId: number): Promise<YearView & { added: number; check: string[] }> {
      await yearRow(db, planId);
      const plan = await plans().get(planId);
      const r = await kitchen(db, owner, clock).groceryFromPlan(plan.start_day, dayNumber(plan.end_day) - dayNumber(plan.start_day) + 1);
      return { ...(await yearView(planId)), added: r.added, check: r.check };
    },

    // ---------- seasons ----------

    async addSeason(planId: number, input: SeasonInput): Promise<YearView> {
      const y = await yearRow(db, planId);
      const t = await tripRow(db, y.trip_id);
      const part = partChecked(t, input.part);
      if (part === 'camping') throw new Problem(400, 'Seasons are for fishing and hunting');
      const label = clean(input.label, 100);
      if (!label) throw new Problem(400, 'Name the season');
      const opens = dayOrNull(input.opens_on);
      if (!opens) throw new Problem(400, 'Say the day it opens');
      const closes = dayOrNull(input.closes_on);
      if (closes && closes < opens) throw new Problem(400, "It can't close before it opens");
      const remind = input.remind_days ?? 7;
      if (!Number.isInteger(remind) || remind < 0 || remind > 120) throw new Problem(400, 'Remind you 0 to 120 days ahead');
      await roomFor('outdoor_seasons', planId);
      await db.run('INSERT INTO outdoor_seasons (plan_id, part, label, opens_on, closes_on, remind_days, note) VALUES (?, ?, ?, ?, ?, ?, ?)', [planId, part, label, opens, closes, remind, clean(input.note, 500)]);
      return yearView(planId);
    },
    async removeSeason(id: number): Promise<YearView> {
      const planId = await planOf('outdoor_seasons', id);
      await db.run('DELETE FROM outdoor_seasons WHERE id = ?', [id]);
      return yearView(planId);
    },

    // ---------- the catch log ----------

    async addCatch(planId: number, input: CatchInput): Promise<YearView> {
      const y = await yearRow(db, planId);
      partChecked(await tripRow(db, y.trip_id), 'fishing');
      const fish = clean(input.fish, 100);
      if (!fish) throw new Problem(400, 'Say what the fish was');
      const full = await plans().get(planId);
      const day = dayOrNull(input.day) ?? (today() >= full.start_day && today() <= full.end_day ? today() : full.start_day);
      lengthOk(input.length_inches, 'The length');
      lengthOk(input.weight_lb, 'The weight');
      let lure = clean(input.lure, 100);
      if (input.lure_thing_id != null) {
        const found = await db.get<{ name: string }>('SELECT name FROM items WHERE id = ? AND owner_id = ?', [input.lure_thing_id, owner]);
        if (!found) throw new Problem(404, "That isn't among your tackle");
        lure = lure ?? found.name;
      }
      await roomFor('outdoor_catch', planId);
      await db.run('INSERT INTO outdoor_catch (plan_id, fish, day, water, length_inches, weight_lb, kept, lure_thing_id, lure, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [planId, fish, day, clean(input.water, 200) ?? y.water, input.length_inches ?? null, input.weight_lb ?? null, input.kept ? 1 : 0, input.lure_thing_id ?? null, lure, clean(input.note, 500)]);
      return yearView(planId);
    },
    async updateCatch(id: number, input: CatchInput): Promise<YearView> {
      const planId = await planOf('outdoor_catch', id);
      const o = (await db.get<{ fish: string; day: string; water: string | null; length_inches: number | null; weight_lb: number | null; kept: number; lure: string | null; note: string | null }>(
        'SELECT fish, day, water, length_inches, weight_lb, kept, lure, note FROM outdoor_catch WHERE id = ?', [id]))!;
      const fish = input.fish === undefined ? o.fish : clean(input.fish, 100);
      if (!fish) throw new Problem(400, 'Say what the fish was');
      lengthOk(input.length_inches, 'The length');
      lengthOk(input.weight_lb, 'The weight');
      await db.run('UPDATE outdoor_catch SET fish = ?, day = ?, water = ?, length_inches = ?, weight_lb = ?, kept = ?, lure = ?, note = ? WHERE id = ?',
        [fish, input.day === undefined ? o.day : (dayOrNull(input.day) ?? o.day), input.water === undefined ? o.water : clean(input.water, 200),
          input.length_inches === undefined ? o.length_inches : input.length_inches, input.weight_lb === undefined ? o.weight_lb : input.weight_lb,
          (input.kept ?? o.kept === 1) ? 1 : 0, input.lure === undefined ? o.lure : clean(input.lure, 100), input.note === undefined ? o.note : clean(input.note, 500), id]);
      return yearView(planId);
    },
    async removeCatch(id: number): Promise<YearView> {
      const planId = await planOf('outdoor_catch', id);
      await db.run('DELETE FROM outdoor_catch WHERE id = ?', [id]);
      return yearView(planId);
    },
    /** A kept fish into the freezer, once. */
    async freezeCatch(id: number): Promise<YearView> {
      const planId = await planOf('outdoor_catch', id);
      const c = (await db.get<{ fish: string; kept: number; frozen: number }>('SELECT fish, kept, frozen FROM outdoor_catch WHERE id = ?', [id]))!;
      if (c.kept !== 1) throw new Problem(400, 'Only a fish you kept can go in the freezer');
      if (c.frozen === 0) { await toFreezer(c.fish); await db.run('UPDATE outdoor_catch SET frozen = 1 WHERE id = ?', [id]); }
      return yearView(planId);
    },

    // ---------- the harvest log ----------

    async addHarvest(planId: number, input: HarvestInput): Promise<YearView> {
      const y = await yearRow(db, planId);
      partChecked(await tripRow(db, y.trip_id), 'hunting');
      const animal = clean(input.animal, 100);
      if (!animal) throw new Problem(400, 'Say what the animal was');
      const full = await plans().get(planId);
      lengthOk(input.weight_lb, 'The weight');
      await roomFor('outdoor_harvest', planId);
      await db.run('INSERT INTO outdoor_harvest (plan_id, animal, day, place, tag_number, weight_lb, note) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [planId, animal, dayOrNull(input.day) ?? full.start_day, clean(input.place, 200), clean(input.tag_number, 60), input.weight_lb ?? null, clean(input.note, 500)]);
      return yearView(planId);
    },
    async removeHarvest(id: number): Promise<YearView> {
      const planId = await planOf('outdoor_harvest', id);
      await db.run('DELETE FROM outdoor_harvest WHERE id = ?', [id]);
      return yearView(planId);
    },
    /** Meat into the freezer, once, under what the person called the animal. */
    async freezeHarvest(id: number): Promise<YearView> {
      const planId = await planOf('outdoor_harvest', id);
      const h = (await db.get<{ animal: string; frozen: number }>('SELECT animal, frozen FROM outdoor_harvest WHERE id = ?', [id]))!;
      if (h.frozen === 0) { await toFreezer(`${h.animal} meat`); await db.run('UPDATE outdoor_harvest SET frozen = 1 WHERE id = ?', [id]); }
      return yearView(planId);
    },

    // ---------- the house, the morning round ----------

    /**
     * What the other people in the house may see: trips marked shared, by name and days. A fishing trip adds its
     * catch. Hunting is never shown, and a trip with hunting on does not say so.
     */
    async shared(): Promise<SharedTrip[]> {
      const out: SharedTrip[] = [];
      for (const t of await db.all<TripRow & { owner_id: number; who: string }>(
        `SELECT t.id, t.name, t.camping, t.fishing, t.hunting, t.private, t.tag_id, t.owner_id,
           COALESCE(NULLIF(TRIM((SELECT s.value FROM user_settings s WHERE s.user_id = u.id AND s.key = 'display_name')), ''), u.username) AS who
         FROM outdoor_trips t JOIN users u ON u.id = t.owner_id WHERE t.owner_id != ? AND t.private = 0 ORDER BY t.name COLLATE NOCASE`, [owner])) {
        const y = await db.get<{ plan_id: number; start_day: string; end_day: string }>(
          `SELECT y.plan_id, p.start_day, p.end_day FROM outdoor_trip_years y JOIN plans p ON p.id = y.plan_id WHERE y.trip_id = ? ORDER BY y.year DESC LIMIT 1`, [t.id]);
        if (!y) continue;
        const parts = partsOf(t).filter((p) => p !== 'hunting');
        const catches = t.fishing === 1 ? await db.all<{ fish: string; day: string; length_inches: number | null; kept: number }>('SELECT fish, day, length_inches, kept FROM outdoor_catch WHERE plan_id = ? ORDER BY day, id', [y.plan_id]) : [];
        out.push({ trip_id: t.id, name: t.name, who: t.who, first_day: y.start_day, last_day: y.end_day, parts, catches: catches.map((c) => ({ ...c, kept: c.kept === 1 })) });
      }
      return out;
    },

    /** The morning round's lines for today: opening day coming, and a trip tomorrow with things left to pack. */
    async digestLines(): Promise<{ title: string; detail: string; link: string; urgent: boolean }[]> {
      const day = today();
      const out: { title: string; detail: string; link: string; urgent: boolean }[] = [];
      for (const s of await db.all<{ label: string; opens_on: string; remind_days: number; plan_id: number; trip_id: number; trip: string }>(
        `SELECT s.label, s.opens_on, s.remind_days, s.plan_id, y.trip_id, t.name AS trip FROM outdoor_seasons s JOIN plans p ON p.id = s.plan_id
         JOIN outdoor_trip_years y ON y.plan_id = s.plan_id JOIN outdoor_trips t ON t.id = y.trip_id WHERE p.owner_id = ? AND s.opens_on >= ? AND s.opens_on <= ? ORDER BY s.opens_on`, [owner, day, addDays(day, 121)])) {
        if (addDays(s.opens_on, -s.remind_days) !== day) continue;
        out.push({ title: `${s.label} opens ${s.remind_days === 0 ? 'today' : `in ${plural(s.remind_days, 'day')}`}`, detail: s.trip, link: `/plans/trips/${s.trip_id}/${s.plan_id}`, urgent: false });
      }
      for (const r of await db.all<{ plan_id: number; trip_id: number; trip: string }>(
        `SELECT y.plan_id, y.trip_id, t.name AS trip FROM outdoor_trip_years y JOIN outdoor_trips t ON t.id = y.trip_id JOIN plans p ON p.id = y.plan_id WHERE t.owner_id = ? AND p.start_day = ?`, [owner, addDays(day, 1)])) {
        const left = (await db.get<{ n: number }>('SELECT COUNT(*) AS n FROM outdoor_gear WHERE plan_id = ? AND packed = 0', [r.plan_id]))!.n;
        if (left > 0) out.push({ title: `${r.trip} starts tomorrow`, detail: `${left} still to pack`, link: `/plans/trips/${r.trip_id}/${r.plan_id}`, urgent: true });
      }
      return out;
    },
  };
}

export type OutdoorTrips = ReturnType<typeof outdoorTrips>;
