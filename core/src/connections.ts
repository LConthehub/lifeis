/**
 * Media servers: bringing what's on your Jellyfin or Emby into the collection, and keeping it in step.
 *
 * A connection is a server's address and its key. Syncing reads the server's library and makes the collection
 * match it: each film, show, album or book there becomes a copy, with the server's name as its format, on a
 * title of the collection. A title you already have (the same film on VHS) gains the copy; one you don't is
 * added. What has gone from the server loses its copy, and a title that was only ever there for the server
 * goes with it. A title you've logged, want, or own another copy of always stays.
 *
 * It only ever reads from the server. Nothing on the server is changed.
 *
 * Two things differ by where Life Is runs, so they are handed in: `fetcher` asks a web address for its answer,
 * and `sealer` locks the server's key before it is stored and opens it again when it's needed.
 */
import { atomic, type Db, type Queries } from './db.ts';
import type { MediaType } from './media.ts';
import { Problem } from './problem.ts';
import { clean, labelKey, stamp, type Clock } from './small.ts';
import { unlink } from './tags.ts';

export const SERVER_KINDS = ['jellyfin', 'emby'] as const;
export type ServerKind = (typeof SERVER_KINDS)[number];
const NAMES: Record<ServerKind, string> = { jellyfin: 'Jellyfin', emby: 'Emby' };
/** How often a connection may sync by itself, in hours. 0: only when asked. */
export const EVERY_CHOICES = [0, 1, 6, 24, 168];

export type Answer = {
  status: number; json(): Promise<unknown>; bytes(): Promise<Uint8Array>; type: string | null;
  /** One of the answer's headers by name, where the fetcher can give them. Needed only to sign in the way a server asks (digest.ts). */
  header?(name: string): string | null;
};
/** Asks a web address for its answer. Almost always a plain question; `send` is for the few that must be posted. */
export type Fetcher = (url: string, headers: Record<string, string>, send?: { method: 'POST'; body: string; /** Don't follow a redirect: the answer is the redirect itself. */ noRedirect?: boolean } | { method: 'GET'; body: ''; noRedirect?: boolean }) => Promise<Answer>;
export type Sealer = { seal(plain: string): string; unseal(sealed: string): string | null };

/** One thing on a server, as the collection needs it. */
export type Imported = {
  sourceId: string;
  type: MediaType;
  title: string;
  creator: string | null;
  year: number | null;
  summary: string | null;
  genres: string[];
  minutes: number | null;
  ids: Record<string, string>;
  /** Where the server keeps a picture of the cover, if it has one. */
  coverUrl: string | null;
  /** What this copy is on, when it isn't simply the server's name: "eBook", "Audiobook". */
  format?: string;
  /** An address that opens it where it lives. */
  link?: string | null;
  /** When this is one book that the server keeps in pieces: the ids of the pieces, as earlier syncs may have made titles of them. */
  parts?: string[];
};
/** Which kind of source copies belong to: a media server (the default) or a book server. */
export type ImportAs = { column: 'connection_id' | 'library_source_id'; source: string; format: string };

export type ConnectionInput = { kind: string; url: string; secret?: string | null; name?: string | null; every_hours?: number | null };
export type Connection = {
  id: number;
  kind: ServerKind;
  name: string;
  url: string;
  every_hours: number;
  last_sync_at: string | null;
  /** Whether the last sync worked. Null: it hasn't synced yet. */
  last_ok: boolean | null;
  last_message: string | null;
  /** How many copies in the collection came from this server. */
  copies: number;
};
export type SyncResult = { total: number; added: number; titles_added: number; removed: number; covers: number; joined_parts: number; joined_books: number };

type ConnectionRow = Omit<Connection, 'last_ok' | 'copies'> & { last_ok: number | null; secret: string | null; owner_id: number };

const JELLYFIN_TYPES: Record<string, MediaType> = { Movie: 'film', Series: 'show', MusicAlbum: 'music', Book: 'book', AudioBook: 'book' };
const PAGE = 200;
const COVERS_PER_SYNC = 400;

const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value.trim() : null);

/** The address as given, tidied: http or https, no trailing slash. */
export function serverUrl(given: string): string {
  let url: URL;
  try {
    url = new URL(given.trim());
  } catch {
    throw new Problem(400, "That isn't a web address. It looks like http://192.168.1.20:8096");
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Problem(400, 'The address starts with http:// or https://');
  if (url.username || url.password) throw new Problem(400, "Leave the name and password out of the address: the key goes in its own box");
  return (url.origin + url.pathname).replace(/\/+$/, '');
}

const authHeaders = (kind: ServerKind, key: string): Record<string, string> =>
  (kind === 'emby' ? { 'X-Emby-Token': key } : { Authorization: `MediaBrowser Token="${key.replaceAll('"', '')}"` });

async function ask(fetcher: Fetcher, kind: ServerKind, url: string, headers: Record<string, string>): Promise<unknown> {
  let answer: Answer;
  try {
    answer = await fetcher(url, { Accept: 'application/json', ...headers });
  } catch {
    throw new Problem(400, `Couldn't reach ${NAMES[kind]} at that address. If it's on the same computer as Life Is, and Life Is runs in Docker, ` +
      'use http://host.docker.internal and its port instead of localhost.');
  }
  if (answer.status === 401 || answer.status === 403) throw new Problem(400, `${NAMES[kind]} didn't accept that key`);
  if (answer.status !== 200) throw new Problem(400, `${NAMES[kind]} answered with an error (${answer.status})`);
  try {
    return await answer.json();
  } catch {
    throw new Problem(400, `That address answered, but not like ${NAMES[kind]} does`);
  }
}

/** The server's own name, which also shows the address is right. Needs no key. */
export async function serverName(fetcher: Fetcher, kind: ServerKind, url: string): Promise<string> {
  const info = await ask(fetcher, kind, `${url}/System/Info/Public`, {}) as { ServerName?: unknown; ProductName?: unknown } | null;
  if (!info || typeof info !== 'object' || !('ServerName' in info)) throw new Problem(400, `That address answered, but not like ${NAMES[kind]} does`);
  return text(info.ServerName) ?? NAMES[kind];
}

/** Everything in the server's library that the collection keeps: films, shows, albums and books. */
export async function readServer(fetcher: Fetcher, kind: ServerKind, url: string, key: string): Promise<Imported[]> {
  const out: Imported[] = [];
  // Jellyfin often lists each file of one audiobook as an AudioBook of its own. They are gathered by folder and joined after the last page.
  const pieces: Piece[] = [];
  for (let start = 0; ; start += PAGE) {
    const query = new URLSearchParams({
      recursive: 'true', includeItemTypes: Object.keys(JELLYFIN_TYPES).join(','), fields: 'Overview,Genres,ProviderIds,ParentId', // (an audiobook's Album comes without asking; Jellyfin refuses a field name it does not know)
      // Without this the server hides every film that belongs to a collection behind the collection, and since
      // collections aren't asked for, those films would never arrive.
      collapseBoxSetItems: 'false',
      enableImages: 'true', sortBy: 'SortName', startIndex: String(start), limit: String(PAGE),
    });
    const page = await ask(fetcher, kind, `${url}/Items?${query}`, authHeaders(kind, key)) as { Items?: unknown; TotalRecordCount?: unknown } | null;
    const items = Array.isArray(page?.Items) ? (page.Items as Record<string, unknown>[]) : null;
    if (!items) throw new Problem(400, `That address answered, but not like ${NAMES[kind]} does`);
    for (const item of items) {
      const type = JELLYFIN_TYPES[String(item.Type)];
      const id = text(item.Id);
      const title = text(item.Name);
      if (!type || !id || !title) continue;
      const ids: Record<string, string> = {};
      for (const [name, value] of Object.entries((item.ProviderIds ?? {}) as Record<string, unknown>)) {
        const idName = name.toLowerCase().replace(/[^a-z0-9_]/g, '');
        if (/^[a-z]/.test(idName) && text(value)) ids[idName] = text(value)!;
      }
      const artists = Array.isArray(item.Artists) ? item.Artists.filter((a): a is string => typeof a === 'string') : [];
      const ticks = typeof item.RunTimeTicks === 'number' ? item.RunTimeTicks : null;
      const hasCover = typeof item.ImageTags === 'object' && item.ImageTags !== null && 'Primary' in item.ImageTags;
      const imported: Imported = {
        sourceId: id, type, title,
        creator: text(item.AlbumArtist) ?? (artists.length ? artists.join(', ') : null),
        year: Number.isInteger(item.ProductionYear) ? (item.ProductionYear as number) : null,
        summary: text(item.Overview),
        genres: Array.isArray(item.Genres) ? item.Genres.filter((g): g is string => typeof g === 'string') : [],
        minutes: ticks !== null && ticks > 0 ? Math.round(ticks / 600_000_000) : null,
        ids,
        coverUrl: hasCover ? `${url}/Items/${encodeURIComponent(id)}/Images/Primary?maxWidth=300&quality=80` : null,
      };
      if (String(item.Type) === 'AudioBook') pieces.push({ imported, ticks: ticks !== null && ticks > 0 ? ticks : 0, parent: text(item.ParentId), album: text(item.Album) });
      else out.push(imported);
    }
    // The server says how many there are in all. A page can come back short of what was asked for, so the count
    // decides when to stop, not the size of a page; a server that gives no count stops at the first short page.
    const total = typeof page?.TotalRecordCount === 'number' ? page.TotalRecordCount : 0;
    if (items.length === 0 || start + PAGE >= total && (total > 0 || items.length < PAGE)) return [...out, ...(await joinAudiobooks(fetcher, kind, url, key, pieces))];
    if (start > 500_000) throw new Problem(400, 'That library is larger than Life Is can import');
  }
}

type Piece = { imported: Imported; ticks: number; parent: string | null; album: string | null };
const FOLDERS_PER_ASK = 40;

/**
 * Audiobooks, with the files of one book made one book. A folder with two or more AudioBook items is one book;
 * a folder with one stays as it was, so nothing about it changes.
 */
async function joinAudiobooks(fetcher: Fetcher, kind: ServerKind, url: string, key: string, pieces: Piece[]): Promise<Imported[]> {
  const folders = new Map<string, Piece[]>();
  for (const piece of pieces) if (piece.parent) folders.set(piece.parent, [...(folders.get(piece.parent) ?? []), piece]);
  const many = [...folders].filter(([, parts]) => parts.length > 1);
  // The folders' own names and pictures, a batch at a time. A folder that can't be read just has none.
  const named = new Map<string, { name: string | null; cover: boolean }>();
  for (let at = 0; at < many.length; at += FOLDERS_PER_ASK) {
    const ids = many.slice(at, at + FOLDERS_PER_ASK).map(([id]) => id);
    try {
      const got = await ask(fetcher, kind, `${url}/Items?${new URLSearchParams({ ids: ids.join(',') })}`, authHeaders(kind, key)) as { Items?: unknown } | null;
      for (const folder of Array.isArray(got?.Items) ? (got.Items as Record<string, unknown>[]) : []) {
        const id = text(folder.Id);
        if (id) named.set(id, { name: text(folder.Name), cover: typeof folder.ImageTags === 'object' && folder.ImageTags !== null && 'Primary' in folder.ImageTags });
      }
    } catch {
      // The pieces still make one book, under their own album name.
    }
  }
  const out: Imported[] = [];
  for (const piece of pieces) if (!piece.parent || folders.get(piece.parent)!.length < 2) out.push(piece.imported);
  for (const [folderId, parts] of many) {
    const first = parts[0]!;
    const shared = new Set(parts.map((p) => p.album)).size === 1 ? first.album : null;
    const folder = named.get(folderId);
    const ticks = parts.reduce((sum, p) => sum + p.ticks, 0);
    const web = kind === 'emby' ? `${url}/web/index.html#!/item?id=${encodeURIComponent(folderId)}` : `${url}/web/#/details?id=${encodeURIComponent(folderId)}`;
    out.push({
      sourceId: `audiobook-folder-${folderId}`, type: 'book',
      title: shared ?? folder?.name ?? first.album ?? first.imported.title,
      creator: parts.find((p) => p.imported.creator)?.imported.creator ?? null,
      year: parts.find((p) => p.imported.year !== null)?.imported.year ?? null,
      summary: parts.find((p) => p.imported.summary)?.imported.summary ?? null,
      genres: parts.find((p) => p.imported.genres.length > 0)?.imported.genres ?? [],
      minutes: ticks > 0 ? Math.round(ticks / 600_000_000) : null,
      ids: parts.find((p) => Object.keys(p.imported.ids).length > 0)?.imported.ids ?? {},
      coverUrl: folder?.cover ? `${url}/Items/${encodeURIComponent(folderId)}/Images/Primary?maxWidth=300&quality=80` : parts.find((p) => p.imported.coverUrl)?.imported.coverUrl ?? null,
      format: 'Audiobook', link: web, parts: parts.map((p) => p.imported.sourceId),
    });
  }
  return out;
}

/** The catalog names worth matching titles on. A film's TMDB number is the same film wherever it's kept. */
const MATCH_IDS = ['tmdb', 'imdb', 'tvdb', 'isbn', 'musicbrainzalbum', 'musicbrainzreleasegroup', 'igdb'];

/**
 * Make the collection's copies from one connection match what the server has now. Runs inside a transaction:
 * the collection is never left half-synced.
 */
export async function applyImport(q: Queries, owner: number, connection: { id: number; kind: string }, items: Imported[], now: string, as?: ImportAs) {
  const where: ImportAs = as ?? { column: 'connection_id', source: connection.kind, format: NAMES[connection.kind as ServerKind] };
  const titles = await q.all<{ id: number; type: string; title: string; creator: string | null; year: number | null; ids: string | null }>(
    'SELECT id, type, title, creator, year, ids FROM media WHERE owner_id = ?', [owner]);
  const byId = new Map<string, number>();
  const byTitle = new Map<string, number>();
  const titleKey = (type: string, title: string, year: number | null) => `${type}|${labelKey(title)}|${year ?? ''}`;
  // Books only: the same book from two servers rarely agrees on the year, so title and the first author's surname are enough.
  const byAuthor = new Map<string, number>();
  const authorKey = (title: string, creator: string | null) => {
    const surname = surnameOf(creator);
    return surname ? `${labelKey(title)}|${surname}` : null;
  };
  const remember = (id: number, type: string, title: string, year: number | null, ids: Record<string, string>, creator: string | null) => {
    for (const name of MATCH_IDS) if (ids[name]) byId.set(`${type}|${name}|${ids[name]}`, id);
    if (!byTitle.has(titleKey(type, title, year))) byTitle.set(titleKey(type, title, year), id);
    const author = type === 'book' ? authorKey(title, creator) : null;
    if (author && !byAuthor.has(author)) byAuthor.set(author, id);
  };
  for (const title of titles) {
    let ids: Record<string, string> = {};
    try {
      ids = title.ids ? (JSON.parse(title.ids) as Record<string, string>) : {};
    } catch {
      // Ids that can't be read just aren't matched on.
    }
    remember(title.id, title.type, title.title, title.year, ids, title.creator);
  }
  const have = new Map((await q.all<{ id: number; media_id: number; source_id: string; link: string | null }>(
    `SELECT id, media_id, source_id, link FROM media_copies WHERE ${where.column} = ?`, [connection.id])).map((copy) => [copy.source_id, copy]));

  const seen = new Set<string>();
  const result = { total: 0, added: 0, titles_added: 0, removed: 0, joined_parts: 0, joined_books: 0 };
  const titleOf = new Map<string, number>(); // each item's title by its source id, to move a piece's things onto its book
  const wantsCover: { mediaId: number; url: string }[] = [];
  for (const item of items) {
    if (seen.has(item.sourceId)) continue;
    seen.add(item.sourceId);
    result.total += 1;
    const had = have.get(item.sourceId);
    let mediaId = had?.media_id;
    // Where it opens may have moved (a server given a new address).
    if (had && item.link && had.link !== item.link) await q.run('UPDATE media_copies SET link = ? WHERE id = ?', [item.link, had.id]);
    if (mediaId === undefined) {
      mediaId = MATCH_IDS.map((name) => (item.ids[name] ? byId.get(`${item.type}|${name}|${item.ids[name]}`) : undefined)).find((id) => id !== undefined)
        ?? byTitle.get(titleKey(item.type, item.title, item.year))
        ?? (item.type === 'book' ? byAuthor.get(authorKey(item.title, item.creator) ?? '') : undefined);
      if (mediaId === undefined) {
        mediaId = (await q.run(
          `INSERT INTO media (owner_id, type, title, creator, year, summary, genres, minutes, ids, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [owner, item.type, clean(item.title, 300), clean(item.creator, 300), item.year, clean(item.summary, 5000),
            item.genres.map((g) => clean(g.replaceAll(',', ' '), 40)).filter(Boolean).slice(0, 20).join(',') || null,
            item.minutes, Object.keys(item.ids).length ? JSON.stringify(item.ids) : null, now, now])).lastId;
        result.titles_added += 1;
      } else {
        await q.run('UPDATE media SET wanted = 0, listed_only = 0 WHERE id = ? AND (wanted = 1 OR listed_only = 1)', [mediaId]); // having it answers the wanting, and it is owned now
      }
      remember(mediaId, item.type, item.title, item.year, item.ids, item.creator);
      await q.run(`INSERT INTO media_copies (media_id, format, source, source_id, ${where.column}, link, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [mediaId, item.format ?? where.format, where.source, item.sourceId, connection.id, item.link ?? null, now]);
      result.added += 1;
    }
    titleOf.set(item.sourceId, mediaId);
    if (item.coverUrl) wantsCover.push({ mediaId, url: item.coverUrl });
  }
  // Which book each piece now belongs to.
  const bookOf = new Map<string, number>();
  for (const item of items) for (const part of item.parts ?? []) if (titleOf.has(item.sourceId)) bookOf.set(part, titleOf.get(item.sourceId)!);
  const joinedBooks = new Set<number>();
  // What's gone from the server loses its copy; a title that was only there for the server goes with it.
  for (const [sourceId, copy] of have) {
    if (seen.has(sourceId)) continue;
    const book = bookOf.get(sourceId);
    if (book !== undefined) {
      // A piece that is now part of a book: what the person added to it goes onto the book.
      if (book !== copy.media_id) await moveOnto(q, owner, copy.media_id, book);
      result.joined_parts += 1;
      joinedBooks.add(book);
    }
    await q.run('DELETE FROM media_copies WHERE id = ?', [copy.id]);
    await q.run(
      `DELETE FROM media WHERE id = ? AND wanted = 0 AND note IS NULL
       AND NOT EXISTS (SELECT 1 FROM media_copies WHERE media_id = media.id) AND NOT EXISTS (SELECT 1 FROM media_log WHERE media_id = media.id)
       AND NOT EXISTS (SELECT 1 FROM media_list_items WHERE media_id = media.id)`, [copy.media_id]);
    if (!(await q.get('SELECT id FROM media WHERE id = ?', [copy.media_id]))) await unlink(q, 'title', copy.media_id);
    result.removed += 1;
  }
  result.joined_books = joinedBooks.size;
  return { result, wantsCover };
}

/** The first author's surname as a word to compare, from "Frank Herbert", "Herbert, Frank", "A. Writer & B. Other" and the like. */
export function surnameOf(creator: string | null): string | null {
  if (!creator) return null;
  const first = creator.split(/\s*(?:&|;|\/|\band\b)\s*/i)[0]!.split(',').map((p) => p.trim()).filter(Boolean)[0];
  const last = first?.replaceAll('.', ' ').split(/\s+/).filter(Boolean).at(-1);
  return last && last.length > 1 ? labelKey(last) : null;
}

/**
 * A title that is one piece of a book goes into the book: what the person added to it (stars, a note, days logged,
 * lists, tags, a place in a plan) moves to the book's title, so nothing is lost when the piece goes.
 */
async function moveOnto(q: Queries, owner: number, from: number, to: number): Promise<void> {
  const mine = await q.get<{ stars: number | null; note: string | null }>('SELECT stars, note FROM media WHERE id = ? AND owner_id = ?', [from, owner]);
  const book = await q.get<{ stars: number | null; note: string | null }>('SELECT stars, note FROM media WHERE id = ? AND owner_id = ?', [to, owner]);
  if (!mine || !book) return;
  if (book.stars === null && mine.stars !== null) await q.run('UPDATE media SET stars = ? WHERE id = ?', [mine.stars, to]);
  await q.run('UPDATE media SET stars = NULL WHERE id = ?', [from]);
  if (mine.note) {
    const kept = (book.note ?? '').split(/\n\s*\n/).map((b) => b.trim());
    if (!kept.includes(mine.note.trim())) await q.run('UPDATE media SET note = ? WHERE id = ?', [book.note ? `${book.note}\n\n${mine.note}` : mine.note, to]);
    await q.run('UPDATE media SET note = NULL WHERE id = ?', [from]);
  }
  // Days logged: one the book has already (same day, words and session) is not doubled.
  const key = (l: { day: string; note: string | null; session_id: number | null }) => `${l.day}|${l.note ?? ''}|${l.session_id ?? ''}`;
  const had = new Set((await q.all<{ day: string; note: string | null; session_id: number | null }>('SELECT day, note, session_id FROM media_log WHERE media_id = ?', [to])).map(key));
  for (const l of await q.all<{ id: number; day: string; note: string | null; session_id: number | null }>('SELECT id, day, note, session_id FROM media_log WHERE media_id = ?', [from])) {
    if (had.has(key(l))) await q.run('DELETE FROM media_log WHERE id = ?', [l.id]);
    else { await q.run('UPDATE media_log SET media_id = ? WHERE id = ?', [to, l.id]); had.add(key(l)); }
  }
  // Lists: a list that has the book already keeps its own entry.
  await q.run('DELETE FROM media_list_items WHERE media_id = ? AND list_id IN (SELECT list_id FROM media_list_items WHERE media_id = ?)', [from, to]);
  await q.run('UPDATE media_list_items SET media_id = ? WHERE media_id = ?', [to, from]);
  await q.run("INSERT OR IGNORE INTO tag_links (tag_id, kind, target_id) SELECT tag_id, 'title', ? FROM tag_links WHERE kind = 'title' AND target_id = ?", [to, from]);
  await unlink(q, 'title', from);
  await q.run("UPDATE plan_items SET ref_id = ? WHERE kind = 'media' AND ref_id = ? AND plan_id IN (SELECT id FROM plans WHERE owner_id = ?)", [to, from, owner]);
  // Wanted is not carried: the book is on the server now, which answers wanting it.
}

/** Every connection whose turn it is to sync by itself, across everyone. For the place that keeps the time. */
export async function connectionsDue(db: Db, clock: Clock): Promise<{ id: number; owner_id: number }[]> {
  const now = clock().getTime();
  const rows = await db.all<{ id: number; owner_id: number; every_hours: number; last_sync_at: string | null }>(
    'SELECT id, owner_id, every_hours, last_sync_at FROM media_sources WHERE every_hours > 0');
  return rows.filter((row) => !row.last_sync_at || !(now - new Date(row.last_sync_at).getTime() < row.every_hours * 3_600_000))
    .map(({ id, owner_id }) => ({ id, owner_id }));
}

export function connections(db: Db, owner: number, clock: Clock, tools: { fetcher: Fetcher; sealer: Sealer }) {
  const now = () => stamp(clock());

  async function row(q: Queries, id: number): Promise<ConnectionRow> {
    const found = await q.get<ConnectionRow>(
      'SELECT id, owner_id, kind, name, url, secret, every_hours, last_sync_at, last_ok, last_message FROM media_sources WHERE id = ? AND owner_id = ?', [id, owner]);
    if (!found) throw new Problem(404, 'Not found');
    return found;
  }

  async function list(q: Queries): Promise<Connection[]> {
    return (await q.all<Omit<ConnectionRow, 'secret' | 'owner_id'> & { copies: number }>(
      `SELECT s.id, s.kind, s.name, s.url, s.every_hours, s.last_sync_at, s.last_ok, s.last_message,
              (SELECT COUNT(*) FROM media_copies c WHERE c.connection_id = s.id) AS copies
       FROM media_sources s WHERE s.owner_id = ? ORDER BY s.name COLLATE NOCASE, s.id`, [owner]))
      .map((one) => ({ ...one, last_ok: one.last_ok === null ? null : Boolean(one.last_ok) }));
  }

  function checked(input: ConnectionInput) {
    if (!SERVER_KINDS.includes(input.kind as ServerKind)) throw new Problem(400, 'Life Is connects to Jellyfin or Emby');
    const every = input.every_hours ?? 0;
    if (!EVERY_CHOICES.includes(every)) throw new Problem(400, 'Choose one of the offered times');
    return { kind: input.kind as ServerKind, url: serverUrl(input.url), every, name: clean(input.name, 80) };
  }

  /** Keep each title's cover that the collection doesn't have yet. A few hundred at a time: the rest next sync. */
  async function fetchCovers(wanted: { mediaId: number; url: string }[]): Promise<number> {
    const missing = new Set((await db.all<{ id: number }>(
      'SELECT id FROM media WHERE owner_id = ? AND id NOT IN (SELECT media_id FROM media_covers)', [owner])).map((r) => r.id));
    let kept = 0;
    for (const { mediaId, url } of wanted) {
      if (kept >= COVERS_PER_SYNC) break;
      if (!missing.has(mediaId)) continue;
      missing.delete(mediaId);
      try {
        const answer = await tools.fetcher(url, {});
        if (answer.status !== 200 || !answer.type?.startsWith('image/')) continue;
        const bytes = await answer.bytes();
        if (bytes.length === 0 || bytes.length > 2_000_000) continue;
        await atomic(db, async (tx) => {
          if (!(await tx.get('SELECT id FROM media WHERE id = ? AND owner_id = ?', [mediaId, owner]))) return;
          await tx.run('INSERT OR REPLACE INTO media_covers (media_id, type, bytes) VALUES (?, ?, ?)', [mediaId, answer.type!.split(';')[0]!.trim(), bytes]);
          await tx.run('UPDATE media SET cover = ? WHERE id = ?', [`/api/media/${mediaId}/cover`, mediaId]);
        });
        kept += 1;
      } catch {
        // A cover that can't be fetched is tried again next sync.
      }
    }
    return kept;
  }

  return {
    list: () => list(db),

    /** Add a server. The address and the key are tried first: a connection that can't work isn't saved. */
    async create(input: ConnectionInput): Promise<Connection[]> {
      const c = checked(input);
      const key = (input.secret ?? '').trim();
      if (!key) throw new Problem(400, `Paste a key from ${NAMES[c.kind]}: Dashboard, then API Keys`);
      const name = c.name ?? await serverName(tools.fetcher, c.kind, c.url);
      await readServerOnce(c.kind, c.url, key);
      await db.run('INSERT INTO media_sources (owner_id, kind, name, url, secret, every_hours, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [owner, c.kind, name, c.url, tools.sealer.seal(key), c.every, now()]);
      return list(db);
    },

    /** Change a server's name, address, key or how often it syncs. A key left empty stays as it is. */
    async update(id: number, input: ConnectionInput): Promise<Connection[]> {
      const before = await row(db, id);
      const c = checked({ ...input, kind: before.kind });
      const key = (input.secret ?? '').trim();
      if (key || c.url !== before.url) {
        const use = key || (before.secret ? tools.sealer.unseal(before.secret) : null);
        if (!use) throw new Problem(400, 'Paste the key again: the saved one can no longer be opened on this computer');
        await readServerOnce(c.kind, c.url, use);
      }
      await db.run('UPDATE media_sources SET name = ?, url = ?, secret = ?, every_hours = ? WHERE id = ?',
        [c.name ?? before.name, c.url, key ? tools.sealer.seal(key) : before.secret, c.every, id]);
      return list(db);
    },

    /**
     * Remove a server. Its copies stay in the collection as ordinary copies, unless `withCopies`: then they
     * go, and so does any title that was only there for the server.
     */
    async remove(id: number, withCopies = false): Promise<Connection[]> {
      const connection = await row(db, id);
      return atomic(db, async (tx) => {
        if (withCopies) await applyImport(tx, owner, connection, [], now());
        await tx.run('DELETE FROM media_sources WHERE id = ?', [id]);
        return list(tx);
      });
    },

    /** Read the server's library and make the collection match it. Whether it worked is kept on the connection. */
    async sync(id: number): Promise<SyncResult> {
      const connection = await row(db, id);
      try {
        const key = connection.secret ? tools.sealer.unseal(connection.secret) : null;
        if (!key) throw new Problem(400, 'Paste the key again: the saved one can no longer be opened on this computer');
        const items = await readServer(tools.fetcher, connection.kind, connection.url, key);
        const { result, wantsCover } = await atomic(db, (tx) => applyImport(tx, owner, connection, items, now()));
        const covers = await fetchCovers(wantsCover);
        const said = `${result.total} on the server` + (result.added ? `, ${result.added} added` : '') + (result.removed ? `, ${result.removed} gone` : '');
        await db.run('UPDATE media_sources SET last_sync_at = ?, last_ok = 1, last_message = ? WHERE id = ?', [now(), said, id]);
        return { ...result, covers };
      } catch (problem) {
        const said = problem instanceof Problem ? problem.message : 'Something went wrong while syncing';
        await db.run('UPDATE media_sources SET last_sync_at = ?, last_ok = 0, last_message = ? WHERE id = ?', [now(), said, id]);
        throw problem;
      }
    },
  };

  /** Ask for one page with the key, to find out now whether the key works. */
  async function readServerOnce(kind: ServerKind, url: string, key: string): Promise<void> {
    await ask(tools.fetcher, kind, `${url}/Items?${new URLSearchParams({ recursive: 'true', includeItemTypes: 'Movie', limit: '1' })}`, authHeaders(kind, key));
  }
}

export type Connections = ReturnType<typeof connections>;
