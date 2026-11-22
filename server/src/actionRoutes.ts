/**
 * Short requests from outside Life Is (/api/actions): Siri and Shortcuts, Google's assistant, the app icon's
 * shortcuts, a link that opens the app. What each does is core/'s actions.ts; asking is GET, doing is POST.
 */
import { actions, type Db } from '../../core/src/index.ts';
import type { Body, Context, Route } from './http.ts';

const said = (c: Context, body: Body) => {
  const given: Record<string, string | undefined> = {};
  for (const [name, value] of c.query) given[name] = value;
  for (const [name, value] of Object.entries(body)) if (typeof value === 'string' || typeof value === 'number') given[name] = String(value);
  return given;
};

export function actionRoutes(db: Db): Route[] {
  const doing = (c: Context) => actions(db, c.user.id, c.clock);
  return [
    ['GET', /^\/api\/actions$/, async (c) => ({ json: doing(c).list() })],
    ['GET', /^\/api\/actions\/([a-z-]{1,40})$/, async (c) => ({ json: await doing(c).run(c.path.split('/').pop()!, said(c, {}), 'GET') })],
    ['POST', /^\/api\/actions\/([a-z-]{1,40})$/, async (c) => ({ json: await doing(c).run(c.path.split('/').pop()!, said(c, c.body), 'POST') })],
  ];
}
