/**
 * The server, asked the way the pages ask it: over HTTP, with a session cookie. Each test gets its own
 * throwaway data folder and its own server.
 */
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createApp } from '../src/app.ts';
import { verifyPassword } from '../src/auth.ts';
import { openDatabase, type OpenDatabase } from '../src/database.ts';

const PASSWORD = 'correct-horse-battery';
const MONDAY = '2046-03-05';

let folder: string;
let database: OpenDatabase;
let server: Server;
let base: string;
let time: Date | null;
const errors: unknown[] = [];

/** Someone using Life Is: remembers their session cookie between requests, as a browser does. */
function visitor() {
  let session = '';
  async function ask(method: string, address: string, body?: unknown, headers: Record<string, string> = {}) {
    const response = await fetch(base + address, {
      method,
      headers: { ...(session ? { Cookie: session } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    });
    const set = response.headers.get('set-cookie');
    if (set) session = set.split(';')[0]!;
    const bytes = Buffer.from(await response.arrayBuffer());
    const json = response.headers.get('content-type') === 'application/json' ? JSON.parse(bytes.toString('utf8')) : undefined;
    return { status: response.status, json, bytes, headers: response.headers, cookie: set };
  }
  return {
    get: (address: string, headers?: Record<string, string>) => ask('GET', address, undefined, headers),
    post: (address: string, body?: unknown, headers?: Record<string, string>) => ask('POST', address, body, headers),
    put: (address: string, body?: unknown) => ask('PUT', address, body),
    delete: (address: string) => ask('DELETE', address),
  };
}

async function start(staticDir?: string) {
  database = await openDatabase(path.join(folder, 'data'), path.join(folder, 'keys'));
  server = createServer(createApp({ db: database.db, staticDir, clock: () => time ?? new Date(), onError: (problem) => errors.push(problem) }));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

async function stop() {
  await new Promise((resolve) => server.close(resolve));
  database.close();
}

/** The owner, signed in: the first account, made on this computer. */
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
  time = null;
  errors.length = 0;
  await start();
});

afterEach(async () => {
  await stop();
  rmSync(folder, { recursive: true, force: true });
  expect(errors).toEqual([]);
});

// ---------- the front door ----------

it('the first account is the admin, and everything else needs signing in', async () => {
  const stranger = visitor();
  expect((await stranger.get('/api/health')).json).toEqual({ status: 'ok' });
  expect((await stranger.get('/api/auth/status')).json).toEqual({ setup_required: true, local: true, user: null });
  expect((await stranger.get('/api/kitchen/recipes')).status).toBe(401);
  expect((await stranger.post('/api/auth/setup', { username: 'x', password: PASSWORD })).status).toBe(400);
  expect((await stranger.post('/api/auth/setup', { username: 'owner', password: 'too short' })).status).toBe(400);
  expect((await stranger.post('/api/auth/setup', { username: 'owner' })).status).toBe(422);

  const admin = visitor();
  const made = await admin.post('/api/auth/setup', { username: ' Owner ', password: PASSWORD });
  expect([made.status, made.json]).toEqual([201, { id: 1, username: 'owner', is_admin: true }]);
  expect(made.cookie).toMatch(/^lifeis_session=[\w-]{43}; Max-Age=2592000; Path=\/; HttpOnly; SameSite=Lax$/);
  expect((await admin.get('/api/auth/status')).json).toEqual({ setup_required: false, local: true, user: { id: 1, username: 'owner', is_admin: true } });
  expect((await stranger.post('/api/auth/setup', { username: 'second', password: PASSWORD })).status).toBe(403);

  const answer = await admin.get('/api/kitchen/recipes');
  expect([answer.status, answer.json]).toEqual([200, []]);
  expect([answer.headers.get('cache-control'), answer.headers.get('x-frame-options')]).toEqual(['no-store', 'DENY']);

  const other = await member(admin, 'partner');
  expect((await other.post('/api/users', { username: 'nope', password: PASSWORD })).status).toBe(403);
  expect((await admin.post('/api/users', { username: 'partner', password: PASSWORD })).status).toBe(409);

  expect((await admin.post('/api/auth/logout')).status).toBe(204);
  expect((await admin.get('/api/kitchen/recipes')).status).toBe(401);
});

it('the first account can only be made on this computer', async () => {
  // Through a reverse proxy (Caddy adds X-Forwarded-For), setup is refused, whether or not an account exists yet.
  const stranger = visitor();
  const refused = await stranger.post('/api/auth/setup', { username: 'stranger', password: PASSWORD }, { 'X-Forwarded-For': '203.0.113.9' });
  expect(refused.status).toBe(403);
  expect(refused.json.detail).toContain('localhost');
  expect((await stranger.get('/api/auth/status', { 'X-Forwarded-For': '203.0.113.9' })).json.local).toBe(false);
  expect((await stranger.get('/api/auth/status')).json.setup_required).toBe(true);
});

it('wrong passwords are refused, then slowed down, and the wait survives a restart', async () => {
  await owner();
  time = new Date(); // held still, so a slow disk can't run the lockout down before it's checked
  const guesser = visitor();
  for (let i = 0; i < 4; i += 1) expect((await guesser.post('/api/auth/login', { username: 'owner', password: 'wrong-wrong-wrong' })).status).toBe(401);
  expect((await guesser.post('/api/auth/login', { username: 'nobody', password: PASSWORD })).status).toBe(401);
  expect((await guesser.post('/api/auth/login', { username: 'owner', password: 'wrong-wrong-wrong' })).status).toBe(401);
  // Five failures: now even the right password waits.
  const locked = await guesser.post('/api/auth/login', { username: 'owner', password: PASSWORD });
  expect(locked.status).toBe(429);
  expect(locked.json.detail).toMatch(/Try again in [12] seconds/);
  await stop();
  await start();
  expect((await visitor().post('/api/auth/login', { username: 'owner', password: PASSWORD })).status).toBe(429);
  time = new Date(time.getTime() + 5000);
  const back = await visitor().post('/api/auth/login', { username: 'OWNER', password: PASSWORD });
  expect([back.status, back.json]).toEqual([200, { id: 1, username: 'owner', is_admin: true }]);
});

it('a session left unused is signed out, after the time the person chose', async () => {
  const admin = await owner();
  expect((await admin.get('/api/account')).json).toEqual({ idle_minutes: 15, idle_choices: [5, 15, 30, 60, 120, 480, 0] });
  time = new Date(Date.now() + 14 * 60_000);
  expect((await admin.get('/api/account', { 'X-Background': '1' })).status).toBe(200); // looked at, but not used
  time = new Date(Date.now() + 16 * 60_000);
  expect((await admin.get('/api/account')).status).toBe(401);

  time = null;
  expect((await admin.post('/api/auth/login', { username: 'owner', password: PASSWORD })).status).toBe(200);
  expect((await admin.put('/api/account', { idle_minutes: 7 })).status).toBe(400);
  expect((await admin.put('/api/account', { idle_minutes: 0 })).json.idle_minutes).toBe(0);
  time = new Date(Date.now() + 29 * 86_400_000);
  expect((await admin.get('/api/account')).status).toBe(200); // "stay signed in" lasts up to 30 days
  time = new Date(Date.now() + 31 * 86_400_000);
  expect((await admin.get('/api/account')).status).toBe(401);
});

it('changing the password signs out the other devices', async () => {
  const laptop = await owner();
  const phone = visitor();
  expect((await phone.post('/api/auth/login', { username: 'owner', password: PASSWORD })).status).toBe(200);
  expect((await laptop.post('/api/auth/change-password', { current_password: 'not-the-password', new_password: 'a-new-long-password' })).status).toBe(400);
  expect((await laptop.post('/api/auth/change-password', { current_password: PASSWORD, new_password: 'short' })).status).toBe(400);
  expect((await laptop.post('/api/auth/change-password', { current_password: PASSWORD, new_password: 'a-new-long-password' })).status).toBe(204);
  expect((await laptop.get('/api/account')).status).toBe(200);
  expect((await phone.get('/api/account')).status).toBe(401);
  expect((await phone.post('/api/auth/login', { username: 'owner', password: PASSWORD })).status).toBe(401);
  expect((await phone.post('/api/auth/login', { username: 'owner', password: 'a-new-long-password' })).status).toBe(200);
});

it("a change another website started is refused", async () => {
  const admin = await owner();
  const blocked = await admin.post('/api/kitchen/grocery', { label: 'milk' }, { 'Sec-Fetch-Site': 'cross-site' });
  expect([blocked.status, blocked.json.detail]).toEqual([403, 'Request blocked: it came from another website']);
  expect((await admin.post('/api/kitchen/grocery', { label: 'milk' }, { 'Sec-Fetch-Site': 'same-origin' })).status).toBe(201);
});

it('the database is encrypted on disk, and passwords the Python server hashed still open', async () => {
  await owner();
  expect(readFileSync(database.file).subarray(0, 16).toString('latin1')).not.toBe('SQLite format 3\0');
  const stored = (await database.db.get<{ password_hash: string }>('SELECT password_hash FROM users'))!.password_hash;
  expect(stored).toMatch(/^scrypt\$16384\$8\$1\$[0-9a-f]{32}\$[0-9a-f]{64}$/);
  expect(stored).not.toContain(PASSWORD);
  // Made by backend/auth.py's hash_password, for "correct-horse-battery".
  const fromPython = 'scrypt$16384$8$1$000102030405060708090a0b0c0d0e0f$5e8024724ca945dbe940a4517c079edcbe91186b07d9b87894049309f3ab1ee4';
  expect(await verifyPassword(PASSWORD, fromPython)).toBe(true);
  expect(await verifyPassword('correct-horse-batterx', fromPython)).toBe(false);
  expect(await verifyPassword(PASSWORD, 'scrypt$16384$8$1$zz$zz')).toBe(false);
  expect(await verifyPassword(PASSWORD, 'scrypt$1073741824$8$1$00$00')).toBe(false); // asks for far too much work
});

it("the database won't open with another key, and is left alone", async () => {
  await owner();
  await stop();
  const before = readFileSync(database.file);
  await expect(openDatabase(path.join(folder, 'data'), path.join(folder, 'other-keys'))).rejects.toThrow("can't be opened with the key");
  expect(readFileSync(database.file).equals(before)).toBe(true);
  await start();
  expect((await visitor().post('/api/auth/login', { username: 'owner', password: PASSWORD })).status).toBe(200);
});

// ---------- the kitchen, over the web ----------

it('the kitchen answers the pages as it always has', async () => {
  const admin = await owner();
  const made = await admin.post('/api/kitchen/recipes', {
    title: 'Lasagne', servings: 6, ingredients_text: '# For the sauce\n1 lb ground beef\nSalt to taste', steps_text: 'Brown the beef.\n\nBake.', tags: ['Dinner'],
  });
  expect(made.status).toBe(201);
  const id = made.json.id;
  expect(made.json.ingredients_text).toBe('# For the sauce\n1 lb ground beef\nSalt to taste');

  const scaled = (await admin.get(`/api/kitchen/recipes/${id}?servings=9`)).json;
  expect(scaled.ingredients.find((l: { text: string }) => l.text.includes('beef')).scaled).toBe('1 1/2 lb');
  expect((await admin.get('/api/kitchen/recipes?q=beef')).json.map((r: { title: string }) => r.title)).toEqual(['Lasagne']);
  expect((await admin.put(`/api/kitchen/recipes/${id}`, { title: 'Lasagne', servings: 6, ingredients_text: '1 lb ground beef\nSalt to taste' })).json.steps).toEqual([]);

  // What the pages can get wrong, and how they're told.
  expect((await admin.post('/api/kitchen/recipes', { title: ' ' })).json).toEqual({ detail: 'Give the recipe a name' });
  expect((await admin.post('/api/kitchen/recipes', { servings: 4 })).status).toBe(422);
  expect((await admin.post('/api/kitchen/recipes', { title: 'x', servings: 'four' })).status).toBe(422);
  expect((await admin.post('/api/kitchen/recipes', '{not json')).status).toBe(422);
  expect((await admin.get('/api/kitchen/recipes/999')).status).toBe(404);
  expect((await admin.get('/api/kitchen/nothing-here')).status).toBe(404);
  expect((await admin.delete('/api/kitchen/recipes')).status).toBe(405);
  expect((await admin.get('/api/kitchen/plan')).status).toBe(422);

  expect((await admin.put('/api/kitchen/pantry', { name: 'ground beef', quantity: 500, unit: 'g', location: 'freezer', expires_on: null, low_at: null })).json.amount).toBe('500 g');
  expect((await admin.post('/api/kitchen/plan', { day: MONDAY, meal: 'dinner', recipe_id: id, title: '', servings: 12 })).status).toBe(201);
  const meal = (await admin.get(`/api/kitchen/plan?start=${MONDAY}&days=7`)).json[0];
  expect([meal.recipe_title, meal.servings]).toEqual(['Lasagne', 12]);

  const list = (await admin.post('/api/kitchen/grocery/from-plan', { start: MONDAY, days: 7 })).json;
  expect(list.items.map((i: { label: string; amount: string }) => [i.label, i.amount])).toEqual([['ground beef', '0.9 lb'], ['Salt', '']]);
  const ticked = (await admin.post(`/api/kitchen/grocery/${list.items[0].id}/tick`, { done: true, put_away: true })).json;
  expect(ticked.find((i: { label: string }) => i.label === 'ground beef').done).toBe(true);
  expect((await admin.post(`/api/kitchen/plan/${meal.id}/cooked`)).json).toEqual({ cooked: true, check_by_hand: [] });
  expect((await admin.post(`/api/kitchen/plan/${meal.id}/cooked`)).status).toBe(409);
  expect((await admin.post('/api/kitchen/grocery/clear-done')).json.map((i: { label: string }) => i.label)).toEqual(['Salt']);

  // Each person has their own kitchen.
  const other = await member(admin, 'partner');
  expect((await other.get(`/api/kitchen/recipes/${id}`)).status).toBe(404);
  expect((await other.get('/api/kitchen/recipes')).json).toEqual([]);
  expect((await other.post('/api/kitchen/plan', { day: MONDAY, recipe_id: id })).status).toBe(404);

  expect((await admin.delete(`/api/kitchen/recipes/${id}`)).status).toBe(204);
  expect((await admin.get('/api/kitchen/recipes')).json).toEqual([]);
});

it('recipes download as a zip of Nextcloud Cookbook folders', async () => {
  const admin = await owner();
  await admin.post('/api/kitchen/recipes/import', { text: 'Crème brûlée\n1 cup cream\nWarm the cream.' });
  const download = await admin.get('/api/kitchen/recipes-export.zip');
  expect([download.status, download.headers.get('content-type'), download.headers.get('content-disposition')])
    .toEqual([200, 'application/zip', 'attachment; filename="lifeis-recipes.zip"']);

  // Read the zip back the way an unzipper does: the list at the end, then each file where the list says it is.
  const bytes = download.bytes;
  const end = bytes.length - 22;
  expect(bytes.readUInt32LE(end)).toBe(0x06054b50);
  const files = new Map<string, string>();
  let at = bytes.readUInt32LE(end + 16);
  for (let i = 0; i < bytes.readUInt16LE(end + 10); i += 1) {
    expect(bytes.readUInt32LE(at)).toBe(0x02014b50);
    const packed = bytes.readUInt32LE(at + 20);
    const nameLength = bytes.readUInt16LE(at + 28);
    const local = bytes.readUInt32LE(at + 42);
    const name = bytes.subarray(at + 46, at + 46 + nameLength).toString('utf8');
    const dataAt = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
    files.set(name, inflateRawSync(bytes.subarray(dataAt, dataAt + packed)).toString('utf8'));
    at += 46 + nameLength;
  }
  expect([...files.keys()]).toEqual(['Recipes/Crème brûlée/recipe.json', 'Recipes/Crème brûlée/original.txt']);
  expect(JSON.parse(files.get('Recipes/Crème brûlée/recipe.json')!).recipeIngredient).toEqual(['1 cup cream']);
  expect(files.get('Recipes/Crème brûlée/original.txt')).toBe('Crème brûlée\n1 cup cream\nWarm the cream.');
});

// ---------- the pages ----------

it('the pages are served, and nothing outside their folder is', async () => {
  await stop();
  const built = path.join(folder, 'pages');
  mkdirSync(path.join(built, 'assets'), { recursive: true });
  writeFileSync(path.join(built, 'index.html'), '<!doctype html><title>Life Is</title>');
  writeFileSync(path.join(built, 'assets', 'app-abc123.js'), 'console.log("hi")');
  writeFileSync(path.join(folder, 'secret.txt'), 'the key');
  await start(built);

  const anyone = visitor();
  const front = await anyone.get('/');
  expect([front.status, front.headers.get('content-type'), front.headers.get('cache-control')]).toEqual([200, 'text/html; charset=utf-8', 'no-store']);
  expect(front.headers.get('content-security-policy')).toContain("script-src 'self'");
  expect((await anyone.get('/recipes/12')).bytes.toString()).toContain('<title>Life Is</title>'); // the pages work out the rest
  const script = await anyone.get('/assets/app-abc123.js');
  expect([script.headers.get('content-type'), script.headers.get('cache-control')]).toEqual(['text/javascript; charset=utf-8', 'public, max-age=2592000, immutable']);
  for (const sneaky of ['/..%2Fsecret.txt', '/%2e%2e/secret.txt', '/assets/..%2F..%2Fsecret.txt', '/..%5Csecret.txt']) {
    expect((await anyone.get(sneaky)).bytes.toString(), sneaky).not.toContain('the key');
  }
  expect((await anyone.get('/api/nothing')).status).toBe(401);
  expect((await anyone.post('/')).status).toBe(404);
});
