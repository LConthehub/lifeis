/**
 * Films, shows, music, books and games: what you own, on every format, and what you've watched, read or heard.
 *
 * A title is the work itself: Alien, Rumours, Dune. What you own of it is its copies, one for each: the VHS
 * on the shelf, the Blu-ray in the bin, the file on your media server. A copy has a format (any word you
 * like: VHS, Betamax, Vinyl, Paperback), a place (the same places your other things use), and who it's lent
 * to. A title with no copies can be marked as wanted.
 *
 * A title can also be only on a list (mediaLists.ts) or wanted: not owned. Those are kept with `listed_only` set, and
 * `list` leaves them out, so nothing that counts what is owned (the Collection, its counts and formats, the printable
 * list, the home page) sees them. Adding a copy takes the mark off.
 *
 * Each time you watch, read, listen or play is a line in the title's log, with its day. A log line can
 * belong to a project session, which is how "watched Alien while sewing" is kept.
 *
 * `media(db, owner)` is one person's collection: everything it reads and writes is theirs.
 */
import { atomic, type Db, type Queries, type Value } from './db.ts';
import { historyOf, noteHistory, noteMove, placePath, type HistoryEntry } from './history.ts';
import { placePaths } from './inventory.ts';
import { Problem } from './problem.ts';
import { attachTags, onlyTagged, unlink, type TagRef } from './tags.ts';
import { clean, dayNumber, dayOrNull, inOrder, labelKey, stamp, todayOf, type Clock } from './small.ts';

export const MEDIA_TYPES = ['film', 'show', 'music', 'book', 'game', 'other'] as const;
export type MediaType = (typeof MEDIA_TYPES)[number];

/** Formats offered for each type. Only suggestions: a format is whatever the person types. */
export const FORMATS: Record<MediaType, string[]> = {
  film: ['VHS', 'DVD', 'Blu-ray', '4K UHD', 'LaserDisc', 'Betamax', 'Digital'],
  show: ['VHS', 'DVD', 'Blu-ray', '4K UHD', 'Digital'],
  music: ['Vinyl', 'CD', 'Cassette', '8-track', 'MiniDisc', 'Digital'],
  book: ['Hardcover', 'Paperback', 'eBook', 'Audiobook', 'Book on CD', 'Book on tape'],
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
  /** What other catalogs call it: { tmdb: "348", isbn: "9780441172719" }. */
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
  /** An address that opens it where it lives: Kindle, Apple Books, a server of your own. Left out: unchanged. */
  link?: string | null;
  /** How many discs or tapes it is (1 to 999), or null for not said. Left out: unchanged. */
  pieces?: number | null;
  /** What it cost, in cents, and the day it was bought. Typed by the person. Left out: unchanged. */
  cost_cents?: number | null;
  bought_on?: string | null;
  /** What it's worth now, in cents, and the day that was noted (left out with a value set: today). Left out: unchanged. */
  value_cents?: number | null;
  valued_on?: string | null;
};

/** The most a price may be, in cents ($10,000,000.00). */
export const MAX_CENTS = 1_000_000_000;

/** Dollars as typed ("12.99", "$1,200", "5") in cents, or null when it isn't an amount with at most two decimals. */
export function centsFromDollars(text: string | null | undefined): number | null {
  const t = (text ?? '').trim().replace(/^\$\s*/, '').replace(/,/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  const [whole, part = ''] = t.split('.');
  const cents = Number(whole) * 100 + Number(part.padEnd(2, '0'));
  return Number.isSafeInteger(cents) && cents <= MAX_CENTS ? cents : null;
}

/** Cents as dollars with two decimals: 123456 is "$1,234.56". */
export function dollarsText(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}$${Math.floor(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${String(abs % 100).padStart(2, '0')}`;
}

/** A title as it is put in order: without a leading "The", "A" or "An", so "The Thing" sits under T-h-i-n-g. Only for sorting. */
export function sortWords(title: string | null | undefined): string {
  const key = labelKey(title ?? '');
  return key.replace(/^(the|an|a)\s+(?=\S)/, '');
}

export const SORTS = ['title', 'creator', 'year', 'added', 'recent', 'value'] as const;
export type SortHow = (typeof SORTS)[number];
type Sortable = Pick<MediaSummary, 'id' | 'title' | 'creator' | 'year' | 'last_on' | 'worth_cents'> & { added_at: string };

/** The titles in the order chosen. Ties fall back to title, then year, then id. Nothing is changed in the titles. */
export function sortTitles<T extends Sortable>(titles: T[], how: SortHow): T[] {
  const byTitle = (a: T, b: T) => inOrder(sortWords(a.title), sortWords(b.title)) || (a.year ?? 0) - (b.year ?? 0) || a.id - b.id;
  // Missing values always come last, whichever way the rest runs.
  const by = <V extends string | number>(value: (t: T) => V | null, down: boolean) => (a: T, b: T) => {
    const x = value(a);
    const y = value(b);
    if (x === null && y === null) return byTitle(a, b);
    if (x === null) return 1;
    if (y === null) return -1;
    return (x < y ? -1 : x > y ? 1 : 0) * (down ? -1 : 1) || byTitle(a, b);
  };
  const compare = {
    title: byTitle,
    creator: by((t) => (t.creator ? sortWords(t.creator) : null), false),
    year: by((t) => t.year, true),
    added: by((t) => t.added_at, true),
    recent: by((t) => t.last_on, true),
    value: by((t) => t.worth_cents, true),
  }[how] ?? byTitle;
  return [...titles].sort(compare);
}

type Counted = Pick<MediaSummary, 'copy_count' | 'cost_cents' | 'worth_cents' | 'unvalued' | 'gain_cents'>;
export type Totals = { titles: number; copies: number; cost_cents: number; worth_cents: number; unvalued: number; difference_cents: number };

/**
 * What a set of titles cost and are worth, in cents. A copy is worth the value typed for it, or else what it
 * cost; `unvalued` counts the copies with neither. The difference is worth less cost, over the copies that
 * have a cost (a copy with a value but no cost says nothing about what was gained).
 */
export function collectionTotals(titles: Counted[]): Totals {
  const total: Totals = { titles: titles.length, copies: 0, cost_cents: 0, worth_cents: 0, unvalued: 0, difference_cents: 0 };
  for (const t of titles) {
    total.copies += t.copy_count;
    total.cost_cents += t.cost_cents ?? 0;
    total.worth_cents += t.worth_cents ?? 0;
    total.unvalued += t.unvalued;
    total.difference_cents += t.gain_cents ?? 0;
  }
  return total;
}

/** The titles of this type that have the typed name (compared the way names are everywhere: case and spacing don't matter). */
export function sameTitles<T extends { type: string; title: string }>(titles: T[], type: string, typed: string): T[] {
  const key = labelKey(typed);
  return key ? titles.filter((t) => t.type === type && labelKey(t.title) === key) : [];
}

/**
 * The word for the pieces a copy comes in, chosen by its format: discs for CD, DVD, Blu-ray, 4K, LaserDisc and a
 * game disc; tapes for tape, cassette, VHS, Betamax and 8-track; records for vinyl, LP and record; otherwise
 * "piece". `known` is false for that last one: the copy form only shows the number for those when asked.
 * (frontend/src/pages/Media.jsx has the same function, since pages cannot import from here: keep them alike.)
 */
export function piecesWord(format: string | null | undefined): { one: string; many: string; known: boolean } {
  const f = (format ?? '').toLowerCase();
  if (/\b(cds?|dvds?|blu.?ray|4k|uhd|laser.?disc|discs?|disks?)\b/.test(f)) return { one: 'disc', many: 'discs', known: true };
  if (/tape|cassette|\bvhs\b|beta.?max|8.?track/.test(f)) return { one: 'tape', many: 'tapes', known: true };
  if (/vinyl|\blps?\b|\brecords?\b/.test(f)) return { one: 'record', many: 'records', known: true };
  return { one: 'piece', many: 'pieces', known: false };
}

/** "12 discs", or null when there is nothing to say: no number, or just the one piece. */
export function piecesText(format: string | null | undefined, pieces: number | null | undefined): string | null {
  if (pieces == null || pieces < 2) return null;
  return `${pieces} ${piecesWord(format).many}`;
}

/**
 * A link as it's kept: a web address, or one of the few app addresses reading apps answer to. Anything else
 * (a script, a file) is refused.
 */
export function openLink(given: string | null | undefined): string | null {
  const text = given?.trim();
  if (!text) return null;
  if (text.length > 600 || !/^(https?|kindle|ibooks|applebooks|audible):/i.test(text) || /[\s<>"]/.test(text)) {
    throw new Problem(400, 'A link starts with https:// (or kindle:// or ibooks://)');
  }
  return text;
}
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
  /** An address that opens it where it lives. */
  link: string | null;
  /** How many discs or tapes it is, or null when not said (and for every copy brought in). */
  pieces: number | null;
  /** What it cost and when it was bought; what it's worth now and the day that was noted. All typed by the person, in cents. */
  cost_cents: number | null;
  bought_on: string | null;
  value_cents: number | null;
  valued_on: string | null;
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
  /** Not owned: only on a list, or wanted, with no copy yet. Such a title is left out of `list`. */
  unowned: boolean;
  /** The formats you have it on, each once: ["VHS", "Blu-ray"]. */
  formats: string[];
  /** How many discs or tapes, for each format in `formats` that has a copy saying so (the most, if two do): { "Book on CD": 12 }. */
  pieces: Record<string, number>;
  /** Who has a copy on loan, if anyone. */
  lent_to: string[];
  /** How many times it's been watched, read, heard or played, and the last day. */
  times: number;
  last_on: string | null;
  /** The day it was added to the collection, as a timestamp. */
  added_at: string;
  /** How many copies, what they cost in all (null if no copy says), and what they are worth (each copy's value, else its cost). */
  copy_count: number;
  cost_cents: number | null;
  worth_cents: number | null;
  /** How many copies have neither a cost nor a value. */
  unvalued: number;
  /** Worth less cost, over the copies that have a cost (null if none does). */
  gain_cents: number | null;
  tag_list: TagRef[];
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

type MediaRow = Omit<Media, 'genres' | 'wanted' | 'unowned' | 'formats' | 'pieces' | 'lent_to' | 'times' | 'last_on' | 'ids' | 'copies' | 'log' | 'added_at' | 'copy_count' | 'cost_cents' | 'worth_cents' | 'unvalued' | 'gain_cents' | 'tag_list'> & { genres: string | null; wanted: number; listed_only: number; ids: string | null };

const list = (text: string | null) => (text ?? '').split(',').filter(Boolean);

function parsedIds(text: string | null): Record<string, string> {
  try {
    const ids: unknown = text ? JSON.parse(text) : {};
    return ids && typeof ids === 'object' && !Array.isArray(ids) ? (ids as Record<string, string>) : {};
  } catch {
    return {};
  }
}

export type BarcodeMatch = { id: number; title: string; type: string; year: number | null; format: string };

/**
 * A barcode as two are compared: without spaces or dashes, and with the American 12-digit form (UPC) made the
 * same as its 13-digit form (EAN), which is the same code with a 0 in front. Scanners report either.
 */
export function barcodeKey(code: string): string {
  const plain = code.replace(/[\s-]/g, '').toUpperCase();
  return /^\d{12}$/.test(plain) ? `0${plain}` : plain;
}

export function media(db: Db, owner: number, clock: Clock = () => new Date()) {
  const now = () => stamp(clock());

  async function owned(q: Queries, id: number): Promise<MediaRow> {
    const row = await q.get<MediaRow>(
      'SELECT id, type, title, creator, year, summary, genres, minutes, cover, wanted, listed_only, ids, note, created_at, updated_at FROM media WHERE id = ? AND owner_id = ?', [id, owner]);
    if (!row) throw new Problem(404, 'Not found');
    return row;
  }

  async function copiesOf(q: Queries, where: string, args: Value[]): Promise<Copy[]> {
    const paths = placePaths(await q.all('SELECT id, parent_id, name, note FROM places WHERE owner_id = ?', [owner]));
    const rows = await q.all<Omit<Copy, 'place'>>(
      `SELECT c.id, c.media_id, c.format, c.place_id, c.barcode, c.lent_to, c.lent_on, c.note, c.source, c.link, c.pieces,
         c.cost_cents, c.bought_on, c.value_cents, c.valued_on
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
    const pieces: Record<string, number> = {};
    for (const copy of copies) {
      const shown = formats.find((f) => labelKey(f) === labelKey(copy.format))!;
      if (copy.pieces !== null && copy.pieces > (pieces[shown] ?? 0)) pieces[shown] = copy.pieces;
    }
    return {
      id: row.id, type: row.type, title: row.title, creator: row.creator, year: row.year, genres: list(row.genres), minutes: row.minutes,
      cover: row.cover, wanted: Boolean(row.wanted), unowned: row.listed_only === 1, formats, pieces,
      lent_to: copies.filter((copy) => copy.lent_to).map((copy) => copy.lent_to!),
      times: log.length, last_on: log[0]?.day ?? null,
      added_at: row.created_at, copy_count: copies.length,
      cost_cents: copies.some((c) => c.cost_cents !== null) ? copies.reduce((sum, c) => sum + (c.cost_cents ?? 0), 0) : null,
      worth_cents: copies.some((c) => (c.value_cents ?? c.cost_cents) !== null) ? copies.reduce((sum, c) => sum + (c.value_cents ?? c.cost_cents ?? 0), 0) : null,
      unvalued: copies.filter((c) => c.value_cents === null && c.cost_cents === null).length,
      gain_cents: copies.some((c) => c.cost_cents !== null) ? copies.reduce((sum, c) => sum + (c.cost_cents !== null ? (c.value_cents ?? c.cost_cents) - c.cost_cents : 0), 0) : null,
      tag_list: [],
    };
  }

  async function one(q: Queries, id: number): Promise<Media> {
    const row = await owned(q, id);
    const copies = await copiesOf(q, 'AND c.media_id = ?', [id]);
    const log = await logOf(q, 'AND l.media_id = ?', [id]);
    const tag_list = (await attachTags(q, owner, 'title', [{ id }]))[0]!.tag_list;
    return { ...summary(row, copies, log), tag_list, summary: row.summary, note: row.note, ids: parsedIds(row.ids), copies, log, created_at: row.created_at, updated_at: row.updated_at };
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

  /** How many pieces, checked: a whole number from 1 to 999, or nothing. */
  function checkedPieces(pieces: number | null): number | null {
    if (pieces == null) return null;
    if (!Number.isInteger(pieces) || pieces < 1 || pieces > 999) throw new Problem(400, 'How many discs or tapes is a whole number from 1 to 999');
    return pieces;
  }

  /** What a copy cost and is worth, checked. Only the parts sent are returned: left out means unchanged. */
  function checkedMoney(input: CopyInput): Record<string, number | string | null> {
    const out: Record<string, number | string | null> = {};
    for (const name of ['cost_cents', 'value_cents'] as const) {
      const cents = input[name];
      if (cents === undefined) continue;
      if (cents !== null && !(Number.isInteger(cents) && cents >= 0 && cents <= MAX_CENTS)) throw new Problem(400, 'A price is dollars and cents, like 12.99');
      out[name] = cents;
    }
    if (input.bought_on !== undefined) out.bought_on = dayOrNull(input.bought_on);
    if (input.valued_on !== undefined) out.valued_on = dayOrNull(input.valued_on);
    // A worth with no day says today; no worth has no day.
    if (out.value_cents === null) out.valued_on = null;
    else if (out.value_cents !== undefined && !out.valued_on) out.valued_on = todayOf(clock);
    return out;
  }

  async function saveMoney(q: Queries, copyId: number, input: CopyInput): Promise<void> {
    const money = checkedMoney(input);
    const names = Object.keys(money);
    if (names.length) await q.run(`UPDATE media_copies SET ${names.map((n) => `${n} = ?`).join(', ')} WHERE id = ?`, [...Object.values(money), copyId]);
  }

  async function ownedCopy(q: Queries, id: number): Promise<{ id: number; media_id: number }> {
    const row = await q.get<{ id: number; media_id: number }>(
      'SELECT c.id, c.media_id FROM media_copies c JOIN media m ON m.id = c.media_id WHERE c.id = ? AND m.owner_id = ?', [id, owner]);
    if (!row) throw new Problem(404, 'Not found');
    return row;
  }

  async function addCopyIn(q: Queries, mediaId: number, input: CopyInput): Promise<void> {
    const pieces = checkedPieces(input.pieces ?? null);
    checkedMoney(input); // refused before anything is written
    const made = await q.run('INSERT INTO media_copies (media_id, format, place_id, barcode, lent_to, lent_on, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [mediaId, ...(await copyValues(q, input)), now()]);
    if (pieces !== null) await q.run('UPDATE media_copies SET pieces = ? WHERE id = ?', [pieces, made.lastId]);
    if (input.link !== undefined) await q.run('UPDATE media_copies SET link = ? WHERE id = ?', [openLink(input.link), made.lastId]);
    await saveMoney(q, made.lastId, input);
    await noteHistory(q, owner, { copy_id: made.lastId }, { what: 'added', to_place: await placePath(q, owner, input.place_id), day: todayOf(clock), at: now() });
    // Having a copy answers the wanting.
    await q.run('UPDATE media SET wanted = 0, listed_only = 0, updated_at = ? WHERE id = ?', [now(), mediaId]);
  }

  return {
    /** The titles you have a copy of with this barcode, and which copy it is. */
    async findBarcode(code: string): Promise<BarcodeMatch[]> {
      const wanted = barcodeKey(code);
      if (!wanted) throw new Problem(400, 'Scan or type a barcode');
      const rows = await db.all<BarcodeMatch & { barcode: string }>(
        `SELECT m.id, m.title, m.type, m.year, c.format, c.barcode FROM media_copies c JOIN media m ON m.id = c.media_id
         WHERE m.owner_id = ? AND c.barcode IS NOT NULL ORDER BY m.title COLLATE NOCASE, c.id`, [owner]);
      return rows.filter((row) => barcodeKey(row.barcode) === wanted).map(({ id, title, type, year, format }) => ({ id, title, type, year, format }));
    },

    /**
     * The collection, by title. Narrowed by type, by words (in the title, who made it, or the genres), by
     * format, by place (and the places inside it), to what's wanted, or to what's out on loan.
     */
    async list(find: { type?: string | null; q?: string | null; format?: string | null; place_id?: number | null; wanted?: boolean; lent?: boolean; tag?: number | null } = {}): Promise<MediaSummary[]> {
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
      // A title that is only on a list, or wanted, is not owned: it stays out unless wanted is what was asked for.
      if (find.wanted) where += ' AND wanted = 1';
      else where += ' AND listed_only = 0';
      const rows = await db.all<MediaRow>(
        `SELECT id, type, title, creator, year, summary, genres, minutes, cover, wanted, listed_only, ids, note, created_at, updated_at FROM media
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
      return attachTags(db, owner, 'title', await onlyTagged(db, owner, 'title', out, find.tag));
    },

    get: (id: number) => one(db, id),

    /** How many titles are marked wanted (the Wanted list). */
    async wantedCount(): Promise<number> {
      return (await db.get<{ n: number }>('SELECT COUNT(*) AS n FROM media WHERE owner_id = ? AND wanted = 1', [owner]))!.n;
    },

    /** A new title, with its first copy if one is given. */
    async create(input: MediaInput, copy?: CopyInput | null): Promise<Media> {
      const values = titleValues(input);
      return atomic(db, async (tx) => {
        // The same title already kept on a list (not owned) is the one that gets the copy, not a second one.
        const key = labelKey(values[1] as string);
        const same = (await tx.all<{ id: number; title: string; wanted: number }>('SELECT id, title, wanted FROM media WHERE owner_id = ? AND type = ? AND listed_only = 1', [owner, input.type])).find((r) => labelKey(r.title) === key);
        let id: number;
        if (same) {
          id = same.id;
          values[8] = input.wanted ? 1 : same.wanted;
          await tx.run(
            `UPDATE media SET type = ?, title = ?, creator = ?, year = ?, summary = ?, genres = ?, minutes = ?, cover = ?, wanted = ?, ids = ?, note = ?, updated_at = ? WHERE id = ?`,
            [...values, now(), id]);
        } else {
          id = (await tx.run(
            `INSERT INTO media (owner_id, type, title, creator, year, summary, genres, minutes, cover, wanted, ids, note, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [owner, ...values, now(), now()])).lastId;
          if (input.wanted && !copy) await tx.run('UPDATE media SET listed_only = 1 WHERE id = ?', [id]);
        }
        if (copy) await addCopyIn(tx, id, copy);
        return one(tx, id);
      });
    },

    async update(id: number, input: MediaInput): Promise<Media> {
      const values = titleValues(input);
      return atomic(db, async (tx) => {
        const before = await owned(tx, id);
        if (input.ids === undefined) values[9] = before.ids; // not sent: what other catalogs call it stays
        if (input.wanted === undefined) values[8] = before.wanted; // not said: wanted stays as the Wanted list has it
        await tx.run(
          `UPDATE media SET type = ?, title = ?, creator = ?, year = ?, summary = ?, genres = ?, minutes = ?, cover = ?, wanted = ?, ids = ?, note = ?,
           updated_at = ? WHERE id = ?`, [...values, now(), id]);
        // Wanted with no copy is not owned.
        if (values[8] === 1 && !(await tx.get('SELECT id FROM media_copies WHERE media_id = ?', [id]))) await tx.run('UPDATE media SET listed_only = 1 WHERE id = ?', [id]);
        return one(tx, id);
      });
    },

    /** Remove a title, with its copies and its log. */
    async remove(id: number): Promise<void> {
      await db.run('DELETE FROM media WHERE id = ? AND owner_id = ?', [id, owner]);
      await unlink(db, 'title', id);
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
        const pieces = input.pieces === undefined ? undefined : checkedPieces(input.pieces);
        const was = (await tx.get<{ place_id: number | null }>('SELECT place_id FROM media_copies WHERE id = ?', [id]))!.place_id;
        if (pieces !== undefined) await tx.run('UPDATE media_copies SET pieces = ? WHERE id = ?', [pieces, id]);
        await tx.run('UPDATE media_copies SET format = ?, place_id = ?, barcode = ?, lent_to = ?, lent_on = ?, note = ? WHERE id = ?', [...(await copyValues(tx, input)), id]);
        if (input.link !== undefined) await tx.run('UPDATE media_copies SET link = ? WHERE id = ?', [openLink(input.link), id]);
        await saveMoney(tx, id, input);
        await noteMove(tx, owner, { copy_id: id }, was, input.place_id ?? null, { day: todayOf(clock), at: now() });
        return one(tx, copy.media_id);
      });
    },

    /** Put a copy somewhere else, keeping where it was in its history. */
    async moveCopy(id: number, placeId: number | null): Promise<Media> {
      return atomic(db, async (tx) => {
        const copy = await ownedCopy(tx, id);
        if (placeId !== null && !(await tx.get('SELECT id FROM places WHERE id = ? AND owner_id = ?', [placeId, owner]))) {
          throw new Problem(404, "That place isn't there to put it in");
        }
        const was = (await tx.get<{ place_id: number | null }>('SELECT place_id FROM media_copies WHERE id = ?', [id]))!.place_id;
        if (await noteMove(tx, owner, { copy_id: id }, was, placeId, { day: todayOf(clock), at: now() })) {
          await tx.run('UPDATE media_copies SET place_id = ? WHERE id = ?', [placeId, id]);
        }
        return one(tx, copy.media_id);
      });
    },

    /** Everything that happened to one copy, newest first. */
    async copyHistory(id: number): Promise<HistoryEntry[]> {
      await ownedCopy(db, id);
      return historyOf(db, owner, { copy_id: id });
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
        // Watched, read or heard: it is no longer something to watch, read or hear.
        await tx.run("DELETE FROM media_list_items WHERE media_id = ? AND list_id IN (SELECT id FROM media_lists WHERE owner_id = ? AND builtin = 'to_watch')", [mediaId, owner]);
        return one(tx, mediaId);
      });
    },

    /** The title's cover, if Life Is keeps one: the picture's bytes and what kind of picture it is. */
    async cover(id: number): Promise<{ type: string; bytes: Uint8Array } | null> {
      const row = await db.get<{ type: string; bytes: Uint8Array }>(
        'SELECT c.type, c.bytes FROM media_covers c JOIN media m ON m.id = c.media_id WHERE c.media_id = ? AND m.owner_id = ?', [id, owner]);
      return row ? { type: row.type, bytes: row.bytes } : null;
    },

    async removeLog(id: number): Promise<void> {
      await db.run('DELETE FROM media_log WHERE id = ? AND media_id IN (SELECT id FROM media WHERE owner_id = ?)', [id, owner]);
    },
  };
}

export type MediaCollection = ReturnType<typeof media>;
