/**
 * The addresses for holidays (/api/plans/holidays): a holiday is a plan that comes back each year, so these sit
 * under plans. What they do is core/'s holidays.ts; this reads what was sent and passes it on.
 */
import { givenTo, holidays, type DateRule, type Db, type HolidayInput } from '../../core/src/index.ts';
import { notUnderstood, read, type Body, type Context, type Route } from './http.ts';
import { pictureFrom } from './planRoutes.ts';

const ID = '(\\d{1,15})';
const at = (path: string) => new RegExp(`^/api/plans/holidays${path.replaceAll(':id', ID)}$`);
const sent = (body: Body, name: string) => Object.hasOwn(body, name);

/**
 * A rule as a page sent it: the same date each year, a weekday rule, a weekday on or after a date, a day on another
 * calendar, or set each year. Any of them can come back every few years (`every_years`).
 */
function ruleFrom(body: Body): DateRule {
  const kind = read.text(body, 'rule');
  if (kind === 'manual') return { kind: 'manual' };
  const every = read.maybeWhole(body, 'every_years');
  const skips = every !== null && every > 1 ? { every } : every === null || every === 1 ? {} : { every };
  if (kind === 'calendar') {
    return { kind: 'calendar', calendar: read.text(body, 'calendar') as 'chinese', month: read.text(body, 'cal_month'), day: read.maybeWhole(body, 'cal_day') ?? 0, ...skips };
  }
  const month = read.maybeWhole(body, 'month');
  if (month === null) throw notUnderstood('month');
  if (kind === 'fixed') return { kind: 'fixed', month, day: read.maybeWhole(body, 'day_of_month') ?? 0, ...skips };
  if (kind === 'after') return { kind: 'after', month, day: read.maybeWhole(body, 'day_of_month') ?? 0, weekday: read.maybeWhole(body, 'weekday') ?? -1, ...skips };
  if (kind === 'weekday') return { kind: 'weekday', month, weekday: read.maybeWhole(body, 'weekday') ?? -1, nth: read.maybeWhole(body, 'nth') ?? 0, ...skips };
  throw notUnderstood('rule');
}
const holidayFrom = (body: Body): HolidayInput => ({ name: read.text(body, 'name'), rule: ruleFrom(body), day: read.maybeText(body, 'day'), lead_weeks: read.maybeWhole(body, 'lead_weeks') });
/** A field that was sent, even if empty (so it can be cleared); left out means leave it. */
const maybe = <T>(body: Body, name: string, get: () => T) => (sent(body, name) ? { [name]: get() } : {});
const needed = (value: number | null, name: string): number => {
  if (value === null) throw notUnderstood(name);
  return value;
};

export function holidayRoutes(db: Db): Route[] {
  const mine = (c: Context) => holidays(db, c.user.id, c.clock);
  return [
    ['GET', at(''), async (c) => ({ json: await mine(c).list() })],
    ['POST', at(''), async (c) => ({ status: 201, json: await mine(c).create(holidayFrom(c.body)) })],
    ['GET', at('/options'), async (c) => ({ json: await mine(c).options() })],
    ['GET', at('/calendars'), async (c) => ({ json: mine(c).calendars() })],
    ['GET', at('/given-to-me'), async (c) => ({ json: await givenTo(db, c.user.id, c.clock) })],
    ['GET', at('/cards'), async (c) => ({ json: await mine(c).cards() })],
    // Guests, cards, gifts and decorations of any plan (a birthday's gifts, a lunch's guests), changed through the addresses below.
    ['GET', at('/gathering/:id'), async (c) => ({ json: await mine(c).gathering(c.id) })],
    ['POST', at('/from-event'), async (c) => ({ status: 201, json: await mine(c).fromEvent(needed(read.maybeWhole(c.body, 'event_id'), 'event_id')) })],
    // Make a plan come back every year. Answers with the plan, now the first year of a yearly one.
    ['POST', at('/from-plan'), async (c) => ({
      status: 201, json: await mine(c).makeYearly(needed(read.maybeWhole(c.body, 'plan_id'), 'plan_id'), { rule: ruleFrom(c.body), lead_weeks: read.maybeWhole(c.body, 'lead_weeks') }),
    })],
    ['GET', at('/:id'), async (c) => ({ json: await mine(c).get(c.id) })],
    ['PUT', at('/:id'), async (c) => ({
      json: await mine(c).update(c.id, {
        ...(sent(c.body, 'name') ? { name: read.maybeText(c.body, 'name') } : {}), ...(sent(c.body, 'rule') ? { rule: ruleFrom(c.body) } : {}),
        ...(sent(c.body, 'lead_weeks') ? { lead_weeks: read.maybeWhole(c.body, 'lead_weeks') } : {}),
      }),
    })],
    ['DELETE', at('/:id'), async (c) => (await mine(c).remove(c.id), { status: 204 })],
    ['POST', at('/:id/years'), async (c) => ({ status: 201, json: await mine(c).startYear(c.id, { day: read.maybeText(c.body, 'day') }) })],

    ['GET', at('/years/:id'), async (c) => ({ json: await mine(c).year(c.id) })],
    ['PUT', at('/years/:id'), async (c) => ({
      json: await mine(c).setYear(c.id, {
        ...maybe(c.body, 'day', () => read.maybeText(c.body, 'day')), ...maybe(c.body, 'put_up_on', () => read.maybeText(c.body, 'put_up_on')),
        ...maybe(c.body, 'take_down_on', () => read.maybeText(c.body, 'take_down_on')), ...maybe(c.body, 'budget_cents', () => read.maybeWhole(c.body, 'budget_cents')),
        ...maybe(c.body, 'notes_next', () => read.maybeText(c.body, 'notes_next')),
      }),
    })],
    ['POST', at('/years/:id/finish'), async (c) => ({ json: await mine(c).finish(c.id, read.maybeText(c.body, 'notes')) })],
    ['POST', at('/years/:id/take-down-done'), async (c) => ({ json: await mine(c).finishTakeDown(c.id) })],
    ['PUT', at('/years/:id/ticks'), async (c) => ({ json: await mine(c).tick(c.id, read.text(c.body, 'key'), read.yesNo(c.body, 'done')) })],
    ['POST', at('/years/:id/steps'), async (c) => ({
      status: 201,
      json: await mine(c).addStep(c.id, { words: read.text(c.body, 'words'), rule: read.text(c.body, 'rule') as 'morning_of', at: read.maybeText(c.body, 'at'), hours: read.maybeWhole(c.body, 'hours') }),
    })],
    ['DELETE', at('/steps/:id'), async (c) => ({ json: await mine(c).removeStep(c.id) })],

    ['POST', at('/years/:id/people'), async (c) => ({
      status: 201,
      json: await mine(c).addPerson(c.id, read.text(c.body, 'role') as 'guest', {
        name: read.maybeText(c.body, 'name'), user_id: read.maybeWhole(c.body, 'user_id'), member_id: read.maybeWhole(c.body, 'member_id'), note: read.maybeText(c.body, 'note'),
      }),
    })],
    ['PUT', at('/people/:id'), async (c) => ({
      json: await mine(c).updatePerson(c.id, {
        ...(sent(c.body, 'done') ? { done: read.yesNo(c.body, 'done') } : {}), ...maybe(c.body, 'note', () => read.maybeText(c.body, 'note')),
        ...(sent(c.body, 'name') ? { name: read.maybeText(c.body, 'name') } : {}),
      }),
    })],
    ['DELETE', at('/people/:id'), async (c) => ({ json: await mine(c).removePerson(c.id) })],

    ['POST', at('/years/:id/gifts'), async (c) => ({
      status: 201,
      json: await mine(c).addGift(c.id, {
        who: read.maybeText(c.body, 'who'), for_user: read.maybeWhole(c.body, 'for_user'), for_member: read.maybeWhole(c.body, 'for_member'),
        idea: read.maybeText(c.body, 'idea'), note: read.maybeText(c.body, 'note'),
      }),
    })],
    ['PUT', at('/gifts/:id'), async (c) => ({
      json: await mine(c).updateGift(c.id, {
        ...maybe(c.body, 'who', () => read.maybeText(c.body, 'who')), ...maybe(c.body, 'idea', () => read.maybeText(c.body, 'idea')), ...maybe(c.body, 'status', () => read.maybeText(c.body, 'status')),
        ...maybe(c.body, 'cents', () => read.maybeWhole(c.body, 'cents')), ...maybe(c.body, 'note', () => read.maybeText(c.body, 'note')),
      }),
    })],
    ['DELETE', at('/gifts/:id'), async (c) => ({ json: await mine(c).removeGift(c.id) })],

    ['POST', at('/years/:id/decor'), async (c) => ({
      status: 201,
      json: await mine(c).addDecor(c.id, {
        spot: read.maybeText(c.body, 'spot'), label: read.maybeText(c.body, 'label'), thing_id: read.maybeWhole(c.body, 'thing_id'), box_id: read.maybeWhole(c.body, 'box_id'), note: read.maybeText(c.body, 'note'),
      }),
    })],
    ['PUT', at('/decor/:id'), async (c) => ({
      json: await mine(c).updateDecor(c.id, {
        ...maybe(c.body, 'spot', () => read.maybeText(c.body, 'spot')), ...maybe(c.body, 'label', () => read.maybeText(c.body, 'label')), ...maybe(c.body, 'note', () => read.maybeText(c.body, 'note')),
        ...maybe(c.body, 'box_id', () => read.maybeWhole(c.body, 'box_id')),
        ...(sent(c.body, 'put_up') ? { put_up: read.yesNo(c.body, 'put_up') } : {}), ...(sent(c.body, 'taken_down') ? { taken_down: read.yesNo(c.body, 'taken_down') } : {}),
        ...(sent(c.body, 'boxed') ? { boxed: read.yesNo(c.body, 'boxed') } : {}), ...(sent(c.body, 'need_done') ? { need_done: read.yesNo(c.body, 'need_done') } : {}),
        ...maybe(c.body, 'fix', () => read.maybeText(c.body, 'fix') as 'broke' | 'out' | null),
      }),
    })],
    ['DELETE', at('/decor/:id'), async (c) => ({ json: await mine(c).removeDecor(c.id) })],
    ['POST', at('/years/:id/spot-photos'), async (c) => ({ status: 201, json: await mine(c).keepSpotPhoto(c.id, read.text(c.body, 'spot'), pictureFrom(c.body)) })],
  ];
}
