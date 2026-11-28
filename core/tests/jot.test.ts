/** Jottings: what each says, who sees it, and that they go out and come back. */
import { beforeEach, expect, it } from 'vitest';
import { callTool, connectionTools, type Live } from '../src/connector.ts';
import type { Db } from '../src/db.ts';
import { bringInDownload, exportEverything, splitDownload } from '../src/exportAll.ts';
import { jottings } from '../src/jottings.ts';
import { LATEST, migrate } from '../src/migrations.ts';
import { isKeyAction, KEY_ACTIONS, voice } from '../src/voice.ts';
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
// ---------- jottings ----------

it('keeps a jotting for its person alone: newest first, reworded, checked off and removed', async () => {
  const mine = jottings(db, ana, clock);
  const first = await mine.add('  call the vet  ');
  expect(first).toEqual({ id: expect.any(Number), text: 'call the vet', done: false, day: '2046-03-06' });
  time = new Date(2046, 2, 7, 9, 0, 0);
  const clockLater = Object.assign(() => time, { today: () => '2046-03-07' });
  const second = await jottings(db, ana, clockLater).add('the blue pen is in the car');
  expect((await mine.list()).map((j) => [j.text, j.day])).toEqual([['the blue pen is in the car', '2046-03-07'], ['call the vet', '2046-03-06']]);
  expect((await mine.update(first.id, { text: 'call the vet about Hank' })).text).toBe('call the vet about Hank');
  await mine.update(second.id, { done: true });
  // Checked ones come after the open ones.
  expect((await mine.list()).map((j) => [j.text, j.done])).toEqual([['call the vet about Hank', false], ['the blue pen is in the car', true]]);
  await mine.update(second.id, { done: false });
  await mine.remove(first.id);
  expect((await mine.list()).map((j) => j.text)).toEqual(['the blue pen is in the car']);
  await expect(mine.add('   ')).rejects.toEqual(problem(400));
  await expect(mine.update(999, { done: true })).rejects.toEqual(problem(404));
});

it("nobody else can see, change or remove a person's jottings", async () => {
  const mine = await jottings(db, ana, clock).add('a private thought');
  const theirs = jottings(db, bob, clock);
  expect(await theirs.list()).toEqual([]);
  await expect(theirs.update(mine.id, { text: 'mine now' })).rejects.toEqual(problem(404));
  await theirs.remove(mine.id);
  expect((await jottings(db, ana, clock).list()).map((j) => j.text)).toEqual(['a private thought']);
  // Not even the person in charge.
  const boss = (await db.run("INSERT INTO users (username, password_hash, is_admin, created_at) VALUES ('boss', 'x', 1, 'now')")).lastId;
  expect(await jottings(db, boss, clock).list()).toEqual([]);
});

it('a key can be allowed to add a jotting, and a key made before cannot', async () => {
  expect(KEY_ACTIONS.map((a) => a.id)).toContain('jotting_add');
  expect(isKeyAction('jotting_add')).toBe(true);
  const say = voice(db, ana, clock);
  expect(await say.addJotting('buy a stamp')).toBe('Jotted down.');
  expect(await say.addJotting('  ')).toBe('No jotting was heard.');
  expect((await jottings(db, ana, clock).list()).map((j) => j.text)).toEqual(['buy a stamp']);
  expect(await jottings(db, bob, clock).list()).toEqual([]);
});

it('goes out in the download and comes back once, into the person bringing it in only', async () => {
  const mine = jottings(db, ana, clock);
  await mine.add('the spare key is in the blue bowl');
  const gone = await mine.add('old thought, checked off');
  await mine.update(gone.id, { done: true });
  const zip = (await exportEverything(db, ana, clock)).bytes;
  const { files } = await splitDownload(zip);
  expect(Object.keys(files)).toContain('jottings.csv');
  const done = await bringInDownload(db, bob, files, ['jottings'], clock);
  expect(done.kinds.find((k) => k.key === 'jottings')).toMatchObject({ ok: true, found: 2, fresh: 2 });
  expect((await jottings(db, bob, clock).list()).map((j) => [j.text, j.done, j.day])).toEqual([['the spare key is in the blue bowl', false, '2046-03-06'], ['old thought, checked off', true, '2046-03-06']]);
  const again = await bringInDownload(db, bob, files, ['jottings'], clock);
  expect(again.kinds.find((k) => k.key === 'jottings')).toMatchObject({ found: 2, fresh: 0, already: 2 });
  // A third person's download holds none of Ana's.
  const carl = await person('carl');
  const carlZip = await splitDownload((await exportEverything(db, carl, clock)).bytes);
  expect(JSON.stringify(carlZip.files['jottings.csv'] ?? '')).not.toContain('spare key');
  // A download made before jottings still comes back.
  const { 'jottings.csv': _gone, ...older } = files;
  expect((await bringInDownload(db, await person('dana'), older, ['jottings'], clock)).kinds.find((k) => k.key === 'jottings')).toMatchObject({ ok: true, found: 0 });
});

// ---------- an AI app connection ----------

async function connection(owner: number, sections: string[]): Promise<Live> {
  const made = await db.run(
    "INSERT INTO ai_connections (owner_id, client_id, app_name, name, sections, may_add, access_hash, refresh_hash, created_at) VALUES (?, 'c1', 'Claude', 'Claude on my iPad', ?, 1, 'aaa', 'bbb', '2046-03-01T10:00:00+00:00')",
    [owner, sections.join(',')]);
  return { id: made.lastId, owner, name: 'Claude on my iPad', sections: sections as Live['sections'], may_add: true };
}

it('an AI app reads jottings only when allowed, and only the connection owner\'s, and cannot add or change one', async () => {
  await jottings(db, ana, clock).add('ZEBRAJOT for ana');
  await jottings(db, bob, clock).add('KIWIJOT for bob');
  const off = await connection(ana, ['kitchen', 'calendar', 'things', 'projects', 'lists', 'money']);
  expect(connectionTools(off).map((t) => t.name)).not.toContain('get_jottings');
  await expect(callTool(db, clock, off, 'get_jottings', {})).rejects.toEqual(problem(403));
  const on = await connection(ana, ['jottings']);
  expect(connectionTools(on).map((t) => t.name)).toEqual(['get_jottings']);
  const said = await callTool(db, clock, on, 'get_jottings', {});
  expect(said).toContain('ZEBRAJOT for ana');
  expect(said).not.toContain('KIWIJOT');
  // Even with "may add" and every section, nothing writes a jotting.
  const all = await connection(ana, ['kitchen', 'calendar', 'things', 'projects', 'lists', 'money', 'jottings']);
  expect(connectionTools(all).filter((t) => /jotting/i.test(t.name))).toHaveLength(1);
  expect((await jottings(db, ana, clock).list())).toHaveLength(1);
});
