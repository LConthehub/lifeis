/** Measures: a person's own numbers over time, and proof that nobody else can ever read them, by any route. */
import { beforeEach, expect, it } from 'vitest';
import { actions } from '../src/actions.ts';
import { assistant } from '../src/assistant.ts';
import type { Fetcher, Sealer } from '../src/connections.ts';
import type { Db } from '../src/db.ts';
import { bringInDownload, exportEverything, splitDownload } from '../src/exportAll.ts';
import { home } from '../src/home.ts';
import { LATEST, migrate } from '../src/migrations.ts';
import { measures } from '../src/measures.ts';
import { reminders } from '../src/reminders.ts';
import { search } from '../src/search.ts';
import { tags } from '../src/tags.ts';
import { voice } from '../src/voice.ts';
import { memoryDb } from './memoryDb.ts';

let db: Db;
let boss: number;
let sam: number;
let pia: number;
const clock = Object.assign(() => new Date(Date.UTC(2046, 2, 5, 10, 0, 0)), { today: () => '2046-03-05' });
const problem = (status: number) => expect.objectContaining({ name: 'Problem', status });
const mine = (who: number) => measures(db, who, clock);

// Words and numbers that appear nowhere else, so finding one anywhere is a leak.
const NAME = 'Quillfeather';
const UNIT = 'zorbs';
const VALUE = 77.123;
const TARGET = 61.5;

async function person(name: string, admin = false): Promise<number> {
  return (await db.run("INSERT INTO users (username, password_hash, created_at, is_admin) VALUES (?, 'x', 'now', ?)", [name, admin ? 1 : 0])).lastId;
}

beforeEach(async () => {
  db = memoryDb();
  expect(await migrate(db)).toBe(LATEST);
  boss = await person('boss', true);
  sam = await person('sam');
  pia = await person('pia');
});

it('makes a measure with a unit and an optional target, adds dated entries, and lists the latest first', async () => {
  const w = await mine(sam).create({ name: '  Weight ', unit: 'lb' });
  expect(w).toMatchObject({ name: 'Weight', unit: 'lb', target: null, entries: [], entry_count: 0 });
  await mine(sam).addEntry(w.id, { value: 182.4, day: '2046-03-01' });
  await mine(sam).addEntry(w.id, { value: 181 });
  const later = await mine(sam).addEntry(w.id, { value: 180.6, day: '2046-03-04' });
  expect(later.entries.map((e) => [e.day, e.value])).toEqual([['2046-03-05', 181], ['2046-03-04', 180.6], ['2046-03-01', 182.4]]);
  const withTarget = await mine(sam).update(w.id, { name: 'Weight', unit: 'lb', target: 170 });
  expect(withTarget.target).toBe(170);
  expect((await mine(sam).update(w.id, { name: 'Weight', unit: 'lb' })).target).toBeNull();
  // Entries can be taken back, and a measure goes with its entries.
  const gone = await mine(sam).removeEntry(later.entries[0]!.id);
  expect(gone.entry_count).toBe(2);
  await mine(sam).remove(w.id);
  expect(await mine(sam).list()).toEqual([]);
  expect(await db.get('SELECT 1 AS one FROM measure_entries')).toBeUndefined();
});

it('says what is wrong in words', async () => {
  await expect(mine(sam).create({ name: '  ' })).rejects.toMatchObject({ status: 400 });
  await expect(mine(sam).create({ name: 'Pulse', target: Number.NaN })).rejects.toMatchObject({ status: 400 });
  const m = await mine(sam).create({ name: 'Pulse', unit: 'bpm' });
  await expect(mine(sam).addEntry(m.id, { value: Number.NaN })).rejects.toMatchObject({ status: 400 });
  await expect(mine(sam).addEntry(m.id, { value: 60, day: 'last tuesday' })).rejects.toMatchObject({ status: 400 });
});

it('judges nothing and suggests nothing: a measure holds only what the person typed', async () => {
  const m = await mine(sam).create({ name: 'Pulse', unit: 'bpm' });
  await mine(sam).addEntry(m.id, { value: 60, day: '2046-03-01' });
  await mine(sam).addEntry(m.id, { value: 70, day: '2046-03-02' });
  const shown = (await mine(sam).list())[0]!;
  expect(Object.keys(shown).sort()).toEqual(['entries', 'entry_count', 'id', 'name', 'target', 'unit']);
  expect(Object.keys(shown.entries[0]!).sort()).toEqual(['day', 'id', 'value']);
});

it('keeps measures to their person: nobody else, the person in charge included, can list, change, add to or remove one', async () => {
  const m = await mine(sam).create({ name: NAME, unit: UNIT, target: TARGET });
  const withEntry = await mine(sam).addEntry(m.id, { value: VALUE, day: '2046-03-02' });
  const entry = withEntry.entries[0]!;
  for (const other of [boss, pia]) {
    expect(await mine(other).list()).toEqual([]);
    await expect(mine(other).update(m.id, { name: 'Mine now' })).rejects.toEqual(problem(404));
    await expect(mine(other).remove(m.id)).rejects.toEqual(problem(404));
    await expect(mine(other).addEntry(m.id, { value: 1 })).rejects.toEqual(problem(404));
    await expect(mine(other).removeEntry(entry.id)).rejects.toEqual(problem(404));
  }
  // Nothing changed.
  expect(await mine(sam).list()).toEqual([{ id: m.id, name: NAME, unit: UNIT, target: TARGET, entries: [entry], entry_count: 1 }]);
});

it('is in no search, no tag, no front page, no reminder, no voice answer, no Siri list and no assistant answer, for anyone', async () => {
  const m = await mine(sam).create({ name: NAME, unit: UNIT, target: TARGET });
  await mine(sam).addEntry(m.id, { value: VALUE, day: '2046-03-05' });
  const leaks = (what: unknown) => JSON.stringify(what).includes(NAME) || JSON.stringify(what).includes(UNIT) || JSON.stringify(what).includes(String(VALUE));

  // Search: not by name, unit or number, not for the person it belongs to and not for the person in charge.
  for (const who of [sam, boss, pia]) {
    for (const q of [NAME, UNIT, String(VALUE), 'Quill', 'measure']) expect(await search(db, who, q), `${who} ${q}`).toEqual([]);
  }
  // Tags cannot be put on one.
  await expect(tags(db, sam, clock).set('measure' as never, m.id, [])).rejects.toBeDefined();

  // The front page and the morning digest.
  for (const who of [sam, boss]) {
    expect(leaks(await home(db, who, clock).summary())).toBe(false);
    expect(leaks(await reminders(db, who, clock).digest())).toBe(false);
  }

  // What a voice key says, and the short requests Siri and Google make.
  for (const who of [sam, boss]) {
    const say = voice(db, who, clock);
    expect(leaks([await say.today(true), await say.week(), await say.dinner(), await say.whatToBuy()])).toBe(false);
    expect(leaks(actions(db, who, clock).list())).toBe(false);
    expect(JSON.stringify(actions(db, who, clock).list()).toLowerCase()).not.toContain('measure');
  }

  // The assistant is given every part of Life Is it offers, and none of it holds a measure.
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
  for (const body of asked) expect(body.includes(NAME) || body.includes(UNIT) || body.includes(String(VALUE))).toBe(false);
});

it('is in the person\'s own full download, never in anyone else\'s, and comes back in with it, once', async () => {
  const m = await mine(sam).create({ name: NAME, unit: UNIT, target: TARGET });
  await mine(sam).addEntry(m.id, { value: VALUE, day: '2046-03-02' });
  await mine(sam).addEntry(m.id, { value: 78.5, day: '2046-03-03' });
  await mine(sam).create({ name: 'Nothing yet', unit: '' });

  const text = async (who: number) => {
    const files = (await splitDownload((await exportEverything(db, who, clock)).bytes)).files;
    return files;
  };
  const sams = await text(sam);
  expect(Object.keys(sams)).toContain('measures.csv');
  expect(sams['measures.csv']).toContain(NAME);
  expect(sams['measures.csv']).toContain(String(VALUE));
  expect(sams['README.txt']).toContain('measures.csv');
  for (const who of [boss, pia]) {
    const theirs = await text(who);
    expect(Object.values(theirs).some((t) => t.includes(NAME) || t.includes(UNIT) || t.includes(String(VALUE)))).toBe(false);
    expect(theirs['measures.csv'] ?? '').not.toContain(NAME);
  }

  // Brought into a person who has none, it makes them their own; again, it adds nothing.
  const done = await bringInDownload(db, pia, sams, ['measures'], clock);
  expect(done.kinds[0]).toMatchObject({ key: 'measures', ok: true, fresh: 2, already: 0 });
  const piaHas = await mine(pia).list();
  expect(piaHas.map((x) => [x.name, x.unit, x.target, x.entries.map((e) => [e.day, e.value])])).toEqual([
    [NAME, UNIT, TARGET, [['2046-03-03', 78.5], ['2046-03-02', VALUE]]], ['Nothing yet', '', null, []],
  ]);
  expect(piaHas[0]!.id).not.toBe(m.id);
  const again = await bringInDownload(db, pia, sams, ['measures'], clock);
  expect(again.kinds[0]).toMatchObject({ key: 'measures', fresh: 0, already: 2 });
  expect((await mine(pia).list())[0]!.entry_count).toBe(2);
  // Sam's own are as they were, and the person in charge still sees none.
  expect((await mine(sam).list())[0]!.entry_count).toBe(2);
  expect(await mine(boss).list()).toEqual([]);
});
