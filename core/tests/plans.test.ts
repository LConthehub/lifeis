/** Plans: made ahead or written afterwards, pointing at everything else, and kept to look back on. */
import { beforeEach, expect, it } from 'vitest';
import { calendar } from '../src/calendar.ts';
import type { Db } from '../src/db.ts';
import { holidays } from '../src/holidays.ts';
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

it("a plan's food goes on the week's meals, moves with the plan, and leaves with it", async () => {
  const k = kitchen(db, owner, clock);
  const things = inventory(db, owner, clock);
  const dishes = (await things.addStarter('cookware')).find((kind) => kind.name === 'Baking dishes')!;
  const dish = await things.createItem({ kind_id: dishes.id, name: '8x8 baking dish', quantity: 2 });
  const stuffing = await k.createRecipe({ title: 'Stuffing', ingredients_text: '1 loaf bread', equipment: [{ item_id: dish.id, quantity: 2 }] });
  const brownies = await k.createRecipe({ title: 'Brownies', ingredients_text: '200 g chocolate', equipment: [{ item_id: dish.id, quantity: 2 }] });
  const pie = await k.createRecipe({ title: 'Pumpkin pie', ingredients_text: '1 pumpkin' });
  const week = async (start: string, days: number) => (await k.listPlan(start, days)).map((m) => `${m.day} ${m.meal}: ${m.recipe_title}`);

  const plan = await mine.create({ name: 'Thanksgiving', start_day: '2046-03-08' });
  await mine.addItem(plan.id, { kind: 'recipe', ref_id: stuffing.id, day: '2046-03-08' }); // no meal said: dinner
  await mine.addItem(plan.id, { kind: 'recipe', ref_id: brownies.id, day: '2046-03-08', meal: 'dinner' });
  let now = await mine.addItem(plan.id, { kind: 'recipe', ref_id: pie.id, day: '2046-03-07', meal: 'snack' }); // made the day before
  expect(now.items_list.map((i) => [i.label, i.on_week])).toEqual([
    ['Stuffing', { day: '2046-03-08', meal: 'dinner', cooked: false, servings: null }], ['Brownies', { day: '2046-03-08', meal: 'dinner', cooked: false, servings: null }], ['Pumpkin pie', { day: '2046-03-07', meal: 'snack', cooked: false, servings: null }]]);
  expect(await week('2046-03-05', 7)).toEqual(['2046-03-07 snack: Pumpkin pie', '2046-03-08 dinner: Stuffing', '2046-03-08 dinner: Brownies']);
  // So everything the week already does follows: the grocery list, and the dishes that one dinner needs.
  expect((await k.groceryFromPlan('2046-03-05', 7)).items.map((g) => g.label.toLowerCase()).sort()).toEqual(['chocolate', 'loaf bread', 'pumpkin']);
  expect((await k.equipmentCheck('2046-03-05', 7)).map((x) => [x.day, x.meal, x.label, x.need, x.have])).toEqual([['2046-03-08', 'dinner', '8x8 baking dish', 4, 2]]);

  await expect(mine.addItem(plan.id, { kind: 'recipe', ref_id: pie.id, day: '2046-03-08' })).rejects.toEqual(problem(409)); // already part of it
  const cake = await k.createRecipe({ title: 'Cake', ingredients_text: '1 egg' });
  await expect(mine.addItem(plan.id, { kind: 'recipe', ref_id: cake.id, day: '2046-03-09' })).rejects.toEqual(problem(400)); // after the plan
  await expect(mine.addItem(plan.id, { kind: 'recipe', ref_id: cake.id, day: '2046-02-20' })).rejects.toEqual(problem(400)); // long before it
  await expect(mine.addItem(plan.id, { kind: 'recipe', ref_id: cake.id, day: '2046-03-08', meal: 'elevenses' })).rejects.toEqual(problem(400));
  expect(await week('2046-02-01', 60)).toHaveLength(3); // nothing was left behind by the refusals

  // A recipe can be noted without a meal, put on the week later, moved, and taken off again.
  now = await mine.addItem(plan.id, { kind: 'recipe', ref_id: cake.id });
  const cakeItem = now.items_list[3]!;
  expect(cakeItem.on_week).toBeNull();
  expect((await mine.updateItem(cakeItem.id, { day: '2046-03-08', meal: 'lunch' })).items_list[3]!.on_week).toEqual({ day: '2046-03-08', meal: 'lunch', cooked: false, servings: null });
  expect((await mine.updateItem(cakeItem.id, { day: '2046-03-06', meal: 'snack' })).items_list[3]!.on_week).toEqual({ day: '2046-03-06', meal: 'snack', cooked: false, servings: null });
  expect(await week('2046-03-06', 1)).toEqual(['2046-03-06 snack: Cake']);
  expect((await mine.updateItem(cakeItem.id, { day: null })).items_list[3]!.on_week).toBeNull();
  expect(await week('2046-03-06', 1)).toEqual([]);
  expect((await mine.updateItem(cakeItem.id, { note: 'if there is time' })).items_list[3]!.on_week).toBeNull(); // other changes leave the week alone

  // The plan moves a week later: its meals move with it.
  now = await mine.update(plan.id, { name: 'Thanksgiving', start_day: '2046-03-15' });
  expect(now.items_list.slice(0, 3).map((i) => i.on_week!.day)).toEqual(['2046-03-15', '2046-03-15', '2046-03-14']);
  expect(await week('2046-03-05', 7)).toEqual([]);

  // Taking a meal off the week by hand only forgets the link; the recipe stays on the plan.
  const pieMeal = (await k.listPlan('2046-03-14', 1))[0]!;
  await k.deletePlan(pieMeal.id);
  expect((await mine.get(plan.id)).items_list[2]).toMatchObject({ label: 'Pumpkin pie', on_week: null });

  // Taking a recipe off the plan takes its meal off the week. One already cooked is history, and stays.
  const stuffingMeal = (await k.listPlan('2046-03-15', 1)).find((m) => m.recipe_title === 'Stuffing')!;
  time = new Date(2046, 2, 15, 18, 0, 0);
  await k.cooked(stuffingMeal.id);
  now = await mine.get(plan.id);
  expect(now.items_list[0]!.on_week).toEqual({ day: '2046-03-15', meal: 'dinner', cooked: true, servings: null });
  await expect(mine.updateItem(now.items_list[0]!.id, { day: '2046-03-14' })).rejects.toEqual(problem(409));
  await mine.removeItem(now.items_list[1]!.id); // Brownies, not cooked
  expect(await week('2046-03-15', 1)).toEqual(['2046-03-15 dinner: Stuffing']);

  // Next year starts from this one, food on the same days of the new week.
  const next = await mine.copy(plan.id, { name: 'Thanksgiving again', start_day: '2047-03-14' });
  expect(next.items_list.map((i) => [i.label, i.on_week])).toEqual([['Stuffing', { day: '2047-03-14', meal: 'dinner', cooked: false, servings: null }], ['Pumpkin pie', null], ['Cake', null]]);

  // Removing the plans removes what's still to be cooked, and leaves what was.
  await mine.remove(next.id);
  await mine.remove(plan.id);
  expect(await week('2046-01-01', 60)).toEqual([]);
  expect(await week('2046-03-01', 60)).toEqual(['2046-03-15 dinner: Stuffing']);
  expect(await week('2047-03-01', 60)).toEqual([]);

  // Only ever the owner's own recipes and week.
  const theirs = plans(db, await person('other'), clock);
  const theirPlan = await theirs.create({ name: 'Theirs', start_day: '2046-03-08' });
  await expect(theirs.addItem(theirPlan.id, { kind: 'recipe', ref_id: pie.id, day: '2046-03-08' })).rejects.toEqual(problem(404));
});

it('a plan says how many its food is for, and the grocery list follows', async () => {
  const k = kitchen(db, owner, clock);
  const stuffing = await k.createRecipe({ title: 'Stuffing', servings: 4, ingredients_text: '2 loaves bread' });
  const plan = await mine.create({ name: 'Thanksgiving', start_day: '2046-03-08' });
  let now = await mine.addItem(plan.id, { kind: 'recipe', ref_id: stuffing.id, day: '2046-03-08', servings: 12 }); // three times the recipe
  expect(now.items_list[0]!.on_week).toEqual({ day: '2046-03-08', meal: 'dinner', cooked: false, servings: 12 });
  expect((await k.listPlan('2046-03-08', 1)).map((m) => [m.recipe_title, m.servings])).toEqual([['Stuffing', 12]]);
  expect((await k.groceryFromPlan('2046-03-08', 1)).items.map((g) => [g.label.toLowerCase(), g.quantity])).toEqual([['loaves bread', 6]]);

  now = await mine.updateItem(now.items_list[0]!.id, { day: '2046-03-08', meal: 'dinner', servings: 8 });
  expect([now.items_list[0]!.on_week!.servings, (await k.listPlan('2046-03-08', 1))[0]!.servings]).toEqual([8, 8]);
  now = await mine.updateItem(now.items_list[0]!.id, { day: '2046-03-08', meal: 'dinner', servings: null }); // back to what the recipe says
  expect(now.items_list[0]!.on_week!.servings).toBeNull();
  await expect(mine.updateItem(now.items_list[0]!.id, { day: '2046-03-08', servings: 0 })).rejects.toEqual(problem(400));

  await mine.updateItem(now.items_list[0]!.id, { day: '2046-03-08', servings: 12 });
  expect((await mine.copy(plan.id, { start_day: '2047-03-14' })).items_list[0]!.on_week).toEqual({ day: '2047-03-14', meal: 'dinner', cooked: false, servings: 12 }); // next year, the same crowd
});

it('a plan uses the parts it needs: chosen when made, changed later, kept when taken off, and copied with it', async () => {
  const plain = await mine.create({ name: 'Sunday lunch', start_day: '2046-03-11' });
  expect(plain.parts).toEqual(['food', 'budget', 'tasks', 'bring']); // none chosen: the first few
  const trip = await mine.create({ name: 'Lake weekend', start_day: '2046-06-13', end_day: '2046-06-15', parts: ['bring', 'more_days', 'tasks', 'bring'] });
  expect(trip.parts).toEqual(['more_days', 'tasks', 'bring']); // each once, in the order they show
  expect((await mine.create({ name: 'Painting', start_day: '2046-03-05', end_day: '2046-03-06' })).parts).toEqual(['food', 'budget', 'more_days', 'tasks', 'bring']);
  await expect(mine.create({ name: 'Odd', start_day: '2046-03-11', parts: ['sailing'] })).rejects.toEqual(problem(400));
  // A starting point checks the parts for that kind of plan; More than one day goes by the days given.
  expect((await mine.create({ name: 'Hank turns nine', start_day: '2046-04-02', start: 'birthday' })).parts).toEqual(['food', 'guests', 'gifts', 'budget', 'tasks']);
  expect((await mine.create({ name: 'River camp', start_day: '2046-07-10', end_day: '2046-07-12', start: 'trip' })).parts).toEqual(['food', 'budget', 'more_days', 'bring', 'after_trip']);
  expect((await mine.create({ name: 'Day hike', start_day: '2046-07-20', start: 'trip' })).parts).toEqual(['food', 'budget', 'bring', 'after_trip']);
  expect((await mine.create({ name: 'Errands', start_day: '2046-07-21', start: 'other' })).parts).toEqual(['food', 'budget', 'tasks', 'bring']);
  await expect(mine.create({ name: 'Odd', start_day: '2046-03-11', start: 'cruise' })).rejects.toEqual(problem(400));

  const withTask = (await mine.addItem(plain.id, { kind: 'task', label: 'Set the table' }));
  expect(withTask.parts).toEqual(['food', 'budget', 'tasks', 'bring']);
  const changed = await mine.setParts(plain.id, ['food', 'budget']);
  expect(changed.parts).toEqual(['food', 'budget']);
  expect(changed.items_list.map((i) => i.label)).toEqual(['Set the table']); // kept, only not shown
  expect((await mine.copy(plain.id, { start_day: '2046-03-18' })).parts).toEqual(['food', 'budget']);
  expect((await mine.addItem(plain.id, { kind: 'task', label: 'Buy ice' })).parts).toEqual(['food', 'budget', 'tasks']); // adding to a hidden part checks it
  await expect(mine.setParts(plain.id, ['food', 'nope'])).rejects.toEqual(problem(400));
});

it('a plan from before parts shows the parts it has something in', async () => {
  const p = await mine.create({ name: 'Painting week', start_day: '2046-03-05', end_day: '2046-03-09' });
  await db.run('UPDATE plans SET parts = NULL WHERE id = ?', [p.id]);
  const things = inventory(db, owner, clock);
  const kind = (await things.addStarter('cookware'))[0]!;
  const item = await things.createItem({ kind_id: kind.id, name: 'Drop cloth', quantity: 1 });
  await mine.addItem(p.id, { kind: 'thing', ref_id: item.id });
  expect((await mine.get(p.id)).parts).toEqual(['budget', 'more_days', 'bring']);
  expect((await mine.list()).find((x) => x.id === p.id)!.parts).toEqual(['budget', 'more_days', 'bring']);
});

it('traditions: short lines to add, reword, reorder, check off and remove; a copy carries them over unchecked', async () => {
  const p = await mine.create({ name: 'Supper', start_day: '2046-03-05', parts: ['food'] });
  expect(p.traditions).toEqual([]);
  await expect(mine.addTradition(p.id, '  ')).rejects.toEqual(problem(400));
  let view = await mine.addTradition(p.id, 'Grandpa carves');
  view = await mine.addTradition(p.id, 'Kids pick the movie');
  view = await mine.addTradition(p.id, 'Everyone says one thing they are glad of');
  expect(view.parts).toEqual(['food', 'traditions']); // adding one checks the part
  const [a, b, c] = view.traditions;
  view = await mine.updateTradition(b!.id, { words: 'Kids pick the film', done: true });
  expect(view.traditions.map((r) => [r.words, r.done])).toEqual([['Grandpa carves', false], ['Kids pick the film', true], ['Everyone says one thing they are glad of', false]]);
  view = await mine.moveTradition(c!.id, 'up');
  view = await mine.moveTradition(c!.id, 'up');
  view = await mine.moveTradition(c!.id, 'up'); // already first: stays
  expect(view.traditions.map((r) => r.id)).toEqual([c!.id, a!.id, b!.id]);
  view = await mine.moveTradition(c!.id, 'down');
  expect(view.traditions.map((r) => r.id)).toEqual([a!.id, c!.id, b!.id]);
  await expect(mine.moveTradition(a!.id, 'sideways')).rejects.toEqual(problem(400));
  const next = await mine.copy(p.id, { start_day: '2047-03-05' });
  expect(next.traditions.map((r) => [r.words, r.done])).toEqual([['Grandpa carves', false], ['Everyone says one thing they are glad of', false], ['Kids pick the film', false]]);
  view = await mine.removeTradition(c!.id);
  expect(view.traditions.map((r) => r.id)).toEqual([a!.id, b!.id]);
  await expect(mine.removeTradition(c!.id)).rejects.toEqual(problem(404));
  // They go when the plan goes, and are another person's to see never.
  await mine.remove(next.id);
  expect(await db.get('SELECT COUNT(*) AS n FROM plan_traditions WHERE plan_id = ?', [next.id])).toEqual({ n: 0 });
});

it('traditions of a yearly plan carry over, unchecked, into next year', async () => {
  const h = await holidays(db, owner, clock).create({ name: 'Family supper', rule: { kind: 'fixed', month: 3, day: 5 } });
  const first = h.years[0]!.plan_id;
  const one = await mine.addTradition(first, 'Grandpa carves');
  await mine.updateTradition(one.traditions[0]!.id, { done: true });
  time = new Date(2046, 2, 10, 10, 0, 0); // this year's has passed
  const second = await holidays(db, owner, clock).startYear(h.id);
  expect((await mine.get(second.plan_id)).traditions.map((r) => [r.words, r.done])).toEqual([['Grandpa carves', false]]);
});

it('when and where: a start time, an optional end time and a place, shown on the calendar and kept when done again', async () => {
  const p = await mine.create({ name: 'Garden party', start_day: '2046-03-12', parts: ['food'] });
  expect([p.start_time, p.end_time, p.place]).toEqual([null, null, null]);
  await expect(mine.setWhenWhere(p.id, { start_time: '25:00' })).rejects.toEqual(problem(400));
  await expect(mine.setWhenWhere(p.id, { end_time: '20:00' })).rejects.toEqual(problem(400)); // needs a start
  const set = await mine.setWhenWhere(p.id, { start_time: '15:30', place: "Aunt Ruth's back yard" });
  expect([set.start_time, set.end_time, set.place, set.parts]).toEqual(['15:30', null, "Aunt Ruth's back yard", ['food', 'when_where']]);
  await expect(mine.setWhenWhere(p.id, { end_time: '15:30' })).rejects.toEqual(problem(400)); // one day: must end after it starts
  const ended = await mine.setWhenWhere(p.id, { end_time: '18:00' });
  expect([ended.start_time, ended.end_time, ended.place]).toEqual(['15:30', '18:00', "Aunt Ruth's back yard"]);
  expect((await mine.setWhenWhere(p.id, { place: '  ' })).place).toBeNull();
  await mine.setWhenWhere(p.id, { place: 'The park' });
  const line = (await calendar(db, owner, clock).between('2046-03-12', 1)).find((e) => e.kind === 'plan')!;
  expect([line.time, line.detail]).toEqual(['15:30', 'until 18:00 · The park']);
  expect((await mine.list()).find((x) => x.id === p.id)).toMatchObject({ start_time: '15:30', place: 'The park' });
  const again = await mine.copy(p.id, { start_day: '2047-03-12' });
  expect([again.start_time, again.end_time, again.place]).toEqual(['15:30', '18:00', 'The park']);
  // Taking a time off keeps the rest.
  expect((await mine.setWhenWhere(p.id, { start_time: null, end_time: null })).place).toBe('The park');
});
