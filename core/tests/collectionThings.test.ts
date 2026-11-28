/** Physical copies in the Collection count as things in the home report and in the Things view; server-only copies and wanted titles never do. */
import { beforeEach, expect, it } from 'vitest';
import type { Db } from '../src/db.ts';
import { inventory, type Inventory } from '../src/inventory.ts';
import { media, type Media } from '../src/media.ts';
import { LATEST, migrate } from '../src/migrations.ts';
import { memoryDb } from './memoryDb.ts';

let db: Db;
let owner: number;
let things: Inventory;
let shelf: ReturnType<typeof media>;
const clock = () => new Date(2046, 2, 5, 10, 0, 0);

beforeEach(async () => {
  db = memoryDb();
  expect(await migrate(db)).toBe(LATEST);
  owner = (await db.run("INSERT INTO users (username, password_hash, created_at) VALUES ('owner', 'x', 'now')", [])).lastId;
  things = inventory(db, owner, clock);
  shelf = media(db, owner, clock);
});

it('counts a disc by its room, and a title with a disc and a server copy once', async () => {
  const den = (await things.createPlace({ name: 'Den' }))[0]!.id;
  const bin = (await things.createPlace({ name: 'Bin', parent_id: den })).find((p) => p.name === 'Bin')!.id;
  const alien: Media = await shelf.create({ type: 'film', title: 'Alien' }, { format: 'Blu-ray', place_id: bin, cost_cents: 1500, value_cents: 2500 });
  // The same title, also on a media server: not counted.
  await db.run("INSERT INTO media_copies (media_id, format, source, source_id, created_at) VALUES (?, 'Jellyfin', 'jellyfin', 'x1', 'now')", [alien.id]);
  // An eBook and a plain Digital copy: not counted either.
  const dune = await shelf.create({ type: 'book', title: 'Dune' }, { format: 'eBook' });
  await shelf.addCopy(dune.id, { format: 'Digital' });
  // Wanted, and not owned: never counted.
  await shelf.create({ type: 'music', title: 'Rumours', wanted: true });

  const report = await things.homeReport();
  expect(report.collection_copies).toBe(1);
  expect(report.things).toBe(1);
  expect(report.worth_cents).toBe(2500);
  expect(report.price_cents).toBe(1500);
  expect(report.rooms.map((r) => r.name)).toEqual(['Den']);
  const line = report.rooms[0]!.lines[0]!;
  expect(line).toMatchObject({ name: 'Alien', kind: 'Blu-ray', where: 'Bin', collection: { media_id: alien.id, format: 'Blu-ray' } });
  expect(line.id).toBeLessThan(0);
  expect(report.neediest).toBeNull();

  const view = await things.collectionThings();
  expect(view.total).toEqual({ copies: 1, worth_cents: 2500, price_cents: 1500 });
  expect(view.copies[0]).toMatchObject({ title: 'Alien', place: 'Den › Bin' });
});

it('adds to the totals of what is already kept, and a copy with no value counts at what it cost, else as unvalued', async () => {
  const kind = (await things.createKind({ name: 'Tools' }))[0]!.id;
  await things.createItem({ kind_id: kind, name: 'Hammer', records: { price_cents: 1000, value_cents: 700 } });
  await shelf.create({ type: 'music', title: 'Blue' }, { format: 'Vinyl', cost_cents: 2000 });
  await shelf.create({ type: 'game', title: 'Tetris' }, { format: 'Cartridge' });
  const report = await things.homeReport();
  expect(report.things).toBe(3);
  expect(report.worth_cents).toBe(2700);
  expect(report.price_cents).toBe(3000);
  expect(report.unvalued).toBe(1);
  expect(report.collection_copies).toBe(2);
  expect(report.rooms[0]!.name).toBe('No place yet');
  expect(report.rooms[0]!.at_cost).toBe(1);
  // Copies add no photo or serial gaps to walk through.
  expect(report.neediest).toBeNull();
  // The spreadsheet has a row for each copy.
  expect((await things.homeReportCsv()).text).toContain('Blue,Vinyl');
});

it('keeps the report as it was when nothing is in the Collection, and leaves copies out of an insured-only report', async () => {
  expect((await things.homeReport()).things).toBe(0);
  await shelf.create({ type: 'book', title: 'Emma' }, { format: 'Paperback', cost_cents: 500 });
  expect((await things.homeReport({ insured_only: true })).shown.things).toBe(0);
  expect((await things.homeReport()).things).toBe(1);
});
