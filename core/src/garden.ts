/**
 * The garden: plants kept in places, what to do this week, watering, harvests and how each plant did.
 *
 * - A plant is a thing (inventory.ts) in a place (a bed, a pot, the side yard). This adds only what a plant has:
 *   which kind of plant it is, whether it lives outdoors, when it was planted, how it did last time, its harvests
 *   and its photos. Seed packets are things too, with no extra record.
 * - Watering is a chore (upkeep.ts), so it is one tap to mark done and can be given to a child with points.
 *   For a plant outdoors, half an inch of rain or more counts as watered.
 * - Planting times are in weeks before or after the town's last spring frost and first fall frost. The frost dates
 *   are worked out from the town's last ten years (asking the weather service the app already uses, and only when
 *   the person has the weather turned on), or typed by hand.
 *
 * What the weather service is asked for here, in addition to the forecast: the lowest temperature of each day of
 * the last ten years, and the rain of the last week, for the same rounded position as the forecast. Nothing else.
 */
import type { Fetcher } from './connections.ts';
import type { Db } from './db.ts';
import { inventory, type Kind } from './inventory.ts';
import { kitchen } from './kitchen.ts';
import { MAX_PHOTO_BYTES } from './plans.ts';
import { Problem } from './problem.ts';
import { addDays, clean, dayNumber, labelKey, pictureType, rounded, stamp, todayOf, type Clock } from './small.ts';
import { upkeep } from './upkeep.ts';
import { weather } from './weather.ts';

// ---------- what is built in ----------

export type PlantKind = 'veg' | 'flower' | 'fruit' | 'house';
export const PLANT_KINDS: { key: PlantKind; name: string; about: string }[] = [
  { key: 'veg', name: 'Vegetables and herbs', about: 'Tomatoes, beans, basil, anything you eat.' },
  { key: 'flower', name: 'Flowers and shrubs', about: 'Beds, borders, hedges and hydrangeas.' },
  { key: 'fruit', name: 'Fruit trees and berries', about: 'Figs, apples, blueberries, vines.' },
  { key: 'house', name: 'Houseplants', about: 'Anything that lives in a pot indoors.' },
];
export const SEED_KIND = 'Seed packets';

export type Doing = 'sow' | 'plant' | 'prune' | 'feed';
/** `from` and `to` are weeks from the frost: negative is before it. A window runs from the start of `from` to the end of `to`. */
export type Timing = { do: Doing; frost: 'spring' | 'fall'; from: number; to: number };
export type Crop = { key: string; name: string; kind: PlantKind; /** Words that find it in a name. */ words: string[]; /** Days between waterings. */ water: number; timing: Timing[] };

const t = (doing: Doing, frost: 'spring' | 'fall', from: number, to: number): Timing => ({ do: doing, frost, from, to });

/**
 * About thirty common plants. The timings are the general rules of thumb every garden guide gives (hardy crops go
 * in weeks before the last spring frost, tender ones weeks after it, bulbs and garlic after the first fall frost,
 * trees and shrubs are pruned while they are bare), kept loose on purpose. They are a nudge, not a rulebook, and
 * are not taken from any one source's table.
 */
export const CROPS: Crop[] = [
  { key: 'tomato', name: 'Tomato', kind: 'veg', words: ['tomato'], water: 3, timing: [t('plant', 'spring', 1, 3), t('feed', 'spring', 4, 10)] },
  { key: 'pepper', name: 'Pepper', kind: 'veg', words: ['pepper'], water: 3, timing: [t('plant', 'spring', 1, 3), t('feed', 'spring', 5, 10)] },
  { key: 'cucumber', name: 'Cucumber', kind: 'veg', words: ['cucumber'], water: 2, timing: [t('sow', 'spring', 1, 3)] },
  { key: 'squash', name: 'Squash', kind: 'veg', words: ['squash', 'zucchini'], water: 3, timing: [t('sow', 'spring', 1, 3)] },
  { key: 'bean', name: 'Beans', kind: 'veg', words: ['bean'], water: 3, timing: [t('sow', 'spring', 1, 4)] },
  { key: 'pea', name: 'Peas', kind: 'veg', words: [' pea', 'peas'], water: 3, timing: [t('sow', 'spring', -6, -3)] },
  { key: 'lettuce', name: 'Lettuce', kind: 'veg', words: ['lettuce'], water: 2, timing: [t('sow', 'spring', -4, 0), t('sow', 'fall', -8, -6)] },
  { key: 'spinach', name: 'Spinach', kind: 'veg', words: ['spinach'], water: 3, timing: [t('sow', 'spring', -6, -2), t('sow', 'fall', -8, -6)] },
  { key: 'kale', name: 'Kale', kind: 'veg', words: ['kale'], water: 3, timing: [t('plant', 'spring', -4, 0), t('plant', 'fall', -10, -8)] },
  { key: 'collards', name: 'Collards', kind: 'veg', words: ['collard'], water: 3, timing: [t('plant', 'spring', -4, 0), t('plant', 'fall', -12, -8)] },
  { key: 'carrot', name: 'Carrots', kind: 'veg', words: ['carrot'], water: 3, timing: [t('sow', 'spring', -3, 2)] },
  { key: 'radish', name: 'Radishes', kind: 'veg', words: ['radish'], water: 2, timing: [t('sow', 'spring', -4, 0), t('sow', 'fall', -8, -5)] },
  { key: 'beet', name: 'Beets', kind: 'veg', words: ['beet'], water: 3, timing: [t('sow', 'spring', -4, 2)] },
  { key: 'onion', name: 'Onions', kind: 'veg', words: ['onion'], water: 4, timing: [t('plant', 'spring', -6, -2)] },
  { key: 'potato', name: 'Potatoes', kind: 'veg', words: ['potato'], water: 4, timing: [t('plant', 'spring', -4, -1)] },
  { key: 'garlic', name: 'Garlic', kind: 'veg', words: ['garlic'], water: 7, timing: [t('plant', 'fall', 2, 5)] },
  { key: 'corn', name: 'Sweet corn', kind: 'veg', words: ['corn'], water: 3, timing: [t('sow', 'spring', 0, 3)] },
  { key: 'okra', name: 'Okra', kind: 'veg', words: ['okra'], water: 3, timing: [t('sow', 'spring', 2, 4)] },
  { key: 'basil', name: 'Basil', kind: 'veg', words: ['basil'], water: 2, timing: [t('plant', 'spring', 1, 3)] },
  { key: 'parsley', name: 'Parsley', kind: 'veg', words: ['parsley'], water: 3, timing: [t('sow', 'spring', -4, 0)] },
  { key: 'cilantro', name: 'Cilantro', kind: 'veg', words: ['cilantro'], water: 3, timing: [t('sow', 'spring', -3, 0), t('sow', 'fall', -8, -5)] },
  { key: 'mint', name: 'Mint', kind: 'veg', words: ['mint'], water: 3, timing: [t('plant', 'spring', -2, 2)] },
  { key: 'rosemary', name: 'Rosemary', kind: 'veg', words: ['rosemary'], water: 7, timing: [t('plant', 'spring', 0, 3)] },
  { key: 'sunflower', name: 'Sunflower', kind: 'flower', words: ['sunflower'], water: 4, timing: [t('sow', 'spring', 0, 3)] },
  { key: 'zinnia', name: 'Zinnia', kind: 'flower', words: ['zinnia'], water: 3, timing: [t('sow', 'spring', 0, 2)] },
  { key: 'tulip', name: 'Tulips and other bulbs', kind: 'flower', words: ['tulip', 'daffodil', 'bulb'], water: 7, timing: [t('plant', 'fall', 4, 8)] },
  { key: 'rose', name: 'Rose', kind: 'flower', words: ['rose'], water: 5, timing: [t('prune', 'spring', -6, -3), t('feed', 'spring', -1, 1)] },
  { key: 'hydrangea', name: 'Hydrangea', kind: 'flower', words: ['hydrangea'], water: 4, timing: [t('prune', 'spring', -6, -2), t('feed', 'spring', -1, 2)] },
  { key: 'fig', name: 'Fig', kind: 'fruit', words: ['fig'], water: 7, timing: [t('prune', 'spring', -6, -3), t('feed', 'spring', 0, 2)] },
  { key: 'blueberry', name: 'Blueberry', kind: 'fruit', words: ['blueberr'], water: 4, timing: [t('prune', 'spring', -8, -4), t('feed', 'spring', -2, 1)] },
  { key: 'apple', name: 'Apple tree', kind: 'fruit', words: ['apple'], water: 10, timing: [t('prune', 'spring', -8, -4), t('feed', 'spring', -2, 0)] },
  { key: 'strawberry', name: 'Strawberry', kind: 'fruit', words: ['strawberr'], water: 3, timing: [t('plant', 'spring', -4, -1), t('feed', 'spring', 0, 3)] },
  { key: 'pothos', name: 'Pothos', kind: 'house', words: ['pothos'], water: 7, timing: [t('feed', 'spring', 2, 24)] },
  { key: 'snakeplant', name: 'Snake plant', kind: 'house', words: ['snake plant'], water: 14, timing: [t('feed', 'spring', 2, 24)] },
  { key: 'monstera', name: 'Monstera', kind: 'house', words: ['monstera'], water: 7, timing: [t('feed', 'spring', 2, 24)] },
  { key: 'aloe', name: 'Aloe', kind: 'house', words: ['aloe'], water: 14, timing: [t('feed', 'spring', 2, 24)] },
];

/** The built-in plant a name seems to be about ("Cherokee tomatoes" is a tomato), or null. */
export function cropFor(name: string): Crop | null {
  const text = ` ${labelKey(name)} `;
  return CROPS.find((c) => c.words.some((w) => text.includes(w))) ?? null;
}

// ---------- dates ----------

/** A frost date as month and day: "04-15". Accepts a whole day too ("2046-04-15"), and keeps its month and day. */
export function frostDay(text: string | null | undefined, what: string): string | null {
  const said = (text ?? '').trim();
  if (!said) return null;
  const m = /^(?:\d{4}-)?(\d{2})-(\d{2})$/.exec(said);
  if (!m) throw new Problem(400, `${what} is a month and day, like 04-15`);
  dayNumber(`2024-${m[1]}-${m[2]}`);
  return `${m[1]}-${m[2]}`;
}

export type Frost = { last_spring: string | null; first_fall: string | null; how: 'weather' | 'typed' | null; worked_out_on: string | null };

/** The days a task of the garden can be done in a year, given the frost dates. Null when that frost date isn't known. */
export function windowOf(timing: Timing, frost: Frost, year: number): { start: string; end: string } | null {
  const md = timing.frost === 'spring' ? frost.last_spring : frost.first_fall;
  if (!md) return null;
  const anchor = `${year}-${md}`;
  return { start: addDays(anchor, timing.from * 7), end: addDays(anchor, timing.to * 7 + 6) };
}

export type WeekTask = { do: Doing; what: string; crop: string; plant_id: number | null; seed: boolean; start: string; end: string; link: string | null };
export type Candidate = { label: string; crop: Crop; plant_id: number | null; seed: boolean; planted_on: string | null; link: string | null };

/** What falls in the seven days from `today`, for these plants and seed packets. */
export function tasksThisWeek(candidates: Candidate[], frost: Frost, today: string): WeekTask[] {
  const year = Number(today.slice(0, 4));
  const last = addDays(today, 6);
  const out: WeekTask[] = [];
  for (const c of candidates) {
    for (const timing of c.crop.timing) {
      for (const y of [year - 1, year, year + 1]) {
        const w = windowOf(timing, frost, y);
        if (!w || w.end < today || w.start > last) continue;
        // Already sown or planted in this window: nothing left to do.
        if ((timing.do === 'sow' || timing.do === 'plant') && c.planted_on && c.planted_on >= w.start && c.planted_on <= addDays(w.end, 30)) continue;
        out.push({ do: timing.do, what: c.label, crop: c.crop.key, plant_id: c.plant_id, seed: c.seed, start: w.start, end: w.end, link: c.link });
        break;
      }
    }
  }
  const order: Doing[] = ['sow', 'plant', 'prune', 'feed'];
  return out.sort((a, b) => order.indexOf(a.do) - order.indexOf(b.do) || a.what.localeCompare(b.what));
}

const median = (n: number[]): number => { const s = [...n].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m]! : Math.round((s[m - 1]! + s[m]!) / 2); };
const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const dayOfYear = (month: number, day: number) => MONTH_DAYS.slice(0, month - 1).reduce((a, b) => a + b, 0) + day;
function fromDayOfYear(n: number): string {
  let left = n;
  for (const [i, days] of MONTH_DAYS.entries()) {
    if (left <= days) return `${String(i + 1).padStart(2, '0')}-${String(left).padStart(2, '0')}`;
    left -= days;
  }
  return '12-31';
}

/**
 * The usual last spring frost and first fall frost, from the lowest temperature of each day of some past years (in
 * degrees Celsius). A frost is a low of 0 or less. Each year gives its last frost before August and its first
 * from August on; the usual day is the middle one across the years. Needs at least three years that had a frost
 * on that side of the summer, else that date is left out (a town with no frost has none to find).
 */
export function frostFromYears(days: { day: string; low: number }[]): { last_spring: string | null; first_fall: string | null } {
  const spring = new Map<string, number>();
  const fall = new Map<string, number>();
  for (const d of days) {
    if (!(d.low <= 0)) continue;
    const year = d.day.slice(0, 4);
    const n = dayOfYear(Number(d.day.slice(5, 7)), Number(d.day.slice(8, 10)));
    if (Number(d.day.slice(5, 7)) < 8) spring.set(year, Math.max(spring.get(year) ?? 0, n));
    else fall.set(year, Math.min(fall.get(year) ?? 999, n));
  }
  return {
    last_spring: spring.size >= 3 ? fromDayOfYear(median([...spring.values()])) : null,
    first_fall: fall.size >= 3 ? fromDayOfYear(median([...fall.values()])) : null,
  };
}

// ---------- watering ----------

export type RainDay = { day: string; inches: number };
/** Half an inch of rain or more counts as a watering for a plant outdoors. */
export const RAIN_WATERS = 0.5;
export type WaterState = {
  every: number; last_done: string | null; due_on: string; due: boolean; days_late: number;
  /** The rain that counted as watering since the last time it was done, if any. */
  rain: { day: string; inches: number; says: string } | null;
  /** It would be due without that rain. */
  skipped_for_rain: boolean;
};

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const weekdayOf = (day: string) => WEEKDAYS[new Date(dayNumber(day) * 86_400_000).getUTCDay()]!;

/** "Rain on Tuesday: 0.7 in" (or "Rain today", or in millimeters). */
export function rainSays(rain: RainDay, today: string, metric = false): string {
  const amount = metric ? `${Math.round(rain.inches * 25.4)} mm` : `${rounded(rain.inches, 1).toFixed(1)} in`;
  return `Rain ${rain.day === today ? 'today' : `on ${weekdayOf(rain.day)}`}: ${amount}`;
}

export function waterState(input: { every: number; last_done: string | null; planted_on: string | null; started: string; outdoor: boolean; rain: RainDay[]; today: string; metric?: boolean }): WaterState {
  const { every, today } = input;
  const wet = input.outdoor
    ? input.rain.filter((r) => r.inches >= RAIN_WATERS && r.day <= today && (!input.last_done || r.day > input.last_done)).sort((a, b) => (a.day < b.day ? 1 : -1))[0] ?? null
    : null;
  const base = (day: string | null) => day ?? input.planted_on ?? input.started;
  const watered = wet && wet.day > base(input.last_done) ? wet.day : base(input.last_done);
  const dueOn = addDays(watered, every);
  const dueWithout = addDays(base(input.last_done), every);
  const due = dueOn <= today;
  return {
    every, last_done: input.last_done, due_on: dueOn, due, days_late: due ? dayNumber(today) - dayNumber(dueOn) : 0,
    rain: wet ? { ...wet, says: rainSays(wet, today, input.metric) } : null,
    skipped_for_rain: Boolean(wet) && !due && dueWithout <= today,
  };
}

// ---------- the weather the garden uses ----------

export type Warning = { day: string; kind: 'frost' | 'heat'; says: string };
/** Frost and heat in the days the forecast covers, in the degrees the forecast is in. */
export function warningsFrom(days: { day: string; high: number; low: number }[], units: 'c' | 'f', today: string): Warning[] {
  const cold = units === 'c' ? 0 : 32;
  const hot = units === 'c' ? 35 : 95;
  const out: Warning[] = [];
  for (const d of days) {
    const name = d.day === today ? 'tonight' : d.day === addDays(today, 1) ? 'tomorrow' : weekdayOf(d.day);
    if (d.low <= cold) out.push({ day: d.day, kind: 'frost', says: `Frost ${name}: low ${d.low}°` });
    if (d.high >= hot) out.push({ day: d.day, kind: 'heat', says: `Heat ${d.day === today ? 'today' : name}: high ${d.high}°` });
  }
  return out;
}

const RAIN_FRESH_MINUTES = 60;
const rainKept = new Map<string, { at: number; days: RainDay[] }>();

async function askNumbers(fetcher: Fetcher, url: string): Promise<{ time: string[]; values: unknown[] }> {
  let status: number;
  let data: unknown;
  try {
    const answer = await fetcher(url, { Accept: 'application/json' });
    status = answer.status;
    data = status === 200 ? await answer.json() : null;
  } catch {
    throw new Problem(400, "The weather service couldn't be reached just now");
  }
  if (status !== 200) throw new Problem(400, "The weather service couldn't answer just now. Try again in a moment.");
  const daily = (data as { daily?: Record<string, unknown> } | null)?.daily;
  if (!daily || !Array.isArray(daily.time)) throw new Problem(400, "The weather service's answer couldn't be read");
  const key = Object.keys(daily).find((k) => k !== 'time');
  const values = key && Array.isArray(daily[key]) ? daily[key] as unknown[] : [];
  return { time: daily.time as string[], values };
}

// ---------- the garden itself ----------

export type Member = { id: number; name: string } | null;
export type PlantInput = {
  name: string; kind?: string | null; crop?: string | null; place_id?: number | null; outdoor?: boolean; planted_on?: string | null;
  /** Days between waterings. Null: it isn't watered by hand. Left out on a new plant: the usual for its crop. */
  water_every?: number | null; assigned_member?: number | null; points?: number | null; note?: string | null;
};
export type PlantLine = {
  id: number; item_id: number; name: string; kind: PlantKind; kind_name: string; crop: string | null; crop_name: string | null;
  place_id: number | null; place: string | null; outdoor: boolean; planted_on: string | null; how_it_did: string | null; note: string | null;
  water_every: number | null; water_job_id: number | null; member: Member; points: number | null; water: WaterState | null;
  harvested: { year: number; totals: { unit: string | null; amount: number }[] }; photos: number; cover_photo: number | null;
};
export type Harvest = { id: number; plant_id: number; day: string; amount: number | null; unit: string | null; note: string | null };
export type Season = { year: number; totals: { unit: string | null; amount: number; times: number }[] };
export type PlantPhoto = { id: number; source: 'kept' | 'immich'; caption: string | null };
export type Plant = PlantLine & { harvests: Harvest[]; seasons: Season[]; photos_list: PlantPhoto[]; /** What was written about it the last time, for when it is planted again. */ last_time: string | null };
export type GardenCard = {
  frost: Frost; weather: boolean; week: WeekTask[]; today: string;
  water: { due: PlantLine[]; skipped: PlantLine[] }; warnings: Warning[]; plants: number; seeds: number;
};

const PLANT_PHOTO_MAX = 40;
const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

/** Where the weather service is asked. A walk-through can point these at a stand-in; nothing else changes them. */
export type WeatherAddresses = { forecast?: string; archive?: string };

export function garden(db: Db, owner: number, clock: Clock = () => new Date(), tools: { fetcher?: Fetcher; addresses?: WeatherAddresses } = {}) {
  const today = () => todayOf(clock);
  const now = () => stamp(clock());
  const things = () => inventory(db, owner, clock);
  const chores = () => upkeep(db, owner, clock);

  async function kindIds(): Promise<{ byKey: Map<PlantKind, Kind>; seeds: Kind }> {
    let kinds = await things().listKinds();
    const find = (name: string) => kinds.find((k) => labelKey(k.name) === labelKey(name));
    for (const wanted of [...PLANT_KINDS.map((k) => k.name), SEED_KIND]) {
      if (find(wanted)) continue;
      kinds = await things().createKind({ name: wanted, unit: wanted === SEED_KIND ? 'packet' : null, activity: 'Gardening' });
    }
    return { byKey: new Map(PLANT_KINDS.map((k) => [k.key, find(k.name)!])), seeds: find(SEED_KIND)! };
  }

  async function frost(): Promise<Frost> {
    const row = await db.get<{ last_spring: string | null; first_fall: string | null; how: 'weather' | 'typed'; worked_out_on: string | null }>(
      'SELECT last_spring, first_fall, how, worked_out_on FROM garden_frost WHERE owner_id = ?', [owner]);
    return row ?? { last_spring: null, first_fall: null, how: null, worked_out_on: null };
  }

  async function saveFrost(spring: string | null, fall: string | null, how: 'weather' | 'typed'): Promise<Frost> {
    await db.run(
      `INSERT INTO garden_frost (owner_id, last_spring, first_fall, how, worked_out_on) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(owner_id) DO UPDATE SET last_spring = excluded.last_spring, first_fall = excluded.first_fall, how = excluded.how, worked_out_on = excluded.worked_out_on`,
      [owner, spring, fall, how, today()]);
    return frost();
  }

  const skies = () => weather(db, owner, clock, tools.fetcher);

  async function rain(): Promise<RainDay[]> {
    const place = await skies().place();
    if (!place || !tools.fetcher) return [];
    const key = `${owner}:${place.latitude},${place.longitude}`;
    const kept = rainKept.get(key);
    if (kept && clock().getTime() - kept.at >= 0 && clock().getTime() - kept.at < RAIN_FRESH_MINUTES * 60_000) return kept.days;
    try {
      const query = new URLSearchParams({ latitude: String(place.latitude), longitude: String(place.longitude), daily: 'precipitation_sum', past_days: '7', forecast_days: '1', precipitation_unit: 'inch', timezone: 'auto' });
      const got = await askNumbers(tools.fetcher, `${tools.addresses?.forecast ?? 'https://api.open-meteo.com'}/v1/forecast?${query}`);
      const days = got.time.flatMap((day, i): RainDay[] => (typeof got.values[i] === 'number' ? [{ day, inches: got.values[i] as number }] : []));
      rainKept.set(key, { at: clock().getTime(), days });
      return days;
    } catch {
      return kept?.days ?? [];
    }
  }

  type Row = {
    id: number; item_id: number; crop: string | null; outdoor: number; water_every: number | null; water_job_id: number | null; planted_on: string | null; how_it_did: string | null;
    name: string; note: string | null; place_id: number | null; kind_id: number; created_at: string;
    member_id: number | null; member_name: string | null; points: number | null; last_done: string | null; photos: number; cover_photo: number | null;
  };

  const SELECT = `SELECT p.id, p.item_id, p.crop, p.outdoor, p.water_every, p.water_job_id, p.planted_on, p.how_it_did, p.created_at, i.name, i.note, i.place_id, i.kind_id,
      j.assigned_member AS member_id, m.name AS member_name, j.points AS points, (SELECT MAX(d.day) FROM upkeep_done d WHERE d.job_id = p.water_job_id) AS last_done,
      (SELECT COUNT(*) FROM plant_photos f WHERE f.plant_id = p.id) AS photos,
      (SELECT f.id FROM plant_photos f WHERE f.plant_id = p.id ORDER BY f.sort_order, f.id LIMIT 1) AS cover_photo
    FROM plants p JOIN items i ON i.id = p.item_id LEFT JOIN upkeep_jobs j ON j.id = p.water_job_id LEFT JOIN household_members m ON m.id = j.assigned_member
    WHERE p.owner_id = ? AND i.gone_on IS NULL`;

  const cropOf = (key: string | null) => CROPS.find((c) => c.key === key) ?? null;

  async function lines(where = '', args: (string | number)[] = []): Promise<PlantLine[]> {
    const rows = await db.all<Row>(`${SELECT} ${where} ORDER BY i.name COLLATE NOCASE, p.id`, [owner, ...args]);
    if (rows.length === 0) return [];
    const kinds = await kindIds();
    const kindOf = new Map<number, PlantKind>([...kinds.byKey.entries()].map(([k, v]) => [v.id, k]));
    const places = new Map((await things().listPlaces()).map((p) => [p.id, p.path]));
    const rainy = await rain();
    const place = await skies().place();
    const day = today();
    const year = Number(day.slice(0, 4));
    const sums = await db.all<{ plant_id: number; unit: string | null; total: number }>(
      `SELECT h.plant_id, h.unit, SUM(COALESCE(h.amount, 0)) AS total FROM plant_harvests h JOIN plants p ON p.id = h.plant_id WHERE p.owner_id = ? AND h.day >= ? AND h.day <= ? GROUP BY h.plant_id, h.unit`,
      [owner, `${year}-01-01`, `${year}-12-31`]);
    return rows.map((r) => {
      const kind: PlantKind = kindOf.get(r.kind_id) ?? cropOf(r.crop)?.kind ?? 'veg';
      const water = r.water_job_id !== null && r.water_every !== null
        ? waterState({ every: r.water_every, last_done: r.last_done, planted_on: r.planted_on, started: r.created_at.slice(0, 10), outdoor: r.outdoor === 1, rain: rainy, today: day, metric: place?.units === 'c' })
        : null;
      return {
        id: r.id, item_id: r.item_id, name: r.name, kind, kind_name: PLANT_KINDS.find((k) => k.key === kind)!.name, crop: r.crop, crop_name: cropOf(r.crop)?.name ?? null,
        place_id: r.place_id, place: r.place_id !== null ? places.get(r.place_id) ?? null : null, outdoor: r.outdoor === 1, planted_on: r.planted_on, how_it_did: r.how_it_did, note: r.note,
        water_every: r.water_every, water_job_id: r.water_job_id, member: r.member_id !== null ? { id: r.member_id, name: r.member_name ?? '' } : null, points: r.points, water,
        harvested: { year, totals: sums.filter((s) => s.plant_id === r.id).map((s) => ({ unit: s.unit, amount: rounded(s.total, 2) })) },
        photos: r.photos, cover_photo: r.cover_photo,
      };
    });
  }

  async function mine(id: number): Promise<PlantLine> {
    const found = (await lines('AND p.id = ?', [id]))[0];
    if (!found) throw new Problem(404, "That plant isn't here anymore. It may have been removed.");
    return found;
  }

  async function ownPlant(id: number): Promise<{ id: number; item_id: number; water_job_id: number | null }> {
    const row = await db.get<{ id: number; item_id: number; water_job_id: number | null }>('SELECT id, item_id, water_job_id FROM plants WHERE id = ? AND owner_id = ?', [id, owner]);
    if (!row) throw new Problem(404, "That plant isn't here anymore. It may have been removed.");
    return row;
  }

  function checkedDay(day: string | null | undefined, what: string): string | null {
    if (!day) return null;
    try { dayNumber(day); } catch { throw new Problem(400, `${what} is a day, like 2046-03-05`); }
    return day;
  }

  /** The watering chore: made when a plant is given a watering rhythm, changed when that changes, taken away when it is none. */
  async function keepWatering(plantId: number, itemId: number, name: string, input: { every: number | null; member?: number | null; points?: number | null; outdoor: boolean }): Promise<number | null> {
    const row = await db.get<{ water_job_id: number | null }>('SELECT water_job_id FROM plants WHERE id = ?', [plantId]);
    const jobId = row?.water_job_id ?? null;
    if (input.every === null) {
      if (jobId !== null) await chores().remove(jobId);
      return null;
    }
    const job = {
      name: `Water ${name}`, kind: 'chore', activity: 'Gardening', item_id: itemId, every_n: input.every, every_unit: 'day', first_due: today(),
      assigned_member: input.member ?? null, points: input.member ? input.points ?? null : null,
    };
    if (jobId !== null) { await chores().update(jobId, job); return jobId; }
    return (await chores().create(job)).id;
  }

  async function putInPantry(name: string, amount: number | null, unit: string | null): Promise<string> {
    const shop = kitchen(db, owner, clock);
    const have = (await shop.listPantry()).items.find((p) => labelKey(p.name) === labelKey(name));
    if (!have) { await shop.savePantry({ name, quantity: amount, unit }); return `${name} is in your pantry`; }
    if (amount !== null && have.quantity !== null && (labelKey(have.unit ?? '') === labelKey(unit ?? ''))) {
      await shop.savePantry({ name, quantity: rounded(have.quantity + amount, 3), unit: have.unit, location: have.location, expires_on: have.expires_on, low_at: have.low_at });
      return `Added to the ${name} in your pantry`;
    }
    return `${name} is already in your pantry. Its amount was left as it was, because the units differ.`;
  }

  async function seasonsOf(plantId: number): Promise<Season[]> {
    const rows = await db.all<{ year: string; unit: string | null; total: number; times: number }>(
      `SELECT substr(day, 1, 4) AS year, unit, SUM(COALESCE(amount, 0)) AS total, COUNT(*) AS times FROM plant_harvests WHERE plant_id = ? GROUP BY substr(day, 1, 4), unit ORDER BY year DESC, unit`, [plantId]);
    const years = [...new Set(rows.map((r) => Number(r.year)))];
    return years.map((year) => ({ year, totals: rows.filter((r) => Number(r.year) === year).map((r) => ({ unit: r.unit, amount: rounded(r.total, 2), times: r.times })) }));
  }

  async function whole(id: number): Promise<Plant> {
    const line = await mine(id);
    const harvests = await db.all<Harvest>('SELECT id, plant_id, day, amount, unit, note FROM plant_harvests WHERE plant_id = ? ORDER BY day DESC, id DESC', [id]);
    const photos = await db.all<PlantPhoto>('SELECT id, source, caption FROM plant_photos WHERE plant_id = ? ORDER BY sort_order, id', [id]);
    return { ...line, harvests, seasons: await seasonsOf(id), photos_list: photos, last_time: line.how_it_did };
  }

  async function roomForPhoto(plantId: number): Promise<number> {
    const count = (await db.get<{ n: number; last: number | null }>('SELECT COUNT(*) AS n, MAX(sort_order) AS last FROM plant_photos WHERE plant_id = ?', [plantId]))!;
    if (count.n >= PLANT_PHOTO_MAX) throw new Problem(400, `A plant holds ${PLANT_PHOTO_MAX} photos at most`);
    return (count.last ?? 0) + 1;
  }

  async function photoOwner(photoId: number): Promise<number> {
    const found = await db.get<{ plant_id: number }>('SELECT f.plant_id FROM plant_photos f JOIN plants p ON p.id = f.plant_id WHERE f.id = ? AND p.owner_id = ?', [photoId, owner]);
    if (!found) throw new Problem(404, "That photo isn't here anymore. It may have been removed.");
    return found.plant_id;
  }

  return {
    /** The plants Life Is knows the timing of, for choosing one. */
    crops: () => CROPS.map((c) => ({ key: c.key, name: c.name, kind: c.kind, water: c.water })),
    kinds: PLANT_KINDS,

    frost,

    /** Frost dates typed by hand: either may be left blank. */
    async setFrost(input: { last_spring?: string | null; first_fall?: string | null }): Promise<Frost> {
      return saveFrost(frostDay(input.last_spring, 'The last spring frost'), frostDay(input.first_fall, 'The first fall frost'), 'typed');
    },

    /**
     * Work the frost dates out from the town's last ten years. This asks the weather service for the lowest
     * temperature of each day of those years, at the place already chosen for the weather; so it needs the weather on.
     */
    async workOutFrost(): Promise<Frost> {
      const place = await skies().place();
      if (!place) throw new Problem(400, 'Turn the weather on and choose your town first, or type your frost dates by hand');
      if (!tools.fetcher) throw new Problem(400, "This copy of Life Is isn't set up to reach outside services");
      if (place.latitude < 0) throw new Problem(400, "Frost dates can't be worked out for south of the equator yet. Type them by hand.");
      const year = Number(today().slice(0, 4));
      const query = new URLSearchParams({
        latitude: String(place.latitude), longitude: String(place.longitude), start_date: `${year - 10}-01-01`, end_date: `${year - 1}-12-31`,
        daily: 'temperature_2m_min', temperature_unit: 'celsius', timezone: 'auto',
      });
      const got = await askNumbers(tools.fetcher, `${tools.addresses?.archive ?? 'https://archive-api.open-meteo.com'}/v1/archive?${query}`);
      const found = frostFromYears(got.time.flatMap((day, i) => (typeof got.values[i] === 'number' ? [{ day, low: got.values[i] as number }] : [])));
      if (!found.last_spring && !found.first_fall) throw new Problem(400, "Your town's past years show no frost, so there are no dates to work out. You can type them by hand.");
      return saveFrost(found.last_spring, found.first_fall, 'weather');
    },

    async list(): Promise<PlantLine[]> { return lines(); },
    get: whole,

    async seeds(): Promise<{ id: number; name: string; amount: string; place: string | null; crop: string | null }[]> {
      const kinds = await kindIds();
      const found = await things().listItems({ kind_id: kinds.seeds.id });
      return found.map((s) => ({ id: s.id, name: s.name, amount: s.amount, place: s.place, crop: cropFor(s.name)?.name ?? null }));
    },

    /** A seed packet: a thing of its own kind, kept in a place. */
    async addSeeds(input: { name: string; place_id?: number | null; quantity?: number | null; note?: string | null }) {
      const name = clean(input.name, 120);
      if (!name) throw new Problem(400, 'Say what the seeds are');
      const kinds = await kindIds();
      return things().createItem({ kind_id: kinds.seeds.id, name, place_id: input.place_id ?? null, quantity: input.quantity ?? null, unit: 'packet', note: input.note ?? null });
    },

    async addPlant(input: PlantInput): Promise<Plant> {
      const name = clean(input.name, 120);
      if (!name) throw new Problem(400, 'Give the plant a name');
      const crop = input.crop ? cropOf(input.crop) ?? (() => { throw new Problem(400, "That isn't a plant Life Is knows. Leave it blank for any other."); })() : cropFor(name);
      const kindKey = (PLANT_KINDS.find((k) => k.key === input.kind)?.key) ?? crop?.kind ?? 'veg';
      if (input.kind && !PLANT_KINDS.some((k) => k.key === input.kind)) throw new Problem(400, 'Choose one of the four kinds of plant');
      const every = input.water_every === undefined ? crop?.water ?? null : input.water_every;
      if (every !== null && !(Number.isInteger(every) && every >= 1 && every <= 365)) throw new Problem(400, 'Watering is every 1 to 365 days');
      const planted = checkedDay(input.planted_on, 'Planted on');
      const outdoor = input.outdoor ?? kindKey !== 'house';
      const kinds = await kindIds();
      const thing = await things().createItem({ kind_id: kinds.byKey.get(kindKey)!.id, name, place_id: input.place_id ?? null, note: input.note ?? null });
      const made = await db.run('INSERT INTO plants (owner_id, item_id, crop, outdoor, water_every, planted_on, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [owner, thing.id, crop?.key ?? null, outdoor ? 1 : 0, every, planted, now()]);
      const job = await keepWatering(made.lastId, thing.id, name, { every, member: input.assigned_member, points: input.points, outdoor });
      await db.run('UPDATE plants SET water_job_id = ? WHERE id = ?', [job, made.lastId]);
      return whole(made.lastId);
    },

    async updatePlant(id: number, input: PlantInput): Promise<Plant> {
      const row = await ownPlant(id);
      const before = await mine(id);
      const name = clean(input.name, 120) ?? before.name;
      const crop = input.crop === undefined ? cropOf(before.crop) : input.crop ? cropOf(input.crop) ?? (() => { throw new Problem(400, "That isn't a plant Life Is knows."); })() : null;
      const every = input.water_every === undefined ? before.water_every : input.water_every;
      if (every !== null && !(Number.isInteger(every) && every >= 1 && every <= 365)) throw new Problem(400, 'Watering is every 1 to 365 days');
      const outdoor = input.outdoor ?? before.outdoor;
      const planted = input.planted_on === undefined ? before.planted_on : checkedDay(input.planted_on, 'Planted on');
      const member = input.assigned_member === undefined ? before.member?.id ?? null : input.assigned_member;
      const points = input.points === undefined ? before.points : input.points;
      await things().updateItem(row.item_id, { name, place_id: input.place_id === undefined ? before.place_id : input.place_id, note: input.note === undefined ? before.note : input.note });
      await db.run('UPDATE plants SET crop = ?, outdoor = ?, water_every = ?, planted_on = ? WHERE id = ?', [crop?.key ?? null, outdoor ? 1 : 0, every, planted, id]);
      const job = await keepWatering(id, row.item_id, name, { every, member, points, outdoor });
      await db.run('UPDATE plants SET water_job_id = ? WHERE id = ?', [job, id]);
      return whole(id);
    },

    /** Take a plant away: its thing, its watering, its harvests and photos. */
    async removePlant(id: number): Promise<void> {
      const row = await ownPlant(id);
      if (row.water_job_id !== null) await chores().remove(row.water_job_id);
      await things().deleteItem(row.item_id);
    },

    /** Water done: one tap. By default it is the signed-in person's; `by_member` credits a child (who earns the points the chore carries). */
    async water(id: number, input: { by_member?: number | null; day?: string | null } = {}): Promise<Plant> {
      const row = await ownPlant(id);
      if (row.water_job_id === null) throw new Problem(400, "This plant isn't set to be watered. Give it a number of days between waterings first.");
      await chores().done(row.water_job_id, { day: checkedDay(input.day, 'The day') ?? today(), by_member: input.by_member ?? null });
      return whole(id);
    },

    /**
     * It is planted (or sown) today or on a day. The note from the last time comes back with it, to read before
     * it goes in again; planting starts a new season, so the note is kept until a new one is written.
     */
    async planted(id: number, day?: string | null): Promise<{ plant: Plant; last_time: string | null }> {
      await ownPlant(id);
      const before = await mine(id);
      await db.run('UPDATE plants SET planted_on = ? WHERE id = ?', [checkedDay(day, 'Planted on') ?? today(), id]);
      return { plant: await whole(id), last_time: before.how_it_did };
    },

    /** How it did: written at the end of the season, shown the next time it is planted. */
    async howItDid(id: number, text: string | null): Promise<Plant> {
      await ownPlant(id);
      await db.run('UPDATE plants SET how_it_did = ? WHERE id = ?', [clean(text, 2000), id]);
      return whole(id);
    },

    async harvest(id: number, input: { day?: string | null; amount?: number | null; unit?: string | null; note?: string | null; pantry?: boolean }): Promise<{ plant: Plant; pantry: string | null }> {
      await ownPlant(id);
      if (input.amount != null && !(Number.isFinite(input.amount) && input.amount >= 0 && input.amount < 1e7)) throw new Problem(400, 'The amount is 0 or more');
      const day = checkedDay(input.day, 'The day') ?? today();
      const unit = clean(input.unit, 30);
      await db.run('INSERT INTO plant_harvests (plant_id, day, amount, unit, note, created_at) VALUES (?, ?, ?, ?, ?, ?)', [id, day, input.amount ?? null, unit, clean(input.note, 500), now()]);
      let pantry: string | null = null;
      if (input.pantry) {
        const line = await mine(id);
        pantry = await putInPantry((line.crop_name ?? line.name).toLowerCase(), input.amount ?? null, unit);
      }
      return { plant: await whole(id), pantry };
    },

    async removeHarvest(harvestId: number): Promise<Plant> {
      const found = await db.get<{ plant_id: number }>('SELECT h.plant_id FROM plant_harvests h JOIN plants p ON p.id = h.plant_id WHERE h.id = ? AND p.owner_id = ?', [harvestId, owner]);
      if (!found) throw new Problem(404, "That harvest isn't here anymore.");
      await db.run('DELETE FROM plant_harvests WHERE id = ?', [harvestId]);
      return whole(found.plant_id);
    },

    /** This year's harvest, plant by plant, with the season's totals. */
    async harvests(year?: number | null): Promise<{ year: number; totals: { unit: string | null; amount: number }[]; plants: { id: number; name: string; totals: { unit: string | null; amount: number }[] }[] }> {
      const y = year ?? Number(today().slice(0, 4));
      const rows = await db.all<{ id: number; name: string; unit: string | null; total: number }>(
        `SELECT p.id, i.name, h.unit, SUM(COALESCE(h.amount, 0)) AS total FROM plant_harvests h JOIN plants p ON p.id = h.plant_id JOIN items i ON i.id = p.item_id
         WHERE p.owner_id = ? AND h.day >= ? AND h.day <= ? GROUP BY p.id, i.name, h.unit ORDER BY i.name COLLATE NOCASE`, [owner, `${y}-01-01`, `${y}-12-31`]);
      const totals = new Map<string | null, number>();
      for (const r of rows) totals.set(r.unit, (totals.get(r.unit) ?? 0) + r.total);
      const names = [...new Map(rows.map((r) => [r.id, r.name])).entries()];
      return {
        year: y, totals: [...totals.entries()].map(([unit, amount]) => ({ unit, amount: rounded(amount, 2) })),
        plants: names.map(([id, name]) => ({ id, name, totals: rows.filter((r) => r.id === id).map((r) => ({ unit: r.unit, amount: rounded(r.total, 2) })) })),
      };
    },

    // ---------- photos, kept as plan photos are ----------

    async keepPhoto(id: number, bytes: Uint8Array, caption?: string | null): Promise<Plant> {
      await ownPlant(id);
      const type = pictureType(bytes);
      if (!type || !PHOTO_TYPES.includes(type)) throw new Problem(400, "That isn't a photo Life Is can keep (JPEG, PNG or WebP)");
      if (bytes.length > MAX_PHOTO_BYTES) throw new Problem(400, 'That photo is too large to keep');
      const order = await roomForPhoto(id);
      await db.run('INSERT INTO plant_photos (plant_id, source, type, bytes, caption, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [id, 'kept', type, bytes, clean(caption, 300), order, now()]);
      return whole(id);
    },

    async linkPhoto(id: number, assetId: string, caption?: string | null): Promise<Plant> {
      await ownPlant(id);
      if (!/^[0-9a-fA-F-]{8,64}$/.test(assetId)) throw new Problem(400, "That isn't a photo from the library");
      const order = await roomForPhoto(id);
      if (await db.get('SELECT id FROM plant_photos WHERE plant_id = ? AND source = ? AND asset_id = ?', [id, 'immich', assetId])) return whole(id);
      await db.run('INSERT INTO plant_photos (plant_id, source, asset_id, caption, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?)', [id, 'immich', assetId, clean(caption, 300), order, now()]);
      return whole(id);
    },

    async photo(photoId: number): Promise<{ source: 'kept'; type: string; bytes: Uint8Array } | { source: 'immich'; asset_id: string }> {
      await photoOwner(photoId);
      const found = (await db.get<{ source: 'kept' | 'immich'; type: string | null; bytes: Uint8Array | null; asset_id: string | null }>('SELECT source, type, bytes, asset_id FROM plant_photos WHERE id = ?', [photoId]))!;
      return found.source === 'kept' ? { source: 'kept', type: found.type!, bytes: found.bytes! } : { source: 'immich', asset_id: found.asset_id! };
    },

    async captionPhoto(photoId: number, caption: string | null): Promise<Plant> {
      const plant = await photoOwner(photoId);
      await db.run('UPDATE plant_photos SET caption = ? WHERE id = ?', [clean(caption, 300), photoId]);
      return whole(plant);
    },

    async removePhoto(photoId: number): Promise<Plant> {
      const plant = await photoOwner(photoId);
      await db.run('DELETE FROM plant_photos WHERE id = ?', [photoId]);
      return whole(plant);
    },

    // ---------- the front page card ----------

    async card(): Promise<GardenCard> {
      const day = today();
      const dates = await frost();
      const plants = await lines();
      const seeds = await this_seeds();
      const candidates: Candidate[] = [
        ...plants.flatMap((p): Candidate[] => { const crop = cropOf(p.crop); return crop ? [{ label: p.name, crop, plant_id: p.id, seed: false, planted_on: p.planted_on, link: `/garden/${p.id}` }] : []; }),
        ...seeds.flatMap((s): Candidate[] => { const crop = cropFor(s.name); return crop ? [{ label: s.name, crop, plant_id: null, seed: true, planted_on: null, link: '/garden' }] : []; }),
      ];
      const place = await skies().place();
      const forecast = place ? (await skies().status()).forecast : null;
      return {
        frost: dates, today: day, weather: place !== null, plants: plants.length, seeds: seeds.length,
        week: tasksThisWeek(candidates, dates, day),
        water: { due: plants.filter((p) => p.water?.due), skipped: plants.filter((p) => p.water?.skipped_for_rain) },
        warnings: place && forecast ? warningsFrom(forecast.days, place.units, day) : [],
      };
    },
  };

  async function this_seeds() {
    const kinds = await kindIds();
    return things().listItems({ kind_id: kinds.seeds.id });
  }
}

export type Garden = ReturnType<typeof garden>;
