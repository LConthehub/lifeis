import { beforeEach, expect, it } from 'vitest';
import type { Fetcher, Sealer } from '../src/connections.ts';
import type { Db } from '../src/db.ts';
import { migrate } from '../src/migrations.ts';
import { isPaused, pausedKinds, setPaused, unlessPaused } from '../src/paused.ts';
import { photoLibrary } from '../src/photos.ts';
import { memoryDb } from './memoryDb.ts';

let db: Db;
let ana: number;
let ben: number;
const sealer: Sealer = { seal: (s) => `sealed:${s}`, unseal: (s) => (s.startsWith('sealed:') ? s.slice(7) : null) };
const person = async (name: string) => (await db.run("INSERT INTO users (username, password_hash, created_at) VALUES (?, 'x', 'now')", [name])).lastId;

beforeEach(async () => {
  db = memoryDb();
  await migrate(db);
  ana = await person('ana'); ben = await person('ben');
});

it('switches a connection off for one person without touching anyone else, and back on', async () => {
  expect(await pausedKinds(db, ana)).toEqual({ mail: false, calendars: false, photos: false });
  await setPaused(db, ana, 'photos', true);
  expect([await isPaused(db, ana, 'photos'), await isPaused(db, ben, 'photos'), await isPaused(db, ana, 'mail')]).toEqual([true, false, false]);
  expect((await setPaused(db, ana, 'photos', false)).photos).toBe(false);
});

it('refuses calls while off, and lets them through when on again', async () => {
  let calls = 0;
  const ask = unlessPaused(db, ana, 'mail', async () => { calls += 1; return 'answer'; });
  expect(await ask()).toBe('answer');
  await setPaused(db, ana, 'mail', true);
  await expect(ask()).rejects.toThrow(/turned off in Settings/);
  expect(calls).toBe(1);
  await setPaused(db, ana, 'mail', false);
  expect(await ask()).toBe('answer');
});

it('a switched-off photo library keeps its setup but asks nothing of Immich', async () => {
  const asked: string[] = [];
  const fetcher: Fetcher = async (url) => { asked.push(url); return { status: 200, type: 'application/json', json: async () => ({}), bytes: async () => new Uint8Array() }; };
  const library = photoLibrary(db, ana, () => new Date(), { fetcher, sealer });
  await db.run(`INSERT INTO user_settings (user_id, key, value) VALUES (?, 'photo_library', ?)`, [ana, JSON.stringify({ url: 'http://photos.home:2283', key: 'sealed:k' })]);
  await setPaused(db, ana, 'photos', true);
  await expect(library.taken('2046-03-01', '2046-03-05')).rejects.toThrow();
  expect(asked).toEqual([]);
});
