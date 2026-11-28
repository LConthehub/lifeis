/**
 * The addresses for splitting a bill or a purchase (/api/splits) and for savings pots (/api/pots).
 * What they do is core/'s splits.ts and pots.ts; this only reads what was sent and passes it on.
 */
import { pots, splits, type Db } from '../../core/src/index.ts';
import { notUnderstood, read, type Body, type Route } from './http.ts';

const ID = '(\\d{1,15})';
const at = (path: string) => new RegExp(`^/api/${path.replaceAll(':id', ID)}$`);

const personFrom = (body: Body) => {
  const said = read.maybeText(body, 'mode');
  if (said !== null && said !== 'equal' && said !== 'amount' && said !== 'percent') throw notUnderstood('mode');
  const mode: 'equal' | 'amount' | 'percent' | null = said;
  return { user_id: read.maybeWhole(body, 'user_id'), name: read.maybeText(body, 'name'), mode, cents: read.maybeNumber(body, 'cents'), percent: read.maybeNumber(body, 'percent'), paid: read.yesNo(body, 'paid', false) };
};
const splitFrom = (body: Body) => ({
  what: read.maybeText(body, 'what'), total_cents: read.maybeNumber(body, 'total_cents'), day: read.maybeText(body, 'day'), note: read.maybeText(body, 'note'),
  entry_id: read.maybeWhole(body, 'entry_id'), job_id: read.maybeWhole(body, 'job_id'), people: read.records(body, 'people').map(personFrom),
});
const potFrom = (body: Body) => ({
  ...(Object.hasOwn(body, 'name') ? { name: read.maybeText(body, 'name') } : {}),
  ...(Object.hasOwn(body, 'shared_with') ? { shared_with: read.wholes(body, 'shared_with') } : {}),
  ...(Object.hasOwn(body, 'closed') ? { closed: read.yesNo(body, 'closed') } : {}),
});
const lineFrom = (body: Body) => ({ day: read.maybeText(body, 'day'), cents: read.maybeNumber(body, 'cents'), note: read.maybeText(body, 'note') });

export function splitRoutes(db: Db): Route[] {
  return [
    ['GET', at('splits'), async (c) => ({ json: await splits(db, c.user.id, c.clock).list() })],
    ['GET', at('splits/start'), async (c) => ({ json: await splits(db, c.user.id, c.clock).start({
      entry_id: c.query.get('entry') ? Number(c.query.get('entry')) : null, job_id: c.query.get('bill') ? Number(c.query.get('bill')) : null }) })],
    ['POST', at('splits/preview'), async (c) => ({ json: await splits(db, c.user.id, c.clock).preview(splitFrom(c.body)) })],
    ['POST', at('splits'), async (c) => ({ status: 201, json: await splits(db, c.user.id, c.clock).create(splitFrom(c.body)) })],
    ['POST', at('splits/shares/:id/settle'), async (c) => (await splits(db, c.user.id, c.clock).settle(c.id, read.yesNo(c.body, 'settled', true)), { status: 204 })],
    ['PUT', at('splits/:id'), async (c) => (await splits(db, c.user.id, c.clock).update(c.id, splitFrom(c.body)), { status: 204 })],
    ['DELETE', at('splits/:id'), async (c) => (await splits(db, c.user.id, c.clock).remove(c.id), { status: 204 })],

    ['GET', at('pots'), async (c) => ({ json: await pots(db, c.user.id, c.clock).list() })],
    ['POST', at('pots'), async (c) => ({ status: 201, json: await pots(db, c.user.id, c.clock).create(potFrom(c.body)) })],
    ['DELETE', at('pots/lines/:id'), async (c) => (await pots(db, c.user.id, c.clock).removeLine(c.id), { status: 204 })],
    ['POST', at('pots/:id/lines'), async (c) => ({ status: 201, json: await pots(db, c.user.id, c.clock).addLine(c.id, lineFrom(c.body)) })],
    ['PUT', at('pots/:id'), async (c) => (await pots(db, c.user.id, c.clock).update(c.id, potFrom(c.body)), { status: 204 })],
    ['DELETE', at('pots/:id'), async (c) => (await pots(db, c.user.id, c.clock).remove(c.id), { status: 204 })],
  ];
}
