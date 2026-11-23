/** The collection (films, shows, music, books, games) and the calendar that gathers every section's days. */
import { beforeEach, expect, it } from 'vitest';
import { calendar, type Calendar } from '../src/calendar.ts';
import type { Db } from '../src/db.ts';
import { inventory, type Inventory } from '../src/inventory.ts';
import { kitchen } from '../src/kitchen.ts';
import { centsFromDollars, collectionTotals, dollarsText, media, piecesText, piecesWord, sameTitles, sortTitles, sortWords, type MediaCollection } from '../src/media.ts';
import { migrate } from '../src/migrations.ts';
import { projects, type Projects } from '../src/projects.ts';
import { memoryDb } from './memoryDb.ts';

let db: Db;
let owner: number;
let shelf: MediaCollection;
let things: Inventory;
let making: Projects;
let dates: Calendar;
const clock = () => new Date(2046, 2, 5, 10, 0, 0);
const MONDAY = '2046-03-05';

async function person(name: string): Promise<number> {
  return (await db.run("INSERT INTO users (username, password_hash, created_at) VALUES (?, 'x', 'now')", [name])).lastId;
}

beforeEach(async () => {
  db = memoryDb();
  await migrate(db);
  owner = await person('owner');
  shelf = media(db, owner, clock);
  things = inventory(db, owner, clock);
  making = projects(db, owner, clock);
  dates = calendar(db, owner, clock);
});

const problem = (status: number) => expect.objectContaining({ name: 'Problem', status });

// ---------- the collection ----------

it('a title is the work, and what you own of it is its copies', async () => {
  const places = await things.createPlace({ name: 'Living room' });
  const cabinet = (await things.createPlace({ name: 'Tape cabinet', parent_id: places[0]!.id })).find((p) => p.name === 'Tape cabinet')!.id;
  let alien = await shelf.create(
    { type: 'film', title: ' Alien ', creator: 'Ridley Scott', year: 1979, minutes: 117, genres: ['Horror', 'Science fiction', 'horror'], ids: { tmdb: '348', 'Not a name': 'x' } },
    { format: 'VHS', place_id: cabinet, barcode: '086162109034' });
  expect(alien).toMatchObject({ title: 'Alien', type: 'film', year: 1979, genres: ['Horror', 'Science fiction'], formats: ['VHS'], wanted: false, ids: { tmdb: '348' }, times: 0 });
  expect(alien.copies[0]).toMatchObject({ format: 'VHS', place: 'Living room › Tape cabinet', barcode: '086162109034', lent_to: null, source: null });

  // The same film again on another format: one title, two copies.
  alien = await shelf.addCopy(alien.id, { format: 'Blu-ray' });
  alien = await shelf.addCopy(alien.id, { format: 'blu-ray', note: 'the steelbook' });
  expect([alien.formats, alien.copies.length]).toEqual([['VHS', 'Blu-ray'], 3]);

  // Lending a copy, and getting it back.
  alien = await shelf.updateCopy(alien.copies[1]!.id, { format: 'Blu-ray', lent_to: 'Sam' });
  expect([alien.copies[1]!.lent_to, alien.copies[1]!.lent_on, alien.lent_to]).toEqual(['Sam', '2046-03-05', ['Sam']]);
  expect((await shelf.list({ lent: true })).map((m) => m.title)).toEqual(['Alien']);
  alien = await shelf.updateCopy(alien.copies[1]!.id, { format: 'Blu-ray' });
  expect([alien.copies[1]!.lent_to, alien.copies[1]!.lent_on, await shelf.list({ lent: true })]).toEqual([null, null, []]);

  // Editing the title keeps what other catalogues call it, unless that is sent too.
  alien = await shelf.update(alien.id, { type: 'film', title: 'Alien', year: 1979, note: 'the director’s cut is on the Blu-ray' });
  expect([alien.ids, alien.creator, alien.note]).toEqual([{ tmdb: '348' }, null, 'the director’s cut is on the Blu-ray']);
  alien = await shelf.removeCopy(alien.copies[2]!.id);
  expect(alien.copies.map((c) => c.format)).toEqual(['VHS', 'Blu-ray']);

  await expect(shelf.create({ type: 'film', title: ' ' })).rejects.toEqual(problem(400));
  await expect(shelf.create({ type: 'podcast', title: 'x' })).rejects.toEqual(problem(400));
  await expect(shelf.create({ type: 'film', title: 'x', year: 19.5 })).rejects.toEqual(problem(400));
  await expect(shelf.create({ type: 'film', title: 'x' }, { format: ' ' })).rejects.toEqual(problem(400));
  await expect(shelf.addCopy(alien.id, { format: 'DVD', place_id: 9999 })).rejects.toEqual(problem(404));
  expect((await shelf.list()).map((m) => m.title)).toEqual(['Alien']); // the refused ones left nothing behind
});

it('music, books and anything else sit beside the films, and are found many ways', async () => {
  const room = (await things.createPlace({ name: 'Study' }))[0]!.id;
  const box = (await things.createPlace({ name: 'Record crate', parent_id: room })).find((p) => p.name === 'Record crate')!.id;
  await shelf.create({ type: 'music', title: 'Rumours', creator: 'Fleetwood Mac', year: 1977, genres: ['Rock'] }, { format: 'Vinyl', place_id: box });
  await shelf.create({ type: 'book', title: 'Dune', creator: 'Frank Herbert', year: 1965, ids: { isbn: '9780441172719' } }, { format: 'Paperback', place_id: room });
  await shelf.create({ type: 'film', title: 'Dune', year: 2021 }, { format: '4K UHD' });
  await shelf.create({ type: 'film', title: 'Alien', year: 1979 }, { format: 'Betamax' }); // a format of the person's own
  const wish = await shelf.create({ type: 'music', title: 'Blue', creator: 'Joni Mitchell', wanted: true });

  const titles = async (find: Parameters<MediaCollection['list']>[0]) => (await shelf.list(find)).map((m) => `${m.title} (${m.type})`);
  expect(await titles({})).toEqual(['Alien (film)', 'Blue (music)', 'Dune (book)', 'Dune (film)', 'Rumours (music)']);
  expect(await titles({ type: 'music' })).toEqual(['Blue (music)', 'Rumours (music)']);
  expect(await titles({ q: 'herbert' })).toEqual(['Dune (book)']);
  expect(await titles({ q: 'rock' })).toEqual(['Rumours (music)']);
  expect(await titles({ format: 'vinyl' })).toEqual(['Rumours (music)']);
  expect(await titles({ place_id: room })).toEqual(['Dune (book)', 'Rumours (music)']); // the crate is in the study
  expect(await titles({ wanted: true })).toEqual(['Blue (music)']);
  expect(await shelf.formats('film')).toEqual(['VHS', 'DVD', 'Blu-ray', '4K UHD', 'LaserDisc', 'Betamax', 'Digital']);
  expect(await shelf.formats('music')).toContain('Vinyl');

  // Getting a copy of something wanted answers the wanting.
  expect((await shelf.addCopy(wish.id, { format: 'CD' })).wanted).toBe(false);
  // Removing a place leaves the copy, with no place.
  await things.deletePlace(box);
  expect((await shelf.list({ format: 'Vinyl' }))[0]!.formats).toEqual(['Vinyl']);
});

it('what was watched while working is kept with the session, and shows from both sides', async () => {
  const alien = await shelf.create({ type: 'film', title: 'Alien' }, { format: 'VHS' });
  const rumours = await shelf.create({ type: 'music', title: 'Rumours' }, { format: 'Vinyl' });
  let dress = await making.createProject({ name: 'Shirt dress', activity: 'Sewing' });
  dress = await making.addSession(dress.id, { day: MONDAY, minutes: 120, note: 'Cut out', media_ids: [alien.id, rumours.id, alien.id] });
  expect(dress.sessions[0]!.media).toEqual([{ id: alien.id, title: 'Alien', type: 'film' }, { id: rumours.id, title: 'Rumours', type: 'music' }]);

  let seen = await shelf.log(alien.id, { day: '2046-03-01', note: 'with the lights off' }); // and once on its own
  expect([seen.times, seen.last_on]).toEqual([2, MONDAY]);
  expect(seen.log.map((l) => [l.day, l.project, l.note])).toEqual([[MONDAY, 'Shirt dress', null], ['2046-03-01', null, 'with the lights off']]);

  // Removing the session keeps the day it was watched; removing a log line takes only that line.
  await making.deleteSession(dress.sessions[0]!.id);
  seen = await shelf.get(alien.id);
  expect(seen.log.map((l) => [l.day, l.project])).toEqual([[MONDAY, null], ['2046-03-01', null]]);
  await shelf.removeLog(seen.log[0]!.id);
  expect((await shelf.get(alien.id)).times).toBe(1);

  await expect(making.addSession(dress.id, { day: MONDAY, media_ids: [9999] })).rejects.toEqual(problem(404));
  expect((await making.getProject(dress.id)).sessions).toEqual([]); // the refused session left nothing behind
  await expect(shelf.log(alien.id, { day: MONDAY, session_id: 9999 })).rejects.toEqual(problem(404));
  await expect(shelf.log(alien.id, { day: 'yesterday' })).rejects.toEqual(problem(400));
});

// ---------- the calendar ----------

it('the calendar gathers each section\'s days, and links back to where they live', async () => {
  const cooking = kitchen(db, owner, clock);
  const soup = await cooking.createRecipe({ title: 'Soup', ingredients_text: '1 onion' });
  await cooking.addPlan({ day: MONDAY, meal: 'dinner', recipe_id: soup.id });
  await cooking.addPlan({ day: MONDAY, meal: 'breakfast', title: 'Porridge' });
  await cooking.savePantry({ name: 'Cream', quantity: 1, expires_on: '2046-03-07' });
  const alien = await shelf.create({ type: 'film', title: 'Alien' });
  const dress = await making.createProject({ name: 'Shirt dress', status: 'active', due_on: '2046-03-09' });
  await making.addSession(dress.id, { day: '2046-03-06', minutes: 90, note: 'Cut out', media_ids: [alien.id] });
  await making.createProject({ name: 'Finished thing', status: 'done', due_on: '2046-03-06' }); // done: no longer wanted by a day
  await dates.createEvent({ title: 'Dentist', day: MONDAY, time: '14:30', note: 'bring the form' });
  await dates.createEvent({ title: 'School play', day: MONDAY, time: '09:00' });
  const trip = await dates.createEvent({ title: 'At the coast', day: '2046-03-08', end_day: '2046-03-10' });
  await dates.createEvent({ title: 'Next week', day: '2046-03-12' });

  const week = await dates.between(MONDAY, 7);
  expect(week.map((e) => `${e.day.slice(8)} ${e.time ?? '--:--'} ${e.kind}: ${e.title}${e.detail ? ` (${e.detail})` : ''}`)).toEqual([
    '05 09:00 event: School play',
    '05 14:30 event: Dentist (bring the form)',
    '05 --:-- meal: Porridge (breakfast)',
    '05 --:-- meal: Soup (dinner)',
    '06 --:-- session: Shirt dress (1 h 30 min · Cut out)',
    '06 --:-- media: Alien (while working on Shirt dress)',
    '07 --:-- use_by: Cream (use by today)',
    '08 --:-- event: At the coast',
    '09 --:-- event: At the coast',
    '09 --:-- due: Shirt dress (wanted by today)',
    '10 --:-- event: At the coast',
  ]);
  expect(week.filter((e) => e.kind !== 'event').map((e) => e.link)).toEqual([
    '/week', `/recipes/${soup.id}`, `/projects/${dress.id}`, `/media/${alien.id}`, '/pantry', `/projects/${dress.id}`]);
  // A window that starts in the middle of the trip still shows it.
  expect((await dates.between('2046-03-10', 3)).map((e) => e.title)).toEqual(['At the coast', 'Next week']);

  const moved = await dates.updateEvent(trip.id, { title: 'At the coast', day: '2046-03-08' });
  expect(moved.end_day).toBeNull();
  await dates.deleteEvent(trip.id);
  await expect(dates.getEvent(trip.id)).rejects.toEqual(problem(404));
  await expect(dates.createEvent({ title: ' ', day: MONDAY })).rejects.toEqual(problem(400));
  await expect(dates.createEvent({ title: 'x', day: MONDAY, time: '7pm' })).rejects.toEqual(problem(400));
  await expect(dates.createEvent({ title: 'x', day: MONDAY, end_day: '2046-03-01' })).rejects.toEqual(problem(400));
  await expect(dates.between(MONDAY, 100)).rejects.toEqual(problem(400));
});

it('each person has their own collection and calendar', async () => {
  const alien = await shelf.create({ type: 'film', title: 'Alien' }, { format: 'VHS' });
  const seen = await shelf.log(alien.id, { day: MONDAY });
  const dentist = await dates.createEvent({ title: 'Dentist', day: MONDAY });
  const other = await person('other');
  const theirs = media(db, other, clock);
  const theirDates = calendar(db, other, clock);
  expect([await theirs.list(), await theirDates.between(MONDAY, 7)]).toEqual([[], []]);
  await expect(theirs.get(alien.id)).rejects.toEqual(problem(404));
  await expect(theirs.update(alien.id, { type: 'film', title: 'Mine' })).rejects.toEqual(problem(404));
  await expect(theirs.addCopy(alien.id, { format: 'DVD' })).rejects.toEqual(problem(404));
  await expect(theirs.updateCopy(alien.copies[0]!.id, { format: 'DVD' })).rejects.toEqual(problem(404));
  await expect(theirs.removeCopy(alien.copies[0]!.id)).rejects.toEqual(problem(404));
  await expect(theirs.log(alien.id, { day: MONDAY })).rejects.toEqual(problem(404));
  await expect(theirDates.updateEvent(dentist.id, { title: 'Mine', day: MONDAY })).rejects.toEqual(problem(404));
  const theirProject = await projects(db, other, clock).createProject({ name: 'Theirs' });
  await expect(projects(db, other, clock).addSession(theirProject.id, { day: MONDAY, media_ids: [alien.id] })).rejects.toEqual(problem(404));
  // Deleting by someone else's id does nothing.
  await theirs.remove(alien.id);
  await theirs.removeLog(seen.log[0]!.id);
  await theirDates.deleteEvent(dentist.id);
  expect([(await shelf.get(alien.id)).times, (await dates.between(MONDAY, 1)).map((e) => e.title)]).toEqual([1, ['Dentist', 'Alien']]);
});

it('a scanned barcode finds the copy it is on, whichever form the scanner reports', async () => {
  const alien = await shelf.create({ type: 'film', title: 'Alien', year: 1979 }, { format: 'Blu-ray', barcode: '0 24543-21346 5' }); // typed as printed, 12 digits
  await shelf.addCopy(alien.id, { format: 'VHS' }); // no barcode: never matches
  const dune = await shelf.create({ type: 'book', title: 'Dune' }, { format: 'Paperback', barcode: '9780441172719' });
  const found = { id: alien.id, title: 'Alien', type: 'film', year: 1979, format: 'Blu-ray' };
  expect(await shelf.findBarcode('024543213465')).toEqual([found]);
  expect(await shelf.findBarcode('0024543213465')).toEqual([found]); // the same code as 13 digits
  expect((await shelf.findBarcode(' 978-0441172719 ')).map((m) => m.id)).toEqual([dune.id]);
  expect(await shelf.findBarcode('4006381333931')).toEqual([]);
  await expect(shelf.findBarcode('  ')).rejects.toEqual(problem(400));
  expect(await media(db, await person('other'), clock).findBarcode('9780441172719')).toEqual([]); // someone else's shelf
});

// ---------- how many discs or tapes ----------

it('a copy says how many discs it is, and the number is kept, changed and cleared', async () => {
  const book = await shelf.create({ type: 'book', title: 'Dune', creator: 'Frank Herbert' }, { format: 'Book on CD', pieces: 12 });
  expect(book.copies[0]!.pieces).toBe(12);
  expect(book.pieces).toEqual({ 'Book on CD': 12 });
  // Left out: unchanged. Sent as empty: cleared.
  let after = await shelf.updateCopy(book.copies[0]!.id, { format: 'Book on CD', note: 'in the car' });
  expect(after.copies[0]!.pieces).toBe(12);
  after = await shelf.updateCopy(book.copies[0]!.id, { format: 'Book on CD', pieces: 13 });
  expect(after.copies[0]!.pieces).toBe(13);
  after = await shelf.updateCopy(book.copies[0]!.id, { format: 'Book on CD', pieces: null });
  expect(after.copies[0]!.pieces).toBeNull();
  expect(after.pieces).toEqual({});
  // A copy added with no number has none; the list shows the most when two copies are one format.
  after = await shelf.addCopy(book.id, { format: 'Book on CD' });
  expect(after.copies[1]!.pieces).toBeNull();
  await shelf.updateCopy(after.copies[0]!.id, { format: 'book on cd', pieces: 8 });
  await shelf.updateCopy(after.copies[1]!.id, { format: 'Book on CD', pieces: 10 });
  expect((await shelf.list({ type: 'book' }))[0]!.pieces).toEqual({ 'book on cd': 10 }); // under the spelling the formats list shows
});

it('a number of pieces is a whole number from 1 to 999, and a bad one saves nothing', async () => {
  const film = await shelf.create({ type: 'film', title: 'Alien' }, { format: 'DVD', pieces: 2 });
  for (const bad of [0, -1, 1000, 2.5, Number.NaN]) {
    await expect(shelf.addCopy(film.id, { format: 'Blu-ray', pieces: bad })).rejects.toEqual(problem(400));
    await expect(shelf.updateCopy(film.copies[0]!.id, { format: 'DVD', note: 'changed', pieces: bad })).rejects.toEqual(problem(400));
  }
  const after = await shelf.get(film.id);
  expect(after.copies).toHaveLength(1);
  expect(after.copies[0]!.note).toBeNull();
  expect(after.copies[0]!.pieces).toBe(2);
  expect((await shelf.addCopy(film.id, { format: 'Blu-ray', pieces: 999 })).copies[1]!.pieces).toBe(999);
});

it('copies that were there before, and copies brought in, have no number and keep working', async () => {
  const film = await shelf.create({ type: 'film', title: 'Heat' }, { format: 'VHS' });
  await db.run("UPDATE media_copies SET pieces = NULL");
  const got = await shelf.get(film.id);
  expect(got.copies[0]!.pieces).toBeNull();
  expect(got.pieces).toEqual({});
  const moved = await shelf.updateCopy(got.copies[0]!.id, { format: 'VHS', note: 'taped off TV' });
  expect(moved.copies[0]!.pieces).toBeNull();
});

it('the word for the pieces comes from the format, and one piece is not shown', () => {
  const words = (format: string) => piecesWord(format).many;
  for (const f of ['CD', 'cd', 'Book on CD', 'DVD', 'Blu-ray', 'Bluray', '4K UHD', 'LaserDisc', 'Disc', 'Audio CD']) expect(words(f), f).toBe('discs');
  for (const f of ['Tape', 'Book on tape', 'Cassette', 'VHS', 'Betamax', '8-track', '8 track']) expect(words(f), f).toBe('tapes');
  for (const f of ['Vinyl', 'LP', 'Record', '12" vinyl']) expect(words(f), f).toBe('records');
  for (const f of ['Hardcover', 'Digital', 'Cartridge', 'MiniDisc', '', 'Cdrom drive']) expect(piecesWord(f), f).toMatchObject({ many: 'pieces', known: false });
  expect(piecesWord('CD').known).toBe(true);
  expect(piecesWord('Book on tape').one).toBe('tape');
  expect(piecesWord(null).many).toBe('pieces');
  expect(piecesText('Book on CD', 12)).toBe('12 discs');
  expect(piecesText('Vinyl', 2)).toBe('2 records');
  expect(piecesText('Hardcover', 3)).toBe('3 pieces');
  expect(piecesText('CD', 1)).toBeNull();
  expect(piecesText('CD', null)).toBeNull();
});

// ---------- sorting, prices and worth, duplicates ----------

it('titles are put in order ignoring a leading The, A or An, without changing what is shown', async () => {
  expect(sortWords('The Thing')).toBe('thing');
  expect(sortWords('An American Werewolf')).toBe('american werewolf');
  expect(sortWords('A Clockwork Orange')).toBe('clockwork orange');
  expect(sortWords('Theater of Blood')).toBe('theater of blood'); // not an article: "The" must be a word
  expect(sortWords('The')).toBe('the');                          // nothing left to sort by: kept
  expect(sortWords('Anna Karenina')).toBe('anna karenina');
  await shelf.create({ type: 'film', title: 'The Thing', creator: 'John Carpenter', year: 1982, minutes: 109 });
  await shelf.create({ type: 'film', title: 'Alien', creator: 'Ridley Scott', year: 1979 });
  await shelf.create({ type: 'film', title: 'A Clockwork Orange', creator: 'The Kubrick Estate', year: 1971 });
  await shelf.create({ type: 'film', title: 'Zodiac', year: null });
  const all = await shelf.list();
  const before = all.map((m) => m.id);
  expect(sortTitles(all, 'title').map((m) => m.title)).toEqual(['Alien', 'A Clockwork Orange', 'The Thing', 'Zodiac']);
  // Creators sort the same way, and a title with no creator comes last.
  expect(sortTitles(all, 'creator').map((m) => m.title)).toEqual(['The Thing', 'A Clockwork Orange', 'Alien', 'Zodiac']);
  // Newest year first, and no year last.
  expect(sortTitles(all, 'year').map((m) => m.title)).toEqual(['The Thing', 'Alien', 'A Clockwork Orange', 'Zodiac']);
  expect(all.map((m) => m.id)).toEqual(before); // the list given was not rearranged, and the titles shown are as they were typed
  expect(all.map((m) => m.title)).toContain('The Thing');
});

it('recently added and recently watched sort from what the list carries', async () => {
  let second = 0;
  const early = media(db, owner, () => new Date(2046, 2, 1, 8, 0, second++)); // each call a second later than the last
  const a = await early.create({ type: 'film', title: 'Alpha' });
  const b = await early.create({ type: 'film', title: 'Bravo' });
  const c = await early.create({ type: 'film', title: 'Charlie' });
  await shelf.log(a.id, { day: '2046-01-05' });
  await shelf.log(c.id, { day: '2046-02-05' });
  await shelf.log(c.id, { day: '2046-01-01' });
  const all = await shelf.list();
  expect(sortTitles(all, 'added').map((m) => m.title)).toEqual(['Charlie', 'Bravo', 'Alpha']);
  // Last watched: Charlie (Feb), Alpha (Jan), Bravo never, so last.
  expect(sortTitles(all, 'recent').map((m) => m.title)).toEqual(['Charlie', 'Alpha', 'Bravo']);
  expect(b.id).toBeGreaterThan(a.id);
});

it('a copy keeps what it cost and what it is worth, in cents, and a title adds up its copies', async () => {
  const film = await shelf.create({ type: 'film', title: 'Alien', year: 1979 }, { format: 'VHS', cost_cents: 1299, bought_on: '1999-05-01' });
  expect(film.copies[0]).toMatchObject({ cost_cents: 1299, bought_on: '1999-05-01', value_cents: null, valued_on: null });
  expect(film).toMatchObject({ copy_count: 1, cost_cents: 1299, worth_cents: 1299, unvalued: 0, gain_cents: 0 }); // no value typed: worth is what it cost
  // A worth with no day is noted today; it replaces the cost in the worth.
  let after = await shelf.updateCopy(film.copies[0]!.id, { format: 'VHS', value_cents: 4000 });
  expect(after.copies[0]).toMatchObject({ cost_cents: 1299, value_cents: 4000, valued_on: '2046-03-05' }); // cost left out: unchanged
  after = await shelf.addCopy(film.id, { format: 'Blu-ray', value_cents: 2000, valued_on: '2045-01-01' });
  expect(after).toMatchObject({ copy_count: 2, cost_cents: 1299, worth_cents: 6000, unvalued: 0, gain_cents: 2701 });
  after = await shelf.addCopy(film.id, { format: 'DVD' });
  expect(after).toMatchObject({ copy_count: 3, cost_cents: 1299, worth_cents: 6000, unvalued: 1 });
  // Taking the worth off takes its day off too.
  after = await shelf.updateCopy(after.copies[1]!.id, { format: 'Blu-ray', value_cents: null });
  expect(after.copies[1]).toMatchObject({ value_cents: null, valued_on: null });
  // Refused: not a whole number of cents, below nothing, or a day that isn't one.
  await expect(shelf.updateCopy(film.copies[0]!.id, { format: 'VHS', cost_cents: -5 })).rejects.toEqual(problem(400));
  await expect(shelf.updateCopy(film.copies[0]!.id, { format: 'VHS', value_cents: 1.5 })).rejects.toEqual(problem(400));
  await expect(shelf.updateCopy(film.copies[0]!.id, { format: 'VHS', bought_on: 'last spring' })).rejects.toEqual(problem(400));
  await expect(shelf.addCopy(film.id, { format: 'LaserDisc', cost_cents: 10 ** 12 })).rejects.toEqual(problem(400));
  expect((await shelf.get(film.id)).copies).toHaveLength(3); // the refused one left nothing behind
});

it('totals use the value, else the cost, and count the copies with neither', async () => {
  await shelf.create({ type: 'film', title: 'Alien' }, { format: 'VHS', cost_cents: 1000, value_cents: 2500 });   // worth 2500, gained 1500
  await shelf.create({ type: 'music', title: 'Rumours' }, { format: 'Vinyl', cost_cents: 800 });                // worth 800 (its cost), gained 0
  await shelf.create({ type: 'book', title: 'Dune' }, { format: 'Paperback', value_cents: 300 });               // worth 300, no cost: no gain counted
  await shelf.create({ type: 'game', title: 'Chess' }, { format: 'Board game' });                               // nothing typed
  await shelf.create({ type: 'book', title: 'Emma' });                                                          // wanted-style title: no copy at all
  const all = await shelf.list();
  expect(collectionTotals(all)).toEqual({ titles: 5, copies: 4, cost_cents: 1800, worth_cents: 3600, unvalued: 1, difference_cents: 1500 });
  expect(collectionTotals(all.filter((m) => m.type === 'book'))).toEqual({ titles: 2, copies: 1, cost_cents: 0, worth_cents: 300, unvalued: 0, difference_cents: 0 });
  expect(collectionTotals([])).toEqual({ titles: 0, copies: 0, cost_cents: 0, worth_cents: 0, unvalued: 0, difference_cents: 0 });
  // Value sorts the highest first; the ones with nothing come last.
  expect(sortTitles(all, 'value').map((m) => m.title)).toEqual(['Alien', 'Rumours', 'Dune', 'Chess', 'Emma']);
});

it('dollars are read as cents and shown with two decimals', () => {
  expect([centsFromDollars('12.99'), centsFromDollars('$1,200'), centsFromDollars('5'), centsFromDollars('0.5'), centsFromDollars(' 7.10 ')]).toEqual([1299, 120000, 500, 50, 710]);
  for (const bad of ['', 'abc', '1.234', '-3', '12.', '1e3', '$', '99999999999']) expect(centsFromDollars(bad), bad).toBeNull();
  expect([dollarsText(1299), dollarsText(5), dollarsText(123456789), dollarsText(0), dollarsText(-250)]).toEqual(['$12.99', '$0.05', '$1,234,567.89', '$0.00', '-$2.50']);
});

it('a typed name matches a title of the same kind you already have, the way names are compared elsewhere', async () => {
  await shelf.create({ type: 'film', title: 'Alien', year: 1979 }, { format: 'VHS' });
  await shelf.create({ type: 'film', title: 'Alien', year: 2026 });
  await shelf.create({ type: 'book', title: 'Alien' });
  const all = await shelf.list();
  expect(sameTitles(all, 'film', ' alien ').map((m) => m.year).sort()).toEqual([1979, 2026]);
  expect(sameTitles(all, 'film', 'ALIEN').length).toBe(2);
  expect(sameTitles(all, 'music', 'Alien')).toEqual([]);
  expect(sameTitles(all, 'film', 'Aliens')).toEqual([]);
  expect(sameTitles(all, 'film', '   ')).toEqual([]);
});

it('the page keeps copies of these rules that give the same answers', async () => {
  // Pages cannot import from core, so frontend/src/components/collectionTools.js repeats them; this holds the two together.
  const url = new URL('../../frontend/src/components/collectionTools.js', import.meta.url).href;
  const page = (await import(/* @vite-ignore */ url)) as Record<string, (...args: unknown[]) => unknown>;
  for (const t of ['The Thing', 'A Clockwork Orange', 'An Affair', 'Theater', 'The', 'Än Ünicode', '  the   spaced ']) expect(page.sortWords!(t), t).toBe(sortWords(t));
  for (const d of ['12.99', '$1,200', '1.234', '', '7', '-1', '0.5']) expect(page.centsFromDollars!(d), d).toBe(centsFromDollars(d));
  for (const c of [0, 5, 1299, 123456789, -250]) expect(page.dollarsText!(c), String(c)).toBe(dollarsText(c));
  await shelf.create({ type: 'film', title: 'The Thing', year: 1982 }, { format: 'VHS', cost_cents: 500, value_cents: 900 });
  await shelf.create({ type: 'film', title: 'Alien', year: 1979 }, { format: 'VHS', cost_cents: 700 });
  await shelf.create({ type: 'film', title: 'Zodiac' });
  const all = await shelf.list();
  for (const how of ['title', 'creator', 'year', 'added', 'recent', 'value'] as const) {
    expect((page.sortTitles!(all, how) as { id: number }[]).map((m) => m.id), how).toEqual(sortTitles(all, how).map((m) => m.id));
  }
  expect(page.collectionTotals!(all)).toEqual(collectionTotals(all));
  expect((page.sameTitles!(all, 'film', ' the thing ') as unknown[]).length).toBe(sameTitles(all, 'film', ' the thing ').length);
});
