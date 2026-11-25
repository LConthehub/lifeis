/**
 * The addresses for measures: a person's own numbers over time. What they do is core/'s measures.ts.
 *
 * Every one of these answers only for the signed-in person's own measures. There is no address that names another
 * person, no sharing address, and nothing here opens to a personal key (keys open only /api/voice addresses).
 * The phone app answers the same addresses on the device, through everydayRoutes.
 */
import { measures, type Db } from '../../core/src/index.ts';
import { notUnderstood, read, type Body, type Context, type Route } from './http.ts';

const ID = '([0-9]{1,15})';
const at = (path: string) => new RegExp(`^/api/${path.replaceAll(':id', ID)}$`);

export function measureRoutes(db: Db): Route[] {
  const mine = (c: Context) => measures(db, c.user.id, c.clock);
  return [
    ['GET', at('measures'), async (c) => ({ json: await mine(c).list() })],
    ['POST', at('measures'), async (c) => ({ status: 201, json: await mine(c).create({ name: read.text(c.body, 'name'), unit: read.maybeText(c.body, 'unit'), target: read.maybeNumber(c.body, 'target') }) })],
    ['PUT', at('measures/:id'), async (c) => ({ json: await mine(c).update(c.id, { name: read.text(c.body, 'name'), unit: read.maybeText(c.body, 'unit'), target: read.maybeNumber(c.body, 'target') }) })],
    ['DELETE', at('measures/:id'), async (c) => (await mine(c).remove(c.id), { status: 204 })],
    ['POST', at('measures/:id/entries'), async (c) => ({ status: 201, json: await mine(c).addEntry(c.id, { value: numberOrThrow(c.body), day: read.maybeText(c.body, 'day') }) })],
    ['DELETE', at('measures/entries/:id'), async (c) => ({ json: await mine(c).removeEntry(c.id) })],
  ];
}

function numberOrThrow(body: Body): number {
  const value = read.maybeNumber(body, 'value');
  if (value === null) throw notUnderstood('value');
  return value;
}
