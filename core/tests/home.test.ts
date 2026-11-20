/** The front page gathers what today holds from every section, and each person chooses what it shows. */
import { beforeEach, expect, it } from 'vitest';
import { calendar } from '../src/calendar.ts';
import type { Db } from '../src/db.ts';
import { home, type Home } from '../src/home.ts';
import { inventory } from '../src/inventory.ts';
import { kitchen } from '../src/kitchen.ts';
import { life } from '../src/life.ts';
import { media } from '../src/media.ts';
import { migrate } from '../src/migrations.ts';
import { projects } from '../src/projects.ts';
import { memoryDb } from './memoryDb.ts';

let db: Db;
let owner: number;
let front: Home;
const clock = () => new Date(2046, 2, 5, 10, 0, 0);
const TODAY = '2046-03-05';

async function person(name: string): Promise<number> {
  return (await db.run("INSERT INTO users (username, password_hash, created_at) VALUES (?, 'x', 'now')", [name])).lastId;
}

beforeEach(async () => {
  db = memoryDb();
  await migrate(db);
  owner = await person('owner');
  front = home(db, owner, clock);
});

it('an empty home shows every card, with nothing on them', async () => {
  const s = await front.summary();
  expect([s.day, s.cards]).toEqual([TODAY, ['days', 'dates', 'kitchen', 'pantry', 'projects', 'things', 'collection', 'week']]);
  expect(s.days.map((d) => [d.day, d.entries])).toEqual([[TODAY, []], ['2046-03-06', []], ['2046-03-07', []]]);
  expect([s.kitchen, s.pantry, s.projects, s.things, s.collection]).toEqual([
    { meals: [], to_buy: 0, short: [] }, { low: [], expiring: [] }, [], { low: [], total: 0 }, { total: 0, wanted: 0, lent: [], lately: [] }]);
});

it('it gathers today from every section', async () => {
  const k = kitchen(db, owner, clock);
  const things = inventory(db, owner, clock);
  const dishes = (await things.addStarter('cookware')).find((kind) => kind.name === 'Baking dishes')!;
  const dish = await things.createItem({ kind_id: dishes.id, name: '8x8 baking dish', quantity: 1, low_at: 1 });
  const brownies = await k.createRecipe({ title: 'Brownies', ingredients_text: '200 g chocolate', equipment: [{ item_id: dish.id, quantity: 2 }] });
  await k.addPlan({ day: TODAY, meal: 'dinner', recipe_id: brownies.id });
  await k.addPlan({ day: '2046-03-06', meal: 'dinner', title: 'Leftovers' });
  await k.groceryFromPlan(TODAY, 1);
  await k.savePantry({ name: 'Cream', quantity: 1, low_at: 1, expires_on: '2046-03-06' });
  await calendar(db, owner, clock).createEvent({ title: 'Dentist', day: TODAY, time: '14:30' });
  const making = projects(db, owner, clock);
  const dress = await making.createProject({ name: 'Shirt dress', status: 'active', due_on: '2046-03-07' });
  await making.addLine(dress.id, { label: 'Zip', quantity: 1 });
  await making.createProject({ name: 'Someday', status: 'idea' });
  const shelf = media(db, owner, clock);
  const alien = await shelf.create({ type: 'film', title: 'Alien' }, { format: 'VHS', lent_to: 'Sam' });
  await shelf.log(alien.id, { day: TODAY });
  await shelf.create({ type: 'music', title: 'Blue', wanted: true });

  const s = await front.summary();
  expect(s.days[0]!.entries.map((e) => `${e.kind}: ${e.title}`)).toEqual(['event: Dentist', 'meal: Brownies', 'media: Alien']);
  expect(s.days[2]!.entries.map((e) => `${e.kind}: ${e.title}`)).toEqual(['due: Shirt dress']);
  expect(s.kitchen.meals.map((m) => m.recipe_title)).toEqual(['Brownies']);
  expect([s.kitchen.to_buy, s.kitchen.short.map((x) => [x.label, x.need, x.have])]).toEqual([1, [['8x8 baking dish', 2, 1]]]);
  expect(s.pantry).toEqual({ low: ['Cream'], expiring: [{ name: 'Cream', days_left: 1 }] });
  expect(s.projects.map((p) => [p.name, p.status, p.short_count])).toEqual([['Shirt dress', 'active', 1]]); // ideas aren't "in hand"
  expect(s.things).toEqual({ total: 1, low: [{ id: dish.id, name: '8x8 baking dish', amount: '1', kind: 'Baking dishes' }] });
  expect(s.collection).toEqual({ total: 2, wanted: 1, lent: [{ id: alien.id, title: 'Alien', to: 'Sam' }], lately: [{ id: alien.id, title: 'Alien', type: 'film', day: TODAY }] });
});

it('a person chooses what shows, and a section they do not use brings no cards', async () => {
  let s = await front.hideCards(['pantry', 'collection']);
  expect(s.cards).toEqual(['days', 'dates', 'kitchen', 'projects', 'things', 'week']);
  expect(s.choices.filter((c) => !c.shown).map((c) => c.key)).toEqual(['pantry', 'collection']);
  expect((await front.summary()).cards).toEqual(['days', 'dates', 'kitchen', 'projects', 'things', 'week']); // remembered
  s = await front.hideCards([]);
  expect(s.cards).toHaveLength(8);
  await expect(front.hideCards(['horoscope'])).rejects.toMatchObject({ name: 'Problem', status: 400 });

  await life(db, owner, clock).saveProfile(['eating']); // only the kitchen
  s = await front.summary();
  expect([s.cards, s.choices.map((c) => c.key)]).toEqual([['kitchen', 'pantry', 'week'], ['kitchen', 'pantry', 'week']]);

  // Someone else's front page is their own.
  await kitchen(db, owner, clock).savePantry({ name: 'Cream', quantity: 1, low_at: 1 });
  const theirs = await home(db, await person('other'), clock).summary();
  expect([theirs.cards.length, theirs.pantry.low]).toEqual([8, []]);
});
