/** Medicines over the web addresses: a private list, checked off as routine steps, shared with chosen people only, and left out of search and the AI connection. */
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
// 2046-03-05 is a Monday.
const MONDAY = new Date(2046, 2, 5, 10, 0, 0);

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
    return { status: response.status, json: response.headers.get('content-type') === 'application/json' ? JSON.parse(text) : undefined };
  }
  return {
    get: (address: string) => ask('GET', address), post: (address: string, body?: unknown) => ask('POST', address, body),
    put: (address: string, body?: unknown) => ask('PUT', address, body), delete: (address: string) => ask('DELETE', address),
  };
}

async function owner() {
  const admin = visitor();
  expect((await admin.post('/api/auth/setup', { username: 'Owner', password: PASSWORD })).status).toBe(201);
  return admin;
}
async function member(admin: ReturnType<typeof visitor>, username: string) {
  expect((await admin.post('/api/users', { username, password: PASSWORD })).status).toBe(201);
  const someone = visitor();
  expect((await someone.post('/api/auth/login', { username, password: PASSWORD })).status).toBe(200);
  return someone;
}

beforeEach(async () => {
  folder = mkdtempSync(path.join(tmpdir(), 'lifeis-test-'));
  errors.length = 0;
  database = await openDatabase(path.join(folder, 'data'), path.join(folder, 'keys'));
  server = createServer(createApp({ db: database.db, clock: () => MONDAY, onError: (problem) => errors.push(problem) }));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
  database.close();
  rmSync(folder, { recursive: true, force: true });
  expect(errors).toEqual([]);
});

type DayTime = { id: number; steps: { id: number; words: string }[] };

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64').toString('base64');

it('keeps a medicine, counts it down from the routine, keeps it private, shares it with one person and no other, and leaves it out of search', async () => {
  const admin = await owner();
  const ana = await member(admin, 'ana');
  const bob = await member(admin, 'bob');
  const made = await ana.post('/api/medicines', { name: 'Zorbex', dose: '5 mg', left: 10, fill_size: 30, prescriber_name: 'Dr. Ames', prescriber_phone: '555-0100', make: ['Morning'] });
  expect([made.status, made.json.left, made.json.times.map((t: { title: string }) => t.title)]).toEqual([201, 10, ['Medicines: Morning']]);
  const id = made.json.id;
  // Taking it is checking the routine step.
  const today: DayTime[] = (await ana.get('/api/routine-day')).json;
  expect(today[0]!.steps[0]!.words).toBe('Zorbex, 5 mg');
  await ana.put(`/api/routine-day/steps/${today[0]!.steps[0]!.id}`, { done: true });
  expect((await ana.get(`/api/medicines/${id}`)).json.left).toBe(9);
  expect((await ana.post(`/api/medicines/${id}/refilled`, {})).json.left).toBe(39);
  expect((await ana.put(`/api/medicines/${id}/photo`, { data: PNG })).json.photo).toBe(true);
  // Nobody else, the person in charge included, sees any of it.
  for (const other of [admin, bob]) {
    expect((await other.get('/api/medicines')).json).toMatchObject({ mine: [], shared: [] });
    for (const [method, address] of [['GET', `/api/medicines/${id}`], ['GET', `/api/medicines/${id}/photo`], ['PUT', `/api/medicines/${id}/sharing`], ['DELETE', `/api/medicines/${id}`], ['POST', `/api/medicines/${id}/refilled`]] as const) {
      const answer = method === 'GET' ? await other.get(address) : method === 'DELETE' ? await other.delete(address) : method === 'PUT' ? await other.put(address, { people: [] }) : await other.post(address, { amount: 1 });
      expect([method, address, answer.status]).toEqual([method, address, 404]);
    }
    expect((await other.get('/api/routine-day')).json).toEqual([]);
  }
  // Search and the AI connection never meet it.
  expect((await ana.get('/api/search?q=zorbex')).json).toEqual([]);
  expect(JSON.stringify((await ana.get('/api/search?q=medicines')).json)).not.toMatch(/Zorbex/);
  // Shared with bob only.
  const people = (await ana.get('/api/medicines')).json.people;
  const bobId = people.find((p: { name: string }) => p.name === 'bob').id;
  expect((await ana.put(`/api/medicines/${id}/sharing`, { people: [bobId] })).json).toEqual({ people: [bobId] });
  expect((await bob.get('/api/medicines')).json.shared.map((m: { name: string; mine: boolean }) => [m.name, m.mine])).toEqual([['Zorbex', false]]);
  expect((await bob.get(`/api/medicines/${id}/photo`)).status).toBe(200);
  expect((await bob.put(`/api/medicines/${id}`, { name: 'x' })).status).toBe(404);
  expect((await admin.get('/api/medicines')).json).toMatchObject({ mine: [], shared: [] });
  // The one switch is each person's own.
  expect((await ana.put('/api/medicines/settings', { show_names: true })).json).toEqual({ show_names: true });
  expect((await bob.get('/api/medicines')).json.show_names).toBe(false);
  expect((await ana.put('/api/medicines/settings', { show_names: 'yes' })).status).toBe(422);
  // The download can be made with it in.
  const zip = await ana.get('/api/export/everything.zip');
  expect(zip.status).toBe(200);
  expect((await ana.delete(`/api/medicines/${id}`)).status).toBe(204);
  expect((await ana.get('/api/routine-day')).json).toEqual([]);
});
