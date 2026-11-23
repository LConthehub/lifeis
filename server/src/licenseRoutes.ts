/**
 * The addresses for licenses and permits (/api/things/licenses), under things so they are treated like the
 * rest of the organized section: free to read once a trial has ended, and changed only when Life Is is
 * unlocked. What they do is core/'s licenses.ts; this reads what was sent and passes it on.
 */
import { LICENSE_CATEGORIES, LICENSE_STARTERS, SOON_DAYS, defaultLead, licenses, type Db, type LicenseInput } from '../../core/src/index.ts';
import { notUnderstood, queryNumber, read, type Body, type Context, type Route } from './http.ts';

const ID = '(\\d{1,15})';
const at = (path: string) => new RegExp(`^/api/things/licenses${path.replaceAll(':id', ID)}$`);

const licenseFrom = (body: Body): LicenseInput => ({
  name: read.text(body, 'name'), category: read.maybeText(body, 'category'), holder: read.maybeText(body, 'holder'), number: read.maybeText(body, 'number'),
  issuer: read.maybeText(body, 'issuer'), issued_on: read.maybeText(body, 'issued_on'), expires_on: read.maybeText(body, 'expires_on'), note: read.maybeText(body, 'note'),
});

export function licenseRoutes(db: Db): Route[] {
  const mine = (c: Context) => licenses(db, c.user.id, c.clock);
  return [
    ['GET', at(''), async (c) => ({ json: await mine(c).list() })],
    // What to offer: the categories, the ready-made ones, how soon is soon, and the usual lead for a category.
    ['GET', at('/ready'), async () => ({ json: {
      categories: LICENSE_CATEGORIES, starters: LICENSE_STARTERS, soon_days: SOON_DAYS,
      leads: Object.fromEntries(LICENSE_CATEGORIES.map((k) => [k, defaultLead(k)])),
    } })],
    ['GET', at('/expiring'), async (c) => ({ json: await mine(c).expiring(queryNumber(c.query, 'days') ?? SOON_DAYS) })],
    ['POST', at(''), async (c) => ({ status: 201, json: await mine(c).create(licenseFrom(c.body)) })],
    ['GET', at('/:id'), async (c) => ({ json: await mine(c).get(c.id) })],
    ['PUT', at('/:id'), async (c) => ({ json: await mine(c).update(c.id, licenseFrom(c.body)) })],
    // ?reminder=1 takes its renewal in upkeep away too; without it, the renewal stays.
    ['DELETE', at('/:id'), async (c) => (await mine(c).remove(c.id, c.query.get('reminder') === '1'), { status: 204 })],
    ['POST', at('/:id/reminder'), async (c) => {
      const has = (k: string) => Object.hasOwn(c.body, k);
      const lead = has('lead_n') || has('lead_unit');
      if (lead && !(has('lead_n') && has('lead_unit'))) throw notUnderstood('lead_n');
      return { json: await mine(c).remind(c.id, {
        ...(lead ? { lead_n: read.maybeWhole(c.body, 'lead_n'), lead_unit: read.maybeText(c.body, 'lead_unit') } : {}),
        ...(has('term_years') ? { term_years: read.maybeWhole(c.body, 'term_years') } : {}),
      }) };
    }],
  ];
}
