/**
 * What happened to a thing, or to a copy of a book or film: when it came in, every time it moved and where
 * from, and each time it was used and what for. Places and projects are written as they were named then, so
 * the history still reads right after either is renamed or removed.
 *
 * Kept apart from inventory.ts and media.ts, which both write here, so neither has to know the other.
 */
import type { Queries } from './db.ts';
import { clean } from './small.ts';

export type HistoryWhat = 'added' | 'moved' | 'used';
export type HistoryEntry = {
  id: number;
  what: HistoryWhat;
  from_place: string | null;
  to_place: string | null;
  project_id: number | null;
  project: string | null;
  activity: string | null;
  day: string;
  note: string | null;
};
type Whose = { item_id: number } | { copy_id: number };

const MAX_DEPTH = 10;

/** A place's whole path as it is now ("Leo's room › Shelf"), or null for no place. */
export async function placePath(q: Queries, owner: number, id: number | null | undefined): Promise<string | null> {
  const names: string[] = [];
  for (let at = id ?? null, steps = 0; at !== null && steps <= MAX_DEPTH; steps += 1) {
    const row = await q.get<{ name: string; parent_id: number | null }>('SELECT name, parent_id FROM places WHERE id = ? AND owner_id = ?', [at, owner]);
    if (!row) break;
    names.unshift(row.name);
    at = row.parent_id;
  }
  return names.length ? names.join(' › ') : null;
}

export async function noteHistory(q: Queries, owner: number, whose: Whose, entry: {
  what: HistoryWhat; day: string; at: string; from_place?: string | null; to_place?: string | null;
  project_id?: number | null; project?: string | null; activity?: string | null; note?: string | null;
}): Promise<void> {
  await q.run(
    `INSERT INTO item_history (owner_id, item_id, copy_id, what, from_place, to_place, project_id, project, activity, day, note, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [owner, 'item_id' in whose ? whose.item_id : null, 'copy_id' in whose ? whose.copy_id : null, entry.what,
      entry.from_place ?? null, entry.to_place ?? null, entry.project_id ?? null, clean(entry.project, 200),
      clean(entry.activity, 80), entry.day, clean(entry.note, 1000), entry.at]);
}

/** When a place changes, a "moved" entry: from where it was to where it is now. Nothing when it stayed put. */
export async function noteMove(q: Queries, owner: number, whose: Whose, from: number | null, to: number | null, when: { day: string; at: string }, note?: string | null): Promise<boolean> {
  if ((from ?? null) === (to ?? null)) return false;
  await noteHistory(q, owner, whose, { what: 'moved', from_place: await placePath(q, owner, from), to_place: await placePath(q, owner, to), note, ...when });
  return true;
}

/** Everything that happened to one thing or copy, newest first. */
export async function historyOf(q: Queries, owner: number, whose: Whose): Promise<HistoryEntry[]> {
  const [column, id] = 'item_id' in whose ? ['item_id', whose.item_id] : ['copy_id', whose.copy_id];
  return q.all<HistoryEntry>(
    `SELECT id, what, from_place, to_place, project_id, project, activity, day, note FROM item_history
     WHERE owner_id = ? AND ${column} = ? ORDER BY day DESC, id DESC`, [owner, id]);
}
