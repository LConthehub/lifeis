/**
 * Reading bank accounts through SimpleFIN over the web addresses, against a fake fetch (nothing reaches a real
 * network). The point of these: the access address is locked in the database and appears in no answer and no download.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { splitDownload, type Fetcher } from '../../core/src/index.ts';
import { createApp } from '../src/app.ts';
import { openDatabase, type OpenDatabase } from '../src/database.ts';
import { vault } from '../src/vault.ts';

const PASSWORD = 'correct-horse-battery';
const PASS = 'a-very-private-bank-password';
const TOKEN = Buffer.from('https://bridge.example.org/simplefin/claim/ONE-TIME').toString('base64');
const ACCESS = `https://bankuser:${PASS}@bridge.example.org/simplefin`;
const WHEN = Math.floor(Date.UTC(2046, 2, 3, 12) / 1000);
let folder: string;
let database: OpenDatabase;
let server: Server;
let base: string;
let asked: { url: string; auth: string | undefined; method: string }[];
let claimed: number;

const fake: Fetcher = async (url, headers, send) => {
  asked.push({ url, auth: headers.Authorization, method: send?.method ?? 'GET' });
  const answer = (status: number, body: unknown) => ({ status, type: 'application/json', json: async () => body, bytes: async () => new TextEncoder().encode(typeof body === 'string' ? body : JSON.stringify(body)) });
  if (send?.method === 'POST') { claimed += 1; return claimed === 1 ? answer(200, ACCESS) : answer(403, 'used'); }
  return answer(200, {
    errors: ['Example Credit Union needs you to sign in again'],
    accounts: [{ id: 'A1', name: 'Checking', currency: 'USD', balance: '100.00', org: { name: 'Example Credit Union' }, transactions: [
      { id: 'T1', posted: WHEN, amount: '-12.30', description: 'Corner Store' }, { id: 'T2', posted: WHEN, amount: '500.00', description: 'Pay' }, { id: 'T3', posted: WHEN, amount: '-1.00', description: 'Pending', pending: true }] }],
  });
};

function visitor() {
  let session = '';
  async function ask(method: string, address: string, body?: unknown, headers: Record<string, string> = {}) {
    const response = await fetch(base + address, {
      method, headers: { ...(session ? { Cookie: session } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = response.headers.get('set-cookie');
    if (set) session = set.split(';')[0]!;
    const bytes = Buffer.from(await response.arrayBuffer());
    const text = bytes.toString('utf8');
    return { status: response.status, text, bytes, json: response.headers.get('content-type')?.startsWith('application/json') ? JSON.parse(text) : undefined };
  }
  return { get: (a: string, h?: Record<string, string>) => ask('GET', a, undefined, h), post: (a: string, b?: unknown) => ask('POST', a, b), put: (a: string, b?: unknown) => ask('PUT', a, b), delete: (a: string) => ask('DELETE', a) };
}

async function start(withBank: boolean) {
  const keys = path.join(folder, 'keys');
  server = createServer(createApp({
    db: database.db, reach: { fetcher: fake, sealer: vault(keys, 'media_source') },
    ...(withBank ? { bank: { fetcher: fake, sealer: vault(keys, 'simplefin_access') } } : {}),
    clock: () => new Date(Date.UTC(2046, 2, 5, 15)),
  }));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const admin = visitor();
  expect((await admin.post('/api/auth/setup', { username: 'owner', password: PASSWORD })).status).toBe(201);
  return admin;
}

beforeEach(async () => {
  asked = []; claimed = 0;
  folder = mkdtempSync(path.join(tmpdir(), 'lifeis-test-'));
  database = await openDatabase(path.join(folder, 'data'), path.join(folder, 'keys'));
});
afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
  database.close();
  rmSync(folder, { recursive: true, force: true });
});

it('is off until turned on, says what it sends, and asks nothing while off', async () => {
  const admin = await start(true);
  const off = (await admin.get('/api/money/simplefin')).json;
  expect([off.available, off.on, off.connection, off.accounts]).toEqual([true, false, null, []]);
  expect(off.service.sends).toMatch(/Nothing from Life Is is sent to it/);
  expect(JSON.stringify(off)).not.toMatch(/\$|per month|price/i);
  expect((await admin.post('/api/money/simplefin/connect', { token: TOKEN })).status).toBe(400);
  expect((await admin.post('/api/money/simplefin/read', {})).status).toBe(400);
  expect(asked).toEqual([]);
  expect((await visitor().get('/api/money/simplefin')).status).toBe(401);
  expect((await admin.put('/api/money/simplefin', { on: 'yes' })).status).toBe(422);
});

it('cannot be turned on in a copy of Life Is that cannot reach outside', async () => {
  const admin = await start(false);
  expect((await admin.get('/api/money/simplefin')).json.available).toBe(false);
  expect((await admin.put('/api/money/simplefin', { on: true })).status).toBe(400);
});

it('connects, chooses, reads and disconnects, and the access address is in no answer and no download', async () => {
  const admin = await start(true);
  const seen: string[] = [];
  const keep = <T extends { text: string }>(r: T): T => { seen.push(r.text); return r; };
  expect(keep(await admin.put('/api/money/simplefin', { on: true })).status).toBe(200);
  expect(keep(await admin.post('/api/money/simplefin/connect', { token: 'not a token' })).status).toBe(400);
  expect(keep(await admin.post('/api/money/simplefin/connect', { token: Buffer.from('https://127.0.0.1/claim/x').toString('base64') })).status).toBe(400);
  expect(asked).toEqual([]);
  const connected = keep(await admin.post('/api/money/simplefin/connect', { token: TOKEN }));
  expect(connected.status).toBe(201);
  expect(connected.json.connection).toEqual({ host: 'bridge.example.org', connected_at: expect.any(String), last_read_at: null });
  expect(connected.json.accounts.map((a: { name: string; org: string }) => [a.name, a.org])).toEqual([['Checking', 'Example Credit Union']]);
  // A second claim of the same token is refused by SimpleFIN, and nothing changes.
  expect(keep(await admin.post('/api/money/simplefin/connect', { token: TOKEN })).status).toBe(409);

  const category = (await admin.post('/api/money/categories', { name: 'Everyday', monthly_cents: 50000 })).json.id;
  const id = connected.json.accounts[0].id;
  expect(keep(await admin.put('/api/money/simplefin/accounts', { accounts: [{ id, chosen: true, category_id: category }] })).json.accounts[0]).toMatchObject({ chosen: true, category_id: category });
  expect((await admin.put('/api/money/simplefin/accounts', { accounts: [{ id: 99999, chosen: true }] })).status).toBe(404);
  expect((await admin.put('/api/money/simplefin/accounts', { accounts: [{ chosen: true }] })).status).toBe(422);

  const read = keep(await admin.post('/api/money/simplefin/read', { from_day: '2046-03-01' }));
  expect([read.status, read.json.added, read.json.already, read.json.left_out, read.json.money_in, read.json.pending]).toEqual([200, 1, 0, 2, 1, 1]);
  expect(read.json.errors).toEqual(['Example Credit Union needs you to sign in again']);
  expect(keep(await admin.post('/api/money/simplefin/read', { from_day: '2046-03-01' })).json).toMatchObject({ added: 0, already: 1 });
  const month = (await admin.get('/api/money?month=2046-03')).json;
  expect(month.entries.map((e: { label: string; cents: number; day: string; category: string }) => [e.label, e.cents, e.day, e.category])).toEqual([['Corner Store', 1230, '2046-03-03', 'Everyday']]);
  expect(keep(await admin.post('/api/money/simplefin/read', { from_day: '2000-01-01' })).status).toBe(400);

  // Every request after the claim signed in with a header, and none carried the password in its address.
  const reads = asked.filter((a) => a.method === 'GET');
  expect(reads.length).toBeGreaterThanOrEqual(3);
  for (const r of reads) {
    expect(r.url).not.toContain(PASS);
    expect(r.url).not.toContain('@');
    expect(r.auth).toBe(`Basic ${Buffer.from(`bankuser:${PASS}`).toString('base64')}`);
  }
  expect(asked.filter((a) => a.method === 'POST').map((a) => a.url)).toEqual(['https://bridge.example.org/simplefin/claim/ONE-TIME']); // claimed once; the second try never left

  // Locked in the database, and nowhere a page or a download can see it.
  const sealed = await database.db.get<{ access: string }>('SELECT access FROM simplefin_connections');
  expect(sealed!.access.startsWith('sealed:v1:')).toBe(true);
  expect(sealed!.access).not.toContain(PASS);
  const everything = await admin.get('/api/export/everything.zip');
  expect(everything.status).toBe(200);
  const unzipped = await splitDownload(new Uint8Array(everything.bytes));
  const all = JSON.stringify(unzipped.files);
  expect(all).toContain('Corner Store');
  for (const secret of [PASS, 'bankuser', 'ONE-TIME', sealed!.access, 'sealed:v1', 'bridge.example.org']) {
    expect(all, secret).not.toContain(secret);
    expect(everything.bytes.toString('latin1'), secret).not.toContain(secret);
  }
  // No answer to the pages carried the password, the user, the token's own part or the sealed text (the host name is shown on purpose).
  for (const secret of [PASS, 'bankuser', 'ONE-TIME', sealed!.access, 'sealed:v1']) for (const text of seen) expect(text, secret).not.toContain(secret);
  for (const text of [(await admin.get('/api/money/simplefin')).text, (await admin.get('/api/money?month=2046-03')).text, (await admin.get('/api/lookups')).text]) {
    for (const secret of [PASS, 'bankuser', 'ONE-TIME', 'sealed:v1']) expect(text).not.toContain(secret);
  }

  // Disconnecting forgets the address and the accounts, and keeps the spending.
  const gone = (await admin.delete('/api/money/simplefin')).json;
  expect([gone.connection, gone.accounts]).toEqual([null, []]);
  expect(await database.db.get('SELECT 1 AS x FROM simplefin_connections')).toBeUndefined();
  expect((await admin.get('/api/money?month=2046-03')).json.entries).toHaveLength(1);
});

it('is covered by the trial like the rest of spending', async () => {
  const { isPaidPath } = await import('../../core/src/access.ts');
  for (const p of ['/api/money/simplefin', '/api/money/simplefin/connect', '/api/money/simplefin/read', '/api/money/simplefin/accounts']) expect(isPaidPath(p), p).toBe(true);
});

it('keeps each person\'s connection to themselves', async () => {
  const admin = await start(true);
  await admin.put('/api/money/simplefin', { on: true });
  await admin.post('/api/money/simplefin/connect', { token: TOKEN });
  const made = await admin.post('/api/auth/people', { username: 'partner', password: PASSWORD });
  if (made.status === 201 || made.status === 200) {
    const partner = visitor();
    await partner.post('/api/auth/login', { username: 'partner', password: PASSWORD });
    expect((await partner.get('/api/money/simplefin')).json.connection).toBeNull();
  }
});
