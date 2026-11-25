/**
 * Measures: a person's own numbers over time (a name, a unit, dated entries, and a target only if they add one).
 *
 * Measures are private to the person they belong to, with no switch to share them and no way in for anyone else, the
 * person in charge included. So every read and every write here goes through `owner_id = the viewer`, and nothing else
 * in Life Is reads these tables: not search, not the front page, reminders, the assistant, a voice key, or another
 * person's download. They are in the person's own full download, and come back in with it (exportAll.ts).
 *
 * Life Is suggests nothing and judges nothing about them: no "good" or "bad", no arrows, no colors for up or down.
 */
import type { Db } from './db.ts';
import { Problem } from './problem.ts';
import { clean, dayOrNull, stamp, todayOf, type Clock } from './small.ts';

export const MAX_MEASURES = 30;
/** How many of the latest entries a measure shows in its list. */
export const RECENT_ENTRIES = 30;
const MOST = 1_000_000_000;

export type MeasureEntry = { id: number; day: string; value: number };
export type Measure = { id: number; name: string; unit: string; target: number | null; entries: MeasureEntry[]; entry_count: number };
export type MeasureInput = { name: string; unit?: string | null; target?: number | null };

const numberOk = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= MOST;

export function measures(db: Db, viewer: number, clock: Clock = () => new Date()) {
  async function whole(id: number, name: string, unit: string, target: number | null): Promise<Measure> {
    const entries = await db.all<MeasureEntry>('SELECT id, day, value FROM measure_entries WHERE measure_id = ? ORDER BY day DESC, id DESC LIMIT ?', [id, RECENT_ENTRIES]);
    const count = (await db.get<{ n: number }>('SELECT COUNT(*) AS n FROM measure_entries WHERE measure_id = ?', [id]))?.n ?? 0;
    return { id, name, unit, target, entries, entry_count: count };
  }
  async function mine(id: number) {
    const row = await db.get<{ id: number; name: string; unit: string; target: number | null }>('SELECT id, name, unit, target FROM measures WHERE id = ? AND owner_id = ?', [id, viewer]);
    if (!row) throw new Problem(404, 'Not found');
    return row;
  }
  function tidy(input: MeasureInput) {
    const name = clean(input.name, 60);
    if (!name) throw new Problem(400, 'Give the measure a name');
    const unit = clean(input.unit, 20) ?? '';
    const target = input.target ?? null;
    if (target !== null && !numberOk(target)) throw new Problem(400, 'A target is a number');
    return { name, unit, target };
  }

  return {
    /** Only the viewer's own measures, each with its latest entries. */
    async list(): Promise<Measure[]> {
      const rows = await db.all<{ id: number; name: string; unit: string; target: number | null }>('SELECT id, name, unit, target FROM measures WHERE owner_id = ? ORDER BY sort_order, id', [viewer]);
      const out: Measure[] = [];
      for (const r of rows) out.push(await whole(r.id, r.name, r.unit, r.target));
      return out;
    },

    async create(input: MeasureInput): Promise<Measure> {
      const t = tidy(input);
      const count = (await db.get<{ n: number }>('SELECT COUNT(*) AS n FROM measures WHERE owner_id = ?', [viewer]))?.n ?? 0;
      if (count >= MAX_MEASURES) throw new Problem(400, `Life Is keeps ${MAX_MEASURES} measures at most`);
      const next = (await db.get<{ n: number | null }>('SELECT MAX(sort_order) AS n FROM measures WHERE owner_id = ?', [viewer]))?.n ?? -1;
      const made = await db.run('INSERT INTO measures (owner_id, name, unit, target, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?)', [viewer, t.name, t.unit, t.target, next + 1, stamp(clock())]);
      return whole(made.lastId, t.name, t.unit, t.target);
    },

    async update(id: number, input: MeasureInput): Promise<Measure> {
      await mine(id);
      const t = tidy(input);
      await db.run('UPDATE measures SET name = ?, unit = ?, target = ? WHERE id = ? AND owner_id = ?', [t.name, t.unit, t.target, id, viewer]);
      return whole(id, t.name, t.unit, t.target);
    },

    /** Takes a measure away, with all its entries. */
    async remove(id: number): Promise<void> {
      await mine(id);
      await db.run('DELETE FROM measures WHERE id = ? AND owner_id = ?', [id, viewer]);
    },

    async addEntry(id: number, input: { value: number; day?: string | null }): Promise<Measure> {
      const m = await mine(id);
      if (!numberOk(input.value)) throw new Problem(400, 'An entry is a number');
      if (input.day != null && !dayOrNull(input.day)) throw new Problem(400, 'Pick the day of the entry');
      await db.run('INSERT INTO measure_entries (measure_id, day, value, created_at) VALUES (?, ?, ?, ?)', [id, dayOrNull(input.day) ?? todayOf(clock), input.value, stamp(clock())]);
      return whole(id, m.name, m.unit, m.target);
    },

    async removeEntry(entryId: number): Promise<Measure> {
      const e = await db.get<{ measure_id: number }>('SELECT e.measure_id FROM measure_entries e JOIN measures m ON m.id = e.measure_id WHERE e.id = ? AND m.owner_id = ?', [entryId, viewer]);
      if (!e) throw new Problem(404, 'Not found');
      await db.run('DELETE FROM measure_entries WHERE id = ?', [entryId]);
      const m = await mine(e.measure_id);
      return whole(m.id, m.name, m.unit, m.target);
    },
  };
}

export type Measures = ReturnType<typeof measures>;
