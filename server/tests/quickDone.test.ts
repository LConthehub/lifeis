/** One tap over the web addresses: a thing use, a chore done record, and a routine time last finished day. */
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
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

it('one tap on a thing records a use, Undo takes back only that use, and nobody else can', async () => {
  const admin = await owner();
  const kind = (await admin.post('/api/things/kinds', { name: 'Appliances' })).json[0].id;
  const thing = (await admin.post('/api/things/items', { name: 'Water filter', kind_id: kind })).json;
  const tap = await admin.post(`/api/things/items/${thing.id}/uses`, {});
  expect(tap.status).toBe(201);
  const used = tap.json.find((h: { what: string }) => h.what === 'used');
  expect(used).toMatchObject({ day: '2046-03-05' });
  const sam = await member(admin, 'sam');
  expect((await sam.delete(`/api/things/uses/${used.id}`)).status).toBe(404);
  // Being added is not a use: it cannot be taken back this way.
  const added = tap.json.find((h: { what: string }) => h.what !== 'used');
  expect((await admin.delete(`/api/things/uses/${added.id}`)).status).toBe(404);
  const undone = await admin.delete(`/api/things/uses/${used.id}`);
  expect(undone.status).toBe(200);
  expect(undone.json.some((h: { what: string }) => h.what === 'used')).toBe(false);
  expect(undone.json.length).toBe(tap.json.length - 1);
  expect((await admin.delete(`/api/things/uses/${used.id}`)).status).toBe(404);
});

it('a chore with no schedule is tapped Done once and undone with the same address as before', async () => {
  const admin = await owner();
  const made = await admin.post('/api/things/upkeep', { name: 'Wipe the counters', kind: 'chore' });
  expect(made.status).toBe(201);
  expect(made.json.every).toBeNull();
  const tap = await admin.post(`/api/things/upkeep/${made.json.id}/done`, {});
  expect(tap.status).toBe(201);
  expect(tap.json.job.last_done.day).toBe('2046-03-05');
  expect(tap.json.done).toHaveLength(1);
  // Adding details replaces the quick record: take it back, then save the fuller one. One record in the end.
  expect((await admin.delete(`/api/things/upkeep/done/${tap.json.done[0].id}`)).json.last_done).toBeNull();
  const full = await admin.post(`/api/things/upkeep/${made.json.id}/done`, { day: '2046-03-05', minutes: 10, note: 'streaky' });
  expect(full.json.done).toHaveLength(1);
});

it('a routine time says when it was last finished', async () => {
  const admin = await owner();
  const routine = (await admin.post('/api/routines', { name: 'Morning', times: [{ name: 'Morning', steps: [{ words: 'Make the bed' }, { words: 'Open the blinds' }] }] })).json;
  const timeId: number = routine.times[0].id;
  expect(routine.times[0].last_done).toBeNull();
  const finished = await admin.put(`/api/routine-day/times/${timeId}`, { done: true });
  expect(finished.json).toMatchObject({ finished: true, last_done: '2046-03-05' });
  expect((await admin.get(`/api/routines/${routine.id}`)).json.times[0].last_done).toBe('2046-03-05');
  expect((await admin.put(`/api/routine-day/times/${timeId}`, { done: false })).json.last_done).toBeNull();
});
