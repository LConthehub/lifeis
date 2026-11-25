/**
 * Lists of titles: films, shows, music, books and games, mixed, in an order the person chooses.
 *
 * Every person has two lists of their own that stay: "To watch, read or hear" and "Wanted". Wanted is drawn from
 * the `wanted` mark on a title (media.wanted), so what was marked wanted before lists is on it, and nothing was
 * moved or rebuilt. A person can make more lists. A list is private to its owner unless the owner shares it, and
 * then it belongs to the household: everyone who signs in here sees it and can add a title to it (by typing it),
 * take any title off it, reorder it, and mark a title watched. Only the owner can rename, stop sharing or delete it.
 * Deleting a list never removes a title.
 *
 * A title typed onto a list that the person does not own is kept as a title with `listed_only` set. It stays
 * out of the Collection and everything that counts what is owned (media.ts `list`) until a copy is added.
 * Every title on a list belongs to the list's owner, so a title added to someone's shared list never touches
 * the adder's own collection, and nobody sees another person's copies or log through a list.
 */
import { atomic, type Db, type Queries } from './db.ts';
import { shown } from './displayName.ts';
import { Problem } from './problem.ts';
import { unlink } from './tags.ts';
import { clean, dayNumber, labelKey, stamp, type Clock } from './small.ts';

export const LIST_TYPES = ['film', 'show', 'music', 'book', 'game', 'other'] as const;
export const TO_WATCH = 'to_watch';
export const WANTED = 'wanted';
export const BUILT_IN_NAMES: Record<string, string> = { [TO_WATCH]: 'To watch, read or hear', [WANTED]: 'Wanted' };

export type ListSummary = {
  id: number;
  name: string;
  /** 'to_watch' or 'wanted' for the two lists everyone has; null for one the person made. */
  builtin: string | null;
  shared: boolean;
  /** Whether it is the viewer's own (they can reorder, rename, share and delete it). */
  mine: boolean;
  /** Who it belongs to, when it is not the viewer's. */
  owner_name: string | null;
  count: number;
};
export type ListEntry = {
  media_id: number;
  title: string;
  type: string;
  creator: string | null;
  year: number | null;
  note: string | null;
  added_by: string | null;
  /** Only said to the list's owner: whether a copy is kept, and how many times it was watched, read or heard. */
  owned: boolean | null;
  times: number | null;
  /** The list owner's own rating in half stars, said only to the owner (null when not rated, or not yours). */
  stars: number | null;
  /** Whether the viewer can take it off (anyone who sees a list can, except on Wanted, which is only its owner's). */
  can_remove: boolean;
};
export type ListView = ListSummary & { entries: ListEntry[] };
export type EntryInput = { media_id?: number | null; type?: string | null; title?: string | null; creator?: string | null; year?: number | null; note?: string | null };

/**
 * A title that is only on lists, and is no longer on any (and is not wanted or watched), has no reason to be kept:
 * it goes. One that has been watched, or has notes of its own, stays (still out of the Collection until it has a copy).
 */
export async function tidyUnowned(q: Queries, mediaId: number): Promise<void> {
  const row = await q.get<{ id: number }>(
    `SELECT m.id FROM media m WHERE m.id = ? AND m.listed_only = 1 AND m.wanted = 0 AND m.note IS NULL AND m.summary IS NULL
       AND NOT EXISTS (SELECT 1 FROM media_copies c WHERE c.media_id = m.id)
       AND NOT EXISTS (SELECT 1 FROM media_log l WHERE l.media_id = m.id)
       AND NOT EXISTS (SELECT 1 FROM media_list_items i WHERE i.media_id = m.id)`, [mediaId]);
  if (!row) return;
  await q.run('DELETE FROM media WHERE id = ?', [mediaId]);
  await unlink(q, 'title', mediaId);
}

/** A title as it is put on a list: checked. */
function checkedTitle(input: EntryInput): { type: string; title: string; creator: string | null; year: number | null } {
  const type = input.type ?? 'other';
  if (!(LIST_TYPES as readonly string[]).includes(type)) throw new Problem(400, 'It is a film, a show, music, a book, a game, or something else');
  const title = clean(input.title, 300);
  if (!title) throw new Problem(400, 'Give it a title');
  if (input.year != null && !(Number.isInteger(input.year) && input.year >= 0 && input.year <= 9999)) throw new Problem(400, 'The year is a whole number');
  return { type, title, creator: clean(input.creator, 300), year: input.year ?? null };
}

export function mediaLists(db: Db, owner: number, clock: Clock = () => new Date()) {
  const now = () => stamp(clock());

  /** The two lists everyone has, made the first time they are needed. */
  async function ensureBuiltIn(q: Queries): Promise<void> {
    for (const [key, order] of [[WANTED, -2], [TO_WATCH, -1]] as const) {
      if (!(await q.get('SELECT id FROM media_lists WHERE owner_id = ? AND builtin = ?', [owner, key]))) {
        await q.run('INSERT INTO media_lists (owner_id, name, builtin, shared, sort_order, created_at) VALUES (?, ?, ?, 0, ?, ?)', [owner, BUILT_IN_NAMES[key]!, key, order, now()]);
      }
    }
  }

  type ListRow = { id: number; owner_id: number; name: string; builtin: string | null; shared: number; owner_name: string };
  /** A list the viewer may see: their own, or one shared with everyone. Anything else is not there. */
  async function visible(q: Queries, id: number): Promise<ListRow> {
    const row = await q.get<ListRow>(
      `SELECT l.id, l.owner_id, l.name, l.builtin, l.shared, ${shown('u')} AS owner_name FROM media_lists l JOIN users u ON u.id = l.owner_id
       WHERE l.id = ? AND (l.owner_id = ? OR l.shared = 1)`, [id, owner]);
    if (!row) throw new Problem(404, 'Not found');
    return row;
  }
  async function mine(q: Queries, id: number): Promise<ListRow> {
    const row = await visible(q, id);
    if (row.owner_id !== owner) throw new Problem(403, 'Only whoever made a list can change it');
    return row;
  }

  async function countOf(q: Queries, row: ListRow): Promise<number> {
    if (row.builtin === WANTED) return (await q.get<{ n: number }>('SELECT COUNT(*) AS n FROM media WHERE owner_id = ? AND wanted = 1', [row.owner_id]))!.n;
    return (await q.get<{ n: number }>('SELECT COUNT(*) AS n FROM media_list_items WHERE list_id = ?', [row.id]))!.n;
  }
  const summaryOf = async (q: Queries, row: ListRow): Promise<ListSummary> => ({
    id: row.id, name: row.name, builtin: row.builtin, shared: row.shared === 1, mine: row.owner_id === owner,
    owner_name: row.owner_id === owner ? null : row.owner_name, count: await countOf(q, row),
  });

  async function view(q: Queries, id: number): Promise<ListView> {
    const row = await visible(q, id);
    const own = row.owner_id === owner;
    type Found = { stars: number | null; media_id: number; title: string; type: string; creator: string | null; year: number | null; note: string | null; added_by: string | null; added_by_id: number | null; owned: number; times: number };
    const found = row.builtin === WANTED
      ? await q.all<Found>(
        `SELECT m.id AS media_id, m.stars, m.title, m.type, m.creator, m.year, NULL AS note, NULL AS added_by, NULL AS added_by_id,
                EXISTS (SELECT 1 FROM media_copies c WHERE c.media_id = m.id) AS owned, (SELECT COUNT(*) FROM media_log l WHERE l.media_id = m.id) AS times
         FROM media m WHERE m.owner_id = ? AND m.wanted = 1 ORDER BY m.title COLLATE NOCASE, m.year, m.id`, [row.owner_id])
      : await q.all<Found>(
        `SELECT m.id AS media_id, m.stars, m.title, m.type, m.creator, m.year, i.note, ${shown('a')} AS added_by, i.added_by AS added_by_id,
                EXISTS (SELECT 1 FROM media_copies c WHERE c.media_id = m.id) AS owned, (SELECT COUNT(*) FROM media_log l WHERE l.media_id = m.id) AS times
         FROM media_list_items i JOIN media m ON m.id = i.media_id LEFT JOIN users a ON a.id = i.added_by
         WHERE i.list_id = ? ORDER BY i.sort_order, i.id`, [row.id]);
    return {
      ...(await summaryOf(q, row)),
      entries: found.map((f): ListEntry => ({
        media_id: f.media_id, title: f.title, type: f.type, creator: f.creator, year: f.year, note: f.note,
        added_by: f.added_by_id !== null && f.added_by_id !== owner ? f.added_by : null,
        owned: own ? f.owned === 1 : null, times: own ? f.times : null, stars: own && f.stars !== null ? f.stars / 2 : null,
        can_remove: row.builtin === WANTED ? own : true,
      })),
    };
  }

  /** The title on a person's own shelf with this type and name, if one is there (watched, owned, wanted or only on a list). */
  async function findTitle(q: Queries, ownerId: number, type: string, title: string): Promise<{ id: number; wanted: number; listed_only: number } | null> {
    const key = labelKey(title);
    const rows = await q.all<{ id: number; title: string; wanted: number; listed_only: number }>('SELECT id, title, wanted, listed_only FROM media WHERE owner_id = ? AND type = ? ORDER BY id', [ownerId, type]);
    return rows.find((r) => labelKey(r.title) === key) ?? null;
  }

  return {
    /** Whose lists the person sees: their own (Wanted, then To watch, then the ones they made), then the ones others shared. */
    async all(): Promise<ListSummary[]> {
      await atomic(db, ensureBuiltIn);
      const rows = await db.all<ListRow>(
        `SELECT l.id, l.owner_id, l.name, l.builtin, l.shared, ${shown('u')} AS owner_name FROM media_lists l JOIN users u ON u.id = l.owner_id
         WHERE l.owner_id = ? OR l.shared = 1
         ORDER BY (l.owner_id = ?) DESC, l.sort_order, l.id`, [owner, owner]);
      const out: ListSummary[] = [];
      for (const row of rows) out.push(await summaryOf(db, row));
      return out;
    },

    async get(id: number): Promise<ListView> {
      await atomic(db, ensureBuiltIn);
      return view(db, id);
    },

    async create(input: { name?: string | null; shared?: boolean }): Promise<ListView> {
      const name = clean(input.name, 80);
      if (!name) throw new Problem(400, 'Give the list a name');
      return atomic(db, async (tx) => {
        await ensureBuiltIn(tx);
        const mineAlready = await tx.all<{ name: string }>('SELECT name FROM media_lists WHERE owner_id = ?', [owner]);
        if (mineAlready.some((l) => labelKey(l.name) === labelKey(name))) throw new Problem(409, 'You already have a list with that name');
        const last = (await tx.get<{ n: number | null }>('SELECT MAX(sort_order) AS n FROM media_lists WHERE owner_id = ?', [owner]))!.n ?? 0;
        const made = await tx.run('INSERT INTO media_lists (owner_id, name, shared, sort_order, created_at) VALUES (?, ?, ?, ?, ?)', [owner, name, input.shared ? 1 : 0, Math.max(last, 0) + 1, now()]);
        return view(tx, made.lastId);
      });
    },

    /** Rename a list or change whether it is shared. The two lists everyone has keep their names and stay private. */
    async update(id: number, input: { name?: string | null; shared?: boolean }): Promise<ListView> {
      return atomic(db, async (tx) => {
        const row = await mine(tx, id);
        if (row.builtin) throw new Problem(400, `${row.name} stays as it is`);
        if (input.name !== undefined) {
          const name = clean(input.name, 80);
          if (!name) throw new Problem(400, 'Give the list a name');
          const others = await tx.all<{ id: number; name: string }>('SELECT id, name FROM media_lists WHERE owner_id = ?', [owner]);
          if (others.some((l) => l.id !== id && labelKey(l.name) === labelKey(name))) throw new Problem(409, 'You already have a list with that name');
          await tx.run('UPDATE media_lists SET name = ? WHERE id = ?', [name, id]);
        }
        if (input.shared !== undefined) await tx.run('UPDATE media_lists SET shared = ? WHERE id = ?', [input.shared ? 1 : 0, id]);
        return view(tx, id);
      });
    },

    /** Delete a list the person made. No title is removed: one that is not owned stays findable and can go on another list. */
    async remove(id: number): Promise<void> {
      await atomic(db, async (tx) => {
        const row = await mine(tx, id);
        if (row.builtin) throw new Problem(400, `${row.name} stays as it is`);
        await tx.run('DELETE FROM media_lists WHERE id = ?', [id]);
      });
    },

    /**
     * Put a title on a list: one of the owner's own (`media_id`), or one typed in (name, kind, optional year, creator
     * and note). Anyone who can see a shared list can type a title onto it. A title already on the list stays once.
     */
    async add(id: number, input: EntryInput): Promise<ListView> {
      return atomic(db, async (tx) => {
        await ensureBuiltIn(tx);
        const row = await visible(tx, id);
        const own = row.owner_id === owner;
        let mediaId: number;
        if (input.media_id != null) {
          if (!own) throw new Problem(400, 'Type the title to put it on someone else’s list');
          if (!(await tx.get('SELECT id FROM media WHERE id = ? AND owner_id = ?', [input.media_id, owner]))) throw new Problem(404, "That isn't in your collection");
          mediaId = input.media_id;
        } else {
          const typed = checkedTitle(input);
          const same = await findTitle(tx, row.owner_id, typed.type, typed.title);
          if (same) mediaId = same.id;
          else {
            mediaId = (await tx.run(
              `INSERT INTO media (owner_id, type, title, creator, year, wanted, listed_only, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
              [row.owner_id, typed.type, typed.title, typed.creator, typed.year, row.builtin === WANTED ? 1 : 0, now(), now()])).lastId;
          }
        }
        if (row.builtin === WANTED) {
          if (await tx.get('SELECT id FROM media_copies WHERE media_id = ?', [mediaId])) throw new Problem(400, 'You already have a copy of that');
          await tx.run('UPDATE media SET wanted = 1, listed_only = 1, updated_at = ? WHERE id = ?', [now(), mediaId]);
        } else {
          const last = (await tx.get<{ n: number | null }>('SELECT MAX(sort_order) AS n FROM media_list_items WHERE list_id = ?', [id]))!.n ?? 0;
          await tx.run('INSERT OR IGNORE INTO media_list_items (list_id, media_id, sort_order, note, added_by, created_at) VALUES (?, ?, ?, ?, ?, ?)',
            [id, mediaId, last + 1, clean(input.note, 1000), owner, now()]);
        }
        return view(tx, id);
      });
    },

    /** Take a title off a list: anyone who sees a shared list can. The title itself is not deleted if it is owned. */
    async take(id: number, mediaId: number): Promise<ListView> {
      return atomic(db, async (tx) => {
        const row = await visible(tx, id);
        if (row.builtin === WANTED) {
          if (row.owner_id !== owner) throw new Problem(403, 'Only whoever made a list can change it');
          await tx.run('UPDATE media SET wanted = 0, updated_at = ? WHERE id = ? AND owner_id = ?', [now(), mediaId, owner]);
        } else {
          const item = await tx.get<{ added_by: number | null }>('SELECT added_by FROM media_list_items WHERE list_id = ? AND media_id = ?', [id, mediaId]);
          if (!item) throw new Problem(404, 'Not found');
          await tx.run('DELETE FROM media_list_items WHERE list_id = ? AND media_id = ?', [id, mediaId]);
        }
        await tidyUnowned(tx, mediaId);
        return view(tx, id);
      });
    },

    /**
     * Mark a title on a list watched, read or heard, today (`day`). It goes in the viewer's OWN log: on their own shelf, a
     * title with the same kind and name (made there, out of the Collection, if they have none). It comes off the list for
     * everyone, if the list is shared or is To watch. On a private list of their own it stays, as marking it always did.
     */
    async watched(id: number, mediaId: number, day: string): Promise<ListView> {
      dayNumber(day);
      return atomic(db, async (tx) => {
        await ensureBuiltIn(tx);
        const row = await visible(tx, id);
        if (row.builtin === WANTED) throw new Problem(400, 'Wanted is for what you do not have yet');
        const title = await tx.get<{ type: string; title: string; creator: string | null; year: number | null }>(
          'SELECT m.type, m.title, m.creator, m.year FROM media_list_items i JOIN media m ON m.id = i.media_id WHERE i.list_id = ? AND i.media_id = ?', [id, mediaId]);
        if (!title) throw new Problem(404, 'Not found');
        let mine = mediaId;
        if (row.owner_id !== owner) {
          const same = await findTitle(tx, owner, title.type, title.title);
          mine = same ? same.id : (await tx.run(
            `INSERT INTO media (owner_id, type, title, creator, year, wanted, listed_only, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, 1, ?, ?)`,
            [owner, title.type, title.title, title.creator, title.year, now(), now()])).lastId;
        }
        await tx.run('INSERT INTO media_log (media_id, day, created_at) VALUES (?, ?, ?)', [mine, day, now()]);
        // No longer something to watch, read or hear, on the person's own To watch list.
        await tx.run("DELETE FROM media_list_items WHERE media_id = ? AND list_id IN (SELECT id FROM media_lists WHERE owner_id = ? AND builtin = 'to_watch')", [mine, owner]);
        if (row.shared === 1) await tx.run('DELETE FROM media_list_items WHERE list_id = ? AND media_id = ?', [id, mediaId]);
        await tidyUnowned(tx, mediaId);
        return view(tx, id);
      });
    },

    /** Move a title one place up or down a list (anyone who sees it; Wanted is in alphabetical order). */
    async move(id: number, mediaId: number, way: 'up' | 'down'): Promise<ListView> {
      if (way !== 'up' && way !== 'down') throw new Problem(400, 'Up or down');
      return atomic(db, async (tx) => {
        const row = await visible(tx, id);
        if (row.builtin === WANTED) throw new Problem(400, 'Wanted is kept in alphabetical order');
        const items = await tx.all<{ id: number; media_id: number }>('SELECT id, media_id FROM media_list_items WHERE list_id = ? ORDER BY sort_order, id', [id]);
        const at = items.findIndex((i) => i.media_id === mediaId);
        if (at < 0) throw new Problem(404, 'Not found');
        const to = way === 'up' ? at - 1 : at + 1;
        if (to >= 0 && to < items.length) {
          const [moved] = items.splice(at, 1);
          items.splice(to, 0, moved!);
        }
        for (const [n, item] of items.entries()) await tx.run('UPDATE media_list_items SET sort_order = ? WHERE id = ?', [n + 1, item.id]);
        return view(tx, id);
      });
    },
  };
}

export type MediaLists = ReturnType<typeof mediaLists>;
