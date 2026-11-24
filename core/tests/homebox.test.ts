/** Things brought in from HomeBox's CSV: read, looked over, then brought in, and bringing the same file in again adds nothing. */
import { readFileSync } from 'node:fs';
import { beforeEach, expect, it } from 'vitest';
import type { Db } from '../src/db.ts';
import { importHomebox, lookOverHomebox, readHomebox } from '../src/homebox.ts';
import { inventory } from '../src/inventory.ts';
import { migrate } from '../src/migrations.ts';
import { memoryDb } from './memoryDb.ts';

const SAMPLE = readFileSync(new URL('../../e2e/fixtures/homebox-sample.csv', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const clock = Object.assign(() => new Date(2046, 2, 5, 10, 0, 0), { today: () => '2046-03-05' });
const problem = (status: number) => expect.objectContaining({ name: 'Problem', status });
let db: Db;
let owner: number;

beforeEach(async () => {
  db = await memoryDb();
  await migrate(db);
  owner = (await db.run("INSERT INTO users (username, password_hash, created_at) VALUES ('a', 'x', 'now')")).lastId;
});

it('reads the columns by name, however they are ordered, with quotes, commas, line breaks and Windows line endings', () => {
  const sheet = readHomebox(SAMPLE.replace(/\n/g, '\r\n'));
  expect(sheet.things).toHaveLength(6);
  const drill = sheet.things[0]!;
  expect(drill).toMatchObject({ name: 'Cordless drill', quantity: 1, insured: true, price_cents: 8999, bought_at: 'Hardware Hut', bought_on: '2044-05-12', model: 'Brightmark BD-18',
    serial: 'SN12345', warranty_until: '2047-05-12', place: ['Garage', 'Shelf 2'], labels: ['Tools', 'Power'], asset: 1, import_ref: 'ref-001', gone: null });
  expect(drill.note).toContain('Drill, 18 volt');
  expect(drill.note).toContain('Battery in the blue case.');
  expect(drill.note).toContain('Second line of notes.');
  expect(drill.own_fields).toEqual([{ name: 'Color', value: 'Blue' }, { name: 'Voltage', value: '18V' }, { name: 'Warranty', value: 'Two years parts and labor' }]);
  expect(sheet.things[1]!.own_fields).toEqual([{ name: 'Warranty', value: 'Lifetime warranty' }]);
  expect(sheet.things[2]!.gone).toEqual({ on: '2046-02-01', to: 'Neighbor Pat', cents: 1200 });
  expect(sheet.things[3]!.price_cents).toBe(120000);
  const reordered = readHomebox('hb.labels,NAME,hb.location\n"Tools; Misc",Wrench,"Shed/Wall"\n');
  expect(reordered.things[0]).toMatchObject({ name: 'Wrench', labels: ['Tools', 'Misc'], place: ['Shed', 'Wall'], asset: null });
  expect(readHomebox("HB.name,HB.notes\nA,'=SUM(1)\n").things[0]!.note).toBe('=SUM(1)');
});

it('says what is wrong with a file that is not from HomeBox', () => {
  expect(() => readHomebox('')).toThrow(problem(400));
  expect(() => readHomebox('Title,Author\nDune,Herbert\n')).toThrow(problem(400));
  expect(() => readHomebox('HB.name,HB.location\n')).toThrow(problem(400));
});

it('looks it over without saving anything', async () => {
  const review = await lookOverHomebox(db, owner, readHomebox(SAMPLE));
  expect(review).toMatchObject({ found: 6, fresh: 6, already: 0, skipped: 0, gone: 1, asset_changed: 0, places: { total: 5, fresh: 5 }, tags: { total: 6, fresh: 6 } });
  const byKind = Object.fromEntries(review.kinds.map((k) => [k.name, k.things]));
  expect(byKind).toEqual({ Tools: 2, 'Kitchen tools': 1, Devices: 1, Other: 2 });
  expect(await db.get('SELECT COUNT(*) AS n FROM items')).toEqual({ n: 0 });
  expect(await db.get('SELECT COUNT(*) AS n FROM places')).toEqual({ n: 0 });
});

it('brings it into an empty Life Is, and again adds nothing', async () => {
  const result = await importHomebox(db, owner, clock, readHomebox(SAMPLE));
  expect(result).toMatchObject({ found: 6, added: 6, already: 0, places_made: 5, tags_made: 6, asset_changed: 0 });
  const stuff = inventory(db, owner, clock);
  const places = (await stuff.listPlaces()).map((p) => p.path);
  expect(places).toContain('Garage › Shelf 2');
  expect(places).toContain('Office › Desk');
  const here = await stuff.listItems();
  expect(here.map((i) => i.name).sort()).toEqual(['Cordless drill', 'Hand saw', 'Laptop', 'Mystery box', 'Old hose'].sort());
  const drill = here.find((i) => i.name === 'Cordless drill')!;
  expect(drill).toMatchObject({ kind: 'Tools', place: 'Garage › Shelf 2', asset_no: '000-001', insured: true, quantity: 1 });
  expect(drill.records).toMatchObject({ price_cents: 8999, bought_on: '2044-05-12', bought_at: 'Hardware Hut', serial: 'SN12345', model: 'Brightmark BD-18', warranty_until: '2047-05-12' });
  expect(drill.tag_list.map((t) => t.name).sort()).toEqual(['Power', 'Tools']);
  expect(drill.own_fields.map((f) => f.name)).toEqual(['Color', 'Voltage', 'Warranty']);
  expect(here.find((i) => i.name === 'Mystery box')!.kind).toBe('Other');
  const gone = await stuff.listItems({ gone: true });
  expect(gone).toHaveLength(1);
  expect(gone[0]).toMatchObject({ name: 'Toaster', gone: { on: '2046-02-01', how: 'sold', to: 'Neighbor Pat', cents: 1200 } });

  const again = await importHomebox(db, owner, clock, readHomebox(SAMPLE));
  expect(again).toMatchObject({ added: 0, already: 6, places_made: 0, tags_made: 0, kinds_made: 0 });
  expect(await db.get('SELECT COUNT(*) AS n FROM items')).toEqual({ n: 6 });
  expect(await lookOverHomebox(db, owner, readHomebox(SAMPLE))).toMatchObject({ fresh: 0, already: 6 });
});

it('finds what is already here by asset number, then by name and place, when there is no reference', async () => {
  const bare = 'HB.location,HB.asset_id,HB.name\nGarage,000-001,Drill\nShed,,Rake\n';
  await importHomebox(db, owner, clock, readHomebox(bare));
  expect(await importHomebox(db, owner, clock, readHomebox(bare))).toMatchObject({ added: 0, already: 2 });
  // Same asset number and name, but in another place in the file: still the same thing.
  expect(await importHomebox(db, owner, clock, readHomebox('HB.location,HB.asset_id,HB.name\nBasement,000-001,Drill\n'))).toMatchObject({ added: 0, already: 1 });
});

it('keeps asset numbers when it can, and takes the next free one when it cannot', async () => {
  const stuff = inventory(db, owner, clock);
  const kind = (await stuff.createKind({ name: 'Stuff' }))[0]!;
  await stuff.createItem({ kind_id: kind.id, name: 'Mine one' });
  await stuff.createItem({ kind_id: kind.id, name: 'Mine two' });
  const file = 'HB.name,HB.asset_id\nNew A,000-002\nNew B,000-007\nNew C,\nNew D,000-007\n';
  const review = await lookOverHomebox(db, owner, readHomebox(file));
  expect(review.asset_changed).toBe(2);
  expect(review.asset_changes.map((c) => [c.name, c.wanted])).toEqual([['New A', '000-002'], ['New D', '000-007']]);
  await importHomebox(db, owner, clock, readHomebox(file));
  const numbers = Object.fromEntries((await stuff.listItems()).map((i) => [i.name, i.asset_no]));
  expect(numbers).toMatchObject({ 'Mine one': '000-001', 'Mine two': '000-002', 'New B': '000-007', 'New A': '000-008', 'New C': '000-009', 'New D': '000-010' });
});

it('uses a kind the person already has, and makes the ready-made kind (with its fields) when they do not', async () => {
  const stuff = inventory(db, owner, clock);
  await stuff.createKind({ name: 'tools', icon: '🛠' });
  await importHomebox(db, owner, clock, readHomebox('HB.name,HB.labels\nA saw,Tools\nA phone,Electronics\nA mug,Kitchen\n'));
  const kinds = await stuff.listKinds();
  expect(kinds.filter((k) => k.name.toLowerCase() === 'tools')).toHaveLength(1);
  expect(kinds.find((k) => k.name === 'Devices')!.fields.length).toBeGreaterThan(0);
  expect(kinds.find((k) => k.name === 'tools')!.items).toBe(1);
});
