/** Routines over the web addresses: making them, ticking them, the cycle, running low, and who may see what. */
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createApp } from '../src/app.ts';
import { openDatabase, type OpenDatabase } from '../src/database.ts';

const PASSWORD = 'correct-horse-battery';
let folder: string;
let database: OpenDatabase;
let server: Server;
let base: string;
const errors: unknown[] = [];
// 2046-03-05 is a Monday.
const MONDAY = new Date(2046, 2, 5, 10, 0, 0);

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
  return {
    get: (address: string) => ask('GET', address), post: (address: string, body?: unknown) => ask('POST', address, body),
    put: (address: string, body?: unknown) => ask('PUT', address, body), delete: (address: string) => ask('DELETE', address),
  };
}

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
  errors.length = 0;
  database = await openDatabase(path.join(folder, 'data'), path.join(folder, 'keys'));
  server = createServer(createApp({ db: database.db, clock: () => MONDAY, onError: (problem) => errors.push(problem) }));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
  database.close();
  rmSync(folder, { recursive: true, force: true });
  expect(errors).toEqual([]);
});

type DayTime = { id: number; title: string; night: number | null; total: number; done: number; finished: boolean; last7: number; steps: { id: number; words: string; ticked: boolean }[] };

it('makes a routine from a starter, ticks it on the front page, goes the cycle round, and runs a thing low', async () => {
  const admin = await owner();
  // The ready-made ones, and adding one.
  const offered = (await admin.get('/api/routines/starters')).json;
  expect(offered.map((s: { slug: string }) => s.slug)).toContain('skin-cycle');
  const made = await admin.post('/api/routines/starters', { slug: 'skincare' });
  expect([made.status, made.json.times.map((t: { name: string }) => t.name), made.json.who]).toEqual([201, ['Morning', 'Evening'], 'You']);
  // A retinoid step on Monday and Thursday, in the evening, naming a thing.
  await admin.post('/api/things/starters', { slug: 'clothing' });
  const kind = (await admin.get('/api/things/kinds')).json[0];
  const serum = (await admin.post('/api/things/items', { kind_id: kind.id, name: 'Retinol serum', quantity: 3, low_at: 1 })).json;
  const evening = made.json.times[1];
  const changed = await admin.put(`/api/routines/${made.json.id}`, {
    name: 'Skincare', for_user: null, for_member: null, cycle_length: null, points: null, note: null,
    times: made.json.times.map((t: { id: number; name: string; at: string | null; steps: { id: number; words: string }[] }) => ({
      id: t.id, name: t.name, at: t.name === 'Evening' ? '21:00' : null,
      steps: [...t.steps.map((s) => ({ id: s.id, words: s.words })), ...(t.name === 'Evening' ? [{ words: 'Retinoid', rule: 'weekdays', weekdays: [1, 4], item_id: serum.id, wait_seconds: 60 }] : [])],
    })),
  });
  expect(changed.status).toBe(200);
  const step = changed.json.times[1].steps.find((s: { words: string }) => s.words === 'Retinoid');
  expect([step.days, step.item, step.wait_seconds]).toEqual(['Mon and Thu', 'Retinol serum', 60]);
  expect((await admin.get(`/api/routines/for-thing/${serum.id}`)).json.map((u: { title: string }) => u.title)).toEqual(['Skincare: Evening']);

  // Today is Monday: the evening has three steps.
  let today: DayTime[] = (await admin.get('/api/routine-day')).json;
  expect(today.map((t) => [t.title, t.total, t.done])).toEqual([['Skincare: Morning', 3, 0], ['Skincare: Evening', 3, 0]]);
  const first = today[1]!.steps[0]!;
  const ticked: DayTime = (await admin.put(`/api/routine-day/steps/${first.id}`, { done: true })).json;
  expect([ticked.done, ticked.finished]).toEqual([1, false]);
  const finished: DayTime = (await admin.put(`/api/routine-day/times/${today[1]!.id}`, { done: true })).json;
  expect([finished.done, finished.finished, finished.last7]).toEqual([3, true, 1]);
  // Tuesday's evening has no retinoid, and a step that isn't there on that day can't be ticked.
  expect((await admin.get('/api/routine-day?day=2046-03-06')).json.find((t: DayTime) => t.title.endsWith('Evening')).total).toBe(2);
  expect((await admin.put(`/api/routine-day/steps/${step.id}`, { done: true, day: '2046-03-06' })).status).toBe(400);
  expect((await admin.put(`/api/routine-day/steps/${first.id}`, { done: true, day: '2046-03-07' })).status).toBe(400);
  expect((await admin.put(`/api/routine-day/steps/${first.id}`, { done: 'yes' })).status).toBe(422);
  today = (await admin.get('/api/routine-day')).json;
  expect(today.map((t) => t.finished)).toEqual([false, true]);

  // Running low from the step puts the thing on the grocery list, once.
  const low = await admin.post(`/api/routine-day/steps/${step.id}/low`);
  expect([low.status, low.json]).toEqual([200, { name: 'Retinol serum', added: true, already: false }]);
  expect((await admin.post(`/api/routine-day/steps/${step.id}/low`)).json.already).toBe(true);
  expect((await admin.get('/api/kitchen/grocery')).json.map((g: { label: string }) => g.label)).toEqual(['Retinol serum']);
  expect((await admin.post(`/api/routine-day/steps/${first.id}/low`)).status).toBe(400);

  // The 4-night cycle waits for the evening to be finished.
  const cycle = (await admin.post('/api/routines/starters', { slug: 'skin-cycle' })).json;
  expect([cycle.cycle_length, cycle.times[0].steps.length]).toEqual([4, 6]);
  today = (await admin.get('/api/routine-day')).json;
  const night = today.find((t) => t.title === '4-night skin cycle: Evening')!;
  expect([night.night, night.steps.map((s) => s.words)]).toEqual([1, ['Wash your face', 'Exfoliate', 'Moisturizer']]);
  expect((await admin.get('/api/routine-day?day=2046-03-09')).json.find((t: DayTime) => t.title === '4-night skin cycle: Evening').night).toBe(1);
  await admin.put(`/api/routine-day/times/${night.id}`, { done: true });
  expect((await admin.get('/api/routine-day?day=2046-03-09')).json.find((t: DayTime) => t.title === '4-night skin cycle: Evening').night).toBe(2);
  // The phone sets reminders from the times with a clock time.
  expect((await admin.get('/api/routines/coming?days=2')).json.map((c: { day: string; at: string; title: string }) => [c.day, c.at, c.title])).toEqual([['2046-03-06', '21:00', 'Skincare: Evening']]);
  // Tags go on routines.
  const tag = (await admin.post('/api/tags', { name: 'Face' })).json;
  expect((await admin.put(`/api/tags/on/routine/${made.json.id}`, { tag_ids: [tag.id] })).json.map((t: { name: string }) => t.name)).toEqual(['Face']);
  expect((await admin.get(`/api/routines?tag=${tag.id}`)).json.map((r: { name: string }) => r.name)).toEqual(['Skincare']);
  expect((await admin.get('/api/search?q=retinoid')).json.map((r: { kind: string }) => r.kind)).toContain('routine');
  expect((await admin.delete(`/api/routines/${made.json.id}`)).status).toBe(204);
  expect((await admin.get(`/api/routines/${made.json.id}`)).status).toBe(404);
});

it('keeps a household member routine for the chart, and each person own routines to themselves', async () => {
  const admin = await owner();
  const partner = await member(admin, 'partner');
  const people = (await admin.get('/api/routines/people')).json;
  expect(people.users.map((u: { name: string }) => u.name).sort()).toEqual(['owner', 'partner']);
  expect((await admin.post('/api/things/upkeep/members', { name: 'Sam' })).status).toBeLessThan(500);
  const sam = (await admin.get('/api/routines/people')).json.members[0];
  const bag = { times: [{ name: 'After school', steps: [{ words: 'Bag away' }, { words: 'Snack' }] }] };
  const kids = (await admin.post('/api/routines', { name: 'After school', for_member: sam.id, points: 2, ...bag })).json;
  const hers = (await admin.post('/api/routines', { name: 'Hers', for_user: people.users.find((u: { name: string }) => u.name === 'partner').id, times: [{ name: 'Morning', steps: [{ words: 'Run' }] }] })).json;
  const house = (await admin.post('/api/routines', { name: 'House', times: [{ name: 'Evening', steps: [{ words: 'Lights' }] }] })).json;
  expect((await admin.get('/api/routine-day')).json.map((t: DayTime) => t.title)).toEqual(['House: Evening']);
  expect((await partner.get('/api/routine-day')).json.map((t: DayTime) => t.title).sort()).toEqual(['Hers: Morning', 'House: Evening']);
  const chart = (await admin.get('/api/routines/members')).json;
  expect(chart.map((t: { who: string; member_id: number; total: number }) => [t.who, t.member_id, t.total])).toEqual([['Sam', sam.id, 2]]);
  await admin.put(`/api/routine-day/times/${chart[0].id}`, { done: true });
  // The partner can tick the house routine, but not change it, nor see the household member's.
  expect((await partner.put(`/api/routine-day/steps/${house.times[0].steps[0].id}`, { done: true })).json.finished).toBe(true);
  expect((await partner.put(`/api/routines/${house.id}`, { name: 'Mine' })).status).toBe(404);
  expect((await partner.get(`/api/routines/${kids.id}`)).status).toBe(404);
  expect((await partner.put(`/api/routine-day/steps/${kids.times[0].steps[0].id}`, { done: false })).status).toBe(404);
  expect((await admin.get(`/api/routines/${hers.id}`)).status).toBe(200);
  expect((await partner.get('/api/routines/members')).json).toEqual([]);
  // Nobody signed in sees anything.
  expect((await visitor().get('/api/routine-day')).status).toBe(401);
  expect((await visitor().get('/api/routines')).status).toBe(401);
});
