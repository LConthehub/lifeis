/** Upkeep's ready-made sets: each job is a real job, fixed days come due on their day, and adding a set twice adds nothing. */
import { beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../src/db.ts';
import { LATEST, migrate } from '../src/migrations.ts';
import { readySets, upkeep, type Upkeep } from '../src/upkeep.ts';
import { memoryDb } from './memoryDb.ts';

let db: Db;
let owner: number;
let jobs: Upkeep;
let time = new Date(2046, 2, 5, 10, 0, 0);
const clock = () => time;

async function person(name: string): Promise<number> {
  return (await db.run("INSERT INTO users (username, password_hash, created_at) VALUES (?, 'x', 'now')", [name])).lastId;
}

beforeEach(async () => {
  db = memoryDb();
  expect(await migrate(db)).toBe(LATEST);
  owner = await person('owner');
  time = new Date(2046, 2, 5, 10, 0, 0);
  jobs = upkeep(db, owner, clock);
});

describe('the ready-made sets', () => {
  it('have a name, a line about them and jobs, with no job named twice', () => {
    const sets = readySets('2046-03-05');
    expect(sets.map((s) => s.slug)).toEqual(['house', 'car', 'papers', 'health', 'yard']);
    const names = sets.flatMap((s) => s.jobs.map((j) => j.name.toLowerCase()));
    expect(new Set(names).size).toBe(names.length);
    for (const s of sets) {
      expect(s.name && s.about && s.jobs.length > 0).toBeTruthy();
      for (const j of s.jobs) expect(j.every_n !== null || j.every_reading !== null, `${j.name} says how often`).toBe(true);
    }
  });

  it('every job in every set is a valid job to create, on a fresh database', async () => {
    let count = 0;
    for (const s of readySets('2046-03-05')) {
      for (const j of s.jobs) {
        const made = await jobs.create(j);
        expect(made.name).toBe(j.name);
        expect(made.kind).toBe(j.kind);
        // A renewal whose date is the person's to set asks for it; every other job has a day to be due on.
        if (j.first === 'yours') expect(made.due).toMatchObject({ state: 'unscheduled', needs_date: true });
        else expect(made.due.state).not.toBe('unscheduled');
        count++;
      }
    }
    expect(await jobs.list()).toHaveLength(count);
  });

  it('keeps pets, estimated taxes and lawn care out', () => {
    const names = readySets('2046-03-05').flatMap((s) => s.jobs.map((j) => j.name.toLowerCase())).join('|');
    expect(names).not.toMatch(/pet|vet|estimated|mow the|aerate|fertilize/);
  });

  it('fixed days come due on their day, the next one from today', async () => {
    const day = (set: string, name: string) => readySets('2046-03-05').find((s) => s.slug === set)!.jobs.find((j) => j.name === name)!.first_due;
    expect(day('papers', 'File federal and state taxes')).toBe('2046-04-15');
    expect(day('papers', 'Health insurance open enrollment')).toBe('2046-11-01');
    expect(day('papers', 'Use up the FSA')).toBe('2046-12-31');
    expect(day('house', 'Change smoke alarm batteries (spring)')).toBe('2046-03-08');
    expect(day('house', 'Change smoke alarm batteries (fall)')).toBe('2046-11-01');
    expect(day('house', 'Clean the gutters')).toBe('2046-04-15'); // spring or fall, whichever comes first
    expect(day('health', 'Flu shot')).toBe('2046-10-01');
    // The person's own day is left for them.
    for (const [set, name] of [['papers', 'Property tax'], ['papers', "Driver's license"], ['papers', 'Passport'], ['car', 'State inspection'], ['car', 'Car registration']] as const) {
      expect(day(set, name), name).toBeNull();
    }

    await jobs.addSet('papers');
    const taxes = (await jobs.list()).find((j) => j.name === 'File federal and state taxes')!;
    expect(taxes.due).toMatchObject({ next_day: '2046-04-15', days_left: 41 });
    // Done on time, a renewal stays on its day: next April 15.
    const done = await jobs.done(taxes.id, { day: '2046-03-20' });
    expect(done.job.due.next_day).toBe('2047-04-15');
  });

  it('count from today: the day itself is today, the day after is next year', () => {
    const taxes = (today: string) => readySets(today).find((s) => s.slug === 'papers')!.jobs[0]!.first_due;
    expect([taxes('2046-04-15'), taxes('2046-04-16'), taxes('2046-12-31')]).toEqual(['2046-04-15', '2047-04-15', '2047-04-15']);
  });
});

describe('when a set job is first due', () => {
  const find = (today: string, set: string, name: string) => readySets(today).find((s) => s.slug === set)!.jobs.find((j) => j.name === name)!;

  it('with no fixed day, one round from the day it is added, and it says how it was found', () => {
    expect(find('2046-03-05', 'house', 'Flush the water heater')).toMatchObject({ first_due: '2047-03-05', first: 'interval' });
    expect(find('2046-03-05', 'house', 'Change the furnace filter')).toMatchObject({ first_due: '2046-06-05', first: 'interval' });
    expect(find('2046-03-05', 'house', 'Test the smoke and CO alarms')).toMatchObject({ first_due: '2046-04-05', first: 'interval' });
    expect(find('2046-08-31', 'health', 'Dentist checkup')).toMatchObject({ first_due: '2047-02-28', first: 'interval' });
    expect(find('2046-03-05', 'health', 'Annual physical')).toMatchObject({ first_due: '2047-03-05', first: 'interval' });
  });

  it('a fixed day keeps its day, even when the job also has an interval', () => {
    expect(find('2046-03-05', 'house', 'Service the furnace')).toMatchObject({ first_due: '2046-10-01', first: 'day' });
    expect(find('2046-03-05', 'papers', 'File federal and state taxes')).toMatchObject({ first_due: '2046-04-15', first: 'day' });
    expect(find('2046-03-05', 'house', 'Clean the gutters')).toMatchObject({ first_due: '2046-04-15', first: 'day' });
  });

  it('a job that goes by a reading alone is left as it was, and one that has both still goes by time too', () => {
    expect(find('2046-03-05', 'car', 'Rotate the tires')).toMatchObject({ first_due: null, first: 'reading', every_n: null });
    expect(find('2046-03-05', 'car', 'Change the oil')).toMatchObject({ first_due: '2046-09-05', first: 'interval', every_reading: 5000 });
  });

  it('a renewal with no date is left for the person to set', () => {
    for (const name of ['Car registration', 'State inspection', 'Car insurance', 'Emissions test']) {
      expect(find('2046-03-05', 'car', name), name).toMatchObject({ first_due: null, first: 'yours' });
    }
    expect(find('2046-03-05', 'papers', 'Passport')).toMatchObject({ first_due: null, first: 'yours' });
  });

  it('adding every set puts nothing late and nothing due today, and the undated renewals ask for a date', async () => {
    for (const s of readySets('2046-03-05')) await jobs.addSet(s.slug);
    const all = await jobs.list();
    const pressing = all.filter((j) => j.due.state === 'overdue' || j.due.state === 'due');
    expect(pressing.map((j) => j.name)).toEqual([]);
    expect(all.find((j) => j.name === 'Flush the water heater')!.due).toMatchObject({ state: 'later', next_day: '2047-03-05', days_left: 365 });
    const asking = all.filter((j) => j.due.needs_date).map((j) => j.name).sort();
    expect(asking).toContain('Passport');
    expect(asking).toContain('Car registration');
    for (const j of all.filter((x) => x.due.needs_date)) expect(j.due).toMatchObject({ state: 'unscheduled', next_day: null, days_left: null });
    // Once the person gives it a date, it is an ordinary renewal.
    const passport = all.find((j) => j.name === 'Passport')!;
    const dated = await jobs.update(passport.id, { name: 'Passport', kind: 'renewal', every_n: 10, every_unit: 'year', first_due: '2046-03-15' });
    expect(dated.due).toMatchObject({ state: 'soon', days_left: 10 });
    expect(dated.due.needs_date).toBeUndefined();
  });

  it('doing a job sooner counts from the day it was done', async () => {
    await jobs.addSet('house');
    const heater = (await jobs.list()).find((j) => j.name === 'Flush the water heater')!;
    const done = await jobs.done(heater.id, { day: '2045-04-01' });
    expect(done.job.due).toMatchObject({ next_day: '2046-04-01', state: 'later', days_left: 27 });
  });
});

describe('adding a set', () => {
  it('adds each job, and says how many', async () => {
    const result = await jobs.addSet('yard');
    expect(result).toMatchObject({ set: 'Yard and seasons', added: 3, already: 0 });
    const list = await jobs.list();
    expect(list.map((j) => j.name).sort()).toEqual(['Clean the grill', 'Service the lawn mower', 'Store the hoses']);
    expect(list.find((j) => j.name === 'Service the lawn mower')!.due).toMatchObject({ next_day: '2046-03-15', days_left: 10, state: 'soon' });
  });

  it('pressed again adds nothing', async () => {
    const first = await jobs.addSet('house');
    const second = await jobs.addSet('house');
    expect([second.added, second.already]).toEqual([0, first.added]);
    expect(await jobs.list()).toHaveLength(first.added);
  });

  it('skips a job the person already has, whatever its case or spacing', async () => {
    await jobs.create({ name: '  change the FURNACE filter ', every_n: 1, every_unit: 'month' });
    const result = await jobs.addSet('house');
    expect(result.already_names).toEqual(['Change the furnace filter']);
    expect(result.added + 1).toBe(readySets('2046-03-05')[0]!.jobs.length);
    expect((await jobs.list()).filter((j) => j.name.toLowerCase().includes('furnace filter'))).toHaveLength(1);
  });

  it('adds only the jobs named, and counts only those', async () => {
    await jobs.create({ name: 'Passport', kind: 'renewal', every_n: 10, every_unit: 'year' });
    const result = await jobs.addSet('papers', ['Passport', 'Property tax', 'Nothing of the kind']);
    expect([result.added_names, result.already_names]).toEqual([['Property tax'], ['Passport']]);
    expect((await jobs.list()).map((j) => j.name).sort()).toEqual(['Passport', 'Property tax']);
  });

  it('is for the person asking: another person gets their own', async () => {
    await jobs.addSet('yard');
    const other = upkeep(db, await person('partner'), clock);
    expect((await other.addSet('yard')).added).toBe(3);
  });

  it('says so when there is no such set', async () => {
    await expect(jobs.addSet('boat')).rejects.toMatchObject({ name: 'Problem', status: 404 });
  });
});
