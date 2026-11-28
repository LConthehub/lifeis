/** Medicines: a private list for a person, a child or a pet, kept as steps in a routine, counted down as doses are taken, and never named in a reminder unless asked. */
import { beforeEach, expect, it } from 'vitest';
import type { Answer, Fetcher } from '../src/connections.ts';
import type { Db } from '../src/db.ts';
import { bringInDownload, bringInPictures, exportEverything, splitDownload } from '../src/exportAll.ts';
import { medicines } from '../src/medicines.ts';
import { LATEST, migrate } from '../src/migrations.ts';
import { pets } from '../src/pets.ts';
import { reminders } from '../src/reminders.ts';
import { routines, routinesDue } from '../src/routines.ts';
import { search } from '../src/search.ts';
import { upkeep } from '../src/upkeep.ts';
import { memoryDb } from './memoryDb.ts';

let db: Db;
let owner: number;
let partner: number;
let third: number;
// 2046-03-05 is a Monday.
let day = '2046-03-05';
const clock = Object.assign(() => new Date(2046, 2, 5, 10, 0, 0), { today: () => day });
const problem = (status: number) => expect.objectContaining({ name: 'Problem', status });
const PNG = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));

let posted: { url: string; body: string }[];
const fetcher: Fetcher = async (url, _headers, send) => {
  posted.push({ url, body: send?.body ?? '' });
  return { status: 200, type: 'text/plain', json: async () => ({}), bytes: async () => new Uint8Array() } as Answer;
};

async function person(name: string): Promise<number> {
  return (await db.run("INSERT INTO users (username, password_hash, created_at) VALUES (?, 'x', 'now')", [name])).lastId;
}
const meds = (who = owner) => medicines(db, who, clock);
const routs = (who = owner) => routines(db, who, clock);

beforeEach(async () => {
  db = memoryDb();
  expect(await migrate(db)).toBe(LATEST);
  owner = await person('owner');
  partner = await person('partner');
  third = await person('third');
  day = '2046-03-05';
  posted = [];
});

it('keeps a medicine in the words typed, in a routine step, and counts the number left down as doses are taken', async () => {
  const m = await meds().create({ name: 'Lisinopril', dose: '10 mg, one tablet', when_taken: 'with breakfast', left: 30, prescriber_name: 'Dr. Ames', prescriber_phone: '555-0100',
    pharmacy_name: 'Main Street Pharmacy', pharmacy_phone: '555-0101', reason: 'blood pressure', note: 'Not with grapefruit', make: ['Morning'] });
  expect([m.name, m.dose, m.left, m.per_day, m.mine, m.for_name, m.reason]).toEqual(['Lisinopril', '10 mg, one tablet', 30, 1, true, 'You', 'blood pressure']);
  expect(m.times.map((t) => t.title)).toEqual(['Medicines: Morning']);
  const today = await routs().today();
  expect(today).toHaveLength(1);
  expect(today[0]!.title).toBe('Medicines: Morning');
  const step = today[0]!.steps[0]!;
  expect([step.words, step.medicine_id]).toEqual(['Lisinopril, 10 mg, one tablet', m.id]);
  // Checking it is taking the dose: one fewer left, once, however often it is checked.
  await routs().tick(step.id, true);
  await routs().tick(step.id, true);
  expect((await meds().get(m.id)).left).toBe(29);
  expect((await meds().get(m.id)).taken_today).toBe(1);
  expect((await meds().get(m.id)).doses.map((d) => [d.day, d.by])).toEqual([['2046-03-05', 'you']]);
  // Taking it back counts it back up.
  await routs().tick(step.id, false);
  await routs().tick(step.id, false);
  expect((await meds().get(m.id)).left).toBe(30);
  // So does finishing and starting over a whole time.
  await routs().finish(today[0]!.id, true);
  expect((await meds().get(m.id)).left).toBe(29);
  await routs().finish(today[0]!.id, false);
  expect((await meds().get(m.id)).left).toBe(30);
  // It never goes below none, and a medicine not being counted is left alone.
  await meds().update(m.id, { name: 'Lisinopril', left: 0, make: [] });
  await routs().tick(step.id, true);
  expect((await meds().get(m.id)).left).toBe(0);
  await meds().update(m.id, { name: 'Lisinopril', left: null });
  await routs().tick(step.id, false);
  await routs().tick(step.id, true);
  expect((await meds().get(m.id)).left).toBeNull();
});

it('uses what a dose uses, and a refill adds what the person said it holds', async () => {
  const m = await meds().create({ name: 'Eye drops', left: 10, per_dose: 2, fill_size: 20, make: ['Morning', 'Evening'] });
  expect(m.per_day).toBe(2);
  const [morning] = await routs().today();
  await routs().tick(morning!.steps[0]!.id, true);
  expect((await meds().get(m.id)).left).toBe(8);
  expect((await meds().refilled(m.id)).left).toBe(28);
  expect((await meds().refilled(m.id, 5)).left).toBe(33);
  const none = await meds().create({ name: 'Cream' });
  await expect(meds().refilled(none.id)).rejects.toThrow(/how many the refill holds/);
});

it('checks what was typed and keeps only a keeper\'s own people and routines', async () => {
  await expect(meds().create({ name: '  ' })).rejects.toMatchObject(problem(400));
  await expect(meds().create({ name: 'A', left: -1 })).rejects.toMatchObject(problem(400));
  await expect(meds().create({ name: 'A', per_dose: 0 })).rejects.toMatchObject(problem(400));
  await expect(meds().create({ name: 'A', prescriber_phone: 'call me maybe' })).rejects.toMatchObject(problem(400));
  const theirPet = await pets(db, partner, clock).create({ name: 'Mittens', species: 'cat' });
  await expect(meds().create({ name: 'A', for_pet: theirPet.id })).rejects.toMatchObject(problem(404));
  // A routine of someone else is not a place to put a medicine.
  const theirs = await routs(partner).create({ name: 'Mine', for_user: partner, times: [{ name: 'Morning', steps: [{ words: 'Wake up' }] }] });
  await expect(meds().create({ name: 'A', times: [theirs.times[0]!.id] })).rejects.toMatchObject(problem(404));
  expect(await meds().list().then((l) => l.mine)).toEqual([]);
});

it('is private: not even the person in charge sees it, until it is shared with chosen people, who can look and not change', async () => {
  const m = await meds().create({ name: 'Sertraline', note: 'private note', make: ['Morning'] });
  await meds().setPhoto(m.id, PNG);
  for (const who of [partner, third]) {
    const list = await meds(who).list();
    expect([list.mine, list.shared]).toEqual([[], []]);
    await expect(meds(who).get(m.id)).rejects.toMatchObject(problem(404));
    await expect(meds(who).photo(m.id)).rejects.toMatchObject(problem(404));
    await expect(meds(who).update(m.id, { name: 'x' })).rejects.toMatchObject(problem(404));
    await expect(meds(who).remove(m.id)).rejects.toMatchObject(problem(404));
    await expect(meds(who).shareWith(m.id, [who])).rejects.toMatchObject(problem(404));
  }
  expect(await meds().shareWith(m.id, [partner, partner])).toEqual({ people: [partner] });
  await expect(meds().shareWith(m.id, [owner])).rejects.toMatchObject(problem(400));
  await expect(meds().shareWith(m.id, [9999])).rejects.toMatchObject(problem(400));
  const list = await meds(partner).list();
  expect(list.mine).toEqual([]);
  expect(list.shared.map((x) => [x.name, x.mine, x.keeper, x.for_name, x.people])).toEqual([['Sertraline', false, 'owner', 'owner', []]]);
  expect((await meds(partner).photo(m.id))?.type).toBe('image/png');
  await expect(meds(partner).update(m.id, { name: 'x' })).rejects.toMatchObject(problem(404));
  await expect(meds(partner).setPhoto(m.id, PNG)).rejects.toMatchObject(problem(404));
  await expect(meds(partner).refilled(m.id, 3)).rejects.toMatchObject(problem(404));
  // The third person still sees nothing, and sharing again with nobody takes it back.
  expect((await meds(third).list()).shared).toEqual([]);
  await meds().shareWith(m.id, []);
  expect((await meds(partner).list()).shared).toEqual([]);
});

it('keeps a pet\'s and a child\'s medicine for whoever keeps them, in their routines, and not in anyone else\'s view of the pet\'s routine', async () => {
  const dog = await pets(db, owner, clock).create({ name: 'George', species: 'dog' });
  const kid = await upkeep(db, owner, clock).addMember('Hank');
  const memberId = (await db.get<{ id: number }>('SELECT id FROM household_members WHERE owner_id = ? AND name = ?', [owner, 'Hank']))!.id;
  void kid;
  const pill = await meds().create({ name: 'Heart pill', for_pet: dog.id, left: 20, make: ['Morning'] });
  const syrup = await meds().create({ name: 'Cough syrup', for_member: memberId, make: ['Evening'] });
  expect([pill.for_kind, pill.for_name, syrup.for_kind, syrup.for_name]).toEqual(['pet', 'George', 'member', 'Hank']);
  const subjects = (await meds().list()).subjects;
  expect(subjects.map((s) => [s.kind, s.name])).toEqual([['me', 'You'], ['pet', 'George'], ['member', 'Hank']]);
  expect(subjects[1]!.times.map((t) => t.title)).toEqual(['Medicines: Morning']);
  // The pet's routine is everyone's, but its medicine is only its keeper's.
  expect((await routs().today(null, dog.id)).map((t) => t.steps.map((s) => s.words))).toEqual([['Heart pill']]);
  expect(await routs(partner).today(null, dog.id)).toEqual([]);
  expect((await routs(partner).list()).flatMap((r) => r.times.flatMap((t) => t.steps))).toEqual([]);
  // The child's shows on the chore chart, for the keeper.
  expect((await routs().forMembers()).map((t) => t.steps.map((s) => s.words))).toEqual([['Cough syrup']]);
  // Shared with the partner, the pet's medicine is in their view of the pet's routine, and can be checked there.
  await meds().shareWith(pill.id, [partner]);
  const theirs = await routs(partner).today(null, dog.id);
  expect(theirs.map((t) => t.steps.map((s) => s.words))).toEqual([['Heart pill']]);
  await routs(partner).tick(theirs[0]!.steps[0]!.id, true);
  expect((await meds().get(pill.id)).left).toBe(19);
  // Taking the pet away takes its medicines with it.
  await pets(db, owner, clock).remove(dog.id);
  expect((await meds().list()).mine.map((m) => m.name)).toEqual(['Cough syrup']);
  // A medicine can be moved to someone else only to a pet or a person that is the keeper's.
  const stranger = await pets(db, partner, clock).create({ name: 'Rex' });
  await expect(meds().update(syrup.id, { name: 'Cough syrup', for_pet: stranger.id })).rejects.toMatchObject(problem(404));
});

it('says only "Morning routine" in a reminder, and never the name, unless that person switched names on', async () => {
  const m = await meds().create({ name: 'Secretmed', left: 30, make: ['Morning'] });
  await db.run("UPDATE routine_times SET at_time = '08:00'");
  await meds().create({ name: 'Other', for_pet: (await pets(db, owner, clock).create({ name: 'Rex' })).id });
  const tools = { fetcher };
  await reminders(db, owner, clock, tools).save({ ntfy: { server: 'https://ntfy.example.org', topic: 'abcdef123456', detail: 'full' }, zone: 'UTC' });
  expect((await routs().coming('2046-03-05', '2046-03-05')).map((c) => [c.title, c.steps])).toEqual([['Morning routine', 1]]);
  const sent = await routinesDue(db, new Date(Date.UTC(2046, 2, 5, 8, 0)), tools);
  expect(sent).toEqual([{ user: owner, sent: ['ntfy'], problems: [] }]);
  expect(posted).toHaveLength(1);
  expect(posted[0]!.body).toContain('Morning routine');
  expect(posted[0]!.body).toContain('1 step');
  expect(posted[0]!.body).not.toMatch(/Secretmed|Medicines/);
  // One switch, the person's own.
  expect((await meds().list()).show_names).toBe(false);
  await meds().setShowNames(true);
  expect((await meds().list()).show_names).toBe(true);
  expect((await meds(partner).list()).show_names).toBe(false);
  expect((await routs().coming('2046-03-06', '2046-03-06')).map((c) => c.title)).toEqual(['Medicines: Morning']);
  await meds().setShowNames(false);
  void m;
});

it('reminds a week before the doses would run out, without the name unless asked', async () => {
  await meds().create({ name: 'Secretmed', left: 14, make: ['Morning', 'Evening'] }); // 2 a day: 7 days
  await meds().create({ name: 'Plenty', left: 400, make: ['Morning'] });
  const quiet = await reminders(db, owner, clock).digest();
  const lines = quiet.lines.filter((l) => l.link === '/medicines');
  expect(lines.map((l) => l.title)).toEqual(['A refill is coming up']);
  expect(JSON.stringify(quiet)).not.toMatch(/Secretmed|Plenty/);
  await meds().setShowNames(true);
  const loud = (await reminders(db, owner, clock).digest()).lines.filter((l) => l.link === '/medicines');
  expect(loud.map((l) => [l.title, l.detail])).toEqual([['Refill: Secretmed', 'about 7 days left']]);
  // Eight days left is not yet; taking doses brings it closer.
  await meds().update((await meds().list()).mine[0]!.id, { name: 'Secretmed', left: 16 });
  expect((await reminders(db, owner, clock).digest()).lines.filter((l) => l.link === '/medicines')).toEqual([]);
  // Nobody else is told about it, shared or not.
  const first = (await meds().list()).mine.find((m) => m.name === 'Secretmed')!;
  await meds().shareWith(first.id, [partner]);
  await meds().update(first.id, { name: 'Secretmed', left: 2 });
  expect((await reminders(db, partner, clock).digest()).lines.filter((l) => l.link === '/medicines')).toEqual([]);
  expect((await reminders(db, owner, clock).digest()).lines.filter((l) => l.link === '/medicines')).toHaveLength(1);
});

it('keeps medicines out of search, and a routine\'s own editor leaves the medicine\'s words alone', async () => {
  const m = await meds().create({ name: 'Zorbex', dose: '5 mg', make: ['Morning'] });
  expect(await search(db, owner, 'zorbex')).toEqual([]);
  expect((await db.all<{ words: string }>('SELECT words FROM routine_steps WHERE medicine_id = ?', [m.id])).map((r) => r.words)).toEqual(['Medicine']);
  // Saving the routine from its own page, with the step as it was shown, keeps the placeholder and the link.
  const r = (await routs().list()).find((x) => x.name === 'Medicines')!;
  const t = r.times[0]!;
  await routs().update(r.id, { name: 'Medicines', for_user: owner, times: [{ id: t.id, name: 'Morning', steps: [{ id: t.steps[0]!.id, words: 'Zorbex, 5 mg' }, { words: 'Water' }] }] });
  expect((await db.all<{ words: string; medicine_id: number | null }>('SELECT words, medicine_id FROM routine_steps WHERE time_id = ? ORDER BY sort_order', [t.id])).map((x) => [x.words, x.medicine_id]))
    .toEqual([['Medicine', m.id], ['Water', null]]);
  expect(await search(db, owner, 'zorbex')).toEqual([]);
  // Taking it out of a routine takes the medicine out of it and keeps the medicine.
  await routs().update(r.id, { name: 'Medicines', for_user: owner, times: [{ id: t.id, name: 'Morning', steps: [{ words: 'Water' }] }] });
  expect((await meds().get(m.id)).times).toEqual([]);
});

it('goes into the download and comes back, with who it is shared with by sign-in name, and its photo and doses, and never in the routines file', async () => {
  const dog = await pets(db, owner, clock).create({ name: 'George', species: 'dog' });
  const a = await meds().create({ name: 'Lisinopril', dose: '10 mg', when_taken: 'with food', left: 12, per_dose: 1, fill_size: 30, prescriber_name: 'Dr. Ames', prescriber_phone: '555-0100',
    pharmacy_name: 'Corner', pharmacy_phone: '555-0101', reason: 'pressure', note: 'a, "quoted" note', make: ['Morning', 'Evening'] });
  await meds().create({ name: 'Heart pill', for_pet: dog.id, left: 5, make: ['Morning'] });
  await meds().setPhoto(a.id, PNG);
  await meds().shareWith(a.id, [partner, third]);
  const [morning] = await routs().today();
  await routs().tick(morning!.steps.find((s) => s.medicine_id === a.id)!.id, true);
  await meds(partner).create({ name: 'Partner private' });
  await routs().create({ name: 'Skincare', for_user: owner, times: [{ name: 'Morning', steps: [{ words: 'Wash your face' }] }] });

  const made = await exportEverything(db, owner, clock);
  const zip = await splitDownload(made.bytes);
  expect(zip.files['medicines.csv']).toContain('Lisinopril');
  expect(zip.files['medicines.csv']).toContain('partner; third');
  expect(zip.files['medicines.csv']).not.toContain('Partner private');
  expect(zip.files['medicine-doses.csv']).toContain('2046-03-05');
  for (const file of ['routines.csv', 'routine-ticks.csv', 'routine-history.csv']) expect(zip.files[file]).not.toMatch(/Lisinopril|Heart pill|Medicine\b/);
  expect(zip.files['routines.csv']).toContain('Wash your face');
  expect([...zip.pictures.keys()].some((p) => /^pictures\/medicines\/Lisinopril-\d+\.png$/.test(p))).toBe(true);
  expect(zip.files['README.txt']).toContain('medicines.csv');
  // Someone else's download has none of it.
  const theirs = await splitDownload((await exportEverything(db, third, clock)).bytes);
  expect(theirs.files['medicines.csv']).not.toContain('Lisinopril');
  expect(theirs.files['medicine-doses.csv']).not.toContain('2046');

  // Back into a new account: one the first two sign-in names exist in, and one that does not.
  const fresh = await person('fresh');
  await db.run("DELETE FROM users WHERE username = 'third'");
  const dog2 = await pets(db, fresh, clock).create({ name: 'George', species: 'dog' });
  const files = { ...zip.files };
  const done = await bringInDownload(db, fresh, files, ['routines', 'medicines'], clock);
  const report = done.kinds.find((k) => k.key === 'medicines')!;
  expect([report.ok, report.found, report.fresh, report.already, report.unlinked]).toEqual([true, 2, 2, 0, 1]);
  expect(report.note).toMatch(/1 sign-in name/);
  const back = (await meds(fresh).list()).mine;
  expect(back.map((m) => [m.name, m.dose, m.left, m.fill_size, m.prescriber_phone, m.pharmacy_name, m.reason, m.note, m.for_name])).toEqual([
    ['Lisinopril', '10 mg', 11, 30, '555-0100', 'Corner', 'pressure', 'a, "quoted" note', 'You'], ['Heart pill', null, 5, null, null, null, null, null, 'George']]);
  expect(back[0]!.times.map((t) => t.title)).toEqual(['Medicines: Morning', 'Medicines: Evening']);
  expect(back[0]!.people).toEqual([partner]);
  expect(back[0]!.doses.map((d) => d.day)).toEqual(['2046-03-05']);
  expect(back[0]!.left).toBe(11);
  expect(back[1]!.times.map((t) => t.title)).toEqual(['Medicines: Morning']);
  void dog2;
  // The photo comes with the pictures, and a second time brings nothing new.
  const photos = done.pending.filter((p) => p.as === 'medicine-photo');
  expect(photos).toHaveLength(1);
  expect((await bringInPictures(db, fresh, [{ as: 'medicine-photo', id: photos[0]!.id, bytes: zip.pictures.get(photos[0]!.file)! }], clock)).kept).toBe(1);
  expect((await meds(fresh).photo(photos[0]!.id))?.type).toBe('image/png');
  expect((await bringInDownload(db, fresh, files, ['medicines'], clock)).kinds[0]!).toMatchObject({ found: 2, fresh: 0, already: 2 });
  // The partner sees both the original and the one that came back, each with its keeper.
  expect((await meds(partner).list()).shared.map((m) => [m.name, m.keeper])).toEqual([['Lisinopril', 'owner'], ['Lisinopril', 'fresh']]);
});

it('leaves a pet\'s medicine out when the pet is not there, rather than putting it on someone else', async () => {
  const dog = await pets(db, owner, clock).create({ name: 'George', species: 'dog' });
  await meds().create({ name: 'Heart pill', for_pet: dog.id });
  const zip = await splitDownload((await exportEverything(db, owner, clock)).bytes);
  const fresh = await person('fresh');
  const done = await bringInDownload(db, fresh, zip.files, ['medicines'], clock);
  const report = done.kinds[0]!;
  expect([report.found, report.fresh, report.skipped.length]).toEqual([0, 0, 1]);
  expect((await meds(fresh).list()).mine).toEqual([]);
});
