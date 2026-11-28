/** "I put X in Y" and "Where is X", by voice: each its own permission. */
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

it('"I put X in Y" and "Where is X" work with their own permission, and say plainly when they are not sure', async () => {
  const admin = await owner();
  const put = await makeKey(admin, ['thing_put'], 'Putter');
  const where = await makeKey(admin, ['thing_where'], 'Asker');
  const other = await makeKey(admin, ['groceries_read'], 'Reader');
  const kind = (await admin.post('/api/things/kinds', { name: 'Kitchen things' })).json[0].id;
  const places = (await admin.post('/api/things/places', { name: 'Kitchen cupboard' })).json;
  await admin.post('/api/things/places', { name: 'Hall closet' });
  const cupboard = places.find((p: { name: string }) => p.name === 'Kitchen cupboard').id;
  expect((await admin.post('/api/things/items', { kind_id: kind, name: 'Egg cooker', place_id: cupboard })).status).toBe(201);
  // Each is its own permission.
  expect((await visitor().post('/api/voice/put', { text: 'I put the egg cooker in the hall closet' }, asKey(where))).status).toBe(403);
  expect((await visitor().post('/api/voice/put', { text: 'I put the egg cooker in the hall closet' }, asKey(other))).status).toBe(403);
  expect((await visitor().get('/api/voice/where?thing=egg%20cooker', asKey(put))).status).toBe(403);
  expect((await visitor().get('/api/voice/where?thing=egg%20cooker', asKey(other))).status).toBe(403);
  // Not clear: nothing changes.
  const unclear = await visitor().post('/api/voice/put', { text: 'I put the whisk in the hall closet' }, asKey(put));
  expect([unclear.status, unclear.text]).toEqual([200, 'I don\'t know a thing called "the whisk". Nothing was moved.']);
  expect((await visitor().post('/api/voice/put', { text: 'the egg cooker' }, asKey(put))).status).toBe(400);
  // The move, whole or in two parts.
  const moved = await visitor().post('/api/voice/put', { text: 'I put the egg cooker in the hall closet' }, asKey(put));
  expect([moved.status, moved.type, moved.text]).toEqual([200, 'text/plain; charset=utf-8', 'The egg cooker is in the hall closet now.']);
  expect((await visitor().post('/api/voice/put', { thing: 'egg cooker', place: 'kitchen cupboard' }, asKey(put))).text).toBe('The egg cooker is in the kitchen cupboard now.');
  expect((await visitor().post('/api/voice/put', { thing: 'egg cooker', place: 'hall closet' }, asKey(put))).text).toBe('The egg cooker is in the hall closet now.');
  const found = await visitor().get('/api/voice/where?thing=the%20egg%20cooker', asKey(where));
  expect([found.status, found.text]).toEqual([200, 'The egg cooker is in the hall closet, since today.']);
  expect((await visitor().get('/api/voice/where?thing=spatula', asKey(where))).text).toBe('I don\'t know a thing called "spatula".');
  expect((await visitor().post('/api/voice/where', { thing: 'egg cooker' }, asKey(where))).text).toBe('The egg cooker is in the hall closet, since today.');
  // Another person's key sees none of this person's things.
  const bob = await member(admin, 'bob');
  const bobs = await makeKey(bob, ['thing_where'], 'Bobs');
  expect((await visitor().get('/api/voice/where?thing=egg%20cooker', asKey(bobs))).text).toBe('I don\'t know a thing called "egg cooker".');
});

it('a key made before the new permissions cannot use them', async () => {
  const admin = await owner();
  const old = await makeKey(admin, ['groceries_read', 'groceries_add', 'today_read', 'meals_read', 'reminder_add']);
  for (const [method, address] of [['POST', '/api/voice/jottings'], ['POST', '/api/voice/put'], ['GET', '/api/voice/where?thing=x']] as const) {
    const answer = await (method === 'GET' ? visitor().get(address, asKey(old)) : visitor().post(address, { text: 'x in y' }, asKey(old)));
    expect([address, answer.status]).toEqual([address, 403]);
  }
});
