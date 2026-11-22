/** Upkeep's chore chart (the days each chore falls due in a week) and the allowance tally, from a fixed clock. */
import { beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../src/db.ts';
import { LATEST, migrate } from '../src/migrations.ts';
import { daysDueIn, periodRange, upkeep, weekStartOf, type Upkeep } from '../src/upkeep.ts';
import { memoryDb } from './memoryDb.ts';

let db: Db;
let owner: number;
let jobs: Upkeep;
// Wednesday, February 28, 2046: a Sunday-to-Saturday week here runs Feb 25 to Mar 3, across the month's end.
let time = new Date(2046, 1, 28, 10, 0, 0);
const clock = () => time;

async function person(name: string): Promise<number> {
  return (await db.run("INSERT INTO users (username, password_hash, created_at) VALUES (?, 'x', 'now')", [name])).lastId;
}

beforeEach(async () => {
  db = memoryDb();
  expect(await migrate(db)).toBe(LATEST);
  owner = await person('owner');
  time = new Date(2046, 1, 28, 10, 0, 0);
  jobs = upkeep(db, owner, clock);
});

const WEEK = ['2046-02-25', '2046-02-26', '2046-02-27', '2046-02-28', '2046-03-01', '2046-03-02', '2046-03-03'];

describe('which days of a week a kind of interval falls due', () => {
  it('weeks start on Sunday, or on Monday when asked', () => {
    expect([weekStartOf('2046-02-28'), weekStartOf('2046-02-25'), weekStartOf('2046-03-03'), weekStartOf('2046-03-04')]).toEqual(['2046-02-25', '2046-02-25', '2046-02-25', '2046-03-04']);
    expect([weekStartOf('2046-02-28', 'monday'), weekStartOf('2046-02-25', 'monday'), weekStartOf('2046-03-05', 'monday')]).toEqual(['2046-02-26', '2046-02-19', '2046-03-05']);
  });

  it('daily is every day, every other day keeps its rhythm, weekly is its weekday', () => {
    expect(daysDueIn('2046-02-28', 1, 'day', WEEK[0]!, WEEK[6]!)).toEqual(WEEK);
    expect(daysDueIn('2046-02-28', 2, 'day', WEEK[0]!, WEEK[6]!)).toEqual(['2046-02-26', '2046-02-28', '2046-03-02']);
    expect(daysDueIn('2046-03-03', 1, 'week', WEEK[0]!, WEEK[6]!)).toEqual(['2046-03-03']);
    expect(daysDueIn('2046-03-10', 1, 'week', WEEK[0]!, WEEK[6]!)).toEqual(['2046-03-03']);
  });

  it('every two weeks falls in alternate weeks; monthly on its date, across the month boundary', () => {
    expect(daysDueIn('2046-03-07', 2, 'week', WEEK[0]!, WEEK[6]!)).toEqual([]);
    expect(daysDueIn('2046-03-07', 2, 'week', '2046-03-04', '2046-03-10')).toEqual(['2046-03-07']);
    expect(daysDueIn('2046-03-03', 1, 'month', WEEK[0]!, WEEK[6]!)).toEqual(['2046-03-03']);
    expect(daysDueIn('2046-03-03', 1, 'month', '2046-03-04', '2046-03-10')).toEqual([]);
    // From the 31st, a short month is its last day.
    expect(daysDueIn('2046-03-31', 1, 'month', WEEK[0]!, WEEK[6]!)).toEqual(['2046-02-28']);
    expect(daysDueIn('2046-03-03', 1, 'year', WEEK[0]!, WEEK[6]!)).toEqual(['2046-03-03']);
    expect(daysDueIn('2046-03-03', 1, 'year', '2046-03-04', '2046-03-10')).toEqual([]);
  });
});

describe('the chart for a week', () => {
  async function chore(name: string, over: Record<string, unknown>) {
    return jobs.create({ name, kind: 'chore', points: 2, ...over });
  }

  it('lists each chore under who has it, with the days from the due logic, Sunday to Saturday', async () => {
    await jobs.addMember('Mia');
    const leo = (await jobs.addMember('Leo')).find((m) => m.name === 'Leo')!;
    const mine = { assigned_member: leo.id };
    await chore('Dishes', { ...mine, every_n: 1, every_unit: 'day', last_done: { day: '2046-02-27' } });
    await chore('Feed the fish', { ...mine, every_n: 2, every_unit: 'day', last_done: { day: '2046-02-26' } });
    await chore('Trash', { ...mine, every_n: 1, every_unit: 'week', last_done: { day: '2046-02-24' } });
    await chore('Mop', { ...mine, every_n: 2, every_unit: 'week', last_done: { day: '2046-02-21' } });
    await chore('Wash the car', { ...mine, every_n: 1, every_unit: 'month', last_done: { day: '2046-02-03' } });
    await chore('Late sweep', { ...mine, every_n: 1, every_unit: 'week', last_done: { day: '2046-02-10' } });
    await chore('Tidy up', { ...mine, every_n: 1, every_unit: 'week' });
    await chore('Water plants', { every_n: 1, every_unit: 'day', last_done: { day: '2046-02-27' } });

    const week = await jobs.chart('this', 'sunday');
    expect(week.week_start).toBe('2046-02-25');
    expect(week.days).toEqual(WEEK);
    expect(week.groups.map((g) => g.who)).toEqual(['Leo', 'Mia', null]);
    const leos = new Map(week.groups[0]!.chores.map((c) => [c.name, c]));
    expect(leos.get('Dishes')).toMatchObject({ days: WEEK, anytime: false, points: 2 });
    expect(leos.get('Feed the fish')!.days).toEqual(['2046-02-26', '2046-02-28', '2046-03-02']);
    expect(leos.get('Trash')!.days).toEqual(['2046-03-03']);
    expect(leos.has('Mop')).toBe(false); // its week is next week
    expect(leos.get('Wash the car')!.days).toEqual(['2046-03-03']);
    // Late is due now, and keeps its weekly rhythm from today.
    expect(leos.get('Late sweep')!.days).toEqual(['2046-02-28']);
    // Never done, no day of its own: one box for the week.
    expect(leos.get('Tidy up')).toMatchObject({ days: [], anytime: true });
    expect(week.groups[1]!.chores).toEqual([]);
    expect(week.groups[2]!.chores.map((c) => c.name)).toEqual(['Water plants']);

    const next = await jobs.chart('next', 'sunday');
    expect(next.week_start).toBe('2046-03-04');
    const nextLeo = new Map(next.groups[0]!.chores.map((c) => [c.name, c]));
    expect(nextLeo.get('Mop')!.days).toEqual(['2046-03-07']);
    expect(nextLeo.get('Trash')!.days).toEqual(['2046-03-10']);
    expect(nextLeo.has('Wash the car')).toBe(false);
    expect(nextLeo.get('Dishes')!.days).toHaveLength(7);

    const monday = await jobs.chart('this', 'monday');
    expect([monday.week_start, monday.days[6]]).toEqual(['2046-02-26', '2046-03-04']);
  });

  it('leaves out jobs that are not chores, and says no to a week that does not exist', async () => {
    await jobs.create({ name: 'Filter', every_n: 1, every_unit: 'month' });
    expect((await jobs.chart(null, null)).groups).toEqual([]);
    await expect(jobs.chart('soon', null)).rejects.toMatchObject({ status: 400 });
    await expect(jobs.chart(null, 'friday')).rejects.toMatchObject({ status: 400 });
  });

  it('carries what a point is worth', async () => {
    expect((await jobs.chart(null, null)).point_cents).toBeNull();
    await jobs.setPointValue(50);
    expect((await jobs.chart(null, null)).point_cents).toBe(50);
  });
});

describe('the allowance tally', () => {
  let leo: number;
  let mia: number;
  async function setUp() {
    const members = await jobs.addMember('Leo');
    leo = members[0]!.id;
    mia = (await jobs.addMember('Mia')).find((m) => m.name === 'Mia')!.id;
    await jobs.setPointValue(50);
    const a = await jobs.create({ name: 'Dishes', kind: 'chore', points: 3, every_n: 1, every_unit: 'day' });
    const b = await jobs.create({ name: 'Mop', kind: 'chore', points: 5, every_n: 1, every_unit: 'week' });
    const did = (id: number, day: string, by: number) => jobs.done(id, { day, by_member: by });
    await did(a.id, '2046-01-30', leo);
    await did(b.id, '2046-02-03', leo);
    await did(a.id, '2046-02-24', leo);
    await did(b.id, '2046-02-26', leo);
    await did(a.id, '2046-02-27', leo);
    await did(a.id, '2046-02-28', leo);
    await did(b.id, '2046-02-26', mia);
    // Done by the person themselves: not a child's allowance.
    await jobs.done(a.id, { day: '2046-02-27' });
  }
  const leosOf = async (period: string, extra: Record<string, string> = {}) => (await jobs.allowance({ period, ...extra })).people.find((p) => p.name === 'Leo')!;

  it('the periods run from the day, Sunday to Saturday, calendar months, or a range', () => {
    expect(periodRange('this_week', '2046-02-28')).toEqual({ from: '2046-02-25', to: '2046-03-03' });
    expect(periodRange('last_week', '2046-02-28')).toEqual({ from: '2046-02-18', to: '2046-02-24' });
    expect(periodRange('this_month', '2046-02-28')).toEqual({ from: '2046-02-01', to: '2046-02-28' });
    expect(periodRange('last_month', '2046-03-05')).toEqual({ from: '2046-02-01', to: '2046-02-28' });
    expect(periodRange('last_month', '2046-01-15')).toEqual({ from: '2045-12-01', to: '2045-12-31' });
    expect(periodRange('custom', '2046-02-28', 'sunday', '2046-02-10', '2046-02-12')).toEqual({ from: '2046-02-10', to: '2046-02-12' });
    expect(() => periodRange('custom', '2046-02-28', 'sunday', '2046-02-12', '2046-02-10')).toThrow();
    expect(() => periodRange('custom', '2046-02-28')).toThrow();
  });

  it('counts each child\'s points over each period, in whole cents', async () => {
    await setUp();
    expect(await leosOf('this_week')).toMatchObject({ points: 11, cents: 550, done: 3, owing_points: 11, owing_cents: 550, paid_through: null });
    expect(await leosOf('last_week')).toMatchObject({ points: 3, cents: 150 });
    expect(await leosOf('this_month')).toMatchObject({ points: 19, cents: 950 });
    expect(await leosOf('last_month')).toMatchObject({ points: 3, cents: 150 });
    expect(await leosOf('custom', { from: '2046-02-24', to: '2046-02-26' })).toMatchObject({ points: 8, cents: 400 });
    // Monday weeks move the edge: Feb 26 to Mar 4.
    expect(await leosOf('this_week', { start_on: 'monday' })).toMatchObject({ points: 11 });
    const all = await jobs.allowance({ period: 'this_week' });
    expect(all.people.map((p) => [p.name, p.points])).toEqual([['Leo', 11], ['Mia', 5]]);
    expect(all.point_cents).toBe(50);
  });

  it('never drifts: a point worth 35 cents, seven of them, is 245', async () => {
    await setUp();
    await jobs.setPointValue(35);
    const mias = (await jobs.allowance({ period: 'this_month' })).people.find((p) => p.name === 'Mia')!;
    expect([mias.points, mias.cents]).toEqual([5, 175]);
    expect((await leosOf('this_week')).cents).toBe(11 * 35);
    await jobs.setPointValue(null);
    expect((await leosOf('this_week')).cents).toBeNull();
  });

  it('a payment marked partway starts the next tally after it, and remembers what it was', async () => {
    await setUp();
    await jobs.markPaid(leo, '2046-02-26');
    expect(await leosOf('this_week')).toMatchObject({ points: 11, paid_through: '2046-02-26', paid_points: 5, paid_cents: 250, owing_points: 6, owing_cents: 300 });
    expect(await leosOf('this_month')).toMatchObject({ points: 19, paid_points: 13, owing_points: 6, owing_cents: 300 });
    expect(await leosOf('last_week')).toMatchObject({ points: 3, owing_points: 0, owing_cents: 0 });
    expect(await leosOf('last_month')).toMatchObject({ owing_points: 0 });
    // The other child is not paid by it.
    expect((await jobs.allowance({ period: 'this_week' })).people.find((p) => p.name === 'Mia')).toMatchObject({ owing_points: 5, paid_through: null });

    const history = await jobs.markPaid(leo, '2046-02-28');
    expect(history[0]).toMatchObject({ name: 'Leo', on: '2046-02-28', through: '2046-02-28', points: 6, cents: 300 });
    expect(history[1]).toMatchObject({ through: '2046-02-26', points: 16, cents: 800 });
    expect(await leosOf('this_week')).toMatchObject({ owing_points: 0, owing_cents: 0 });
    // A later change to what a point is worth does not change what was paid.
    await jobs.setPointValue(100);
    expect((await jobs.allowance({ period: 'this_week' })).history[1]).toMatchObject({ points: 16, cents: 800 });
  });

  it('will not pay twice for a day, into the future, or for nothing; and a payment can be taken back', async () => {
    await setUp();
    await jobs.markPaid(leo, '2046-02-26');
    await expect(jobs.markPaid(leo, '2046-02-26')).rejects.toMatchObject({ status: 409 });
    await expect(jobs.markPaid(leo, '2046-02-20')).rejects.toMatchObject({ status: 409 });
    await expect(jobs.markPaid(leo, '2046-03-01')).rejects.toMatchObject({ status: 400 });
    await expect(jobs.markPaid(9999, null)).rejects.toMatchObject({ status: 404 });
    await jobs.markPaid(leo, null); // today
    await expect(jobs.markPaid(leo, null)).rejects.toMatchObject({ status: 409 });
    const back = await jobs.undoPaid(leo);
    expect(back).toHaveLength(1);
    expect(await leosOf('this_week')).toMatchObject({ paid_through: '2046-02-26', owing_points: 6 });
    expect(await jobs.undoPaid(leo)).toEqual([]);
    expect(await leosOf('this_week')).toMatchObject({ paid_through: null, owing_points: 11 });
    await expect(jobs.undoPaid(leo)).rejects.toMatchObject({ status: 404 });
    // Nothing earned, nothing to pay.
    const quiet = (await jobs.addMember('Zed')).find((m) => m.name === 'Zed')!;
    await expect(jobs.markPaid(quiet.id, null)).rejects.toMatchObject({ status: 400 });
  });

  it('forgets a payment record when the child leaves the household', async () => {
    await setUp();
    await jobs.markPaid(leo, null);
    await jobs.removeMember(leo);
    expect((await jobs.allowance({})).history).toEqual([]);
    expect(await db.get('SELECT value FROM user_settings WHERE user_id = ? AND key = ?', [owner, 'allowance_paid'])).toBeFalsy();
  });

  it('says no to a period that is not one', async () => {
    await expect(jobs.allowance({ period: 'forever' })).rejects.toMatchObject({ status: 400 });
    await expect(jobs.allowance({ period: 'custom', from: '2040-01-01', to: '2046-01-01' })).rejects.toMatchObject({ status: 400 });
  });
});
