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
import { LATEST, splitDownload } from '../../core/src/index.ts';
import { createApp } from '../src/app.ts';
import { verifyPassword } from '../src/auth.ts';
import { vault } from '../src/vault.ts';
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
  expect([made.status, made.json]).toEqual([201, { id: 1, username: 'owner', name: 'owner', is_admin: true }]);
  expect(made.cookie).toMatch(/^lifeis_session=[\w-]{43}; Max-Age=2592000; Path=\/; HttpOnly; SameSite=Lax$/);
  expect((await admin.get('/api/auth/status')).json).toEqual({ setup_required: false, local: true, user: { id: 1, username: 'owner', name: 'owner', is_admin: true } });
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
  expect([back.status, back.json]).toEqual([200, { id: 1, username: 'owner', name: 'owner', is_admin: true }]);
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

it('the week copies, keeps templates, suggests recipes for what is going off, and takes scanned things into the pantry', async () => {
  const admin = await owner();
  const soup = (await admin.post('/api/kitchen/recipes', { title: 'Cream soup', servings: 4, ingredients_text: '1 cup cream\n1 onion' })).json.id;
  await admin.post('/api/kitchen/plan', { day: MONDAY, meal: 'dinner', recipe_id: soup, servings: 6 });
  const next = '2046-03-12';
  expect((await admin.post('/api/kitchen/plan/copy', { from: MONDAY, to: next })).json).toEqual({ added: 1, already: 0, days_with_meals: 0, missing: [] });
  expect((await admin.post('/api/kitchen/plan/copy', { from: MONDAY, to: MONDAY })).status).toBe(400);
  expect((await admin.post('/api/kitchen/plan/copy', { from: MONDAY })).status).toBe(422);
  expect((await admin.get(`/api/kitchen/plan?start=${next}&days=7`)).json[0]).toMatchObject({ day: next, recipe_id: soup, servings: 6, cooked_on: null });

  const made = await admin.post('/api/kitchen/plan/templates', { start: MONDAY, name: 'School week' });
  expect(made.status).toBe(201);
  const id = made.json[0].id;
  expect((await admin.post('/api/kitchen/plan/templates', { start: MONDAY, name: 'school week' })).status).toBe(409);
  expect((await admin.put(`/api/kitchen/plan/templates/${id}`, { name: 'Term time' })).json.map((t: { name: string }) => t.name)).toEqual(['Term time']);
  expect((await admin.post(`/api/kitchen/plan/templates/${id}/use`, { start: '2046-03-19' })).json).toMatchObject({ added: 1, missing: [] });
  await admin.delete(`/api/kitchen/recipes/${soup}`);
  expect((await admin.get('/api/kitchen/plan/templates')).json[0].missing).toEqual(['Cream soup']);
  expect((await admin.delete(`/api/kitchen/plan/templates/${id}`)).json).toEqual([]);
  expect((await admin.post('/api/kitchen/plan/templates/999/use', { start: MONDAY })).status).toBe(404);

  // Use it up: cream goes off in two days, and a recipe uses it.
  const soon = new Date(Date.now() + 2 * 86_400_000);
  const soonDay = `${soon.getFullYear()}-${String(soon.getMonth() + 1).padStart(2, '0')}-${String(soon.getDate()).padStart(2, '0')}`;
  await admin.put('/api/kitchen/pantry', { name: 'cream', quantity: 1, unit: 'cup', expires_on: soonDay });
  await admin.post('/api/kitchen/recipes', { title: 'Cream soup', servings: 4, ingredients_text: '1 cup cream\n1 onion' });
  const ideas = (await admin.get('/api/kitchen/use-it-up')).json;
  expect(ideas.soon).toEqual([{ name: 'cream', days_left: 2 }]);
  expect(ideas.suggestions).toMatchObject([{ title: 'Cream soup', uses: ['cream'] }]);

  // Scan to add: a new barcode is named once; a look-up that is off asks nobody (this Life Is can't reach outside at all).
  expect((await admin.get('/api/kitchen/pantry/scan?code=5012345678900')).json).toMatchObject({ barcode: '5012345678900', ingredient: null });
  expect((await admin.get('/api/lookups/product?code=5012345678900')).status).toBe(400);
  expect((await admin.post('/api/kitchen/pantry/scan', { code: '5012345678900' })).status).toBe(400);
  const first = (await admin.post('/api/kitchen/pantry/scan', { code: '5012345678900', name: 'coffee', size: '12 oz' })).json;
  expect(first).toMatchObject({ learned: true, item: { name: 'coffee', amount: '12 oz' } });
  expect((await admin.get('/api/kitchen/pantry/scan?code=5012345678900')).json.ingredient).toMatchObject({ name: 'coffee', size: '12 oz' });
  expect((await admin.post('/api/kitchen/pantry/scan', { code: '5012345678900', quantity: 4, unit: 'oz' })).json).toMatchObject({ learned: false, item: { amount: '16 oz' } });
  expect((await admin.get('/api/kitchen/pantry/scan?code=x')).status).toBe(400);

  // A shop's aisle order.
  await admin.post('/api/shopping/stores', { name: 'Aldi' });
  await admin.put('/api/shopping/settings', { store: 'Aldi' });
  const shop = (await admin.get('/api/shopping')).json;
  expect(shop).toMatchObject({ store: 'Aldi', aisle_order: null });
  expect((await admin.put(`/api/shopping/stores/${shop.store_id}/aisles`, { aisles: ['Produce', 'Dairy'] })).json.aisle_order).toEqual(['Produce', 'Dairy']);
  expect((await admin.get(`/api/shopping/stores/${shop.store_id}/aisles`)).json).toEqual({ aisles: ['Produce', 'Dairy'] });
  expect((await admin.put('/api/shopping/stores/9999/aisles', { aisles: ['x'] })).status).toBe(404);
  const other = await member(admin, 'partner');
  expect((await other.get('/api/kitchen/plan/templates')).json).toEqual([]);
  expect((await other.put(`/api/shopping/stores/${shop.store_id}/aisles`, { aisles: ['x'] })).status).toBe(404);
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

it("a recipe's picture is kept, shown, replaced and removed over the web, and is private to its owner", async () => {
  const admin = await owner();
  const soup = (await admin.post('/api/kitchen/recipes', { title: 'Soup', ingredients_text: '1 leek' })).json;
  expect([soup.has_photo, (await admin.get(`/api/kitchen/recipes/${soup.id}/photo`)).status]).toEqual([false, 404]);
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 7, 7, 7]);
  const put = await admin.put(`/api/kitchen/recipes/${soup.id}/photo`, { data: png.toString('base64') });
  expect([put.status, put.json.has_photo, put.json.ingredients_text]).toEqual([200, true, '1 leek']);
  expect((await admin.get('/api/kitchen/recipes')).json[0].has_photo).toBe(true);
  const shown = await admin.get(`/api/kitchen/recipes/${soup.id}/photo`);
  expect([shown.status, shown.headers.get('content-type'), shown.headers.get('cache-control'), shown.bytes.equals(png)]).toEqual([200, 'image/png', 'private, max-age=60', true]);
  // Not a picture, damaged, or missing: refused, and the picture stays.
  expect((await admin.put(`/api/kitchen/recipes/${soup.id}/photo`, { data: Buffer.from('<svg onload=alert(1)>').toString('base64') })).status).toBe(400);
  expect((await admin.put(`/api/kitchen/recipes/${soup.id}/photo`, { data: 'not base64!' })).status).toBe(400);
  expect((await admin.put(`/api/kitchen/recipes/${soup.id}/photo`, {})).status).toBe(422);
  expect((await admin.get(`/api/kitchen/recipes/${soup.id}/photo`)).bytes.equals(png)).toBe(true);

  const other = await member(admin, 'partner');
  expect([(await other.get(`/api/kitchen/recipes/${soup.id}/photo`)).status, (await other.put(`/api/kitchen/recipes/${soup.id}/photo`, { data: png.toString('base64') })).status,
    (await other.delete(`/api/kitchen/recipes/${soup.id}/photo`)).status]).toEqual([404, 404, 404]);
  expect((await admin.get(`/api/kitchen/recipes/${soup.id}/photo`)).status).toBe(200);

  expect((await admin.delete(`/api/kitchen/recipes/${soup.id}/photo`)).json.has_photo).toBe(false);
  expect((await admin.get(`/api/kitchen/recipes/${soup.id}/photo`)).status).toBe(404);
  await admin.put(`/api/kitchen/recipes/${soup.id}/photo`, { data: png.toString('base64') });
  await admin.delete(`/api/kitchen/recipes/${soup.id}`);
  expect((await database.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM recipe_photos'))!.n).toBe(0);

  // A file of recipes: the picture beside a recipe is kept with a new one; looking over only hears there is one.
  const file = { sources: [{ name: 'Pancakes', data: { name: 'Pancakes', ingredients: '1 cup flour', directions: 'Fry.' }, photo: png.toString('base64') }] };
  expect((await admin.post('/api/kitchen/recipes/file/read', { sources: [{ ...file.sources[0], photo: undefined, has_photo: true }] })).json).toMatchObject({ fresh: 1, pictures: 1 });
  expect((await admin.post('/api/kitchen/recipes/file', file)).json).toMatchObject({ added: 1, pictures: 1 });
  const pancakes = (await admin.get('/api/kitchen/recipes')).json[0];
  expect([pancakes.title, pancakes.has_photo, (await admin.get(`/api/kitchen/recipes/${pancakes.id}/photo`)).bytes.equals(png)]).toEqual(['Pancakes', true, true]);
});

it('recipes from another app are looked over, brought in once, and a pasted grocery list is added as typed', async () => {
  const admin = await owner();
  const soup = { name: 'Tomato Soup', ingredients: '1 can tomatoes\n1 cup stock', directions: 'Simmer.', prep_time: '10 min', categories: ['Soup'], photo_data: 'AAAA' };
  const file = { sources: [{ name: 'Tomato Soup', data: soup }, { name: 'Pancakes', data: { name: 'Pancakes', ingredients: '1 cup flour', directions: 'Fry.' } }, { name: 'Odd', data: 'x' }], unreadable: [{ name: 'Broken', why: 'It was damaged' }] };
  const look = await admin.post('/api/kitchen/recipes/file/read', file);
  expect([look.status, look.json]).toEqual([200, { found: 4, first: ['Tomato Soup', 'Pancakes'], already: 0, fresh: 2, pictures: 0,
    failed: [{ name: 'Broken', why: 'It was damaged' }, { name: 'Odd', why: "That isn't a recipe" }] }]);
  expect((await admin.get('/api/kitchen/recipes')).json).toEqual([]);
  const brought = await admin.post('/api/kitchen/recipes/file', file);
  expect([brought.status, brought.json.added, brought.json.already]).toEqual([201, 2, 0]);
  const listed = (await admin.get('/api/kitchen/recipes')).json;
  expect(listed.map((r: { title: string }) => r.title)).toEqual(['Pancakes', 'Tomato Soup']);
  expect((await admin.get(`/api/kitchen/recipes/${listed[1].id}`)).json).toMatchObject({ prep_minutes: 10, tags: ['soup'], ingredients_text: '1 can tomatoes\n1 cup stock', steps_text: 'Simmer.' });
  expect((await admin.post('/api/kitchen/recipes/file', file)).json).toMatchObject({ added: 0, already: 2 });
  expect((await admin.post('/api/kitchen/recipes/file', { sources: 'x' })).status).toBe(422);
  expect((await admin.post('/api/kitchen/recipes/file', {})).status).toBe(400);

  await admin.post('/api/kitchen/grocery', { label: 'Eggs' });
  const pasted = 'Produce:\n- apples\n[ ] 2 lb chicken thighs\nmilk, eggs, bread\ntomatoes, diced';
  const peek = (await admin.post('/api/kitchen/grocery/paste/read', { text: pasted })).json.lines;
  expect(peek.map((l: { text: string; already: boolean }) => [l.text, l.already])).toEqual([['apples', false], ['2 lb chicken thighs', false], ['milk', false], ['eggs', true], ['bread', false], ['tomatoes, diced', false]]);
  expect((await admin.get('/api/kitchen/grocery')).json).toHaveLength(1);
  const added = await admin.post('/api/kitchen/grocery/paste', { lines: peek.map((l: { text: string }) => l.text) });
  expect([added.status, added.json.added, added.json.already]).toEqual([201, 5, 1]);
  expect(added.json.items.find((g: { label: string }) => g.label === 'chicken thighs')).toMatchObject({ quantity: 2, unit: 'lb' });
  expect((await admin.post('/api/kitchen/grocery/paste/read', { text: 'Produce:' })).status).toBe(400);
  expect((await admin.post('/api/kitchen/grocery/paste', { lines: 'milk' })).status).toBe(422);
});

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
  const fibre = fabric.fields.find((f: { name: string }) => f.name === 'Fiber').id;

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

it('a home inventoried over the web: scanning, moving, uses, activities, stickers and photos', async () => {
  const admin = await owner();
  const kind = (await admin.post('/api/things/kinds', { name: 'Household' })).json[0];
  const places = (await admin.post('/api/things/places', { name: 'Garage' })).json;
  const garage = places[0].id;
  const drill = (await admin.post('/api/things/items', { kind_id: kind.id, name: 'Drill', barcode: '5012345678900', activities: ['DIY'] })).json;
  expect([drill.barcode, drill.activities, drill.photo]).toEqual(['5012345678900', ['DIY'], false]);

  // Its box's barcode finds it; moving it is kept in its history.
  expect((await admin.get('/api/things/scan?code=5012345678900')).json).toMatchObject({ kind: 'thing', item: { id: drill.id } });
  expect((await admin.get('/api/things/scan?code=9780140449136')).json).toEqual({ kind: 'unknown', barcode: '9780140449136', isbn: true });
  expect((await admin.post(`/api/things/items/${drill.id}/move`, { place_id: garage })).json.place).toBe('Garage');
  expect((await admin.post(`/api/things/items/${drill.id}/uses`, { activity: 'Repairs', note: 'gate hinge' })).status).toBe(201);
  expect((await admin.get(`/api/things/items/${drill.id}/history`)).json.map((h: { what: string }) => h.what)).toEqual(['used', 'moved', 'added']);
  expect((await admin.get('/api/things/activities')).json).toEqual([{ name: 'DIY', things: 1, projects: 0, jobs: 0 }]);
  expect((await admin.get('/api/things/activity?name=diy')).json.things.map((t: { name: string }) => t.name)).toEqual(['Drill']);

  // A sheet of blank stickers; one scanned is new, until it's put on something.
  const blanks = (await admin.get('/api/things/stickers/blank?count=4')).json;
  expect(blanks).toHaveLength(4);
  expect((await admin.get(`/api/things/scan?code=${encodeURIComponent(`https://x/t/${blanks[0]}`)}`)).json).toEqual({ kind: 'new-sticker', code: blanks[0] });
  const kite = (await admin.post('/api/things/items', { kind_id: kind.id, name: 'Kite', code: blanks[0], place_id: garage })).json;
  expect((await admin.get(`/api/things/scan?code=${encodeURIComponent(`https://x/t/${blanks[0]}`)}`)).json).toMatchObject({ kind: 'thing', item: { id: kite.id } });
  expect((await admin.post('/api/things/stickers', { ids: [drill.id] })).json[0]).toMatchObject({ id: drill.id, name: 'Drill', place: 'Garage' });
  expect((await admin.post('/api/things/stickers', { ids: 'all' })).status).toBe(422);

  // A photo of it, shown back as it was sent.
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 7, 7, 7]);
  expect((await admin.put(`/api/things/items/${drill.id}/photo`, { data: jpeg.toString('base64') })).json.photo).toBe(true);
  const shown = await admin.get(`/api/things/items/${drill.id}/photo`);
  expect([shown.status, shown.headers.get('content-type'), shown.bytes.equals(jpeg)]).toEqual([200, 'image/jpeg', true]);

  const other = await member(admin, 'partner');
  expect((await other.get(`/api/things/items/${drill.id}/photo`)).status).toBe(404);
  expect((await other.get('/api/things/scan?code=5012345678900')).json.kind).toBe('unknown');
});

it('home records over the web: what a thing cost, its papers, and the home inventory', async () => {
  const admin = await owner();
  const kind = (await admin.post('/api/things/kinds', { name: 'Appliances' })).json[0];
  const tv = (await admin.post('/api/things/items', { kind_id: kind.id, name: 'Television', records: { price_cents: 79900, serial: 'SN-123', warranty_until: '2099-01-01' } })).json;
  expect([tv.records.price_cents, tv.records.serial, tv.documents]).toEqual([79900, 'SN-123', 0]);
  expect((await admin.put(`/api/things/items/${tv.id}`, { name: 'Television', records: { value_cents: 50000 } })).json.records).toMatchObject({ price_cents: 79900, value_cents: 50000 });
  expect((await admin.put(`/api/things/items/${tv.id}`, { name: 'Television', records: { price_cents: 'lots' } })).status).toBe(422);

  const pdf = Buffer.from('%PDF-1.4 a receipt');
  const kept = await admin.post(`/api/things/items/${tv.id}/documents`, { kind: 'receipt', name: 'Receipt.pdf', data: pdf.toString('base64') });
  expect([kept.status, kept.json.map((d: { name: string; type: string }) => [d.name, d.type])]).toEqual([201, [['Receipt.pdf', 'application/pdf']]]);
  expect((await admin.post(`/api/things/items/${tv.id}/documents`, { kind: 'receipt', name: 'x.html', data: Buffer.from('<script>').toString('base64') })).status).toBe(400);
  const shown = await admin.get(`/api/things/documents/${kept.json[0].id}`);
  expect([shown.status, shown.headers.get('content-type'), shown.headers.get('content-security-policy'), shown.bytes.equals(pdf)]).toEqual([200, 'application/pdf', "sandbox; default-src 'none'", true]);

  const report = (await admin.get('/api/things/report')).json;
  expect([report.things, report.worth_cents, report.with_receipt, report.rooms[0].name]).toEqual([1, 50000, 1, 'No place yet']);
  const other = await member(admin, 'partner');
  expect((await other.get(`/api/things/documents/${kept.json[0].id}`)).status).toBe(404);
  expect((await other.get('/api/things/report')).json.things).toBe(0);
  // The inventory by room, and the same as a spreadsheet: a byte-order mark, a download name with the day, a known row.
  expect((await admin.get('/api/things/report?rooms=0&min_cents=60000')).json.rooms).toEqual([]);
  expect((await admin.get('/api/things/report?rooms=x')).status).toBe(422);
  const sheet = await admin.get('/api/things/report.csv');
  expect([sheet.status, sheet.headers.get('content-type'), sheet.headers.get('content-disposition')])
    .toEqual([200, 'text/csv; charset=utf-8', expect.stringMatching(/^attachment; filename="home-inventory-\d{4}-\d{2}-\d{2}\.csv"$/)]);
  expect([...sheet.bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  expect(sheet.bytes.toString('utf8')).toContain('No place yet,,Television,Appliances,some,,SN-123,,,799.00,500.00,2099-01-01,no,yes,000-001,no\r\n');
  expect((await admin.get('/api/things/report.csv?min_cents=lots')).status).toBe(422);
  expect((await other.get('/api/things/report.csv')).bytes.toString('utf8')).not.toContain('Television');
  expect((await admin.delete(`/api/things/documents/${kept.json[0].id}`)).status).toBe(204);
});

it('pets over the web: a profile, care that becomes upkeep, weights and a photo', async () => {
  const admin = await owner();
  const made = await admin.post('/api/things/pets', { name: 'Rex', species: 'Dog', vet_name: 'Oak Lane Vets', vet_phone: '555 0100' });
  expect([made.status, made.json.species, made.json.care]).toEqual([201, 'dog', []]);
  const id = made.json.id;
  expect((await admin.post('/api/things/pets', { species: 'cat' })).status).toBe(422);
  expect((await admin.get(`/api/things/pets/${id}/care`)).json.map((c: { name: string }) => c.name)).toContain('Heartworm prevention');
  const cared = await admin.post(`/api/things/pets/${id}/care`, { name: 'Vaccinations', every_n: 1, every_unit: 'year', last_done: '2020-01-01' });
  expect([cared.status, cared.json.care.map((j: { name: string }) => j.name), cared.json.next.state, cared.json.care_due]).toEqual([201, ['Rex: Vaccinations'], 'overdue', 1]);
  // It's upkeep too, and says whose it is.
  expect((await admin.get('/api/things/upkeep')).json.map((j: { name: string; pet: { name: string } }) => [j.name, j.pet.name])).toEqual([['Rex: Vaccinations', 'Rex']]);
  expect((await admin.post(`/api/things/pets/${id}/weights`, { value: 43, unit: 'lb' })).json.weights[0]).toMatchObject({ value: 43, unit: 'lb' });
  expect((await admin.post(`/api/things/pets/${id}/weights`, { unit: 'lb' })).status).toBe(422);
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 9, 9]);
  expect((await admin.put(`/api/things/pets/${id}/photo`, { data: jpeg.toString('base64') })).json.photo).toBe(true);
  expect((await admin.get(`/api/things/pets/${id}/photo`)).bytes.equals(jpeg)).toBe(true);
  expect((await admin.get('/api/search?q=rex&kind=pet')).json.map((r: { title: string }) => r.title)).toEqual(['Rex']);

  const other = await member(admin, 'partner');
  expect([(await other.get('/api/things/pets')).json, (await other.get(`/api/things/pets/${id}`)).status, (await other.get(`/api/things/pets/${id}/photo`)).status]).toEqual([[], 404, 404]);
  expect((await admin.delete(`/api/things/pets/${id}`)).status).toBe(204);
  expect((await admin.get('/api/things/upkeep')).json).toEqual([]);
});

it('the house manual is written signed in, and read by its link without signing in until its day', async () => {
  const admin = await owner();
  expect((await admin.get('/api/manual')).json.sections.map((s: { id: string }) => s.id)).toEqual(['emergency', 'contacts', 'house', 'routines']);
  await admin.post('/api/manual/entries', { section: 'house', title: 'Wi-Fi', body: 'Password: <b>fish</b>' });
  const made = await admin.post('/api/manual/entries', { section: 'house', title: 'Alarm', body: 'Code 4821', private: true });
  expect([made.status, made.json.sections[2].entries.map((e: { title: string; private: boolean }) => [e.title, e.private])]).toEqual([201, [['Wi-Fi', false], ['Alarm', true]]]);
  expect((await admin.post('/api/manual/entries', { section: 'house' })).status).toBe(422);

  const share = (await admin.put('/api/manual/share', { days: 3 })).json.share;
  expect([share.on, share.token.length]).toEqual([true, 64]);
  const reader = visitor(); // nobody signed in
  const page = await reader.get(`/m/${share.token}`);
  const html = page.bytes.toString('utf8');
  expect([page.status, page.headers.get('content-type'), page.headers.get('content-security-policy'), page.headers.get('x-robots-tag')])
    .toEqual([200, 'text/html; charset=utf-8', "default-src 'none'; style-src 'unsafe-inline'", 'noindex, nofollow']);
  expect([html.includes('Wi-Fi'), html.includes('&lt;b&gt;fish&lt;/b&gt;'), html.includes('4821'), html.includes('<script')]).toEqual([true, true, false, false]);
  expect((await reader.get(`/m/${'0'.repeat(64)}`)).status).toBe(404);
  expect((await reader.get('/api/manual')).status).toBe(401);
  expect((await admin.put('/api/manual/share', { days: 0 })).status).toBe(400);

  expect((await admin.delete('/api/manual/share')).json.share.on).toBe(false);
  expect((await reader.get(`/m/${share.token}`)).status).toBe(404);
});

it('packing over the web: boxes made, filled, marked and unpacked', async () => {
  const admin = await owner();
  const kind = (await admin.post('/api/things/kinds', { name: 'Kitchen' })).json[0];
  const made = await admin.post('/api/things/packing/boxes', { count: 2, destination: 'Kitchen' });
  expect([made.status, made.json.boxes.map((b: { name: string; state: string }) => [b.name, b.state])]).toEqual([201, [['Box 1', 'packing'], ['Box 2', 'packing']]]);
  expect((await admin.post('/api/things/packing/boxes', { destination: 'Kitchen' })).status).toBe(422);
  const box = made.json.boxes[0].id;
  await admin.post('/api/things/items', { kind_id: kind.id, name: 'Kettle', place_id: box });
  expect((await admin.put(`/api/things/packing/boxes/${box}`, { state: 'packed' })).json.counts).toEqual({ packing: 1, packed: 1, moved: 0, unpacked: 0 });
  expect((await admin.put(`/api/things/packing/boxes/${box}`, { state: 'lost' })).status).toBe(400);
  const places = (await admin.post('/api/things/places', { name: 'Cupboard' })).json;
  const cupboard = places.find((p: { name: string }) => p.name === 'Cupboard').id;
  const done = (await admin.post(`/api/things/packing/boxes/${box}/unpack`, { place_id: cupboard })).json;
  expect([done.moved, done.boxes[0].state]).toEqual([1, 'unpacked']);
  expect((await admin.get('/api/things/items')).json[0].place).toBe('Cupboard');
  expect((await (await member(admin, 'partner')).get('/api/things/packing')).json.boxes).toEqual([]);
});

it('upkeep over the web: a job with its tools, done, on the calendar, and given to someone else', async () => {
  const admin = await owner();
  const kind = (await admin.post('/api/things/kinds', { name: 'Tools' })).json[0];
  const ladder = (await admin.post('/api/things/items', { kind_id: kind.id, name: 'Ladder' })).json;
  expect((await admin.get('/api/things/upkeep/starters')).json.map((j: { name: string }) => j.name)).toContain('Clean the gutters');
  const made = await admin.post('/api/things/upkeep', { name: 'Clean the gutters', every_n: 6, every_unit: 'month', tools: [ladder.id], last_done: { day: '2020-08-01' } });
  expect([made.status, made.json.tools.map((t: { name: string }) => t.name), made.json.due.state]).toEqual([201, ['Ladder'], 'overdue']);
  expect((await admin.post('/api/things/upkeep', { name: 'x', tools: 'ladder' })).status).toBe(422);
  // Late, so it shows on today.
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  expect((await admin.get(`/api/calendar?start=${today}&days=1`)).json.some((e: { kind: string; title: string }) => e.kind === 'upkeep' && e.title === 'Clean the gutters')).toBe(true);

  const done = (await admin.post(`/api/things/upkeep/${made.json.id}/done`, { minutes: 45 })).json;
  expect([done.job.due.state, done.done[0].minutes]).toEqual(['later', 45]);
  expect((await admin.get(`/api/things/items/${ladder.id}/history`)).json[0]).toMatchObject({ what: 'used', job: 'Clean the gutters' });

  const partner = await member(admin, 'partner');
  const people = (await admin.get('/api/things/upkeep/people')).json;
  const partnerId = people.find((p: { name: string }) => p.name === 'partner').id;
  await admin.put(`/api/things/upkeep/${made.json.id}`, { name: 'Clean the gutters', every_n: 6, every_unit: 'month', assigned_to: partnerId });
  expect((await partner.get('/api/things/upkeep')).json.map((j: { name: string; mine: boolean }) => [j.name, j.mine])).toEqual([['Clean the gutters', false]]);
  expect((await partner.put(`/api/things/upkeep/${made.json.id}`, { name: 'Mine' })).status).toBe(403);
  expect((await partner.delete(`/api/things/upkeep/${made.json.id}`)).status).toBe(403);
  expect((await admin.delete(`/api/things/upkeep/${made.json.id}`)).status).toBe(204);
});

it('upkeep ready-made sets are listed, added with the jobs the person kept, and added only once', async () => {
  const admin = await owner();
  const sets = (await admin.get('/api/things/upkeep/sets')).json;
  expect(sets.map((s: { slug: string }) => s.slug)).toEqual(['house', 'car', 'papers', 'health', 'yard']);
  const taxes = sets.find((s: { slug: string }) => s.slug === 'papers').jobs.find((j: { name: string }) => j.name === 'File federal and state taxes');
  expect([taxes.kind, taxes.every_n, taxes.every_unit, /^\d{4}-04-15$/.test(taxes.first_due)]).toEqual(['renewal', 1, 'year', true]);
  const first = await admin.post('/api/things/upkeep/sets', { slug: 'yard', only: ['Clean the grill', 'Store the hoses'] });
  expect([first.status, first.json.added, first.json.already, first.json.added_names]).toEqual([201, 2, 0, ['Clean the grill', 'Store the hoses']]);
  const again = await admin.post('/api/things/upkeep/sets', { slug: 'yard' });
  expect([again.json.added_names, again.json.already_names]).toEqual([['Service the lawn mower'], ['Clean the grill', 'Store the hoses']]);
  const third = await admin.post('/api/things/upkeep/sets', { slug: 'yard' });
  expect([third.json.added, third.json.already]).toEqual([0, 3]);
  expect((await admin.get('/api/things/upkeep')).json).toHaveLength(3);
  expect((await admin.post('/api/things/upkeep/sets', { slug: 'boat' })).status).toBe(404);
  expect((await admin.post('/api/things/upkeep/sets', { slug: 'yard', only: 'all' })).status).toBe(422);
  // A job with no day of its own is first due a round from today, not today; one with a day keeps it.
  const mower = (await admin.get('/api/things/upkeep')).json.find((j: { name: string }) => j.name === 'Clean the grill');
  expect([mower.due.state, mower.first_due]).toEqual(['later', mower.due.next_day]);
  const house = (await admin.post('/api/things/upkeep/sets', { slug: 'house', only: ['Flush the water heater'] })).json;
  expect(house.added).toBe(1);
  const heater = (await admin.get('/api/things/upkeep')).json.find((j: { name: string }) => j.name === 'Flush the water heater');
  expect([heater.due.state, heater.due.days_left >= 364]).toEqual(['later', true]);
  expect((await admin.get('/api/things/upkeep/sets')).json.find((s: { slug: string }) => s.slug === 'house').jobs.find((j: { name: string }) => j.name === 'Flush the water heater').first).toBe('interval');
});

it('upkeep: a chore chart for a week, and an allowance that can be marked paid', async () => {
  const admin = await owner();
  const leo = (await admin.post('/api/things/upkeep/members', { name: 'Leo' })).json[0];
  await admin.put('/api/things/upkeep/points', { cents: 25 });
  const day = new Date();
  const today = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
  const dishes = (await admin.post('/api/things/upkeep', { name: 'Dishes', kind: 'chore', points: 3, assigned_member: leo.id, every_n: 1, every_unit: 'day' })).json;
  await admin.post('/api/things/upkeep', { name: 'Vacuum', kind: 'chore', points: 5, every_n: 1, every_unit: 'week' });
  await admin.post('/api/things/upkeep', { name: 'Change the filter', every_n: 1, every_unit: 'month' });

  const chart = await admin.get('/api/things/upkeep/chart');
  expect([chart.status, chart.json.days.length, chart.json.point_cents, chart.json.days.includes(chart.json.today)]).toEqual([200, 7, 25, true]);
  expect(new Date(`${chart.json.week_start}T12:00:00`).getDay()).toBe(0); // Sunday
  expect(chart.json.groups.map((g: { who: string | null }) => g.who)).toEqual(['Leo', null]);
  expect(chart.json.groups[0].chores[0]).toMatchObject({ name: 'Dishes', points: 3, anytime: false });
  expect(chart.json.groups[0].chores[0].days).toEqual(chart.json.days);
  expect(chart.json.groups[1].chores.map((c: { name: string }) => c.name)).toEqual(['Vacuum']);
  expect((await admin.get('/api/things/upkeep/chart?week=next&start_on=monday')).json.days[0] > chart.json.today).toBe(true);
  expect((await admin.get('/api/things/upkeep/chart?week=soon')).status).toBe(400);

  await admin.post(`/api/things/upkeep/${dishes.id}/done`, { day: today, by_member: leo.id });
  const owed = (await admin.get('/api/things/upkeep/allowance?period=this_week')).json;
  expect(owed.people).toHaveLength(1);
  expect(owed.people[0]).toMatchObject({ name: 'Leo', points: 3, cents: 75, owing_points: 3, owing_cents: 75, paid_through: null });
  expect((await admin.get('/api/things/upkeep/allowance?period=custom&from=2020-01-01&to=2020-01-31')).json.people[0]).toMatchObject({ points: 0, cents: 0 });
  expect((await admin.get('/api/things/upkeep/allowance?period=custom&from=2020-02-01&to=2020-01-31')).status).toBe(400);
  expect((await admin.get('/api/things/upkeep/allowance?period=never')).status).toBe(400);

  const paid = await admin.post('/api/things/upkeep/allowance/paid', { member_id: leo.id });
  expect([paid.status, paid.json[0]]).toEqual([201, expect.objectContaining({ name: 'Leo', points: 3, cents: 75 })]);
  expect((await admin.get('/api/things/upkeep/allowance?period=this_week')).json.people[0]).toMatchObject({ paid_through: today, owing_points: 0, owing_cents: 0 });
  expect((await admin.post('/api/things/upkeep/allowance/paid', { member_id: leo.id })).status).toBe(409);
  expect((await admin.post('/api/things/upkeep/allowance/paid', {})).status).toBe(422);
  expect((await admin.delete(`/api/things/upkeep/allowance/paid/${leo.id}`)).json).toEqual([]);
  expect((await admin.get('/api/things/upkeep/allowance?period=this_week')).json.people[0]).toMatchObject({ paid_through: null, owing_points: 3 });
  // Another person's household is theirs alone.
  const partner = await member(admin, 'partner');
  expect((await partner.get('/api/things/upkeep/allowance')).json.people).toEqual([]);
  expect((await partner.post('/api/things/upkeep/allowance/paid', { member_id: leo.id })).status).toBe(404);
});

it('what Life Is looks after is asked once, and sets up what fits', async () => {
  const admin = await owner();
  expect((await admin.get('/api/life')).json).toMatchObject({ areas: null, sections: ['eating', 'planning', 'keeping', 'making', 'enjoying', 'spending'] });
  const saved = (await admin.put('/api/life', { areas: ['eating', 'sewing'] })).json;
  expect([saved.areas, saved.sections, saved.added]).toEqual([['eating', 'sewing'], ['eating', 'keeping', 'making'], ['Fabric', 'Notions', 'Sewing patterns']]);
  expect((await admin.put('/api/life', { areas: ['eating'] })).json).toMatchObject({ sections: ['eating'], added: [] });
  expect((await admin.get('/api/things/kinds')).json).toHaveLength(3); // out of sight, still there
  expect((await admin.put('/api/life', { areas: ['alchemy'] })).status).toBe(400);
  expect((await admin.put('/api/life', {})).status).toBe(422);
  expect((await (await member(admin, 'partner')).get('/api/life')).json.areas).toBeNull(); // each person answers for themselves
});

it('the two-minute start is for a new household, saves each step, and clears only its own examples', async () => {
  const admin = await owner();
  const first = (await admin.get('/api/start')).json;
  expect([first.first_run, first.status, first.step, first.card]).toEqual(['guide', 'new', 1, null]);
  expect(first.options.sets.map((s: { slug: string }) => s.slug)).toEqual(['house', 'car', 'papers', 'health', 'yard']);

  const people = (await admin.put('/api/start/people', { adults: ['Sam'], children: ['Mia', 'Leo'], pets: [{ kind: 'dog', name: 'Biscuit' }] })).json;
  expect(people.step).toBe(2);
  expect((await admin.get('/api/things/upkeep/members')).json.map((m: { name: string }) => m.name)).toEqual(['Leo', 'Mia']);
  expect((await admin.get('/api/things/pets')).json.map((p: { name: string }) => p.name)).toEqual(['Biscuit']);
  await admin.put('/api/start/people', { adults: ['Sam'], children: ['Mia', 'Leo'], pets: [{ kind: 'dog', name: 'Biscuit' }] });
  expect((await admin.get('/api/things/pets')).json).toHaveLength(1); // twice adds nothing twice

  expect((await admin.put('/api/start/interests', { wants: ['meals', 'house'] })).json.step).toBe(3);
  expect((await admin.get('/api/life')).json).toMatchObject({ areas: ['eating', 'keeping'], sections: ['eating', 'keeping'] });
  expect((await admin.put('/api/start/interests', { wants: ['meals', 'alchemy'] })).status).toBe(400);
  expect((await admin.put('/api/start/interests', {})).status).toBe(200);
  await admin.put('/api/start/interests', { wants: ['meals', 'house'] });
  expect((await admin.put('/api/start/upkeep', { sets: ['house'], has_car: false })).json.step).toBe(4);
  expect((await admin.get('/api/things/upkeep')).json.length).toBe(14);
  expect((await admin.put('/api/start/upkeep', { sets: ['moon'] })).status).toBe(404);
  expect((await admin.put('/api/start/examples', {})).status).toBe(422);
  await admin.put('/api/start/examples', { on: true });
  expect((await admin.get('/api/kitchen/recipes')).json).toHaveLength(3);

  const closed = (await admin.post('/api/start/close', { step: 4 })).json;
  expect([closed.first_run, closed.card]).toEqual(['quiet', { kind: 'finish', step: 4 }]);
  const done = (await admin.post('/api/start/finish', {})).json;
  expect(done.card).toMatchObject({ kind: 'started', examples: { recipes: 3, meals: 3, groceries: 6 } });
  expect(done.landing).toEqual({ to: '/recipes', label: 'Open your recipes' });
  expect((await admin.put('/api/start/people', { children: ['Zed'] })).status).toBe(409); // finished

  // One example the person changes is kept.
  const recipes = (await admin.get('/api/kitchen/recipes')).json as { id: number; title: string }[];
  const chili = recipes.find((r) => r.title === 'Slow-cooker beef chili')!;
  const whole = (await admin.get(`/api/kitchen/recipes/${chili.id}`)).json;
  await admin.put(`/api/kitchen/recipes/${chili.id}`, { title: whole.title, ingredients_text: `${whole.ingredients_text}\n1 tsp oregano`, steps_text: whole.steps_text });
  const cleared = (await admin.post('/api/start/examples/clear', {})).json;
  expect(cleared.removed).toEqual({ recipes: 2, meals: 3, groceries: 6 });
  expect(cleared.kept).toEqual([{ title: 'Slow-cooker beef chili', why: 'you have changed it' }]);
  expect((await admin.get('/api/kitchen/recipes')).json.map((r: { title: string }) => r.title)).toEqual(['Slow-cooker beef chili']);
  expect(cleared.state.card).toMatchObject({ kind: 'started', examples: null }); // the examples are gone; the tips stay

  // Another person is asked on their own, and a household that has begun gets the long checklist instead.
  const partner = await member(admin, 'partner');
  expect((await partner.get('/api/start')).json).toMatchObject({ first_run: 'guide', status: 'new' });
  expect((await partner.get('/api/things/pets')).json).toEqual([]);
  expect((await partner.post('/api/start/skip', {})).json).toMatchObject({ status: 'skipped', card: null });
  const neighbor = await member(admin, 'neighbor');
  await neighbor.post('/api/kitchen/recipes', { title: 'Toast' });
  expect((await neighbor.get('/api/start')).json.first_run).toBe('checklist');
  expect((await neighbor.put('/api/start/people', { children: ['Kid'] })).status).toBe(409);
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
  expect((await admin.get('/api/media/formats?type=book')).json).toEqual(['Hardcover', 'Paperback', 'eBook', 'Audiobook', 'Book on CD', 'Book on tape']);

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

it('a copy keeps how many discs it is over the web, and a bad number is refused', async () => {
  const admin = await owner();
  const made = await admin.post('/api/media', { type: 'book', title: 'Dune', copy: { format: 'Book on CD', pieces: 12 } });
  expect(made.status).toBeLessThan(300);
  const book = made.json;
  expect(book.copies[0].pieces).toBe(12);
  expect((await admin.get(`/api/media/${book.id}`)).json.copies[0].pieces).toBe(12);
  expect((await admin.get('/api/media?type=book')).json[0].pieces).toEqual({ 'Book on CD': 12 });
  // Left out: unchanged. Sent as null: cleared.
  expect((await admin.put(`/api/media/copies/${book.copies[0].id}`, { format: 'Book on CD', note: 'in the car' })).json.copies[0].pieces).toBe(12);
  expect((await admin.put(`/api/media/copies/${book.copies[0].id}`, { format: 'Book on CD', note: 'in the car', pieces: 14 })).json.copies[0].pieces).toBe(14);
  // A bad number is refused, and nothing else in the request is kept.
  for (const bad of [0, 1000, -3, 2.5, 'twelve']) {
    expect((await admin.post(`/api/media/${book.id}/copies`, { format: 'Cassette', pieces: bad })).status, String(bad)).toBeGreaterThanOrEqual(400);
    expect((await admin.put(`/api/media/copies/${book.copies[0].id}`, { format: 'Book on CD', note: 'changed', pieces: bad })).status, String(bad)).toBeGreaterThanOrEqual(400);
  }
  const after = (await admin.get(`/api/media/${book.id}`)).json;
  expect(after.copies).toHaveLength(1);
  expect(after.copies[0]).toMatchObject({ pieces: 14, note: 'in the car' });
  expect((await admin.put(`/api/media/copies/${book.copies[0].id}`, { format: 'Book on CD', note: 'in the car', pieces: null })).json.copies[0].pieces).toBeNull();
});

it('a copy keeps what it cost and is worth over the web, in cents, and a bad amount is refused', async () => {
  const admin = await owner();
  const made = await admin.post('/api/media', { type: 'film', title: 'Alien', copy: { format: 'VHS', cost_cents: 1299, bought_on: '1999-05-01' } });
  expect(made.status).toBeLessThan(300);
  const film = made.json;
  expect(film.copies[0]).toMatchObject({ cost_cents: 1299, bought_on: '1999-05-01', value_cents: null, valued_on: null });
  const id = film.copies[0].id;
  // A worth with no day is noted on a day (today, as the server counts it); what was not sent stays as it was.
  const worth = (await admin.put(`/api/media/copies/${id}`, { format: 'VHS', value_cents: 4050 })).json.copies[0];
  expect(worth).toMatchObject({ cost_cents: 1299, bought_on: '1999-05-01', value_cents: 4050 });
  expect(worth.valued_on).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect((await admin.get('/api/media')).json[0]).toMatchObject({ copy_count: 1, cost_cents: 1299, worth_cents: 4050, unvalued: 0, gain_cents: 2751 });
  expect((await admin.get(`/api/media/${film.id}`)).json.copies[0]).toMatchObject({ cost_cents: 1299, value_cents: 4050 });
  // Bad amounts are refused, whether not a whole number of cents, below nothing, too large, text, or a day that is not one; nothing else in the request is kept.
  for (const bad of [{ cost_cents: -5 }, { cost_cents: 12.5 }, { value_cents: 'twelve' }, { value_cents: 10 ** 12 }, { bought_on: 'last spring' }, { valued_on: '2046-13-45' }]) {
    expect((await admin.put(`/api/media/copies/${id}`, { format: 'VHS', note: 'changed', ...bad })).status, JSON.stringify(bad)).toBeGreaterThanOrEqual(400);
    expect((await admin.post(`/api/media/${film.id}/copies`, { format: 'DVD', ...bad })).status, JSON.stringify(bad)).toBeGreaterThanOrEqual(400);
  }
  const after = (await admin.get(`/api/media/${film.id}`)).json;
  expect(after.copies).toHaveLength(1);
  expect(after.copies[0]).toMatchObject({ cost_cents: 1299, value_cents: 4050, note: null });
  // Sent as null: cleared, and the worth's day with it.
  expect((await admin.put(`/api/media/copies/${id}`, { format: 'VHS', value_cents: null })).json.copies[0]).toMatchObject({ value_cents: null, valued_on: null, cost_cents: 1299 });
});

it('a list of films and albums is looked over and brought in over the web, with its columns told back', async () => {
  const admin = await owner();
  const text = 'Title,Director,Media,Price Paid,Mood\nAlien,Ridley Scott,Blu-ray,14.99,tense\nRumours,Fleetwood Mac,Vinyl,12,calm\n';
  const seen = (await admin.post('/api/media/list/read', { text, any: true, type: 'film' })).json;
  expect(seen).toMatchObject({ count: 2, types: { film: 1, music: 1 }, columns: { ignored: ['Mood'] } });
  expect(seen.columns.understood.map((c: { as: string }) => c.as)).toEqual(['Title', 'Creator', 'Type or format', 'Price paid']);
  const done = await admin.post('/api/media/list', { text, any: true, type: 'film' });
  expect([done.status, done.json]).toEqual([201, { listed: 2, added: 2, copies: 2, already: 0, wanted: 0, logged: 0 }]);
  expect((await admin.get('/api/media')).json.map((m: { title: string; cost_cents: number }) => [m.title, m.cost_cents])).toEqual([['Alien', 1499], ['Rumours', 1200]]);
  expect((await admin.post('/api/media/list/read', { text: '  ', any: true })).status).toBe(400);
});

it('a kind carries the activity its things are for, and one button adds it to the things already there', async () => {
  const admin = await owner();
  let kinds = (await admin.post('/api/things/kinds', { name: 'Odds and ends', activity: 'Sewing' })).json;
  const notions = kinds.find((k: { name: string }) => k.name === 'Odds and ends');
  expect(notions.activity).toBe('Sewing');
  expect(notions.group).toBeNull();
  expect(Object.keys(notions).sort()).toEqual(['activity', 'fields', 'group', 'icon', 'id', 'items', 'name', 'unit']);
  expect((await admin.post('/api/things/items', { kind_id: notions.id, name: 'Thread', activities: [] })).json.activities).toEqual(['Sewing']);
  const hatchet = (await admin.post('/api/things/items', { kind_id: notions.id, name: 'Hatchet', activities: ['Camping'] })).json;
  expect(hatchet.activities).toEqual(['Camping']);
  kinds = (await admin.put(`/api/things/kinds/${notions.id}`, { activity: 'Woodworking' })).json;
  expect(kinds.find((k: { name: string }) => k.name === 'Odds and ends').activity).toBe('Woodworking');
  expect((await admin.get(`/api/things/items/${hatchet.id}`)).json.activities).toEqual(['Camping']);
  expect((await admin.post(`/api/things/kinds/${notions.id}/activity`, {})).json).toEqual({ added: 2 });
  expect((await admin.get(`/api/things/items/${hatchet.id}`)).json.activities.sort()).toEqual(['Camping', 'Woodworking']);
  expect((await admin.post(`/api/things/kinds/${notions.id}/activity`, {})).json).toEqual({ added: 0 });
  kinds = (await admin.put(`/api/things/kinds/${notions.id}`, { activity: null })).json;
  expect(kinds.find((k: { name: string }) => k.name === 'Odds and ends').activity).toBeNull();
  expect((await admin.post(`/api/things/kinds/${notions.id}/activity`, {})).status).toBe(400);
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
  expect([empty.day, empty.cards]).toEqual([day['X-Local-Day'], ['days', 'dates', 'kitchen', 'pantry', 'projects', 'upkeep', 'things', 'collection', 'week']]);
  await admin.post('/api/calendar/events', { title: 'Dentist', day: empty.day, time: '14:30' });
  await admin.post('/api/kitchen/plan', { day: empty.day, title: 'Leftovers' });
  await admin.post('/api/projects', { name: 'Shirt dress', status: 'active' });
  const full = (await admin.get('/api/home', day)).json;
  expect(full.days[0].entries.map((e: { title: string }) => e.title)).toEqual(['Dentist', 'Leftovers']);
  expect([full.kitchen.meals.length, full.projects.map((p: { name: string }) => p.name)]).toEqual([1, ['Shirt dress']]);

  const fewer = (await admin.put('/api/home/cards', { hidden: ['pantry', 'things'] })).json;
  expect(fewer.cards).toEqual(['days', 'dates', 'kitchen', 'projects', 'upkeep', 'collection', 'week']);
  expect((await admin.put('/api/home/cards', { hidden: ['horoscope'] })).status).toBe(400);
  expect((await admin.put('/api/home/cards', {})).status).toBe(422);
  const other = await member(admin, 'partner');
  const theirs = (await other.get('/api/home', day)).json;
  expect([theirs.cards.length, theirs.days[0].entries, theirs.projects]).toEqual([9, [], []]);
  expect((await visitor().get('/api/home')).status).toBe(401);
});

it('things answer over the web: no longer have it and undoing it, insured, asset numbers and fields of your own', async () => {
  const admin = await owner();
  const kind = (await admin.post('/api/things/kinds', { name: 'Household' })).json[0];
  const tv = (await admin.post('/api/things/items', { kind_id: kind.id, name: 'Television', insured: true, own_fields: [{ name: 'Remote', value: 'In the drawer' }] })).json;
  const lamp = (await admin.post('/api/things/items', { kind_id: kind.id, name: 'Lamp' })).json;
  expect([tv.asset_no, lamp.asset_no, tv.insured, tv.own_fields]).toEqual(['000-001', '000-002', true, [{ name: 'Remote', value: 'In the drawer' }]]);
  expect((await admin.get('/api/things/items?q=000-002')).json.map((t: { name: string }) => t.name)).toEqual(['Lamp']);
  expect((await admin.get('/api/things/report?insured=1')).json.rooms[0].lines.map((l: { name: string }) => l.name)).toEqual(['Television']);
  expect((await admin.get('/api/things/report.csv?insured=1')).bytes.toString()).not.toContain('Lamp');

  const gone = await admin.post(`/api/things/items/${tv.id}/gone`, { how: 'sold', day: '2046-03-01', to: 'A neighbor', price_cents: 5000 });
  expect([gone.status, gone.json.gone]).toEqual([200, { on: '2046-03-01', how: 'sold', to: 'A neighbor', cents: 5000 }]);
  expect((await admin.post(`/api/things/items/${tv.id}/gone`, { how: 'sold' })).status).toBe(409);
  expect((await admin.post(`/api/things/items/${lamp.id}/gone`, { how: 'misplaced' })).status).toBe(400);
  expect((await admin.get('/api/things/items')).json.map((t: { name: string }) => t.name)).toEqual(['Lamp']);
  expect((await admin.get('/api/things/items?gone=1')).json.map((t: { name: string }) => t.name)).toEqual(['Television']);
  // Editing the thing without saying so keeps its fields and insurance.
  const edited = (await admin.put(`/api/things/items/${tv.id}`, { name: 'Television, 55 inch' })).json;
  expect([edited.insured, edited.own_fields.length, edited.gone.how]).toEqual([true, 1, 'sold']);
  const back = await admin.delete(`/api/things/items/${tv.id}/gone`);
  expect([back.status, back.json.gone]).toEqual([200, null]);
  expect((await admin.get('/api/things/items')).json).toHaveLength(2);
  const other = await member(admin, 'partner');
  expect((await other.post(`/api/things/items/${tv.id}/gone`, { how: 'sold' })).status).toBe(404);
});

it('a database from before things and projects is upgraded, with a copy saved first', async () => {
  const admin = await owner();
  await admin.post('/api/kitchen/recipes', { title: 'Toast', ingredients_text: '2 slices bread' });
  // Put the database back to how version 2 left it: the kitchen, and none of the newer tables.
  for (const table of ['media_list_items', 'media_lists', 'item_fields', 'outdoor_harvest', 'outdoor_catch', 'outdoor_seasons', 'outdoor_gear', 'outdoor_trip_years', 'outdoor_trips', 'holiday_ticks', 'holiday_steps', 'holiday_decor', 'holiday_gifts', 'holiday_people', 'holiday_years', 'holidays', 'trip_receipts', 'shopping_trips', 'routine_sent', 'routine_finished', 'routine_ticks', 'routine_steps', 'routine_times', 'routines', 'prep_sent', 'prep_steps', 'simplefin_accounts', 'simplefin_connections', 'money_goal_saved', 'money_goals', 'money_income', 'tag_links', 'tags', 'recipe_photos', 'auth_challenges', 'passkeys', 'recovery_codes', 'user_security', 'licenses','recall_checks', 'vehicle_recalls', 'manual_shares','manual_entries', 'pet_weights', 'item_documents', 'push_subscriptions', 'readings', 'upkeep_done', 'upkeep_supplies', 'upkeep_tools', 'upkeep_jobs', 'pets', 'household_members', 'item_history', 'item_activities', 'item_photos', 'money_entries', 'money_shares', 'money_categories', 'project_costs', 'followed_events', 'followed_calendars', 'calendar_feeds', 'stores', 'ingredient_barcodes', 'coupons', 'prices', 'plan_photos', 'plan_items', 'plans', 'mail_accounts', 'recipe_equipment', 'media_covers', 'media_log', 'media_copies', 'library_sources', 'media', 'media_sources', 'events', 'project_sessions', 'project_items', 'projects', 'item_values', 'items', 'places', 'kind_fields', 'kinds']) {
    await database.db.run(`DROP TABLE ${table}`);
  }
  // Columns later added to a table that was already there go back too.
  for (const column of ['usual_store', 'usual_size_quantity', 'usual_size_unit']) await database.db.run(`ALTER TABLE ingredients DROP COLUMN ${column}`);
  await database.db.run('ALTER TABLE meal_plan DROP COLUMN eat_time');
  await database.db.run('ALTER TABLE grocery DROP COLUMN store');
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
  expect((await admin.get(`/api/shopping/prices/${coffee}/history`)).json).toEqual([{ cents: 899, saved_cents: 0, amount: '', store: 'Aldi', day: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) }]);

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
  expect((await admin.put(`/api/shopping/usual/${again}`, { store: 'Costco', size: '3 lb' })).json.lines).toEqual([{ id: again, price_cents: null, saved_cents: 0, deal: null, size: '', assumed: false,
    last: expect.objectContaining({ cents: 899, amount: '30 oz', store: 'Aldi on Main St' }), coupons: [], usual_store: 'Costco', usual_size: '3 lb', likely_store: 'Costco',
    moved_to: null, store: 'Costco', estimate_cents: 899, cheaper: null }]);
  expect((await admin.put(`/api/shopping/usual/${again}`, { size: 'huge' })).status).toBe(400);
});

it('a trip to a store, a moved line and a paid project cost answer over the web, and the bank charge is not counted again', async () => {
  const admin = await owner();
  const groceries = (await admin.post('/api/money/categories', { name: 'Groceries', monthly_cents: 50000 })).json.id;
  const id = (await admin.post('/api/kitchen/grocery', { label: 'milk' })).json[0].id;
  expect((await admin.put(`/api/shopping/move/${id}`, { store: 'Aldi' })).json.lines[0]).toMatchObject({ moved_to: 'Aldi', likely_store: 'Aldi' });
  await admin.post(`/api/kitchen/grocery/${id}/tick`, { done: true, put_away: false });
  await admin.put('/api/shopping/settings', { store: 'Aldi' });
  await admin.put(`/api/shopping/prices/${id}`, { cents: 229 });
  const plan = (await admin.get('/api/shopping/trip?store=Aldi')).json;
  expect([plan.estimate_cents, plan.parts.map((p: { key: string }) => p.key)]).toEqual([229, ['groceries']]);
  expect((await admin.post('/api/shopping/trip', { store: 'Aldi', total_cents: 250, parts: [{ cents: 1 }] })).status).toBe(400);
  expect((await admin.post('/api/shopping/trip', { store: '', total_cents: 250 })).status).toBe(400);
  const done = await admin.post('/api/shopping/trip', { store: 'Aldi', total_cents: 250, day: '2046-03-05' });
  expect([done.status, done.json.entries, done.json.got]).toEqual([201, 1, 1]);
  const bank = await admin.post('/api/money/statement', { text: 'Date,Description,Amount\n03/06/2046,ALDI 72,-2.50\n' });
  expect([bank.json.added, bank.json.already]).toEqual([0, 1]);
  expect((await admin.get('/api/money?month=2046-03')).json.entries.map((e: { label: string; cents: number; category_id: number }) => [e.label, e.cents, e.category_id])).toEqual([['Groceries at Aldi', 250, groceries]]);

  // A project cost, paid from savings, is one entry on the project, and its entry can only be changed there.
  const project = (await admin.post('/api/projects', { name: 'Shelf' })).json;
  const costed = (await admin.post(`/api/projects/${project.id}/costs`, { label: 'Boards', planned_cents: 1000 })).json;
  const goal = (await admin.post('/api/money/goals', { name: 'Shelf fund', target_cents: 5000, project_id: project.id })).json.id;
  await admin.post(`/api/money/goals/${goal}/saved`, { cents: 600, day: '2046-02-01' });
  const paid = (await admin.post(`/api/projects/costs/${costed.costs[0].id}/pay`, { actual_cents: 1200, from_savings: true })).json;
  expect([paid.costs[0].drawn_cents, paid.budget.saved.cents, paid.budget.over]).toEqual([600, 0, 200]);
  const entry = (await admin.get(`/api/money?month=${paid.costs[0].paid_on.slice(0, 7)}`)).json;
  expect([entry.projects.spent, entry.entries.filter((e: { label: string }) => e.label === 'Boards')]).toEqual([1200, []]);
  const linked = (await admin.put(`/api/projects/${project.id}/goal`, { goal_id: null })).json;
  expect(linked.budget.saved).toBeNull();
});

it('a bank statement is looked over, then brought in once, privately, over the web', async () => {
  const admin = await owner();
  const other = await member(admin, 'ben');
  const text = 'Account summary,,\nDate,Description,Amount\n03/02/2046,"Market, Main St",-20.00\n03/03/2046,Pay,500.00\n';
  const house = (await admin.post('/api/money/categories', { name: 'House', monthly_cents: 50000 })).json.id;
  const seen = await admin.post('/api/money/statement/read', { text });
  expect(seen.status).toBe(200);
  expect(seen.json).toMatchObject({ spending_is: 'negative', guessed: true, first_day: '2046-03-02', last_day: '2046-03-03', spent_cents: 2000, received_cents: 50000, already: 0 });
  expect(seen.json.rows.map((r: { label: string; kind: string }) => [r.label, r.kind])).toEqual([['Market, Main St', 'spent'], ['Pay', 'received']]);
  // Said the other way round, the same file reads the other way.
  expect((await admin.post('/api/money/statement/read', { text, spending_is: 'positive' })).json.spent_cents).toBe(50000);
  expect((await admin.post('/api/money/statement/read', { text, spending_is: 'sideways' })).status).toBe(422);
  expect((await admin.post('/api/money/statement/read', { text: 'OFXHEADER:100\n<OFX>' })).json.detail).toBe('That is a Quicken/OFX file. Download the CSV version from your bank instead.');
  expect((await admin.post('/api/money/statement/read', { text: '' })).status).toBe(400);

  const brought = await admin.post('/api/money/statement', { text, keep: [0], categories: { 0: house } });
  expect([brought.status, brought.json]).toEqual([201, { listed: 2, added: 1, already: 0, left_out: 1, months: [{ month: '2046-03', added: 1 }] }]);
  expect((await admin.post('/api/money/statement', { text, keep: [0], categories: { 0: house } })).json).toMatchObject({ added: 0, already: 1 });
  const march = (await admin.get('/api/money?month=2046-03')).json;
  expect(march.entries.map((e: { label: string; category: string }) => [e.label, e.category])).toEqual([['Market, Main St', 'House']]);
  // Another person sees none of it, can't use the category, and is told nothing is already there.
  expect((await other.get('/api/money?month=2046-03')).json.entries).toEqual([]);
  expect((await other.post('/api/money/statement', { text, categories: { 0: house } })).status).toBe(404);
  expect((await other.post('/api/money/statement/read', { text })).json.already).toBe(0);
});

it("a HomeBox file is looked over, then brought in once, and only for the person who brought it", async () => {
  const admin = await owner();
  const other = await member(admin, 'ben');
  const text = 'HB.import_ref,HB.location,HB.labels,HB.asset_id,HB.name,HB.quantity\nr1,Garage / Shelf,Tools,000-001,Drill,1\nr2,,,000-002,Box,2\n';
  const seen = await admin.post('/api/things/homebox/read', { text });
  expect([seen.status, seen.json.fresh, seen.json.places, seen.json.kinds.map((k: { name: string }) => k.name)]).toEqual([200, 2, { total: 2, fresh: 2 }, ['Other', 'Tools']]);
  expect((await admin.get('/api/things/items')).json).toEqual([]);
  expect((await admin.post('/api/things/homebox/read', { text: 'Title,Author\nDune,Herbert\n' })).status).toBe(400);
  expect((await admin.post('/api/things/homebox/read', {})).status).toBe(422);
  const brought = await admin.post('/api/things/homebox', { text });
  expect([brought.status, brought.json]).toMatchObject([201, { added: 2, already: 0, places_made: 2, tags_made: 1, asset_changed: 0 }]);
  expect((await admin.post('/api/things/homebox', { text })).json).toMatchObject({ added: 0, already: 2 });
  expect((await admin.get('/api/things/items')).json.map((i: { name: string; asset_no: string }) => [i.name, i.asset_no]).sort()).toEqual([['Box', '000-002'], ['Drill', '000-001']]);
  expect((await other.get('/api/things/items')).json).toEqual([]);
  expect((await other.post('/api/things/homebox/read', { text })).json.already).toBe(0);
});

it('the budget answers over the web: income, bills from upkeep, goals, the month and the year, and tags', async () => {
  const admin = await owner();
  const other = await member(admin, 'ben');
  const pay = await admin.post('/api/money/income', { name: 'Paycheck', cents: 150000, every: 'monthly', start_day: '2046-01-05' });
  expect([pay.status, typeof pay.json.id]).toEqual([201, 'number']);
  expect((await admin.post('/api/money/income', { name: 'Gift', cents: 5000, every: 'once' })).status).toBe(400);
  expect((await admin.post('/api/money/income', { name: 'x', cents: 'lots', every: 'monthly' })).status).toBe(422);
  expect((await admin.put(`/api/money/income/${pay.json.id}`, { name: 'Paycheck', cents: 160000, every: 'monthly', start_day: '2046-01-05' })).status).toBe(204);
  expect((await admin.get('/api/money/income')).json).toMatchObject([{ name: 'Paycheck', cents: 160000, every: 'monthly', per_month: 160000 }]);

  // A bill made from the budget is an upkeep job, so it shows in upkeep and is paid there.
  const bill = await admin.post('/api/money/bills', { name: 'Rent', cents: 90000, every_n: 1, every_unit: 'month', first_due: '2046-03-01' });
  expect(bill.status).toBe(201);
  expect((await admin.get(`/api/things/upkeep/${bill.json.id}`)).json).toMatchObject({ kind: 'bill', amount_cents: 90000 });
  expect((await admin.get('/api/money/bills')).json).toMatchObject([{ job_id: bill.json.id, name: 'Rent', per_month: 90000 }]);
  expect((await admin.post('/api/money/bills', { name: 'Water', cents: 'x' })).status).toBe(422);

  const goal = await admin.post('/api/money/goals', { name: 'Trip', target_cents: 100000, by_day: '2046-12-31' });
  expect(goal.status).toBe(201);
  expect((await admin.post(`/api/money/goals/${goal.json.id}/saved`, { day: '2046-03-03', cents: 20000 })).status).toBe(201);
  expect((await admin.post(`/api/money/goals/${goal.json.id}/saved`, { day: '2046-03-04', cents: -500000 })).status).toBe(422);
  expect((await admin.get(`/api/money/goals/${goal.json.id}`)).json).toMatchObject({ saved: 20000, left: 80000, puts: [{ day: '2046-03-03', cents: 20000 }] });
  expect((await admin.put(`/api/money/goals/${goal.json.id}`, { name: 'Big trip', target_cents: 120000 })).status).toBe(204);

  const house = (await admin.post('/api/money/categories', { name: 'House', monthly_cents: 30000 })).json.id;
  const spent = (await admin.post('/api/money/entries', { label: 'Paint', cents: 4000, day: '2046-03-02', category_id: house })).json.id;
  const tag = (await admin.post('/api/tags', { name: 'Home' })).json;
  expect((await admin.put(`/api/tags/on/spending/${spent}`, { tag_ids: [tag.id] })).status).toBe(200);

  const march = (await admin.get('/api/money/budget?month=2046-03')).json;
  expect([march.income.total, march.bills.total, march.planned.total, march.saved.total, march.left_over]).toEqual([160000, 90000, 30000, 20000, 20000]);
  expect(march.by_tag).toMatchObject([{ path: 'Home', cents: 4000, count: 1 }]);
  const year = (await admin.get('/api/money/year?year=2046')).json;
  expect(year.months).toHaveLength(12);
  expect(year.months[2]).toMatchObject({ month: '2046-03', income: 160000, bills: 90000, saved: 20000 });
  expect((await admin.get('/api/money/by-tag?period=2046')).json).toMatchObject([{ path: 'Home', cents: 4000 }]);
  expect((await admin.get(`/api/tags/${tag.id}`)).json.spending).toMatchObject({ count: 1, all: 4000 });

  // Another person sees none of it and cannot change it.
  expect((await other.get('/api/money/income')).json).toEqual([]);
  expect((await other.get('/api/money/goals')).json).toEqual([]);
  expect((await other.get('/api/money/bills')).json).toEqual([]);
  expect((await other.get('/api/money/budget?month=2046-03')).json.income.total).toBe(0);
  expect((await other.put(`/api/money/income/${pay.json.id}`, { name: 'x', cents: 1, every: 'monthly' })).status).toBe(404);
  expect((await other.delete(`/api/money/goals/${goal.json.id}`)).status).toBe(404);
  expect((await other.post(`/api/money/goals/${goal.json.id}/saved`, { cents: 100 })).status).toBe(404);
  expect((await visitor().get('/api/money/year')).status).toBe(401);

  const put = (await admin.get(`/api/money/goals/${goal.json.id}`)).json.puts[0].id;
  expect((await admin.delete(`/api/money/goals/saved/${put}`)).status).toBe(204);
  expect((await admin.delete(`/api/money/goals/${goal.json.id}`)).status).toBe(204);
  expect((await admin.delete(`/api/money/income/${pay.json.id}`)).status).toBe(204);
  expect((await admin.get('/api/money/goals')).json).toEqual([]);
});

it('licenses are kept over the web, with a renewal that follows them, and the number only where asked for', async () => {
  const admin = await owner();
  const other = await member(admin, 'ben');
  const dayIn = (days: number) => { const d = new Date(); d.setDate(d.getDate() + days); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const ready = (await admin.get('/api/things/licenses/ready')).json;
  expect([ready.categories.length, ready.soon_days, ready.leads.Travel.n, ready.leads.Travel.unit, ready.starters.find((s: { name: string }) => s.name === 'Passport').term_years]).toEqual([7, 60, 6, 'month', 10]);

  const made = await admin.post('/api/things/licenses', { name: "Driver's license", category: 'Driving', holder: 'Dana', number: 'D123-4567', issuer: 'State DMV', expires_on: dayIn(20) });
  expect(made.status).toBe(201);
  expect((await admin.post('/api/things/licenses', { name: '' })).status).toBe(400);
  expect((await admin.post('/api/things/licenses', {})).status).toBe(422);
  // The list says there is a number and never shows it; asking for the one license does.
  const list = await admin.get('/api/things/licenses');
  expect(list.json).toHaveLength(1);
  expect(JSON.stringify(list.json)).not.toContain('D123-4567');
  expect(list.json[0]).toMatchObject({ has_number: true, state: 'soon', days_left: 20 });
  expect((await admin.get(`/api/things/licenses/${made.json.id}`)).json.number).toBe('D123-4567');
  expect((await admin.get('/api/things/licenses/expiring?days=60')).json.map((l: { name: string }) => l.name)).toEqual(["Driver's license"]);

  // "Remind me to renew": a renewal in upkeep, first due 30 days before, which follows the expiry day.
  expect((await admin.post(`/api/things/licenses/${made.json.id}/reminder`, { lead_n: 5, lead_unit: 'fortnight' })).status).toBe(400);
  const set = (await admin.post(`/api/things/licenses/${made.json.id}/reminder`, { term_years: 4 })).json;
  expect(set.reminder).toMatchObject({ lead: { n: 30, unit: 'day' }, term_years: 4, due_on: dayIn(-10), renewed: false });
  const job = (await admin.get(`/api/things/upkeep/${set.reminder.job_id}`)).json;
  expect([job.name, job.kind, job.first_due]).toEqual(["Renew Dana's driver's license", 'renewal', dayIn(-10)]);
  expect(JSON.stringify(job)).not.toContain('D123-4567');
  const moved = (await admin.put(`/api/things/licenses/${made.json.id}`, { name: "Driver's license", category: 'Driving', holder: 'Dana', number: 'D123-4567', issuer: 'State DMV', expires_on: dayIn(90) })).json;
  expect(moved.reminder.due_on).toBe(dayIn(60));
  expect((await admin.get('/api/search?q=driver')).json.map((r: { kind: string; link: string }) => [r.kind, r.link]).filter(([k]: string[]) => k === 'license')).toEqual([['license', '/things/licenses']]);
  expect(JSON.stringify((await admin.get('/api/search?q=D123')).json)).toBe('[]');

  // Nobody else sees or changes it.
  expect((await other.get('/api/things/licenses')).json).toEqual([]);
  expect([(await other.get(`/api/things/licenses/${made.json.id}`)).status, (await other.delete(`/api/things/licenses/${made.json.id}`)).status,
    (await other.post(`/api/things/licenses/${made.json.id}/reminder`, {})).status]).toEqual([404, 404, 404]);

  // Removed with its reminder, or without it.
  expect((await admin.delete(`/api/things/licenses/${made.json.id}?reminder=1`)).status).toBe(204);
  expect((await admin.get(`/api/things/upkeep/${set.reminder.job_id}`)).status).toBe(404);
  const again = (await admin.post('/api/things/licenses', { name: 'Passport', holder: 'Dana', category: 'Travel', expires_on: dayIn(400) })).json;
  const kept = (await admin.post(`/api/things/licenses/${again.id}/reminder`, {})).json;
  expect((await admin.delete(`/api/things/licenses/${again.id}`)).status).toBe(204);
  expect((await admin.get(`/api/things/upkeep/${kept.reminder.job_id}`)).status).toBe(200);
  expect((await visitor().get('/api/things/licenses')).status).toBe(401);
});

it('download everything: a zip with a dated name that holds only your own, and a way to bring it back in part by part', async () => {
  time = new Date('2046-03-05T12:00:00Z');
  const admin = await owner();
  const other = await member(admin, 'partner');
  await admin.post('/api/kitchen/recipes/import', { text: 'Crème brûlée\n1 cup cream\nWarm the cream.' });
  await other.post('/api/kitchen/recipes/import', { text: 'Partner pie\n1 apple\nBake it.' });
  const kind = (await admin.post('/api/things/kinds', { name: 'Fabric' })).json.find((k: { name: string }) => k.name === 'Fabric');
  const thing = (await admin.post('/api/things/items', { kind_id: kind.id, name: 'Blue linen', quantity: 3 })).json;
  const photo = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
  expect((await admin.put(`/api/things/items/${thing.id}/photo`, { data: photo.toString('base64') })).status).toBe(200);

  expect((await visitor().get('/api/export/everything.zip')).status).toBe(401);
  const got = await admin.get('/api/export/everything.zip', { 'X-Local-Day': MONDAY });
  expect([got.status, got.headers.get('content-type'), got.headers.get('content-disposition')])
    .toEqual([200, 'application/zip', 'attachment; filename="lifeis-everything-2046-03-05.zip"']);
  expect(got.headers.get('cache-control')).toBe('private, no-store');
  const mine = await splitDownload(new Uint8Array(got.bytes));
  expect(Object.keys(mine.files)).toEqual(expect.arrayContaining(['README.txt', 'recipes.csv', 'things.csv']));
  expect(mine.files['recipes.csv']).toContain('Crème brûlée');
  expect(JSON.stringify(mine.files)).not.toContain('Partner pie');
  expect((await other.get('/api/export/everything.zip')).bytes.toString('latin1')).not.toContain('Blue linen');

  // The partner looks at the zip, brings in recipes and things only, then the pictures; the same file again adds nothing.
  const files = mine.files;
  const looked = (await other.post('/api/export/look', { files })).json;
  expect(looked.made_on).toBe('2046-03-05');
  expect(looked.kinds.find((k: { key: string }) => k.key === 'things')).toMatchObject({ found: 1, fresh: 1, already: 0, importable: true });
  expect(looked.kinds.find((k: { key: string }) => k.key === 'recipes')).toMatchObject({ found: 1, fresh: 1 });
  expect((await other.get('/api/things/items')).json).toEqual([]);
  const brought = (await other.post('/api/export/bring-in', { files, kinds: ['things', 'recipes'] })).json;
  expect(brought.kinds.map((k: { key: string; ok: boolean; fresh: number }) => [k.key, k.ok, k.fresh])).toEqual([['things', true, 1], ['recipes', true, 1]]);
  expect(brought.pending).toEqual([expect.objectContaining({ as: 'thing-photo' })]);
  const pictures = await other.post('/api/export/pictures', { pictures: [{ as: 'thing-photo', id: brought.pending[0].id, data: Buffer.from(mine.pictures.values().next().value!).toString('base64') }] });
  expect(pictures.json).toEqual({ kept: 1, left: 0 });
  expect((await other.get('/api/things/items')).json.map((i: { name: string; photo: boolean }) => [i.name, i.photo])).toEqual([['Blue linen', true]]);
  expect((await other.get('/api/kitchen/recipes')).json.map((r: { title: string }) => r.title).sort()).toEqual(['Crème brûlée', 'Partner pie']);
  const again = (await other.post('/api/export/bring-in', { files, kinds: ['things', 'recipes'] })).json;
  expect(again.kinds.map((k: { fresh: number; already: number }) => [k.fresh, k.already])).toEqual([[0, 1], [0, 1]]);
  expect(again.pending).toEqual([]);

  // What cannot be read is said in words.
  expect([(await other.post('/api/export/look', { files: { 'notes.txt': 'hello' } })).status, (await other.post('/api/export/look', {})).status, (await other.post('/api/export/pictures', { pictures: [{ as: 'thing-photo', id: 1, data: 5 }] })).status]).toEqual([400, 422, 422]);
  expect((await visitor().post('/api/export/look', { files })).status).toBe(401);
});

it('films and shows are looked up on TMDB with the persons own key, kept sealed, and the poster comes through Life Is', async () => {
  // This one needs a way outside, so it runs its own server in place of the usual one: a stand-in for TMDB.
  await stop();
  const KEY = 'eyJhbGciOiJIUzI1NiJ9.a-long-read-access-token-for-tests.signature';
  const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
  const asked: Array<{ url: string; authorization: string | undefined }> = [];
  const fetcher = async (url: string, headers: Record<string, string>) => {
    asked.push({ url, authorization: headers.Authorization });
    const reply = (status: number, body: unknown, type = 'application/json') => ({ status, type, json: async () => body, bytes: async () => (body instanceof Uint8Array ? body : new Uint8Array()) });
    if (url.startsWith('https://image.tmdb.org/')) return reply(200, PNG, 'image/png');
    if (headers.Authorization !== `Bearer ${KEY}`) return reply(401, {});
    if (url.includes('/3/configuration')) return reply(200, { images: {} });
    if (url.includes('/3/search/movie')) return reply(200, { results: [{ id: 348, title: 'Alien', release_date: '1979-05-25', poster_path: '/alien-poster.jpg' }] });
    if (url.includes('/3/movie/348')) return reply(200, { id: 348, title: 'Alien', release_date: '1979-05-25', runtime: 117, overview: 'In space.', poster_path: '/alien-poster.jpg', genres: [{ name: 'Horror' }], credits: { crew: [{ job: 'Director', name: 'Ridley Scott' }] } });
    return reply(404, {});
  };
  database = await openDatabase(path.join(folder, 'data'), path.join(folder, 'keys'));
  server = createServer(createApp({ db: database.db, reach: { fetcher, sealer: vault(path.join(folder, 'keys'), 'media_source') }, onError: (problem) => errors.push(problem) }));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const admin = await owner();
  const off = (await admin.get('/api/lookups')).json;
  expect([off.films, off.film_key, off.film_service.name]).toEqual([false, false, 'Films and shows from TMDB']);
  expect(off.film_service.sends).toContain('image.tmdb.org');
  expect(off.film_service.notice).toContain('not endorsed');
  expect((await admin.get('/api/lookups/films/search?q=Alien&kind=film')).status).toBe(400); // off: nothing asked
  expect((await admin.put('/api/lookups', { films: true })).status).toBe(400); // and it needs a key
  expect((await admin.put('/api/lookups', { films: true, films_key: 'short' })).status).toBe(400);
  expect(asked).toEqual([]);

  const on = await admin.put('/api/lookups', { films: true, films_key: KEY });
  expect([on.json.films, on.json.film_key]).toEqual([true, true]);
  expect(JSON.stringify(on.json)).not.toContain(KEY);
  expect(JSON.stringify((await admin.get('/api/lookups')).json)).not.toContain(KEY);
  expect((await admin.post('/api/lookups/films/test')).json).toEqual({ ok: true });

  const search = await admin.get('/api/lookups/films/search?q=Alien&year=1979&kind=film');
  expect(search.json.matches).toEqual([{ kind: 'movie', id: '348', title: 'Alien', year: 1979, poster: '/alien-poster.jpg', overview: null }]);
  expect(asked.at(-1)).toEqual({ url: 'https://api.themoviedb.org/3/search/movie?query=Alien&year=1979', authorization: `Bearer ${KEY}` });

  const picked = (await admin.post('/api/lookups/films/pick', { kind: 'movie', id: '348', current: { title: 'Alien (my tape)', year: '', creator: '', genres: [], summary: 'Mine.' } })).json;
  expect(picked.fields).toEqual({ title: 'Alien (my tape)', year: 1979, creator: 'Ridley Scott', minutes: 117, genres: ['Horror'], summary: 'Mine.' });
  expect([picked.filled, picked.kept]).toEqual([['year', 'creator', 'minutes', 'genres'], ['title', 'summary']]);

  // The poster is asked for through Life Is, and kept as the title's cover.
  const poster = await admin.get('/api/lookups/films/poster?path=/alien-poster.jpg');
  expect([poster.status, poster.headers.get('content-type'), [...poster.bytes]]).toEqual([200, 'image/png', [...PNG]]);
  expect((await admin.get('/api/lookups/films/poster?path=/../../x.jpg')).status).toBe(400);
  const film = (await admin.post('/api/media', { type: 'film', title: 'Alien', ids: { tmdb: '348', tmdb_kind: 'movie' } })).json;
  expect((await admin.post('/api/lookups/films/cover', { media_id: film.id, path: '/alien-poster.jpg' })).json).toEqual({ cover: `/api/media/${film.id}/cover` });
  const cover = await admin.get(`/api/media/${film.id}/cover`);
  expect([cover.status, cover.headers.get('content-type'), [...cover.bytes]]).toEqual([200, 'image/png', [...PNG]]);
  expect((await admin.get(`/api/media/${film.id}`)).json).toMatchObject({ cover: `/api/media/${film.id}/cover`, ids: { tmdb: '348', tmdb_kind: 'movie' } });

  // Another person has no key of their own, and cannot use this one or give this title a cover.
  const other = await member(admin, 'partner');
  expect((await other.get('/api/lookups')).json).toMatchObject({ films: false, film_key: false });
  const before = asked.length;
  expect((await other.get('/api/lookups/films/search?q=Alien&kind=film')).status).toBe(400);
  expect((await other.get('/api/lookups/films/poster?path=/alien-poster.jpg')).status).toBe(400);
  expect(asked).toHaveLength(before);
  // With a key of their own that TMDB does not accept, they are told so plainly, and only then.
  await other.put('/api/lookups', { films: true, films_key: 'a-different-key-that-tmdb-does-not-know' });
  const refused = await other.post('/api/lookups/films/test');
  expect([refused.status, refused.json.detail]).toEqual([400, expect.stringContaining("didn't accept that key")]);
  expect((await other.post('/api/lookups/films/cover', { media_id: film.id, path: '/alien-poster.jpg' })).status).toBe(404);
  expect((await visitor().get('/api/lookups/films/search?q=Alien')).status).toBe(401);

  // Forgetting the key turns it off.
  expect((await admin.put('/api/lookups', { forget_films_key: true })).json).toMatchObject({ films: false, film_key: false });
});

it('tags are made, nested, put on things and recipes, filtered, merged and removed over the web, one list for each person', async () => {
  const admin = await owner();
  const home = (await admin.post('/api/tags', { name: 'Kitchen' })).json;
  const small = (await admin.post('/api/tags', { name: 'Small', parent_id: home.id })).json;
  expect([home.path, small.path]).toEqual(['Kitchen', 'Kitchen > Small']);
  expect((await admin.post('/api/tags', {})).status).toBe(422);
  expect((await admin.post('/api/tags', { name: 'x', parent_id: 99999 })).status).toBe(404);

  const kinds = (await admin.post('/api/things/kinds', { name: 'Gadget', icon: '🔌', fields: [] })).json;
  const kind = kinds.find((k: { name: string }) => k.name === 'Gadget');
  const toaster = (await admin.post('/api/things/items', { kind_id: kind.id, name: 'Toaster' })).json;
  const soup = (await admin.post('/api/kitchen/recipes', { title: 'Soup', ingredients_text: '1 leek', steps_text: 'Simmer.', tags: ['winter'] })).json;
  expect(soup.tag_list.map((t: { path: string }) => t.path)).toEqual(['winter']);

  expect((await admin.put(`/api/tags/on/thing/${toaster.id}`, { tag_ids: [small.id] })).json.map((t: { path: string }) => t.path)).toEqual(['Kitchen > Small']);
  expect((await admin.get(`/api/tags/on/thing/${toaster.id}`)).json).toHaveLength(1);
  expect((await admin.get('/api/tags/on/nonsense/1')).status).toBe(404);
  expect((await admin.put(`/api/tags/on/thing/${toaster.id}`, {})).json).toEqual([]); // nothing given: none
  await admin.put(`/api/tags/on/thing/${toaster.id}`, { tag_ids: [small.id] });
  expect((await admin.post('/api/tags/bulk', { kind: 'recipe', ids: [soup.id], add: [home.id], remove: [] })).json).toEqual({ changed: 1 });
  expect((await admin.post('/api/tags/bulk', { kind: 'bad', ids: [], add: [], remove: [] })).status).toBe(422);

  // The filter on the lists: a parent includes what is inside it.
  expect((await admin.get(`/api/things/items?tag=${home.id}`)).json.map((i: { name: string }) => i.name)).toEqual(['Toaster']);
  expect((await admin.get(`/api/kitchen/recipes?tag=${home.id}`)).json.map((r: { title: string }) => r.title)).toEqual(['Soup']);
  expect((await admin.get('/api/kitchen/recipes?tag=winter')).json.map((r: { title: string }) => r.title)).toEqual(['Soup']);
  expect((await admin.get(`/api/projects?tag=${home.id}`)).json).toEqual([]);
  expect((await admin.get(`/api/things/pets?tag=${home.id}`)).json).toEqual([]);
  expect((await admin.get(`/api/things/upkeep?tag=${home.id}`)).json).toEqual([]);
  expect((await admin.get(`/api/plans?tag=${home.id}`)).json).toEqual([]);
  expect((await admin.get(`/api/media?tag=${home.id}`)).json).toEqual([]);
  expect((await admin.get(`/api/money?tag=${home.id}`)).json.entries).toEqual([]);
  expect((await admin.get(`/api/calendar?start=2046-03-01&tag=${home.id}`)).json).toEqual([]);
  expect((await admin.get('/api/things/items?tag=abc')).status).toBe(422);

  const page = (await admin.get(`/api/tags/${home.id}`)).json;
  expect([page.total, page.groups.map((g: { kind: string }) => g.kind), page.inside.map((n: { path: string }) => n.path)]).toEqual([2, ['thing', 'recipe'], ['Kitchen > Small']]);
  expect((await admin.get('/api/search?q=kitchen')).json.map((r: { kind: string }) => r.kind)).toEqual(['tag', 'tag', 'recipe', 'thing']);

  // Another person has their own list and cannot see, use or change these.
  const other = await member(admin, 'partner');
  expect((await other.get('/api/tags')).json).toEqual([]);
  expect((await other.get(`/api/tags/${home.id}`)).status).toBe(404);
  expect((await other.put(`/api/tags/${home.id}`, { name: 'Mine' })).status).toBe(404);
  expect((await other.delete(`/api/tags/${home.id}`)).status).toBe(404);
  expect((await visitor().get('/api/tags')).status).toBe(401);

  // Rename, move, merge, delete.
  expect((await admin.put(`/api/tags/${small.id}`, { name: 'Gadgets' })).json.path).toBe('Kitchen > Gadgets');
  expect((await admin.put(`/api/tags/${small.id}`, { parent_id: null })).json.path).toBe('Gadgets');
  expect((await admin.put(`/api/tags/${home.id}`, { parent_id: home.id })).status).toBe(400);
  const winter = (await admin.get('/api/tags')).json.find((t: { path: string }) => t.path === 'winter');
  expect((await admin.post(`/api/tags/${winter.id}/merge`, { into: home.id })).json.path).toBe('Kitchen');
  expect((await admin.post(`/api/tags/${winter.id}/merge`, { into: home.id })).status).toBe(404);
  expect((await admin.post(`/api/tags/${home.id}/merge`, {})).status).toBe(422);
  expect((await admin.delete(`/api/tags/${small.id}`)).status).toBe(204);
  expect((await admin.get(`/api/things/items/${toaster.id}`)).json.tag_list).toEqual([]);
  expect((await admin.get('/api/tags')).json.map((t: { path: string }) => t.path)).toEqual(['Kitchen']);
});

it('a person can choose a name to be shown: trimmed, 40 at most, empty means the sign-in name, and sign-in is untouched', async () => {
  const admin = await owner();
  expect((await admin.get('/api/account/name')).json).toEqual({ display_name: '', name: 'owner' });
  expect((await admin.put('/api/account/name', { display_name: '  Sam  ' })).json).toEqual({ display_name: 'Sam', name: 'Sam' });
  expect((await admin.get('/api/auth/status')).json.user).toEqual({ id: 1, username: 'owner', name: 'Sam', is_admin: true });
  expect((await admin.put('/api/account/name', { display_name: 'x'.repeat(41) })).status).toBe(400);
  expect((await admin.put('/api/account/name', { display_name: 7 })).status).toBe(400);
  expect((await admin.put('/api/account/name', { display_name: 'y'.repeat(40) })).json.name).toBe('y'.repeat(40));
  expect((await admin.get('/api/account/name')).json.display_name).toBe('y'.repeat(40));

  // Signing in still uses the sign-in name, and the display name does not work as one.
  const again = visitor();
  expect((await again.post('/api/auth/login', { username: 'Sam', password: PASSWORD })).status).toBe(401);
  const login = await again.post('/api/auth/login', { username: 'owner', password: PASSWORD });
  expect([login.status, login.json.username, login.json.name]).toEqual([200, 'owner', 'y'.repeat(40)]);

  // Someone else sees the new name where they share something, and the sign-in name where nothing is chosen.
  const partner = await member(admin, 'partner');
  const partnerId = (await admin.get('/api/things/upkeep/people')).json.find((p: { name: string }) => p.name === 'partner').id;
  await admin.put('/api/account/name', { display_name: 'Sam' });
  const house = (await admin.post('/api/money/categories', { name: 'House', monthly_cents: 50000, shared_with: [partnerId] })).json.id;
  const seen = (await partner.get('/api/money')).json;
  expect(seen.categories.find((c: { id: number }) => c.id === house)).toMatchObject({ owner: 'Sam', mine: false });
  expect(seen.people).toEqual([{ id: 1, username: 'owner', name: 'Sam' }]);
  expect((await admin.get('/api/money')).json.categories[0].shared_with).toEqual([{ id: partnerId, username: 'partner', name: 'partner' }]);
  expect((await partner.put('/api/account/name', { display_name: 'Pat' })).json.name).toBe('Pat');
  expect((await admin.get('/api/money')).json.categories[0].shared_with[0]).toMatchObject({ username: 'partner', name: 'Pat' });
  expect((await admin.get('/api/things/upkeep/people')).json.map((p: { name: string }) => p.name)).toEqual(['Pat', 'Sam']);
  const job = (await admin.post('/api/things/upkeep', { name: 'Mow', every_n: 1, every_unit: 'week', assigned_to: partnerId })).json;
  expect((await admin.get('/api/things/upkeep')).json.find((j: { id: number }) => j.id === job.id).assigned_to).toEqual({ id: partnerId, name: 'Pat' });
  expect((await partner.get('/api/things/upkeep')).json.find((j: { id: number }) => j.id === job.id).owner).toBe('Sam');

  // Empty goes back to the sign-in name.
  expect((await admin.put('/api/account/name', { display_name: '   ' })).json).toEqual({ display_name: '', name: 'owner' });
  expect((await partner.get('/api/money')).json.people).toEqual([{ id: 1, username: 'owner', name: 'owner' }]);
  // The list of people for an admin shows both.
  expect((await admin.get('/api/security/people')).json.map((p: { username: string; name: string }) => [p.username, p.name])).toEqual([['owner', 'owner'], ['partner', 'Pat']]);
});

it('prep reminders are kept on a recipe and on a meal, and listed for the week and for the front page', async () => {
  const admin = await owner();
  const recipe = (await admin.post('/api/kitchen/recipes', { title: 'Roast chicken', ingredients_text: '1 chicken' })).json;
  const kept = await admin.put(`/api/prep/recipes/${recipe.id}`, { steps: [{ words: 'Thaw the chicken', rule: 'night_before', at: '20:00' }, { words: 'Salt it', rule: 'hours_before', hours: 3 }] });
  expect([kept.status, kept.json.map((s: { when: string }) => s.when)]).toEqual([200, ['the night before at 8 pm', '3 hours before']]);
  expect((await admin.get(`/api/prep/recipes/${recipe.id}`)).json).toHaveLength(2);
  expect((await admin.put(`/api/prep/recipes/${recipe.id}`, { steps: [{ words: 'Thaw', rule: 'whenever' }] })).status).toBe(400);
  expect((await admin.put(`/api/prep/recipes/${recipe.id}`, { steps: [{ words: 'Thaw', rule: 'hours_before', hours: 99 }] })).status).toBe(400);
  const meal = (await admin.post('/api/kitchen/plan', { day: '2046-03-06', meal: 'dinner', recipe_id: recipe.id })).json;
  const set = await admin.put(`/api/prep/meals/${meal.id}`, { eat_time: '19:00', steps: [{ words: 'Make the stock', rule: 'morning_of', at: '09:00' }] });
  expect([set.status, set.json.eat_time, set.json.default_eat_time, set.json.steps.length, set.json.recipe_steps.length]).toEqual([200, '19:00', '18:00', 1, 2]);
  expect((await admin.put(`/api/prep/meals/${meal.id}`, { eat_time: 'seven' })).status).toBe(400);
  // The week page asks by the day the meals are eaten; the front page and the phone by the day each step falls due.
  const week = (await admin.get('/api/prep/coming?meals_from=2046-03-05&days=7')).json;
  expect(week.map((c: { words: string; due_day: string; due_time: string }) => [c.words, c.due_day, c.due_time]))
    .toEqual([['Thaw the chicken', '2046-03-05', '20:00'], ['Make the stock', '2046-03-06', '09:00'], ['Salt it', '2046-03-06', '16:00']]);
  const due = (await admin.get('/api/prep/coming?from=2046-03-05&days=1')).json;
  expect(due.map((c: { words: string }) => c.words)).toEqual(['Thaw the chicken']);
  // Taking the meal off the week takes its reminders with it; the recipe keeps its own.
  expect((await admin.delete(`/api/kitchen/plan/${meal.id}`)).status).toBe(204);
  expect((await admin.get('/api/prep/coming?meals_from=2046-03-05&days=7')).json).toEqual([]);
  expect((await admin.get(`/api/prep/recipes/${recipe.id}`)).json).toHaveLength(2);
  // Nobody else can read or change them.
  const other = await member(admin, 'partner');
  expect((await other.put(`/api/prep/recipes/${recipe.id}`, { steps: [] })).status).toBe(404);
  expect((await visitor().get('/api/prep/coming')).status).toBe(401);
});

it('lists of titles answer over the web: private by default, shared with the household when chosen, not owned until a copy, and in the download', async () => {
  const admin = await owner();
  const other = await member(admin, 'partner');
  const mine = (await admin.get('/api/media/lists')).json;
  expect(mine.map((l: { name: string; builtin: string | null }) => [l.name, l.builtin])).toEqual([['Wanted', 'wanted'], ['To watch, read or hear', 'to_watch']]);
  const toWatch = mine[1];
  await admin.post('/api/media', { type: 'music', title: 'Blue', wanted: true });
  expect((await admin.get(`/api/media/lists/${mine[0].id}`)).json.entries.map((e: { title: string }) => e.title)).toEqual(['Blue']);
  expect((await admin.get('/api/media')).json).toEqual([]); // Blue is wanted, not owned

  const added = await admin.post(`/api/media/lists/${toWatch.id}/titles`, { type: 'film', title: 'Stalker', year: 1979, note: 'rainy night' });
  expect([added.status, added.json.entries.map((e: { title: string; owned: boolean }) => [e.title, e.owned])]).toEqual([201, [['Stalker', false]]]);
  expect((await admin.get('/api/media')).json).toEqual([]);
  expect((await admin.get('/api/search?q=stalker')).json).toEqual([expect.objectContaining({ kind: 'title', detail: expect.stringContaining('On a list') })]);
  expect((await admin.post(`/api/media/lists/${toWatch.id}/titles`, { type: 'podcast', title: 'x' })).status).toBe(400);
  expect((await admin.post(`/api/media/lists/${toWatch.id}/titles`, { type: 'film' })).status).toBe(400);

  // Your own list, in an order you choose; the partner cannot see it until it is shared.
  const made = (await admin.post('/api/media/lists', { name: 'Rainy day' })).json;
  await admin.post(`/api/media/lists/${made.id}/titles`, { type: 'game', title: 'Ticket to Ride' });
  const two = (await admin.post(`/api/media/lists/${made.id}/titles`, { type: 'book', title: 'Dune' })).json;
  expect((await admin.post(`/api/media/lists/${made.id}/move`, { media_id: two.entries[1].media_id, way: 'up' })).json.entries.map((e: { title: string }) => e.title)).toEqual(['Dune', 'Ticket to Ride']);
  expect((await admin.post(`/api/media/lists/${made.id}/move`, { media_id: two.entries[1].media_id, way: 'sideways' })).status).toBe(400);
  expect((await other.get(`/api/media/lists/${made.id}`)).status).toBe(404);
  expect((await other.get('/api/media/lists')).json.map((l: { name: string }) => l.name)).toEqual(['Wanted', 'To watch, read or hear']);
  expect((await other.get('/api/search?q=dune')).json).toEqual([]);
  expect((await other.post(`/api/media/lists/${made.id}/titles`, { type: 'film', title: 'Sneaky' })).status).toBe(404);
  expect((await other.put(`/api/media/lists/${made.id}`, { shared: true })).status).toBe(404);
  const theirs = await splitDownload(new Uint8Array((await other.get('/api/export/everything.zip')).bytes));
  expect(JSON.stringify(theirs.files)).not.toMatch(/Dune|Rainy day|Stalker/);

  // Shared: the partner sees it and can add to it, but not change it.
  expect((await admin.put(`/api/media/lists/${made.id}`, { shared: true })).json.shared).toBe(true);
  expect((await other.get('/api/media/lists')).json.map((l: { name: string; mine: boolean }) => [l.name, l.mine])).toEqual([['Wanted', true], ['To watch, read or hear', true], ['Rainy day', false]]);
  expect((await other.post(`/api/media/lists/${made.id}/titles`, { type: 'film', title: 'Spirited Away' })).json.entries.map((e: { title: string }) => e.title)).toEqual(['Dune', 'Ticket to Ride', 'Spirited Away']);
  expect((await other.put(`/api/media/lists/${made.id}`, { name: 'Mine' })).status).toBe(403);
  expect((await other.delete(`/api/media/lists/${made.id}`)).status).toBe(403);
  expect((await other.get('/api/media')).json).toEqual([]); // nothing of it is in the partner's collection

  // The two lists everyone has stay.
  expect((await admin.put(`/api/media/lists/${toWatch.id}`, { name: 'Other' })).status).toBe(400);
  expect((await admin.delete(`/api/media/lists/${toWatch.id}`)).status).toBe(400);

  // Watching Stalker takes it off To watch. A copy makes it owned.
  const stalker = added.json.entries[0].media_id;
  await admin.post(`/api/media/${stalker}/copies`, { format: 'DVD' });
  expect((await admin.get('/api/media')).json.map((t: { title: string }) => t.title)).toEqual(['Stalker']);
  await admin.post(`/api/media/${stalker}/log`, { day: MONDAY });
  expect((await admin.get(`/api/media/lists/${toWatch.id}`)).json.entries).toEqual([]);

  // In the download, and back in on an empty Life Is.
  await admin.post(`/api/media/lists/${toWatch.id}/titles`, { type: 'book', title: 'Emma' });
  const zip = await splitDownload(new Uint8Array((await admin.get('/api/export/everything.zip', { 'X-Local-Day': MONDAY })).bytes));
  expect(zip.files['lists.csv']).toContain('Rainy day');
  const looked = (await other.post('/api/export/look', { files: zip.files })).json;
  expect(looked.kinds.find((k: { key: string }) => k.key === 'lists')).toMatchObject({ found: 4, importable: true });
  const brought = (await other.post('/api/export/bring-in', { files: zip.files, kinds: ['collection', 'lists'] })).json;
  expect(brought.kinds.every((k: { ok: boolean }) => k.ok)).toBe(true);
  const own = (await other.get('/api/media/lists')).json.filter((l: { mine: boolean }) => l.mine);
  expect(own.map((l: { name: string; count: number }) => [l.name, l.count])).toEqual([['Wanted', 1], ['To watch, read or hear', 1], ['Rainy day', 3]]);
  const again = (await other.post('/api/export/bring-in', { files: zip.files, kinds: ['collection', 'lists'] })).json;
  expect(again.kinds.map((k: { fresh: number }) => k.fresh)).toEqual([0, 0]);
});
