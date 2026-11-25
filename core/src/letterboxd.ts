/**
 * Letterboxd files, both ways.
 *
 * In: the download from Letterboxd (Settings, Data, Export), a zip of CSV files, or any of its CSVs one by one:
 *   watched.csv   every film watched (Date, Name, Year, Letterboxd URI)
 *   diary.csv     each day a film was watched (Date, Name, Year, Letterboxd URI, Rating, Rewatch, Tags, Watched Date)
 *   ratings.csv   the stars (Date, Name, Year, Letterboxd URI, Rating)
 *   reviews.csv   reviews (the same columns, with Review)
 *   watchlist.csv films to watch (Date, Name, Year, Letterboxd URI)
 *   lists/*.csv   one file for each list: a few header lines, then Position, Name, Year, URL, Description
 * Column names are matched loosely (case, spaces and underscores do not matter), so a variant still reads.
 *
 * Every film becomes a title that is not owned (`listed_only`), each diary entry a day in its watch log, the watchlist goes on
 * "To watch, read or hear", each Letterboxd list becomes a list in the same order, stars are kept in halves, and a review is
 * kept word for word as the note of that day. Reading the same download again adds nothing: a film is matched on its
 * Letterboxd link when one is kept, else on its name and year. Nothing is looked up and nothing leaves the device.
 *
 * Out: `letterboxdFile` makes a CSV that Letterboxd's importer accepts (letterboxd.com/about/importing-data) from any list.
 */
import { csvRows } from './bookList.ts';
import { atomic, type Db, type Queries } from './db.ts';
import { mediaLists, type ListEntry } from './mediaLists.ts';
import { Problem } from './problem.ts';
import { clean, dayOrNull, labelKey, stamp, type Clock } from './small.ts';

export const MAX_FILMS = 20_000;
/** A review is kept whole; this is only a guard against a file that is not a review. */
const MAX_REVIEW = 50_000;

type Row = Record<string, string>;
const headerKey = (h: string) => labelKey(h).replace(/[\s_-]+/g, '');

function tableOf(text: string): { headers: string[]; rows: Row[] } {
  const all = csvRows(text);
  const headers = (all[0] ?? []).map(headerKey);
  return { headers, rows: all.slice(1).map((cells) => Object.fromEntries(headers.map((h, at) => [h, cells[at] ?? '']))) };
}
const pick = (row: Row, ...names: string[]): string => { for (const n of names) if (row[n] !== undefined && row[n]!.trim() !== '') return row[n]!.trim(); return ''; };
const yearOf = (text: string): number | null => { const n = /^\d{4}$/.test(text.trim()) ? Number(text.trim()) : null; return n !== null && n >= 1000 ? n : null; };
const dayOf = (text: string): string | null => { try { return dayOrNull(text.trim().slice(0, 10) || null); } catch { return null; } };
/** Stars as typed ("3.5"), in half stars (7); null when it is not 0.5 to 5 in halves. */
export function halvesOf(text: string): number | null {
  const n = Number(text.trim());
  if (text.trim() === '' || !Number.isFinite(n)) return null;
  const halves = Math.round(n * 2);
  return halves >= 1 && halves <= 10 && halves / 2 === n ? halves : null;
}
const uriOf = (text: string): string | null => {
  const t = text.trim().replace(/\/+$/, '');
  return /^https?:\/\/\S+$/i.test(t) && t.length <= 300 ? t : null;
};
/** The short link (boxd.it) is the film's own; a film page link is kept only when nothing better is known. */
const isShort = (uri: string) => /^https?:\/\/boxd\.it\//i.test(uri);

type Film = { key: string; name: string; year: number | null; uri: string | null; halves: number | null; ratedOn: string | null; watchedLogged: string | null; entries: Entry[] };
type Entry = { day: string; review: string | null; fromReview: boolean };
type ListFile = { name: string; items: { key: string; note: string | null }[] };

export type LetterboxdRead = {
  films: Map<string, Film>;
  watchlist: string[];
  lists: ListFile[];
  /** Files that were read, and files that were left alone. */
  read: string[];
  left: string[];
  skipped: number;
};

const filmKey = (name: string, year: number | null) => `${labelKey(name)}|${year ?? ''}`;

/** What a set of files holds. `files` maps a path (as in the zip, or just the file name) to its text. */
export function readLetterboxd(files: Record<string, string>): LetterboxdRead {
  const out: LetterboxdRead = { films: new Map(), watchlist: [], lists: [], read: [], left: [], skipped: 0 };
  const film = (row: Row, uriFrom = 'letterboxduri'): Film | null => {
    const name = clean(pick(row, 'name', 'title', 'film', 'filmtitle'), 300);
    if (!name) { out.skipped += 1; return null; }
    const year = yearOf(pick(row, 'year', 'releaseyear'));
    const key = filmKey(name, year);
    let f = out.films.get(key);
    if (!f) {
      if (out.films.size >= MAX_FILMS) throw new Problem(400, `That is more than ${MAX_FILMS} films`);
      f = { key, name, year, uri: null, halves: null, ratedOn: null, watchedLogged: null, entries: [] };
      out.films.set(key, f);
    }
    const uri = uriOf(pick(row, uriFrom, 'letterboxdurl', 'url', 'link'));
    if (uri && (!f.uri || (isShort(uri) && !isShort(f.uri)))) f.uri = uri;
    return f;
  };
  // A diary entry's own link is not the film's, so it is not kept.
  const entryFilm = (row: Row) => film({ ...row, letterboxduri: '', url: '' });

  const kinds = (path: string, text: string): 'watched' | 'diary' | 'ratings' | 'reviews' | 'watchlist' | 'list' | null => {
    const parts = path.replace(/\\/g, '/').toLowerCase().split('/');
    const base = parts[parts.length - 1]!;
    if (!base.endsWith('.csv')) return null;
    if (parts.some((p) => p === 'deleted' || p === 'likes' || p === 'orphaned')) return null;
    if (parts.slice(0, -1).includes('lists')) return 'list';
    if (base === 'watched.csv') return 'watched';
    if (base === 'diary.csv') return 'diary';
    if (base === 'ratings.csv') return 'ratings';
    if (base === 'reviews.csv') return 'reviews';
    if (base === 'watchlist.csv') return 'watchlist';
    if (['comments.csv', 'profile.csv'].includes(base)) return null;
    // Any other CSV: a list if it has the list's own header line.
    return csvRows(text).some((r) => headerKey(r[0] ?? '') === 'position') ? 'list' : null;
  };

  const order = ['watched', 'diary', 'ratings', 'reviews', 'watchlist', 'list'];
  const found = Object.entries(files).map(([path, text]) => ({ path, text, kind: kinds(path, text) }));
  for (const f of found.filter((x) => !x.kind)) out.left.push(f.path);
  for (const f of found.filter((x) => x.kind).sort((a, b) => order.indexOf(a.kind!) - order.indexOf(b.kind!))) {
    out.read.push(f.path);
    if (f.kind === 'list') {
      const all = csvRows(f.text.replace(/\r\n?/g, '\n'));
      const at = all.findIndex((r) => headerKey(r[0] ?? '') === 'position');
      if (at < 0) { out.left.push(f.path); out.read.pop(); continue; }
      // The list's own name is in the line under "Date, Name, Tags, URL, Description"; failing that, the file's name.
      let name = '';
      for (let i = 0; i < at; i += 1) {
        const heads = all[i]!.map(headerKey);
        if (heads.includes('name') && heads.includes('date') && all[i + 1]) name = (all[i + 1]![heads.indexOf('name')] ?? '').trim();
      }
      if (!name) name = (f.path.replace(/\\/g, '/').split('/').pop() ?? 'List').replace(/\.csv$/i, '').replace(/[-_]+/g, ' ');
      const heads = all[at]!.map(headerKey);
      const list: ListFile = { name: clean(name, 80) ?? 'Letterboxd list', items: [] };
      const rows = all.slice(at + 1).map((cells) => Object.fromEntries(heads.map((h, n) => [h, cells[n] ?? ''])) as Row)
        .map((row, n) => ({ row, n, position: Number(pick(row, 'position')) }));
      rows.sort((a, b) => (Number.isFinite(a.position) && Number.isFinite(b.position) ? a.position - b.position : 0) || a.n - b.n);
      for (const { row } of rows) {
        const x = film({ ...row, letterboxduri: pick(row, 'url') }, 'letterboxduri');
        if (x) list.items.push({ key: x.key, note: clean(pick(row, 'description'), 1000) });
      }
      out.lists.push(list);
      continue;
    }
    const { rows } = tableOf(f.text);
    for (const row of rows) {
      if (f.kind === 'watched') {
        const x = film(row);
        if (x) x.watchedLogged = dayOf(pick(row, 'date')) ?? x.watchedLogged;
      } else if (f.kind === 'watchlist') {
        const x = film(row);
        if (x && !out.watchlist.includes(x.key)) out.watchlist.push(x.key);
      } else if (f.kind === 'ratings') {
        const x = film(row);
        const halves = halvesOf(pick(row, 'rating'));
        if (x && halves !== null) { x.halves = halves; x.ratedOn = '9999-99-99'; } // the ratings file is the current rating
      } else {
        const x = entryFilm(row);
        if (!x) continue;
        const day = dayOf(pick(row, 'watcheddate')) ?? dayOf(pick(row, 'date'));
        if (!day) { out.skipped += 1; continue; }
        const halves = halvesOf(pick(row, 'rating'));
        if (halves !== null && (!x.ratedOn || (x.ratedOn !== '9999-99-99' && day >= x.ratedOn))) { x.halves = halves; x.ratedOn = day; }
        if (f.kind === 'diary') x.entries.push({ day, review: null, fromReview: false });
        else {
          const text = (row.review ?? '').replace(/^\s+$/, '');
          if (!text) continue;
          const text2 = text.length > MAX_REVIEW ? text.slice(0, MAX_REVIEW) : text;
          // A review belongs to the diary entry of the same day, if that entry has none yet.
          const same = x.entries.find((e) => e.day === day && e.review === null);
          if (same) same.review = text2; else x.entries.push({ day, review: text2, fromReview: true });
        }
      }
    }
  }
  return out;
}

export type LetterboxdCounts = { found: number; new: number; already: number };
export type LetterboxdReport = {
  files: string[];
  left_alone: string[];
  skipped: number;
  films: LetterboxdCounts;
  days: LetterboxdCounts;
  ratings: LetterboxdCounts;
  reviews: LetterboxdCounts;
  watchlist: LetterboxdCounts;
  lists: (LetterboxdCounts & { name: string; made: boolean })[];
  /** Films that Letterboxd lists as watched but gave no diary day for: their logged day is used. */
  day_from_log: number;
  saved: boolean;
};

class Rehearsal extends Error {
  report: LetterboxdReport;
  constructor(report: LetterboxdReport) { super('rehearsal'); this.report = report; }
}

const counts = (): LetterboxdCounts => ({ found: 0, new: 0, already: 0 });
const idsOf = (text: string | null): Record<string, string> => { try { const v: unknown = text ? JSON.parse(text) : {}; return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, string>) : {}; } catch { return {}; } };

/**
 * Bring a Letterboxd download in, or, with `save` false, say what would happen and change nothing (the same work, then undone,
 * so the numbers are exactly what saving gives).
 */
export async function bringInLetterboxd(db: Db, owner: number, files: Record<string, string>, save: boolean, clock: Clock = () => new Date()): Promise<LetterboxdReport> {
  const data = readLetterboxd(files);
  if (data.read.length === 0) throw new Problem(400, 'None of those looks like a Letterboxd file. The download has watched.csv, diary.csv, ratings.csv, reviews.csv and watchlist.csv, and a lists folder.');
  const now = stamp(clock());
  await mediaLists(db, owner, clock).all(); // makes To watch, read or hear if it is not there yet
  const report: LetterboxdReport = {
    files: data.read, left_alone: data.left, skipped: data.skipped, films: counts(), days: counts(), ratings: counts(), reviews: counts(), watchlist: counts(), lists: [], day_from_log: 0, saved: save,
  };
  try {
    await atomic(db, async (tx) => {
      await work(tx);
      if (!save) throw new Rehearsal(report);
    });
  } catch (e) {
    if (e instanceof Rehearsal) return e.report;
    throw e;
  }
  return report;

  async function work(tx: Queries): Promise<void> {
    type Mine = { id: number; title: string; year: number | null; stars: number | null; ids: string | null };
    const mine = await tx.all<Mine>("SELECT id, title, year, stars, ids FROM media WHERE owner_id = ? AND type = 'film' ORDER BY id", [owner]);
    const byUri = new Map<string, Mine>();
    const note = (m: Mine) => { const u = idsOf(m.ids).letterboxd; if (u) byUri.set(u, m); };
    mine.forEach(note);
    const find = (f: Film): Mine | undefined => {
      const viaUri = f.uri ? byUri.get(f.uri) : undefined;
      if (viaUri) return viaUri;
      const k = labelKey(f.name);
      return mine.find((m) => labelKey(m.title) === k && (m.year === f.year || m.year === null || f.year === null));
    };
    const ensured = new Map<string, Mine>();
    const ensure = async (f: Film): Promise<Mine> => {
      const had = ensured.get(f.key);
      if (had) return had;
      let m = find(f);
      if (m) report.films.already += 1;
      else {
        const ids = f.uri ? JSON.stringify({ letterboxd: f.uri }) : null;
        const made = await tx.run(
          `INSERT INTO media (owner_id, type, title, year, wanted, listed_only, ids, created_at, updated_at) VALUES (?, 'film', ?, ?, 0, 1, ?, ?, ?)`,
          [owner, f.name, f.year, ids, now, now]);
        m = { id: made.lastId, title: f.name, year: f.year, stars: null, ids };
        mine.push(m);
        report.films.new += 1;
      }
      if (f.uri && !idsOf(m.ids).letterboxd) {
        const ids = JSON.stringify({ ...idsOf(m.ids), letterboxd: f.uri });
        await tx.run('UPDATE media SET ids = ? WHERE id = ?', [ids, m.id]);
        m.ids = ids;
      }
      note(m);
      ensured.set(f.key, m);
      return m;
    };
    // Every film in the file, in the order it was met.
    report.films.found = data.films.size;
    for (const f of data.films.values()) {
      const m = await ensure(f);
      // Stars: kept as typed here already if the person rated it in Life Is.
      if (f.halves !== null) {
        report.ratings.found += 1;
        if (m.stars === null) { await tx.run('UPDATE media SET stars = ? WHERE id = ?', [f.halves, m.id]); m.stars = f.halves; report.ratings.new += 1; } else report.ratings.already += 1;
      }
      // Days. A film with no diary entry of its own gets the day it was logged on Letterboxd, once.
      const existing = await tx.all<{ id: number; day: string; note: string | null }>('SELECT id, day, note FROM media_log WHERE media_id = ? ORDER BY id', [m.id]);
      let entries = f.entries;
      if (entries.length === 0 && f.watchedLogged && existing.length === 0) {
        entries = [{ day: f.watchedLogged, review: null, fromReview: false }];
        report.day_from_log += 1;
      }
      const used = new Set<number>();
      for (const e of entries) {
        report.days.found += 1;
        if (e.review !== null) report.reviews.found += 1;
        const row = existing.find((x) => x.day === e.day && !used.has(x.id));
        if (row) {
          used.add(row.id);
          report.days.already += 1;
          if (e.review !== null) {
            if (row.note === null) { await tx.run('UPDATE media_log SET note = ? WHERE id = ?', [e.review, row.id]); row.note = e.review; report.reviews.new += 1; } else report.reviews.already += 1;
          }
        } else {
          const made = await tx.run('INSERT INTO media_log (media_id, day, note, created_at) VALUES (?, ?, ?, ?)', [m.id, e.day, e.review, now]);
          existing.push({ id: made.lastId, day: e.day, note: e.review });
          used.add(made.lastId);
          report.days.new += 1;
          if (e.review !== null) report.reviews.new += 1;
        }
      }
    }
    // A list of titles: the order of the file; what is on it already stays where it is.
    const put = async (listId: number, keys: { key: string; note: string | null }[], tally: LetterboxdCounts): Promise<void> => {
      const on = new Set((await tx.all<{ media_id: number }>('SELECT media_id FROM media_list_items WHERE list_id = ?', [listId])).map((i) => i.media_id));
      let last = (await tx.get<{ n: number | null }>('SELECT MAX(sort_order) AS n FROM media_list_items WHERE list_id = ?', [listId]))!.n ?? 0;
      for (const item of keys) {
        const f = data.films.get(item.key)!;
        const m = await ensure(f);
        tally.found += 1;
        if (on.has(m.id)) { tally.already += 1; continue; }
        last += 1;
        await tx.run('INSERT INTO media_list_items (list_id, media_id, sort_order, note, added_by, created_at) VALUES (?, ?, ?, ?, ?, ?)', [listId, m.id, last, item.note, owner, now]);
        on.add(m.id);
        tally.new += 1;
      }
    };
    const toWatch = await tx.get<{ id: number }>("SELECT id FROM media_lists WHERE owner_id = ? AND builtin = 'to_watch'", [owner]);
    if (toWatch && data.watchlist.length) await put(toWatch.id, data.watchlist.map((key) => ({ key, note: null })), report.watchlist);
    for (const l of data.lists) {
      const mineLists = await tx.all<{ id: number; name: string }>('SELECT id, name FROM media_lists WHERE owner_id = ?', [owner]);
      let listId = mineLists.find((x) => labelKey(x.name) === labelKey(l.name))?.id;
      const made = listId === undefined;
      if (listId === undefined) {
        const last = (await tx.get<{ n: number | null }>('SELECT MAX(sort_order) AS n FROM media_lists WHERE owner_id = ?', [owner]))!.n ?? 0;
        listId = (await tx.run('INSERT INTO media_lists (owner_id, name, shared, sort_order, created_at) VALUES (?, ?, 0, ?, ?)', [owner, l.name, Math.max(last, 0) + 1, now])).lastId;
      }
      const tally = { name: l.name, made, ...counts() };
      // A list that is Wanted has no rows: it cannot be a Letterboxd list's home, but nobody names a list that.
      await put(listId, l.items, tally);
      report.lists.push(tally);
    }
  }
}

// ==================== out ====================

/** One CSV field: quoted when it holds a comma, a quote or a line break. Nothing is changed in the text, so a review stays as it was. */
const field = (text: string): string => (/[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text);
const stars = (halves: number | null): string => (halves === null ? '' : String(halves / 2));

export type LetterboxdFile = { name: string; file_name: string; csv: string; films: number; left_out: number };

/**
 * A list as a file for Letterboxd's importer: Title, Year, the director when known, and for the person's own list the Letterboxd
 * link, the rating, and each day watched with its review. Only films go in; the count of the others is said.
 */
export async function letterboxdFile(db: Db, owner: number, listId: number, clock: Clock = () => new Date()): Promise<LetterboxdFile> {
  const view = await mediaLists(db, owner, clock).get(listId); // 404 for a list the person cannot see
  const films = view.entries.filter((e: ListEntry) => e.type === 'film');
  const header = ['LetterboxdURI', 'Title', 'Year', 'Directors', 'Rating', 'WatchedDate', 'Rewatch', 'Review'];
  const lines: string[][] = [];
  for (const e of films) {
    const base = [e.title, e.year === null ? '' : String(e.year), e.creator ?? ''];
    if (!view.mine) { lines.push(['', ...base, '', '', '', '']); continue; }
    const m = (await db.get<{ stars: number | null; ids: string | null }>('SELECT stars, ids FROM media WHERE id = ? AND owner_id = ?', [e.media_id, owner]));
    const uri = idsOf(m?.ids ?? null).letterboxd ?? '';
    const log = await db.all<{ day: string; note: string | null }>('SELECT day, note FROM media_log WHERE media_id = ? ORDER BY day, id', [e.media_id]);
    if (log.length === 0) lines.push([uri, ...base, stars(m?.stars ?? null), '', '', '']);
    log.forEach((l, n) => lines.push([uri, ...base, stars(m?.stars ?? null), l.day, n > 0 ? 'true' : '', l.note ?? '']));
  }
  const csv = [header, ...lines].map((r) => r.map(field).join(',')).join('\r\n') + '\r\n';
  const slug = view.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'list';
  return { name: view.name, file_name: `${slug}-for-letterboxd.csv`, csv, films: films.length, left_out: view.entries.length - films.length };
}
