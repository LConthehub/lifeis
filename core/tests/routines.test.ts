/** Routines: times of day with steps, step days, a cycle that waits, finishing, history, reminders, running low, tags, and bringing them in. */
import { beforeEach, expect, it } from 'vitest';
import type { Answer, Fetcher } from '../src/connections.ts';
import type { Db } from '../src/db.ts';
import { exportEverything, bringInDownload, splitDownload } from '../src/exportAll.ts';
import { inventory } from '../src/inventory.ts';
import { kitchen } from '../src/kitchen.ts';
import { LATEST, migrate } from '../src/migrations.ts';
import { reminders } from '../src/reminders.ts';
import { daysAsText, daysFromText, daysWords, fallsOn, isoWeekday, ROUTINE_STARTERS, routines, routinesDue, weekdaysWords } from '../src/routines.ts';
import { search } from '../src/search.ts';
import { stamp } from '../src/small.ts';
import { tags } from '../src/tags.ts';
import { upkeep } from '../src/upkeep.ts';
import { pets } from '../src/pets.ts';
import { memoryDb } from './memoryDb.ts';

let db: Db;
let owner: number;
let partner: number;
// 2046-03-05 is a Monday.
let day = '2046-03-05';
const clock = Object.assign(() => new Date(2046, 2, 5, 10, 0, 0), { today: () => day });
const problem = (status: number) => expect.objectContaining({ name: 'Problem', status });

let posted: { url: string; body: string }[];
const fetcher: Fetcher = async (url, _headers, send) => {
  posted.push({ url, body: send?.body ?? '' });
  return { status: 200, type: 'text/plain', json: async () => ({}), bytes: async () => new Uint8Array() } as Answer;
};

async function person(name: string): Promise<number> {
  return (await db.run("INSERT INTO users (username, password_hash, created_at) VALUES (?, 'x', 'now')", [name])).lastId;
}
const mine = (who = owner) => routines(db, who, clock);

beforeEach(async () => {
  db = memoryDb();
  expect(await migrate(db)).toBe(LATEST);
  owner = await person('owner');
  partner = await person('partner');
  day = '2046-03-05';
  posted = [];
});

it('says days in words and reads them back', () => {
  expect([weekdaysWords([1]), weekdaysWords([4, 1]), weekdaysWords([1, 3, 5]), weekdaysWords([1, 2, 3, 4, 5, 6, 7])]).toEqual(['Mon', 'Mon and Thu', 'Mon, Wed and Fri', 'every day']);
  expect([isoWeekday('2046-03-05'), isoWeekday('2046-03-10'), isoWeekday('2046-03-11')]).toEqual([1, 6, 7]);
  expect(daysWords({ rule: 'cycle', weekdays: [], night: 2 }, 4)).toBe('night 2 of 4');
  const mondayThursday = { rule: 'weekdays' as const, weekdays: [1, 4], night: null };
  expect([fallsOn(mondayThursday, '2046-03-05', null), fallsOn(mondayThursday, '2046-03-06', null), fallsOn(mondayThursday, '2046-03-08', null)]).toEqual([true, false, true]);
  expect(fallsOn({ rule: 'cycle', weekdays: [], night: 3 }, '2046-03-05', 3)).toBe(true);
  expect(fallsOn({ rule: 'cycle', weekdays: [], night: 3 }, '2046-03-05', 2)).toBe(false);
  for (const step of [mondayThursday, { rule: 'daily' as const, weekdays: [], night: null }, { rule: 'cycle' as const, weekdays: [], night: 3 }]) {
    expect(daysFromText(daysAsText(step))).toMatchObject({ rule: step.rule, ...(step.rule === 'weekdays' ? { weekdays: [1, 4] } : step.rule === 'cycle' ? { night: 3 } : {}) });
  }
});

it('shows each step on its days: every day, or only on Monday and Thursday', async () => {
  const r = await mine().create({ name: 'Skincare', times: [{ name: 'Evening', steps: [
    { words: 'Wash your face' },
    { words: 'Retinoid', rule: 'weekdays', weekdays: [4, 1] },
  ] }] });
  expect(r.times[0]!.steps.map((s) => s.days)).toEqual(['every day', 'Mon and Thu']);
  const words = async (on: string) => (await mine().today(on)).flatMap((t) => t.steps.map((s) => s.words));
  expect(await words('2046-03-05')).toEqual(['Wash your face', 'Retinoid']); // Monday
  expect(await words('2046-03-06')).toEqual(['Wash your face']); // Tuesday
  expect(await words('2046-03-08')).toEqual(['Wash your face', 'Retinoid']); // Thursday
});

it('leaves out a time with nothing on that day, such as a Sunday-only reset on a Monday', async () => {
  await mine().addStarter('weekly-reset');
  expect(await mine().today('2046-03-05')).toEqual([]);
  const sunday = await mine().today('2046-03-11');
  expect([sunday.length, sunday[0]!.total, sunday[0]!.title]).toEqual([1, 5, 'Weekly reset']);
});

it('makes the cycle wait: it moves on only when that time was finished, so skipped days are the same night', async () => {
  const r = await mine().addStarter('skin-cycle');
  const time = r.times[0]!;
  const night = async (on: string) => (await mine().today(on))[0]!.night;
  expect(await night('2046-03-05')).toBe(1);
  // Monday: night 1 is Exfoliate, with the daily steps. Tick them all.
  day = '2046-03-05';
  let view = (await mine().today())[0]!;
  expect(view.steps.map((s) => s.words)).toEqual(['Wash your face', 'Exfoliate', 'Moisturizer']);
  view = await mine().finish(time.id, true);
  expect([view.finished, view.night]).toEqual([true, 1]);
  // Tuesday and Wednesday are skipped. Thursday is night 2, the retinoid night.
  day = '2046-03-08';
  expect(await night('2046-03-06')).toBe(2);
  expect(await night('2046-03-08')).toBe(2);
  view = (await mine().today())[0]!;
  expect(view.steps.map((s) => s.words)).toEqual(['Wash your face', 'Retinoid', 'Moisturizer']);
  // Ticking some, but not all, does not move it on.
  await mine().tick(view.steps[0]!.id, true);
  expect((await mine().today('2046-03-09'))[0]!.night).toBe(2);
  await mine().finish(time.id, true);
  day = '2046-03-09';
  expect((await mine().today())[0]!.night).toBe(3);
  await mine().finish(time.id, true);
  day = '2046-03-10';
  expect((await mine().today())[0]!.night).toBe(4);
  await mine().finish(time.id, true);
  // And round again.
  day = '2046-03-11';
  expect((await mine().today())[0]!.night).toBe(1);
});

it('never gets stuck on a cycle night with nothing on it', async () => {
  const r = await mine().create({ name: 'Face', cycle_length: 3, times: [{ name: 'Evening', steps: [
    { words: 'Mask', rule: 'cycle', night: 1 }, { words: 'Serum', rule: 'cycle', night: 3 },
  ] }] });
  await mine().finish(r.times[0]!.id, true);
  day = '2046-03-06';
  // Night 2 has nothing, so the night after it comes.
  const next = (await mine().today())[0]!;
  expect([next.night, next.steps.map((s) => s.words)]).toEqual([3, ['Serum']]);
});

it('is finished when every step of the day is ticked, and ticking back un-finishes it', async () => {
  const r = await mine().addStarter('morning');
  const t = r.times[0]!;
  let view = (await mine().today())[0]!;
  expect([view.total, view.done, view.finished]).toEqual([5, 0, false]);
  for (const s of view.steps.slice(0, 4)) view = await mine().tick(s.id, true);
  expect([view.done, view.finished]).toEqual([4, false]);
  view = await mine().tick(view.steps[4]!.id, true);
  expect([view.done, view.finished, view.last7]).toEqual([5, true, 1]);
  view = await mine().tick(view.steps[4]!.id, false);
  expect([view.done, view.finished, view.last7]).toEqual([4, false, 0]);
  view = await mine().finish(t.id, true);
  expect([view.finished, view.last7]).toEqual([true, 1]);
  view = await mine().finish(t.id, false);
  expect([view.done, view.finished]).toEqual([0, false]);
  // Only today, or the last week, and a step must belong to the day.
  await expect(mine().tick(view.steps[0]!.id, true, '2046-03-06')).rejects.toEqual(problem(400));
  await expect(mine().tick(view.steps[0]!.id, true, '2046-02-20')).rejects.toEqual(problem(400));
  await expect(mine().tick(99999, true)).rejects.toEqual(problem(404));
});

it('remembers the days a time was finished and says how many of the last 7', async () => {
  const r = await mine().addStarter('bedtime');
  const t = r.times[0]!;
  day = '2046-03-12';
  for (const d of ['2046-03-05', '2046-03-07', '2046-03-08', '2046-03-10', '2046-03-12']) await mine().finish(t.id, true, d);
  // The 5th is more than 6 days back from the 12th, so it no longer counts: 4 of 7.
  expect((await mine().today())[0]!.last7).toBe(4);
  await mine().finish(t.id, true, '2046-03-11');
  expect((await mine().today())[0]!.last7).toBe(5);
  expect((await mine().list())[0]!.times[0]!.last7).toBe(5);
  day = '2046-03-14';
  expect((await mine().today())[0]!.last7).toBe(4); // the 8th to the 14th: the 8th, 10th, 11th and 12th
});

it('keeps a person own routines to their own front page, and shows everyone routines to all', async () => {
  await mine().create({ name: 'Mine', for_user: owner, times: [{ name: 'Morning', steps: [{ words: 'One' }] }] });
  await mine().create({ name: 'Theirs', for_user: partner, times: [{ name: 'Morning', steps: [{ words: 'Two' }] }] });
  await mine().create({ name: 'House', times: [{ name: 'Evening', steps: [{ words: 'Three' }] }] });
  expect((await mine(owner).today()).map((t) => t.routine).sort()).toEqual(['House', 'Mine']);
  expect((await mine(partner).today()).map((t) => t.routine).sort()).toEqual(['House', 'Theirs']);
  // Changing a routine is for whoever made it; anyone it shows to can tick.
  const house = (await mine(owner).list()).find((r) => r.name === 'House')!;
  await expect(mine(partner).update(house.id, { name: 'Mine now' })).rejects.toEqual(problem(404));
  const view = await mine(partner).tick(house.times[0]!.steps[0]!.id, true);
  expect(view.finished).toBe(true);
  const private1 = (await mine(owner).list()).find((r) => r.name === 'Mine')!;
  await expect(mine(partner).tick(private1.times[0]!.steps[0]!.id, true)).rejects.toEqual(problem(404));
});

it('keeps a household member routine off the front page, shows it on the chart, and earns chore points', async () => {
  const home = upkeep(db, owner, clock);
  const kid = (await home.addMember('Sam'))[0]!;
  const r = await mine().addStarter('after-school', null, kid.id);
  expect(r.who_kind).toBe('member');
  expect(await mine().today()).toEqual([]);
  const chart = await mine().forMembers();
  expect([chart.length, chart[0]!.member_id, chart[0]!.who]).toEqual([1, kid.id, 'Sam']);
  await mine().update(r.id, { name: r.name, for_member: kid.id, points: 4 });
  await mine().finish(r.times[0]!.id, true);
  const week = await home.allowance({ period: 'this_week' });
  expect(week.people.find((p) => p.id === kid.id)).toMatchObject({ points: 4, done: 1 });
  // Taking the tick back takes the points back.
  await mine().finish(r.times[0]!.id, false);
  expect((await home.allowance({ period: 'this_week' })).people.find((p) => p.id === kid.id)).toMatchObject({ points: 0 });
  // Someone else's household member can't be named.
  const other = (await upkeep(db, partner, clock).addMember('Lee'))[0]!;
  await expect(mine().create({ name: 'X', for_member: other.id, times: [{ name: 'A', steps: [{ words: 'b' }] }] })).rejects.toEqual(problem(404));
});

it('checks what was sent', async () => {
  const one = (step: object, more: object = {}) => mine().create({ name: 'R', ...more, times: [{ name: 'Morning', steps: [step as { words: string }] }] });
  await expect(mine().create({ name: ' ', times: [] })).rejects.toEqual(problem(400));
  await expect(mine().create({ name: 'R', times: [] })).rejects.toEqual(problem(400));
  await expect(mine().create({ name: 'R', times: [{ name: 'Morning', steps: [] }] })).rejects.toEqual(problem(400));
  await expect(mine().create({ name: 'R', times: [{ name: 'Morning', at: '7am', steps: [{ words: 'x' }] }] })).rejects.toEqual(problem(400));
  await expect(mine().create({ name: 'R', times: [{ name: 'A', steps: [{ words: 'x' }] }, { name: 'a', steps: [{ words: 'y' }] }] })).rejects.toEqual(problem(409));
  await expect(one({ words: 'x', rule: 'weekdays', weekdays: [] })).rejects.toEqual(problem(400));
  await expect(one({ words: 'x', rule: 'weekdays', weekdays: [8] })).rejects.toEqual(problem(400));
  await expect(one({ words: 'x', rule: 'cycle', night: 1 })).rejects.toEqual(problem(400)); // no cycle yet
  await expect(one({ words: 'x', rule: 'cycle', night: 5 }, { cycle_length: 4 })).rejects.toEqual(problem(400));
  await expect(one({ words: 'x' }, { cycle_length: 1 })).rejects.toEqual(problem(400));
  await expect(one({ words: 'x', wait_seconds: 0 })).rejects.toEqual(problem(400));
  await expect(one({ words: 'x', wait_seconds: 7200 })).rejects.toEqual(problem(400));
  await expect(one({ words: 'x', item_id: 999 })).rejects.toEqual(problem(404));
  await expect(one({ words: 'x' }, { for_user: owner, for_member: 1 })).rejects.toEqual(problem(400));
  await expect(one({ words: 'x' }, { for_user: 999 })).rejects.toEqual(problem(404));
  expect(await mine().list()).toEqual([]); // nothing half-made
});

it('keeps what was ticked on a step that is kept when a routine is changed', async () => {
  const r = await mine().addStarter('bedtime');
  const [first, second, ...rest] = r.times[0]!.steps;
  await mine().tick(first!.id, true);
  const changed = await mine().update(r.id, {
    name: 'Bedtime', for_user: owner,
    times: [{ id: r.times[0]!.id, name: 'Bedtime', at: '20:30', steps: [{ id: first!.id, words: 'Tidy the room' }, { id: second!.id, words: second!.words }, { words: 'Read a book' }, ...rest.slice(0, 1).map((s) => ({ id: s.id, words: s.words }))] }],
  });
  const view = (await mine().today())[0]!;
  expect(view.steps.map((s) => [s.words, s.ticked])).toEqual([['Tidy the room', true], ['Put on pajamas', false], ['Read a book', false], ['Brush your teeth', false]]);
  expect([changed.times[0]!.at, changed.times[0]!.at_words]).toEqual(['20:30', '8:30 pm']);
  // Taking a step away that was the last one left to tick finishes the time.
  const left = await mine().update(r.id, { name: 'Bedtime', for_user: owner, times: [{ id: r.times[0]!.id, name: 'Bedtime', steps: [{ id: first!.id, words: 'Tidy the room' }] }] });
  expect((await mine().today())[0]!.finished).toBe(true);
  expect(left.times[0]!.steps).toHaveLength(1);
});

it('sends a reminder at the clock time in the person zone, once, and not when it is finished or has gone by', async () => {
  const r = await mine().create({ name: 'Evening', for_user: owner, times: [{ name: 'Evening', at: '21:00', steps: [{ words: 'Wash' }, { words: 'Moisturize' }] }, { name: 'Midday', steps: [{ words: 'Stretch' }] }] });
  const tools = { fetcher };
  await reminders(db, owner, clock, tools).save({ ntfy: { server: 'https://ntfy.example.org', topic: 'abcdef123456', detail: 'full' }, zone: 'Asia/Tokyo' });
  // 9 pm in Tokyo on the 5th is 12:00 UTC.
  expect(await routinesDue(db, new Date(Date.UTC(2046, 2, 5, 11, 59)), fetcherTools())).toEqual([]);
  const sent = await routinesDue(db, new Date(Date.UTC(2046, 2, 5, 12, 0)), fetcherTools());
  expect(sent).toEqual([{ user: owner, sent: ['ntfy'], problems: [] }]);
  expect(posted).toHaveLength(1);
  expect(posted[0]!.body).toContain('Evening');
  expect(posted[0]!.body).toContain('2 steps');
  expect(await routinesDue(db, new Date(Date.UTC(2046, 2, 5, 12, 1)), fetcherTools())).toEqual([]); // once only
  // Tomorrow, a finished one is not sent, and one more than a quarter of an hour late is not sent either.
  day = '2046-03-06';
  await mine().finish(r.times[0]!.id, true);
  expect(await routinesDue(db, new Date(Date.UTC(2046, 2, 6, 12, 0)), fetcherTools())).toEqual([]);
  await mine().finish(r.times[0]!.id, false);
  expect(await routinesDue(db, new Date(Date.UTC(2046, 2, 6, 12, 20)), fetcherTools())).toEqual([]);
  expect((await routinesDue(db, new Date(Date.UTC(2046, 2, 6, 12, 10)), fetcherTools())).length).toBe(1);
  expect(posted).toHaveLength(2);
  // What the phone schedules for itself is the same list.
  expect((await mine().coming('2046-03-06', '2046-03-07')).map((c) => [c.day, c.at, c.title, c.steps])).toEqual([['2046-03-06', '21:00', 'Evening', 2], ['2046-03-07', '21:00', 'Evening', 2]]);
  // A person with no way of being reminded is sent nothing.
  await reminders(db, owner, clock, tools).save({ ntfy: null });
  expect(await routinesDue(db, new Date(Date.UTC(2046, 2, 7, 12, 0)), fetcherTools())).toEqual([]);

  function fetcherTools() { return { fetcher }; }
});

it('marks a thing running low from its step: on the grocery list once, and brought down to its low mark', async () => {
  const things = inventory(db, owner, clock);
  const kind = (await things.createKind({ name: 'Skincare', icon: '🧴' }))[0]!.id;
  const serum = await things.createItem({ kind_id: kind, name: 'Vitamin C serum', quantity: 5, low_at: 1 });
  const plain = await things.createItem({ kind_id: kind, name: 'Moisturizer' });
  const r = await mine().create({ name: 'Skincare', times: [{ name: 'Morning', steps: [{ words: 'Serum', item_id: serum.id }, { words: 'Moisturize', item_id: plain.id }, { words: 'Smile' }] }] });
  const [a, b, c] = r.times[0]!.steps;
  expect(a!.item).toBe('Vitamin C serum');
  expect(await mine().low(a!.id)).toEqual({ name: 'Vitamin C serum', added: true, already: false });
  expect((await kitchen(db, owner, clock).listGrocery()).map((g) => g.label)).toEqual(['Vitamin C serum']);
  expect((await things.listItems({ low: true })).map((i) => i.name)).toEqual(['Vitamin C serum']);
  expect(await mine().low(a!.id)).toEqual({ name: 'Vitamin C serum', added: false, already: true });
  expect(await mine().low(b!.id)).toMatchObject({ name: 'Moisturizer', added: true });
  expect((await kitchen(db, owner, clock).listGrocery())).toHaveLength(2);
  await expect(mine().low(c!.id)).rejects.toEqual(problem(400));
  // The thing's page says where it is used; a thing taken out leaves the step in place without it.
  expect(await mine().usedIn(serum.id)).toEqual([{ routine_id: r.id, routine: 'Skincare', time: 'Morning', title: 'Skincare: Morning' }]);
  expect(await mine().usedIn(plain.id)).toHaveLength(1);
  await things.deleteItem(serum.id);
  expect((await mine().get(r.id)).times[0]!.steps[0]).toMatchObject({ words: 'Serum', item_id: null, item: null });
  await expect(mine(partner).usedIn(plain.id)).rejects.toEqual(problem(404));
});

it('can be tagged, filtered by tag, found by search, and its links go when it is removed', async () => {
  const t = tags(db, owner, clock);
  const face = await t.create('Face');
  const a = await mine().create({ name: 'Skincare', for_user: owner, times: [{ name: 'Evening', steps: [{ words: 'Retinoid' }] }] });
  const b = await mine().create({ name: 'Bedtime', for_user: owner, times: [{ name: 'Bedtime', steps: [{ words: 'Lights out' }] }] });
  expect((await t.set('routine', a.id, [face.id])).map((x) => x.name)).toEqual(['Face']);
  expect((await mine().list({ tag: face.id })).map((r) => r.name)).toEqual(['Skincare']);
  expect((await mine().list()).find((r) => r.name === 'Skincare')!.tag_list.map((x) => x.name)).toEqual(['Face']);
  expect((await t.page(face.id)).groups.map((g) => [g.kind, g.items.map((i) => i.title)])).toEqual([['routine', ['Skincare']]]);
  // Search finds a routine by its name, a time's name, a step's words, or a tag.
  for (const q of ['skincare', 'retinoid', 'evening', 'face']) expect((await search(db, owner, q)).filter((r) => r.kind === 'routine').map((r) => r.title)).toEqual(['Skincare']);
  expect((await search(db, owner, 'lights', 'routine')).map((r) => r.title)).toEqual(['Bedtime']);
  expect(await search(db, partner, 'retinoid')).toEqual([]);
  await mine().remove(a.id);
  expect(await db.get('SELECT 1 AS one FROM tag_links WHERE kind = ? AND target_id = ?', ['routine', a.id])).toBeUndefined();
  expect(await db.get('SELECT 1 AS one FROM routine_steps')).toBeDefined(); // Bedtime's own
  expect((await db.all('SELECT id FROM routines')).map((r) => r.id)).toEqual([b.id]);
  await expect(mine(partner).remove(b.id)).rejects.toEqual(problem(404));
});

it('offers ready-made routines, once each by name', async () => {
  expect(ROUTINE_STARTERS.map((s) => s.slug)).toEqual(['morning', 'bedtime', 'after-school', 'weekly-reset', 'skincare', 'dog-daily', 'cat-daily', 'skin-cycle']);
  const skin = await mine().addStarter('skincare');
  expect(skin.times.map((t) => [t.name, t.steps.length])).toEqual([['Morning', 3], ['Evening', 2]]);
  expect((await mine().starters()).filter((s) => s.have).map((s) => s.slug)).toEqual(['skincare']);
  const cycle = await mine().addStarter('skin-cycle');
  expect([cycle.cycle_length, cycle.times[0]!.steps.map((s) => s.days)]).toEqual([4, ['every day', 'night 1 of 4', 'night 2 of 4', 'night 3 of 4', 'night 4 of 4', 'every day']]);
  await expect(mine().addStarter('nope')).rejects.toEqual(problem(404));
});

it('goes into the download with its history, and comes back in for someone else', async () => {
  const things = inventory(db, owner, clock);
  const kind = (await things.createKind({ name: 'Skincare', icon: '🧴' }))[0]!.id;
  const serum = await things.createItem({ kind_id: kind, name: 'Serum' });
  const kid = (await upkeep(db, owner, clock).addMember('Sam'))[0]!;
  const r = await mine().create({ name: 'Skin cycle', for_user: owner, cycle_length: 4, note: 'Four nights', times: [
    { name: 'Evening', at: '21:15', steps: [{ words: 'Wash' }, { words: 'Retinoid, with serum', rule: 'cycle', night: 2, item_id: serum.id, wait_seconds: 60 }, { words: 'Mask', rule: 'weekdays', weekdays: [1, 4] }] },
  ] });
  const chore = await mine().create({ name: 'After school', for_member: kid.id, points: 3, times: [{ name: 'After school', steps: [{ words: 'Bag away' }] }] });
  await mine().finish(r.times[0]!.id, true);
  await mine().finish(chore.times[0]!.id, true);
  const zip = (await exportEverything(db, owner, clock)).bytes;
  const { files } = await splitDownload(zip);
  expect(files['routines.csv']).toContain('Retinoid');
  expect(files['routine-history.csv']).toContain('2046-03-05');
  const bob = await person('bob');
  const done = await bringInDownload(db, bob, files, ['things', 'household', 'routines'], clock);
  for (const kind of done.kinds) if (['things', 'household', 'routines'].includes(kind.key)) expect(kind.ok, `${kind.key}: ${kind.problem}`).toBe(true);
  // The sign-in name is matched to a person here (the same Life Is in this test), so it stays theirs.
  const theirs = (await mine(bob).list()).sort((x, y) => x.name.localeCompare(y.name));
  expect(theirs.map((x) => [x.name, x.who_kind, x.cycle_length, x.points])).toEqual([['After school', 'member', null, 3], ['Skin cycle', 'person', 4, null]]);
  const skin = theirs.find((x) => x.name === 'Skin cycle')!;
  expect(skin.note).toBe('Four nights');
  expect(skin.times[0]).toMatchObject({ name: 'Evening', at: '21:15' });
  expect(skin.times[0]!.steps.map((s) => [s.words, s.days, s.wait_seconds, s.item])).toEqual([
    ['Wash', 'every day', null, null], ['Retinoid, with serum', 'night 2 of 4', 60, 'Serum'], ['Mask', 'Mon and Thu', null, null],
  ]);
  // When each time was finished came with it, so the cycle carries on from night 2.
  expect(skin.times[0]!.last7).toBe(1);
  expect((await mine(bob).time(skin.times[0]!.id, '2046-03-06')).night).toBe(2);
  // Bringing it in again adds nothing.
  const again = await bringInDownload(db, bob, files, ['routines'], clock);
  expect(again.kinds[0]).toMatchObject({ key: 'routines', ok: true, fresh: 0, already: 2 });
});

it('shows a pet routine to every person, with the pet name, while a person routine stays with its person', async () => {
  const biscuit = await pets(db, owner, clock).create({ name: 'Biscuit', species: 'dog' });
  const r = await mine().addStarter('dog-daily', null, null, biscuit.id);
  expect([r.who_kind, r.who, r.for_pet, r.for_user, r.times.map((t) => t.name)]).toEqual(['pet', 'Biscuit', biscuit.id, null, ['Morning', 'Evening']]);
  await mine().create({ name: 'Mine', for_user: owner, times: [{ name: 'Morning', steps: [{ words: 'Private' }] }] });
  const titles = async (who: number) => (await mine(who).today()).map((t) => t.title);
  expect(await titles(owner)).toEqual(['Biscuit: Morning', 'Biscuit: Evening', 'Mine: Morning']);
  expect(await titles(partner)).toEqual(['Biscuit: Morning', 'Biscuit: Evening']);
  // The pet's page asks for only its own.
  expect((await mine(partner).today(undefined, biscuit.id)).map((t) => t.pet_id)).toEqual([biscuit.id, biscuit.id]);
  expect(await mine(owner).today(undefined, biscuit.id + 99)).toEqual([]);
  // Only one owner: a routine is for a person, a pet, or everyone.
  await expect(mine().create({ name: 'Both', for_user: owner, for_pet: biscuit.id, times: [{ name: 'A', steps: [{ words: 'x' }] }] })).rejects.toEqual(problem(400));
  const other = pets(db, partner, clock);
  const theirs = await other.create({ name: 'Nibbles' });
  await expect(mine().create({ name: 'Not mine', for_pet: theirs.id, times: [{ name: 'A', steps: [{ words: 'x' }] }] })).rejects.toEqual(problem(404));
  // The two feed steps use the food when one is given, and the starter needs a pet.
  await expect(mine().addStarter('cat-daily')).rejects.toEqual(problem(400));
});

it('keeps who ticked a step and when, so the next person reads it and nobody does it twice', async () => {
  const biscuit = await pets(db, owner, clock).create({ name: 'Biscuit', species: 'dog' });
  const kind = (await inventory(db, owner, clock).createKind({ name: 'Pet', icon: '🐕' }))[0]!.id;
  const food = await inventory(db, owner, clock).createItem({ kind_id: kind, name: 'Dog food' });
  const r = await mine().addStarter('dog-daily', null, null, biscuit.id, food.id);
  const morning = r.times[0]!;
  expect(morning.steps.map((s) => [s.words, s.item])).toEqual([['Feed', 'Dog food'], ['Fresh water', null], ['Walk', null]]);
  await mine(partner).tick(morning.steps[0]!.id, true);
  const theirView = (await mine(owner).today())[0]!;
  const fed = theirView.steps[0]!;
  expect([fed.ticked, fed.by, fed.at]).toEqual([true, 'partner', stamp(clock())]);
  expect(theirView.steps[1]).toMatchObject({ ticked: false, by: null, at: null });
  // The person who did it sees "you".
  expect((await mine(partner).today())[0]!.steps[0]!.by).toBe('you');
  // A chosen display name is what others read.
  await db.run("INSERT INTO user_settings (user_id, key, value) VALUES (?, 'display_name', 'Sam')", [partner]);
  expect((await mine(owner).today())[0]!.steps[0]!.by).toBe('Sam');
  // Finishing the whole time keeps who and when for the rest.
  const done = await mine(owner).finish(morning.id, true);
  expect(done.steps.map((s) => s.by)).toEqual(['Sam', 'you', 'you']);
  expect(done.last7).toBe(1);
  // Taking a tick back clears who and when.
  const back = await mine(owner).tick(morning.steps[2]!.id, false);
  expect(back.steps[2]).toMatchObject({ ticked: false, by: null, at: null });
  // The feed step can be marked running low from the step by anyone, and it goes on the owner's grocery list.
  expect(await mine(partner).low(morning.steps[0]!.id)).toMatchObject({ name: 'Dog food', added: true });
});

it('takes a pet routine away with the pet', async () => {
  const biscuit = await pets(db, owner, clock).create({ name: 'Biscuit', species: 'dog' });
  await mine().addStarter('dog-daily', null, null, biscuit.id);
  await pets(db, owner, clock).remove(biscuit.id);
  expect(await mine().list()).toEqual([]);
});

it('keeps the pet link in the download and when it is brought in, and leaves a routine for a pet that is not here as everyone own', async () => {
  const biscuit = await pets(db, owner, clock).create({ name: 'Biscuit', species: 'dog' });
  await mine().addStarter('dog-daily', null, null, biscuit.id);
  const { files } = await splitDownload((await exportEverything(db, owner, clock)).bytes);
  expect(files['routines.csv']).toContain('For (pet)');
  const bob = await person('bob');
  const done = await bringInDownload(db, bob, files, ['pets', 'routines'], clock);
  for (const k of done.kinds) expect(k.ok, `${k.key}: ${k.problem}`).toBe(true);
  const theirs = (await mine(bob).list()).filter((x) => x.mine);
  expect(theirs.map((x) => [x.name, x.who_kind, x.who])).toEqual([['Dog, daily', 'pet', 'Biscuit']]);
  expect(theirs[0]!.for_pet).not.toBe(biscuit.id);
  expect(theirs[0]!.times.map((t) => t.steps.length)).toEqual([3, 2]);
  // Reading it twice adds nothing.
  expect((await bringInDownload(db, bob, files, ['routines'], clock)).kinds[0]).toMatchObject({ key: 'routines', fresh: 0, already: 1 });
  // Without the pets, it comes in as everyone's, and the count of what could not be linked says so.
  const carol = await person('carol');
  const lonely = await bringInDownload(db, carol, files, ['routines'], clock);
  expect(lonely.kinds[0]).toMatchObject({ key: 'routines', fresh: 1, unlinked: 1 });
  expect((await mine(carol).list()).filter((x) => x.mine).map((x) => x.who_kind)).toEqual(['everyone']);
});

it('upgrades from the version before pet routines: routines and ticks kept, ticks without a time, new ones with', async () => {
  const r = await mine().create({ name: 'Morning', times: [{ name: 'Morning', steps: [{ words: 'One' }, { words: 'Two' }] }] });
  await mine().tick(r.times[0]!.steps[0]!.id, true);
  await db.run('ALTER TABLE routines DROP COLUMN for_pet');
  await db.run('ALTER TABLE routine_ticks DROP COLUMN ticked_at');
  await db.run('PRAGMA user_version = 55');
  expect(await migrate(db)).toBe(LATEST);
  const before = (await mine(partner).today())[0]!;
  expect(before.steps.map((s) => [s.ticked, s.by, s.at])).toEqual([[true, 'owner', null], [false, null, null]]);
  expect(before.who_kind).toBe('everyone');
  await mine(partner).tick(before.steps[1]!.id, true);
  expect((await mine(owner).today())[0]!.steps[1]).toMatchObject({ by: 'partner', at: stamp(clock()) });
});
