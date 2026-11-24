/** Outdoor trips over the web addresses: one trip with camping and fishing, a bring list, a catch log, hunting kept private. */
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
let time = new Date(2026, 9, 1, 12, 0, 0);
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
  const made = await admin.post('/api/users', { username, password: PASSWORD });
  expect(made.status).toBe(201);
  const someone = visitor();
  expect((await someone.post('/api/auth/login', { username, password: PASSWORD })).status).toBe(200);
  return { client: someone, id: made.json.id as number };
}

beforeEach(async () => {
  folder = mkdtempSync(path.join(tmpdir(), 'lifeis-test-'));
  errors.length = 0;
  time = new Date(2026, 9, 1, 12, 0, 0);
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

const TRIP = { name: 'Lake weekend', parts: ['camping', 'fishing'], day: '2026-10-09', end_day: '2026-10-11' };
const API = '/api/plans/trips';

it('makes a camping and fishing trip, packs, logs a catch with a lure, and sends a torn tent to Upkeep', async () => {
  const admin = await owner();
  expect((await admin.get(API)).json).toEqual([]);
  expect((await admin.post(API, { ...TRIP, parts: ['sailing'] })).status).toBe(400);
  expect((await admin.post(API, { ...TRIP, name: undefined })).status).toBe(422);
  const made = await admin.post(API, TRIP);
  expect([made.status, made.json.parts, made.json.years[0].day]).toEqual([201, ['camping', 'fishing'], '2026-10-09']);
  const planId = made.json.years[0].plan_id;
  const kinds = (await admin.post('/api/things/kinds', { name: 'Camping gear', icon: null, fields: [] })).json;
  const kind = kinds.find((k: { name: string }) => k.name === 'Camping gear');
  await admin.post('/api/things/items', { kind_id: kind.id, name: 'Family tent' });
  const filled = (await admin.post(`${API}/years/${planId}/fill-gear`, { part: 'camping' })).json;
  expect([filled.added, filled.gear.map((g: { label: string }) => g.label)]).toEqual([1, ['Family tent']]);
  const options = (await admin.get(`${API}/options`)).json;
  expect(options.things.map((t: { name: string }) => t.name)).toEqual(['Family tent']);
  await admin.post('/api/things/kinds', { name: 'Fishing tackle', icon: null, fields: [] });
  const lure = (await admin.post('/api/things/items', { kind_id: (await admin.get('/api/things/kinds')).json.find((k: { name: string }) => k.name === 'Fishing tackle').id, name: 'Jig heads', quantity: 6 })).json;
  const fished = await admin.post(`${API}/years/${planId}/catches`, { fish: 'Walleye', day: '2026-10-10', water: 'Lake Pepin', length_inches: 17, kept: true, lure_thing_id: lure.id });
  expect([fished.status, fished.json.catches[0].lure, fished.json.worked[0].lures[0].lure]).toEqual([201, 'Jig heads', 'Jig heads']);
  expect((await admin.post(`${API}/years/${planId}/catches`, { fish: ' ' })).status).toBe(400);
  const torn = await admin.put(`${API}/gear/${filled.gear[0].id}`, { returned: true, after_trip: 'repair' });
  expect(torn.json.gear[0].job_id).toEqual(expect.any(Number));
  expect((await admin.get('/api/things/upkeep')).json.some((j: { name: string }) => j.name === 'Repair: Family tent')).toBe(true);
  expect((await admin.put(`${API}/years/${planId}`, { check_in: '2026-10-11', check_out: '2026-10-09' })).status).toBe(400);
  expect((await admin.put(`${API}/years/${planId}`, { campground: 'Pine Hollow', check_in: '2026-10-09', check_out: '2026-10-11' })).json.booking.campground).toBe('Pine Hollow');
  const next = await admin.post(`${API}/${made.json.id}/years`, {});
  expect([next.status, next.json.day]).toEqual([201, '2026-10-09']); // the one already coming is the year to use
});

it('shows a shared trip to the house without its hunting, and hides a private one', async () => {
  const admin = await owner();
  const { client } = await member(admin, 'Sam');
  const made = (await admin.post(API, { ...TRIP, parts: ['fishing', 'hunting'] })).json;
  const planId = made.years[0].plan_id;
  await admin.post(`${API}/years/${planId}/harvest`, { animal: 'Turkey', tag_number: 'T-77' });
  const seen = await client.get(`${API}/shared`);
  expect(seen.json).toHaveLength(1);
  expect(seen.json[0]).toMatchObject({ name: 'Lake weekend', who: 'owner', parts: ['fishing'] });
  expect(seen.text).not.toMatch(/Turkey|T-77|hunting/);
  expect((await client.get(`${API}/years/${planId}`)).status).toBe(404);
  expect((await admin.put(`${API}/${made.id}`, { private: true })).json.private).toBe(true);
  expect((await client.get(`${API}/shared`)).json).toEqual([]);
});
