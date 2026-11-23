/** A shop's own order for the aisles, kept in the person's settings. */
import { beforeEach, expect, it } from 'vitest';
import type { Db } from '../src/db.ts';
import { migrate } from '../src/migrations.ts';
import { shopping, type ShoppingOf } from '../src/shopping.ts';
import { memoryDb } from './memoryDb.ts';

let db: Db;
let owner: number;
let shop: ShoppingOf;
const clock = () => new Date(2046, 2, 5, 10, 0, 0);
const problem = (status: number) => expect.objectContaining({ name: 'Problem', status });

beforeEach(async () => {
  db = memoryDb();
  await migrate(db);
  owner = (await db.run("INSERT INTO users (username, password_hash, created_at) VALUES ('owner', 'x', 'now')", [])).lastId;
  shop = shopping(db, owner, clock);
});

it('has no order until one is set, and each shop has its own', async () => {
  const [aldi, costco] = await shop.addStore({ name: 'Aldi' }).then(() => shop.addStore({ name: 'Costco' })).then((list) => [list.find((s) => s.name === 'Aldi')!, list.find((s) => s.name === 'Costco')!]);
  await shop.setStore('Aldi');
  expect(await shop.summary()).toMatchObject({ store: 'Aldi', store_id: aldi!.id, aisle_order: null });
  expect(await shop.aisles(aldi!.id)).toBeNull();

  expect(await shop.setAisles(aldi!.id, ['Produce', 'Dairy', 'produce', '  ', 'Frozen'])).toMatchObject({ aisle_order: ['Produce', 'Dairy', 'Frozen'] });
  await shop.setAisles(costco!.id, ['Frozen', 'Produce']);
  expect(await shop.aisles(aldi!.id)).toEqual(['Produce', 'Dairy', 'Frozen']);
  expect(await shop.aisles(costco!.id)).toEqual(['Frozen', 'Produce']);

  // The list follows the shop you say you are at.
  expect((await shop.setStore('Costco')).aisle_order).toEqual(['Frozen', 'Produce']);
  expect((await shop.setStore(null)).aisle_order).toBeNull();
});

it('is kept in settings, survives renaming the shop, and goes when the shop does or the order is cleared', async () => {
  const aldi = (await shop.addStore({ name: 'Aldi' }))[0]!;
  await shop.setAisles(aldi.id, ['Produce', 'Dairy']);
  expect(await db.get<{ value: string }>('SELECT value FROM user_settings WHERE user_id = ? AND key = ?', [owner, `shopping_aisles_${aldi.id}`])).toEqual({ value: '["Produce","Dairy"]' });

  await shop.updateStore(aldi.id, { name: 'Aldi Main St' });
  await shop.setStore('Aldi Main St');
  expect((await shop.summary()).aisle_order).toEqual(['Produce', 'Dairy']);

  expect((await shop.setAisles(aldi.id, [])).aisle_order).toBeNull();
  await shop.setAisles(aldi.id, ['Dairy']);
  await shop.removeStore(aldi.id);
  expect(await db.get('SELECT 1 AS there FROM user_settings WHERE user_id = ? AND key LIKE ?', [owner, 'shopping_aisles_%'])).toBeUndefined();
});

it("is one person's own, and a shop that isn't yours is not found", async () => {
  const aldi = (await shop.addStore({ name: 'Aldi' }))[0]!;
  const other = shopping(db, (await db.run("INSERT INTO users (username, password_hash, created_at) VALUES ('other', 'x', 'now')", [])).lastId, clock);
  await expect(other.setAisles(aldi.id, ['Dairy'])).rejects.toEqual(problem(404));
  await expect(other.aisles(aldi.id)).rejects.toEqual(problem(404));
  await expect(shop.setAisles(aldi.id, Array.from({ length: 101 }, (_, i) => `Aisle ${i}`))).rejects.toEqual(problem(400));
});
