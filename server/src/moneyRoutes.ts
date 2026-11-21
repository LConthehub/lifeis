/**
 * The addresses for Life is spending (/api/money). What they do is core/'s money.ts; this only reads what
 * was sent and passes it on.
 */
import { money, type Db } from '../../core/src/index.ts';
import { read, type Body, type Context, type Route } from './http.ts';

const ID = '(\\d{1,15})';
const at = (path: string) => new RegExp(`^/api/${path.replaceAll(':id', ID)}$`);
const sent = (body: Body, name: string) => Object.hasOwn(body, name);

const categoryFrom = (body: Body) => ({
  name: read.maybeText(body, 'name'),
  ...(sent(body, 'monthly_cents') ? { monthly_cents: read.maybeNumber(body, 'monthly_cents') } : {}),
  ...(sent(body, 'shared_with') ? { shared_with: read.wholes(body, 'shared_with') } : {}),
});
const entryFrom = (body: Body) => ({
  label: read.maybeText(body, 'label'), cents: read.maybeNumber(body, 'cents'), day: read.maybeText(body, 'day'),
  note: read.maybeText(body, 'note'), category_id: read.maybeWhole(body, 'category_id'),
});

export function moneyRoutes(db: Db): Route[] {
  const spending = (c: Context) => money(db, c.user.id, c.clock);
  return [
    ['GET', at('money'), async (c) => ({ json: await spending(c).month(c.query.get('month')) })],
    ['POST', at('money/categories'), async (c) => ({ status: 201, json: await spending(c).addCategory(categoryFrom(c.body)) })],
    ['PUT', at('money/categories/:id'), async (c) => (await spending(c).updateCategory(c.id, categoryFrom(c.body)), { status: 204 })],
    ['DELETE', at('money/categories/:id'), async (c) => (await spending(c).removeCategory(c.id), { status: 204 })],
    ['POST', at('money/entries'), async (c) => ({ status: 201, json: await spending(c).addEntry(entryFrom(c.body)) })],
    ['PUT', at('money/entries/:id'), async (c) => (await spending(c).updateEntry(c.id, entryFrom(c.body)), { status: 204 })],
    ['DELETE', at('money/entries/:id'), async (c) => (await spending(c).removeEntry(c.id), { status: 204 })],
  ];
}
