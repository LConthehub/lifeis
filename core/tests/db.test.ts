import { beforeEach, expect, it } from 'vitest';
import type { Db } from '../src/db.ts';
import { memoryDb } from './memoryDb.ts';

let db: Db;
beforeEach(async () => {
  db = memoryDb();
  await db.run('CREATE TABLE pantry (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, quantity REAL)');
});

const names = async () => (await db.all<{ name: string }>('SELECT name FROM pantry ORDER BY id')).map((r) => r.name);

it('a write says which row it added and how many it touched', async () => {
  expect(await db.run('INSERT INTO pantry (name, quantity) VALUES (?, ?)', ['flour', 500])).toEqual({ lastId: 1, changes: 1 });
  expect((await db.run('INSERT INTO pantry (name) VALUES (?)', ['salt'])).lastId).toBe(2);
  expect((await db.run('UPDATE pantry SET quantity = 0')).changes).toBe(2);
  expect(await db.get('SELECT name, quantity FROM pantry WHERE id = ?', [1])).toEqual({ name: 'flour', quantity: 0 });
  expect(await db.get('SELECT * FROM pantry WHERE id = ?', [99])).toBeUndefined();
  expect(await db.all('SELECT * FROM pantry WHERE id > ?', [99])).toEqual([]);
});

it('a transaction happens whole or not at all', async () => {
  const undone = await db.begin();
  await undone.run('INSERT INTO pantry (name) VALUES (?)', ['rice']);
  expect(await undone.get('SELECT name FROM pantry')).toEqual({ name: 'rice' });
  await undone.rollback();
  expect(await names()).toEqual([]);

  const kept = await db.begin();
  await kept.run('INSERT INTO pantry (name) VALUES (?)', ['rice']);
  await kept.run('INSERT INTO pantry (name) VALUES (?)', ['beans']);
  await kept.commit();
  expect(await names()).toEqual(['rice', 'beans']);
  await expect(kept.run('INSERT INTO pantry (name) VALUES (?)', ['late'])).rejects.toThrow('already ended');
  await expect(kept.commit()).rejects.toThrow('already ended');
});

it("someone else's write waits for an open transaction, and isn't undone with it", async () => {
  const tx = await db.begin();
  await tx.run('INSERT INTO pantry (name) VALUES (?)', ['inside']);
  const outside = db.run('INSERT INTO pantry (name) VALUES (?)', ['outside']);
  const second = db.begin();
  await tx.rollback();
  await outside;
  const tx2 = await second;
  await tx2.run('INSERT INTO pantry (name) VALUES (?)', ['second']);
  await tx2.commit();
  expect(await names()).toEqual(['outside', 'second']);
});
