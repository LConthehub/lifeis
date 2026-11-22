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
  if (books.length > MAX_BOOKS) throw new Problem(400, `That's more than ${MAX_BOOKS} books. Bring it in as two lists.`);
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
