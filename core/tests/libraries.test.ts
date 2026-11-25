/** Book servers (Audiobookshelf, Calibre-Web, Kavita, any OPDS catalogue), a list of books brought in, and a link on a copy. */
import { beforeEach, expect, it } from 'vitest';
import { csvRows, importBookList, importMediaList, readBookList, readMediaList } from '../src/bookList.ts';
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
// A book as Calibre-Web 0.6.27 really sends it: a shared "urn:uuid:None" id (books added without Calibre have no uuid), the date as
// <published>, a description in xhtml led by a TAGS line and escaped twice, a cover only when there is one, and the number in both addresses.
const calibreBook = (n: number, title: string, author: string, tags: string, cover = true) => `<entry>
    <title>${title}</title>
    <id>urn:uuid:None</id>
    <updated>2026-11-22T19:15:48+00:00</updated>
      <author>
        <name>${author}</name>
      </author>
    <published>2005-07-20T00:00:00+00:00</published>
      <dcterms:language>eng</dcterms:language>
    <category scheme="http://www.bisg.org/standards/bisac_subject/index.html"
              term="${tags}"
              label="${tags}"/>
    <content type="xhtml"><div xmlns="http://www.w3.org/1999/xhtml">
    TAGS: ${tags}<br/>
        <p>A tiny book about ${title.replace('&amp;', '&amp;amp;')}.</p>
    </div></content>
    ${cover ? `<link type="image/jpeg" href="/opds/cover/${n}" rel="http://opds-spec.org/image"/>
    <link type="image/jpeg" href="/opds/cover/${n}" rel="http://opds-spec.org/image/thumbnail"/>` : ''}
    <link rel="http://opds-spec.org/acquisition" href="/opds/download/${n}/epub/"
          length="1082" title="EPUB" mtime="2026-11-22T19:15:48+00:00" type="application/epub+zip"/>
  </entry>`;

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
  expect(page.entries[0]!.summary).toBe('A novel of manners.');
  expect(page.entries[1]).toMatchObject({ title: 'By author', book: false, leads: 'http://shelf.test/opds/author' });
  expect(() => readOpdsPage('<html><body>Sign in</body></html>', 'http://shelf.test')).toThrow(/catalog/);
});

// ---------- Calibre-Web ----------

it('Calibre-Web: every page is read with your sign-in, and each book opens on its own page', async () => {
  // Emma has no cover, and every book shares the same id: the number in the download address tells them apart.
  pages['http://calibre.test/opds/books/letter/00'] = { body: feed(calibreBook(1, 'Dune', 'Frank Herbert', 'Science Fiction') + calibreBook(2, 'Emma', 'Jane Austen', 'Classics', false), '/opds/books/letter/00?offset=2') };
  pages['http://calibre.test/opds/books/letter/00?offset=2'] = { body: feed(calibreBook(3, 'Salt &amp; Stone', 'Octavia E. Butler', 'Fiction')) };
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
  // A book without a cover still opens on its page, and an ampersand in a title or its description comes out as one.
  const emma = (await shelf.list({ q: 'Emma' }))[0]!;
  expect((await shelf.get(emma.id)).copies[0]).toMatchObject({ link: 'http://calibre.test/book/2' });
  const salt = await shelf.get((await shelf.list({ q: 'Salt' }))[0]!.id);
  expect(salt).toMatchObject({ title: 'Salt & Stone', year: 2005, summary: 'A tiny book about Salt & Stone.' });
  expect(salt.genres).toEqual(['Fiction']);
  expect((await servers().list())[0]).toMatchObject({ copies: 3, last_ok: true, last_message: '3 on the server, 3 added' });

  // A book gone from the server goes from the collection; one you've logged stays as a title.
  await shelf.log((await shelf.list({ q: 'Emma' }))[0]!.id, { day: '2046-03-01' });
  pages['http://calibre.test/opds/books/letter/00'] = { body: feed(calibreBook(1, 'Dune', 'Frank Herbert', 'Science Fiction')) };
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

// Shaped like Kavita 0.9.1.4 answers: a library lists its series itself, 20 to a page, with a "next" link carrying pageNumber; a series has an author, a summary led by "Format: ...", and covers that hold the key in their address.
it('Kavita: each library is followed to its series, every page of it, with the key in the address', async () => {
  const nav = 'application/atom+xml;profile=opds-catalog;kind=navigation';
  const library = (id: string, title: string) => `<entry><updated>2026-11-22T19:22:47</updated><id>${id}</id><title>${title}</title><link rel="subsection" type="${nav}" href="/api/opds/K1/libraries/${id}" /><link rel="http://opds-spec.org/image" type="image/jpeg" href="/api/image/library-cover?libraryId=${id}&amp;apiKey=K1" /></entry>`;
  const series = (id: number, title: string, author: string, genre: string) => `<entry><updated>2026-11-22T19:22:51</updated><id>${id}</id><title>${title}</title>
    <summary>Format: Epub     Summary: A tiny book about ${title}.</summary>
    <link rel="subsection" type="${nav}" href="/api/opds/K1/series/${id}" />
    <link rel="http://opds-spec.org/image" type="image/jpeg" href="/api/image/series-cover?seriesId=${id}&amp;apiKey=K1" />
    <link rel="http://opds-spec.org/image/thumbnail" type="image/jpeg" href="/api/image/series-cover?seriesId=${id}&amp;apiKey=K1" />
    <author><name>${author}</name><uri>http://opds-spec.org/author/${id}</uri></author><category term="" label="${genre}" /></entry>`;
  pages['http://kavita.test/api/opds/K1/libraries'] = { type: 'application/xml', body: feed(library('1', 'Books') + library('2', 'Comics')) };
  pages['http://kavita.test/api/opds/K1/libraries/1'] = { type: 'application/xml', body: feed(series(40, 'The Hobbit', 'J. R. R. Tolkien', 'fantasy') + series(42, 'Salt &amp; Stone', 'Mara Quill', 'fiction'),
    '/api/opds/K1/libraries/1?pageNumber=2') };
  pages['http://kavita.test/api/opds/K1/libraries/1?pageNumber=2'] = { type: 'application/xml', body: feed(series(43, 'Quiet Orchards', 'Ines Calder', 'nature')) };
  pages['http://kavita.test/api/opds/K1/libraries/2'] = { type: 'application/xml', body: feed(series(41, 'Bone', 'Jeff Smith', 'comics')) };
  pages['http://kavita.test/api/image/series-cover?seriesId=40&apiKey=K1'] = { type: 'image/png', body: new Uint8Array([137, 80, 78, 71]) };
  const [server] = await servers().create({ kind: 'kavita', url: 'http://kavita.test', key: 'K1' });
  await expect(servers().create({ kind: 'kavita', url: 'http://kavita.test' })).rejects.toThrow('Paste the API key from Kavita');
  expect(await servers().sync(server!.id)).toMatchObject({ total: 4, added: 4, covers: 1 });
  const hobbit = await shelf.get((await shelf.list({ q: 'Hobbit' }))[0]!.id);
  expect(hobbit).toMatchObject({ creator: 'J. R. R. Tolkien', summary: 'A tiny book about The Hobbit.' });
  expect(hobbit.copies[0]).toMatchObject({ format: 'eBook', source: 'kavita', link: 'http://kavita.test/library/1/series/40' });
  // The second page of a library is read, and a series is linked under the library it is in.
  const orchards = await shelf.get((await shelf.list({ q: 'Orchards' }))[0]!.id);
  expect(orchards.copies[0]).toMatchObject({ link: 'http://kavita.test/library/1/series/43' });
  expect((await shelf.get((await shelf.list({ q: 'Bone' }))[0]!.id)).copies[0]).toMatchObject({ link: 'http://kavita.test/library/2/series/41' });
  expect((await shelf.get((await shelf.list({ q: 'Salt' }))[0]!.id)).title).toBe('Salt & Stone');
});

// ---------- Audiobookshelf ----------

// Shaped like Audiobookshelf 2.37.2 answers with minified=1: the year is text, empty things are null, and `ebookFormat` is only there when an eBook file is.
const absItem = (id: string, title: string, author: string, more: object = {}, isbn: string | null = '978-0441172719', item: object = {}) => ({
  id, libraryId: 'lib1', path: `/audiobooks/${author}/${title}`, isMissing: false, isInvalid: false, mediaType: 'book', numFiles: 1,
  media: { id: `m-${id}`, metadata: { title, subtitle: null, authorName: author, authorNameLF: author, narratorName: '', seriesName: '', publishedYear: '1965', publishedDate: null, publisher: null, description: null, genres: ['Science Fiction'], isbn, asin: null, language: null },
    coverPath: null, numTracks: 1, numAudioFiles: 12, numChapters: 0, duration: 75600, size: 1000, ...more },
  ...item,
});

it('Audiobookshelf: audiobooks and eBooks come in as what they are, with how long they run', async () => {
  pages['http://abs.test/api/libraries'] = { type: 'application/json', body: { libraries: [{ id: 'lib1', mediaType: 'book' }, { id: 'pod', mediaType: 'podcast' }] } };
  pages['http://abs.test/api/libraries/lib1/items?limit=100&page=0&minified=1'] = { type: 'application/json', body: { total: 4, page: 0, limit: 100, results: [
    absItem('a1', 'Dune', 'Frank Herbert'),
    absItem('a2', 'Emma', 'Jane Austen', { numTracks: 0, numAudioFiles: 0, duration: 0, ebookFormat: 'epub' }, null),
    // An audio file and an eBook file in one folder: one title, brought in as an Audiobook.
    absItem('a3', 'Persuasion', 'Jane Austen', { numAudioFiles: 1, duration: 2, ebookFormat: 'epub' }, null),
    // Gone from the disk: still listed by the server, not brought in.
    absItem('a4', 'Lost Book', 'Nobody', {}, null, { isMissing: true }),
  ] } };
  const [server] = await servers().create({ kind: 'audiobookshelf', url: 'http://abs.test', key: 'tok' });
  expect(asked[0]!.headers.Authorization).toBe('Bearer tok');
  expect(await servers().sync(server!.id)).toMatchObject({ total: 3, added: 3 });
  const both = await shelf.get((await shelf.list({ q: 'Persuasion' }))[0]!.id);
  expect(both).toMatchObject({ minutes: 1 });
  expect(both.copies[0]!.format).toBe('Audiobook');
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
  pages['http://calibre.test/opds/books/letter/00'] = { body: feed(calibreBook(1, 'Dune', 'Frank Herbert', 'Science Fiction')) };
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
  expect(await shelf.list()).toHaveLength(2); // the wanted book is on the Wanted list, not in the collection
  expect(await shelf.list({ wanted: true })).toHaveLength(1);
});

it('"they are all on Kindle" overrides what the list says', async () => {
  const result = await importBookList(db, owner, clock, readBookList('Dune by Frank Herbert\nEmma').books, { format: 'Kindle' });
  expect(result).toMatchObject({ added: 2, copies: 2 });
  expect((await shelf.list()).map((m) => m.formats)).toEqual([['Kindle'], ['Kindle']]);
});

// ---------- a list of anything: films, music, games, books ----------

// What the owner's old collection app's export might look like. Its real column names are not known, so these are guesses at the usual ones.
const OLD_APP = `Title,Director,Release Year,Media,UPC,Price Paid,Current Value,Notes,Wishlist,Star Rating,Date Added
Alien,Ridley Scott,1979,Blu-ray,024543012345,"$1,014.99",$25.00,"the steelbook, ex-rental",,5,2024-01-01
Rumours,Fleetwood Mac,1977,Vinyl,,12,30.50,,,4,
Halo,Bungie,2001,Game,,,,,yes,3,
The Thing,John Carpenter,1982,,,,,,,,
`;

it('a list of anything is read: the kind from a Type or Media column, prices in cents, and what was understood and ignored', () => {
  const list = readMediaList(OLD_APP, 'film');
  expect(list.items.map((i) => [i.title, i.type, i.format, i.creator, i.year])).toEqual([
    ['Alien', 'film', 'Blu-ray', 'Ridley Scott', 1979], ['Rumours', 'music', 'Vinyl', 'Fleetwood Mac', 1977],
    ['Halo', 'game', null, 'Bungie', 2001], ['The Thing', 'film', null, 'John Carpenter', 1982],
  ]);
  expect(list.items[0]).toMatchObject({ barcode: '024543012345', cost_cents: 101499, value_cents: 2500, note: 'the steelbook, ex-rental', wanted: false });
  expect(list.items[1]).toMatchObject({ cost_cents: 1200, value_cents: 3050, barcode: null });
  expect(list.items[2]!.wanted).toBe(true);
  expect(list.types).toEqual({ film: 2, music: 1, game: 1 });
  expect(list.wanted).toBe(1);
  expect(list.columns).toEqual({
    understood: [
      { column: 'Title', as: 'Title' }, { column: 'Director', as: 'Creator' }, { column: 'Release Year', as: 'Year' }, { column: 'Media', as: 'Type or format' },
      { column: 'UPC', as: 'Barcode' }, { column: 'Price Paid', as: 'Price paid' }, { column: 'Current Value', as: 'Value' }, { column: 'Notes', as: 'Notes' },
      { column: 'Wishlist', as: 'Wanted' },
    ],
    ignored: ['Star Rating', 'Date Added'],
  });
});

it('column names are matched generously, and a Type column names the kind of each line', () => {
  const list = readMediaList(' TITLE ,Type,Artist/Author,price-paid,Date Bought,Wanted?\nRumours,Album,Fleetwood Mac,9.99,3/5/2024,\nAlien,movie,,,,\nJaws,DVD,,,,\nDune,book,Frank Herbert,,,\nChess,Whatever,,,,x\n', 'show');
  expect(list.items.map((i) => [i.title, i.type, i.format])).toEqual([['Rumours', 'music', null], ['Alien', 'film', null], ['Jaws', 'film', 'DVD'], ['Dune', 'book', null], ['Chess', 'show', null]]);
  // "Wanted?" is Wanted once the punctuation is ignored; "Artist/Author" is no name any rule knows, so it is said to be ignored, not guessed at.
  expect(list.columns!.ignored).toEqual(['Artist/Author']);
  expect(list.columns!.understood.map((c) => c.as)).toEqual(['Title', 'Type', 'Price paid', 'Day bought', 'Wanted']);
  expect(list.items.map((i) => i.wanted)).toEqual([false, false, false, false, true]);
  expect(list.items[0]).toMatchObject({ cost_cents: 999, bought_on: '2024-03-05', creator: null });
  expect(readMediaList('Title,Artist\nRumours,Fleetwood Mac\n').columns).toEqual({ understood: [{ column: 'Title', as: 'Title' }, { column: 'Artist', as: 'Creator' }], ignored: [] });
});

it('plain lines are read as the chosen kind, with no columns to report; nothing readable is refused', () => {
  const list = readMediaList('Alien by Ridley Scott\nJaws\n', 'film');
  expect(list.items.map((i) => [i.title, i.creator, i.type])).toEqual([['Alien', 'Ridley Scott', 'film'], ['Jaws', null, 'film']]);
  expect(list.columns).toBeNull();
  expect(readMediaList('Halo\n', 'nonsense').items[0]!.type).toBe('film'); // an unknown kind falls back to film
  expect(() => readMediaList('  ')).toThrow('Paste a list');
});

it('a list of anything is brought in once: copies with their prices, wanted ones with none, and what you have is left alone', async () => {
  const mine = await shelf.create({ type: 'film', title: 'Alien', year: 1979 }, { format: 'VHS', barcode: '0-86162-10903-4' });
  const book = await shelf.create({ type: 'book', title: 'Alien' }, { format: 'Paperback' }); // the same name, another kind: not the same title
  const { items } = readMediaList(OLD_APP, 'film');
  const first = await importMediaList(db, owner, clock, items, { otherwise: 'DVD' });
  expect(first).toEqual({ listed: 4, added: 3, copies: 3, already: 0, wanted: 1, logged: 0 });
  const alien = await shelf.get(mine.id);
  expect(alien.copies.map((c) => c.format).sort()).toEqual(['Blu-ray', 'VHS']);
  expect(alien.copies.find((c) => c.format === 'Blu-ray')).toMatchObject({ cost_cents: 101499, value_cents: 2500, source: 'list', barcode: '024543012345' });
  expect((await shelf.get(book.id)).copies).toHaveLength(1);
  const rumours = (await shelf.list({ q: 'Rumours' }))[0]!;
  expect(rumours).toMatchObject({ type: 'music', formats: ['Vinyl'], cost_cents: 1200, worth_cents: 3050 });
  expect(await shelf.get(rumours.id)).toMatchObject({ copies: [expect.objectContaining({ cost_cents: 1200, value_cents: 3050 })] });
  expect((await shelf.list({ q: 'Halo', wanted: true }))[0]).toMatchObject({ type: 'game', wanted: true, formats: [] });
  expect(await shelf.list({ q: 'Halo' })).toEqual([]);
  expect((await shelf.list({ q: 'The Thing' }))[0]).toMatchObject({ formats: ['DVD'] });
  // The same list again changes nothing.
  expect(await importMediaList(db, owner, clock, items, { otherwise: 'DVD' })).toEqual({ listed: 4, added: 0, copies: 0, already: 4, wanted: 0, logged: 0 });
  expect(await shelf.list()).toHaveLength(4); // and the wanted game is on the Wanted list
  // A barcode that is already a copy's finds its title, whatever the list calls it, and a format said for all overrides.
  const again = await importMediaList(db, owner, clock, readMediaList('Title,Barcode\nAlien: Special Edition,086162109034\n').items, { format: 'LaserDisc' });
  expect(again).toMatchObject({ added: 0, copies: 1 });
  expect((await shelf.get(mine.id)).formats).toContain('LaserDisc');
  expect(await importMediaList(db, owner, clock, readMediaList('Mystery\n').items)).toMatchObject({ added: 1 });
  expect((await shelf.list({ q: 'Mystery' }))[0]!.formats).toEqual(['Not said']);
});

it('the book import is as it was: Type and Media columns are not read there, and the list of books gives the same answers', () => {
  expect(readBookList('Title,Author,Type\nDune,Frank Herbert,film\n').books).toEqual([
    { title: 'Dune', creator: 'Frank Herbert', year: null, isbn: null, shelf: null, read_on: null, format: null }]);
});

// ---------- Calibre's own Content server ----------

it('Calibre: "By Title" is read page by page, tags become genres, and each book opens in its reader', async () => {
  // Shaped like Calibre 8's own feed: the date in dc:date, tags on a TAGS line, files under /get/<format>/<number>/<library>.
  const entry = (n: number, title: string, author: string, tags: string) => `<entry><title>${title}</title><author><name>${author}</name></author>
    <id>urn:uuid:calibre-${n}</id><published>2026-09-24T18:17:05+00:00</published><dc:date>2024-02-06T19:42:36+00:00</dc:date>
    <content type="xhtml"><div xmlns="http://www.w3.org/1999/xhtml">${tags ? `TAGS: ${tags}<br/>` : ''}<p>About ${title}.</p></div></content>
    <link type="application/epub+zip" href="/get/epub/${n}/calibre" rel="http://opds-spec.org/acquisition"/>
    <link type="image/jpeg" href="/get/cover/${n}/calibre" rel="http://opds-spec.org/cover"/>
    <link type="image/jpeg" href="/get/cover/${n}/calibre" rel="http://opds-spec.org/image"/></entry>`;
  pages['http://calibre.test/opds/navcatalog/4f7469746c65'] = { body: feed(entry(44, 'Reasons', 'Chris Ferrie &amp; Wade Fairclough', 'Humor, Physics'), '/opds/navcatalog/4f7469746c65?library_id=calibre&amp;offset=30') };
  pages['http://calibre.test/opds/navcatalog/4f7469746c65?library_id=calibre&offset=30'] = { body: feed(entry(45, 'Emma', 'Jane Austen', '')) };
  const [server] = await servers().create({ kind: 'calibre', url: 'http://calibre.test' });
  expect(server).toMatchObject({ kind: 'calibre', name: 'Calibre' });
  expect(await servers().sync(server!.id)).toMatchObject({ total: 2, added: 2 });
  const reasons = await shelf.get((await shelf.list({ q: 'Reasons' }))[0]!.id);
  expect(reasons).toMatchObject({ creator: 'Chris Ferrie, Wade Fairclough', year: 2024, genres: ['Humor', 'Physics'], summary: 'About Reasons.' });
  expect(reasons.copies[0]).toMatchObject({ format: 'eBook', source: 'calibre', link: 'http://calibre.test/#book_id=44&library_id=calibre&panel=book_details' });
});

// ---------- signing in the way Calibre asks ----------

it('the fingerprint Digest sign-in is built on matches the published examples', async () => {
  const { md5, digestAnswer, digestChallenge } = await import('../src/digest.ts');
  expect([md5(''), md5('abc'), md5('The quick brown fox jumps over the lazy dog')]).toEqual([
    'd41d8cd98f00b204e9800998ecf8427e', '900150983cd24fb0d6963f7d28e17f72', '9e107d9d372bb6826bd81d3542a419d6']);
  expect(md5('a'.repeat(200))).toHaveLength(32);
  // The worked example in the standard (RFC 2617, section 3.5).
  const challenge = digestChallenge('Digest realm="testrealm@host.com", qop="auth,auth-int", nonce="dcd98b7102dd2f0e8b11d0f600bfb0c093", opaque="5ccc069c403ebaf9f0171e9517f40e41"')!;
  expect(challenge).toMatchObject({ realm: 'testrealm@host.com', qop: true });
  expect(digestAnswer(challenge, 'Mufasa', 'Circle Of Life', 'GET', '/dir/index.html', 1, '0a4f113b')).toContain('response="6629fae49393a05397450978507c4ef1"');
  expect(digestChallenge('Basic realm="x"')).toBeNull();
});

it('Calibre with a password: the reader signs in with Digest when asked, and never sends the password itself', async () => {
  const { md5 } = await import('../src/digest.ts');
  const entry = `<entry><title>Emma</title><author><name>Jane Austen</name></author><id>urn:uuid:e1</id>
    <link type="application/epub+zip" href="/get/epub/7/calibre" rel="http://opds-spec.org/acquisition"/><link type="image/jpeg" href="/get/cover/7/calibre" rel="http://opds-spec.org/image"/></entry>`;
  const sent: (string | undefined)[] = [];
  const guarded: Fetcher = async (url, headers) => {
    sent.push(headers.Authorization);
    const given = headers.Authorization ?? '';
    const at = new URL(url);
    const part = (name: string) => new RegExp(`${name}="?([^",]+)"?`).exec(given)?.[1] ?? '';
    const right = md5(`${md5('reader:calibre:s3cret')}:n0nce:${part('nc')}:${part('cnonce')}:auth:${md5(`GET:${at.pathname}${at.search}`)}`);
    const ok = given.startsWith('Digest ') && part('response') === right && part('uri') === at.pathname + at.search;
    const body = new TextEncoder().encode(ok ? (at.pathname.startsWith('/get/cover') ? 'jpeg' : feed(entry)) : '');
    return { status: ok ? 200 : 401, type: ok ? (at.pathname.startsWith('/get/cover') ? 'image/jpeg' : 'application/atom+xml') : null,
      header: (name) => (!ok && name.toLowerCase() === 'www-authenticate' ? 'Digest realm="calibre", nonce="n0nce", algorithm="MD5", qop="auth"' : null),
      json: async () => ({}), bytes: async () => body };
  };
  const mine = libraries(db, owner, clock, { fetcher: guarded, sealer });
  await expect(mine.create({ kind: 'calibre', url: 'http://calibre.test', username: 'reader', password: 'wrong' })).rejects.toThrow("Calibre didn't accept that sign-in");
  const [server] = await mine.create({ kind: 'calibre', url: 'http://calibre.test', username: 'reader', password: 's3cret' });
  expect(await mine.sync(server!.id)).toMatchObject({ total: 1, added: 1, covers: 1 });
  expect(sent.join(' ')).not.toContain('s3cret');
  expect(sent.some((line) => line?.startsWith('Basic '))).toBe(false);
});
