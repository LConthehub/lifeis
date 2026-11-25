/** Cooking timers: kept in memory, sent through the person's own push and ntfy when they end (and not before), and private to each person. */
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { reminders } from '../../core/src/index.ts';
import { createApp } from '../src/app.ts';
import { cookTimers } from '../src/cookTimers.ts';
import { sendFinished } from '../src/cookingTimerRoutes.ts';
import { openDatabase, type OpenDatabase } from '../src/database.ts';
import { vault } from '../src/vault.ts';

const PASSWORD = 'correct-horse-battery';
let folder: string;
let database: OpenDatabase;
let server: Server;
let base: string;
const errors: unknown[] = [];

// A clock and a scheduler the test moves by hand.
let at = 1_000_000;
let waiting: { due: number; run: () => void; live: boolean }[] = [];
const advance = async (ms: number) => {
  at += ms;
  for (const w of waiting.filter((x) => x.live && x.due <= at)) { w.live = false; w.run(); }
  await new Promise((r) => setTimeout(r, 50));
};
const pushes: { title: string; body: string; url: string }[] = [];
const ntfy: { url: string; headers: Record<string, string>; body: string }[] = [];

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
  return { get: (a: string) => ask('GET', a), post: (a: string, b?: unknown) => ask('POST', a, b), put: (a: string, b?: unknown) => ask('PUT', a, b), delete: (a: string) => ask('DELETE', a) };
}

beforeEach(async () => {
  folder = mkdtempSync(path.join(tmpdir(), 'lifeis-test-'));
  errors.length = 0; pushes.length = 0; ntfy.length = 0; waiting = []; at = 1_000_000;
  database = await openDatabase(path.join(folder, 'data'), path.join(folder, 'keys'));
  const fetcher = async (url: string, headers: Record<string, string>, init?: { method?: string; body?: string }) => {
    ntfy.push({ url, headers, body: String(init?.body ?? '') });
    return { status: 200, body: '' };
  };
  const send = async (_to: unknown, message: { title: string; body: string; url: string }) => { pushes.push(message); return 'sent' as const; };
  const timers = cookTimers({
    now: () => at,
    later: (run, ms) => { const w = { due: at + ms, run, live: true }; waiting.push(w); return () => { w.live = false; }; },
    notify: sendFinished(database.db, { fetcher: fetcher as never, push: send as never, clock: () => new Date(at), onError: (p) => errors.push(p) }),
  });
  server = createServer(createApp({ db: database.db, timers, reach: { fetcher: fetcher as never, sealer: vault(path.join(folder, 'keys'), 'media_source') }, push: { publicKey: 'k', send: send as never } }));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
  database.close();
  rmSync(folder, { recursive: true, force: true });
  expect(errors).toEqual([]);
});

async function people() {
  const admin = visitor();
  expect((await admin.post('/api/auth/setup', { username: 'Owner', password: PASSWORD })).status).toBe(201);
  expect((await admin.post('/api/users', { username: 'Sam', password: PASSWORD })).status).toBe(201);
  const sam = visitor();
  expect((await sam.post('/api/auth/login', { username: 'Sam', password: PASSWORD })).status).toBe(200);
  return { admin, sam };
}

async function turnOnWays(who: number, ways: { push?: boolean; ntfy?: 'full' | 'count'; email?: boolean }) {
  const mine = reminders(database.db, who, () => new Date(at));
  await mine.save({ push: Boolean(ways.push), email: Boolean(ways.email), ...(ways.ntfy ? { ntfy: { server: 'https://ntfy.example', topic: 'kitchen-topic-1', detail: ways.ntfy } } : {}) });
  if (ways.push) await mine.addBrowser({ endpoint: `https://push.example/${who}/aaaaaaaaaa`, p256dh: 'p'.repeat(40), auth: 'a'.repeat(20) });
}

it('sends through push and ntfy when a timer ends, not before, and never by email', async () => {
  const { admin } = await people();
  await turnOnWays(1, { push: true, ntfy: 'full', email: true });
  const made = await admin.post('/api/cooking/timers', { label: 'Simmer the sauce', minutes: 12, recipe_id: 7 });
  expect([made.status, made.json.label, made.json.seconds_left]).toEqual([201, 'Simmer the sauce', 720]);
  expect((await admin.get('/api/cooking/timers')).json.map((t: { label: string }) => t.label)).toEqual(['Simmer the sauce']);
  await advance(11 * 60_000);
  expect([pushes.length, ntfy.length]).toEqual([0, 0]);
  expect((await admin.get('/api/cooking/timers')).json[0].seconds_left).toBe(60);
  await advance(60_000);
  expect(pushes).toEqual([{ title: 'Timer done: Simmer the sauce', body: 'Your cooking timer has ended.', url: '/recipes/7' }]);
  expect(ntfy.length).toBe(1);
  expect(ntfy[0]!.url).toBe('https://ntfy.example/kitchen-topic-1');
  expect([ntfy[0]!.headers.Title, ntfy[0]!.headers.Priority]).toEqual(['Timer done: Simmer the sauce', 'high']);
  // It is gone from the list once it has gone off, and goes off only once.
  expect((await admin.get('/api/cooking/timers')).json).toEqual([]);
  await advance(60 * 60_000);
  expect([pushes.length, ntfy.length]).toEqual([1, 1]);
});

it('tells an ntfy server only that a timer ended when the person chose counts only', async () => {
  const { admin } = await people();
  await turnOnWays(1, { ntfy: 'count' });
  await admin.post('/api/cooking/timers', { label: 'Thaw the secret recipe', minutes: 1 });
  await advance(60_000);
  expect(pushes).toEqual([]);
  expect([ntfy[0]!.headers.Title, ntfy[0]!.body]).toEqual(['Timer done', 'A cooking timer has ended.']);
});

it('works with no way turned on, and sends nothing', async () => {
  const { admin } = await people();
  await admin.post('/api/cooking/timers', { label: 'Boil eggs', minutes: 8 });
  await advance(8 * 60_000);
  expect([pushes.length, ntfy.length]).toEqual([0, 0]);
});

it('stopping cancels it, and adding a minute moves the end', async () => {
  const { admin } = await people();
  await turnOnWays(1, { push: true });
  const a = (await admin.post('/api/cooking/timers', { label: 'Stop me', minutes: 5 })).json;
  const b = (await admin.post('/api/cooking/timers', { label: 'Add to me', minutes: 5 })).json;
  expect((await admin.delete(`/api/cooking/timers/${a.id}`)).status).toBe(204);
  expect((await admin.post(`/api/cooking/timers/${b.id}/more`, { minutes: 1 })).json.seconds_left).toBe(360);
  await advance(5 * 60_000);
  expect(pushes).toEqual([]);
  await advance(60_000);
  expect(pushes.map((p) => p.title)).toEqual(['Timer done: Add to me']);
  expect((await admin.post(`/api/cooking/timers/${b.id}/more`, { minutes: 1 })).status).toBe(404);
});

it('keeps each person to their own timers', async () => {
  const { admin, sam } = await people();
  await turnOnWays(1, { push: true });
  await turnOnWays(2, { push: true });
  const mine = (await admin.post('/api/cooking/timers', { label: 'Owner pot', minutes: 5 })).json;
  await sam.post('/api/cooking/timers', { label: 'Sam pot', minutes: 5 });
  expect((await sam.get('/api/cooking/timers')).json.map((t: { label: string }) => t.label)).toEqual(['Sam pot']);
  expect((await admin.get('/api/cooking/timers')).json.map((t: { label: string }) => t.label)).toEqual(['Owner pot']);
  // Sam cannot stop or extend it.
  await sam.delete(`/api/cooking/timers/${mine.id}`);
  expect((await sam.post(`/api/cooking/timers/${mine.id}/more`, { minutes: 1 })).status).toBe(404);
  expect((await admin.get('/api/cooking/timers')).json.length).toBe(1);
  await advance(5 * 60_000);
  expect(pushes.map((p) => p.title).sort()).toEqual(['Timer done: Owner pot', 'Timer done: Sam pot']);
});

it('refuses a time that makes no sense, and needs a sign-in', async () => {
  const { admin } = await people();
  expect((await admin.post('/api/cooking/timers', { label: 'x', minutes: 0 })).status).toBe(400);
  expect((await admin.post('/api/cooking/timers', { label: 'x', minutes: 5000 })).status).toBe(400);
  expect((await admin.post('/api/cooking/timers', { label: 'x' })).status).toBe(422);
  expect((await visitor().get('/api/cooking/timers')).status).toBe(401);
});
