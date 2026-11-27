/** "Don't forget": a few quiet lines, pushed away with Later or Not now, and nothing at all when nothing qualifies. */
import { beforeEach, expect, it } from 'vitest';
import type { Db } from '../src/db.ts';
import { dontForget } from '../src/dontForget.ts';
import { kitchen } from '../src/kitchen.ts';
import { migrate } from '../src/migrations.ts';
import { projects } from '../src/projects.ts';
import { upkeep } from '../src/upkeep.ts';
import { memoryDb } from './memoryDb.ts';

let db: Db;
let owner: number;
let now = new Date(2046, 2, 5, 10, 0, 0);
const clock = () => now;
const ymd = (n: number) => { const d = new Date(2046, 2, 5 + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const mine = () => dontForget(db, owner, clock);

beforeEach(async () => {
  db = memoryDb();
  await migrate(db);
  now = new Date(2046, 2, 5, 10, 0, 0);
  owner = (await db.run("INSERT INTO users (username, password_hash, created_at) VALUES ('owner', 'x', 'now')", [])).lastId;
});

it('says nothing when nothing qualifies', async () => {
  await kitchen(db, owner, clock).savePantry({ name: 'Rice', quantity: 2, unit: 'lb', expires_on: ymd(40) });
  await upkeep(db, owner, clock).create({ name: 'Water the plants', kind: 'chore', every_n: 1, every_unit: 'week', last_done: { day: ymd(-3) } });
  expect(await mine().lines()).toEqual([]);
});

it('names food near its date, a project left alone, a bill coming and a chore not done for a while, three at most', async () => {
  await kitchen(db, owner, clock).savePantry({ name: 'Milk', quantity: 1, unit: 'cup', expires_on: ymd(1) });
  const p = await projects(db, owner, clock).createProject({ name: 'Garden shed', status: 'active' });
  await db.run('UPDATE projects SET updated_at = ? WHERE id = ?', [`${ymd(-21)}T09:00:00+00:00`, p.id]);
  const jobs = upkeep(db, owner, clock);
  const counters = await jobs.create({ name: 'Wipe the counters', kind: 'chore', every_n: 1, every_unit: 'day', last_done: { day: ymd(-12) } });
  await jobs.create({ name: 'Electricity', kind: 'bill', first_due: ymd(3), every_n: 1, every_unit: 'month' });
  const lines = await mine().lines();
  expect(lines.map((l) => l.text)).toEqual(['Milk: use by tomorrow', 'Electricity: due in 3 days', "Wipe the counters: it's been a while (12 days)"]);
  expect(lines.map((l) => l.to)).toEqual(['/pantry', expect.stringMatching(/^\/things\/upkeep\/\d+$/), `/things/upkeep/${counters.id}`]);
  expect(lines[2]!.job_id).toBe(counters.id);
  // Take the bill away and the project takes its place.
  await mine().push(lines[1]!.key, 'later');
  expect((await mine().lines()).map((l) => l.text)).toEqual(['Milk: use by tomorrow', "Wipe the counters: it's been a while (12 days)", 'Garden shed: untouched for 3 weeks']);
});

it('leaves out what the Home cards on screen already list', async () => {
  await kitchen(db, owner, clock).savePantry({ name: 'Milk', quantity: 1, unit: 'cup', expires_on: ymd(1) });
  const p = await projects(db, owner, clock).createProject({ name: 'Garden shed', status: 'active' });
  await db.run('UPDATE projects SET updated_at = ? WHERE id = ?', [`${ymd(-21)}T09:00:00+00:00`, p.id]);
  const jobs = upkeep(db, owner, clock);
  await jobs.create({ name: 'Wipe the counters', kind: 'chore', every_n: 1, every_unit: 'day', last_done: { day: ymd(-12) } });
  await jobs.create({ name: 'Electricity', kind: 'bill', first_due: ymd(5), every_n: 1, every_unit: 'month' });
  const texts = async (shown: string[]) => (await mine().lines(shown)).map((l) => l.text);
  // The next three days lists the late chore, the pantry card lists the milk; the bill in 5 days is past that window.
  expect(await texts(['days', 'pantry'])).toEqual(['Electricity: due in 5 days', 'Garden shed: untouched for 3 weeks']);
  // The upkeep card lists every bill and job coming up.
  expect(await texts(['days', 'pantry', 'upkeep'])).toEqual(['Garden shed: untouched for 3 weeks']);
});

it('Later hides a line for a week, and Not now until the thing changes', async () => {
  const k = kitchen(db, owner, clock);
  await k.savePantry({ name: 'Milk', quantity: 1, unit: 'cup', expires_on: ymd(1) });
  await k.savePantry({ name: 'Cream', quantity: 1, unit: 'cup', expires_on: ymd(2) });
  const [milk, cream] = await mine().lines();
  await mine().push(milk!.key, 'later');
  await mine().push(cream!.key, 'notnow');
  expect(await mine().lines()).toEqual([]);
  // A week on, Milk is back (and past its date); Cream stays away until its date changes.
  now = new Date(2046, 2, 12, 10, 0, 0);
  expect((await mine().lines()).map((l) => l.text)).toEqual(['Milk: past its use-by date']);
  await k.savePantry({ name: 'Cream', quantity: 1, unit: 'cup', expires_on: ymd(8) });
  expect((await mine().lines()).map((l) => l.text)).toEqual(['Milk: past its use-by date', 'Cream: use by tomorrow']);
});

it('keeps one person\'s choices apart from another\'s, and refuses what it does not know', async () => {
  await kitchen(db, owner, clock).savePantry({ name: 'Milk', quantity: 1, unit: 'cup', expires_on: ymd(1) });
  const other = (await db.run("INSERT INTO users (username, password_hash, created_at) VALUES ('other', 'x', 'now')", [])).lastId;
  const [milk] = await mine().lines();
  await mine().push(milk!.key, 'later');
  expect(await mine().lines()).toEqual([]);
  await expect(mine().push('pantry-99999', 'later')).rejects.toThrow();
  await expect(mine().push(milk!.key, 'never')).rejects.toThrow();
  await expect(dontForget(db, other, clock).push(milk!.key, 'later')).rejects.toThrow();
});
