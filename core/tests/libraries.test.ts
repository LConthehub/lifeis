/** Book servers (Audiobookshelf, Calibre-Web, Kavita, any OPDS catalogue), a list of books brought in, and a link on a copy. */
import { beforeEach, expect, it } from 'vitest';
import { csvRows, importBookList, readBookList } from '../src/bookList.ts';
import type { Answer, Fetcher, Sealer } from '../src/connections.ts';
import type { Db } from '../src/db.ts';
import { libraries, librariesDue, readOpdsPage } from '../src/libraries.ts';
import { media, type MediaCollection } from '../src/media.ts';
import { migrate } from '../src/migrations.ts';
import { memoryDb } from './memoryDb.ts';

let db: Db;
let owner: number;
let shelf: MediaCollection;
let asked: { url: string; headers: Record<string, string> }[];
let pages: Record<string, { status?: number; type?: string; body: string | object | Uint8Array }>;
const clock = () => new Date(2046, 2, 5, 10, 0, 0);
const sealer: Sealer = { seal: (s) => `sealed:${s}`, unseal: (s) => (s.startsWith('sealed:') ? s.slice(7) : null) };
const fetcher: Fetcher = async (url, headers) => {
  asked.push({ url, headers });
  const page = pages[url];
  if (!page) return { status: 404, type: null, json: async () => ({}), bytes: async () => new Uint8Array() };
  const bytes = page.body instanceof Uint8Array ? page.body : new TextEncoder().encode(typeof page.body === 'string' ? page.body : JSON.stringify(page.body));
  return { status: page.status ?? 200, type: page.type ?? 'application/atom+xml', json: async () => JSON.parse(new TextDecoder().decode(bytes)) as unknown, bytes: async () => bytes } satisfies Answer;
};
const servers = () => libraries(db, owner, clock, { fetcher, sealer });
const problem = (status: number) => expect.objectContaining({ name: 'Problem', status });

beforeEach(async () => {
  db = memoryDb();
  await migrate(db);
  owner = (await db.run("INSERT INTO users (username, password_hash, created_at) VALUES ('owner', 'x', 'now')")).lastId;
  shelf = media(db, owner, clock);
  asked = [];
  pages = {};
});

const feed = (entries: string, next = '') => `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/terms/">
  <title>Books</title>${next ? `<link rel="next" type="application/atom+xml;profile=opds-catalog" href="${next}"/>` : ''}
  ${entries}
</feed>`;
const book = (n: number, title: string, author: string, extra = '') => `<entry>
  <title>${title}</title><id>urn:uuid:book-${n}</id>
  <author><name>${author}</name></author>
  <link rel="http://opds-spec.org/acquisition" type="application/epub+zip" href="/opds/download/${n}/epub/"/>
  <link rel="http://opds-spec.org/image" type="image/jpeg" href="/opds/cover/${n}"/>
  ${extra}</entry>`;

// ---------- reading a catalogue ----------

it('a page of a catalogue is read: titles, authors, the year, the ISBN, and words with &amp; in them', () => {
  const page = readOpdsPage(feed(
    book(7, 'Pride &amp; Prejudice', 'Jane Austen', '<dc:issued>1813-01-28</dc:issued><dc:identifier>urn:isbn:978-0-14-143951-8</dc:identifier><category term="Classics" label="Classics"/><summary type="html">&lt;p&gt;A novel of &lt;b&gt;manners&lt;/b&gt;.&lt;/p&gt;</summary>')
    + '<entry><title>By author</title><id>menu</id><link rel="subsection" type="application/atom+xml;profile=opds-catalog" href="/opds/author"/></entry>',
    '/opds/books?offset=30'), 'http://shelf.test/opds/books');
  expect(page.next).toBe('http://shelf.test/opds/books?offset=30');
  expect(page.entries[0]).toMatchObject({
    title: 'Pride & Prejudice', creator: 'Jane Austen', year: 1813, ids: { isbn: '9780141439518' }, genres: ['Classics'], format: 'eBook', book: true,
    coverUrl: 'http://shelf.test/opds/cover/7', sourceId: 'urn:uuid:book-7',
  });
  expect(page.entries[0]!.summary).toBe('<p>A novel of <b>manners</b>.</p>');
  expect(page.entries[1]).toMatchObject({ title: 'By author', book: false, leads: 'http://shelf.test/opds/author' });
  expect(() => readOpdsPage('<html><body>Sign in</body></html>', 'http://shelf.test')).toThrow(/catalogue/);
});

// ---------- Calibre-Web ----------

it('Calibre-Web: every page is read with your sign-in, and each book opens on its own page', async () => {
  pages['http://calibre.test/opds/books/letter/00'] = { body: feed(book(1, 'Dune', 'Frank Herbert') + book(2, 'Emma', 'Jane Austen'), '/opds/books/letter/00?offset=2') };
  pages['http://calibre.test/opds/books/letter/00?offset=2'] = { body: feed(book(3, 'Kindred', 'Octavia E. Butler')) };
  pages['http://calibre.test/opds/cover/1'] = { type: 'image/jpeg', body: new Uint8Array([255, 216, 255, 1]) };
  const [server] = await servers().create({ kind: 'calibre-web', url: 'http://calibre.test/', username: 'reader', password: 'pa ss', every_hours: 6 });
  expect(server).toMatchObject({ kind: 'calibre-web', name: 'Calibre-Web', url: 'http://calibre.test', copies: 0, last_ok: null });
  expect(asked[0]!.headers.Authorization).toBe(`Basic ${btoa('reader:pa ss')}`);
  // The sign-in is kept locked, never as it was typed.
  expect((await db.get<{ secret: string }>('SELECT secret FROM library_sources'))!.secret).toMatch(/^sealed:/);

  const result = await servers().sync(server!.id);
  expect(result).toMatchObject({ total: 3, added: 3, titles_added: 3, removed: 0, covers: 1 });
  const dune = (await shelf.list({ q: 'Dune' }))[0]!;
  expect(dune).toMatchObject({ type: 'book', creator: 'Frank Herbert', formats: ['eBook'], cover: `/api/media/${dune.id}/cover` });
  expect((await shelf.get(dune.id)).copies[0]).toMatchObject({ format: 'eBook', source: 'calibre-web', link: 'http://calibre.test/book/1' });
  expect((await servers().list())[0]).toMatchObject({ copies: 3, last_ok: true, last_message: '3 on the server, 3 added' });

  // A book gone from the server goes from the collection; one you've logged stays as a title.
  await shelf.log((await shelf.list({ q: 'Emma' }))[0]!.id, { day: '2046-03-01' });
  pages['http://calibre.test/opds/books/letter/00'] = { body: feed(book(1, 'Dune', 'Frank Herbert')) };
  expect(await servers().sync(server!.id)).toMatchObject({ total: 1, added: 0, removed: 2 });
  expect((await shelf.list()).map((m) => m.title)).toEqual(['Dune', 'Emma']);
});

it("a sign-in that isn't accepted, or an address that is a menu, is said plainly and nothing is saved", async () => {
  pages['http://calibre.test/opds/books/letter/00'] = { status: 401, body: '' };
  await expect(servers().create({ kind: 'calibre-web', url: 'http://calibre.test', username: 'a', password: 'b' })).rejects.toThrow("Calibre-Web didn't accept that sign-in");
  await expect(servers().create({ kind: 'calibre-web', url: 'http://calibre.test' })).rejects.toThrow('username and password');
  pages['http://komga.test/opds/v1.2/catalog'] = { body: feed('<entry><title>All series</title><id>a</id><link rel="subsection" type="application/atom+xml;profile=opds-catalog" href="/opds/v1.2/series"/></entry>') };
  await expect(servers().create({ kind: 'opds', url: 'http://komga.test/opds/v1.2/catalog' })).rejects.toThrow('a menu, not a list of books');
  await expect(servers().create({ kind: 'plex', url: 'http://x.test' })).rejects.toEqual(problem(400));
  expect(await servers().list()).toEqual([]);
});

it('any OPDS list of books can be given by its address, with no sign-in', async () => {
  pages['http://komga.test/opds/books'] = { body: feed(book(1, 'Saga', 'Brian K. Vaughan', '<link rel="alternate" type="text/html" href="/book/1"/>')) };
  const [server] = await servers().create({ kind: 'opds', url: 'http://komga.test/opds/books' });
  expect(server!.name).toBe('komga.test');
  expect(asked[0]!.headers.Authorization).toBeUndefined();
  await servers().sync(server!.id);
  expect((await shelf.get((await shelf.list())[0]!.id)).copies[0]).toMatchObject({ source: 'opds', link: 'http://komga.test/book/1' });
});

// ---------- Kavita ----------

it('Kavita: each library is followed to its series, with the key in the address', async () => {
  const lead = (id: string, title: string, href: string) => `<entry><title>${title}</title><id>${id}</id><link rel="subsection" type="application/atom+xml;profile=opds-catalog" href="${href}"/><link rel="http://opds-spec.org/image" type="image/jpeg" href="/api/image/series-cover?seriesId=${id}&amp;apiKey=K1"/></entry>`;
  pages['http://kavita.test/api/opds/K1/libraries'] = { body: feed(lead('1', 'Books', '/api/opds/K1/libraries/1') + lead('2', 'Comics', '/api/opds/K1/libraries/2')) };
  pages['http://kavita.test/api/opds/K1/libraries/1'] = { body: feed(lead('40', 'The Hobbit', '/api/opds/K1/series/40')) };
  pages['http://kavita.test/api/opds/K1/libraries/2'] = { body: feed(lead('41', 'Bone', '/api/opds/K1/series/41')) };
  const [server] = await servers().create({ kind: 'kavita', url: 'http://kavita.test', key: 'K1' });
  await expect(servers().create({ kind: 'kavita', url: 'http://kavita.test' })).rejects.toThrow('Paste the API key from Kavita');
  expect(await servers().sync(server!.id)).toMatchObject({ total: 2, added: 2 });
  const hobbit = await shelf.get((await shelf.list({ q: 'Hobbit' }))[0]!.id);
  expect(hobbit.copies[0]).toMatchObject({ format: 'eBook', source: 'kavita', link: 'http://kavita.test/library/1/series/40' });
});

// ---------- Audiobookshelf ----------

const absItem = (id: string, title: string, author: string, more: object = {}, isbn: string | null = '978-0441172719') => ({ id, mediaType: 'book', media: { metadata: { title, authorName: author, publishedYear: '1965', genres: ['Science Fiction'], isbn }, numAudioFiles: 12, duration: 75600, ...more } });

it('Audiobookshelf: audiobooks and eBooks come in as what they are, with how long they run', async () => {
  pages['http://abs.test/api/libraries'] = { type: 'application/json', body: { libraries: [{ id: 'lib1', mediaType: 'book' }, { id: 'pod', mediaType: 'podcast' }] } };
  pages['http://abs.test/api/libraries/lib1/items?limit=100&page=0&minified=1'] = { type: 'application/json', body: { total: 2, results: [
    absItem('a1', 'Dune', 'Frank Herbert'),
    absItem('a2', 'Emma', 'Jane Austen', { numAudioFiles: 0, duration: 0, ebookFormat: 'epub' }, null),
  ] } };
  const [server] = await servers().create({ kind: 'audiobookshelf', url: 'http://abs.test', key: 'tok' });
  expect(asked[0]!.headers.Authorization).toBe('Bearer tok');
  expect(await servers().sync(server!.id)).toMatchObject({ total: 2, added: 2 });
  const dune = await shelf.get((await shelf.list({ q: 'Dune' }))[0]!.id);
  expect(dune).toMatchObject({ minutes: 1260, year: 1965, ids: { isbn: '9780441172719' } });
  expect(dune.copies[0]).toMatchObject({ format: 'Audiobook', source: 'audiobookshelf', link: 'http://abs.test/audiobookshelf/item/a1' });
  expect((await shelf.get((await shelf.list({ q: 'Emma' }))[0]!.id)).copies[0]!.format).toBe('eBook');
  expect(asked.some((a) => a.url.includes('/pod/'))).toBe(false);
});

it('a book you already have gains a copy rather than a second title', async () => {
  const mine = await shelf.create({ type: 'book', title: 'Dune', creator: 'Frank Herbert', ids: { isbn: '9780441172719' } }, { format: 'Paperback' });
  pages['http://abs.test/api/libraries'] = { type: 'application/json', body: { libraries: [{ id: 'lib1', mediaType: 'book' }] } };
  pages['http://abs.test/api/libraries/lib1/items?limit=100&page=0&minified=1'] = { type: 'application/json', body: { total: 1, results: [absItem('a1', 'Dune (Unabridged)', 'Frank Herbert')] } };
  const [server] = await servers().create({ kind: 'audiobookshelf', url: 'http://abs.test', key: 'tok' });
  expect(await servers().sync(server!.id)).toMatchObject({ added: 1, titles_added: 0 });
  expect((await shelf.get(mine.id)).copies.map((c) => c.format).sort()).toEqual(['Audiobook', 'Paperback']);
});

it('changing, syncing by itself, and removing a book server', async () => {
  pages['http://calibre.test/opds/books/letter/00'] = { body: feed(book(1, 'Dune', 'Frank Herbert')) };
  const [server] = await servers().create({ kind: 'calibre-web', url: 'http://calibre.test', username: 'reader', password: 'p', every_hours: 6 });
  expect(await librariesDue(db, clock)).toEqual([{ id: server!.id, owner_id: owner }]);
  await servers().sync(server!.id);
  expect(await librariesDue(db, clock)).toEqual([]);
  // A new name, and no sign-in given: the saved one stays and still works.
  const [renamed] = await servers().update(server!.id, { kind: 'calibre-web', url: 'http://calibre.test', name: 'The study', every_hours: 0 });
  expect(renamed).toMatchObject({ name: 'The study', every_hours: 0 });
  await servers().sync(server!.id);
  // Another person can't see or sync it.
  const other = (await db.run("INSERT INTO users (username, password_hash, created_at) VALUES ('other', 'x', 'now')")).lastId;
  await expect(libraries(db, other, clock, { fetcher, sealer }).sync(server!.id)).rejects.toEqual(problem(404));
  // Removed: what it brought in stays as ordinary copies, or goes with it.
  expect(await servers().remove(server!.id)).toEqual([]);
  expect((await shelf.list()).map((m) => m.title)).toEqual(['Dune']);
  const [again] = await servers().create({ kind: 'calibre-web', url: 'http://calibre.test', username: 'reader', password: 'p' });
  await servers().sync(again!.id);
  await servers().remove(again!.id, true);
  expect((await shelf.get((await shelf.list())[0]!.id)).copies).toHaveLength(1);
});

// ---------- a link on a copy ----------

it('a copy can carry a link that opens it where it lives, and only a link', async () => {
  const dune = await shelf.create({ type: 'book', title: 'Dune' }, { format: 'Kindle', link: 'https://read.amazon.com/?asin=B00B7NPRY8' });
  const copy = dune.copies[0]!;
  expect(copy.link).toBe('https://read.amazon.com/?asin=B00B7NPRY8');
  // Left out: unchanged. Empty: taken off.
  expect((await shelf.updateCopy(copy.id, { format: 'Kindle' })).copies[0]!.link).toBe('https://read.amazon.com/?asin=B00B7NPRY8');
  expect((await shelf.updateCopy(copy.id, { format: 'Kindle', link: 'ibooks://assetid/123' })).copies[0]!.link).toBe('ibooks://assetid/123');
  expect((await shelf.updateCopy(copy.id, { format: 'Kindle', link: '' })).copies[0]!.link).toBeNull();
  await expect(shelf.updateCopy(copy.id, { format: 'Kindle', link: 'javascript:alert(1)' })).rejects.toEqual(problem(400));
  await expect(shelf.updateCopy(copy.id, { format: 'Kindle', link: 'file:///etc/passwd' })).rejects.toEqual(problem(400));
});

// ---------- a list of books ----------

const GOODREADS = `Book Id,Title,Author,Author l-f,Additional Authors,ISBN,ISBN13,My Rating,Average Rating,Publisher,Binding,Number of Pages,Year Published,Original Publication Year,Date Read,Date Added,Bookshelves,Bookshelves with positions,Exclusive Shelf
1,"Dune (Dune Chronicles, #1)",Frank Herbert,"Herbert, Frank",,"=""0441172717""","=""9780441172719""",5,4.25,Ace,Kindle Edition,896,1990,1965,2024/03/05,2024/01/02,,,read
2,"The Left Hand of Darkness",Ursula K. Le Guin,"Le Guin, Ursula K.",,"=""""","=""""",0,4.1,Ace,Paperback,304,1987,1969,,2024/02/01,to-read,to-read (#1),to-read
3,"Project Hail Mary, a novel",Andy Weir,"Weir, Andy",,"=""""","=""9780593135204""",4,4.5,Audible,Audible Audio,476,2021,2021,,2024/02/03,,,currently-reading
`;

it('a table with quoted commas, doubled quotes and line breaks in a cell is read as rows', () => {
  expect(csvRows('a,"b, ""c""",d\r\n"two\nlines",,\n\n')).toEqual([['a', 'b, "c"', 'd'], ['two\nlines', '', '']]);
});

it('a Goodreads list is read: ISBNs out of their wrapping, shelves, the day read, and what each is on', () => {
  const { books } = readBookList(GOODREADS);
  expect(books).toEqual([
    { title: 'Dune (Dune Chronicles, #1)', creator: 'Frank Herbert', year: 1965, isbn: '9780441172719', shelf: 'read', read_on: '2024-03-05', format: 'eBook' },
    { title: 'The Left Hand of Darkness', creator: 'Ursula K. Le Guin', year: 1969, isbn: null, shelf: 'to-read', read_on: null, format: 'Paperback' },
    { title: 'Project Hail Mary, a novel', creator: 'Andy Weir', year: 2021, isbn: '9780593135204', shelf: 'reading', read_on: null, format: 'Audiobook' },
  ]);
});

it('plain lines are read too, one book each', () => {
  expect(readBookList('1. Dune by Frank Herbert\n- Kindred — Octavia E. Butler\n\nEmma\n').books.map((b) => [b.title, b.creator])).toEqual([
    ['Dune', 'Frank Herbert'], ['Kindred', 'Octavia E. Butler'], ['Emma', null]]);
  expect(() => readBookList('   ')).toThrow('Paste a list');
  expect(() => readBookList('Rating,Pages\n5,300\n')).not.toThrow(); // read as plain lines: better something than nothing
});

it('a list is brought in once: what you have gains nothing, wanted books are wanted, and days read are logged', async () => {
  const mine = await shelf.create({ type: 'book', title: 'Dune', creator: 'Frank Herbert' }, { format: 'Paperback' });
  const { books } = readBookList(GOODREADS);
  const first = await importBookList(db, owner, clock, books, { to_read_as_wanted: true, log_read: true });
  expect(first).toEqual({ listed: 3, added: 2, copies: 2, already: 0, wanted: 1, logged: 1 });
  const dune = await shelf.get(mine.id);
  expect(dune.copies.map((c) => c.format).sort()).toEqual(['Paperback', 'eBook']);
  expect(dune.log.map((l) => l.day)).toEqual(['2024-03-05']);
  const wanted = (await shelf.list({ wanted: true }))[0]!;
  expect(wanted).toMatchObject({ title: 'The Left Hand of Darkness', formats: [] });
  expect(await shelf.get((await shelf.list({ q: 'Hail Mary' }))[0]!.id)).toMatchObject({ formats: ['Audiobook'], ids: { isbn: '9780593135204' } });
  // The same list again changes nothing.
  expect(await importBookList(db, owner, clock, books, { to_read_as_wanted: true, log_read: true })).toEqual({ listed: 3, added: 0, copies: 0, already: 3, wanted: 0, logged: 0 });
  expect(await shelf.list()).toHaveLength(3);
});

it('"they are all on Kindle" overrides what the list says', async () => {
  const result = await importBookList(db, owner, clock, readBookList('Dune by Frank Herbert\nEmma').books, { format: 'Kindle' });
  expect(result).toMatchObject({ added: 2, copies: 2 });
  expect((await shelf.list()).map((m) => m.formats)).toEqual([['Kindle'], ['Kindle']]);
});
