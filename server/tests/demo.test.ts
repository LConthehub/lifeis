/** Demo mode: a made-up household anyone can sign in to, that can't be locked, grown or used to publish. */
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createApp } from '../src/app.ts';
import { openDatabase, type OpenDatabase } from '../src/database.ts';
import { demoFromEnv, resetDemo } from '../src/demo.ts';

const DEMO = { username: 'demo', password: 'demo-password-for-tests' };
let folder: string;
let database: OpenDatabase;
let server: Server;
let base: string;

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
  return { get: (a: string) => ask('GET', a), post: (a: string, b?: unknown) => ask('POST', a, b), put: (a: string, b?: unknown) => ask('PUT', a, b) };
}

beforeEach(async () => {
  folder = mkdtempSync(path.join(tmpdir(), 'lifeis-demo-'));
  database = await openDatabase(path.join(folder, 'data'), path.join(folder, 'keys'));
  await resetDemo(database.db, DEMO);
  server = createServer(createApp({ db: database.db, demo: DEMO }));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
  database.close();
  rmSync(folder, { recursive: true, force: true });
});

it('a demo needs a password of its own, and is off unless asked for', () => {
  expect(demoFromEnv({})).toBeNull();
  expect(demoFromEnv({ DEMO_MODE: '1', DEMO_PASSWORD: 'long-enough-password' })).toEqual({ username: 'demo', password: 'long-enough-password' });
  expect(() => demoFromEnv({ DEMO_MODE: '1', DEMO_PASSWORD: 'short' })).toThrow(/DEMO_PASSWORD/);
});

it('the sign-in page is handed the demo sign-in, which opens a household with something on every page', async () => {
  const guest = visitor();
  expect((await guest.get('/api/auth/status')).json).toMatchObject({ setup_required: false, user: null, demo: DEMO });
  expect((await guest.post('/api/auth/login', DEMO)).status).toBe(200);
  const counts = await Promise.all(['/api/kitchen/recipes', '/api/things/items', '/api/things/places', '/api/media', '/api/projects', '/api/things/upkeep', '/api/things/pets']
    .map(async (address) => (await guest.get(address)).json.length));
  expect(counts.every((n) => n >= 2)).toBe(true);
  const jobs = (await guest.get('/api/things/upkeep')).json;
  expect(new Set(jobs.map((j: { kind: string }) => j.kind))).toEqual(new Set(['job', 'bill', 'renewal', 'chore']));
  expect(jobs.some((j: { due: { state: string } }) => j.due.state === 'overdue')).toBe(true); // something is due, so reminders and the calendar have something to say
  expect((await guest.get('/api/manual')).json.sections.every((s: { entries: unknown[] }) => s.entries.length >= 1)).toBe(true);
  expect((await guest.get('/api/things/packing')).json.boxes).toHaveLength(3);
  expect((await guest.get('/api/things/upkeep/scores')).json.people.map((p: { name: string }) => p.name)).toEqual(expect.arrayContaining(['Leo', 'Mia']));
  expect((await guest.get('/api/auth/status')).json.user).toMatchObject({ username: 'demo', is_admin: false });
});

it('a visitor can change things, but not lock others out, add people, publish a page or reach outside', async () => {
  const guest = visitor();
  await guest.post('/api/auth/login', DEMO);
  expect((await guest.post('/api/kitchen/grocery', { label: 'Oat milk' })).status).toBeLessThan(300);
  expect((await guest.post('/api/auth/change-password', { current_password: DEMO.password, new_password: 'another-long-password' })).status).toBe(403);
  expect((await guest.post('/api/users', { username: 'friend', password: 'another-long-password' })).status).toBe(403);
  expect((await guest.put('/api/manual/share', { days: 7 })).status).toBe(403);
  // Nothing that reaches outside can be turned on.
  expect((await guest.get('/api/lookups')).json).toMatchObject({ available: false });
  expect((await guest.put('/api/lookups', { books: true })).status).toBe(400);
  expect((await guest.get('/api/reminders')).json.can).toEqual({ email: false, mail_available: false, ntfy: false, push: false });
  expect((await guest.get('/api/mail')).json.available).toBe(false);

  // A reset puts everything back, and signs everyone out.
  await resetDemo(database.db, DEMO);
  expect((await guest.get('/api/kitchen/grocery')).status).toBe(401);
  const again = visitor();
  await again.post('/api/auth/login', DEMO);
  expect((await again.get('/api/kitchen/grocery')).json.map((g: { label: string }) => g.label)).not.toContain('Oat milk');
});
