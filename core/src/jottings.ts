/**
 * Jottings: a person's own scratch list for stray thoughts. One line each, with the day it was jotted.
 *
 * Jottings are private to the person who wrote them, with no switch to share them and no way in for anyone else, the
 * person in charge included. Every read and write here goes through `owner_id = the viewer`. Nothing else in Life Is
 * reads these rows except what the person chooses: a personal key that was allowed to add one (voice.ts, add only), an
 * AI app connection that was allowed to read them (connector.ts, read only), and their own full download (exportAll.ts).
 */
import type { Db } from './db.ts';
import { Problem } from './problem.ts';
import { clean, stamp, todayOf, type Clock } from './small.ts';

export const MAX_JOTTINGS = 1000;
export const MAX_JOTTING = 500;

export type Jotting = { id: number; text: string; done: boolean; day: string };
type Row = { id: number; text: string; done: number; created_at: string };
const asJotting = (row: Row): Jotting => ({ id: row.id, text: row.text, done: row.done === 1, day: row.created_at.slice(0, 10) });
// created_at is "<the person's day>T<time>+00:00": the day is the person's own, as todayOf says it.

export function jottings(db: Db, viewer: number, clock: Clock = () => new Date()) {
  async function mine(id: number): Promise<Row> {
    const row = await db.get<Row>('SELECT id, text, done, created_at FROM jottings WHERE id = ? AND owner_id = ?', [id, viewer]);
    if (!row) throw new Problem(404, "That jotting isn't here anymore. It may have been removed.");
    return row;
  }
  function tidy(text: unknown): string {
    const said = clean(typeof text === 'string' ? text : null, MAX_JOTTING);
    if (!said) throw new Problem(400, 'Write something to jot down');
    return said;
  }

  return {
    /** Only the viewer's own, newest first. Checked ones come after the open ones, also newest first. */
    async list(): Promise<Jotting[]> {
      const rows = await db.all<Row>('SELECT id, text, done, created_at FROM jottings WHERE owner_id = ? ORDER BY done, id DESC', [viewer]);
      return rows.map(asJotting);
    },

    async add(text: string): Promise<Jotting> {
      const said = tidy(text);
      const count = (await db.get<{ n: number }>('SELECT COUNT(*) AS n FROM jottings WHERE owner_id = ?', [viewer]))?.n ?? 0;
      if (count >= MAX_JOTTINGS) throw new Problem(400, `Life Is keeps ${MAX_JOTTINGS} jottings at most. Remove some you are done with.`);
      const made = await db.run('INSERT INTO jottings (owner_id, text, done, created_at) VALUES (?, ?, 0, ?)', [viewer, said, `${todayOf(clock)}${stamp(clock()).slice(10)}`]);
      return asJotting((await mine(made.lastId)));
    },

    /** Reword it, check it off, or bring it back. */
    async update(id: number, change: { text?: string; done?: boolean }): Promise<Jotting> {
      const row = await mine(id);
      const text = change.text === undefined ? row.text : tidy(change.text);
      const done = change.done === undefined ? row.done : change.done ? 1 : 0;
      await db.run('UPDATE jottings SET text = ?, done = ? WHERE id = ? AND owner_id = ?', [text, done, id, viewer]);
      return asJotting(await mine(id));
    },

    async remove(id: number): Promise<void> {
      await db.run('DELETE FROM jottings WHERE id = ? AND owner_id = ?', [id, viewer]);
    },
  };
}

export type Jottings = ReturnType<typeof jottings>;
