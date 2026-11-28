/** The "leave by" line in the morning reminder, and the minutes to get there on an event. */
import { beforeEach, expect, it } from 'vitest';
import { calendar } from '../src/calendar.ts';
import type { Db } from '../src/db.ts';
import { bringInDownload, exportEverything, splitDownload } from '../src/exportAll.ts';
import { LATEST, migrate } from '../src/migrations.ts';
import { reminders } from '../src/reminders.ts';
import { memoryDb } from './memoryDb.ts';

let db: Db;
let ana: number;
let bob: number;
let time = new Date(2046, 2, 6, 10, 0, 0);
const clock = Object.assign(() => time, { today: () => '2046-03-06' });
const problem = (status: number) => expect.objectContaining({ name: 'Problem', status });

async function person(name: string): Promise<number> {
  return (await db.run("INSERT INTO users (username, password_hash, created_at) VALUES (?, 'x', 'now')", [name])).lastId;
}

beforeEach(async () => {
  db = memoryDb();
  expect(await migrate(db)).toBe(LATEST);
  time = new Date(2046, 2, 6, 10, 0, 0);
  ana = await person('ana');
  bob = await person('bob');
});
// ---------- leave by ----------

it('the morning round says when to leave for an event that has a time and minutes to get there', async () => {
  const cal = calendar(db, ana, clock);
  const dentist = await cal.createEvent({ title: 'Dentist', day: '2046-03-06', time: '15:00', travel_minutes: 25 });
  expect(dentist.travel_minutes).toBe(25);
  await cal.createEvent({ title: 'Haircut', day: '2046-03-06', time: '09:30' });
  await cal.createEvent({ title: 'Market', day: '2046-03-06', travel_minutes: null });
  await cal.createEvent({ title: 'Pickup', day: '2046-03-07', time: '15:00', travel_minutes: 20 });
  const lines = (await reminders(db, ana, clock).digest()).lines.filter((l) => l.kind === 'dates');
  expect(lines.map((l) => l.title)).toContain('Dentist at 3:00 pm. Leave by 2:35 pm.');
  expect(lines.find((l) => l.title === 'Haircut')).toMatchObject({ detail: 'today at 09:30' });
  expect(lines.find((l) => l.title === 'Market')).toMatchObject({ detail: 'today' });
  expect(lines.map((l) => l.title).join('|')).not.toContain('Pickup');
  // Someone else's morning does not have it.
  expect((await reminders(db, bob, clock).digest()).lines).toEqual([]);
});

it('the minutes to get there are a whole number, need a time, and are kept when the event is reworded', async () => {
  const cal = calendar(db, ana, clock);
  await expect(cal.createEvent({ title: 'Dentist', day: '2046-03-06', time: '15:00', travel_minutes: 0 })).rejects.toEqual(problem(400));
  await expect(cal.createEvent({ title: 'Dentist', day: '2046-03-06', time: '15:00', travel_minutes: 12.5 })).rejects.toEqual(problem(400));
  await expect(cal.createEvent({ title: 'Dentist', day: '2046-03-06', time: '15:00', travel_minutes: 9000 })).rejects.toEqual(problem(400));
  await expect(cal.createEvent({ title: 'Dentist', day: '2046-03-06', travel_minutes: 20 })).rejects.toEqual(problem(400));
  const made = await cal.createEvent({ title: 'Dentist', day: '2046-03-06', time: '15:00', travel_minutes: 25 });
  expect((await cal.updateEvent(made.id, { title: 'Dentist', day: '2046-03-06', time: '16:00', travel_minutes: 40 })).travel_minutes).toBe(40);
  expect((await cal.updateEvent(made.id, { title: 'Dentist', day: '2046-03-06', time: '16:00' })).travel_minutes).toBeNull();
  // Just after midnight, the time to leave is the evening before.
  const night = await cal.createEvent({ title: 'Early flight', day: '2046-03-06', time: '00:20', travel_minutes: 35 });
  expect((await reminders(db, ana, clock).digest()).lines.map((l) => l.title)).toContain('Early flight at 12:20 am. Leave by 11:45 pm.');
  expect(night.id).toBeGreaterThan(0);
});

it('the minutes to get there go out in the download and come back, and an older download still does', async () => {
  const cal = calendar(db, ana, clock);
  await cal.createEvent({ title: 'Dentist', day: '2046-03-06', time: '15:00', travel_minutes: 25 });
  await cal.createEvent({ title: 'Picnic', day: '2046-03-08' });
  const { files } = await splitDownload((await exportEverything(db, ana, clock)).bytes);
  expect(files['events.csv']).toContain('Minutes to get there');
  await bringInDownload(db, bob, files, ['events'], clock);
  expect((await db.all('SELECT title, travel_minutes FROM events WHERE owner_id = ? ORDER BY day', [bob]))).toEqual([{ title: 'Dentist', travel_minutes: 25 }, { title: 'Picnic', travel_minutes: null }]);
  const older = { ...files, 'events.csv': 'Title,Day,Ends on,Time,Every year,Notes\nBook club,2046-04-01,,19:00,,\n' };
  const dana = await person('dana');
  expect((await bringInDownload(db, dana, older, ['events'], clock)).kinds.find((k) => k.key === 'events')).toMatchObject({ ok: true, fresh: 1 });
  expect(await db.get('SELECT title, travel_minutes FROM events WHERE owner_id = ?', [dana])).toEqual({ title: 'Book club', travel_minutes: null });
});
