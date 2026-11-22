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
import type { Answer, Fetcher } from './connections.ts';
import type { Db } from './db.ts';
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

/** A grocery product by its barcode: what it's called, who makes it, and the size on the packet. */
export type FoundProduct = { barcode: string; name: string; brand: string | null; size: string | null };
export type FoundBook = {
  isbn: string; title: string; creator: string | null; /** The year this printing came out, which may be long after the book was first published. */ edition_year: number | null;
  pages: number | null; /** What it's about, as the library files it: a few subjects at most. */ genres: string[];
};
/** A film, album or game by its barcode, with what it's on when the answer says. */
export type FoundTitle = { barcode: string; type: 'film' | 'music' | 'game' | 'other'; title: string; creator: string | null; year: number | null; format: string | null; from: string };
export type Lookups = { available: boolean; books: boolean; groceries: boolean; titles: boolean };

const SETTING = 'lookup_books';
const GROCERIES = 'lookup_groceries';
const TITLES = 'lookup_titles';

/** The ISBN in what a scanner read off a book, or null when it isn't one. */
export function isbnOf(read: string): string | null {
  const plain = read.replace(/[\s-]/g, '').toUpperCase();
  if (/^97[89]\d{10}$/.test(plain)) return plain;
  return /^\d{9}[\dX]$/.test(plain) ? plain : null;
}

export function lookups(db: Db, owner: number, _clock: Clock = () => new Date(), fetcher?: Fetcher) {
  const isOn = async (key: string) => (await db.get<{ value: string | null }>('SELECT value FROM user_settings WHERE user_id = ? AND key = ?', [owner, key]))?.value === '1';
  const on = () => isOn(SETTING);
  const status = async (): Promise<Lookups> => ({ available: Boolean(fetcher), books: Boolean(fetcher) && await on(), groceries: Boolean(fetcher) && await isOn(GROCERIES), titles: Boolean(fetcher) && await isOn(TITLES) });
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
        return { barcode, type: 'music', title, creator: artist ? clean(artist, 300) : null, year: yearIn(release.date), format: text(media[0]?.format, 40), from: 'MusicBrainz' };
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

/**
 * A shop's product name, read for what a collection needs: "The Matrix [Blu-ray] (Widescreen)" is the film
 * The Matrix, on Blu-ray. What kind of thing it is comes from the shop's category, then from the format.
 */
export function readProduct(name: string, category: string): { type: 'film' | 'music' | 'game' | 'other'; title: string; format: string | null } {
  const format = FORMATS.find(([pattern]) => pattern.test(name))?.[1] ?? null;
  const games = /video game|games?\b/i.test(category) || /^(Switch|PS[45]|Xbox)/.test(format ?? '');
  const music = /music|\bcds?\b|vinyl|records?\b/i.test(category) || ['Vinyl', 'CD', 'Cassette'].includes(format ?? '');
  const film = /movie|dvd|blu-?ray|video|film/i.test(category) || ['4K Blu-ray', 'Blu-ray', 'DVD', 'VHS'].includes(format ?? '');
  const type = games ? 'game' : music ? 'music' : film ? 'film' : 'other';
  // What's in brackets is about the box, not the title: the format, the edition, the region.
  const title = clean(name.replace(/\s*[([][^)\]]*[)\]]/g, '').replace(/\s+-\s+(blu-?ray|dvd|4k.*|nintendo switch|playstation \d|xbox.*)$/i, '')
    .replace(/(\s+(blu-?ray|dvd|cd|vinyl|lp))+$/i, ''), 300) || clean(name, 300)!;
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
