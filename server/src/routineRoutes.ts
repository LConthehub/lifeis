/**
 * The addresses for routines. What they do is core/'s routines.ts; this only reads what was sent and passes it on.
 * The phone app answers the same addresses on the device, through everydayRoutes.
 *
 * Two roots, so the trial rule is one line in core/'s access.ts:
 *   /api/routines     making and changing routines (covered by the unlock, like the rest),
 *   /api/routine-day  using them: ticking a step, finishing a time, marking a thing running low (free for good).
 */
import { addDays, todayOf } from '../../core/src/small.ts';
import { pets, routines, upkeep, type Db, type RoutineInput, type RoutineKind, type RoutineNumbers, type RoutineStepRule } from '../../core/src/index.ts';
import { queryNumber, read, type Body, type Context, type Route } from './http.ts';

const ID = '([0-9]{1,15})';
const at = (path: string) => new RegExp(`^/api/${path.replaceAll(':id', ID)}$`);
const sent = (body: Body, name: string) => Object.hasOwn(body, name);

/** The numbers a workout step carries, as a page sent them (blank is fine). */
function numbersFrom(body: Body): Partial<RoutineNumbers> {
  return {
    sets: read.maybeWhole(body, 'sets'), reps: read.maybeWhole(body, 'reps'), weight: read.maybeNumber(body, 'weight'), weight_unit: read.maybeText(body, 'weight_unit'),
    minutes: read.maybeNumber(body, 'minutes'), distance: read.maybeNumber(body, 'distance'), distance_unit: read.maybeText(body, 'distance_unit'),
  };
}

/** A routine as a page sent it: its name and whose it is, and (when given) its times with their steps. */
function routineFrom(body: Body): RoutineInput {
  const input: RoutineInput = {
    name: read.text(body, 'name'), kind: read.maybeText(body, 'kind') as RoutineKind | null,
    // Not saying whose it is leaves a new workout the maker's own; sending null means everyone's.
    ...(sent(body, 'for_user') || sent(body, 'for_member') || sent(body, 'for_pet') ? { for_user: read.maybeWhole(body, 'for_user'), for_member: read.maybeWhole(body, 'for_member'), for_pet: read.maybeWhole(body, 'for_pet') } : {}),
    cycle_length: read.maybeWhole(body, 'cycle_length'), points: read.maybeWhole(body, 'points'), note: read.maybeText(body, 'note'),
  };
  if (sent(body, 'times')) {
    input.times = read.records(body, 'times').map((t) => ({
      id: read.maybeWhole(t, 'id'), name: read.text(t, 'name'), at: read.maybeText(t, 'at'),
      steps: read.records(t, 'steps').map((s) => ({
        id: read.maybeWhole(s, 'id'), words: read.text(s, 'words'), rule: read.maybeText(s, 'rule') as RoutineStepRule | null,
        weekdays: s.weekdays === undefined || s.weekdays === null ? null : read.wholes(s, 'weekdays'),
        night: read.maybeWhole(s, 'night'), item_id: read.maybeWhole(s, 'item_id'), wait_seconds: read.maybeWhole(s, 'wait_seconds'),
        nums: sent(s, 'nums') && s.nums !== null ? numbersFrom(read.record(s, 'nums')) : null,
      })),
    }));
  }
  return input;
}

export function routineRoutes(db: Db): Route[] {
  const mine = (c: Context) => routines(db, c.user.id, c.clock);
  const day = (c: Context) => c.query.get('day');
  return [
    // ---------- making and changing ----------
    ['GET', at('routines'), async (c) => {
      const tag = c.query.get('tag');
      return { json: await mine(c).list({ tag: tag ? Number(tag) : null }) };
    }],
    ['POST', at('routines'), async (c) => ({ status: 201, json: await mine(c).create(routineFrom(c.body)) })],
    ['GET', at('routines/starters'), async (c) => ({ json: await mine(c).starters(queryNumber(c.query, 'pet')) })],
    ['POST', at('routines/starters'), async (c) => ({ status: 201, json: await mine(c).addStarter(read.text(c.body, 'slug'), read.maybeWhole(c.body, 'for_user'), read.maybeWhole(c.body, 'for_member'), read.maybeWhole(c.body, 'for_pet'), read.maybeWhole(c.body, 'food')) })],
    // Who a routine can be for: the people with a sign-in here, and the household members without one.
    ['GET', at('routines/people'), async (c) => {
      const home = upkeep(db, c.user.id, c.clock);
      const animals = (await pets(db, c.user.id, c.clock).list()).map((p) => ({ id: p.id, name: p.name }));
      return { json: { users: await home.people(), members: await home.members(), pets: animals, me: c.user.id } };
    }],
    // What is on today for the household members' routines, for the chore chart.
    ['GET', at('routines/members'), async (c) => ({ json: await mine(c).forMembers(day(c)) })],
    // The times with a clock time, for the phone to set its own reminders from.
    ['GET', at('routines/coming'), async (c) => {
      const from = c.query.get('from') ?? todayOf(c.clock);
      return { json: await mine(c).coming(from, addDays(from, (queryNumber(c.query, 'days') ?? 2) - 1)) };
    }],
    ['GET', at('routines/for-thing/:id'), async (c) => ({ json: await mine(c).usedIn(c.id) })],
    ['GET', at('routines/:id/history'), async (c) => ({ json: await mine(c).history(c.id) })],
    ['GET', at('routines/:id'), async (c) => ({ json: await mine(c).get(c.id) })],
    ['PUT', at('routines/:id'), async (c) => ({ json: await mine(c).update(c.id, routineFrom(c.body)) })],
    ['DELETE', at('routines/:id'), async (c) => (await mine(c).remove(c.id), { status: 204 })],

    // ---------- using ----------
    ['GET', at('routine-day'), async (c) => ({ json: await mine(c).today(day(c), queryNumber(c.query, 'pet')) })],
    ['GET', at('routine-day/times/:id'), async (c) => ({ json: await mine(c).time(c.id, day(c)) })],
    ['PUT', at('routine-day/steps/:id'), async (c) => ({ json: await mine(c).tick(c.id, read.yesNo(c.body, 'done'), read.maybeText(c.body, 'day'), sent(c.body, 'nums') ? (c.body.nums === null ? null : numbersFrom(read.record(c.body, 'nums'))) : undefined) })],
    ['PUT', at('routine-day/times/:id'), async (c) => ({ json: await mine(c).finish(c.id, read.yesNo(c.body, 'done'), read.maybeText(c.body, 'day')) })],
    ['POST', at('routine-day/steps/:id/low'), async (c) => ({ json: await mine(c).low(c.id) })],
  ];
}

