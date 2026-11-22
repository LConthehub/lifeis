/**
 * Book servers: a library you run yourself, brought into the collection so every book you have is in one
 * place. Life Is only ever reads from them; nothing on a server is changed. Each copy keeps a link that
 * opens the book on its server.
 *
 * Three servers are known by name, and anything else that offers an OPDS catalogue can be given by its
 * address:
 *   - Audiobookshelf: its own way of answering, with a key (Settings, Users, your user, API token).
 *   - Calibre-Web: an OPDS catalogue at /opds, with your username and password.
 *   - Kavita: an OPDS catalogue whose address holds your key (User settings, 3rd Party Clients, OPDS).
 *   - OPDS: the address of a list of books in any other catalogue (Calibre itself, Komga, COPS).
 *
 * Kindle, Apple Books and Google Play Books offer no way to read a library, so they can't be linked here;
 * a list from them can be brought in (bookList.ts), and a copy can carry a link that opens it there.
 *
 * `fetcher` asks a web address for its answer and `sealer` locks the sign-in; both are handed in because
 * they differ by where Life Is runs.
 */
import { applyImport, serverUrl, type Answer, type Fetcher, type Imported, type Sealer, type SyncResult } from './connections.ts';
import { atomic, type Db, type Queries } from './db.ts';
import { Problem } from './problem.ts';
import { clean, stamp, type Clock } from './small.ts';

export const LIBRARY_KINDS = ['audiobookshelf', 'calibre-web', 'kavita', 'opds'] as const;
export type LibraryKind = (typeof LIBRARY_KINDS)[number];
export const LIBRARY_NAMES: Record<LibraryKind, string> = { audiobookshelf: 'Audiobookshelf', 'calibre-web': 'Calibre-Web', kavita: 'Kavita', opds: 'An OPDS catalog' };
/** What each asks for, so the page can ask the right questions. */
export const LIBRARY_NEEDS: Record<LibraryKind, { address: string; key?: string; login?: boolean; hint: string }> = {
  audiobookshelf: { address: 'http://192.168.1.20:13378', key: 'API token', hint: 'In Audiobookshelf: Settings, Users, your user, then copy the API token.' },
  'calibre-web': { address: 'http://192.168.1.20:8083', login: true, hint: 'Your Calibre-Web username and password. Life Is reads its catalog at /opds.' },
  kavita: { address: 'http://192.168.1.20:5000', key: 'API key', hint: 'In Kavita: your user settings, then 3rd Party Clients, then copy the API key.' },
  opds: { address: 'http://192.168.1.20:8080/opds/books', login: true, hint: 'The address of a list of books, not a menu. A username and password only if it asks for them.' },
};

export type LibraryInput = { kind: string; url: string; key?: string | null; username?: string | null; password?: string | null; name?: string | null; every_hours?: number | null };
export type Library = {
  id: number; kind: LibraryKind; name: string; url: string; every_hours: number;
  last_sync_at: string | null; last_ok: boolean | null; last_message: string | null; copies: number;
};
type Secret = { key?: string; username?: string; password?: string };
type Row = Omit<Library, 'last_ok' | 'copies'> & { last_ok: number | null; secret: string | null; owner_id: number };

const EVERY = [0, 1, 6, 24, 168];
const MAX_PAGES = 400;
const COVERS_PER_SYNC = 300;
const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value.trim() : null);

// ---------- reading a catalogue (OPDS is Atom, a kind of XML) ----------

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
/** The words out of a piece of a feed: tags gone, &amp; and its kind turned back into letters. */
export function plain(xml: string | undefined | null): string | null {
  if (!xml) return null;
  const inner = /^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/.exec(xml)?.[1] ?? xml;
  const out = inner.replace(/<[^>]+>/g, ' ').replace(/&(#x?[0-9a-fA-F]+|\w+);/g, (whole, name: string) => {
    if (name[0] === '#') { const n = name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10); return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : ''; }
    return ENTITIES[name] ?? whole;
  }).replace(/\s+/g, ' ').trim();
  return out || null;
}
/** A description as plain words. Servers often send it as escaped HTML (Calibre-Web does, with its &amp; escaped again), so it is read twice. */
const words = (xml: string | undefined | null): string | null => {
  const once = plain(xml);
  // Taking tags out leaves a space where each was, so "<b>manners</b>." would read "manners .".
  return once && /<\/?[a-z][^>]*>|&(?:#\d+|#x[0-9a-f]+|[a-z]+);/i.test(once) ? plain(once)?.replace(/\s+([.,;:!?])/g, '$1') ?? null : once;
};
const tag = (xml: string, name: string) => new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i').exec(xml)?.[1];
const attribute = (element: string, name: string) => plain(new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i').exec(element)?.slice(1).find((v) => v !== undefined));
type Link = { rel: string; type: string; href: string };
const linksIn = (xml: string): Link[] => [...xml.matchAll(/<link\b[^>]*>/gi)].map(([element]) => ({
  rel: attribute(element, 'rel') ?? '', type: attribute(element, 'type') ?? '', href: attribute(element, 'href') ?? '',
})).filter((l) => l.href);

export type OpdsEntry = Imported & { /** Whether it's a book to have (it can be downloaded), or only a way further into the catalogue. */ book: boolean; /** Where this entry leads, when it's a way further in. */ leads: string | null; /** Where each file of the book can be downloaded. */ files: string[] };
export type OpdsPage = { entries: OpdsEntry[]; next: string | null };

/** One page of an OPDS catalogue, read. `at` is the page's own address, which the links in it are relative to. */
export function readOpdsPage(xml: string, at: string): OpdsPage {
  if (!/<feed[\s>]/i.test(xml)) throw new Problem(400, "That address answered, but not with a catalog of books (an OPDS feed)");
  const resolve = (href: string) => { try { return new URL(href, at).href; } catch { return null; } };
  const entries: OpdsEntry[] = [];
  for (const [entry] of xml.matchAll(/<entry[\s>][\s\S]*?<\/entry>/gi)) {
    const title = plain(tag(entry, 'title'));
    if (!title) continue;
    const links = linksIn(entry);
    const get = links.filter((l) => l.rel.includes('opds-spec.org/acquisition'));
    const cover = links.find((l) => l.rel.includes('opds-spec.org/image') && !l.rel.includes('thumbnail')) ?? links.find((l) => l.rel.includes('opds-spec.org/image'));
    const further = links.find((l) => l.type.includes('profile=opds-catalog') || (l.type.includes('atom+xml') && !l.rel.includes('acquisition')));
    const page = links.find((l) => l.rel === 'alternate' && l.type.includes('text/html'));
    const authors = [...entry.matchAll(/<author[\s>][\s\S]*?<\/author>/gi)].map(([a]) => plain(tag(a, 'name'))).filter((n): n is string => Boolean(n));
    const genres = [...entry.matchAll(/<category\b[^>]*>/gi)].map(([c]) => attribute(c, 'label') ?? attribute(c, 'term')).filter((g): g is string => Boolean(g));
    const when = plain(tag(entry, 'dc:issued') ?? tag(entry, 'dcterms:issued') ?? tag(entry, 'dc:date') ?? tag(entry, 'published'));
    const year = /\b(1[0-9]|20)\d{2}\b/.exec(when ?? '')?.[0];
    const ids: Record<string, string> = {};
    for (const [, value] of entry.matchAll(/<(?:dc:|dcterms:)?identifier(?:\s[^>]*)?>([\s\S]*?)<\/(?:dc:|dcterms:)?identifier>/gi)) {
      const isbn = /(?:isbn[:\s]*)?(97[89][\d-]{10,14}|\d{9}[\dXx])\b/i.exec(plain(value ?? '') ?? '');
      if (isbn && /isbn/i.test(value ?? '')) ids.isbn = isbn[1]!.replace(/-/g, '');
    }
    const types = get.map((l) => l.type.toLowerCase()).join(' ');
    const id = plain(tag(entry, 'id')) ?? title;
    // Calibre-Web starts its description with lines of its own ("TAGS: ...", "SERIES: ..."), which aren't part of the book's.
    const described = (tag(entry, 'summary') ?? tag(entry, 'content'))?.replace(/\b(?:RATING|TAGS|SERIES):[^<]*<br\s*\/?>/g, '');
    entries.push({
      sourceId: id.slice(0, 300), type: 'book', title, creator: authors.length ? authors.slice(0, 4).join(', ') : null,
      year: year ? Number(year) : null, summary: words(described), genres: [...new Set(genres)].slice(0, 12), minutes: null, ids,
      files: get.map((l) => resolve(l.href)).filter((h): h is string => Boolean(h)),
      coverUrl: cover ? resolve(cover.href) : null,
      format: /audio|mpeg|m4b/.test(types) ? 'Audiobook' : /cbz|cbr|comic/.test(types) ? 'Comic' : 'eBook',
      link: page ? resolve(page.href) : null,
      book: get.length > 0, leads: further ? resolve(further.href) : null,
    });
  }
  // The feed's own "next page" link sits outside its entries.
  const outside = xml.replace(/<entry[\s>][\s\S]*?<\/entry>/gi, '');
  const next = linksIn(outside).find((l) => l.rel === 'next');
  return { entries, next: next ? resolve(next.href) : null };
}

const basic = (s: Secret): Record<string, string> => (s.username ? { Authorization: `Basic ${btoa(unescape(encodeURIComponent(`${s.username}:${s.password ?? ''}`)))}` } : {});

async function get(fetcher: Fetcher, who: string, url: string, headers: Record<string, string>): Promise<Answer> {
  let answer: Answer;
  try {
    answer = await fetcher(url, headers);
  } catch {
    throw new Problem(400, `Couldn't reach ${who} at that address. If it's on the same computer as Life Is, and Life Is runs in Docker, use http://host.docker.internal and its port instead of localhost.`);
  }
  if (answer.status === 401 || answer.status === 403) throw new Problem(400, `${who} didn't accept that sign-in`);
  if (answer.status === 404) throw new Problem(400, `${who} has nothing at that address. Check the address, and that its catalog is turned on.`);
  if (answer.status !== 200) throw new Problem(400, `${who} answered with an error (${answer.status})`);
  return answer;
}

/** Every page of a list of books, following its "next" links. With `all`, every entry counts, not only those that can be downloaded. */
async function readOpds(fetcher: Fetcher, who: string, start: string, headers: Record<string, string>, all = false, limit = 0): Promise<OpdsEntry[]> {
  const out: OpdsEntry[] = [];
  const seen = new Set<string>();
  let at: string | null = start;
  for (let pages = 0; at && pages < MAX_PAGES; pages += 1) {
    if (seen.has(at)) break;
    seen.add(at);
    const answer = await get(fetcher, who, at, { Accept: 'application/atom+xml,application/xml;q=0.9,*/*;q=0.5', ...headers });
    const page = readOpdsPage(new TextDecoder().decode(await answer.bytes()), at);
    out.push(...page.entries.filter((e) => all || e.book));
    // A menu rather than a list of books: say so, as it is the commonest mistake.
    if (pages === 0 && !all && page.entries.length > 0 && !page.entries.some((e) => e.book)) {
      throw new Problem(400, 'That address is a menu, not a list of books. Open it in a browser, follow it to the list you want (such as "All books"), and give that address.');
    }
    if (limit && out.length >= limit) break;
    at = page.next;
  }
  return out;
}

/** A Calibre-Web book's number, from its download or cover address (every book has a download; only some have a cover). */
const calibreWebNumber = (entry: OpdsEntry): string | null =>
  [...entry.files, entry.coverUrl ?? ''].map((a) => /\/opds\/(?:cover|download)\/(\d+)/.exec(a)?.[1]).find(Boolean) ?? null;

/** Everything a book server has, as the collection needs it. `limit` reads only that many, to try a sign-in. */
export async function readLibrary(fetcher: Fetcher, kind: LibraryKind, url: string, secret: Secret, limit = 0): Promise<{ items: Imported[]; coverHeaders: Record<string, string> }> {
  const who = LIBRARY_NAMES[kind];
  if (kind === 'audiobookshelf') {
    const headers = { Accept: 'application/json', Authorization: `Bearer ${secret.key ?? ''}` };
    const json = async (address: string) => {
      const answer = await get(fetcher, who, address, headers);
      try { return await answer.json() as Record<string, unknown>; } catch { throw new Problem(400, `That address answered, but not like ${who} does`); }
    };
    const libraries = (await json(`${url}/api/libraries`)).libraries;
    if (!Array.isArray(libraries)) throw new Problem(400, `That address answered, but not like ${who} does`);
    const items: Imported[] = [];
    for (const library of libraries as Record<string, unknown>[]) {
      if (library.mediaType !== 'book' || !text(library.id)) continue;
      for (let page = 0; page < MAX_PAGES; page += 1) {
        const got = await json(`${url}/api/libraries/${encodeURIComponent(String(library.id))}/items?limit=100&page=${page}&minified=1`);
        const results = Array.isArray(got.results) ? got.results as Record<string, unknown>[] : [];
        for (const item of results) {
          const media = (item.media ?? {}) as Record<string, unknown>;
          const meta = (media.metadata ?? {}) as Record<string, unknown>;
          const id = text(item.id);
          const title = text(meta.title);
          if (!id || !title) continue;
          // Files that have gone from the disk, or can't be read, are still listed by the server.
          if (item.isMissing === true || item.isInvalid === true) continue;
          // A title with an audio file is an Audiobook even when an eBook file sits beside it (it then also has media.ebookFormat).
          const seconds = typeof media.duration === 'number' ? media.duration : 0;
          const audio = (typeof media.numAudioFiles === 'number' && media.numAudioFiles > 0) || seconds > 0;
          const year = /\b(1[0-9]|20)\d{2}\b/.exec(String(meta.publishedYear ?? ''))?.[0];
          const ids: Record<string, string> = {};
          if (text(meta.isbn)) ids.isbn = text(meta.isbn)!.replace(/-/g, '');
          if (text(meta.asin)) ids.asin = text(meta.asin)!;
          items.push({
            sourceId: id, type: 'book', title, creator: text(meta.authorName) ?? text(meta.authorNameLF), year: year ? Number(year) : null,
            summary: plain(text(meta.description)), genres: Array.isArray(meta.genres) ? meta.genres.filter((g): g is string => typeof g === 'string') : [],
            minutes: seconds > 0 ? Math.max(1, Math.round(seconds / 60)) : null, ids,
            coverUrl: `${url}/api/items/${encodeURIComponent(id)}/cover?width=300`,
            format: audio ? 'Audiobook' : 'eBook', link: `${url}/audiobookshelf/item/${encodeURIComponent(id)}`,
          });
        }
        const total = typeof got.total === 'number' ? got.total : 0;
        if (results.length === 0 || (page + 1) * 100 >= total || (limit && items.length >= limit)) break;
      }
      if (limit && items.length >= limit) break;
    }
    return { items, coverHeaders: { Authorization: headers.Authorization } };
  }
  if (kind === 'kavita') {
    // Kavita's catalogue address holds the key. Its libraries are a menu; each leads to a list of series.
    const root = `${url}/api/opds/${encodeURIComponent(secret.key ?? '')}`;
    const libraries = await readOpds(fetcher, who, `${root}/libraries`, {}, true);
    const items: Imported[] = [];
    for (const library of libraries) {
      if (!library.leads) continue;
      const libraryId = /\/libraries\/(\d+)/.exec(library.leads)?.[1];
      for (const series of await readOpds(fetcher, who, library.leads, {}, true, limit)) {
        const seriesId = /\/series\/(\d+)/.exec(series.leads ?? '')?.[1] ?? (/^\d+$/.test(series.sourceId) ? series.sourceId : null);
        // Kavita opens each summary with what it knows of the files ("Format: Epub     Summary: ...").
        const summary = series.summary?.replace(/^(?:Format|File Type):.*?(?:Summary:\s*|$)/i, '').trim() || null;
        items.push({ ...series, summary, sourceId: seriesId ? `series-${seriesId}` : series.sourceId, format: 'eBook',
          link: seriesId && libraryId ? `${url}/library/${libraryId}/series/${seriesId}` : null });
      }
      if (limit && items.length >= limit) break;
    }
    return { items, coverHeaders: {} };
  }
  const headers = basic(secret);
  if (kind === 'calibre-web') {
    // Its own ids can't be trusted (books added without Calibre all share "urn:uuid:None"), so the book's number is the id.
    const items = (await readOpds(fetcher, who, `${url}/opds/books/letter/00`, headers, false, limit)).map((e) => {
      const n = calibreWebNumber(e);
      return { ...e, sourceId: n ? `book-${n}` : e.sourceId, link: n ? `${url}/book/${n}` : e.link };
    });
    return { items, coverHeaders: headers };
  }
  return { items: await readOpds(fetcher, who, url, headers, false, limit), coverHeaders: headers };
}

// ---------- the book servers a person has added ----------

/** Every book server whose turn it is to sync by itself, across everyone. */
export async function librariesDue(db: Db, clock: Clock): Promise<{ id: number; owner_id: number }[]> {
  const now = clock().getTime();
  return (await db.all<{ id: number; owner_id: number; every_hours: number; last_sync_at: string | null }>(
    'SELECT id, owner_id, every_hours, last_sync_at FROM library_sources WHERE every_hours > 0'))
    .filter((row) => !row.last_sync_at || !(now - new Date(row.last_sync_at).getTime() < row.every_hours * 3_600_000)).map(({ id, owner_id }) => ({ id, owner_id }));
}

export function libraries(db: Db, owner: number, clock: Clock, tools: { fetcher: Fetcher; sealer: Sealer }) {
  const now = () => stamp(clock());

  async function row(q: Queries, id: number): Promise<Row> {
    const found = await q.get<Row>('SELECT id, owner_id, kind, name, url, secret, every_hours, last_sync_at, last_ok, last_message FROM library_sources WHERE id = ? AND owner_id = ?', [id, owner]);
    if (!found) throw new Problem(404, 'Not found');
    return found;
  }
  async function list(q: Queries): Promise<Library[]> {
    const rows = await q.all<Row & { copies: number }>(
      `SELECT s.id, s.kind, s.name, s.url, s.every_hours, s.last_sync_at, s.last_ok, s.last_message,
              (SELECT COUNT(*) FROM media_copies c WHERE c.library_source_id = s.id) AS copies
       FROM library_sources s WHERE s.owner_id = ? ORDER BY s.name COLLATE NOCASE, s.id`, [owner]);
    return rows.map(({ last_ok, ...r }) => ({ ...r, last_ok: last_ok === null ? null : last_ok === 1 }));
  }
  function checked(input: LibraryInput): { kind: LibraryKind; url: string; name: string | null; every: number } {
    if (!LIBRARY_KINDS.includes(input.kind as LibraryKind)) throw new Problem(400, "That isn't a book server Life Is knows");
    const every = input.every_hours ?? 0;
    if (!EVERY.includes(every)) throw new Problem(400, 'It can sync by itself every hour, every 6 hours, every day or every week, or not at all');
    return { kind: input.kind as LibraryKind, url: serverUrl(input.url), name: clean(input.name, 80), every };
  }
  /** The sign-in as given, checked for what this kind of server needs. Null: nothing was given. */
  function signIn(kind: LibraryKind, input: LibraryInput): Secret | null {
    const key = text(input.key);
    const username = text(input.username);
    if (LIBRARY_NEEDS[kind].key) return key ? { key } : null;
    if (username) return { username, password: input.password ?? '' };
    return kind === 'opds' ? {} : null;
  }
  const opened = (r: Row): Secret => {
    const plainText = r.secret ? tools.sealer.unseal(r.secret) : null;
    if (plainText === null) throw new Problem(400, 'Give the sign-in again: the saved one can no longer be opened on this computer');
    try { return JSON.parse(plainText) as Secret; } catch { throw new Problem(400, 'Give the sign-in again: the saved one can no longer be read'); }
  };

  async function keepCovers(wanted: { mediaId: number; url: string }[], headers: Record<string, string>): Promise<number> {
    const missing = new Set((await db.all<{ id: number }>('SELECT id FROM media WHERE owner_id = ? AND id NOT IN (SELECT media_id FROM media_covers)', [owner])).map((r) => r.id));
    let kept = 0;
    for (const { mediaId, url } of wanted) {
      if (kept >= COVERS_PER_SYNC) break;
      if (!missing.has(mediaId)) continue;
      missing.delete(mediaId);
      try {
        const answer = await tools.fetcher(url, headers);
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

  const as = (kind: LibraryKind) => ({ column: 'library_source_id' as const, source: kind, format: 'eBook' });

  return {
    list: () => list(db),

    /** Add a book server. The address and the sign-in are tried first: one that can't work isn't saved. */
    async create(input: LibraryInput): Promise<Library[]> {
      const c = checked(input);
      const secret = signIn(c.kind, input);
      if (!secret) throw new Problem(400, LIBRARY_NEEDS[c.kind].key ? `Paste the ${LIBRARY_NEEDS[c.kind].key} from ${LIBRARY_NAMES[c.kind]}` : `Give your ${LIBRARY_NAMES[c.kind]} username and password`);
      await readLibrary(tools.fetcher, c.kind, c.url, secret, 1);
      await db.run('INSERT INTO library_sources (owner_id, kind, name, url, secret, every_hours, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [owner, c.kind, c.name ?? (c.kind === 'opds' ? new URL(c.url).host : LIBRARY_NAMES[c.kind]), c.url, tools.sealer.seal(JSON.stringify(secret)), c.every, now()]);
      return list(db);
    },

    /** Change a book server's name, address, sign-in or how often it syncs. A sign-in left empty stays as it is. */
    async update(id: number, input: LibraryInput): Promise<Library[]> {
      const before = await row(db, id);
      const c = checked({ ...input, kind: before.kind });
      const given = signIn(c.kind, input);
      const fresh = given && (given.key || given.username) ? given : null;
      if (fresh || c.url !== before.url) await readLibrary(tools.fetcher, c.kind, c.url, fresh ?? opened(before), 1);
      await db.run('UPDATE library_sources SET name = ?, url = ?, secret = ?, every_hours = ? WHERE id = ?',
        [c.name ?? before.name, c.url, fresh ? tools.sealer.seal(JSON.stringify(fresh)) : before.secret, c.every, id]);
      return list(db);
    },

    /** Remove a book server. Its copies stay as ordinary copies, unless `withCopies`: then they go too. */
    async remove(id: number, withCopies = false): Promise<Library[]> {
      const source = await row(db, id);
      return atomic(db, async (tx) => {
        if (withCopies) await applyImport(tx, owner, source, [], now(), as(source.kind));
        await tx.run('DELETE FROM library_sources WHERE id = ?', [id]);
        return list(tx);
      });
    },

    /** Read the server's library and make the collection match it. Whether it worked is kept on the server. */
    async sync(id: number): Promise<SyncResult> {
      const source = await row(db, id);
      try {
        const { items, coverHeaders } = await readLibrary(tools.fetcher, source.kind, source.url, opened(source));
        const { result, wantsCover } = await atomic(db, (tx) => applyImport(tx, owner, source, items, now(), as(source.kind)));
        const covers = await keepCovers(wantsCover, coverHeaders);
        const said = `${result.total} on the server` + (result.added ? `, ${result.added} added` : '') + (result.removed ? `, ${result.removed} gone` : '');
        await db.run('UPDATE library_sources SET last_sync_at = ?, last_ok = 1, last_message = ? WHERE id = ?', [now(), said, id]);
        return { ...result, covers };
      } catch (problem) {
        const said = problem instanceof Problem ? problem.message : 'Something went wrong while syncing';
        await db.run('UPDATE library_sources SET last_sync_at = ?, last_ok = 0, last_message = ? WHERE id = ?', [now(), said, id]);
        throw problem;
      }
    },
  };
}

export type Libraries = ReturnType<typeof libraries>;
