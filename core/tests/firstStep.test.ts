/** "Just the first step": the next small step of a chore, a project or a routine, and the assistant's three smaller steps. */
import { beforeEach, expect, it } from 'vitest';
import { assistant } from '../src/assistant.ts';
import type { Fetcher } from '../src/connections.ts';
import type { Db } from '../src/db.ts';
import { firstStep, pickChoreStep, pickProjectLine, pickRoutineStep } from '../src/firstStep.ts';
import { migrate } from '../src/migrations.ts';
import { projects } from '../src/projects.ts';
import { routines } from '../src/routines.ts';
import { upkeep } from '../src/upkeep.ts';
import { memoryDb } from './memoryDb.ts';

let db: Db;
let owner: number;
const clock = Object.assign(() => new Date(2046, 2, 5, 10, 0, 0), { today: () => '2046-03-05' });
const find = (kind: string, id: number, after = 0) => firstStep(db, owner, clock).find(kind, id, after);

beforeEach(async () => {
  db = memoryDb();
  await migrate(db);
  owner = (await db.run("INSERT INTO users (username, password_hash, created_at) VALUES ('owner', 'x', 'now')", [])).lastId;
});

it('picks a chore step: its written steps in order, or the chore itself', () => {
  expect(pickChoreStep('Wipe the counters', null)).toEqual({ words: 'Wipe the counters', index: 0, of: 1 });
  expect(pickChoreStep('Wipe the counters', '  \n ')).toEqual({ words: 'Wipe the counters', index: 0, of: 1 });
  expect(pickChoreStep('Filter', 'Turn it off.\n\n Find the size.\nSlide in the new one.')).toEqual({ words: 'Turn it off.', index: 0, of: 3 });
  expect(pickChoreStep('Filter', 'Turn it off.\nFind the size.\nSlide in the new one.', 2)).toEqual({ words: 'Slide in the new one.', index: 2, of: 3 });
  expect(pickChoreStep('Filter', 'Turn it off.\nFind the size.', 2)).toBeNull();
  expect(pickChoreStep('Wipe the counters', null, 1)).toBeNull();
});

it('picks the first project line not yet used, and the first routine step not yet checked', () => {
  const lines = [
    { used_on: '2046-03-01', label: 'Pine board', amount: '2 pc', note: null },
    { used_on: null, label: 'Wood glue', amount: '', note: 'The small bottle' },
    { used_on: null, label: 'Screws', amount: '12', note: null },
  ];
  expect(pickProjectLine(lines)).toMatchObject({ words: 'Wood glue', line: lines[1] });
  expect(pickProjectLine(lines.map((l) => ({ ...l, used_on: '2046-03-02' })))).toBeNull();
  const times = [{ name: 'Morning', steps: [{ ticked: true }, { ticked: true }] }, { name: 'Evening', steps: [{ ticked: true }, { ticked: false }, { ticked: false }] }];
  expect(pickRoutineStep(times)).toMatchObject({ time: times[1], index: 1 });
  expect(pickRoutineStep(times.map((t) => ({ ...t, steps: t.steps.map(() => ({ ticked: true })) })))).toBeNull();
});

it('finds the step of a chore with no steps (the chore itself) and of one with steps', async () => {
  const plain = await upkeep(db, owner, clock).create({ name: 'Wipe the counters', kind: 'chore', every_n: 1, every_unit: 'week' });
  expect(await find('chore', plain.id)).toMatchObject({ name: 'Wipe the counters', step: 'Wipe the counters', place: null, done: { how: 'chore', id: plain.id } });
  const filter = await upkeep(db, owner, clock).create({ name: 'Change the furnace filter', every_n: 3, every_unit: 'month', steps: 'Turn the system off.\nNote the size.' });
  expect(await find('chore', filter.id)).toMatchObject({ step: 'Turn the system off.', place: 'Step 1 of 2', done: { how: 'chore-line', last: false } });
  expect(await find('chore', filter.id, 1)).toMatchObject({ step: 'Note the size.', place: 'Step 2 of 2', done: { how: 'chore-line', last: true } });
  expect(await find('chore', filter.id, 2)).toMatchObject({ step: null, done: null });
});

it('finds a project\'s next unchecked line, and moves on when it is used', async () => {
  const making = projects(db, owner, clock);
  let shelf = await making.createProject({ name: 'Garage shelves' });
  expect(await find('project', shelf.id)).toMatchObject({ name: 'Garage shelves', step: null, done: null });
  shelf = await making.addLine(shelf.id, { label: 'Cut the boards', note: 'Two long, four short' });
  shelf = await making.addLine(shelf.id, { label: 'Sand the edges' });
  const first = await find('project', shelf.id);
  expect(first).toMatchObject({ step: 'Cut the boards', more: 'Two long, four short', place: '2 left of 2', done: { how: 'line', id: shelf.lines[0]!.id } });
  await making.useLine(shelf.lines[0]!.id);
  expect(await find('project', shelf.id)).toMatchObject({ step: 'Sand the edges', place: '1 left of 2' });
});

it('finds a routine\'s next step not yet checked today, and moves on when it is checked', async () => {
  const made = await routines(db, owner, clock).create({
    name: 'Daily', times: [{ name: 'Morning', steps: [{ words: 'Make the bed' }, { words: 'Take the pills' }] }, { name: 'Evening', steps: [{ words: 'Lock the door' }] }],
  });
  const first = await find('routine', made.id);
  expect(first).toMatchObject({ name: 'Daily', step: 'Make the bed', more: 'Morning', place: '3 left of 3 today', done: { how: 'routine' } });
  await routines(db, owner, clock).tick((first.done as { id: number }).id, true);
  expect(await find('routine', made.id)).toMatchObject({ step: 'Take the pills', place: '2 left of 3 today' });
  await routines(db, owner, clock).tick(made.times[0]!.steps[1]!.id, true);
  await routines(db, owner, clock).tick(made.times[1]!.steps[0]!.id, true);
  expect(await find('routine', made.id)).toMatchObject({ step: null, done: null });
});

it('refuses a kind it does not know, and a thing that is not there', async () => {
  await expect(find('holiday', 1)).rejects.toMatchObject({ status: 400 });
  await expect(find('chore', 999)).rejects.toMatchObject({ status: 404 });
});

// ---------- break it down ----------
let asked: { url: string; body: string }[];
let said: unknown;
const fetcher: Fetcher = async (url, _h, send) => {
  asked.push({ url, body: send?.body ?? '' });
  const text = JSON.stringify(url.endsWith('/models') ? { data: [] } : said);
  return { status: 200, type: 'application/json', json: async () => JSON.parse(text), bytes: async () => new TextEncoder().encode(text) };
};
const reply = (content: string) => { said = { choices: [{ message: { content } }] }; };

it('asks the assistant for three smaller steps, sending only the step and where it belongs', async () => {
  asked = [];
  const helper = assistant(db, owner, clock, { fetcher });
  reply('x');
  await expect(helper.breakDown('Clean the garage', null)).rejects.toMatchObject({ status: 409 });      // off until turned on
  await helper.save({ enabled: true, url: 'http://localhost:1234/v1' });
  reply('<think>hm</think>1. Clear a path to the door\n- Put the bike on its hook\n\n* Sweep the cleared floor');
  const got = await helper.breakDown('  Clean the garage ', 'Garage shelves');
  expect(got.steps).toEqual(['Clear a path to the door', 'Put the bike on its hook', 'Sweep the cleared floor']);
  expect(got.sent).toBe('Clean the garage (part of: Garage shelves)');
  const body = asked.at(-1)!.body;
  expect(body).toContain('Clean the garage');
  expect(body).toContain('Garage shelves');
  expect(body).not.toContain('Facts');
  await expect(helper.breakDown('   ', null)).rejects.toMatchObject({ status: 400 });
});

it('says so, and changes nothing, when the assistant does not give three clean steps', async () => {
  const helper = assistant(db, owner, clock, { fetcher });
  await helper.save({ enabled: true, url: 'http://localhost:1234/v1' });
  reply('Sure! Here is one idea: just start.');
  await expect(helper.breakDown('Clean the garage', null)).rejects.toThrow(/three clear steps/);
  reply('One\nTwo\nThree\nFour');
  await expect(helper.breakDown('Clean the garage', null)).rejects.toMatchObject({ status: 400 });
});
