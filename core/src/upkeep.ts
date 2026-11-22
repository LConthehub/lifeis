/**
 * Upkeep: the jobs that come round again. The furnace filter every three months, the gutters every autumn,
 * the oil every 5,000 miles or six months, whichever comes first.
 *
 * A job can be for one of your things (the car, the furnace), needs some of your things as tools, and uses
 * some up as supplies. Doing it is kept: the day, who did it, a reading if it goes by one, the time and the
 * cost. Each tool's history says it was used for the job; each supply comes out of what you have, and one
 * that runs low goes on the shopping list; the cost can go into the month's spending.
 *
 * A reading (an odometer, an hour meter) is kept on the thing it's read from, so every job for the car knows
 * the car's miles, however they were last read.
 *
 * A job is its owner's. Given to someone else in the household (assigned_to), it shows in their upkeep too,
 * and they can do it; its tools and supplies are still the owner's things.
 */
import { atomic, type Db, type Queries, type Value } from './db.ts';
import { noteHistory, placePath } from './history.ts';
import { inventory } from './inventory.ts';
import { kitchen } from './kitchen.ts';
import { money } from './money.ts';
import { Problem } from './problem.ts';
import { addDays, clean, dayNumber, dayOrNull, labelKey, rounded, stamp, todayOf, type Clock } from './small.ts';
import * as units from './units.ts';

export const EVERY_UNITS = ['day', 'week', 'month', 'year'] as const;
export type EveryUnit = (typeof EVERY_UNITS)[number];
export type DueState = 'overdue' | 'due' | 'soon' | 'later' | 'unscheduled';

export const JOB_KINDS = ['job', 'bill', 'renewal', 'chore'] as const;
export type JobKind = (typeof JOB_KINDS)[number];
/** A bill or a renewal stays on its date: rent is due on the 1st however late last month's was paid. */
const anchored = (kind: JobKind) => kind === 'bill' || kind === 'renewal';

export type JobInput = {
  name: string;
  /** A job around the home (the default), a bill, a renewal, or a chore. Left out: unchanged. */
  kind?: string | null;
  /** What a bill or a renewal costs each time. */
  amount_cents?: number | null;
  /** What a chore is worth to whoever does it. */
  points?: number | null;
  /** A bill that pays itself: it's a reminder that money is about to leave, not something to do. */
  autopay?: boolean;
  /** The pet this care is for. Left out: unchanged. */
  pet_id?: number | null;
  activity?: string | null;
  /** The thing the job is for: the car, the furnace. */
  item_id?: number | null;
  every_n?: number | null;
  every_unit?: string | null;
  every_reading?: number | null;
  reading_unit?: string | null;
  /** When it's first due, if it has never been done. */
  first_due?: string | null;
  assigned_to?: number | null;
  steps?: string | null;
  note?: string | null;
  /** The tools it needs: your things, by id. Left out: unchanged. */
  tools?: number[];
  /** What it uses up. Left out: unchanged. */
  supplies?: { item_id: number; quantity?: number | null; unit?: string | null }[];
  /** When it was last done before it was kept here, so the next time is known from the start. Only when making one. */
  last_done?: { day: string; reading?: number | null } | null;
};
export type DoneInput = {
  day?: string | null; reading?: number | null; minutes?: number | null; cost_cents?: number | null; note?: string | null;
  /** Put the cost into the month's spending, in this category (or none). */
  spend?: { category_id?: number | null } | null;
};

export type Due = {
  state: DueState;
  /** The day it's next due by time, or null. */
  next_day: string | null;
  /** Days until then: below 0 is late. */
  days_left: number | null;
  /** The reading it's next due at, the latest reading, and how far off that is. */
  next_reading: number | null;
  latest_reading: number | null;
  reading_left: number | null;
};
export type JobTool = { id: number; name: string; icon: string | null; place: string | null };
export type JobSupply = { id: number; item_id: number; name: string; quantity: number | null; unit: string | null; amount: string; have: string; low: boolean; place: string | null };
export type DoneRecord = { id: number; day: string; by: string | null; reading: number | null; minutes: number | null; cost_cents: number | null; points: number | null; money_entry_id: number | null; note: string | null };
export type Job = {
  id: number;
  name: string;
  kind: JobKind;
  amount_cents: number | null;
  points: number | null;
  autopay: boolean;
  pet: { id: number; name: string } | null;
  activity: string | null;
  /** Whether the person asking owns it (and so can change it). */
  mine: boolean;
  owner: string;
  item: { id: number; name: string; place: string | null } | null;
  every: { n: number; unit: EveryUnit } | null;
  every_reading: number | null;
  reading_unit: string | null;
  first_due: string | null;
  assigned_to: { id: number; name: string } | null;
  steps: string | null;
  note: string | null;
  tools: JobTool[];
  supplies: JobSupply[];
  due: Due;
  last_done: { day: string; reading: number | null } | null;
};
export type DoneResult = { job: Job; done: DoneRecord[]; to_buy: string[]; check_by_hand: string[] };

type JobRow = {
  id: number; owner_id: number; owner: string; name: string; activity: string | null; item_id: number | null;
  every_n: number | null; every_unit: EveryUnit | null; every_reading: number | null; reading_unit: string | null;
  first_due: string | null; assigned_to: number | null; assigned_name: string | null; steps: string | null; note: string | null;
  kind: JobKind; amount_cents: number | null; points: number | null; autopay: number; pet_id: number | null; pet_name: string | null;
};

const MAX_TOOLS = 40;
const MAX_SUPPLIES = 40;
const ORDER: DueState[] = ['overdue', 'due', 'soon', 'later', 'unscheduled'];
const pad = (n: number) => String(n).padStart(2, '0');

/** A day a number of days, weeks, months or years on. The 31st a month on is the month's last day. */
export function addInterval(day: string, n: number, unit: EveryUnit): string {
  if (unit === 'day') return addDays(day, n);
  if (unit === 'week') return addDays(day, n * 7);
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const total = m - 1 + (unit === 'month' ? n : n * 12);
  const year = y + Math.floor(total / 12);
  const month = ((total % 12) + 12) % 12;
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return `${year}-${pad(month + 1)}-${pad(Math.min(d, last))}`;
}

/** How many days ahead "soon" is: two weeks, or a quarter of the time between, whichever is shorter. */
function soonWindow(n: number, unit: EveryUnit): number {
  const days = n * { day: 1, week: 7, month: 30, year: 365 }[unit];
  return Math.max(1, Math.min(14, Math.round(days / 4)));
}

/**
 * When a job is next due, and how pressing that is: by time, by reading, or by whichever comes first.
 * `last` is the last time it was done; `latest` the latest reading of what it goes by.
 */
export function dueOf(job: Pick<JobRow, 'every_n' | 'every_unit' | 'every_reading' | 'first_due'> & { kind?: JobKind }, last: { day: string; reading: number | null } | null, latest: number | null, today: string): Due {
  const out: Due = { state: 'unscheduled', next_day: null, days_left: null, next_reading: null, latest_reading: latest, reading_left: null };
  const states: DueState[] = [];
  if (job.every_n && job.every_unit) {
    // A bill or renewal is due on its own date; anything else, so long after it was last done.
    out.next_day = anchored(job.kind ?? 'job') && job.first_due ? job.first_due : last ? addInterval(last.day, job.every_n, job.every_unit) : (job.first_due ?? today);
    out.days_left = dayNumber(out.next_day) - dayNumber(today);
    states.push(out.days_left < 0 ? 'overdue' : out.days_left === 0 ? 'due' : out.days_left <= soonWindow(job.every_n, job.every_unit) ? 'soon' : 'later');
  }
  if (job.every_reading) {
    // Without a reading from when it was last done, the next is counted from the earliest reading known.
    const from = last?.reading ?? null;
    if (from !== null) out.next_reading = rounded(from + job.every_reading, 2);
    if (out.next_reading !== null && latest !== null) {
      out.reading_left = rounded(out.next_reading - latest, 2);
      states.push(out.reading_left < 0 ? 'overdue' : out.reading_left === 0 ? 'due' : out.reading_left <= job.every_reading * 0.1 ? 'soon' : 'later');
    } else if (!job.every_n) {
      states.push('later');
    }
  }
  if (states.length) out.state = states.sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b))[0]!;
  else if (job.first_due) {
    out.next_day = job.first_due;
    out.days_left = dayNumber(job.first_due) - dayNumber(today);
    out.state = out.days_left < 0 ? 'overdue' : out.days_left === 0 ? 'due' : out.days_left <= 14 ? 'soon' : 'later';
  }
  return out;
}

/** Common upkeep around a home, to start from. Each is only a suggestion: every part can be changed. */
export const STARTER_JOBS: { name: string; activity: string; kind?: JobKind; points?: number; every_n?: number; every_unit?: EveryUnit; every_reading?: number; reading_unit?: string; steps?: string }[] = [
  { name: 'Rent or mortgage', activity: 'Home', kind: 'bill', every_n: 1, every_unit: 'month' },
  { name: 'Electricity', activity: 'Home', kind: 'bill', every_n: 1, every_unit: 'month' },
  { name: 'Internet', activity: 'Home', kind: 'bill', every_n: 1, every_unit: 'month' },
  { name: 'Phone', activity: 'Home', kind: 'bill', every_n: 1, every_unit: 'month' },
  { name: 'Car registration', activity: 'Car', kind: 'renewal', every_n: 1, every_unit: 'year' },
  { name: 'Car insurance', activity: 'Car', kind: 'renewal', every_n: 6, every_unit: 'month' },
  { name: 'Home or renters insurance', activity: 'Home', kind: 'renewal', every_n: 1, every_unit: 'year' },
  { name: 'Passport', activity: 'Papers', kind: 'renewal', every_n: 10, every_unit: 'year' },
  { name: "Driver's license", activity: 'Papers', kind: 'renewal', every_n: 4, every_unit: 'year' },
  { name: 'Take out the trash', activity: 'Chores', kind: 'chore', points: 2, every_n: 1, every_unit: 'week' },
  { name: 'Vacuum', activity: 'Chores', kind: 'chore', points: 3, every_n: 1, every_unit: 'week' },
  { name: 'Clean the bathroom', activity: 'Chores', kind: 'chore', points: 5, every_n: 1, every_unit: 'week' },
  { name: 'Do the dishes', activity: 'Chores', kind: 'chore', points: 1, every_n: 1, every_unit: 'day' },
  { name: 'Tidy your room', activity: 'Chores', kind: 'chore', points: 2, every_n: 1, every_unit: 'week' },
  { name: 'Change the furnace filter', activity: 'Home maintenance', every_n: 3, every_unit: 'month', steps: 'Turn the system off.\nNote the size printed on the old filter.\nArrow on the new one points toward the furnace.' },
  { name: 'Test the smoke and CO alarms', activity: 'Home maintenance', every_n: 1, every_unit: 'month' },
  { name: 'Replace smoke alarm batteries', activity: 'Home maintenance', every_n: 1, every_unit: 'year' },
  { name: 'Clean the gutters', activity: 'Home maintenance', every_n: 6, every_unit: 'month' },
  { name: 'Flush the water heater', activity: 'Home maintenance', every_n: 1, every_unit: 'year' },
  { name: 'Clean the dryer vent', activity: 'Home maintenance', every_n: 1, every_unit: 'year' },
  { name: 'Clean the fridge coils', activity: 'Home maintenance', every_n: 1, every_unit: 'year' },
  { name: 'Service the air conditioning', activity: 'Home maintenance', every_n: 1, every_unit: 'year' },
  { name: 'Change the oil', activity: 'Car', every_n: 6, every_unit: 'month', every_reading: 5000, reading_unit: 'miles' },
  { name: 'Rotate the tires', activity: 'Car', every_reading: 6000, reading_unit: 'miles' },
  { name: 'Check the tire pressure', activity: 'Car', every_n: 1, every_unit: 'month' },
  { name: 'Sharpen the mower blade', activity: 'Garden', every_n: 1, every_unit: 'year' },
];

export function upkeep(db: Db, viewer: number, clock: Clock = () => new Date()) {
  const now = () => stamp(clock());
  const today = () => todayOf(clock);

  async function rows(q: Queries, where = '', args: Value[] = []): Promise<JobRow[]> {
    return q.all<JobRow>(
      `SELECT j.id, j.owner_id, o.username AS owner, j.name, j.activity, j.item_id, j.every_n, j.every_unit, j.every_reading, j.reading_unit,
              j.first_due, j.assigned_to, a.username AS assigned_name, j.steps, j.note, j.kind, j.amount_cents, j.points, j.autopay, j.pet_id, p.name AS pet_name
       FROM upkeep_jobs j JOIN users o ON o.id = j.owner_id LEFT JOIN users a ON a.id = j.assigned_to LEFT JOIN pets p ON p.id = j.pet_id
       WHERE (j.owner_id = ? OR j.assigned_to = ?) ${where} ORDER BY j.name COLLATE NOCASE, j.id`, [viewer, viewer, ...args]);
  }

  async function seen(q: Queries, id: number): Promise<JobRow> {
    const row = (await rows(q, 'AND j.id = ?', [id]))[0];
    if (!row) throw new Problem(404, 'Not found');
    return row;
  }
  async function mine(q: Queries, id: number): Promise<JobRow> {
    const row = await seen(q, id);
    if (row.owner_id !== viewer) throw new Problem(403, 'Only the person whose job this is can change it');
    return row;
  }

  async function latestReading(q: Queries, row: { id: number; item_id: number | null }): Promise<number | null> {
    const found = row.item_id !== null
      ? await q.get<{ v: number | null }>('SELECT MAX(value) AS v FROM readings WHERE item_id = ?', [row.item_id])
      : await q.get<{ v: number | null }>('SELECT MAX(value) AS v FROM readings WHERE job_id = ?', [row.id]);
    return found?.v ?? null;
  }

  async function whole(q: Queries, row: JobRow): Promise<Job> {
    const owner = row.owner_id;
    const things = new Map((await inventory(db, owner, clock).listItems()).map((t) => [t.id, t]));
    const item = row.item_id !== null ? things.get(row.item_id) : undefined;
    const tools = (await q.all<{ item_id: number }>('SELECT item_id FROM upkeep_tools WHERE job_id = ? ORDER BY sort_order', [row.id]))
      .map((t) => things.get(t.item_id)).filter((t) => t !== undefined)
      .map((t) => ({ id: t.id, name: t.name, icon: t.icon, place: t.place }));
    const supplies = (await q.all<{ id: number; item_id: number; quantity: number | null; unit: string | null }>(
      'SELECT id, item_id, quantity, unit FROM upkeep_supplies WHERE job_id = ? ORDER BY sort_order, id', [row.id]))
      .filter((s) => things.has(s.item_id))
      .map((s) => {
        const t = things.get(s.item_id)!;
        return { id: s.id, item_id: s.item_id, name: t.name, quantity: s.quantity, unit: s.unit, amount: s.quantity !== null ? units.amount(s.quantity, s.unit) : 'some', have: t.amount, low: t.low, place: t.place };
      });
    const last = (await q.get<{ day: string; reading: number | null }>('SELECT day, reading FROM upkeep_done WHERE job_id = ? ORDER BY day DESC, id DESC LIMIT 1', [row.id])) ?? null;
    // The reading it was last done at, if that time had none: the last one that did.
    const lastReading = last && last.reading === null
      ? ((await q.get<{ reading: number }>('SELECT reading FROM upkeep_done WHERE job_id = ? AND reading IS NOT NULL ORDER BY day DESC, id DESC LIMIT 1', [row.id]))?.reading ?? null)
      : (last?.reading ?? null);
    return {
      id: row.id, name: row.name, kind: row.kind, amount_cents: row.amount_cents, points: row.points, autopay: row.autopay === 1,
      pet: row.pet_id !== null ? { id: row.pet_id, name: row.pet_name ?? '' } : null,
      activity: row.activity, mine: owner === viewer, owner: row.owner,
      item: item ? { id: item.id, name: item.name, place: item.place } : null,
      every: row.every_n && row.every_unit ? { n: row.every_n, unit: row.every_unit } : null,
      every_reading: row.every_reading, reading_unit: row.reading_unit, first_due: row.first_due,
      assigned_to: row.assigned_to !== null ? { id: row.assigned_to, name: row.assigned_name ?? '' } : null,
      steps: row.steps, note: row.note, tools, supplies,
      due: dueOf(row, last ? { day: last.day, reading: lastReading } : null, await latestReading(q, row), today()),
      last_done: last,
    };
  }

  async function doneList(q: Queries, jobId: number): Promise<DoneRecord[]> {
    return q.all<DoneRecord>(
      `SELECT d.id, d.day, u.username AS by, d.reading, d.minutes, d.cost_cents, d.points, d.money_entry_id, d.note
       FROM upkeep_done d LEFT JOIN users u ON u.id = d.done_by WHERE d.job_id = ? ORDER BY d.day DESC, d.id DESC`, [jobId]);
  }

  /** A job's own columns, checked, in the order the SQL below names them. */
  async function checked(q: Queries, input: JobInput): Promise<Value[]> {
    const name = clean(input.name, 200);
    if (!name) throw new Problem(400, 'Give the job a name');
    const unit = input.every_unit ?? null;
    if (unit !== null && !EVERY_UNITS.includes(unit as EveryUnit)) throw new Problem(400, 'It comes round every so many days, weeks, months or years');
    const n = input.every_n ?? null;
    if ((n === null) !== (unit === null)) throw new Problem(400, 'Say how often: a number, and days, weeks, months or years');
    if (n !== null && !(Number.isInteger(n) && n > 0 && n <= 1000)) throw new Problem(400, 'How often is a whole number, 1 or more');
    const reading = input.every_reading ?? null;
    if (reading !== null && !(reading > 0 && reading < 1e9)) throw new Problem(400, 'The reading it comes round at is more than 0');
    if (input.first_due != null && !dayOrNull(input.first_due)) throw new Problem(400, 'Pick the day it is first due');
    if (input.item_id != null && !(await q.get('SELECT id FROM items WHERE id = ? AND owner_id = ?', [input.item_id, viewer]))) throw new Problem(404, "That thing isn't one of yours");
    if (input.assigned_to != null && !(await q.get('SELECT id FROM users WHERE id = ?', [input.assigned_to]))) throw new Problem(404, "That person isn't in this Life Is");
    return [name, clean(input.activity, 60), input.item_id ?? null, n, unit, reading, reading !== null ? clean(input.reading_unit, 20) : null,
      dayOrNull(input.first_due), input.assigned_to ?? null, clean(input.steps, 5000), clean(input.note, 2000)];
  }

  /** What kind it is, and what goes with that: an amount for a bill or renewal, points for a chore. */
  async function saveKind(q: Queries, jobId: number, input: JobInput, making: boolean) {
    if (input.kind != null && !JOB_KINDS.includes(input.kind as JobKind)) throw new Problem(400, "It's a job, a bill, a renewal or a chore");
    if (input.amount_cents != null && !(Number.isInteger(input.amount_cents) && input.amount_cents >= 0 && input.amount_cents < 1e11)) throw new Problem(400, 'What it costs is an amount, 0 or more');
    if (input.points != null && !(Number.isInteger(input.points) && input.points >= 0 && input.points <= 1000)) throw new Problem(400, 'Points are a whole number, up to 1000');
    const sets: string[] = [];
    const args: Value[] = [];
    if (input.kind != null) { sets.push('kind = ?'); args.push(input.kind); }
    if (input.amount_cents !== undefined || making) { sets.push('amount_cents = ?'); args.push(input.amount_cents ?? null); }
    if (input.points !== undefined || making) { sets.push('points = ?'); args.push(input.points ?? null); }
    if (input.autopay !== undefined) { sets.push('autopay = ?'); args.push(input.autopay ? 1 : 0); }
    if (input.pet_id !== undefined) {
      if (input.pet_id !== null && !(await q.get('SELECT id FROM pets WHERE id = ? AND owner_id = ?', [input.pet_id, viewer]))) throw new Problem(404, "That pet isn't one of yours");
      sets.push('pet_id = ?'); args.push(input.pet_id);
    }
    if (sets.length) await q.run(`UPDATE upkeep_jobs SET ${sets.join(', ')} WHERE id = ?`, [...args, jobId]);
  }

  async function saveParts(q: Queries, jobId: number, input: JobInput) {
    const yours = async (id: number) => {
      if (!(await q.get('SELECT id FROM items WHERE id = ? AND owner_id = ?', [id, viewer]))) throw new Problem(404, "One of those things isn't yours");
    };
    if (input.tools !== undefined) {
      if (input.tools.length > MAX_TOOLS) throw new Problem(400, `A job can list ${MAX_TOOLS} tools at most`);
      await q.run('DELETE FROM upkeep_tools WHERE job_id = ?', [jobId]);
      let order = 0;
      for (const id of new Set(input.tools)) {
        await yours(id);
        await q.run('INSERT INTO upkeep_tools (job_id, item_id, sort_order) VALUES (?, ?, ?)', [jobId, id, order++]);
      }
    }
    if (input.supplies !== undefined) {
      if (input.supplies.length > MAX_SUPPLIES) throw new Problem(400, `A job can list ${MAX_SUPPLIES} supplies at most`);
      await q.run('DELETE FROM upkeep_supplies WHERE job_id = ?', [jobId]);
      let order = 0;
      for (const s of input.supplies) {
        await yours(s.item_id);
        if (s.quantity != null && !(s.quantity > 0 && s.quantity < 1e9)) throw new Problem(400, 'How much a job uses is more than 0');
        await q.run('INSERT INTO upkeep_supplies (job_id, item_id, quantity, unit, sort_order) VALUES (?, ?, ?, ?, ?)',
          [jobId, s.item_id, s.quantity ?? null, units.canonical(clean(s.unit, 20)), order++]);
      }
    }
  }

  async function noteReading(q: Queries, row: { id: number; owner_id: number; item_id: number | null }, value: number, day: string) {
    if (!(value >= 0 && value < 1e12)) throw new Problem(400, 'A reading is a number, 0 or more');
    await q.run('INSERT INTO readings (owner_id, item_id, job_id, value, day, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [row.owner_id, row.item_id, row.item_id === null ? row.id : null, value, day, now()]);
  }

  async function listJobs(): Promise<Job[]> {
    const all: Job[] = [];
    for (const row of await rows(db)) all.push(await whole(db, row));
    return all.sort((a, b) => ORDER.indexOf(a.due.state) - ORDER.indexOf(b.due.state)
      || (a.due.days_left ?? Infinity) - (b.due.days_left ?? Infinity) || a.name.localeCompare(b.name));
  }
  async function getJob(id: number): Promise<Job & { done: DoneRecord[] }> {
    const row = await seen(db, id);
    return { ...(await whole(db, row)), done: await doneList(db, id) };
  }

  return {
    /** Everyone else in this Life Is a job can be given to. */
    async people(): Promise<{ id: number; name: string }[]> {
      return db.all<{ id: number; name: string }>('SELECT id, username AS name FROM users ORDER BY username COLLATE NOCASE');
    },

    /** Every job this person owns or has been given, the most pressing first. */
    list: listJobs,
    get: getJob,

    create(input: JobInput): Promise<Job> {
      return atomic(db, async (tx): Promise<number> => {
        const made = await tx.run(
          `INSERT INTO upkeep_jobs (owner_id, name, activity, item_id, every_n, every_unit, every_reading, reading_unit, first_due, assigned_to, steps, note, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [viewer, ...(await checked(tx, input)), now(), now()]);
        await saveParts(tx, made.lastId, input);
        await saveKind(tx, made.lastId, input, true);
        if (input.last_done) {
          const day = dayOrNull(input.last_done.day);
          if (!day) throw new Problem(400, 'Pick the day it was last done');
          const reading = input.last_done.reading ?? null;
          await tx.run('INSERT INTO upkeep_done (job_id, day, done_by, reading, note, created_at) VALUES (?, ?, NULL, ?, ?, ?)',
            [made.lastId, day, reading, 'before it was kept here', now()]);
          if (reading !== null) await noteReading(tx, { id: made.lastId, owner_id: viewer, item_id: input.item_id ?? null }, reading, day);
        }
        return made.lastId;
      }).then(async (id) => whole(db, await seen(db, id)));
    },

    update(id: number, input: JobInput): Promise<Job> {
      return atomic(db, async (tx) => {
        await mine(tx, id);
        await tx.run(
          `UPDATE upkeep_jobs SET name = ?, activity = ?, item_id = ?, every_n = ?, every_unit = ?, every_reading = ?, reading_unit = ?, first_due = ?,
             assigned_to = ?, steps = ?, note = ?, updated_at = ? WHERE id = ?`, [...(await checked(tx, input)), now(), id]);
        await saveParts(tx, id, input);
        await saveKind(tx, id, input, false);
      }).then(async () => whole(db, await seen(db, id)));
    },

    async remove(id: number): Promise<void> {
      await mine(db, id);
      await db.run('DELETE FROM upkeep_jobs WHERE id = ?', [id]);
    },

    /** A reading taken without doing the job: the car's miles today. */
    async reading(id: number, value: number, day?: string | null): Promise<Job> {
      return atomic(db, async (tx) => {
        const row = await seen(tx, id);
        if (row.every_reading === null && row.item_id === null) throw new Problem(400, "This job doesn't go by a reading");
        await noteReading(tx, row, value, dayOrNull(day) ?? today());
        return row;
      }).then((row) => whole(db, row));
    },

    /**
     * The job done. Kept with who did it; each tool's history says it was used for this; supplies come out of
     * what's kept, and those now running low go on the shopping list; the cost can go into spending.
     */
    async done(id: number, input: DoneInput): Promise<DoneResult> {
      if (input.day != null && !dayOrNull(input.day)) throw new Problem(400, 'Pick the day it was done');
      if (input.minutes != null && !(Number.isInteger(input.minutes) && input.minutes >= 0 && input.minutes < 100000)) throw new Problem(400, 'The time it took is whole minutes');
      if (input.cost_cents != null && !(Number.isInteger(input.cost_cents) && input.cost_cents >= 0 && input.cost_cents < 1e11)) throw new Problem(400, 'The cost is an amount, 0 or more');
      const day = dayOrNull(input.day) ?? today();
      const runningLow: string[] = [];
      const checkByHand: string[] = [];
      let doneId = 0;
      let cost: number | null = null;
      let row!: JobRow;
      await atomic(db, async (tx) => {
        row = await seen(tx, id);
        // A bill's usual amount is what it cost, unless another is said.
        cost = input.cost_cents ?? (anchored(row.kind) ? row.amount_cents : null);
        const made = await tx.run('INSERT INTO upkeep_done (job_id, day, done_by, reading, minutes, cost_cents, points, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [id, day, viewer, input.reading ?? null, input.minutes ?? null, cost, row.kind === 'chore' ? row.points : null, clean(input.note, 1000), now()]);
        doneId = made.lastId;
        // Paid or renewed: its date moves on by one round (or, with no round, it's finished with).
        if (anchored(row.kind) && row.first_due) {
          await tx.run('UPDATE upkeep_jobs SET first_due = ? WHERE id = ?', [row.every_n && row.every_unit ? addInterval(row.first_due, row.every_n, row.every_unit) : null, id]);
        }
        if (input.reading != null) await noteReading(tx, row, input.reading, day);
        const when = { day, at: now() };
        for (const tool of await tx.all<{ item_id: number }>('SELECT item_id FROM upkeep_tools WHERE job_id = ?', [id])) {
          await noteHistory(tx, row.owner_id, { item_id: tool.item_id }, { what: 'used', job_id: id, job: row.name, activity: row.activity, ...when });
        }
        for (const s of await tx.all<{ item_id: number; quantity: number | null; unit: string | null }>('SELECT item_id, quantity, unit FROM upkeep_supplies WHERE job_id = ?', [id])) {
          const item = await tx.get<{ name: string; quantity: number | null; unit: string | null; low_at: number | null }>(
            'SELECT name, quantity, unit, low_at FROM items WHERE id = ?', [s.item_id]);
          if (!item) continue;
          const taken = s.quantity !== null ? units.convert(s.quantity, s.unit, item.unit) : null;
          await noteHistory(tx, row.owner_id, { item_id: s.item_id }, { what: 'used', job_id: id, job: row.name, activity: row.activity, note: s.quantity !== null ? `used ${units.amount(s.quantity, s.unit)}` : null, ...when });
          if (item.quantity === null || s.quantity === null) continue;
          if (taken === null) { checkByHand.push(item.name); continue; }
          const left = rounded(Math.max(0, item.quantity - taken), 4);
          await tx.run('UPDATE items SET quantity = ?, updated_at = ? WHERE id = ?', [left, now(), s.item_id]);
          if (item.low_at !== null && left <= item.low_at) runningLow.push(item.name);
        }
      });
      // Outside the job's own change, as each of these keeps its own: the shopping list, and spending.
      const toBuy: string[] = [];
      if (runningLow.length) {
        const shop = kitchen(db, row.owner_id, clock);
        const listed = new Set((await shop.listGrocery()).filter((g) => !g.done).map((g) => labelKey(g.label)));
        for (const name of runningLow) {
          if (listed.has(labelKey(name))) continue;
          await shop.addGrocery({ label: name });
          toBuy.push(name);
        }
      }
      if (input.spend && cost) {
        const entry = await money(db, viewer, clock).addEntry({ label: row.name, cents: cost, day, note: clean(input.note, 300), category_id: input.spend.category_id ?? null });
        await db.run('UPDATE upkeep_done SET money_entry_id = ? WHERE id = ?', [entry.id, doneId]);
      }
      return { job: await whole(db, await seen(db, id)), done: await doneList(db, id), to_buy: toBuy, check_by_hand: checkByHand };
    },

    /** Take back a time it was marked done (its spending entry stays: that is changed in spending). */
    async undo(doneId: number): Promise<Job & { done: DoneRecord[] }> {
      const found = await db.get<{ job_id: number }>('SELECT job_id FROM upkeep_done WHERE id = ?', [doneId]);
      if (!found) throw new Problem(404, 'Not found');
      const row = await seen(db, found.job_id);
      await db.run('DELETE FROM upkeep_done WHERE id = ?', [doneId]);
      // A bill or renewal goes back to the date it was on.
      if (anchored(row.kind) && row.first_due && row.every_n && row.every_unit) {
        await db.run('UPDATE upkeep_jobs SET first_due = ? WHERE id = ?', [addInterval(row.first_due, -row.every_n, row.every_unit), row.id]);
      }
      return getJob(found.job_id);
    },

    /** The jobs due on each day from `start`, for the calendar. Anything late shows on today. */
    async dueBetween(start: string, days: number): Promise<{ day: string; job: Job }[]> {
      const end = addDays(start, days - 1);
      const now = today();
      const out: { day: string; job: Job }[] = [];
      for (const job of await listJobs()) {
        const late = job.due.state === 'overdue' || job.due.state === 'due';
        const on = job.due.next_day !== null && job.due.next_day >= now ? job.due.next_day : late ? now : null;
        if (on && on >= start && on <= end) out.push({ day: on, job });
      }
      return out;
    },

    /**
     * Who has done what this week (Monday to Sunday) and last: the points of the chores each person did, among
     * the chores this person owns or was given.
     */
    async scores(): Promise<{ week_start: string; people: { name: string; this_week: number; last_week: number; done: number }[] }> {
      const day = today();
      const start = addDays(day, -((dayNumber(day) + 3) % 7));
      const rows = await db.all<{ name: string | null; day: string; points: number | null }>(
        `SELECT u.username AS name, d.day, d.points FROM upkeep_done d JOIN upkeep_jobs j ON j.id = d.job_id LEFT JOIN users u ON u.id = d.done_by
         WHERE j.kind = 'chore' AND (j.owner_id = ? OR j.assigned_to = ?) AND d.day >= ? AND d.done_by IS NOT NULL`, [viewer, viewer, addDays(start, -7)]);
      const people = new Map<string, { name: string; this_week: number; last_week: number; done: number }>();
      for (const r of rows) {
        const one = people.get(r.name ?? '?') ?? { name: r.name ?? '?', this_week: 0, last_week: 0, done: 0 };
        if (r.day >= start) { one.this_week += r.points ?? 0; one.done += 1; } else one.last_week += r.points ?? 0;
        people.set(one.name, one);
      }
      return { week_start: start, people: [...people.values()].sort((a, b) => b.this_week - a.this_week || a.name.localeCompare(b.name)) };
    },

    /** What a thing's latest reading is, and the place it's kept, for a job's page. */
    async thingReading(itemId: number): Promise<{ latest: number | null; place: string | null }> {
      const item = await db.get<{ place_id: number | null }>('SELECT place_id FROM items WHERE id = ? AND owner_id = ?', [itemId, viewer]);
      if (!item) throw new Problem(404, 'Not found');
      const v = await db.get<{ v: number | null }>('SELECT MAX(value) AS v FROM readings WHERE item_id = ?', [itemId]);
      return { latest: v?.v ?? null, place: await placePath(db, viewer, item.place_id) };
    },
  };
}

export type Upkeep = ReturnType<typeof upkeep>;
