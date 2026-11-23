import { beforeEach, describe, expect, it } from 'vitest';
import type { Answer, Fetcher, Sealer } from '../src/connections.ts';
import type { Db } from '../src/db.ts';
import { audiobookFormat, bookGenres, fillFrom, lookups, readProduct, shopsOwnBarcode } from '../src/lookups.ts';
import { media } from '../src/media.ts';
import { migrate } from '../src/migrations.ts';
import { memoryDb } from './memoryDb.ts';

describe('reading what a shop calls a product', () => {
  it('finds the title and the format, and what kind of thing it is', () => {
    expect(readProduct('The Matrix [Blu-ray] (Widescreen)', 'Media > DVDs & Videos')).toEqual({ type: 'film', title: 'The Matrix', format: 'Blu-ray' });
    expect(readProduct('Jaws (4K Ultra HD + Blu-ray)', '')).toEqual({ type: 'film', title: 'Jaws', format: '4K Blu-ray' });
    expect(readProduct('The Legend of Zelda: Tears of the Kingdom - Nintendo Switch', 'Video Games')).toEqual({ type: 'game', title: 'The Legend of Zelda: Tears of the Kingdom', format: 'Switch' });
    expect(readProduct('Rumours [Vinyl LP]', 'Music')).toEqual({ type: 'music', title: 'Rumours', format: 'Vinyl' });
    expect(readProduct('La Blast 3 Dvd Dance Workout Collection Dvd', 'Electronics > Video > DVD & Blu-ray Players')).toEqual({ type: 'film', title: 'La Blast 3 Dvd Dance Workout Collection', format: 'DVD' });
    expect(readProduct('Stainless steel water bottle', 'Home & Garden')).toEqual({ type: 'other', title: 'Stainless steel water bottle', format: null });
  });
  it('keeps the name whole when it is all brackets', () => {
    expect(readProduct('[Untitled]', '').title).toBe('[Untitled]');
  });
  it('files an audiobook on CD as a book on CD, not as music', () => {
    expect(readProduct('Project Hail Mary Unabridged Audiobook CD', 'Books > Audiobooks')).toEqual({ type: 'book', title: 'Project Hail Mary', format: 'Book on CD' });
  });
  it('files an audiobook on tape as a book on tape', () => {
    expect(readProduct('Dune Unabridged Audiobook Tape', '')).toEqual({ type: 'book', title: 'Dune', format: 'Book on tape' });
    expect(readProduct('Dune Audiobook Cassette', '')).toEqual({ type: 'book', title: 'Dune', format: 'Book on tape' });
  });
  it('files a plain unabridged audiobook with no medium as an audiobook', () => {
    expect(readProduct('Dune Unabridged', '')).toEqual({ type: 'book', title: 'Dune', format: 'Audiobook' });
  });
  it('keeps an Audio CD music, since shops label ordinary music CDs that way', () => {
    expect(readProduct('Rumours [Audio CD]', 'Music')).toEqual({ type: 'music', title: 'Rumours', format: 'CD' });
    expect(audiobookFormat('Rumours Audio CD')).toBeNull();
  });
});

describe("a library's subjects as genres", () => {
  it('keeps short, plain ones, without filing notes or repeats, five at most', () => {
    expect(bookGenres(['Science fiction', 'Fiction, general', 'nyt:hardcover-fiction=2020-01-01', 'Accessible book', 'science fiction', 'Protected DAISY', 'A very long subject heading that nobody would call a genre'])).toEqual(['Science fiction', 'Fiction']);
    expect(bookGenres(['a', 'b', 'c', 'd', 'e', 'f'])).toHaveLength(5);
    // What Open Library really sends for Dune.
    expect(bookGenres(['Dune (Imaginary place)', 'Fiction', 'Fiction, science fiction, general', 'New York Times reviewed', 'Science fiction', 'Science-fiction'])).toEqual(['Fiction', 'Science fiction']);
  });
});

describe("a shop's own barcode", () => {
  it('is told apart from one a maker prints', () => {
    expect(['2000000000015', '0212345678906', '412345678908', '0000000000017'].map(shopsOwnBarcode)).toEqual([true, true, true, true]);
    expect(['0883929106509', '9780441172719', '5012345678900', '012345678905', '12345670'].map(shopsOwnBarcode)).toEqual([false, false, false, false, false]);
  });
});

describe('films and shows from TMDB', () => {
  const KEY = 'eyJhbGciOiJIUzI1NiJ9.a-long-read-access-token-for-tests.signature';
  const V3 = '0123456789abcdef0123456789abcdef';
  const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
  const sealer: Sealer = { seal: (p) => `sealed:v1:${Buffer.from(p).toString('base64')}`, unseal: (s) => (s.startsWith('sealed:v1:') ? Buffer.from(s.slice(10), 'base64').toString() : null) };
  const answer = (status: number, body: unknown = {}, type = 'application/json'): Answer => ({ status, type, json: async () => body, bytes: async () => (body instanceof Uint8Array ? body : new Uint8Array()) });

  let db: Db;
  let asked: Array<{ url: string; headers: Record<string, string> }>;
  let accepted: string;
  const fetcher: Fetcher = async (url, headers) => {
    asked.push({ url, headers });
    if (url.startsWith('https://image.tmdb.org/')) return answer(200, PNG, 'image/png');
    const sent = headers.Authorization?.replace('Bearer ', '') ?? new URL(url).searchParams.get('api_key');
    if (sent !== accepted) return answer(401, { status_code: 7 });
    const path = new URL(url).pathname;
    if (path === '/3/configuration') return answer(200, { images: { secure_base_url: 'https://image.tmdb.org/t/p/' } });
    if (path === '/3/search/movie') {
      return answer(200, { results: Array.from({ length: 10 }, (_, n) => ({ id: 348 + n, title: n === 0 ? 'Alien' : `Alien ${n}`, release_date: n === 0 ? '1979-05-25' : '', poster_path: n === 0 ? '/alien-poster.jpg' : null, overview: 'In space' })) });
    }
    if (path === '/3/search/tv') return answer(200, { results: [{ id: 1396, name: 'Breaking Bad', first_air_date: '2008-01-20', poster_path: '/bb-poster.jpg' }] });
    if (path === '/3/movie/348') {
      return answer(200, { id: 348, title: 'Alien', release_date: '1979-05-25', runtime: 117, overview: 'In space no one can hear you scream.', poster_path: '/alien-poster.jpg',
        genres: [{ name: 'Horror' }, { name: 'Science Fiction' }], credits: { crew: [{ job: 'Producer', name: 'Gordon Carroll' }, { job: 'Director', name: 'Ridley Scott' }] } });
    }
    if (path === '/3/tv/1396') return answer(200, { id: 1396, name: 'Breaking Bad', first_air_date: '2008-01-20', episode_run_time: [47], created_by: [{ name: 'Vince Gilligan' }], genres: [{ name: 'Drama' }], overview: 'A teacher.', poster_path: '/bb-poster.jpg' });
    return answer(404);
  };
  const mine = (owner: number, tools: { sealer?: Sealer } = { sealer }, f: Fetcher | null = fetcher) => lookups(db, owner, () => new Date(), f ?? undefined, tools);
  const person = async (name: string) => (await db.run("INSERT INTO users (username, password_hash, created_at) VALUES (?, 'x', 'now')", [name])).lastId;
  const problem = (status: number) => expect.objectContaining({ name: 'Problem', status });
  let owner: number;

  beforeEach(async () => {
    db = memoryDb();
    await migrate(db);
    owner = await person('owner');
    asked = [];
    accepted = KEY;
  });

  it('asks nothing while it is off, and cannot be turned on without a key or without a way outside', async () => {
    const l = mine(owner);
    expect(await l.status()).toMatchObject({ films: false, film_key: false });
    await expect(l.searchFilms({ title: 'Alien', kind: 'film' })).rejects.toEqual(problem(400));
    await expect(l.setFilms(true)).rejects.toEqual(problem(400)); // no key yet
    await expect(mine(owner, { sealer }, null).setFilms(true, KEY)).rejects.toEqual(problem(400)); // no way outside (demo, or no fetcher)
    expect(await l.status()).toMatchObject({ films: false, film_key: false });
    expect(asked).toEqual([]);
    // Saved but off: still nothing asked.
    await l.setFilms(false, KEY);
    await expect(l.filmDetails('film', '348')).rejects.toEqual(problem(400));
    await expect(l.poster('/alien-poster.jpg')).rejects.toEqual(problem(400));
    expect(asked).toEqual([]);
  });

  it('keeps the key sealed, and never gives it back', async () => {
    const l = mine(owner);
    const on = await l.setFilms(true, KEY);
    expect(on).toMatchObject({ films: true, film_key: true });
    expect(JSON.stringify(on)).not.toContain(KEY);
    const stored = (await db.all<{ value: string }>('SELECT value FROM user_settings WHERE user_id = ?', [owner])).map((r) => r.value);
    expect(stored.some((v) => v.includes(KEY))).toBe(false);
    expect(stored.some((v) => v.startsWith('sealed:v1:'))).toBe(true);
    expect(JSON.stringify(await l.searchFilms({ title: 'Alien', kind: 'film' }))).not.toContain(KEY);
    // A key that can't be kept locked is refused outright.
    await expect(mine(owner, {}).setFilms(true, KEY)).rejects.toEqual(problem(400));
    await expect(l.setFilms(true, 'short')).rejects.toEqual(problem(400));
    expect(await l.forgetFilmsKey()).toMatchObject({ films: false, film_key: false });
  });

  it("sends only the title, the year and the key: the token as a header, the v3 key in the address", async () => {
    const l = mine(owner);
    await l.setFilms(true, KEY);
    const found = await l.searchFilms({ title: ' Alien ', year: 1979, kind: 'film' });
    expect(found).toHaveLength(8);
    expect(found[0]).toEqual({ kind: 'movie', id: '348', title: 'Alien', year: 1979, poster: '/alien-poster.jpg', overview: 'In space' });
    expect(asked).toEqual([{ url: 'https://api.themoviedb.org/3/search/movie?query=Alien&year=1979', headers: { Accept: 'application/json', Authorization: `Bearer ${KEY}` } }]);

    asked = [];
    await l.searchFilms({ title: 'Breaking Bad', kind: 'show' });
    expect(asked.map((a) => a.url)).toEqual(['https://api.themoviedb.org/3/search/tv?query=Breaking+Bad']);

    asked = []; accepted = V3;
    await l.setFilms(true, V3);
    await l.filmDetails('film', '348');
    expect(asked).toEqual([{ url: `https://api.themoviedb.org/3/movie/348?append_to_response=credits&api_key=${V3}`, headers: { Accept: 'application/json' } }]);
  });

  it('reads a film from its details: director, runtime, genres, summary and the poster path', async () => {
    const l = mine(owner);
    await l.setFilms(true, KEY);
    expect(await l.filmDetails('film', '348')).toEqual({
      kind: 'movie', id: '348', title: 'Alien', year: 1979, creator: 'Ridley Scott', minutes: 117, genres: ['Horror', 'Science Fiction'],
      summary: 'In space no one can hear you scream.', poster: '/alien-poster.jpg',
    });
    expect(await l.filmDetails('show', '1396')).toMatchObject({ kind: 'tv', title: 'Breaking Bad', year: 2008, creator: 'Vince Gilligan', minutes: 47 });
    expect(await l.filmDetails('film', '999999')).toBeNull();
    await expect(l.filmDetails('film', '../../x')).rejects.toEqual(problem(400));
  });

  it('a match fills only what is empty, and "use all of it" fills everything', async () => {
    const l = mine(owner);
    await l.setFilms(true, KEY);
    const found = (await l.filmDetails('film', '348'))!;
    const mineSoFar = { title: 'alien (my tape)', year: null, creator: '', minutes: null, genres: [], summary: 'My own words about it.' };
    const some = fillFrom(mineSoFar, found);
    expect(some.fields).toEqual({ title: 'alien (my tape)', year: 1979, creator: 'Ridley Scott', minutes: 117, genres: ['Horror', 'Science Fiction'], summary: 'My own words about it.' });
    expect(some.filled).toEqual(['year', 'creator', 'minutes', 'genres']);
    expect(some.kept).toEqual(['title', 'summary']);
    const all = fillFrom(mineSoFar, found, true);
    expect(all.fields).toEqual({ title: 'Alien', year: 1979, creator: 'Ridley Scott', minutes: 117, genres: ['Horror', 'Science Fiction'], summary: 'In space no one can hear you scream.' });
    expect(all.kept).toEqual([]);
    // Nothing found for a field leaves what was typed.
    expect(fillFrom({ creator: 'Me' }, { ...found, creator: null }, true).fields.creator).toBe('Me');
  });

  it("keeps the poster as the title's cover, fetched once through Life Is, and only for its owner", async () => {
    const l = mine(owner);
    await l.setFilms(true, KEY);
    const shelf = media(db, owner, () => new Date());
    const film = await shelf.create({ type: 'film', title: 'Alien', ids: { tmdb: '348', tmdb_kind: 'movie' } });
    expect(await l.keepPoster(film.id, '/alien-poster.jpg')).toEqual({ cover: `/api/media/${film.id}/cover` });
    expect(asked.map((a) => a.url)).toEqual(['https://image.tmdb.org/t/p/w342/alien-poster.jpg']);
    expect(await shelf.cover(film.id)).toEqual({ type: 'image/png', bytes: PNG });
    expect((await shelf.get(film.id)).cover).toBe(`/api/media/${film.id}/cover`);
    // The small ones for the list of matches come the same way.
    expect((await l.poster('/alien-poster.jpg')).type).toBe('image/png');
    expect(asked.at(-1)!.url).toBe('https://image.tmdb.org/t/p/w92/alien-poster.jpg');
    // Nothing but a poster's file name is ever put after the image address.
    await expect(l.poster('/../../evil.jpg')).rejects.toEqual(problem(400));
    await expect(l.poster('/alien-poster.jpg', 'original')).rejects.toEqual(problem(400));
    // Someone else's title can't be given a cover.
    const other = await person('partner');
    await mine(other).setFilms(true, KEY);
    await expect(mine(other).keepPoster(film.id, '/alien-poster.jpg')).rejects.toEqual(problem(404));
  });

  it('says plainly when the key is wrong, and a test checks it with one harmless request', async () => {
    const l = mine(owner);
    await l.setFilms(true, KEY);
    asked = [];
    expect(await l.testFilms()).toEqual({ ok: true });
    expect(asked.map((a) => a.url)).toEqual(['https://api.themoviedb.org/3/configuration']);
    accepted = 'another-key-entirely-not-the-saved-one';
    await expect(l.testFilms()).rejects.toMatchObject({ status: 400, message: expect.stringContaining("TMDB didn't accept that key") });
    await expect(l.searchFilms({ title: 'Alien', kind: 'film' })).rejects.toMatchObject({ message: expect.not.stringContaining(KEY) });
  });

  it("never uses another person's key", async () => {
    await mine(owner).setFilms(true, KEY);
    const other = await person('partner');
    const theirs = mine(other);
    expect(await theirs.status()).toMatchObject({ films: false, film_key: false });
    await expect(theirs.searchFilms({ title: 'Alien', kind: 'film' })).rejects.toEqual(problem(400));
    expect(asked).toEqual([]);
    // Their own key, their own requests.
    accepted = V3;
    await theirs.setFilms(true, V3);
    await theirs.searchFilms({ title: 'Alien', kind: 'film' });
    expect(asked.map((a) => a.url)).toEqual([`https://api.themoviedb.org/3/search/movie?query=Alien&api_key=${V3}`]);
    expect(asked.some((a) => JSON.stringify(a).includes(KEY))).toBe(false);
  });

  it('says it is not set up to reach outside when there is no fetcher', async () => {
    const l = mine(owner, { sealer }, null);
    expect(await l.status()).toMatchObject({ available: false, films: false });
    await expect(l.setFilms(true, KEY)).rejects.toMatchObject({ status: 400, message: expect.stringContaining("isn't set up to reach outside") });
  });
});
