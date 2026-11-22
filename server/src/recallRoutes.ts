/**
 * The addresses for recall alerts on cars (/api/recalls): whether they are on and what they send, checking
 * now, what was found, and putting a recall aside. What they do is core/'s recalls.ts; this reads what was
 * sent and passes it on. Like the weather, they are always answered, and say so when this copy of Life Is
 * isn't set up to reach outside.
 */
import { NHTSA_API, RECALL_SERVICE, recalls, type Db, type Fetcher } from '../../core/src/index.ts';
import { read, type Context, type Route } from './http.ts';

const ID = '(\\d{1,15})';
const at = (path: string) => new RegExp(`^/api/recalls${path.replaceAll(':id', ID)}$`);

/** Where NHTSA is asked. A walk-through can point it at a stand-in with NHTSA_API; nothing else changes it. */
export const nhtsaBase = (): string => {
  const set = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.NHTSA_API;
  return set && /^https?:\/\//.test(set) ? set : NHTSA_API;
};

export function recallRoutes(db: Db, fetcher?: Fetcher): Route[] {
  const mine = (c: Context) => recalls(db, c.user.id, c.clock, fetcher, nhtsaBase());
  const with_service = <T extends object>(json: T) => ({ ...json, service: RECALL_SERVICE });
  return [
    ['GET', at(''), async (c) => ({ json: with_service(await mine(c).status()) })],
    ['PUT', at(''), async (c) => ({ json: with_service(await mine(c).turn(read.yesNo(c.body, 'on'))) })],
    ['POST', at('/check'), async (c) => ({ json: await mine(c).check({ force: read.yesNo(c.body, 'force', false) }) })],
    ['GET', at('/list'), async (c) => ({ json: await mine(c).list({ dismissed: c.query.get('dismissed') === '1' }) })],
    ['GET', at('/items/:id'), async (c) => ({ json: await mine(c).forThing(c.id, { dismissed: c.query.get('dismissed') === '1' }) })],
    ['POST', at('/:id/dismiss'), async (c) => ({ json: await mine(c).dismiss(c.id) })],
    ['POST', at('/:id/restore'), async (c) => ({ json: await mine(c).restore(c.id) })],
  ];
}
