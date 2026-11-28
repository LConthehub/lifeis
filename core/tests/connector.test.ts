/** Use Life Is from your AI app: what a connection may read and add, what is never reachable, the log, and who may touch what. */
import { beforeEach, expect, it } from 'vitest';
import type { Db } from '../src/db.ts';
import { calendar } from '../src/calendar.ts';
import {
  CONNECTOR_SERVICE, RESULT_LIMIT, UNUSED_DAYS, callTool, checkConnection, connectionTools, connector, householdOn, stillLive,
  type Live, type SectionId,
} from '../src/connector.ts';
import { goals } from '../src/goals.ts';
import { holidays } from '../src/holidays.ts';
import { inventory } from '../src/inventory.ts';
import { kitchen } from '../src/kitchen.ts';
import { LATEST, migrate } from '../src/migrations.ts';
import { measures } from '../src/measures.ts';
import { mediaLists } from '../src/mediaLists.ts';
import { money } from '../src/money.ts';
import { plans } from '../src/plans.ts';
import { projects } from '../src/projects.ts';
import { memoryDb } from './memoryDb.ts';

let db: Db;
let boss: number;
let ana: number;
let bob: number;
let now = Date.UTC(2046, 2, 5, 10, 0, 0);
const clock = Object.assign(() => new Date(now), { today: () => new Date(now).toISOString().slice(0, 10) });
const problem = (status: number) => expect.objectContaining({ name: 'Problem', status });
const ALL: SectionId[] = ['kitchen', 'calendar', 'things', 'projects', 'lists', 'money'];

// Words that appear nowhere they are allowed to, so finding one in an answer is a leak.
const NEVER = ['Quillrifle', 'Quillrounds', 'Quillfeather', 'Zebrafeather', 'Zorbtron', 'alarm4455', 'SECRETNOTE', 'Dentistsecret'];

async function person(name: string, admin = false): Promise<number> {
  return (await db.run("INSERT INTO users (username, password_hash, is_admin, created_at) VALUES (?, 'x', ?, 'now')", [name, admin ? 1 : 0])).lastId;
}
/** A made connection, as the server would have written it. */
async function connection(owner: number, sections: SectionId[], mayAdd = false, name = 'Claude on my iPad', extra: { last?: string | null; made?: string } = {}): Promise<Live> {
  const made = await db.run(
    "INSERT INTO ai_connections (owner_id, client_id, app_name, name, sections, may_add, access_hash, refresh_hash, created_at, last_used_on) VALUES (?, 'c1', 'Claude', ?, ?, ?, 'aaa', 'bbb', ?, ?)",
    [owner, name, sections.join(','), mayAdd ? 1 : 0, extra.made ?? '2046-03-01T10:00:00+00:00', extra.last ?? null]);
  return { id: made.lastId, owner, name, sections, may_add: mayAdd };
}
const call = (live: Live, tool: string, args: Record<string, unknown> = {}) => callTool(db, clock, live, tool, args);
const info = (who: number) => connector(db, who, clock);

beforeEach(async () => {
  db = memoryDb();
  expect(await migrate(db)).toBe(LATEST);
  now = Date.UTC(2046, 2, 5, 10, 0, 0);
  boss = await person('boss', true);
  ana = await person('ana');
  bob = await person('bob');
});

/** Ana's household, with a recognizable word in everything that must never come out. */
async function fill() {
  const k = kitchen(db, ana, clock);
  await k.createRecipe({ title: 'Plum cake', ingredients_text: '3 plums\n1 cup flour' });
  await k.addGrocery({ label: 'oat milk' });
  await k.addPlan({ day: '2046-03-06', meal: 'dinner', title: 'Soup night' });
  await calendar(db, ana, clock).createEvent({ title: 'Piano lesson', day: '2046-03-07', time: '16:00', note: 'SECRETNOTE' });
  const cal = (await db.run("INSERT INTO followed_calendars (owner_id, name, url, show, zone, created_at) VALUES (?, 'Work', 'https://x.example/c.ics', 'titles', 'UTC', 'now')", [ana])).lastId;
  await db.run("INSERT INTO followed_events (calendar_id, day, time, title) VALUES (?, '2046-03-08', '09:00', 'Dentistsecret')", [cal]);
  const things = inventory(db, ana, clock);
  await things.addStarter('hunting');
  const kinds = await things.listKinds();
  const rifle = (await things.createItem({ kind_id: kinds.find((x) => x.name === 'Firearms')!.id, name: 'Quillrifle' })).id;
  await things.createItem({ kind_id: kinds.find((x) => x.name === 'Ammunition')!.id, name: 'Quillrounds' });
  const tools = (await things.createKind({ name: 'Tools' })).find((x) => x.name === 'Tools')!;
  await things.createItem({ kind_id: tools.id, name: 'Cordless drill' });
  const making = projects(db, ana, clock);
  const shed = await making.createProject({ name: 'Garden shed' });
  await making.addLine(shed.id, { label: 'Plywood' });
  await making.addLine(shed.id, { item_id: rifle });
  await measures(db, ana, clock).create({ name: 'Quillfeather', unit: 'zorbs' });
  await db.run("INSERT INTO manual_entries (owner_id, section, title, body, private, sort_order, created_at, updated_at) VALUES (?, 'wifi', 'Wi-Fi Zorbtron', 'alarm4455', 0, 0, 'now', 'now')", [ana]);
  const food = (await money(db, ana, clock).addCategory({ name: 'Food', monthly_cents: 50_000 })).id;
  await money(db, ana, clock).addEntry({ label: 'Milk run', cents: 450, category_id: food, day: '2046-03-02' });
  const holiday = await holidays(db, ana, clock).create({ name: 'Thanksgiving', rule: { kind: 'weekday', month: 11, weekday: 4, nth: 4 } });
  const plan = holiday.years[0]!.plan_id;
  await holidays(db, ana, clock).addGift(plan, { who: 'Maya', idea: 'Zebrafeather' });
  const gift = (await holidays(db, ana, clock).year(plan)).gifts[0]!.id;
  await holidays(db, ana, clock).updateGift(gift, { status: 'bought', cents: 1234 });
  await mediaLists(db, ana, clock).create({ name: 'Weekend films' });
}

const READS = ['get_grocery_list', 'get_meals', 'get_pantry', 'find_recipes', 'get_calendar', 'find_things', 'get_projects', 'get_lists', 'get_spending'];

it('says plainly what is sent, and to whom', () => {
  expect(CONNECTOR_SERVICE.name).toBe('Use Life Is from your AI app');
  expect(CONNECTOR_SERVICE.sends).toMatch(/Only when the AI app asks/);
  expect(CONNECTOR_SERVICE.sends).toMatch(/company that makes that AI app, through that company's servers/);
  expect(CONNECTOR_SERVICE.sends).toMatch(/Nothing is sent at any other time/);
  expect(CONNECTOR_SERVICE.sends).not.toMatch(/—/);
});

it('lists tools by the sections ticked, and adds only with the tick too', () => {
  const names = (sections: SectionId[], may_add: boolean) => connectionTools({ sections, may_add }).map((t) => t.name);
  expect(names([], true)).toEqual([]);
  expect(names(['kitchen'], false)).toEqual(['get_grocery_list', 'get_meals', 'get_pantry', 'find_recipes']);
  expect(names(['kitchen'], true)).toEqual(['get_grocery_list', 'get_meals', 'get_pantry', 'find_recipes', 'add_groceries']);
  expect(names(['calendar', 'lists'], true)).toEqual(['get_calendar', 'get_lists', 'add_event', 'add_reminder', 'add_to_list']);
  expect(names(['money'], true)).toEqual(['get_spending']);
  expect(names(['things', 'projects'], true)).toEqual(['find_things', 'get_projects']);
  expect(names(ALL, true)).toHaveLength(13);
  for (const t of connectionTools({ sections: ALL, may_add: true })) {
    expect(t.annotations).toMatchObject({ destructiveHint: false, openWorldHint: false, readOnlyHint: t.name.startsWith('add_') ? false : true });
    expect(t.description + t.title).not.toMatch(/—/);
  }
});

it('refuses a read outside the ticked sections, an add without the tick, and a tool that is not there', async () => {
  const live = await connection(ana, ['kitchen']);
  await expect(call(live, 'get_calendar')).rejects.toEqual(problem(403));
  await expect(call(live, 'get_spending')).rejects.toEqual(problem(403));
  await expect(call(live, 'add_groceries', { items: ['milk'] })).rejects.toEqual(problem(403)); // section ticked, "may add" not
  const adder = await connection(ana, ['calendar'], true);
  await expect(call(adder, 'add_groceries', { items: ['milk'] })).rejects.toEqual(problem(403)); // "may add", but not the kitchen
  await expect(call(adder, 'delete_everything')).rejects.toEqual(problem(404));
  await expect(call(adder, 'add_event', { title: '', day: '2046-03-09' })).rejects.toEqual(problem(400));
  await expect(call(adder, 'add_event', { title: 'x', day: 'tomorrow' })).rejects.toEqual(problem(400));
  expect((await info(ana).status()).log).toEqual([]); // a refusal is not a line in the log
});

it('never shows guns, ammunition, measures, gifts, the house manual or calendar notes, with everything ticked', async () => {
  await fill();
  const live = await connection(ana, ALL, true);
  let all = '';
  for (const tool of READS) all += await call(live, tool, tool === 'find_recipes' ? {} : {});
  all += await call(live, 'find_things', { query: 'quill' });
  all += await call(live, 'get_calendar', { days: 31 });
  const squeezed = all.replace(/[\s-]+/g, '');
  for (const word of NEVER) expect([word, squeezed.includes(word.replace(/-/g, ''))]).toEqual([word, false]);
  // What is allowed is there.
  for (const word of ['oat milk', 'Plum cake', 'Soup night', 'Piano lesson', 'Cordless drill', 'Garden shed', 'Plywood', 'Milk run', 'Weekend films', 'busy']) expect([word, all.includes(word)]).toEqual([word, true]);
});

it('shows other calendars as busy and nothing more, and no note on an event', async () => {
  await fill();
  const out = JSON.parse(await call(await connection(ana, ['calendar']), 'get_calendar', { days: 14 }));
  expect(out.calendar).toContainEqual({ day: '2046-03-08', time: '09:00', what: 'busy' });
  expect(out.calendar).toContainEqual({ day: '2046-03-07', time: '16:00', kind: 'event', title: 'Piano lesson' });
});

it('keeps meals off the calendar unless the kitchen is ticked too', async () => {
  await fill();
  const alone = await call(await connection(ana, ['calendar']), 'get_calendar', { days: 14 });
  expect(alone).not.toContain('Soup night');
  const both = await call(await connection(ana, ['calendar', 'kitchen']), 'get_calendar', { days: 14 });
  expect(both).toContain('Soup night');
});

it('leaves the gift out of spending and out of its totals', async () => {
  await fill();
  const out = JSON.parse(await call(await connection(ana, ['money']), 'get_spending'));
  expect(out.spent_on.map((e: { what: string }) => e.what)).toEqual(['Milk run']);
  expect(out.in_no_category).toBe(0);
  expect(out.total_spent).toBe(450);
  expect(out.categories).toEqual([{ name: 'Food', planned: 50_000, spent: 450, left: 49_550 }]);
  await expect(call(await connection(ana, ['money']), 'get_spending', { month: 'March' })).rejects.toEqual(problem(400));
});

it('leaves a gift out of spending and its totals on a plain plan and on a holiday year, with and without a goal', async () => {
  await fill();
  const mine = holidays(db, ana, clock);
  const plain = await plans(db, ana, clock).create({ name: 'Maya birthday', start_day: '2046-03-20' });
  await mine.addGift(plain.id, { who: 'Maya', idea: 'Quillkite' });
  const gift = (await db.get<{ id: number }>('SELECT id FROM holiday_gifts WHERE plan_id = ?', [plain.id]))!.id;
  await mine.updateGift(gift, { status: 'bought', cents: 1800 });
  const year = (await db.get<{ plan_id: number }>('SELECT plan_id FROM holiday_years LIMIT 1'))!.plan_id;
  const check = async () => {
    const out = JSON.parse(await call(await connection(ana, ['money']), 'get_spending'));
    expect(JSON.stringify(out)).not.toMatch(/Quillkite|gift/i);
    expect(out.spent_on.map((e: { what: string }) => e.what)).toEqual(['Milk run']);
    expect(out.in_no_category).toBe(0);
    expect(out.total_spent).toBe(450);
    expect(out.categories).toEqual([{ name: 'Food', planned: 50_000, spent: 450, left: 49_550 }]);
  };
  await check(); // no goal on either plan
  await goals(db, ana, clock).start({ plan_id: plain.id, target_cents: 5000 });
  await goals(db, ana, clock).start({ plan_id: year, target_cents: 5000 });
  await check(); // a goal on each
});

it('keeps an answer within the limit by shortening the longest list, and says so', async () => {
  const rows = Array.from({ length: 3000 }, (_, i) => `(${ana}, 'Item number ${i} with a long enough name to take up room', 0, 'now')`).join(',');
  await db.run(`INSERT INTO grocery (owner_id, label, done, created_at) VALUES ${rows}`);
  const out = await call(await connection(ana, ['kitchen']), 'get_grocery_list');
  expect(out.length).toBeLessThanOrEqual(RESULT_LIMIT);
  const parsed = JSON.parse(out);
  expect(parsed.note).toMatch(/shortened/);
  expect(parsed.grocery_list.length).toBeLessThan(3000);
});

it('adds groceries, marks them with the connection, adds nothing twice, and undoes exactly those rows', async () => {
  await kitchen(db, ana, clock).addGrocery({ label: 'oat milk' });
  const live = await connection(ana, ['kitchen'], true, 'Claude on my iPad');
  const said = await call(live, 'add_groceries', { items: ['oat milk', '2 lb chicken thighs', 'eggs'] });
  expect(said).toMatch(/^Added to the grocery list: .*chicken thighs.*eggs/);
  expect(said).toMatch(/One was already there/);
  const rows = await db.all<{ id: number; label: string; note: string | null }>('SELECT id, label, note FROM grocery WHERE owner_id = ? ORDER BY id', [ana]);
  expect(rows.map((r) => [r.label, r.note])).toEqual([['oat milk', null], ['chicken thighs', 'Added by Claude on my iPad'], ['eggs', 'Added by Claude on my iPad']]);
  expect(await call(live, 'add_groceries', { items: ['eggs'] })).toMatch(/already on the grocery list. Nothing was added/);
  expect(await db.all('SELECT id FROM grocery WHERE owner_id = ?', [ana])).toHaveLength(3);

  const lines = (await info(ana).status()).log;
  expect(lines.map((l) => [l.kind, l.can_undo])).toEqual([['add', false], ['add', true]]);
  expect(lines[1]!.what).toMatch(/^Added to the grocery list: .*chicken thighs/);
  // One of the two rows is gone already; undo takes away only what is still there, and never the older line.
  await db.run('DELETE FROM grocery WHERE id = ?', [rows[2]!.id]);
  await info(ana).undo(lines[1]!.id);
  expect((await db.all<{ label: string }>('SELECT label FROM grocery WHERE owner_id = ?', [ana])).map((r) => r.label)).toEqual(['oat milk']);
  expect((await info(ana).status()).log[1]).toMatchObject({ can_undo: false, undone: true });
  await expect(info(ana).undo(lines[1]!.id)).rejects.toEqual(problem(409));
  await expect(info(ana).undo(lines[0]!.id)).rejects.toEqual(problem(409)); // it added nothing
});

it('adds an event and a reminder to the calendar, once each, and undoes them', async () => {
  const live = await connection(ana, ['calendar'], true, 'Claude at work');
  expect(await call(live, 'add_event', { title: 'Dentist', day: '2046-03-09', time: '14:30' })).toBe('Added to the calendar: Dentist, 2046-03-09 at 14:30.');
  expect(await call(live, 'add_reminder', { text: 'Call Mom', when: 'tomorrow at 3pm' })).toBe('Added a reminder: Call Mom, 2046-03-06 at 15:00.');
  expect(await call(live, 'add_reminder', { text: 'Pay rent' })).toBe('Added a reminder: Pay rent, 2046-03-05.');
  expect(await call(live, 'add_event', { title: 'dentist', day: '2046-03-09', time: '14:30' })).toMatch(/already on the calendar/);
  await expect(call(live, 'add_reminder', { text: 'x', when: 'whenever' })).rejects.toEqual(problem(400));
  const events = await db.all<{ id: number; title: string; note: string | null }>('SELECT id, title, note FROM events WHERE owner_id = ? ORDER BY id', [ana]);
  expect(events.map((e) => [e.title, e.note])).toEqual([['Dentist', 'Added by Claude at work'], ['Call Mom', 'Added by Claude at work'], ['Pay rent', 'Added by Claude at work']]);
  const log = (await info(ana).status()).log;
  expect(log.filter((l) => l.can_undo)).toHaveLength(3);
  await info(ana).undo(log.find((l) => l.what.includes('Call Mom'))!.id);
  expect((await db.all<{ title: string }>('SELECT title FROM events WHERE owner_id = ? ORDER BY id', [ana])).map((e) => e.title)).toEqual(['Dentist', 'Pay rent']);
});

it('adds a title to one of the person\'s own lists, and undoes it; not to a list that is not theirs', async () => {
  const mine = await mediaLists(db, ana, clock).create({ name: 'Weekend films', shared: true });
  await mediaLists(db, bob, clock).create({ name: 'Bob only' });
  const live = await connection(ana, ['lists'], true, 'Claude');
  expect(await call(live, 'add_to_list', { list: 'weekend FILMS', title: 'Arrival', type: 'film' })).toBe('Added to the list Weekend films: Arrival.');
  expect(await call(live, 'add_to_list', { list: 'Weekend films', title: 'arrival', type: 'film' })).toMatch(/already on Weekend films/);
  await expect(call(live, 'add_to_list', { list: 'Bob only', title: 'Heat', type: 'film' })).rejects.toEqual(problem(400));
  await expect(call(live, 'add_to_list', { list: 'Weekend films', title: 'Heat', type: 'poem' })).rejects.toEqual(problem(400));
  const there = (await mediaLists(db, ana, clock).get(mine.id)).entries;
  expect(there.map((e) => [e.title, e.note])).toEqual([['Arrival', 'Added by Claude']]);
  await call(live, 'add_to_list', { list: 'Wanted', title: 'Dune', type: 'book' });
  expect((await mediaLists(db, ana, clock).all()).find((l) => l.builtin === 'wanted')!.count).toBe(1);
  const log = (await info(ana).status()).log.filter((l) => l.can_undo);
  expect(log).toHaveLength(2);
  for (const l of log) await info(ana).undo(l.id);
  expect((await mediaLists(db, ana, clock).get(mine.id)).entries).toEqual([]);
  expect((await mediaLists(db, ana, clock).all()).find((l) => l.builtin === 'wanted')!.count).toBe(0);
});

it('writes a plain line for every call, shows the newest 100 with the connection\'s name, and drops lines older than 90 days', async () => {
  await fill();
  const live = await connection(ana, ['kitchen', 'money']);
  await call(live, 'get_grocery_list');
  await call(live, 'find_recipes', { query: 'plum' });
  await call(live, 'get_spending');
  expect((await info(ana).status()).log.map((l) => [l.connection, l.kind, l.what]).reverse()).toEqual([
    ['Claude on my iPad', 'read', 'Read the grocery list'],
    ['Claude on my iPad', 'read', 'Looked up recipes for "plum"'],
    ['Claude on my iPad', 'read', 'Read your spending for 2046-03'],
  ]);
  for (let i = 0; i < 110; i += 1) await call(live, 'get_pantry');
  const shown = (await info(ana).status()).log;
  expect(shown).toHaveLength(100);
  expect(shown[0]!.what).toBe('Read the pantry');
  expect(shown[0]!.id).toBeGreaterThan(shown[99]!.id);
  // 91 days on, the next call clears the old lines.
  now += 91 * 86_400_000;
  await call(live, 'get_grocery_list');
  const later = (await info(ana).status()).log;
  expect(later.map((l) => l.what)).toEqual(['Read the grocery list']);
  expect(await db.get('SELECT COUNT(*) AS n FROM ai_log WHERE at < ?', ['2046-03-06'])).toEqual({ n: 0 });
  // Using a connection counts as using it today.
  expect(await db.get('SELECT last_used_on FROM ai_connections WHERE id = ?', [live.id])).toEqual({ last_used_on: new Date(now).toISOString().slice(0, 10) });
});

it('is live until it has gone 90 days unused, or has been ended', () => {
  const fresh = { ended_at: null, created_at: '2046-03-01T10:00:00+00:00', last_used_on: null };
  expect(UNUSED_DAYS).toBe(90);
  expect(stillLive(fresh, '2046-03-01')).toBe(true);
  expect(stillLive(fresh, '2046-05-29')).toBe(true); // day 89
  expect(stillLive(fresh, '2046-05-30')).toBe(false); // day 90: it ended
  expect(stillLive({ ...fresh, last_used_on: '2046-05-20' }, '2046-07-01')).toBe(true);
  expect(stillLive({ ...fresh, last_used_on: '2046-05-20' }, '2046-08-18')).toBe(false);
  expect(stillLive({ ...fresh, ended_at: '2046-03-02T00:00:00+00:00' }, '2046-03-02')).toBe(false);
});

it('shows each person only their own connections and log, the person in charge too, and lets nobody change another\'s', async () => {
  const mineA = await connection(ana, ['kitchen'], true, 'Ana app');
  const mineB = await connection(bob, ['kitchen'], true, 'Bob app');
  await call(mineA, 'add_groceries', { items: ['pears'] });
  await call(mineB, 'add_groceries', { items: ['plums'] });
  for (const who of [boss, ana, bob]) {
    const status = await info(who).status();
    expect(status.connections.map((c) => c.name)).toEqual(who === ana ? ['Ana app'] : who === bob ? ['Bob app'] : []);
    expect(status.log.map((l) => l.connection)).toEqual(who === ana ? ['Ana app'] : who === bob ? ['Bob app'] : []);
  }
  const bobsLine = (await info(bob).status()).log[0]!.id;
  await expect(info(boss).undo(bobsLine)).rejects.toEqual(problem(404));
  await expect(info(ana).undo(bobsLine)).rejects.toEqual(problem(404));
  await expect(info(ana).update(mineB.id, { name: 'Mine now' })).rejects.toEqual(problem(404));
  await expect(info(boss).update(mineB.id, { may_add: false })).rejects.toEqual(problem(404));
  await expect(info(ana).cutOff(mineB.id)).rejects.toEqual(problem(404));
  await expect(info(boss).cutOff(mineB.id)).rejects.toEqual(problem(404));
  expect(await db.get('SELECT ended_at, access_hash FROM ai_connections WHERE id = ?', [mineB.id])).toEqual({ ended_at: null, access_hash: 'aaa' });
  // Undo reaches only rows that are the person's own, even if a log line named another's.
  await db.run("UPDATE ai_log SET added_ids = ? WHERE owner_id = ?", [(await db.get<{ id: number }>('SELECT id FROM grocery WHERE label = ?', ['plums']))!.id, ana]);
  await info(ana).undo((await info(ana).status()).log[0]!.id);
  expect(await db.all('SELECT label FROM grocery WHERE owner_id = ?', [bob])).toEqual([{ label: 'plums' }]);
});

it('changes a connection\'s name, sections and add tick, and cuts one off while the log still names it', async () => {
  const live = await connection(ana, ['kitchen'], false, 'Old name');
  await call(live, 'get_pantry');
  const changed = await info(ana).update(live.id, { name: '  Claude in the kitchen ', sections: ['calendar', 'kitchen', 'calendar'], may_add: true });
  expect(changed).toMatchObject({ id: live.id, name: 'Claude in the kitchen', app_name: 'Claude', sections: ['kitchen', 'calendar'], may_add: true, last_used_on: '2046-03-05', ends_on: '2046-06-03' });
  expect((await info(ana).update(live.id, { may_add: false })).sections).toEqual(['kitchen', 'calendar']); // what was not sent stays
  await expect(info(ana).update(live.id, { sections: ['passwords'] })).rejects.toEqual(problem(400));
  await expect(info(ana).update(live.id, { name: '   ' })).rejects.toEqual(problem(400));
  await info(ana).cutOff(live.id);
  await info(ana).cutOff(live.id); // again is fine
  expect(await db.get('SELECT ended_at IS NOT NULL AS ended, access_hash, refresh_hash, old_refresh_hash, code_hash FROM ai_connections WHERE id = ?', [live.id]))
    .toEqual({ ended: 1, access_hash: null, refresh_hash: null, old_refresh_hash: null, code_hash: null });
  const status = await info(ana).status();
  expect(status.connections).toEqual([]);
  expect(status.log.map((l) => l.connection)).toEqual(['Claude in the kitchen']);
  await expect(info(ana).update(live.id, { name: 'Back' })).rejects.toEqual(problem(409));
});

it('ends a connection that nobody used for 90 days', async () => {
  const live = await connection(ana, ['kitchen'], false, 'Forgotten', { made: '2045-11-01T10:00:00+00:00' });
  expect((await info(ana).status()).connections.map((c) => c.id)).toEqual([]);
  expect(await db.get('SELECT ended_at IS NOT NULL AS ended, access_hash FROM ai_connections WHERE id = ?', [live.id])).toEqual({ ended: 1, access_hash: null });
});

it('is off for the household until the person in charge turns it on, and turning it off ends every connection and clears every token', async () => {
  expect(await householdOn(db)).toBe(false);
  expect((await info(ana).status()).household_on).toBe(false);
  await expect(info(ana).setHousehold(true, false)).rejects.toEqual(problem(403));
  expect(await householdOn(db)).toBe(false);
  await info(boss).setHousehold(true, true);
  expect(await householdOn(db)).toBe(true);
  expect((await info(ana).status()).household_on).toBe(true);
  const a = await connection(ana, ['kitchen']);
  const b = await connection(bob, ['calendar']);
  await db.run("UPDATE ai_connections SET code_hash = 'c', old_refresh_hash = 'o', access_expires_at = 'x' WHERE id = ?", [b.id]);
  await expect(info(bob).setHousehold(false, false)).rejects.toEqual(problem(403));
  expect((await info(bob).status()).connections).toHaveLength(1);
  await info(boss).setHousehold(false, true);
  expect(await householdOn(db)).toBe(false);
  for (const who of [a, b]) {
    expect(await db.get('SELECT ended_at IS NOT NULL AS ended, access_hash, refresh_hash, old_refresh_hash, code_hash, access_expires_at FROM ai_connections WHERE id = ?', [who.id]))
      .toEqual({ ended: 1, access_hash: null, refresh_hash: null, old_refresh_hash: null, code_hash: null, access_expires_at: null });
    expect((await info(who.owner).status()).connections).toEqual([]);
  }
});

it('tidies what the approval page sent', () => {
  expect(checkConnection({ name: '  Claude   ', sections: ['money', 'kitchen', 'kitchen'], may_add: true })).toEqual({ name: 'Claude', sections: ['kitchen', 'money'], may_add: true });
  expect(checkConnection({ name: 'x' })).toEqual({ name: 'x', sections: [], may_add: false });
  expect(() => checkConnection({ name: '' })).toThrow(/name/);
  expect(() => checkConnection({ name: 'x', sections: ['mail'] })).toThrow();
});
