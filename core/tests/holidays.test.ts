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

it('a weekday on or after a date finds each year, and the next year starts on its own day', async () => {
  const made = await mine().create({ name: 'Lantern night at the lake', rule: { kind: 'after', month: 11, day: 2, weekday: 2 } });
  expect(made.rule_words).toBe('The first Tuesday on or after November 2');
  expect(made.years.map((y) => y.day)).toEqual(['2026-11-03']);
  day = '2026-11-10';
  await mine().finish(made.years[0]!.plan_id, 'More lanterns');
  expect((await mine().get(made.id)).years.map((y) => y.day)).toEqual(['2027-11-02', '2026-11-03']);
  const row = await db.get<{ rule: string; rule_kind: string }>('SELECT rule, rule_kind FROM holidays WHERE id = ?', [made.id]);
  expect(row).toEqual({ rule: 'manual', rule_kind: 'after' }); // the table's own check holds
  expect((await plans(db, owner, clock).get(made.years[0]!.plan_id)).yearly!.rule_words).toBe('The first Tuesday on or after November 2');
});

it('a day on another calendar finds each year, and can be changed to one on this calendar', async () => {
  day = '2026-12-01';
  const made = await mine().create({ name: 'Block party', rule: { kind: 'calendar', calendar: 'chinese', month: '2', day: 15 } });
  expect(made.rule_words).toBe('Day 15 of Second Month on the Chinese calendar');
  expect(made.years.map((y) => y.day)).toEqual(['2027-03-22']);
  day = '2027-04-01';
  await mine().finish(made.years[0]!.plan_id, null);
  expect((await mine().get(made.id)).years.map((y) => y.day)).toEqual(['2028-03-10', '2027-03-22']);
  const back = await mine().update(made.id, { rule: { kind: 'fixed', month: 3, day: 22 } });
  expect(back.rule).toEqual({ kind: 'fixed', month: 3, day: 22 });
  expect(await db.get('SELECT rule_kind, calendar, cal_month, cal_day FROM holidays WHERE id = ?', [made.id])).toEqual({ rule_kind: null, calendar: null, cal_month: null, cal_day: null });
  await expect(mine().update(made.id, { rule: { kind: 'calendar', calendar: 'chinese', month: '13', day: 1 } })).rejects.toEqual(problem(400));
});

it('a plan that comes back every 5 years starts its next year five years on, counted from its first', async () => {
  const planId = (await plans(db, owner, clock).create({ name: 'Family reunion 2026', start_day: '2026-07-04' })).id;
  await mine().makeYearly(planId, { rule: { kind: 'fixed', month: 7, day: 4, every: 5 } });
  const holiday = (await mine().list())[0]!;
  expect([holiday.rule_words, holiday.rule]).toEqual(['July 4, every 5 years', { kind: 'fixed', month: 7, day: 4, every: 5, from: 2026 }]);
  day = '2026-07-20';
  await mine().finish(planId, 'Rent the pavilion earlier');
  expect((await mine().get(holiday.id)).years.map((y) => y.day)).toEqual(['2031-07-04', '2026-07-04']);
  // Asked to start a year in 2028, it finds the one already on its way.
  day = '2028-01-10';
  expect((await mine().startYear(holiday.id)).day).toBe('2031-07-04');
  // Changing how often keeps the first year it counts from.
  const every3 = await mine().update(holiday.id, { rule: { kind: 'fixed', month: 7, day: 4, every: 3 } });
  expect(every3.rule).toEqual({ kind: 'fixed', month: 7, day: 4, every: 3, from: 2026 });
  const yearly = await mine().update(holiday.id, { rule: { kind: 'fixed', month: 7, day: 4 } });
  expect([yearly.rule, yearly.rule_words]).toEqual([{ kind: 'fixed', month: 7, day: 4 }, 'July 4']);
  await expect(mine().update(holiday.id, { rule: { kind: 'fixed', month: 7, day: 4, every: 12 } })).rejects.toEqual(problem(400));
});

it('suggests nothing: a new Life Is has no holidays', async () => {
  expect(await mine().list()).toEqual([]);
  expect((await home(db, owner, clock).summary()).coming.holidays).toEqual([]);
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
  await expect(plans(db, owner, clock).setFood(planId, { served_at: '6pm' })).rejects.toEqual(problem(400));
  await expect(plans(db, owner, clock).addFood(planId, { label: 'Turkey', thaw_pounds: 0 })).rejects.toEqual(problem(400));
  await plans(db, owner, clock).setFood(planId, { served_at: '17:00' });
  const turkeyLine = (await plans(db, owner, clock).addFood(planId, { label: 'Turkey', thaw_pounds: 18 })).food_lines[0]!.id;
  const year = await mine().year(planId);
  const steps = year.countdown.steps.map((s) => `${s.due_day} ${s.due_time} ${s.words}`);
  expect([...steps].sort()).toEqual([
    '2026-11-21 09:00 Put the 18 lb Turkey in the refrigerator to thaw', // 18 lb: 5 days, 24 hours for each 4 pounds
    '2026-11-25 20:00 Brine the turkey',
    '2026-11-26 13:00 Mix the dough',
    '2026-11-26 13:00 Start cooking Roast turkey', // dinner at 5 pm, 240 minutes to cook
  ].sort());
  expect(steps[0]).toContain('Put the 18 lb Turkey'); // and they come in the order of the day
  expect(year.countdown.thaw).toEqual([{ label: 'Turkey', pounds: 18, days: 5, source: 'USDA: thawing in the refrigerator' }]);
  expect(year.countdown.steps[0]!.detail).toContain('USDA: thawing in the refrigerator');

  // The person's own steps count back too, and dinner moving moves them all.
  await mine().addStep(planId, { words: 'Set the table', rule: 'morning_of', at: '10:00' });
  await mine().addStep(planId, { words: 'Make the gravy', rule: 'hours_before', hours: 1 });
  await plans(db, owner, clock).setFood(planId, { served_at: '15:00' });
  const moved = await mine().year(planId);
  expect(moved.countdown.steps.find((s) => s.words === 'Make the gravy')).toMatchObject({ due_day: '2026-11-26', due_time: '14:00' });
  expect(moved.countdown.steps.find((s) => s.words === 'Mix the dough')).toMatchObject({ due_time: '11:00' });

  // Ticking a step off, whichever kind it is.
  const ticked = await mine().tick(planId, `f${turkeyLine}`, true);
  expect(ticked.countdown.steps.find((s) => s.key === `f${turkeyLine}`)!.done).toBe(true);
  await mine().tick(planId, `s${moved.countdown.steps.find((s) => s.words === 'Set the table')!.step_id}`, true);
  expect((await mine().year(planId)).countdown.steps.filter((s) => s.done)).toHaveLength(2);
  await expect(mine().tick(planId, 'x1', true)).rejects.toEqual(problem(400));
});

it('says a step is late when its time has gone and it is not done', async () => {
  const planId = (await mine().create(THANKSGIVING)).years[0]!.plan_id;
  await plans(db, owner, clock).setFood(planId, { served_at: '17:00' });
  const line = (await plans(db, owner, clock).addFood(planId, { label: 'Turkey', thaw_pounds: 12 })).food_lines[0]!.id; // thaw: 3 days, so Nov 23 at 9 am
  day = '2026-11-24';
  expect((await mine().year(planId)).countdown.steps[0]).toMatchObject({ late: true, label: 'yesterday 9 am' });
  await mine().tick(planId, `f${line}`, true);
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
  await plans(db, owner, clock).setFood(first, { served_at: '16:00' });
  const firstTurkey = (await plans(db, owner, clock).addFood(first, { label: 'Turkey', brought_by: 'Uncle Bo', thaw_pounds: 14 })).food_lines[0]!.id;
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
  await mine().tick(first, `f${firstTurkey}`, true);

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
  expect([next.plan.served_at, next.plan.food_lines.map((f) => [f.label, f.brought_by, f.thaw_pounds, f.done])]).toEqual(['16:00', [['Turkey', 'Uncle Bo', 14, false]]]);
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
  await plans(db, owner, clock).setFood(planId, { served_at: '17:00' });
  const thawLine = (await plans(db, owner, clock).addFood(planId, { label: 'Turkey', thaw_pounds: 12 })).food_lines[0]!.id;
  await mine().addDecor(planId, { spot: 'Porch', label: 'Wreath' });
  const card = async () => (await home(db, owner, clock).summary()).coming.holidays[0];

  day = '2026-10-14'; // 43 days ahead: more than six weeks
  expect(await card()).toBeUndefined();
  expect((await home(db, owner, clock).summary()).cards).toContain('coming');
  day = '2026-10-15'; // 42 days: six weeks to the day
  expect(await card()).toMatchObject({ stage: 'planning', days_until: 42, name: 'Thanksgiving' });
  expect((await card())!.next).toContain('Put the 12 lb Turkey in the refrigerator to thaw');
  day = '2026-11-10';
  await mine().tick(planId, `f${thawLine}`, true);
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
  // With a year made, the card opens that year's plan page.
  expect((await mine().cards())[0]).toMatchObject({ plan_id: year.plan_id, link: `/plans/${year.plan_id}` });
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
  await plans(db, owner, clock).setFood(planId, { served_at: '17:00' });
  await plans(db, owner, clock).addFood(planId, { label: 'Turkey', thaw_pounds: 8 }); // thaw: 2 days, Nov 24 at 9 am
  await mine().addStep(planId, { words: 'Chill the wine', rule: 'morning_of', at: '10:30' });
  const sent: string[] = [];
  const tools = { fetcher: (async (_url, _headers, send) => { sent.push(send?.body ?? ''); return { status: 200, type: 'text/plain', json: async () => ({}), bytes: async () => new Uint8Array() } as Answer; }) as Fetcher };
  await reminders(db, owner, clock, tools).save({ ntfy: { server: 'https://ntfy.example.org', topic: 'abcdef123456', detail: 'full' }, zone: 'UTC' });
  expect(await prepDue(db, new Date(Date.UTC(2026, 10, 24, 8, 59)), tools)).toEqual([]); // not yet
  const at9 = await prepDue(db, new Date(Date.UTC(2026, 10, 24, 9, 0)), tools);
  expect(at9).toHaveLength(1);
  expect(sent.join(' ')).toContain('Put the 8 lb Turkey in the refrigerator to thaw');
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
  await plans(db, owner, clock).setFood(planId, { served_at: '17:00' });
  const year = await mine().year(planId);
  expect(year.countdown.steps[0]).toMatchObject({ words: 'Brine the turkey', reminded_on_week: true });
  // The week's meal now has the time it is served, so its own reminders count back from it.
  const meal = year.plan.items_list[0]!.on_week!;
  expect(meal).toMatchObject({ day: '2026-11-26' });
  expect((await db.get<{ eat_time: string }>('SELECT eat_time FROM meal_plan WHERE recipe_id = ?', [turkey]))!.eat_time).toBe('17:00');
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

it('a gift bought the day after the holiday, on the page for next year, counts toward next year and not this one', async () => {
  const made = await mine().create(THANKSGIVING); // 2026-11-26
  const thisYear = made.years[0]!.plan_id;
  day = '2026-11-27';
  const next = (await mine().startYear(made.id)).plan_id;
  expect((await mine().year(next)).day).toBe('2027-11-25');
  await mine().addGift(next, { who: 'Maya', idea: 'A scarf' });
  await mine().updateGift((await mine().year(next)).gifts[0]!.id, { status: 'bought', cents: 4000 });
  expect((await mine().year(next)).budget).toMatchObject({ spent_cents: 4000, count: 1 });
  expect((await mine().year(thisYear)).budget).toMatchObject({ spent_cents: 0, count: 0 });
});

it('guests, cards, gifts and decorations work on any plan, not only a holiday', async () => {
  const lunch = await plans(db, owner, clock).create({ name: 'Memorial lunch', start_day: '2026-10-10', parts: ['guests', 'gifts'] });
  await mine().addPerson(lunch.id, 'guest', { name: 'Aunt June' });
  await mine().addPerson(lunch.id, 'card', { name: 'Grandma' });
  await mine().addDecor(lunch.id, { spot: 'Hall', label: 'Photo board' });
  const added = await mine().addGift(lunch.id, { who: 'Hank', idea: 'A frame' });
  expect(added.holiday).toBeNull();
  const g = added.gifts[0]!;
  const bought = await mine().updateGift(g.id, { status: 'bought', cents: 1800 });
  expect(bought.gifts.map((x) => [x.idea, x.status, x.cents, x.before])).toEqual([['A frame', 'bought', 1800, []]]);
  // The spending entry is named after the plan, with no category and no tag.
  expect(await db.get('SELECT label, category_id, cents FROM money_entries WHERE owner_id = ?', [owner])).toEqual({ label: 'Memorial lunch gift: A frame', category_id: null, cents: 1800 });
  expect(await db.get("SELECT COUNT(*) AS n FROM tag_links WHERE kind = 'spending'")).toEqual({ n: 0 });
  const view = await mine().gathering(lunch.id);
  expect([view.guests.map((p) => p.name), view.cards.map((p) => p.name), view.spots.map((s) => [s.name, s.items.map((i) => i.label)])]).toEqual([['Aunt June'], ['Grandma'], [['Hall', ['Photo board']]]]);
  await mine().updateDecor(view.spots[0]!.items[0]!.id, { fix: 'broke' }); // no next year to pass it on to: fine
  await mine().removeGift(g.id);
  expect(await db.get('SELECT 1 AS x FROM money_entries WHERE owner_id = ?', [owner])).toBeUndefined();
  // Someone else's plan is not theirs to add to.
  const other = (await db.run("INSERT INTO users (username, password_hash, created_at) VALUES ('other', 'x', 'now')")).lastId;
  await expect(holidays(db, other, clock).addGift(lunch.id, { who: 'Hank', idea: 'A frame' })).rejects.toEqual(problem(404));
  await expect(holidays(db, other, clock).gathering(lunch.id)).rejects.toEqual(problem(404));
});

it('makes a plan come back every year: the next year starts from it, with its parts and lists', async () => {
  const p = plans(db, owner, clock);
  const party = await p.create({ name: 'Block party 2026', start_day: '2026-10-10', parts: ['food', 'guests', 'tasks'] });
  expect(party.yearly).toBeNull();
  await p.addItem(party.id, { kind: 'task', label: 'Borrow the tables' });
  await mine().addPerson(party.id, 'guest', { name: 'The Hills' });
  const yearly = await mine().makeYearly(party.id, { rule: { kind: 'weekday', month: 10, weekday: 6, nth: 2 } });
  // Named without its year; this plan is its first year.
  expect(yearly.yearly).toEqual(expect.objectContaining({ name: 'Block party', rule_words: 'Second Saturday of October', year: 2026, next_due: false }));
  expect(yearly.yearly!.years).toEqual([{ plan_id: party.id, year: 2026, day: '2026-10-10' }]);
  await expect(mine().makeYearly(party.id, { rule: { kind: 'manual' } })).rejects.toEqual(problem(409));
  // Once its day has gone, the next year can be started, from this one.
  day = '2026-10-20';
  expect((await p.get(party.id)).yearly!.next_due).toBe(true);
  const next = await mine().startYear(yearly.yearly!.holiday_id);
  expect([next.plan.name, next.day, next.plan.parts]).toEqual(['Block party 2027', '2027-10-09', ['food', 'guests', 'tasks']]);
  expect(next.guests.map((g) => g.name)).toEqual(['The Hills']);
  expect(next.plan.items_list.map((i) => [i.label, i.done])).toEqual([['Borrow the tables', false]]);
  expect((await p.get(party.id)).yearly!.years.map((y) => y.year)).toEqual([2027, 2026]);
  // Stopping leaves each year as a plan.
  await mine().remove(yearly.yearly!.holiday_id);
  expect((await p.get(party.id)).yearly).toBeNull();
  expect((await p.list()).map((x) => x.name).sort()).toEqual(['Block party 2026', 'Block party 2027']);
  // Someone else's plan is not theirs to make yearly.
  const other = await person('other');
  await expect(holidays(db, other, clock).makeYearly(party.id, { rule: { kind: 'manual' } })).rejects.toEqual(problem(404));
});

it("a holiday's first year starts with the parts a holiday uses", async () => {
  const made = await mine().create(THANKSGIVING);
  const plan = await plans(db, owner, clock).get(made.years[0]!.plan_id);
  expect(plan.parts).toEqual(['food', 'guests', 'cards', 'gifts', 'decorations', 'budget', 'tasks']);
  expect(plan.yearly!.name).toBe('Thanksgiving');
});
