/**
 * The addresses for a person's own private records: checkups, the daily check-in and the incident log. What they do is
 * core/'s checkups.ts, checkins.ts and incidents.ts.
 *
 * Every one of these answers only for the signed-in person's own records. There is no address that names another person,
 * no sharing address, and nothing here opens to a personal key (keys open only /api/voice addresses). The phone app
 * answers the same addresses on the device, through everydayRoutes.
 */
import { checkins, checkups, incidents, type Db } from '../../core/src/index.ts';
import { notUnderstood, read, type Body, type Context, type Route } from './http.ts';

const ID = '([0-9]{1,15})';
const DAY = '([0-9]{4}-[0-9]{2}-[0-9]{2})';
const at = (path: string) => new RegExp(`^/api/${path.replaceAll(':id', ID).replaceAll(':day', DAY)}$`);

const checkup = (body: Body) => ({ name: read.text(body, 'name'), every_n: whole(body, 'every_n'), every_unit: read.text(body, 'every_unit'), last_on: read.maybeText(body, 'last_on'), note: read.maybeText(body, 'note'), cost_cents: read.maybeWhole(body, 'cost_cents') });
const whole = (body: Body, name: string) => { const n = read.maybeWhole(body, name); if (n === null) throw notUnderstood(name); return n; };
const incident = (body: Body) => ({ happened_on: read.text(body, 'happened_on'), happened_time: read.maybeText(body, 'happened_time'), what: read.text(body, 'what'), who: read.maybeText(body, 'who'), kept: read.maybeText(body, 'kept') });

export function recordRoutes(db: Db): Route[] {
  const checks = (c: Context) => checkups(db, c.user.id, c.clock);
  const check = (c: Context) => checkins(db, c.user.id, c.clock);
  const log = (c: Context) => incidents(db, c.user.id, c.clock);
  return [
    ['GET', at('checkups'), async (c) => ({ json: await checks(c).list() })],
    ['POST', at('checkups'), async (c) => ({ status: 201, json: await checks(c).create(checkup(c.body)) })],
    ['PUT', at('checkups/:id'), async (c) => ({ json: await checks(c).update(c.id, checkup(c.body)) })],
    ['POST', at('checkups/:id/done'), async (c) => ({ json: await checks(c).done(c.id, read.maybeText(c.body, 'day')) })],
    ['DELETE', at('checkups/:id'), async (c) => (await checks(c).remove(c.id), { status: 204 })],

    ['GET', at('check-ins'), async (c) => ({ json: await check(c).recent() })],
    ['PUT', at('check-ins'), async (c) => ({ json: await check(c).save({
      day: read.maybeText(c.body, 'day'), sleep_hours: read.maybeNumber(c.body, 'sleep_hours'), water: read.maybeWhole(c.body, 'water'), energy: read.maybeWhole(c.body, 'energy'), line: read.maybeText(c.body, 'line'),
    }) })],
    ['DELETE', at('check-ins/:day'), async (c) => (await check(c).remove(c.path.slice(-10)), { status: 204 })],

    ['GET', at('incidents'), async (c) => ({ json: await log(c).list() })],
    ['POST', at('incidents'), async (c) => ({ status: 201, json: await log(c).create(incident(c.body)) })],
    ['PUT', at('incidents/:id'), async (c) => ({ json: await log(c).update(c.id, incident(c.body)) })],
    ['DELETE', at('incidents/:id'), async (c) => (await log(c).remove(c.id), { status: 204 })],
    ['POST', at('incidents/:id/additions'), async (c) => ({ status: 201, json: await log(c).addTo(c.id, read.text(c.body, 'words')) })],
  ];
}
