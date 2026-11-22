/**
 * What every address shares: how a request is read, how a refusal is worded, and what a handler is given.
 *
 * A handler is given a Context and answers with a Reply, and knows nothing of how either travelled. On the
 * server they come from and go back over the web (app.ts). In the phone app the pages hand them straight to
 * the same handlers, with no web in between (frontend/src/device).
 */
import type { IncomingMessage } from 'node:http';
import type { Kitchen } from '../../core/src/index.ts';
import type * as auth from './auth.ts';

const MAX_BODY_BYTES = 8 * 1024 * 1024; // room for the largest paste the kitchen accepts

/** A refusal with words for the person, as the pages expect them: { detail }. */
export class Refusal extends Error {
  readonly status: number;

  constructor(status: number, detail: string) {
    super(detail);
    this.status = status;
  }
}

export type Reply = { status?: number; json?: unknown; headers?: Record<string, string | string[]>; body?: Uint8Array };
export type Body = Record<string, unknown>;
export type Context = {
  /** The address asked for, without what follows a "?": /api/kitchen/recipes/12 */
  path: string;
  query: URLSearchParams;
  id: number;
  body: Body;
  /** The signed-in person. On the public addresses, where nobody may be signed in, this is never read. */
  user: auth.User;
  kitchen: Kitchen;
  /** What the browser or app calls itself, kept with a sign-in so a person can tell their devices apart. */
  userAgent?: string;
  /** The time, and the day where the person is. */
  clock: auth.Clock;
  token: string | undefined;
  ip: string;
  https: boolean;
  local: boolean;
  /** Where the person reached Life Is (https://life.example), for links back to it. */
  origin?: string;
};
export type Handler = (c: Context) => Promise<Reply>;
export type Route = [method: string, path: RegExp, handler: Handler];

// ---------- reading what was sent ----------

export const notUnderstood = (name: string) => new Refusal(422, `That couldn't be read: "${name}" is missing or isn't the right kind of thing`);
const given = (value: unknown) => value !== undefined && value !== null;

export const read = {
  text(body: Body, name: string): string {
    if (typeof body[name] !== 'string') throw notUnderstood(name);
    return body[name];
  },
  maybeText(body: Body, name: string): string | null {
    return given(body[name]) ? read.text(body, name) : null;
  },
  maybeNumber(body: Body, name: string): number | null {
    const value = body[name];
    if (!given(value)) return null;
    if (typeof value !== 'number' || !Number.isFinite(value)) throw notUnderstood(name);
    return value;
  },
  maybeWhole(body: Body, name: string): number | null {
    const value = read.maybeNumber(body, name);
    if (value !== null && !Number.isInteger(value)) throw notUnderstood(name);
    return value;
  },
  yesNo(body: Body, name: string, otherwise?: boolean): boolean {
    if (!given(body[name]) && otherwise !== undefined) return otherwise;
    if (typeof body[name] !== 'boolean') throw notUnderstood(name);
    return body[name];
  },
  /** A list of whole numbers (ids); nothing given is an empty list. */
  wholes(body: Body, name: string): number[] {
    const value = body[name];
    if (!given(value)) return [];
    if (!Array.isArray(value) || !value.every((item) => Number.isSafeInteger(item))) throw notUnderstood(name);
    return value as number[];
  },
  /** A set of named values ({ "12": "Linen" }); nothing given is an empty set. */
  record(body: Body, name: string): Record<string, unknown> {
    const value = body[name];
    if (!given(value)) return {};
    if (typeof value !== 'object' || Array.isArray(value)) throw notUnderstood(name);
    return value as Record<string, unknown>;
  },
  /** A list of sets of named values; nothing given is an empty list. */
  records(body: Body, name: string): Body[] {
    const value = body[name];
    if (!given(value)) return [];
    if (!Array.isArray(value) || !value.every((item) => typeof item === 'object' && item !== null && !Array.isArray(item))) throw notUnderstood(name);
    return value as Body[];
  },
  texts(body: Body, name: string): string[] {
    const value = body[name];
    if (!given(value)) return [];
    if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) throw notUnderstood(name);
    return value;
  },
};

export function queryNumber(query: URLSearchParams, name: string): number | null {
  const text = query.get(name);
  if (text === null || text === '') return null;
  const value = Number(text);
  if (!Number.isFinite(value)) throw notUnderstood(name);
  return value;
}

/** A paper kept with a thing (a scanned manual) may be larger than anything else that's sent. */
export const MAX_PAPER_BODY_BYTES = 18 * 1024 * 1024;

export async function readBody(req: IncomingMessage, most = MAX_BODY_BYTES): Promise<Body> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > most) throw new Refusal(413, "That's too much to send at once");
    chunks.push(chunk as Buffer);
  }
  if (size === 0) return {};
  let data: unknown;
  try {
    data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new Refusal(422, "That couldn't be read");
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) throw new Refusal(422, "That couldn't be read");
  return data as Body;
}
