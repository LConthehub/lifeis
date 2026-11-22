/**
 * The calendar, for the calendar on your phone.
 *
 * A calendar app can't sign in to Life Is, so it is given a link instead: an address with a long random
 * part that only you know, which answers with the calendar in the form every calendar app reads
 * (iCalendar, a ".ics" file). The app fetches it again every so often and shows what it finds.
 *
 * It only shows. Nothing can be changed through the link, and it carries only the kinds of thing you ticked.
 * It is off until you make a link; making a new one stops the old one working, and turning it off forgets it.
 *
 * `calendarFeed(db, owner)` is one person's link. `feedFor(db, token)` is what the link answers with.
 */
import { calendar, type Entry, type EntryKind } from './calendar.ts';
import type { Db } from './db.ts';
import { Problem } from './problem.ts';
import { addDays, stamp, todayOf, type Clock } from './small.ts';

/** What a link can carry, in the order it's offered. */
export const FEED_KINDS: { key: EntryKind; label: string; usual: boolean }[] = [
  { key: 'event', label: 'Dates and events, birthdays included', usual: true },
  { key: 'plan', label: 'Plans', usual: true },
  { key: 'meal', label: "The week's meals", usual: true },
  { key: 'due', label: 'Projects wanted by a day', usual: true },
  { key: 'use_by', label: 'Food to use up', usual: false },
  { key: 'session', label: 'Time spent on projects', usual: false },
  { key: 'media', label: 'What you watched, read and heard', usual: false },
];
const KNOWN = new Set<string>(FEED_KINDS.map((k) => k.key));

/** How far back and ahead the link reaches from today. */
const DAYS_BACK = 31;
const DAYS_AHEAD = 365;

export type FeedStatus = {
  on: boolean;
  /** The random part of the address. Null while off. */
  token: string | null;
  kinds: EntryKind[];
  choices: typeof FEED_KINDS;
  /** When a calendar app last fetched it; null if none has yet. */
  read_at: string | null;
  days_back: number;
  days_ahead: number;
};

const TOKEN = /^[0-9a-f]{64}$/;
function newToken(): string {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function checkedKinds(kinds: string[] | null | undefined): EntryKind[] {
  if (kinds === null || kinds === undefined) return FEED_KINDS.filter((k) => k.usual).map((k) => k.key);
  if (!kinds.every((k) => KNOWN.has(k))) throw new Problem(400, "That isn't something the calendar holds");
  const chosen = FEED_KINDS.map((k) => k.key).filter((k) => kinds.includes(k));
  if (chosen.length === 0) throw new Problem(400, 'Check at least one thing to show');
  return chosen;
}

type Kept = { token: string; kinds: string; read_at: string | null };

export function calendarFeed(db: Db, owner: number, clock: Clock = () => new Date()) {
  const kept = () => db.get<Kept>('SELECT token, kinds, read_at FROM calendar_feeds WHERE owner_id = ?', [owner]);
  async function status(): Promise<FeedStatus> {
    const row = await kept();
    return {
      on: Boolean(row), token: row?.token ?? null, kinds: row ? (JSON.parse(row.kinds) as EntryKind[]) : checkedKinds(null),
      choices: FEED_KINDS, read_at: row?.read_at ?? null, days_back: DAYS_BACK, days_ahead: DAYS_AHEAD,
    };
  }
  return {
    status,

    /** Makes the link, or changes what an existing one carries. The address stays the same once made. */
    async turnOn(kinds?: string[] | null): Promise<FeedStatus> {
      const chosen = JSON.stringify(checkedKinds(kinds));
      if (await kept()) await db.run('UPDATE calendar_feeds SET kinds = ? WHERE owner_id = ?', [chosen, owner]);
      else await db.run('INSERT INTO calendar_feeds (owner_id, token, kinds, created_at) VALUES (?, ?, ?, ?)', [owner, newToken(), chosen, stamp(clock())]);
      return status();
    },

    /** A new address. The old one stops working at once, wherever it was copied to. */
    async renew(): Promise<FeedStatus> {
      if (!(await kept())) throw new Problem(404, "There's no link to replace");
      await db.run('UPDATE calendar_feeds SET token = ?, read_at = NULL WHERE owner_id = ?', [newToken(), owner]);
      return status();
    },

    async turnOff(): Promise<FeedStatus> {
      await db.run('DELETE FROM calendar_feeds WHERE owner_id = ?', [owner]);
      return status();
    },
  };
}

export type CalendarFeed = ReturnType<typeof calendarFeed>;

// ---------- the file a calendar app reads ----------

/** One thing on the calendar, as the file says it. */
export type FeedEvent = {
  uid: string;
  title: string;
  /** The first day, as 2046-03-05. */
  day: string;
  /** The last day, when it runs over several. */
  end_day?: string | null;
  /** 18:30, for something at a time (an hour is allowed for it). Left out: all day. */
  time?: string | null;
  note?: string | null;
  /** The page in Life Is it lives on. */
  url?: string | null;
  /** Comes round on this day every year. */
  yearly?: boolean;
};

const compact = (day: string) => day.replaceAll('-', '');
const escaped = (text: string) => text.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const encoder = new TextEncoder();

/** A line no longer than a calendar file allows (75 bytes), carried on to the next with a leading space. */
function folded(line: string): string {
  const parts: string[] = [];
  let part = '';
  let size = 0;
  for (const letter of line) {
    const bytes = encoder.encode(letter).length;
    if (size + bytes > (parts.length === 0 ? 75 : 74)) {
      parts.push(part);
      part = '';
      size = 0;
    }
    part += letter;
    size += bytes;
  }
  parts.push(part);
  return parts.join('\r\n ');
}

/** The whole file. Times are "floating": 18:30 is 18:30 wherever the phone is, as it is in Life Is. */
export function calendarFile(name: string, events: FeedEvent[], at: Date): string {
  const made = at.toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Life Is//Calendar//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    `X-WR-CALNAME:${escaped(name)}`, `NAME:${escaped(name)}`, 'REFRESH-INTERVAL;VALUE=DURATION:PT1H', 'X-PUBLISHED-TTL:PT1H',
  ];
  for (const e of events) {
    const last = e.end_day && e.end_day > e.day ? e.end_day : e.day;
    const timed = Boolean(e.time) && last === e.day;
    lines.push('BEGIN:VEVENT', `UID:${e.uid}`, `DTSTAMP:${made}`);
    if (timed) lines.push(`DTSTART:${compact(e.day)}T${e.time!.replace(':', '')}00`, 'DURATION:PT1H');
    // A whole day ends at the start of the day after.
    else lines.push(`DTSTART;VALUE=DATE:${compact(e.day)}`, `DTEND;VALUE=DATE:${compact(addDays(last, 1))}`);
    if (e.yearly) lines.push('RRULE:FREQ=YEARLY');
    lines.push(`SUMMARY:${escaped(e.title)}`);
    // Over several days the time can't be shown on the days themselves, so it is said in words.
    const words = [e.time && !timed ? `Starts at ${e.time}` : null, e.note || null].filter(Boolean).join('\n');
    if (words) lines.push(`DESCRIPTION:${escaped(words)}`);
    if (e.url) lines.push(`URL:${e.url}`);
    lines.push('TRANSP:TRANSPARENT', 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(folded).join('\r\n') + '\r\n';
}

const MEAL_WORD: Record<string, string> = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snack: 'Snack' };
const titleOf = (e: Entry): string =>
  e.kind === 'meal' ? `${MEAL_WORD[e.detail ?? ''] ?? 'Meal'}: ${e.title}`
    : e.kind === 'due' ? `Wanted by today: ${e.title}`
      : e.kind === 'use_by' ? `Use up: ${e.title}`
        : e.title;
const noteOf = (e: Entry): string | null => (e.kind === 'session' || e.kind === 'media' ? e.detail : null);
const leap = (year: number) => (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;

/**
 * What the link with this random part answers with, or null when there is no such link. `base` is the
 * address Life Is was reached at ("https://life.example.org"), so each thing can lead back to its page.
 */
export async function feedFor(db: Db, token: string, clock: Clock = () => new Date(), base = ''): Promise<string | null> {
  if (!TOKEN.test(token)) return null;
  const row = await db.get<{ owner_id: number; kinds: string }>('SELECT owner_id, kinds FROM calendar_feeds WHERE token = ?', [token]);
  if (!row) return null;
  const owner = row.owner_id;
  const kinds = new Set(JSON.parse(row.kinds) as EntryKind[]);
  const today = todayOf(clock);
  const start = addDays(today, -DAYS_BACK);
  const end = addDays(today, DAYS_AHEAD);
  const page = (link: string | null) => (base && link ? base + link : null);
  const events: FeedEvent[] = [];

  if (kinds.has('event')) {
    for (const e of await db.all<{ id: number; title: string; day: string; end_day: string | null; time: string | null; note: string | null; yearly: number }>(
      `SELECT id, title, day, end_day, time, note, yearly FROM events
       WHERE owner_id = ? AND day <= ? AND (yearly = 1 OR COALESCE(end_day, day) >= ?) ORDER BY day, id`, [owner, end, start])) {
      const one = { title: e.title, time: e.time, note: e.note, url: page('/calendar') };
      if (e.yearly !== 1) events.push({ ...one, uid: `event-${e.id}@lifeis`, day: e.day, end_day: e.end_day });
      else if (e.day.slice(5) !== '02-29') events.push({ ...one, uid: `event-${e.id}@lifeis`, day: e.day, yearly: true });
      else {
        // The 29th of February is kept on the 28th in the years without one, as Life Is shows it.
        for (let year = Math.max(Number(e.day.slice(0, 4)), Number(start.slice(0, 4))); year <= Number(end.slice(0, 4)); year += 1) {
          events.push({ ...one, uid: `event-${e.id}-${year}@lifeis`, day: `${year}-02-${leap(year) ? '29' : '28'}` });
        }
      }
    }
  }
  if (kinds.has('plan')) {
    for (const p of await db.all<{ id: number; name: string; start_day: string; end_day: string; note: string | null }>(
      'SELECT id, name, start_day, end_day, note FROM plans WHERE owner_id = ? AND start_day <= ? AND end_day >= ? ORDER BY start_day, id', [owner, end, start])) {
      events.push({ uid: `plan-${p.id}@lifeis`, title: p.name, day: p.start_day, end_day: p.end_day, note: p.note, url: page(`/plans/${p.id}`) });
    }
  }
  // Everything else is on one day each, and is gathered the way the calendar page gathers it.
  const others = (['meal', 'due', 'use_by', 'session', 'media'] as EntryKind[]).filter((k) => kinds.has(k));
  if (others.length > 0) {
    const dates = calendar(db, owner, clock);
    const seen = new Map<string, number>();
    for (let from = start; from <= end; from = addDays(from, 62)) {
      const days = Math.min(62, Math.round((Date.parse(end) - Date.parse(from)) / 86_400_000) + 1);
      for (const e of await dates.between(from, days)) {
        if (!others.includes(e.kind)) continue;
        const nth = (seen.get(`${e.kind}-${e.day}`) ?? 0) + 1;
        seen.set(`${e.kind}-${e.day}`, nth);
        events.push({ uid: `${e.kind}-${e.day}-${nth}@lifeis`, title: titleOf(e), day: e.day, note: noteOf(e), url: page(e.link) });
      }
    }
  }
  await db.run('UPDATE calendar_feeds SET read_at = ? WHERE token = ?', [stamp(clock()), token]);
  return calendarFile('Life Is', events, clock());
}
