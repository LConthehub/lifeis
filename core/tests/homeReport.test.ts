/** The home inventory an insurer will take: by room, in exact cents, with a spreadsheet of the same. */
import { beforeEach, expect, it } from 'vitest';
import type { Db } from '../src/db.ts';
import { inventory, type Inventory } from '../src/inventory.ts';
import { LATEST, migrate } from '../src/migrations.ts';
import { memoryDb } from './memoryDb.ts';

let db: Db;
let things: Inventory;
let kind: number;
const clock = () => new Date(2046, 2, 5, 10, 0, 0);
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 1, 2, 3]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2]);

async function person(name: string): Promise<number> {
  return (await db.run("INSERT INTO users (username, password_hash, created_at) VALUES (?, 'x', 'now')", [name])).lastId;
}

beforeEach(async () => {
  db = memoryDb();
  expect(await migrate(db)).toBe(LATEST);
  things = inventory(db, await person('owner'), clock);
  kind = (await things.createKind({ name: 'Appliances' }))[0]!.id;
});

/** A house: two rooms, a nested shelf and bin, and things with and without values. */
async function house() {
  const living = (await things.createPlace({ name: 'Living room' }))[0]!.id;
  const shelf = (await things.createPlace({ name: 'Shelf', parent_id: living })).find((p) => p.name === 'Shelf')!.id;
  const bin = (await things.createPlace({ name: 'Bin', parent_id: shelf })).find((p) => p.name === 'Bin')!.id;
  const attic = (await things.createPlace({ name: 'Attic' })).find((p) => p.name === 'Attic')!.id;
  const tv = await things.createItem({ kind_id: kind, name: 'Television', place_id: living, records: { price_cents: 79999, value_cents: 50001, serial: 'SN-1' } });
  const cable = await things.createItem({ kind_id: kind, name: 'Cable', place_id: bin, records: { price_cents: 1005 } });
  const lamp = await things.createItem({ kind_id: kind, name: 'Lamp', place_id: shelf });
  const trunk = await things.createItem({ kind_id: kind, name: 'Trunk', place_id: attic, records: { price_cents: 10 } });
  const kettle = await things.createItem({ kind_id: kind, name: 'Kettle' });
  return { living, shelf, bin, attic, tv, cable, lamp, trunk, kettle };
}
type Report = Awaited<ReturnType<Inventory['homeReport']>>;
const names = (r: Report) => r.rooms.flatMap((room) => room.lines.map((l) => l.name));

it('puts a thing under its room however deep it sits, rooms in name order and no place last', async () => {
  const h = await house();
  const report = await things.homeReport();
  expect(report.rooms.map((r) => [r.name, r.things])).toEqual([['Attic', 1], ['Living room', 3], ['No place yet', 1]]);
  const living = report.rooms.find((r) => r.name === 'Living room')!;
  expect(living.id).toBe(h.living);
  expect(living.lines.map((l) => [l.name, l.place, l.where, l.room_id])).toEqual([
    ['Television', 'Living room', null, h.living],
    ['Cable', 'Living room › Shelf › Bin', 'Shelf › Bin', h.living], // three levels down, still the living room's
    ['Lamp', 'Living room › Shelf', 'Shelf', h.living],
  ]);
});

it('adds up cents exactly, counts a price where there is no worth-now value, and counts the unvalued apart', async () => {
  await house();
  const report = await things.homeReport();
  const living = report.rooms.find((r) => r.name === 'Living room')!;
  // 50001 (worth now given, not the 79999 paid) + 1005 (the price, as no value was given) + nothing for the lamp.
  expect([living.price_cents, living.worth_cents, living.at_cost, living.unvalued]).toEqual([81004, 51006, 1, 1]);
  expect([report.things, report.price_cents, report.worth_cents, report.valued, report.unvalued, report.at_cost]).toEqual([5, 81014, 51016, 3, 2, 2]);
  expect(report.shown).toEqual({ things: 5, worth_cents: 51016, price_cents: 81014 });
  // Many small amounts do not drift: ten cents nine more times is ninety cents more, whole.
  for (let i = 0; i < 9; i += 1) await things.createItem({ kind_id: kind, name: `Nail ${i}`, records: { price_cents: 10 } });
  expect((await things.homeReport()).worth_cents).toBe(51016 + 90);
});

it('counts what has a photo, a serial number and a receipt, and names the room most in need', async () => {
  const h = await house();
  await things.setPhoto(h.tv.id, JPEG);
  await things.addDocument(h.tv.id, { kind: 'receipt', name: 'r.pdf', bytes: PDF });
  await things.addDocument(h.cable.id, { kind: 'manual', name: 'm.pdf', bytes: PDF }); // a manual is not a receipt
  const report = await things.homeReport();
  const living = report.rooms.find((r) => r.name === 'Living room')!;
  expect([living.with_photo, living.with_serial, living.with_receipt]).toEqual([1, 1, 1]);
  expect([report.with_photo, report.with_serial, report.with_receipt]).toEqual([1, 1, 1]);
  // Living room: the cable lacks a photo and a serial, the lamp all three. The attic's trunk lacks two.
  expect(report.neediest).toEqual({ id: h.living, name: 'Living room', gaps: 5 });
  expect(report.choices.map((c) => [c.name, c.incomplete])).toEqual([['Attic', 1], ['Living room', 2], ['No place yet', 1]]);
});

it('can be narrowed to some rooms, to things worth at least an amount, and without things that have no value', async () => {
  const h = await house();
  expect(names(await things.homeReport({ rooms: [h.attic] }))).toEqual(['Trunk']);
  expect(names(await things.homeReport({ rooms: [0] }))).toEqual(['Kettle']);
  expect(names(await things.homeReport({ min_cents: 1000 }))).toEqual(['Television', 'Cable']);
  expect(names(await things.homeReport({ unvalued: false }))).toEqual(['Trunk', 'Television', 'Cable']);
  const narrow = await things.homeReport({ rooms: [h.living], min_cents: 50000 });
  expect(narrow.rooms.map((r) => r.name)).toEqual(['Living room']);
  expect(narrow.shown).toEqual({ things: 1, worth_cents: 50001, price_cents: 79999 });
  // The household's own totals are the household's, whatever was left out of the page.
  expect([narrow.things, narrow.worth_cents]).toEqual([5, 51016]);
});

it('makes a spreadsheet with a row for each thing, quoting commas, quotes and line breaks, that Excel opens as UTF-8', async () => {
  const h = await house();
  await things.updateItem(h.tv.id, { name: 'Television, 55" "Q" model\nsecond line', place_id: h.living, records: { bought_on: '2045-04-04', bought_at: 'Costco, Seattle' } });
  await things.updateItem(h.lamp.id, { name: '=SUM(A1)', place_id: h.shelf });
  await things.setPhoto(h.cable.id, JPEG);
  const { filename, text } = await things.homeReportCsv();
  expect(filename).toBe('home-inventory-2046-03-05.csv');
  expect(text.charCodeAt(0)).toBe(0xfeff);
  expect(text.endsWith('\r\n')).toBe(true);
  expect(text.slice(1).split('\r\n')[0]).toBe('Room,Where exactly,What it is,Kind,Quantity,Make/model,Serial number,Bought on,Bought at,Cost,Worth now,Warranty until,Has photo,Has receipt');
  expect(text).toContain('Living room,,"Television, 55"" ""Q"" model\nsecond line",Appliances,some,,SN-1,2045-04-04,"Costco, Seattle",799.99,500.01,,no,no\r\n');
  expect(text).toContain('Living room,Shelf › Bin,Cable,Appliances,some,,,,,10.05,10.05,,yes,no\r\n'); // dollars as a plain number; worth falls back to the cost
  expect(text).toContain("Living room,Shelf,'=SUM(A1),Appliances"); // a name that looks like a formula is not run by Excel
  expect(text).toContain('No place yet,,Kettle,Appliances,some,,,,,,,,no,no\r\n');
  // The same choices narrow it: a heading and one thing.
  expect((await things.homeReportCsv({ rooms: [h.attic] })).text.split('\r\n').filter(Boolean)).toHaveLength(2);
});

it("never shows another person's things in a report or its spreadsheet", async () => {
  await house();
  const other = inventory(db, await person('other'), clock);
  const theirKind = (await other.createKind({ name: 'Tools' }))[0]!.id;
  const room = (await other.createPlace({ name: 'Garage' }))[0]!.id;
  await other.createItem({ kind_id: theirKind, name: 'Secret drill', place_id: room, records: { price_cents: 99900, serial: 'ZZ-9' } });
  const mine = await things.homeReport();
  expect(JSON.stringify(mine)).not.toContain('Secret drill');
  expect(mine.rooms.map((r) => r.name)).not.toContain('Garage');
  expect(mine.worth_cents).toBe(51016);
  expect((await things.homeReportCsv()).text).not.toContain('Secret');
  expect((await things.homeReport({ rooms: [room] })).rooms).toEqual([]); // asking for their room by number shows nothing
  const theirs = await other.homeReport();
  expect([theirs.things, theirs.worth_cents]).toEqual([1, 99900]);
});
