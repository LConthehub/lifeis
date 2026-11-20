/** Other calendars followed by their link: what is read, and how little of it is kept. */
import { beforeEach, expect, it } from 'vitest';
import { calendar } from '../src/calendar.ts';
import type { Fetcher, Sealer } from '../src/connections.ts';
import type { Db } from '../src/db.ts';
import { calendarFeed, feedFor } from '../src/feed.ts';
import { followedCalendars, followedDue, readCalendar } from '../src/follow.ts';
import { migrate } from '../src/migrations.ts';
import { memoryDb } from './memoryDb.ts';

let db: Db;
let owner: number;
let time: Date;
let served: string | number;
let asked: string[];
const clock = Object.assign(() => time, { today: () => '2046-03-05' });
const sealer: Sealer = { seal: (plain) => `locked(${plain})`, unseal: (sealed) => /^locked\((.*)\)$/.exec(sealed)?.[1] ?? null };
const fetcher: Fetcher = async (url) => {
  asked.push(url);
  if (served === 'down') throw new Error('no route');
  return { status: typeof served === 'number' ? served : 200, type: 'text/calendar', json: async () => ({}), bytes: async () => new TextEncoder().encode(String(served)) };
};
const tools = { fetcher, sealer };

const file = (...events: string[][]) => ['BEGIN:VCALENDAR', 'VERSION:2.0', ...events.flatMap((e) => ['BEGIN:VEVENT', ...e, 'END:VEVENT']), 'END:VCALENDAR'].join('\r\n');
const WORK = file(
  ['UID:1', 'DTSTART:20460306T190000Z', 'DTEND:20460306T210000Z', 'SUMMARY:Client: A. Person', 'LOCATION:Hotel Grand\\, room 12', 'DESCRIPTION:Private notes'],
  ['UID:2', 'DTSTART;VALUE=DATE:20460310', 'DTEND;VALUE=DATE:20460313', 'SUMMARY:Tour: Chicago'],
  ['UID:3', 'DTSTART:20460307T150000Z', 'DTEND:20460307T160000Z', 'SUMMARY:Called off', 'STATUS:CANCELLED'],
);

async function person(name: string): Promise<number> {
  return (await db.run("INSERT INTO users (username, password_hash, created_at) VALUES (?, 'x', 'now')", [name])).lastId;
}

beforeEach(async () => {
  db = memoryDb();
  await migrate(db);
  owner = await person('owner');
  time = new Date(Date.UTC(2046, 2, 5, 10, 0, 0));
  served = WORK;
  asked = [];
});

const problem = (status: number) => expect.objectContaining({ name: 'Problem', status });
const everythingKept = async () => JSON.stringify([await db.all('SELECT * FROM followed_calendars'), await db.all('SELECT * FROM followed_events')]);

it('a calendar followed busy only keeps the times and nothing else', async () => {
  const mine = followedCalendars(db, owner, clock, tools);
  expect(await mine.list()).toEqual([]);
  const [work] = await mine.add({ name: 'Work', url: 'webcal://sworkr.example.org/busy/abc.ics', zone: 'America/Chicago' });
  expect(work).toMatchObject({ name: 'Work', show: 'busy', zone: 'America/Chicago', events: 2, problem: null });
  expect(asked).toEqual(['https://sworkr.example.org/busy/abc.ics']);

  // 19:00 universal time is 13:00 in Chicago in early March. The whole days are whole days.
  const week = await calendar(db, owner, clock).between('2046-03-05', 10);
  expect(week.map((e) => [e.kind, e.day, e.time, e.title, e.detail, e.link])).toEqual([
    ['outside', '2046-03-06', '13:00', 'Work', 'until 15:00', null],
    ['outside', '2046-03-10', null, 'Work', null, null],
    ['outside', '2046-03-11', null, 'Work', null, null],
    ['outside', '2046-03-12', null, 'Work', null, null],
  ]);
  // Nothing of what the calendar said about each thing is anywhere in the database, and the link is locked.
  const kept = await everythingKept();
  for (const word of ['Client', 'Person', 'Hotel', 'Private', 'Tour', 'Called off']) expect(kept).not.toContain(word);
  expect(kept).toContain('locked(https://sworkr.example.org/busy/abc.ics)');
  expect(JSON.stringify(await mine.list())).not.toContain('sworkr.example.org');
});

it('titles are kept only when asked for, dropped at once when not, and never the place or notes', async () => {
  const mine = followedCalendars(db, owner, clock, tools);
  const [family] = await mine.add({ name: 'Family', url: 'https://cal.example.org/f.ics', show: 'titles', zone: 'America/Chicago' });
  let week = await calendar(db, owner, clock).between('2046-03-05', 10);
  expect(week.slice(0, 2).map((e) => [e.title, e.detail])).toEqual([['Client: A. Person', 'until 15:00 · Family'], ['Tour: Chicago', 'Family']]);
  expect(await everythingKept()).not.toContain('Hotel');
  expect(await everythingKept()).not.toContain('Private notes');

  await mine.update(family!.id, { name: 'Family', show: 'busy' });
  expect(await everythingKept()).not.toContain('Client');
  expect(asked).toHaveLength(1); // asking for less needs nothing from outside
  await mine.update(family!.id, { name: 'Home', show: 'titles' });
  expect(asked).toHaveLength(2); // asking for more means reading it again
  week = await calendar(db, owner, clock).between('2046-03-05', 10);
  expect(week[0]).toMatchObject({ title: 'Client: A. Person', detail: 'until 15:00 · Home' });
});

it('a link is only saved if it answers with a calendar, and a later failure keeps what was read', async () => {
  const mine = followedCalendars(db, owner, clock, tools);
  await expect(mine.add({ name: '', url: 'https://cal.example.org/a.ics' })).rejects.toEqual(problem(400));
  await expect(mine.add({ name: 'Work', url: 'ftp://cal.example.org/a.ics' })).rejects.toEqual(problem(400));
  await expect(mine.add({ name: 'Work', url: 'https://me:secret@cal.example.org/a.ics' })).rejects.toEqual(problem(400));
  await expect(mine.add({ name: 'Work', url: 'https://cal.example.org/a.ics', zone: 'Mars/Olympus' })).rejects.toEqual(problem(400));
  await expect(mine.add({ name: 'Work', url: 'https://cal.example.org/a.ics', show: 'everything' })).rejects.toEqual(problem(400));
  served = '<html>Sign in</html>';
  await expect(mine.add({ name: 'Work', url: 'https://cal.example.org/a.ics' })).rejects.toEqual(problem(400));
  served = 404;
  await expect(mine.add({ name: 'Work', url: 'https://cal.example.org/a.ics' })).rejects.toEqual(problem(400));
  served = 'down';
  await expect(mine.add({ name: 'Work', url: 'https://cal.example.org/a.ics' })).rejects.toEqual(problem(400));
  expect(await mine.list()).toEqual([]);
  await expect(followedCalendars(db, owner, clock).add({ name: 'Work', url: 'https://cal.example.org/a.ics' })).rejects.toEqual(problem(400));

  served = WORK;
  const [work] = await mine.add({ name: 'Work', url: 'https://cal.example.org/a.ics' });
  served = 'down';
  const [after] = await mine.refresh(work!.id);
  expect([after!.events, after!.problem]).toEqual([2, expect.stringContaining("Couldn't reach")]);
  served = WORK;
  expect((await mine.refresh(work!.id))[0]!.problem).toBeNull();

  // Somebody else can't touch it, and it's gone with its times when removed.
  const other = followedCalendars(db, await person('other'), clock, tools);
  await expect(other.refresh(work!.id)).rejects.toEqual(problem(404));
  await expect(other.remove(work!.id)).rejects.toEqual(problem(404));
  expect(await mine.remove(work!.id)).toEqual([]);
  expect(await db.all('SELECT * FROM followed_events')).toEqual([]);
});

it('followed calendars are read again once an hour, and stay out of the link for a phone', async () => {
  const mine = followedCalendars(db, owner, clock, tools);
  await mine.add({ name: 'Work', url: 'https://cal.example.org/a.ics' });
  expect([await followedDue(db, clock, tools), asked.length]).toEqual([0, 1]);
  time = new Date(time.getTime() + 61 * 60_000);
  expect([await followedDue(db, clock, tools), asked.length]).toEqual([1, 2]);
  expect(await followedDue(db, clock, tools)).toBe(0);

  const { token } = await calendarFeed(db, owner, clock).turnOn(['event', 'plan', 'meal', 'due', 'use_by', 'session', 'media']);
  expect((await feedFor(db, token!, clock))!.includes('Work')).toBe(false);
});

it('a calendar file is read: repeats, exceptions, zones and lengths', () => {
  const read = (events: string[][], zone = 'America/Chicago', titles = true) => readCalendar(file(...events), zone, '2046-03-01', '2046-03-31', titles);
  // Weekly on Monday and Wednesday, one skipped, one moved to another time.
  const weekly = read([
    ['UID:w', 'DTSTART;TZID=America/Chicago:20460305T090000', 'DTEND;TZID=America/Chicago:20460305T100000', 'RRULE:FREQ=WEEKLY;BYDAY=MO,WE;UNTIL=20460316T235959Z', 'EXDATE;TZID=America/Chicago:20460307T090000', 'SUMMARY:Standup'],
    ['UID:w', 'RECURRENCE-ID;TZID=America/Chicago:20460312T090000', 'DTSTART;TZID=America/Chicago:20460312T140000', 'DTEND;TZID=America/Chicago:20460312T150000', 'SUMMARY:Standup (late)'],
  ]);
  expect(weekly.map((e) => [e.day, e.time, e.end_time, e.title])).toEqual([
    ['2046-03-05', '09:00', '10:00', 'Standup'], ['2046-03-12', '09:00', '10:00', 'Standup'], ['2046-03-12', '14:00', '15:00', 'Standup (late)'], ['2046-03-14', '09:00', '10:00', 'Standup'],
  ].filter((row) => !(row[0] === '2046-03-12' && row[1] === '09:00')));

  // A time in another zone is said on the clock here; one with no zone is taken as written.
  expect(read([['DTSTART;TZID=Europe/London:20460306T180000', 'DURATION:PT90M', 'SUMMARY:Call']])[0]).toMatchObject({ day: '2046-03-06', time: '12:00', end_time: '13:30' });
  expect(read([['DTSTART:20460306T180000', 'SUMMARY:Supper']])[0]).toMatchObject({ day: '2046-03-06', time: '18:00', end_time: null });
  // Late in the evening, universal time is already tomorrow: the day is the day here.
  expect(read([['DTSTART:20460307T030000Z', 'DTEND:20460307T040000Z']])[0]).toMatchObject({ day: '2046-03-06', time: '21:00', end_time: '22:00' });
  // Daily three times, a birthday every year from long ago, and a monthly 31st that skips short months.
  expect(read([['DTSTART;VALUE=DATE:20460310', 'RRULE:FREQ=DAILY;COUNT=3']]).map((e) => e.day)).toEqual(['2046-03-10', '2046-03-11', '2046-03-12']);
  expect(read([['DTSTART;VALUE=DATE:19580307', 'RRULE:FREQ=YEARLY', 'SUMMARY:Mum']]).map((e) => [e.day, e.end_day])).toEqual([['2046-03-07', null]]);
  expect(readCalendar(file(['DTSTART;VALUE=DATE:20460131', 'RRULE:FREQ=MONTHLY']), 'UTC', '2046-02-01', '2046-04-30', true).map((e) => e.day)).toEqual(['2046-03-31']);
  // Without titles asked for, none is read; an alarm inside an event doesn't confuse it.
  expect(read([['DTSTART:20460306T180000', 'SUMMARY:Secret', 'BEGIN:VALARM', 'TRIGGER:-PT15M', 'DESCRIPTION:Secret', 'END:VALARM']], 'UTC', false)).toEqual([{ day: '2046-03-06', end_day: null, time: '18:00', end_time: null, title: null }]);
  expect(() => readCalendar('hello', 'UTC', '2046-03-01', '2046-03-31', true)).toThrow();
});
