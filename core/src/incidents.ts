/**
 * A private incident log: dated entries only the person can see, for something like a break-in, a dispute or a problem with
 * a landlord. Each entry says when it happened, what happened, who was there, and what the person kept (a note of photos,
 * messages or papers, in words: the files themselves are not kept here).
 *
 * So the record holds up later, an entry can be changed or taken away for 24 hours after it is written, and not after. From
 * then on it can only be added to, and an addition cannot be changed at all. `written_at` is when the entry was first
 * written, set here from the clock and never taken from the person. A restore from a download keeps it.
 *
 * Private to the person it belongs to, like measures: every read and write goes through `owner_id = the viewer`, and nothing
 * else reads these tables (not search, the front page, reminders, the assistant, a voice key, or another person's download).
 * Life Is keeps what the person typed. It gives no legal advice and says nothing about what an entry means.
 */
import type { Db } from './db.ts';
import { Problem } from './problem.ts';
import { addDays, clean, dayNumber, stamp, todayOf, type Clock } from './small.ts';

export const MAX_INCIDENTS = 500;
export const MAX_ADDITIONS = 200;
/** How long an entry can still be changed after it is written. */
export const CHANGE_HOURS = 24;
const HOUR = 3_600_000;

export type Addition = { id: number; words: string; written_at: string };
export type Incident = {
  id: number; happened_on: string; happened_time: string | null; what: string; who: string | null; kept: string | null; written_at: string;
  /** True once 24 hours have passed: it can only be added to. */
  locked: boolean;
  /** Until when it can still be changed (a UTC stamp); null once locked. */
  changeable_until: string | null;
  additions: Addition[];
};
export type IncidentInput = { happened_on: string; happened_time?: string | null; what: string; who?: string | null; kept?: string | null };

type Row = { id: number; happened_on: string; happened_time: string | null; what: string; who: string | null; kept: string | null; written_at: string };
const COLUMNS = 'id, happened_on, happened_time, what, who, kept, written_at';

export function incidents(db: Db, viewer: number, clock: Clock = () => new Date()) {
  const lockedAt = (written: string) => Date.parse(written) + CHANGE_HOURS * HOUR;
  const isLocked = (written: string) => clock().getTime() >= lockedAt(written);
  async function whole(r: Row): Promise<Incident> {
    const additions = await db.all<Addition>('SELECT id, words, written_at FROM incident_additions WHERE incident_id = ? ORDER BY written_at, id', [r.id]);
    const locked = isLocked(r.written_at);
    return { ...r, locked, changeable_until: locked ? null : stamp(new Date(lockedAt(r.written_at))), additions };
  }
  async function mine(id: number): Promise<Row> {
    const row = await db.get<Row>(`SELECT ${COLUMNS} FROM incidents WHERE id = ? AND owner_id = ?`, [id, viewer]);
    if (!row) throw new Problem(404, "That entry isn't here anymore.");
    return row;
  }
  function tidy(input: IncidentInput) {
    if (!input.happened_on) throw new Problem(400, 'Pick the day it happened');
    dayNumber(input.happened_on);
    if (input.happened_on > addDays(todayOf(clock), 1)) throw new Problem(400, "It can't have happened on a day that hasn't come yet");
    const what = clean(input.what, 8000);
    if (!what) throw new Problem(400, 'Say what happened');
    const time = clean(input.happened_time, 40);
    return { happened_on: input.happened_on, happened_time: time, what, who: clean(input.who, 1000), kept: clean(input.kept, 2000) };
  }
  const tooLate = () => new Problem(403, `This entry was written more than ${CHANGE_HOURS} hours ago, so it can't be changed or taken away. That keeps the record sound. You can add to it.`);

  return {
    /** The viewer's whole log, in the order things happened (the oldest first), each with what was added to it. */
    async list(): Promise<Incident[]> {
      const rows = await db.all<Row>(`SELECT ${COLUMNS} FROM incidents WHERE owner_id = ? ORDER BY happened_on, happened_time, id`, [viewer]);
      const out: Incident[] = [];
      for (const r of rows) out.push(await whole(r));
      return out;
    },

    async create(input: IncidentInput): Promise<Incident> {
      const t = tidy(input);
      const count = (await db.get<{ n: number }>('SELECT COUNT(*) AS n FROM incidents WHERE owner_id = ?', [viewer]))?.n ?? 0;
      if (count >= MAX_INCIDENTS) throw new Problem(400, `Life Is keeps ${MAX_INCIDENTS} entries at most`);
      const made = await db.run('INSERT INTO incidents (owner_id, happened_on, happened_time, what, who, kept, written_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [viewer, t.happened_on, t.happened_time, t.what, t.who, t.kept, stamp(clock())]);
      return whole(await mine(made.lastId));
    },

    /** Changes an entry, only within 24 hours of writing it. */
    async update(id: number, input: IncidentInput): Promise<Incident> {
      const row = await mine(id);
      if (isLocked(row.written_at)) throw tooLate();
      const t = tidy(input);
      await db.run('UPDATE incidents SET happened_on = ?, happened_time = ?, what = ?, who = ?, kept = ? WHERE id = ? AND owner_id = ?', [t.happened_on, t.happened_time, t.what, t.who, t.kept, id, viewer]);
      return whole(await mine(id));
    },

    /** Takes an entry away, only within 24 hours of writing it. */
    async remove(id: number): Promise<void> {
      const row = await mine(id);
      if (isLocked(row.written_at)) throw tooLate();
      await db.run('DELETE FROM incidents WHERE id = ? AND owner_id = ?', [id, viewer]);
    },

    /** Adds words to an entry, at any time. An addition is kept as written, with when it was written. */
    async addTo(id: number, words: string): Promise<Incident> {
      const row = await mine(id);
      const text = clean(words, 8000);
      if (!text) throw new Problem(400, 'Say what you want to add');
      const count = (await db.get<{ n: number }>('SELECT COUNT(*) AS n FROM incident_additions WHERE incident_id = ?', [id]))?.n ?? 0;
      if (count >= MAX_ADDITIONS) throw new Problem(400, `An entry takes ${MAX_ADDITIONS} additions at most`);
      await db.run('INSERT INTO incident_additions (incident_id, words, written_at) VALUES (?, ?, ?)', [id, text, stamp(clock())]);
      return whole(row);
    },
  };
}

export type Incidents = ReturnType<typeof incidents>;
