/**
 * The addresses for media servers (/api/connections) and for the covers Life Is keeps (/api/media/:id/cover).
 * What they do is core/'s connections.ts; this reads what was sent, and is where Life Is reaches out to the
 * server you named. It reaches nowhere else.
 */
import { connections, connectionsDue, media, type Db, type Fetcher, type Sealer } from '../../core/src/index.ts';
import type * as auth from './auth.ts';
import { read, type Body, type Context, type Route } from './http.ts';

const ID = '(\\d{1,15})';
const at = (path: string) => new RegExp(`^/api/${path.replaceAll(':id', ID)}$`);

export type Reach = { fetcher: Fetcher; sealer: Sealer };

/** Asks a web address for its answer, giving up after half a minute and never taking in more than 20 MB. */
export const webFetcher: Fetcher = async (url, headers) => {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(30_000) });
  const body = async () => {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length > 20_000_000) throw new Error('That answer is too large');
    return bytes;
  };
  return {
    status: response.status,
    type: response.headers.get('content-type'),
    json: async () => JSON.parse(Buffer.from(await body()).toString('utf8')) as unknown,
    bytes: body,
  };
};

const connectionFrom = (body: Body) => ({
  kind: read.maybeText(body, 'kind') ?? 'jellyfin', url: read.text(body, 'url'), secret: read.maybeText(body, 'secret'),
  name: read.maybeText(body, 'name'), every_hours: read.maybeWhole(body, 'every_hours'),
});

export function connectionRoutes(db: Db, reach: Reach): Route[] {
  const servers = (c: Context) => connections(db, c.user.id, c.clock, reach);
  return [
    ['GET', at('connections'), async (c) => ({ json: await servers(c).list() })],
    ['POST', at('connections'), async (c) => ({ status: 201, json: await servers(c).create(connectionFrom(c.body)) })],
    ['PUT', at('connections/:id'), async (c) => ({ json: await servers(c).update(c.id, connectionFrom(c.body)) })],
    ['DELETE', at('connections/:id'), async (c) => ({ json: await servers(c).remove(c.id, c.query.get('with_copies') === '1') })],
    ['POST', at('connections/:id/sync'), async (c) => {
      const result = await servers(c).sync(c.id);
      return { json: { ...result, connections: await servers(c).list() } };
    }],

    ['GET', at('media/:id/cover'), async (c) => {
      const cover = await media(db, c.user.id, c.clock).cover(c.id);
      if (!cover) return { status: 404, json: { detail: 'Not found' } };
      // A cover never changes, and is the person's own: their browser may keep it, nothing in between may.
      return { body: Buffer.from(cover.bytes), headers: { 'Content-Type': cover.type, 'Cache-Control': 'private, max-age=604800' } };
    }],
  ];
}

/**
 * Sync every connection whose turn it is. Called every few minutes by the program; one that fails is noted on
 * the connection (see its last_message) and tried again when it's next due.
 */
export async function syncDue(db: Db, clock: auth.Clock, reach: Reach, onError: (problem: unknown) => void = () => {}): Promise<number> {
  let done = 0;
  for (const due of await connectionsDue(db, clock)) {
    try {
      await connections(db, due.owner_id, clock, reach).sync(due.id);
      done += 1;
    } catch (problem) {
      onError(problem);
    }
  }
  return done;
}
