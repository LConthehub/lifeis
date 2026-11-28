import { beforeEach, expect, it } from 'vitest';
import type { Db } from '../src/db.ts';
import { migrate } from '../src/migrations.ts';
import { seenByOthers } from '../src/privacyCheck.ts';
import { memoryDb } from './memoryDb.ts';

let db: Db;
let ana: number;
let ben: number;
const person = async (name: string) => (await db.run("INSERT INTO users (username, password_hash, created_at) VALUES (?, 'x', 'now')", [name])).lastId;

beforeEach(async () => {
  db = memoryDb();
  await migrate(db);
  ana = await person('ana'); ben = await person('ben');
});

it('says what other people who sign in can see, and only about the person asking', async () => {
  expect(await seenByOthers(db, ana)).toEqual({ others: 1, shared_lists: [], shared_categories: [], shared_private_things: 0, shared_trips: [], private_trips: 0 });
  await db.run("INSERT INTO media_lists (owner_id, name, shared, sort_order, created_at) VALUES (?, 'Movie night', 1, 1, 'now'), (?, 'Mine', 0, 2, 'now'), (?, 'Ben only', 1, 1, 'now')", [ana, ana, ben]);
  const category = (await db.run("INSERT INTO money_categories (owner_id, name, monthly_cents, sort_order, created_at) VALUES (?, 'Groceries', 0, 1, 'now')", [ana])).lastId;
  await db.run('INSERT INTO money_shares (category_id, user_id) VALUES (?, ?)', [category, ben]);
  await db.run("INSERT INTO outdoor_trips (owner_id, name, private, created_at, updated_at) VALUES (?, 'Lake weekend', 0, 'now', 'now'), (?, 'Quiet trip', 1, 'now', 'now')", [ana, ana]);
  expect(await seenByOthers(db, ana)).toMatchObject({ shared_lists: ['Movie night'], shared_categories: [{ name: 'Groceries', people: 1 }], shared_trips: ['Lake weekend'], private_trips: 1 });
  expect((await seenByOthers(db, ben)).shared_lists).toEqual(['Ben only']);
});
