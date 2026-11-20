/**
 * Other calendars, shown on Life Is's own: a work calendar, a shared family one, anything that has a link.
 * An outside service, and so off until a person adds a link.
 *
 * A calendar is followed "busy only" unless the person asks for more. Busy only keeps the times and nothing
 * else: what each thing is called, where it is and its notes are dropped as the calendar is read, and are never
 * stored. On the calendar those times show under the name the person gave the calendar ("Work").
 *
 * The link is the key to that calendar, so it is stored locked, and never sent back to the page. Life Is only
 * ever reads from it, about once an hour.
 *
 * `fetcher` asks a web address for its answer and `sealer` locks the link; both are handed in because they
 * differ by where Life Is runs.
 */
import type { Fetcher, Sealer } from './connections.ts';
import { atomic, type Db } from './db.ts';
import { Problem } from './problem.ts';
import { addDays, clean, stamp, todayOf, type Clock } from './small.ts';

export const FOLLOW_SERVICE = {
  name: 'Other calendars',
  sends: 'Life Is asks each calendar link you give for its calendar, about once an hour, and sends nothing but that request. The link is stored locked. ' +
    'A calendar followed "busy only" keeps just the times: what each thing is called, where it is and its notes are thrown away as it is read, and never stored.',
};

export const SHOWS = ['busy', 'titles'] as const;
export type Show = (typeof SHOWS)[number];
export type Followed = {
  id: number;
  name: string;
  show: Show;
  /** The time zone its times are shown in: where the person was when they added it. */
  zone: string;
  /** How many things it holds in the days Life Is looks at. */
  events: number;
  fetched_at: string | null;
  /** Why the last try failed, in words; null when it worked. What was read before is kept meanwhile. */
  problem: string | null;
};
export type FollowInput = { name: string; url: string; show?: string | null; zone?: string | null };

/** One thing read from a calendar file, in the days asked for. */
export type ReadEvent = { day: string; end_day: string | null; time: string | null; end_time: string | null; title: string | null };

const DAYS_BACK = 31;
const DAYS_AHEAD = 365;
const MAX_BYTES = 5_000_000;
const MAX_EVENTS = 5000;
const STALE_MINUTES = 60;
const DAY = 86_400_000;

// ---------- time zones ----------

const formats = new Map<string, Intl.DateTimeFormat>();
function formatFor(zone: string): Intl.DateTimeFormat | null {
  if (!formats.has(zone)) {
    try {
      formats.set(zone, new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    } catch {
      return null;
    }
  }
  return formats.get(zone)!;
}
/** The clock on the wall in `zone` at a moment, as if that clock were universal time. */
function wallOf(moment: number, zone: string): number {
  const part: Record<string, number> = {};
  for (const p of formatFor(zone)!.formatToParts(new Date(moment))) if (p.type !== 'literal') part[p.type] = Number(p.value);
  return Date.UTC(part.year!, part.month! - 1, part.day!, part.hour!, part.minute!, part.second!);
}
/** The moment the clock on the wall in `zone` says this. */
function momentOf(wall: number, zone: string): number {
  let guess = wall;
  for (let i = 0; i < 2; i += 1) guess = wall - (wallOf(guess, zone) - guess);
  return guess;
}
function checkedZone(zone: string | null | undefined): string {
  const tidy = (zone ?? '').trim() || 'UTC';
  if (tidy.length > 64 || !formatFor(tidy)) throw new Problem(400, "That time zone isn't one Life Is knows");
  return tidy;
}

// ---------- reading a calendar file ----------

type Prop = { name: string; params: Record<string, string>; value: string };
function propOf(line: string): Prop | null {
  const m = /^([A-Za-z0-9-]+)((?:;[^=;:]+=(?:"[^"]*"|[^;:]*))*):(.*)$/s.exec(line);
  if (!m) return null;
  const params: Record<string, string> = {};
  for (const p of m[2]!.matchAll(/;([^=;:]+)=("[^"]*"|[^;:]*)/g)) params[p[1]!.toUpperCase()] = p[2]!.replace(/^"|"$/g, '');
  return { name: m[1]!.toUpperCase(), params, value: m[3]! };
}
const unescaped = (text: string) => text.replace(/\\([nN,;\\])/g, (_, c: string) => (c === 'n' || c === 'N' ? ' ' : c));

/** A day or a time as the file writes it. `wall` is the clock on the wall, as if universal time. */
type When = { wall: number; allDay: boolean; utc: boolean; zone: string | null };
function whenOf(prop: Prop): When | null {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(prop.value.trim());
  if (!m) return null;
  const wall = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] ?? 0), Number(m[5] ?? 0), Number(m[6] ?? 0));
  if (Number.isNaN(wall)) return null;
  return { wall, allDay: m[4] === undefined, utc: m[7] === 'Z', zone: prop.params.TZID ?? null };
}
function lengthOf(text: string): number | null {
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(text.trim());
  if (!m) return null;
  const ms = ((Number(m[2] ?? 0) * 7 + Number(m[3] ?? 0)) * 24 * 3600 + Number(m[4] ?? 0) * 3600 + Number(m[5] ?? 0) * 60 + Number(m[6] ?? 0)) * 1000;
  return m[1] === '-' ? null : ms;
}

const WEEKDAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
/** Each time a repeating thing starts, on its own wall clock, up to `until` (and never more than a few thousand). */
function startsOf(first: number, rule: string | null, until: number): number[] {
  if (!rule) return [first];
  const part: Record<string, string> = {};
  for (const piece of rule.split(';')) { const [k, v] = piece.split('='); if (k && v) part[k.toUpperCase()] = v.toUpperCase(); }
  const every = Math.max(1, Number(part.INTERVAL ?? 1) || 1);
  const count = part.COUNT ? Number(part.COUNT) : Infinity;
  const endRule = part.UNTIL ? whenOf({ name: 'UNTIL', params: {}, value: part.UNTIL }) : null;
  const last = Math.min(until, endRule ? endRule.wall + (endRule.allDay ? DAY - 1 : 0) : Infinity);
  const found: number[] = [];
  const add = (at: number) => { if (at >= first && at <= last && found.length < count) found.push(at); };
  const start = new Date(first);
  const timeOfDay = first % DAY;
  const days = (part.BYDAY ?? '').split(',').map((d) => WEEKDAYS.indexOf(d)).filter((d) => d >= 0);
  for (let n = 0; n < 4000 && found.length < count; n += 1) {
    let at: number;
    if (part.FREQ === 'DAILY') at = first + n * every * DAY;
    else if (part.FREQ === 'WEEKLY' && days.length > 0) {
      // Day by day from the Monday of the first week, keeping the named weekdays of every `every`th week.
      const monday = first - timeOfDay - ((start.getUTCDay() + 6) % 7) * DAY;
      at = monday + n * DAY + timeOfDay;
      if (at > last) break;
      if (Math.floor(n / 7) % every !== 0 || !days.includes(new Date(at).getUTCDay())) continue;
    } else if (part.FREQ === 'WEEKLY') at = first + n * every * 7 * DAY;
    else if (part.FREQ === 'MONTHLY' || part.FREQ === 'YEARLY') {
      const months = part.FREQ === 'YEARLY' ? n * every * 12 : n * every;
      const d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + months, start.getUTCDate()) + timeOfDay);
      // A month without that day (the 31st, or the 29th of February) is passed over.
      if (d.getUTCDate() !== start.getUTCDate()) { if (d.getTime() > last + 31 * DAY) break; continue; }
      at = d.getTime();
    } else return [first]; // a kind of repeating Life Is doesn't follow: shown the once
    if (at > last) break;
    add(at);
  }
  return found;
}

const dayOf = (wall: number) => new Date(wall).toISOString().slice(0, 10);
const timeOf = (wall: number) => new Date(wall).toISOString().slice(11, 16);

/**
 * What a calendar file holds from `from` to `to`, with every time said on the clock in `zone`.
 * Cancelled things are left out. With `titles` false, what each thing is called is never read.
 */
export function readCalendar(text: string, zone: string, from: string, to: string, titles: boolean): ReadEvent[] {
  if (!/BEGIN:VCALENDAR/i.test(text)) throw new Problem(400, "That address answered, but not with a calendar");
  const here = checkedZone(zone);
  type Raw = { uid: string; start: When; end: When | null; length: number | null; rule: string | null; skip: number[]; title: string | null; instead: number | null };
  const raws: Raw[] = [];
  let depth = 0;
  let raw: (Partial<Raw> & { skip: number[]; cancelled?: boolean }) | null = null;
  for (const line of text.replace(/\r?\n[ \t]/g, '').split(/\r?\n/)) {
    const prop = propOf(line);
    if (!prop) continue;
    if (prop.name === 'BEGIN') {
      if (prop.value.toUpperCase() === 'VEVENT' && raw === null) raw = { skip: [] };
      else if (raw) depth += 1;
    } else if (prop.name === 'END') {
      if (raw && depth > 0) depth -= 1;
      else if (raw && prop.value.toUpperCase() === 'VEVENT') {
        if (raw.start && !raw.cancelled) raws.push({ uid: raw.uid ?? '', start: raw.start, end: raw.end ?? null, length: raw.length ?? null, rule: raw.rule ?? null, skip: raw.skip, title: raw.title ?? null, instead: raw.instead ?? null });
        raw = null;
      }
    } else if (raw && depth === 0) {
      if (prop.name === 'DTSTART') raw.start = whenOf(prop) ?? undefined;
      else if (prop.name === 'DTEND') raw.end = whenOf(prop);
      else if (prop.name === 'DURATION') raw.length = lengthOf(prop.value);
      else if (prop.name === 'RRULE') raw.rule = prop.value;
      else if (prop.name === 'UID') raw.uid = prop.value;
      else if (prop.name === 'STATUS') raw.cancelled = prop.value.trim().toUpperCase() === 'CANCELLED';
      else if (prop.name === 'EXDATE') for (const v of prop.value.split(',')) { const w = whenOf({ ...prop, value: v }); if (w) raw.skip.push(w.wall); }
      else if (prop.name === 'RECURRENCE-ID') raw.instead = whenOf(prop)?.wall ?? null;
      else if (prop.name === 'SUMMARY' && titles) raw.title = clean(unescaped(prop.value), 200);
    }
  }
  // One time of a repeating thing that was moved or changed comes as its own entry, and replaces the usual one.
  const moved = new Set(raws.filter((r) => r.instead !== null).map((r) => `${r.uid}|${r.instead}`));

  /** A wall-clock time in the file's own terms, as the wall clock where the person is. */
  const local = (wall: number, when: When): number => {
    if (when.allDay) return wall;
    if (when.utc) return wallOf(wall, here);
    if (when.zone && when.zone !== here && formatFor(when.zone)) return wallOf(momentOf(wall, when.zone), here);
    return wall; // no zone given, or one Life Is doesn't know: the time as written
  };
  const first = Date.parse(`${from}T00:00:00Z`);
  const lastDay = Date.parse(`${to}T23:59:59Z`);
  const found: ReadEvent[] = [];
  for (const r of raws) {
    const length = r.end ? Math.max(0, r.end.wall - r.start.wall) : r.length ?? (r.start.allDay ? DAY : 0);
    for (const at of startsOf(r.start.wall, r.instead === null ? r.rule : null, lastDay + 2 * DAY)) {
      if (r.instead === null && (r.skip.includes(at) || (r.rule && moved.has(`${r.uid}|${at}`)))) continue;
      const begins = local(at, r.start);
      // A whole day ends at the start of the day after; a time that runs to midnight ends on its own day.
      const ends = local(at + length, r.start) - (r.start.allDay || (length > 0 && (local(at + length, r.start) % DAY === 0)) ? 1 : 0);
      if (ends < first || begins > lastDay) continue;
      const [day, endDay] = [dayOf(begins), dayOf(Math.max(begins, ends))];
      found.push({
        day, end_day: endDay !== day ? endDay : null,
        time: r.start.allDay ? null : timeOf(begins),
        end_time: r.start.allDay || length === 0 || (ends + 1) % DAY === 0 ? null : timeOf(ends),
        title: titles ? r.title : null,
      });
      if (found.length >= MAX_EVENTS) return found;
    }
  }
  return found.sort((a, b) => (a.day + (a.time ?? '')).localeCompare(b.day + (b.time ?? '')));
}

// ---------- the calendars a person follows ----------

/** The address of a calendar link, tidied. A "webcal:" link is the same thing over https. */
function linkOf(given: string): string {
  let url: URL;
  try {
    url = new URL(given.trim().replace(/^webcals?:/i, 'https:'));
  } catch {
    throw new Problem(400, "That isn't a calendar link. It starts with https:// or webcal://");
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Problem(400, 'A calendar link starts with https:// or webcal://');
  if (url.username || url.password) throw new Problem(400, 'Leave any name and password out of the link');
  return url.href;
}

type Tools = { fetcher: Fetcher; sealer: Sealer };
type Row = { id: number; owner_id: number; name: string; url: string; show: Show; zone: string; fetched_at: string | null; problem: string | null };

async function fetched(tools: Tools, url: string, zone: string, show: Show, today: string): Promise<ReadEvent[]> {
  let text: string;
  try {
    const answer = await tools.fetcher(url, { Accept: 'text/calendar, text/plain;q=0.8, */*;q=0.5' });
    if (answer.status === 404 || answer.status === 410) throw new Problem(400, "There's no calendar at that link any more. If the link was replaced, give the new one.");
    if (answer.status !== 200) throw new Problem(400, `The calendar's server answered with an error (${answer.status})`);
    const bytes = await answer.bytes();
    if (bytes.length > MAX_BYTES) throw new Problem(400, 'That calendar is too large to follow');
    text = new TextDecoder().decode(bytes);
  } catch (problem) {
    if (problem instanceof Problem) throw problem;
    throw new Problem(400, "Couldn't reach that link. If the calendar is on the same computer as Life Is, and Life Is runs in Docker, use http://host.docker.internal and its port instead of localhost.");
  }
  return readCalendar(text, zone, addDays(today, -DAYS_BACK), addDays(today, DAYS_AHEAD), show === 'titles');
}

async function keep(db: Db, id: number, events: ReadEvent[], at: string): Promise<void> {
  await atomic(db, async (tx) => {
    await tx.run('DELETE FROM followed_events WHERE calendar_id = ?', [id]);
    for (const e of events) await tx.run('INSERT INTO followed_events (calendar_id, day, end_day, time, end_time, title) VALUES (?, ?, ?, ?, ?, ?)', [id, e.day, e.end_day, e.time, e.end_time, e.title]);
    await tx.run('UPDATE followed_calendars SET fetched_at = ?, problem = NULL WHERE id = ?', [at, id]);
  });
}

/** Reads one followed calendar again. A failure is noted against it, and what was read before stays. */
async function refreshRow(db: Db, row: Row, clock: Clock, tools: Tools): Promise<void> {
  const at = stamp(clock());
  try {
    const url = tools.sealer.unseal(row.url);
    if (url === null) throw new Problem(400, "Its link can't be opened any more. Remove it and add it again.");
    await keep(db, row.id, await fetched(tools, url, row.zone, row.show, todayOf(clock)), at);
  } catch (problem) {
    await db.run('UPDATE followed_calendars SET fetched_at = ?, problem = ? WHERE id = ?', [at, problem instanceof Problem ? problem.message : "Couldn't be read", row.id]);
  }
}

const COLUMNS = 'id, owner_id, name, url, show, zone, fetched_at, problem';

/** Reads again every followed calendar, anyone's, that hasn't been read for an hour. Called on a timer. */
export async function followedDue(db: Db, clock: Clock, tools: Tools): Promise<number> {
  const before = stamp(new Date(clock().getTime() - STALE_MINUTES * 60_000));
  const due = await db.all<Row>(`SELECT ${COLUMNS} FROM followed_calendars WHERE fetched_at IS NULL OR fetched_at < ? ORDER BY id`, [before]);
  for (const row of due) await refreshRow(db, row, clock, tools);
  return due.length;
}

export function followedCalendars(db: Db, owner: number, clock: Clock = () => new Date(), tools?: Tools) {
  const need = () => {
    if (!tools) throw new Problem(400, "This copy of Life Is isn't set up to reach outside services");
    return tools;
  };
  const checkedShow = (show: string | null | undefined): Show => {
    if (show === null || show === undefined) return 'busy';
    if (!(SHOWS as readonly string[]).includes(show)) throw new Problem(400, 'A calendar shows "busy" or "titles"');
    return show as Show;
  };
  const named = (name: string) => {
    const tidy = clean(name, 60);
    if (!tidy) throw new Problem(400, 'Give it a name, like "Work"');
    return tidy;
  };
  const row = async (id: number): Promise<Row> => {
    const found = await db.get<Row>(`SELECT ${COLUMNS} FROM followed_calendars WHERE id = ? AND owner_id = ?`, [id, owner]);
    if (!found) throw new Problem(404, 'Not found');
    return found;
  };
  async function list(): Promise<Followed[]> {
    return (await db.all<Row & { events: number }>(
      `SELECT ${COLUMNS}, (SELECT COUNT(*) FROM followed_events e WHERE e.calendar_id = followed_calendars.id) AS events
       FROM followed_calendars WHERE owner_id = ? ORDER BY name COLLATE NOCASE, id`, [owner]))
      .map(({ id, name, show, zone, events, fetched_at, problem }) => ({ id, name, show, zone, events, fetched_at, problem }));
  }

  return {
    available: () => Boolean(tools),
    list,

    /** Follow a calendar. It is only saved once the link has been read and shown to be a calendar. */
    async add(input: FollowInput): Promise<Followed[]> {
      const { sealer } = need();
      const name = named(input.name);
      const show = checkedShow(input.show);
      const zone = checkedZone(input.zone);
      const url = linkOf(input.url);
      if ((await db.get<{ n: number }>('SELECT COUNT(*) AS n FROM followed_calendars WHERE owner_id = ?', [owner]))!.n >= 20) throw new Problem(400, 'Twenty calendars at most');
      const events = await fetched(need(), url, zone, show, todayOf(clock));
      const made = await db.run('INSERT INTO followed_calendars (owner_id, name, url, show, zone, created_at) VALUES (?, ?, ?, ?, ?, ?)', [owner, name, sealer.seal(url), show, zone, stamp(clock())]);
      await keep(db, made.lastId, events, stamp(clock()));
      return list();
    },

    /** Rename it, or change how much of it shows. Asking for less takes effect at once: the titles kept are dropped. */
    async update(id: number, input: { name: string; show?: string | null }): Promise<Followed[]> {
      const before = await row(id);
      const show = checkedShow(input.show ?? before.show);
      await db.run('UPDATE followed_calendars SET name = ?, show = ? WHERE id = ?', [named(input.name), show, id]);
      if (show === 'busy' && before.show !== 'busy') await db.run('UPDATE followed_events SET title = NULL WHERE calendar_id = ?', [id]);
      // Asking for more means reading it again: the titles were never kept.
      if (show === 'titles' && before.show !== 'titles' && tools) await refreshRow(db, { ...before, show }, clock, tools);
      return list();
    },

    /** Stop following it. What was read from it, and its link, are forgotten. */
    async remove(id: number): Promise<Followed[]> {
      await row(id);
      await db.run('DELETE FROM followed_calendars WHERE id = ?', [id]);
      return list();
    },

    /** Read it again now. */
    async refresh(id: number): Promise<Followed[]> {
      await refreshRow(db, await row(id), clock, need());
      return list();
    },
  };
}

export type FollowedCalendars = ReturnType<typeof followedCalendars>;
