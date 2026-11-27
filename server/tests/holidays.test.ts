/** Holidays over the web addresses: adding one, a year's countdown, and a gift staying hidden from the person it is for. */
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
let time = new Date(2026, 9, 1, 12, 0, 0);
const errors: unknown[] = [];

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
    return { status: response.status, json: response.headers.get('content-type') === 'application/json' ? JSON.parse(text) : undefined, text };
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
  const made = await admin.post('/api/users', { username, password: PASSWORD });
  expect(made.status).toBe(201);
  const someone = visitor();
  expect((await someone.post('/api/auth/login', { username, password: PASSWORD })).status).toBe(200);
  return { client: someone, id: made.json.id as number };
}

beforeEach(async () => {
  folder = mkdtempSync(path.join(tmpdir(), 'lifeis-test-'));
  errors.length = 0;
  time = new Date(2026, 9, 1, 12, 0, 0);
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

const THANKSGIVING = { name: 'Thanksgiving', rule: 'weekday', month: 11, weekday: 4, nth: 4 };

it('adds Thanksgiving, plans a countdown with a frozen turkey, and plans next year from this one', async () => {
  const admin = await owner();
  expect((await admin.get('/api/plans/holidays')).json).toEqual([]); // Life Is suggests none
  expect((await admin.post('/api/plans/holidays', { ...THANKSGIVING, rule: 'sometimes' })).status).toBe(422);
  expect((await admin.post('/api/plans/holidays', { ...THANKSGIVING, month: 13 })).status).toBe(400);
  const made = await admin.post('/api/plans/holidays', THANKSGIVING);
  expect([made.status, made.json.rule_words, made.json.years[0].day]).toEqual([201, 'Fourth Thursday of November', '2026-11-26']);
  const planId = made.json.years[0].plan_id;

  const year = (await admin.put(`/api/plans/holidays/years/${planId}`, { dinner_time: '16:30', turkey_pounds: 15 })).json;
  expect(year.countdown.thaw).toEqual({ pounds: 15, days: 4, source: 'USDA: thawing in the refrigerator' });
  expect(year.countdown.steps[0]).toMatchObject({ due_day: '2026-11-22', due_time: '09:00' });
  expect(year.countdown.steps[0].detail).toContain('USDA: thawing in the refrigerator');
  expect((await admin.put(`/api/plans/holidays/years/${planId}`, { turkey_pounds: 0 })).status).toBe(400);
  expect((await admin.put(`/api/plans/holidays/years/${planId}`, { dinner_time: 'late' })).status).toBe(400);

  expect((await admin.post(`/api/plans/holidays/years/${planId}/decor`, { spot: 'Mantel', label: 'Garland' })).status).toBe(201);
  expect((await admin.post(`/api/plans/holidays/years/${planId}/people`, { role: 'guest', name: 'Aunt June' })).status).toBe(201);
  const finished = await admin.post(`/api/plans/holidays/years/${planId}/finish`, { notes: 'More pie' });
  expect(finished.status).toBe(200);
  const holiday = (await admin.get(`/api/plans/holidays/${made.json.id}`)).json;
  expect(holiday.years.map((y: { day: string }) => y.day)).toEqual(['2027-11-25', '2026-11-26']);
  const next = (await admin.get(`/api/plans/holidays/years/${holiday.years[0].plan_id}`)).json;
  expect([next.last_notes, next.guests[0].name, next.countdown.thaw.days, next.spots[0].items[0].label]).toEqual(['More pie', 'Aunt June', 4, 'Garland']);

  // Both years are plans, so they are found like any other.
  expect((await admin.get('/api/search?q=Thanksgiving')).json.some((r: { title: string }) => r.title === 'Thanksgiving 2027')).toBe(true);
  expect((await admin.get('/api/home')).json.cards).toContain('coming');
  expect((await admin.delete(`/api/plans/holidays/${made.json.id}`)).status).toBe(204);
  expect((await admin.get('/api/plans')).json.map((p: { name: string }) => p.name)).toEqual(['Thanksgiving 2027', 'Thanksgiving 2026']);
});

it('turns a birthday into a holiday with one request', async () => {
  const admin = await owner();
  const event = (await admin.post('/api/calendar/events', { title: 'Grandma turns', day: '1950-12-02', yearly: true })).json;
  const made = await admin.post('/api/plans/holidays/from-event', { event_id: event.id });
  expect([made.status, made.json.rule_words, made.json.from_calendar, made.json.years[0].day]).toEqual([201, 'December 2', true, '2026-12-02']);
  expect((await admin.get(`/api/plans/holidays/years/${made.json.years[0].plan_id}`)).json.turns).toBe(76);
  expect((await admin.post('/api/plans/holidays/from-event', { event_id: event.id })).status).toBe(409);
  expect((await admin.post('/api/plans/holidays/from-event', {})).status).toBe(422);
});

it('hides a gift from the person it is for, in the holiday, in search, in spending, in tags, until the day has passed', async () => {
  const admin = await owner();
  const partner = await member(admin, 'partner');
  const made = (await admin.post('/api/plans/holidays', THANKSGIVING)).json;
  const planId = made.years[0].plan_id;
  // The partner shares a spending category with the owner, as a household does.
  const category = (await admin.post('/api/money/categories', { name: 'Household', monthly_cents: 300000, shared_with: [partner.id] })).json;
  await admin.post('/api/money/entries', { label: 'Groceries', cents: 15000, day: '2026-10-02', category_id: category.id });
  const before = (await partner.client.get('/api/money?month=2026-10')).json;
  expect(before.total.spent).toBe(15000);

  const withGift = (await admin.post(`/api/plans/holidays/years/${planId}/gifts`, { for_user: partner.id, idea: 'Secret binoculars' })).json;
  expect(withGift.gifts[0]).toMatchObject({ who: 'partner', idea: 'Secret binoculars', for_user: partner.id });
  const gift = withGift.gifts[0];
  await admin.put(`/api/plans/holidays/gifts/${gift.id}`, { status: 'wrapped', cents: 8800 });
  expect((await admin.get(`/api/plans/holidays/years/${planId}`)).json.budget.spent_cents).toBe(8800); // the owner sees what it cost

  const everything = async (client: ReturnType<typeof visitor>) => [
    (await client.get('/api/plans/holidays')).text, (await client.get('/api/plans')).text, (await client.get(`/api/plans/${planId}`)).text,
    (await client.get('/api/search?q=binoculars')).text, (await client.get('/api/search?q=gift')).text, (await client.get('/api/search?q=Thanksgiving')).text,
    (await client.get('/api/money?month=2026-10')).text, (await client.get('/api/money?month=2026-11')).text, (await client.get('/api/tags')).text,
    (await client.get('/api/home')).text, (await client.get('/api/plans/holidays/given-to-me')).text, (await client.get('/api/calendar?start=2026-11-26&days=1')).text,
  ].join('\n');
  const theirs = await everything(partner.client);
  expect(theirs).not.toMatch(/inocular|Thanksgiving|gift|8800|88\.00/i);
  expect((await partner.client.get('/api/money?month=2026-10')).json.total.spent).toBe(15000); // spending totals are unchanged
  expect((await partner.client.get('/api/money?month=2026-11')).json.total.spent).toBe(0);
  expect((await partner.client.get(`/api/plans/holidays/years/${planId}`)).status).toBe(404);
  expect((await partner.client.put(`/api/plans/holidays/gifts/${gift.id}`, { status: 'given' })).status).toBe(404);

  // Marked as given, and the day has passed: now it is theirs to see, as what they were given.
  await admin.put(`/api/plans/holidays/gifts/${gift.id}`, { status: 'given' });
  expect((await partner.client.get('/api/plans/holidays/given-to-me')).json).toEqual([]);
  // Weeks pass, so everyone signs in again.
  time = new Date(2026, 10, 26, 20, 0, 0);
  await partner.client.post('/api/auth/login', { username: 'partner', password: PASSWORD });
  await admin.post('/api/auth/login', { username: 'owner', password: PASSWORD });
  expect((await partner.client.get('/api/plans/holidays/given-to-me')).json).toEqual([]); // the day itself
  time = new Date(2026, 10, 27, 9, 0, 0);
  await partner.client.post('/api/auth/login', { username: 'partner', password: PASSWORD });
  await admin.post('/api/auth/login', { username: 'owner', password: PASSWORD });
  expect((await partner.client.get('/api/plans/holidays/given-to-me')).json).toEqual([{ holiday: 'Thanksgiving', year: 2026, day: '2026-11-26', idea: 'Secret binoculars' }]);
  expect((await admin.get('/api/plans/holidays/given-to-me')).json).toEqual([]);
  // Still nothing of the owner's plan or spending is theirs.
  expect((await partner.client.get('/api/plans/holidays')).json).toEqual([]);
  expect((await partner.client.get('/api/money?month=2026-11')).json.total.spent).toBe(0);
});
