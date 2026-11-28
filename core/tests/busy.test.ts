/** The busy-times link: a page that holds times of day and nothing else. */
import { beforeEach, expect, it } from 'vitest';
import { busyBlocks, busyFor, busyHtml, busyLink, joined } from '../src/busy.ts';
import { calendar } from '../src/calendar.ts';
import type { Db } from '../src/db.ts';
import { LATEST, migrate } from '../src/migrations.ts';
import { memoryDb } from './memoryDb.ts';

let db: Db;
let owner: number;
let time = new Date(2046, 2, 5, 10, 0, 0);
const clock = () => time;
const problem = (status: number) => expect.objectContaining({ name: 'Problem', status });

async function person(name: string): Promise<number> {
  return (await db.run("INSERT INTO users (username, password_hash, created_at) VALUES (?, 'x', 'now')", [name])).lastId;
}

beforeEach(async () => {
  db = memoryDb();
  expect(await migrate(db)).toBe(LATEST);
  owner = await person('owner');
  time = new Date(2046, 2, 5, 10, 0, 0);
});

/** Things that must never reach the shared page, each written somewhere the calendar keeps it. */
const SECRETS = ['Charlie dentist', 'Hank birthday party', 'Loretta flight', 'George the dog vet', 'Room 12 on Maple Street', 'bring the blue folder'];

async function fillCalendar() {
  const cal = calendar(db, owner, clock);
  await cal.createEvent({ title: SECRETS[0]!, day: '2046-03-06', time: '09:00', note: SECRETS[5]! });
  await cal.createEvent({ title: SECRETS[1]!, day: '2046-03-06', time: '09:30', note: SECRETS[4]! }); // overlaps the first
  await cal.createEvent({ title: SECRETS[2]!, day: '2046-03-08', end_day: '2046-03-10', time: '14:00' });
  await cal.createEvent({ title: 'Anniversary', day: '2040-03-07', yearly: true }); // a yearly date is not busy time
  await db.run('INSERT INTO plans (owner_id, name, start_day, end_day, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [owner, SECRETS[3]!, '2046-03-15', '2046-03-16', SECRETS[4]!, 'now', 'now']);
  const followed = (await db.run("INSERT INTO followed_calendars (owner_id, name, url, show, created_at) VALUES (?, 'Work at Acme Corp', 'x', 'busy', 'now')", [owner])).lastId;
  await db.run("INSERT INTO followed_events (calendar_id, day, time, end_time) VALUES (?, '2046-03-12', '13:00', '14:30')", [followed]);
  await db.run("INSERT INTO followed_events (calendar_id, day, time, end_time) VALUES (?, '2046-03-12', '14:30', '15:00')", [followed]); // touches the one before
  // Meals and chores are not busy time.
  await db.run("INSERT INTO meal_plan (owner_id, day, meal, title, created_at) VALUES (?, '2046-03-07', 'dinner', 'Soup', 'now')", [owner]);
}

it('blocks that touch or overlap run together, so one cannot be told from another', () => {
  expect(joined([[540, 600], [570, 660], [660, 700], [800, 820]])).toEqual([[540, 700], [800, 820]]);
  expect(joined([[0, 1440], [100, 200]])).toEqual([[0, 1440]]);
});

it('busy time comes from dates, plans and followed calendars for four weeks, and nothing else', async () => {
  await fillCalendar();
  const days = await busyBlocks(db, owner, '2046-03-05');
  expect(days).toHaveLength(28);
  expect(days[0]!.day).toBe('2046-03-05');
  expect(days[27]!.day).toBe('2046-04-01');
  const at = (day: string) => days.find((d) => d.day === day)!.busy;
  expect(at('2046-03-06')).toEqual([[540, 600 + 30]]); // 9:00 to 10:30: the second event starts at 9:30 and, with no end, lasts an hour
  expect(at('2046-03-07')).toEqual([]); // the yearly date and the meal are not busy time
  expect(at('2046-03-08')).toEqual([[840, 1440]]); // a trip starts at 2:00 PM
  expect(at('2046-03-09')).toEqual([[0, 1440]]);
  expect(at('2046-03-10')).toEqual([[0, 1440]]);
  expect(at('2046-03-12')).toEqual([[780, 900]]); // the two followed blocks run together
  expect(at('2046-03-15')).toEqual([[0, 1440]]);
  expect(at('2046-03-16')).toEqual([[0, 1440]]);
  expect(at('2046-03-17')).toEqual([]);
});

it('the link is made for a number of days, ends on its day, can be ended, and a new one replaces the old', async () => {
  const mine = busyLink(db, owner, clock);
  expect(await mine.get()).toEqual({ on: false, token: null, expires_on: null, credit: true });
  await expect(mine.shareFor(0)).rejects.toEqual(problem(400));
  await expect(mine.shareFor(366)).rejects.toEqual(problem(400));
  const made = await mine.shareFor(7);
  expect([made.on, made.expires_on, made.token]).toEqual([true, '2046-03-12', expect.stringMatching(/^[0-9a-f]{64}$/)]);
  expect(await busyFor(db, made.token!, clock)).not.toBeNull();
  expect(await busyFor(db, 'not a token', clock)).toBeNull();
  expect(await busyFor(db, '0'.repeat(64), clock)).toBeNull();

  const again = await mine.shareFor(7);
  expect(again.token).not.toBe(made.token);
  expect(await busyFor(db, made.token!, clock)).toBeNull(); // the old address stopped working

  time = new Date(2046, 2, 12, 23, 0, 0); // the last day: still works
  expect(await busyFor(db, again.token!, clock)).not.toBeNull();
  time = new Date(2046, 2, 13, 0, 5, 0);
  expect(await busyFor(db, again.token!, clock)).toBeNull();
  expect((await mine.get()).on).toBe(false);

  time = new Date(2046, 2, 5, 10, 0, 0);
  const third = await mine.shareFor(30);
  expect((await mine.stopSharing()).on).toBe(false);
  expect(await busyFor(db, third.token!, clock)).toBeNull();
});

it('what the public page is sent holds times only: no titles, names, places, notes or kinds', async () => {
  await fillCalendar();
  const mine = busyLink(db, owner, clock);
  const link = await mine.shareFor(10);
  const found = (await busyFor(db, link.token!, clock))!;

  // The data itself: only a day and blocks of minutes, nothing else.
  expect(Object.keys(found).sort()).toEqual(['credit', 'days', 'expires_on']);
  for (const d of found.days) {
    expect(Object.keys(d).sort()).toEqual(['busy', 'day']);
    for (const block of d.busy) expect(block.every((n) => Number.isInteger(n) && n >= 0 && n <= 1440)).toBe(true);
  }
  const data = JSON.stringify(found);
  const page = busyHtml(found);
  for (const text of [...SECRETS, 'Anniversary', 'Soup', 'Acme', 'Work at', 'Charlie', 'Hank', 'Loretta', 'George', 'Maple', 'dentist']) {
    expect(data.toLowerCase()).not.toContain(text.toLowerCase());
    expect(page.toLowerCase()).not.toContain(text.toLowerCase());
  }
  // The data holds no words at all, only numbers and the days.
  expect(data.replace(/"(days|day|busy|expires_on|credit)"/g, '').replace(/[0-9"\-[\]{},:]|true|false|null/g, '')).toBe('');
  expect(page).not.toContain('<script');
  expect(page).toContain('Busy from 9:00 AM to 10:30 AM');
  expect(page).toContain('Busy all day');
  expect(page).toContain('Free all day');
  expect(page).toContain('Available until Thursday, March 15');
  expect(page).toContain('Made with Life Is');
  expect((await mine.setCredit(false)).credit).toBe(false);
  expect(busyHtml((await busyFor(db, link.token!, clock))!)).not.toContain('Made with Life Is');
});

it("one person's link shows that person's calendar, and nobody else's", async () => {
  await fillCalendar();
  const other = await person('other');
  const theirs = await busyLink(db, other, clock).shareFor(5);
  const found = (await busyFor(db, theirs.token!, clock))!;
  expect(found.days.every((d) => d.busy.length === 0)).toBe(true);
});
