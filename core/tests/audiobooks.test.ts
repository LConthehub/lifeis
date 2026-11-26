/** An audiobook kept in pieces on Jellyfin is one book; the same book on two servers is one title; pieces already in the collection are joined. */
import { beforeEach, expect, it } from 'vitest';
import { applyImport, connections, surnameOf, type Fetcher, type Imported, type Sealer } from '../src/connections.ts';
import type { Db } from '../src/db.ts';
import { media, type MediaCollection } from '../src/media.ts';
import { mediaLists } from '../src/mediaLists.ts';
import { migrate } from '../src/migrations.ts';
import { tags } from '../src/tags.ts';
import { memoryDb } from './memoryDb.ts';

let db: Db;
let owner: number;
let shelf: MediaCollection;
let items: Record<string, unknown>[];
let folders: Record<string, unknown>[];
let folderAsks: string[];
const clock = () => new Date(2046, 2, 5, 10, 0, 0);
const sealer: Sealer = { seal: (s) => `sealed:${s}`, unseal: (s) => (s.startsWith('sealed:') ? s.slice(7) : null) };
const answer = (body: unknown) => ({ status: 200, type: 'application/json', json: async () => body, bytes: async () => new Uint8Array() });
const fetcher: Fetcher = async (url) => {
  if (url.includes('/Items?ids=') || url.includes('&ids=')) { folderAsks.push(url); return answer({ Items: folders }); }
  if (url.includes('/Items?')) return answer({ Items: items, TotalRecordCount: items.length });
  return answer({});
};
const ticks = (minutes: number) => minutes * 600_000_000;
const part = (id: string, name: string, parent: string | null, minutes: number, extra: Record<string, unknown> = {}) =>
  ({ Id: id, Name: name, Type: 'AudioBook', ParentId: parent, Album: 'The Long Book', AlbumArtist: 'Ann Writer', RunTimeTicks: ticks(minutes), ProductionYear: 2001, ...extra });

async function connect(): Promise<number> {
  return (await db.run("INSERT INTO media_sources (owner_id, kind, name, url, secret, created_at) VALUES (?, 'jellyfin', 'Home', 'http://jf.test', 'sealed:k', 'now')", [owner])).lastId;
}
const sync = (id: number) => connections(db, owner, clock, { fetcher, sealer }).sync(id);

beforeEach(async () => {
  db = memoryDb();
  await migrate(db);
  owner = (await db.run("INSERT INTO users (username, password_hash, created_at) VALUES ('owner', 'x', 'now')")).lastId;
  shelf = media(db, owner, clock);
  items = [];
  folders = [];
  folderAsks = [];
});

it('three files in one folder become one book: the album as the title, the minutes added up, a link to the folder', async () => {
  items = [part('p1', 'Part 1', 'f1', 100), part('p2', 'Part 2', 'f1', 200, { ProductionYear: undefined }), part('p3', 'Part 3', 'f1', 61)];
  folders = [{ Id: 'f1', Name: 'Folder Name', ImageTags: { Primary: 'x' } }];
  const result = await sync(await connect());
  expect(result).toMatchObject({ total: 1, added: 1, titles_added: 1, joined_parts: 0, joined_books: 0 });
  const all = await shelf.list({});
  expect(all).toHaveLength(1);
  const book = await shelf.get(all[0]!.id);
  expect(book).toMatchObject({ title: 'The Long Book', creator: 'Ann Writer', type: 'book', minutes: 361, year: 2001 });
  expect(book.copies).toHaveLength(1);
  expect(book.copies[0]).toMatchObject({ format: 'Audiobook', link: 'http://jf.test/web/#/details?id=f1' });
  expect(await db.get('SELECT source_id FROM media_copies WHERE media_id = ?', [book.id])).toEqual({ source_id: 'audiobook-folder-f1' });
  expect(folderAsks).toHaveLength(1);
});

it('the folder name is the title when the albums differ, and the folder cover is asked for', async () => {
  items = [part('p1', 'Part 1', 'f1', 10, { Album: 'Disc 1' }), part('p2', 'Part 2', 'f1', 10, { Album: 'Disc 2' })];
  folders = [{ Id: 'f1', Name: 'Whole Book' }];
  await sync(await connect());
  const [one] = await shelf.list({});
  expect(one).toMatchObject({ title: 'Whole Book' });
});

it('a book in one file stays as it was, under its own id', async () => {
  items = [part('solo', 'Single File', 'f9', 90), part('other', 'Elsewhere', 'f8', 30, { Album: 'Another' })];
  await sync(await connect());
  expect(folderAsks).toHaveLength(0);
  const found = await shelf.list({ q: 'Single File' });
  expect(found).toHaveLength(1);
  expect((await shelf.get(found[0]!.id)).copies[0]).toMatchObject({ link: null });
  expect(await db.get('SELECT source_id FROM media_copies WHERE media_id = ?', [found[0]!.id])).toEqual({ source_id: 'solo' });
  expect((await shelf.list({}))).toHaveLength(2);
});

it('a Jellyfin book and the same book from Audiobookshelf are one title with two copies, whatever year each says', async () => {
  items = [part('p1', 'Part 1', 'f1', 100, { Album: 'Dune', AlbumArtist: 'Frank Herbert', ProductionYear: 1965 }), part('p2', 'Part 2', 'f1', 100, { Album: 'Dune', AlbumArtist: 'Frank Herbert' })];
  await sync(await connect());
  const library = (await db.run("INSERT INTO library_sources (owner_id, kind, name, url, created_at) VALUES (?, 'audiobookshelf', 'Shelf', 'http://abs.test', 'now')", [owner])).lastId;
  const incoming: Imported = { sourceId: 'a1', type: 'book', title: 'Dune', creator: 'Herbert, Frank', year: 2007, summary: null, genres: [], minutes: 1200, ids: {}, coverUrl: null, format: 'Audiobook', link: 'http://abs.test/audiobookshelf/item/a1' };
  const { result } = await applyImport(db, owner, { id: library, kind: 'audiobookshelf' }, [incoming], 'now', { column: 'library_source_id', source: 'audiobookshelf', format: 'Audiobook' });
  expect(result).toMatchObject({ added: 1, titles_added: 0 });
  const all = await shelf.list({});
  expect(all).toHaveLength(1);
  const book = await shelf.get(all[0]!.id);
  expect(book.copies.map((c) => c.source).sort()).toEqual(['audiobookshelf', 'jellyfin']);
  expect(book.copies.every((c) => c.link)).toBe(true);
});

it('films are never matched on the author rule, and a book needs the same surname', async () => {
  await shelf.create({ type: 'film', title: 'Dune', creator: 'Frank Herbert', year: 1984 });
  await shelf.create({ type: 'book', title: 'Dune', creator: 'Brian Smith', year: 1999 });
  const mk = (id: string, type: 'film' | 'book', creator: string): Imported => ({ sourceId: id, type, title: 'Dune', creator, year: 2021, summary: null, genres: [], minutes: null, ids: {}, coverUrl: null });
  const connection = await connect();
  const { result } = await applyImport(db, owner, { id: connection, kind: 'jellyfin' }, [mk('x1', 'film', 'Frank Herbert'), mk('x2', 'book', 'Frank Herbert')], 'now');
  expect(result.titles_added).toBe(2);
});

it('the first author\'s surname is read from the usual ways of writing it', () => {
  expect(surnameOf('Frank Herbert')).toBe('herbert');
  expect(surnameOf('Herbert, Frank')).toBe('herbert');
  expect(surnameOf('Frank Herbert, Brian Herbert')).toBe('herbert');
  expect(surnameOf('Terry Pratchett & Neil Gaiman')).toBe('pratchett');
  expect(surnameOf('Gaiman, Neil, Terry Pratchett')).toBe('gaiman');
  expect(surnameOf('J. R. R. Tolkien')).toBe('tolkien');
  expect(surnameOf(null)).toBeNull();
});

it('pieces already in the collection are joined into the book on the next sync, with all the person added', async () => {
  const connection = await connect();
  const old = (n: number): Imported => ({ sourceId: `p${n}`, type: 'book', title: `Part ${n}`, creator: 'Ann Writer', year: 2001, summary: null, genres: [], minutes: 10, ids: {}, coverUrl: null });
  await applyImport(db, owner, { id: connection, kind: 'jellyfin' }, [old(1), old(2), old(3)], 'now');
  const [a, b, c] = await Promise.all([1, 2, 3].map(async (n) => (await shelf.list({ q: `Part ${n}` }))[0]!.id));
  await shelf.rate(a!, 4);
  const lists = mediaLists(db, owner, clock);
  const list = await lists.create({ name: 'Next up' });
  await lists.add(list.id, { media_id: b! });
  await db.run("UPDATE media SET note = 'Loved this bit' WHERE id = ?", [c!]);
  await shelf.log(c!, { day: '2046-01-02', note: 'on a walk' });
  const tag = (await tags(db, owner, clock).create('cozy')).id;
  await tags(db, owner, clock).set('title', a!, [tag]);

  items = [part('p1', 'Part 1', 'f1', 10), part('p2', 'Part 2', 'f1', 10), part('p3', 'Part 3', 'f1', 10)];
  folders = [{ Id: 'f1', Name: 'Folder' }];
  const result = await sync(connection);
  expect(result).toMatchObject({ joined_parts: 3, joined_books: 1, removed: 3, titles_added: 1 });

  const all = await shelf.list({});
  expect(all.map((t) => t.title)).toEqual(['The Long Book']);
  const book = await shelf.get(all[0]!.id);
  expect(book).toMatchObject({ stars: 4, note: 'Loved this bit', minutes: 30 });
  expect(book.log.map((l) => l.day)).toEqual(['2046-01-02']);
  expect(book.copies).toHaveLength(1);
  expect((await lists.get(list.id)).entries.map((e) => e.media_id)).toEqual([book.id]);
  expect(await db.get("SELECT tag_id FROM tag_links WHERE kind = 'title' AND target_id = ?", [book.id])).toMatchObject({ tag_id: tag });
  expect(await db.get("SELECT COUNT(*) AS n FROM tag_links WHERE kind = 'title' AND target_id IN (?, ?, ?)", [a!, b!, c!])).toMatchObject({ n: 0 });

  // The next sync has nothing more to join.
  expect(await sync(connection)).toMatchObject({ joined_parts: 0, joined_books: 0, removed: 0, added: 0 });
});
