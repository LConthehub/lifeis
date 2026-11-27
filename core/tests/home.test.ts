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
  expect([s.day, s.cards]).toEqual([TODAY, ['days', 'coming', 'kitchen', 'pantry', 'projects', 'upkeep', 'things', 'collection', 'week']]);
  expect(s.days.map((d) => [d.day, d.entries])).toEqual([[TODAY, []], ['2046-03-06', []], ['2046-03-07', []]]);
  expect([s.kitchen, s.pantry, s.projects, s.things, s.collection]).toEqual([
    { meals: [], to_buy: 0, short: [], use_up: null }, { low: [], expiring: [] }, [], { low: [], total: 0 }, { total: 0, wanted: 0, lent: [], lately: [], added: [], added_count: 0 }]);
});

it('the kitchen card names what is going off, and the best recipe for it, when something is', async () => {
  const k = kitchen(db, owner, clock);
  await k.savePantry({ name: 'cream', quantity: 1, unit: 'cup', expires_on: '2046-03-07' });   // 2 days
  await k.savePantry({ name: 'spinach', quantity: 1, unit: 'bag', expires_on: '2046-03-09' });  // 4 days
  await k.savePantry({ name: 'milk', quantity: 1, unit: 'l', expires_on: '2046-03-20' });       // not soon
  await k.createRecipe({ title: 'Cream pasta', servings: 2, ingredients_text: '1 cup cream\n1 bag spinach\n200 g pasta', steps_text: 'Cook it.' });
  await k.createRecipe({ title: 'Milk pudding', servings: 2, ingredients_text: '1 l milk', steps_text: 'Cook it.' });

  const s = await front.summary();
  expect(s.kitchen.use_up).toEqual({ soon: ['cream', 'spinach'], suggestion: { recipe_id: expect.any(Number), title: 'Cream pasta', uses: ['cream', 'spinach'] } });
  expect(s.kitchen.use_up!.suggestion!.recipe_id).toBeGreaterThan(0);
  await front.hideCards(['kitchen']);
  expect((await front.summary()).kitchen.use_up).toBeNull(); // out of sight: not read
});

it('the kitchen card has no use-up line when nothing is going off, and no recipe when none uses it', async () => {
  const k = kitchen(db, owner, clock);
  await k.savePantry({ name: 'milk', quantity: 1, unit: 'l', expires_on: '2046-03-20' });
  await k.createRecipe({ title: 'Milk pudding', servings: 2, ingredients_text: '1 l milk', steps_text: 'Cook it.' });
  expect((await front.summary()).kitchen.use_up).toBeNull();

  await k.savePantry({ name: 'cream', quantity: 1, unit: 'cup', expires_on: '2046-03-06' });  // tomorrow, and no recipe uses it
  expect((await front.summary()).kitchen.use_up).toEqual({ soon: ['cream'], suggestion: null });
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
  expect(s.collection).toEqual({ total: 1, wanted: 1, lent: [{ id: alien.id, title: 'Alien', to: 'Sam' }], lately: [{ id: alien.id, title: 'Alien', type: 'film', day: TODAY }],
    added: [{ id: alien.id, title: 'Alien', type: 'film', cover: null }], added_count: 1 }); // a wanted title is not new to the shelf
  // Added more than two weeks ago, it is no longer new.
  await db.run('UPDATE media SET created_at = ? WHERE id = ?', ['2046-02-15T09:00:00Z', alien.id]);
  expect([(await front.summary()).collection.added, (await front.summary()).collection.added_count]).toEqual([[], 0]);
});

it('a person chooses what shows, and a section they do not use brings no cards', async () => {
  let s = await front.hideCards(['pantry', 'collection']);
  expect(s.cards).toEqual(['days', 'coming', 'kitchen', 'projects', 'upkeep', 'things', 'week']);
  expect(s.choices.filter((c) => !c.shown).map((c) => c.key)).toEqual(['pantry', 'collection']);
  expect((await front.summary()).cards).toEqual(['days', 'coming', 'kitchen', 'projects', 'upkeep', 'things', 'week']); // remembered
  s = await front.hideCards([]);
  expect(s.cards).toHaveLength(9);
  await expect(front.hideCards(['horoscope'])).rejects.toMatchObject({ name: 'Problem', status: 400 });

  await life(db, owner, clock).saveProfile(['eating']); // only the kitchen
  s = await front.summary();
  expect([s.cards, s.choices.map((c) => c.key)]).toEqual([['kitchen', 'pantry', 'week'], ['kitchen', 'pantry', 'week']]);

  // Someone else's front page is their own.
  await kitchen(db, owner, clock).savePantry({ name: 'Cream', quantity: 1, low_at: 1 });
  const theirs = await home(db, await person('other'), clock).summary();
  expect([theirs.cards.length, theirs.pantry.low]).toEqual([9, []]);
});

it('plans come up on the Coming up card, and coupons about to run out get a card once there is one', async () => {
  const { plans } = await import('../src/plans.ts');
  const { shopping } = await import('../src/shopping.ts');
  const { addDays } = await import('../src/small.ts');
  expect((await front.summary()).choices.map((c) => c.key)).not.toContain('coupons');

  const mine = plans(db, owner, clock);
  const spring = await mine.create({ name: 'Spring break', start_day: addDays(TODAY, 12), end_day: addDays(TODAY, 14), note: null, story: null });
  await mine.create({ name: 'House guests', start_day: addDays(TODAY, -1), end_day: addDays(TODAY, 1), note: null, story: null });
  await mine.create({ name: 'Last summer', start_day: addDays(TODAY, -200), end_day: addDays(TODAY, -190), note: null, story: null });
  await mine.create({ name: 'Next year', start_day: addDays(TODAY, 300), end_day: addDays(TODAY, 300), note: null, story: null });
  const shop = shopping(db, owner, clock);
  await shop.addCoupon({ label: 'Coffee', cents_off: 150, store: 'Aldi', expires_on: addDays(TODAY, 2) });
  await shop.addCoupon({ label: 'Whole shop', percent_off: 10, expires_on: TODAY });
  await shop.addCoupon({ label: 'Next month', cents_off: 100, expires_on: addDays(TODAY, 30) });
  await shop.addCoupon({ label: 'Ran out', cents_off: 100, expires_on: addDays(TODAY, -1) });

  const s = await front.summary();
  expect([s.cards.includes('coming'), s.cards.includes('coupons')]).toEqual([true, true]);
  expect(s.coming.lines.map((p) => [p.name, p.days_until])).toEqual([['House guests', 0], ['Spring break', 12]]);
  expect(s.coming.lines[1]!.link).toBe(`/plans/${spring.id}`);
  expect(s.coupons.soon.map((c) => [c.label, c.days_left, c.store])).toEqual([['Whole shop', 0, null], ['Coffee', 2, 'Aldi']]);
  expect(s.coupons.currency).toBe('$');
});

it('Coming up stays hidden for someone who had hidden all three cards it replaced, and shows for someone who hid one', async () => {
  await db.run("INSERT INTO user_settings (user_id, key, value) VALUES (?, 'home_hidden_cards', ?)", [owner, JSON.stringify(['dates', 'plans', 'holidays'])]);
  expect((await front.summary()).cards).not.toContain('coming');
  await db.run("UPDATE user_settings SET value = ? WHERE user_id = ? AND key = 'home_hidden_cards'", [JSON.stringify(['dates']), owner]);
  expect((await front.summary()).cards).toContain('coming');
});

it('Coming up holds a renewal or a yearly job coming due in two months, not chores, bills or jobs far off', async () => {
  const { upkeep } = await import('../src/upkeep.ts');
  const jobs = upkeep(db, owner, clock);
  await jobs.create({ name: 'Car tabs', kind: 'renewal', every_n: 1, every_unit: 'year', first_due: '2046-04-10' });
  await jobs.create({ name: 'Clean the gutters', every_n: 1, every_unit: 'year', first_due: '2046-03-20' });
  await jobs.create({ name: 'Passport', kind: 'renewal', every_n: 10, every_unit: 'year', first_due: '2047-01-01' });
  await jobs.create({ name: 'Rent', kind: 'bill', every_n: 1, every_unit: 'month', first_due: '2046-03-10' });
  await jobs.create({ name: 'Vacuum', kind: 'chore', every_n: 1, every_unit: 'week' });
  await jobs.create({ name: 'Furnace filter', every_n: 3, every_unit: 'month', first_due: '2046-03-15' });
  expect((await front.summary()).coming.upkeep.map((j) => [j.name, j.kind, j.day, j.days_until])).toEqual([
    ['Clean the gutters', 'job', '2046-03-20', 15],
    ['Car tabs', 'renewal', '2046-04-10', 36],
  ]);
});
