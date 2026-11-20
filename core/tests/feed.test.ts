/** The calendar link: what a calendar app is given, and only once a link is made. */
import { beforeEach, expect, it } from 'vitest';
import { calendar } from '../src/calendar.ts';
import type { Db } from '../src/db.ts';
import { calendarFeed, calendarFile, feedFor } from '../src/feed.ts';
import { kitchen } from '../src/kitchen.ts';
import { migrate } from '../src/migrations.ts';
import { plans } from '../src/plans.ts';
import { memoryDb } from './memoryDb.ts';

let db: Db;
let owner: number;
let time: Date;
const clock = Object.assign(() => time, { today: () => '2046-03-05' });

async function person(name: string): Promise<number> {
  return (await db.run("INSERT INTO users (username, password_hash, created_at) VALUES (?, 'x', 'now')", [name])).lastId;
}

beforeEach(async () => {
  db = memoryDb();
  await migrate(db);
  owner = await person('owner');
  time = new Date(Date.UTC(2046, 2, 5, 10, 0, 0));
});

const problem = (status: number) => expect.objectContaining({ name: 'Problem', status });
/** The events in a file, each as its lines by name. */
const eventsIn = (file: string) => file.replace(/\r\n /g, '').split('BEGIN:VEVENT').slice(1)
  .map((block) => Object.fromEntries(block.split('\r\n').filter((l) => l.includes(':')).map((l) => [l.slice(0, l.indexOf(':')), l.slice(l.indexOf(':') + 1)])));

it('there is no link until one is made, a new one stops the old, and turning it off forgets it', async () => {
  const link = calendarFeed(db, owner, clock);
  const off = await link.status();
  expect([off.on, off.token, off.kinds]).toEqual([false, null, ['event', 'plan', 'meal', 'due']]);
  await expect(link.renew()).rejects.toEqual(problem(404));

  const on = await link.turnOn();
  expect(on.token).toMatch(/^[0-9a-f]{64}$/);
  expect(await feedFor(db, on.token!, clock)).toContain('BEGIN:VCALENDAR');
  expect((await link.status()).read_at).toBe('2046-03-05T10:00:00+00:00');

  // Changing what it carries keeps the address; asking for a new one doesn't.
  expect((await link.turnOn(['plan', 'event'])).token).toBe(on.token);
  expect((await link.status()).kinds).toEqual(['event', 'plan']);
  await expect(link.turnOn([])).rejects.toEqual(problem(400));
  await expect(link.turnOn(['passwords'])).rejects.toEqual(problem(400));
  const again = await link.renew();
  expect(again.token).not.toBe(on.token);
  expect([await feedFor(db, on.token!, clock), again.read_at]).toEqual([null, null]);

  await link.turnOff();
  expect([await feedFor(db, again.token!, clock), await feedFor(db, 'nonsense', clock), await feedFor(db, '', clock)]).toEqual([null, null, null]);
});

it('the file carries dates, plans and meals the way a calendar app reads them', async () => {
  const dates = calendar(db, owner, clock);
  await dates.createEvent({ title: 'Dentist; bring forms, x-rays', day: '2046-03-09', time: '14:30', note: 'Second floor\nRing the bell' });
  await dates.createEvent({ title: "Mum's birthday", day: '1958-03-07', yearly: true });
  await dates.createEvent({ title: 'Leap day baby', day: '2044-02-29', yearly: true });
  await dates.createEvent({ title: 'Fair', day: '2046-03-20', end_day: '2046-03-22', time: '09:00' });
  await dates.createEvent({ title: 'Long ago', day: '2045-06-01' });
  const plan = await plans(db, owner, clock).create({ name: 'Easter', start_day: '2046-03-24', end_day: '2046-03-26', note: null, story: null });
  const k = kitchen(db, owner, clock);
  const soup = await k.createRecipe({ title: 'Leek soup', ingredients_text: '3 leeks' });
  await k.addPlan({ day: '2046-03-06', meal: 'dinner', recipe_id: soup.id });
  await k.addPlan({ day: '2046-03-06', meal: 'lunch', title: 'Leftovers' });

  const { token } = await calendarFeed(db, owner, clock).turnOn();
  const file = (await feedFor(db, token!, clock, 'https://life.example.org'))!;
  expect(file.split('\r\n').every((line) => new TextEncoder().encode(line).length <= 75)).toBe(true);
  const found = eventsIn(file);
  const by = (title: string) => found.filter((e) => e.SUMMARY === title);

  // A time is said as it is, with no time zone: 14:30 wherever the phone is.
  expect(by('Dentist\\; bring forms\\, x-rays')[0]).toMatchObject({ DTSTART: '20460309T143000', DURATION: 'PT1H', DESCRIPTION: 'Second floor\\nRing the bell', URL: 'https://life.example.org/calendar' });
  expect(by("Mum's birthday")[0]).toMatchObject({ 'DTSTART;VALUE=DATE': '19580307', 'DTEND;VALUE=DATE': '19580308', RRULE: 'FREQ=YEARLY' });
  // The 29th of February is on the 28th in the years without one.
  expect(by('Leap day baby').map((e) => e['DTSTART;VALUE=DATE'])).toEqual(['20460228', '20470228']);
  expect(by('Fair')[0]).toMatchObject({ 'DTSTART;VALUE=DATE': '20460320', 'DTEND;VALUE=DATE': '20460323', DESCRIPTION: 'Starts at 09:00' });
  expect(by('Long ago')).toEqual([]);
  expect(by('Easter')[0]).toMatchObject({ UID: `plan-${plan.id}@lifeis`, 'DTSTART;VALUE=DATE': '20460324', 'DTEND;VALUE=DATE': '20460327', URL: `https://life.example.org/plans/${plan.id}` });
  expect(by('Dinner: Leek soup')[0]).toMatchObject({ 'DTSTART;VALUE=DATE': '20460306', URL: `https://life.example.org/recipes/${soup.id}` });
  expect(by('Lunch: Leftovers')).toHaveLength(1);
  expect(new Set(found.map((e) => e.UID)).size).toBe(found.length);
});

it('the link carries only what was ticked, and only its own person', async () => {
  const k = kitchen(db, owner, clock);
  await k.addPlan({ day: '2046-03-06', meal: 'dinner', title: 'Stew' });
  await calendar(db, owner, clock).createEvent({ title: 'Book club', day: '2046-03-10' });
  const other = await person('other');
  await calendar(db, other, clock).createEvent({ title: 'Their secret', day: '2046-03-10' });

  const link = calendarFeed(db, owner, clock);
  const { token } = await link.turnOn(['event']);
  let file = (await feedFor(db, token!, clock))!;
  expect([file.includes('Book club'), file.includes('Stew'), file.includes('Their secret'), file.includes('URL:')]).toEqual([true, false, false, false]);
  await link.turnOn(['meal']);
  file = (await feedFor(db, token!, clock))!;
  expect([file.includes('Book club'), file.includes('Dinner: Stew')]).toEqual([false, true]);
});

it('a long line with accents is folded without breaking a letter', () => {
  const file = calendarFile('Life Is', [{ uid: 'a@lifeis', title: 'Fête de la musique à Besançon, précédée d’un dîner très long chez Hélène et Zoë', day: '2046-06-21' }], new Date(Date.UTC(2046, 0, 1)));
  expect(file.split('\r\n').every((line) => new TextEncoder().encode(line).length <= 75)).toBe(true);
  expect(file.replace(/\r\n /g, '')).toContain('SUMMARY:Fête de la musique à Besançon\\, précédée d’un dîner très long chez Hélène et Zoë');
  expect(file).toContain('DTSTAMP:20460101T000000Z');
});
