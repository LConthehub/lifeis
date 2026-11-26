/** Tags: one nested list for the household, put on nine kinds of thing. */
import { beforeEach, expect, it } from 'vitest';
import { makeBackup, restoreBackup } from '../src/backup.ts';
import { calendar } from '../src/calendar.ts';
import type { Db } from '../src/db.ts';
import { bringInDownload, exportEverything, splitDownload } from '../src/exportAll.ts';
import { inventory } from '../src/inventory.ts';
import { kitchen } from '../src/kitchen.ts';
import { media } from '../src/media.ts';
import { LATEST, migrate } from '../src/migrations.ts';
import { money } from '../src/money.ts';
import { pets } from '../src/pets.ts';
import { plans } from '../src/plans.ts';
import { projects } from '../src/projects.ts';
import { search } from '../src/search.ts';
import { tags, type Tags } from '../src/tags.ts';
import { upkeep } from '../src/upkeep.ts';
import { memoryDb } from './memoryDb.ts';

let db: Db;
let owner: number;
let mine: Tags;
const clock = Object.assign(() => new Date(2046, 2, 5, 10, 0, 0), { today: () => '2046-03-05' });
const problem = (status: number) => expect.objectContaining({ name: 'Problem', status });

async function person(name: string): Promise<number> {
  return (await db.run("INSERT INTO users (username, password_hash, created_at) VALUES (?, 'x', 'now')", [name])).lastId;
}
const names = async (t: Tags = mine) => (await t.list()).map((n) => n.path);

/** One of each of the nine kinds, made with the real functions. */
async function nine(who = owner) {
  const stuff = inventory(db, who, clock);
  const kinds = await stuff.createKind({ name: 'Gadget', icon: '🔌', fields: [] });
  const thing = await stuff.createItem({ kind_id: kinds.find((k) => k.name === 'Gadget')!.id, name: 'Toaster' });
  const recipe = await kitchen(db, who, clock).createRecipe({ title: 'Toast', ingredients_text: '2 slices bread', steps_text: 'Toast it.', tags: [] });
  const project = await projects(db, who, clock).createProject({ name: 'Paint the hall', status: 'idea' });
  const plan = await plans(db, who, clock).create({ name: 'Beach day', start_day: '2046-04-01' });
  const entry = await money(db, who, clock).addEntry({ label: 'New toaster', cents: 2599, day: '2046-03-04' });
  const title = await media(db, who, clock).create({ type: 'film', title: 'Toast the Film' });
  const pet = await pets(db, who, clock).create({ name: 'Rex', species: 'dog' });
  const job = await upkeep(db, who, clock).create({ name: 'Descale the kettle', every_n: 1, every_unit: 'month' });
  const event = await calendar(db, who, clock).createEvent({ title: 'Toast party', day: '2046-03-20' });
  return { thing: thing.id, recipe: recipe.id, project: project.id, plan: plan.id, spending: entry.id, title: title.id, pet: pet.id, job: job.id, event: event.id };
}
type Nine = Awaited<ReturnType<typeof nine>>;
const KINDS = ['thing', 'recipe', 'project', 'plan', 'spending', 'title', 'pet', 'job', 'event'] as const;

beforeEach(async () => {
  db = memoryDb();
  expect(await migrate(db)).toBe(LATEST);
  owner = await person('owner');
  mine = tags(db, owner, clock);
});

it('carries the old recipe tags over: one top-level tag for each word, each owner on their own', async () => {
  const other = await person('other');
  // Put the database back to how version 38 left it, with recipes that have a comma list of tags.
  // Version 53 comes last, then 52, then 51, then 50, then 49, then 48, then 47.
  // Version 57 comes last.
  for (const table of ['item_did', 'ai_log', 'ai_connections', 'ai_clients']) await db.run(`DROP TABLE ${table}`);
  await db.run('DROP TABLE measure_entries');
  await db.run('DROP TABLE measures');
  await db.run('ALTER TABLE routines DROP COLUMN kind');
  for (const column of ['sets', 'reps', 'weight', 'weight_unit', 'minutes', 'distance', 'distance_unit']) for (const table of ['routine_steps', 'routine_ticks']) await db.run(`ALTER TABLE ${table} DROP COLUMN ${column}`);
  await db.run('ALTER TABLE routines DROP COLUMN for_pet');
  await db.run('ALTER TABLE routine_ticks DROP COLUMN ticked_at');
  await db.run('DROP TABLE money_goal_lines');
  await db.run('ALTER TABLE money_goals DROP COLUMN plan_id');
  await db.run('ALTER TABLE money_goals DROP COLUMN settled_on');
  await db.run('ALTER TABLE media DROP COLUMN stars');
  await db.run('DROP TABLE personal_keys');
  await db.run('DROP TABLE item_shares');
  await db.run('ALTER TABLE kinds DROP COLUMN guard');
  for (const table of ['home_service_pins', 'home_service_people', 'home_services']) await db.run(`DROP TABLE ${table}`);
  await db.run('DROP TABLE media_list_items');
  await db.run('DROP TABLE media_lists');
  await db.run('ALTER TABLE media DROP COLUMN listed_only');
  await db.run('ALTER TABLE items DROP COLUMN import_ref');
  await db.run('DROP TABLE item_fields');
  await db.run('DROP INDEX idx_items_asset');
  for (const column of ['gone_on', 'gone_how', 'gone_to', 'gone_cents', 'insured', 'asset_no']) await db.run(`ALTER TABLE items DROP COLUMN ${column}`);
  // Version 46 comes next, then 45.
  for (const table of ['outdoor_harvest', 'outdoor_catch', 'outdoor_seasons', 'outdoor_gear', 'outdoor_trip_years', 'outdoor_trips', 'holiday_ticks', 'holiday_steps', 'holiday_decor', 'holiday_gifts', 'holiday_people', 'holiday_years', 'holidays']) await db.run(`DROP TABLE ${table}`);
  await db.run('ALTER TABLE plan_photos DROP COLUMN spot');
  await db.run('DROP TABLE trip_receipts');
  for (const column of ['saved_cents', 'trip_id', 'claimed_on']) await db.run(`ALTER TABLE prices DROP COLUMN ${column}`);
  await db.run('ALTER TABLE stores DROP COLUMN adjust_days');
  for (const column of ['book', 'item', 'starts_on']) await db.run(`ALTER TABLE coupons DROP COLUMN ${column}`);
  await db.run('DROP TABLE shopping_trips'); // version 44 comes before
  await db.run('DROP INDEX idx_money_entries_cost');
  for (const column of ['project_id', 'project_cost_id', 'trip_id']) await db.run(`ALTER TABLE money_entries DROP COLUMN ${column}`);
  await db.run('ALTER TABLE money_goals DROP COLUMN project_id');
  await db.run('ALTER TABLE money_goal_saved DROP COLUMN cost_id');
  await db.run('ALTER TABLE grocery DROP COLUMN store');
  for (const table of ['routine_sent', 'routine_finished', 'routine_ticks', 'routine_steps', 'routine_times', 'routines']) await db.run(`DROP TABLE ${table}`); // version 43 comes before
  for (const table of ['prep_sent', 'prep_steps']) await db.run(`DROP TABLE ${table}`); // version 42 comes last
  await db.run('ALTER TABLE meal_plan DROP COLUMN eat_time');
  for (const table of ['money_goal_saved', 'money_goals', 'money_income']) await db.run(`DROP TABLE ${table}`); // version 40 comes after
  for (const table of ['simplefin_accounts', 'simplefin_connections']) await db.run(`DROP TABLE ${table}`); // and 41
  await db.run('DROP INDEX idx_money_entries_bank');
  for (const column of ['bank_account', 'bank_txn']) await db.run(`ALTER TABLE money_entries DROP COLUMN ${column}`);
  await db.run('DROP TABLE tag_links');
  await db.run('DROP TABLE tags');
  await db.run('PRAGMA user_version = 38');
  const recipe = (who: number, title: string, list: string | null) =>
    db.run('INSERT INTO recipes (owner_id, title, tags, created_at, updated_at) VALUES (?, ?, ?, ?, ?)', [who, title, list, 'now', 'now']);
  const soup = (await recipe(owner, 'Soup', 'winter,soup')).lastId;
  const stew = (await recipe(owner, 'Stew', 'winter, slow cooker ,')).lastId;
  const plain = (await recipe(owner, 'Plain', null)).lastId;
  const theirs = (await recipe(other, 'Theirs', 'winter')).lastId;
  expect(await migrate(db)).toBe(LATEST);

  expect(await names()).toEqual(['slow cooker', 'soup', 'winter']);
  expect(await names(tags(db, other, clock))).toEqual(['winter']);
  const onRecipe = async (id: number, who = owner) => (await tags(db, who, clock).of('recipe', id)).map((t) => t.name);
  expect(await onRecipe(soup)).toEqual(['soup', 'winter']);
  expect(await onRecipe(stew)).toEqual(['slow cooker', 'winter']);
  expect(await onRecipe(plain)).toEqual([]);
  expect(await onRecipe(theirs, other)).toEqual(['winter']);
  // The recipe list reads them from the new tables.
  expect((await kitchen(db, owner, clock).listRecipes()).find((r) => r.id === stew)!.tags).toEqual(['slow cooker', 'winter']);
});

it('recipe tags typed as words are found or made, and an edit that leaves tags out keeps them', async () => {
  const cook = kitchen(db, owner, clock);
  const made = await cook.createRecipe({ title: 'Lasagne', ingredients_text: '1 box pasta', steps_text: 'Bake.', tags: ['Dinner', 'freezes well', 'dinner'] });
  expect(made.tags).toEqual(['dinner', 'freezes well']);
  expect(made.tag_list.map((t) => t.path)).toEqual(['dinner', 'freezes well']);
  expect(await db.get('SELECT tags FROM recipes WHERE id = ?', [made.id])).toEqual({ tags: null }); // the old column isn't used
  const kept = await cook.updateRecipe(made.id, { title: 'Lasagne', ingredients_text: '1 box pasta', steps_text: 'Bake.' });
  expect(kept.tags).toEqual(['dinner', 'freezes well']);
  const cut = await cook.updateRecipe(made.id, { title: 'Lasagne', ingredients_text: '1 box pasta', steps_text: 'Bake.', tags: ['dinner'] });
  expect(cut.tags).toEqual(['dinner']);
  expect((await cook.listRecipes({ tag: 'dinner' })).map((r) => r.title)).toEqual(['Lasagne']);
  expect(await cook.listRecipes({ tag: 'nothing' })).toEqual([]);
});

it('tags nest, and a name can be used once in a place', async () => {
  const kitchenTag = await mine.create('Kitchen');
  const appliances = await mine.create('Appliances', kitchenTag.id);
  expect(appliances.path).toBe('Kitchen > Appliances');
  expect((await mine.create('  kitchen ')).id).toBe(kitchenTag.id); // same place, same name: the one there
  expect((await mine.create('Garage > Appliances')).path).toBe('Garage > Appliances'); // each step made
  expect((await mine.create('Appliances')).path).toBe('Appliances'); // the same name elsewhere is another tag
  expect(await names()).toEqual(['Appliances', 'Garage', 'Garage > Appliances', 'Kitchen', 'Kitchen > Appliances']);
  await expect(mine.create('   ')).rejects.toEqual(problem(400));
  await expect(mine.create('Fridge', 9999)).rejects.toEqual(problem(404));
  await expect(mine.rename(appliances.id, 'a>b')).rejects.toEqual(problem(400));
  const renamed = await mine.rename(appliances.id, 'Gadgets');
  expect(renamed.path).toBe('Kitchen > Gadgets');
  await expect(mine.rename(appliances.id, 'GADGETS ')).resolves.toBeTruthy(); // itself
  const garage = (await mine.list()).find((n) => n.path === 'Garage')!;
  const top = (await mine.list()).find((n) => n.path === 'Appliances')!;
  await expect(mine.move(top.id, garage.id)).rejects.toEqual(problem(409)); // Garage already has Appliances
  expect((await mine.move(top.id, kitchenTag.id)).path).toBe('Kitchen > Appliances');
  // No loops: not inside itself, nor inside what is inside it.
  await expect(mine.move(kitchenTag.id, kitchenTag.id)).rejects.toEqual(problem(400));
  await expect(mine.move(kitchenTag.id, appliances.id)).rejects.toEqual(problem(400));
  expect((await mine.move(top.id, null)).path).toBe('Appliances');

  // Other households never see or touch them.
  const other = tags(db, await person('other'), clock);
  expect(await other.list()).toEqual([]);
  await expect(other.rename(kitchenTag.id, 'Mine')).rejects.toEqual(problem(404));
  await expect(other.create('Sub', kitchenTag.id)).rejects.toEqual(problem(404));
  await expect(other.remove(kitchenTag.id)).rejects.toEqual(problem(404));
});

it('every kind can carry tags, a parent includes its children, and each list can be filtered', async () => {
  const ids = await nine();
  const kitchenTag = await mine.create('Kitchen');
  const small = await mine.create('Small', kitchenTag.id);
  const garden = await mine.create('Garden');
  for (const kind of KINDS) await mine.set(kind, ids[kind], [small.id]);
  await mine.set('thing', ids.thing, [small.id, garden.id]);
  expect((await mine.of('thing', ids.thing)).map((t) => t.path)).toEqual(['Garden', 'Kitchen > Small']);

  const page = await mine.page(kitchenTag.id);
  expect(page.total).toBe(9);
  expect(page.groups.map((g) => g.kind)).toEqual([...KINDS]);
  expect(page.groups.find((g) => g.kind === 'event')!.items[0]).toMatchObject({ title: 'Toast party', link: '/calendar?day=2046-03-20' });
  expect(page.groups.find((g) => g.kind === 'thing')!.items[0]).toMatchObject({ title: 'Toaster', link: `/things/${ids.thing}` });
  expect(page.groups.find((g) => g.kind === 'spending')!.items[0]).toMatchObject({ link: '/money?month=2046-03' });
  expect(page.inside.map((n) => n.path)).toEqual(['Kitchen > Small']);
  expect((await mine.page(garden.id)).groups.map((g) => g.kind)).toEqual(['thing']);

  const counted = await mine.list();
  expect(counted.find((n) => n.path === 'Kitchen')).toMatchObject({ own: 0, total: 9 });
  expect(counted.find((n) => n.path === 'Kitchen > Small')).toMatchObject({ own: 9, total: 9, depth: 1 });

  // The filter takes the parent (and so the child) and every list shows the tags.
  const stuff = inventory(db, owner, clock);
  const filtered = await stuff.listItems({ tag: kitchenTag.id });
  expect(filtered.map((i) => i.name)).toEqual(['Toaster']);
  expect(filtered[0]!.tag_list.map((t) => t.path)).toEqual(['Garden', 'Kitchen > Small']);
  expect(await stuff.listItems({ tag: garden.id })).toHaveLength(1);
  expect((await stuff.listItems()).length).toBe(1);
  const lonely = await stuff.createItem({ kind_id: filtered[0]!.kind_id, name: 'Other gadget' });
  expect(await stuff.listItems({ tag: kitchenTag.id })).toHaveLength(1);
  expect((await stuff.listItems()).find((i) => i.id === lonely.id)!.tag_list).toEqual([]);
  expect((await kitchen(db, owner, clock).listRecipes({ tag: kitchenTag.id })).map((r) => [r.title, r.tag_list[0]!.path])).toEqual([['Toast', 'Kitchen > Small']]);
  expect(await projects(db, owner, clock).listProjects({ tag: kitchenTag.id })).toHaveLength(1);
  expect(await projects(db, owner, clock).listProjects({ tag: garden.id })).toHaveLength(0);
  expect((await plans(db, owner, clock).list({ tag: small.id }))[0]!.tag_list[0]!.name).toBe('Small');
  expect(await plans(db, owner, clock).list({ tag: garden.id })).toHaveLength(0);
  expect((await money(db, owner, clock).month('2046-03', kitchenTag.id)).entries.map((e) => e.label)).toEqual(['New toaster']);
  expect((await money(db, owner, clock).month('2046-03', garden.id)).entries).toEqual([]);
  expect((await money(db, owner, clock).month('2046-03')).entries[0]!.tag_list[0]!.path).toBe('Kitchen > Small');
  expect(await media(db, owner, clock).list({ tag: garden.id })).toHaveLength(0);
  const titles = await media(db, owner, clock).list({ tag: kitchenTag.id });
  expect(titles.map((t) => t.title)).toEqual(['Toast the Film']);
  expect(titles[0]!.tag_list).toHaveLength(1);
  expect((await media(db, owner, clock).get(ids.title)).tag_list).toHaveLength(1);
  expect((await pets(db, owner, clock).list({ tag: kitchenTag.id })).map((p) => p.name)).toEqual(['Rex']);
  expect((await pets(db, owner, clock).get(ids.pet)).tag_list).toHaveLength(1);
  expect((await upkeep(db, owner, clock).list({ tag: kitchenTag.id })).map((j) => j.name)).toEqual(['Descale the kettle']);
  expect((await upkeep(db, owner, clock).get(ids.job)).tag_list).toHaveLength(1);
  const week = await calendar(db, owner, clock).between('2046-03-18', 7, kitchenTag.id);
  expect(week.map((e) => [e.title, e.tag_list![0]!.name])).toEqual([['Toast party', 'Small']]);
  expect(await calendar(db, owner, clock).between('2046-03-18', 7, garden.id)).toEqual([]);
  expect((await calendar(db, owner, clock).between('2046-03-18', 7)).length).toBe(1);
  expect((await calendar(db, owner, clock).getEvent(ids.event)).tag_list).toHaveLength(1);
});

it('many things are tagged and untagged at once, and only the person\'s own', async () => {
  const a = await nine();
  const other = await person('other');
  const theirs = await nine(other);
  const tag = await mine.create('Seasonal');
  const extra = await mine.create('Later');
  const recipe2 = (await kitchen(db, owner, clock).createRecipe({ title: 'Soup', ingredients_text: '1 leek', steps_text: 'Simmer.', tags: [] })).id;
  expect(await mine.change('recipe', [a.recipe, recipe2, a.recipe], [tag.id, extra.id], [])).toEqual({ changed: 2 });
  expect((await mine.page(tag.id)).total).toBe(2);
  expect(await mine.change('recipe', [recipe2], [], [tag.id])).toEqual({ changed: 1 });
  expect((await mine.of('recipe', recipe2)).map((t) => t.name)).toEqual(['Later']);
  expect((await mine.of('recipe', a.recipe)).map((t) => t.name)).toEqual(['Later', 'Seasonal']);
  await expect(mine.change('recipe', [theirs.recipe], [tag.id], [])).rejects.toEqual(problem(404));
  await expect(mine.change('recipe', [a.recipe, 99999], [tag.id], [])).rejects.toEqual(problem(404));
  await expect(mine.change('recipe', [a.recipe], [999], [])).rejects.toEqual(problem(404));
  await expect(mine.change('nonsense' as 'recipe', [1], [], [])).rejects.toEqual(problem(400));
  await expect(mine.set('thing', a.recipe + 100, [])).rejects.toEqual(problem(404));
  // Someone else's tag can't be put on my thing.
  const theirTag = await tags(db, other, clock).create('Theirs');
  await expect(mine.set('recipe', a.recipe, [theirTag.id])).rejects.toEqual(problem(404));
  expect((await mine.set('recipe', a.recipe, [])).length).toBe(0);
});

it('merging moves what is carried and what is inside, with nothing twice', async () => {
  const a = await nine();
  const food = await mine.create('Food');
  const meals = await mine.create('Meals');
  const soups = await mine.create('Soups', meals.id);
  const foodSoups = await mine.create('Soups', food.id);
  const warm = await mine.create('Warm', meals.id);
  await mine.set('recipe', a.recipe, [meals.id, food.id]);
  await mine.set('thing', a.thing, [meals.id, soups.id]);
  await mine.set('project', a.project, [foodSoups.id, warm.id]);

  await expect(mine.merge(food.id, food.id)).rejects.toEqual(problem(400));
  await mine.merge(meals.id, food.id);
  expect(await names()).toEqual(['Food', 'Food > Soups', 'Food > Warm']); // Soups met Soups and became one; Warm moved in
  expect((await mine.of('recipe', a.recipe)).map((t) => t.path)).toEqual(['Food']); // one link, not two
  expect((await mine.of('thing', a.thing)).map((t) => t.path)).toEqual(['Food', 'Food > Soups']);
  expect((await mine.of('project', a.project)).map((t) => t.path)).toEqual(['Food > Soups', 'Food > Warm']);
  await expect(mine.merge(meals.id, food.id)).rejects.toEqual(problem(404)); // it's gone
  expect(await db.get('SELECT COUNT(*) AS n FROM tag_links WHERE tag_id NOT IN (SELECT id FROM tags)')).toEqual({ n: 0 });

  // A tag merged into one inside it: the inner one takes its place.
  const top = (await mine.list()).find((n) => n.path === 'Food')!;
  const soup = (await mine.list()).find((n) => n.path === 'Food > Soups')!;
  await mine.merge(top.id, soup.id);
  expect(await names()).toEqual(['Soups', 'Soups > Warm']);
  expect((await mine.of('recipe', a.recipe)).map((t) => t.path)).toEqual(['Soups']);
});

it('deleting a tag takes it off everything and moves what is inside up', async () => {
  const a = await nine();
  const top = await mine.create('Home');
  const middle = await mine.create('Rooms', top.id);
  const inner = await mine.create('Kitchen', middle.id);
  const clash = await mine.create('Kitchen', top.id);
  const loose = await mine.create('Attic', middle.id);
  await mine.set('thing', a.thing, [middle.id, inner.id]);
  await mine.set('pet', a.pet, [clash.id]);
  await mine.remove(middle.id);
  // Kitchen (inside Rooms) moved up beside the Kitchen already there, so they joined; Attic moved up.
  expect(await names()).toEqual(['Home', 'Home > Attic', 'Home > Kitchen']);
  expect((await mine.of('thing', a.thing)).map((t) => t.path)).toEqual(['Home > Kitchen']);
  expect((await mine.of('pet', a.pet)).map((t) => t.path)).toEqual(['Home > Kitchen']);
  expect(loose.id).toBeGreaterThan(0);
  await mine.remove(top.id); // a top-level tag: what was inside it goes to the top
  expect(await names()).toEqual(['Attic', 'Kitchen']);
  expect(await db.get('SELECT COUNT(*) AS n FROM tag_links WHERE tag_id NOT IN (SELECT id FROM tags)')).toEqual({ n: 0 });
});

it('a removed thing loses its links, and a link left behind never shows', async () => {
  const a = await nine();
  const tag = await mine.create('Doomed');
  for (const kind of KINDS) await mine.set(kind, a[kind as keyof Nine], [tag.id]);
  expect((await mine.page(tag.id)).total).toBe(9);
  await inventory(db, owner, clock).deleteItem(a.thing);
  await kitchen(db, owner, clock).deleteRecipe(a.recipe);
  await projects(db, owner, clock).deleteProject(a.project);
  await plans(db, owner, clock).remove(a.plan);
  await money(db, owner, clock).removeEntry(a.spending);
  await media(db, owner, clock).remove(a.title);
  await pets(db, owner, clock).remove(a.pet);
  await upkeep(db, owner, clock).remove(a.job);
  await calendar(db, owner, clock).deleteEvent(a.event);
  expect(await db.get('SELECT COUNT(*) AS n FROM tag_links')).toEqual({ n: 0 });
  expect((await mine.page(tag.id)).total).toBe(0);

  // A stray link (made by hand here) is joined away: it is not counted, listed or searched.
  await db.run("INSERT INTO tag_links (tag_id, kind, target_id) VALUES (?, 'thing', 4242)", [tag.id]);
  expect((await mine.list())[0]).toMatchObject({ own: 0, total: 0 });
  expect((await mine.page(tag.id)).groups).toEqual([]);
  expect(await search(db, owner, 'doomed')).toEqual([{ kind: 'tag', id: tag.id, icon: '🏷', title: 'Doomed', detail: 'Tag', link: `/tags/${tag.id}` }]);
});

it('search finds a tag and what carries it, including through a parent', async () => {
  const a = await nine();
  const kitchenTag = await mine.create('Kitchen');
  const small = await mine.create('Small appliances', kitchenTag.id);
  await mine.set('thing', a.thing, [small.id]);
  await mine.set('recipe', a.recipe, [kitchenTag.id]);
  await mine.set('event', a.event, [small.id]);
  const found = await search(db, owner, 'kitchen');
  expect(found.map((r) => [r.kind, r.title])).toEqual([['tag', 'Kitchen'], ['tag', 'Kitchen > Small appliances'], ['recipe', 'Toast'], ['thing', 'Toaster'], ['event', 'Toast party']]);
  expect(found[0]!.link).toBe(`/tags/${kitchenTag.id}`);
  expect((await search(db, owner, 'appliances kitchen')).map((r) => r.title)).toEqual(['Kitchen > Small appliances', 'Toaster', 'Toast party']);
  expect((await search(db, owner, 'kitchen', 'tag')).map((r) => r.kind)).toEqual(['tag', 'tag']);
  // Someone else's search never sees them.
  expect(await search(db, await person('other'), 'kitchen')).toEqual([]);
});

it('the full export lists tags, writes recipe tags as paths, and brings them back in', async () => {
  const a = await nine();
  const kitchenTag = await mine.create('Kitchen');
  const small = await mine.create('Small', kitchenTag.id);
  await mine.create('Unused');
  await mine.set('recipe', a.recipe, [small.id]);
  await mine.set('thing', a.thing, [kitchenTag.id]);
  const made = await exportEverything(db, owner, clock);
  const { files } = await splitDownload(made.bytes);
  const text = (name: string) => files[name]!;
  expect(text('tags.csv').replace(/\r/g, '').trim().split('\n')).toEqual([
    'Tag,Used on,Name', 'Kitchen,Things,Toaster', 'Kitchen > Small,Recipes,Toast', 'Unused,,']);
  expect(text('recipes.csv')).toContain('Kitchen > Small');

  const there = await person('there');
  const brought = await bringInDownload(db, there, files, ['recipes'], clock);
  expect(brought.kinds.find((k) => k.key === 'recipes')!.fresh).toBe(1);
  const theirs = tags(db, there, clock);
  expect(await names(theirs)).toEqual(['Kitchen', 'Kitchen > Small']);
  const toast = (await kitchen(db, there, clock).listRecipes())[0]!;
  expect(toast.tag_list.map((t) => t.path)).toEqual(['Kitchen > Small']);
});

it('a backup brings tags back exactly, and they keep working afterwards', async () => {
  const a = await nine();
  const kitchenTag = await mine.create('Kitchen');
  const small = await mine.create('Small', kitchenTag.id);
  await mine.set('thing', a.thing, [small.id]);
  await mine.set('recipe', a.recipe, [kitchenTag.id]);
  const everything = async (from: Db) => ({ tags: await from.all('SELECT * FROM tags ORDER BY id'), links: await from.all('SELECT * FROM tag_links ORDER BY tag_id, kind, target_id') });
  const before = await everything(db);
  const file = await makeBackup(db, 'correct horse battery', clock);

  const to = memoryDb();
  await migrate(to);
  await to.run('PRAGMA foreign_keys = OFF');
  const there = (await to.run("INSERT INTO users (username, password_hash, created_at) VALUES ('x', 'x', 'now')")).lastId;
  await tags(to, there, clock).create('Only here > Deep');
  await restoreBackup(to, file, 'correct horse battery');
  expect(await everything(to)).toEqual(before);
  const back = tags(to, owner, clock);
  expect(await names(back)).toEqual(['Kitchen', 'Kitchen > Small']);
  expect((await inventory(to, owner, clock).listItems({ tag: kitchenTag.id })).map((i) => i.name)).toEqual(['Toaster']);
  expect((await back.create('More', small.id)).path).toBe('Kitchen > Small > More');
});
