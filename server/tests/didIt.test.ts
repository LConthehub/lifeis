/** Did it over the web addresses: one tap on a thing, a chore or a routine time records today. */
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

it('a thing is tapped Did it, says so, and the tap is taken back', async () => {
  const admin = await owner();
  const kind = (await admin.post('/api/things/kinds', { name: 'Appliances' })).json[0].id;
  const thing = (await admin.post('/api/things/items', { name: 'Water filter', kind_id: kind })).json;
  expect((await admin.get(`/api/things/items/${thing.id}/did`)).json).toEqual({ last_day: null, last_id: null, times: 0 });
  const tap = await admin.post(`/api/things/items/${thing.id}/did`, {});
  expect(tap.status).toBe(201);
  expect(tap.json).toMatchObject({ last_day: '2046-03-05', times: 1 });
  expect((await admin.post(`/api/things/items/${thing.id}/did`, { day: 'someday' })).status).toBe(400);
  // Someone else cannot see, tap or undo it.
  const sam = await member(admin, 'sam');
  expect((await sam.get(`/api/things/items/${thing.id}/did`)).status).toBe(404);
  expect((await sam.post(`/api/things/items/${thing.id}/did`, {})).status).toBe(404);
  expect((await sam.delete(`/api/things/did/${tap.json.last_id}`)).status).toBe(404);
  const undone = await admin.delete(`/api/things/did/${tap.json.last_id}`);
  expect(undone.status).toBe(200);
  expect(undone.json).toEqual({ last_day: null, last_id: null, times: 0 });
  expect((await admin.delete(`/api/things/did/${tap.json.last_id}`)).status).toBe(404);
});

it('a chore with no schedule is tapped Did it once and undone with the same address as before', async () => {
  const admin = await owner();
  const made = await admin.post('/api/things/upkeep', { name: 'Wipe the counters', kind: 'chore' });
  expect(made.status).toBe(201);
  expect(made.json.every).toBeNull();
  const tap = await admin.post(`/api/things/upkeep/${made.json.id}/done`, {});
  expect(tap.status).toBe(201);
  expect(tap.json.job.last_done.day).toBe('2046-03-05');
  const undone = await admin.delete(`/api/things/upkeep/done/${tap.json.done[0].id}`);
  expect(undone.json.last_done).toBeNull();
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
