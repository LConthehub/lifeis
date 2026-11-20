/** Shopping: prices as the trolley fills, what things cost last time, and coupons. */
import { beforeEach, expect, it } from 'vitest';
import type { Db } from '../src/db.ts';
import { kitchen, type Kitchen } from '../src/kitchen.ts';
import { migrate } from '../src/migrations.ts';
import { shopping, type ShoppingOf } from '../src/shopping.ts';
import { memoryDb } from './memoryDb.ts';

let db: Db;
let owner: number;
let k: Kitchen;
let shop: ShoppingOf;
let time: Date;
const clock = () => time;

async function person(name: string): Promise<number> {
  return (await db.run("INSERT INTO users (username, password_hash, created_at) VALUES (?, 'x', 'now')", [name])).lastId;
}

beforeEach(async () => {
  db = memoryDb();
  await migrate(db);
  owner = await person('owner');
  time = new Date(2046, 2, 5, 10, 0, 0);
  k = kitchen(db, owner, clock);
  shop = shopping(db, owner, clock);
});

const problem = (status: number) => expect.objectContaining({ name: 'Problem', status });
const idOf = async (label: string) => (await k.listGrocery()).find((g) => g.label.toLowerCase().includes(label))!.id;

it('prices add up as things go in the trolley, in whole cents', async () => {
  await k.addGrocery({ label: '2 lb chicken thighs' });
  await k.addGrocery({ label: 'milk' });
  await k.addGrocery({ label: 'bread' });
  const [chicken, milk, bread] = [await idOf('chicken'), await idOf('milk'), await idOf('bread')];

  let s = await shop.summary();
  expect([s.currency, s.store, s.totals]).toEqual(['$', null, { trolley_cents: 0, trolley_unpriced: 0, left_cents: 0, left_unknown: 3, coupons_cents: 0, to_pay_cents: 0 }]);

  await shop.setStore(' Aldi ');
  await k.tickGrocery(chicken, { done: true, put_away: false });
  await shop.setPrice(chicken, 698);
  await k.tickGrocery(milk, { done: true, put_away: false });
  s = await shop.setPrice(milk, 10); // ten cents and twenty cents are thirty cents, exactly
  await k.tickGrocery(bread, { done: true, put_away: false });
  s = await shop.setPrice(bread, 20);
  expect([s.store, s.totals.trolley_cents, s.totals.to_pay_cents, s.totals.left_unknown]).toEqual(['Aldi', 728, 728, 0]);
  expect(s.lines.find((l) => l.id === chicken)).toEqual({ id: chicken, price_cents: 698, assumed: false, last: null, coupons: [] });

  // A price is replaced, not added to; and can be taken away again.
  s = await shop.setPrice(chicken, 649);
  expect(s.totals.trolley_cents).toBe(679);
  s = await shop.setPrice(bread, null);
  expect([s.totals.trolley_cents, s.totals.trolley_unpriced]).toEqual([659, 1]);

  // Only what's ticked off counts as in the trolley.
  await k.tickGrocery(milk, { done: false });
  expect((await shop.summary()).totals.trolley_cents).toBe(649);

  await expect(shop.setPrice(chicken, 3.49)).rejects.toEqual(problem(400)); // dollars, not cents
  await expect(shop.setPrice(chicken, -1)).rejects.toEqual(problem(400));
  await expect(shop.setPrice(9999, 100)).rejects.toEqual(problem(404));
  expect((await shop.setCurrency('£')).currency).toBe('£');
  await expect(shop.setCurrency('  ')).rejects.toEqual(problem(400));
});

it('next time, the list knows what things cost last time and guesses the trip', async () => {
  await shop.setStore('Aldi');
  await k.addGrocery({ label: '2 lb chicken thighs' });
  await k.addGrocery({ label: 'milk' });
  await k.tickGrocery(await idOf('chicken'), { done: true, put_away: false });
  await shop.setPrice(await idOf('chicken'), 698);
  await k.tickGrocery(await idOf('milk'), { done: true, put_away: false });
  await shop.setPrice(await idOf('milk'), 329);
  await k.clearDone(); // home again: the list is cleared, the prices are kept

  time = new Date(2046, 2, 12, 10, 0, 0);
  await shop.setStore('Hy-Vee');
  await k.addGrocery({ label: '2 lb chicken thighs' });
  await k.addGrocery({ label: 'milk' });
  await k.addGrocery({ label: 'saffron' });
  const [chicken, milk] = [await idOf('chicken'), await idOf('milk')];
  let s = await shop.summary();
  expect(s.lines.find((l) => l.id === chicken)!.last).toEqual({ cents: 698, amount: '2 lb', store: 'Aldi', day: '2046-03-05' });
  expect(s.totals).toMatchObject({ trolley_cents: 0, left_cents: 1027, left_unknown: 1 }); // a guess for two, and saffron unknown

  // Ticked off without typing a price: last time's stands in, and says so.
  await k.tickGrocery(milk, { done: true, put_away: false });
  s = await shop.setPrice(milk, 329, true);
  expect([s.lines.find((l) => l.id === milk)!.assumed, s.totals.trolley_cents, s.totals.left_cents]).toEqual([true, 329, 698]);
  // The real price is dearer here.
  await k.tickGrocery(chicken, { done: true, put_away: false });
  s = await shop.setPrice(chicken, 799);
  expect(await shop.history(chicken)).toEqual([{ cents: 799, amount: '2 lb', store: 'Hy-Vee', day: '2046-03-12' }, { cents: 698, amount: '2 lb', store: 'Aldi', day: '2046-03-05' }]);
  await k.clearDone();

  // A stand-in was never a price anyone saw: it isn't history. The chicken's real one is.
  time = new Date(2046, 2, 19, 10, 0, 0);
  await k.addGrocery({ label: 'milk' });
  await k.addGrocery({ label: '2 lb chicken thighs' });
  s = await shop.summary();
  // (Saffron is still on the list from last week, never bought, so never priced.)
  expect(s.lines.map((l) => [l.last?.cents, l.last?.day])).toEqual([[undefined, undefined], [329, '2046-03-05'], [799, '2046-03-12']]);
  expect(await shop.history(await idOf('milk'))).toHaveLength(1);
});

it('coupons come off the total when used, for one thing or the whole shop', async () => {
  await k.addGrocery({ label: 'coffee' });
  await k.addGrocery({ label: 'milk' });
  const [coffee, milk] = [await idOf('coffee'), await idOf('milk')];

  let s = await shop.addCoupon({ label: '$2 off coffee', grocery_id: coffee, cents_off: 200, store: 'Aldi', expires_on: '2046-03-07' });
  s = await shop.addCoupon({ label: '10% off your shop', percent_off: 10, code: 'SPRING10' });
  const [off2, tenth] = s.coupons;
  expect(s.coupons.map((c) => [c.label, c.ingredient?.toLowerCase() ?? null, c.days_left, c.used_on])).toEqual([['$2 off coffee', 'coffee', 2, null], ['10% off your shop', null, null, null]]);
  expect(s.lines.map((l) => l.coupons)).toEqual([[off2!.id], []]); // the list says which line has a coupon

  await k.tickGrocery(coffee, { done: true, put_away: false });
  await shop.setPrice(coffee, 899);
  await k.tickGrocery(milk, { done: true, put_away: false });
  s = await shop.setPrice(milk, 301);
  expect([s.totals.trolley_cents, s.totals.coupons_cents, s.totals.to_pay_cents]).toEqual([1200, 0, 1200]); // not used yet

  s = await shop.useCoupon(off2!.id, true);
  expect([s.totals.coupons_cents, s.totals.to_pay_cents, s.coupons[0]!.used_on]).toEqual([200, 1000, '2046-03-05']);
  s = await shop.useCoupon(tenth!.id, true); // a tenth of the whole trolley
  expect([s.coupons[1]!.worth_cents, s.totals.coupons_cents, s.totals.to_pay_cents]).toEqual([120, 320, 880]);
  s = await shop.useCoupon(tenth!.id, false); // not after all
  expect(s.totals.to_pay_cents).toBe(1000);

  // Money off one thing is never more than the thing cost.
  s = await shop.setPrice(coffee, 150);
  expect([s.coupons[0]!.worth_cents, s.totals.to_pay_cents]).toEqual([150, 301]);

  // Used coupons aren't offered again; one that ran out is flagged, then dropped.
  time = new Date(2046, 2, 6, 10, 0, 0);
  expect((await shop.summary()).coupons.map((c) => c.label)).toEqual(['10% off your shop']);
  s = await shop.addCoupon({ label: '50c off bread', cents_off: 50, expires_on: '2046-03-01' });
  expect(s.coupons.map((c) => [c.label, c.days_left])).toEqual([['50c off bread', -5], ['10% off your shop', null]]);
  time = new Date(2046, 2, 20, 10, 0, 0);
  expect((await shop.summary()).coupons.map((c) => c.label)).toEqual(['10% off your shop']);

  s = await shop.updateCoupon(tenth!.id, { label: '15% off your shop', percent_off: 15 });
  expect([s.coupons[0]!.label, s.coupons[0]!.percent_off]).toEqual(['15% off your shop', 15]);
  expect((await shop.removeCoupon(tenth!.id)).coupons).toEqual([]);

  await expect(shop.addCoupon({ label: 'Both', cents_off: 100, percent_off: 10 })).rejects.toEqual(problem(400));
  await expect(shop.addCoupon({ label: 'Neither' })).rejects.toEqual(problem(400));
  await expect(shop.addCoupon({ label: 'Too much', percent_off: 150 })).rejects.toEqual(problem(400));
  await expect(shop.addCoupon({ label: ' ', cents_off: 100 })).rejects.toEqual(problem(400));
  await expect(shop.addCoupon({ label: 'For what', cents_off: 100, grocery_id: 9999 })).rejects.toEqual(problem(404));
});

it("one person's prices and coupons are their own", async () => {
  await k.addGrocery({ label: 'milk' });
  const milk = await idOf('milk');
  await k.tickGrocery(milk, { done: true, put_away: false });
  await shop.setPrice(milk, 329);
  const s = await shop.addCoupon({ label: '$1 off', cents_off: 100 });

  const theirs = shopping(db, await person('other'), clock);
  expect(await theirs.summary()).toMatchObject({ lines: [], coupons: [], totals: { trolley_cents: 0 } });
  await expect(theirs.setPrice(milk, 1)).rejects.toEqual(problem(404));
  await expect(theirs.history(milk)).rejects.toEqual(problem(404));
  await expect(theirs.useCoupon(s.coupons[0]!.id, true)).rejects.toEqual(problem(404));
  await theirs.removeCoupon(s.coupons[0]!.id);
  expect((await shop.summary()).coupons).toHaveLength(1);
});

it('a product is taught once by its barcode, and found on the list ever after', async () => {
  await k.addGrocery({ label: 'coffee' });
  await k.addGrocery({ label: 'milk' });
  const [coffee, milk] = [await idOf('coffee'), await idOf('milk')];

  expect(await shop.scan('0 25500-00027 6')).toEqual({ barcode: '0025500000276', ingredient: null, line: null, last: null }); // never seen
  let seen = await shop.learn('025500000276', coffee, 'Folgers Classic Roast 30 oz');
  expect(seen).toEqual({ barcode: '0025500000276', ingredient: { id: expect.any(Number), name: expect.stringMatching(/coffee/i), product: 'Folgers Classic Roast 30 oz' },
    line: { id: coffee, label: expect.stringMatching(/coffee/i), amount: '', done: false }, last: null });
  // The 12-digit and 13-digit forms of the same code are one barcode.
  expect((await shop.scan('0025500000276')).line!.id).toBe(coffee);

  // Bought with the scan: the price remembers which product it was.
  await shop.setStore('Aldi');
  await k.tickGrocery(coffee, { done: true, put_away: false });
  await shop.setPrice(coffee, 899, false, '025500000276');
  expect((await db.get<{ barcode: string }>('SELECT barcode FROM prices WHERE grocery_id = ?', [coffee]))!.barcode).toBe('0025500000276');
  expect((await shop.scan('025500000276')).line).toMatchObject({ id: coffee, done: true }); // already in the trolley

  // Next week it isn't on the list, but the scan still knows what it is and what it cost.
  await k.clearDone();
  seen = await shop.scan('025500000276');
  expect([seen.ingredient!.product, seen.line, seen.last]).toEqual(['Folgers Classic Roast 30 oz', null, { cents: 899, amount: '', store: 'Aldi', day: '2046-03-05' }]);
  await k.addGrocery({ label: 'coffee' });
  expect((await shop.scan('025500000276')).line).toMatchObject({ done: false });

  // Another brand can be the same ingredient; a barcode taught wrongly is simply taught again.
  await shop.learn('4006381333931', await idOf('coffee'));
  expect((await shop.scan('4006381333931')).ingredient!.name).toMatch(/coffee/i);
  expect((await shop.learn('4006381333931', milk)).ingredient!.name).toMatch(/milk/i);
  await shop.forget('4006381333931');
  expect((await shop.scan('4006381333931')).ingredient).toBeNull();

  await expect(shop.scan('!!')).rejects.toEqual(problem(400));
  await expect(shop.learn('025500000276', 9999)).rejects.toEqual(problem(404));
  // Someone else scanning the same tin has taught nothing yet.
  expect((await shopping(db, await person('other'), clock).scan('025500000276')).ingredient).toBeNull();
});

it('prices are followed over time, like for like, and spending by the month', async () => {
  const buy = async (label: string, price: number, at: Date, store: string, assumed = false) => {
    time = at;
    await shop.setStore(store);
    await k.addGrocery({ label });
    const id = (await k.listGrocery()).find((g) => !g.done)!.id;
    await k.tickGrocery(id, { done: true, put_away: false });
    await shop.setPrice(id, price, assumed);
    await k.clearDone();
  };
  await buy('2 lb chicken thighs', 698, new Date(2046, 0, 10), 'Aldi');   // 3.49 a pound
  await buy('5 lb chicken thighs', 1495, new Date(2046, 1, 14), 'Costco'); // 2.99 a pound: cheaper, though the bill is bigger
  await buy('2 lb chicken thighs', 798, new Date(2046, 2, 5), 'Hy-Vee');   // 3.99 a pound
  await buy('milk', 329, new Date(2046, 1, 14), 'Costco');
  await buy('milk', 349, new Date(2046, 2, 5), 'Hy-Vee');
  await buy('milk', 349, new Date(2046, 2, 6), 'Hy-Vee', true);            // a stand-in: spent, but not a price anyone saw
  await buy('saffron', 1200, new Date(2046, 2, 5), 'Hy-Vee');

  const [chicken, milk, saffron] = await shop.trends();
  expect([chicken!.name.toLowerCase(), chicken!.times, chicken!.basis, chicken!.per]).toEqual(['chicken thighs', 3, 'per', 'lb']);
  expect(chicken!.points.map((p) => [p.day, p.per_cents, p.amount, p.store])).toEqual([
    ['2046-01-10', 349, '2 lb', 'Aldi'], ['2046-02-14', 299, '5 lb', 'Costco'], ['2046-03-05', 399, '2 lb', 'Hy-Vee']]);
  expect([chicken!.lowest.store, chicken!.highest.store, chicken!.latest.per_cents, chicken!.change_cents]).toEqual(['Costco', 'Hy-Vee', 399, 100]);
  // Milk has no amount, so it's compared as bought; the stand-in isn't one of its prices.
  expect([milk!.times, milk!.basis, milk!.per, milk!.change_cents, milk!.lowest.cents]).toEqual([2, 'line', null, 20, 329]);
  expect([saffron!.times, saffron!.change_cents]).toEqual([1, null]);

  expect(await shop.spending()).toEqual([{ month: '2046-03', cents: 798 + 349 + 349 + 1200, lines: 4 }, { month: '2046-02', cents: 1495 + 329, lines: 2 }, { month: '2046-01', cents: 698, lines: 1 }]);
  expect(await shop.spending(1)).toHaveLength(1);
  expect(await shopping(db, await person('other'), clock).trends()).toEqual([]);
});
