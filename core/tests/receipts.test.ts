/** Receipt photos and in-store savings: a full price kept apart from what was saved, savings by store and month, price drops inside a store's window, and the savings book. */
import { beforeEach, expect, it } from 'vitest';
import type { Db } from '../src/db.ts';
import { bringInDownload, exportEverything, splitDownload } from '../src/exportAll.ts';
import { kitchen, type Kitchen } from '../src/kitchen.ts';
import { migrate } from '../src/migrations.ts';
import { money } from '../src/money.ts';
import { readReceipt } from '../src/receipt.ts';
import { shopping, type ShoppingOf } from '../src/shopping.ts';
import { trips } from '../src/trips.ts';
import { memoryDb } from './memoryDb.ts';

let db: Db;
let me: number;
let k: Kitchen;
let shop: ShoppingOf;
let day = '2046-03-05';
const clock = Object.assign(() => new Date(Date.UTC(2046, 2, 5, 17, 0, 0)), { today: () => day });
const person = async (name: string) => (await db.run("INSERT INTO users (username, password_hash, created_at) VALUES (?, 'x', 'now')", [name])).lastId;
// The smallest thing that is a JPEG to the reader of picture types.
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xd9]);

const RECEIPT = `
COSTCO WHOLESALE
E 1234567 KS ORG COFFEE 3LB    18.99 A
  1234567 /1234567 INSTANT SAVINGS    4.00-
E 2223334 BANANAS    1.99 A
SUBTOTAL 16.98
TAX 0.00
**** TOTAL 16.98
03/05/2046
`;

beforeEach(async () => {
  db = memoryDb();
  await migrate(db);
  me = await person('me');
  k = kitchen(db, me, clock);
  shop = shopping(db, me, clock);
  day = '2046-03-05';
});

const idOf = async (label: string) => (await k.listGrocery()).find((g) => g.label.toLowerCase().includes(label))!.id;
/** On the list, in the buggy, at Costco, at a price (paid) and a saving. */
async function got(label: string, paid: number, saved = 0, store = 'Costco') {
  await k.addGrocery({ label });
  const id = await idOf(label);
  await k.tickGrocery(id, { done: true, put_away: false });
  await shop.setStore(store);
  await shop.setPrice(id, paid, false, null, null, saved);
  return id;
}

it('a receipt is read into lines tied to what is in the buggy, then written down with a photo and the savings kept apart from the price', async () => {
  await got('coffee', 1899); // typed full first; the receipt then says what was saved
  await got('bananas', 199);
  const tr = trips(db, me, clock);
  const read = await tr.readReceipt(RECEIPT, 'Costco');
  expect(read.receipt.total_cents).toBe(1698);
  expect(read.ties.every((t) => t.id !== null)).toBe(true);
  // The page applies what the person checked: coffee was 18.99 in full, 4.00 off, 14.99 paid.
  const coffee = read.ties[0]!.id!;
  await shop.setPrice(coffee, 1499, false, null, null, 400);
  expect((await tr.plan('Costco')).saved_cents).toBe(400);
  const done = await tr.finish({ store: 'Costco', total_cents: 1698, photo: JPEG, day: '2046-03-05' });
  expect([done.saved_cents, done.receipt, done.got]).toEqual([400, true, 2]);

  // The photo stays with the spending entry.
  const entry = (await money(db, me, clock).month()).entries[0]!;
  expect(entry.receipt_trip).toBe(done.id);
  expect((await tr.receipt(done.id))!.type).toBe('image/jpeg');
  expect(await db.all('SELECT saved_cents FROM shopping_trips')).toEqual([{ saved_cents: 400 }]);
  await money(db, me, clock).removeEntry(entry.id);
  expect(await db.all('SELECT trip_id FROM trip_receipts')).toEqual([]);
});

it('a bad picture is refused, and nothing is written', async () => {
  await got('coffee', 899);
  await expect(trips(db, me, clock).finish({ store: 'Costco', total_cents: 899, photo: new Uint8Array([1, 2, 3]) })).rejects.toMatchObject({ status: 400 });
  expect(await db.all('SELECT id FROM shopping_trips')).toEqual([]);
});

it('history and last time use the full price, with the saving beside it; the sale is also said in words, and totalled by store, month and year', async () => {
  for (const [when, saved] of [['2046-01-10', 0], ['2046-02-10', 400], ['2046-03-05', 400]] as const) {
    day = when;
    const id = await got('coffee', 1899 - saved, saved);
    await k.clearDone();
    expect(id).toBeGreaterThan(0);
  }
  day = '2046-03-20';
  await k.addGrocery({ label: 'coffee' });
  const line = (await shop.summary()).lines[0]!;
  expect(line.last).toMatchObject({ cents: 1899, saved_cents: 400, store: 'Costco' });
  const history = await shop.history(line.id);
  expect(history.map((h) => [h.cents, h.saved_cents])).toEqual([[1899, 400], [1899, 400], [1899, 0]]);
  const trend = (await shop.trends())[0]!;
  expect(trend.latest.cents).toBe(1899);
  expect(trend.highest.cents).toBe(1899);
  expect(trend.savings).toEqual({ times: 2, text: '$4 off in February and March', last_on: '2046-03-05' });

  const s = await shop.savings('2046-03');
  expect([s.month_cents, s.year_cents, s.stores]).toEqual([400, 800, [{ store: 'Costco', month_cents: 400, year_cents: 800 }]]);
  expect((await shop.savings('2045-03')).year_cents).toBe(0);
});

it('a cheaper price at the same store inside its window says how much to ask back; outside the window, or at another store, it does not', async () => {
  const stores = await shop.addStore({ name: 'Costco', adjust_days: 30 });
  expect(stores[0]!.adjust_days).toBe(30);
  day = '2046-02-10';
  await got('coffee', 1899);
  await k.clearDone();
  day = '2046-02-20';
  await got('eggs', 600, 0, 'Aldi'); // Aldi has no window
  await k.clearDone();
  expect(await shop.drops()).toEqual([]);
  // A later receipt: the same coffee, with a saving, paid 14.99.
  day = '2046-03-05';
  await got('coffee', 1499, 400);
  await got('eggs', 500, 0, 'Aldi');
  await k.clearDone();
  const drops = await shop.drops();
  expect(drops).toHaveLength(1);
  expect(drops[0]).toMatchObject({ item: 'coffee', store: 'Costco', bought_on: '2046-02-10', paid_cents: 1899, now_cents: 1499, ask_cents: 400, because: 'receipt', claim_by: '2046-03-12', days_left: 7 });
  // Asked back: not offered again.
  expect(await shop.claimDrop(drops[0]!.id)).toEqual([]);
  // After the window the first purchase is no longer offered.
  day = '2046-03-20';
  expect(await shop.drops()).toEqual([]);
});

it('a saving in the store\'s savings book, typed in, shows on the list line, and flags a buy inside the window', async () => {
  await shop.addStore({ name: 'Costco', adjust_days: 30 });
  day = '2046-02-25';
  await got('coffee', 1899);
  await k.clearDone();
  day = '2046-03-05';
  const noisy = await shop.addBook({ store: 'costco', text: 'KS Coffee 3 lb 4.00\nCereal 20%\nnonsense', starts_on: '2046-03-01', expires_on: '2046-03-31' });
  expect([noisy.added, noisy.skipped]).toEqual([2, ['nonsense']]);
  expect(noisy.summary.book.map((b) => [b.item, b.cents_off, b.percent_off, b.store, b.state])).toEqual([['KS Coffee 3 lb', 400, null, 'Costco', 'now'], ['Cereal', null, 20, 'Costco', 'now']]);
  expect(noisy.summary.coupons).toEqual([]); // not a coupon to use on the shop
  await k.addGrocery({ label: 'coffee' });
  await k.addGrocery({ label: 'milk' });
  const lines = (await shop.summary()).lines;
  expect(lines.map((l) => l.deal && [l.deal.cents_off, l.deal.until])).toEqual([[400, '2046-03-31'], null]);
  // The coffee bought on 25 Feb, inside 30 days, is now 4.00 less in the book: ask back.
  expect((await shop.drops()).map((d) => [d.item, d.ask_cents, d.because])).toEqual([['coffee', 400, 'book']]);
  // Typing the same book again changes it, it does not double it.
  await shop.addBook({ store: 'Costco', text: 'KS Coffee 3 lb 5.00', starts_on: '2046-03-01', expires_on: '2046-03-31' });
  expect((await shop.summary()).book.filter((b) => b.item === 'KS Coffee 3 lb').map((b) => b.cents_off)).toEqual([500]);
  // Before the book starts it is only coming.
  day = '2046-02-27';
  expect((await shop.summary()).book[0]!.state).toBe('soon');
  expect((await shop.summary()).lines[0]!.deal).toBeNull();
});

it('the download carries the savings, the window, the book and the receipt photos', async () => {
  await shop.addStore({ name: 'Costco', adjust_days: 30 });
  await got('coffee', 1499, 400);
  await trips(db, me, clock).finish({ store: 'Costco', total_cents: 1499, photo: JPEG });
  await shop.addBook({ store: 'Costco', text: 'Rice 1.50', starts_on: '2046-03-01', expires_on: '2046-03-31' });
  const zip = await splitDownload((await exportEverything(db, me, clock)).bytes);
  expect(zip.files['prices.csv']).toMatch(/Saved/);
  expect(zip.files['prices.csv']).toMatch(/4\.00/);
  expect(zip.files['stores.csv']).toMatch(/Price adjustment days[\s\S]*Costco[^\n]*30/);
  expect(zip.files['coupons.csv']).toMatch(/Rice[^\n]*yes/);
  expect([...zip.pictures.keys()].some((n) => n.startsWith('pictures/receipts/'))).toBe(true);
  // And brought into another person's Life Is, they come back as they were.
  const bob = await person('bob');
  await bringInDownload(db, bob, zip.files, ['stores', 'prices', 'coupons'], clock);
  expect(await db.all('SELECT adjust_days FROM stores WHERE owner_id = ?', [bob])).toEqual([{ adjust_days: 30 }]);
  expect(await db.all('SELECT cents, saved_cents FROM prices WHERE owner_id = ?', [bob])).toEqual([{ cents: 1499, saved_cents: 400 }]);
  expect(await db.all('SELECT item, book, starts_on FROM coupons WHERE owner_id = ?', [bob])).toEqual([{ item: 'Rice', book: 1, starts_on: '2046-03-01' }]);
});

it('the reader is the same pure function the page calls: it spots Costco savings lines', () => {
  expect(readReceipt(RECEIPT).items[0]).toMatchObject({ cents: 1899, saved_cents: 400 });
});
