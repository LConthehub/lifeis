/** What every address shares: how a request is read, how a refusal is worded, and what a handler is given. */
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

export type Reply = { status?: number; json?: unknown; headers?: Record<string, string | string[]>; body?: Buffer };
export type Body = Record<string, unknown>;
export type Context = {
  req: IncomingMessage;
  query: URLSearchParams;
  id: number;
  body: Body;
  /** The signed-in person. On the public addresses, where nobody may be signed in, this is never read. */
  user: auth.User;
  kitchen: Kitchen;
  token: string | undefined;
  ip: string;
  https: boolean;
  local: boolean;
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

export async function readBody(req: IncomingMessage): Promise<Body> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new Refusal(413, "That's too much to send at once");
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
