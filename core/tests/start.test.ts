/**
 * The two-minute start: each step's effect through the real core functions, nothing added twice, the examples
 * taken back exactly as they were made, and who counts as brand new.
 */
import { beforeEach, expect, it } from 'vitest';
import type { Db } from '../src/db.ts';
import { inventory } from '../src/inventory.ts';
import { calendar } from '../src/calendar.ts';
import { home } from '../src/home.ts';
import { kitchen } from '../src/kitchen.ts';
import { life } from '../src/life.ts';
import { migrate } from '../src/migrations.ts';
import { pets } from '../src/pets.ts';
import { reminders } from '../src/reminders.ts';
import { start, type StartState } from '../src/start.ts';
import { upkeep } from '../src/upkeep.ts';
import { memoryDb } from './memoryDb.ts';

let db: Db;
let owner: number;
const clock = Object.assign(() => new Date('2026-11-22T12:00:00Z'), { today: () => '2026-11-22' });
const mine = () => start(db, owner, clock);
const user = async (name: string) => (await db.run("INSERT INTO users (username, password_hash, created_at) VALUES (?, 'x', 'now')", [name])).lastId;

beforeEach(async () => {
  db = memoryDb();
  await migrate(db);
  owner = await user('owner');
});

it('only a brand-new household is asked, and anyone else keeps the long checklist', async () => {
  expect((await mine().state()).first_run).toBe('guide');
  expect(await mine().brandNew()).toBe(true);
  // Anything of theirs, in any part, and they are not new.
  await kitchen(db, owner, clock).createRecipe({ title: 'Toast' });
  expect(await mine().brandNew()).toBe(false);
  expect((await mine().state()).first_run).toBe('checklist');
  expect((await mine().state()).card).toBeNull();
  await expect(mine().people({ children: ['Mia'] })).rejects.toMatchObject({ status: 409 });
  expect(await upkeep(db, owner, clock).members()).toEqual([]);

  // Answering the question the old way means nothing more is asked.
  const other = await user('other');
  await life(db, other, clock).saveProfile([]);
  expect((await start(db, other, clock).state()).first_run).toBe('quiet');
  // Each part counts: a pet alone, or a calendar date alone, is not a new household.
  const third = await user('third');
  await pets(db, third, clock).create({ name: 'Rex' });
  expect(await start(db, third, clock).brandNew()).toBe(false);
  const fourth = await user('fourth');
  await db.run("INSERT INTO events (owner_id, title, day, created_at, updated_at) VALUES (?, 'Dentist', '2026-12-01', 'now', 'now')", [fourth]);
  expect(await start(db, fourth, clock).brandNew()).toBe(false);
});

it('step 1: children become household members, pets are made, adults are only named, and doing it twice adds nothing', async () => {
  const before = (await db.get<{ n: number }>('SELECT COUNT(*) AS n FROM users'))!.n;
  const said = { adults: ['Sam', ' Alex '], children: ['Mia', 'Leo', 'mia'], pets: [{ kind: 'dog', name: 'Biscuit' }, { kind: 'cat', name: 'Pepper' }, { kind: 'other', name: 'Goldie' }, { kind: 'dog', name: '' }] };
  const state = await mine().people(said);
  expect(state.step).toBe(2);
  expect(state.answers.adults).toEqual(['Sam', 'Alex']);
  expect((await upkeep(db, owner, clock).members()).map((m) => m.name)).toEqual(['Leo', 'Mia']);
  expect((await pets(db, owner, clock).list()).map((p) => [p.name, p.species])).toEqual([['Biscuit', 'dog'], ['Goldie', null], ['Pepper', 'cat']]);
  expect((await db.get<{ n: number }>('SELECT COUNT(*) AS n FROM users'))!.n).toBe(before); // the adults have no sign-ins

  await mine().people(said);
  expect((await upkeep(db, owner, clock).members()).length).toBe(2);
  expect((await pets(db, owner, clock).list()).length).toBe(3);

  // Everything is optional.
  const quiet = await user('quiet');
  const empty = await start(db, quiet, clock).people({});
  expect([empty.step, (await upkeep(db, quiet, clock).members()).length, (await pets(db, quiet, clock).list()).length]).toEqual([2, 0, 0]);
  await expect(mine().people({ children: 'Mia' })).rejects.toMatchObject({ status: 400 });
  await expect(mine().people({ pets: [{ kind: 'dragon', name: 'Smaug' }] })).rejects.toMatchObject({ status: 400 });
});

it('step 2: saves the profile life.ts keeps, so sections show as they always have', async () => {
  const state = await mine().interests({ wants: ['meals', 'things', 'house'], hobbies: ['sewing'] });
  // Hobbies only count when "projects and hobbies" is chosen.
  expect(state.answers.hobbies).toEqual([]);
  expect(state.step).toBe(3);
  const profile = await life(db, owner, clock).getProfile();
  expect(profile.areas).toEqual(['eating', 'keeping']);
  expect(profile.sections).toEqual(['eating', 'keeping']);

  const more = await mine().interests({ wants: ['meals', 'money', 'projects'], hobbies: ['sewing'] });
  expect(more.step).toBe(4); // no house: the upkeep step is not shown
  const next = await life(db, owner, clock).getProfile();
  expect(next.areas).toEqual(['eating', 'making', 'spending', 'sewing']);
  expect(next.sections).toEqual(['eating', 'keeping', 'making', 'spending']);
  expect((await inventory(db, owner, clock).listKinds()).map((k) => k.name)).toEqual(['Fabric', 'Notions', 'Sewing patterns']); // the hobby's ready-made kinds

  await expect(mine().interests({ wants: ['alchemy'] })).rejects.toMatchObject({ status: 400 });
  await expect(mine().interests({ wants: ['meals'], hobbies: ['alchemy'] })).rejects.toMatchObject({ status: 400 });
  // Nothing chosen shows everything, as skipping does.
  await mine().interests({ wants: [] });
  expect((await life(db, owner, clock).getProfile()).sections.length).toBe(6);
});

it('step 3: adds the ready-made sets chosen, once, and a car brings the vehicle kinds', async () => {
  await mine().interests({ wants: ['house'] });
  const first = await mine().upkeep({ sets: ['house'], has_car: false });
  const jobs = upkeep(db, owner, clock);
  const house = jobs.sets().find((s) => s.slug === 'house')!;
  expect((await jobs.list()).length).toBe(house.jobs.length);
  expect(first.options.sets.find((s) => s.slug === 'house')!.jobs).toBe(house.jobs.length);
  expect((await inventory(db, owner, clock).listKinds()).some((k) => k.name === 'Vehicles')).toBe(false);

  await mine().upkeep({ sets: ['house'], has_car: false });
  expect((await jobs.list()).length).toBe(house.jobs.length); // nothing twice

  await mine().upkeep({ sets: ['house', 'car'], has_car: true });
  const car = jobs.sets().find((s) => s.slug === 'car')!;
  expect((await jobs.list()).length).toBe(house.jobs.length + car.jobs.length);
  expect((await inventory(db, owner, clock).listKinds()).some((k) => k.name === 'Vehicles')).toBe(true);
  await expect(mine().upkeep({ sets: ['moon'] })).rejects.toMatchObject({ status: 404 });
});

const titles = async (who = owner) => (await kitchen(db, who, clock).listRecipes()).map((r) => r.title);

it('step 4: three real recipes, three dinners and six grocery lines, made once', async () => {
  const state = await mine().examples(true);
  const k = kitchen(db, owner, clock);
  expect(await titles()).toEqual(['Baked macaroni and cheese', 'Sheet-pan sausage and vegetables', 'Slow-cooker beef chili']);
  for (const r of await k.listRecipes()) {
    const whole = await k.getRecipe(r.id);
    expect(whole.ingredients.length).toBeGreaterThanOrEqual(8);
    expect(whole.steps.length).toBeGreaterThanOrEqual(4);
    expect(whole.tags).toContain('example');
  }
  const week = await k.listPlan('2026-11-22', 3);
  expect(week.map((m) => [m.day, m.meal, m.recipe_title])).toEqual([
    ['2026-11-22', 'dinner', 'Sheet-pan sausage and vegetables'], ['2026-11-23', 'dinner', 'Slow-cooker beef chili'], ['2026-11-24', 'dinner', 'Baked macaroni and cheese']]);
  expect((await k.listGrocery()).length).toBe(6);
  expect(state.card).toEqual({ kind: 'finish', step: 4 }); // not finished yet
  expect(state.answers.sample).toBe(true);

  await mine().examples(true);
  expect(await titles()).toHaveLength(3);
  expect((await k.listGrocery()).length).toBe(6);
  expect((await k.listPlan('2026-11-22', 3)).length).toBe(3);
});

it('clearing removes exactly what was made, and never the person\'s own recipe of the same name', async () => {
  const k = kitchen(db, owner, clock);
  await mine().people({}); // begun: from here the start is theirs to finish
  const own = await k.createRecipe({ title: 'Baked macaroni and cheese', ingredients_text: '1 box macaroni', steps_text: 'Boil it.' });
  await k.addGrocery({ label: '1 gallon whole milk' }); // already on their list: the example line joins it, so it is not an example
  const mineBefore = (await k.listGrocery()).map((g) => [g.id, g.label, g.quantity]);
  await mine().examples(true);
  await mine().finish();
  expect(await titles()).toHaveLength(4);
  const made = (await k.listGrocery()).length - mineBefore.length;

  const cleared = (await mine().clearExamples());
  expect(cleared.removed).toEqual({ recipes: 3, meals: 3, groceries: made, things: 3, jobs: 2, events: 2 });
  expect(made).toBeGreaterThanOrEqual(5);
  expect(cleared.kept).toEqual([]);
  expect(cleared.message).toContain(`Cleared the examples: 3 recipes, 3 dinners, ${made} grocery lines, 3 things, 2 upkeep jobs and 2 calendar dates.`);
  expect(await titles()).toEqual(['Baked macaroni and cheese']);
  expect((await k.getRecipe(own.id)).ingredients_text).toBe('1 box macaroni');
  expect((await k.listGrocery()).map((g) => [g.id, g.label, g.quantity])).toEqual(mineBefore);
  expect((await k.listPlan('2026-11-22', 7)).length).toBe(0);
  expect(cleared.state.card).toMatchObject({ kind: 'started', examples: null });
  // Again: nothing left to do.
  expect((await mine().clearExamples()).message).toBe('There are no examples to clear.');
});

it('an example changed since is kept, and the person is told', async () => {
  await mine().examples(true);
  await mine().finish();
  const k = kitchen(db, owner, clock);
  const mac = (async () => (await k.listRecipes()).find((r) => r.title === "Baked macaroni and cheese")!.id)();
  const edited = await k.getRecipe(await mac);
  await k.updateRecipe(edited.id, { title: edited.title, servings: 8, ingredients_text: edited.ingredients_text, steps_text: edited.steps_text, tags: edited.tags });
  // A grocery line the person changed stays too.
  const line = (await k.listGrocery()).find((g) => g.label.includes('milk'))!;
  await db.run('UPDATE grocery SET quantity = 2 WHERE id = ?', [line.id]);
  // And one example meal the person already cooked.
  const meal = (await k.listPlan('2026-11-22', 1))[0]!;
  await k.cooked(meal.id);
  expect((await mine().state()).card).toMatchObject({ kind: 'started', examples: { recipes: 3, meals: 3, groceries: 6 } });

  const cleared = await mine().clearExamples();
  expect(cleared.removed).toEqual({ recipes: 1, meals: 2, groceries: 5, things: 3, jobs: 2, events: 2 });
  // Changed: kept. Cooked, so its dinner stays: the recipe it is for stays too.
  expect(cleared.kept).toEqual([{ title: 'Sheet-pan sausage and vegetables', why: 'it is in one of your plans' }, { title: 'Baked macaroni and cheese', why: 'you have changed it' }]);
  expect(cleared.message).toContain('Kept “Baked macaroni and cheese” because you have changed it.');
  expect(await titles()).toEqual(['Baked macaroni and cheese', 'Sheet-pan sausage and vegetables']);
  expect((await k.getRecipe(await mac)).servings).toBe(8);
  expect((await k.listGrocery()).map((g) => g.id)).toEqual([line.id]);
  expect((await k.listPlan('2026-11-22', 1)).map((m) => m.id)).toEqual([meal.id]); // cooked: theirs now

  // The kept ones are theirs from now on: nothing remains on offer to clear.
  expect((await mine().state()).card).toMatchObject({ kind: 'started', examples: null });
});

it('an example recipe the person has put in their own week is kept', async () => {
  await mine().examples(true);
  await mine().finish();
  const k = kitchen(db, owner, clock);
  const chili = (await k.listRecipes()).find((r) => r.title === 'Slow-cooker beef chili')!;
  await k.addPlan({ day: '2026-11-30', meal: 'dinner', recipe_id: chili.id });
  const cleared = await mine().clearExamples();
  expect(cleared.kept).toEqual([{ title: 'Slow-cooker beef chili', why: 'it is in one of your plans' }]);
  expect((await k.listPlan('2026-11-30', 1)).map((m) => m.recipe_title)).toEqual(['Slow-cooker beef chili']);
});

it('turning the examples off on the step takes back those still untouched', async () => {
  await mine().examples(true);
  const state = await mine().examples(false);
  expect(await titles()).toEqual([]);
  expect(state.answers.sample).toBe(false);
});

it('another person is untouched', async () => {
  const other = await user('other');
  const theirs = kitchen(db, other, clock);
  await theirs.createRecipe({ title: 'Slow-cooker beef chili', ingredients_text: '1 can beans', steps_text: 'Heat.' });
  await mine().examples(true);
  await mine().finish();
  await mine().clearExamples();
  expect(await titles(other)).toEqual(['Slow-cooker beef chili']);
  expect((await start(db, other, clock).state()).first_run).toBe('checklist'); // they have a recipe: not new
  const fresh = await user('fresh');
  expect((await start(db, fresh, clock).state()).status).toBe('new');
});

it('closing part way keeps the work and leaves a "finish setting up" card at that step, until finished or put away', async () => {
  await mine().people({ children: ['Mia'] });
  const closed = await mine().close(2);
  expect(closed.first_run).toBe('quiet'); // not shown again on its own
  expect(closed.card).toEqual({ kind: 'finish', step: 2 });
  expect((await upkeep(db, owner, clock).members()).length).toBe(1);
  // It can be picked up where it was left.
  await mine().interests({ wants: ['meals'] });
  expect((await mine().state()).card).toEqual({ kind: 'finish', step: 4 });
  expect((await mine().dismiss()).card).toBeNull();
  await expect(mine().interests({ wants: ['meals'] })).rejects.toMatchObject({ status: 409 });
});

const keys = (state: StartState) => (state.card && state.card.kind === 'started' ? state.card.steps.map((s) => [s.key, s.done]) : []);

it('finishing gives a sentence and a first page, and a Start here card whose steps tick themselves when the real thing is done', async () => {
  await mine().people({ children: ['Mia', 'Leo'], pets: [{ kind: 'dog', name: 'Biscuit' }] });
  await mine().interests({ wants: ['meals', 'things', 'house', 'money'] });
  await mine().upkeep({ sets: ['house'], has_car: true });
  await mine().examples(true);
  const done = await mine().finish();
  expect(done.summary).toBe('You’re set up with 2 people added for chores, 1 pet, 14 upkeep jobs and 3 example recipes with this week’s dinners, and the parts you asked for are showing.');
  expect(done.landing).toEqual({ to: '/recipes', label: 'Open your recipes' });
  // Three to five steps, about two minutes each, none done: the examples do not count.
  expect(keys(done)).toEqual([['recipe', false], ['plan', false], ['room', false], ['chart', false], ['car', false]]);
  expect(done.card).toMatchObject({ steps: [{ minutes: 2 }, { minutes: 2 }, { minutes: 2 }, { minutes: 2 }, { minutes: 2 }] });
  await expect(mine().finish()).rejects.toMatchObject({ status: 409 });

  const k = kitchen(db, owner, clock);
  const own = await k.createRecipe({ title: 'My own', ingredients_text: '1 egg', steps_text: 'Fry.' });
  expect(keys(await mine().state())).toEqual([['recipe', true], ['plan', false], ['room', false], ['chart', false], ['car', false]]);
  const things = inventory(db, owner, clock);
  const kind = (await things.listKinds()).find((x) => x.name === 'Vehicles')!;
  const place = (await things.createPlace({ name: 'Garage' })).at(-1)!.id;
  await things.createItem({ kind_id: kind.id, name: 'Our car', place_id: place, values: {} });
  expect(keys(await mine().state())).toEqual([['recipe', true], ['plan', false], ['room', true], ['chart', false], ['car', false]]); // the car lacks its make, model and year
  await upkeep(db, owner, clock).create({ name: 'Tidy your room', kind: 'chore', points: 2, every_n: 1, every_unit: 'week' });
  await k.addPlan({ day: '2026-11-25', meal: 'dinner', recipe_id: own.id });
  expect(keys(await mine().state())).toEqual([['recipe', true], ['plan', true], ['room', true], ['chart', true], ['car', false]]);
  // A step once done stays ticked, even if the thing is taken away again.
  await db.run('DELETE FROM meal_plan WHERE owner_id = ? AND recipe_id = ?', [owner, own.id]);
  await k.deleteRecipe(own.id);
  expect(keys(await mine().state())).toEqual([['recipe', true], ['plan', true], ['room', true], ['chart', true], ['car', false]]);

  // Put away: the steps go, the examples stay on offer.
  expect((await mine().dismiss()).card).toMatchObject({ kind: 'started', steps: [], examples: { recipes: 3 } });
  await mine().clearExamples();
  expect((await mine().state()).card).toBeNull();
});

it('the card goes once every step is done and no examples are left, and a short list is padded to three', async () => {
  await mine().interests({ wants: ['meals'] });
  const done = await mine().finish();
  expect(keys(done)).toEqual([['recipe', false], ['plan', false], ['backup', false]]);
  const k = kitchen(db, owner, clock);
  const r = await k.createRecipe({ title: 'Mine', ingredients_text: '1 egg', steps_text: 'Fry.' });
  await k.addPlan({ day: '2026-11-25', meal: 'dinner', recipe_id: r.id });
  await reminders(db, owner, clock).copyMade();
  expect((await mine().state()).card).toBeNull();
});

it('examples go only in the parts picked, are marked Example, and clearing takes only them', async () => {
  await mine().interests({ wants: ['things', 'calendar'] });
  const state = await mine().examples(true);
  const things = inventory(db, owner, clock);
  const names = (await things.listItems()).map((t) => t.name).sort();
  expect(names).toEqual(['Example: Box of light bulbs', 'Example: Cordless drill', 'Example: Step stool']);
  expect((await calendar(db, owner, clock).between('2026-11-22', 14)).map((e) => e.title)).toEqual(expect.arrayContaining(['Example: Dentist visit']));
  expect(await titles()).toEqual([]); // meals were not picked
  expect(await upkeep(db, owner, clock).list()).toEqual([]); // nor the house
  expect(state.answers.sample).toBe(true);

  // Their own thing, and their own date, next to the examples.
  const kind = (await things.listKinds())[0]!;
  const mineThing = await things.createItem({ kind_id: kind.id, name: 'My lamp' });
  await calendar(db, owner, clock).createEvent({ title: 'Piano lesson', day: '2026-11-25' });
  // One example is changed: it becomes theirs and is told about.
  const stool = (await things.listItems()).find((t) => t.name === 'Example: Step stool')!;
  await things.updateItem(stool.id, { name: 'Example: Step stool', quantity: 2 });
  await mine().finish();
  const cleared = await mine().clearExamples();
  expect(cleared.removed).toEqual({ recipes: 0, meals: 0, groceries: 0, things: 2, jobs: 0, events: 2 });
  expect(cleared.kept).toEqual([{ title: 'Example: Step stool', why: 'you have changed it' }]);
  expect((await things.listItems()).map((t) => t.name).sort()).toEqual(['Example: Step stool', 'My lamp']);
  expect((await things.getItem(mineThing.id)).name).toBe('My lamp');
  expect((await calendar(db, owner, clock).between('2026-11-25', 1)).map((e) => e.title)).toEqual(['Piano lesson']);
});

it('the first question sets the Start here card and what Home opens on', async () => {
  await expect(mine().problem('boredom')).rejects.toMatchObject({ status: 400 });
  const asked = await mine().problem('meals');
  expect(asked.answers.problem).toBe('meals');
  await mine().interests({ wants: ['meals', 'things', 'house'] });
  const done = await mine().finish();
  expect((done.card as { steps: { key: string }[] }).steps[0]!.key).toBe('recipe');
  expect((await home(db, owner, clock).summary()).first).toBe('kitchen');

  const second = await user('second');
  const s = start(db, second, clock);
  await s.problem('clutter');
  await s.interests({ wants: ['meals', 'things', 'house'] });
  expect((await s.finish().then((d) => (d.card as { steps: { key: string }[] }).steps[0]!.key))).toBe('room');
  expect((await home(db, second, clock).summary()).first).toBe('things');

  // A different answer opens a different card; a card that is not showing, or no answer, opens on none.
  const third = await user('third');
  await start(db, third, clock).problem('calendar');
  await start(db, third, clock).interests({ wants: ['calendar'] });
  expect((await home(db, third, clock).summary()).first).toBe('days');
  const fourth = await user('fourth');
  await start(db, fourth, clock).problem('bills');
  await start(db, fourth, clock).interests({ wants: ['meals'] }); // no upkeep section, so no card for bills
  expect((await home(db, fourth, clock).summary()).first).toBeNull();
  const fifth = await user('fifth');
  await start(db, fifth, clock).problem('');
  expect((await start(db, fifth, clock).state()).answers.problem).toBe('none');
  expect((await home(db, fifth, clock).summary()).first).toBeNull();
});

const on = (day: string) => Object.assign(() => new Date(`${day}T12:00:00Z`), { today: () => day });
const MONDAYS = ['2026-11-23', '2026-11-30', '2026-12-07', '2026-12-14'];
const weekLine = async (day: string) => (await reminders(db, owner, on(day)).digest()).lines.find((l) => l.kind === 'week');

it('the weekly question goes only to someone with a way to be reminded, on Mondays, with three picks', async () => {
  await mine().interests({ wants: ['meals'] });
  await mine().finish();
  expect(await weekLine(MONDAYS[0]!)).toBeUndefined(); // no channel: off
  expect(await start(db, owner, on(MONDAYS[0]!)).weekly()).toMatchObject({ channel: false, on: false, active: false });

  await reminders(db, owner, clock).save({ phone: true });
  const first = await weekLine(MONDAYS[0]!);
  expect(first?.title).toBe('What do you want to get done this week?');
  expect(first?.detail?.split(' · ')).toHaveLength(3);
  expect(await weekLine('2026-11-24')).toBeUndefined(); // not a Monday

  // Email counts as a way to be reminded; a person with none does not get it.
  const other = await user('other');
  await start(db, other, clock).finishNow();
  expect((await reminders(db, other, on(MONDAYS[0]!)).digest()).lines.find((l) => l.kind === 'week')).toBeUndefined();
  await reminders(db, other, clock).save({ email: true });
  expect((await reminders(db, other, on(MONDAYS[0]!)).digest()).lines.find((l) => l.kind === 'week')).toBeDefined();
});

it('after the second week the weekly question asks once whether to keep it, and stop means stop', async () => {
  await mine().finishNow();
  await reminders(db, owner, clock).save({ phone: true });
  const sendOn = async (day: string) => {
    const r = reminders(db, owner, on(day));
    const d = await r.digest();
    await r.markSent(day, d);
    return d.lines.find((l) => l.kind === 'week');
  };
  expect((await sendOn(MONDAYS[0]!))?.title).toBe('What do you want to get done this week?');
  expect(await sendOn(MONDAYS[0]!)).toBeUndefined(); // once a week
  expect((await sendOn(MONDAYS[1]!))?.title).toBe('What do you want to get done this week?');
  expect((await start(db, owner, on(MONDAYS[1]!)).weekly())).toMatchObject({ on: true, active: true, ask: false });
  const asked = await sendOn(MONDAYS[2]!);
  expect(asked?.title).toBe('Keep the weekly question?');
  expect((await start(db, owner, on(MONDAYS[2]!)).weekly())).toMatchObject({ ask: true, picks: [] });
  // Asked once: the next Monday it is the question again.
  expect((await sendOn(MONDAYS[3]!))?.title).toBe('What do you want to get done this week?');

  expect((await start(db, owner, on(MONDAYS[3]!)).weeklyAnswer('stop'))).toMatchObject({ on: false, ask: false });
  expect(await weekLine('2026-12-21')).toBeUndefined();
  await expect(start(db, owner, clock).weeklyAnswer('maybe')).rejects.toMatchObject({ status: 400 });
  expect((await start(db, owner, on('2026-12-21')).weeklyAnswer('keep'))).toMatchObject({ on: true });
  expect(await weekLine('2026-12-21')).toBeDefined();
});

it('"set up now" finishes from any step, keeps what was chosen, and shows everything if nothing was asked', async () => {
  await mine().people({ children: ['Mia'] });
  const done = await mine().finishNow();
  expect(done.status).toBe('finished');
  expect((await life(db, owner, clock).getProfile()).areas).toEqual([]); // not asked: everything shows
  expect((await upkeep(db, owner, clock).members()).length).toBe(1);

  const second = await user('second');
  const s = start(db, second, clock);
  await s.interests({ wants: ['meals'] });
  await s.finishNow();
  expect((await life(db, second, clock).getProfile()).areas).toEqual(['eating']); // what was chosen stays
});

it('"skip, show me everything" ends the start with no card, and keeps what was done', async () => {
  await mine().people({ children: ['Mia'] });
  const skipped = await mine().skip();
  expect([skipped.status, skipped.card, skipped.first_run]).toEqual(['skipped', null, 'quiet']);
  expect((await upkeep(db, owner, clock).members()).length).toBe(1);
  await expect(mine().people({ children: ['Leo'] })).rejects.toMatchObject({ status: 409 });

  const second = await user('second');
  expect((await start(db, second, clock).skip()).status).toBe('skipped'); // from the very first step
  expect((await kitchen(db, second, clock).listRecipes()).length).toBe(0); // and no sample
});
