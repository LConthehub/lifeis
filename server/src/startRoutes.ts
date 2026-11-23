/**
 * The addresses for the two-minute start (/api/start): where a new household has got to, each step saved as it
 * is finished, and clearing the examples made at the end. What each does is core/'s start.ts. Nothing here
 * reaches outside Life Is. These addresses are not part of the paid parts: a brand-new household is never in
 * a trial that has ended, and start.ts refuses anyone who is not brand new.
 */
import { start, type Db } from '../../core/src/index.ts';
import { read, type Context, type Route } from './http.ts';

const at = (path: string) => new RegExp(`^/api/start${path}$`);

export function startRoutes(db: Db): Route[] {
  const mine = (c: Context) => start(db, c.user.id, c.clock);
  return [
    ['GET', at(''), async (c) => ({ json: await mine(c).state() })],
    ['PUT', at('/people'), async (c) => ({ json: await mine(c).people({ adults: c.body.adults, children: c.body.children, pets: c.body.pets }) })],
    ['PUT', at('/interests'), async (c) => ({ json: await mine(c).interests({ wants: c.body.wants, hobbies: c.body.hobbies }) })],
    ['PUT', at('/upkeep'), async (c) => ({ json: await mine(c).upkeep({ sets: c.body.sets, has_car: c.body.has_car }) })],
    ['PUT', at('/examples'), async (c) => ({ json: await mine(c).examples(read.yesNo(c.body, 'on')) })],
    ['POST', at('/finish'), async (c) => ({ json: await (read.yesNo(c.body, 'early', false) ? mine(c).finishNow() : mine(c).finish()) })],
    ['POST', at('/skip'), async (c) => ({ json: await mine(c).skip() })],
    ['POST', at('/close'), async (c) => ({ json: await mine(c).close(read.maybeWhole(c.body, 'step') ?? 1) })],
    ['POST', at('/dismiss'), async (c) => ({ json: await mine(c).dismiss() })],
    ['POST', at('/examples/clear'), async (c) => ({ json: await mine(c).clearExamples() })],
  ];
}
