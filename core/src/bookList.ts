/**
 * A list of books brought in at once, for the libraries nothing can read for you: Kindle, Apple Books and
 * Google Play Books offer no way in, but a list can be had from Goodreads (My Books, Import and export),
 * StoryGraph or a spreadsheet, or simply typed.
 *
 * Two shapes are read:
 *   - A table saved as CSV, whose first line names its columns. Title is needed; Author, ISBN, Year, the
 *     shelf (read, to-read), the day it was read and the binding are used when they're there.
 *   - Plain lines, one book each: "Dune by Frank Herbert", or just "Dune".
 *
 * Nothing is looked up and nothing leaves the device. A book already in the collection (by ISBN, or by title
 * and author) isn't added twice, so the same list can be brought in again after it grows.
 */
import { atomic, type Db } from './db.ts';
import { barcodeKey, centsFromDollars, MEDIA_TYPES, type MediaType } from './media.ts';
import { Problem } from './problem.ts';
import { clean, dayOrNull, labelKey, stamp, todayOf, type Clock } from './small.ts';

export type ListedBook = {
  title: string; creator: string | null; year: number | null; isbn: string | null;
  /** What the list says of it: read, being read, or wanted. */
  shelf: 'read' | 'reading' | 'to-read' | null;
  /** The day it was finished, as 2046-03-05. */
  read_on: string | null;
  /** What the list says it's on, as Life Is words it: eBook, Audiobook, Hardcover, Paperback. */
  format: string | null;
};

const MAX_BOOKS = 5000;

/** A CSV table as rows of cells: quoted cells may hold commas, line breaks and doubled quotes. */
export function csvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const body = text.replace(/^﻿/, '');
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i]!;
    if (quoted) {
      if (ch === '"' && body[i + 1] === '"') { cell += '"'; i += 1; } else if (ch === '"') quoted = false; else cell += ch;
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && body[i + 1] === '\n') i += 1;
      row.push(cell); cell = '';
      if (row.some((c) => c.trim())) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim())) rows.push(row);
  return rows;
}

// Goodreads writes an ISBN as ="0441172717" so spreadsheets leave it alone.
const bare = (cell: string | undefined) => (cell ?? '').trim().replace(/^="?(.*?)"?$/, '$1').trim();
const isbnOf = (cell: string | undefined): string | null => {
  const digits = bare(cell).replace(/[-\s]/g, '').toUpperCase();
  return /^(97[89]\d{10}|\d{9}[\dX])$/.test(digits) ? digits : null;
};
const yearOf = (cell: string | undefined): number | null => {
  const found = /\b(1[0-9]|20)\d{2}\b/.exec(bare(cell))?.[0];
  return found ? Number(found) : null;
};
/** A day however the list wrote it: 2024/03/05, 2024-03-05, 3/5/2024. */
const dayOf = (cell: string | undefined): string | null => {
  const text = bare(cell);
  const ymd = /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})/.exec(text);
  if (ymd) return dayOrNull(`${ymd[1]}-${ymd[2]!.padStart(2, '0')}-${ymd[3]!.padStart(2, '0')}`);
  const mdy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(text);
  return mdy ? dayOrNull(`${mdy[3]}-${mdy[1]!.padStart(2, '0')}-${mdy[2]!.padStart(2, '0')}`) : null;
};
const shelfOf = (cell: string | undefined): ListedBook['shelf'] => {
  const key = labelKey(bare(cell)).replace(/[\s_]+/g, '-');
  if (key === 'read' || key === 'finished') return 'read';
  if (key === 'currently-reading' || key === 'reading') return 'reading';
  if (key === 'to-read' || key === 'want-to-read' || key === 'wishlist' || key === 'wanted') return 'to-read';
  return null;
};
/** What a list calls the binding, as Life Is words it. */
export function formatOf(binding: string | undefined): string | null {
  const key = labelKey(bare(binding));
  if (!key) return null;
  if (/audio|audible/.test(key)) return 'Audiobook';
  if (/kindle|e-?book|epub|nook|kobo|digital/.test(key)) return 'eBook';
  if (/hard/.test(key)) return 'Hardcover';
  if (/paper|softcover|mass market/.test(key)) return 'Paperback';
  return null;
}

// What each column is called, across the lists people have: Goodreads, StoryGraph, LibraryThing, a spreadsheet.
const COLUMNS: Record<string, string[]> = {
  title: ['title', 'book title', 'name'],
  creator: ['author', 'authors', 'author l-f', 'primary author', 'creator', 'by'],
  isbn13: ['isbn13', 'isbn 13', 'isbn/uid'],
  isbn: ['isbn', 'isbn10', 'isbn 10', 'isbns'],
  year: ['original publication year', 'year published', 'year', 'published', 'date', 'publication year'],
  shelf: ['exclusive shelf', 'read status', 'status', 'shelf', 'bookshelves'],
  read_on: ['date read', 'last date read', 'date finished', 'finished', 'dates read'],
  format: ['binding', 'format', 'media'],
};

/** A pasted or uploaded list, read. `skipped` counts lines with no title on them. */
export function readBookList(text: string): { books: ListedBook[]; skipped: number } {
  if (typeof text !== 'string' || !text.trim()) throw new Problem(400, 'Paste a list of books, or choose a file');
  if (text.length > 5_000_000) throw new Problem(400, 'That list is too large');
  const rows = csvRows(text);
  const head = (rows[0] ?? []).map((c) => labelKey(c));
  const find = (names: string[]) => names.map((n) => head.indexOf(n)).find((i) => i >= 0) ?? -1;
  const at = Object.fromEntries(Object.entries(COLUMNS).map(([key, names]) => [key, find(names)])) as Record<keyof typeof COLUMNS, number>;
  const books: ListedBook[] = [];
  let skipped = 0;
  if (at.title! >= 0 && head.length > 1) {
    for (const row of rows.slice(1)) {
      const title = clean(bare(row[at.title!]), 300);
      if (!title) { skipped += 1; continue; }
      // "Herbert, Frank" as LibraryThing writes it is turned the usual way round.
      let creator = clean(bare(row[at.creator!]), 300);
      if (creator && head[at.creator!] === 'author l-f' && creator.split(',').length === 2) creator = creator.split(',').map((p) => p.trim()).reverse().join(' ');
      books.push({
        title, creator, year: yearOf(row[at.year!]), isbn: isbnOf(row[at.isbn13!]) ?? isbnOf(row[at.isbn!]),
        shelf: shelfOf(row[at.shelf!]), read_on: dayOf(row[at.read_on!]), format: formatOf(row[at.format!]),
      });
    }
  } else {
    // Plain lines: "Title by Author", "Title - Author", or a title alone.
    for (const line of text.replace(/^﻿/, '').split(/\r?\n/)) {
      const words = line.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '').trim();
      if (!words) continue;
      const split = /^(.+?)\s+by\s+(.+)$/i.exec(words) ?? /^(.+?)\s+[–—-]\s+(.+)$/.exec(words) ?? /^(.+?)\t+(.+)$/.exec(words);
      const title = clean(split ? split[1] : words, 300);
      if (!title) { skipped += 1; continue; }
      books.push({ title, creator: split ? clean(split[2], 300) : null, year: null, isbn: null, shelf: null, read_on: null, format: null });
    }
  }
  if (books.length === 0) throw new Problem(400, "No books were found in that. A table needs a column called Title; otherwise put one book on each line, like \"Dune by Frank Herbert\".");
  if (books.length > MAX_BOOKS) throw new Problem(400, `That's more than ${MAX_BOOKS} books. Import it as two lists.`);
  return { books, skipped };
}

export type ListChoices = {
  /** What they're all on ("eBook", "Kindle", "Audiobook"). Empty: what the list says of each, and where it says nothing, `otherwise`. */
  format?: string | null;
  /** What a book is on when neither you nor the list says. */
  otherwise?: string | null;
  /** Books on the list's to-read shelf become books you want, with no copy. Otherwise they're brought in like the rest. */
  to_read_as_wanted?: boolean;
  /** The days the list says books were read go into each book's log. */
  log_read?: boolean;
};
export type ListResult = { listed: number; added: number; copies: number; already: number; wanted: number; logged: number };

/** Bring a read list into the collection. One change: a list that can't all be brought in changes nothing. */
export async function importBookList(db: Db, owner: number, clock: Clock, books: ListedBook[], choices: ListChoices = {}): Promise<ListResult> {
  const all = clean(choices.format, 60);
  const otherwise = clean(choices.otherwise, 60) ?? 'eBook';
  const now = stamp(clock());
  const today = todayOf(clock);
  const result: ListResult = { listed: books.length, added: 0, copies: 0, already: 0, wanted: 0, logged: 0 };
  return atomic(db, async (tx) => {
    const titles = await tx.all<{ id: number; title: string; creator: string | null; ids: string | null }>(
      "SELECT id, title, creator, ids FROM media WHERE owner_id = ? AND type = 'book'", [owner]);
    const byIsbn = new Map<string, number>();
    const byName = new Map<string, number>();
    // "Dune (Dune Chronicles, #1)" and "Dune" are the same book: what's in the last brackets is left out.
    const nameKey = (title: string, creator: string | null) => `${labelKey(title.replace(/\s*\([^)]*\)\s*$/, ''))}|${labelKey((creator ?? '').split(',')[0]!)}`;
    for (const t of titles) {
      try { const isbn = (JSON.parse(t.ids ?? '{}') as Record<string, string>).isbn; if (isbn) byIsbn.set(isbn, t.id); } catch { /* not matched on */ }
      if (!byName.has(nameKey(t.title, t.creator))) byName.set(nameKey(t.title, t.creator), t.id);
    }
    const formats = new Map<number, Set<string>>();
    for (const c of await tx.all<{ media_id: number; format: string }>(
      'SELECT c.media_id, c.format FROM media_copies c JOIN media m ON m.id = c.media_id WHERE m.owner_id = ?', [owner])) {
      if (!formats.has(c.media_id)) formats.set(c.media_id, new Set());
      formats.get(c.media_id)!.add(labelKey(c.format));
    }
    for (const book of books) {
      const wanted = Boolean(choices.to_read_as_wanted) && book.shelf === 'to-read';
      let id = (book.isbn ? byIsbn.get(book.isbn) : undefined) ?? byName.get(nameKey(book.title, book.creator));
      // A title with no author on the list matches one of that name, whoever wrote it.
      if (id === undefined && !book.creator) id = titles.find((t) => nameKey(t.title, null) === nameKey(book.title, null))?.id;
      const fresh = id === undefined;
      if (id === undefined) {
        id = (await tx.run(
          `INSERT INTO media (owner_id, type, title, creator, year, wanted, ids, created_at, updated_at) VALUES (?, 'book', ?, ?, ?, ?, ?, ?, ?)`,
          [owner, book.title, book.creator, book.year, wanted ? 1 : 0, book.isbn ? JSON.stringify({ isbn: book.isbn }) : null, now, now])).lastId;
        if (book.isbn) byIsbn.set(book.isbn, id);
        byName.set(nameKey(book.title, book.creator), id);
        titles.push({ id, title: book.title, creator: book.creator, ids: null });
        formats.set(id, new Set());
        result.added += 1;
        if (wanted) result.wanted += 1;
      }
      if (!wanted) {
        const format = all ?? book.format ?? otherwise;
        const have = formats.get(id) ?? new Set<string>();
        if (have.has(labelKey(format))) {
          if (!fresh) result.already += 1;
        } else {
          await tx.run('INSERT INTO media_copies (media_id, format, source, created_at) VALUES (?, ?, ?, ?)', [id, format, 'list', now]);
          await tx.run('UPDATE media SET wanted = 0 WHERE id = ? AND wanted = 1', [id]);
          have.add(labelKey(format));
          formats.set(id, have);
          result.copies += 1;
        }
      } else if (!fresh) result.already += 1;
      if (choices.log_read && book.shelf !== 'to-read' && (book.read_on || book.shelf === 'read')) {
        const day = book.read_on ?? today;
        // Only a day the list gives is logged; "read, some time" isn't a day.
        if (book.read_on && !(await tx.get('SELECT id FROM media_log WHERE media_id = ? AND day = ?', [id, day]))) {
          await tx.run('INSERT INTO media_log (media_id, day, created_at) VALUES (?, ?, ?)', [id, day, now]);
          result.logged += 1;
        }
      }
    }
    return result;
  });
}

// ====================================================================================================
// A list of anything: films, shows, music, books, games. The same two shapes (a CSV table, or lines), and
// the owner's old collection app is the main case. Its export's column names are not known for certain, so
// a column is matched by what it's called with case, spaces and punctuation ignored, under any of the names
// people give it. What was understood and what was left alone is told back, so a person sees it at a glance.
// ====================================================================================================

export type ListedTitle = {
  type: MediaType; title: string; creator: string | null; year: number | null; format: string | null; barcode: string | null;
  cost_cents: number | null; bought_on: string | null; value_cents: number | null; valued_on: string | null;
  note: string | null; genres: string[]; minutes: number | null; wanted: boolean;
};
export type ColumnReport = { understood: { column: string; as: string }[]; ignored: string[] };
export type ReadList = { items: ListedTitle[]; skipped: number; columns: ColumnReport | null; types: Partial<Record<MediaType, number>>; says_format: number; wanted: number };

const plain = (name: string) => name.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

/** What a Type (or Media) cell says it is, and the format that word also names ("Blu-ray" is a film on Blu-ray). */
export function typeWord(cell: string | undefined): { type: MediaType; format: string | null } | null {
  const w = plain(bare(cell));
  if (!w) return null;
  const known: Record<string, [MediaType, string | null]> = {
    film: ['film', null], films: ['film', null], movie: ['film', null], movies: ['film', null], dvd: ['film', 'DVD'], dvds: ['film', 'DVD'],
    bluray: ['film', 'Blu-ray'], blurays: ['film', 'Blu-ray'], bd: ['film', 'Blu-ray'], '4k': ['film', '4K UHD'], '4kuhd': ['film', '4K UHD'], uhd: ['film', '4K UHD'],
    vhs: ['film', 'VHS'], laserdisc: ['film', 'LaserDisc'], show: ['show', null], shows: ['show', null], tv: ['show', null], tvshow: ['show', null],
    tvshows: ['show', null], series: ['show', null], television: ['show', null],
    music: ['music', null], album: ['music', null], albums: ['music', null], cd: ['music', 'CD'], cds: ['music', 'CD'], vinyl: ['music', 'Vinyl'],
    lp: ['music', 'Vinyl'], record: ['music', 'Vinyl'], records: ['music', 'Vinyl'], cassette: ['music', 'Cassette'], audio: ['music', null],
    game: ['game', null], games: ['game', null], videogame: ['game', null], videogames: ['game', null], boardgame: ['game', 'Board game'],
    book: ['book', null], books: ['book', null], novel: ['book', null], ebook: ['book', 'eBook'], audiobook: ['book', 'Audiobook'],
    other: ['other', null],
  };
  const hit = known[w];
  return hit ? { type: hit[0], format: hit[1] } : null;
}

type Field = 'title' | 'creator' | 'year' | 'type' | 'typeOrFormat' | 'format' | 'barcode' | 'cost' | 'value' | 'bought_on' | 'valued_on' | 'note' | 'wanted' | 'genres' | 'minutes';
const FIELD_NAMES: Record<Field, string> = {
  title: 'Title', creator: 'Creator', year: 'Year', type: 'Type', typeOrFormat: 'Type or format', format: 'Format', barcode: 'Barcode', cost: 'Price paid',
  value: 'Value', bought_on: 'Day bought', valued_on: 'Day valued', note: 'Notes', wanted: 'Wanted', genres: 'Genres', minutes: 'Minutes',
};
// Every name a column goes by, written the way `plain` writes it.
const ALIASES: Record<Field, string[]> = {
  title: ['title', 'name', 'itemtitle', 'itemname', 'item', 'movietitle', 'filmtitle', 'albumtitle', 'booktitle', 'gametitle', 'album', 'movie', 'film', 'game', 'book'],
  creator: ['creator', 'director', 'directedby', 'artist', 'author', 'authors', 'by', 'maker', 'madeby', 'band', 'performer', 'developer', 'studio', 'primaryauthor', 'artistname'],
  year: ['year', 'releaseyear', 'yearreleased', 'released', 'releasedate', 'release', 'publicationyear', 'yearpublished', 'originalpublicationyear', 'date', 'published'],
  type: ['type', 'mediatype', 'itemtype', 'kind', 'category', 'collection', 'collectiontype'],
  typeOrFormat: ['media', 'medium'],
  format: ['format', 'edition', 'binding', 'discformat', 'mediaformat', 'packaging', 'version'],
  barcode: ['barcode', 'upc', 'ean', 'upcean', 'eanupc', 'isbn', 'isbn13', 'isbn10', 'ean13', 'gtin', 'upccode', 'barcodenumber', 'code'],
  cost: ['pricepaid', 'price', 'cost', 'paid', 'purchaseprice', 'amountpaid', 'paidprice', 'purchasecost', 'costpaid', 'pricepaidusd'],
  value: ['value', 'currentvalue', 'worth', 'estimatedvalue', 'marketvalue', 'valuenow', 'currentprice', 'estimatedworth'],
  bought_on: ['purchasedate', 'datepurchased', 'dateofpurchase', 'bought', 'boughton', 'dateacquired', 'acquired', 'purchaseddate', 'datebought', 'acquisitiondate'],
  valued_on: ['valuedate', 'valuedon', 'datevalued', 'valuationdate', 'valueasof'],
  note: ['notes', 'note', 'comments', 'comment', 'remarks', 'mynotes'],
  wanted: ['wanted', 'wishlist', 'wish', 'wantlist', 'onwishlist', 'wanttobuy', 'want', 'status'],
  genres: ['genre', 'genres', 'subgenre'],
  minutes: ['runtime', 'runningtime', 'minutes', 'length', 'duration'],
};

const moneyOf = (cell: string | undefined): number | null => {
  const text = bare(cell).replace(/[^\d.]/g, '');
  return text ? centsFromDollars(text) : null;
};
const wantedOf = (cell: string | undefined): boolean => {
  const key = labelKey(bare(cell));
  if (!key || /^(no|n|false|0|owned|own|have|collection)$/.test(key)) return false;
  return /^(y|yes|true|1|x)$/.test(key) || /wish|want/.test(key);
};

/** A pasted or uploaded list of anything, read. `type` is what a line is when the list doesn't say. */
export function readMediaList(text: string, type: string = 'film'): ReadList {
  if (typeof text !== 'string' || !text.trim()) throw new Problem(400, 'Paste a list, or choose a file');
  if (text.length > 5_000_000) throw new Problem(400, 'That list is too large');
  const fallback = (MEDIA_TYPES as readonly string[]).includes(type) ? (type as MediaType) : 'film';
  const rows = csvRows(text);
  const headers = (rows[0] ?? []).map((c) => c.trim());
  const heads = headers.map(plain);
  // The first column called by each field's names; a later column with the same job is left alone, and said so.
  const at: Partial<Record<Field, number>> = {};
  const used = new Set<number>();
  for (const field of Object.keys(ALIASES) as Field[]) {
    for (const alias of ALIASES[field]) {
      const i = heads.findIndex((h, n) => h === alias && !used.has(n));
      if (i >= 0) { at[field] = i; used.add(i); break; }
    }
  }
  const items: ListedTitle[] = [];
  const types: Partial<Record<MediaType, number>> = {};
  let skipped = 0;
  const isTable = at.title !== undefined && heads.length > 1;
  let columns: ColumnReport | null = null;
  const cell = (row: string[], field: Field) => (at[field] === undefined ? undefined : row[at[field]!]);
  if (isTable) {
    columns = {
      understood: (Object.keys(at) as Field[]).map((f) => ({ column: headers[at[f]!]!, as: FIELD_NAMES[f], at: at[f]! })).sort((a, b) => a.at - b.at).map(({ column, as }) => ({ column, as })),
      ignored: headers.filter((h, i) => h && !used.has(i)),
    };
    for (const row of rows.slice(1)) {
      const title = clean(bare(cell(row, 'title')), 300);
      if (!title) { skipped += 1; continue; }
      const kind = typeWord(cell(row, 'type')) ?? typeWord(cell(row, 'typeOrFormat'));
      const said = clean(bare(cell(row, 'format')), 40) ?? (typeWord(cell(row, 'typeOrFormat')) ? null : clean(bare(cell(row, 'typeOrFormat')), 40));
      const genres = bare(cell(row, 'genres')).split(/[,;/|]/).map((g) => clean(g, 40)).filter((g): g is string => Boolean(g));
      const minutes = Number(bare(cell(row, 'minutes')).replace(/[^\d]/g, ''));
      const kindOf = kind?.type ?? fallback;
      items.push({
        type: kindOf, title, creator: clean(bare(cell(row, 'creator')), 300), year: yearOf(cell(row, 'year')),
        format: said ?? kind?.format ?? null, barcode: clean(bare(cell(row, 'barcode')).replace(/[-\s]/g, ''), 40),
        cost_cents: moneyOf(cell(row, 'cost')), bought_on: dayOf(cell(row, 'bought_on')), value_cents: moneyOf(cell(row, 'value')), valued_on: dayOf(cell(row, 'valued_on')),
        note: clean(bare(cell(row, 'note')), 5000), genres: genres.slice(0, 20), minutes: Number.isInteger(minutes) && minutes > 0 && minutes < 100_000 ? minutes : null,
        wanted: wantedOf(cell(row, 'wanted')),
      });
      types[kindOf] = (types[kindOf] ?? 0) + 1;
    }
  } else {
    for (const line of text.replace(/^﻿/, '').split(/\r?\n/)) {
      const words = line.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '').trim();
      if (!words) continue;
      const split = /^(.+?)\s+by\s+(.+)$/i.exec(words) ?? /^(.+?)\s+[–—-]\s+(.+)$/.exec(words) ?? /^(.+?)\t+(.+)$/.exec(words);
      const title = clean(split ? split[1] : words, 300);
      if (!title) { skipped += 1; continue; }
      items.push({
        type: fallback, title, creator: split ? clean(split[2], 300) : null, year: null, format: null, barcode: null, cost_cents: null, bought_on: null,
        value_cents: null, valued_on: null, note: null, genres: [], minutes: null, wanted: false,
      });
      types[fallback] = (types[fallback] ?? 0) + 1;
    }
  }
  if (items.length === 0) throw new Problem(400, 'Nothing was found in that. A table needs a column called Title; otherwise put one title on each line, like "Alien by Ridley Scott".');
  if (items.length > MAX_BOOKS) throw new Problem(400, `That's more than ${MAX_BOOKS} titles. Import it as two lists.`);
  return { items, skipped, columns, types, says_format: items.filter((i) => i.format).length, wanted: items.filter((i) => i.wanted).length };
}

export type MediaListChoices = {
  /** What they're all on. Empty: what the list says of each. */
  format?: string | null;
  /** What a title is on when neither you nor the list says. Left out: "Not said". */
  otherwise?: string | null;
  /** Titles marked wanted become titles you want, with no copy. Otherwise they're brought in like the rest. */
  wanted_as_wanted?: boolean;
};

/** Bring a read list of any kind into the collection. One change: a list that can't all be brought in changes nothing. */
export async function importMediaList(db: Db, owner: number, clock: Clock, items: ListedTitle[], choices: MediaListChoices = {}): Promise<ListResult> {
  const all = clean(choices.format, 60);
  const otherwise = clean(choices.otherwise, 60) ?? 'Not said';
  const now = stamp(clock());
  const result: ListResult = { listed: items.length, added: 0, copies: 0, already: 0, wanted: 0, logged: 0 };
  return atomic(db, async (tx) => {
    const titles = await tx.all<{ id: number; type: string; title: string; creator: string | null; year: number | null }>(
      'SELECT id, type, title, creator, year FROM media WHERE owner_id = ?', [owner]);
    const byBarcode = new Map<string, number>();
    const formats = new Map<number, Set<string>>();
    for (const c of await tx.all<{ media_id: number; format: string; barcode: string | null }>(
      'SELECT c.media_id, c.format, c.barcode FROM media_copies c JOIN media m ON m.id = c.media_id WHERE m.owner_id = ?', [owner])) {
      if (!formats.has(c.media_id)) formats.set(c.media_id, new Set());
      formats.get(c.media_id)!.add(labelKey(c.format));
      if (c.barcode) byBarcode.set(barcodeKey(c.barcode), c.media_id);
    }
    const nameOf = (title: string) => labelKey(title.replace(/\s*\([^)]*\)\s*$/, ''));
    const firstOf = (creator: string | null) => labelKey((creator ?? '').split(',')[0]!);
    for (const item of items) {
      const code = item.barcode ? barcodeKey(item.barcode) : null;
      let id = code ? byBarcode.get(code) : undefined;
      if (id === undefined) {
        // The same name, of the same kind; a creator or a year given on both sides must agree.
        id = titles.find((t) => t.type === item.type && nameOf(t.title) === nameOf(item.title)
          && (!t.creator || !item.creator || firstOf(t.creator) === firstOf(item.creator))
          && (t.year === null || item.year === null || t.year === item.year))?.id;
      }
      const fresh = id === undefined;
      const wanted = (choices.wanted_as_wanted ?? true) && item.wanted;
      if (id === undefined) {
        id = (await tx.run(
          'INSERT INTO media (owner_id, type, title, creator, year, genres, minutes, wanted, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [owner, item.type, item.title, item.creator, item.year, item.genres.join(',') || null, item.minutes, wanted ? 1 : 0, item.note, now, now])).lastId;
        titles.push({ id, type: item.type, title: item.title, creator: item.creator, year: item.year });
        formats.set(id, new Set());
        result.added += 1;
        if (wanted) result.wanted += 1;
      }
      if (!wanted) {
        const format = all ?? item.format ?? otherwise;
        const have = formats.get(id) ?? new Set<string>();
        if (have.has(labelKey(format))) {
          if (!fresh) result.already += 1;
        } else {
          await tx.run(
            'INSERT INTO media_copies (media_id, format, barcode, cost_cents, bought_on, value_cents, valued_on, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [id, format, item.barcode, item.cost_cents, item.bought_on, item.value_cents, item.value_cents === null ? null : item.valued_on, 'list', now]);
          await tx.run('UPDATE media SET wanted = 0 WHERE id = ? AND wanted = 1', [id]);
          have.add(labelKey(format));
          formats.set(id, have);
          if (item.barcode) byBarcode.set(barcodeKey(item.barcode), id);
          result.copies += 1;
        }
      } else if (!fresh) result.already += 1;
    }
    return result;
  });
}
