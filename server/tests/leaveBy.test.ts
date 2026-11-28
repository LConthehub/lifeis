/** The minutes to get there on an event, over the web addresses. */
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

it('the minutes to get there are kept on an event, and checked', async () => {
  const admin = await owner();
  const made = await admin.post('/api/calendar/events', { title: 'Dentist', day: '2046-03-05', time: '15:00', travel_minutes: 25 });
  expect([made.status, made.json.travel_minutes]).toEqual([201, 25]);
  expect((await admin.get(`/api/calendar/events/${made.json.id}`)).json.travel_minutes).toBe(25);
  expect((await admin.post('/api/calendar/events', { title: 'Picnic', day: '2046-03-05', travel_minutes: 25 })).status).toBe(400);
  expect((await admin.post('/api/calendar/events', { title: 'Picnic', day: '2046-03-05', time: '12:00', travel_minutes: 2.5 })).status).toBe(422);
  expect((await admin.put(`/api/calendar/events/${made.json.id}`, { title: 'Dentist', day: '2046-03-05', time: '15:00' })).json.travel_minutes).toBeNull();
});
