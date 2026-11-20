/**
 * Films, shows, music, books and games: what you own, on every format, and what you've watched, read or heard.
 *
 * A title is the work itself: Alien, Rumours, Dune. What you own of it is its copies, one for each: the VHS
 * on the shelf, the Blu-ray in the bin, the file on your media server. A copy has a format (any word you
 * like: VHS, Betamax, Vinyl, Paperback), a place (the same places your other things use), and who it's lent
 * to. A title with no copies can be marked as wanted.
 *
 * Each time you watch, read, listen or play is a line in the title's log, with its day. A log line can
 * belong to a project session, which is how "watched Alien while sewing" is kept.
 *
 * `media(db, owner)` is one person's collection: everything it reads and writes is theirs.
 */
import { atomic, type Db, type Queries, type Value } from './db.ts';
import { placePaths } from './inventory.ts';
import { Problem } from './problem.ts';
import { clean, dayNumber, dayOrNull, inOrder, labelKey, stamp, todayOf, type Clock } from './small.ts';

export const MEDIA_TYPES = ['film', 'show', 'music', 'book', 'game', 'other'] as const;
export type MediaType = (typeof MEDIA_TYPES)[number];

/** Formats offered for each type. Only suggestions: a format is whatever the person types. */
export const FORMATS: Record<MediaType, string[]> = {
  film: ['VHS', 'DVD', 'Blu-ray', '4K UHD', 'LaserDisc', 'Betamax', 'Digital'],
  show: ['VHS', 'DVD', 'Blu-ray', '4K UHD', 'Digital'],
  music: ['Vinyl', 'CD', 'Cassette', '8-track', 'MiniDisc', 'Digital'],
  book: ['Hardcover', 'Paperback', 'Ebook', 'Audiobook'],
  game: ['Cartridge', 'Disc', 'Digital', 'Board game'],
  other: [],
};

export type MediaInput = {
  type: string;
  title: string;
  /** The director, the artist, the author. */
  creator?: string | null;
  year?: number | null;
  summary?: string | null;
  genres?: string[];
  /** How long it runs, in minutes. */
  minutes?: number | null;
  /** The address of a picture of its cover. */
  cover?: string | null;
  /** You'd like to have it. */
  wanted?: boolean;
  note?: string | null;
  /** What other catalogues call it: { tmdb: "348", isbn: "9780441172719" }. */
  ids?: Record<string, string>;
};
export type CopyInput = {
  format: string;
  place_id?: number | null;
  barcode?: string | null;
  lent_to?: string | null;
  /** The day it was lent, as 2046-03-05. Left out with lent_to set: today. */
  lent_on?: string | null;
  note?: string | null;
};
export type LogInput = { day: string; note?: string | null; session_id?: number | null };

export type Copy = {
  id: number;
  media_id: number;
  format: string;
  place_id: number | null;
  place: string | null;
  barcode: string | null;
  lent_to: string | null;
  lent_on: string | null;
  note: string | null;
  /** Where the copy was brought in from ("jellyfin"), or null for one typed in. */
  source: string | null;
};
export type LogEntry = { id: number; media_id: number; day: string; note: string | null; session_id: number | null; project_id: number | null; project: string | null };
export type MediaSummary = {
  id: number;
  type: MediaType;
  title: string;
  creator: string | null;
  year: number | null;
  genres: string[];
  minutes: number | null;
  cover: string | null;
  wanted: boolean;
  /** The formats you have it on, each once: ["VHS", "Blu-ray"]. */
  formats: string[];
  /** Who has a copy on loan, if anyone. */
  lent_to: string[];
  /** How many times it's been watched, read, heard or played, and the last day. */
  times: number;
  last_on: string | null;
};
export type Media = MediaSummary & {
  summary: string | null;
  note: string | null;
  ids: Record<string, string>;
  copies: Copy[];
  log: LogEntry[];
  created_at: string;
  updated_at: string;
};

type MediaRow = Omit<Media, 'genres' | 'wanted' | 'formats' | 'lent_to' | 'times' | 'last_on' | 'ids' | 'copies' | 'log'> & { genres: string | null; wanted: number; ids: string | null };

const list = (text: string | null) => (text ?? '').split(',').filter(Boolean);

function parsedIds(text: string | null): Record<string, string> {
  try {
    const ids: unknown = text ? JSON.parse(text) : {};
    return ids && typeof ids === 'object' && !Array.isArray(ids) ? (ids as Record<string, string>) : {};
  } catch {
    return {};
  }
}

export function media(db: Db, owner: number, clock: Clock = () => new Date()) {
  const now = () => stamp(clock());

  async function owned(q: Queries, id: number): Promise<MediaRow> {
    const row = await q.get<MediaRow>(
      'SELECT id, type, title, creator, year, summary, genres, minutes, cover, wanted, ids, note, created_at, updated_at FROM media WHERE id = ? AND owner_id = ?', [id, owner]);
    if (!row) throw new Problem(404, 'Not found');
    return row;
  }

  async function copiesOf(q: Queries, where: string, args: Value[]): Promise<Copy[]> {
    const paths = placePaths(await q.all('SELECT id, parent_id, name, note FROM places WHERE owner_id = ?', [owner]));
    const rows = await q.all<Omit<Copy, 'place'>>(
      `SELECT c.id, c.media_id, c.format, c.place_id, c.barcode, c.lent_to, c.lent_on, c.note, c.source
       FROM media_copies c JOIN media m ON m.id = c.media_id WHERE m.owner_id = ? ${where} ORDER BY c.id`, [owner, ...args]);
    return rows.map((row) => ({ ...row, place: row.place_id !== null ? (paths.get(row.place_id) ?? null) : null }));
  }

  const logOf = (q: Queries, where: string, args: Value[]) => q.all<LogEntry>(
    `SELECT l.id, l.media_id, l.day, l.note, l.session_id, p.id AS project_id, p.name AS project
     FROM media_log l JOIN media m ON m.id = l.media_id
     LEFT JOIN project_sessions s ON s.id = l.session_id LEFT JOIN projects p ON p.id = s.project_id
     WHERE m.owner_id = ? ${where} ORDER BY l.day DESC, l.id DESC`, [owner, ...args]);

  function summary(row: MediaRow, copies: Copy[], log: LogEntry[]): MediaSummary {
    const formats: string[] = [];
    for (const copy of copies) if (!formats.some((f) => labelKey(f) === labelKey(copy.format))) formats.push(copy.format);
    return {
      id: row.id, type: row.type, title: row.title, creator: row.creator, year: row.year, genres: list(row.genres), minutes: row.minutes,
      cover: row.cover, wanted: Boolean(row.wanted), formats,
      lent_to: copies.filter((copy) => copy.lent_to).map((copy) => copy.lent_to!),
      times: log.length, last_on: log[0]?.day ?? null,
    };
  }

  async function one(q: Queries, id: number): Promise<Media> {
    const row = await owned(q, id);
    const copies = await copiesOf(q, 'AND c.media_id = ?', [id]);
    const log = await logOf(q, 'AND l.media_id = ?', [id]);
    return { ...summary(row, copies, log), summary: row.summary, note: row.note, ids: parsedIds(row.ids), copies, log, created_at: row.created_at, updated_at: row.updated_at };
  }

  /** A title's own columns, checked, in the order the SQL below names them. */
  function titleValues(input: MediaInput): Value[] {
    if (!MEDIA_TYPES.includes(input.type as MediaType)) throw new Problem(400, 'It is a film, a show, music, a book, a game, or something else');
    const title = clean(input.title, 300);
    if (!title) throw new Problem(400, 'Give it a title');
    if (input.year != null && !(Number.isInteger(input.year) && input.year >= 0 && input.year <= 9999)) throw new Problem(400, 'The year is a whole number');
    if (input.minutes != null && !(Number.isInteger(input.minutes) && input.minutes >= 0 && input.minutes <= 100_000)) throw new Problem(400, 'How long it runs is in minutes');
    const genres: string[] = [];
    for (const genre of input.genres ?? []) {
      const one = clean(genre.replaceAll(',', ' '), 40);
      if (one && !genres.some((g) => labelKey(g) === labelKey(one))) genres.push(one);
    }
    const ids: Record<string, string> = {};
    for (const [name, value] of Object.entries(input.ids ?? {})) {
      const id = clean(String(value ?? ''), 200);
      if (/^[a-z][a-z0-9_]{0,30}$/.test(name) && id) ids[name] = id;
    }
    return [
      input.type, title, clean(input.creator, 300), input.year ?? null, clean(input.summary, 5000), genres.slice(0, 20).join(',') || null,
      input.minutes ?? null, clean(input.cover, 1000), input.wanted ? 1 : 0, Object.keys(ids).length ? JSON.stringify(ids) : null, clean(input.note, 5000),
    ];
  }

  /** A copy's own columns, checked, in the order the SQL below names them. */
  async function copyValues(q: Queries, input: CopyInput): Promise<Value[]> {
    const format = clean(input.format, 40);
    if (!format) throw new Problem(400, 'Say what it is on: VHS, Blu-ray, vinyl, paperback…');
    if (input.place_id != null && !(await q.get('SELECT id FROM places WHERE id = ? AND owner_id = ?', [input.place_id, owner]))) {
      throw new Problem(404, "That place isn't there to put it in");
    }
    const lentTo = clean(input.lent_to, 100);
    const lentOn = lentTo ? (dayOrNull(input.lent_on) ?? todayOf(clock)) : null;
    return [format, input.place_id ?? null, clean(input.barcode, 40), lentTo, lentOn, clean(input.note, 1000)];
  }

  async function ownedCopy(q: Queries, id: number): Promise<{ id: number; media_id: number }> {
    const row = await q.get<{ id: number; media_id: number }>(
      'SELECT c.id, c.media_id FROM media_copies c JOIN media m ON m.id = c.media_id WHERE c.id = ? AND m.owner_id = ?', [id, owner]);
    if (!row) throw new Problem(404, 'Not found');
    return row;
  }

  async function addCopyIn(q: Queries, mediaId: number, input: CopyInput): Promise<void> {
    await q.run('INSERT INTO media_copies (media_id, format, place_id, barcode, lent_to, lent_on, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [mediaId, ...(await copyValues(q, input)), now()]);
    // Having a copy answers the wanting.
    await q.run('UPDATE media SET wanted = 0, updated_at = ? WHERE id = ?', [now(), mediaId]);
  }

  return {
    /**
     * The collection, by title. Narrowed by type, by words (in the title, who made it, or the genres), by
     * format, by place (and the places inside it), to what's wanted, or to what's out on loan.
     */
    async list(find: { type?: string | null; q?: string | null; format?: string | null; place_id?: number | null; wanted?: boolean; lent?: boolean } = {}): Promise<MediaSummary[]> {
      let where = '';
      const args: Value[] = [];
      if (find.type) {
        where += ' AND type = ?';
        args.push(find.type);
      }
      if (find.q?.trim()) {
        const like = `%${find.q.trim()}%`;
        where += ' AND (title LIKE ? OR creator LIKE ? OR genres LIKE ?)';
        args.push(like, like, like);
      }
      if (find.wanted) where += ' AND wanted = 1';
      const rows = await db.all<MediaRow>(
        `SELECT id, type, title, creator, year, summary, genres, minutes, cover, wanted, ids, note, created_at, updated_at FROM media
         WHERE owner_id = ? ${where} ORDER BY title COLLATE NOCASE, year, id`, [owner, ...args]);
      const copies = await copiesOf(db, '', []);
      const log = await logOf(db, '', []);
      let inside: Set<number> | null = null;
      if (find.place_id != null) {
        const places = await db.all<{ id: number; parent_id: number | null }>('SELECT id, parent_id FROM places WHERE owner_id = ?', [owner]);
        inside = new Set([find.place_id]);
        for (let grew = true; grew;) {
          grew = false;
          for (const place of places) {
            if (place.parent_id !== null && inside.has(place.parent_id) && !inside.has(place.id)) {
              inside.add(place.id);
              grew = true;
            }
          }
        }
      }
      const out: MediaSummary[] = [];
      for (const row of rows) {
        const mine = copies.filter((copy) => copy.media_id === row.id);
        if (find.format && !mine.some((copy) => labelKey(copy.format) === labelKey(find.format!))) continue;
        if (inside && !mine.some((copy) => copy.place_id !== null && inside!.has(copy.place_id))) continue;
        if (find.lent && !mine.some((copy) => copy.lent_to)) continue;
        out.push(summary(row, mine, log.filter((entry) => entry.media_id === row.id)));
      }
      return out;
    },

    get: (id: number) => one(db, id),

    /** A new title, with its first copy if one is given. */
    async create(input: MediaInput, copy?: CopyInput | null): Promise<Media> {
      const values = titleValues(input);
      return atomic(db, async (tx) => {
        const made = await tx.run(
          `INSERT INTO media (owner_id, type, title, creator, year, summary, genres, minutes, cover, wanted, ids, note, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [owner, ...values, now(), now()]);
        if (copy) await addCopyIn(tx, made.lastId, copy);
        return one(tx, made.lastId);
      });
    },

    async update(id: number, input: MediaInput): Promise<Media> {
      const values = titleValues(input);
      return atomic(db, async (tx) => {
        const before = await owned(tx, id);
        if (input.ids === undefined) values[9] = before.ids; // not sent: what other catalogues call it stays
        await tx.run(
          `UPDATE media SET type = ?, title = ?, creator = ?, year = ?, summary = ?, genres = ?, minutes = ?, cover = ?, wanted = ?, ids = ?, note = ?,
           updated_at = ? WHERE id = ?`, [...values, now(), id]);
        return one(tx, id);
      });
    },

    /** Remove a title, with its copies and its log. */
    async remove(id: number): Promise<void> {
      await db.run('DELETE FROM media WHERE id = ? AND owner_id = ?', [id, owner]);
    },

    // ---------- copies ----------

    async addCopy(mediaId: number, input: CopyInput): Promise<Media> {
      return atomic(db, async (tx) => {
        await owned(tx, mediaId);
        await addCopyIn(tx, mediaId, input);
        return one(tx, mediaId);
      });
    },

    /** Change a copy: move it, lend it (lent_to), or take it back (lent_to empty). */
    async updateCopy(id: number, input: CopyInput): Promise<Media> {
      return atomic(db, async (tx) => {
        const copy = await ownedCopy(tx, id);
        await tx.run('UPDATE media_copies SET format = ?, place_id = ?, barcode = ?, lent_to = ?, lent_on = ?, note = ? WHERE id = ?', [...(await copyValues(tx, input)), id]);
        return one(tx, copy.media_id);
      });
    },

    async removeCopy(id: number): Promise<Media> {
      return atomic(db, async (tx) => {
        const copy = await ownedCopy(tx, id);
        await tx.run('DELETE FROM media_copies WHERE id = ?', [id]);
        return one(tx, copy.media_id);
      });
    },

    /** The formats to offer for a type: the usual ones, then any others the person has used. */
    async formats(type: string): Promise<string[]> {
      const offered = [...(FORMATS[type as MediaType] ?? [])];
      const used = await db.all<{ format: string }>(
        'SELECT DISTINCT c.format FROM media_copies c JOIN media m ON m.id = c.media_id WHERE m.owner_id = ? AND m.type = ?', [owner, type]);
      for (const { format } of used.sort((a, b) => inOrder(a.format.toLowerCase(), b.format.toLowerCase()))) {
        if (!offered.some((f) => labelKey(f) === labelKey(format))) offered.push(format);
      }
      return offered;
    },

    // ---------- watched, read, heard, played ----------

    /** Note a day it was watched, read, heard or played; with a project session, that it kept the session company. */
    async log(mediaId: number, input: LogInput): Promise<Media> {
      dayNumber(input.day);
      return atomic(db, async (tx) => {
        await owned(tx, mediaId);
        if (input.session_id != null && !(await tx.get(
          'SELECT s.id FROM project_sessions s JOIN projects p ON p.id = s.project_id WHERE s.id = ? AND p.owner_id = ?', [input.session_id, owner]))) {
          throw new Problem(404, "That project session isn't there");
        }
        await tx.run('INSERT INTO media_log (media_id, day, note, session_id, created_at) VALUES (?, ?, ?, ?, ?)',
          [mediaId, input.day, clean(input.note, 1000), input.session_id ?? null, now()]);
        return one(tx, mediaId);
      });
    },

    async removeLog(id: number): Promise<void> {
      await db.run('DELETE FROM media_log WHERE id = ? AND media_id IN (SELECT id FROM media WHERE owner_id = ?)', [id, owner]);
    },
  };
}

export type MediaCollection = ReturnType<typeof media>;
