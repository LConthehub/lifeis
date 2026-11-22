/** Home records: what things cost, their numbers and warranties, their papers, and the home inventory. */
import { beforeEach, expect, it } from 'vitest';
import type { Db } from '../src/db.ts';
import { inventory, type Inventory } from '../src/inventory.ts';
import { LATEST, migrate } from '../src/migrations.ts';
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
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 1, 2, 3]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2]);

async function person(name: string): Promise<number> {
  return (await db.run("INSERT INTO users (username, password_hash, created_at) VALUES (?, 'x', 'now')", [name])).lastId;
}

beforeEach(async () => {
  db = memoryDb();
  expect(await migrate(db)).toBe(LATEST);
  owner = await person('owner');
  time = new Date(2046, 2, 5, 10, 0, 0);
  things = inventory(db, owner, clock);
  kind = (await things.createKind({ name: 'Appliances' }))[0]!.id;
});

it('a thing keeps what it cost, its numbers and its warranty; only what is given changes', async () => {
  const tv = await things.createItem({ kind_id: kind, name: 'Television', records: { bought_on: '2045-04-04', bought_at: 'Costco', price_cents: 79900, serial: ' SN-123 ', model: 'QN55', warranty_until: '2046-04-04' } });
  expect(tv.records).toEqual({ bought_on: '2045-04-04', bought_at: 'Costco', price_cents: 79900, value_cents: null, serial: 'SN-123', model: 'QN55', warranty_until: '2046-04-04' });
  expect(tv.warranty_days).toBe(30);
  const later = await things.updateItem(tv.id, { name: 'Television', records: { value_cents: 50000 } });
  expect([later.records.value_cents, later.records.serial, later.records.price_cents]).toEqual([50000, 'SN-123', 79900]);
  expect((await things.updateItem(tv.id, { name: 'Television' })).records.serial).toBe('SN-123'); // records left out: untouched
  expect((await things.updateItem(tv.id, { name: 'Television', records: { serial: null } })).records.serial).toBeNull();
  await expect(things.updateItem(tv.id, { name: 'Television', records: { price_cents: -1 } })).rejects.toEqual(problem(400));
  await expect(things.updateItem(tv.id, { name: 'Television', records: { warranty_until: 'next year' } })).rejects.toEqual(problem(400));
  expect((await search(db, owner, 'qn55')).map((r) => r.title)).toEqual(['Television']); // found by its model number
});

it('papers are kept with a thing: a PDF or a photo, nothing else, and only its owner reads them', async () => {
  const tv = await things.createItem({ kind_id: kind, name: 'Television' });
  let papers = await things.addDocument(tv.id, { kind: 'receipt', name: 'Costco receipt.pdf', bytes: PDF });
  papers = await things.addDocument(tv.id, { kind: 'manual', name: '', bytes: JPEG });
  expect(papers.map((d) => [d.kind, d.name, d.type, d.size])).toEqual([['receipt', 'Costco receipt.pdf', 'application/pdf', 8], ['manual', 'Manual', 'image/jpeg', 6]]);
  expect((await things.getItem(tv.id)).documents).toBe(2);
  expect((await things.document(papers[0]!.id))!.bytes).toEqual(PDF);
  await expect(things.addDocument(tv.id, { kind: 'receipt', name: 'virus.exe', bytes: new Uint8Array([0x4d, 0x5a, 1, 2]) })).rejects.toEqual(problem(400));
  await expect(things.addDocument(tv.id, { kind: 'deed', name: 'x', bytes: PDF })).rejects.toEqual(problem(400));

  const other = inventory(db, await person('other'), clock);
  expect(await other.document(papers[0]!.id)).toBeNull();
  await other.removeDocument(papers[0]!.id); // does nothing
  await expect(other.documents(tv.id)).rejects.toEqual(problem(404));
  await things.removeDocument(papers[1]!.id);
  expect((await things.documents(tv.id)).map((d) => d.kind)).toEqual(['receipt']);
});

it('the home inventory goes room by room, worth by value or else by price, and says what has proof', async () => {
  const living = (await things.createPlace({ name: 'Living room' }))[0]!.id;
  const cabinet = (await things.createPlace({ name: 'Cabinet', parent_id: living })).find((p) => p.name === 'Cabinet')!.id;
  const tv = await things.createItem({ kind_id: kind, name: 'Television', place_id: living, records: { price_cents: 79900, value_cents: 50000, serial: 'SN-123', warranty_until: '2046-04-04' } });
  await things.createItem({ kind_id: kind, name: 'Speakers', place_id: cabinet, records: { price_cents: 20000 } });
  await things.createItem({ kind_id: kind, name: 'Old kettle' });
  await things.addDocument(tv.id, { kind: 'receipt', name: 'r.pdf', bytes: PDF });
  await things.setPhoto(tv.id, JPEG);

  const report = await things.homeReport();
  expect([report.things, report.worth_cents, report.valued, report.with_photo, report.with_receipt]).toEqual([3, 70000, 2, 1, 1]);
  expect(report.rooms.map((r) => [r.name, r.worth_cents, r.lines.map((l) => [l.name, l.worth_cents, l.photo, l.receipt])])).toEqual([
    ['Living room', 70000, [['Television', 50000, true, true], ['Speakers', 20000, false, false]]],
    ['No place yet', 0, [['Old kettle', 0, false, false]]],
  ]);
  expect(report.warranties).toEqual([{ id: tv.id, name: 'Television', until: '2046-04-04', days_left: 30 }]);
});

it('a warranty about to end is in the morning reminder a month, a week and a day ahead, not every day', async () => {
  await things.createItem({ kind_id: kind, name: 'Television', records: { warranty_until: '2046-04-04' } });
  const titles = async () => (await reminders(db, owner, clock).digest()).lines.map((l) => [l.title, l.detail, l.urgent]);
  expect(await titles()).toEqual([['Warranty: Television', 'ends in 30 days · anything wrong with it?', false]]);
  time = new Date(2046, 2, 6, 10, 0, 0);
  expect(await titles()).toEqual([]);
  time = new Date(2046, 3, 3, 10, 0, 0);
  expect(await titles()).toEqual([['Warranty: Television', 'ends tomorrow · anything wrong with it?', true]]);
});
