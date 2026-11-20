/** The collection (films, shows, music, books, games) and the calendar that gathers every section's days. */
import { beforeEach, expect, it } from 'vitest';
import { calendar, type Calendar } from '../src/calendar.ts';
import type { Db } from '../src/db.ts';
import { inventory, type Inventory } from '../src/inventory.ts';
import { kitchen } from '../src/kitchen.ts';
import { media, type MediaCollection } from '../src/media.ts';
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
