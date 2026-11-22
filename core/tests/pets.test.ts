/** Pets, and the care that belongs to each. */
import { beforeEach, expect, it } from 'vitest';
import type { Db } from '../src/db.ts';
import { LATEST, migrate } from '../src/migrations.ts';
import { pets, type Pets } from '../src/pets.ts';
import { reminders } from '../src/reminders.ts';
import { search } from '../src/search.ts';
import { upkeep } from '../src/upkeep.ts';
import { memoryDb } from './memoryDb.ts';

let db: Db;
let owner: number;
let mine: Pets;
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
  mine = pets(db, owner, clock);
});

it('a pet is kept with who looks after them, and is only their person\'s', async () => {
  const rex = await mine.create({ name: ' Rex ', species: 'Dog', breed: 'Border collie', born_on: '2041-06-01', microchip: '985112000000001', vet_name: 'Oak Lane Vets', vet_phone: '555 0100', food: 'Two cups, morning and evening' });
  expect([rex.name, rex.species, rex.vet_phone, rex.photo, rex.care, rex.next]).toEqual(['Rex', 'dog', '555 0100', false, [], null]);
  expect((await mine.update(rex.id, { name: 'Rex', species: 'dog', breed: 'Border collie', note: 'Scared of fireworks' })).note).toBe('Scared of fireworks');
  await expect(mine.create({ name: '' })).rejects.toEqual(problem(400));
  await expect(mine.create({ name: 'Kit', born_on: '2047-01-01' })).rejects.toEqual(problem(400));

  const other = pets(db, await person('other'), clock);
  expect(await other.list()).toEqual([]);
  await expect(other.get(rex.id)).rejects.toEqual(problem(404));
  await other.remove(rex.id); // does nothing
  expect((await mine.list()).map((p) => p.name)).toEqual(['Rex']);
  expect((await search(db, owner, 'collie')).map((r) => [r.kind, r.title, r.link])).toEqual([['pet', 'Rex', `/things/pets/${rex.id}`]]);
});

it('care suits the kind of pet, becomes upkeep that is theirs, and says which is most pressing', async () => {
  const rex = await mine.create({ name: 'Rex', species: 'dog' });
  const tom = await mine.create({ name: 'Tom', species: 'cat' });
  expect((await mine.careOffered(rex.id)).map((c) => c.name)).toContain('Heartworm prevention');
  expect((await mine.careOffered(tom.id)).map((c) => c.name)).not.toContain('Heartworm prevention');
  expect((await mine.careOffered(tom.id)).map((c) => c.name)).toContain('Clean the litter box');

  await mine.addCare(rex.id, { name: 'Vaccinations', every_n: 1, every_unit: 'year', last_done: '2045-04-01' });
  const withCare = await mine.addCare(rex.id, { name: 'Flea and tick treatment', every_n: 1, every_unit: 'month', last_done: '2046-01-20' });
  expect(withCare.care.map((j) => [j.name, j.due.state, j.pet?.name])).toEqual([['Rex: Flea and tick treatment', 'overdue', 'Rex'], ['Rex: Vaccinations', 'later', 'Rex']]);
  expect([withCare.care_due, withCare.next]).toEqual([1, { id: withCare.care[0]!.id, name: 'Flea and tick treatment', state: 'overdue', days_left: -13 }]);
  expect((await mine.careOffered(rex.id)).map((c) => c.name)).not.toContain('Vaccinations'); // not offered twice
  expect((await mine.list()).map((p) => [p.name, p.care_due])).toEqual([['Rex', 1], ['Tom', 0]]);

  // It is upkeep like any other: in the morning reminder, and done from there.
  expect((await reminders(db, owner, clock).digest()).lines.map((l) => [l.title, l.detail])).toEqual([['Rex: Flea and tick treatment', 'late by 13 days']]);
  await upkeep(db, owner, clock).done(withCare.care[0]!.id, { cost_cents: 2500 });
  expect((await mine.get(rex.id)).care_due).toBe(0);

  // Removing the pet takes their care with them.
  await mine.remove(rex.id);
  expect(await upkeep(db, owner, clock).list()).toEqual([]);
});

it('weights are kept by the day, newest first, and a photo only when it is one', async () => {
  const rex = await mine.create({ name: 'Rex' });
  await mine.addWeight(rex.id, { value: 41.5, unit: 'lb', day: '2046-01-10' });
  const now = await mine.addWeight(rex.id, { value: 43, unit: 'lb' });
  expect(now.weights.map((w) => [w.day, w.value, w.unit])).toEqual([['2046-03-05', 43, 'lb'], ['2046-01-10', 41.5, 'lb']]);
  await expect(mine.addWeight(rex.id, { value: 0, unit: 'lb' })).rejects.toEqual(problem(400));
  await expect(mine.addWeight(rex.id, { value: 3, unit: 'stone' })).rejects.toEqual(problem(400));
  await mine.removeWeight(now.weights[0]!.id);
  expect((await mine.get(rex.id)).weights).toHaveLength(1);

  expect((await mine.setPhoto(rex.id, new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1]))).photo).toBe(true);
  expect((await mine.photo(rex.id))!.type).toBe('image/jpeg');
  await expect(mine.setPhoto(rex.id, new Uint8Array([1, 2, 3]))).rejects.toEqual(problem(400));
  expect(await pets(db, await person('other'), clock).photo(rex.id)).toBeNull();
  expect((await mine.removePhoto(rex.id)).photo).toBe(false);
});
