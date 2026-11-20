/** Plans: made ahead or written afterwards, pointing at everything else, and kept to look back on. */
import { beforeEach, expect, it } from 'vitest';
import { calendar } from '../src/calendar.ts';
import type { Db } from '../src/db.ts';
import { inventory } from '../src/inventory.ts';
import { kitchen } from '../src/kitchen.ts';
import { media } from '../src/media.ts';
import { migrate } from '../src/migrations.ts';
import { pictureType, plans, type Plans } from '../src/plans.ts';
import { projects } from '../src/projects.ts';
import { memoryDb } from './memoryDb.ts';

let db: Db;
let owner: number;
let mine: Plans;
let time: Date;
const clock = () => time;
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

async function person(name: string): Promise<number> {
  return (await db.run("INSERT INTO users (username, password_hash, created_at) VALUES (?, 'x', 'now')", [name])).lastId;
}

beforeEach(async () => {
  db = memoryDb();
  await migrate(db);
  owner = await person('owner');
  time = new Date(2046, 2, 5, 10, 0, 0); // Monday 5 March
  mine = plans(db, owner, clock);
});

const problem = (status: number) => expect.objectContaining({ name: 'Problem', status });

it('a holiday gathers its food, dishes, films and jobs, and says what it is short of', async () => {
  const k = kitchen(db, owner, clock);
  const things = inventory(db, owner, clock);
  const dishes = (await things.addStarter('cookware')).find((kind) => kind.name === 'Baking dishes')!;
  await things.createPlace({ name: 'Kitchen' });
  const dish = await things.createItem({ kind_id: dishes.id, name: '8x8 baking dish', quantity: 2, place_id: (await things.listPlaces())[0]!.id });
  const stuffing = await k.createRecipe({ title: 'Stuffing', ingredients_text: '1 loaf bread' });
  const film = await media(db, owner, clock).create({ type: 'film', title: 'Home for the Holidays' }, { format: 'VHS' });

  const made = await mine.create({ name: 'Thanksgiving', start_day: '2046-11-22', note: 'Twelve of us this year' });
  expect([made.when, made.end_day, made.items_list, made.happened]).toEqual(['ahead', '2046-11-22', [], []]);
  await mine.addItem(made.id, { kind: 'recipe', ref_id: stuffing.id });
  await mine.addItem(made.id, { kind: 'thing', ref_id: dish.id, quantity: 4 });
  await mine.addItem(made.id, { kind: 'media', ref_id: film.id });
  let plan = await mine.addItem(made.id, { kind: 'task', label: 'Order the turkey' });

  expect(plan.items_list.map((i) => [i.kind, i.label, i.link, i.short, i.detail])).toEqual([
    ['recipe', 'Stuffing', `/recipes/${stuffing.id}`, null, null],
    ['thing', '8x8 baking dish', '/things', 'needs 4, and you have 2', 'Kitchen'],
    ['media', 'Home for the Holidays', `/media/${film.id}`, null, 'VHS'],
    ['task', 'Order the turkey', null, null, null],
  ]);
  expect([plan.items, plan.tasks_left]).toEqual([4, 1]);
  await expect(mine.addItem(made.id, { kind: 'recipe', ref_id: stuffing.id })).rejects.toEqual(problem(409)); // already part of it
  await expect(mine.addItem(made.id, { kind: 'recipe', ref_id: 999 })).rejects.toEqual(problem(404));
  await expect(mine.addItem(made.id, { kind: 'spell', label: 'x' })).rejects.toEqual(problem(400));
  await expect(mine.addItem(made.id, { kind: 'task', label: ' ' })).rejects.toEqual(problem(400));

  // Buying two more dishes clears the shortage; ticking the task leaves none to do.
  await things.updateItem(dish.id, { name: '8x8 baking dish', quantity: 4 });
  const task = plan.items_list[3]!;
  plan = await mine.updateItem(task.id, { done: true });
  expect([plan.items_list[1]!.short, plan.items_list[3]!.done, plan.tasks_left]).toEqual([null, true, 0]);
  plan = await mine.updateItem(task.id, { label: 'Collect the turkey' });
  expect([plan.items_list[3]!.label, plan.items_list[3]!.done]).toEqual(['Collect the turkey', true]);

  // Things are renamed and removed elsewhere; the plan follows, and keeps the name of what has gone.
  await k.updateRecipe(stuffing.id, { title: 'Sage stuffing', ingredients_text: '1 loaf bread' });
  await things.deleteItem(dish.id);
  plan = await mine.get(made.id);
  expect(plan.items_list.slice(0, 2).map((i) => [i.label, i.link, i.short])).toEqual([['Sage stuffing', `/recipes/${stuffing.id}`, null], ['8x8 baking dish', null, "it's no longer among your things"]]);

  plan = await mine.removeItem(plan.items_list[1]!.id);
  expect(plan.items_list.map((i) => i.kind)).toEqual(['recipe', 'media', 'task']);

  // It shows on the calendar on its day, and leads to its page.
  expect((await calendar(db, owner, clock).between('2046-11-22', 1)).map((e) => [e.kind, e.title, e.link])).toEqual([['plan', 'Thanksgiving', `/plans/${made.id}`]]);
});

it('a sewing afternoon can be written down afterwards, and remembers what happened on its day', async () => {
  const making = projects(db, owner, clock);
  const shelf = media(db, owner, clock);
  const dress = await making.createProject({ name: 'Shirt dress', status: 'active' });
  const album = await shelf.create({ type: 'music', title: 'Blue' });
  await making.addSession(dress.id, { day: '2046-03-03', minutes: 120, media_ids: [album.id] });
  await kitchen(db, owner, clock).addPlan({ day: '2046-03-03', meal: 'lunch', title: 'Soup' });
  await calendar(db, owner, clock).createEvent({ title: 'Dentist', day: '2046-03-03' }); // not part of a memory

  const memory = await mine.create({ name: 'Saturday sewing', start_day: '2046-03-03', story: 'Finished the collar at last.' });
  await mine.addItem(memory.id, { kind: 'project', ref_id: dress.id });
  const plan = await mine.get(memory.id);
  expect([plan.when, plan.story, plan.items_list[0]!.link]).toEqual(['past', 'Finished the collar at last.', `/projects/${dress.id}`]);
  expect(plan.happened.map((e) => `${e.kind}: ${e.title}${e.detail ? ` (${e.detail})` : ''}`)).toEqual(['meal: Soup (lunch)', 'session: Shirt dress (2 h)', 'media: Blue (while working on Shirt dress)']);

  // One under way shows only the days so far; one ahead shows nothing yet.
  const week = await mine.create({ name: 'Spring clean', start_day: '2046-03-03', end_day: '2046-03-09' });
  expect([week.when, week.happened.length]).toEqual(['now', 3]);
  await kitchen(db, owner, clock).addPlan({ day: '2046-03-08', meal: 'dinner', title: 'Later' });
  expect((await mine.get(week.id)).happened.length).toBe(3);

  expect((await mine.list()).map((p) => [p.name, p.when])).toEqual([['Spring clean', 'now'], ['Saturday sewing', 'past']]);
});

it('next year starts from last year: the same things on new days, the checklist unticked, the memories left behind', async () => {
  const k = kitchen(db, owner, clock);
  const pie = await k.createRecipe({ title: 'Pumpkin pie', ingredients_text: '1 pumpkin' });
  const last = await mine.create({ name: 'Thanksgiving 2045', start_day: '2045-11-23', end_day: '2045-11-24', note: 'At ours', story: 'The pie was the best yet.' });
  await mine.addItem(last.id, { kind: 'recipe', ref_id: pie.id });
  const withTask = await mine.addItem(last.id, { kind: 'task', label: 'Order the turkey' });
  await mine.updateItem(withTask.items_list[1]!.id, { done: true });
  await mine.keepPhoto(last.id, JPEG, 'The table');

  const next = await mine.copy(last.id, { name: 'Thanksgiving 2046', start_day: '2046-11-22' });
  expect([next.name, next.start_day, next.end_day, next.note, next.story, next.photos]).toEqual(['Thanksgiving 2046', '2046-11-22', '2046-11-23', 'At ours', null, 0]);
  expect(next.items_list.map((i) => [i.kind, i.label, i.done])).toEqual([['recipe', 'Pumpkin pie', false], ['task', 'Order the turkey', false]]);
  const old = await mine.get(last.id);
  expect([old.story, old.photos, old.items_list[1]!.done]).toEqual(['The pie was the best yet.', 1, true]); // untouched
});

it('photos are kept or linked, and go with the plan', async () => {
  const plan = await mine.create({ name: 'Birthday', start_day: '2046-03-01' });
  let now = await mine.keepPhoto(plan.id, JPEG, ' The cake ');
  now = await mine.linkPhoto(plan.id, 'immich', '3fa85f64-5717-4562-b3fc-2c963f66afa6');
  now = await mine.linkPhoto(plan.id, 'immich', '3fa85f64-5717-4562-b3fc-2c963f66afa6'); // the same one twice is once
  expect(now.photos_list.map((p) => [p.source, p.caption])).toEqual([['kept', 'The cake'], ['immich', null]]);
  expect([now.photos, now.cover_photo]).toEqual([2, now.photos_list[0]!.id]);

  expect(await mine.photo(now.photos_list[0]!.id)).toEqual({ source: 'kept', type: 'image/jpeg', bytes: JPEG });
  expect(await mine.photo(now.photos_list[1]!.id)).toEqual({ source: 'immich', asset_id: '3fa85f64-5717-4562-b3fc-2c963f66afa6' });
  expect((await mine.captionPhoto(now.photos_list[1]!.id, 'Everyone')).photos_list[1]!.caption).toBe('Everyone');

  await expect(mine.keepPhoto(plan.id, new Uint8Array([1, 2, 3]))).rejects.toEqual(problem(400)); // not a picture
  await expect(mine.keepPhoto(plan.id, new Uint8Array([0x3c, 0x73, 0x76, 0x67]))).rejects.toEqual(problem(400)); // an SVG is never kept
  await expect(mine.linkPhoto(plan.id, 'immich', '../etc/passwd')).rejects.toEqual(problem(400));
  expect([pictureType(new Uint8Array([0x89, 0x50, 0x4e, 0x47])), pictureType(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]))]).toEqual(['image/png', 'image/webp']);

  expect((await mine.removePhoto(now.photos_list[0]!.id)).photos_list.map((p) => p.source)).toEqual(['immich']);
  await mine.remove(plan.id);
  expect((await db.get<{ n: number }>('SELECT COUNT(*) AS n FROM plan_photos'))!.n).toBe(0);
});

it('a plan has sensible days, and is only its owner\'s', async () => {
  await expect(mine.create({ name: ' ', start_day: '2046-03-05' })).rejects.toEqual(problem(400));
  await expect(mine.create({ name: 'Backwards', start_day: '2046-03-05', end_day: '2046-03-04' })).rejects.toEqual(problem(400));
  await expect(mine.create({ name: 'Forever', start_day: '2046-03-05', end_day: '2046-06-05' })).rejects.toEqual(problem(400));
  const trip = await mine.create({ name: 'Trip', start_day: '2046-03-05', end_day: '2046-03-07' });
  expect((await calendar(db, owner, clock).between('2046-03-06', 2)).map((e) => [e.day, e.title, e.detail])).toEqual([['2046-03-06', 'Trip', 'day 2 of 3'], ['2046-03-07', 'Trip', 'day 3 of 3']]);
  expect((await mine.update(trip.id, { name: 'Long weekend', start_day: '2046-03-06' })).end_day).toBe('2046-03-06');

  const theirs = plans(db, await person('other'), clock);
  expect(await theirs.list()).toEqual([]);
  await expect(theirs.get(trip.id)).rejects.toEqual(problem(404));
  await expect(theirs.addItem(trip.id, { kind: 'task', label: 'Snoop' })).rejects.toEqual(problem(404));
  await expect(theirs.keepPhoto(trip.id, JPEG)).rejects.toEqual(problem(404));
  await theirs.remove(trip.id);
  expect(await mine.list()).toHaveLength(1);
});
