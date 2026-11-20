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
import { LATEST } from '../../core/src/index.ts';
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

// ---------- things and projects, over the web ----------

it('things and projects answer over the web', async () => {
  const admin = await owner();
  expect((await admin.get('/api/things/starters')).json.map((s: { slug: string }) => s.slug)).toContain('sewing');
  let kinds = (await admin.post('/api/things/starters', { slug: 'sewing' })).json;
  const fabric = kinds.find((k: { name: string }) => k.name === 'Fabric');
  const fibre = fabric.fields.find((f: { name: string }) => f.name === 'Fibre').id;

  // A kind of the person's own, with their own fields.
  const made = await admin.post('/api/things/kinds', { name: 'Board games', icon: '🎲', fields: [{ name: 'Players', type: 'text' }, { name: 'Wear', type: 'choice', choices: ['None', 'Some'] }] });
  expect(made.status).toBe(201);
  const games = made.json.find((k: { name: string }) => k.name === 'Board games');
  expect((await admin.post('/api/things/kinds', { name: 'board games' })).status).toBe(409);
  expect((await admin.post('/api/things/kinds', { name: 'Bad', fields: [{ name: 'x', type: 'colour' }] })).status).toBe(400);
  expect((await admin.post('/api/things/kinds', { name: 'Bad', fields: 'Players' })).status).toBe(422);
  kinds = (await admin.post(`/api/things/kinds/${games.id}/fields`, { name: 'Minutes', type: 'number', unit: 'min' })).json;
  // Renaming a kind leaves its picture alone unless a new one is sent.
  kinds = (await admin.put(`/api/things/kinds/${games.id}`, { name: 'Games' })).json;
  expect(kinds.find((k: { id: number }) => k.id === games.id)).toMatchObject({ name: 'Games', icon: '🎲' });

  const places = (await admin.post('/api/things/places', { name: 'Sewing room' })).json;
  const linen = await admin.post('/api/things/items', { kind_id: fabric.id, name: 'Blue linen', quantity: 5, place_id: places[0].id, values: { [fibre]: 'Flax' } });
  expect([linen.status, linen.json.amount, linen.json.place, linen.json.values]).toEqual([201, '5 yd', 'Sewing room', { [fibre]: 'Flax' }]);
  expect((await admin.post('/api/things/items', { name: 'No kind' })).status).toBe(422);
  expect((await admin.post('/api/things/items', { kind_id: fabric.id, name: 'x', values: ['Flax'] })).status).toBe(422);
  expect((await admin.get('/api/things/items?q=flax')).json.map((i: { name: string }) => i.name)).toEqual(['Blue linen']);
  expect((await admin.get(`/api/things/items?kind_id=${games.id}`)).json).toEqual([]);
  expect((await admin.delete(`/api/things/kinds/${fabric.id}`)).status).toBe(409);

  let dress = (await admin.post('/api/projects', { name: 'Shirt dress', activity: 'Sewing', status: 'planned' })).json;
  dress = (await admin.post(`/api/projects/${dress.id}/lines`, { item_id: linen.json.id, quantity: 3 })).json;
  dress = (await admin.post(`/api/projects/${dress.id}/lines`, { label: '9 inch zip', quantity: 1 })).json;
  expect(dress.lines.map((l: { label: string; amount: string; short: number }) => [l.label, l.amount, l.short])).toEqual([['Blue linen', '3 yd', 0], ['9 inch zip', '1', 1]]);
  expect((await admin.get(`/api/things/items/${linen.json.id}`)).json).toMatchObject({ set_aside: 3, free: 2 });
  expect((await admin.post(`/api/projects/${dress.id}/sessions`, { day: MONDAY, minutes: 90, note: 'Cut out' })).status).toBe(201);
  expect((await admin.get(`/api/projects/sessions?start=${MONDAY}&end=${MONDAY}`)).json.map((s: { project: string; minutes: number }) => [s.project, s.minutes])).toEqual([['Shirt dress', 90]]);
  expect((await admin.get('/api/projects/sessions')).status).toBe(422);
  expect((await admin.get('/api/projects/activities')).json).toEqual(['Sewing']);
  const used = (await admin.post(`/api/projects/lines/${dress.lines[0].id}/use`)).json;
  expect([used.taken, used.lines[0].used_on !== null]).toEqual([true, true]);
  const done = (await admin.put(`/api/projects/${dress.id}`, { name: 'Shirt dress', activity: 'Sewing', status: 'done' })).json;
  expect([done.status, done.check_by_hand]).toEqual(['done', []]);
  expect((await admin.get(`/api/things/items/${linen.json.id}`)).json).toMatchObject({ quantity: 2, set_aside: 0 });
  expect((await admin.get('/api/projects')).json.map((p: { name: string; status: string; minutes: number }) => [p.name, p.status, p.minutes])).toEqual([['Shirt dress', 'done', 90]]);

  // Each person has their own.
  const other = await member(admin, 'partner');
  expect([(await other.get('/api/things/kinds')).json, (await other.get('/api/projects')).json]).toEqual([[], []]);
  expect((await other.get(`/api/things/items/${linen.json.id}`)).status).toBe(404);
  expect((await other.get(`/api/projects/${dress.id}`)).status).toBe(404);
  expect((await visitor().get('/api/things/items')).status).toBe(401);

  expect((await admin.delete(`/api/projects/${dress.id}`)).status).toBe(204);
  expect((await admin.delete(`/api/things/items/${linen.json.id}`)).status).toBe(204);
});

it('what Life Is looks after is asked once, and sets up what fits', async () => {
  const admin = await owner();
  expect((await admin.get('/api/life')).json).toMatchObject({ areas: null, sections: ['eating', 'planning', 'keeping', 'making', 'enjoying'] });
  const saved = (await admin.put('/api/life', { areas: ['eating', 'sewing'] })).json;
  expect([saved.areas, saved.sections, saved.added]).toEqual([['eating', 'sewing'], ['eating', 'keeping', 'making'], ['Fabric', 'Notions', 'Sewing patterns']]);
  expect((await admin.put('/api/life', { areas: ['eating'] })).json).toMatchObject({ sections: ['eating'], added: [] });
  expect((await admin.get('/api/things/kinds')).json).toHaveLength(3); // out of sight, still there
  expect((await admin.put('/api/life', { areas: ['alchemy'] })).status).toBe(400);
  expect((await admin.put('/api/life', {})).status).toBe(422);
  expect((await (await member(admin, 'partner')).get('/api/life')).json.areas).toBeNull(); // each person answers for themselves
});

it('the collection and the calendar answer over the web', async () => {
  const admin = await owner();
  const room = (await admin.post('/api/things/places', { name: 'Living room' })).json[0].id;
  // The room's sticker finds it again, by its code or by the address printed on it.
  const sticker = (await admin.get('/api/things/places/stickers')).json[0];
  expect([sticker.id, sticker.path, /^[2-9A-HJ-NP-Z]{10}$/.test(sticker.code)]).toEqual([room, 'Living room', true]);
  expect((await admin.get(`/api/things/places/sticker?code=${encodeURIComponent(`https://anywhere.example/p/${sticker.code}`)}`)).json).toEqual({ id: room, name: 'Living room', path: 'Living room' });
  expect((await admin.get('/api/things/places/sticker?code=9780441172719')).status).toBe(404);
  const made = await admin.post('/api/media', { type: 'film', title: 'Alien', creator: 'Ridley Scott', year: 1979, genres: ['Horror'], ids: { tmdb: 348 }, copy: { format: 'VHS', place_id: room } });
  expect(made.status).toBe(201);
  let alien = made.json;
  expect(alien).toMatchObject({ title: 'Alien', formats: ['VHS'], ids: { tmdb: '348' } });
  // A barcode kept on a copy finds its title when scanned.
  expect((await admin.post(`/api/media/${alien.id}/copies`, { format: 'Blu-ray', barcode: '024543213465' })).status).toBeLessThan(300);
  expect((await admin.get('/api/media/barcode?code=0024543213465')).json).toEqual([{ id: alien.id, title: 'Alien', type: 'film', year: 1979, format: 'Blu-ray' }]);
  expect([(await admin.get('/api/media/barcode?code=1234')).json, (await admin.get('/api/media/barcode')).status]).toEqual([[], 400]);
  expect((await admin.delete(`/api/media/copies/${(await admin.get(`/api/media/${alien.id}`)).json.copies.find((c: { format: string }) => c.format === 'Blu-ray').id}`)).status).toBeLessThan(300);
  expect(alien.copies[0]).toMatchObject({ format: 'VHS', place: 'Living room' });
  alien = (await admin.post(`/api/media/${alien.id}/copies`, { format: 'Blu-ray', lent_to: 'Sam' })).json;
  expect([alien.formats, alien.lent_to]).toEqual([['VHS', 'Blu-ray'], ['Sam']]);
  // Editing without sending ids keeps them.
  alien = (await admin.put(`/api/media/${alien.id}`, { type: 'film', title: 'Alien', year: 1979 })).json;
  expect(alien.ids).toEqual({ tmdb: '348' });
  expect((await admin.post('/api/media', { type: 'music', title: 'Blue', wanted: true })).json).toMatchObject({ wanted: true, formats: [] });
  expect((await admin.post('/api/media', { type: 'podcast', title: 'x' })).status).toBe(400);
  expect((await admin.post('/api/media', { type: 'film' })).status).toBe(422);
  expect((await admin.post('/api/media', { type: 'film', title: 'x', copy: 'VHS' })).status).toBe(422);
  expect((await admin.get('/api/media?type=film')).json.map((m: { title: string }) => m.title)).toEqual(['Alien']);
  expect((await admin.get('/api/media?wanted=1')).json.map((m: { title: string }) => m.title)).toEqual(['Blue']);
  expect((await admin.get('/api/media?lent=1')).json.map((m: { title: string }) => m.title)).toEqual(['Alien']);
  expect((await admin.get(`/api/media?place_id=${room}`)).json.map((m: { title: string }) => m.title)).toEqual(['Alien']);
  expect((await admin.get('/api/media/formats?type=book')).json).toEqual(['Hardcover', 'Paperback', 'Ebook', 'Audiobook']);

  // Watched while sewing: kept with the session, and seen from the film and from the calendar.
  const dress = (await admin.post('/api/projects', { name: 'Shirt dress', status: 'active' })).json;
  const worked = (await admin.post(`/api/projects/${dress.id}/sessions`, { day: MONDAY, minutes: 90, media_ids: [alien.id] })).json;
  expect(worked.sessions[0].media).toEqual([{ id: alien.id, title: 'Alien', type: 'film' }]);
  expect((await admin.post(`/api/projects/${dress.id}/sessions`, { day: MONDAY, media_ids: ['Alien'] })).status).toBe(422);
  alien = (await admin.post(`/api/media/${alien.id}/log`, { day: '2046-03-06', note: 'again' })).json;
  expect(alien.log.map((l: { day: string; project: string | null }) => [l.day, l.project])).toEqual([['2046-03-06', null], [MONDAY, 'Shirt dress']]);

  const dentist = await admin.post('/api/calendar/events', { title: 'Dentist', day: MONDAY, time: '14:30' });
  expect(dentist.status).toBe(201);
  expect((await admin.post('/api/calendar/events', { title: 'x', day: MONDAY, time: 'noon' })).status).toBe(400);
  const week = (await admin.get(`/api/calendar?start=${MONDAY}&days=7`)).json;
  expect(week.map((e: { kind: string; title: string; day: string }) => `${e.day.slice(8)} ${e.kind} ${e.title}`)).toEqual([
    '05 event Dentist', '05 session Shirt dress', '05 media Alien', '06 media Alien']);
  expect((await admin.get('/api/calendar')).status).toBe(422);
  expect((await admin.put(`/api/calendar/events/${dentist.json.id}`, { title: 'Dentist', day: '2046-03-06' })).json).toMatchObject({ day: '2046-03-06', time: null });
  expect((await admin.delete(`/api/calendar/events/${dentist.json.id}`)).status).toBe(204);

  // Each person has their own.
  const other = await member(admin, 'partner');
  expect([(await other.get('/api/media')).json, (await other.get(`/api/calendar?start=${MONDAY}`)).json]).toEqual([[], []]);
  expect((await other.get(`/api/media/${alien.id}`)).status).toBe(404);
  expect((await visitor().get('/api/media')).status).toBe(401);
  expect((await admin.delete(`/api/media/${alien.id}`)).status).toBe(204);
});

it('days are the person\'s own, not the server\'s', async () => {
  const admin = await owner();
  time = new Date('2046-03-05T03:00:00Z'); // three in the morning in UTC: still the evening of the 4th in Chicago
  expect((await admin.post('/api/auth/login', { username: 'owner', password: PASSWORD })).status).toBe(200);
  const evening = { 'X-Local-Day': '2046-03-04' };
  const finish = async (name: string, headers?: Record<string, string>) => {
    const made = (await admin.post('/api/projects', { name, status: 'active' }, headers)).json;
    return [made.started_on, (await admin.put(`/api/projects/${made.id}`, { name, status: 'done' })).json.finished_on, made.created_at];
  };
  // The day comes from the person; the moment is always the server's.
  expect((await finish('Evening sewing', evening))[0]).toBe('2046-03-04');
  expect((await finish('Evening sewing 2', evening))[2]).toBe('2046-03-05T03:00:00+00:00');
  const film = (await admin.post('/api/media', { type: 'film', title: 'Alien', copy: { format: 'VHS', lent_to: 'Sam' } }, evening)).json;
  expect(film.copies[0].lent_on).toBe('2046-03-04');
  // A day that can't be right anywhere on Earth is ignored, and so is one that isn't a day.
  for (const wrong of ['2046-03-02', '1999-01-01', 'yesterday', '2046-03-06T22:00']) {
    expect((await finish(`Sent ${wrong}`, { 'X-Local-Day': wrong }))[0], wrong).not.toBe(wrong.slice(0, 10));
  }
});

it('a recipe says what it is cooked in, and the week flags a meal that needs more than you own', async () => {
  const admin = await owner();
  const kinds = (await admin.post('/api/things/starters', { slug: 'cookware' })).json;
  const dishes = kinds.find((k: { name: string }) => k.name === 'Baking dishes').id;
  const dish = (await admin.post('/api/things/items', { kind_id: dishes, name: '8x8 baking dish', quantity: 2 })).json;
  const made = await admin.post('/api/kitchen/recipes', { title: 'Brownies', equipment: [{ item_id: dish.id, quantity: 3 }, { label: 'Wire rack' }] });
  expect(made.status).toBe(201);
  expect(made.json.equipment.map((e: { label: string; quantity: number; have: number | null }) => [e.label, e.quantity, e.have])).toEqual([['8x8 baking dish', 3, 2], ['Wire rack', 1, null]]);
  // The pages that don't know about equipment yet send none, and nothing is lost.
  expect((await admin.put(`/api/kitchen/recipes/${made.json.id}`, { title: 'Brownies' })).json.equipment).toHaveLength(2);
  expect((await admin.post('/api/kitchen/recipes', { title: 'x', equipment: 'a pan' })).status).toBe(422);
  expect((await admin.post('/api/kitchen/recipes', { title: 'x', equipment: [{ item_id: 9999 }] })).status).toBe(404);

  await admin.post('/api/kitchen/plan', { day: MONDAY, meal: 'dinner', recipe_id: made.json.id });
  const short = (await admin.get(`/api/kitchen/equipment?start=${MONDAY}&days=7`)).json;
  expect(short.map((s: { label: string; need: number; have: number | null; short: number }) => [s.label, s.need, s.have, s.short])).toEqual([['8x8 baking dish', 3, 2, 1], ['Wire rack', 1, null, 1]]);
  expect((await admin.get('/api/kitchen/equipment')).status).toBe(422);
  const other = await member(admin, 'partner');
  expect((await other.get(`/api/kitchen/equipment?start=${MONDAY}`)).json).toEqual([]);
  expect((await other.post('/api/kitchen/recipes', { title: 'Theirs', equipment: [{ item_id: dish.id }] })).status).toBe(404);
});

it('the front page gathers today, and each person chooses what it shows', async () => {
  const admin = await owner();
  const day = { 'X-Local-Day': new Date().toISOString().slice(0, 10) };
  const empty = (await admin.get('/api/home', day)).json;
  expect([empty.day, empty.cards]).toEqual([day['X-Local-Day'], ['days', 'dates', 'kitchen', 'pantry', 'projects', 'things', 'collection', 'week']]);
  await admin.post('/api/calendar/events', { title: 'Dentist', day: empty.day, time: '14:30' });
  await admin.post('/api/kitchen/plan', { day: empty.day, title: 'Leftovers' });
  await admin.post('/api/projects', { name: 'Shirt dress', status: 'active' });
  const full = (await admin.get('/api/home', day)).json;
  expect(full.days[0].entries.map((e: { title: string }) => e.title)).toEqual(['Dentist', 'Leftovers']);
  expect([full.kitchen.meals.length, full.projects.map((p: { name: string }) => p.name)]).toEqual([1, ['Shirt dress']]);

  const fewer = (await admin.put('/api/home/cards', { hidden: ['pantry', 'things'] })).json;
  expect(fewer.cards).toEqual(['days', 'dates', 'kitchen', 'projects', 'collection', 'week']);
  expect((await admin.put('/api/home/cards', { hidden: ['horoscope'] })).status).toBe(400);
  expect((await admin.put('/api/home/cards', {})).status).toBe(422);
  const other = await member(admin, 'partner');
  const theirs = (await other.get('/api/home', day)).json;
  expect([theirs.cards.length, theirs.days[0].entries, theirs.projects]).toEqual([8, [], []]);
  expect((await visitor().get('/api/home')).status).toBe(401);
});

it('a database from before things and projects is upgraded, with a copy saved first', async () => {
  const admin = await owner();
  await admin.post('/api/kitchen/recipes', { title: 'Toast', ingredients_text: '2 slices bread' });
  // Put the database back to how version 2 left it: the kitchen, and none of the newer tables.
  for (const table of ['calendar_feeds', 'stores', 'ingredient_barcodes', 'coupons', 'prices', 'plan_photos', 'plan_items', 'plans', 'mail_accounts', 'recipe_equipment', 'media_covers', 'media_log', 'media_copies', 'media', 'media_sources', 'events', 'project_sessions', 'project_items', 'projects', 'item_values', 'items', 'places', 'kind_fields', 'kinds']) {
    await database.db.run(`DROP TABLE ${table}`);
  }
  // Columns later added to a table that was already there go back too.
  for (const column of ['usual_store', 'usual_size_quantity', 'usual_size_unit']) await database.db.run(`ALTER TABLE ingredients DROP COLUMN ${column}`);
  await database.db.run('PRAGMA user_version = 2');
  await stop();

  await start();
  const copy = path.join(folder, 'data', `lifeis.before-v${LATEST}.db`);
  expect(readFileSync(copy).subarray(0, 16).toString('latin1')).not.toBe('SQLite format 3\0'); // the copy is encrypted too
  expect((await database.db.get<{ user_version: number }>('PRAGMA user_version'))!.user_version).toBe(LATEST);
  expect((await admin.get('/api/kitchen/recipes')).json.map((r: { title: string }) => r.title)).toEqual(['Toast']); // still signed in, recipe still there
  expect((await admin.get('/api/things/kinds')).json).toEqual([]);
});

it('plans answer over the web, with their photos', async () => {
  const admin = await owner();
  const recipe = (await admin.post('/api/kitchen/recipes', { title: 'Stuffing', ingredients_text: '1 loaf bread' })).json;
  const made = await admin.post('/api/plans', { name: 'Thanksgiving', start_day: '2046-11-22', note: 'Twelve of us' });
  expect([made.status, made.json.when, made.json.end_day]).toEqual([201, 'ahead', '2046-11-22']);
  const id = made.json.id;
  // The recipe goes on the week's meals for the plan's day, and can be taken off again.
  const withFood = await admin.post(`/api/plans/${id}/items`, { kind: 'recipe', ref_id: recipe.id, day: '2046-11-22', meal: 'dinner' });
  expect([withFood.status, withFood.json.items_list[0].on_week]).toEqual([201, { day: '2046-11-22', meal: 'dinner', cooked: false, servings: null }]);
  expect((await admin.put(`/api/plans/items/${withFood.json.items_list[0].id}`, { day: '2046-11-22', meal: 'dinner', servings: 12 })).json.items_list[0].on_week.servings).toBe(12);
  expect((await admin.get('/api/kitchen/plan?start=2046-11-22&days=1')).json.map((m: { recipe_title: string; meal: string }) => [m.recipe_title, m.meal])).toEqual([['Stuffing', 'dinner']]);
  expect((await admin.put(`/api/plans/items/${withFood.json.items_list[0].id}`, { day: '2046-11-21', meal: 'snack' })).json.items_list[0].on_week.day).toBe('2046-11-21');
  expect((await admin.put(`/api/plans/items/${withFood.json.items_list[0].id}`, { day: '2046-12-25' })).status).toBe(400);
  expect((await admin.put(`/api/plans/items/${withFood.json.items_list[0].id}`, { day: null })).json.items_list[0].on_week).toBeNull();
  expect((await admin.get('/api/kitchen/plan?start=2046-11-15&days=14')).json).toEqual([]);
  const withTask = (await admin.post(`/api/plans/${id}/items`, { kind: 'task', label: 'Order the turkey' })).json;
  expect(withTask.items_list.map((i: { kind: string; label: string }) => [i.kind, i.label])).toEqual([['recipe', 'Stuffing'], ['task', 'Order the turkey']]);
  expect((await admin.put(`/api/plans/items/${withTask.items_list[1].id}`, { done: true })).json.tasks_left).toBe(0);
  expect((await admin.post(`/api/plans/${id}/items`, { kind: 'recipe', ref_id: recipe.id })).status).toBe(409);
  expect((await admin.post(`/api/plans/${id}/items`, { kind: 'task' })).status).toBe(400);

  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
  const kept = await admin.post(`/api/plans/${id}/photos`, { data: jpeg.toString('base64'), caption: 'The table' });
  expect([kept.status, kept.json.photos_list.map((p: { source: string; caption: string }) => [p.source, p.caption])]).toEqual([201, [['kept', 'The table']]]);
  const shown = await admin.get(`/api/plans/photos/${kept.json.photos_list[0].id}`);
  expect([shown.status, shown.headers.get('content-type'), shown.headers.get('x-content-type-options'), shown.bytes.equals(jpeg)]).toEqual([200, 'image/jpeg', 'nosniff', true]);
  expect((await admin.post(`/api/plans/${id}/photos`, { data: Buffer.from('<svg onload=alert(1)>').toString('base64') })).status).toBe(400);
  expect((await admin.post(`/api/plans/${id}/photos`, { data: 'not base64!' })).status).toBe(400);

  const again = await admin.post(`/api/plans/${id}/copy`, { name: 'Thanksgiving 2047', start_day: '2047-11-28' });
  expect([again.status, again.json.photos, again.json.tasks_left]).toEqual([201, 0, 1]);
  expect((await admin.get('/api/plans')).json.map((p: { name: string }) => p.name)).toEqual(['Thanksgiving 2047', 'Thanksgiving']);
  expect((await admin.get('/api/calendar?start=2046-11-22&days=1')).json.map((e: { kind: string; link: string }) => [e.kind, e.link])).toEqual([['plan', `/plans/${id}`]]);

  // Someone else in the house sees none of it, photos included.
  expect((await admin.post('/api/users', { username: 'other', password: PASSWORD })).status).toBe(201);
  const other = visitor();
  await other.post('/api/auth/login', { username: 'other', password: PASSWORD });
  expect([(await other.get('/api/plans')).json, (await other.get(`/api/plans/${id}`)).status, (await other.get(`/api/plans/photos/${kept.json.photos_list[0].id}`)).status]).toEqual([[], 404, 404]);
  expect((await visitor().get(`/api/plans/photos/${kept.json.photos_list[0].id}`)).status).toBe(401);

  expect((await admin.delete(`/api/plans/${id}`)).status).toBe(204);
  expect((await admin.get(`/api/plans/photos/${kept.json.photos_list[0].id}`)).status).toBe(404);
});

it('prices, the running total and coupons answer over the web, in whole cents', async () => {
  const admin = await owner();
  const list = (await admin.post('/api/kitchen/grocery', { label: 'coffee' })).json;
  const coffee = list[0].id;
  expect((await admin.get('/api/shopping')).json).toMatchObject({ currency: '$', store: null, totals: { trolley_cents: 0, left_unknown: 1 } });
  expect((await admin.put('/api/shopping/settings', { store: 'Aldi', currency: '£' })).json).toMatchObject({ store: 'Aldi', currency: '£' });

  await admin.post(`/api/kitchen/grocery/${coffee}/tick`, { done: true, put_away: false });
  expect((await admin.put(`/api/shopping/prices/${coffee}`, { cents: 899 })).json.totals.trolley_cents).toBe(899);
  expect((await admin.put(`/api/shopping/prices/${coffee}`, { cents: 8.99 })).status).toBe(422); // pounds, not pence
  expect((await admin.put(`/api/shopping/prices/${coffee}`, {})).status).toBe(422);
  expect((await admin.get(`/api/shopping/prices/${coffee}/history`)).json).toEqual([{ cents: 899, amount: '', store: 'Aldi', day: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) }]);

  const made = await admin.post('/api/shopping/coupons', { label: '£2 off coffee', grocery_id: coffee, cents_off: 200, expires_on: '2099-01-01' });
  expect([made.status, made.json.coupons[0].ingredient.toLowerCase(), made.json.totals.to_pay_cents]).toEqual([201, 'coffee', 899]);
  const coupon = made.json.coupons[0].id;
  expect((await admin.post(`/api/shopping/coupons/${coupon}/use`, { using: true })).json.totals).toMatchObject({ coupons_cents: 200, to_pay_cents: 699 });
  expect((await admin.post('/api/shopping/coupons', { label: 'Both', cents_off: 100, percent_off: 10 })).status).toBe(400);

  // Someone else in the house sees none of it and can't touch it.
  expect((await admin.post('/api/users', { username: 'other', password: PASSWORD })).status).toBe(201);
  const other = visitor();
  await other.post('/api/auth/login', { username: 'other', password: PASSWORD });
  expect((await other.get('/api/shopping')).json).toMatchObject({ lines: [], coupons: [], currency: '$' });
  expect([(await other.put(`/api/shopping/prices/${coffee}`, { cents: 1 })).status, (await other.post(`/api/shopping/coupons/${coupon}/use`, { using: false })).status]).toEqual([404, 404]);
  expect((await visitor().get('/api/shopping')).status).toBe(401);

  // A scanned packet is taught once, then found; and prices are followed over time.
  expect((await admin.get('/api/shopping/scan?code=025500000276')).json).toEqual({ barcode: '0025500000276', ingredient: null, line: null, last: null });
  const taught = (await admin.put('/api/shopping/scan', { code: '025500000276', grocery_id: coffee, product: 'Folgers 30 oz' })).json;
  expect([taught.ingredient.product, taught.line.id, taught.line.done]).toEqual(['Folgers 30 oz', coffee, true]);
  expect((await admin.put('/api/shopping/scan', { code: '025500000276' })).status).toBe(422);
  expect((await other.get('/api/shopping/scan?code=025500000276')).json.ingredient).toBeNull();
  const trends = (await admin.get('/api/shopping/trends')).json;
  expect([trends.currency, trends.trends.map((t: { name: string; times: number }) => [t.name.toLowerCase(), t.times]), trends.spending[0].cents]).toEqual(['£', [['coffee', 1]], 899]);
  expect((await other.get('/api/shopping/trends')).json.trends).toEqual([]);

  // Shops are a list to choose from; a size typed with a price is kept with it.
  expect((await admin.get('/api/shopping/stores')).json.map((x: { name: string; prices: number }) => [x.name, x.prices])).toEqual([['Aldi', 1]]);
  const shops = await admin.post('/api/shopping/stores', { name: 'Costco', note: 'needs the card' });
  expect([shops.status, shops.json.map((x: { name: string }) => x.name), (await admin.post('/api/shopping/stores', { name: 'aldi' })).status]).toEqual([201, ['Aldi', 'Costco'], 409]);
  expect((await admin.put(`/api/shopping/stores/${shops.json[0].id}`, { name: 'Aldi on Main St' })).json[0].name).toBe('Aldi on Main St');
  expect((await admin.get('/api/shopping')).json).toMatchObject({ store: 'Aldi on Main St', stores: ['Aldi on Main St', 'Costco'] });
  expect((await admin.put(`/api/shopping/prices/${coffee}`, { cents: 899, size: '30 oz' })).json.lines[0].size).toBe('30 oz');
  expect((await admin.put(`/api/shopping/prices/${coffee}`, { cents: 899, size: 'a big one' })).status).toBe(400);
  expect((await other.get('/api/shopping/stores')).json).toEqual([]);

  // Clearing the list keeps what things cost.
  await admin.post('/api/kitchen/grocery/clear-done');
  const again = (await admin.post('/api/kitchen/grocery', { label: 'coffee' })).json[0].id;
  expect((await admin.put(`/api/shopping/usual/${again}`, { store: 'Costco', size: '3 lb' })).json.lines).toEqual([{ id: again, price_cents: null, size: '', assumed: false,
    last: expect.objectContaining({ cents: 899, amount: '30 oz', store: 'Aldi on Main St' }), coupons: [], usual_store: 'Costco', usual_size: '3 lb', likely_store: 'Costco' }]);
  expect((await admin.put(`/api/shopping/usual/${again}`, { size: 'huge' })).status).toBe(400);
});
