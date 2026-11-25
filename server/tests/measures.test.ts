/** Measures and workouts over the web addresses: measures belong to their person alone, by every route. */
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { isPaidPath, splitDownload } from '../../core/src/index.ts';
import { createApp } from '../src/app.ts';
import { openDatabase, type OpenDatabase } from '../src/database.ts';

const PASSWORD = 'correct-horse-battery';
// 2046-03-05 is a Monday.
const MONDAY = new Date(2046, 2, 5, 10, 0, 0);
let folder: string;
let database: OpenDatabase;
let server: Server;
let base: string;
let time: Date;
const errors: unknown[] = [];

// Words and numbers that appear nowhere else, so finding one anywhere is a leak.
const NAME = 'Quillfeather';
const UNIT = 'zorbs';
const VALUE = 77.123;
const leaks = (what: unknown) => { const text = typeof what === 'string' ? what : JSON.stringify(what); return text.includes(NAME) || text.includes(UNIT) || text.includes(String(VALUE)); };

function visitor() {
  let session = '';
  async function ask(method: string, address: string, body?: unknown, headers: Record<string, string> = {}) {
    const response = await fetch(base + address, {
      method,
      headers: { ...(session ? { Cookie: session } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = response.headers.get('set-cookie');
    if (set) session = set.split(';')[0]!;
    const bytes = new Uint8Array(await response.arrayBuffer());
    const text = new TextDecoder().decode(bytes);
    const type = response.headers.get('content-type') ?? '';
    return { status: response.status, json: type.startsWith('application/json') ? JSON.parse(text) : undefined, text, bytes };
  }
  return {
    get: (address: string, headers?: Record<string, string>) => ask('GET', address, undefined, headers),
    post: (address: string, body?: unknown, headers?: Record<string, string>) => ask('POST', address, body, headers),
    put: (address: string, body?: unknown) => ask('PUT', address, body),
    delete: (address: string) => ask('DELETE', address),
  };
}
type Someone = ReturnType<typeof visitor>;

async function owner() {
  const admin = visitor();
  expect((await admin.post('/api/auth/setup', { username: 'Owner', password: PASSWORD })).status).toBe(201);
  return admin;
}
async function member(admin: Someone, username: string) {
  expect((await admin.post('/api/users', { username, password: PASSWORD })).status).toBe(201);
  const someone = visitor();
  expect((await someone.post('/api/auth/login', { username, password: PASSWORD })).status).toBe(200);
  return someone;
}
const ALL = ['groceries_read', 'groceries_add', 'today_read', 'meals_read', 'reminder_add'];
async function makeKey(who: Someone) {
  const made = await who.post('/api/keys', { name: 'Siri on my iPhone', can: ALL, password: PASSWORD });
  expect(made.status).toBe(201);
  return { Authorization: `Bearer ${made.json.key as string}` };
}

beforeEach(async () => {
  folder = mkdtempSync(path.join(tmpdir(), 'lifeis-test-'));
  errors.length = 0;
  time = MONDAY;
  database = await openDatabase(path.join(folder, 'data'), path.join(folder, 'keys'));
  server = createServer(createApp({ db: database.db, clock: () => time, onError: (problem) => errors.push(problem) }));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
  database.close();
  rmSync(folder, { recursive: true, force: true });
  expect(errors).toEqual([]);
});

it('measures are made, added to and changed by their person, with plain checks', async () => {
  const admin = await owner();
  expect((await admin.get('/api/measures')).json).toEqual([]);
  expect((await admin.post('/api/measures', { unit: 'lb' })).status).toBe(422);
  expect((await admin.post('/api/measures', { name: '   ' })).status).toBe(400);
  const made = await admin.post('/api/measures', { name: 'Weight', unit: 'lb' });
  expect(made.status).toBe(201);
  const id: number = made.json.id;
  expect((await admin.post(`/api/measures/${id}/entries`, { value: 'heavy' })).status).toBe(422);
  expect((await admin.post(`/api/measures/${id}/entries`, { value: 181.5, day: '2046-03-01' })).status).toBe(201);
  const second = await admin.post(`/api/measures/${id}/entries`, { value: 180 });
  expect(second.json.entries.map((e: { day: string; value: number }) => [e.day, e.value])).toEqual([['2046-03-05', 180], ['2046-03-01', 181.5]]);
  expect((await admin.put(`/api/measures/${id}`, { name: 'Weight', unit: 'lb', target: 170 })).json.target).toBe(170);
  expect((await admin.delete(`/api/measures/entries/${second.json.entries[0].id}`)).json.entry_count).toBe(1);
  expect((await admin.delete(`/api/measures/${id}`)).status).toBe(204);
  expect((await admin.get('/api/measures')).json).toEqual([]);
});

it('nobody else, the person in charge included, can read measures by any route', async () => {
  const admin = await owner();
  const sam = await member(admin, 'Sam');
  const made = await sam.post('/api/measures', { name: NAME, unit: UNIT, target: 61.5 });
  const id: number = made.json.id;
  const entry = await sam.post(`/api/measures/${id}/entries`, { value: VALUE, day: '2046-03-04' });
  const entryId: number = entry.json.entries[0].id;

  // The measures addresses: the person in charge sees nothing and can change nothing.
  expect((await admin.get('/api/measures')).json).toEqual([]);
  expect((await admin.put(`/api/measures/${id}`, { name: 'Taken' })).status).toBe(404);
  expect((await admin.delete(`/api/measures/${id}`)).status).toBe(404);
  expect((await admin.post(`/api/measures/${id}/entries`, { value: 1 })).status).toBe(404);
  expect((await admin.delete(`/api/measures/entries/${entryId}`)).status).toBe(404);
  // Nobody signed in sees nothing either.
  expect((await visitor().get('/api/measures')).status).toBe(401);
  // There is no way to share, and no address that names another person.
  for (const address of [`/api/measures/${id}/share`, `/api/measures/${id}/shares`, `/api/measures/shared`, `/api/measures/all`, `/api/users/${1}/measures`, `/api/measures?owner=2`]) {
    const got = await admin.get(address);
    expect(leaks(got.text), address).toBe(false);
  }
  expect((await sam.post(`/api/measures/${id}/share`, { user: 1 })).status).toBe(404);

  // Search, for the person it belongs to and for the person in charge.
  for (const who of [sam, admin]) for (const q of [NAME, UNIT, String(VALUE)]) expect((await who.get(`/api/search?q=${encodeURIComponent(q)}`)).json, q).toEqual([]);
  // The front page, for both.
  for (const who of [sam, admin]) expect(leaks((await who.get('/api/home')).text)).toBe(false);
  // The ready-made short requests, the assistant and the reminders.
  for (const who of [sam, admin]) {
    expect(leaks((await who.get('/api/actions')).text)).toBe(false);
    expect(leaks((await who.get('/api/assistant')).text)).toBe(false);
    expect(leaks((await who.get('/api/reminders')).text)).toBe(false);
  }

  // Personal keys: a key opens only the voice addresses. Its answers hold no measure, and it cannot reach /api/measures at all.
  for (const who of [sam, admin]) {
    const key = await makeKey(who);
    for (const address of ['/api/voice/groceries', '/api/voice/dinner', '/api/voice/week', '/api/voice/today']) {
      const got = await visitor().get(address, key);
      expect(got.status, address).toBe(200);
      expect(leaks(got.text), address).toBe(false);
    }
    for (const address of ['/api/measures', `/api/measures/${id}`, '/api/voice/measures', '/api/search?q=Quill', '/api/home']) {
      const got = await visitor().get(address, key);
      expect([401, 404], address).toContain(got.status);
      expect(leaks(got.text), address).toBe(false);
    }
    expect((await visitor().post(`/api/measures/${id}/entries`, { value: 1 }, key)).status).toBe(401);
  }

  // The full download: the person's own holds it, nobody else's does.
  const theirs = (await splitDownload((await sam.get('/api/export/everything.zip')).bytes)).files;
  expect(theirs['measures.csv']).toContain(NAME);
  expect(theirs['measures.csv']).toContain(String(VALUE));
  const bosses = (await splitDownload((await admin.get('/api/export/everything.zip')).bytes)).files;
  expect(Object.values(bosses).some((t) => leaks(t))).toBe(false);
  // The person in charge cannot bring it in from their side either: what they send is theirs alone.
  expect((await admin.get('/api/measures')).json).toEqual([]);
});

it('measures follow the trial and unlock rules of routines', () => {
  expect(isPaidPath('/api/measures')).toBe(true);
  expect(isPaidPath('/api/measures/3/entries')).toBe(true);
  expect(isPaidPath('/api/routines')).toBe(true);
});

it('a workout over the web: private to start with, numbers kept with the tick, last time, and a plain history', async () => {
  const admin = await owner();
  const sam = await member(admin, 'Sam');
  const made = await admin.post('/api/routines', {
    name: 'Leg day', kind: 'workout',
    times: [{ name: 'Workout', steps: [{ words: 'Goblet squat', nums: { sets: 3, reps: 10, weight: 25, weight_unit: 'lb' } }, { words: 'Stretch' }] }],
  });
  expect(made.status).toBe(201);
  expect(made.json).toMatchObject({ kind: 'workout', who_kind: 'me' });
  expect((await sam.get('/api/routines')).json).toEqual([]);
  expect((await sam.get(`/api/routines/${made.json.id}/history`)).status).toBe(404);
  const step = made.json.times[0].steps[0];
  expect((await admin.post('/api/routines', { name: 'Bad', kind: 'workout', times: [{ name: 'T', steps: [{ words: 'X', nums: { sets: 0 } }] }] })).status).toBe(400);
  expect((await admin.post('/api/routines', { name: 'Odd', kind: 'weights', times: [{ name: 'T', steps: [{ words: 'X' }] }] })).status).toBe(400);

  const ticked = await admin.put(`/api/routine-day/steps/${step.id}`, { done: true, nums: { sets: 3, reps: 10, weight: 27.5, weight_unit: 'lb' } });
  expect(ticked.json.steps[0]).toMatchObject({ ticked: true, kept_words: '3 x 10 at 27.5 lb' });
  expect((await admin.put(`/api/routine-day/steps/${step.id}`, { done: true, nums: { sets: 'three' } })).status).toBe(422);
  const next = (await admin.get('/api/routine-day?day=2046-03-06')).json[0].steps[0];
  expect(next.last.text).toBe('3 x 10 at 27.5 lb, Mon');
  const history = (await admin.get(`/api/routines/${made.json.id}/history`)).json;
  expect(history).toMatchObject({ last7: 1, last7_text: '1 of the last 7 days' });
  expect(history.days).toHaveLength(30);
  expect(history.steps[0].entries).toEqual([{ day: '2046-03-05', label: 'Mon', words: '3 x 10 at 27.5 lb' }]);
});
