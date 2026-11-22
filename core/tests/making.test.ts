/** The things you keep, and the projects that use them. */
import { beforeEach, expect, it } from 'vitest';
import type { Db } from '../src/db.ts';
import { inventory, type Inventory, type Kind } from '../src/inventory.ts';
import { LATEST, migrate } from '../src/migrations.ts';
import { projects, type Projects } from '../src/projects.ts';
import { memoryDb } from './memoryDb.ts';

let db: Db;
let things: Inventory;
let making: Projects;
let time = new Date(2046, 2, 5, 10, 0, 0);
const clock = () => time;

async function person(name: string): Promise<number> {
  return (await db.run("INSERT INTO users (username, password_hash, created_at) VALUES (?, 'x', 'now')", [name])).lastId;
}

beforeEach(async () => {
  db = memoryDb();
  expect(await migrate(db)).toBe(LATEST);
  const owner = await person('owner');
  time = new Date(2046, 2, 5, 10, 0, 0);
  things = inventory(db, owner, clock);
  making = projects(db, owner, clock);
});

const problem = (status: number) => expect.objectContaining({ name: 'Problem', status });
const kindNamed = (kinds: Kind[], name: string) => kinds.find((k) => k.name === name)!;
const fieldId = (kind: Kind, name: string) => String(kind.fields.find((f) => f.name === name)!.id);

// ---------- kinds and fields: the person's own ----------

it('a kind of thing is whatever the person says it is', async () => {
  let kinds = await things.createKind({ name: 'Board games', icon: '🎲', fields: [
    { name: 'Players', type: 'text' }, { name: 'Minutes', type: 'number', unit: 'min' },
    { name: 'Shelf wear', type: 'choice', choices: ['None', 'Some', ' some ', 'A lot'] }, { name: 'Complete', type: 'yesno' },
  ] });
  const games = kindNamed(kinds, 'Board games');
  expect(games.fields.map((f) => [f.name, f.type, f.unit, f.choices])).toEqual([
    ['Players', 'text', null, []], ['Minutes', 'number', 'min', []], ['Shelf wear', 'choice', null, ['None', 'Some', 'A lot']], ['Complete', 'yesno', null, []]]);

  // Names that are the same apart from capitals and spaces are the same name; any alphabet is a name.
  await expect(things.createKind({ name: '  board   GAMES ' })).rejects.toEqual(problem(409));
  await expect(things.createKind({ name: ' ' })).rejects.toEqual(problem(400));
  expect(kindNamed(await things.createKind({ name: '布地' }), '布地').name).toBe('布地');
  await expect(things.createKind({ name: 'Bad', fields: [{ name: 'Colour', type: 'choice' }] })).rejects.toEqual(problem(400));
  expect((await things.listKinds()).map((k) => k.name)).toEqual(['Board games', '布地']); // the refused one left nothing behind

  kinds = await things.addField(games.id, { name: 'Bought on', type: 'date' });
  await expect(things.addField(games.id, { name: 'players', type: 'text' })).rejects.toEqual(problem(409));
  const minutes = kindNamed(kinds, 'Board games').fields.find((f) => f.name === 'Minutes')!;
  kinds = await things.updateField(minutes.id, { name: 'Play time', unit: 'minutes' });
  expect(kindNamed(kinds, 'Board games').fields.find((f) => f.id === minutes.id)).toMatchObject({ name: 'Play time', type: 'number', unit: 'minutes' });
  kinds = await things.updateKind(games.id, { name: 'Games', unit: 'boxes' });
  expect(kindNamed(kinds, 'Games')).toMatchObject({ icon: '🎲', unit: 'box' });
});

it('a thing holds a value for each of its kind\'s fields, checked by what the field is', async () => {
  const games = kindNamed(await things.createKind({ name: 'Games', fields: [
    { name: 'Players', type: 'text' }, { name: 'Minutes', type: 'number' }, { name: 'Wear', type: 'choice', choices: ['None', 'Some'] },
    { name: 'Complete', type: 'yesno' }, { name: 'Bought on', type: 'date' }, { name: 'Rules', type: 'link' },
  ] }), 'Games');
  const f = (name: string) => fieldId(games, name);
  const made = await things.createItem({ kind_id: games.id, name: ' Carcassonne ', quantity: 1, values: {
    [f('Players')]: '2–5', [f('Minutes')]: '45', [f('Wear')]: 'some', [f('Complete')]: false, [f('Bought on')]: '2040-12-25', [f('Rules')]: '',
  } });
  expect(made).toMatchObject({ name: 'Carcassonne', kind: 'Games', amount: '1', place: null, low: false, set_aside: 0, free: 1 });
  expect(made.values).toEqual({ [f('Players')]: '2–5', [f('Minutes')]: 45, [f('Wear')]: 'Some', [f('Complete')]: false, [f('Bought on')]: '2040-12-25' });

  const base = { kind_id: games.id, name: 'x' };
  await expect(things.createItem({ ...base, values: { [f('Minutes')]: 'a while' } })).rejects.toEqual(problem(400));
  await expect(things.createItem({ ...base, values: { [f('Wear')]: 'Ruined' } })).rejects.toEqual(problem(400));
  await expect(things.createItem({ ...base, values: { [f('Complete')]: 'yes' } })).rejects.toEqual(problem(400));
  await expect(things.createItem({ ...base, values: { [f('Bought on')]: 'Christmas' } })).rejects.toEqual(problem(400));
  await expect(things.createItem({ ...base, values: { 9999: 'x' } })).rejects.toEqual(problem(400));
  await expect(things.createItem({ ...base, quantity: -1 })).rejects.toEqual(problem(400));
  await expect(things.createItem({ kind_id: 9999, name: 'x' })).rejects.toEqual(problem(404));
  expect(await things.listItems()).toHaveLength(1);

  // Changing a thing replaces its values; a value left out is no value.
  const changed = await things.updateItem(made.id, { name: 'Carcassonne', values: { [f('Players')]: '2–5' } });
  expect([changed.amount, changed.values]).toEqual(['some', { [f('Players')]: '2–5' }]);

  // Taking a field away takes its values with it, and nothing else. A kind with things in it can't be removed.
  await things.deleteField(Number(f('Players')));
  expect((await things.getItem(made.id)).values).toEqual({});
  await expect(things.deleteKind(games.id)).rejects.toEqual(problem(409));
  await things.deleteItem(made.id);
  expect(await things.deleteKind(games.id)).toEqual([]);
});

it('ready-made sets save typing, and never touch what is already there', async () => {
  await things.createKind({ name: 'fabric', fields: [{ name: 'My own field', type: 'text' }] });
  const offered = (await things.listStarters()).find((s) => s.slug === 'sewing')!;
  expect(offered.kinds.map((k) => [k.name, k.have])).toEqual([['Fabric', true], ['Notions', false], ['Sewing patterns', false]]);
  const kinds = await things.addStarter('sewing');
  expect(kinds.map((k) => k.name)).toEqual(['fabric', 'Notions', 'Sewing patterns']);
  expect(kindNamed(kinds, 'fabric').fields.map((f) => f.name)).toEqual(['My own field']);
  expect(kindNamed(kinds, 'Notions').fields.find((f) => f.name === 'Type')!.choices).toContain('Zipper');
  expect(await things.addStarter('sewing')).toEqual(kinds); // adding it twice changes nothing
  await expect(things.addStarter('alchemy')).rejects.toEqual(problem(404));
  // Every ready-made set can be added whole.
  for (const starter of await things.listStarters()) await things.addStarter(starter.slug);
});

// ---------- places ----------

it('places sit inside places, and a thing in a bin is found from the room', async () => {
  let places = await things.createPlace({ name: 'Sewing room' });
  const room = places[0]!.id;
  places = await things.createPlace({ name: 'Shelf 2', parent_id: room });
  const shelf = places.find((p) => p.name === 'Shelf 2')!.id;
  places = await things.createPlace({ name: 'Bin A', parent_id: shelf, note: 'clear lid' });
  const bin = places.find((p) => p.name === 'Bin A')!.id;
  await things.createPlace({ name: 'Garage' });
  expect((await things.listPlaces()).map((p) => p.path)).toEqual(['Garage', 'Sewing room', 'Sewing room › Shelf 2', 'Sewing room › Shelf 2 › Bin A']);

  const fabric = kindNamed(await things.addStarter('sewing'), 'Fabric');
  const linen = await things.createItem({ kind_id: fabric.id, name: 'Blue linen', quantity: 5, place_id: bin });
  await things.createItem({ kind_id: fabric.id, name: 'Canvas', quantity: 2 });
  expect([linen.place, linen.amount]).toEqual(['Sewing room › Shelf 2 › Bin A', '5 yd']); // the kind's unit, when none is given
  expect((await things.listItems({ place_id: room })).map((i) => i.name)).toEqual(['Blue linen']);
  expect((await things.listPlaces()).find((p) => p.id === bin)!.items).toBe(1);

  await expect(things.updatePlace(room, { name: 'Sewing room', parent_id: bin })).rejects.toEqual(problem(400)); // inside itself
  await expect(things.createPlace({ name: 'Nowhere', parent_id: 9999 })).rejects.toEqual(problem(404));
  await expect(things.createItem({ kind_id: fabric.id, name: 'x', place_id: 9999 })).rejects.toEqual(problem(404));

  // Removing the shelf: the bin moves up into the room, and the linen is still in the bin.
  await things.deletePlace(shelf);
  expect((await things.getItem(linen.id)).place).toBe('Sewing room › Bin A');
  await things.deletePlace(bin);
  expect((await things.getItem(linen.id)).place).toBeNull();
});

it('things are found by name, by note, and by what was typed into their fields', async () => {
  const kinds = await things.addStarter('sewing');
  const fabric = kindNamed(kinds, 'Fabric');
  const notions = kindNamed(kinds, 'Notions');
  await things.createItem({ kind_id: fabric.id, name: 'Blue linen', quantity: 5, low_at: 1, values: { [fieldId(fabric, 'Fiber')]: 'Flax' } });
  await things.createItem({ kind_id: fabric.id, name: 'Canvas', quantity: 0.5, low_at: 1, note: 'for the tote bag' });
  await things.createItem({ kind_id: notions.id, name: 'Zips', quantity: 3, values: { [fieldId(notions, 'Color')]: 'navy blue' } });
  const names = async (find: Parameters<Inventory['listItems']>[0]) => (await things.listItems(find)).map((i) => i.name);
  expect(await names({ q: 'blue' })).toEqual(['Blue linen', 'Zips']);
  expect(await names({ q: 'flax' })).toEqual(['Blue linen']);
  expect(await names({ q: 'tote' })).toEqual(['Canvas']);
  expect(await names({ kind_id: notions.id })).toEqual(['Zips']);
  expect(await names({ low: true })).toEqual(['Canvas']);
});

// ---------- projects ----------

async function sewingRoom() {
  const kinds = await things.addStarter('sewing');
  const fabric = kindNamed(kinds, 'Fabric');
  return {
    linen: await things.createItem({ kind_id: fabric.id, name: 'Blue linen', quantity: 5 }),
    thread: await things.createItem({ kind_id: kindNamed(kinds, 'Notions').id, name: 'Navy thread' }), // "some"
    pattern: await things.createItem({ kind_id: kindNamed(kinds, 'Sewing patterns').id, name: 'Shirt dress pattern', quantity: 1 }),
    elastic: await things.createItem({ kind_id: kindNamed(kinds, 'Notions').id, name: 'Elastic', quantity: 2, unit: 'm' }),
  };
}

it('a project sets aside what it needs, and says what it is short of', async () => {
  const { linen, thread, pattern, elastic } = await sewingRoom();
  let dress = await making.createProject({ name: 'Shirt dress', activity: 'Sewing', status: 'planned', due_on: '2046-04-01' });
  dress = await making.addLine(dress.id, { item_id: linen.id, quantity: 3 });
  dress = await making.addLine(dress.id, { item_id: pattern.id }); // referred to, not used up
  dress = await making.addLine(dress.id, { item_id: thread.id, quantity: 1, unit: 'spool' });
  dress = await making.addLine(dress.id, { label: '9 inch zip', quantity: 1 }); // not one of your things yet
  dress = await making.addLine(dress.id, { item_id: elastic.id, quantity: 18, unit: 'in' }); // inches from metres
  expect(dress.lines.map((l) => [l.label, l.amount, l.have, l.short])).toEqual([
    ['Blue linen', '3 yd', '5 yd', 0], ['Shirt dress pattern', '', '1', null], ['Navy thread', '1 spool', 'some', null],
    ['9 inch zip', '1', null, 1], ['Elastic', '18 in', '2 m', 0]]);
  expect(dress.short_count).toBe(1);
  expect(await things.getItem(linen.id)).toMatchObject({ quantity: 5, set_aside: 3, free: 2 });
  expect((await things.getItem(elastic.id)).set_aside).toBeCloseTo(0.4572);

  // A second project can't count on the same cloth: it wants 3 yd, and only 2 are free.
  let shirt = await making.createProject({ name: 'Linen shirt', activity: 'sewing', status: 'active' });
  shirt = await making.addLine(shirt.id, { item_id: linen.id, quantity: 3 });
  expect([shirt.lines[0]!.short, shirt.lines[0]!.short_text, shirt.started_on]).toEqual([1, '1 yd', '2046-03-05']);
  expect((await making.getProject(dress.id)).lines[0]!.short).toBe(1); // and now each is short by the one yard they share
  expect((await things.getItem(linen.id)).free).toBe(0);

  // An idea sets nothing aside, but still says what it would be short of.
  let someday = await making.createProject({ name: 'Curtains' });
  someday = await making.addLine(someday.id, { item_id: linen.id, quantity: 4 });
  expect([someday.status, someday.lines[0]!.short]).toEqual(['idea', 4]);
  expect((await things.getItem(linen.id)).set_aside).toBe(6);

  expect((await making.listProjects()).map((p) => [p.name, p.status, p.short_count])).toEqual([
    ['Linen shirt', 'active', 1], ['Shirt dress', 'planned', 2], ['Curtains', 'idea', 1]]);
  expect(await making.listActivities()).toEqual(['Sewing']);
  expect((await making.listProjects({ activity: 'SEWING' })).map((p) => p.name)).toEqual(['Linen shirt', 'Shirt dress']);

  // Dropping the shirt frees its cloth.
  await making.updateProject(shirt.id, { name: 'Linen shirt', activity: 'Sewing', status: 'dropped' });
  expect((await things.getItem(linen.id)).free).toBe(2);
  expect((await making.getProject(dress.id)).lines[0]!.short).toBe(0);

  await expect(making.addLine(dress.id, { item_id: 9999, quantity: 1 })).rejects.toEqual(problem(404));
  await expect(making.addLine(dress.id, { quantity: 1 })).rejects.toEqual(problem(400));
  await expect(making.addLine(dress.id, { item_id: linen.id, quantity: 0 })).rejects.toEqual(problem(400));
  await expect(making.createProject({ name: 'x', status: 'someday' })).rejects.toEqual(problem(400));
});

it('using a line, or finishing, takes what was used out of what you keep', async () => {
  const { linen, thread, elastic } = await sewingRoom();
  let dress = await making.createProject({ name: 'Shirt dress', status: 'active' });
  dress = await making.addLine(dress.id, { item_id: linen.id, quantity: 3 });
  dress = await making.addLine(dress.id, { item_id: thread.id, quantity: 1, unit: 'spool' });
  dress = await making.addLine(dress.id, { item_id: elastic.id, quantity: 18, unit: 'in' });
  dress = await making.addLine(dress.id, { label: '9 inch zip', quantity: 1 });

  const cut = await making.useLine(dress.lines[0]!.id); // the cloth is cut
  expect([cut.taken, cut.lines[0]!.used_on, cut.lines[0]!.short]).toEqual([true, '2046-03-05', null]);
  expect(await things.getItem(linen.id)).toMatchObject({ quantity: 2, set_aside: 0, free: 2 });
  await expect(making.useLine(dress.lines[0]!.id)).rejects.toEqual(problem(409));
  await expect(making.updateLine(dress.lines[0]!.id, { quantity: 1 })).rejects.toEqual(problem(409));
  expect((await making.updateLine(dress.lines[2]!.id, { quantity: 1, unit: 'm', note: 'waist' })).lines[2]).toMatchObject({ amount: '1 m', note: 'waist' });

  time = new Date(2046, 2, 20, 21, 0, 0);
  const done = await making.updateProject(dress.id, { name: 'Shirt dress', status: 'done' });
  expect([done.status, done.finished_on, done.check_by_hand]).toEqual(['done', '2046-03-20', ['Navy thread']]); // "some" thread: can't be taken away
  expect(done.lines.every((l) => l.used_on !== null && l.short === null)).toBe(true);
  expect((await things.getItem(elastic.id)).quantity).toBe(1);
  expect((await things.getItem(linen.id)).quantity).toBe(2); // not taken twice

  // Removing a thing leaves its name on the projects that used it.
  await things.deleteItem(linen.id);
  expect((await making.getProject(dress.id)).lines[0]).toMatchObject({ label: 'Blue linen', item_id: null, have: null });
});

it('time spent is kept by the day, for the calendar', async () => {
  let dress = await making.createProject({ name: 'Shirt dress', activity: 'Sewing' });
  dress = await making.addSession(dress.id, { day: '2046-03-05', minutes: 90, note: 'Cut out. Watched Alien.' });
  dress = await making.addSession(dress.id, { day: '2046-03-07', minutes: 45 });
  dress = await making.addSession(dress.id, { day: '2046-03-12' });
  expect([dress.minutes, dress.sessions_count, dress.sessions.map((s) => s.day)]).toEqual([135, 3, ['2046-03-12', '2046-03-07', '2046-03-05']]);
  expect((await making.sessionsBetween('2046-03-05', '2046-03-11')).map((s) => [s.day, s.project, s.activity, s.minutes])).toEqual([
    ['2046-03-05', 'Shirt dress', 'Sewing', 90], ['2046-03-07', 'Shirt dress', 'Sewing', 45]]);
  await expect(making.addSession(dress.id, { day: 'Tuesday' })).rejects.toEqual(problem(400));
  await expect(making.addSession(dress.id, { day: '2046-03-05', minutes: 2000 })).rejects.toEqual(problem(400));
  await making.deleteSession(dress.sessions[0]!.id);
  expect((await making.getProject(dress.id)).sessions_count).toBe(2);
});

it("each person has their own things and projects", async () => {
  const { linen } = await sewingRoom();
  const dress = await making.addLine((await making.createProject({ name: 'Shirt dress', status: 'active' })).id, { item_id: linen.id, quantity: 3 });
  const place = (await things.createPlace({ name: 'Sewing room' }))[0]!;
  const session = (await making.addSession(dress.id, { day: '2046-03-05' })).sessions[0]!;

  const other = await person('other');
  const theirThings = inventory(db, other, clock);
  const theirMaking = projects(db, other, clock);
  expect([await theirThings.listKinds(), await theirThings.listItems(), await theirThings.listPlaces(), await theirMaking.listProjects()]).toEqual([[], [], [], []]);
  await expect(theirThings.getItem(linen.id)).rejects.toEqual(problem(404));
  await expect(theirThings.updateItem(linen.id, { name: 'Mine now' })).rejects.toEqual(problem(404));
  await expect(theirThings.createItem({ kind_id: linen.kind_id, name: 'x' })).rejects.toEqual(problem(404));
  await expect(theirThings.addField(linen.kind_id, { name: 'x', type: 'text' })).rejects.toEqual(problem(404));
  await expect(theirThings.deleteKind(linen.kind_id)).rejects.toEqual(problem(404));
  await expect(theirThings.updatePlace(place.id, { name: 'Mine now' })).rejects.toEqual(problem(404));
  await expect(theirThings.createPlace({ name: 'Inside theirs', parent_id: place.id })).rejects.toEqual(problem(404));
  await expect(theirMaking.getProject(dress.id)).rejects.toEqual(problem(404));
  await expect(theirMaking.addLine(dress.id, { label: 'x' })).rejects.toEqual(problem(404));
  await expect(theirMaking.useLine(dress.lines[0]!.id)).rejects.toEqual(problem(404));
  const theirs = await theirMaking.createProject({ name: 'Theirs' });
  await expect(theirMaking.addLine(theirs.id, { item_id: linen.id, quantity: 1 })).rejects.toEqual(problem(404));
  // Deleting by someone else's id does nothing.
  await theirThings.deleteItem(linen.id);
  await theirThings.deletePlace(place.id);
  await theirMaking.deleteProject(dress.id);
  await theirMaking.deleteSession(session.id);
  expect(await things.getItem(linen.id)).toMatchObject({ name: 'Blue linen', set_aside: 3 });
  expect([(await things.listPlaces()).length, (await making.getProject(dress.id)).sessions_count]).toEqual([1, 1]);
});

it('each place has a sticker code that stays the same and finds it again', async () => {
  const { inventory: things2, stickerCode } = await import('../src/inventory.ts');
  const mine = things;
  await mine.createPlace({ name: 'Sewing room' });
  const room = (await mine.listPlaces())[0]!;
  await mine.createPlace({ name: 'Bin A', parent_id: room.id });
  const first = await mine.stickers();
  expect(first.map((s) => [s.path, /^[2-9A-HJ-NP-Z]{10}$/.test(s.code)])).toEqual([['Sewing room', true], ['Sewing room › Bin A', true]]);
  expect(new Set(first.map((s) => s.code)).size).toBe(2);
  expect(await mine.stickers()).toEqual(first); // asked again: the same codes, so printed stickers stay good

  const bin = first[1]!;
  // Whatever address the sticker was printed with, and however the scanner reports it.
  for (const read of [bin.code, bin.code.toLowerCase(), `https://lifeis.example/p/${bin.code}`, `http://192.168.1.5:8020/p/${bin.code}/`]) {
    expect(await mine.placeForSticker(read)).toEqual({ id: bin.id, name: 'Bin A', path: 'Sewing room › Bin A' });
  }
  expect([stickerCode('9780441172719'), stickerCode('https://example.com/other'), stickerCode(`https://x/p/${bin.code}0`)]).toEqual([null, null, null]);
  await expect(mine.placeForSticker('AAAAAAAAAA')).rejects.toMatchObject({ status: 404 });
  // Someone else scanning your sticker learns nothing.
  const other = (await db.run("INSERT INTO users (username, password_hash, created_at) VALUES ('nosy', 'x', 'now')")).lastId;
  await expect(things2(db, other, clock).placeForSticker(bin.code)).rejects.toMatchObject({ status: 404 });
});

it('a project has a budget: what each thing is planned to cost, and what it came to once paid', async () => {
  let dress = await making.createProject({ name: 'Shirt dress', activity: 'Sewing' });
  expect(dress.budget).toEqual({ currency: '$', planned: 0, spent: 0, expected: 0, left: 0, unpaid: 0 });
  dress = await making.addCost(dress.id, { label: 'Linen, 3 yd', planned_cents: 4500 });
  dress = await making.addCost(dress.id, { label: 'Buttons', planned_cents: 800, note: 'shell, 12' });
  dress = await making.addCost(dress.id, { label: 'Pattern' }); // no idea yet what it costs
  expect(dress.costs.map((c) => [c.label, c.planned_cents, c.paid_on])).toEqual([['Linen, 3 yd', 4500, null], ['Buttons', 800, null], ['Pattern', null, null]]);
  expect(dress.budget).toMatchObject({ planned: 5300, spent: 0, expected: 5300, left: 0, unpaid: 3 });

  // The linen cost more than planned; the buttons cost what was planned.
  dress = await making.payCost(dress.costs[0]!.id, 5200);
  dress = await making.payCost(dress.costs[1]!.id);
  expect(dress.costs.map((c) => [c.actual_cents, c.paid_on])).toEqual([[5200, '2046-03-05'], [800, '2046-03-05'], [null, null]]);
  expect(dress.budget).toMatchObject({ planned: 5300, spent: 6000, expected: 6000, left: -700, unpaid: 1 });

  // A correction keeps it paid; un-paying goes back to the plan; a line can go.
  dress = await making.updateCost(dress.costs[0]!.id, { actual_cents: 5000 });
  expect([dress.costs[0]!.actual_cents, dress.costs[0]!.paid_on, dress.budget.left]).toEqual([5000, '2046-03-05', -500]);
  dress = await making.unpayCost(dress.costs[0]!.id);
  expect([dress.costs[0]!.actual_cents, dress.budget.spent, dress.budget.left]).toEqual([null, 800, 0]);
  dress = await making.removeCost(dress.costs[2]!.id);
  expect(dress.costs).toHaveLength(2);

  await expect(making.addCost(dress.id, { label: '  ' })).rejects.toMatchObject({ status: 400 });
  await expect(making.addCost(dress.id, { label: 'Zip', planned_cents: -1 })).rejects.toMatchObject({ status: 422 });
  // Somebody else's project and its costs are not there to be touched.
  const other = projects(db, (await db.run("INSERT INTO users (username, password_hash, created_at) VALUES ('other', 'x', 'now')")).lastId, clock);
  await expect(other.addCost(dress.id, { label: 'Mine now' })).rejects.toMatchObject({ status: 404 });
  await expect(other.payCost(dress.costs[0]!.id)).rejects.toMatchObject({ status: 404 });
  // Removing the project takes its costs with it.
  await making.deleteProject(dress.id);
  expect((await db.get<{ n: number }>('SELECT COUNT(*) AS n FROM project_costs'))!.n).toBe(0);
});
