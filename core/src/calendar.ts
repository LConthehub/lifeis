/**
 * The calendar: one place to see what's on each day.
 *
 * Most of what it shows is kept elsewhere and only gathered here: the week's meals (kitchen.ts), the time
 * spent on projects and the days they're wanted by (projects.ts), what's about to go off in the pantry, and
 * what was watched, read or heard (media.ts). Each of those links back to where it lives, and is changed
 * there. What is typed into the calendar itself is an event: a title on a day (or over several), with a
 * time if it has one.
 *
 * `calendar(db, owner)` is one person's calendar: everything it reads and writes is theirs.
 */
import type { Db, Value } from './db.ts';
import { Problem } from './problem.ts';
import { addDays, clean, dayNumber, dayOrNull, inOrder, stamp, type Clock } from './small.ts';

export type EventInput = {
  title: string;
  /** The day, or the first of several, as 2046-03-05. */
  day: string;
  /** The last day, when it runs over more than one. */
  end_day?: string | null;
  /** The time it starts, as 18:30. Left out: all day. */
  time?: string | null;
  note?: string | null;
  /** A birthday or an anniversary: on this day every year from now on. */
  yearly?: boolean;
};
export type Event = { id: number; title: string; day: string; end_day: string | null; time: string | null; note: string | null; yearly: boolean };
/** One coming round of a date that returns every year. */
export type YearlyDate = { id: number; title: string; day: string; time: string | null; note: string | null; /** How many years since the first. */ years: number };

export type EntryKind = 'event' | 'meal' | 'session' | 'due' | 'use_by' | 'media';
/** One line on one day of the calendar. */
export type Entry = {
  kind: EntryKind;
  day: string;
  /** 18:30, or null for something that has no time. */
  time: string | null;
  title: string;
  /** A few more words: "dinner", "1 h 30 min", "wanted by today". */
  detail: string | null;
  /** The page it lives on, where it's changed. Null for an event, which is changed here. */
  link: string | null;
  /** The event's id, for an event. */
  id: number | null;
};

const KIND_ORDER: EntryKind[] = ['event', 'due', 'meal', 'session', 'media', 'use_by'];
const MEAL_TIME: Record<string, number> = { breakfast: 0, lunch: 1, dinner: 2, snack: 3 };
const leap = (year: number) => (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
/** The day a yearly date falls on in one year. The 29th of February is kept on the 28th in the years without one. */
const inYear = (first: string, year: number) => (first.slice(5) === '02-29' && !leap(year) ? `${year}-02-28` : `${year}${first.slice(4)}`);
const yearsText = (years: number) => (years === 1 ? '1 year' : `${years} years`);
const duration = (minutes: number) => (minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h${minutes % 60 ? ` ${minutes % 60} min` : ''}`);

export function calendar(db: Db, owner: number, clock: Clock = () => new Date()) {
  const now = () => stamp(clock());

  function checked(input: EventInput): Value[] {
    const title = clean(input.title, 200);
    if (!title) throw new Problem(400, 'Say what it is');
    dayNumber(input.day);
    const end = dayOrNull(input.end_day);
    if (end !== null && dayNumber(end) < dayNumber(input.day)) throw new Problem(400, "It can't end before it starts");
    if (end !== null && dayNumber(end) - dayNumber(input.day) > 366) throw new Problem(400, 'An event runs for a year at most');
    const time = clean(input.time, 5);
    if (time !== null && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Problem(400, 'A time is written like 18:30');
    const yearly = input.yearly === true;
    if (yearly && end !== null && end !== input.day) throw new Problem(400, 'Something that comes every year is on one day');
    return [title, input.day, end === input.day ? null : end, time, clean(input.note, 2000), yearly ? 1 : 0];
  }

  type Kept = Omit<Event, 'yearly'> & { yearly: number };
  const COLUMNS = 'id, title, day, end_day, time, note, yearly';
  const asEvent = (row: Kept): Event => ({ ...row, yearly: row.yearly === 1 });

  /** Each time a yearly date comes round from `start` to `end`, soonest first. */
  async function yearlyIn(start: string, end: string): Promise<YearlyDate[]> {
    const found: YearlyDate[] = [];
    for (const e of await db.all<Kept>(`SELECT ${COLUMNS} FROM events WHERE owner_id = ? AND yearly = 1 AND day <= ? ORDER BY id`, [owner, end])) {
      const first = Number(e.day.slice(0, 4));
      for (let year = Math.max(first, Number(start.slice(0, 4))); year <= Number(end.slice(0, 4)); year += 1) {
        const day = year === first ? e.day : inYear(e.day, year);
        if (day >= start && day <= end) found.push({ id: e.id, title: e.title, day, time: e.time, note: e.note, years: year - first });
      }
    }
    return found.sort((a, b) => inOrder(a.day, b.day));
  }

  const event = async (id: number): Promise<Event> => {
    const row = await db.get<Kept>(`SELECT ${COLUMNS} FROM events WHERE id = ? AND owner_id = ?`, [id, owner]);
    if (!row) throw new Problem(404, 'Not found');
    return asEvent(row);
  };

  return {
    /** Everything on each of `days` days from `start`, in the order the day goes. */
    async between(start: string, days = 7): Promise<Entry[]> {
      if (!(Number.isInteger(days) && days >= 1 && days <= 62)) throw new Problem(400, '1 to 62 days');
      const end = addDays(start, days - 1);
      const entries: Entry[] = [];

      for (const e of await db.all<Kept>(
        `SELECT ${COLUMNS} FROM events WHERE owner_id = ? AND yearly = 0 AND day <= ? AND COALESCE(end_day, day) >= ?`, [owner, end, start])) {
        // An event over several days is on each of them; its time belongs to the first.
        const last = e.end_day ?? e.day;
        for (let day = e.day < start ? start : e.day; day <= last && day <= end; day = addDays(day, 1)) {
          entries.push({ kind: 'event', day, time: day === e.day ? e.time : null, title: e.title, detail: e.note, link: null, id: e.id });
        }
      }
      for (const y of await yearlyIn(start, end)) {
        entries.push({ kind: 'event', day: y.day, time: y.time, title: y.title, detail: [y.years > 0 ? yearsText(y.years) : null, y.note].filter(Boolean).join(' · ') || null, link: null, id: y.id });
      }
      for (const m of await db.all<{ day: string; meal: string; title: string | null; recipe_id: number | null; recipe: string | null }>(
        `SELECT m.day, m.meal, m.title, m.recipe_id, r.title AS recipe FROM meal_plan m LEFT JOIN recipes r ON r.id = m.recipe_id
         WHERE m.owner_id = ? AND m.day >= ? AND m.day <= ? ORDER BY m.id`, [owner, start, end])) {
        entries.push({ kind: 'meal', day: m.day, time: null, title: m.recipe ?? m.title ?? 'A meal', detail: m.meal, link: m.recipe_id ? `/recipes/${m.recipe_id}` : '/week', id: null });
      }
      for (const s of await db.all<{ day: string; minutes: number | null; note: string | null; project_id: number; project: string }>(
        `SELECT s.day, s.minutes, s.note, s.project_id, p.name AS project FROM project_sessions s JOIN projects p ON p.id = s.project_id
         WHERE p.owner_id = ? AND s.day >= ? AND s.day <= ? ORDER BY s.id`, [owner, start, end])) {
        entries.push({ kind: 'session', day: s.day, time: null, title: s.project, detail: [s.minutes !== null ? duration(s.minutes) : null, s.note].filter(Boolean).join(' · ') || null,
          link: `/projects/${s.project_id}`, id: null });
      }
      for (const p of await db.all<{ id: number; name: string; due_on: string }>(
        `SELECT id, name, due_on FROM projects WHERE owner_id = ? AND due_on >= ? AND due_on <= ? AND status NOT IN ('done', 'dropped') ORDER BY id`, [owner, start, end])) {
        entries.push({ kind: 'due', day: p.due_on, time: null, title: p.name, detail: 'wanted by today', link: `/projects/${p.id}`, id: null });
      }
      for (const p of await db.all<{ name: string; expires_on: string }>(
        `SELECT i.name, p.expires_on FROM pantry p JOIN ingredients i ON i.id = p.ingredient_id
         WHERE p.owner_id = ? AND p.expires_on >= ? AND p.expires_on <= ? ORDER BY i.name COLLATE NOCASE`, [owner, start, end])) {
        entries.push({ kind: 'use_by', day: p.expires_on, time: null, title: p.name, detail: 'use by today', link: '/pantry', id: null });
      }
      for (const l of await db.all<{ day: string; note: string | null; media_id: number; title: string; type: string; project: string | null }>(
        `SELECT l.day, l.note, l.media_id, m.title, m.type, p.name AS project FROM media_log l JOIN media m ON m.id = l.media_id
         LEFT JOIN project_sessions s ON s.id = l.session_id LEFT JOIN projects p ON p.id = s.project_id
         WHERE m.owner_id = ? AND l.day >= ? AND l.day <= ? ORDER BY l.id`, [owner, start, end])) {
        entries.push({ kind: 'media', day: l.day, time: null, title: l.title, detail: [l.project ? `while working on ${l.project}` : null, l.note].filter(Boolean).join(' · ') || null,
          link: `/media/${l.media_id}`, id: null });
      }

      const mealOrder = (e: Entry) => (e.kind === 'meal' ? (MEAL_TIME[e.detail ?? ''] ?? 9) : 0);
      // Sorting keeps the order things were read in when nothing else tells them apart.
      return entries.sort((a, b) =>
        inOrder(a.day, b.day)
        || inOrder(a.time ?? '99', b.time ?? '99')
        || KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind)
        || mealOrder(a) - mealOrder(b));
    },

    getEvent: event,

    /** The birthdays, anniversaries and other yearly dates in the `days` days from `start`. */
    async yearly(start: string, days = 30): Promise<YearlyDate[]> {
      if (!(Number.isInteger(days) && days >= 1 && days <= 366)) throw new Problem(400, '1 to 366 days');
      return yearlyIn(start, addDays(start, days - 1));
    },

    async createEvent(input: EventInput): Promise<Event> {
      const made = await db.run('INSERT INTO events (owner_id, title, day, end_day, time, note, yearly, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [owner, ...checked(input), now(), now()]);
      return event(made.lastId);
    },

    async updateEvent(id: number, input: EventInput): Promise<Event> {
      const values = checked(input);
      await event(id);
      await db.run('UPDATE events SET title = ?, day = ?, end_day = ?, time = ?, note = ?, yearly = ?, updated_at = ? WHERE id = ? AND owner_id = ?', [...values, now(), id, owner]);
      return event(id);
    },

    async deleteEvent(id: number): Promise<void> {
      await db.run('DELETE FROM events WHERE id = ? AND owner_id = ?', [id, owner]);
    },
  };
}

export type Calendar = ReturnType<typeof calendar>;
