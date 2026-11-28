/** Checkups, the daily check-in and the incident log: a person's own, and proof that nobody else can ever read them. */
import { beforeEach, expect, it } from 'vitest';
import { actions } from '../src/actions.ts';
import { assistant } from '../src/assistant.ts';
import { checkins } from '../src/checkins.ts';
import { checkups } from '../src/checkups.ts';
import type { Fetcher, Sealer } from '../src/connections.ts';
import { callTool, connector } from '../src/connector.ts';
import type { Db } from '../src/db.ts';
import { bringInDownload, exportEverything, splitDownload } from '../src/exportAll.ts';
import { home } from '../src/home.ts';
import { incidents } from '../src/incidents.ts';
import { LATEST, migrate } from '../src/migrations.ts';
import { reminders } from '../src/reminders.ts';
import { search } from '../src/search.ts';
import { voice } from '../src/voice.ts';
import { memoryDb } from './memoryDb.ts';

let db: Db;
let boss: number;
let sam: number;
let pia: number;
let now = new Date(Date.UTC(2046, 2, 5, 10, 0, 0));
const clock = Object.assign(() => now, { today: () => now.toISOString().slice(0, 10) });
const problem = (status: number) => expect.objectContaining({ name: 'Problem', status });
const checks = (who: number) => checkups(db, who, clock);
const ins = (who: number) => checkins(db, who, clock);
const log = (who: number) => incidents(db, who, clock);

// Words that appear nowhere else, so finding one anywhere is a leak.
const WORDS = ['Quillfeather', 'Zorbwash', 'Snarfle ridge', 'Gloomwick', 'Plinthbottom'];
const leaks = (what: unknown) => WORDS.some((w) => JSON.stringify(what).includes(w));

async function person(name: string, admin = false): Promise<number> {
  return (await db.run("INSERT INTO users (username, password_hash, created_at, is_admin) VALUES (?, 'x', 'now', ?)", [name, admin ? 1 : 0])).lastId;
}
const hours = (n: number) => { now = new Date(now.getTime() + n * 3_600_000); };

beforeEach(async () => {
  now = new Date(Date.UTC(2046, 2, 5, 10, 0, 0));
  db = memoryDb();
  expect(await migrate(db)).toBe(LATEST);
  boss = await person('boss', true);
  sam = await person('sam');
  pia = await person('pia');
});

// ---------- checkups ----------

it('works out the next checkup from the last, and says what is overdue, due and coming soon', async () => {
  await checks(sam).create({ name: 'Dentist', every_n: 6, every_unit: 'month', last_on: '2045-09-05' }); // next 2046-03-05: today
  await checks(sam).create({ name: 'Eyes', every_n: 1, every_unit: 'year', last_on: '2045-03-01' }); // 2046-03-01: late by 4 days
  await checks(sam).create({ name: 'Bloodwork', every_n: 52, every_unit: 'week', last_on: '2045-03-20', note: 'Fasting first', cost_cents: 4500 }); // 2046-03-19: soon
  await checks(sam).create({ name: 'Vet for George the dog', every_n: 2, every_unit: 'year', last_on: '2045-12-01' }); // later
  await checks(sam).create({ name: 'Skin check', every_n: 1, every_unit: 'year' }); // never done
  const list = await checks(sam).list();
  expect(list.map((c) => [c.name, c.state, c.next_on, c.days_left])).toEqual([
    ['Eyes', 'overdue', '2046-03-01', -4],
    ['Dentist', 'due', '2046-03-05', 0],
    ['Bloodwork', 'soon', '2046-03-19', 14],
    ['Vet for George the dog', 'later', '2047-12-01', 636],
    ['Skin check', 'unknown', null, null],
  ]);
  expect(list.find((c) => c.name === 'Bloodwork')).toMatchObject({ note: 'Fasting first', cost_cents: 4500 });
});

it('marking one done today sets the last day and moves the next', async () => {
  const eyes = await checks(sam).create({ name: 'Eyes', every_n: 1, every_unit: 'year', last_on: '2045-03-01' });
  expect(eyes.state).toBe('overdue');
  const done = await checks(sam).done(eyes.id);
  expect(done).toMatchObject({ last_on: '2046-03-05', next_on: '2047-03-05', state: 'later', days_left: 365 });
  expect((await checks(sam).done(eyes.id, '2046-03-01')).last_on).toBe('2046-03-01');
  await expect(checks(sam).done(eyes.id, '2046-09-01')).rejects.toEqual(problem(400));
});

it('says what is wrong with a checkup in words', async () => {
  await expect(checks(sam).create({ name: '  ', every_n: 1, every_unit: 'year' })).rejects.toEqual(problem(400));
  await expect(checks(sam).create({ name: 'X', every_n: 0, every_unit: 'year' })).rejects.toEqual(problem(400));
  await expect(checks(sam).create({ name: 'X', every_n: 1.5, every_unit: 'year' })).rejects.toEqual(problem(400));
  await expect(checks(sam).create({ name: 'X', every_n: 1, every_unit: 'day' })).rejects.toEqual(problem(400));
  await expect(checks(sam).create({ name: 'X', every_n: 1, every_unit: 'year', last_on: 'last spring' })).rejects.toEqual(problem(400));
  await expect(checks(sam).create({ name: 'X', every_n: 1, every_unit: 'year', cost_cents: 12.5 })).rejects.toEqual(problem(400));
  await expect(checks(sam).create({ name: 'X', every_n: 1, every_unit: 'year', cost_cents: -1 })).rejects.toEqual(problem(400));
});

it('puts a checkup coming due in its person\'s morning reminder as a plain line, and in no one else\'s', async () => {
  await checks(sam).create({ name: 'Dentist', every_n: 6, every_unit: 'month', last_on: '2045-09-12' }); // due in 7 days
  await checks(sam).create({ name: 'Eyes', every_n: 1, every_unit: 'year', last_on: '2045-03-04' }); // late by 1 day
  await checks(sam).create({ name: 'Bloodwork', every_n: 1, every_unit: 'year', last_on: '2045-10-01' }); // far off: not said
  const lines = (await reminders(db, sam, clock).digest()).lines.filter((l) => l.title.startsWith('Checkup'));
  expect(lines.map((l) => [l.title, l.detail, l.urgent])).toEqual([['Checkup: Eyes', 'was due yesterday', true], ['Checkup: Dentist', 'due in 7 days', false]]);
  for (const who of [boss, pia]) expect((await reminders(db, who, clock).digest()).lines.some((l) => l.title.startsWith('Checkup'))).toBe(false);
});

// ---------- the daily check-in ----------

it('keeps one check-in a day, each part optional, and changes it when saved again', async () => {
  const first = await ins(sam).save({ sleep_hours: 7.5, water: 6, energy: 3, line: '  slow start ' });
  expect(first).toMatchObject({ day: '2046-03-05', sleep_hours: 7.5, water: 6, energy: 3, line: 'slow start' });
  const again = await ins(sam).save({ energy: 4 });
  expect(again).toMatchObject({ id: first.id, sleep_hours: null, water: null, energy: 4, line: null });
  await ins(sam).save({ day: '2046-03-03', water: 8 });
  const seen = await ins(sam).recent();
  expect(seen.today).toBe('2046-03-05');
  expect(seen.entries.map((e) => [e.day, e.water, e.energy])).toEqual([['2046-03-05', null, 4], ['2046-03-03', 8, null]]);
  await ins(sam).remove('2046-03-03');
  expect((await ins(sam).recent()).entries).toHaveLength(1);
  await expect(ins(sam).remove('2046-03-03')).rejects.toEqual(problem(404));
});

it('shows four weeks and says what is wrong in words', async () => {
  await ins(sam).save({ day: '2046-02-05', water: 1 }); // 28 days back: out
  await ins(sam).save({ day: '2046-02-06', water: 2 }); // 27 days back: in
  expect((await ins(sam).recent()).entries.map((e) => e.day)).toEqual(['2046-02-06']);
  await expect(ins(sam).save({})).rejects.toEqual(problem(400));
  await expect(ins(sam).save({ sleep_hours: 30 })).rejects.toEqual(problem(400));
  await expect(ins(sam).save({ water: 2.5 })).rejects.toEqual(problem(400));
  await expect(ins(sam).save({ energy: 6 })).rejects.toEqual(problem(400));
  await expect(ins(sam).save({ energy: 0 })).rejects.toEqual(problem(400));
  await expect(ins(sam).save({ day: '2046-04-01', water: 1 })).rejects.toEqual(problem(400));
  await expect(ins(sam).save({ day: 'yesterday', water: 1 })).rejects.toEqual(problem(400));
});

it('judges nothing: a check-in holds only what the person typed', async () => {
  await ins(sam).save({ sleep_hours: 5, water: 1, energy: 1 });
  const shown = (await ins(sam).recent()).entries[0]!;
  expect(Object.keys(shown).sort()).toEqual(['day', 'energy', 'id', 'line', 'sleep_hours', 'water']);
  expect(Object.keys(await ins(sam).recent()).sort()).toEqual(['days', 'entries', 'today']);
});

// ---------- the incident log ----------

const entry = { happened_on: '2046-03-04', happened_time: 'about 9 pm', what: 'The back door was open when we got home. Gloomwick', who: 'Charlie and Hank', kept: 'Four photos and a text from the landlord' };

it('writes an entry, changes it within 24 hours, and then only lets it be added to', async () => {
  const made = await log(sam).create(entry);
  expect(made).toMatchObject({ ...entry, locked: false, changeable_until: '2046-03-06T10:00:00+00:00', additions: [], written_at: '2046-03-05T10:00:00+00:00' });
  hours(23);
  const fixed = await log(sam).update(made.id, { ...entry, what: 'The back door was open when we got home.' });
  expect(fixed.what).toBe('The back door was open when we got home.');
  expect(fixed.written_at).toBe(made.written_at);
  hours(2); // 25 hours after it was written
  await expect(log(sam).update(made.id, { ...entry, what: 'Changed' })).rejects.toEqual(problem(403));
  await expect(log(sam).remove(made.id)).rejects.toEqual(problem(403));
  const locked = (await log(sam).list())[0]!;
  expect(locked).toMatchObject({ locked: true, changeable_until: null, what: 'The back door was open when we got home.' });
  const added = await log(sam).addTo(made.id, 'The landlord called back the next morning.');
  expect(added.additions.map((a) => [a.words, a.written_at])).toEqual([['The landlord called back the next morning.', '2046-03-06T11:00:00+00:00']]);
  expect(added.what).toBe(locked.what);
});

it('lets a new entry be taken away inside 24 hours, and its additions go with it', async () => {
  const made = await log(sam).create(entry);
  await log(sam).addTo(made.id, 'More.');
  await log(sam).remove(made.id);
  expect(await log(sam).list()).toEqual([]);
  expect(await db.get('SELECT 1 AS one FROM incident_additions')).toBeUndefined();
});

it('has no way to change or take away an addition, and lists entries in the order things happened', async () => {
  const later = await log(sam).create({ ...entry, happened_on: '2046-03-05', what: 'Second' });
  const first = await log(sam).create({ ...entry, happened_on: '2046-03-01', what: 'First' });
  expect((await log(sam).list()).map((i) => i.what)).toEqual(['First', 'Second']);
  expect(Object.keys(log(sam)).sort()).toEqual(['addTo', 'create', 'list', 'remove', 'update']);
  expect(later.id).not.toBe(first.id);
});

it('says what is wrong with an entry in words', async () => {
  await expect(log(sam).create({ ...entry, happened_on: '' })).rejects.toEqual(problem(400));
  await expect(log(sam).create({ ...entry, happened_on: '2046-05-01' })).rejects.toEqual(problem(400));
  await expect(log(sam).create({ ...entry, what: '   ' })).rejects.toEqual(problem(400));
  const made = await log(sam).create(entry);
  await expect(log(sam).addTo(made.id, ' ')).rejects.toEqual(problem(400));
  await expect(log(sam).addTo(9999, 'x')).rejects.toEqual(problem(404));
});

// ---------- private to the person ----------

it('keeps all three to their person: nobody else, the person in charge included, can list, change, add to or remove them', async () => {
  const c = await checks(sam).create({ name: 'Quillfeather', every_n: 1, every_unit: 'year', last_on: '2045-03-01', note: 'Zorbwash' });
  await ins(sam).save({ line: 'Snarfle ridge' });
  const i = await log(sam).create({ ...entry, what: 'Plinthbottom' });
  for (const other of [boss, pia]) {
    expect(await checks(other).list()).toEqual([]);
    expect((await ins(other).recent()).entries).toEqual([]);
    expect(await log(other).list()).toEqual([]);
    await expect(checks(other).update(c.id, { name: 'Mine now', every_n: 1, every_unit: 'year' })).rejects.toEqual(problem(404));
    await expect(checks(other).done(c.id)).rejects.toEqual(problem(404));
    await expect(checks(other).remove(c.id)).rejects.toEqual(problem(404));
    await expect(log(other).update(i.id, entry)).rejects.toEqual(problem(404));
    await expect(log(other).addTo(i.id, 'Mine')).rejects.toEqual(problem(404));
    await expect(log(other).remove(i.id)).rejects.toEqual(problem(404));
    await expect(ins(other).remove('2046-03-05')).rejects.toEqual(problem(404));
  }
  expect((await checks(sam).list())[0]).toMatchObject({ name: 'Quillfeather', last_on: '2045-03-01' });
  expect((await ins(sam).recent()).entries[0]!.line).toBe('Snarfle ridge');
  expect((await log(sam).list())[0]!.what).toBe('Plinthbottom');
});

it('is in no search, front page, voice answer, Siri list, assistant answer or AI app answer, for anyone', async () => {
  await checks(sam).create({ name: 'Quillfeather', every_n: 1, every_unit: 'year', last_on: '2045-03-01', note: 'Zorbwash' });
  await ins(sam).save({ line: 'Snarfle ridge' });
  await log(sam).create({ ...entry, what: 'Plinthbottom' });
  for (const who of [sam, boss, pia]) {
    for (const q of WORDS.concat(['Quill', 'checkup', 'incident', 'back door'])) expect(await search(db, who, q), `${who} ${q}`).toEqual([]);
  }
  for (const who of [sam, boss]) {
    expect(leaks(await home(db, who, clock).summary())).toBe(false);
    const say = voice(db, who, clock);
    expect(leaks([await say.today(true), await say.week(), await say.dinner(), await say.whatToBuy()])).toBe(false);
    expect(leaks(actions(db, who, clock).list())).toBe(false);
  }
  expect(leaks((await reminders(db, boss, clock).digest()).lines)).toBe(false);

  const asked: string[] = [];
  const fetcher: Fetcher = async (_url, _headers, send) => {
    asked.push(send?.body ?? '');
    const text = JSON.stringify({ choices: [{ message: { content: 'ok' } }] });
    return { status: 200, type: 'application/json', json: async () => JSON.parse(text), bytes: async () => new TextEncoder().encode(text) };
  };
  const sealer: Sealer = { seal: (s) => `sealed:${s}`, unseal: (s) => (s.startsWith('sealed:') ? s.slice(7) : null) };
  const helper = assistant(db, sam, clock, { fetcher, sealer });
  await helper.save({ enabled: true, url: 'http://localhost:11434/v1', model: 'llama3.2', areas: ['kitchen', 'things', 'projects', 'spending', 'calendar'] });
  await helper.ask('What do I have?');
  expect(asked.length).toBeGreaterThan(0);
  for (const body of asked) expect(leaks(body)).toBe(false);
  expect(typeof connector).toBe('function');
  expect(typeof callTool).toBe('function');
});

// ---------- the download ----------

it('is in the person\'s own full download, never in anyone else\'s, and comes back in with it, once, keeping when each entry was written', async () => {
  await checks(sam).create({ name: 'Quillfeather', every_n: 6, every_unit: 'month', last_on: '2045-09-05', note: 'Zorbwash', cost_cents: 12_345 });
  await checks(sam).create({ name: 'Never done', every_n: 2, every_unit: 'year' });
  await ins(sam).save({ day: '2046-03-04', sleep_hours: 6.5, water: 5, energy: 2, line: 'Snarfle ridge' });
  await ins(sam).save({ day: '2046-03-05', water: 3 });
  const made = await log(sam).create({ ...entry, what: 'Plinthbottom' });
  hours(30);
  await log(sam).addTo(made.id, 'Added a day later');
  await log(sam).create({ ...entry, what: 'Second one', happened_on: '2046-03-06' });

  const text = async (who: number) => (await splitDownload((await exportEverything(db, who, clock)).bytes)).files;
  const sams = await text(sam);
  for (const f of ['checkups.csv', 'check-ins.csv', 'incident-log.csv']) { expect(Object.keys(sams)).toContain(f); expect(sams['README.txt']).toContain(f); }
  expect(sams['checkups.csv']).toContain('Quillfeather');
  expect(sams['checkups.csv']).toContain('12345');
  expect(sams['checkups.csv']).toContain('2046-03-05');
  expect(sams['check-ins.csv']).toContain('Snarfle ridge');
  expect(sams['incident-log.csv']).toContain('Plinthbottom');
  expect(sams['incident-log.csv']).toContain('Added a day later');
  for (const who of [boss, pia]) {
    const theirs = await text(who);
    expect(Object.values(theirs).some((t) => leaks(t))).toBe(false);
  }

  const done = await bringInDownload(db, pia, sams, ['checkups', 'checkins', 'incidents'], clock);
  expect(done.kinds.map((k) => [k.key, k.ok, k.fresh, k.already])).toEqual([['checkups', true, 2, 0], ['checkins', true, 2, 0], ['incidents', true, 2, 0]]);
  const piaChecks = await checks(pia).list();
  expect(piaChecks.map((c) => [c.name, c.every_n, c.every_unit, c.last_on, c.note, c.cost_cents])).toEqual([
    ['Quillfeather', 6, 'month', '2045-09-05', 'Zorbwash', 12_345], ['Never done', 2, 'year', null, null, null],
  ]);
  expect((await ins(pia).recent()).entries.map((e) => [e.day, e.sleep_hours, e.water, e.energy, e.line])).toEqual([['2046-03-05', null, 3, null, null], ['2046-03-04', 6.5, 5, 2, 'Snarfle ridge']]);
  const piaLog = await log(pia).list();
  expect(piaLog.map((i) => i.what)).toEqual(['Plinthbottom', 'Second one']);
  expect(piaLog[0]).toMatchObject({ written_at: made.written_at, locked: true, kept: entry.kept, who: entry.who, happened_time: entry.happened_time });
  expect(piaLog[0]!.additions.map((a) => a.words)).toEqual(['Added a day later']);
  expect(piaLog[1]!.locked).toBe(false); // written 6 hours ago in this test's time
  // The restored entry is still locked: it cannot be quietly rewritten.
  await expect(log(pia).update(piaLog[0]!.id, entry)).rejects.toEqual(problem(403));

  const again = await bringInDownload(db, pia, sams, ['checkups', 'checkins', 'incidents'], clock);
  expect(again.kinds.map((k) => [k.key, k.fresh, k.already])).toEqual([['checkups', 0, 2], ['checkins', 0, 2], ['incidents', 0, 2]]);
  expect((await log(pia).list())[0]!.additions).toHaveLength(1);
  // Sam's own are as they were, and the others still see none of Sam's.
  expect(await checks(sam).list()).toHaveLength(2);
  expect(await checks(boss).list()).toEqual([]);
});

it('an older download, with none of these files, still comes back in', async () => {
  await checks(sam).create({ name: 'Quillfeather', every_n: 1, every_unit: 'year' });
  const files = (await splitDownload((await exportEverything(db, sam, clock)).bytes)).files;
  delete files['checkups.csv'];
  delete files['check-ins.csv'];
  delete files['incident-log.csv'];
  const done = await bringInDownload(db, pia, files, ['checkups', 'checkins', 'incidents'], clock);
  expect(done.kinds.map((k) => [k.key, k.ok, k.found])).toEqual([['checkups', true, 0], ['checkins', true, 0], ['incidents', true, 0]]);
  expect(await checks(pia).list()).toEqual([]);
});
