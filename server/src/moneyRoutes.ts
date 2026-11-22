/**
 * The addresses for Life is spending (/api/money). What they do is core/'s money.ts; this only reads what
 * was sent and passes it on.
 */
import { importStatement, lookOverStatement, money, readStatement, type Db } from '../../core/src/index.ts';
import { notUnderstood, read, type Body, type Context, type Route } from './http.ts';

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

/** The statement a request carries, read afresh each time (so what is brought in is never what a page claims it read). */
const statementFrom = (body: Body) => {
  const flip = read.maybeText(body, 'spending_is');
  if (flip !== null && flip !== 'negative' && flip !== 'positive') throw notUnderstood('spending_is');
  return readStatement(typeof body.text === 'string' ? body.text : '', { spending_is: flip });
};
const choicesFrom = (body: Body) => {
  const categories: Record<string, number | null> = {};
  for (const [place, id] of Object.entries(read.record(body, 'categories'))) {
    if (id !== null && !Number.isSafeInteger(id)) throw notUnderstood('categories');
    categories[place] = id as number | null;
  }
  return { keep: Array.isArray(body.keep) ? read.wholes(body, 'keep') : undefined, categories, suggest: read.yesNo(body, 'suggest', true) };
};

export function moneyRoutes(db: Db): Route[] {
  const spending = (c: Context) => money(db, c.user.id, c.clock);
  return [
    // A statement downloaded from a bank or card, looked over and then brought in. Read here, sent nowhere. See bankStatement.ts.
    ['POST', at('money/statement/read'), async (c) => ({ json: await lookOverStatement(db, c.user.id, c.clock, statementFrom(c.body)) })],
    ['POST', at('money/statement'), async (c) => ({ status: 201, json: await importStatement(db, c.user.id, c.clock, statementFrom(c.body).rows, choicesFrom(c.body)) })],
    ['GET', at('money'), async (c) => ({ json: await spending(c).month(c.query.get('month')) })],
    ['POST', at('money/categories'), async (c) => ({ status: 201, json: await spending(c).addCategory(categoryFrom(c.body)) })],
    ['PUT', at('money/categories/:id'), async (c) => (await spending(c).updateCategory(c.id, categoryFrom(c.body)), { status: 204 })],
    ['DELETE', at('money/categories/:id'), async (c) => (await spending(c).removeCategory(c.id), { status: 204 })],
    ['POST', at('money/entries'), async (c) => ({ status: 201, json: await spending(c).addEntry(entryFrom(c.body)) })],
    ['PUT', at('money/entries/:id'), async (c) => (await spending(c).updateEntry(c.id, entryFrom(c.body)), { status: 204 })],
    ['DELETE', at('money/entries/:id'), async (c) => (await spending(c).removeEntry(c.id), { status: 204 })],
  ];
}
