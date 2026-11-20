/**
 * Looking a title up from its barcode, so it needn't be typed. An outside service, and so off until a person
 * turns it on.
 *
 * Books only, for now: the barcode on a book is its ISBN, and Open Library (openlibrary.org, run by the
 * Internet Archive) answers what book that is, with no account and no key. The one thing ever sent there is
 * that number. What comes back is offered to the person to check before anything is saved.
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

export type FoundBook = { isbn: string; title: string; creator: string | null; /** The year this printing came out, which may be long after the book was first published. */ edition_year: number | null; pages: number | null };
export type Lookups = { available: boolean; books: boolean };

const SETTING = 'lookup_books';

/** The ISBN in what a scanner read off a book, or null when it isn't one. */
export function isbnOf(read: string): string | null {
  const plain = read.replace(/[\s-]/g, '').toUpperCase();
  if (/^97[89]\d{10}$/.test(plain)) return plain;
  return /^\d{9}[\dX]$/.test(plain) ? plain : null;
}

export function lookups(db: Db, owner: number, _clock: Clock = () => new Date(), fetcher?: Fetcher) {
  const on = async () => (await db.get<{ value: string | null }>('SELECT value FROM user_settings WHERE user_id = ? AND key = ?', [owner, SETTING]))?.value === '1';
  const status = async (): Promise<Lookups> => ({ available: Boolean(fetcher), books: Boolean(fetcher) && await on() });

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
      return {
        isbn, title, creator: clean(authors.slice(0, 4).join(', '), 300), edition_year: year ? Number(year[0]) : null,
        pages: typeof found.number_of_pages === 'number' && found.number_of_pages > 0 ? Math.round(found.number_of_pages) : null,
      };
    },
  };
}
