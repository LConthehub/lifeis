/** Checkups, the daily check-in and the incident log over the web addresses: they belong to their person alone, by every route. */
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { splitDownload } from '../../core/src/index.ts';
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
const WORDS = ['Quillfeather', 'Zorbwash', 'Snarfle ridge', 'Plinthbottom'];
const leaks = (what: unknown) => { const text = typeof what === 'string' ? what : JSON.stringify(what); return WORDS.some((w) => text.includes(w)); };

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

it('checkups are made, marked done and changed by their person, with plain checks', async () => {
  const admin = await owner();
  expect((await admin.get('/api/checkups')).json).toEqual([]);
  expect((await admin.post('/api/checkups', { name: 'Dentist' })).status).toBe(422);
  expect((await admin.post('/api/checkups', { name: ' ', every_n: 6, every_unit: 'month' })).status).toBe(400);
  expect((await admin.post('/api/checkups', { name: 'Dentist', every_n: 6, every_unit: 'fortnight' })).status).toBe(400);
  const made = await admin.post('/api/checkups', { name: 'Dentist', every_n: 6, every_unit: 'month', last_on: '2045-09-05', note: 'Ask about the crown', cost_cents: 15_000 });
  expect(made.status).toBe(201);
  expect(made.json).toMatchObject({ name: 'Dentist', next_on: '2046-03-05', state: 'due', cost_cents: 15_000 });
  const id: number = made.json.id;
  const done = await admin.post(`/api/checkups/${id}/done`, {});
  expect(done.json).toMatchObject({ last_on: '2046-03-05', next_on: '2046-09-05', state: 'later' });
  expect((await admin.put(`/api/checkups/${id}`, { name: 'Dentist', every_n: 1, every_unit: 'year', last_on: '2046-03-05' })).json.next_on).toBe('2047-03-05');
  expect((await admin.delete(`/api/checkups/${id}`)).status).toBe(204);
  expect((await admin.get('/api/checkups')).json).toEqual([]);
});

it('the daily check-in keeps one a day over the web, and can be changed or taken back', async () => {
  const admin = await owner();
  expect((await admin.get('/api/check-ins')).json).toMatchObject({ today: '2046-03-05', entries: [] });
  expect((await admin.put('/api/check-ins', {})).status).toBe(400);
  expect((await admin.put('/api/check-ins', { energy: 9 })).status).toBe(400);
  expect((await admin.put('/api/check-ins', { water: 'lots' })).status).toBe(422);
  expect((await admin.put('/api/check-ins', { sleep_hours: 7.5, water: 5, energy: 3, line: 'fine' })).json).toMatchObject({ day: '2046-03-05', sleep_hours: 7.5, water: 5, energy: 3, line: 'fine' });
  expect((await admin.put('/api/check-ins', { water: 6 })).json).toMatchObject({ water: 6, sleep_hours: null });
  expect((await admin.get('/api/check-ins')).json.entries).toHaveLength(1);
  expect((await admin.delete('/api/check-ins/2046-03-05')).status).toBe(204);
  expect((await admin.delete('/api/check-ins/2046-03-05')).status).toBe(404);
});

it('the incident log changes an entry for 24 hours, and then only adds to it', async () => {
  const admin = await owner();
  const entry = { happened_on: '2046-03-04', what: 'The back door was open.', who: 'Charlie', kept: 'Two photos' };
  expect((await admin.post('/api/incidents', { what: 'x' })).status).toBe(422);
  expect((await admin.post('/api/incidents', { ...entry, what: ' ' })).status).toBe(400);
  const made = await admin.post('/api/incidents', entry);
  expect(made.status).toBe(201);
  const id: number = made.json.id;
  expect(made.json).toMatchObject({ locked: false, written_at: '2046-03-05T10:00:00+00:00' });
  expect((await admin.put(`/api/incidents/${id}`, { ...entry, what: 'The back door was open and a light was on.' })).json.what).toContain('a light was on');
  // Written 25 hours ago (the sign-in itself would not last that long in this test's clock, so the entry is moved back instead).
  await database.db.run('UPDATE incidents SET written_at = ? WHERE id = ?', ['2046-03-04T09:00:00+00:00', id]);
  expect((await admin.put(`/api/incidents/${id}`, { ...entry, what: 'Changed' })).status).toBe(403);
  expect((await admin.delete(`/api/incidents/${id}`)).status).toBe(403);
  const added = await admin.post(`/api/incidents/${id}/additions`, { words: 'The landlord called.' });
  expect(added.status).toBe(201);
  expect(added.json).toMatchObject({ locked: true, additions: [{ words: 'The landlord called.' }] });
  expect((await admin.post(`/api/incidents/${id}/additions`, { words: ' ' })).status).toBe(400);
  expect((await admin.put(`/api/incidents/${id}/additions/1`, { words: 'x' })).status).toBe(404);
  expect((await admin.delete(`/api/incidents/${id}/additions/1`)).status).toBe(404);
  expect((await admin.get('/api/incidents')).json[0].what).toContain('a light was on');
});

it('nobody else, the person in charge included, can read them by any route', async () => {
  const admin = await owner();
  const sam = await member(admin, 'Sam');
  const c = await sam.post('/api/checkups', { name: 'Quillfeather', every_n: 1, every_unit: 'year', last_on: '2045-03-01', note: 'Zorbwash' });
  await sam.put('/api/check-ins', { line: 'Snarfle ridge' });
  const i = await sam.post('/api/incidents', { happened_on: '2046-03-04', what: 'Plinthbottom' });

  expect((await admin.get('/api/checkups')).json).toEqual([]);
  expect((await admin.get('/api/check-ins')).json.entries).toEqual([]);
  expect((await admin.get('/api/incidents')).json).toEqual([]);
  expect((await admin.put(`/api/checkups/${c.json.id}`, { name: 'Taken', every_n: 1, every_unit: 'year' })).status).toBe(404);
  expect((await admin.post(`/api/checkups/${c.json.id}/done`, {})).status).toBe(404);
  expect((await admin.delete(`/api/checkups/${c.json.id}`)).status).toBe(404);
  expect((await admin.put(`/api/incidents/${i.json.id}`, { happened_on: '2046-03-04', what: 'Taken' })).status).toBe(404);
  expect((await admin.post(`/api/incidents/${i.json.id}/additions`, { words: 'Mine' })).status).toBe(404);
  expect((await admin.delete(`/api/incidents/${i.json.id}`)).status).toBe(404);
  for (const address of [`/api/incidents/${i.json.id}/share`, '/api/incidents/all', '/api/checkups/all', '/api/check-ins/all', '/api/users/1/incidents', '/api/incidents?owner=2', '/api/checkups?owner=2']) {
    expect(leaks((await admin.get(address)).text), address).toBe(false);
  }
  for (const route of ['/api/checkups', '/api/check-ins', '/api/incidents']) expect((await visitor().get(route)).status, route).toBe(401);

  for (const who of [sam, admin]) {
    for (const q of WORDS) expect((await who.get(`/api/search?q=${encodeURIComponent(q)}`)).json, q).toEqual([]);
  }
  for (const who of [admin]) {
    expect(leaks((await who.get('/api/home')).text)).toBe(false);
    expect(leaks((await who.get('/api/actions')).text)).toBe(false);
    expect(leaks((await who.get('/api/assistant')).text)).toBe(false);
    expect(leaks((await who.get('/api/reminders')).text)).toBe(false);
  }
  expect(leaks((await sam.get('/api/home')).text)).toBe(false);
  expect(leaks((await sam.get('/api/assistant')).text)).toBe(false);

  // Personal keys open only the voice addresses.
  for (const who of [sam, admin]) {
    const key = await makeKey(who);
    for (const address of ['/api/voice/groceries', '/api/voice/dinner', '/api/voice/week', '/api/voice/today']) {
      const got = await visitor().get(address, key);
      expect(got.status, address).toBe(200);
      expect(leaks(got.text), address).toBe(false);
    }
    for (const address of ['/api/checkups', '/api/check-ins', '/api/incidents', '/api/voice/incidents', '/api/voice/checkups', '/api/home']) {
      const got = await visitor().get(address, key);
      expect([401, 404], address).toContain(got.status);
      expect(leaks(got.text), address).toBe(false);
    }
    expect((await visitor().post('/api/incidents', { happened_on: '2046-03-04', what: 'x' }, key)).status).toBe(401);
  }

  // The full download: the person's own holds them, nobody else's does.
  const theirs = (await splitDownload((await sam.get('/api/export/everything.zip')).bytes)).files;
  expect(theirs['checkups.csv']).toContain('Quillfeather');
  expect(theirs['check-ins.csv']).toContain('Snarfle ridge');
  expect(theirs['incident-log.csv']).toContain('Plinthbottom');
  const bosses = (await splitDownload((await admin.get('/api/export/everything.zip')).bytes)).files;
  expect(Object.values(bosses).some((t) => leaks(t))).toBe(false);
});
