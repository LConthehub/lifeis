/** Personal keys and the voice addresses a key opens: who may do what, and what is refused. */
import { createHash } from 'node:crypto';
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
const ALL = ['groceries_read', 'groceries_add', 'today_read', 'meals_read', 'reminder_add'];
/** A key, made as the person would: with their password. */
async function makeKey(who: Someone, name = 'Siri on my iPhone', can = ALL) {
  const made = await who.post('/api/keys', { name, can, password: PASSWORD });
  expect(made.status).toBe(201);
  return { key: made.json.key as string, id: made.json.made.id as number };
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

it('a key is made with the password, shown once, and kept only as a hash', async () => {
  const admin = await owner();
  expect((await admin.get('/api/keys')).json).toMatchObject({ keys: [], most: 10 });
  expect((await admin.get('/api/keys')).json.actions.map((a: { id: string }) => a.id)).toEqual(ALL);
  // The password again, or nothing is made.
  expect((await admin.post('/api/keys', { name: 'Siri', can: ALL })).status).toBe(422);
  expect((await admin.post('/api/keys', { name: 'Siri', can: ALL, password: 'not-the-password' })).status).toBe(400);
  expect((await admin.post('/api/keys', { name: '  ', can: ALL, password: PASSWORD })).status).toBe(400);
  expect((await admin.post('/api/keys', { name: 'Siri', can: [], password: PASSWORD })).status).toBe(400);
  expect((await admin.post('/api/keys', { name: 'Siri', can: ['groceries_read', 'read_the_guns'], password: PASSWORD })).status).toBe(400);
  expect((await admin.get('/api/keys')).json.keys).toEqual([]);

  const made = await admin.post('/api/keys', { name: 'Siri on my iPhone', can: ['groceries_read', 'groceries_read', 'reminder_add'], password: PASSWORD });
  expect(made.status).toBe(201);
  const key: string = made.json.key;
  expect(key).toMatch(/^lik_[\w-]{43}$/);
  expect(made.json.made).toMatchObject({ name: 'Siri on my iPhone', can: ['groceries_read', 'reminder_add'], on: true, last_used_on: null, hint: key.slice(-4) });
  expect(made.json.made.says).toEqual(['Read your grocery list', 'Add a reminder to your calendar']);
  // Never again: not in the list, and not in the database in any form but a hash.
  expect(JSON.stringify((await admin.get('/api/keys')).json)).not.toContain(key);
  const rows = await database.db.all('SELECT * FROM personal_keys');
  expect(rows).toHaveLength(1);
  expect(JSON.stringify(rows)).not.toContain(key);
  expect(rows[0]!.key_hash).toBe(createHash('sha256').update(key).digest('hex'));
});

it('a key does what it is allowed to, as its person, and nothing else', async () => {
  const admin = await owner();
  const { key } = await makeKey(admin, 'Reader', ['groceries_read']);
  const adder = (await makeKey(admin, 'Adder', ['groceries_add'])).key;
  // Adding is for the key that may, and it says how many.
  expect((await admin.post('/api/voice/groceries', { text: 'milk, eggs and pie crust' }, asKey(key))).status).toBe(403);
  const added = await admin.post('/api/voice/groceries', { text: 'milk, eggs and pie crust' }, asKey(adder));
  expect([added.status, added.type, added.text]).toEqual([200, 'text/plain; charset=utf-8', "Added 3. That's 3 on the list."]);
  expect((await visitor().post('/api/voice/groceries', { text: 'milk, eggs and pie crust' }, asKey(adder))).text).toMatch(/^That was|^Those were/);
  // Reading is for the reader, and it cannot read anything else.
  const said = await visitor().get('/api/voice/groceries', asKey(key));
  expect(said.text).toMatch(/^3 things\. /);
  expect((await visitor().get('/api/voice/dinner', asKey(key))).status).toBe(403);
  expect((await visitor().get('/api/voice/today', asKey(key))).status).toBe(403);
  expect((await visitor().post('/api/voice/reminders', { text: 'x' }, asKey(key))).status).toBe(403);
  expect((await visitor().get('/api/voice/groceries', asKey(adder))).status).toBe(403);
});

it('a key reaches only the voice addresses: no pages, no records, no way to make more keys', async () => {
  const admin = await owner();
  const { key } = await makeKey(admin);
  const stranger = visitor();
  for (const address of ['/api/kitchen/groceries', '/api/home', '/api/keys', '/api/things/guns', '/api/money/entries', '/api/mail', '/api/auth/status', '/api/holidays']) {
    expect([address, (await stranger.get(address, asKey(key))).status === 401 || address === '/api/auth/status']).toEqual([address, true]);
  }
  expect((await stranger.post('/api/keys', { name: 'x', can: ALL, password: PASSWORD }, asKey(key))).status).toBe(401);
  // Voice addresses that don't exist are not there, with a key or without.
  for (const address of ['/api/voice/guns', '/api/voice/money', '/api/voice/mail', '/api/voice/gifts', '/api/voice/measures']) {
    expect([address, (await stranger.get(address, asKey(key))).status]).toEqual([address, 404]);
  }
  // A signed-in browser with no key is not a key.
  const refused = await admin.get('/api/voice/groceries');
  expect([refused.status, refused.text]).toEqual([401, "That key isn't working."]);
});

it('a turned-off or deleted key is refused at once, a wrong one without saying why', async () => {
  const admin = await owner();
  const { key, id } = await makeKey(admin);
  const ask = (k: string) => visitor().get('/api/voice/groceries', asKey(k));
  expect((await ask(key)).status).toBe(200);
  expect((await admin.put(`/api/keys/${id}`, { on: false })).json.keys[0].on).toBe(false);
  const off = await ask(key);
  const wrong = await ask('lik_' + 'A'.repeat(43));
  const nonsense = await visitor().get('/api/voice/groceries', { Authorization: 'Bearer nonsense' });
  const none = await visitor().get('/api/voice/groceries');
  expect([off.status, wrong.status, nonsense.status, none.status]).toEqual([401, 401, 401, 401]);
  expect(new Set([off.text, wrong.text, nonsense.text, none.text])).toEqual(new Set(["That key isn't working."]));
  expect((await admin.put(`/api/keys/${id}`, { on: true })).json.keys[0].on).toBe(true);
  expect((await ask(key)).status).toBe(200);
  expect((await admin.delete(`/api/keys/${id}`)).json.keys).toEqual([]);
  expect((await ask(key)).status).toBe(401);
  expect(await database.db.all('SELECT 1 FROM personal_keys')).toEqual([]);
});

it('each person has their own keys and their own list, and cannot touch another person’s key', async () => {
  const admin = await owner();
  const bob = await member(admin, 'bob');
  await admin.post('/api/kitchen/grocery', { label: 'caviar' });
  const mine = (await makeKey(admin, 'Mine', ['groceries_read'])).key;
  const theirs = await makeKey(bob, 'Bobs', ['groceries_read', 'groceries_add']);
  expect((await visitor().get('/api/voice/groceries', asKey(theirs.key))).text).toBe('Nothing on the list.');
  await visitor().post('/api/voice/groceries', { text: 'bread' }, asKey(theirs.key));
  expect((await visitor().get('/api/voice/groceries', asKey(mine))).text).toMatch(/^1 thing\. Caviar/);
  expect((await visitor().get('/api/voice/groceries', asKey(theirs.key))).text).toBe('1 thing. Bread.');
  // Another person's key can't be seen, turned off or deleted.
  expect((await admin.get('/api/keys')).json.keys.map((k: { name: string }) => k.name)).toEqual(['Mine']);
  expect((await admin.put(`/api/keys/${theirs.id}`, { on: false })).status).toBe(404);
  await admin.delete(`/api/keys/${theirs.id}`);
  expect((await visitor().get('/api/voice/groceries', asKey(theirs.key))).status).toBe(200);
  expect((await bob.get('/api/keys')).json.keys).toHaveLength(1);
});

it('the day a key was last used is kept, and nothing more about it', async () => {
  const admin = await owner();
  const { key } = await makeKey(admin);
  expect((await admin.get('/api/keys')).json.keys[0].last_used_on).toBeNull();
  await visitor().get('/api/voice/groceries', asKey(key));
  expect((await admin.get('/api/keys')).json.keys[0].last_used_on).toBe('2046-03-05');
  time = new Date(2046, 2, 9, 8, 0, 0);
  await visitor().get('/api/voice/groceries', asKey(key));
  // (Days later, the person's own sign-in has timed out, so the kept day is read from the database.)
  expect((await database.db.get<{ last_used_on: string }>('SELECT last_used_on FROM personal_keys'))!.last_used_on).toBe('2046-03-09');
});

it('a key nobody has used for a year stops working, counted from its last use or, if never used, from when it was made', async () => {
  const admin = await owner();
  const { key, id } = await makeKey(admin);
  const daysAgo = (n: number) => new Date(2046, 2, 5 - n, 12).toISOString().slice(0, 10);
  const setUsed = (last: string | null, made = '2040-01-01') =>
    database.db.run('UPDATE personal_keys SET last_used_on = ?, created_at = ? WHERE id = ?', [last, `${made}T09:00:00+00:00`, id]);
  const asked = () => visitor().get('/api/voice/groceries', asKey(key)).then((answer) => answer.status);

  await setUsed(daysAgo(364));
  expect(await asked()).toBe(200);
  await setUsed(daysAgo(366));
  expect(await asked()).toBe(401);
  await setUsed(daysAgo(365));
  expect(await asked()).toBe(401);
  await setUsed(daysAgo(1));
  expect(await asked()).toBe(200);
  // Never used: from the day it was made.
  await setUsed(null, daysAgo(364));
  expect(await asked()).toBe(200);
  await setUsed(null, daysAgo(366));
  expect(await asked()).toBe(401);
  // A stopped key is not a wrong guess: it is not counted against the address.
  expect((await database.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM login_throttle'))!.n).toBe(0);
});

it('each key shows the day it would stop', async () => {
  const admin = await owner();
  const { id } = await makeKey(admin);
  expect((await admin.get('/api/keys')).json.keys[0].stops_on).toBe('2047-03-05');
  await database.db.run('UPDATE personal_keys SET last_used_on = ? WHERE id = ?', ['2046-03-01', id]);
  expect((await admin.get('/api/keys')).json.keys[0].stops_on).toBe('2047-03-01');
});

it('adding a reminder, today and the week speak plainly', async () => {
  const admin = await owner();
  const { key } = await makeKey(admin);
  const them = visitor();
  expect((await them.post('/api/voice/reminders', { text: 'Call the dentist', when: 'tomorrow at 3pm' }, asKey(key))).text).toBe('Reminder added for tomorrow at 3 PM: Call the dentist.');
  expect((await them.post('/api/voice/reminders', { text: 'Call the dentist', when: 'when the cows come home' }, asKey(key))).status).toBe(400);
  expect((await them.post('/api/voice/reminders', {}, asKey(key))).status).toBe(422);
  expect((await them.get('/api/voice/today', asKey(key))).text).toBe('Nothing on today.');
  await admin.post('/api/calendar/events', { title: 'Dentist', day: '2046-03-05', time: '09:00' });
  expect((await them.get('/api/voice/today', asKey(key))).text).toBe('On today: Dentist at 9 AM.');
  expect((await them.get('/api/voice/dinner', asKey(key))).text).toBe('Nothing planned for dinner.');
  expect((await them.get('/api/voice/week', asKey(key))).text).toBe('Nothing planned for the week.');
  expect((await them.get('/api/voice/groceries?store=Costco', asKey(key))).text).toBe('Nothing to buy at Costco.');
});

it('wrong keys are slowed down by address, and one key is held to sixty a minute', async () => {
  const admin = await owner();
  const { key } = await makeKey(admin);
  const them = visitor();
  for (let i = 0; i < 59; i += 1) expect((await them.get('/api/voice/groceries', asKey(key))).status).toBe(200);
  expect((await them.get('/api/voice/groceries', asKey(key))).status).toBe(200);
  const slow = await them.get('/api/voice/groceries', asKey(key));
  expect([slow.status, slow.text]).toEqual([429, 'That key is being used too fast. Wait a minute.']);
  time = new Date(time.getTime() + 61_000);
  expect((await them.get('/api/voice/groceries', asKey(key))).status).toBe(200);
  // Guessing: twenty wrong keys, then even the right one waits.
  time = new Date(time.getTime() + 3_600_000);
  const wrong = 'lik_' + 'B'.repeat(43);
  for (let i = 0; i < 20; i += 1) expect((await them.get('/api/voice/groceries', asKey(wrong))).status).toBe(401);
  const locked = await them.get('/api/voice/groceries', asKey(key));
  expect(locked.status).toBe(429);
  expect(locked.text).toMatch(/Try again in \d+ seconds/);
});
