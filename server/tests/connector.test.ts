/** Use Life Is from your AI app: the sign-in an AI app does, the addresses it uses, and what each person sees of it. */
import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createApp } from '../src/app.ts';
import { openDatabase, type OpenDatabase } from '../src/database.ts';
import { resetDemo } from '../src/demo.ts';

const PASSWORD = 'correct-horse-battery';
const DAY = 86_400_000;
// 2046-03-05 is a Monday.
const MONDAY = new Date(2046, 2, 5, 10, 0, 0);
const REDIRECT = 'https://claude.example/callback?via=test';
let folder: string;
let database: OpenDatabase;
let server: Server;
let base: string;
let time: Date;
const errors: unknown[] = [];
const notes: string[] = [];

function visitor() {
  let session = '';
  async function ask(method: string, address: string, body?: unknown, headers: Record<string, string> = {}, raw?: string) {
    const response = await fetch(base + address, {
      method,
      headers: { ...(session ? { Cookie: session } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
    });
    const set = response.headers.get('set-cookie');
    if (set) session = set.split(';')[0]!;
    const text = await response.text();
    const type = response.headers.get('content-type') ?? '';
    return { status: response.status, json: type.startsWith('application/json') && text ? JSON.parse(text) : undefined, text, headers: response.headers };
  }
  return {
    get: (address: string, headers?: Record<string, string>) => ask('GET', address, undefined, headers),
    post: (address: string, body?: unknown, headers?: Record<string, string>) => ask('POST', address, body, headers),
    put: (address: string, body?: unknown) => ask('PUT', address, body),
    delete: (address: string) => ask('DELETE', address),
    form: (address: string, fields: Record<string, string>) => ask('POST', address, undefined, { 'Content-Type': 'application/x-www-form-urlencoded' }, new URLSearchParams(fields).toString()),
    raw: (method: string, address: string, text: string, headers: Record<string, string> = {}) => ask(method, address, undefined, headers, text),
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

const pkce = () => {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
};

/** An AI app: registers, is sent to the person, gets a code. */
async function register(app: Someone, name = 'Claude', redirects = [REDIRECT]) {
  const made = await app.post('/oauth/register', { client_name: name, redirect_uris: redirects });
  expect(made.status).toBe(201);
  return made.json.client_id as string;
}
async function allow(person: Someone, clientId: string, extra: Record<string, unknown> = {}) {
  const { verifier, challenge } = pkce();
  const answer = await person.post('/api/connector/allow', {
    client_id: clientId, redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: 'S256', state: 'abc',
    name: 'Claude on my iPad', sections: ['kitchen'], may_add: true, ...extra,
  });
  return { answer, verifier, code: answer.status === 200 ? new URL(answer.json.redirect).searchParams.get('code')! : '' };
}
async function connect(person: Someone, app: Someone, extra: Record<string, unknown> = {}) {
  const clientId = await register(app);
  const { answer, verifier, code } = await allow(person, clientId, extra);
  expect(answer.status).toBe(200);
  const tokens = await app.form('/oauth/token', { grant_type: 'authorization_code', code, code_verifier: verifier, client_id: clientId, redirect_uri: REDIRECT });
  expect(tokens.status).toBe(200);
  return { clientId, ...tokens.json } as { clientId: string; access_token: string; refresh_token: string; expires_in: number; token_type: string };
}
const rpc = (app: Someone, token: string, message: unknown) =>
  app.post('/mcp', message, { Authorization: `Bearer ${token}`, Accept: 'application/json, text/event-stream' });
const call = (app: Someone, token: string, name: string, args: unknown = {}, id = 1) =>
  rpc(app, token, { jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } });

beforeEach(async () => {
  folder = mkdtempSync(path.join(tmpdir(), 'lifeis-test-'));
  errors.length = 0;
  notes.length = 0;
  time = MONDAY;
  database = await openDatabase(path.join(folder, 'data'), path.join(folder, 'keys'));
  server = createServer(createApp({ db: database.db, clock: () => time, onError: (problem) => errors.push(problem), note: (line) => notes.push(line) }));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
  database.close();
  rmSync(folder, { recursive: true, force: true });
  expect(errors).toEqual([]);
});

it('is off for the household until the person in charge turns it on', async () => {
  const admin = await owner();
  const other = await member(admin, 'sam');
  const app = visitor();
  for (const address of ['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp', '/.well-known/oauth-authorization-server']) {
    expect((await app.get(address)).status).toBe(404);
  }
  expect((await app.post('/oauth/register', { client_name: 'Claude', redirect_uris: [REDIRECT] })).status).toBe(404);
  expect((await app.form('/oauth/token', { grant_type: 'refresh_token', refresh_token: 'x' })).status).toBe(404);
  const asking = '/api/connector/request?client_id=x&redirect_uri=y&response_type=code';
  expect((await admin.get(asking)).status).toBe(403);
  expect((await admin.post('/api/connector/allow', { client_id: 'x', redirect_uri: REDIRECT, code_challenge: 'x', code_challenge_method: 'S256' })).status).toBe(403);

  const status = await other.get('/api/connector');
  expect(status.json).toMatchObject({ household_on: false, available: true, is_admin: false, address: `${base}/mcp`, connections: [], log: [] });
  expect((await other.put('/api/connector/household', { on: true })).status).toBe(403);
  const on = await admin.put('/api/connector/household', { on: true });
  expect(on.json).toMatchObject({ household_on: true, is_admin: true });
  expect((await app.get('/.well-known/oauth-protected-resource')).status).toBe(200);
});

it('says plainly when an AI app could not reach this address', async () => {
  const admin = await owner();
  const plain = (await admin.get('/api/connector')).json.reach;
  expect(plain).toEqual({ ok: false, why: 'AI apps only connect to addresses that start with https://.' });
  const home = (await admin.get('/api/connector', { 'X-Forwarded-Proto': 'https' })).json.reach;
  expect(home).toEqual({ ok: false, why: "This Life Is is only on your home network, so an AI app on the internet can't reach it." });
  const away = await admin.get('/api/connector', { 'X-Forwarded-Proto': 'https', Host: 'life.example.org' });
  if (away.json.address.startsWith('https://life.example.org')) expect(away.json.reach).toEqual({ ok: true, why: null });
});

it('answers the sign-in documents with exactly what an AI app looks for', async () => {
  const admin = await owner();
  await admin.put('/api/connector/household', { on: true });
  const app = visitor();
  const resource = { resource: `${base}/mcp`, authorization_servers: [base], bearer_methods_supported: ['header'] };
  for (const address of ['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp']) {
    const got = await app.get(address);
    expect(got.status).toBe(200);
    expect(got.json).toEqual(resource);
    expect(got.headers.get('cache-control')).toBe('no-store');
  }
  expect((await app.get('/.well-known/oauth-authorization-server')).json).toEqual({
    issuer: base, authorization_endpoint: `${base}/connect`, token_endpoint: `${base}/oauth/token`, registration_endpoint: `${base}/oauth/register`,
    response_types_supported: ['code'], grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'], token_endpoint_auth_methods_supported: ['none'],
  });
});

it('registers an app only with good redirect addresses, and keeps its name short', async () => {
  const admin = await owner();
  await admin.put('/api/connector/household', { on: true });
  const app = visitor();
  const made = await app.post('/oauth/register', { client_name: 'C'.repeat(100), redirect_uris: [REDIRECT, 'http://localhost:6274/cb', 'http://127.0.0.1/cb'] });
  expect(made.status).toBe(201);
  expect(made.json.client_name).toHaveLength(80);
  expect(made.json.client_id).toMatch(/^lcl_/);
  expect(made.json.redirect_uris).toHaveLength(3);
  for (const bad of [['http://example.com/cb'], ['https://example.com/cb#frag'], ['ftp://example.com/cb'], ['nonsense'], [], 'https://example.com/cb',
    ['https://a.example/1', 'https://a.example/2', 'https://a.example/3', 'https://a.example/4', 'https://a.example/5', 'https://a.example/6']]) {
    const refused = await app.post('/oauth/register', { client_name: 'X', redirect_uris: bad });
    expect(refused.status).toBe(400);
    expect(refused.json.error).toBe('invalid_redirect_uri');
  }
});

it('goes the whole way: an app is allowed, gets tokens, reads, adds, refreshes, and is cut off', async () => {
  const admin = await owner();
  await admin.put('/api/connector/household', { on: true });
  const app = visitor();
  const clientId = await register(app);

  // What the approval page is shown.
  const asked = await admin.get(`/api/connector/request?client_id=${clientId}&redirect_uri=${encodeURIComponent(REDIRECT)}&response_type=code&code_challenge=${pkce().challenge}&code_challenge_method=S256&state=abc&resource=${encodeURIComponent(base + '/mcp')}`);
  expect(asked.status).toBe(200);
  expect(asked.json).toMatchObject({ app_name: 'Claude', goes_to: 'claude.example', suggested_name: 'Claude' });
  expect(asked.json.sections.map((s: { id: string }) => s.id)).toContain('kitchen');
  // An address the app didn't register, or no safe sign-in, is refused with words.
  const elsewhere = await admin.get(`/api/connector/request?client_id=${clientId}&redirect_uri=${encodeURIComponent('https://evil.example/cb')}&response_type=code&code_challenge=${pkce().challenge}&code_challenge_method=S256`);
  expect(elsewhere.status).toBe(400);
  expect((await admin.get(`/api/connector/request?client_id=${clientId}&redirect_uri=${encodeURIComponent(REDIRECT)}&response_type=code&code_challenge=${pkce().challenge}&code_challenge_method=plain`)).status).toBe(400);
  expect((await admin.post('/api/connector/deny', { client_id: clientId, redirect_uri: 'https://evil.example/cb', state: 's' })).status).toBe(400);
  const denied = await admin.post('/api/connector/deny', { client_id: clientId, redirect_uri: REDIRECT, state: 's1' });
  const goBack = new URL(denied.json.redirect);
  expect(goBack.searchParams.get('error')).toBe('access_denied');
  expect(goBack.searchParams.get('state')).toBe('s1');
  expect(goBack.searchParams.get('via')).toBe('test');

  // Allowed: the redirect keeps what the address already had.
  const wrong = await allow(admin, clientId);
  expect(wrong.answer.status).toBe(200);
  const sent = new URL(wrong.answer.json.redirect);
  expect(`${sent.origin}${sent.pathname}`).toBe('https://claude.example/callback');
  expect(sent.searchParams.get('via')).toBe('test');
  expect(sent.searchParams.get('state')).toBe('abc');
  expect(wrong.code).toMatch(/^lic_[A-Za-z0-9_-]{43}$/);
  // A wrong verifier is refused, and the code is spent.
  const bad = await app.form('/oauth/token', { grant_type: 'authorization_code', code: wrong.code, code_verifier: pkce().verifier, client_id: clientId, redirect_uri: REDIRECT });
  expect(bad.status).toBe(400);
  expect(bad.json.error).toBe('invalid_grant');
  const spent = await app.form('/oauth/token', { grant_type: 'authorization_code', code: wrong.code, code_verifier: wrong.verifier, client_id: clientId, redirect_uri: REDIRECT });
  expect(spent.json.error).toBe('invalid_grant');

  // A right one works, once. (JSON is accepted too.)
  const good = await allow(admin, clientId);
  const another = await register(app);
  const crossed = await app.form('/oauth/token', { grant_type: 'authorization_code', code: good.code, code_verifier: good.verifier, client_id: another, redirect_uri: REDIRECT });
  expect(crossed.json.error).toBe('invalid_grant'); // a code belongs to the app it was made for
  const again = await allow(admin, clientId);
  const swap = await app.post('/oauth/token', { grant_type: 'authorization_code', code: again.code, code_verifier: again.verifier, client_id: clientId, redirect_uri: REDIRECT });
  expect(swap.status).toBe(200);
  expect(swap.headers.get('cache-control')).toBe('no-store');
  expect(swap.json).toMatchObject({ token_type: 'Bearer', expires_in: 3600 });
  expect(swap.json.access_token).toMatch(/^lia_[A-Za-z0-9_-]{43}$/);
  expect(swap.json.refresh_token).toMatch(/^lir_[A-Za-z0-9_-]{43}$/);
  const reuse = await app.post('/oauth/token', { grant_type: 'authorization_code', code: again.code, code_verifier: again.verifier, client_id: clientId, redirect_uri: REDIRECT });
  expect(reuse.status).toBe(400);
  expect(reuse.json.error).toBe('invalid_grant');
  expect((await app.form('/oauth/token', { grant_type: 'password' })).json.error).toBe('unsupported_grant_type');
  const { access_token: access, refresh_token: refreshToken } = swap.json as { access_token: string; refresh_token: string };

  // No token, or a wrong one: 401 with where to start.
  const header = `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource/mcp"`;
  const none = await app.post('/mcp', { jsonrpc: '2.0', id: 1, method: 'ping' });
  expect(none.status).toBe(401);
  expect(none.headers.get('www-authenticate')).toBe(header);
  const nope = await rpc(app, `lia_${'x'.repeat(43)}`, { jsonrpc: '2.0', id: 1, method: 'ping' });
  expect(nope.status).toBe(401);
  expect(nope.headers.get('www-authenticate')).toBe(header);
  expect((await app.get('/mcp')).status).toBe(405);
  expect((await app.delete('/mcp')).status).toBe(405);

  // The talk itself.
  const hello = await rpc(app, access, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'Claude', version: '1' } } });
  expect(hello.status).toBe(200);
  expect(hello.json.result).toMatchObject({ protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'Life Is' } });
  expect(typeof hello.json.result.instructions).toBe('string');
  expect((await rpc(app, access, { jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '1999-01-01' } })).json.result.protocolVersion).toBe('2025-06-18');
  const note = await rpc(app, access, { jsonrpc: '2.0', method: 'notifications/initialized' });
  expect(note.status).toBe(202);
  expect(note.text).toBe('');
  expect((await rpc(app, access, { jsonrpc: '2.0', id: 3, method: 'ping' })).json.result).toEqual({});
  expect((await rpc(app, access, { jsonrpc: '2.0', id: 4, method: 'nothing/here' })).json.error.code).toBe(-32601);
  expect((await rpc(app, access, [{ jsonrpc: '2.0', id: 5, method: 'ping' }])).json.error.code).toBe(-32600);

  const listed = (await rpc(app, access, { jsonrpc: '2.0', id: 6, method: 'tools/list' })).json.result.tools as { name: string }[];
  const names = listed.map((t) => t.name);
  expect(names).toContain('get_grocery_list');
  expect(names).toContain('add_groceries');
  expect(names).not.toContain('get_calendar');
  expect(names).not.toContain('get_spending');
  expect(names).not.toContain('add_event');

  const read = await call(app, access, 'get_grocery_list');
  expect(read.status).toBe(200);
  expect(read.json.result.isError).toBeUndefined();
  expect(read.json.result.content[0].type).toBe('text');
  const added = await call(app, access, 'add_groceries', { items: ['milk', 'eggs'] });
  expect(added.json.result.isError).toBeUndefined();
  const groceries = (await call(app, access, 'get_grocery_list')).json.result.content[0].text as string;
  expect(groceries.toLowerCase()).toContain('milk');
  const outside = await call(app, access, 'get_calendar');
  expect(outside.status).toBe(200);
  expect(outside.json.result.isError).toBe(true);
  expect(typeof outside.json.result.content[0].text).toBe('string');

  // The person sees it, with what was read and added.
  const seen = (await admin.get('/api/connector')).json;
  expect(seen.connections).toHaveLength(1);
  expect(seen.connections[0]).toMatchObject({ name: 'Claude on my iPad', app_name: 'Claude', sections: ['kitchen'], may_add: true, last_used_on: expect.stringMatching(/^2046-03-05/) });
  expect(seen.log.map((l: { kind: string }) => l.kind)).toEqual(expect.arrayContaining(['read', 'add']));

  // A refresh swaps both tokens. The old refresh token works for a minute more; a made-up one never.
  const fresh = await app.form('/oauth/token', { grant_type: 'refresh_token', refresh_token: refreshToken, client_id: clientId });
  expect(fresh.status).toBe(200);
  expect(fresh.json.refresh_token).not.toBe(refreshToken);
  expect(fresh.json.access_token).not.toBe(access);
  expect((await rpc(app, access, { jsonrpc: '2.0', id: 7, method: 'ping' })).status).toBe(401);
  expect((await rpc(app, fresh.json.access_token, { jsonrpc: '2.0', id: 7, method: 'ping' })).status).toBe(200);
  time = new Date(time.getTime() + 30_000);
  const lost = await app.form('/oauth/token', { grant_type: 'refresh_token', refresh_token: refreshToken });
  expect(lost.status).toBe(200);
  time = new Date(time.getTime() + 120_000);
  const late = await app.form('/oauth/token', { grant_type: 'refresh_token', refresh_token: refreshToken });
  expect(late.status).toBe(400);
  expect(late.json.error).toBe('invalid_grant');
  const madeUp = await app.form('/oauth/token', { grant_type: 'refresh_token', refresh_token: `lir_${'y'.repeat(43)}` });
  expect(madeUp.status).toBe(400);
  expect(madeUp.json.error).toBe('invalid_grant');
  expect((await app.form('/oauth/token', { grant_type: 'refresh_token', refresh_token: 'nonsense' })).json.error).toBe('invalid_grant');

  // Cut off: the very next call is refused, and the row stays so the log can name it.
  const live = lost.json.access_token as string;
  expect((await rpc(app, live, { jsonrpc: '2.0', id: 8, method: 'ping' })).status).toBe(200);
  const id = seen.connections[0].id as number;
  const cut = await admin.delete(`/api/connector/connections/${id}`);
  expect(cut.status).toBe(200);
  expect(cut.json.connections).toHaveLength(0);
  expect((await rpc(app, live, { jsonrpc: '2.0', id: 9, method: 'ping' })).status).toBe(401);
  expect((await app.form('/oauth/token', { grant_type: 'refresh_token', refresh_token: lost.json.refresh_token })).json.error).toBe('invalid_grant');
});

it('reads only the sections that were ticked, and adds only when the add tick is on', async () => {
  const admin = await owner();
  await admin.put('/api/connector/household', { on: true });
  const app = visitor();
  const { access_token: access } = await connect(admin, app, { sections: ['kitchen', 'calendar'], may_add: false });
  const names = ((await rpc(app, access, { jsonrpc: '2.0', id: 1, method: 'tools/list' })).json.result.tools as { name: string }[]).map((t) => t.name);
  expect(names).toContain('get_calendar');
  expect(names).not.toContain('add_groceries');
  expect(names).not.toContain('add_event');
  const refused = await call(app, access, 'add_groceries', { items: ['milk'] });
  expect(refused.json.result.isError).toBe(true);
  const nothing = await call(app, access, 'drop_everything');
  expect(nothing.json.result.isError).toBe(true);
});

it('keeps each person to their own connections', async () => {
  const admin = await owner();
  const sam = await member(admin, 'sam');
  await admin.put('/api/connector/household', { on: true });
  const first = visitor();
  const second = visitor();
  const hers = await connect(admin, first, { name: 'Owner phone' });
  await connect(sam, second, { name: 'Sam laptop' });
  await call(first, hers.access_token, 'get_grocery_list');

  const adminSees = (await admin.get('/api/connector')).json;
  const samSees = (await sam.get('/api/connector')).json;
  expect(adminSees.connections.map((c: { name: string }) => c.name)).toEqual(['Owner phone']);
  expect(samSees.connections.map((c: { name: string }) => c.name)).toEqual(['Sam laptop']);
  expect(JSON.stringify(adminSees)).not.toContain('Sam laptop');
  expect(JSON.stringify(samSees)).not.toContain('Owner phone');
  expect(samSees.log).toEqual([]);

  const theirs = adminSees.connections[0].id as number;
  expect((await sam.delete(`/api/connector/connections/${theirs}`)).status).toBeGreaterThanOrEqual(400);
  expect((await sam.put(`/api/connector/connections/${theirs}`, { name: 'Mine now' })).status).toBeGreaterThanOrEqual(400);
  expect((await rpc(first, hers.access_token, { jsonrpc: '2.0', id: 1, method: 'ping' })).status).toBe(200);
  expect((await admin.get('/api/connector')).json.connections[0].name).toBe('Owner phone');
  // The person can change their own.
  const changed = await admin.put(`/api/connector/connections/${theirs}`, { name: 'Renamed', sections: ['kitchen', 'lists'], may_add: false });
  expect(changed.json.connections[0]).toMatchObject({ name: 'Renamed', sections: ['kitchen', 'lists'], may_add: false });
});

it('stops a connection that sat unused for more than 90 days', async () => {
  const admin = await owner();
  await admin.put('/api/connector/household', { on: true });
  const app = visitor();
  const tokens = await connect(admin, app);
  time = new Date(time.getTime() + 91 * DAY);
  expect((await rpc(app, tokens.access_token, { jsonrpc: '2.0', id: 1, method: 'ping' })).status).toBe(401);
  const refreshed = await app.form('/oauth/token', { grant_type: 'refresh_token', refresh_token: tokens.refresh_token });
  expect(refreshed.status).toBe(400);
  expect(refreshed.json.error).toBe('invalid_grant');
  const row = await database.db.get<{ ended_at: string | null; access_hash: string | null; refresh_hash: string | null }>('SELECT ended_at, access_hash, refresh_hash FROM ai_connections');
  expect(row?.ended_at).not.toBeNull();
  expect(row?.access_hash).toBeNull();
  expect(row?.refresh_hash).toBeNull();
});

it('stops every connection at once when the person in charge turns it off', async () => {
  const admin = await owner();
  await admin.put('/api/connector/household', { on: true });
  const app = visitor();
  const tokens = await connect(admin, app);
  expect((await rpc(app, tokens.access_token, { jsonrpc: '2.0', id: 1, method: 'ping' })).status).toBe(200);
  expect((await admin.put('/api/connector/household', { on: false })).json.household_on).toBe(false);
  expect((await rpc(app, tokens.access_token, { jsonrpc: '2.0', id: 2, method: 'ping' })).status).toBe(404);
  expect((await app.form('/oauth/token', { grant_type: 'refresh_token', refresh_token: tokens.refresh_token })).status).toBe(404);
  expect((await app.get('/.well-known/oauth-authorization-server')).status).toBe(404);
  // Turned on again, the old connection is still ended.
  await admin.put('/api/connector/household', { on: true });
  expect((await rpc(app, tokens.access_token, { jsonrpc: '2.0', id: 3, method: 'ping' })).status).toBe(401);
});

it('limits a person to ten connections and an address to thirty registrations an hour', async () => {
  const admin = await owner();
  await admin.put('/api/connector/household', { on: true });
  const app = visitor();
  const clientId = await register(app);
  for (let n = 0; n < 10; n += 1) expect((await allow(admin, clientId)).answer.status).toBe(200);
  const eleventh = await allow(admin, clientId);
  expect(eleventh.answer.status).toBe(400);
  expect(eleventh.answer.json.detail).toMatch(/10/);
  let last = 201;
  for (let n = 0; n < 31; n += 1) last = (await app.post('/oauth/register', { client_name: 'Again', redirect_uris: [REDIRECT] })).status;
  expect(last).toBe(429);
});

it('forgets apps that were registered a month ago and never connected', async () => {
  const admin = await owner();
  await admin.put('/api/connector/household', { on: true });
  const app = visitor();
  const old = await register(app, 'Old');
  const kept = await register(app, 'Kept');
  await allow(admin, kept);
  time = new Date(time.getTime() + 31 * DAY);
  await register(app, 'New');
  const left = (await database.db.all<{ client_id: string }>('SELECT client_id FROM ai_clients')).map((r) => r.client_id);
  expect(left).not.toContain(old);
  expect(left).toContain(kept);
});

it('does nothing in the demo', async () => {
  const DEMO = { username: 'demo', password: 'demo-password-for-tests' };
  await new Promise((resolve) => server.close(resolve));
  await resetDemo(database.db, DEMO);
  await database.db.run("INSERT INTO settings (key, value) VALUES ('ai_connector', '1') ON CONFLICT(key) DO UPDATE SET value = '1'");
  server = createServer(createApp({ db: database.db, clock: () => time, demo: DEMO, onError: (problem) => errors.push(problem) }));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const guest = visitor();
  expect((await guest.post('/api/auth/login', DEMO)).status).toBe(200);
  const app = visitor();
  for (const address of ['/.well-known/oauth-protected-resource', '/.well-known/oauth-authorization-server', '/mcp']) expect((await app.get(address)).status).toBe(404);
  expect((await app.post('/oauth/register', { client_name: 'Claude', redirect_uris: [REDIRECT] })).status).toBe(404);
  expect((await app.post('/mcp', { jsonrpc: '2.0', id: 1, method: 'ping' })).status).toBe(404);
  expect((await guest.get('/api/connector')).json).toMatchObject({ available: false });
  expect((await guest.get('/api/connector/request?client_id=x&redirect_uri=y&response_type=code')).status).toBe(403);
  expect((await guest.post('/api/connector/allow', { client_id: 'x', redirect_uri: REDIRECT, code_challenge: 'x', code_challenge_method: 'S256' })).status).toBe(403);
  expect((await guest.put('/api/connector/household', { on: true })).status).toBe(403);
});

it('answers not found at the sign-in addresses Life Is does not have, and notes each step without what was sent', async () => {
  const admin = await owner();
  await admin.put('/api/connector/household', { on: true });
  const app = visitor();
  for (const address of ['/.well-known/openid-configuration', '/.well-known/oauth-authorization-server/mcp', '/register', '/authorize', '/token']) {
    expect([address, (await app.get(address)).status]).toEqual([address, 404]);
  }
  const tokens = await connect(admin, app);
  expect((await app.post('/oauth/register', { client_name: 'Claude', redirect_uris: ['http://evil.example/cb'] })).status).toBe(400);
  const all = notes.join('\n');
  expect(all).toMatch(/\[connector\] \S+ POST \/oauth\/register -> 201/);
  expect(all).toMatch(/POST \/oauth\/token -> 200/);
  expect(all).toMatch(/POST \/oauth\/register -> 400 app="[^"]*" why="invalid_redirect_uri: /);
  expect(all).toMatch(/GET \/register -> 404/);
  for (const secret of [tokens.access_token, tokens.refresh_token, 'code_challenge', 'evil.example']) expect(all).not.toContain(secret);
  expect(notes.every((line) => line.startsWith('[connector] '))).toBe(true);
});
