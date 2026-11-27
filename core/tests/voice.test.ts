/** What a voice shortcut says: how a spoken list is split, what comes back, and what is never reachable. */
import { beforeEach, expect, it } from 'vitest';
import { calendar } from '../src/calendar.ts';
import type { Db } from '../src/db.ts';
import { inventory } from '../src/inventory.ts';
import { kitchen, type Kitchen } from '../src/kitchen.ts';
import { migrate } from '../src/migrations.ts';
import { splitGroceries, spokenList, spokenTime, readWhen, voice } from '../src/voice.ts';
import { memoryDb } from './memoryDb.ts';

const TUESDAY = '2046-03-06';
const clock = Object.assign(() => new Date(2046, 2, 6, 10, 0, 0), { today: () => TUESDAY });

let db: Db;
let owner: number;
let k: Kitchen;
const person = async (name: string) => (await db.run("INSERT INTO users (username, password_hash, created_at) VALUES (?, 'x', 'now')", [name])).lastId;

beforeEach(async () => {
  db = memoryDb();
  await migrate(db);
  owner = await person('owner');
  k = kitchen(db, owner, clock);
});

it('splits what was said on commas and "and"', () => {
  expect(splitGroceries('milk, eggs and pie crust')).toEqual(['milk', 'eggs', 'pie crust']);
  expect(splitGroceries('Milk, eggs, and pie crust.')).toEqual(['Milk', 'eggs', 'pie crust']);
  expect(splitGroceries('2 lb chicken thighs & some rice')).toEqual(['2 lb chicken thighs', 'rice']);
  expect(splitGroceries('  ')).toEqual([]);
  expect(splitGroceries('bread\nbutter; jam')).toEqual(['bread', 'butter', 'jam']);
});

it('reads a list for speaking, and a time of day', () => {
  expect(spokenList(['Milk'])).toBe('Milk.');
  expect(spokenList(['Milk', 'Eggs'])).toBe('Milk and Eggs.');
  expect(spokenList(['Milk', 'Eggs', 'Pie crust'])).toBe('Milk, Eggs, and Pie crust.');
  expect(spokenList(['Milk', 'Eggs', 'Pie crust', 'a', 'b'])).toBe('Milk, Eggs, Pie crust, and 2 more.');
  expect([spokenTime('09:00'), spokenTime('15:30'), spokenTime('00:05'), spokenTime('12:00')]).toEqual(['9 AM', '3:30 PM', '12:05 AM', '12 PM']);
});

it('adds groceries and says how many, matching what is already on the list by name', async () => {
  for (const name of ['butter', 'flour', 'sugar', 'salt', 'rice', 'oil', 'beans', 'corn', 'peas', 'jam', 'tea', 'ham']) await k.addGrocery({ label: name });
  const say = voice(db, owner, clock);
  expect(await say.addGroceries('milk, eggs and pie crust')).toBe("Added 3. That's 15 on the list.");
  expect((await k.listGrocery()).map((g) => g.label).sort()).toContain('pie crust');
  // The same again: nothing is added twice, and it says so.
  expect(await say.addGroceries('Milk and bananas')).toBe("Added 1. One was already there. That's 16 on the list.");
  expect(await say.addGroceries('milk')).toBe("That was already on the list. That's 16 things on the list.");
  expect(await say.addGroceries('   ')).toBe("Nothing to add was heard.");
});

it('says what is left to buy, shortened, and for one store', async () => {
  const say = voice(db, owner, clock);
  expect(await say.whatToBuy()).toBe('Nothing on the list.');
  await say.addGroceries('milk, eggs, pie crust, a, b, c');
  const first = await say.whatToBuy();
  expect(first).toMatch(/^6 things\. [A-Za-z ]+, [A-Za-z ]+, [A-Za-z ]+, and 3 more\.$/);
  // One ticked off is not left to buy.
  const milk = (await k.listGrocery()).find((g) => g.label === 'milk')!;
  await k.tickGrocery(milk.id, { done: true, put_away: false });
  expect(await say.whatToBuy()).toMatch(/^5 things\./);
  expect(await say.whatToBuy('Costco')).toBe('Nothing to buy at Costco.');
  const eggs = (await k.listGrocery()).find((g) => g.label === 'eggs')!;
  await db.run('UPDATE grocery SET store = ? WHERE id = ?', ['Costco', eggs.id]);
  expect(await say.whatToBuy('costco')).toBe('1 thing at costco. Eggs.');
});

it('says what is for dinner, and what is still needed for it', async () => {
  const say = voice(db, owner, clock);
  expect(await say.dinner()).toBe('Nothing planned for dinner.');
  await k.addPlan({ day: TUESDAY, meal: 'lunch', title: 'Soup' });
  expect(await say.dinner()).toBe('Nothing planned for dinner.');
  const chili = await k.createRecipe({ title: 'Turkey chili', servings: 4, ingredients_text: '1 lb ground turkey\n1 cup sour cream\n2 onions', steps_text: 'Cook it.' });
  await k.addPlan({ day: TUESDAY, meal: 'dinner', recipe_id: chili.id });
  await k.savePantry({ name: 'ground turkey', quantity: 2, unit: 'lb' });
  await k.savePantry({ name: 'onions', quantity: 5 });
  expect(await say.dinner()).toBe('Turkey chili. You still need sour cream.');
  await k.savePantry({ name: 'sour cream', quantity: 1, unit: 'cup' });
  expect(await say.dinner()).toBe('Turkey chili.');
  expect(await say.week()).toBe('Dinners this week: today, Turkey chili.');
});

it('says what is on today: events with their times, and chores due; never a gun or its chores', async () => {
  const say = voice(db, owner, clock);
  expect(await say.today()).toBe('Nothing on today.');
  await calendar(db, owner, clock).createEvent({ title: 'Dentist', day: TUESDAY, time: '15:30' });
  await calendar(db, owner, clock).createEvent({ title: 'Trash day', day: TUESDAY });
  await calendar(db, owner, clock).createEvent({ title: 'Tomorrow thing', day: '2046-03-07' });
  expect(await say.today()).toBe('On today: Dentist at 3:30 PM and Trash day.');
  // A chore due today, and a chore on a gun, which a voice never says.
  const things = inventory(db, owner, clock);
  const kind = (await things.createKind({ name: 'Firearms' })).find((x) => x.name === 'Firearms')!.id;
  const gun = await things.createItem({ kind_id: kind, name: 'Deer rifle' });
  const upkeep = await import('../src/upkeep.ts');
  await upkeep.upkeep(db, owner, clock).create({ name: 'Clean the rifle', item_id: gun.id, every_n: 1, every_unit: 'day', first_due: TUESDAY });
  await upkeep.upkeep(db, owner, clock).create({ name: 'Clean the gutters', every_n: 1, every_unit: 'day', first_due: TUESDAY });
  const said = await say.today();
  expect(said).toContain('Due today: Clean the gutters.');
  expect(said).not.toMatch(/rifle/i);
  // With the week's meals allowed, dinner is part of it.
  await k.addPlan({ day: TUESDAY, meal: 'dinner', title: 'Pasta' });
  expect(await say.today(true)).toContain('Dinner is Pasta.');
  expect(await say.today(false)).not.toContain('Pasta');
});

it('reads when a reminder is for', () => {
  expect(readWhen(null, TUESDAY)).toEqual({ day: TUESDAY, time: null });
  expect(readWhen('tomorrow at 3pm', TUESDAY)).toEqual({ day: '2046-03-07', time: '15:00' });
  expect(readWhen('Friday 9:30 am', TUESDAY)).toEqual({ day: '2046-03-09', time: '09:30' });
  expect(readWhen('next tuesday', TUESDAY)).toEqual({ day: '2046-03-13', time: null });
  expect(readWhen('in 3 days at noon', TUESDAY)).toEqual({ day: '2046-03-09', time: '12:00' });
  expect(readWhen('2046-04-01 18:45', TUESDAY)).toEqual({ day: '2046-04-01', time: '18:45' });
  expect(readWhen('12 am', TUESDAY).time).toBe('00:00');
  expect(() => readWhen('whenever the cows come home', TUESDAY)).toThrow(/time wasn't clear/);
});

it('adds a reminder as a dated line on the calendar, and says when', async () => {
  const say = voice(db, owner, clock);
  expect(await say.addReminder('Call the dentist', 'tomorrow at 3pm')).toBe('Reminder added for tomorrow at 3 PM: Call the dentist.');
  expect(await say.addReminder('Water the plants')).toBe('Reminder added for today: Water the plants.');
  expect(await say.addReminder('  ')).toBe("No reminder was heard.");
  const entries = await calendar(db, owner, clock).between(TUESDAY, 2);
  expect(entries.map((e) => [e.day, e.time, e.title])).toEqual([[TUESDAY, null, 'Water the plants'], ['2046-03-07', '15:00', 'Call the dentist']]);
});

it('only ever speaks for its own person', async () => {
  const other = await person('other');
  await kitchen(db, other, clock).addGrocery({ label: 'secret cake' });
  await calendar(db, other, clock).createEvent({ title: 'Surprise party', day: TUESDAY });
  const say = voice(db, owner, clock);
  expect(await say.whatToBuy()).toBe('Nothing on the list.');
  expect(await say.today()).toBe('Nothing on today.');
});
