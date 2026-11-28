/** Splits and savings pots over the web addresses: each person sees only what they are in, and plain checks say what is wrong. */
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


it('a purchase is split three ways with a typed name, and shows who owes whom', async () => {
  const admin = await owner();
  await member(admin, 'Sam');
  const people = (await admin.get('/api/splits')).json.people as { id: number; name: string }[];
  const sam = people.find((p) => p.name.toLowerCase() === 'sam')!;
  const me = (await admin.get('/api/splits')).json.me as { id: number };
  const entry = await admin.post('/api/money/entries', { label: 'Pizza night', cents: 6001, day: '2046-03-04' });
  const start = await admin.get(`/api/splits/start?entry=${entry.json.id}`);
  expect(start.json).toMatchObject({ what: 'Pizza night', total_cents: 6001, day: '2046-03-04' });
  const people3 = [{ user_id: me.id, paid: true }, { user_id: sam.id }, { name: 'Hank' }];
  const preview = await admin.post('/api/splits/preview', { ...start.json, people: people3 });
  expect(preview.json.shares.map((s: { cents: number }) => s.cents)).toEqual([2001, 2000, 2000]);
  const made = await admin.post('/api/splits', { ...start.json, people: people3 });
  expect(made.status).toBe(201);
  const page = (await admin.get('/api/splits')).json;
  expect(page.splits).toHaveLength(1);
  expect(page.payments.map((p: { from: string; cents: number }) => [p.from, p.cents])).toEqual([['Hank', 2000], ['sam', 2000]]);
  // Plain checks.
  expect((await admin.post('/api/splits', { what: 'x', total_cents: 1000, people: [{ user_id: me.id, paid: true, mode: 'amount', cents: 100 }, { name: 'Hank', mode: 'amount', cents: 100 }] })).status).toBe(422);
  expect((await admin.post('/api/splits', { what: 'x', total_cents: 1000, people: [{ user_id: me.id, mode: 'odd' }] })).status).toBe(422);
  expect((await admin.get('/api/splits/start?entry=999999')).status).toBe(404);
  expect((await visitor().get('/api/splits')).status).toBe(401);
});

it('a person outside a split cannot see it, settle on it, change it or remove it; one inside can only mark their own part', async () => {
  const admin = await owner();
  const sam = await member(admin, 'Sam');
  const kim = await member(admin, 'Kim');
  const ids = (await admin.get('/api/splits')).json;
  const find = (name: string) => (ids.people as { id: number; name: string }[]).find((p) => p.name.toLowerCase() === name.toLowerCase())!.id;
  const made = await admin.post('/api/splits', { what: 'Gas', total_cents: 4000, people: [{ user_id: ids.me.id, paid: true }, { user_id: find('Sam') }] });
  const id: number = made.json.id;
  expect((await sam.get('/api/splits')).json.splits).toHaveLength(1);
  const line = (await sam.get('/api/splits')).json.splits[0].shares.find((s: { you: boolean }) => s.you);
  expect(line.can_settle).toBe(true);
  // Kim is in nothing.
  expect((await kim.get('/api/splits')).json.splits).toEqual([]);
  expect((await kim.post(`/api/splits/shares/${line.id}/settle`, { settled: true })).status).toBe(404);
  expect((await kim.put(`/api/splits/${id}`, { what: 'Mine', total_cents: 4000, people: [{ user_id: find('Kim'), paid: true }, { name: 'Hank' }] })).status).toBe(404);
  expect((await kim.delete(`/api/splits/${id}`)).status).toBe(404);
  // Sam is in it, so he sees it, but cannot change or remove it.
  expect((await sam.delete(`/api/splits/${id}`)).status).toBe(403);
  expect((await sam.put(`/api/splits/${id}`, { what: 'Mine', total_cents: 4000, people: [{ user_id: find('Sam'), paid: true }, { name: 'Hank' }] })).status).toBe(403);
  expect((await sam.post(`/api/splits/shares/${line.id}/settle`, { settled: true })).status).toBe(204);
  const after = (await admin.get('/api/splits')).json;
  expect(after.payments).toEqual([]);
  expect(after.history.map((h: { what: string; cents: number }) => [h.what, h.cents])).toEqual([['Gas', 2000]]);
  expect((await admin.delete(`/api/splits/${id}`)).status).toBe(204);
});

it('pots take lines in and out, stay private unless shared, and come back from the list', async () => {
  const admin = await owner();
  const sam = await member(admin, 'Sam');
  const samId = ((await admin.get('/api/pots')).json.people as { id: number; name: string }[]).find((p) => p.name.toLowerCase() === 'sam')!.id;
  const car = await admin.post('/api/pots', { name: 'The car' });
  expect(car.status).toBe(201);
  expect((await admin.post('/api/pots', { name: '  ' })).status).toBe(400);
  expect((await admin.post(`/api/pots/${car.json.id}/lines`, { cents: 20000, note: 'Refund' })).status).toBe(201);
  expect((await admin.post(`/api/pots/${car.json.id}/lines`, { cents: -30000 })).status).toBe(422);
  expect((await admin.post(`/api/pots/${car.json.id}/lines`, { cents: -4550, note: 'Tires' })).status).toBe(201);
  expect((await admin.get('/api/pots')).json).toMatchObject({ total: 15450, pots: [{ name: 'The car', balance: 15450 }] });
  expect((await sam.get('/api/pots')).json.pots).toEqual([]);
  expect((await sam.post(`/api/pots/${car.json.id}/lines`, { cents: 100 })).status).toBe(404);
  expect((await admin.put(`/api/pots/${car.json.id}`, { shared_with: [samId] })).status).toBe(204);
  expect((await sam.post(`/api/pots/${car.json.id}/lines`, { cents: 100 })).status).toBe(201);
  expect((await sam.put(`/api/pots/${car.json.id}`, { closed: true })).status).toBe(403);
  expect((await admin.put(`/api/pots/${car.json.id}`, { closed: true, name: 'Car fund' })).status).toBe(204);
  expect((await sam.get('/api/pots')).json.pots[0]).toMatchObject({ name: 'Car fund', mine: false });
  expect((await sam.post(`/api/pots/${car.json.id}/lines`, { cents: 100 })).status).toBe(409);
});
