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

  expect((await admin.put(`/api/plans/${planId}/food`, { served_at: 'late' })).status).toBe(400);
  expect((await admin.post(`/api/plans/${planId}/food-lines`, { label: 'Turkey', thaw_pounds: 0 })).status).toBe(400);
  expect((await admin.put(`/api/plans/${planId}/food`, { served_at: '16:30', food_kind: 'meal' })).json.served_at).toBe('16:30');
  const added = await admin.post(`/api/plans/${planId}/food-lines`, { label: 'Turkey', brought_by: 'Aunt June', thaw_pounds: 15 });
  expect([added.status, added.json.food_lines[0].brought_by]).toEqual([201, 'Aunt June']);
  const year = (await admin.get(`/api/plans/holidays/years/${planId}`)).json;
  expect(year.countdown.thaw).toEqual([{ label: 'Turkey', pounds: 15, days: 4, source: 'USDA: thawing in the refrigerator' }]);
  expect(year.countdown.steps[0]).toMatchObject({ due_day: '2026-11-22', due_time: '09:00' });
  expect(year.countdown.steps[0].detail).toContain('USDA: thawing in the refrigerator');
  // Any plan has it: the gathering view of a plan that is not a holiday's year carries a countdown too.
  const lunch = (await admin.post('/api/plans', { name: 'Lunch', start_day: '2026-11-28' })).json;
  await admin.put(`/api/plans/${lunch.id}/food`, { served_at: '12:00', food_kind: 'refreshments' });
  const line = (await admin.post(`/api/plans/${lunch.id}/food-lines`, { label: 'Ham', thaw_pounds: 8 })).json.food_lines[0];
  const view = (await admin.put(`/api/plans/holidays/years/${lunch.id}/ticks`, { key: `f${line.id}`, done: true })).json;
  expect([view.countdown.food_kind, view.countdown.steps[0].words, view.countdown.steps[0].done]).toEqual(['refreshments', 'Put the 8 lb Ham in the refrigerator to thaw', true]);
  expect((await admin.put(`/api/plans/food-lines/${line.id}`, { done: true })).json.food_lines[0].done).toBe(true);
  expect((await admin.delete(`/api/plans/food-lines/${line.id}`)).json.food_lines).toEqual([]);

  expect((await admin.post(`/api/plans/holidays/years/${planId}/decor`, { spot: 'Mantel', label: 'Garland' })).status).toBe(201);
  expect((await admin.post(`/api/plans/holidays/years/${planId}/people`, { role: 'guest', name: 'Aunt June' })).status).toBe(201);
  const finished = await admin.post(`/api/plans/holidays/years/${planId}/finish`, { notes: 'More pie' });
  expect(finished.status).toBe(200);
  const holiday = (await admin.get(`/api/plans/holidays/${made.json.id}`)).json;
  expect(holiday.years.map((y: { day: string }) => y.day)).toEqual(['2027-11-25', '2026-11-26']);
  const next = (await admin.get(`/api/plans/holidays/years/${holiday.years[0].plan_id}`)).json;
  expect([next.last_notes, next.guests[0].name, next.countdown.thaw[0].days, next.spots[0].items[0].label]).toEqual(['More pie', 'Aunt June', 4, 'Garland']);

  // Both years are plans, so they are found like any other.
  expect((await admin.get('/api/search?q=Thanksgiving')).json.some((r: { title: string }) => r.title === 'Thanksgiving 2027')).toBe(true);
  expect((await admin.get('/api/home')).json.cards).toContain('coming');
  expect((await admin.delete(`/api/plans/holidays/${made.json.id}`)).status).toBe(204);
  expect((await admin.get('/api/plans')).json.map((p: { name: string }) => p.name)).toEqual(['Thanksgiving 2027', 'Lunch', 'Thanksgiving 2026']);
});

it('adds a weekday after a date, a day on another calendar, and a rule that skips years, over the web', async () => {
  const admin = await owner();
  const after = await admin.post('/api/plans/holidays', { name: 'Lantern night at the lake', rule: 'after', month: 11, day_of_month: 2, weekday: 2, every_years: 1, lead_weeks: 6 });
  expect([after.status, after.json.rule_words, after.json.years[0].day]).toEqual([201, 'The first Tuesday on or after November 2', '2026-11-03']);
  const calendars = await admin.get('/api/plans/holidays/calendars');
  expect(calendars.json.map((c: { calendar: string }) => c.calendar)).toEqual(['chinese', 'hebrew', 'islamic']);
  expect(calendars.json[0].months).toHaveLength(12);
  const chinese = await admin.post('/api/plans/holidays', { name: 'Block party', rule: 'calendar', calendar: 'chinese', cal_month: '2', cal_day: 15, every_years: 1, lead_weeks: 6 });
  expect([chinese.status, chinese.json.rule_words, chinese.json.years[0].day]).toEqual([201, 'Day 15 of Second Month on the Chinese calendar', '2027-03-22']);
  const reunion = await admin.post('/api/plans/holidays', { name: 'Family reunion', rule: 'fixed', month: 7, day_of_month: 4, every_years: 5, lead_weeks: 6 });
  expect([reunion.status, reunion.json.rule_words, reunion.json.rule]).toEqual([201, 'July 4, every 5 years', { kind: 'fixed', month: 7, day: 4, every: 5, from: 2027 }]);
  expect((await admin.post('/api/plans/holidays', { name: 'Too often', rule: 'fixed', month: 7, day_of_month: 4, every_years: 11 })).status).toBe(400);
  expect((await admin.post('/api/plans/holidays', { name: 'No such month', rule: 'calendar', calendar: 'chinese', cal_month: 'Nowhere', cal_day: 1 })).status).toBe(400);
  expect((await admin.post('/api/plans/holidays', { name: 'Hindu', rule: 'calendar', calendar: 'hindu', cal_month: '1', cal_day: 1 })).status).toBe(400);
  const changed = await admin.put(`/api/plans/holidays/${after.json.id}`, { rule: 'after', month: 12, day_of_month: 1, weekday: 6, every_years: 2, lead_weeks: 6 });
  expect([changed.status, changed.json.rule_words]).toEqual([200, 'The first Saturday on or after December 1, every 2 years']);
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

it('opens a yearly date as a plan without saving, and makes it a yearly plan when a part is checked', async () => {
  const admin = await owner();
  const event = (await admin.post('/api/calendar/events', { title: 'Mina turns', day: '2017-12-02', yearly: true })).json;
  const draft = await admin.get(`/api/plans/holidays/from-date/${event.id}`);
  expect([draft.status, draft.json.name, draft.json.day, draft.json.years, draft.json.plan_id]).toEqual([200, 'Mina turns', '2026-12-02', 9, null]);
  expect((await admin.get('/api/plans/holidays')).json).toEqual([]);
  const made = await admin.post(`/api/plans/holidays/from-date/${event.id}`, { parts: ['gifts'] });
  expect([made.status, made.json.parts, made.json.start_day]).toEqual([201, ['gifts'], '2026-12-02']);
  expect((await admin.get(`/api/plans/holidays/from-date/${event.id}`)).json.plan_id).toBe(made.json.id);
  expect((await admin.get('/api/plans/holidays/from-date/9999')).status).toBe(404);
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
