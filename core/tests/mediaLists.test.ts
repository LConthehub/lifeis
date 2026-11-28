/** Lists of titles: owned and not owned, private and shared, Wanted, and the download. */
import { beforeEach, expect, it } from 'vitest';
import type { Db } from '../src/db.ts';
import { bringInDownload, exportEverything, splitDownload } from '../src/exportAll.ts';
import { home } from '../src/home.ts';
import { media } from '../src/media.ts';
import { mediaLists } from '../src/mediaLists.ts';
import { migrate } from '../src/migrations.ts';
import { search } from '../src/search.ts';
import { memoryDb } from './memoryDb.ts';

let db: Db;
let ana: number;
let bob: number;
const clock = () => new Date(2046, 2, 5, 10, 0, 0);

async function person(name: string): Promise<number> {
  return (await db.run("INSERT INTO users (username, password_hash, created_at) VALUES (?, 'x', 'now')", [name])).lastId;
}
const shelfOf = (who: number) => media(db, who, clock);
const listsOf = (who: number) => mediaLists(db, who, clock);
const titlesOf = (view: { entries: { title: string }[] }) => view.entries.map((e) => e.title);

beforeEach(async () => {
  db = memoryDb();
  await migrate(db);
  ana = await person('ana');
  bob = await person('bob');
});

const problem = (status: number) => expect.objectContaining({ name: 'Problem', status });

it('every person has Wanted and To watch, read or hear; Wanted is drawn from the wanted mark', async () => {
  const blue = await shelfOf(ana).create({ type: 'music', title: 'Blue', creator: 'Joni Mitchell', wanted: true });
  const all = await listsOf(ana).all();
  expect(all.map((l) => [l.name, l.builtin, l.count, l.mine])).toEqual([['Wanted', 'wanted', 1, true], ['To watch, read or hear', 'to_watch', 0, true]]);
  const wanted = await listsOf(ana).get(all[0]!.id);
  expect(wanted.entries.map((e) => [e.title, e.type, e.owned])).toEqual([['Blue', 'music', false]]);
  // Bob has his own two, and Ana's are not his.
  expect((await listsOf(bob).all()).map((l) => l.name)).toEqual(['Wanted', 'To watch, read or hear']);
  await expect(listsOf(bob).get(all[0]!.id)).rejects.toEqual(problem(404));
  // Taking it off Wanted clears the mark (a title that was nothing more goes), and a copy answers the wanting.
  await listsOf(ana).take(all[0]!.id, blue.id);
  expect(await shelfOf(ana).wantedCount()).toBe(0);
  const dune = await shelfOf(ana).create({ type: 'book', title: 'Dune', wanted: true });
  expect(await shelfOf(ana).wantedCount()).toBe(1);
  expect((await shelfOf(ana).addCopy(dune.id, { format: 'Paperback' })).wanted).toBe(false);
  expect(await shelfOf(ana).wantedCount()).toBe(0);
});

it('a title typed onto a list is kept but is not owned: out of the collection, its counts and formats, until a copy is added', async () => {
  const lists = listsOf(ana);
  const toWatch = (await lists.all()).find((l) => l.builtin === 'to_watch')!;
  await shelfOf(ana).create({ type: 'film', title: 'Alien', year: 1979 }, { format: 'Blu-ray', cost_cents: 1500 });
  const view = await lists.add(toWatch.id, { type: 'film', title: 'Stalker', year: 1979, note: 'after the long weekend' });
  expect(view.entries.map((e) => [e.title, e.year, e.note, e.owned])).toEqual([['Stalker', 1979, 'after the long weekend', false]]);

  const shelf = shelfOf(ana);
  expect((await shelf.list()).map((t) => t.title)).toEqual(['Alien']);
  expect(await shelf.list({ q: 'Stalker' })).toEqual([]);
  expect(await shelf.list({ type: 'film', format: 'Blu-ray' })).toHaveLength(1);
  expect(await shelf.list({ lent: true })).toEqual([]);
  expect((await shelf.formats('film')).includes('Blu-ray')).toBe(true);
  // What the home page counts, and the places a title is looked up by place or barcode.
  expect((await home(db, ana, clock).summary()).collection).toMatchObject({ total: 1, wanted: 0 });
  expect(await shelf.findBarcode('0123456789012')).toEqual([]);
  // Search still finds it, marked as on a list.
  const found = await search(db, ana, 'stalker');
  expect(found).toEqual([expect.objectContaining({ kind: 'title', title: 'Stalker', detail: expect.stringContaining('On a list: To watch, read or hear') })]);
  // It can be opened, and the title page says it is not owned.
  const stalker = (await shelf.get(view.entries[0]!.media_id));
  expect(stalker.unowned).toBe(true);
  // A copy makes it owned: it joins the collection, and stays on the list.
  await shelf.addCopy(stalker.id, { format: 'DVD' });
  expect((await shelf.list()).map((t) => t.title)).toEqual(['Alien', 'Stalker']);
  expect((await shelf.get(stalker.id)).unowned).toBe(false);
  expect(titlesOf(await lists.get(toWatch.id))).toEqual(['Stalker']);
  expect((await lists.get(toWatch.id)).entries[0]!.owned).toBe(true);
});

it('adding the same title through the new-title form uses the one on the list, so nothing is doubled', async () => {
  const toWatch = (await listsOf(ana).all()).find((l) => l.builtin === 'to_watch')!;
  await listsOf(ana).add(toWatch.id, { type: 'book', title: 'Dune' });
  const made = await shelfOf(ana).create({ type: 'book', title: 'dune', creator: 'Frank Herbert' }, { format: 'Paperback' });
  expect(await db.all("SELECT id FROM media WHERE owner_id = ? AND type = 'book'", [ana])).toHaveLength(1);
  expect(made.unowned).toBe(false);
  expect(titlesOf(await listsOf(ana).get(toWatch.id))).toEqual(['dune']); // the list shows the title as it is kept now
});

it('watching something takes it off To watch; a title that is only on a list goes when it leaves the last one', async () => {
  const lists = listsOf(ana);
  const toWatch = (await lists.all()).find((l) => l.builtin === 'to_watch')!;
  const made = await lists.add(toWatch.id, { type: 'film', title: 'Stalker' });
  await lists.add(toWatch.id, { type: 'show', title: 'Dark' });
  const id = made.entries[0]!.media_id;
  const logged = await shelfOf(ana).log(id, { day: '2046-03-05' });
  expect(logged.times).toBe(1);
  expect(titlesOf(await lists.get(toWatch.id))).toEqual(['Dark']);
  // The watched title is still kept (it has a log) and is still not in the collection.
  expect((await shelfOf(ana).list()).map((t) => t.title)).toEqual([]);
  expect((await shelfOf(ana).get(id)).unowned).toBe(true);
  // Taking Dark off the list removes it, since it was nothing else.
  await lists.take(toWatch.id, (await lists.get(toWatch.id)).entries[0]!.media_id);
  expect(await db.all("SELECT title FROM media WHERE owner_id = ? ORDER BY title", [ana])).toEqual([{ title: 'Stalker' }]);
});

it('lists of your own take any kind of title, in an order you choose, and move up and down', async () => {
  const lists = listsOf(ana);
  const made = await lists.create({ name: 'Rainy day' });
  expect([made.name, made.shared, made.mine, made.builtin]).toEqual(['Rainy day', false, true, null]);
  await shelfOf(ana).create({ type: 'game', title: 'Ticket to Ride' }, { format: 'Board game' });
  const mine = (await shelfOf(ana).list())[0]!;
  await lists.add(made.id, { media_id: mine.id });
  await lists.add(made.id, { type: 'film', title: 'Spirited Away' });
  const three = await lists.add(made.id, { type: 'music', title: 'Rumours' });
  await lists.add(made.id, { type: 'music', title: 'rumours' }); // the same again: still once
  expect(titlesOf(three)).toEqual(['Ticket to Ride', 'Spirited Away', 'Rumours']);
  const rumours = three.entries[2]!.media_id;
  expect(titlesOf(await lists.move(made.id, rumours, 'up'))).toEqual(['Ticket to Ride', 'Rumours', 'Spirited Away']);
  expect(titlesOf(await lists.move(made.id, rumours, 'up'))).toEqual(['Rumours', 'Ticket to Ride', 'Spirited Away']);
  expect(titlesOf(await lists.move(made.id, rumours, 'up'))).toEqual(['Rumours', 'Ticket to Ride', 'Spirited Away']); // already first
  expect(titlesOf(await lists.move(made.id, rumours, 'down'))).toEqual(['Ticket to Ride', 'Rumours', 'Spirited Away']);
  await expect(lists.create({ name: 'rainy DAY' })).rejects.toEqual(problem(409));
  await expect(lists.create({ name: '  ' })).rejects.toEqual(problem(400));
  // Rename; the built-in lists stay as they are.
  expect((await lists.update(made.id, { name: 'Rainy days' })).name).toBe('Rainy days');
  const builtin = (await lists.all())[0]!;
  await expect(lists.update(builtin.id, { shared: true })).rejects.toEqual(problem(400));
  await expect(lists.remove(builtin.id)).rejects.toEqual(problem(400));
  // Deleting a list removes no title: owned ones stay in the collection, the others stay findable and can go on another list.
  await lists.remove(made.id);
  expect((await shelfOf(ana).list()).map((t) => t.title)).toEqual(['Ticket to Ride']);
  const kept = (await db.all<{ title: string }>('SELECT title FROM media WHERE owner_id = ? AND listed_only = 1', [ana])).map((t) => t.title);
  expect(kept.length).toBeGreaterThan(0);
  expect((await search(db, ana, kept[0]!)).length).toBeGreaterThan(0);
  const toWatch = (await lists.all()).find((l) => l.builtin === 'to_watch')!;
  expect((await lists.add(toWatch.id, { type: 'film', title: kept[0]! })).entries.map((e) => e.title)).toEqual([kept[0]]);
});

it('a list nobody shared is seen only by its owner, through every route; a shared one can be seen and added to by everyone', async () => {
  const secret = await listsOf(ana).create({ name: 'Gift ideas' });
  await listsOf(ana).add(secret.id, { type: 'film', title: 'A Surprise Film' });
  // Not in Bob's lists, not through the list or its titles, not in search, not in his download.
  expect((await listsOf(bob).all()).map((l) => l.name)).not.toContain('Gift ideas');
  await expect(listsOf(bob).get(secret.id)).rejects.toEqual(problem(404));
  await expect(listsOf(bob).add(secret.id, { type: 'film', title: 'Mine too' })).rejects.toEqual(problem(404));
  await expect(listsOf(bob).take(secret.id, 1)).rejects.toEqual(problem(404));
  await expect(listsOf(bob).move(secret.id, 1, 'up')).rejects.toEqual(problem(404));
  await expect(listsOf(bob).update(secret.id, { shared: true })).rejects.toEqual(problem(404));
  await expect(listsOf(bob).remove(secret.id)).rejects.toEqual(problem(404));
  expect(await search(db, bob, 'surprise')).toEqual([]);
  expect(await search(db, bob, 'gift')).toEqual([]);
  expect(await shelfOf(bob).list()).toEqual([]);
  const bobs = await splitDownload((await exportEverything(db, bob, clock)).bytes);
  expect(Object.values(bobs.files).join('\n')).not.toMatch(/Surprise|Gift ideas/);
  // The title belongs to Ana alone.
  const surprise = (await listsOf(ana).get(secret.id)).entries[0]!.media_id;
  await expect(shelfOf(bob).get(surprise)).rejects.toEqual(problem(404));
  expect(await search(db, ana, 'surprise')).toHaveLength(1);

  // Shared: Bob sees it, finds it, and can type a title onto it, but cannot change the list itself.
  await listsOf(ana).update(secret.id, { shared: true });
  const seen = (await listsOf(bob).all()).find((l) => l.name === 'Gift ideas')!;
  expect([seen.mine, seen.shared, seen.owner_name]).toEqual([false, true, 'ana']);
  const view = await listsOf(bob).get(secret.id);
  expect(view.entries.map((e) => [e.title, e.owned, e.times, e.can_remove])).toEqual([['A Surprise Film', null, null, true]]); // nothing of Ana's copies or log
  expect(await search(db, bob, 'surprise')).toEqual([expect.objectContaining({ kind: 'list', title: 'A Surprise Film', link: `/media/lists/${secret.id}` })]);
  expect(await search(db, bob, 'gift')).toEqual([expect.objectContaining({ kind: 'list', title: 'Gift ideas' })]);
  const added = await listsOf(bob).add(secret.id, { type: 'show', title: 'Bob picks' });
  expect(added.entries.map((e) => [e.title, e.added_by, e.can_remove])).toEqual([['A Surprise Film', 'ana', true], ['Bob picks', null, true]]);
  expect((await listsOf(ana).get(secret.id)).entries[1]).toMatchObject({ title: 'Bob picks', added_by: 'bob', can_remove: true });
  await expect(listsOf(bob).add(secret.id, { media_id: surprise })).rejects.toEqual(problem(400)); // type it; pick from your own collection only on your own lists
  await expect(listsOf(bob).update(secret.id, { name: 'Mine now' })).rejects.toEqual(problem(403));
  await expect(listsOf(bob).remove(secret.id)).rejects.toEqual(problem(403));
  // It is the household's: Bob can reorder it and take off any title, Ana's too; none of it is in Bob's collection or lists.
  expect(titlesOf(await listsOf(bob).move(secret.id, surprise, 'down'))).toEqual(['Bob picks', 'A Surprise Film']);
  expect(titlesOf(await listsOf(ana).get(secret.id))).toEqual(['Bob picks', 'A Surprise Film']);
  await listsOf(bob).take(secret.id, surprise);
  expect(titlesOf(await listsOf(ana).get(secret.id))).toEqual(['Bob picks']);
  await listsOf(bob).take(secret.id, added.entries[1]!.media_id);
  expect(titlesOf(await listsOf(ana).get(secret.id))).toEqual([]);
  // Wanted is only its owner's.
  const anaWanted = (await listsOf(ana).all()).find((l) => l.builtin === 'wanted')!;
  await expect(listsOf(bob).take(anaWanted.id, 1)).rejects.toEqual(problem(404));
  expect(await shelfOf(bob).list()).toEqual([]);
  expect((await listsOf(bob).all()).filter((l) => l.mine).map((l) => l.count)).toEqual([0, 0]);
  // Unshared again: gone from Bob.
  await listsOf(ana).update(secret.id, { shared: false });
  await expect(listsOf(bob).get(secret.id)).rejects.toEqual(problem(404));
  expect(await search(db, bob, 'surprise')).toEqual([]);
});

it('the download keeps lists, their order and sharing, and titles not owned yet; bringing it in elsewhere restores them, and twice adds nothing', async () => {
  const lists = listsOf(ana);
  const toWatch = (await lists.all()).find((l) => l.builtin === 'to_watch')!;
  await shelfOf(ana).create({ type: 'film', title: 'Alien', year: 1979 }, { format: 'Blu-ray' });
  await lists.add(toWatch.id, { type: 'film', title: 'Stalker', year: 1979, note: 'long' });
  await lists.add(toWatch.id, { type: 'book', title: 'Dune' });
  const mixed = await lists.create({ name: 'Rainy day', shared: true });
  await lists.add(mixed.id, { type: 'game', title: 'Ticket to Ride' });
  await lists.add(mixed.id, { type: 'film', title: 'Spirited Away' });
  const two = await lists.add(mixed.id, { type: 'music', title: 'Rumours', note: 'the vinyl' });
  await lists.move(mixed.id, two.entries[2]!.media_id, 'up'); // Ticket, Rumours, Spirited
  await lists.create({ name: 'Empty one' });
  await listsOf(bob).add(mixed.id, { type: 'book', title: 'Bobs book' });
  await shelfOf(ana).create({ type: 'music', title: 'Blue', wanted: true });

  const zip = await splitDownload((await exportEverything(db, ana, clock)).bytes);
  expect(zip.files['lists.csv']).toContain('Rainy day');
  expect(zip.files['collection.csv']).toContain('Not owned yet');

  // Into a Life Is with nothing in it (a new person there).
  const carl = await person('carl');
  const chosen = ['collection', 'lists'];
  const first = await bringInDownload(db, carl, zip.files, chosen, clock);
  expect(first.kinds.every((k) => k.ok)).toBe(true);
  // Carl also sees Ana's shared Rainy day in his lists; the ones that are his own are what came in.
  const got = (await listsOf(carl).all()).filter((l) => l.mine);
  expect(got.map((l) => [l.name, l.builtin, l.shared, l.count])).toEqual([
    ['Wanted', 'wanted', false, 1], ['To watch, read or hear', 'to_watch', false, 2], ['Rainy day', null, true, 4], ['Empty one', null, false, 0]]);
  const view = (name: string) => listsOf(carl).get(got.find((l) => l.name === name)!.id);
  expect(titlesOf(await view('To watch, read or hear'))).toEqual(['Stalker', 'Dune']);
  expect(titlesOf(await view('Rainy day'))).toEqual(['Ticket to Ride', 'Rumours', 'Spirited Away', 'Bobs book']);
  expect((await view('Rainy day')).entries[1]).toMatchObject({ type: 'music', note: 'the vinyl' });
  expect((await view('To watch, read or hear')).entries[0]).toMatchObject({ year: 1979, note: 'long', owned: false });
  // What is owned is in the collection; what is not owned is not.
  expect((await shelfOf(carl).list()).map((t) => t.title)).toEqual(['Alien']);
  expect(await shelfOf(carl).wantedCount()).toBe(1);

  // Reading it twice adds nothing.
  const again = await bringInDownload(db, carl, zip.files, chosen, clock);
  expect(again.kinds.map((k) => [k.key, k.fresh, k.already])).toEqual([['collection', 0, 8], ['lists', 0, 7]]);
  expect((await listsOf(carl).all()).filter((l) => l.mine)).toEqual(got);
  expect(await db.get('SELECT COUNT(*) AS n FROM media WHERE owner_id = ?', [carl])).toEqual({ n: 8 });
});

it('the listing of what is owned leaves a not-owned title out, and Wanted only shows when asked for', async () => {
  const toWatch = (await listsOf(ana).all()).find((l) => l.builtin === 'to_watch')!;
  const view = await listsOf(ana).add(toWatch.id, { type: 'film', title: 'Stalker' });
  await shelfOf(ana).create({ type: 'film', title: 'Alien' }, { format: 'VHS' });
  expect((await shelfOf(ana).list({})).map((t) => t.title)).toEqual(['Alien']);
  expect((await shelfOf(ana).list({ wanted: true }))).toEqual([]);
  expect(view.entries).toHaveLength(1);
});

it('upgrading from before lists: what was marked wanted is on its owner’s Wanted list, and nothing is deleted or rebuilt', async () => {
  // Put the database back to how version 49 left it (version 51's tables go first).
  await db.run('DROP TABLE plan_food');

  for (const column of ['returned', 'after_trip', 'after_done', 'job_id', 'thaw_pounds']) await db.run(`ALTER TABLE plan_items DROP COLUMN ${column}`);

  for (const column of ['served_at', 'food_kind', 'parts']) await db.run(`ALTER TABLE plans DROP COLUMN ${column}`);
  for (const column of ['every_days', 'every_from']) await db.run(`ALTER TABLE routine_steps DROP COLUMN ${column}`);
  for (const table of ['routine_closed', 'dont_forget_hidden', 'ai_log', 'ai_connections', 'ai_clients']) await db.run(`DROP TABLE ${table}`);
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
  await db.run('PRAGMA user_version = 49');
  const title = async (who: number, name: string, wanted: number) =>
    (await db.run("INSERT INTO media (owner_id, type, title, wanted, created_at, updated_at) VALUES (?, 'film', ?, ?, 'now', 'now')", [who, name, wanted])).lastId;
  const wish = await title(ana, 'Stalker', 1);
  const both = await title(ana, 'Solaris', 1); // wanted, but it has a copy: owned
  await db.run("INSERT INTO media_copies (media_id, format, created_at) VALUES (?, 'DVD', 'now')", [both]);
  await title(ana, 'Alien', 0);
  await title(bob, 'Dune', 1);
  await migrate(db);
  expect((await shelfOf(ana).list()).map((t) => t.title)).toEqual(['Alien', 'Solaris']);
  const wanted = (await listsOf(ana).all()).find((l) => l.builtin === 'wanted')!;
  expect((await listsOf(ana).get(wanted.id)).entries.map((e) => e.title)).toEqual(['Solaris', 'Stalker']); // in alphabetical order
  expect((await listsOf(bob).get((await listsOf(bob).all())[0]!.id)).entries.map((e) => e.title)).toEqual(['Dune']);
  // The mark itself is as it was.
  expect(await db.all('SELECT title, wanted FROM media ORDER BY id')).toEqual([
    { title: 'Stalker', wanted: 1 }, { title: 'Solaris', wanted: 1 }, { title: 'Alien', wanted: 0 }, { title: 'Dune', wanted: 1 }]);
  expect((await shelfOf(ana).get(wish)).unowned).toBe(true);
});

it('on a shared list another person marks a title watched: it is in their own log and comes off the list for everyone', async () => {
  const shared = await listsOf(ana).create({ name: 'Movie night', shared: true });
  const view = await listsOf(ana).add(shared.id, { type: 'film', title: 'Stalker', year: 1979 });
  await listsOf(ana).add(shared.id, { type: 'book', title: 'Dune' });
  const stalker = view.entries[0]!.media_id;
  const after = await listsOf(bob).watched(shared.id, stalker, '2046-03-05');
  expect(titlesOf(after)).toEqual(['Dune']);
  expect(titlesOf(await listsOf(ana).get(shared.id))).toEqual(['Dune']);
  // It is in Bob's log, on his own shelf, and not in his Collection; Ana's log has nothing.
  expect(await db.all('SELECT m.owner_id, m.title, m.listed_only, l.day FROM media_log l JOIN media m ON m.id = l.media_id')).toEqual([
    { owner_id: bob, title: 'Stalker', listed_only: 1, day: '2046-03-05' },
  ]);
  expect(await shelfOf(bob).list()).toEqual([]);
  // Ana's own record of it was only for the list, so nothing is left of it on her side.
  expect(await db.all('SELECT id FROM media WHERE owner_id = ? AND title = ?', [ana, 'Stalker'])).toEqual([]);
  // Bob watching a title he already keeps logs that one.
  const own = await shelfOf(bob).create({ type: 'book', title: 'Dune' });
  await listsOf(bob).watched(shared.id, (await listsOf(ana).get(shared.id)).entries[0]!.media_id, '2046-03-06');
  expect((await shelfOf(bob).get(own.id)).log.map((l) => l.day)).toEqual(['2046-03-06']);
  expect(titlesOf(await listsOf(ana).get(shared.id))).toEqual([]);
  // A private list of his own keeps the title on it; Wanted cannot be watched.
  const privateList = await listsOf(bob).create({ name: 'Mine' });
  const one = (await listsOf(bob).add(privateList.id, { type: 'film', title: 'Alien' })).entries[0]!.media_id;
  expect(titlesOf(await listsOf(bob).watched(privateList.id, one, '2046-03-07'))).toEqual(['Alien']);
  const wanted = (await listsOf(bob).all()).find((l) => l.builtin === 'wanted')!;
  await expect(listsOf(bob).watched(wanted.id, one, '2046-03-07')).rejects.toEqual(problem(400));
});

it('on a shared list others can reorder and take off any title, but not rename, stop sharing or delete it', async () => {
  const shared = await listsOf(ana).create({ name: 'Family picks', shared: true });
  for (const title of ['One', 'Two', 'Three']) await listsOf(ana).add(shared.id, { type: 'film', title });
  const ids = (await listsOf(bob).get(shared.id)).entries.map((e) => e.media_id);
  expect(titlesOf(await listsOf(bob).move(shared.id, ids[2]!, 'up'))).toEqual(['One', 'Three', 'Two']);
  expect(titlesOf(await listsOf(bob).take(shared.id, ids[0]!))).toEqual(['Three', 'Two']);
  await expect(listsOf(bob).update(shared.id, { name: 'Bob’s' })).rejects.toEqual(problem(403));
  await expect(listsOf(bob).update(shared.id, { shared: false })).rejects.toEqual(problem(403));
  await expect(listsOf(bob).remove(shared.id)).rejects.toEqual(problem(403));
  expect((await listsOf(ana).get(shared.id)).shared).toBe(true);
});
