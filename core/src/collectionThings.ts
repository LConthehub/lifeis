/**
 * The physical copies in the Collection (a disc, a record, a printed book, a cartridge), seen as things the household
 * owns. This is only a view: nothing is copied out of the Collection (media.ts keeps its own tables), so a copy
 * added, moved or deleted there shows here at once.
 *
 * A copy counts when it is physical. It does not count when it lives only on a server (Jellyfin, an eBook or an
 * Audiobookshelf copy, or a format such as Digital or eBook). A title that is only wanted, or only on a list,
 * has no copies and so is never counted.
 */
import type { Queries } from './db.ts';

/** Formats that are only ever a file or an account: nothing to put on a shelf. */
const FILE_FORMATS = /\b(digital|e-?books?|audiobooks?|kindle|stream(ing)?|download(ed)?|file)\b/i;

/**
 * Whether a copy is something on a shelf. It is not when it came from a server (a media server or book server it
 * is kept in step with), or when its format says it is a file. A copy brought in from a typed list ("list") is
 * judged by its format alone.
 */
export function isPhysicalCopy(copy: { format: string; source: string | null; connection_id: number | null; library_source_id: number | null }): boolean {
  if (copy.connection_id !== null || copy.library_source_id !== null) return false;
  if (copy.source !== null && copy.source !== 'list') return false;
  return !FILE_FORMATS.test(copy.format);
}

export type PhysicalCopy = {
  copy_id: number;
  media_id: number;
  title: string;
  /** film, show, music, book, game or other. */
  type: string;
  year: number | null;
  format: string;
  place_id: number | null;
  /** What it cost, in cents, if said. */
  cost_cents: number | null;
  /** What it is worth now, in cents, if said. */
  value_cents: number | null;
  /** What it counts for: the value if said, else the cost, else 0. */
  worth_cents: number;
};

/** Every physical copy this person owns, in title order. Titles with no copy (wanted, or only listed) are never in it. */
export async function physicalCopies(q: Queries, owner: number): Promise<PhysicalCopy[]> {
  const rows = await q.all<{ copy_id: number; media_id: number; title: string; type: string; year: number | null; format: string; place_id: number | null;
    cost_cents: number | null; value_cents: number | null; source: string | null; connection_id: number | null; library_source_id: number | null }>(
    `SELECT c.id AS copy_id, c.media_id, m.title, m.type, m.year, c.format, c.place_id, c.cost_cents, c.value_cents, c.source, c.connection_id, c.library_source_id
     FROM media_copies c JOIN media m ON m.id = c.media_id
     WHERE m.owner_id = ? AND m.listed_only = 0 ORDER BY m.title COLLATE NOCASE, c.id`, [owner]);
  return rows.filter(isPhysicalCopy).map(({ source: _s, connection_id: _c, library_source_id: _l, ...row }) => ({ ...row, worth_cents: row.value_cents ?? row.cost_cents ?? 0 }));
}
