/** Outdoor trips: a trip that comes back each year, with camping, fishing and hunting parts turned on. */
import { beforeEach, expect, it } from 'vitest';
import { calendar } from '../src/calendar.ts';
import type { Db } from '../src/db.ts';
import { bringInDownload, exportEverything, splitDownload } from '../src/exportAll.ts';
import { inventory } from '../src/inventory.ts';
import { kitchen } from '../src/kitchen.ts';
import { licenses } from '../src/licenses.ts';
import { LATEST, migrate } from '../src/migrations.ts';
import { outdoorTrips, type OutdoorView, type PlanGear, type YearView } from '../src/outdoorTrips.ts';
import { plans as plansOf } from '../src/plans.ts';
import { upkeep } from '../src/upkeep.ts';
import { memoryDb } from './memoryDb.ts';

let db: Db;
let owner: number;
let day = '2046-05-01';
const clock = Object.assign(() => new Date(`${day}T10:00:00`), { today: () => day });
const problem = (status: number) => expect.objectContaining({ name: 'Problem', status });

async function person(name: string): Promise<number> {
  return (await db.run("INSERT INTO users (username, password_hash, created_at) VALUES (?, 'x', 'now')", [name])).lastId;
}
const mine = () => outdoorTrips(db, owner, clock);

/** What a camper keeps: camping gear, tackle with counts, and a recipe or two. */
async function gear() {
  const stuff = inventory(db, owner, clock);
  const camp = (await stuff.createKind({ name: 'Camping gear', icon: null, fields: [{ name: 'Type', type: 'choice', choices: ['Tent', 'Cooler', 'Stove', 'Other'] }] })).find((k) => k.name === 'Camping gear')!;
  const tackle = (await stuff.createKind({ name: 'Fishing tackle', icon: null, fields: [] })).find((k) => k.name === 'Fishing tackle')!;
  const hunt = (await stuff.createKind({ name: 'Hunting gear', icon: null, fields: [] })).find((k) => k.name === 'Hunting gear')!;
  const type = camp.fields[0]!.id;
  const tent = await stuff.createItem({ kind_id: camp.id, name: 'Family tent', values: { [type]: 'Tent' } });
  const cooler = await stuff.createItem({ kind_id: camp.id, name: 'Big cooler', values: { [type]: 'Cooler' } });
  await stuff.createItem({ kind_id: camp.id, name: 'Two-burner stove', values: { [type]: 'Stove' } });
  const jig = await stuff.createItem({ kind_id: tackle.id, name: 'Jig heads', quantity: 2, low_at: 3 });
  await stuff.createItem({ kind_id: tackle.id, name: 'Spinner', quantity: 6, low_at: 2 });
  await stuff.createItem({ kind_id: hunt.id, name: 'Orange vest' });
  await stuff.createItem({ kind_id: hunt.id, name: '.308 cartridges', quantity: 12 });
  return { tent, cooler, jig };
}

beforeEach(async () => {
  db = memoryDb();
  expect(await migrate(db)).toBe(LATEST);
  owner = await person('owner');
  day = '2046-05-01';
});

it('one trip turns on camping and fishing, builds a bring list, a camp menu, a catch log, and sends a torn tent to Upkeep', async () => {
  const { tent, jig } = await gear();
  const made = await mine().create({ name: 'Lake weekend', parts: ['camping', 'fishing'], day: '2046-06-13', end_day: '2046-06-15' });
  expect(made.parts).toEqual(['camping', 'fishing']);
  const planId = made.years[0]!.plan_id;
  expect((await calendar(db, owner, clock).between('2046-06-13', 3)).some((e) => e.title === 'Lake weekend 2046')).toBe(true); // an ordinary plan, so on the calendar
  await expect(mine().create({ name: ' ', parts: ['camping'], day: '2046-06-13' })).rejects.toEqual(problem(400));
  await expect(mine().create({ name: 'Odd', parts: ['sailing'], day: '2046-06-13' })).rejects.toEqual(problem(400));

  // the bring list, from the gear
  const filled = await mine().fillGear(planId, 'camping');
  expect(filled.added).toBe(3);
  expect((await mine().fillGear(planId, 'camping')).added).toBe(0);
  await mine().fillGear(planId, 'fishing');
  let year = await mine().year(planId);
  expect(year.gear.filter((g) => g.part === 'camping').map((g) => g.label)).toEqual(['Big cooler', 'Family tent', 'Two-burner stove']);
  expect(year.gear.find((g) => g.label === 'Jig heads')).toMatchObject({ have: '2', low: true });
  await expect(mine().addGear(planId, { part: 'hunting', label: 'Vest' })).rejects.toEqual(problem(400)); // hunting is not on
  year = await mine().addGear(planId, { part: 'camping', label: 'Bug spray', quantity: 2 });
  expect(year.gear).toHaveLength(6);

  // the camp menu goes onto the grocery list; the cooler and stove are found among what is owned
  const cook = kitchen(db, owner, clock);
  const chili = await cook.createRecipe({ title: 'Camp chili', servings: 4, ingredients_text: '2 lb ground beef\n1 can beans', steps_text: 'Brown it.' });
  year = await mine().addMeal(planId, { recipe_id: chili.id, day: '2046-06-13', meal: 'dinner' });
  expect(year.menu.map((m) => [m.label, m.on_week?.day])).toEqual([['Camp chili', '2046-06-13']]);
  expect(year.checks.kitchen).toMatchObject({ cooler: 'Big cooler', stove: 'Two-burner stove' });
  const listed = await mine().menuToGroceries(planId);
  expect(listed.added).toBeGreaterThan(0);
  expect((await cook.listGrocery()).map((g) => g.label.toLowerCase()).join(' ')).toMatch(/ground beef/);

  // the site booking, typed in, shows on the calendar
  year = await mine().setYear(planId, { campground: 'Pine Hollow', site: '14', confirmation: 'AB12', check_in: '2046-06-13', check_out: '2046-06-15', water: 'Lake Pepin' });
  const booked = (await calendar(db, owner, clock).between('2046-06-13', 3)).filter((e) => e.title.startsWith('Lake weekend: Pine Hollow'));
  expect(booked.length).toBeGreaterThan(0); // shown on each of its days
  await mine().setYear(planId, { campground: 'Pine Hollow North' });
  expect((await db.all("SELECT title FROM events WHERE owner_id = ? AND title LIKE 'Lake weekend:%'", [owner]))).toEqual([{ title: 'Lake weekend: Pine Hollow North' }]); // changed, not doubled
  await expect(mine().setYear(planId, { check_in: '2046-06-15', check_out: '2046-06-13' })).rejects.toEqual(problem(400));

  // a catch with the lure from the tackle, freezer, what worked
  day = '2046-06-14';
  year = await mine().addCatch(planId, { fish: 'Walleye', length_inches: 17.5, weight_lb: 2.5, kept: true, lure_thing_id: jig.id });
  expect(year.catches[0]).toMatchObject({ fish: 'Walleye', day: '2046-06-14', water: 'Lake Pepin', lure: 'Jig heads', kept: true });
  await mine().addCatch(planId, { fish: 'Walleye', length_inches: 14, lure_thing_id: jig.id });
  await mine().addCatch(planId, { fish: 'Perch', lure: 'Little spinner', kept: false });
  year = await mine().freezeCatch(year.catches[0]!.id);
  year = await mine().freezeCatch(year.catches[0]!.id); // twice: still once
  expect((await cook.listPantry()).items.find((i) => i.name.toLowerCase() === 'walleye')).toMatchObject({ location: 'freezer', quantity: 1 });
  await expect(mine().freezeCatch(year.catches[2]!.id)).rejects.toEqual(problem(400)); // released fish stay in the water
  expect(year.worked).toEqual([{ water: 'Lake Pepin', season: 'summer', lures: [{ lure: 'Jig heads', count: 2, fish: ['Walleye'] }, { lure: 'Little spinner', count: 1, fish: ['Perch'] }] }]);
  expect(year.catch_years).toEqual([{ year: 2046, count: 3, kept: 1, released: 2, biggest_inches: 17.5 }]);
  expect(year.checks.tackle_low.map((t) => t.name)).toEqual(['Jig heads']);
  expect((await mine().tackleToList(planId)).added).toBe(1);

  // after the trip: the torn tent goes to Upkeep, a replacement to the shopping list
  const tentLine = year.gear.find((g) => g.label === 'Family tent')!;
  year = await mine().updateGear(tentLine.id, { packed: true, returned: true, after_trip: 'repair' });
  const job = year.gear.find((g) => g.label === 'Family tent')!;
  expect(job.job_id).not.toBeNull();
  const found = (await upkeep(db, owner, clock).list()).find((j) => j.name === 'Repair: Family tent')!;
  expect(found).toMatchObject({ activity: 'Camping', item: { id: tent.id } });
  await mine().updateGear(tentLine.id, { after_trip: 'repair' });
  expect((await upkeep(db, owner, clock).list()).filter((j) => j.name.startsWith('Repair'))).toHaveLength(1); // once
  const bug = year.gear.find((g) => g.label === 'Bug spray')!;
  await mine().updateGear(bug.id, { after_trip: 'replace' });
  expect((await cook.listGrocery()).some((g) => /bug spray/i.test(g.label))).toBe(true);
  await expect(mine().updateGear(bug.id, { after_trip: 'burn' })).rejects.toEqual(problem(400));
});

it('a trip comes back from last year: the bring list unpacked, the menu on new days, seasons a year on, notes kept', async () => {
  await gear();
  const made = await mine().create({ name: 'Lake weekend', parts: ['camping', 'fishing'], day: '2046-06-13', end_day: '2046-06-15' });
  const first = made.years[0]!.plan_id;
  await mine().fillGear(first, 'camping');
  await mine().addSeason(first, { part: 'fishing', label: 'Walleye opener', opens_on: '2046-05-15', closes_on: '2046-12-01', remind_days: 7 });
  await expect(mine().addSeason(first, { part: 'camping', label: 'x', opens_on: '2046-05-15' })).rejects.toEqual(problem(400));
  const chili = await kitchen(db, owner, clock).createRecipe({ title: 'Camp chili', ingredients_text: '1 can beans' });
  await mine().addMeal(first, { recipe_id: chili.id, day: '2046-06-14', meal: 'dinner' });
  const gearLine = (await mine().year(first)).gear[0]!;
  await mine().updateGear(gearLine.id, { packed: true, after_trip: 'dry' });
  await mine().setYear(first, { campground: 'Pine Hollow', confirmation: 'AB12', check_in: '2046-06-13' });
  await mine().addCatch(first, { fish: 'Bass' });
  await mine().finish(first, 'Bring more firewood');
  day = '2046-07-01';
  const next = await mine().startYear(made.id);
  expect(next.day).toBe('2047-06-13');
  expect(next.end_day).toBe('2047-06-15');
  expect(next.last_notes).toBe('Bring more firewood');
  expect(next.gear.map((g) => [g.label, g.packed, g.returned, g.after_trip])).toEqual(expect.arrayContaining([['Family tent', false, false, null]]));
  expect(next.seasons.map((s) => [s.label, s.opens_on, s.closes_on])).toEqual([['Walleye opener', '2047-05-15', '2047-12-01']]);
  expect(next.menu.map((m) => [m.label, m.on_week?.day])).toEqual([['Camp chili', '2047-06-14']]);
  expect(next.booking).toMatchObject({ campground: 'Pine Hollow', confirmation: null, check_in: null }); // the site is remembered, not last year's number
  expect(next.catches).toEqual([]);
  expect((await mine().startYear(made.id)).plan_id).toBe(next.plan_id); // asked twice: the one made
  expect((await mine().year(first)).catches).toHaveLength(1);
  expect((await mine().get(made.id)).years.map((y) => y.year)).toEqual([2047, 2046]);
});

it('adds up what was spent on the trip from spending tagged to it', async () => {
  const made = await mine().create({ name: 'Lake weekend', parts: ['fishing'], day: '2046-06-13' });
  const planId = made.years[0]!.plan_id;
  const tag = (await db.get<{ id: number }>("SELECT id FROM tags WHERE owner_id = ? AND name = 'Lake weekend'", [owner]))!.id;
  const entry = (await db.run("INSERT INTO money_entries (owner_id, category_id, label, cents, day, note, created_at) VALUES (?, NULL, 'Bait', 1250, '2046-06-12', NULL, 'now')", [owner])).lastId;
  await db.run("INSERT INTO tag_links (tag_id, kind, target_id) VALUES (?, 'spending', ?)", [tag, entry]);
  await mine().setYear(planId, { budget_cents: 20000 });
  expect((await mine().year(planId)).budget).toMatchObject({ tag: 'Lake weekend', spent_cents: 1250, count: 1, target_cents: 20000 });
});

it('checks fishing and hunting licenses against the trip', async () => {
  const made = await mine().create({ name: 'Fall trip', parts: ['fishing', 'hunting'], day: '2046-10-10', end_day: '2046-10-12' });
  const planId = made.years[0]!.plan_id;
  let year = await mine().year(planId);
  expect(year.checks.licenses.map((l) => [l.part, l.found, l.ok])).toEqual([['fishing', null, false], ['hunting', null, false]]);
  await licenses(db, owner, clock).create({ name: 'Fishing license', category: 'Outdoors', expires_on: '2046-08-01' });
  await licenses(db, owner, clock).create({ name: 'Deer tag', category: 'Outdoors', expires_on: '2046-12-31' });
  year = await mine().year(planId);
  expect(year.checks.licenses.map((l) => [l.part, l.found, l.ok])).toEqual([['fishing', 'Fishing license', false], ['hunting', 'Deer tag', true]]);
  expect(year.checks.licenses[0]!.words).toMatch(/Renew it first/);
});

it('hunting keeps a bring list with an ammunition check, a harvest log, and meat for the freezer', async () => {
  await gear();
  const made = await mine().create({ name: 'Deer camp', parts: ['hunting'], day: '2046-11-08', end_day: '2046-11-10' });
  const planId = made.years[0]!.plan_id;
  expect((await mine().fillGear(planId, 'hunting')).added).toBe(2);
  await mine().addGear(planId, { part: 'hunting', label: '.308 rounds', quantity: 20, caliber: '.308' });
  await mine().addGear(planId, { part: 'hunting', label: '12 gauge shells', quantity: 10, caliber: '12 gauge' });
  const year = await mine().year(planId);
  expect(year.checks.ammo.map((a) => [a.caliber, a.bringing, a.have, a.short])).toEqual([['.308', 20, 12, 8], ['12 gauge', 10, null, null]]);
  expect(year.checks.kitchen).toBeNull();
  await mine().addHarvest(planId, { animal: 'White-tailed deer', day: '2046-11-09', place: 'North ridge', tag_number: 'T-4471', weight_lb: 140 });
  let after = await mine().year(planId);
  expect(after.harvest[0]).toMatchObject({ animal: 'White-tailed deer', tag_number: 'T-4471', weight_lb: 140, frozen: false });
  after = (await mine().freezeHarvest(after.harvest[0]!.id)) as typeof after;
  expect((await kitchen(db, owner, clock).listPantry()).items.find((i) => i.name === 'White-tailed deer meat')).toMatchObject({ location: 'freezer', quantity: 1 });
  await expect(mine().addCatch(planId, { fish: 'Bass' })).rejects.toEqual(problem(400)); // fishing is not on
});

it('shows the house a shared trip by name and days, never the hunting, and nothing of a private one', async () => {
  const made = await mine().create({ name: 'Lake weekend', parts: ['camping', 'fishing', 'hunting'], day: '2046-06-13', end_day: '2046-06-15' });
  const planId = made.years[0]!.plan_id;
  await mine().addCatch(planId, { fish: 'Walleye', length_inches: 18, kept: true });
  await mine().addHarvest(planId, { animal: 'Turkey', tag_number: 'secret-1' });
  const other = person('other').then((id) => outdoorTrips(db, id, clock));
  const seen = await (await other).shared();
  expect(seen).toEqual([{ trip_id: made.id, name: 'Lake weekend', who: 'owner', first_day: '2046-06-13', last_day: '2046-06-15', parts: ['camping', 'fishing'], catches: [{ fish: 'Walleye', day: '2046-06-13', length_inches: 18, kept: true }] }]);
  expect(JSON.stringify(seen)).not.toMatch(/Turkey|secret-1|hunting/);
  await mine().update(made.id, { private: true });
  expect(await (await other).shared()).toEqual([]);
  await expect((await other).get(made.id)).rejects.toEqual(problem(404));
  await expect((await other).year(planId)).rejects.toEqual(problem(404));
  expect(await mine().shared()).toEqual([]); // your own are not "shared with you"
  // a private trip shows only its name on the calendar, with the booking's details left off
  await mine().setYear(planId, { campground: 'Pine Hollow', site: '14', confirmation: 'AB12', check_in: '2046-06-13' });
  const event = (await db.get<{ title: string; note: string | null }>('SELECT title, note FROM events WHERE owner_id = ?', [owner]))!;
  expect(event).toEqual({ title: 'Lake weekend', note: null });
});

it('reminds before opening day, and the day before a trip with things left to pack', async () => {
  await gear();
  const made = await mine().create({ name: 'Lake weekend', parts: ['camping', 'fishing'], day: '2046-05-17' });
  const planId = made.years[0]!.plan_id;
  await mine().addSeason(planId, { part: 'fishing', label: 'Walleye opener', opens_on: '2046-05-15', remind_days: 7 });
  await mine().fillGear(planId, 'camping');
  day = '2046-05-08';
  expect(await mine().digestLines()).toEqual([expect.objectContaining({ title: 'Walleye opener opens in 7 days', link: `/plans/${planId}` })]);
  day = '2046-05-16';
  expect(await mine().digestLines()).toEqual([expect.objectContaining({ title: 'Lake weekend starts tomorrow', detail: '3 still to pack', urgent: true })]);
  const all = (await mine().year(planId)).gear;
  for (const g of all) await mine().updateGear(g.id, { packed: true });
  expect(await mine().digestLines()).toEqual([]);
});

it('keeps each person own trips to themselves', async () => {
  const made = await mine().create({ name: 'Lake weekend', parts: ['fishing'], day: '2046-06-13' });
  const other = await person('other');
  expect(await outdoorTrips(db, other, clock).list()).toEqual([]);
  await expect(outdoorTrips(db, other, clock).addCatch(made.years[0]!.plan_id, { fish: 'Bass' })).rejects.toEqual(problem(404));
  await expect(outdoorTrips(db, other, clock).remove(made.id)).rejects.toEqual(problem(404));
});

it('goes out in the download and comes back in once, with nothing of anyone else', async () => {
  const { jig } = await gear();
  const made = await mine().create({ name: 'Lake weekend', parts: ['camping', 'fishing', 'hunting'], day: '2046-06-13', end_day: '2046-06-15' });
  const planId = made.years[0]!.plan_id;
  await mine().fillGear(planId, 'camping');
  await mine().addGear(planId, { part: 'hunting', label: '.308 rounds', quantity: 20, caliber: '.308' });
  await mine().addSeason(planId, { part: 'fishing', label: 'Walleye opener', opens_on: '2046-05-15', closes_on: '2046-12-01', remind_days: 10 });
  await mine().setYear(planId, { water: 'Lake Pepin', campground: 'Pine Hollow', confirmation: 'AB12', budget_cents: 15000 });
  await mine().addCatch(planId, { fish: 'Walleye', day: '2046-06-14', length_inches: 17.5, weight_lb: 2.5, kept: true, lure_thing_id: jig.id });
  await mine().addHarvest(planId, { animal: 'Turkey', day: '2046-06-14', place: 'Back field', tag_number: 'T-1', weight_lb: 18 });
  const tent = (await mine().year(planId)).gear.find((g) => g.label === 'Family tent')!;
  await mine().updateGear(tent.id, { packed: true, after_trip: 'dry' });
  await mine().finish(planId, 'More firewood');

  const zip = (await exportEverything(db, owner, clock)).bytes;
  const bob = await person('bob');
  const bring = async () => {
    const { files } = await splitDownload(zip);
    const done = await bringInDownload(db, bob, files, ['plans', 'trips'], clock);
    for (const kind of done.kinds) expect(kind.ok, `${kind.key}: ${kind.problem}`).toBe(true);
    return done;
  };
  await bring();
  const theirs = outdoorTrips(db, bob, clock);
  const trip = (await theirs.list())[0]!;
  expect([trip.name, trip.parts, trip.private]).toEqual(['Lake weekend', ['camping', 'fishing', 'hunting'], false]);
  const year = await theirs.year(trip.years[0]!.plan_id);
  expect([year.water, year.booking.campground, year.booking.confirmation, year.budget_cents, year.notes_next, year.notes_done]).toEqual(['Lake Pepin', 'Pine Hollow', 'AB12', 15000, 'More firewood', true]);
  expect(year.catches.map((c) => [c.fish, c.day, c.length_inches, c.weight_lb, c.kept, c.lure])).toEqual([['Walleye', '2046-06-14', 17.5, 2.5, true, 'Jig heads']]);
  expect(year.harvest.map((h) => [h.animal, h.place, h.tag_number, h.weight_lb])).toEqual([['Turkey', 'Back field', 'T-1', 18]]);
  expect(year.seasons.map((s) => [s.label, s.opens_on, s.closes_on, s.remind_days])).toEqual([['Walleye opener', '2046-05-15', '2046-12-01', 10]]);
  expect(year.gear.find((g) => g.label === 'Family tent')).toMatchObject({ packed: true, after_trip: 'dry' });
  expect(year.gear.find((g) => g.part === 'hunting')).toMatchObject({ caliber: '.308', quantity: 20 });
  // The same file again adds nothing.
  const again = await bring();
  expect(again.kinds.find((k) => k.key === 'trips')).toMatchObject({ found: 1, fresh: 0, already: 1 });
  expect(await theirs.list()).toHaveLength(1);
  expect((await theirs.year(trip.years[0]!.plan_id)).catches).toHaveLength(1);
  expect((await mine().list())[0]!.years).toHaveLength(1);
});

/** A camping weekend that is not a trip's year: a plain plan with the outdoor parts checked. */
async function weekend() {
  const { tent } = await gear();
  const plan = await plansOf(db, owner, clock).create({ name: 'Camping weekend', start_day: '2046-06-13', end_day: '2046-06-15', parts: ['bring', 'seasons', 'harvest', 'after_trip'] });
  const view = async () => (await mine().outdoor(plan.id)) as OutdoorView;
  return { plan, tent, view };
}

it('seasons and the license check work on a plan that is not a trip, one check for each kind it has a season for', async () => {
  const { plan, view } = await weekend();
  expect(await view()).toMatchObject({ trip: null, seasons: [], harvest: [], gear: [], checks: { licenses: [] } });
  await expect(mine().addSeason(plan.id, { part: 'camping', label: 'x', opens_on: '2046-05-15' })).rejects.toEqual(problem(400));
  await expect(mine().addSeason(plan.id, { part: null, label: 'x', opens_on: '2046-05-15' })).rejects.toEqual(problem(400));
  const added = (await mine().addSeason(plan.id, { part: 'fishing', label: 'Walleye opener', opens_on: '2046-05-15', closes_on: '2046-12-01', remind_days: 7 })) as OutdoorView;
  expect(added.seasons.map((s) => [s.part, s.label])).toEqual([['fishing', 'Walleye opener']]);
  // Fishing only: one check, and no license kept yet.
  expect(added.checks.licenses.map((l) => [l.kind, l.ok, l.found])).toEqual([['fishing', false, null]]);
  await licenses(db, owner, clock).create({ name: 'Fishing license', category: 'Outdoors', expires_on: '2046-08-01' });
  await licenses(db, owner, clock).create({ name: 'Deer tag', category: 'Outdoors', expires_on: '2046-06-14' });
  expect((await view()).checks.licenses.map((l) => [l.kind, l.ok, l.found])).toEqual([['fishing', true, 'Fishing license']]);
  const both = (await mine().addSeason(plan.id, { part: 'hunting', label: 'Deer season', opens_on: '2046-11-01' })) as OutdoorView;
  // The hunting tag ends the 14th, before the plan is over on the 15th.
  expect(both.checks.licenses.map((l) => [l.kind, l.ok, l.found])).toEqual([['fishing', true, 'Fishing license'], ['hunting', false, 'Deer tag']]);
  const left = (await mine().removeSeason(both.seasons.find((s) => s.label === 'Deer season')!.id)) as OutdoorView;
  expect(left.seasons).toHaveLength(1);
  expect(left.checks.licenses.map((l) => l.kind)).toEqual(['fishing']);
  expect(plan.parts).toContain('seasons');
});

it('the harvest log works on a plan that is not a trip, with meat to the freezer and a hunting license check', async () => {
  const { plan, view } = await weekend();
  await expect(mine().addHarvest(plan.id, { animal: ' ' })).rejects.toEqual(problem(400));
  const added = (await mine().addHarvest(plan.id, { animal: 'Deer', day: '2046-06-14', place: 'North ridge', tag_number: 'T-1', weight_lb: 120 })) as OutdoorView;
  expect(added.harvest).toMatchObject([{ animal: 'Deer', place: 'North ridge', tag_number: 'T-1', weight_lb: 120, frozen: false }]);
  expect(added.checks.licenses.map((l) => [l.kind, l.ok])).toEqual([['hunting', false]]); // a harvest line asks about the hunting license
  const frozen = (await mine().freezeHarvest(added.harvest[0]!.id)) as OutdoorView;
  expect(frozen.harvest[0]!.frozen).toBe(true);
  expect((await kitchen(db, owner, clock).listPantry()).items.find((i) => i.name === 'Deer meat')).toMatchObject({ location: 'freezer', quantity: 1 });
  await mine().freezeHarvest(added.harvest[0]!.id);
  expect((await kitchen(db, owner, clock).listPantry()).items.find((i) => i.name === 'Deer meat')).toMatchObject({ quantity: 1 }); // once
  expect(((await mine().removeHarvest(added.harvest[0]!.id)) as OutdoorView).harvest).toEqual([]);
  expect((await view()).checks.licenses).toEqual([]);
});

it('after the trip works on a plan that is not a trip: back home, what each thing needs, a repair to Upkeep once, a replacement to the list once', async () => {
  const { plan, tent, view } = await weekend();
  const plans = plansOf(db, owner, clock);
  expect((await view()).gear).toEqual([]); // nothing on the Bring list yet
  await plans.addItem(plan.id, { kind: 'thing', ref_id: tent.id });
  await plans.addItem(plan.id, { kind: 'thing', ref_id: (await inventory(db, owner, clock).listItems()).find((t) => t.name === 'Big cooler')!.id });
  await plans.addItem(plan.id, { kind: 'task', label: 'Buy ice' }); // not a thing: not listed
  const first = (await view()).gear;
  expect(first.map((g) => [g.label, g.returned, g.after_trip, g.after_done])).toEqual([['Family tent', false, null, false], ['Big cooler', false, null, false]]);
  const [tentLine, cooler] = first as [PlanGear, PlanGear];
  await expect(mine().updateBring(tentLine.id, { after_trip: 'burn' })).rejects.toEqual(problem(400));
  await mine().updateBring(tentLine.id, { returned: true, after_trip: 'dry' });
  let now = ((await mine().updateBring(tentLine.id, { after_done: true })) as OutdoorView).gear[0]!;
  expect(now).toMatchObject({ returned: true, after_trip: 'dry', after_done: true });
  now = ((await mine().updateBring(tentLine.id, { after_trip: 'clean' })) as OutdoorView).gear[0]!;
  expect(now).toMatchObject({ after_trip: 'clean', after_done: false }); // a new need starts undone
  await mine().updateBring(tentLine.id, { after_trip: 'repair' });
  await mine().updateBring(tentLine.id, { after_trip: 'repair' });
  expect((await upkeep(db, owner, clock).list()).filter((j) => j.name === 'Repair: Family tent')).toHaveLength(1);
  expect(((await view()).gear[0]!).job_id).not.toBeNull();
  await mine().updateBring(cooler.id, { after_trip: 'replace' });
  await mine().updateBring(cooler.id, { after_trip: 'replace' });
  expect((await kitchen(db, owner, clock).listGrocery()).filter((g) => /big cooler/i.test(g.label))).toHaveLength(1);
  // Taking the thing off the plan takes its line away.
  await plans.removeItem(cooler.id);
  expect((await view()).gear.map((g) => g.label)).toEqual(['Family tent']);
});

it('on a plan that is not a trip, these parts are only for its own person, and a part taken off keeps what is in it', async () => {
  const { plan, tent, view } = await weekend();
  const plans = plansOf(db, owner, clock);
  await mine().addSeason(plan.id, { part: 'fishing', label: 'Walleye opener', opens_on: '2046-05-15' });
  await mine().addHarvest(plan.id, { animal: 'Turkey' });
  const item = (await plans.addItem(plan.id, { kind: 'thing', ref_id: tent.id })).items_list[0]!;
  await mine().updateBring(item.id, { returned: true, after_trip: 'dry' });
  const seasonId = (await view()).seasons[0]!.id;
  const harvestId = (await view()).harvest[0]!.id;
  const other = outdoorTrips(db, await person('other'), clock);
  await expect(other.outdoor(plan.id)).rejects.toEqual(problem(404));
  await expect(other.addSeason(plan.id, { part: 'fishing', label: 'x', opens_on: '2046-05-15' })).rejects.toEqual(problem(404));
  await expect(other.addHarvest(plan.id, { animal: 'Deer' })).rejects.toEqual(problem(404));
  await expect(other.removeSeason(seasonId)).rejects.toEqual(problem(404));
  await expect(other.removeHarvest(harvestId)).rejects.toEqual(problem(404));
  await expect(other.freezeHarvest(harvestId)).rejects.toEqual(problem(404));
  await expect(other.updateBring(item.id, { returned: false })).rejects.toEqual(problem(404));
  // Taken off the plan, they are still there when checked again.
  await plans.setParts(plan.id, ['bring']);
  await plans.setParts(plan.id, ['bring', 'seasons', 'harvest', 'after_trip']);
  const back = await view();
  expect([back.seasons.length, back.harvest.length, back.gear[0]!.returned, back.gear[0]!.after_trip]).toEqual([1, 1, true, 'dry']);
});

it('a trip year shows its own data through the plan page route, and a plan that is not a trip does not mix with it', async () => {
  await gear();
  const made = await mine().create({ name: 'Lake weekend', parts: ['camping', 'fishing'], day: '2046-06-13', end_day: '2046-06-15' });
  const planId = made.years[0]!.plan_id;
  await mine().fillGear(planId, 'camping');
  await mine().addSeason(planId, { part: 'fishing', label: 'Walleye opener', opens_on: '2046-05-15' });
  const view = (await mine().outdoor(planId)) as YearView;
  expect(view.trip.parts).toEqual(['camping', 'fishing']);
  expect(view.gear.length).toBeGreaterThan(0);
  expect(view.seasons.map((s) => s.label)).toEqual(['Walleye opener']);
  // Hunting is not on for this trip, so a harvest line is refused, as on the trip's own page.
  await expect(mine().addHarvest(planId, { animal: 'Deer' })).rejects.toEqual(problem(400));
});

it('a trip year opens as a plan with the parts its trip uses, and next year keeps them', async () => {
  const made = await mine().create({ name: 'Lake weekend', parts: ['camping', 'fishing'], day: '2046-06-13', end_day: '2046-06-15' });
  const planId = made.years[0]!.plan_id;
  const plan = await plansOf(db, owner, clock).get(planId);
  expect(plan.parts).toEqual(['food', 'budget', 'more_days', 'when_where', 'tasks', 'bring', 'seasons', 'after_trip']);
  expect(plan.trip).toMatchObject({ trip_id: made.id, name: 'Lake weekend', parts: ['camping', 'fishing'], private: false, year: 2046, next_due: false });
  const hunter = await mine().create({ name: 'Fall hunt', parts: ['hunting'], day: '2046-10-01' });
  expect((await plansOf(db, owner, clock).get(hunter.years[0]!.plan_id)).parts).toEqual(['budget', 'more_days', 'tasks', 'bring', 'seasons', 'harvest', 'after_trip']);
  // a part taken off the plan stays off next year; a part turned on for the trip is checked on its years
  await plansOf(db, owner, clock).setParts(planId, ['food', 'budget', 'more_days', 'when_where', 'bring', 'seasons', 'after_trip']);
  day = '2046-07-01';
  const next = await mine().startYear(made.id);
  expect((await plansOf(db, owner, clock).get(next.plan_id)).parts).toEqual(['food', 'budget', 'more_days', 'when_where', 'bring', 'seasons', 'after_trip']);
  expect((await plansOf(db, owner, clock).get(next.plan_id)).trip!.years.map((y) => y.year)).toEqual([2047, 2046]);
  await mine().update(made.id, { parts: ['camping', 'fishing', 'hunting'] });
  expect((await plansOf(db, owner, clock).get(planId)).parts).toContain('harvest');
  expect((await plansOf(db, owner, clock).get(planId)).parts).not.toContain('tasks');
});

it('a trip year made before trips used parts shows its trip parts, and a year started from it has them saved', async () => {
  const made = await mine().create({ name: 'Lake weekend', parts: ['camping', 'hunting'], day: '2046-06-13', end_day: '2046-06-15' });
  const planId = made.years[0]!.plan_id;
  await db.run("UPDATE plans SET parts = 'food,budget,tasks,bring' WHERE id = ?", [planId]); // how a year was saved before
  expect((await plansOf(db, owner, clock).get(planId)).parts).toEqual(['food', 'budget', 'more_days', 'when_where', 'tasks', 'bring', 'seasons', 'harvest', 'after_trip']);
  day = '2046-07-01';
  const next = await mine().startYear(made.id);
  expect((await db.get<{ parts: string }>('SELECT parts FROM plans WHERE id = ?', [next.plan_id]))!.parts).toContain('harvest');
  // a plan that is not a trip's year never gets trip parts
  const plain = await plansOf(db, owner, clock).create({ name: 'Picnic', start_day: '2046-08-01' });
  expect(plain.trip).toBeNull();
  expect(plain.parts).not.toContain('after_trip');
});

it("another person in the house gets nothing of a hunting trip's plan page data", async () => {
  await gear();
  const made = await mine().create({ name: 'Fall hunt', parts: ['camping', 'hunting'], day: '2046-10-01', end_day: '2046-10-03' });
  const planId = made.years[0]!.plan_id;
  await mine().addGear(planId, { part: 'hunting', label: '.308 ammunition', caliber: '.308', quantity: 20 });
  await mine().addSeason(planId, { part: 'hunting', label: 'Deer secret-season', opens_on: '2046-09-15' });
  await mine().addHarvest(planId, { animal: 'Buck secret-buck', tag_number: 'secret-tag' });
  const mineView = JSON.stringify([await plansOf(db, owner, clock).get(planId), await mine().outdoor(planId), await mine().year(planId)]);
  expect(mineView).toMatch(/secret-buck/); // the person sees their own
  const other = await person('other');
  const theirs = plansOf(db, other, clock);
  const theirTrips = outdoorTrips(db, other, clock);
  for (const ask of [() => theirs.get(planId), () => theirTrips.outdoor(planId), () => theirTrips.year(planId), () => theirTrips.get(made.id), () => theirTrips.setYear(planId, { water: 'x' }),
    () => theirTrips.addHarvest(planId, { animal: 'x' }), () => theirTrips.menuToGroceries(planId)]) await expect(ask()).rejects.toEqual(problem(404));
  expect(await theirs.list()).toEqual([]);
  // what the house is shown: the trip's name and days, and no word of hunting
  const seen = JSON.stringify(await theirTrips.shared());
  expect(seen).toMatch(/Fall hunt/);
  expect(seen).not.toMatch(/secret|hunting|\.308|Buck|harvest/i);
  // and the owner's trip stays off the house's morning lines
  expect(JSON.stringify(await theirTrips.digestLines())).not.toMatch(/secret|Fall hunt/);
});
