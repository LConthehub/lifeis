/** Renting: the landlord's jobs and their notes, the lease and its reminders, the move-in and move-out record, and all of it through a download. */
import { beforeEach, expect, it } from 'vitest';
import type { Db } from '../src/db.ts';
import { bringInDownload, bringInPictures, exportEverything, KINDS, splitDownload, type PictureIn } from '../src/exportAll.ts';
import { LATEST, migrate } from '../src/migrations.ts';
import { reminders } from '../src/reminders.ts';
import { renters } from '../src/renters.ts';
import { upkeep } from '../src/upkeep.ts';
import { memoryDb } from './memoryDb.ts';

let db: Db;
let owner: number;
let other: number;
let day = '2046-03-05';
const clock = Object.assign(() => new Date(2046, 2, 5, 10, 0, 0), { today: () => day });
const problem = (status: number) => expect.objectContaining({ name: 'Problem', status });
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const JPG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 9, 9, 9, 9]);

async function person(name: string): Promise<number> {
  return (await db.run("INSERT INTO users (username, password_hash, created_at) VALUES (?, 'x', 'now')", [name])).lastId;
}
const mine = () => renters(db, owner, clock);

beforeEach(async () => {
  db = memoryDb();
  expect(await migrate(db)).toBe(LATEST);
  day = '2046-03-05';
  owner = await person('owner');
  other = await person('other');
});

it('a job marked as the landlord\'s is asked about, with a dated note that is kept, until it is fixed', async () => {
  const job = await upkeep(db, owner, clock).create({ name: 'Leaking kitchen tap', landlord: true, note: 'It drips all night' });
  expect(job).toMatchObject({ landlord: true, asked_on: null, fixed_on: null, asked_days: null });
  await mine().setLease({ landlord_name: 'Loretta' });
  const preview = await mine().preview(job.id, { since: '2046-03-01', place: 'Kitchen sink' });
  expect(preview.text).toBe([
    'Date: Mar 5, 2046', 'To: Loretta', 'Repair needed: Leaking kitchen tap', 'What is wrong: It drips all night', 'Since: Mar 1, 2046', 'Where: Kitchen sink', 'Please let me know when this can be fixed.',
  ].join('\n'));
  expect(await mine().notes(job.id)).toEqual([]); // looking at it keeps nothing

  const asked = await mine().ask(job.id, { since: '2046-03-01', place: 'Kitchen sink' });
  expect(asked.note.body).toBe(preview.text);
  expect(asked.job).toMatchObject({ asked_on: '2046-03-05', asked_days: 0 });
  day = '2046-03-17';
  expect((await upkeep(db, owner, clock).get(job.id)).asked_days).toBe(12);
  expect(await mine().notes(job.id)).toEqual([{ id: asked.note.id, day: '2046-03-05', body: preview.text }]);

  const fixed = await mine().fixed(job.id);
  expect(fixed).toMatchObject({ asked_on: '2046-03-05', fixed_on: '2046-03-17', asked_days: null });
  expect((await db.get<{ n: number }>('SELECT COUNT(*) AS n FROM upkeep_done WHERE job_id = ?', [job.id]))!.n).toBe(1);
  // Asking again later starts over, and keeps the first note too.
  day = '2046-05-01';
  expect((await mine().ask(job.id, { what: 'Dripping again' })).job).toMatchObject({ asked_on: '2046-05-01', fixed_on: null });
  expect((await mine().notes(job.id)).map((n) => n.day)).toEqual(['2046-05-01', '2046-03-05']);
});

it('only a landlord\'s job can be asked about, and only its owner can ask', async () => {
  const plain = await upkeep(db, owner, clock).create({ name: 'Change the filter' });
  await expect(mine().ask(plain.id)).rejects.toEqual(problem(400));
  await expect(mine().fixed(plain.id)).rejects.toEqual(problem(400));
  const theirs = await upkeep(db, other, clock).create({ name: 'Broken lock', landlord: true });
  await expect(mine().ask(theirs.id)).rejects.toEqual(problem(404));
  await expect(mine().notes(theirs.id)).rejects.toEqual(problem(404));
  expect((await upkeep(db, owner, clock).update(plain.id, { name: 'Change the filter', landlord: true })).landlord).toBe(true);
  expect((await upkeep(db, owner, clock).update(plain.id, { name: 'Change the filter' })).landlord).toBe(true); // left out: unchanged
  expect((await upkeep(db, owner, clock).update(plain.id, { name: 'Change the filter', landlord: false })).landlord).toBe(false);
});

it('the lease keeps its days, rent day, deposit in cents and landlord, refuses nonsense, and is one person\'s', async () => {
  expect(await mine().lease()).toMatchObject({ start_day: null, end_day: null, end_days: null });
  const lease = await mine().setLease({ start_day: '2045-09-01', end_day: '2046-08-31', rent_day: 1, deposit_cents: 150000, landlord_name: 'Loretta', landlord_contact: '555-0100', notice_day: '2046-06-30', notice_label: 'Say if we stay' });
  expect(lease).toMatchObject({ rent_day: 1, deposit_cents: 150000, landlord_contact: '555-0100', end_days: 179, notice_days: 117 });
  await expect(mine().setLease({ start_day: '2046-09-01', end_day: '2046-08-31' })).rejects.toEqual(problem(400));
  await expect(mine().setLease({ rent_day: 32 })).rejects.toEqual(problem(400));
  await expect(mine().setLease({ deposit_cents: 12.5 })).rejects.toEqual(problem(400));
  await expect(mine().setLease({ end_day: 'someday' })).rejects.toEqual(problem(400));
  expect((await mine().lease()).deposit_cents).toBe(150000);
  expect(await renters(db, other, clock).lease()).toMatchObject({ landlord_name: null });
  await mine().clearLease();
  expect((await mine().lease()).landlord_name).toBeNull();
});

it('the morning reminder says when the lease is ending and when a notice is due, on the set days and no others', async () => {
  await mine().setLease({ end_day: '2046-04-10', notice_day: '2046-03-12', notice_label: 'Say if we stay' });
  const say = async () => (await reminders(db, owner, clock, {} as never).digest()).lines.filter((l) => l.link === '/things/renting').map((l) => [l.title, l.detail, l.urgent]);
  day = '2046-03-05';
  expect(await say()).toEqual([['Notice due: Say if we stay', 'in 7 days, Mar 12, 2046', false]]);
  day = '2046-03-06';
  expect(await say()).toEqual([]);
  day = '2046-03-05'; // 30 days before the end
  await mine().setLease({ end_day: '2046-04-04' });
  expect(await say()).toEqual([['Your lease ends', 'in 30 days, Apr 4, 2046', false]]);
  day = '2046-04-03';
  expect(await say()).toEqual([['Your lease ends', 'tomorrow, Apr 4, 2046', true]]);
  day = '2046-04-04';
  expect(await say()).toEqual([['Your lease ends', 'today, Apr 4, 2046', true]]);
  day = '2046-04-05';
  expect(await say()).toEqual([]);
});

it('a room keeps a move-in and a move-out note and dated photos for each, with the same limits as other kept photos', async () => {
  const rooms = await mine().addRoom('Kitchen');
  const id = rooms[0]!.id;
  await mine().updateRoom(id, { in_note: 'Scratch on the counter by the sink' });
  await mine().addPhoto(id, 'in', PNG);
  day = '2047-02-20';
  await mine().updateRoom(id, { out_note: 'Same scratch, nothing new' });
  const after = await mine().addPhoto(id, 'out', JPG);
  expect(after[0]).toMatchObject({ name: 'Kitchen', in_note: 'Scratch on the counter by the sink', out_note: 'Same scratch, nothing new' });
  expect(after[0]!.photos.map((p) => [p.phase, p.day, p.type])).toEqual([['in', '2046-03-05', 'image/png'], ['out', '2047-02-20', 'image/jpeg']]);
  expect((await mine().photo(after[0]!.photos[1]!.id)).bytes).toEqual(JPG);

  await expect(mine().addPhoto(id, 'in', Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]))).rejects.toEqual(problem(400)); // not a photo
  await expect(mine().addPhoto(id, 'in', new Uint8Array(8_000_001).fill(0xff, 0, 3))).rejects.toEqual(problem(400)); // too large
  await expect(mine().addPhoto(id, 'during', PNG)).rejects.toEqual(problem(400));
  for (let n = 0; n < 11; n += 1) await mine().addPhoto(id, 'in', PNG);
  await expect(mine().addPhoto(id, 'in', PNG)).rejects.toEqual(problem(400)); // 12 at most for each visit

  // Nobody else can see, change or remove it.
  await expect(renters(db, other, clock).photo(after[0]!.photos[0]!.id)).rejects.toEqual(problem(404));
  await expect(renters(db, other, clock).updateRoom(id, { name: 'Mine now' })).rejects.toEqual(problem(404));
  await expect(renters(db, other, clock).removeRoom(id)).rejects.toEqual(problem(404));
  expect(await renters(db, other, clock).rooms()).toEqual([]);

  expect((await mine().removePhoto(after[0]!.photos[0]!.id))[0]!.photos.filter((p) => p.phase === 'in')).toHaveLength(11);
  expect(await mine().removeRoom(id)).toEqual([]);
  expect((await db.get<{ n: number }>('SELECT COUNT(*) AS n FROM rental_photos'))!.n).toBe(0);
  await expect(mine().addRoom('  ')).rejects.toEqual(problem(400));
});

it('everything goes out in the download and comes back, an older download still comes in, and a second time adds nothing', async () => {
  const job = await upkeep(db, owner, clock).create({ name: 'Leaking kitchen tap', landlord: true, note: 'Drips' });
  await mine().ask(job.id, { since: '2046-03-01' });
  await mine().fixed(job.id, '2046-03-09');
  await mine().setLease({ start_day: '2045-09-01', end_day: '2046-08-31', rent_day: 3, deposit_cents: 150050, landlord_name: 'Loretta', landlord_contact: 'loretta@example.com', notice_day: '2046-06-30', notice_label: 'Say if we stay' });
  const room = (await mine().addRoom('Kitchen'))[0]!.id;
  await mine().updateRoom(room, { in_note: 'Chip in the sink', out_note: 'Same chip' });
  await mine().addPhoto(room, 'in', PNG, '2045-09-01');
  await mine().addPhoto(room, 'out', JPG, '2046-08-30');

  const zip = await splitDownload((await exportEverything(db, owner, clock)).bytes);
  expect(zip.files['lease.csv']).toContain('1500.50');
  expect([...zip.pictures.keys()].filter((p) => p.startsWith('pictures/renting/'))).toHaveLength(2);
  const bring = async (who: number, files = zip.files) => {
    const done = await bringInDownload(db, who, files, KINDS.filter((k) => k.importable).map((k) => k.key), clock);
    const sent: PictureIn[] = done.pending.filter((p) => zip.pictures.has(p.file)).map((p) => ({ as: p.as, id: p.id, kind: p.kind, name: p.name, spot: p.spot, bytes: zip.pictures.get(p.file)! }));
    return { ...done, kept: await bringInPictures(db, who, sent, clock) };
  };
  const first = await bring(other);
  for (const kind of first.kinds) expect(kind.ok, `${kind.key}: ${kind.problem}`).toBe(true);
  expect(first.kinds.find((k) => k.key === 'renting')).toMatchObject({ found: 2, fresh: 2, already: 0, pictures: 2 });
  expect(first.kept).toEqual({ kept: 2, left: 0 });
  const theirs = renters(db, other, clock);
  expect(await theirs.lease()).toMatchObject({ rent_day: 3, deposit_cents: 150050, landlord_name: 'Loretta', notice_label: 'Say if we stay' });
  const rooms = await theirs.rooms();
  expect(rooms).toHaveLength(1);
  expect(rooms[0]).toMatchObject({ name: 'Kitchen', in_note: 'Chip in the sink', out_note: 'Same chip' });
  expect(rooms[0]!.photos.map((p) => [p.phase, p.day])).toEqual([['in', '2045-09-01'], ['out', '2046-08-30']]);
  const theirJob = (await upkeep(db, other, clock).list()).find((j) => j.name === 'Leaking kitchen tap')!;
  expect(theirJob).toMatchObject({ landlord: true, asked_on: '2046-03-05', fixed_on: '2046-03-09' });
  expect((await theirs.notes(theirJob.id)).map((n) => n.day)).toEqual(['2046-03-05']);

  const second = await bring(other);
  expect(second.kinds.find((k) => k.key === 'renting')).toMatchObject({ ok: true, fresh: 0, already: 2 });
  expect(second.kept).toEqual({ kept: 0, left: 0 });
  expect(await theirs.rooms()).toHaveLength(1);
  expect((await theirs.notes(theirJob.id))).toHaveLength(1);

  // A download made before renting existed has none of these files, and still comes in.
  const older = Object.fromEntries(Object.entries(zip.files).filter(([name]) => !/^(lease|landlord-notes|rental-rooms|rental-photos)\.csv$/.test(name)));
  const third = renters(db, await person('third'), clock);
  const old = await bringInDownload(db, (await db.get<{ id: number }>("SELECT id FROM users WHERE username = 'third'"))!.id, older, ['upkeep', 'renting'], clock);
  expect(old.kinds.every((k) => k.ok)).toBe(true);
  expect(await third.rooms()).toEqual([]);
  expect((await third.lease()).start_day).toBeNull();
});
