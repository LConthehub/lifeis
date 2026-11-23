/**
 * Two-step sign-in and passkeys, asked the way the pages ask: over HTTP. Each test gets its own throwaway data
 * folder and server, and a clock the test moves.
 *
 * The authenticator app and the passkey device are written here from scratch, with Node's crypto, so the checks
 * don't just agree with the code they check.
 */
import { createHash, createHmac, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createApp } from '../src/app.ts';
import { openDatabase, type OpenDatabase } from '../src/database.ts';
import { totpCode } from '../src/secondStep.ts';
import { vault } from '../src/vault.ts';

const PASSWORD = 'correct-horse-battery';
const START = new Date('2046-03-05T10:00:30Z');

let folder: string;
let database: OpenDatabase;
let server: Server;
let base: string;
let time: Date;
const errors: unknown[] = [];
const advance = (seconds: number) => { time = new Date(time.getTime() + seconds * 1000); };

/** Someone using Life Is: remembers their session cookie between requests, as a browser does. */
function visitor(address = () => base) {
  let session = '';
  async function ask(method: string, url: string, body?: unknown, headers: Record<string, string> = {}) {
    const response = await fetch(address() + url, {
      method,
      headers: { ...(session ? { Cookie: session } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = response.headers.get('set-cookie');
    if (set) session = set.split(';')[0]!;
    const text = await response.text();
    const json = response.headers.get('content-type') === 'application/json' ? JSON.parse(text) : undefined;
    return { status: response.status, json, text, cookie: set };
  }
  return {
    get: (url: string, headers?: Record<string, string>) => ask('GET', url, undefined, headers),
    post: (url: string, body?: unknown, headers?: Record<string, string>) => ask('POST', url, body, headers),
    put: (url: string, body?: unknown) => ask('PUT', url, body),
    delete: (url: string) => ask('DELETE', url),
    forget: () => { session = ''; },
    cookieValue: () => session,
  };
}
type Visitor = ReturnType<typeof visitor>;

async function start(options: Record<string, unknown> = {}) {
  database = await openDatabase(path.join(folder, 'data'), path.join(folder, 'keys'));
  server = createServer(createApp({ db: database.db, clock: () => time, onError: (problem) => errors.push(problem), sealer: vault(path.join(folder, 'keys'), 'second_step'), ...options }));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  // "localhost" rather than the number: passkeys are tied to a name.
  base = `http://localhost:${(server.address() as AddressInfo).port}`;
}

beforeEach(async () => {
  folder = mkdtempSync(path.join(tmpdir(), 'lifeis-security-'));
  time = START;
  errors.length = 0;
  await start();
});

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
  database.close();
  rmSync(folder, { recursive: true, force: true });
  expect(errors).toEqual([]);
});

async function owner() {
  const admin = visitor();
  expect((await admin.post('/api/auth/setup', { username: 'Owner', password: PASSWORD })).status).toBe(201);
  return admin;
}

async function signedInAs(username: string) {
  const someone = visitor();
  expect((await someone.post('/api/auth/login', { username, password: PASSWORD })).status).toBe(200);
  return someone;
}

async function member(admin: Visitor, username: string) {
  expect((await admin.post('/api/users', { username, password: PASSWORD })).status).toBe(201);
  return signedInAs(username);
}

// ---------- an authenticator app, written from scratch ----------

function base32Decode(text: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const ch of text.replace(/\s/g, '').toUpperCase()) bits += alphabet.indexOf(ch).toString(2).padStart(5, '0');
  const bytes: number[] = [];
  for (let at = 0; at + 8 <= bits.length; at += 8) bytes.push(parseInt(bits.slice(at, at + 8), 2));
  return Buffer.from(bytes);
}

/** RFC 4226 (HOTP) as written in the RFC, for RFC 6238's time steps. */
function hotp(key: Buffer, counter: number, digits: number): string {
  const message = Buffer.alloc(8);
  message.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  message.writeUInt32BE(counter >>> 0, 4);
  const hash = createHmac('sha1', key).update(message).digest();
  const offset = hash[19]! & 0xf;
  const number = ((hash[offset]! & 0x7f) << 24) | (hash[offset + 1]! << 16) | (hash[offset + 2]! << 8) | hash[offset + 3]!;
  return String(number % 10 ** digits).padStart(digits, '0');
}

/** What the app shows `steps` steps from now (negative: older), given the secret as typed (in groups of four). */
const codeFor = (secret: string, steps = 0) => hotp(base32Decode(secret), Math.floor(time.getTime() / 1000 / 30) + steps, 6);

it('the codes agree with the examples in RFC 6238 (SHA-1, 30 seconds)', () => {
  const key = Buffer.from('12345678901234567890');
  for (const [seconds, eight] of [[59, '94287082'], [1111111109, '07081804'], [1111111111, '14050471'], [1234567890, '89005924'], [2000000000, '69279037'], [20000000000, '65353130']] as const) {
    expect(hotp(key, Math.floor(seconds / 30), 8)).toBe(eight); // the test's own generator
    expect(totpCode(key, Math.floor(seconds / 30))).toBe(eight.slice(2)); // Life Is's, six digits
  }
});

/** Two-step turned on for someone signed in. Returns what the app was given and the recovery codes. */
async function turnOn(who: Visitor) {
  const started = await who.post('/api/security/second-step/start', { password: PASSWORD });
  expect(started.status).toBe(200);
  const done = await who.post('/api/security/second-step/confirm', { setup: started.json.setup, code: codeFor(started.json.secret) });
  expect(done.status).toBe(200);
  return { secret: started.json.secret as string, codes: done.json.recovery_codes as string[], uri: started.json.uri as string };
}

/** The next code the app will show: time moves on, so a code is never one already used. */
const next = (secret: string) => { advance(30); return codeFor(secret); };

async function firstStep(username = 'owner') {
  const stranger = visitor();
  const asked = await stranger.post('/api/auth/login', { username, password: PASSWORD });
  return { stranger, asked };
}

// ---------- turning two-step on ----------

it('turning two-step on needs the password and a right code, and the secret is only ever sent once', async () => {
  const admin = await owner();
  expect((await admin.post('/api/security/second-step/start', { password: 'not it, not it, not it' })).status).toBe(400);
  expect((await admin.post('/api/security/second-step/start', {})).status).toBe(422);
  expect((await admin.get('/api/security')).json.second_step).toEqual({ on: false, recovery_left: 0 });

  const started = await admin.post('/api/security/second-step/start', { password: PASSWORD });
  const secret = String(started.json.secret).replace(/\s/g, '');
  expect(secret).toMatch(/^[A-Z2-7]{32}$/);
  expect(started.json.uri).toBe(`otpauth://totp/Life%20Is:owner?secret=${secret}&issuer=Life%20Is&algorithm=SHA1&digits=6&period=30`);

  // Not on yet: a wrong code, a made-up setup, and someone else's setup all fail, and sign-in is unchanged.
  expect((await admin.post('/api/security/second-step/confirm', { setup: started.json.setup, code: '000000' })).status).toBe(400);
  expect((await admin.post('/api/security/second-step/confirm', { setup: 'made-up', code: codeFor(started.json.secret) })).status).toBe(400);
  expect((await admin.get('/api/security')).json.second_step.on).toBe(false);
  expect((await visitor().post('/api/auth/login', { username: 'owner', password: PASSWORD })).json).toEqual({ id: 1, username: 'owner', name: 'owner', is_admin: true });

  const done = await admin.post('/api/security/second-step/confirm', { setup: started.json.setup, code: codeFor(started.json.secret) });
  expect(done.status).toBe(200);
  expect(done.json.recovery_codes).toHaveLength(10);
  for (const code of done.json.recovery_codes) expect(code).toMatch(/^[a-hj-km-np-z2-9]{5}-[a-hj-km-np-z2-9]{5}$/);
  expect(new Set(done.json.recovery_codes).size).toBe(10);
  // The same setup can't be used again.
  expect((await admin.post('/api/security/second-step/confirm', { setup: started.json.setup, code: codeFor(started.json.secret, 1) })).status).toBe(400);
  expect((await admin.post('/api/security/second-step/start', { password: PASSWORD })).status).toBe(409);

  // What is kept: the secret locked, the recovery codes only as hashes. And nothing later says the secret.
  const kept = await database.db.all('SELECT * FROM user_security');
  expect(String(kept[0]!.totp_secret)).toMatch(/^sealed:v1:/);
  const everything = JSON.stringify([kept, await database.db.all('SELECT * FROM recovery_codes'), await database.db.all('SELECT * FROM auth_challenges')]);
  expect(everything).not.toContain(secret);
  for (const code of done.json.recovery_codes) expect(everything).not.toContain(code.replace('-', ''));
  expect((await database.db.all<{ code_hash: string }>('SELECT code_hash FROM recovery_codes')).every((r) => r.code_hash.startsWith('scrypt$'))).toBe(true);
  const later = [(await admin.get('/api/security')).text, (await firstStep()).asked.text, (await admin.get('/api/auth/status')).text];
  for (const text of later) expect(text).not.toContain(secret);
  expect((await admin.get('/api/security')).json.second_step).toEqual({ on: true, recovery_left: 10 });
});

it('a person with two-step on gets no session from the password alone', async () => {
  const admin = await owner();
  const { secret } = await turnOn(admin);
  const { stranger, asked } = await firstStep();
  expect(asked.status).toBe(200);
  expect(asked.cookie).toBeNull();
  expect(asked.json).toEqual({ second_step: true, pending: expect.any(String), passkey: false, expires_in: 300 });
  // The pending token opens nothing: not as the session cookie, and not in place of a code.
  expect((await stranger.get('/api/kitchen/recipes')).status).toBe(401);
  const pretend = await fetch(`${base}/api/kitchen/recipes`, { headers: { Cookie: `lifeis_session=${asked.json.pending}` } });
  expect(pretend.status).toBe(401);
  expect((await stranger.post('/api/auth/second-step', { pending: asked.json.pending, code: '123456' })).status).toBe(401);
  expect((await stranger.get('/api/kitchen/recipes')).status).toBe(401);

  const done = await stranger.post('/api/auth/second-step', { pending: asked.json.pending, code: next(secret) });
  expect([done.status, done.json]).toEqual([200, { id: 1, username: 'owner', name: 'owner', is_admin: true }]);
  expect(done.cookie).toMatch(/^lifeis_session=/);
  expect((await stranger.get('/api/kitchen/recipes')).status).toBe(200);
  // A wrong password still looks just as it did.
  expect((await visitor().post('/api/auth/login', { username: 'owner', password: 'wrong wrong wrong' })).json).toEqual({ detail: 'Wrong username or password' });
});

it('the pending sign-in runs out after five minutes, works once, and belongs to one person', async () => {
  const admin = await owner();
  const mine = await turnOn(admin);
  const other = await member(admin, 'partner');
  const theirs = await turnOn(other);

  const slow = await firstStep();
  advance(5 * 60 + 1);
  const late = await slow.stranger.post('/api/auth/second-step', { pending: slow.asked.json.pending, code: codeFor(mine.secret) });
  expect([late.status, late.json.detail]).toEqual([400, 'That sign-in took too long. Sign in again.']);

  const once = await firstStep();
  expect((await once.stranger.post('/api/auth/second-step', { pending: once.asked.json.pending, code: next(mine.secret) })).status).toBe(200);
  expect((await visitor().post('/api/auth/second-step', { pending: once.asked.json.pending, code: next(mine.secret) })).status).toBe(400);

  // Somebody else's pending token and the right code for the other account: not accepted either way.
  const a = await firstStep('owner');
  const b = await firstStep('partner');
  advance(30);
  expect((await visitor().post('/api/auth/second-step', { pending: a.asked.json.pending, code: codeFor(theirs.secret) })).status).toBe(401);
  expect((await visitor().post('/api/auth/second-step', { pending: b.asked.json.pending, code: codeFor(mine.secret) })).status).toBe(401);
  const right = await visitor().post('/api/auth/second-step', { pending: b.asked.json.pending, code: codeFor(theirs.secret) });
  expect([right.status, right.json.username]).toEqual([200, 'partner']);
  // Made up, or not even text.
  expect((await visitor().post('/api/auth/second-step', { pending: 'x'.repeat(43), code: '123456' })).status).toBe(400);
  expect((await visitor().post('/api/auth/second-step', { pending: 5, code: '123456' })).status).toBe(422);
});

it('a code works once, one step old still works, and two steps old does not', async () => {
  const admin = await owner();
  const { secret } = await turnOn(admin);
  // Setup used this step. A little later, a code one step old is still good (clocks differ a little).
  advance(30);
  const a = await firstStep();
  expect((await a.stranger.post('/api/auth/second-step', { pending: a.asked.json.pending, code: codeFor(secret, 1) })).status).toBe(200); // a step ahead
  // …and that one is spent: the same code, and anything older, are refused.
  const b = await firstStep();
  expect((await b.stranger.post('/api/auth/second-step', { pending: b.asked.json.pending, code: codeFor(secret, 1) })).status).toBe(401);
  expect((await b.stranger.post('/api/auth/second-step', { pending: b.asked.json.pending, code: codeFor(secret, 0) })).status).toBe(401);
  // A step behind works after time moves on.
  advance(90);
  const c = await firstStep();
  expect((await c.stranger.post('/api/auth/second-step', { pending: c.asked.json.pending, code: codeFor(secret, -1) })).status).toBe(200);
  // Two steps behind does not.
  advance(120);
  const d = await firstStep();
  expect((await d.stranger.post('/api/auth/second-step', { pending: d.asked.json.pending, code: codeFor(secret, -2) })).status).toBe(401);
  expect((await d.stranger.post('/api/auth/second-step', { pending: d.asked.json.pending, code: codeFor(secret, 0) })).status).toBe(200);
  // Not six digits.
  const e = await firstStep();
  for (const code of ['', '12345', '1234567', 'abcdef']) expect((await e.stranger.post('/api/auth/second-step', { pending: e.asked.json.pending, code })).status).toBe(401);
});

it('a recovery code works once, however it is typed', async () => {
  const admin = await owner();
  const { codes } = await turnOn(admin);
  const a = await firstStep();
  const typed = codes[0]!.toUpperCase();
  const done = await a.stranger.post('/api/auth/second-step', { pending: a.asked.json.pending, code: typed });
  expect(done.status).toBe(200);
  expect((await admin.get('/api/security')).json.second_step.recovery_left).toBe(9);
  const b = await firstStep();
  expect((await b.stranger.post('/api/auth/second-step', { pending: b.asked.json.pending, code: codes[0] })).status).toBe(401);
  expect((await b.stranger.post('/api/auth/second-step', { pending: b.asked.json.pending, code: codes[1]!.replace('-', ' ') })).status).toBe(200);
  // One person's recovery code is no use for another.
  const other = await member(admin, 'partner');
  await turnOn(other);
  const c = await firstStep('partner');
  expect((await c.stranger.post('/api/auth/second-step', { pending: c.asked.json.pending, code: codes[2] })).status).toBe(401);
});

it('wrong codes are counted like wrong passwords, and signing in again does not clear them', async () => {
  const admin = await owner();
  const { secret } = await turnOn(admin);
  let one = await firstStep();
  for (let i = 0; i < 3; i += 1) expect((await one.stranger.post('/api/auth/second-step', { pending: one.asked.json.pending, code: '000000' })).status).toBe(401);
  // A right password again does not forget those three.
  one = await firstStep();
  expect((await one.stranger.post('/api/auth/second-step', { pending: one.asked.json.pending, code: '000000' })).status).toBe(401);
  const fifth = await one.stranger.post('/api/auth/second-step', { pending: one.asked.json.pending, code: '000000' });
  expect(fifth.status).toBe(401);
  // Five wrong: the pair is locked, so even the right password and the right code are held back for a moment…
  const held = await visitor().post('/api/auth/login', { username: 'owner', password: PASSWORD });
  expect([held.status, held.json.detail]).toEqual([429, 'Too many failed attempts. Try again in 2 seconds.']);
  expect((await one.stranger.post('/api/auth/second-step', { pending: one.asked.json.pending, code: codeFor(secret, 1) })).status).toBe(429);
  // …until the wait is over.
  advance(3);
  const after = await firstStep();
  expect((await after.stranger.post('/api/auth/second-step', { pending: after.asked.json.pending, code: codeFor(secret, 1) })).status).toBe(200);
  // Five wrong tries on one pending sign-in end it, even for the right code.
  advance(30);
  const doomed = await firstStep();
  const answers: number[] = [];
  for (let i = 0; i < 5; i += 1) { answers.push((await doomed.stranger.post('/api/auth/second-step', { pending: doomed.asked.json.pending, code: '111111' })).status); }
  expect(answers).toEqual([401, 401, 401, 401, 401]);
  advance(60);
  expect((await doomed.stranger.post('/api/auth/second-step', { pending: doomed.asked.json.pending, code: codeFor(secret, 1) })).status).toBe(400);
});

it('a stranger guessing codes at someone else is held back by address too', async () => {
  const admin = await owner();
  await turnOn(admin);
  // Twenty bad pending tokens from one address: then that address is held back.
  const guesser = visitor();
  for (let i = 0; i < 20; i += 1) expect((await guesser.post('/api/auth/second-step', { pending: randomBytes(32).toString('base64url'), code: '123456' })).status).toBe(400);
  expect((await guesser.post('/api/auth/second-step', { pending: randomBytes(32).toString('base64url'), code: '123456' })).status).toBe(429);
});

// ---------- turning it off, and changing things ----------

it('turning two-step off needs the password and a code, and takes the secret and recovery codes with it', async () => {
  const admin = await owner();
  const { secret, codes } = await turnOn(admin);
  expect((await admin.post('/api/security/second-step/off', { password: 'not it, not it, not it', code: next(secret) })).status).toBe(400);
  expect((await admin.post('/api/security/second-step/off', { password: PASSWORD, code: '000000' })).status).toBe(400);
  expect((await admin.post('/api/security/second-step/off', { password: PASSWORD })).status).toBe(422);
  expect((await admin.get('/api/security')).json.second_step.on).toBe(true);
  // A recovery code does it too.
  expect((await admin.post('/api/security/second-step/off', { password: PASSWORD, code: codes[3] })).status).toBe(204);
  expect((await admin.get('/api/security')).json.second_step).toEqual({ on: false, recovery_left: 0 });
  expect((await database.db.get<{ totp_secret: string | null }>('SELECT totp_secret FROM user_security'))!.totp_secret).toBeNull();
  expect((await database.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM recovery_codes'))!.n).toBe(0);
  expect((await visitor().post('/api/auth/login', { username: 'owner', password: PASSWORD })).json).toEqual({ id: 1, username: 'owner', name: 'owner', is_admin: true });
  expect((await admin.post('/api/security/second-step/off', { password: PASSWORD, code: '000000' })).status).toBe(409);
});

it('new recovery codes need the password, and replace the old ones', async () => {
  const admin = await owner();
  expect((await admin.post('/api/security/recovery-codes', { password: PASSWORD })).status).toBe(409);
  const { codes } = await turnOn(admin);
  expect((await admin.post('/api/security/recovery-codes', { password: 'not it, not it, not it' })).status).toBe(400);
  const made = await admin.post('/api/security/recovery-codes', { password: PASSWORD });
  expect(made.json.recovery_codes).toHaveLength(10);
  expect(made.json.recovery_codes).not.toContain(codes[0]);
  const a = await firstStep();
  expect((await a.stranger.post('/api/auth/second-step', { pending: a.asked.json.pending, code: codes[0] })).status).toBe(401);
  const b = await firstStep();
  expect((await b.stranger.post('/api/auth/second-step', { pending: b.asked.json.pending, code: made.json.recovery_codes[0] })).status).toBe(200);
});

it('turning two-step on or off, and changing the password, sign out the other sessions', async () => {
  const admin = await owner();
  const phone = await signedInAs('owner');
  expect((await phone.get('/api/kitchen/recipes')).status).toBe(200);
  const { secret } = await turnOn(admin);
  expect((await phone.get('/api/kitchen/recipes')).status).toBe(401);
  expect((await admin.get('/api/kitchen/recipes')).status).toBe(200);

  const again = await firstStep();
  expect((await again.stranger.post('/api/auth/second-step', { pending: again.asked.json.pending, code: next(secret) })).status).toBe(200);
  expect((await admin.post('/api/security/second-step/off', { password: PASSWORD, code: next(secret) })).status).toBe(204);
  expect((await again.stranger.get('/api/kitchen/recipes')).status).toBe(401);
  expect((await admin.get('/api/kitchen/recipes')).status).toBe(200);

  const tablet = await signedInAs('owner');
  expect((await admin.post('/api/auth/change-password', { current_password: PASSWORD, new_password: 'a-new-password-for-owner' })).status).toBe(204);
  expect((await tablet.get('/api/kitchen/recipes')).status).toBe(401);
});

// ---------- other people ----------

it('nobody can read or change another person\'s security settings', async () => {
  const admin = await owner();
  const other = await member(admin, 'partner');
  const mine = await turnOn(admin);
  const setupOfOther = await other.post('/api/security/second-step/start', { password: PASSWORD });
  // Their screen is theirs.
  expect((await other.get('/api/security')).json.second_step.on).toBe(false);
  expect((await other.get('/api/security')).text).not.toContain(mine.secret.replace(/\s/g, ''));
  // Using another person's setup token, or turning off theirs, or reaching the admin's list, fails.
  expect((await admin.post('/api/security/second-step/confirm', { setup: setupOfOther.json.setup, code: codeFor(setupOfOther.json.secret) })).status).toBe(400);
  expect((await other.post('/api/security/second-step/off', { password: PASSWORD, code: codeFor(mine.secret) })).status).toBe(409);
  expect((await other.get('/api/security/people')).status).toBe(403);
  expect((await other.post('/api/security/people/1/reset')).status).toBe(403);
  expect((await admin.get('/api/security')).json.second_step.on).toBe(true);
});

it('an admin can turn off someone else\'s two-step and passkeys, and they are told next time they sign in', async () => {
  const admin = await owner();
  const other = await member(admin, 'partner');
  const theirs = await turnOn(other);
  const listed = await admin.get('/api/security/people');
  expect(listed.json).toEqual([
    { id: 1, username: 'owner', name: 'owner', is_admin: true, second_step: false, passkeys: 0, you: true },
    { id: 2, username: 'partner', name: 'partner', is_admin: false, second_step: true, passkeys: 0, you: false },
  ]);
  expect(listed.text).not.toContain(theirs.secret.replace(/\s/g, ''));
  expect((await admin.post('/api/security/people/1/reset')).status).toBe(400); // not yourself
  expect((await admin.post('/api/security/people/99/reset')).status).toBe(404);
  expect((await admin.post('/api/security/people/2/reset')).status).toBe(204);
  expect((await admin.post('/api/security/people/2/reset')).status).toBe(409); // nothing left to turn off
  expect((await other.get('/api/kitchen/recipes')).status).toBe(401); // whoever was signed in as them is out

  const back = visitor();
  const signedIn = await back.post('/api/auth/login', { username: 'partner', password: PASSWORD });
  expect([signedIn.status, signedIn.json.username]).toEqual([200, 'partner']); // no second step now
  expect(signedIn.json.notice).toBe('An admin turned off two-step sign-in on March 5, 2046.');
  expect((await back.get('/api/security')).json.notice).toBe('An admin turned off two-step sign-in on March 5, 2046.');
  expect((await back.post('/api/security/notice/dismiss')).status).toBe(204);
  expect((await back.get('/api/security')).json.notice).toBeNull();
  expect((await visitor().post('/api/auth/login', { username: 'partner', password: PASSWORD })).json).toEqual({ id: 2, username: 'partner', name: 'partner', is_admin: false });
});

it('the demo refuses every change to sign-in security', async () => {
  const admin = await owner();
  const { secret } = await turnOn(admin);
  const demoServer = createServer(createApp({ db: database.db, clock: () => time, onError: (problem) => errors.push(problem), sealer: vault(path.join(folder, 'keys'), 'second_step'), demo: { username: 'demo', password: 'demo-demo-demo-demo' } }));
  await new Promise<void>((resolve) => demoServer.listen(0, '127.0.0.1', resolve));
  const there = `http://localhost:${(demoServer.address() as AddressInfo).port}`;
  try {
    const cookie = admin.cookieValue();
    const send = (method: string, url: string, body: unknown = {}) =>
      fetch(there + url, { method, headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    for (const [method, url] of [['POST', '/api/security/second-step/start'], ['POST', '/api/security/second-step/confirm'], ['POST', '/api/security/second-step/off'],
      ['POST', '/api/security/recovery-codes'], ['POST', '/api/security/passkeys/begin'], ['POST', '/api/security/passkeys/finish'], ['PUT', '/api/security/passkeys/1'],
      ['DELETE', '/api/security/passkeys/1'], ['POST', '/api/security/people/2/reset'], ['POST', '/api/security/notice/dismiss']] as const) {
      const answer = await send(method, url, { password: PASSWORD, code: codeFor(secret) });
      expect([url, answer.status]).toEqual([url, 403]);
      expect((await answer.json()).detail).toBe("Sign-in security can't be changed in the demo: everyone shares its account");
    }
    expect((await fetch(there + '/api/security', { headers: { Cookie: cookie } })).status).toBe(200); // it can still be looked at
  } finally {
    await new Promise((resolve) => demoServer.close(resolve));
  }
});

// ---------- passkeys, with a device written here ----------

const cbor = {
  bytes: (b: Buffer) => Buffer.concat([cbor.head(2, b.length), b]),
  text: (s: string) => Buffer.concat([cbor.head(3, Buffer.byteLength(s)), Buffer.from(s)]),
  head: (type: number, n: number) => (n < 24 ? Buffer.from([(type << 5) | n]) : n < 256 ? Buffer.from([(type << 5) | 24, n]) : Buffer.from([(type << 5) | 25, n >> 8, n & 255])),
  map: (...pairs: Buffer[]) => Buffer.concat([cbor.head(5, pairs.length / 2), ...pairs]),
  int: (n: number) => (n >= 0 ? cbor.head(0, n) : cbor.head(1, -1 - n)),
};
const sha256 = (data: Buffer | string) => createHash('sha256').update(data).digest();

/** A passkey device: makes a key pair, answers "create" with a none-attestation, and "get" with signed assertions. */
function device() {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = publicKey.export({ format: 'jwk' });
  const credentialId = randomBytes(16);
  let counter = 0;
  const flags = (attested: boolean) => 0x01 | 0x04 | (attested ? 0x40 : 0);
  const countBytes = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };
  const clientData = (type: string, challenge: string, origin: string) => Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false }));
  const rpHash = (options: { rp?: { id: string }; rpId?: string }) => sha256(options.rp?.id ?? options.rpId ?? 'localhost');
  return {
    id: credentialId.toString('base64url'),
    get counter() { return counter; },
    create(options: any, over: { origin?: string; challenge?: string; fmt?: string } = {}) {
      const cose = cbor.map(cbor.int(1), cbor.int(2), cbor.int(3), cbor.int(-7), cbor.int(-1), cbor.int(1),
        cbor.int(-2), cbor.bytes(Buffer.from(jwk.x!, 'base64url')), cbor.int(-3), cbor.bytes(Buffer.from(jwk.y!, 'base64url')));
      const authData = Buffer.concat([rpHash(options), Buffer.from([flags(true)]), countBytes(counter), Buffer.alloc(16), Buffer.from([0, credentialId.length]), credentialId, cose]);
      const statement = over.fmt && over.fmt !== 'none' ? cbor.map(cbor.text('alg'), cbor.int(-7), cbor.text('sig'), cbor.bytes(Buffer.alloc(70))) : cbor.map();
      const attestation = cbor.map(cbor.text('fmt'), cbor.text(over.fmt ?? 'none'), cbor.text('attStmt'), statement, cbor.text('authData'), cbor.bytes(authData));
      return {
        id: this.id, rawId: this.id, type: 'public-key', clientExtensionResults: {},
        response: { clientDataJSON: clientData('webauthn.create', over.challenge ?? options.challenge, over.origin ?? base).toString('base64url'), attestationObject: attestation.toString('base64url'), transports: ['internal'] },
      };
    },
    sign(options: any, over: { origin?: string; challenge?: string; counter?: number; tamper?: boolean; userHandle?: string | null } = {}) {
      counter = over.counter ?? counter + 1;
      const authData = Buffer.concat([rpHash(options), Buffer.from([flags(false)]), countBytes(counter)]);
      const data = clientData('webauthn.get', over.challenge ?? options.challenge, over.origin ?? base);
      let signature = sign('sha256', Buffer.concat([authData, sha256(data)]), privateKey);
      if (over.tamper) { signature = Buffer.from(signature); signature[signature.length - 3] = signature[signature.length - 3]! ^ 0xff; }
      return {
        id: this.id, rawId: this.id, type: 'public-key', clientExtensionResults: {},
        response: { clientDataJSON: data.toString('base64url'), authenticatorData: authData.toString('base64url'), signature: signature.toString('base64url'),
          ...(over.userHandle === null ? {} : { userHandle: over.userHandle }) },
      };
    },
  };
}

/** A passkey added to the signed-in person's account; returns the device and the handle it was given. */
async function addPasskey(who: Visitor, name = "Mom's iPhone") {
  const begun = await who.post('/api/security/passkeys/begin', { password: PASSWORD });
  expect(begun.status).toBe(200);
  const phone = device();
  const done = await who.post('/api/security/passkeys/finish', { credential: phone.create(begun.json.options), name });
  expect(done.status).toBe(201);
  return { phone, handle: begun.json.options.user.id as string, id: done.json.id as number };
}

async function signInWith(phone: ReturnType<typeof device>, handle: string, over: Parameters<ReturnType<typeof device>['sign']>[1] = {}) {
  const stranger = visitor();
  const begun = await stranger.post('/api/auth/passkey/begin');
  expect(begun.status).toBe(200);
  const answered = await stranger.post('/api/auth/passkey/finish', { credential: phone.sign(begun.json.options, { userHandle: handle, ...over }) });
  return { stranger, begun, answered };
}

it('registration options are well formed, and ask for what Life Is needs', async () => {
  const admin = await owner();
  expect((await admin.post('/api/security/passkeys/begin', { password: 'not it, not it, not it' })).status).toBe(400);
  expect((await admin.post('/api/security/passkeys/begin', {})).status).toBe(422);
  const begun = await admin.post('/api/security/passkeys/begin', { password: PASSWORD });
  const o = begun.json.options;
  expect(o.challenge).toMatch(/^[\w-]{43}$/);
  expect(o.rp).toEqual({ id: 'localhost', name: 'Life Is' });
  expect(o.authenticatorSelection).toMatchObject({ residentKey: 'required', userVerification: 'required' });
  expect(o.attestation).toBe('none');
  expect(o.user.name).toBe('owner');
  // The person's handle is random: not their name and not their number.
  const handle = Buffer.from(o.user.id, 'base64url');
  expect(handle).toHaveLength(32);
  expect(handle.toString()).not.toContain('owner');
  expect(o.excludeCredentials ?? []).toEqual([]);

  const first = await addPasskey(admin);
  expect(first.handle).toHaveLength(43);
  const again = await admin.post('/api/security/passkeys/begin', { password: PASSWORD });
  expect(again.json.options.excludeCredentials.map((c: { id: string }) => c.id)).toEqual([first.phone.id]);
  expect(again.json.options.user.id).toBe(first.handle); // the same handle every time
  expect(again.json.options.challenge).not.toBe(o.challenge);
  // Another person gets another handle.
  const other = await member(admin, 'partner');
  expect((await other.post('/api/security/passkeys/begin', { password: PASSWORD })).json.options.user.id).not.toBe(first.handle);
  // Never at a number: passkeys are tied to a name.
  const number = await visitor(() => base.replace('localhost', '127.0.0.1'));
  expect((await number.post('/api/auth/login', { username: 'owner', password: PASSWORD })).status).toBe(200);
  expect((await number.post('/api/security/passkeys/begin', { password: PASSWORD })).status).toBe(400);
  expect((await number.get('/api/security')).status).toBe(200); // the settings page still opens at a number
});

it('a passkey is added with a name, listed without its key, renamed and removed', async () => {
  const admin = await owner();
  const { phone, id } = await addPasskey(admin);
  const listed = (await admin.get('/api/security')).json.passkeys;
  expect(listed).toEqual([{ id, name: "Mom's iPhone", created_on: '2046-03-05', last_used_on: null, backed_up: false, multi_device: false, flagged: false, here: true }]);
  expect((await admin.get('/api/security')).text).not.toContain(phone.id);
  const stored = (await database.db.get<{ public_key: string; rp_id: string }>('SELECT public_key, rp_id FROM passkeys'))!;
  expect(stored.rp_id).toBe('localhost');
  expect((await admin.put(`/api/security/passkeys/${id}`, { name: '  Kitchen   tablet ' })).json).toEqual({ id, name: 'Kitchen tablet' });
  expect((await admin.put(`/api/security/passkeys/${id}`, {})).status).toBe(422);
  expect((await admin.get('/api/security')).json.passkeys[0].name).toBe('Kitchen tablet');
  expect((await admin.delete(`/api/security/passkeys/${id}`)).status).toBe(204);
  expect((await admin.delete(`/api/security/passkeys/${id}`)).status).toBe(404);
  expect((await admin.get('/api/security')).json.passkeys).toEqual([]);
});

it('registration is refused for a wrong origin, a wrong or reused or late challenge, and any attestation', async () => {
  const admin = await owner();
  const tries = async (over: Parameters<ReturnType<typeof device>['create']>[1], headers?: Record<string, string>) => {
    const begun = await admin.post('/api/security/passkeys/begin', { password: PASSWORD });
    return admin.post('/api/security/passkeys/finish', { credential: device().create(begun.json.options, over), name: 'x' }, headers);
  };
  expect((await tries({ origin: 'https://evil.example' })).status).toBe(400);
  expect((await tries({ origin: 'http://localhost:1' })).status).toBe(400);
  expect((await tries({ challenge: randomBytes(32).toString('base64url') })).status).toBe(400);
  expect((await tries({ fmt: 'packed' })).status).toBe(400);
  expect((await tries({}, { Origin: 'https://evil.example' })).status).toBe(403);
  // One challenge, once.
  const begun = await admin.post('/api/security/passkeys/begin', { password: PASSWORD });
  const credential = device().create(begun.json.options);
  expect((await admin.post('/api/security/passkeys/finish', { credential, name: 'a' })).status).toBe(201);
  expect((await admin.post('/api/security/passkeys/finish', { credential, name: 'a' })).status).toBe(400);
  // Five minutes.
  const late = await admin.post('/api/security/passkeys/begin', { password: PASSWORD });
  const lateCredential = device().create(late.json.options);
  advance(5 * 60 + 1);
  expect((await admin.post('/api/security/passkeys/finish', { credential: lateCredential, name: 'b' })).status).toBe(400);
  // Someone else's challenge can't register a passkey on my account.
  const other = await member(admin, 'partner');
  const theirs = await other.post('/api/security/passkeys/begin', { password: PASSWORD });
  expect((await admin.post('/api/security/passkeys/finish', { credential: device().create(theirs.json.options), name: 'c' })).status).toBe(400);
  expect((await admin.get('/api/security')).json.passkeys).toHaveLength(1);
});

it('a passkey signs in with no username and no password, and a removed one no longer does', async () => {
  const admin = await owner();
  const { phone, handle, id } = await addPasskey(admin);
  const { stranger, answered } = await signInWith(phone, handle);
  expect([answered.status, answered.json]).toEqual([200, { id: 1, username: 'owner', name: 'owner', is_admin: true }]);
  expect(answered.cookie).toMatch(/^lifeis_session=/);
  expect((await stranger.get('/api/kitchen/recipes')).status).toBe(200);
  expect((await admin.get('/api/security')).json.passkeys[0].last_used_on).toBe('2046-03-05');
  expect((await database.db.get<{ method: string }>('SELECT method FROM sessions ORDER BY created_at DESC, rowid DESC LIMIT 1'))!.method).toBe('passkey');
  // A device that doesn't say whose it is (no user handle) still signs in; one that names someone else does not.
  expect((await signInWith(phone, handle, { userHandle: null })).answered.status).toBe(200);
  expect((await signInWith(phone, handle, { userHandle: randomBytes(32).toString('base64url') })).answered.status).toBe(401);

  expect((await admin.delete(`/api/security/passkeys/${id}`)).status).toBe(204);
  expect((await signInWith(phone, handle)).answered.status).toBe(401);
});

it('a passkey sign-in is refused for the wrong origin, challenge, signature and counter, and a challenge is used once', async () => {
  const admin = await owner();
  const { phone, handle } = await addPasskey(admin);
  const refused = async (over: Parameters<ReturnType<typeof device>['sign']>[1], headers?: Record<string, string>) => {
    const stranger = visitor();
    const begun = await stranger.post('/api/auth/passkey/begin');
    return (await stranger.post('/api/auth/passkey/finish', { credential: phone.sign(begun.json.options, { userHandle: handle, ...over }) }, headers)).status;
  };
  expect(await refused({ origin: 'https://evil.example' })).toBe(401);
  expect(await refused({ challenge: randomBytes(32).toString('base64url') })).toBe(401);
  expect(await refused({ tamper: true })).toBe(401);
  expect(await refused({}, { Origin: 'https://evil.example' })).toBe(403);
  expect((await signInWith(phone, handle)).answered.status).toBe(200); // the device itself is fine

  // The same answer twice: the second finds no challenge.
  const stranger = visitor();
  const begun = await stranger.post('/api/auth/passkey/begin');
  const credential = phone.sign(begun.json.options, { userHandle: handle });
  expect((await stranger.post('/api/auth/passkey/finish', { credential })).status).toBe(200);
  expect((await visitor().post('/api/auth/passkey/finish', { credential })).status).toBe(401);
  // Five minutes.
  const slow = await visitor().post('/api/auth/passkey/begin');
  const slowCredential = phone.sign(slow.json.options, { userHandle: handle });
  advance(5 * 60 + 1);
  expect((await visitor().post('/api/auth/passkey/finish', { credential: slowCredential })).status).toBe(401);
  // A challenge made for one purpose is no use for another.
  const login = await visitor().post('/api/auth/passkey/begin');
  const asSecond = await visitor().post('/api/auth/second-step/passkey/finish', { pending: 'x'.repeat(43), credential: phone.sign(login.json.options, { userHandle: handle }) });
  expect(asSecond.status).toBe(400);
  expect((await visitor().post('/api/auth/passkey/finish', { credential: phone.sign(login.json.options, { userHandle: handle }) })).status).toBe(200);
});

it('a counter that goes backwards refuses the sign-in and flags the passkey; always-zero counters are fine', async () => {
  const admin = await owner();
  const { phone, handle } = await addPasskey(admin);
  expect((await signInWith(phone, handle, { counter: 5 })).answered.status).toBe(200);
  expect((await signInWith(phone, handle, { counter: 6 })).answered.status).toBe(200);
  expect((await signInWith(phone, handle, { counter: 3 })).answered.status).toBe(401);
  expect((await admin.get('/api/security')).json.passkeys[0].flagged).toBe(true);
  expect((await signInWith(phone, handle, { counter: 50 })).answered.status).toBe(401); // flagged: refused until removed

  const zero = await addPasskey(admin, 'Zero');
  for (let i = 0; i < 3; i += 1) expect((await signInWith(zero.phone, zero.handle, { counter: 0 })).answered.status).toBe(200);
});

it('failed passkey tries are counted like wrong passwords', async () => {
  const admin = await owner();
  const { phone, handle } = await addPasskey(admin);
  for (let i = 0; i < 5; i += 1) expect((await signInWith(phone, handle, { tamper: true })).answered.status).toBe(401);
  // Five for this person from this address: the same lock a wrong password would have set.
  const held = await visitor().post('/api/auth/login', { username: 'owner', password: PASSWORD });
  expect([held.status, held.json.detail]).toEqual([429, 'Too many failed attempts. Try again in 2 seconds.']);
  // Twenty from one address of any kind: then that address is held back from passkeys too.
  advance(2 * 86400);
  const guesser = visitor();
  for (let i = 0; i < 20; i += 1) expect((await guesser.post('/api/auth/passkey/finish', { credential: { nonsense: true } })).status).toBe(401);
  expect((await guesser.post('/api/auth/passkey/finish', { credential: { nonsense: true } })).status).toBe(429);
});

it('a passkey can answer the second step instead of a code, and only that person\'s sign-in and passkeys count', async () => {
  const admin = await owner();
  const { secret } = await turnOn(admin);
  const { phone, handle } = await addPasskey(admin);
  const other = await member(admin, 'partner');
  await turnOn(other);
  const theirs = await addPasskey(other, 'Theirs');

  const { stranger, asked } = await firstStep();
  expect(asked.json.passkey).toBe(true);
  const begun = await stranger.post('/api/auth/second-step/passkey/begin', { pending: asked.json.pending });
  expect(begun.status).toBe(200);
  expect(begun.json.options.allowCredentials.map((c: { id: string }) => c.id)).toEqual([phone.id]);
  const credential = phone.sign(begun.json.options, { userHandle: handle });
  // Another person's passkey, or an answer to the wrong sign-in, doesn't count.
  const impostor = await visitor().post('/api/auth/second-step/passkey/begin', { pending: asked.json.pending });
  expect((await stranger.post('/api/auth/second-step/passkey/finish', { pending: asked.json.pending, credential: theirs.phone.sign(impostor.json.options, { userHandle: theirs.handle }) })).status).toBe(401);
  const second = await firstStep();
  expect((await second.stranger.post('/api/auth/second-step/passkey/finish', { pending: second.asked.json.pending, credential })).status).toBe(401);
  // The right passkey for the right sign-in.
  const fresh = await firstStep();
  const options = (await fresh.stranger.post('/api/auth/second-step/passkey/begin', { pending: fresh.asked.json.pending })).json.options;
  const done = await fresh.stranger.post('/api/auth/second-step/passkey/finish', { pending: fresh.asked.json.pending, credential: phone.sign(options, { userHandle: handle }) });
  expect([done.status, done.json.username]).toEqual([200, 'owner']);
  expect((await fresh.stranger.get('/api/kitchen/recipes')).status).toBe(200);
  // Sign-in with the passkey alone doesn't need the code either; the password alone still does.
  expect((await signInWith(phone, handle)).answered.status).toBe(200);
  expect((await firstStep()).asked.json.second_step).toBe(true);
  void secret;
});

it('an admin removing someone\'s passkeys signs them out and tells them', async () => {
  const admin = await owner();
  const other = await member(admin, 'partner');
  const { phone, handle } = await addPasskey(other, 'Theirs');
  expect((await admin.post('/api/security/people/2/reset')).status).toBe(204);
  expect((await signInWith(phone, handle)).answered.status).toBe(401);
  const back = await visitor().post('/api/auth/login', { username: 'partner', password: PASSWORD });
  expect(back.json.notice).toBe('An admin removed your passkeys on March 5, 2046.');
  // Another person can't rename or remove a passkey that isn't theirs.
  const mine = await addPasskey(admin, 'Mine');
  const stranger = await member(admin, 'third');
  expect((await stranger.put(`/api/security/passkeys/${mine.id}`, { name: 'Taken' })).status).toBe(404);
  expect((await stranger.delete(`/api/security/passkeys/${mine.id}`)).status).toBe(404);
  expect((await admin.get('/api/security')).json.passkeys[0].name).toBe('Mine');
});
