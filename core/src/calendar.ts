/**
 * The calendar: one place to see what's on each day.
 *
 * Most of what it shows is kept elsewhere and only gathered here: the week's meals (kitchen.ts), the time
 * spent on projects and the days they're wanted by (projects.ts), what's about to go off in the pantry, and
 * what was watched, read or heard (media.ts), and the times read from other calendars a person follows
 * (follow.ts), which can't be changed from here at all. Each of the rest links back to where it lives, and is changed
 * there. What is typed into the calendar itself is an event: a title on a day (or over several), with a
 * time if it has one.
 *
 * `calendar(db, owner)` is one person's calendar: everything it reads and writes is theirs.
 */
import { upkeep } from './upkeep.ts';
import type { Db, Value } from './db.ts';
import { attachTags, idsWithTag, tagsOnto, unlink, type TagRef } from './tags.ts';
import { PAUSED_CALENDARS } from './paused.ts';
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
export type Event = { id: number; title: string; day: string; end_day: string | null; time: string | null; note: string | null; yearly: boolean; tag_list: TagRef[] };
/** One coming round of a date that returns every year. */
export type YearlyDate = { id: number; title: string; day: string; time: string | null; note: string | null; /** How many years since the first. */ years: number };

export type EntryKind = 'plan' | 'event' | 'outside' | 'meal' | 'session' | 'due' | 'upkeep' | 'use_by' | 'media';
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
  /** For an event: its tags. */
  tag_list?: TagRef[];
};

const KIND_ORDER: EntryKind[] = ['plan', 'event', 'outside', 'due', 'upkeep', 'meal', 'session', 'media', 'use_by'];
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

  type Kept = Omit<Event, 'yearly' | 'tag_list'> & { yearly: number };
  const COLUMNS = 'id, title, day, end_day, time, note, yearly';
  const asEvent = (row: Kept): Event => ({ ...row, yearly: row.yearly === 1, tag_list: [] });

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
    if (!row) throw new Problem(404, "That event isn't here anymore. It may have been deleted.");
    return (await attachTags(db, owner, 'event', [asEvent(row)]))[0]!;
  };

  return {
    /** Everything on each of `days` days from `start`, in the order the day goes. */
    async between(start: string, days = 7, tag?: number | null): Promise<Entry[]> {
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
      // A plan is on each of its days, and leads to its own page.
      for (const p of await db.all<{ id: number; name: string; start_day: string; end_day: string }>(
        'SELECT id, name, start_day, end_day FROM plans WHERE owner_id = ? AND start_day <= ? AND end_day >= ? ORDER BY start_day, id', [owner, end, start])) {
        for (let day = p.start_day < start ? start : p.start_day; day <= p.end_day && day <= end; day = addDays(day, 1)) {
          const nth = dayNumber(day) - dayNumber(p.start_day) + 1;
          entries.push({ kind: 'plan', day, time: null, title: p.name, detail: p.end_day !== p.start_day ? `day ${nth} of ${dayNumber(p.end_day) - dayNumber(p.start_day) + 1}` : null, link: `/plans/${p.id}`, id: null });
        }
      }
      // Other calendars a person follows. One followed "busy only" has no titles: its times go under its own name.
      for (const o of await db.all<{ day: string; end_day: string | null; time: string | null; end_time: string | null; title: string | null; name: string; show: string }>(
        `SELECT e.day, e.end_day, e.time, e.end_time, e.title, f.name, f.show FROM followed_events e JOIN followed_calendars f ON f.id = e.calendar_id
         WHERE f.owner_id = ? AND e.day <= ? AND COALESCE(e.end_day, e.day) >= ? AND NOT ${PAUSED_CALENDARS} ORDER BY e.day, e.time, e.id`, [owner, end, start, owner])) {
        const last = o.end_day ?? o.day;
        for (let day = o.day < start ? start : o.day; day <= last && day <= end; day = addDays(day, 1)) {
          const until = day === last && o.end_time ? `until ${o.end_time}` : null;
          const named = o.show === 'titles' && o.title ? o.title : o.name;
          entries.push({ kind: 'outside', day, time: day === o.day ? o.time : null, title: named, detail: [until, named !== o.name ? o.name : null].filter(Boolean).join(' · ') || null, link: null, id: null });
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

      // Upkeep due: on the day it comes round, and anything late on today.
      for (const { day, job } of await upkeep(db, owner, clock).dueBetween(start, days)) {
        const late = job.due.state === 'overdue' ? (job.due.days_left !== null && job.due.days_left < 0 ? `late by ${-job.due.days_left} day${job.due.days_left === -1 ? '' : 's'}` : 'past its reading') : null;
        const who = job.assigned_to && job.assigned_to.id !== owner ? job.assigned_to.name : !job.mine ? `for ${job.owner}` : null;
        entries.push({ kind: 'upkeep', day, time: null, title: job.name, detail: [late ?? (job.item ? job.item.name : null), who].filter(Boolean).join(' · ') || null, link: `/things/upkeep/${job.id}`, id: null });
      }

      const mealOrder = (e: Entry) => (e.kind === 'meal' ? (MEAL_TIME[e.detail ?? ''] ?? 9) : 0);
      // Sorting keeps the order things were read in when nothing else tells them apart.
      const ordered = entries.sort((a, b) =>
        inOrder(a.day, b.day)
        || inOrder(a.time ?? '99', b.time ?? '99')
        || KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind)
        || mealOrder(a) - mealOrder(b));
      // Dates carry tags. Asking for a tag leaves the dates that have it (or a tag inside it) and nothing else.
      const dates = ordered.filter((e) => e.kind === 'event' && e.id !== null);
      const on = await tagsOnto(db, owner, 'event', [...new Set(dates.map((e) => e.id!))]);
      for (const e of dates) e.tag_list = on.get(e.id!) ?? [];
      if (tag == null) return ordered;
      const have = await idsWithTag(db, owner, 'event', tag);
      return dates.filter((e) => have.has(e.id!));
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
      await unlink(db, 'event', id);
    },
  };
}

export type Calendar = ReturnType<typeof calendar>;
