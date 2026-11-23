/**
 * The addresses for Life is spending (/api/money). What they do is core/'s money.ts; this only reads what
 * was sent and passes it on.
 */
import { budget, importStatement, lookOverStatement, money, readStatement, simplefin, type Db } from '../../core/src/index.ts';
import type { Reach } from './connectionRoutes.ts';
import { notUnderstood, queryNumber, read, type Body, type Context, type Route } from './http.ts';

const ID = '(\\d{1,15})';
const at = (path: string) => new RegExp(`^/api/${path.replaceAll(':id', ID)}$`);
const sent = (body: Body, name: string) => Object.hasOwn(body, name);

const categoryFrom = (body: Body) => ({
  name: read.maybeText(body, 'name'),
  ...(sent(body, 'monthly_cents') ? { monthly_cents: read.maybeNumber(body, 'monthly_cents') } : {}),
  ...(sent(body, 'shared_with') ? { shared_with: read.wholes(body, 'shared_with') } : {}),
});
const incomeFrom = (body: Body) => ({
  name: read.maybeText(body, 'name'), cents: read.maybeNumber(body, 'cents'), every: read.maybeText(body, 'every'),
  start_day: read.maybeText(body, 'start_day'), end_day: read.maybeText(body, 'end_day'),
});
const goalFrom = (body: Body) => ({ name: read.maybeText(body, 'name'), target_cents: read.maybeNumber(body, 'target_cents'), by_day: read.maybeText(body, 'by_day') });
const billFrom = (body: Body) => ({
  name: read.maybeText(body, 'name'), cents: read.maybeNumber(body, 'cents'), every_n: read.maybeWhole(body, 'every_n'), every_unit: read.maybeText(body, 'every_unit'),
  first_due: read.maybeText(body, 'first_due'), autopay: read.yesNo(body, 'autopay', false),
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

export function moneyRoutes(db: Db, bank?: Reach & { allowLocal?: boolean }): Route[] {
  const spending = (c: Context) => money(db, c.user.id, c.clock);
  // Reading bank accounts through SimpleFIN (core/'s simplefin.ts). Its access address is opened only inside core and is never in an answer.
  const bankReading = (c: Context) => simplefin(db, c.user.id, c.clock, bank?.fetcher, { sealer: bank?.sealer, allowLocal: bank?.allowLocal });
  const planning = (c: Context) => budget(db, c.user.id, c.clock);
  return [
    // A statement downloaded from a bank or card, looked over and then brought in. Read here, sent nowhere. See bankStatement.ts.
    ['GET', at('money/simplefin'), async (c) => ({ json: await bankReading(c).state() })],
    ['PUT', at('money/simplefin'), async (c) => ({ json: await bankReading(c).turn(read.yesNo(c.body, 'on')) })],
    ['POST', at('money/simplefin/connect'), async (c) => ({ status: 201, json: await bankReading(c).connect(read.text(c.body, 'token')) })],
    ['POST', at('money/simplefin/refresh'), async (c) => ({ json: await bankReading(c).refresh() })],
    ['PUT', at('money/simplefin/accounts'), async (c) => ({ json: await bankReading(c).choose(read.records(c.body, 'accounts').map((a) => ({
      id: read.maybeWhole(a, 'id') ?? (() => { throw notUnderstood('id'); })(), chosen: read.yesNo(a, 'chosen'), category_id: read.maybeWhole(a, 'category_id') }))) })],
    ['POST', at('money/simplefin/read'), async (c) => ({ json: await bankReading(c).read({ from_day: read.maybeText(c.body, 'from_day'), minutes_behind_utc: read.maybeWhole(c.body, 'minutes_behind_utc') }) })],
    ['DELETE', at('money/simplefin'), async (c) => ({ json: await bankReading(c).disconnect() })],
    ['POST', at('money/statement/read'), async (c) => ({ json: await lookOverStatement(db, c.user.id, c.clock, statementFrom(c.body)) })],
    ['POST', at('money/statement'), async (c) => ({ status: 201, json: await importStatement(db, c.user.id, c.clock, statementFrom(c.body).rows, choicesFrom(c.body)) })],
    // The budget: income, bills (read from upkeep), savings goals, a month's and a year's figures. See budget.ts.
    ['GET', at('money/budget'), async (c) => ({ json: await planning(c).month(c.query.get('month')) })],
    ['GET', at('money/year'), async (c) => ({ json: await planning(c).year(c.query.get('year')) })],
    ['GET', at('money/by-tag'), async (c) => ({ json: await planning(c).byTag(c.query.get('period')) })],
    ['GET', at('money/income'), async (c) => ({ json: await planning(c).income() })],
    ['POST', at('money/income'), async (c) => ({ status: 201, json: await planning(c).addIncome(incomeFrom(c.body)) })],
    ['PUT', at('money/income/:id'), async (c) => (await planning(c).updateIncome(c.id, incomeFrom(c.body)), { status: 204 })],
    ['DELETE', at('money/income/:id'), async (c) => (await planning(c).removeIncome(c.id), { status: 204 })],
    ['GET', at('money/bills'), async (c) => ({ json: await planning(c).bills() })],
    ['POST', at('money/bills'), async (c) => ({ status: 201, json: await planning(c).addBill(billFrom(c.body)) })],
    ['GET', at('money/goals'), async (c) => ({ json: await planning(c).goals() })],
    ['POST', at('money/goals'), async (c) => ({ status: 201, json: await planning(c).addGoal(goalFrom(c.body)) })],
    ['DELETE', at('money/goals/saved/:id'), async (c) => (await planning(c).removeSaved(c.id), { status: 204 })],
    ['GET', at('money/goals/:id'), async (c) => ({ json: await planning(c).goal(c.id) })],
    ['PUT', at('money/goals/:id'), async (c) => (await planning(c).updateGoal(c.id, goalFrom(c.body)), { status: 204 })],
    ['DELETE', at('money/goals/:id'), async (c) => (await planning(c).removeGoal(c.id), { status: 204 })],
    ['POST', at('money/goals/:id/saved'), async (c) => ({ status: 201, json: await planning(c).putAside(c.id, { day: read.maybeText(c.body, 'day'), cents: read.maybeNumber(c.body, 'cents') }) })],
    ['GET', at('money'), async (c) => ({ json: await spending(c).month(c.query.get('month'), queryNumber(c.query, 'tag')) })],
    ['POST', at('money/categories'), async (c) => ({ status: 201, json: await spending(c).addCategory(categoryFrom(c.body)) })],
    ['PUT', at('money/categories/:id'), async (c) => (await spending(c).updateCategory(c.id, categoryFrom(c.body)), { status: 204 })],
    ['DELETE', at('money/categories/:id'), async (c) => (await spending(c).removeCategory(c.id), { status: 204 })],
    ['POST', at('money/entries'), async (c) => ({ status: 201, json: await spending(c).addEntry(entryFrom(c.body)) })],
    ['PUT', at('money/entries/:id'), async (c) => (await spending(c).updateEntry(c.id, entryFrom(c.body)), { status: 204 })],
    ['DELETE', at('money/entries/:id'), async (c) => (await spending(c).removeEntry(c.id), { status: 204 })],
  ];
}
