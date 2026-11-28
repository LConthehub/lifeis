/**
 * The addresses for jottings: a person's own private scratch list. What they do is core/'s jottings.ts.
 *
 * Every one of these answers only for the signed-in person's own jottings. There is no address that names another
 * person and no sharing address. A personal key can only add one, through /api/voice/jottings (keyRoutes.ts).
 * The phone app answers the same addresses on the device, through everydayRoutes.
 */
import { jottings, type Db } from '../../core/src/index.ts';
import { read, type Context, type Route } from './http.ts';

const ID = '([0-9]{1,15})';
const at = (path: string) => new RegExp(`^/api/${path.replaceAll(':id', ID)}$`);

export function jottingRoutes(db: Db): Route[] {
  const mine = (c: Context) => jottings(db, c.user.id, c.clock);
  return [
    ['GET', at('jottings'), async (c) => ({ json: await mine(c).list() })],
    ['POST', at('jottings'), async (c) => ({ status: 201, json: await mine(c).add(read.text(c.body, 'text')) })],
    ['PUT', at('jottings/:id'), async (c) => ({
      json: await mine(c).update(c.id, {
        ...(c.body.text !== undefined ? { text: read.text(c.body, 'text') } : {}),
        ...(c.body.done !== undefined ? { done: read.yesNo(c.body, 'done') } : {}),
      }),
    })],
    ['DELETE', at('jottings/:id'), async (c) => (await mine(c).remove(c.id), { status: 204 })],
  ];
}
