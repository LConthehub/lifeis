/** Holidays: a plan that comes back each year, started from last year's, with decorations, a countdown, gifts and cards. */
import { beforeEach, expect, it } from 'vitest';
import { calendar } from '../src/calendar.ts';
import type { Answer, Fetcher } from '../src/connections.ts';
import type { Db } from '../src/db.ts';
import { givenTo, holidays } from '../src/holidays.ts';
import { home } from '../src/home.ts';
import { inventory } from '../src/inventory.ts';
import { kitchen } from '../src/kitchen.ts';
import { LATEST, migrate } from '../src/migrations.ts';
import { money } from '../src/money.ts';
import { plans } from '../src/plans.ts';
import { prep, prepDue } from '../src/prep.ts';
import { reminders } from '../src/reminders.ts';
import { tags } from '../src/tags.ts';
import { memoryDb } from './memoryDb.ts';

let db: Db;
let owner: number;
let day = '2026-10-01';
let time = '10:00';
const clock = Object.assign(() => new Date(`${day}T${time}:00`), { today: () => day });
const problem = (status: number) => expect.objectContaining({ name: 'Problem', status });
const THANKSGIVING = { name: 'Thanksgiving', rule: { kind: 'weekday', month: 11, weekday: 4, nth: 4 } } as const;

async function person(name: string): Promise<number> {
  return (await db.run("INSERT INTO users (username, password_hash, created_at) VALUES (?, 'x', 'now')", [name])).lastId;
}
const mine = () => holidays(db, owner, clock);

beforeEach(async () => {
  db = memoryDb();
  expect(await migrate(db)).toBe(LATEST);
  owner = await person('owner');
  day = '2026-10-01';
  time = '10:00';
});

it('adds Thanksgiving as the fourth Thursday of November and makes this year as a plan', async () => {
  const made = await mine().create(THANKSGIVING);
  expect(made.rule_words).toBe('Fourth Thursday of November');
  expect(made.years).toEqual([{ plan_id: expect.any(Number), year: 2026, day: '2026-11-26' }]);
  const plan = (await plans(db, owner, clock).list())[0]!;
  expect([plan.name, plan.start_day, plan.when]).toEqual(['Thanksgiving 2026', '2026-11-26', 'ahead']); // it is an ordinary plan, so it shows on the calendar
  expect((await calendar(db, owner, clock).between('2026-11-26', 1)).some((e) => e.title === 'Thanksgiving 2026')).toBe(true);
  expect(await mine().list()).toHaveLength(1);
  await expect(mine().create({ name: ' ', rule: { kind: 'manual' }, day: '2026-01-01' })).rejects.toEqual(problem(400));
  await expect(mine().create({ name: 'Mystery', rule: { kind: 'manual' } })).rejects.toEqual(problem(400)); // set each year: needs a day
});

it('suggests nothing: a new Life Is has no holidays', async () => {
  expect(await mine().list()).toEqual([]);
  expect((await home(db, owner, clock).summary()).cards).not.toContain('holidays');
});

it('keeps each person own holidays to themselves', async () => {
  const made = await mine().create(THANKSGIVING);
  const other = await person('other');
  expect(await holidays(db, other, clock).list()).toEqual([]);
  await expect(holidays(db, other, clock).get(made.id)).rejects.toEqual(problem(404));
  await expect(holidays(db, other, clock).year(made.years[0]!.plan_id)).rejects.toEqual(problem(404));
  await expect(holidays(db, other, clock).addGift(made.years[0]!.plan_id, { who: 'x', idea: 'y' })).rejects.toEqual(problem(404));
});

it('works a countdown back from dinner, with a frozen turkey thawed in the refrigerator', async () => {
  const k = kitchen(db, owner, clock);
  const turkey = (await k.createRecipe({ title: 'Roast turkey', ingredients_text: '1 turkey', cook_minutes: 240 })).id;
  const rolls = (await k.createRecipe({ title: 'Rolls', ingredients_text: '2 cups flour' })).id;
  await prep(db, owner, clock).setRecipeSteps(turkey, [{ words: 'Brine the turkey', rule: 'night_before', at: '20:00' }]);
  await prep(db, owner, clock).setRecipeSteps(rolls, [{ words: 'Mix the dough', rule: 'hours_before', hours: 4 }]);
  const planId = (await mine().create(THANKSGIVING)).years[0]!.plan_id;
  await plans(db, owner, clock).addItem(planId, { kind: 'recipe', ref_id: turkey });
  await plans(db, owner, clock).addItem(planId, { kind: 'recipe', ref_id: rolls });

  // Nothing is worked out until the person says when dinner is.
  expect((await mine().year(planId)).countdown.steps).toEqual([]);
  await expect(mine().setYear(planId, { dinner_time: '6pm' })).rejects.toEqual(problem(400));
  await expect(mine().setYear(planId, { turkey_pounds: 0 })).rejects.toEqual(problem(400));
  const year = await mine().setYear(planId, { dinner_time: '17:00', turkey_pounds: 18 });
  const steps = year.countdown.steps.map((s) => `${s.due_day} ${s.due_time} ${s.words}`);
  expect([...steps].sort()).toEqual([
    '2026-11-21 09:00 Put the 18 lb turkey in the refrigerator to thaw', // 18 lb: 5 days, 24 hours for each 4 pounds
    '2026-11-25 20:00 Brine the turkey',
    '2026-11-26 13:00 Mix the dough',
    '2026-11-26 13:00 Start cooking Roast turkey', // dinner at 5 pm, 240 minutes to cook
  ].sort());
  expect(steps[0]).toContain('Put the 18 lb turkey'); // and they come in the order of the day
  expect(year.countdown.thaw).toEqual({ pounds: 18, days: 5, source: 'USDA: thawing in the refrigerator' });
  expect(year.countdown.steps[0]!.detail).toContain('USDA: thawing in the refrigerator');

  // The person's own steps count back too, and dinner moving moves them all.
  await mine().addStep(planId, { words: 'Set the table', rule: 'morning_of', at: '10:00' });
  await mine().addStep(planId, { words: 'Make the gravy', rule: 'hours_before', hours: 1 });
  const moved = await mine().setYear(planId, { dinner_time: '15:00' });
  expect(moved.countdown.steps.find((s) => s.words === 'Make the gravy')).toMatchObject({ due_day: '2026-11-26', due_time: '14:00' });
  expect(moved.countdown.steps.find((s) => s.words === 'Mix the dough')).toMatchObject({ due_time: '11:00' });

  // Ticking a step off, whichever kind it is.
  const ticked = await mine().tick(planId, 'thaw', true);
  expect(ticked.countdown.steps.find((s) => s.key === 'thaw')!.done).toBe(true);
  await mine().tick(planId, `s${moved.countdown.steps.find((s) => s.words === 'Set the table')!.step_id}`, true);
  expect((await mine().year(planId)).countdown.steps.filter((s) => s.done)).toHaveLength(2);
  await expect(mine().tick(planId, 'x1', true)).rejects.toEqual(problem(400));
});

it('says a step is late when its time has gone and it is not done', async () => {
  const planId = (await mine().create(THANKSGIVING)).years[0]!.plan_id;
  await mine().setYear(planId, { dinner_time: '17:00', turkey_pounds: 12 }); // thaw: 3 days, so Nov 23 at 9 am
  day = '2026-11-24';
  expect((await mine().year(planId)).countdown.steps[0]).toMatchObject({ late: true, label: 'yesterday 9 am' });
  await mine().tick(planId, 'thaw', true);
  expect((await mine().year(planId)).countdown.steps[0]!.late).toBe(false);
});

it('starts next year from last year, with nothing ticked and what broke as the shopping list', async () => {
  const stuff = inventory(db, owner, clock);
  const kind = (await stuff.createKind({ name: 'Decor', icon: null, fields: [] })).find((x) => x.name === 'Decor')!;
  const box = (await stuff.createPlace({ name: 'Attic box 3' })).find((p) => p.name === 'Attic box 3')!;
  const lights = await stuff.createItem({ kind_id: kind.id, name: 'String lights', place_id: box.id });
  const k = kitchen(db, owner, clock);
  const pie = (await k.createRecipe({ title: 'Pumpkin pie', ingredients_text: '1 pumpkin' })).id;

  const first = (await mine().create(THANKSGIVING)).years[0]!.plan_id;
  await plans(db, owner, clock).addItem(first, { kind: 'recipe', ref_id: pie });
  await plans(db, owner, clock).addItem(first, { kind: 'task', label: 'Buy the turkey' });
  await mine().setYear(first, { dinner_time: '16:00', turkey_pounds: 14 });
  await mine().addPerson(first, 'guest', { name: 'Aunt June' });
  await mine().addPerson(first, 'guest', { name: 'Uncle Bo' });
  await mine().addPerson(first, 'card', { name: 'Grandma' });
  await mine().addStep(first, { words: 'Chill the wine', rule: 'morning_of', at: '09:00' });
  await mine().addDecor(first, { spot: 'Front porch', label: 'Wreath' });
  const withThing = await mine().addDecor(first, { spot: 'Mantel', label: '', thing_id: lights.id });
  expect(withThing.spots.find((s) => s.name === 'Mantel')!.items[0]).toMatchObject({ label: 'String lights', box: 'Attic box 3' }); // in a box, which is a place
  await mine().addGift(first, { who: 'Maya', idea: 'A scarf' });
  await mine().addGift(first, { who: 'Sam', idea: 'Chess set' });
  await mine().updateGift((await mine().year(first)).gifts[1]!.id, { status: 'given' });

  // The put-up list, then the take-down: the lights broke, the wreath is fine.
  let year = await mine().year(first);
  for (const d of year.spots.flatMap((s) => s.items)) await mine().updateDecor(d.id, { put_up: true });
  year = await mine().year(first);
  const lightsRow = year.spots.flatMap((s) => s.items).find((d) => d.label === 'String lights')!;
  const wreath = year.spots.flatMap((s) => s.items).find((d) => d.label === 'Wreath')!;
  await mine().updateDecor(lightsRow.id, { taken_down: true, boxed: true, fix: 'broke' });
  await mine().updateDecor(wreath.id, { taken_down: true });
  expect((await mine().year(first)).spots.flatMap((s) => s.items).find((d) => d.label === 'Wreath')!.boxed).toBe(false);
  await mine().updateDecor(wreath.id, { boxed: true });
  await mine().tick(first, 'thaw', true);

  day = '2026-12-01';
  const done = await mine().finish(first, 'Do the pie the day before. Less stuffing.');
  expect(done.notes_done).toBe(true);
  const holiday = (await mine().list())[0]!;
  expect(holiday.years.map((y) => y.day)).toEqual(['2027-11-25', '2026-11-26']); // next year's day is worked out from the rule

  const next = await mine().year(holiday.years[0]!.plan_id);
  expect(next.plan.name).toBe('Thanksgiving 2027');
  expect(next.last_notes).toBe('Do the pie the day before. Less stuffing.');
  expect(next.previous!.year).toBe(2026);
  expect(next.guests.map((g) => [g.name, g.done])).toEqual([['Aunt June', false], ['Uncle Bo', false]]);
  expect(next.cards.map((g) => g.name)).toEqual(['Grandma']);
  expect([next.dinner_time, next.turkey_pounds]).toEqual(['16:00', 14]);
  expect(next.countdown.steps.every((s) => !s.done)).toBe(true);
  expect(next.countdown.steps.map((s) => s.words)).toContain('Chill the wine');
  expect(next.plan.items_list.map((i) => [i.label, i.done])).toEqual([['Pumpkin pie', false], ['Buy the turkey', false]]);
  expect(next.spots.flatMap((s) => s.items).every((d) => !d.put_up && !d.taken_down && !d.boxed)).toBe(true);
  expect(next.shopping.map((d) => [d.label, d.need])).toEqual([['String lights', 'broke']]); // what broke is this year's shopping
  // Only ideas carry over; what was given is history.
  expect(next.gifts.map((g) => g.idea)).toEqual(['A scarf']);
  expect(next.put_up_on).toBe('2027-11-18'); // a week before, as last year's was

  // Asking again for the same year gives the one already made, and last year is still there to look back on.
  expect((await mine().startYear(holiday.id)).plan_id).toBe(next.plan_id);
  expect((await mine().year(first)).spots.flatMap((s) => s.items).find((d) => d.label === 'String lights')!.fix).toBe('broke');
  expect((await plans(db, owner, clock).list()).map((p) => p.name)).toEqual(['Thanksgiving 2027', 'Thanksgiving 2026']);

  // Buying the replacement ticks it off; what was given before is shown beside this year's idea for the same person.
  await mine().updateDecor((await mine().year(next.plan_id)).shopping[0]!.id, { need_done: true });
  expect((await mine().year(next.plan_id)).shopping[0]!.need_done).toBe(true);
  await mine().addGift(next.plan_id, { who: 'sam', idea: 'A chess clock' });
  expect((await mine().year(next.plan_id)).gifts.find((g) => g.idea === 'A chess clock')!.before).toEqual([{ year: 2026, idea: 'Chess set' }]);
});

it('tells next year about a decoration that breaks after next year already has its page', async () => {
  const first = (await mine().create(THANKSGIVING)).years[0]!.plan_id;
  await mine().addDecor(first, { spot: 'Door', label: 'Banner' });
  const holiday = (await mine().list())[0]!;
  const next = (await mine().startYear(holiday.id, { day: '2027-11-25' })).plan_id;
  await mine().updateDecor((await mine().year(first)).spots[0]!.items[0]!.id, { taken_down: true, fix: 'out' });
  expect((await mine().year(next)).shopping.map((d) => d.label)).toEqual(['Banner']);
  await mine().updateDecor((await mine().year(first)).spots[0]!.items[0]!.id, { fix: null });
  expect((await mine().year(next)).shopping).toEqual([]);
});

it('keeps a spot photo with the year and shows it on next year put-up list', async () => {
  const first = (await mine().create(THANKSGIVING)).years[0]!.plan_id;
  await mine().addDecor(first, { spot: 'Mantel', label: 'Garland' });
  const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0, 0, 0, 0]);
  const withPhoto = await mine().keepSpotPhoto(first, 'Mantel', png);
  expect(withPhoto.spots[0]!.photos).toHaveLength(1);
  const next = await mine().startYear((await mine().list())[0]!.id, { day: '2027-11-25' });
  expect(next.spots[0]).toMatchObject({ name: 'Mantel', photos: [], last_year: { photos: withPhoto.spots[0]!.photos, year: 2026 } });
  await expect(mine().keepSpotPhoto(first, 'Mantel', Uint8Array.from([1, 2, 3]))).rejects.toEqual(problem(400)); // not a photo
});

it('totals spending tagged to the holiday for the year, and nothing of another year', async () => {
  const planId = (await mine().create(THANKSGIVING)).years[0]!.plan_id;
  const tag = (await mine().list())[0] && (await db.get<{ id: number }>('SELECT tag_id AS id FROM holidays WHERE owner_id = ?', [owner]))!.id;
  const m = money(db, owner, clock);
  const bought = (await m.addEntry({ label: 'Groceries', cents: 8450, day: '2026-11-20' })).id;
  const flowers = (await m.addEntry({ label: 'Flowers', cents: 2000, day: '2026-11-25' })).id;
  const lastYear = (await m.addEntry({ label: 'Groceries 2025', cents: 9999, day: '2025-11-20' })).id;
  const other = (await m.addEntry({ label: 'Gas', cents: 4000, day: '2026-11-20' })).id;
  for (const id of [bought, flowers, lastYear]) await tags(db, owner, clock).set('spending', id, [tag!]);
  void other;
  await mine().setYear(planId, { budget_cents: 15000 });
  expect((await mine().year(planId)).budget).toEqual({ tag: 'Thanksgiving', spent_cents: 10450, count: 2, target_cents: 15000 });
  await expect(mine().setYear(planId, { budget_cents: -5 })).rejects.toEqual(problem(400));
});

it('a gift makes a spending entry of its own, tagged to the holiday, with no category', async () => {
  const planId = (await mine().create(THANKSGIVING)).years[0]!.plan_id;
  await mine().addGift(planId, { who: 'Maya', idea: 'A scarf' });
  const id = (await mine().year(planId)).gifts[0]!.id;
  await mine().updateGift(id, { status: 'bought', cents: 2500 });
  let year = await mine().year(planId);
  expect(year.budget).toMatchObject({ spent_cents: 2500, count: 1 });
  expect(await db.get('SELECT label, category_id FROM money_entries WHERE owner_id = ?', [owner])).toEqual({ label: 'Thanksgiving gift: A scarf', category_id: null });
  await mine().updateGift(id, { cents: 3000 });
  expect((await mine().year(planId)).budget.spent_cents).toBe(3000);
  await mine().updateGift(id, { status: 'idea' }); // never mind: the entry goes
  expect((await mine().year(planId)).budget.spent_cents).toBe(0);
  expect(await db.get('SELECT 1 AS x FROM money_entries WHERE owner_id = ?', [owner])).toBeUndefined();
  await expect(mine().updateGift(id, { status: 'lost' })).rejects.toEqual(problem(400));
  await expect(mine().updateGift(id, { cents: 1.5 })).rejects.toEqual(problem(400));
});

it('hides a gift from the person it is for, whoever can see the spending, until the holiday has passed', async () => {
  const partner = await person('partner');
  const planId = (await mine().create(THANKSGIVING)).years[0]!.plan_id;
  await mine().addGift(planId, { for_user: partner, idea: 'Binoculars' });
  const gift = (await mine().year(planId)).gifts[0]!;
  expect(gift.who).toBe('partner');
  await mine().updateGift(gift.id, { status: 'given', cents: 6000 });
  // The entry says nothing of who it is for, and sits in no category, so a category shared with the partner never shows it.
  expect(await db.get('SELECT label, category_id FROM money_entries WHERE owner_id = ?', [owner])).toEqual({ label: 'Thanksgiving gift', category_id: null });
  const shared = (await money(db, owner, clock).addCategory({ name: 'Household', monthly_cents: 200000, shared_with: [partner] })).id;
  await money(db, owner, clock).addEntry({ label: 'Rent', cents: 100000, day: '2026-11-01', category_id: shared });
  const theirs = await money(db, partner, clock).month('2026-11');
  expect(theirs.entries.map((e) => e.label)).toEqual(['Rent']); // they see the shared category's spending, and not the gift
  expect(theirs.total.spent).toBe(100000);
  expect(JSON.stringify(theirs)).not.toMatch(/Binoculars|gift/i);
  expect(await holidays(db, partner, clock).list()).toEqual([]);
  expect(await plans(db, partner, clock).list()).toEqual([]);
  expect(await givenTo(db, partner, clock)).toEqual([]); // before the day: nothing
  day = '2026-11-26';
  expect(await givenTo(db, partner, clock)).toEqual([]); // on the day itself: still nothing
  day = '2026-11-27';
  expect(await givenTo(db, partner, clock)).toEqual([{ holiday: 'Thanksgiving', year: 2026, day: '2026-11-26', idea: 'Binoculars' }]);
  expect(await givenTo(db, owner, clock)).toEqual([]);
});

it('turns a yearly date on the calendar into a holiday, with the age still shown', async () => {
  const event = await calendar(db, owner, clock).createEvent({ title: "Dad's birthday", day: '1960-03-14', yearly: true });
  const plain = await calendar(db, owner, clock).createEvent({ title: 'Dentist', day: '2026-10-20' });
  await expect(mine().fromEvent(plain.id)).rejects.toEqual(problem(400));
  const made = await mine().fromEvent(event.id);
  expect(made).toMatchObject({ name: "Dad's birthday", rule_words: 'March 14', from_calendar: true });
  expect(made.years[0]).toMatchObject({ year: 2027, day: '2027-03-14' }); // next one from today
  expect((await mine().year(made.years[0]!.plan_id)).turns).toBe(67);
  await expect(mine().fromEvent(event.id)).rejects.toEqual(problem(409));
  // The calendar date is untouched.
  expect((await calendar(db, owner, clock).yearly('2027-03-14', 1))[0]).toMatchObject({ title: "Dad's birthday", years: 67 });
  await mine().remove(made.id);
  expect(await mine().list()).toEqual([]);
  expect((await plans(db, owner, clock).list())[0]!.name).toBe("Dad's birthday 2027"); // removing the holiday keeps its years
});

it('asks for the day each year when the person sets it, once this year is finished', async () => {
  const made = await mine().create({ name: 'Family reunion', rule: { kind: 'manual' }, day: '2026-07-18' });
  day = '2026-07-19';
  const first = made.years[0]!.plan_id;
  expect((await mine().cards())[0]).toMatchObject({ stage: 'notes', name: 'Family reunion' });
  await mine().finish(first, 'Book the park sooner');
  expect((await mine().list())[0]!.years).toHaveLength(1); // nothing is guessed
  expect((await mine().cards())[0]).toMatchObject({ stage: 'next_date', next: "When is next year's Family reunion?" });
  await expect(mine().startYear(made.id)).rejects.toEqual(problem(400));
  const next = await mine().startYear(made.id, { day: '2027-08-07' });
  expect([next.year, next.day]).toEqual([2027, '2027-08-07']);
  expect(next.last_notes).toBe('Book the park sooner');
});

it('shows on Home six weeks ahead, what is next until take-down, asks for notes, then goes quiet', async () => {
  const made = await mine().create(THANKSGIVING);
  const planId = made.years[0]!.plan_id;
  await mine().setYear(planId, { dinner_time: '17:00', turkey_pounds: 12 });
  await mine().addDecor(planId, { spot: 'Porch', label: 'Wreath' });
  const card = async () => (await home(db, owner, clock).summary()).holidays[0];

  day = '2026-10-14'; // 43 days ahead: more than six weeks
  expect(await card()).toBeUndefined();
  expect((await home(db, owner, clock).summary()).cards).toContain('holidays');
  day = '2026-10-15'; // 42 days: six weeks to the day
  expect(await card()).toMatchObject({ stage: 'planning', days_until: 42, name: 'Thanksgiving' });
  expect((await card())!.next).toContain('Put the 12 lb turkey in the refrigerator to thaw');
  day = '2026-11-10';
  await mine().tick(planId, 'thaw', true);
  expect((await card())!.next).toBe('1 decoration to put up by 2026-11-19');
  const decor = (await mine().year(planId)).spots[0]!.items[0]!;
  await mine().updateDecor(decor.id, { put_up: true });
  expect((await card())!.next).toBe('Everything is ready');

  day = '2026-11-27'; // after the day: take-down
  expect(await card()).toMatchObject({ stage: 'take_down', next: '1 decoration to take down and put back in their boxes' });
  await mine().finishTakeDown(planId);
  expect(await card()).toMatchObject({ stage: 'notes' });
  await mine().finish(planId, null);
  expect(await card()).toBeUndefined(); // quiet until next year's lead time
  day = '2027-10-13';
  expect(await card()).toBeUndefined();
  day = '2027-10-14';
  expect(await card()).toMatchObject({ stage: 'planning', year: 2027 });
  // Long past and never finished: it stops asking.
  day = '2028-02-01';
  expect((await mine().cards()).filter((c) => c.stage === 'notes' || c.stage === 'take_down')).toEqual([]);
});

it('offers to start this year when none was started and its lead time has come', async () => {
  const made = await mine().create(THANKSGIVING);
  await db.run('DELETE FROM plans WHERE id = ?', [made.years[0]!.plan_id]); // the person removed the plan; the holiday stays
  day = '2026-10-20';
  expect((await mine().cards())[0]).toMatchObject({ stage: 'start', plan_id: null, link: `/plans/holidays/${made.id}` });
  const year = await mine().startYear(made.id);
  expect(year.day).toBe('2026-11-26');
});

it('reminds in the morning round: start planning, put up, take down', async () => {
  const planId = (await mine().create(THANKSGIVING)).years[0]!.plan_id;
  await mine().addDecor(planId, { spot: 'Porch', label: 'Wreath' });
  await mine().setYear(planId, { put_up_on: '2026-11-14', take_down_on: '2026-11-30' });
  day = '2026-10-15';
  expect((await mine().digestLines()).map((l) => l.title)).toEqual(['Time to start planning Thanksgiving']);
  day = '2026-11-14';
  expect((await mine().digestLines()).map((l) => l.title)).toEqual(['Put up the Thanksgiving decorations']);
  await mine().updateDecor((await mine().year(planId)).spots[0]!.items[0]!.id, { put_up: true });
  expect(await mine().digestLines()).toEqual([]); // nothing left to put up
  day = '2026-11-30';
  expect((await mine().digestLines()).map((l) => l.title)).toEqual(['Take down the Thanksgiving decorations']);
  // And it goes out with the digest.
  expect((await reminders(db, owner, clock).digest()).lines.some((l) => l.title === 'Take down the Thanksgiving decorations')).toBe(true);
});

it('sends each countdown step once, at its time, and never late', async () => {
  const planId = (await mine().create(THANKSGIVING)).years[0]!.plan_id;
  await mine().setYear(planId, { dinner_time: '17:00', turkey_pounds: 8 }); // thaw: 2 days, Nov 24 at 9 am
  await mine().addStep(planId, { words: 'Chill the wine', rule: 'morning_of', at: '10:30' });
  const sent: string[] = [];
  const tools = { fetcher: (async (_url, _headers, send) => { sent.push(send?.body ?? ''); return { status: 200, type: 'text/plain', json: async () => ({}), bytes: async () => new Uint8Array() } as Answer; }) as Fetcher };
  await reminders(db, owner, clock, tools).save({ ntfy: { server: 'https://ntfy.example.org', topic: 'abcdef123456', detail: 'full' }, zone: 'UTC' });
  expect(await prepDue(db, new Date(Date.UTC(2026, 10, 24, 8, 59)), tools)).toEqual([]); // not yet
  const at9 = await prepDue(db, new Date(Date.UTC(2026, 10, 24, 9, 0)), tools);
  expect(at9).toHaveLength(1);
  expect(sent.join(' ')).toContain('Put the 8 lb turkey in the refrigerator to thaw');
  expect(await prepDue(db, new Date(Date.UTC(2026, 10, 24, 9, 1)), tools)).toEqual([]); // once only
  expect(await prepDue(db, new Date(Date.UTC(2026, 10, 24, 9, 30)), tools)).toEqual([]); // the wine is at 10:30 on the 26th
  // A step whose time went by a long while ago is not sent late.
  expect(await prepDue(db, new Date(Date.UTC(2026, 10, 26, 12, 0)), tools)).toEqual([]);
  expect(await prepDue(db, new Date(Date.UTC(2026, 10, 26, 10, 31)), tools)).toHaveLength(1);
});

it('does not remind a recipe step twice when the recipe is also on the week\'s meals', async () => {
  const k = kitchen(db, owner, clock);
  const turkey = (await k.createRecipe({ title: 'Roast turkey', ingredients_text: '1 turkey' })).id;
  await prep(db, owner, clock).setRecipeSteps(turkey, [{ words: 'Brine the turkey', rule: 'night_before', at: '20:00' }]);
  const planId = (await mine().create(THANKSGIVING)).years[0]!.plan_id;
  await plans(db, owner, clock).addItem(planId, { kind: 'recipe', ref_id: turkey, day: '2026-11-26', meal: 'dinner' });
  await mine().setYear(planId, { dinner_time: '17:00' });
  const year = await mine().year(planId);
  expect(year.countdown.steps[0]).toMatchObject({ words: 'Brine the turkey', reminded_on_week: true });
  // The week's meal now has the dinner time, so its own reminders count back from it.
  const meal = year.plan.items_list[0]!.on_week!;
  expect(meal).toMatchObject({ day: '2026-11-26' });
  expect(await mine().countdownDue('2026-11-25', '2026-11-25')).toEqual([]);
});

it('rolls back a gift or decoration that is not valid, and refuses what is not the person own', async () => {
  const planId = (await mine().create(THANKSGIVING)).years[0]!.plan_id;
  await expect(mine().addGift(planId, { who: '', idea: 'x' })).rejects.toEqual(problem(400));
  await expect(mine().addGift(planId, { who: 'Sam', idea: '' })).rejects.toEqual(problem(400));
  await expect(mine().addGift(planId, { for_user: 9999, idea: 'x' })).rejects.toEqual(problem(404));
  await expect(mine().addDecor(planId, { spot: '', label: 'x' })).rejects.toEqual(problem(400));
  await expect(mine().addDecor(planId, { spot: 'Porch', label: 'x', thing_id: 9999 })).rejects.toEqual(problem(404));
  await expect(mine().addDecor(planId, { spot: 'Porch', label: 'x', box_id: 9999 })).rejects.toEqual(problem(404));
  await mine().addPerson(planId, 'guest', { name: 'Sam' });
  await expect(mine().addPerson(planId, 'guest', { name: 'sam' })).rejects.toEqual(problem(409));
  const other = await person('other');
  await expect(mine().addPerson(planId, 'card', { user_id: other, member_id: 1 })).rejects.toEqual(problem(400));
  await expect(holidays(db, other, clock).updateGift(1, {})).rejects.toEqual(problem(404));
  expect((await tags(db, owner, clock).list()).map((t) => t.path)).toEqual(['Thanksgiving']); // the holiday's own tag, made once
  await mine().create({ ...THANKSGIVING, name: 'thanksgiving' }).catch(() => undefined);
  expect((await tags(db, owner, clock).list()).map((t) => t.path)).toEqual(['Thanksgiving']);
});
