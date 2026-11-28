/** Jottings, by page and by voice: who may do what, and who sees what. */
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
    const text = await response.text();
    const type = response.headers.get('content-type') ?? '';
    return { status: response.status, json: type.startsWith('application/json') ? JSON.parse(text) : undefined, text, type };
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
async function makeKey(who: Someone, can: string[], name = 'Siri on my iPhone') {
  const made = await who.post('/api/keys', { name, can, password: PASSWORD });
  expect(made.status).toBe(201);
  return made.json.key as string;
}
const asKey = (key: string) => ({ Authorization: `Bearer ${key}` });

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

it('jottings are added, listed newest first, reworded, checked off and removed by their person alone', async () => {
  const admin = await owner();
  const bob = await member(admin, 'bob');
  expect((await admin.post('/api/jottings', { text: '   ' })).status).toBe(400);
  expect((await admin.post('/api/jottings', {})).status).toBe(422);
  const first = (await admin.post('/api/jottings', { text: 'call the vet' })).json;
  const second = (await admin.post('/api/jottings', { text: 'the blue pen is in the car' })).json;
  expect(first).toMatchObject({ text: 'call the vet', done: false, day: '2046-03-05' });
  expect((await admin.get('/api/jottings')).json.map((j: { text: string }) => j.text)).toEqual(['the blue pen is in the car', 'call the vet']);
  expect((await admin.put(`/api/jottings/${first.id}`, { text: 'call the vet about Hank' })).json.text).toBe('call the vet about Hank');
  expect((await admin.put(`/api/jottings/${second.id}`, { done: true })).json.done).toBe(true);
  expect((await admin.get('/api/jottings')).json.map((j: { done: boolean }) => j.done)).toEqual([false, true]);
  // Bob sees none of it, and cannot touch it.
  expect((await bob.get('/api/jottings')).json).toEqual([]);
  expect((await bob.put(`/api/jottings/${first.id}`, { done: true })).status).toBe(404);
  expect((await bob.delete(`/api/jottings/${first.id}`)).status).toBe(204);
  expect((await admin.get('/api/jottings')).json).toHaveLength(2);
  expect((await admin.delete(`/api/jottings/${first.id}`)).status).toBe(204);
  expect((await admin.get('/api/jottings')).json).toHaveLength(1);
  // Signed out: no.
  expect((await visitor().get('/api/jottings')).status).toBe(401);
});

it('a key may add a jotting only when it was allowed to, as its person, and cannot read any', async () => {
  const admin = await owner();
  const bob = await member(admin, 'bob');
  const may = await makeKey(admin, ['jotting_add']);
  const mayNot = await makeKey(admin, ['groceries_read'], 'Reader');
  expect((await visitor().post('/api/voice/jottings', { text: 'buy a stamp' }, asKey(mayNot))).status).toBe(403);
  const said = await visitor().post('/api/voice/jottings', { text: 'buy a stamp' }, asKey(may));
  expect([said.status, said.text]).toEqual([200, 'Jotted down.']);
  expect((await visitor().post('/api/voice/jottings', {}, asKey(may))).status).toBe(422);
  expect((await admin.get('/api/jottings')).json.map((j: { text: string }) => j.text)).toEqual(['buy a stamp']);
  expect((await bob.get('/api/jottings')).json).toEqual([]);
  // A key has no way to read them back.
  expect((await visitor().get('/api/voice/jottings', asKey(may))).status).toBe(404);
  expect((await visitor().get('/api/jottings', asKey(may))).status).toBe(401);
});

it('a key made before jottings cannot add one', async () => {
  const admin = await owner();
  const old = await makeKey(admin, ['groceries_read', 'groceries_add', 'today_read', 'meals_read', 'reminder_add']);
  expect((await visitor().post('/api/voice/jottings', { text: 'x' }, asKey(old))).status).toBe(403);
});
