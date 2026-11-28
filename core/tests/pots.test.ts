/** Savings pots: money set aside with no target, put in and taken out by dated lines, private unless shared. */
import { beforeEach, expect, it } from 'vitest';
import type { Db } from '../src/db.ts';
import { migrate } from '../src/migrations.ts';
import { pots } from '../src/pots.ts';
import { memoryDb } from './memoryDb.ts';

let db: Db;
let ana: number;
let ben: number;
let cat: number;
let day = '2046-03-05';
const clock = Object.assign(() => new Date(`${day}T10:00:00`), { today: () => day });
const person = async (name: string) => (await db.run("INSERT INTO users (username, password_hash, created_at) VALUES (?, 'x', 'now')", [name])).lastId;
const p = (who = ana) => pots(db, who, clock);

beforeEach(async () => {
  db = memoryDb();
  await migrate(db);
  ana = await person('ana'); ben = await person('ben'); cat = await person('cat');
  day = '2046-03-05';
});

it('a pot takes money in and out with a dated line each time, and cannot go below nothing', async () => {
  const car = await p().create({ name: 'The car' });
  await p().addLine(car.id, { cents: 20000, note: 'Tax refund' });
  day = '2046-03-12';
  await p().addLine(car.id, { cents: -4550, note: 'Tires' });
  await p().addLine(car.id, { cents: 1000, day: '2046-03-01' });
  const view = await p().list();
  expect(view.total).toBe(16450);
  expect(view.pots[0]).toMatchObject({ name: 'The car', balance: 16450, mine: true, closed_on: null });
  expect(view.pots[0]!.lines.map((l) => [l.day, l.cents, l.note])).toEqual([['2046-03-12', -4550, 'Tires'], ['2046-03-05', 20000, 'Tax refund'], ['2046-03-01', 1000, null]]);
  await expect(p().addLine(car.id, { cents: -20000 })).rejects.toThrow(/only \$164\.50 in The car/);
  await expect(p().addLine(car.id, { cents: 0 })).rejects.toThrow(/more than nothing/);
  await expect(p().addLine(car.id, { cents: 12.5 })).rejects.toThrow(/more than nothing/);
  // A line can be taken back out of the record, unless that would leave less than nothing.
  const lines = (await p().list()).pots[0]!.lines;
  await expect(p().removeLine(lines.find((l) => l.cents === 20000)!.id)).rejects.toThrow(/less than nothing/);
  await p().removeLine(lines.find((l) => l.cents === -4550)!.id);
  expect((await p().list()).pots[0]!.balance).toBe(21000);
});

it('a pot can be renamed, closed and opened again; a closed pot takes no lines and leaves the total', async () => {
  const gifts = await p().create({ name: 'Gifts' });
  const trip = await p().create({ name: 'Trip' });
  await p().addLine(gifts.id, { cents: 5000 });
  await p().addLine(trip.id, { cents: 7000 });
  await p().update(gifts.id, { name: 'Presents' });
  await p().update(trip.id, { closed: true });
  let view = await p().list();
  expect(view.pots.map((x) => [x.name, x.closed_on])).toEqual([['Presents', null], ['Trip', '2046-03-05']]);
  expect(view.total).toBe(5000);
  await expect(p().addLine(trip.id, { cents: 100 })).rejects.toThrow(/closed/);
  await p().update(trip.id, { closed: false });
  await p().addLine(trip.id, { cents: 100 });
  view = await p().list();
  expect(view.total).toBe(12100);
  await expect(p().update(gifts.id, { name: '  ' })).rejects.toThrow(/name/);
});

it('a pot is private unless shared by name; shared people can put in and take out, and only the owner can change it', async () => {
  const fund = await p().create({ name: 'Family fund', shared_with: [ben] });
  const mine = await p().create({ name: 'Surprise' });
  await p().addLine(mine.id, { cents: 3000 });
  // Ben sees the shared pot and not the private one; cat sees neither.
  expect((await p(ben).list()).pots.map((x) => [x.name, x.mine, x.owner])).toEqual([['Family fund', false, 'ana']]);
  expect((await p(cat).list()).pots).toEqual([]);
  await p(ben).addLine(fund.id, { cents: 2500, note: 'From Ben' });
  expect((await p().list()).pots.find((x) => x.name === 'Family fund')!.lines[0]).toMatchObject({ cents: 2500, by: 'ben', mine: false });
  await expect(p(cat).addLine(fund.id, { cents: 100 })).rejects.toThrow(/isn't here/);
  await expect(p(ben).addLine(mine.id, { cents: 100 })).rejects.toThrow(/isn't here/);
  await expect(p(ben).update(fund.id, { name: 'Mine' })).rejects.toThrow(/Only the person who made/);
  await expect(p(ben).remove(fund.id)).rejects.toThrow(/Only the person who made/);
  // Ben can take back his own line.
  const line = (await p(ben).list()).pots[0]!.lines[0]!;
  await p(ben).removeLine(line.id);
  expect((await p().list()).pots.find((x) => x.name === 'Family fund')!.balance).toBe(0);
  // Sharing with nobody makes it private again.
  await p().update(fund.id, { shared_with: [] });
  expect((await p(ben).list()).pots).toEqual([]);
  await p().remove(fund.id);
  expect((await p().list()).pots.map((x) => x.name)).toEqual(['Surprise']);
});
