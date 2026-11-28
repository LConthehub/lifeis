/** Where is it, by voice: putting a thing somewhere, and asking where it is. */
import { beforeEach, expect, it } from 'vitest';
import type { Db } from '../src/db.ts';
import { inventory, type Inventory } from '../src/inventory.ts';
import { LATEST, migrate } from '../src/migrations.ts';
import { KEY_ACTIONS, readPut, voice } from '../src/voice.ts';
import { sinceDay } from '../src/whereabouts.ts';
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
// ---------- where is it, by voice ----------

let things: Inventory;
let kind: number;
async function place(name: string, parent: number | null = null): Promise<number> {
  const all = await things.createPlace({ name, parent_id: parent });
  return all.filter((p) => p.name === name && p.parent_id === parent).at(-1)!.id;
}
const where = async (name: string) => (await things.listItems({ q: name }))[0]!.place;

async function house() {
  things = inventory(db, ana, clock);
  kind = (await things.createKind({ name: 'Kitchen things' }))[0]!.id;
}

it('a key may be allowed to put a thing and to say where it is', () => {
  expect(KEY_ACTIONS.map((a) => a.id)).toEqual(expect.arrayContaining(['thing_put', 'thing_where']));
});

it('moves a thing when told, in one plain sentence, and remembers the move', async () => {
  await house();
  const hall = await place('Hall closet');
  const kitchenCupboard = await place('Kitchen cupboard');
  await things.createItem({ kind_id: kind, name: 'Egg cooker', place_id: kitchenCupboard });
  const say = voice(db, ana, clock);
  expect(await say.putThing('the egg cooker', 'the hall closet')).toBe('The egg cooker is in the hall closet now.');
  expect(await where('Egg cooker')).toBe('Hall closet');
  expect(await say.putThing('egg cooker', 'hall closet')).toBe('The egg cooker is already in the hall closet.');
  expect(hall).toBeGreaterThan(0);
  const history = await things.itemHistory((await things.listItems({ q: 'Egg' }))[0]!.id);
  expect(history.find((h) => h.what === 'moved')).toMatchObject({ from_place: 'Kitchen cupboard', to_place: 'Hall closet' });
});

it('changes nothing and asks, naming the closest, when the thing or the place is not clear', async () => {
  await house();
  const hall = await place('Hall closet');
  const garage = await place('Garage');
  await place('Garage shelf', garage);
  await things.createItem({ kind_id: kind, name: 'Large pan', place_id: hall });
  await things.createItem({ kind_id: kind, name: 'Small pan', place_id: hall });
  await things.createItem({ kind_id: kind, name: 'Egg timer', place_id: hall });
  const say = voice(db, ana, clock);
  // More than one pan.
  expect(await say.putThing('the pan', 'the garage')).toBe('Which one do you mean: the large pan, or the small pan? Nothing was moved.');
  // Not known, with a close one.
  expect(await say.putThing('the egg cooker', 'the garage')).toBe('I don\'t know a thing called "the egg cooker". Did you mean the egg timer? Nothing was moved.');
  // Not known at all.
  expect(await say.putThing('the piano', 'the garage')).toBe('I don\'t know a thing called "the piano". Nothing was moved.');
  // The place: not known, then two that fit.
  expect(await say.putThing('egg timer', 'the attic')).toBe('I don\'t know a place called "the attic". Nothing was moved.');
  expect(await say.putThing('egg timer', 'the shed shelf')).toBe('I don\'t know a place called "the shed shelf". Did you mean the garage shelf? Nothing was moved.');
  expect(await say.putThing('egg timer', 'the garage s')).toMatch(/Nothing was moved\.$/);
  for (const name of ['Large pan', 'Small pan', 'Egg timer']) expect(await where(name)).toBe('Hall closet');
});

it('says where a thing is and since when, or that it does not know', async () => {
  await house();
  const hall = await place('Hall closet');
  const attic = await place('Attic');
  const cooker = await things.createItem({ kind_id: kind, name: 'Egg cooker', place_id: attic });
  const say = voice(db, ana, clock);
  // 2046-03-06 is a Tuesday. Moved today:
  await things.moveItem(cooker.id, hall);
  expect(await say.whereIs("the egg cooker")).toBe('The egg cooker is in the hall closet, since today.');
  time = new Date(2046, 2, 9, 10, 0, 0);
  const later = Object.assign(() => time, { today: () => '2046-03-09' });
  expect(await voice(db, ana, later).whereIs('egg cooker')).toBe('The egg cooker is in the hall closet, since Tuesday.');
  expect(await say.whereIs('the spatula')).toBe('I don\'t know a thing called "the spatula".');
  expect(await say.whereIs('the egg cookers')).toBe('The egg cooker is in the hall closet, since today.');
  await things.createItem({ kind_id: kind, name: 'Whisk' });
  expect(await say.whereIs('whisk')).toBe('The whisk has no place yet.');
  expect(sinceDay('2046-03-05', '2046-03-06')).toBe('yesterday');
  expect(sinceDay('2046-02-20', '2046-03-06')).toBe('February 20');
});

it("never reaches another person's things, a gun, or a thing that is gone", async () => {
  await house();
  const hall = await place('Hall closet');
  await things.createItem({ kind_id: kind, name: 'Egg cooker', place_id: hall });
  await things.addStarter('hunting');
  const kinds = await things.listKinds();
  await things.createItem({ kind_id: kinds.find((k) => k.name === 'Firearms')!.id, name: 'Quillrifle' });
  const gone = await things.createItem({ kind_id: kind, name: 'Old toaster', place_id: hall });
  await things.letGo(gone.id, { how: 'given' });
  const say = voice(db, ana, clock);
  expect(await say.whereIs('quillrifle')).not.toContain('Quillrifle is in');
  expect(await say.whereIs('quillrifle')).toBe('I don\'t know a thing called "quillrifle".');
  expect(await say.putThing('quillrifle', 'hall closet')).toBe('I don\'t know a thing called "quillrifle". Nothing was moved.');
  expect(await say.whereIs('old toaster')).toBe('I don\'t know a thing called "old toaster".');
  // Bob has none of it.
  expect(await voice(db, bob, clock).whereIs('egg cooker')).toBe('I don\'t know a thing called "egg cooker".');
  expect(await voice(db, bob, clock).putThing('egg cooker', 'hall closet')).toBe('I don\'t know a thing called "egg cooker". Nothing was moved.');
});

it('reads "I put X in Y" whole, and asks to be told again when it cannot', () => {
  expect(readPut('I put the egg cooker in the hall closet')).toEqual({ thing: 'the egg cooker', place: 'the hall closet' });
  expect(readPut("I've put the keys on the hook.")).toEqual({ thing: 'the keys', place: 'the hook' });
  expect(readPut('the egg cooker in the hall closet')).toEqual({ thing: 'the egg cooker', place: 'the hall closet' });
  expect(() => readPut('the egg cooker')).toThrow(/Say what you put and where/);
  expect(() => readPut('in the hall closet')).toThrow(/Say what you put/);
});
