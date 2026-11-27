/** The house manual, and the link it's shared by. */
import { beforeEach, expect, it } from 'vitest';
import type { Db } from '../src/db.ts';
import { inventory } from '../src/inventory.ts';
import { manual, manualFor, manualHtml, untilWords, type ManualStore } from '../src/manual.ts';
import { LATEST, migrate } from '../src/migrations.ts';
import { pets } from '../src/pets.ts';
import { memoryDb } from './memoryDb.ts';

let db: Db;
let owner: number;
let book: ManualStore;
let time = new Date(2046, 2, 5, 10, 0, 0);
const clock = () => time;
const problem = (status: number) => expect.objectContaining({ name: 'Problem', status });

async function person(name: string): Promise<number> {
  return (await db.run("INSERT INTO users (username, password_hash, created_at) VALUES (?, 'x', 'now')", [name])).lastId;
}

beforeEach(async () => {
  db = memoryDb();
  expect(await migrate(db)).toBe(LATEST);
  owner = await person('owner');
  time = new Date(2046, 2, 5, 10, 0, 0);
  book = manual(db, owner, clock);
});

it('entries are kept by section, can say where a thing is, and ideas already written are not offered again', async () => {
  const basement = (await inventory(db, owner, clock).createPlace({ name: 'Basement' }))[0]!.id;
  let m = await book.get();
  expect(m.sections.map((s) => s.id)).toEqual(['emergency', 'contacts', 'house', 'routines']);
  expect(m.sections[0]!.ideas).toContain('Water shut-off');
  m = await book.addEntry({ section: 'emergency', title: 'Water shut-off', body: 'Red lever behind the boiler.\nTurn it a quarter.', place_id: basement });
  m = await book.addEntry({ section: 'contacts', title: 'Plumber', phone: '555 0142', body: 'Ask for Dana' });
  expect(m.sections[0]!.entries.map((e) => [e.title, e.place, e.private])).toEqual([['Water shut-off', 'Basement', false]]);
  expect(m.sections[0]!.ideas).not.toContain('Water shut-off');
  const id = m.sections[1]!.entries[0]!.id;
  expect((await book.updateEntry(id, { section: 'contacts', title: 'Plumber (Dana)', phone: '555 0142' })).sections[1]!.entries[0]!.title).toBe('Plumber (Dana)');
  await expect(book.addEntry({ section: 'secrets', title: 'x' })).rejects.toEqual(problem(400));
  await expect(book.addEntry({ section: 'house', title: ' ' })).rejects.toEqual(problem(400));
  await expect(book.addEntry({ section: 'house', title: 'Key', place_id: 9999 })).rejects.toEqual(problem(404));
  await expect(manual(db, await person('other'), clock).updateEntry(id, { section: 'contacts', title: 'Mine' })).rejects.toEqual(problem(404));
  expect((await book.removeEntry(id)).sections[1]!.entries).toEqual([]);
});

it('the shared link shows everything but what is private, with the pets, until its day', async () => {
  await book.addEntry({ section: 'house', title: 'Wi-Fi', body: 'Network: Home\nPassword: <fish&chips>' });
  await book.addEntry({ section: 'house', title: 'Alarm', body: 'Code 4821', private: true });
  await pets(db, owner, clock).create({ name: 'Rex', species: 'dog', food: 'Two cups, twice a day', vet_name: 'Oak Lane Vets', vet_phone: '555 0100' });
  expect((await book.get()).share).toEqual({ on: false, token: null, expires_on: null, pets: true });

  const shared = (await book.shareFor(7)).share;
  expect([shared.on, shared.expires_on, shared.token]).toEqual([true, '2046-03-12', expect.stringMatching(/^[0-9a-f]{64}$/)]);
  const seen = (await manualFor(db, shared.token!, clock))!;
  expect(seen.sections).toEqual([{ title: 'How the house works', entries: [{ title: 'Wi-Fi', body: 'Network: Home\nPassword: <fish&chips>', phone: null, place: null }] }]);
  expect(seen.pets).toEqual([{ name: 'Rex', species: 'dog', food: 'Two cups, twice a day', vet_name: 'Oak Lane Vets', vet_phone: '555 0100', note: null }]);
  const page = manualHtml(seen);
  expect(page).toContain('Password: &lt;fish&amp;chips&gt;'); // what was written is shown, never run
  expect(page).toContain('<a href="tel:5550100">555 0100</a>');
  expect(page).not.toContain('4821');
  expect(page).not.toContain('<script');
  // In Life Is's look, loading nothing from another site, with the quiet credit on by default.
  expect(page).toContain('<meta name="robots" content="noindex, nofollow">');
  expect(page).toContain('prefers-color-scheme:dark');
  expect(page).not.toContain('Shared with you');
  expect(page).toContain('Nothing on this page can be changed from here.');
  expect(page).toContain('Made with Life Is, a private home organizer you run yourself. <a href="https://lifeis.living" rel="noopener noreferrer">lifeis.living</a>');
  const outside = [...page.matchAll(/(?:src|href)="(https?:[^"]*)"|url\((https?:[^)]*)\)/g)].map((x) => x[1] ?? x[2]);
  expect(outside).toEqual(['https://lifeis.living']);
  expect(page).toContain('/fonts/fraunces-soft.woff2');
  expect(page).toContain('src="/mark-192.png"');
  // Turned off, the credit is gone and the old line stays.
  expect((await book.get()).credit).toBe(true);
  expect((await book.setCredit(false)).credit).toBe(false);
  const quiet = manualHtml((await manualFor(db, shared.token!, clock))!);
  expect(quiet).not.toContain('lifeis.living');
  expect(quiet).not.toContain('Made with Life Is');
  expect(quiet).toContain('Nothing on this page can be changed from here.');
  expect((await book.setCredit(true)).credit).toBe(true);

  // A new link replaces the old; without pets when asked; and its day ends it.
  const again = (await book.shareFor(1, false)).share;
  expect(await manualFor(db, shared.token!, clock)).toBeNull();
  expect((await manualFor(db, again.token!, clock))!.pets).toEqual([]);
  time = new Date(2046, 2, 7, 10, 0, 0);
  expect(await manualFor(db, again.token!, clock)).toBeNull();
  expect((await book.get()).share.on).toBe(false);

  const open = (await book.shareFor(null)).share;
  expect([open.expires_on, (await manualFor(db, open.token!, clock)) !== null]).toEqual([null, true]);
  await book.stopSharing();
  expect(await manualFor(db, open.token!, clock)).toBeNull();
  expect(await manualFor(db, 'not-a-token', clock)).toBeNull();
  await expect(book.shareFor(0)).rejects.toEqual(problem(400));
});

it('says how long a shared link works in plain words', () => {
  expect([untilWords('2026-11-30'), untilWords('2026-11-28'), untilWords('2027-01-01')]).toEqual(['Monday, November 30', 'Saturday, November 28', 'Friday, January 1']);
});
