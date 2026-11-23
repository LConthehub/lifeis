/**
 * Looking a title up from its barcode, so it needn't be typed. An outside service, and so off until a person
 * turns it on.
 *
 * The barcode on a book is its ISBN, and Open Library (openlibrary.org, run by the Internet Archive) answers
 * what book that is. Films, music and games carry a product barcode: MusicBrainz knows records and CDs, and
 * UPCitemdb most other boxed things. None needs an account or a key, and the one thing ever sent is the
 * number. What comes back is offered to the person to check before anything is saved.
 *
 * `fetcher` asks a web address for its answer; it is handed in because that differs by where Life Is runs.
 */
import type { Answer, Fetcher, Sealer } from './connections.ts';
import { atomic, type Db } from './db.ts';
import { Problem } from './problem.ts';
import { clean, type Clock } from './small.ts';

export const BOOK_SERVICE = {
  name: 'Open Library',
  site: 'https://openlibrary.org',
  sends: 'The number under the barcode of a book you scan (its ISBN), and nothing else. No account, no key.',
};

export const GROCERY_SERVICE = {
  name: 'Open Food Facts',
  site: 'https://world.openfoodfacts.org',
  sends: 'The number under the barcode of a grocery you scan, and nothing else. No account, no key. It is a volunteer-run list of food products, so it knows many but not all.',
};

export const TITLE_SERVICES = {
  name: 'MusicBrainz and UPCitemdb',
  sites: [{ name: 'MusicBrainz', site: 'https://musicbrainz.org' }, { name: 'UPCitemdb', site: 'https://www.upcitemdb.com' }],
  sends: 'The number under the barcode of a film, album or game you scan, and nothing else: first to MusicBrainz (a volunteer-run list of music), then, if it isn\'t music, to UPCitemdb (a list of products, free for about 100 look-ups a day). No account, no key.',
};

/**
 * Films and shows from The Movie Database (TMDB). Unlike the others it needs a key, which TMDB gives free to an
 * individual: the person brings their own, and it is kept sealed. Its terms ask for the notice below wherever
 * its details are shown (and for its logo, which Life Is does not load from anywhere).
 */
export const FILM_SERVICE = {
  name: 'Films and shows from TMDB',
  site: 'https://www.themoviedb.org',
  keys: 'https://www.themoviedb.org/settings/api',
  sends: "The title you type (and the year, if you give one), or a title's TMDB number, sent to themoviedb.org with your own key; nothing else. Life Is also fetches posters from image.tmdb.org (the small ones in the list of matches, and the one you keep as the cover), through itself: your browser never asks TMDB for anything.",
  notice: 'This application uses TMDB and the TMDB APIs but is not endorsed, certified, or otherwise approved by TMDB.',
};
export const TMDB_API = 'https://api.themoviedb.org';
export const TMDB_IMAGES = 'https://image.tmdb.org/t/p/';

/** A grocery product by its barcode: what it's called, who makes it, and the size on the packet. */
export type FoundProduct = { barcode: string; name: string; brand: string | null; size: string | null };
export type FoundBook = {
  isbn: string; title: string; creator: string | null; /** The year this printing came out, which may be long after the book was first published. */ edition_year: number | null;
  pages: number | null; /** What it's about, as the library files it: a few subjects at most. */ genres: string[];
};
/** A film, album or game by its barcode, with what it's on when the answer says. */
export type FoundTitle = { barcode: string; type: 'film' | 'music' | 'game' | 'book' | 'other'; title: string; creator: string | null; year: number | null; format: string | null; from: string };
/** `films` is TMDB being on; `film_key` is only whether a key is kept, never the key. */
export type Lookups = { available: boolean; books: boolean; groceries: boolean; titles: boolean; films: boolean; film_key: boolean };

/** One film or show in a list of matches: `kind` is TMDB's own word ('movie' or 'tv'). */
export type FilmMatch = { kind: FilmKind; id: string; title: string; year: number | null; poster: string | null; overview: string | null };
export type FilmKind = 'movie' | 'tv';
export type FilmFields = { title: string; year: number | null; creator: string | null; minutes: number | null; genres: string[]; summary: string | null };
/** A title's details from TMDB, with the path of its poster (never an address). */
export type FilmFound = FilmFields & { kind: FilmKind; id: string; poster: string | null };

const SETTING = 'lookup_books';
const GROCERIES = 'lookup_groceries';
const TITLES = 'lookup_titles';
const FILMS = 'lookup_films';
const FILMS_KEY = 'lookup_films_key';
/** The path TMDB gives for a poster: a file name under its image address, nothing that could lead elsewhere. */
const POSTER_PATH = /^\/[A-Za-z0-9_-]{5,100}\.(jpg|jpeg|png)$/;
const POSTER_SIZES = ['w92', 'w185', 'w342'];

/**
 * What a lookup brought, set against what the person already typed. Their own words stay where they typed
 * something; a lookup only fills what is empty, unless `all` says to take all of it.
 */
export function fillFrom(current: Partial<Record<keyof FilmFields, unknown>>, found: FilmFields, all = false): { fields: FilmFields; filled: string[]; kept: string[] } {
  const filled: string[] = [];
  const kept: string[] = [];
  const empty = (v: unknown) => v == null || v === '' || (Array.isArray(v) && v.length === 0);
  const pick = <K extends keyof FilmFields>(name: K): FilmFields[K] => {
    const mine = current[name] as FilmFields[K] | undefined;
    const theirs = found[name];
    if (empty(theirs)) return (empty(mine) ? (name === 'genres' ? [] : null) : mine) as FilmFields[K];
    if (empty(mine) || all) { if (JSON.stringify(mine ?? null) !== JSON.stringify(theirs)) filled.push(name); return theirs; }
    if (JSON.stringify(mine) !== JSON.stringify(theirs)) kept.push(name);
    return mine as FilmFields[K];
  };
  const title = pick('title');
  return { fields: { title: title ?? found.title, year: pick('year'), creator: pick('creator'), minutes: pick('minutes'), genres: pick('genres'), summary: pick('summary') }, filled, kept };
}

/** The ISBN in what a scanner read off a book, or null when it isn't one. */
export function isbnOf(read: string): string | null {
  const plain = read.replace(/[\s-]/g, '').toUpperCase();
  if (/^97[89]\d{10}$/.test(plain)) return plain;
  return /^\d{9}[\dX]$/.test(plain) ? plain : null;
}

/** What TMDB's own answers need to be asked from and kept by: a sealer for the key, and (for a stand-in in a test) the addresses. */
export type FilmTools = { sealer?: Sealer; api?: string; images?: string };

export function lookups(db: Db, owner: number, _clock: Clock = () => new Date(), fetcher?: Fetcher, tools: FilmTools = {}) {
  const isOn = async (key: string) => (await db.get<{ value: string | null }>('SELECT value FROM user_settings WHERE user_id = ? AND key = ?', [owner, key]))?.value === '1';
  const on = () => isOn(SETTING);
  const hasFilmKey = async () => Boolean((await db.get<{ value: string | null }>('SELECT value FROM user_settings WHERE user_id = ? AND key = ?', [owner, FILMS_KEY]))?.value);
  const status = async (): Promise<Lookups> => ({
    available: Boolean(fetcher), books: Boolean(fetcher) && await on(), groceries: Boolean(fetcher) && await isOn(GROCERIES), titles: Boolean(fetcher) && await isOn(TITLES),
    films: Boolean(fetcher) && await isOn(FILMS) && await hasFilmKey(), film_key: await hasFilmKey(),
  });
  const api = (tools.api ?? TMDB_API).replace(/\/+$/, '');
  const images = (tools.images ?? TMDB_IMAGES).replace(/\/*$/, '/');

  /** The saved key, opened: only for this person, and only while TMDB is on. */
  const filmKey = async (): Promise<string> => {
    if (!fetcher) throw new Problem(400, "This copy of Life Is isn't set up to reach outside services");
    if (!(await isOn(FILMS))) throw new Problem(400, 'Looking films and shows up on TMDB is turned off. Turn it on in Settings, under "Outside services".');
    const sealed = (await db.get<{ value: string | null }>('SELECT value FROM user_settings WHERE user_id = ? AND key = ?', [owner, FILMS_KEY]))?.value;
    if (!sealed) throw new Problem(400, 'Type your TMDB key in Settings first.');
    const plain = tools.sealer?.unseal(sealed);
    if (!plain) throw new Problem(400, "The saved TMDB key can't be opened here any more. Type it in again in Settings.");
    return plain;
  };
  /** Asks TMDB, with the key: as a bearer token when it is the long "read access token", otherwise as the v3 key. */
  const tmdb = async (path: string, params: Record<string, string>): Promise<Record<string, unknown> | null> => {
    const key = await filmKey();
    const headers: Record<string, string> = { Accept: 'application/json' };
    const query = new URLSearchParams(params);
    if (/^[a-f0-9]{32}$/i.test(key)) query.set('api_key', key); else headers.Authorization = `Bearer ${key}`;
    let answer: Answer;
    try {
      answer = await fetcher!(`${api}/3${path}${query.size ? `?${query}` : ''}`, headers);
    } catch {
      throw new Problem(400, "TMDB couldn't be reached just now");
    }
    if (answer.status === 401) throw new Problem(400, "TMDB didn't accept that key. Check it at themoviedb.org, under your account's API settings, and type it in again.");
    if (answer.status === 404) return null;
    if (answer.status === 429) throw new Problem(400, 'TMDB asked Life Is to slow down. Try again in a moment.');
    if (answer.status !== 200) throw new Problem(400, `TMDB answered with an error (${answer.status})`);
    try { return await answer.json() as Record<string, unknown>; } catch { throw new Problem(400, "TMDB's answer couldn't be read"); }
  };
  const words = (value: unknown, most = 300) => (typeof value === 'string' && value.trim() ? clean(value, most) : null);
  const yearOf = (value: unknown) => { const y = /^(\d{4})/.exec(typeof value === 'string' ? value : ''); return y && Number(y[1]) > 0 ? Number(y[1]) : null; };
  const posterOf = (value: unknown) => (typeof value === 'string' && POSTER_PATH.test(value) ? value : null);
  const kindOf = (kind: string): FilmKind => {
    if (kind === 'film' || kind === 'movie') return 'movie';
    if (kind === 'show' || kind === 'tv') return 'tv';
    throw new Problem(400, 'TMDB knows films and shows');
  };
  /** A poster's picture, fetched through Life Is: nothing but the file name TMDB gave goes after its image address. */
  const picture = async (path: string, size: string): Promise<{ type: string; bytes: Uint8Array }> => {
    if (!POSTER_PATH.test(path) || !POSTER_SIZES.includes(size)) throw new Problem(400, "That isn't a poster");
    if (!fetcher || !(await isOn(FILMS))) throw new Problem(400, 'Looking films and shows up on TMDB is turned off. Turn it on in Settings, under "Outside services".');
    let answer: Answer;
    try { answer = await fetcher(`${images}${size}${path}`, { Accept: 'image/*' }); } catch { throw new Problem(400, "image.tmdb.org couldn't be reached just now"); }
    const type = answer.type?.split(';')[0]?.trim() ?? '';
    if (answer.status !== 200 || !type.startsWith('image/')) throw new Problem(400, "That poster couldn't be fetched");
    const bytes = await answer.bytes();
    if (bytes.length === 0 || bytes.length > 2_000_000) throw new Problem(400, "That poster couldn't be fetched");
    return { type, bytes };
  };
  const turn = async (key: string, wanted: boolean): Promise<Lookups> => {
    if (wanted && !fetcher) throw new Problem(400, "This copy of Life Is isn't set up to reach outside services");
    if (wanted) await db.run(`INSERT INTO user_settings (user_id, key, value) VALUES (?, ?, '1') ON CONFLICT(user_id, key) DO UPDATE SET value = '1'`, [owner, key]);
    else await db.run('DELETE FROM user_settings WHERE user_id = ? AND key = ?', [owner, key]);
    return status();
  };

  return {
    status,

    /** Turn looking books up on or off. Off, nothing is ever asked. */
    async setBooks(wanted: boolean): Promise<Lookups> {
      if (wanted && !fetcher) throw new Problem(400, "This copy of Life Is isn't set up to reach outside services");
      if (wanted) {
        await db.run(`INSERT INTO user_settings (user_id, key, value) VALUES (?, ?, '1') ON CONFLICT(user_id, key) DO UPDATE SET value = '1'`, [owner, SETTING]);
      } else {
        await db.run('DELETE FROM user_settings WHERE user_id = ? AND key = ?', [owner, SETTING]);
      }
      return status();
    },

    /** Turn looking groceries up on or off. Off, nothing is ever asked. */
    setGroceries: (wanted: boolean) => turn(GROCERIES, wanted),

    /** Turn looking films, music and games up on or off. Off, nothing is ever asked. */
    setTitles: (wanted: boolean) => turn(TITLES, wanted),

    /**
     * Turn TMDB on or off. A key typed here is sealed and kept for this person; it is never given back. Turning it
     * on needs a key, typed now or kept already. Off, nothing is ever asked (the key stays, locked, for next time).
     */
    async setFilms(wanted: boolean, typedKey?: string | null): Promise<Lookups> {
      if (wanted && !fetcher) throw new Problem(400, "This copy of Life Is isn't set up to reach outside services");
      const typed = typedKey?.trim();
      if (typed) {
        if (!tools.sealer) throw new Problem(400, "A key can't be kept safely here yet.");
        if (!/^[\w.-]{20,1000}$/.test(typed)) throw new Problem(400, "That doesn't look like a TMDB key. It is one long run of letters and numbers: copy it whole from your TMDB account's API settings.");
        await db.run(`INSERT INTO user_settings (user_id, key, value) VALUES (?, ?, ?) ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value`, [owner, FILMS_KEY, tools.sealer.seal(typed)]);
      }
      if (wanted) {
        if (!(await hasFilmKey())) throw new Problem(400, 'Type your TMDB key first. It is free for one person: see themoviedb.org, under your account\'s API settings.');
        await db.run(`INSERT INTO user_settings (user_id, key, value) VALUES (?, ?, '1') ON CONFLICT(user_id, key) DO UPDATE SET value = '1'`, [owner, FILMS]);
      } else {
        await db.run('DELETE FROM user_settings WHERE user_id = ? AND key = ?', [owner, FILMS]);
      }
      return status();
    },

    /** Forget the saved TMDB key, and turn TMDB off with it. */
    async forgetFilmsKey(): Promise<Lookups> {
      await db.run('DELETE FROM user_settings WHERE user_id = ? AND key IN (?, ?)', [owner, FILMS, FILMS_KEY]);
      return status();
    },

    /** One harmless request, TMDB's own list of settings, to see that the saved key is accepted. */
    async testFilms(): Promise<{ ok: true }> {
      const answer = await tmdb('/configuration', {});
      if (!answer || typeof answer.images !== 'object') throw new Problem(400, 'TMDB answered, but not in the way Life Is expects');
      return { ok: true };
    },

    /** Up to eight films or shows by name (and year, if given). `kind` is what the form says it is: film or show. */
    async searchFilms(input: { title: string; year?: number | null; kind: string }): Promise<FilmMatch[]> {
      const kind = kindOf(input.kind);
      const title = clean(input.title, 200);
      if (!title) throw new Problem(400, 'Type the title to look for');
      const year = input.year ?? null;
      if (year !== null && !(Number.isInteger(year) && year >= 1870 && year <= 2200)) throw new Problem(400, 'The year is a whole number');
      const found = await tmdb(`/search/${kind}`, { query: title, ...(year !== null ? { [kind === 'movie' ? 'year' : 'first_air_date_year']: String(year) } : {}) });
      const results = Array.isArray(found?.results) ? found.results as Array<Record<string, unknown>> : [];
      const matches: FilmMatch[] = [];
      for (const r of results) {
        const name = words(kind === 'movie' ? r.title : r.name);
        if (!name || !(typeof r.id === 'number' && Number.isInteger(r.id) && r.id > 0)) continue;
        matches.push({ kind, id: String(r.id), title: name, year: yearOf(kind === 'movie' ? r.release_date : r.first_air_date), poster: posterOf(r.poster_path), overview: words(r.overview, 300) });
        if (matches.length === 8) break;
      }
      return matches;
    },

    /** A film's or show's details by its TMDB number: director or creator, runtime, genres, summary, poster. */
    async filmDetails(kindName: string, id: string): Promise<FilmFound | null> {
      const kind = kindOf(kindName);
      if (!/^\d{1,10}$/.test(id)) throw new Problem(400, "That isn't a TMDB number");
      const d = await tmdb(`/${kind}/${id}`, { append_to_response: 'credits' });
      const title = words(kind === 'movie' ? d?.title : d?.name);
      if (!d || !title) return null;
      const names = (list: unknown) => (Array.isArray(list) ? list.map((p) => (p as { name?: unknown }).name).filter((n): n is string => typeof n === 'string' && n.trim() !== '') : []);
      const crew = Array.isArray((d.credits as { crew?: unknown } | undefined)?.crew) ? (d.credits as { crew: Array<{ job?: unknown; name?: unknown }> }).crew : [];
      const directors = crew.filter((p) => p.job === 'Director' && typeof p.name === 'string').map((p) => p.name as string);
      const who = kind === 'movie' ? directors : names(d.created_by);
      const run = kind === 'movie' ? d.runtime : Array.isArray(d.episode_run_time) ? d.episode_run_time[0] : null;
      return {
        kind, id, title, year: yearOf(kind === 'movie' ? d.release_date : d.first_air_date), creator: who.length ? clean(who.slice(0, 3).join(', '), 300) : null,
        minutes: typeof run === 'number' && run > 0 && run <= 100_000 ? Math.round(run) : null, genres: names(d.genres).slice(0, 5).map((g) => clean(g, 40)!),
        summary: words(d.overview, 5000), poster: posterOf(d.poster_path),
      };
    },

    /** A small poster for the list of matches, fetched through Life Is. */
    poster: (path: string, size = 'w92') => picture(path, size),

    /**
     * Keep a poster as a title's cover: fetched once, stored with the title, and served from Life Is itself.
     * Only this person's own titles.
     */
    async keepPoster(mediaId: number, path: string): Promise<{ cover: string }> {
      if (!(await db.get('SELECT id FROM media WHERE id = ? AND owner_id = ?', [mediaId, owner]))) throw new Problem(404, 'Not found');
      const { type, bytes } = await picture(path, 'w342');
      await atomic(db, async (tx) => {
        if (!(await tx.get('SELECT id FROM media WHERE id = ? AND owner_id = ?', [mediaId, owner]))) throw new Problem(404, 'Not found');
        await tx.run('INSERT OR REPLACE INTO media_covers (media_id, type, bytes) VALUES (?, ?, ?)', [mediaId, type, bytes]);
        await tx.run('UPDATE media SET cover = ? WHERE id = ?', [`/api/media/${mediaId}/cover`, mediaId]);
      });
      return { cover: `/api/media/${mediaId}/cover` };
    },

    /**
     * What film, album or game a barcode is, or null when neither service knows it. Music is asked of
     * MusicBrainz first, since it knows records best; anything it doesn't know goes to UPCitemdb.
     */
    async title(read: string): Promise<FoundTitle | null> {
      const barcode = read.replace(/[\s-]/g, '');
      if (!/^\d{8,14}$/.test(barcode)) throw new Problem(400, "That isn't a product's barcode");
      if (!fetcher || !(await isOn(TITLES))) throw new Problem(400, 'Looking films, music and games up is turned off. Turn it on in Settings, under "Outside services".');
      // A shop's own number means nothing anywhere else: asking would only bring back something unrelated.
      if (shopsOwnBarcode(barcode)) return null;
      const ask = async (url: string, who: string): Promise<Record<string, unknown> | null> => {
        let answer: Answer;
        try {
          answer = await fetcher(url, { Accept: 'application/json', 'User-Agent': 'LifeIs/0.1 (self-hosted household app)' });
        } catch {
          throw new Problem(400, `${who} couldn't be reached just now`);
        }
        if (answer.status === 404) return null;
        if (answer.status === 429) throw new Problem(400, `${who} has had enough look-ups for today. Try again tomorrow, or type it in.`);
        if (answer.status !== 200) throw new Problem(400, `${who} answered with an error (${answer.status})`);
        try { return await answer.json() as Record<string, unknown>; } catch { throw new Problem(400, `${who}'s answer couldn't be read`); }
      };
      const text = (value: unknown, most = 300) => (typeof value === 'string' && value.trim() ? clean(value, most) : null);
      const yearIn = (value: unknown) => { const y = /\b(1[89]|20)\d{2}\b/.exec(typeof value === 'string' ? value : ''); return y ? Number(y[0]) : null; };

      // MusicBrainz is often too busy to answer; then UPCitemdb is asked all the same.
      const music = await ask(`https://musicbrainz.org/ws/2/release/?query=barcode:${barcode}&fmt=json&limit=1`, 'MusicBrainz').catch(() => null);
      const release = Array.isArray(music?.releases) ? music.releases[0] as Record<string, unknown> | undefined : undefined;
      const title = text(release?.title);
      if (release && title && (typeof release.score !== 'number' || release.score >= 90)) {
        const credits = Array.isArray(release['artist-credit']) ? release['artist-credit'] as Array<Record<string, unknown>> : [];
        const artist = credits.map((c) => `${text(c.name) ?? ''}${typeof c.joinphrase === 'string' ? c.joinphrase : ''}`).join('').trim();
        const media = Array.isArray(release.media) ? release.media as Array<Record<string, unknown>> : [];
        const medium = text(media[0]?.format, 40);
        // A spoken book is filed on CD by MusicBrainz too; it's a book, not music.
        const spoken = audiobookFormat(`${title} ${medium ?? ''}`);
        return { barcode, type: spoken ? 'book' : 'music', title, creator: artist ? clean(artist, 300) : null, year: yearIn(release.date), format: spoken ?? medium, from: 'MusicBrainz' };
      }

      const product = await ask(`https://api.upcitemdb.com/prod/trial/lookup?upc=${barcode}`, 'UPCitemdb');
      const item = Array.isArray(product?.items) ? product.items[0] as Record<string, unknown> | undefined : undefined;
      const named = text(item?.title);
      if (!item || !named) return null;
      return { barcode, ...readProduct(named, text(item.category) ?? ''), creator: null, year: null, from: 'UPCitemdb' };
    },

    /** What grocery a barcode is, or null when the service doesn't know it. Only when turned on. */
    async product(read: string): Promise<FoundProduct | null> {
      const barcode = read.replace(/[\s-]/g, '');
      if (!/^\d{6,14}$/.test(barcode)) throw new Problem(400, "That isn't a grocery's barcode");
      if (!fetcher || !(await isOn(GROCERIES))) throw new Problem(400, 'Looking groceries up is turned off. Turn it on in Settings, under "Outside services".');
      let answer: Answer;
      try {
        answer = await fetcher(`https://world.openfoodfacts.org/api/v2/product/${barcode}.json?fields=product_name,brands,quantity`, { Accept: 'application/json', 'User-Agent': 'LifeIs/0.1 (self-hosted household app)' });
      } catch {
        throw new Problem(400, "Open Food Facts couldn't be reached just now");
      }
      if (answer.status === 404) return null;
      if (answer.status !== 200) throw new Problem(400, `Open Food Facts answered with an error (${answer.status})`);
      let data: { status?: unknown; product?: Record<string, unknown> };
      try {
        data = await answer.json() as typeof data;
      } catch {
        throw new Problem(400, "Open Food Facts' answer couldn't be read");
      }
      const name = typeof data?.product?.product_name === 'string' ? clean(data.product.product_name, 200) : null;
      if (data?.status !== 1 || !name) return null;
      const text = (value: unknown) => (typeof value === 'string' ? clean(value, 100) : null);
      return { barcode, name, brand: text(data.product!.brands), size: text(data.product!.quantity) };
    },

    /** What book a barcode is, or null when the service doesn't know it. Only when turned on. */
    async book(read: string): Promise<FoundBook | null> {
      const isbn = isbnOf(read);
      if (!isbn) throw new Problem(400, "That isn't a book's barcode");
      if (!fetcher || !(await on())) throw new Problem(400, 'Looking books up is turned off. Turn it on in Settings, under "Outside services".');
      let answer: Answer;
      try {
        answer = await fetcher(`https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&format=json&jscmd=data`, { Accept: 'application/json' });
      } catch {
        throw new Problem(400, "Open Library couldn't be reached just now");
      }
      if (answer.status !== 200) throw new Problem(400, `Open Library answered with an error (${answer.status})`);
      let found: Record<string, unknown> | undefined;
      try {
        found = ((await answer.json()) as Record<string, Record<string, unknown>>)[`ISBN:${isbn}`];
      } catch {
        throw new Problem(400, "Open Library's answer couldn't be read");
      }
      const title = typeof found?.title === 'string' ? clean([found.title, typeof found.subtitle === 'string' ? found.subtitle : null].filter(Boolean).join(': '), 300) : null;
      if (!found || !title) return null;
      const authors = Array.isArray(found.authors) ? found.authors.map((a) => (a as { name?: unknown }).name).filter((n): n is string => typeof n === 'string') : [];
      const year = /\b(1[5-9]|20)\d{2}\b/.exec(typeof found.publish_date === 'string' ? found.publish_date : '');
      const subjects = Array.isArray(found.subjects) ? found.subjects.map((a) => (a as { name?: unknown }).name).filter((n): n is string => typeof n === 'string') : [];
      return {
        isbn, title, creator: clean(authors.slice(0, 4).join(', '), 300), edition_year: year ? Number(year[0]) : null,
        pages: typeof found.number_of_pages === 'number' && found.number_of_pages > 0 ? Math.round(found.number_of_pages) : null,
        genres: bookGenres(subjects),
      };
    },
  };
}

/**
 * A library's subjects, as genres a person would use: the short ones, without its filing notes
 * ("Fiction, general", "Accessible book", "nyt:hardcover-fiction=2020-01-01"), at most five.
 */
export function bookGenres(subjects: string[]): string[] {
  const kept: string[] = [];
  for (const raw of subjects) {
    // "Fiction, science fiction" is filed under fiction; the genre is what comes after.
    const name = raw.trim().replace(/\s*,\s*general$/i, '').replace(/^fiction\s*,\s*/i, '');
    if (!name || name.length > 30 || /[:=()]|\bbook\b|accessible|protected daisy|in library|large type|juvenile literature|reviewed|new york times|bestseller/i.test(name)) continue;
    const proper = name.charAt(0).toUpperCase() + name.slice(1);
    // "Science fiction" and "Science-fiction" are one genre.
    const same = (a: string) => a.toLowerCase().replace(/[\s-]+/g, ' ');
    if (!kept.some((k) => same(k) === same(proper))) kept.push(proper);
    if (kept.length === 5) break;
  }
  return kept;
}

const FORMATS: Array<[RegExp, string]> = [
  [/\b4k\b|ultra ?hd/i, '4K Blu-ray'], [/blu-?ray/i, 'Blu-ray'], [/\bdvd\b/i, 'DVD'], [/\bvhs\b/i, 'VHS'],
  [/\bvinyl\b|\blp\b/i, 'Vinyl'], [/\bcd\b|compact disc/i, 'CD'], [/cassette/i, 'Cassette'],
  [/nintendo switch/i, 'Switch'], [/playstation 5|\bps5\b/i, 'PS5'], [/playstation 4|\bps4\b/i, 'PS4'],
  [/xbox series/i, 'Xbox Series'], [/xbox one/i, 'Xbox One'],
];

/** Words that say a product is a spoken book: an audiobook, unabridged, or a book on CD or tape. */
const SPOKEN = /audio ?books?|unabridged|books? on (cds?|tapes?)/i;

/**
 * The format of a spoken book, from the text that names it: "Book on CD" when it mentions a CD or disc, "Book on
 * tape" when it mentions a tape or cassette, otherwise "Audiobook". Null when the text doesn't say it's a spoken
 * book. "Audio CD" alone is not enough: shops label ordinary music CDs that way.
 */
export function audiobookFormat(text: string): string | null {
  if (!SPOKEN.test(text)) return null;
  if (/\btapes?\b|\bcassettes?\b/i.test(text)) return 'Book on tape';
  if (/\bcds?\b|\bdiscs?\b/i.test(text)) return 'Book on CD';
  return 'Audiobook';
}

/**
 * A shop's product name, read for what a collection needs: "The Matrix [Blu-ray] (Widescreen)" is the film
 * The Matrix, on Blu-ray. What kind of thing it is comes from the shop's category, then from the format. A
 * spoken book ("Unabridged Audiobook CD") is a book, whatever disc it's on.
 */
export function readProduct(name: string, category: string): { type: 'film' | 'music' | 'game' | 'book' | 'other'; title: string; format: string | null } {
  const spoken = audiobookFormat(`${name} ${category}`);
  const format = spoken ?? FORMATS.find(([pattern]) => pattern.test(name))?.[1] ?? null;
  const games = /video game|games?\b/i.test(category) || /^(Switch|PS[45]|Xbox)/.test(format ?? '');
  const music = /music|\bcds?\b|vinyl|records?\b/i.test(category) || ['Vinyl', 'CD', 'Cassette'].includes(format ?? '');
  const film = /movie|dvd|blu-?ray|video|film/i.test(category) || ['4K Blu-ray', 'Blu-ray', 'DVD', 'VHS'].includes(format ?? '');
  const type = spoken ? 'book' : games ? 'game' : music ? 'music' : film ? 'film' : 'other';
  // What's in brackets is about the box, not the title: the format, the edition, the region.
  const plain = name.replace(/\s*[([][^)\]]*[)\]]/g, '').replace(/\s+-\s+(blu-?ray|dvd|4k.*|nintendo switch|playstation \d|xbox.*)$/i, '')
    .replace(/(\s+(blu-?ray|dvd|cd|vinyl|lp))+$/i, '');
  // A spoken book's name also says what it is ("Unabridged", "Audiobook", "Tape"): that's not part of the title.
  const bare = spoken ? plain.replace(/\b((un)?abridged|audio ?books?|books? on|cds?|discs?|tapes?|cassettes?)\b/gi, ' ').replace(/\s+/g, ' ') : plain;
  const title = clean(bare, 300) || clean(name, 300)!;
  return { type, title, format };
}

/**
 * Whether a barcode is one a shop prints itself (on things it weighs or labels: numbers starting 2, or 02 and
 * 04 on a 12-digit one) or a placeholder of zeros. Such numbers are reused by every shop for its own things,
 * so no list anywhere can say what one is.
 */
export function shopsOwnBarcode(barcode: string): boolean {
  const digits = barcode.replace(/\D/g, '');
  if (/^0{7,}/.test(digits)) return true;
  const ean = digits.length === 12 ? `0${digits}` : digits;
  return ean.length === 13 && /^(02|04|2)/.test(ean);
}
