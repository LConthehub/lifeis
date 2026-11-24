/** Things kept at home: no longer have it, insured, asset numbers, and your own fields. */
import { beforeEach, expect, it } from 'vitest';
import type { Db } from '../src/db.ts';
import { assetLabel, assetNumber, inventory, type Inventory } from '../src/inventory.ts';
import { LATEST, MIGRATIONS, migrate } from '../src/migrations.ts';
import { reminders } from '../src/reminders.ts';
import { search } from '../src/search.ts';
import { memoryDb } from './memoryDb.ts';

let db: Db;
let owner: number;
let things: Inventory;
let kind: number;
let time = new Date(2046, 2, 5, 10, 0, 0);
const clock = () => time;
const problem = (status: number) => expect.objectContaining({ name: 'Problem', status });

async function person(name: string): Promise<number> {
  return (await db.run("INSERT INTO users (username, password_hash, created_at) VALUES (?, 'x', 'now')", [name])).lastId;
}

beforeEach(async () => {
  db = memoryDb();
  expect(await migrate(db)).toBe(LATEST);
  owner = await person('owner');
  time = new Date(2046, 2, 5, 10, 0, 0);
  things = inventory(db, owner, clock);
  kind = (await things.createKind({ name: 'Household' }))[0]!.id;
});

const names = async (find = {}) => (await things.listItems(find)).map((t) => t.name);

it('a thing that is gone leaves the lists, search, totals and place counts, stays on file, and comes back when undone', async () => {
  const room = (await things.createPlace({ name: 'Den' }))[0]!.id;
  const tv = await things.createItem({ kind_id: kind, name: 'Television', place_id: room, records: { price_cents: 50000, warranty_until: '2046-04-04' } });
  await things.createItem({ kind_id: kind, name: 'Lamp', place_id: room, records: { price_cents: 2000 } });
  expect((await things.listPlaces())[0]!.items).toBe(2);

  const gone = await things.letGo(tv.id, { how: 'sold', day: '2046-03-01', to: 'A neighbor', price_cents: 12000 });
  expect(gone.gone).toEqual({ on: '2046-03-01', how: 'sold', to: 'A neighbor', cents: 12000 });
  expect(await names()).toEqual(['Lamp']);
  expect(await names({ gone: true })).toEqual(['Television']);
  expect(await names({ q: 'television' })).toEqual([]);
  expect(await names({ q: 'television', gone: true })).toEqual(['Television']);
  expect((await search(db, owner, 'television')).map((r) => r.title)).toEqual([]);
  expect((await things.listPlaces())[0]!.items).toBe(1);
  expect((await things.listKinds())[0]!.items).toBe(1);
  const report = await things.homeReport();
  expect([report.things, report.worth_cents, report.rooms[0]!.lines.map((l) => l.name), report.warranties]).toEqual([1, 2000, ['Lamp'], []]);
  // The record is still there to open, and the warranty no longer reminds anyone.
  expect((await things.getItem(tv.id)).gone!.how).toBe('sold');
  expect((await reminders(db, owner, clock).digest()).lines.map((l) => l.title)).toEqual([]);
  await expect(things.deleteKind(kind)).rejects.toEqual(problem(409));
  await expect(things.letGo(tv.id, { how: 'sold' })).rejects.toEqual(problem(409));

  const back = await things.takeBack(tv.id);
  expect([back.gone, back.place]).toEqual([null, 'Den']);
  expect(await names()).toEqual(['Lamp', 'Television']);
  expect(await names({ gone: true })).toEqual([]);
  expect((await things.listPlaces())[0]!.items).toBe(2);
  expect((await reminders(db, owner, clock).digest()).lines.map((l) => l.title)).toEqual(['Warranty: Television']);
});

it('says what is wrong when a thing is let go badly, and keeps nothing of another person', async () => {
  const lamp = await things.createItem({ kind_id: kind, name: 'Lamp' });
  await expect(things.letGo(lamp.id, { how: 'lost' })).rejects.toEqual(problem(400));
  await expect(things.letGo(lamp.id, { how: 'sold', day: 'soon' })).rejects.toEqual(problem(400));
  await expect(things.letGo(lamp.id, { how: 'sold', price_cents: -5 })).rejects.toEqual(problem(400));
  await expect(things.letGo(lamp.id, { how: 'sold', price_cents: 1.5 })).rejects.toEqual(problem(400));
  const other = inventory(db, await person('other'), clock);
  await expect(other.letGo(lamp.id, { how: 'sold' })).rejects.toEqual(problem(404));
  await expect(other.takeBack(lamp.id)).rejects.toEqual(problem(404));
  // With no day given it is today, and "to" and the price are optional.
  const done = await things.letGo(lamp.id, { how: 'thrown' });
  expect(done.gone).toEqual({ on: '2046-03-05', how: 'thrown', to: null, cents: null });
  // A thing that is gone can still be changed (its record, its notes) and stays gone.
  const edited = await things.updateItem(lamp.id, { name: 'Lamp', note: 'Broke' });
  expect([edited.note, edited.gone!.how]).toEqual(['Broke', 'thrown']);
});

it('the report can show only the insured things, and says how many are insured', async () => {
  const room = (await things.createPlace({ name: 'Den' }))[0]!.id;
  const tv = await things.createItem({ kind_id: kind, name: 'Television', place_id: room, insured: true, records: { price_cents: 50000 } });
  await things.createItem({ kind_id: kind, name: 'Lamp', place_id: room, records: { price_cents: 2000 } });
  const ring = await things.createItem({ kind_id: kind, name: 'Ring', insured: true, records: { value_cents: 90000 } });
  expect([tv.insured, (await things.getItem(ring.id)).insured]).toEqual([true, true]);
  const all = await things.homeReport();
  expect([all.things, all.insured, all.shown.things]).toEqual([3, 2, 3]);
  const only = await things.homeReport({ insured_only: true });
  expect(only.rooms.flatMap((r) => r.lines.map((l) => [l.name, l.insured]))).toEqual([['Television', true], ['Ring', true]]);
  expect([only.shown.things, only.shown.worth_cents, only.things]).toEqual([2, 140000, 3]);
  const csv = (await things.homeReportCsv({ insured_only: true })).text;
  expect(csv).toContain('Television');
  expect(csv).not.toContain('Lamp');
  expect(csv).toMatch(/,000-001,yes\r\n/);
  // Left out in an edit, it stays; said, it changes. A gone thing is not counted.
  expect((await things.updateItem(tv.id, { name: 'Television' })).insured).toBe(true);
  expect((await things.updateItem(tv.id, { name: 'Television', insured: false })).insured).toBe(false);
  await things.letGo(ring.id, { how: 'stolen' });
  expect((await things.homeReport({ insured_only: true })).rooms).toEqual([]);
});

it('a warranty is said a month before, then a week, a day, and the day it ends', async () => {
  await things.createItem({ kind_id: kind, name: 'Television', records: { warranty_until: '2046-04-04' } });
  const titles = async () => (await reminders(db, owner, clock).digest()).lines.map((l) => [l.title, l.detail]);
  expect(await titles()).toEqual([['Warranty: Television', 'ends in 30 days · anything wrong with it?']]);
  time = new Date(2046, 2, 6, 10, 0, 0);
  expect(await titles()).toEqual([]);
  time = new Date(2046, 3, 4, 10, 0, 0);
  expect(await titles()).toEqual([['Warranty: Television', 'ends today · anything wrong with it?']]);
});

it('asset numbers are given in order, written 000-001, never reused for another thing and found by search', async () => {
  const a = await things.createItem({ kind_id: kind, name: 'Television' });
  const b = await things.createItem({ kind_id: kind, name: 'Lamp' });
  const c = await things.createItem({ kind_id: kind, name: 'Kettle' });
  expect([a.asset_no, b.asset_no, c.asset_no]).toEqual(['000-001', '000-002', '000-003']);
  // Another person counts from their own 1.
  const other = inventory(db, await person('other'), clock);
  const k2 = (await other.createKind({ name: 'Things' }))[0]!.id;
  expect((await other.createItem({ kind_id: k2, name: 'Spoon' })).asset_no).toBe('000-001');
  // Editing keeps the number; one that is gone keeps it too, and the next thing goes on from the last.
  expect((await things.updateItem(b.id, { name: 'Lamp, tall' })).asset_no).toBe('000-002');
  await things.letGo(c.id, { how: 'given' });
  expect((await things.createItem({ kind_id: kind, name: 'Toaster' })).asset_no).toBe('000-004');
  // Typing the number finds the thing, whole or in part; the search page does too.
  expect(await names({ q: '000-002' })).toEqual(['Lamp, tall']);
  expect(await names({ q: '000-00' })).toEqual(['Lamp, tall', 'Television', 'Toaster']);
  expect((await search(db, owner, '000-004')).map((r) => r.title)).toEqual(['Toaster']);
  expect((await search(db, owner, '000-003')).map((r) => r.title)).toEqual([]); // gone
  expect(await names({ q: '000-003', gone: true })).toEqual(['Kettle']);
  // Its sticker carries it.
  expect((await things.thingStickers([a.id]))[0]).toMatchObject({ name: 'Television', asset_no: '000-001' });
  expect([assetLabel(1), assetLabel(1234), assetNumber('000-012'), assetNumber('1-2'), assetNumber('nope')]).toEqual(['000-001', '001-234', 12, 1002, null]);
});

it('things that were already kept are numbered when the database is upgraded, in the order they were made', async () => {
  // A database as version 47 left it, with things of two people.
  const old = memoryDb();
  for (const m of MIGRATIONS.filter((x) => x.number <= 47)) {
    for (const statement of m.statements) await old.run(statement);
  }
  await old.run('PRAGMA user_version = 47');
  const one = (await old.run("INSERT INTO users (username, password_hash, created_at) VALUES ('one', 'x', 'now')")).lastId;
  const two = (await old.run("INSERT INTO users (username, password_hash, created_at) VALUES ('two', 'x', 'now')")).lastId;
  const k1 = (await old.run("INSERT INTO kinds (owner_id, name, key, created_at) VALUES (?, 'Things', 'things', 'now')", [one])).lastId;
  const k2 = (await old.run("INSERT INTO kinds (owner_id, name, key, created_at) VALUES (?, 'Things', 'things', 'now')", [two])).lastId;
  const add = (who: number, k: number, name: string) => old.run('INSERT INTO items (owner_id, kind_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)', [who, k, name, 'now', 'now']);
  await add(one, k1, 'First');
  await add(two, k2, 'Theirs');
  await add(one, k1, 'Second');
  await add(one, k1, 'Third');
  expect(await migrate(old)).toBe(LATEST);
  const got = (who: number) => inventory(old, who, clock).listItems().then((l) => l.map((t) => [t.name, t.asset_no, t.insured, t.gone, t.own_fields]).sort());
  expect(await got(one)).toEqual([['First', '000-001', false, null, []], ['Second', '000-002', false, null, []], ['Third', '000-003', false, null, []]]);
  expect(await got(two)).toEqual([['Theirs', '000-001', false, null, []]]);
  // New things go on from there.
  expect((await inventory(old, one, clock).createItem({ kind_id: k1, name: 'Fourth' })).asset_no).toBe('000-004');
});

it('a thing can have fields of your own beside its kind\'s, kept in order, replaced as a list and found by search', async () => {
  const fabric = (await things.createKind({ name: 'Fabric', fields: [{ name: 'Width', type: 'number', unit: 'in' }] })).find((k) => k.name === 'Fabric')!;
  const bolt = await things.createItem({ kind_id: fabric.id, name: 'Blue linen', values: { [String(fabric.fields[0]!.id)]: 54 },
    own_fields: [{ name: 'Dye lot', value: 'K-4471' }, { name: ' Mill ', value: 'Hawthorne' }, { name: '', value: '' }] });
  expect(bolt.own_fields).toEqual([{ name: 'Dye lot', value: 'K-4471' }, { name: 'Mill', value: 'Hawthorne' }]);
  expect(bolt.values).toEqual({ [String(fabric.fields[0]!.id)]: 54 });
  // Left out in an edit: they stay. A list: replaces them.
  expect((await things.updateItem(bolt.id, { name: 'Blue linen' })).own_fields).toHaveLength(2);
  const changed = await things.updateItem(bolt.id, { name: 'Blue linen', own_fields: [{ name: 'Mill', value: 'Hawthorne East' }] });
  expect(changed.own_fields).toEqual([{ name: 'Mill', value: 'Hawthorne East' }]);
  expect(await names({ q: 'hawthorne' })).toEqual(['Blue linen']);
  expect((await search(db, owner, 'hawthorne')).map((r) => r.title)).toEqual(['Blue linen']);
  expect((await things.updateItem(bolt.id, { name: 'Blue linen', own_fields: [] })).own_fields).toEqual([]);
  await expect(things.updateItem(bolt.id, { name: 'Blue linen', own_fields: [{ name: 'Mill', value: 'a' }, { name: 'mill', value: 'b' }] })).rejects.toEqual(problem(409));
  await expect(things.updateItem(bolt.id, { name: 'Blue linen', own_fields: [{ name: 'Mill', value: '' }] })).rejects.toEqual(problem(400));
  await expect(things.updateItem(bolt.id, { name: 'Blue linen', own_fields: [{ name: '', value: 'x' }] })).rejects.toEqual(problem(400));
  // They go with the thing.
  await things.updateItem(bolt.id, { name: 'Blue linen', own_fields: [{ name: 'Mill', value: 'x' }] });
  await things.deleteItem(bolt.id);
  expect((await db.get<{ n: number }>('SELECT COUNT(*) AS n FROM item_fields'))!.n).toBe(0);
});
