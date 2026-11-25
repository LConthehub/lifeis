/** Guns and ammunition: private to the person who keeps them, shared only with people they pick, and left out of everything else. */
import { beforeEach, expect, it } from 'vitest';
import { assistant } from '../src/assistant.ts';
import type { Db } from '../src/db.ts';
import { exportEverything, splitDownload } from '../src/exportAll.ts';
import { home } from '../src/home.ts';
import { inventory, sharedPhoto, sharedWithMe, type Inventory } from '../src/inventory.ts';
import { migrate } from '../src/migrations.ts';
import { ammoOnHand, outdoorTrips } from '../src/outdoorTrips.ts';
import { search } from '../src/search.ts';
import { memoryDb } from './memoryDb.ts';

let db: Db;
let boss: number;
let ana: number;
let bob: number;
let rifle: number;
let ammo: number;
const clock = () => new Date(2046, 2, 5, 10, 0, 0);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2]);
const SERIAL = 'ZX-90417-Q';
const problem = (status: number) => expect.objectContaining({ name: 'Problem', status });

async function person(name: string, admin = false): Promise<number> {
  return (await db.run("INSERT INTO users (username, password_hash, is_admin, created_at) VALUES (?, 'x', ?, 'now')", [name, admin ? 1 : 0])).lastId;
}
const of = (who: number): Inventory => inventory(db, who, clock);

async function kindId(things: Inventory, name: string): Promise<number> {
  return (await things.listKinds()).find((k) => k.name === name)!.id;
}
async function fieldId(things: Inventory, kind: string, field: string): Promise<string> {
  return String((await things.listKinds()).find((k) => k.name === kind)!.fields.find((f) => f.name === field)!.id);
}

beforeEach(async () => {
  db = memoryDb();
  await migrate(db);
  boss = await person('boss', true);
  ana = await person('ana');
  bob = await person('bob');
  const mine = of(ana);
  await mine.addStarter('hunting');
  const room = (await mine.createPlace({ name: 'Study' })).find((p) => p.name === 'Study')!;
  rifle = (await mine.createItem({
    kind_id: await kindId(mine, 'Firearms'), name: 'Deer rifle', place_id: room.id, note: 'Left-hand bolt',
    values: { [await fieldId(mine, 'Firearms', 'Type')]: 'Rifle', [await fieldId(mine, 'Firearms', 'Maker')]: 'Ruger', [await fieldId(mine, 'Firearms', 'Caliber or gauge')]: '.308 Win' },
    records: { serial: SERIAL, model: 'American', bought_on: '2040-11-02', bought_at: 'Hill Sports', price_cents: 64900 },
  })).id;
  await mine.setPhoto(rifle, JPEG);
  await mine.addDocument(rifle, { kind: 'receipt', name: 'Receipt', bytes: JPEG });
  ammo = (await mine.createItem({
    kind_id: await kindId(mine, 'Ammunition'), name: 'Soft point 150 grain', quantity: 18, low_at: 20, place_id: room.id,
    values: { [await fieldId(mine, 'Ammunition', 'Caliber or gauge')]: '.308 Win', [await fieldId(mine, 'Ammunition', 'Brand')]: 'Federal' },
  })).id;
  await of(bob).addStarter('home');
  await of(bob).createItem({ kind_id: await kindId(of(bob), 'Tools'), name: 'Hammer' });
});

it('the Hunting and shooting set has three kinds, is off until picked, and makes guns and ammunition private', async () => {
  expect(await of(bob).listKinds().then((k) => k.some((x) => x.name === 'Firearms'))).toBe(false);
  const kinds = await of(ana).listKinds();
  expect(kinds.filter((k) => ['Firearms', 'Ammunition', 'Hunting gear'].includes(k.name)).map((k) => [k.name, k.guard])).toEqual([['Ammunition', 'ammo'], ['Firearms', 'firearm'], ['Hunting gear', null]]);
  expect(kinds.find((k) => k.name === 'Firearms')!.fields.map((f) => f.name)).toEqual(['Type', 'Maker', 'Caliber or gauge']);
  expect(kinds.find((k) => k.name === 'Firearms')!.fields[0]!.choices).toEqual(['Rifle', 'Shotgun', 'Handgun', 'Muzzleloader', 'Air gun', 'Bow and crossbow']);
  // A kind made by hand with the same name is private too.
  expect((await of(bob).createKind({ name: 'Ammunition' })).find((k) => k.name === 'Ammunition')!.guard).toBe('ammo');
});

it('the serial number is in the thing itself, never in a list', async () => {
  const mine = of(ana);
  const listed = (await mine.listItems({ guarded: true })).find((t) => t.id === rifle)!;
  expect([listed.records.serial, listed.serial_kept]).toEqual([null, true]);
  expect((await mine.getItem(rifle)).records.serial).toBe(SERIAL);
  expect(JSON.stringify(await mine.listItems({ guarded: true }))).not.toContain(SERIAL);
  // Without asking for them, a list has no guns or ammunition in it at all.
  expect((await mine.listItems()).map((t) => t.name)).not.toContain('Deer rifle');
});

it('someone else, and the person in charge, cannot see a private gun or ammunition by any route', async () => {
  for (const who of [bob, boss]) {
    const other = of(who);
    expect((await other.listItems({ guarded: true })).map((t) => t.name)).not.toContain('Deer rifle');
    await expect(other.getItem(rifle)).rejects.toEqual(problem(404));
    await expect(other.photo(rifle)).rejects.toEqual(problem(404));
    await expect(other.documents(rifle)).rejects.toEqual(problem(404));
    await expect(other.thingStickers([rifle])).rejects.toEqual(problem(404));
    await expect(other.moveItem(rifle, null)).rejects.toEqual(problem(404));
    await expect(other.letGo(rifle, { how: 'sold' })).rejects.toEqual(problem(404));
    await expect(other.sharing(rifle)).rejects.toEqual(problem(404));
    await expect(other.shareWith(rifle, [who])).rejects.toEqual(problem(404));
    expect(await other.guns()).toEqual([]);
    expect(await other.ammoLow()).toEqual([]);
    expect(await other.ammoByCaliber()).toEqual([]);
    for (const word of ['rifle', SERIAL, 'Ruger', 'Federal', '.308', 'Hill Sports']) expect(await search(db, who, word)).toEqual([]);
    expect(JSON.stringify(await other.homeReport())).not.toMatch(/rifle|ZX-90417|Ruger/i);
    expect((await home(db, who, clock).summary()).ammo).toEqual([]);
    expect(JSON.stringify(await home(db, who, clock).summary())).not.toMatch(/rifle|Soft point|ZX-90417/i);
    expect(await sharedWithMe(db, who, clock)).toEqual([]);
    expect(await sharedPhoto(db, who, rifle)).toBeNull();
    const download = await splitDownload((await exportEverything(db, who, clock)).bytes);
    expect(JSON.stringify(download.files)).not.toMatch(/Deer rifle|ZX-90417|Soft point/);
  }
});

it('even the person it belongs to does not see it in the Home page, the home report, the general search, the assistant or the reminders; the Things page asks for it', async () => {
  const mine = of(ana);
  expect(await search(db, ana, 'Deer rifle')).toEqual([]);
  expect(await search(db, ana, SERIAL)).toEqual([]);
  expect(await mine.homeReport()).toMatchObject({ things: 0 });
  expect((await mine.homeReportCsv()).text).not.toMatch(/rifle|ZX-90417|Soft point/i);
  const summary = await home(db, ana, clock).summary();
  expect(summary.things.total).toBe(0);
  expect(summary.things.low).toEqual([]);
  expect(JSON.stringify(summary.things)).not.toMatch(/rifle|Soft point/);
  await assistant(db, ana, clock).save({ areas: ['things'] });
  const facts = await assistant(db, ana, clock).facts();
  expect(facts).toHaveProperty('things');
  expect(JSON.stringify(facts)).not.toMatch(/rifle|Soft point|ZX-90417|Ruger/i);
});

it('ammunition running low is a card on that person’s own Home page, and counts by caliber', async () => {
  const summary = await home(db, ana, clock).summary();
  expect(summary.ammo).toEqual([{ id: ammo, name: 'Soft point 150 grain', amount: '18 rounds', caliber: '.308 Win' }]);
  expect(await of(ana).ammoByCaliber()).toEqual([{ caliber: '.308 Win', rounds: 18 }]);
  await of(ana).updateItem(ammo, { name: 'Soft point 150 grain', quantity: 60, low_at: 20, values: { [await fieldId(of(ana), 'Ammunition', 'Caliber or gauge')]: '.308 Win' } });
  expect((await home(db, ana, clock).summary()).ammo).toEqual([]);
  expect(await ammoOnHand(of(ana), '.308')).toBe(60);
  expect(await ammoOnHand(of(ana), '12 gauge')).toBeNull();
});

it('sharing with one person shows it to that person only, read-only, serial on request, and stops when taken back', async () => {
  const mine = of(ana);
  const { choices, people } = await mine.sharing(rifle);
  expect(people).toEqual([]);
  expect(choices.map((c) => c.name)).toEqual(['bob', 'boss']);
  expect((await mine.shareWith(rifle, [bob])).people).toEqual([bob]);

  const seen = await sharedWithMe(db, bob, clock);
  expect(seen.map((t) => [t.name, t.owner, t.guard])).toEqual([['Deer rifle', 'ana', 'firearm']]);
  expect(JSON.stringify(seen)).not.toContain(SERIAL);
  expect(seen[0]).toMatchObject({ serial_kept: true, photo: true, fields: expect.arrayContaining([{ name: 'Caliber or gauge', value: '.308 Win' }]) });
  expect((await sharedWithMe(db, bob, clock, rifle))[0]!.records.serial).toBe(SERIAL);
  expect(await sharedPhoto(db, bob, rifle)).not.toBeNull();
  // Still not in bob's own things, search, totals or Home, and not for the person in charge.
  expect((await of(bob).listItems({ guarded: true })).map((t) => t.name)).not.toContain('Deer rifle');
  await expect(of(bob).getItem(rifle)).rejects.toEqual(problem(404));
  await expect(of(bob).letGo(rifle, { how: 'stolen' })).rejects.toEqual(problem(404));
  expect(await search(db, bob, 'rifle')).toEqual([]);
  expect((await home(db, bob, clock).summary()).things.total).toBe(1); // his own hammer
  expect(await sharedWithMe(db, boss, clock)).toEqual([]);
  expect(await sharedPhoto(db, boss, rifle)).toBeNull();
  expect((await sharedWithMe(db, bob, clock, ammo))).toEqual([]);
  // The ammunition was not shared, and the download of the one it was shared with has nothing of it.
  expect(JSON.stringify((await splitDownload((await exportEverything(db, bob, clock)).bytes)).files)).not.toMatch(/Deer rifle|ZX-90417/);

  await mine.shareWith(rifle, []);
  expect(await sharedWithMe(db, bob, clock)).toEqual([]);
  expect(await sharedPhoto(db, bob, rifle)).toBeNull();
});

it('only your own guns and ammunition can be shared, and only with people who exist', async () => {
  const mine = of(ana);
  await expect(mine.shareWith(rifle, [ana])).rejects.toEqual(problem(400));
  await expect(mine.shareWith(rifle, [9999])).rejects.toEqual(problem(400));
  const plain = (await of(bob).listItems())[0];
  if (plain) await expect(of(bob).shareWith(plain.id, [ana])).rejects.toEqual(problem(400));
  await expect(of(bob).shareWith(rifle, [bob])).rejects.toEqual(problem(404));
});

it('No longer have it keeps the record and the serial, and the gun leaves the lists', async () => {
  const mine = of(ana);
  const gone = await mine.letGo(rifle, { how: 'sold', day: '2046-01-20', to: 'A friend at the club', price_cents: 50000 });
  expect(gone.gone).toEqual({ on: '2046-01-20', how: 'sold', to: 'A friend at the club', cents: 50000 });
  expect((await mine.listItems({ guarded: true })).map((t) => t.name)).not.toContain('Deer rifle');
  expect((await mine.listItems({ guarded: true, gone: true })).map((t) => [t.name, t.serial_kept])).toEqual([['Deer rifle', true]]);
  const line = (await mine.guns())[0]!;
  expect([line.name, line.serial, line.gone?.how]).toEqual(['Deer rifle', SERIAL, 'sold']);
  expect((await mine.letGo(await mine.createItem({ kind_id: await kindId(mine, 'Firearms'), name: 'Old shotgun' }).then((t) => t.id), { how: 'stolen' })).gone?.how).toBe('stolen');
  expect((await mine.takeBack(rifle)).gone).toBeNull();
});

it('the printable list has only the person’s own guns, with serials and records, here first and gone after; ammunition is not on it', async () => {
  const mine = of(ana);
  await mine.createItem({ kind_id: await kindId(mine, 'Firearms'), name: 'Garden shotgun', records: { serial: 'S-77' } });
  await mine.letGo((await mine.guns()).find((g) => g.name === 'Garden shotgun')!.id, { how: 'given', to: 'My brother' });
  const list = await mine.guns();
  expect(list.map((g) => g.name)).toEqual(['Deer rifle', 'Garden shotgun']);
  expect(list[0]).toMatchObject({
    type: 'Rifle', maker: 'Ruger', model: 'American', caliber: '.308 Win', serial: SERIAL, bought_on: '2040-11-02', bought_at: 'Hill Sports', price_cents: 64900,
    place: 'Study', photo: true, receipt: true, note: 'Left-hand bolt', gone: null,
  });
  expect(list[1]!.gone).toMatchObject({ how: 'given', to: 'My brother' });
  // Someone with a gun of their own gets their own list; a gun shared with them is not in it.
  await of(bob).addStarter('hunting');
  await of(bob).createItem({ kind_id: await kindId(of(bob), 'Firearms'), name: 'Duck gun', records: { serial: 'B-1' } });
  await mine.shareWith(rifle, [bob]);
  expect((await of(bob).guns()).map((g) => g.name)).toEqual(['Duck gun']);
  expect((await mine.guns()).map((g) => g.name)).not.toContain('Duck gun');
});

it('recalls and the home report never take guns or ammunition, and a guarded kind is not given an activity', async () => {
  const kinds = await of(ana).listKinds();
  expect(kinds.filter((k) => k.guard).map((k) => k.activity)).toEqual([null, null]);
  expect(kinds.find((k) => k.name === 'Hunting gear')!.activity).toBe('Outdoors');
});

it('the hunting trip fills its bring list from guns and hunting gear, adds ammunition for each caliber, and checks the rounds kept', async () => {
  const mine = () => outdoorTrips(db, ana, clock);
  const made = await mine().create({ name: 'Deer camp', parts: ['hunting'], day: '2046-11-08', end_day: '2046-11-10' });
  const planId = made.years[0]!.plan_id;
  expect((await mine().fillGear(planId, 'hunting')).added).toBe(2);
  const list = (await mine().year(planId)).gear.filter((g) => g.part === 'hunting');
  expect(list.map((g) => [g.label, g.caliber])).toEqual([['Deer rifle', null], ['.308 Win ammunition', '.308 Win']]);
  expect((await mine().fillGear(planId, 'hunting')).added).toBe(0); // asked twice: nothing doubled
  await mine().updateGear(list[1]!.id, { quantity: 20 });
  expect((await mine().year(planId)).checks.ammo.map((a) => [a.caliber, a.bringing, a.have, a.short])).toEqual([['.308 Win', 20, 18, 2]]);
  // Someone else's trip does not find her guns or her rounds.
  const theirs = outdoorTrips(db, bob, clock);
  const trip = await theirs.create({ name: 'Duck blind', parts: ['hunting'], day: '2046-11-08' });
  expect((await theirs.fillGear(trip.years[0]!.plan_id, 'hunting')).added).toBe(0);
  expect((await theirs.options()).things.map((t) => t.name)).toEqual(['Hammer']);
});

const reportNames = (r: Awaited<ReturnType<Inventory['homeReport']>>) => r.rooms.flatMap((room) => room.lines.map((l) => l.name));

it('the home report leaves guns out unless asked; asked, it has only the person’s own guns and ammunition, with serial numbers', async () => {
  const mine = of(ana);
  await mine.createItem({ kind_id: await kindId(mine, 'Firearms'), name: 'Old shotgun', insured: true, records: { serial: 'S-77', price_cents: 30000 } });
  await mine.createItem({ kind_id: await kindId(mine, 'Firearms'), name: 'Spare barrel' });
  const off = await mine.homeReport();
  expect(off.things).toBe(0);
  expect(JSON.stringify(off)).not.toMatch(/rifle|shotgun|barrel|Soft point|ZX-90417|S-77/i);
  expect((await mine.homeReportCsv()).text).not.toMatch(/rifle|shotgun|barrel|Soft point|ZX-90417|S-77/i);

  const on = await mine.homeReport({ guns: true });
  expect(reportNames(on)).toEqual(['Deer rifle', 'Soft point 150 grain', 'Old shotgun', 'Spare barrel']);
  expect(on.things).toBe(4);
  expect(on.with_serial).toBe(2);
  expect(on.rooms.find((r) => r.name === 'Study')!.lines.find((l) => l.name === 'Deer rifle')!.serial).toBe(SERIAL);
  const csv = (await mine.homeReportCsv({ guns: true })).text;
  expect(csv).toContain(SERIAL);
  expect(csv).toContain('S-77');
  expect(csv).toContain('Old shotgun');
});

it('the home report with guns never shows guns shared with the person, or anyone else’s', async () => {
  const mine = of(ana);
  const bobs = of(bob);
  await bobs.addStarter('hunting');
  await bobs.createItem({ kind_id: await kindId(bobs, 'Firearms'), name: 'Duck gun', records: { serial: 'B-1' } });
  await mine.shareWith(rifle, [bob]);
  const theirs = await bobs.homeReport({ guns: true });
  expect(reportNames(theirs)).toEqual(['Duck gun', 'Hammer']);
  expect(JSON.stringify(theirs)).not.toMatch(/Deer rifle|ZX-90417/);
  const mineNow = await mine.homeReport({ guns: true });
  expect(reportNames(mineNow)).toEqual(['Deer rifle', 'Soft point 150 grain']);
  expect(JSON.stringify(mineNow)).not.toMatch(/Duck gun|B-1/);
  expect((await mine.homeReportCsv({ guns: true })).text).not.toMatch(/Duck gun|B-1/);
  expect(reportNames(await bobs.homeReport())).toEqual(['Hammer']);
});

it('the insured filter still works with the guns option', async () => {
  const mine = of(ana);
  await mine.createItem({ kind_id: await kindId(mine, 'Firearms'), name: 'Old shotgun', insured: true, records: { serial: 'S-77' } });
  await mine.createItem({ kind_id: await kindId(mine, 'Firearms'), name: 'Spare barrel' });
  expect(reportNames(await mine.homeReport({ insured_only: true }))).toEqual([]);
  expect(reportNames(await mine.homeReport({ guns: true, insured_only: true }))).toEqual(['Old shotgun']);
  const csv = (await mine.homeReportCsv({ guns: true, insured_only: true })).text;
  expect(csv).toContain('Old shotgun');
  expect(csv).not.toContain('Spare barrel');
  expect(csv).not.toContain(SERIAL);
});
