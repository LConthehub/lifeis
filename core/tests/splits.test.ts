/** Splitting a bill or a purchase: shares to the cent, who owes whom in the fewest payments, Settled, and who sees what. */
import { beforeEach, expect, it } from 'vitest';
import type { Db } from '../src/db.ts';
import { migrate } from '../src/migrations.ts';
import { money } from '../src/money.ts';
import { fewestPayments, shareOut, splits } from '../src/splits.ts';
import { upkeep } from '../src/upkeep.ts';
import { memoryDb } from './memoryDb.ts';

let db: Db;
let ana: number;
let ben: number;
let cat: number;
let day = '2046-03-05';
const clock = Object.assign(() => new Date(`${day}T10:00:00`), { today: () => day });
const person = async (name: string) => (await db.run("INSERT INTO users (username, password_hash, created_at) VALUES (?, 'x', 'now')", [name])).lastId;
const s = (who = ana) => splits(db, who, clock);

beforeEach(async () => {
  db = memoryDb();
  await migrate(db);
  ana = await person('ana'); ben = await person('ben'); cat = await person('cat');
  day = '2046-03-05';
});

it('shares out to the cent: equal shares send the leftover cents one each to the first in the list', () => {
  expect(shareOut(1000, [{ mode: 'equal' }, { mode: 'equal' }, { mode: 'equal' }])).toEqual({ cents: [334, 333, 333], extra: [0] });
  expect(shareOut(1001, [{ mode: 'equal' }, { mode: 'equal' }, { mode: 'equal' }])).toEqual({ cents: [334, 334, 333], extra: [0, 1] });
  // An amount first, then the rest is shared equally.
  expect(shareOut(1000, [{ mode: 'amount', cents: 250 }, { mode: 'equal' }, { mode: 'equal' }]).cents).toEqual([250, 375, 375]);
  // A percent of the whole, the rest equal.
  expect(shareOut(1000, [{ mode: 'percent', percent: 50 }, { mode: 'equal' }, { mode: 'equal' }]).cents).toEqual([500, 250, 250]);
  // All percents that come to 100: rounding down leaves a cent, which goes to the first.
  expect(shareOut(1000, [{ mode: 'percent', percent: 33.33 }, { mode: 'percent', percent: 33.33 }, { mode: 'percent', percent: 33.34 }]).cents).toEqual([334, 333, 333]);
  const odd = shareOut(1001, [{ mode: 'percent', percent: 50 }, { mode: 'percent', percent: 50 }]);
  expect(odd.cents.reduce((a, b) => a + b, 0)).toBe(1001);
  expect(odd.cents).toEqual([501, 500]);
  // Amounts that do not add up are refused, saying how far off.
  expect(() => shareOut(1000, [{ mode: 'amount', cents: 600 }, { mode: 'amount', cents: 300 }])).toThrow(/come to \$9, and the whole is \$10/);
  expect(() => shareOut(1000, [{ mode: 'amount', cents: 600 }, { mode: 'amount', cents: 600 }])).toThrow(/too much/);
  expect(() => shareOut(1000, [{ mode: 'amount', cents: 1200 }, { mode: 'equal' }])).toThrow(/more than the whole/);
  expect(() => shareOut(1000, [{ mode: 'equal' }])).toThrow(/two people/);
});

it('boils balances down to the fewest payments, and settles a group that cancels inside itself', () => {
  // A owes 10 to B, B owes 10 to C: C is owed 10 by A directly, one payment.
  const one = fewestPayments(new Map([['a', -1000], ['b', 0], ['c', 1000]]));
  expect(one).toEqual([{ from: 'a', to: 'c', cents: 1000 }]);
  // Two separate pairs that cancel inside themselves stay two payments, not a crossing mess.
  const pairs = fewestPayments(new Map([['a', -500], ['b', 500], ['c', -700], ['d', 700]]));
  expect(pairs).toHaveLength(2);
  expect(pairs.map((p) => [p.from, p.to, p.cents]).sort()).toEqual([['a', 'b', 500], ['c', 'd', 700]]);
  // Whatever is paid settles every balance.
  const net = new Map([['a', -900], ['b', -300], ['c', 600], ['d', 600]]);
  const paid = fewestPayments(net);
  const left = new Map(net);
  for (const p of paid) { left.set(p.from, left.get(p.from)! + p.cents); left.set(p.to, left.get(p.to)! - p.cents); }
  expect([...left.values()].every((v) => v === 0)).toBe(true);
  expect(paid.length).toBeLessThanOrEqual(3);
});

it('splits a purchase three ways with a typed name, and starts from the purchase so nothing is typed twice', async () => {
  const entry = await money(db, ana, clock).addEntry({ label: 'Pizza night', cents: 6001, day: '2046-03-04' });
  const start = await s().start({ entry_id: entry.id });
  expect(start).toMatchObject({ what: 'Pizza night', total_cents: 6001, day: '2046-03-04', entry_id: entry.id });
  const made = await s().create({ ...start, people: [{ user_id: ana, paid: true }, { user_id: ben }, { name: 'Hank' }] });
  const page = await s().list();
  const one = page.splits.find((x) => x.id === made.id)!;
  // $60.01 in three: the leftover cent goes to the first on the list, who is the one who paid.
  expect(one.shares.map((x) => [x.who, x.cents])).toEqual([['ana', 2001], ['ben', 2000], ['Hank', 2000]]);
  expect(one.shares.reduce((n, x) => n + x.cents, 0)).toBe(6001);
  expect(one.paid_by).toBe('ana');
  expect(one.shares.find((x) => x.who === 'Hank')).toMatchObject({ typed: true, user_id: null });
  expect(page.payments.map((p) => [p.from, p.to, p.cents])).toEqual([['Hank', 'ana', 2000], ['ben', 'ana', 2000]]);
  expect(page.you_are_owed).toBe(4000);
  // The purchase is not touched, and nobody else's purchase can be split.
  await expect(s(ben).start({ entry_id: entry.id })).rejects.toThrow(/isn't one of yours/);
});

it('splits a bill from Upkeep with the bill\'s amount', async () => {
  const bill = await upkeep(db, ana, clock).create({ name: 'Electric', kind: 'bill', amount_cents: 12000, every_n: 1, every_unit: 'month', first_due: '2046-03-10' });
  const start = await s().start({ job_id: bill.id });
  expect(start).toMatchObject({ what: 'Electric', total_cents: 12000, job_id: bill.id });
  expect((await s().create({ ...start, people: [{ user_id: ana, paid: true }, { user_id: ben }] })).id).toBeGreaterThan(0);
  await expect(s(cat).start({ job_id: bill.id })).rejects.toThrow(/isn't here/);
});

it('an uneven split keeps amounts and percents, and refuses what does not add up', async () => {
  const made = await s().create({ what: 'Cabin', total_cents: 30000, day: '2046-03-01', people: [
    { user_id: ana, paid: true, mode: 'percent', percent: 50 }, { user_id: ben, mode: 'amount', cents: 5000 }, { name: 'Hank' }] });
  const one = (await s().list()).splits.find((x) => x.id === made.id)!;
  expect(one.shares.map((x) => x.cents)).toEqual([15000, 5000, 10000]);
  await expect(s().create({ what: 'Bad', total_cents: 1000, people: [{ user_id: ana, paid: true, mode: 'amount', cents: 100 }, { user_id: ben, mode: 'amount', cents: 100 }] })).rejects.toThrow(/come to \$2, and/);
  await expect(s().create({ what: 'No payer', total_cents: 1000, people: [{ user_id: ana }, { user_id: ben }] })).rejects.toThrow(/who paid/);
  await expect(s().create({ what: 'Twice', total_cents: 1000, people: [{ user_id: ana, paid: true }, { user_id: ana }] })).rejects.toThrow(/twice/);
  await expect(s().create({ what: 'Ghost', total_cents: 1000, people: [{ user_id: ana, paid: true }, { user_id: 9999 }] })).rejects.toThrow(/isn't in this Life Is/);
  const preview = await s().preview({ what: 'x', total_cents: 1000, people: [{ user_id: ana, paid: true }, { user_id: ben }, { name: 'Hank' }] });
  expect(preview.shares.map((x) => x.cents)).toEqual([334, 333, 333]);
  expect(preview.words).toContain('Leftover cents go one each to the first people on the list');
});

it('settling takes a line out of the balance and into a short history, and can be taken back', async () => {
  const a = await s().create({ what: 'Dinner', total_cents: 9000, day: '2046-03-01', people: [{ user_id: ana, paid: true }, { user_id: ben }, { user_id: cat }] });
  const b = await s(ben).create({ what: 'Gas', total_cents: 4000, day: '2046-03-02', people: [{ user_id: ben, paid: true }, { user_id: ana }] });
  let page = await s().list();
  // Ana is owed 3000 + 3000 for dinner, and owes 2000 for gas: boiled down, ben owes ana 1000 and cat owes ana 3000.
  expect(page.payments.map((p) => [p.from, p.to, p.cents]).sort()).toEqual([['ben', 'ana', 1000], ['cat', 'ana', 3000]].sort());
  expect(page.you_are_owed).toBe(4000);
  const benDinner = page.splits.find((x) => x.id === a.id)!.shares.find((x) => x.who === 'ben')!;
  // Ben marks his own part settled; cat cannot mark Ben's.
  await s(ben).settle(benDinner.id, true);
  await expect(s(cat).settle(benDinner.id, true)).rejects.toThrow(/your own part/);
  page = await s().list();
  // Ben's dinner share is paid. What is left: ana owes ben 2000 for gas, and cat owes 3000 for dinner.
  expect(page.payments.map((p) => [p.from, p.to, p.cents])).toEqual([['cat', 'ben', 2000], ['cat', 'ana', 1000]]);
  expect(page.history).toMatchObject([{ what: 'Dinner', from: 'ben', to: 'ana', cents: 3000, settled_on: '2046-03-05' }]);
  // Ana, who paid, marks what she was paid by cat; then takes it back.
  const catDinner = page.splits.find((x) => x.id === a.id)!.shares.find((x) => x.who === 'cat')!;
  expect(catDinner.can_settle).toBe(true);
  await s().settle(catDinner.id, true);
  expect((await s().list()).payments.map((p) => p.from)).toEqual(['ana']);
  await s().settle(catDinner.id, false);
  expect((await s().list()).payments.map((p) => p.from)).toEqual(['cat', 'cat']);
  expect(b.id).toBeGreaterThan(0);
  // The one who paid has nothing to settle.
  const payerShare = page.splits.find((x) => x.id === a.id)!.shares.find((x) => x.paid)!;
  await expect(s().settle(payerShare.id, true)).rejects.toThrow(/nothing to settle/);
});

it('each person sees only the splits they are in; only the one who made it can change or remove it', async () => {
  const made = await s().create({ what: 'Trip gas', total_cents: 4000, day: '2046-03-01', people: [{ user_id: ana, paid: true }, { user_id: ben }, { name: 'Hank' }] });
  expect((await s(ben).list()).splits.map((x) => x.what)).toEqual(['Trip gas']);
  const out = await s(cat).list();
  expect(out.splits).toEqual([]);
  expect(out.payments).toEqual([]);
  // Cat cannot open it, settle on it, change it or remove it, and is told nothing about it.
  const share = (await s().list()).splits[0]!.shares[1]!;
  await expect(s(cat).settle(share.id, true)).rejects.toThrow(/isn't here/);
  await expect(s(cat).remove(made.id)).rejects.toThrow(/isn't here/);
  // Ben is in it, but did not make it.
  await expect(s(ben).update(made.id, { what: 'Mine now', total_cents: 4000, people: [{ user_id: ben, paid: true }, { user_id: ana }] })).rejects.toThrow(/Only the person who made/);
  await expect(s(ben).remove(made.id)).rejects.toThrow(/Only the person who made/);
  // The one who made it changes it: a line settled stays settled when that share is not changed.
  const benShare = (await s().list()).splits[0]!.shares.find((x) => x.who === 'ben')!;
  await s(ben).settle(benShare.id, true);
  await s().update(made.id, { what: 'Trip gas and tolls', total_cents: 4000, day: '2046-03-01', people: [{ user_id: ana, paid: true }, { user_id: ben }, { name: 'Hank' }] });
  const changed = (await s().list()).splits[0]!;
  expect(changed.what).toBe('Trip gas and tolls');
  expect(changed.shares.find((x) => x.who === 'ben')!.settled_on).toBe('2046-03-05');
  await s().remove(made.id);
  expect((await s(ben).list()).splits).toEqual([]);
  expect((await db.get<{ n: number }>('SELECT COUNT(*) AS n FROM split_shares'))!.n).toBe(0);
});

it('a typed name is only a label: it can be settled by the one who paid, and never signs in', async () => {
  const made = await s().create({ what: 'Pizza', total_cents: 3000, people: [{ user_id: ana, paid: true }, { name: 'Hank' }] });
  const hank = (await s().list()).splits[0]!.shares.find((x) => x.typed)!;
  expect(hank).toMatchObject({ who: 'Hank', user_id: null, you: false, can_settle: true });
  await s().settle(hank.id, true);
  expect((await s().list()).payments).toEqual([]);
  expect(made.id).toBeGreaterThan(0);
});
