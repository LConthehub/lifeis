/** Reminders that reach you: what goes in the morning digest, when, and the ways it's carried. */
import { beforeEach, expect, it } from 'vitest';
import type { Answer, Fetcher } from '../src/connections.ts';
import type { Db } from '../src/db.ts';
import { inventory } from '../src/inventory.ts';
import { kitchen } from '../src/kitchen.ts';
import type { Outgoing, Postbox } from '../src/mail.ts';
import { LATEST, migrate } from '../src/migrations.ts';
import { reminders, remindersDue, zoneNow, type PushSender } from '../src/reminders.ts';
import { upkeep } from '../src/upkeep.ts';
import { memoryDb } from './memoryDb.ts';

let db: Db;
let owner: number;
let time = new Date(2046, 2, 5, 10, 0, 0);
const clock = () => time;
const problem = (status: number) => expect.objectContaining({ name: 'Problem', status });

let posted: { url: string; headers: Record<string, string>; body: string }[];
const fetcher: Fetcher = async (url, headers, send) => {
  posted.push({ url, headers, body: send?.body ?? '' });
  return { status: 200, type: 'text/plain', json: async () => ({}), bytes: async () => new Uint8Array() } as Answer;
};
let mailed: Outgoing[];
const postbox: Postbox = {
  check: async () => {}, list: async () => ({ messages: [], unread: 0 }), read: async () => null, mark: async () => {},
  send: async (_s, message) => { mailed.push(message); },
};
const sealer = { seal: (s: string) => `sealed:${s}`, unseal: (s: string) => s.replace(/^sealed:/, '') };
let pushed: { endpoint: string; title: string; body: string }[];
const push: PushSender = async (to, message) => {
  if (to.endpoint.includes('gone')) return 'gone';
  pushed.push({ endpoint: to.endpoint, title: message.title, body: message.body });
  return 'sent';
};
const tools = { fetcher, mail: { postbox, sealer }, push };

async function person(name: string): Promise<number> {
  return (await db.run("INSERT INTO users (username, password_hash, created_at) VALUES (?, 'x', 'now')", [name])).lastId;
}

beforeEach(async () => {
  db = memoryDb();
  expect(await migrate(db)).toBe(LATEST);
  owner = await person('owner');
  time = new Date(2046, 2, 5, 10, 0, 0);
  posted = []; mailed = []; pushed = [];
});

it('the time and day in a time zone', () => {
  const at = new Date(Date.UTC(2046, 2, 5, 23, 30));
  expect(zoneNow(at, 'UTC')).toEqual({ day: '2046-03-05', time: '23:30' });
  expect(zoneNow(at, 'Asia/Tokyo')).toEqual({ day: '2046-03-06', time: '08:30' });
  expect(zoneNow(at, 'America/Los_Angeles')).toEqual({ day: '2046-03-05', time: '15:30' });
});

it('the digest gathers what needs the person, the pressing first, and leaves out what they turned off', async () => {
  const things = inventory(db, owner, clock);
  const kind = (await things.createKind({ name: 'Household' }))[0]!.id;
  await things.createItem({ kind_id: kind, name: 'Dish soap', quantity: 1, low_at: 1 });
  await upkeep(db, owner, clock).create({ name: 'Change the furnace filter', every_n: 3, every_unit: 'month', last_done: { day: '2045-11-20' } });
  await upkeep(db, owner, clock).create({ name: 'Clean the gutters', every_n: 6, every_unit: 'month', last_done: { day: '2045-09-20' } }); // a fortnight off: not yet
  await kitchen(db, owner, clock).savePantry({ name: 'Cream', quantity: 1, expires_on: '2046-03-05' });
  await db.run("INSERT INTO events (owner_id, title, day, yearly, created_at, updated_at) VALUES (?, 'Mum''s birthday', '1960-03-06', 1, 'now', 'now')", [owner]);
  await db.run("INSERT INTO coupons (owner_id, label, store, cents_off, expires_on, created_at) VALUES (?, 'Coffee', 'Costco', 150, '2046-03-06', 'now')", [owner]);

  const mine = reminders(db, owner, clock, tools);
  let d = await mine.digest();
  expect(d.lines.map((l) => [l.title, l.detail, l.urgent])).toEqual([
    ['Change the furnace filter', 'late by 13 days', true],
    ['Cream', 'use it today', true],
    ['Dish soap', 'running low: 1 left', false],
    ["Mum's birthday", 'tomorrow (86 years)', false],
    ['Coupon: Coffee', 'Costco · 1 day left', false],
  ]);
  expect(d.title).toBe('5 things for today, 2 pressing');
  expect(d.text.split('\n')[0]).toBe('! Change the furnace filter — late by 13 days');

  await mine.save({ covers: { upkeep: false, low: false, dates: true, coupons: false } });
  d = await mine.digest();
  expect(d.lines.map((l) => l.title)).toEqual(["Mum's birthday"]);
});

it('settings are checked, and an ntfy topic is made long and random when none is given', async () => {
  const mine = reminders(db, owner, clock, tools);
  expect(await mine.settings()).toMatchObject({ time: '07:30', email: false, ntfy: null, push: false });
  const s = await mine.save({ time: '06:45', zone: 'Europe/London', ntfy: { server: 'https://ntfy.sh/', topic: '', detail: 'count' } }, 'https://life.example');
  expect([s.time, s.zone, s.ntfy?.server, s.ntfy?.detail, s.origin]).toEqual(['06:45', 'Europe/London', 'https://ntfy.sh', 'count', 'https://life.example']);
  expect(s.ntfy?.topic).toMatch(/^lifeis-[a-z2-9]{15}$/);
  await expect(mine.save({ time: '7am' })).rejects.toEqual(problem(400));
  await expect(mine.save({ zone: 'Mars/Olympus' })).rejects.toEqual(problem(400));
  await expect(mine.save({ ntfy: { server: 'http://ntfy.example.com', topic: 'mytopic', detail: 'full' } })).rejects.toEqual(problem(400));
  expect((await mine.save({ ntfy: { server: 'http://ntfy.lan', topic: 'my_topic', detail: 'full' } })).ntfy).toEqual({ server: 'http://ntfy.lan', topic: 'my_topic', detail: 'full' });
});

it('each way carries it: email to yourself, ntfy saying only how many, and every browser that said yes', async () => {
  const mine = reminders(db, owner, clock, tools);
  await mine.save({ email: true, push: true, ntfy: { server: 'https://ntfy.sh', topic: 'lifeis-test-topic', detail: 'count' } }, 'https://life.example');
  await db.run("INSERT INTO mail_accounts (owner_id, address, name, username, password, imap_host, imap_port, smtp_host, smtp_port, local, created_at) VALUES (?, 'me@example.org', 'Ana', 'me', 'sealed:pw', 'imap.example.org', 993, 'smtp.example.org', 465, 0, 'now')", [owner]);
  await mine.addBrowser({ endpoint: 'https://push.example/abcdefghijk', p256dh: 'B'.repeat(40), auth: 'a'.repeat(16), label: 'Laptop' });
  await mine.addBrowser({ endpoint: 'https://push.example/gone-long-ago', p256dh: 'B'.repeat(40), auth: 'a'.repeat(16) });
  await upkeep(db, owner, clock).create({ name: 'Test the alarms', every_n: 1, every_unit: 'month' });

  const d = await mine.digest();
  expect(await mine.send(d)).toEqual({ sent: ['email', 'ntfy', 'push'], problems: [] });
  expect([mailed[0]!.to[0]!.address, mailed[0]!.subject, mailed[0]!.text]).toEqual(['me@example.org', 'Life Is: 1 thing for today, 1 pressing', '! Test the alarms — due today\n\nSee it all: https://life.example/']);
  expect(posted[0]).toEqual({ url: 'https://ntfy.sh/lifeis-test-topic', body: '1 thing needs you today. Open Life Is to see what.',
    headers: { Title: 'Life Is: 1 thing today', Tags: 'house', 'Content-Type': 'text/plain; charset=utf-8', Click: 'https://life.example/', Priority: 'high' } });
  expect(pushed).toEqual([{ endpoint: 'https://push.example/abcdefghijk', title: 'Life Is: 1 thing for today, 1 pressing', body: 'Test the alarms — due today' }]);
  expect((await mine.browsers()).map((b) => b.label)).toEqual(['Laptop']); // the one that stopped listening is forgotten

  // Without what each needs, it says so plainly.
  const bare = reminders(db, await person('bare'), clock, {});
  expect((await bare.send(d, 'email')).problems[0]).toMatch(/can't send email/);
  expect((await reminders(db, await person('nomail'), clock, tools).send(d, 'email')).problems[0]).toMatch(/Connect an email account first/);
  await expect(mine.addBrowser({ endpoint: 'http://not-https', p256dh: 'x', auth: 'y' })).rejects.toEqual(problem(400));
});

it('the morning round sends once a day, at each person’s time in their own zone, and nothing on a quiet day', async () => {
  const mine = reminders(db, owner, clock, tools);
  await mine.save({ time: '07:30', zone: 'America/New_York', ntfy: { server: 'https://ntfy.sh', topic: 'lifeis-round-test', detail: 'full' } });
  await upkeep(db, owner, clock).create({ name: 'Water the plants', every_n: 1, every_unit: 'week' });
  const quiet = await person('quiet');
  await reminders(db, quiet, clock, tools).save({ zone: 'UTC', ntfy: { server: 'https://ntfy.sh', topic: 'lifeis-quiet-one', detail: 'full' } });

  // 12:00 UTC is 07:00 in New York: not yet.
  expect(await remindersDue(db, new Date(Date.UTC(2046, 2, 5, 12, 0)), tools)).toEqual([{ user: quiet, sent: [], problems: [] }]);
  // 12:31 UTC is 07:31: it goes, once.
  expect(await remindersDue(db, new Date(Date.UTC(2046, 2, 5, 12, 31)), tools)).toEqual([{ user: owner, sent: ['ntfy'], problems: [] }]);
  expect(await remindersDue(db, new Date(Date.UTC(2046, 2, 5, 13, 0)), tools)).toEqual([]);
  expect(posted.map((p) => p.url)).toEqual(['https://ntfy.sh/lifeis-round-test']);
  expect(posted[0]!.body).toMatch(/^! Water the plants — due today/);
  // The next morning, again.
  expect((await remindersDue(db, new Date(Date.UTC(2046, 2, 6, 12, 45)), tools)).find((r) => r.user === owner)?.sent).toEqual(['ntfy']);
});

it('a line about making a copy comes after 30 days with records, at most weekly, never when off or with nothing kept', async () => {
  const mine = reminders(db, owner, clock, tools);
  const lines = async () => (await mine.digest()).lines.filter((l) => l.kind === 'copy').map((l) => l.title);
  const keepSomething = () => db.run("INSERT INTO events (owner_id, title, day, yearly, created_at, updated_at) VALUES (?, 'Dentist', '2046-09-09', 0, 'now', 'now')", [owner]);
  await db.run("UPDATE users SET created_at = '2046-01-01T09:00:00.000Z' WHERE id = ?", [owner]); // March 5 is 63 days on

  // A person with nothing kept is never told.
  expect(await lines()).toEqual([]);
  expect((await mine.copyState()).records).toBe(false);
  await keepSomething();

  // Never copied, long in use, records: it says how long they have been here, and the page's gentle line shows.
  expect(await lines()).toEqual(["Make a copy of your Life Is: it's been 63 days."]);
  expect(await mine.copyState()).toMatchObject({ last: null, days: null, records: true, stale: true, nudge: true });

  // A copy made today: nothing to say, and the state says when.
  await mine.copyMade();
  expect(await mine.copyState()).toMatchObject({ last: '2046-03-05', days: 0, stale: false, nudge: false });
  expect(await lines()).toEqual([]);
  // Thirty days on is not yet more than thirty.
  time = new Date(2046, 3, 4, 10, 0, 0);
  expect(await lines()).toEqual([]);
  expect((await mine.copyState()).stale).toBe(false);
  // The day after that it is.
  time = new Date(2046, 3, 5, 10, 0, 0);
  expect(await lines()).toEqual(["Make a copy of your Life Is: it's been 31 days."]);

  // Said in a morning round it is not said again for a week.
  const d = await mine.digest();
  await mine.markSent('2046-04-05', d);
  expect(await lines()).toEqual([]);
  time = new Date(2046, 3, 11, 10, 0, 0); // six days on
  expect(await lines()).toEqual([]);
  time = new Date(2046, 3, 12, 10, 0, 0); // seven
  expect(await lines()).toEqual(["Make a copy of your Life Is: it's been 38 days."]);

  // Turned off in the digest's own choices, it stays quiet; a new copy resets it.
  await mine.save({ covers: { copy: false } });
  expect(await lines()).toEqual([]);
  expect((await mine.copyState()).remind).toBe(false);
  await mine.save({ covers: { copy: true } });
  expect(await lines()).toHaveLength(1);
  await mine.copyMade();
  expect(await lines()).toEqual([]);

  // Someone else's copy and records are their own.
  const other = reminders(db, await person('other'), clock, tools);
  expect(await other.copyState()).toMatchObject({ last: null, records: false, stale: false });
});

it('a new person with records is not nagged in their first week, and the morning round records that the line was said', async () => {
  await db.run("UPDATE users SET created_at = '2046-03-01T09:00:00.000Z' WHERE id = ?", [owner]);
  await db.run("INSERT INTO events (owner_id, title, day, yearly, created_at, updated_at) VALUES (?, 'Dentist', '2046-09-09', 0, 'now', 'now')", [owner]);
  const mine = reminders(db, owner, clock, tools);
  expect(await mine.copyState()).toMatchObject({ started_days: 4, records: true, stale: false });
  await db.run("UPDATE users SET created_at = '2045-12-01T09:00:00.000Z' WHERE id = ?", [owner]);
  await mine.save({ time: '07:30', zone: 'UTC', ntfy: { server: 'https://ntfy.sh', topic: 'lifeis-copy-test', detail: 'full' } });
  expect(await remindersDue(db, new Date(Date.UTC(2046, 2, 5, 8, 0)), tools)).toEqual([{ user: owner, sent: ['ntfy'], problems: [] }]);
  expect(posted[0]!.body).toMatch(/Make a copy of your Life Is: it's been 94 days/);
  expect((await mine.settings()).copy_nudged).toBe('2046-03-05');
  // The next morning there is nothing to say, so nothing is sent.
  expect(await remindersDue(db, new Date(Date.UTC(2046, 2, 6, 8, 0)), tools)).toEqual([{ user: owner, sent: [], problems: [] }]);
  expect(posted).toHaveLength(1);
});
