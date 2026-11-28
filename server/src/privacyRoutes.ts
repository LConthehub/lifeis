/**
 * What other people who sign in can see (/api/privacy/people), for the privacy check-up in Settings. Read only.
 * What it counts is core/'s privacyCheck.ts.
 */
import { seenByOthers, type Db } from '../../core/src/index.ts';
import type { Route } from './http.ts';

export function privacyRoutes(db: Db): Route[] {
  return [
    ['GET', /^\/api\/privacy\/people$/, async (c) => ({ json: await seenByOthers(db, c.user.id) })],
  ];
}
