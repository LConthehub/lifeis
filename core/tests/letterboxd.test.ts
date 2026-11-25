/** Letterboxd files in and out, and half-star ratings. Made-up films only. */
import { beforeEach, expect, it } from 'vitest';
import type { Db } from '../src/db.ts';
import { bringInDownload, exportEverything, splitDownload } from '../src/exportAll.ts';
import { bringInLetterboxd, halvesOf, letterboxdFile } from '../src/letterboxd.ts';
import { media, sortTitles } from '../src/media.ts';
import { mediaLists } from '../src/mediaLists.ts';
import { migrate } from '../src/migrations.ts';
import { memoryDb } from './memoryDb.ts';

let db: Db;
let ana: number;
let bob: number;
const clock = () => new Date(2046, 2, 5, 10, 0, 0);
const person = async (name: string) => (await db.run("INSERT INTO users (username, password_hash, created_at) VALUES (?, 'x', 'now')", [name])).lastId;
const shelfOf = (who: number) => media(db, who, clock);
const listsOf = (who: number) => mediaLists(db, who, clock);

const REVIEW = 'Cold, grey and "quiet".\r\n\r\nThe second paragraph  keeps its   spacing.';
const download = {
  'letterboxd-someone/watched.csv': 'Date,Name,Year,Letterboxd URI\n2024-01-05,The Lantern Keepers,1971,https://boxd.it/aaa1\n2024-02-10,Salt Harbor,1988,https://boxd.it/bbb2\n2024-03-01,Quiet Orchard,2003,https://boxd.it/ccc3\n',
  'letterboxd-someone/diary.csv': 'Date,Name,Year,Letterboxd URI,Rating,Rewatch,Tags,Watched Date\n2024-01-06,The Lantern Keepers,1971,https://boxd.it/e1,4.5,,,2024-01-05\n2024-02-11,Salt Harbor,1988,https://boxd.it/e2,3.5,,,2024-02-10\n2024-05-01,Salt Harbor,1988,https://boxd.it/e3,,Yes,,2024-04-30\n',
  'letterboxd-someone/ratings.csv': 'Date,Name,Year,Letterboxd URI,Rating\n2024-01-06,The Lantern Keepers,1971,https://boxd.it/aaa1,4.5\n2024-02-11,Salt Harbor,1988,https://boxd.it/bbb2,3.5\n2024-03-02,Quiet Orchard,2003,https://boxd.it/ccc3,0.5\n',
  'letterboxd-someone/reviews.csv': `Date,Name,Year,Letterboxd URI,Rating,Rewatch,Review,Tags,Watched Date\n2024-02-11,Salt Harbor,1988,https://boxd.it/e2,3.5,,"${REVIEW.replaceAll('"', '""')}",,2024-02-10\n`,
  'letterboxd-someone/watchlist.csv': 'Date,Name,Year,Letterboxd URI\n2024-04-01,Marsh Lights,1994,https://boxd.it/ddd4\n2024-04-02,Paper Moons,2011,https://boxd.it/eee5\n',
  'letterboxd-someone/lists/rainy-day-picks.csv': 'Letterboxd list export v7\nDate,Name,Tags,URL,Description\n2024-06-01,Rainy Day Picks,,https://boxd.it/L1,Slow ones\n\nPosition,Name,Year,URL,Description\n2,Salt Harbor,1988,https://letterboxd.com/film/salt-harbor/,Second one\n1,Marsh Lights,1994,https://letterboxd.com/film/marsh-lights/,First one\n3,Glass Tide,1999,,\n',
  'letterboxd-someone/profile.csv': 'Date Joined,Username\n2020-01-01,someone\n',
  'letterboxd-someone/likes/films.csv': 'Date,Name,Year,Letterboxd URI\n2024-01-05,Never Read,1971,https://boxd.it/zzz\n',
};

beforeEach(async () => {
  db = memoryDb();
  await migrate(db);
  ana = await person('ana');
  bob = await person('bob');
});

const count = async (table: string, who = ana) => (await db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table} ${table === 'media' ? 'WHERE owner_id = ?' : 'WHERE media_id IN (SELECT id FROM media WHERE owner_id = ?)'}`, [who]))!.n;

it('stars are halves from 0.5 to 5', () => {
  expect([halvesOf('0.5'), halvesOf('3.5'), halvesOf('5'), halvesOf('0'), halvesOf('5.5'), halvesOf('3.3'), halvesOf(''), halvesOf('x')]).toEqual([1, 7, 10, null, null, null, null, null]);
});

it('a rating is the person’s own, on any kind of title, in halves, and sorts', async () => {
  const a = await shelfOf(ana).create({ type: 'film', title: 'Alpha' });
  const b = await shelfOf(ana).create({ type: 'book', title: 'Beta' });
  await shelfOf(ana).create({ type: 'game', title: 'Gamma' });
  expect((await shelfOf(ana).rate(a.id, 3.5)).stars).toBe(3.5);
  expect((await shelfOf(ana).rate(b.id, 5)).stars).toBe(5);
  await expect(shelfOf(ana).rate(a.id, 3.3)).rejects.toMatchObject({ status: 400 });
  await expect(shelfOf(ana).rate(a.id, 0)).rejects.toMatchObject({ status: 400 });
  await expect(shelfOf(ana).rate(a.id, 5.5)).rejects.toMatchObject({ status: 400 });
  expect(sortTitles(await shelfOf(ana).list(), 'rating').map((t) => t.title)).toEqual(['Beta', 'Alpha', 'Gamma']);
  // Bob cannot see or change Ana's.
  await expect(shelfOf(bob).get(a.id)).rejects.toMatchObject({ status: 404 });
  await expect(shelfOf(bob).rate(a.id, 1)).rejects.toMatchObject({ status: 404 });
  expect((await shelfOf(ana).rate(a.id, null)).stars).toBeNull();
});

it('a Letterboxd download comes in: counts first, then saved, then nothing the second time', async () => {
  const look = await bringInLetterboxd(db, ana, download, false, clock);
  expect(look.saved).toBe(false);
  expect(look.files).toHaveLength(6);
  expect([...look.left_alone].sort()).toEqual(['letterboxd-someone/likes/films.csv', 'letterboxd-someone/profile.csv']);
  expect(look.films).toEqual({ found: 6, new: 6, already: 0 });
  expect(look.days).toEqual({ found: 4, new: 4, already: 0 });
  expect(look.day_from_log).toBe(1);
  expect(look.ratings).toEqual({ found: 3, new: 3, already: 0 });
  expect(look.reviews).toEqual({ found: 1, new: 1, already: 0 });
  expect(look.watchlist).toEqual({ found: 2, new: 2, already: 0 });
  expect(look.lists).toEqual([{ name: 'Rainy Day Picks', made: true, found: 3, new: 3, already: 0 }]);
  // Looking changed nothing.
  expect(await count('media')).toBe(0);
  expect((await listsOf(ana).all()).every((l) => l.count === 0)).toBe(true);

  const saved = await bringInLetterboxd(db, ana, download, true, clock);
  expect({ ...saved, saved: undefined }).toEqual({ ...look, saved: undefined });

  // Nothing is owned: every title is kept only as watched or listed.
  expect(await count('media')).toBe(6);
  expect((await db.get<{ n: number }>('SELECT COUNT(*) AS n FROM media WHERE owner_id = ? AND listed_only = 1', [ana]))!.n).toBe(6);
  expect(await count('media_copies')).toBe(0);
  expect(await shelfOf(ana).list()).toEqual([]);

  const titles = await db.all<{ id: number; title: string; stars: number | null; ids: string | null }>('SELECT id, title, stars, ids FROM media WHERE owner_id = ? ORDER BY id', [ana]);
  const of = (name: string) => titles.find((t) => t.title === name)!;
  expect([of('The Lantern Keepers').stars, of('Salt Harbor').stars, of('Quiet Orchard').stars, of('Glass Tide').stars]).toEqual([9, 7, 1, null]);
  expect(JSON.parse(of('Salt Harbor').ids!)).toEqual({ letterboxd: 'https://boxd.it/bbb2' });

  // Watch days: each diary entry is a day; a film with none gets its logged day.
  const logs = await db.all<{ title: string; day: string; note: string | null }>('SELECT m.title, l.day, l.note FROM media_log l JOIN media m ON m.id = l.media_id WHERE m.owner_id = ? ORDER BY m.title, l.day', [ana]);
  expect(logs.map((l) => [l.title, l.day])).toEqual([['Quiet Orchard', '2024-03-01'], ['Salt Harbor', '2024-02-10'], ['Salt Harbor', '2024-04-30'], ['The Lantern Keepers', '2024-01-05']]);
  // The review is word for word, with its line breaks, spaces and quotes.
  expect(logs.find((l) => l.day === '2024-02-10')!.note).toBe(REVIEW);
  expect(logs.filter((l) => l.note !== null)).toHaveLength(1);

  // Watchlist on To watch, read or hear, in the file's order; the list in the position order.
  const all = await listsOf(ana).all();
  const toWatch = await listsOf(ana).get(all.find((l) => l.builtin === 'to_watch')!.id);
  expect(toWatch.entries.map((e) => [e.title, e.year, e.type, e.owned])).toEqual([['Marsh Lights', 1994, 'film', false], ['Paper Moons', 2011, 'film', false]]);
  const rainy = await listsOf(ana).get(all.find((l) => l.name === 'Rainy Day Picks')!.id);
  expect(rainy.entries.map((e) => e.title)).toEqual(['Marsh Lights', 'Salt Harbor', 'Glass Tide']);
  expect(rainy.entries.map((e) => e.note)).toEqual(['First one', 'Second one', null]);
  expect(rainy.shared).toBe(false);
  // Marsh Lights is one title on both lists.
  expect(rainy.entries[0]!.media_id).toBe(toWatch.entries[0]!.media_id);

  // Again: nothing is added anywhere.
  const before = [await count('media'), await count('media_log')];
  const again = await bringInLetterboxd(db, ana, download, true, clock);
  expect(again.films).toEqual({ found: 6, new: 0, already: 6 });
  expect(again.days).toEqual({ found: 3, new: 0, already: 3 });
  expect(again.day_from_log).toBe(0);
  expect(again.ratings).toEqual({ found: 3, new: 0, already: 3 });
  expect(again.reviews).toEqual({ found: 1, new: 0, already: 1 });
  expect(again.watchlist).toEqual({ found: 2, new: 0, already: 2 });
  expect(again.lists).toEqual([{ name: 'Rainy Day Picks', made: false, found: 3, new: 0, already: 3 }]);
  expect([await count('media'), await count('media_log')]).toEqual([before[0], before[1]]);
  expect((await db.get<{ n: number }>('SELECT COUNT(*) AS n FROM media_list_items i JOIN media_lists l ON l.id = i.list_id WHERE l.owner_id = ?', [ana]))!.n).toBe(5);
  expect((await db.get<{ n: number }>('SELECT COUNT(*) AS n FROM media_lists WHERE owner_id = ?', [ana]))!.n).toBe(3);

  // Bob sees nothing of it.
  expect((await listsOf(bob).all()).map((l) => l.name)).toEqual(['Wanted', 'To watch, read or hear']);
  expect(await count('media', bob)).toBe(0);
});

it('a title already here is matched by name and year, and a rating set here is not replaced', async () => {
  const mine = await shelfOf(ana).create({ type: 'film', title: 'salt harbor', year: 1988 }, { format: 'DVD' });
  await shelfOf(ana).rate(mine.id, 2);
  const report = await bringInLetterboxd(db, ana, download, true, clock);
  expect(report.films).toEqual({ found: 6, new: 5, already: 1 });
  expect(report.ratings).toEqual({ found: 3, new: 2, already: 1 });
  const after = await shelfOf(ana).get(mine.id);
  expect(after.stars).toBe(2);
  expect(after.copies).toHaveLength(1);
  expect(after.unowned).toBe(false);
  expect(after.log.map((l) => l.day)).toEqual(['2024-04-30', '2024-02-10']);
  expect(after.ids).toEqual({ letterboxd: 'https://boxd.it/bbb2' });
});

it('loose files come in one by one, and a list file is known by its own header', async () => {
  const one = await bringInLetterboxd(db, ana, { 'my list.csv': download['letterboxd-someone/lists/rainy-day-picks.csv'] }, true, clock);
  expect(one.lists.map((l) => l.name)).toEqual(['Rainy Day Picks']);
  await expect(bringInLetterboxd(db, ana, { 'notes.csv': 'a,b\n1,2\n' }, true, clock)).rejects.toMatchObject({ status: 400 });
  // Variant headings and an ordinary list name from the file's name.
  const loose = await bringInLetterboxd(db, ana, { 'diary.csv': 'date,NAME,year,letterboxd_uri,Rating,watched date\n2030-01-01,Odd Season,2001,,2.5,2030-01-02\n' }, true, clock);
  expect(loose.days).toEqual({ found: 1, new: 1, already: 0 });
  expect((await db.get<{ stars: number }>("SELECT stars FROM media WHERE title = 'Odd Season'"))!.stars).toBe(5);
});

it('a list goes out as a file Letterboxd takes: films only, the rest counted', async () => {
  await bringInLetterboxd(db, ana, download, true, clock);
  const all = await listsOf(ana).all();
  const rainy = all.find((l) => l.name === 'Rainy Day Picks')!;
  await listsOf(ana).add(rainy.id, { type: 'book', title: 'Dune Ish' });
  await listsOf(ana).add(rainy.id, { type: 'music', title: 'Some Record' });
  const made = await letterboxdFile(db, ana, rainy.id, clock);
  expect(made.films).toBe(3);
  expect(made.left_out).toBe(2);
  expect(made.file_name).toBe('rainy-day-picks-for-letterboxd.csv');
  const lines = made.csv.split('\r\n').filter(Boolean);
  expect(lines[0]).toBe('LetterboxdURI,Title,Year,Directors,Rating,WatchedDate,Rewatch,Review');
  expect(lines[1]).toBe('https://boxd.it/ddd4,Marsh Lights,1994,,,,,');
  expect(lines[2]).toContain('Salt Harbor,1988,,3.5,2024-02-10,,"Cold, grey and ""quiet"".');
  expect(made.csv).not.toContain('Dune Ish');
  // The second watch of Salt Harbor is a rewatch with its own day: it is on the next line of the quoted review, so count rows another way.
  const wrote = (made.csv.match(/Salt Harbor/g) ?? []).length;
  expect(wrote).toBe(2);
  expect(made.csv).toContain('2024-04-30,true,');
  expect(made.csv).toContain('Glass Tide,1999,,,,,');
  // A list of a person with Wanted too: any list works.
  const wanted = await letterboxdFile(db, ana, all.find((l) => l.builtin === 'wanted')!.id, clock);
  expect(wanted.films).toBe(0);
});

it('what is shared stays plain: another person gets titles but no ratings, days or reviews, and cannot read a private list', async () => {
  await bringInLetterboxd(db, ana, download, true, clock);
  const rainy = (await listsOf(ana).all()).find((l) => l.name === 'Rainy Day Picks')!;
  await expect(letterboxdFile(db, bob, rainy.id, clock)).rejects.toMatchObject({ status: 404 });
  await listsOf(ana).update(rainy.id, { shared: true });
  const seen = await letterboxdFile(db, bob, rainy.id, clock);
  expect(seen.films).toBe(3);
  expect(seen.csv).not.toContain('3.5');
  expect(seen.csv).not.toContain('2024-');
  expect(seen.csv).not.toContain('quiet');
  expect(seen.csv).not.toContain('boxd.it');
  expect((await listsOf(bob).get(rainy.id)).entries.every((e) => e.owned === null && e.times === null)).toBe(true);
});

it('stars and the Letterboxd link are in the download of everything, and come back', async () => {
  await bringInLetterboxd(db, ana, download, true, clock);
  const zip = await splitDownload((await exportEverything(db, ana, clock)).bytes);
  expect(zip.files['collection.csv']).toContain('Stars,Letterboxd link');
  expect(zip.files['collection.csv']).toContain('3.5,https://boxd.it/bbb2');
  const carl = await person('carl');
  const chosen = ['collection', 'lists'];
  await bringInDownload(db, carl, zip.files, chosen, clock);
  const salt = (await shelfOf(carl).list({ wanted: false })).length; // none owned
  expect(salt).toBe(0);
  const row = await db.get<{ stars: number; ids: string }>("SELECT stars, ids FROM media WHERE owner_id = ? AND title = 'Salt Harbor'", [carl]);
  expect(row).toEqual({ stars: 7, ids: JSON.stringify({ letterboxd: 'https://boxd.it/bbb2' }) });
  const note = await db.get<{ note: string }>("SELECT l.note FROM media_log l JOIN media m ON m.id = l.media_id WHERE m.owner_id = ? AND l.day = '2024-02-10'", [carl]);
  expect(note!.note).toBe(REVIEW.replaceAll('\r\n', '\n')); // a spreadsheet file keeps one kind of line break
  const again = await bringInLetterboxd(db, carl, download, true, clock);
  expect(again.films.new).toBe(0);
  expect(again.days.new).toBe(0);
});
