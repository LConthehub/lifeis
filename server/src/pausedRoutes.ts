/**
 * Which outside connections are switched off in Settings, with their setup kept (/api/paused). What switching off
 * does is core/'s paused.ts; this only reads what was sent and passes it on.
 */
import { PAUSABLE, pausedKinds, setPaused, type Db, type Pausable } from '../../core/src/index.ts';
import { notUnderstood, read, type Route } from './http.ts';

export function pausedRoutes(db: Db): Route[] {
  return [
    ['GET', /^\/api\/paused$/, async (c) => ({ json: await pausedKinds(db, c.user.id) })],
    ['PUT', /^\/api\/paused$/, async (c) => {
      const what = read.text(c.body, 'what');
      if (!(PAUSABLE as readonly string[]).includes(what)) throw notUnderstood('what');
      return { json: await setPaused(db, c.user.id, what as Pausable, read.yesNo(c.body, 'paused')) };
    }],
  ];
}
