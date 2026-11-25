/** Letterboxd files and half-star ratings over the web addresses: read, bring in, make a file, and who sees what. */
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createApp } from '../src/app.ts';
import { openDatabase, type OpenDatabase } from '../src/database.ts';

const PASSWORD = 'correct-horse-battery';
let folder: string;
let database: OpenDatabase;
let server: Server;
let base: string;
const errors: unknown[] = [];

function visitor() {
  let session = '';
  async function ask(method: string, address: string, body?: unknown) {
    const response = await fetch(base + address, {
      method, headers: { ...(session ? { Cookie: session } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = response.headers.get('set-cookie');
    if (set) session = set.split(';')[0]!;
    const text = await response.text();
    return { status: response.status, json: response.headers.get('content-type') === 'application/json' ? JSON.parse(text) : undefined, text };
  }
  return { get: (a: string) => ask('GET', a), post: (a: string, b?: unknown) => ask('POST', a, b), put: (a: string, b?: unknown) => ask('PUT', a, b), delete: (a: string) => ask('DELETE', a) };
}

beforeEach(async () => {
  folder = mkdtempSync(path.join(tmpdir(), 'lifeis-test-'));
  errors.length = 0;
  database = await openDatabase(path.join(folder, 'data'), path.join(folder, 'keys'));
  server = createServer(createApp({ db: database.db, clock: () => new Date(2026, 9, 1, 12, 0, 0), onError: (problem) => errors.push(problem) }));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
  database.close();
  rmSync(folder, { recursive: true, force: true });
  expect(errors).toEqual([]);
});

const files = {
  'watched.csv': 'Date,Name,Year,Letterboxd URI\n2024-01-05,The Lantern Keepers,1971,https://boxd.it/aaa1\n',
  'diary.csv': 'Date,Name,Year,Letterboxd URI,Rating,Rewatch,Tags,Watched Date\n2024-01-06,The Lantern Keepers,1971,https://boxd.it/e1,4.5,,,2024-01-05\n',
  'ratings.csv': 'Date,Name,Year,Letterboxd URI,Rating\n2024-01-06,The Lantern Keepers,1971,https://boxd.it/aaa1,4.5\n',
  'reviews.csv': 'Date,Name,Year,Letterboxd URI,Rating,Rewatch,Review,Tags,Watched Date\n2024-01-06,The Lantern Keepers,1971,https://boxd.it/e1,4.5,,"Slow, and kind.",,2024-01-05\n',
  'watchlist.csv': 'Date,Name,Year,Letterboxd URI\n2024-04-01,Marsh Lights,1994,https://boxd.it/ddd4\n',
};

it('reads a download without saving, brings it in, gives half stars, makes a file, and keeps it all to its person', async () => {
  const admin = visitor();
  expect((await admin.post('/api/auth/setup', { username: 'Owner', password: PASSWORD })).status).toBe(201);
  const made = await admin.post('/api/users', { username: 'Guest', password: PASSWORD });
  expect(made.status).toBe(201);
  const guest = visitor();
  expect((await guest.post('/api/auth/login', { username: 'Guest', password: PASSWORD })).status).toBe(200);

  expect((await admin.post('/api/media/letterboxd/read', { files: { 'notes.csv': 'a,b\n1,2\n' } })).status).toBe(400);
  expect((await admin.post('/api/media/letterboxd/read', { files: { 'watched.csv': 5 } })).status).toBe(422);
  const look = await admin.post('/api/media/letterboxd/read', { files });
  expect([look.status, look.json.saved, look.json.films, look.json.days, look.json.reviews, look.json.watchlist]).toEqual([
    200, false, { found: 2, new: 2, already: 0 }, { found: 1, new: 1, already: 0 }, { found: 1, new: 1, already: 0 }, { found: 1, new: 1, already: 0 }]);
  expect((await admin.get('/api/media?wanted=0')).json).toEqual([]);

  const saved = await admin.post('/api/media/letterboxd', { files });
  expect([saved.status, saved.json.saved]).toEqual([201, true]);
  expect((await admin.post('/api/media/letterboxd', { files })).json.films).toEqual({ found: 2, new: 0, already: 2 });
  // Nothing is owned, so the collection stays empty.
  expect((await admin.get('/api/media')).json).toEqual([]);

  const lists = (await admin.get('/api/media/lists')).json;
  const toWatch = lists.find((l: { builtin: string }) => l.builtin === 'to_watch');
  const view = (await admin.get(`/api/media/lists/${toWatch.id}`)).json;
  expect(view.entries.map((e: { title: string; stars: number | null }) => e.title)).toEqual(['Marsh Lights']);
  const lantern = (await admin.get('/api/media/lists')).json.length; // the lists are all there
  expect(lantern).toBe(2);

  // Rate a title: halves only, and null takes it off.
  const title = view.entries[0].media_id as number;
  expect((await admin.put(`/api/media/${title}/stars`, { stars: 3.5 })).json.stars).toBe(3.5);
  expect((await admin.put(`/api/media/${title}/stars`, { stars: 3.3 })).status).toBe(400);
  expect((await admin.put(`/api/media/${title}/stars`, { stars: 'lots' })).status).toBe(422);
  expect((await admin.get(`/api/media/lists/${toWatch.id}`)).json.entries[0].stars).toBe(3.5);

  // The file for Letterboxd.
  const file = (await admin.get(`/api/media/lists/${toWatch.id}/letterboxd`)).json;
  expect([file.films, file.left_out, file.file_name]).toEqual([1, 0, 'to-watch-read-or-hear-for-letterboxd.csv']);
  expect(file.csv).toContain('LetterboxdURI,Title,Year,Directors,Rating,WatchedDate,Rewatch,Review');
  expect(file.csv).toContain('https://boxd.it/ddd4,Marsh Lights,1994,,3.5,,,');

  // The guest has none of it.
  expect((await guest.put(`/api/media/${title}/stars`, { stars: 1 })).status).toBe(404);
  expect((await guest.get(`/api/media/${title}`)).status).toBe(404);
  expect((await guest.get(`/api/media/lists/${toWatch.id}/letterboxd`)).status).toBe(404);
  expect((await guest.get('/api/media/lists')).json.map((l: { name: string }) => l.name)).toEqual(['Wanted', 'To watch, read or hear']);
});
