/**
 * The addresses for media servers (/api/connections) and for the covers Life Is keeps (/api/media/:id/cover).
 * What they do is core/'s connections.ts; this reads what was sent, and is where Life Is reaches out to the
 * server you named. It reaches nowhere else.
 */
import { connections, connectionsDue, libraries, librariesDue, media, type Db, type Fetcher, type Sealer } from '../../core/src/index.ts';
import type * as auth from './auth.ts';
import { read, type Body, type Context, type Route } from './http.ts';

const ID = '(\\d{1,15})';
const at = (path: string) => new RegExp(`^/api/${path.replaceAll(':id', ID)}$`);

export type Reach = { fetcher: Fetcher; sealer: Sealer };

/**
 * A question that only reads is asked once more when the line itself failed (the first connection to a host
 * after starting up sometimes does). Never something posted, which might then arrive twice, and never after
 * waiting the whole time out.
 */
async function reach(url: string, init: RequestInit, wait: number): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(wait) });
  } catch (problem) {
    if (init.method || (problem as Error).name === 'TimeoutError') throw problem;
    await new Promise((r) => setTimeout(r, 400));
    return fetch(url, { ...init, signal: AbortSignal.timeout(wait) });
  }
}

/** Asks a web address for its answer, giving up after half a minute and never taking in more than 20 MB. */
export const webFetcher: Fetcher = async (url, headers, send) => {
  const response = await reach(url, { headers, ...(send ? { method: send.method, ...(send.method === 'POST' ? { body: send.body } : {}), ...(send.noRedirect ? { redirect: 'manual' as const } : {}) } : {}) }, 30_000);
  const body = async () => {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length > 20_000_000) throw new Error('That answer is too large');
    return bytes;
  };
  return {
    status: response.status,
    header: (name: string) => response.headers.get(name),
    type: response.headers.get('content-type'),
    json: async () => JSON.parse(new TextDecoder().decode(await body())) as unknown,
    bytes: body,
  };
};

/** The same way out, for a model that may take a minute or two to think. */
export const patientFetcher: Fetcher = async (url, headers, send) => {
  const response = await reach(url, { headers, ...(send ? { method: send.method, ...(send.method === 'POST' ? { body: send.body } : {}), ...(send.noRedirect ? { redirect: 'manual' as const } : {}) } : {}) }, 180_000);
  const body = async () => {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length > 5_000_000) throw new Error('That answer is too large');
    return bytes;
  };
  return { status: response.status, header: (name: string) => response.headers.get(name), type: response.headers.get('content-type'), json: async () => JSON.parse(new TextDecoder().decode(await body())) as unknown, bytes: body };
};

const connectionFrom = (body: Body) => ({
  kind: read.maybeText(body, 'kind') ?? 'jellyfin', url: read.text(body, 'url'), secret: read.maybeText(body, 'secret'),
  name: read.maybeText(body, 'name'), every_hours: read.maybeWhole(body, 'every_hours'),
});

const libraryFrom = (body: Body) => ({
  kind: read.maybeText(body, 'kind') ?? '', url: read.text(body, 'url'), key: read.maybeText(body, 'key'),
  username: read.maybeText(body, 'username'), password: typeof body.password === 'string' ? body.password : null,
  name: read.maybeText(body, 'name'), every_hours: read.maybeWhole(body, 'every_hours'),
});

export function connectionRoutes(db: Db, reach: Reach): Route[] {
  const servers = (c: Context) => connections(db, c.user.id, c.clock, reach);
  const books = (c: Context) => libraries(db, c.user.id, c.clock, reach);
  return [
    // Book servers: Audiobookshelf, Calibre-Web, Kavita, or any OPDS catalogue. See core/'s libraries.ts.
    ['GET', at('libraries'), async (c) => ({ json: await books(c).list() })],
    ['POST', at('libraries'), async (c) => ({ status: 201, json: await books(c).create(libraryFrom(c.body)) })],
    ['PUT', at('libraries/:id'), async (c) => ({ json: await books(c).update(c.id, libraryFrom(c.body)) })],
    ['DELETE', at('libraries/:id'), async (c) => ({ json: await books(c).remove(c.id, c.query.get('with_copies') === '1') })],
    ['POST', at('libraries/:id/sync'), async (c) => {
      const result = await books(c).sync(c.id);
      return { json: { ...result, libraries: await books(c).list() } };
    }],

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
      return { body: cover.bytes, headers: { 'Content-Type': cover.type, 'Cache-Control': 'private, max-age=604800' } };
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
  for (const due of await librariesDue(db, clock)) {
    try {
      await libraries(db, due.owner_id, clock, reach).sync(due.id);
      done += 1;
    } catch (problem) {
      onError(problem);
    }
  }
  return done;
}
