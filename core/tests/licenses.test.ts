/** Licenses and permits: kept per person, tied to a renewal in upkeep, and the number kept out of everywhere else. */
import { beforeEach, expect, it } from 'vitest';
import { accessNow, decide } from '../src/access.ts';
import { makeBackup, restoreBackup } from '../src/backup.ts';
import type { Db } from '../src/db.ts';
import { calendarFeed, feedFor } from '../src/feed.ts';
import { LICENSE_CATEGORIES, LICENSE_STARTERS, defaultLead, expiring, licenses, renewalName, type Licenses } from '../src/licenses.ts';
import { LATEST, migrate } from '../src/migrations.ts';
import { reminders } from '../src/reminders.ts';
import { search } from '../src/search.ts';
import { upkeep } from '../src/upkeep.ts';
import { memoryDb } from './memoryDb.ts';

let db: Db;
let owner: number;
let mine: Licenses;
let time = new Date(2046, 2, 5, 10, 0, 0); // March 5, 2046
const clock = Object.assign(() => time, { today: () => '2046-03-05' });
const problem = (status: number) => expect.objectContaining({ name: 'Problem', status });
const NUMBER = 'D123-4567-8901';

async function person(name: string): Promise<number> {
  return (await db.run("INSERT INTO users (username, password_hash, created_at) VALUES (?, 'x', 'now')", [name])).lastId;
}
const jobs = () => upkeep(db, owner, clock);

beforeEach(async () => {
  db = memoryDb();
  expect(await migrate(db)).toBe(LATEST);
  owner = await person('owner');
  time = new Date(2046, 2, 5, 10, 0, 0);
  mine = licenses(db, owner, clock);
});

it('a license is kept with who it is for and when it runs out, cleaned and checked, and is only its person\'s', async () => {
  const made = await mine.create({ name: "  Driver's license ", category: 'Driving', holder: ' Dana ', number: NUMBER, issuer: 'Your state DMV', issued_on: '2042-04-04', expires_on: '2046-04-04', note: 'In the blue wallet' });
  expect([made.name, made.holder, made.number, made.category, made.has_number, made.days_left, made.state, made.reminder]).toEqual(["Driver's license", 'Dana', NUMBER, 'Driving', true, 30, 'soon', null]);
  // The list never carries the number; the one license does.
  const listed = (await mine.list())[0]!;
  expect(listed.has_number).toBe(true);
  expect(Object.keys(listed)).not.toContain('number');
  expect(JSON.stringify(await mine.list())).not.toContain(NUMBER);

  await expect(mine.create({ name: ' ' })).rejects.toEqual(problem(400));
  await expect(mine.create({ name: 'Boat', category: 'Boats' })).rejects.toEqual(problem(400));
  await expect(mine.create({ name: 'Boat', expires_on: '2046-02-30' })).rejects.toEqual(problem(400));
  await expect(mine.create({ name: 'Boat', issued_on: '2046-05-01', expires_on: '2046-04-01' })).rejects.toEqual(problem(400));
  expect((await mine.create({ name: 'Library card', category: '', expires_on: '' })).state).toBe('none');
  expect(LICENSE_CATEGORIES).toEqual(['Driving', 'Travel', 'Work', 'Outdoors', 'Pets', 'Vehicle', 'Other']);

  const changed = await mine.update(made.id, { name: "Driver's license", holder: 'Dana', issuer: 'Your state DMV', expires_on: '2046-04-04' });
  expect([changed.number, changed.has_number, changed.note]).toEqual([null, false, null]); // a change says everything, as the other modules do

  const other = licenses(db, await person('other'), clock);
  expect(await other.list()).toEqual([]);
  await expect(other.get(made.id)).rejects.toEqual(problem(404));
  await expect(other.update(made.id, { name: 'Mine now' })).rejects.toEqual(problem(404));
  await expect(other.remind(made.id)).rejects.toEqual(problem(404));
  await expect(other.remove(made.id)).rejects.toEqual(problem(404));
  expect((await mine.get(made.id)).name).toBe("Driver's license");
});

it('"remind me to renew" makes a renewal in upkeep first due a lead before it runs out', async () => {
  const lic = await mine.create({ name: "Driver's license", holder: 'Dana', category: 'Driving', expires_on: '2046-09-30' });
  await expect(mine.remind((await mine.create({ name: 'No end' })).id)).rejects.toEqual(problem(400)); // nothing to count back from
  await expect(mine.remind(lic.id, { lead_n: 5, lead_unit: 'decade' })).rejects.toEqual(problem(400));
  await expect(mine.remind(lic.id, { term_years: 0 })).rejects.toEqual(problem(400));

  // The usual lead is 30 days.
  const set = await mine.remind(lic.id, { term_years: 4 });
  const job = await jobs().get(set.reminder!.job_id);
  expect([job.name, job.kind, job.first_due, job.every, job.activity]).toEqual(["Renew Dana's driver's license", 'renewal', '2046-08-31', { n: 4, unit: 'year' }, 'Papers']);
  expect(set.reminder).toMatchObject({ lead: { n: 30, unit: 'day' }, term_years: 4, due_on: '2046-08-31', state: 'later', renewed: false });

  // Another lead, set again: the same renewal moves rather than a second being made.
  const weeks = await mine.remind(lic.id, { lead_n: 2, lead_unit: 'week' });
  expect(weeks.reminder).toMatchObject({ job_id: job.id, due_on: '2046-09-16', term_years: 4 }); // the term is kept when not said again
  const months = await mine.remind(lic.id, { lead_n: 6, lead_unit: 'month', term_years: 8 });
  expect(months.reminder).toMatchObject({ job_id: job.id, due_on: '2046-03-30', term_years: 8, lead: { n: 6, unit: 'month' } });
  expect((await jobs().list()).filter((j) => j.kind === 'renewal')).toHaveLength(1);
  const once = await mine.remind(lic.id, { term_years: null });
  expect(once.reminder).toMatchObject({ job_id: job.id, term_years: null, due_on: '2046-03-30' });

  // A passport: Travel starts 6 months out, and says why.
  const passport = await mine.create({ name: 'Passport', holder: 'Dana', category: 'Travel', expires_on: '2047-01-31' });
  const p = await mine.remind(passport.id, { term_years: 10 });
  expect(p.reminder).toMatchObject({ lead: { n: 6, unit: 'month' }, due_on: '2046-07-31', term_years: 10 });
  expect((await jobs().get(p.reminder!.job_id)).note).toContain('6 months');
  expect(defaultLead('Travel').why).toContain('6 months');
  expect(defaultLead('Driving')).toMatchObject({ n: 30, unit: 'day', why: null });

  // With no term it is a one-time reminder; when it is done, it is finished with.
  const card = await mine.create({ name: 'TSA PreCheck', category: 'Travel', expires_on: '2046-12-01' });
  const c = await mine.remind(card.id);
  expect((await jobs().get(c.reminder!.job_id)).every).toBeNull();
  expect((await jobs().get(c.reminder!.job_id)).name).toBe('Renew TSA PreCheck');
  expect(renewalName('Passport', null)).toBe('Renew passport');
  expect(renewalName('CPR certification', 'Sam')).toBe("Renew Sam's CPR certification");
});

it('changing the expiry day moves the renewal, and a renewal marked done leaves the license asking for the new day', async () => {
  const lic = await mine.create({ name: "Driver's license", holder: 'Dana', category: 'Driving', expires_on: '2046-04-04' });
  const set = await mine.remind(lic.id, { term_years: 4 });
  expect(set.reminder).toMatchObject({ due_on: '2046-03-05', state: 'due' });

  // The expiry moves; so does the renewal. The name follows a changed holder too.
  let now = await mine.update(lic.id, { name: "Driver's license", holder: 'Dana', category: 'Driving', expires_on: '2046-06-10' });
  expect(now.reminder).toMatchObject({ due_on: '2046-05-11', renewed: false });
  now = await mine.update(lic.id, { name: "Driver's license", holder: 'Dana L.', category: 'Driving', expires_on: '2046-06-10' });
  expect((await jobs().get(set.reminder!.job_id)).name).toBe("Renew Dana L.'s driver's license");
  // A renewal someone renamed is not renamed back.
  await jobs().update(set.reminder!.job_id, { name: 'Do the DMV thing', first_due: '2046-05-11', every_n: 4, every_unit: 'year' });
  await mine.update(lic.id, { name: "Driver's license", holder: 'Dana', category: 'Driving', expires_on: '2046-06-10' });
  expect((await jobs().get(set.reminder!.job_id)).name).toBe('Do the DMV thing');

  // Done in Upkeep: the renewal goes on a term; the license is NOT changed, and says so until its day moves.
  await jobs().done(set.reminder!.job_id, { day: '2046-05-20' });
  const asked = await mine.get(lic.id);
  expect([asked.expires_on, asked.reminder!.renewed, asked.reminder!.due_on]).toEqual(['2046-06-10', true, '2050-05-11']);
  expect((await mine.list())[0]!.reminder!.renewed).toBe(true);
  const moved = await mine.update(lic.id, { name: "Driver's license", holder: 'Dana', category: 'Driving', expires_on: '2050-06-10' });
  expect([moved.reminder!.renewed, moved.reminder!.due_on]).toEqual([false, '2050-05-11']);

  // A one-time reminder that was done is armed again by a new expiry day.
  const once = await mine.create({ name: 'Boating license', category: 'Outdoors', expires_on: '2046-05-05' });
  const o = await mine.remind(once.id);
  await jobs().done(o.reminder!.job_id, { day: '2046-03-06' });
  const done = await mine.get(once.id);
  expect([done.reminder!.renewed, done.reminder!.due_on]).toEqual([true, null]);
  const again = await mine.update(once.id, { name: 'Boating license', category: 'Outdoors', expires_on: '2049-05-05' });
  expect([again.reminder!.renewed, again.reminder!.due_on]).toEqual([false, '2049-04-05']);

  // A license that has run out is flagged as it is.
  const old = await mine.create({ name: 'Fishing license', expires_on: '2046-02-20' });
  expect([old.state, old.days_left]).toEqual(['expired', -13]);
});

it('removing the license asks about its reminder, and removing the reminder leaves the license', async () => {
  const a = await mine.remind((await mine.create({ name: 'Passport', holder: 'Dana', expires_on: '2046-12-01' })).id, { term_years: 10 });
  const b = await mine.remind((await mine.create({ name: 'Hunting license', holder: 'Sam', expires_on: '2046-12-01' })).id);
  const c = await mine.remind((await mine.create({ name: 'Fishing license', holder: 'Sam', expires_on: '2046-12-01' })).id);
  expect(await jobs().list()).toHaveLength(3);

  await mine.remove(a.id, true);                       // with its reminder
  expect((await jobs().list()).map((j) => j.id)).not.toContain(a.reminder!.job_id);
  expect(await db.get('SELECT 1 FROM user_settings WHERE user_id = ? AND key = ?', [owner, `license_lead_${a.id}`])).toBeUndefined();
  await mine.remove(b.id);                             // the reminder stays
  expect((await jobs().list()).map((j) => j.id)).toContain(b.reminder!.job_id);
  expect((await mine.list()).map((l) => l.name)).toEqual(['Fishing license']);

  await jobs().remove(c.reminder!.job_id);             // the other way round
  const left = await mine.get(c.id);
  expect([left.name, left.reminder]).toEqual(['Fishing license', null]);
  expect((await db.get<{ job_id: number | null }>('SELECT job_id FROM licenses WHERE id = ?', [c.id]))!.job_id).toBeNull();
  // And a reminder can be made for it again.
  expect((await mine.remind(c.id)).reminder).not.toBeNull();
});

it('lists those that have run out or will soon, the soonest first, for the banner', async () => {
  await mine.create({ name: 'Far', expires_on: '2047-01-01' });
  await mine.create({ name: 'Soon', expires_on: '2046-04-10' });
  await mine.create({ name: 'Gone', expires_on: '2046-03-01' });
  await mine.create({ name: 'No end' });
  await licenses(db, await person('other'), clock).create({ name: 'Theirs', expires_on: '2046-03-02' });
  expect((await expiring(db, owner, clock, 60)).map((l) => [l.name, l.state, l.days_left])).toEqual([['Gone', 'expired', -4], ['Soon', 'soon', 36]]);
  expect((await mine.expiring(0)).map((l) => l.name)).toEqual(['Gone']);
  expect((await mine.list()).map((l) => l.name)).toEqual(['Gone', 'Soon', 'Far', 'No end']);
  await expect(mine.expiring(-1)).rejects.toEqual(problem(400));
});

it('the ready-made ones state only what is the same nationwide', () => {
  const by = (name: string) => LICENSE_STARTERS.find((s) => s.name === name)!;
  expect([by('Passport').term_years, by('Passport').issuer, by("Child's passport (under 16)").term_years, by('Global Entry').term_years, by('TSA PreCheck').term_years]).toEqual([10, 'U.S. Department of State', 5, 5, 5]);
  const withTerm = LICENSE_STARTERS.filter((s) => s.term_years !== null).map((s) => s.name);
  expect(withTerm).toEqual(['Passport', "Child's passport (under 16)", 'Global Entry', 'TSA PreCheck']);
  for (const name of ["Driver's license", 'Hunting license', 'Fishing license', 'Vehicle registration', 'Concealed carry permit', 'Nursing license']) expect(by(name).note).toContain('state sets');
  expect(LICENSE_STARTERS.every((s) => (LICENSE_CATEGORIES as readonly string[]).includes(s.category))).toBe(true);
});

it('the number is not in search, the morning reminder, the calendar file or the renewal', async () => {
  const lic = await mine.create({ name: "Driver's license", holder: 'Dana', category: 'Driving', number: NUMBER, issuer: 'State DMV', expires_on: '2046-04-04' });
  const set = await mine.remind(lic.id, { term_years: 4 });

  // Search finds it by name, holder or issuer, and the answer leads to the page; never by the number.
  for (const q of ['driver', 'dana', 'dmv']) expect((await search(db, owner, q)).filter((r) => r.kind === 'license').map((r) => [r.title, r.link])).toEqual([["Driver's license", '/things/licenses']]);
  expect(await search(db, owner, 'D123')).toEqual([]);
  expect(await search(db, owner, '4567-8901')).toEqual([]);
  expect(JSON.stringify(await search(db, owner, 'driver'))).not.toContain(NUMBER);
  expect(await search(db, owner, 'driver', 'license')).toHaveLength(1);
  expect(await search(db, await person('stranger'), 'driver')).toEqual([]);

  // The morning reminder has the renewal (it is due today) by name, without the number.
  const digest = await reminders(db, owner, clock).digest();
  expect(digest.lines.map((l) => l.title)).toEqual(["Renew Dana's driver's license"]);
  expect(JSON.stringify(digest)).not.toContain(NUMBER);

  // The calendar file (every kind of entry turned on) has no number; a license's own day is not in it at all, and
  // the in-app calendar's list of jobs due shows the renewal by name only.
  const { token } = await calendarFeed(db, owner, clock).turnOn(['event', 'plan', 'meal', 'due', 'use_by', 'session', 'media']);
  const file = (await feedFor(db, token!, clock))!;
  expect(file).not.toContain(NUMBER);
  expect(file).not.toContain('D123');

  expect(JSON.stringify(await jobs().dueBetween('2046-03-05', 30))).not.toContain(NUMBER);
  expect((await jobs().dueBetween('2046-03-05', 30)).map((d) => d.job.name)).toEqual(["Renew Dana's driver's license"]);

  // And nothing about the renewal itself holds it.
  expect(JSON.stringify(await jobs().get(set.reminder!.job_id))).not.toContain(NUMBER);
  expect(JSON.stringify(await mine.list())).not.toContain(NUMBER);
  expect((await mine.get(lic.id)).number).toBe(NUMBER);
});

it('a license, its renewal and the lead time survive a backup and restore', async () => {
  const lic = await mine.create({ name: 'Passport', holder: 'Dana', category: 'Travel', number: NUMBER, issuer: 'U.S. Department of State', expires_on: '2047-01-31' });
  const set = await mine.remind(lic.id, { term_years: 10 });
  const file = await makeBackup(db, 'correct horse battery', clock);

  const to = memoryDb();
  await migrate(to);
  await to.run("INSERT INTO users (id, username, password_hash, created_at) VALUES (?, 'someone else', 'x', 'now')", [owner + 40]);
  await restoreBackup(to, file, 'correct horse battery');
  const back = await licenses(to, owner, clock).get(lic.id);
  expect(back).toEqual(set);
  expect([back.number, back.reminder!.lead, back.reminder!.due_on]).toEqual([NUMBER, { n: 6, unit: 'month' }, '2046-07-31']);
  expect((await upkeep(to, owner, clock).get(set.reminder!.job_id)).name).toBe("Renew Dana's passport");
});

it('after a trial ends licenses can still be read, but not changed, like the rest of the organized section', () => {
  const ended = accessNow({ trial_started: '2046-02-01T00:00:00Z', unlocked: false }, new Date('2046-03-05T10:00:00Z'));
  expect(ended.state).toBe('ended');
  expect(['/api/things/licenses', '/api/things/licenses/12', '/api/things/licenses/ready'].map((p) => decide(ended, 'GET', p))).toEqual(['go', 'go', 'go']);
  expect([['POST', '/api/things/licenses'], ['PUT', '/api/things/licenses/12'], ['DELETE', '/api/things/licenses/12'], ['POST', '/api/things/licenses/12/reminder']]
    .map(([m, p]) => decide(ended, m!, p!))).toEqual(['read_only', 'read_only', 'read_only', 'read_only']);
});
