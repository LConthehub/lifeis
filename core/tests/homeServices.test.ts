/** Home lab: who sees each link, who may change them, pins, search, the Home card, the guest view and the download. */
import { beforeEach, expect, it } from 'vitest';
import type { Db } from '../src/db.ts';
import { bringInDownload, exportEverything, splitDownload } from '../src/exportAll.ts';
import { home } from '../src/home.ts';
import { homeServices } from '../src/homeServices.ts';
import { manual, manualFor, manualHtml } from '../src/manual.ts';
import { migrate } from '../src/migrations.ts';
import { search } from '../src/search.ts';
import { memoryDb } from './memoryDb.ts';

let db: Db;
let boss: number;
let ana: number;
let bob: number;
const clock = () => new Date(2046, 2, 5, 10, 0, 0);

async function person(name: string, admin = false): Promise<number> {
  return (await db.run("INSERT INTO users (username, password_hash, is_admin, created_at) VALUES (?, 'x', ?, 'now')", [name, admin ? 1 : 0])).lastId;
}
const of = (who: number) => homeServices(db, who, clock);
const names = async (who: number) => (await of(who).list()).services.map((s) => s.name);
const problem = (status: number) => expect.objectContaining({ name: 'Problem', status });

beforeEach(async () => {
  db = memoryDb();
  await migrate(db);
  boss = await person('boss', true);
  ana = await person('ana');
  bob = await person('bob');
});

async function setUp() {
  await of(boss).create({ name: 'Jellyfin', address: 'http://192.168.1.20:8096', address_at: 'home', address2: 'https://watch.example.com', address2_at: 'away', icon: 'media', color: 'plum', group: 'Watch', guests: true });
  await of(boss).create({ name: 'Photos', address: 'http://192.168.1.21:2283', who: 'chosen', people: [ana], icon: 'photo', color: 'green', group: 'Files' });
  await of(boss).create({ name: 'Router', address: 'http://192.168.1.1', who: 'me', icon: 'settings', color: 'rust', group: 'House', note: 'Admin page' });
}

it('everyone, chosen people and only the person in charge: each sees their own, in the list, in search, and on the Home card', async () => {
  await setUp();
  expect(await names(boss)).toEqual(['Jellyfin', 'Photos', 'Router']);
  expect(await names(ana)).toEqual(['Jellyfin', 'Photos']);
  expect(await names(bob)).toEqual(['Jellyfin']);
  for (const [who, found] of [[boss, 1], [ana, 0], [bob, 0]] as const) expect((await search(db, who, 'router')).filter((r) => r.kind === 'service')).toHaveLength(found);
  expect((await search(db, bob, 'photos')).filter((r) => r.kind === 'service')).toEqual([]);
  expect((await search(db, ana, 'photos')).filter((r) => r.kind === 'service')).toEqual([expect.objectContaining({ title: 'Photos', link: '/manual/services' })]);
  // Only the person in charge is told who sees what.
  expect((await of(ana).list()).services.every((s) => s.sharing === null)).toBe(true);
  expect((await of(ana).list()).people).toEqual([]);
  const mine = await of(boss).list();
  expect(mine.services[1]!.sharing).toEqual({ who: 'chosen', people: [ana], guests: false });
  expect(mine.people.map((p) => p.name)).toEqual(['ana', 'bob']);
});

it('only the person in charge adds, changes or removes links', async () => {
  await setUp();
  const id = (await of(boss).list()).services[0]!.id;
  const input = { name: 'Sneaky', address: 'http://x.example.com' };
  await expect(of(ana).create(input)).rejects.toEqual(problem(403));
  await expect(of(ana).update(id, input)).rejects.toEqual(problem(403));
  await expect(of(ana).remove(id)).rejects.toEqual(problem(403));
  expect(await names(boss)).toEqual(['Jellyfin', 'Photos', 'Router']);
});

it('a link hidden from someone does not exist for them: no look, no pin, no change', async () => {
  await setUp();
  const router = (await of(boss).list()).services[2]!.id;
  await expect(of(ana).pin(router)).rejects.toEqual(problem(404));
  await expect(of(bob).pin((await of(boss).list()).services[1]!.id)).rejects.toEqual(problem(404));
  await expect(of(ana).update(router, { name: 'x', address: 'http://x.example.com' })).rejects.toEqual(problem(403));
});

it('each person pins to their own Home card; a link taken away from someone leaves their card', async () => {
  await setUp();
  const [jelly, photos] = (await of(boss).list()).services;
  await of(ana).pin(jelly!.id);
  await of(ana).pin(photos!.id);
  await of(bob).pin(jelly!.id);
  expect((await of(ana).pinned()).map((s) => s.name)).toEqual(['Jellyfin', 'Photos']);
  expect((await of(bob).pinned()).map((s) => s.name)).toEqual(['Jellyfin']);
  expect((await of(boss).pinned())).toEqual([]);
  let card = await home(db, ana, clock).summary();
  expect(card.cards.includes('services')).toBe(true);
  expect(card.services.map((s) => s.name)).toEqual(['Jellyfin', 'Photos']);
  // Photos is no longer for Ana: it leaves her list, her card, and her pins.
  await of(boss).update(photos!.id, { name: 'Photos', address: 'http://192.168.1.21:2283', who: 'chosen', people: [bob] });
  expect((await of(ana).pinned()).map((s) => s.name)).toEqual(['Jellyfin']);
  expect(await names(ana)).toEqual(['Jellyfin']);
  card = await home(db, ana, clock).summary();
  expect(card.services.map((s) => s.name)).toEqual(['Jellyfin']);
  await of(ana).unpin(jelly!.id);
  expect((await home(db, ana, clock).summary()).cards.includes('services')).toBe(false);
});

it('an address is checked: web only, no password in it, a second one for the other place', async () => {
  await expect(of(boss).create({ name: 'A', address: 'ftp://nas.local' })).rejects.toEqual(problem(400));
  await expect(of(boss).create({ name: 'A', address: 'javascript:alert(1)' })).rejects.toEqual(problem(400));
  await expect(of(boss).create({ name: 'A', address: 'http://me:secret@nas.local' })).rejects.toEqual(problem(400));
  await expect(of(boss).create({ name: 'A', address: 'nas.local has a space' })).rejects.toEqual(problem(400));
  await expect(of(boss).create({ name: '', address: 'nas.local' })).rejects.toEqual(problem(400));
  await expect(of(boss).create({ name: 'A', address: 'nas.local', icon: 'skull' })).rejects.toEqual(problem(400));
  await expect(of(boss).create({ name: 'A', address: 'a.example.com', address_at: 'home', address2: 'b.example.com', address2_at: 'home' })).rejects.toEqual(problem(400));
  await expect(of(boss).create({ name: 'A', address: 'nas.local', who: 'chosen', people: [9999] })).rejects.toEqual(problem(404));
  const made = (await of(boss).create({ name: 'NAS', address: '192.168.1.5:5000' })).services[0]!;
  expect([made.address, made.address_at, made.address2, made.icon, made.color]).toEqual(['http://192.168.1.5:5000', 'any', null, 'link', 'brown']);
  // Two addresses: the first has no mark, so it takes the one the second does not.
  const two = (await of(boss).create({ name: 'Both', address: 'a.example.com', address2: 'http://b.local', address2_at: 'home' })).services[1]!;
  expect([two.address_at, two.address2_at]).toEqual(['away', 'home']);
});

it('the shared house manual shows only links marked for guests, and only the away address', async () => {
  await setUp();
  await of(boss).create({ name: 'Printer', address: 'http://192.168.1.30', address_at: 'home', guests: true, note: 'Prints from the guest room' });
  await of(boss).create({ name: 'Wiki', address: 'https://wiki.example.com', guests: false });
  await manual(db, boss, clock).addEntry({ section: 'house', title: 'Wi-Fi', body: 'ask' });
  await manual(db, boss, clock).shareFor(3);
  const token = (await manual(db, boss, clock).get()).share.token!;
  const shared = (await manualFor(db, token, clock))!;
  expect(shared.services).toEqual([
    { name: 'Jellyfin', group: 'Watch', note: null, address: 'https://watch.example.com', only_at_home: false },
    { name: 'Printer', group: null, note: 'Prints from the guest room', address: null, only_at_home: true },
  ]);
  const page = manualHtml(shared);
  expect(page).toContain('https://watch.example.com');
  expect(page).toContain('Only works at home.');
  expect(page).toContain('<h2>Links</h2>');
  expect(page).not.toContain('Home lab');
  expect(page).not.toContain('Home services');
  for (const left of ['192.168.1.20', '192.168.1.30', 'Router', 'Photos', 'Wiki', '192.168.1.1']) expect(page).not.toContain(left);
  // A person who cannot see a link cannot hand it to guests, whatever it is marked.
  await of(boss).update((await of(boss).list()).services[0]!.id, { name: 'Jellyfin', address: 'http://192.168.1.20:8096', address_at: 'home', address2: 'https://watch.example.com', address2_at: 'away', who: 'me', guests: true });
  await manual(db, ana, clock).shareFor(3);
  expect((await manualFor(db, (await manual(db, ana, clock).get()).share.token!, clock))!.services.map((v) => v.name)).toEqual(['Printer']);
});

it('links are in the download, left out of other people’s, and come back on bring in once only', async () => {
  await setUp();
  const [jelly] = (await of(boss).list()).services;
  await of(boss).pin(jelly!.id);
  const mine = await splitDownload((await exportEverything(db, boss, clock)).bytes);
  expect(mine.files['home-services.csv']).toContain('Router');
  expect(mine.files['home-services.csv']).toContain('Only the person in charge');
  const theirs = await splitDownload((await exportEverything(db, ana, clock)).bytes);
  expect(theirs.files['home-services.csv']).toContain('Photos');
  expect(theirs.files['home-services.csv']).not.toMatch(/Router|192\.168\.1\.1,|Only the person/);
  expect((await splitDownload((await exportEverything(db, bob, clock)).bytes)).files['home-services.csv']).not.toContain('Photos');

  // Back in, on a fresh Life Is where the person in charge has the same name.
  const fresh = memoryDb();
  await migrate(fresh);
  const newBoss = (await fresh.run("INSERT INTO users (username, password_hash, is_admin, created_at) VALUES ('boss', 'x', 1, 'now')")).lastId;
  const newAna = (await fresh.run("INSERT INTO users (username, password_hash, is_admin, created_at) VALUES ('ana', 'x', 0, 'now')")).lastId;
  const first = await bringInDownload(fresh, newBoss, mine.files, ['services'], clock);
  expect(first.kinds.find((k) => k.key === 'services')).toMatchObject({ found: 3, fresh: 3, already: 0 });
  const again = await bringInDownload(fresh, newBoss, mine.files, ['services'], clock);
  expect(again.kinds.find((k) => k.key === 'services')).toMatchObject({ found: 3, fresh: 0, already: 3 });
  const back = await homeServices(fresh, newBoss, clock).list();
  expect(back.services.map((s) => [s.name, s.address, s.address2, s.icon, s.color, s.group, s.pinned, s.sharing?.who, s.sharing?.guests])).toEqual([
    ['Jellyfin', 'http://192.168.1.20:8096', 'https://watch.example.com', 'media', 'plum', 'Watch', true, 'everyone', true],
    ['Photos', 'http://192.168.1.21:2283', null, 'photo', 'green', 'Files', false, 'chosen', false],
    ['Router', 'http://192.168.1.1', null, 'settings', 'rust', 'House', false, 'me', false],
  ]);
  expect(back.services[1]!.sharing!.people).toEqual([newAna]);
  // The person without charge cannot bring links in.
  const notBoss = await bringInDownload(fresh, newAna, mine.files, ['services'], clock);
  expect(notBoss.kinds.find((k) => k.key === 'services')).toMatchObject({ fresh: 0 });
  expect((await homeServices(fresh, newBoss, clock).list()).services).toHaveLength(3);
});
