/**
 * Use Life Is from your AI app: the sign-in an AI app does (OAuth 2.1 with PKCE, as the open connector standard asks).
 *
 * - An app registers itself (RFC 7591), the person says yes on a page of their own, the app gets a one-time code
 *   and swaps it for an access token (good one hour) and a refresh token. Nothing here uses the session cookie.
 * - Tokens, codes and refresh tokens are random and shown once. Only their SHA-256 hashes are kept (as with a session
 *   or a personal key), so a copy of the database can't be used with them.
 * - A code is good for 5 minutes and works once, only for the app and address it was made for, only with the secret
 *   (PKCE verifier) the app made it with. Anything wrong with a code or a refresh token is the same answer: invalid_grant.
 * - A refresh token is swapped for a new one each time it is used. The old one still works for 60 seconds, in case the
 *   answer was lost on the way.
 * - A connection is refused the next request when the household switch is off, it was cut off, its token ran out, or
 *   it was left unused too long. Wrong tokens are counted per address and slowed down like wrong passwords.
 * - Each connection may make 60 calls a minute. Only the day of the last use is kept.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { atomic, checkConnection, CONNECTOR_SECTIONS, householdOn, MOST_CONNECTIONS, stillLive, type Db, type Live, type SectionId } from '../../core/src/index.ts';
import { todayOf } from '../../core/src/small.ts';
import { LoginThrottle, type Clock } from './auth.ts';
import { Refusal } from './http.ts';

export const ACCESS_PREFIX = 'lia_';
export const REFRESH_PREFIX = 'lir_';
export const CODE_PREFIX = 'lic_';
const ACCESS_FORMAT = /^lia_[A-Za-z0-9_-]{43}$/;
const REFRESH_FORMAT = /^lir_[A-Za-z0-9_-]{43}$/;
const CODE_FORMAT = /^lic_[A-Za-z0-9_-]{43}$/;
const CHALLENGE_FORMAT = /^[A-Za-z0-9_-]{43}$/;
const VERIFIER_FORMAT = /^[A-Za-z0-9\-._~]{43,128}$/;

export const ACCESS_SECONDS = 3600;
export const CODE_SECONDS = 300;
export const REFRESH_GRACE_SECONDS = 60;
export const MAX_CLIENT_NAME = 80;
export const MAX_REDIRECTS = 5;
export const REGISTRATIONS_PER_HOUR = 30;
export const CLIENT_KEEP_DAYS = 30;
export const PER_MINUTE = 60;

export const REFUSED = 'That connection is not working. Connect again from your AI app.';

/** Wrong tokens, codes and refresh tokens from one address: 20 free, then slower and slower. */
export const connectorThrottle = new LoginThrottle('connector', 20);

/** An answer in the shape OAuth asks for: { error, error_description }. */
export class OAuthError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(code: string, description: string, status = 400) {
    super(description);
    this.code = code;
    this.status = status;
  }
}

const hashOf = (secret: string) => createHash('sha256').update(secret, 'utf8').digest('hex');
const stamp = (at: Date) => at.toISOString().slice(0, 19) + '+00:00';
const later = (clock: Clock, seconds: number) => stamp(new Date(clock().getTime() + seconds * 1000));
const secret = (prefix: string) => prefix + randomBytes(32).toString('base64url');
const SECTION_IDS = CONNECTOR_SECTIONS.map((s) => s.id);
const sectionsOf = (text: string): SectionId[] => text.split(',').filter((id): id is SectionId => (SECTION_IDS as string[]).includes(id));

/** The token in `Authorization: Bearer <token>`, or undefined. */
export function bearerToken(header: string | string[] | undefined): string | undefined {
  const text = Array.isArray(header) ? header[0] : header;
  return /^Bearer[ \t]+(\S{1,200})[ \t]*$/i.exec(text ?? '')?.[1];
}

// ---------- registering an app (RFC 7591) ----------

/** Per address, when its last registrations were (in memory: a restart gives a fresh hour, which is fine). */
const registrationsOf = new WeakMap<Db, Map<string, number[]>>();
const memory = <K, V>(kept: WeakMap<Db, Map<K, V>>, db: Db): Map<K, V> => {
  let map = kept.get(db);
  if (!map) kept.set(db, map = new Map());
  return map;
};

/** A redirect address: https, or http on this computer (an app on a laptop), and nothing after a "#". */
function redirectOk(text: unknown): text is string {
  if (typeof text !== 'string' || text.length > 500) return false;
  let url: URL;
  try { url = new URL(text); } catch { return false; }
  if (url.hash || text.includes('#') || url.username || url.password) return false;
  if (url.protocol === 'https:') return true;
  return url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname);
}

export type Registered = { client_id: string; client_name: string; redirect_uris: string[]; client_id_issued_at: number };

export async function registerClient(db: Db, input: { client_name?: unknown; redirect_uris?: unknown }, ip: string, clock: Clock): Promise<Registered> {
  const now = clock().getTime();
  const registrations = memory(registrationsOf, db);
  const times = (registrations.get(ip) ?? []).filter((t) => now - t < 3_600_000);
  if (times.length >= REGISTRATIONS_PER_HOUR) throw new OAuthError('invalid_request', 'Too many apps were registered from this address. Try again later.', 429);
  times.push(now);
  registrations.set(ip, times);
  if (registrations.size > 10_000) for (const [key, list] of registrations) if (list.every((t) => now - t >= 3_600_000)) registrations.delete(key);

  const uris = input.redirect_uris;
  if (!Array.isArray(uris) || uris.length === 0) throw new OAuthError('invalid_redirect_uri', 'redirect_uris is needed');
  if (uris.length > MAX_REDIRECTS) throw new OAuthError('invalid_redirect_uri', `At most ${MAX_REDIRECTS} redirect addresses`);
  if (!uris.every(redirectOk)) throw new OAuthError('invalid_redirect_uri', 'Each redirect address must start with https:// (or be http:// on localhost) and have no #');
  if (input.client_name !== undefined && typeof input.client_name !== 'string') throw new OAuthError('invalid_client_metadata', 'client_name must be text');
  const name = [...(input.client_name ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim()].slice(0, MAX_CLIENT_NAME).join('') || 'An AI app';
  const redirects = [...new Set(uris)] as string[];

  const clientId = 'lcl_' + randomBytes(16).toString('base64url');
  const day = 86_400_000;
  await atomic(db, async (tx) => {
    // Apps nobody ever connected are forgotten after a month.
    await tx.run('DELETE FROM ai_clients WHERE created_at < ? AND client_id NOT IN (SELECT client_id FROM ai_connections)',
      [stamp(new Date(now - CLIENT_KEEP_DAYS * day))]);
    await tx.run('INSERT INTO ai_clients (client_id, name, redirect_uris, created_at) VALUES (?, ?, ?, ?)',
      [clientId, name, JSON.stringify(redirects), stamp(new Date(now))]);
  });
  return { client_id: clientId, client_name: name, redirect_uris: redirects, client_id_issued_at: Math.floor(now / 1000) };
}

export type Client = { client_id: string; name: string; redirect_uris: string[] };

export async function findClient(db: Db, clientId: string): Promise<Client | undefined> {
  const row = await db.get<{ client_id: string; name: string; redirect_uris: string }>(
    'SELECT client_id, name, redirect_uris FROM ai_clients WHERE client_id = ?', [clientId]);
  if (!row) return undefined;
  let uris: unknown;
  try { uris = JSON.parse(row.redirect_uris); } catch { uris = []; }
  return { client_id: row.client_id, name: row.name, redirect_uris: Array.isArray(uris) ? uris.filter((u): u is string => typeof u === 'string') : [] };
}

// ---------- the person says yes: a code ----------

export type Asking = { client_id: string; redirect_uri: string; code_challenge: string; code_challenge_method: string };

/** Checks what the app asked for against what it registered. Throws plain words for the person (Refusal). */
export async function checkAsking(db: Db, asked: Partial<Record<keyof Asking, string | null>>): Promise<Client> {
  const client = asked.client_id ? await findClient(db, asked.client_id) : undefined;
  if (!client) throw new Refusal(400, "That AI app isn't known here. Start again from the app.");
  if (!asked.redirect_uri || !client.redirect_uris.includes(asked.redirect_uri)) {
    throw new Refusal(400, "That AI app asked to go back to an address it didn't register. Nothing was shared.");
  }
  return client;
}

export function checkChallenge(asked: { code_challenge?: string | null; code_challenge_method?: string | null }): string {
  if (asked.code_challenge_method !== 'S256' || !asked.code_challenge || !CHALLENGE_FORMAT.test(asked.code_challenge)) {
    throw new Refusal(400, "That AI app didn't use the safe sign-in Life Is asks for. Nothing was shared.");
  }
  return asked.code_challenge;
}

/** Makes the connection and its one-time code, for the person who said yes. The code is in the answer once and nowhere else. */
export async function makeCode(db: Db, owner: number, asked: Asking, input: { name?: string | null; sections?: string[]; may_add?: boolean }, clock: Clock): Promise<string> {
  const client = await checkAsking(db, asked);
  const challenge = checkChallenge(asked);
  const chosen = checkConnection(input);
  const code = secret(CODE_PREFIX);
  const today = todayOf(clock);
  await atomic(db, async (tx) => {
    // A yes that was never followed by the app is forgotten once its code ran out.
    await tx.run('DELETE FROM ai_connections WHERE ended_at IS NULL AND refresh_hash IS NULL AND (code_hash IS NULL OR code_expires_at < ?)', [stamp(clock())]);
    const rows = await tx.all<{ ended_at: string | null; created_at: string; last_used_on: string | null }>(
      'SELECT ended_at, created_at, last_used_on FROM ai_connections WHERE owner_id = ?', [owner]);
    if (rows.filter((r) => stillLive(r, today)).length >= MOST_CONNECTIONS) {
      throw new Refusal(400, `That's ${MOST_CONNECTIONS} connections. Cut one off that you don't use first.`);
    }
    await tx.run(
      `INSERT INTO ai_connections (owner_id, client_id, app_name, name, sections, may_add, code_hash, code_challenge, code_redirect, code_expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [owner, client.client_id, client.name, chosen.name, chosen.sections.join(','), chosen.may_add ? 1 : 0, hashOf(code), challenge,
        asked.redirect_uri, later(clock, CODE_SECONDS), stamp(clock())]);
  });
  return code;
}

// ---------- the app swaps a code, or a refresh token, for tokens ----------

export type Tokens = { access_token: string; token_type: 'Bearer'; expires_in: number; refresh_token: string };

async function waitIfSlowed(db: Db, ip: string, clock: Clock): Promise<void> {
  const wait = await connectorThrottle.secondsLocked(db, ip, clock);
  if (wait) throw new OAuthError('invalid_request', `Too many wrong attempts. Try again in ${wait} seconds.`, 429);
}
async function wrong(db: Db, ip: string, clock: Clock): Promise<never> {
  await connectorThrottle.failure(db, ip, clock);
  throw new OAuthError('invalid_grant', 'That code or token is not good.');
}

function sameSecret(a: string, b: string): boolean {
  const x = Buffer.from(a, 'utf8');
  const y = Buffer.from(b, 'utf8');
  return x.length === y.length && timingSafeEqual(x, y);
}

export async function exchangeCode(db: Db, input: { code?: string; code_verifier?: string; client_id?: string; redirect_uri?: string }, ip: string, clock: Clock): Promise<Tokens> {
  await waitIfSlowed(db, ip, clock);
  const { code, code_verifier: verifier } = input;
  if (!code || !CODE_FORMAT.test(code)) return wrong(db, ip, clock);
  const hash = hashOf(code);
  // Every try uses the code up, right or wrong.
  const found = await atomic(db, async (tx) => {
    const row = await tx.get<{ id: number; client_id: string; code_challenge: string | null; code_redirect: string | null; code_expires_at: string | null }>(
      'SELECT id, client_id, code_challenge, code_redirect, code_expires_at FROM ai_connections WHERE code_hash = ? AND ended_at IS NULL', [hash]);
    if (!row) return undefined;
    const used = await tx.run(
      'UPDATE ai_connections SET code_hash = NULL, code_challenge = NULL, code_redirect = NULL, code_expires_at = NULL WHERE id = ? AND code_hash = ?', [row.id, hash]);
    return used.changes ? row : undefined;
  });
  if (!found) return wrong(db, ip, clock);
  const good = Boolean(found.code_expires_at && found.code_expires_at >= stamp(clock()) && found.code_challenge && found.code_redirect
    && input.client_id === found.client_id && input.redirect_uri === found.code_redirect
    && verifier && VERIFIER_FORMAT.test(verifier)
    && sameSecret(createHash('sha256').update(verifier, 'utf8').digest('base64url'), found.code_challenge));
  if (!good) {
    await db.run('DELETE FROM ai_connections WHERE id = ? AND refresh_hash IS NULL', [found.id]);
    return wrong(db, ip, clock);
  }
  const tokens = newTokens();
  await db.run('UPDATE ai_connections SET access_hash = ?, access_expires_at = ?, refresh_hash = ? WHERE id = ?',
    [hashOf(tokens.access_token), later(clock, ACCESS_SECONDS), hashOf(tokens.refresh_token), found.id]);
  return tokens;
}

const newTokens = (): Tokens =>
  ({ access_token: secret(ACCESS_PREFIX), token_type: 'Bearer', expires_in: ACCESS_SECONDS, refresh_token: secret(REFRESH_PREFIX) });

/** Ends a connection and forgets everything that could sign it in. The row stays, so the log can still name it. */
async function end(db: Db, id: number, clock: Clock): Promise<void> {
  await db.run(
    `UPDATE ai_connections SET ended_at = ?, access_hash = NULL, access_expires_at = NULL, refresh_hash = NULL, old_refresh_hash = NULL, old_refresh_until = NULL,
       code_hash = NULL, code_challenge = NULL, code_redirect = NULL, code_expires_at = NULL WHERE id = ? AND ended_at IS NULL`, [stamp(clock()), id]);
}

export async function refresh(db: Db, input: { refresh_token?: string; client_id?: string }, ip: string, clock: Clock): Promise<Tokens> {
  await waitIfSlowed(db, ip, clock);
  const token = input.refresh_token;
  if (!token || !REFRESH_FORMAT.test(token)) return wrong(db, ip, clock);
  const hash = hashOf(token);
  const row = await db.get<{ id: number; client_id: string; ended_at: string | null; created_at: string; last_used_on: string | null; refresh_hash: string | null; old_refresh_hash: string | null; old_refresh_until: string | null }>(
    `SELECT id, client_id, ended_at, created_at, last_used_on, refresh_hash, old_refresh_hash, old_refresh_until FROM ai_connections
     WHERE refresh_hash = ? OR (old_refresh_hash = ? AND old_refresh_until >= ?)`, [hash, hash, stamp(clock())]);
  if (!row || row.ended_at || (input.client_id && input.client_id !== row.client_id)) return wrong(db, ip, clock);
  if (!(await householdOn(db))) return wrong(db, ip, clock);
  if (!stillLive(row, todayOf(clock))) {
    await end(db, row.id, clock);
    return wrong(db, ip, clock);
  }
  const tokens = newTokens();
  // The one that was current is kept for a minute more. Two tries at once with the same token can't both win.
  const moved = await db.run(
    `UPDATE ai_connections SET access_hash = ?, access_expires_at = ?, refresh_hash = ?, old_refresh_hash = ?, old_refresh_until = ?
     WHERE id = ? AND refresh_hash IS ?`,
    [hashOf(tokens.access_token), later(clock, ACCESS_SECONDS), hashOf(tokens.refresh_token), row.refresh_hash, later(clock, REFRESH_GRACE_SECONDS), row.id, row.refresh_hash]);
  if (!moved.changes) return wrong(db, ip, clock);
  return tokens;
}

// ---------- using a token ----------

/** Per connection, when its last calls were (in memory: a restart gives a fresh minute, which is fine). */
const recentOf = new WeakMap<Db, Map<number, number[]>>();

/**
 * Who a token is, if it is good. Anything else is the same refusal (401), and a wrong one is counted against the address.
 * Counts as a use: the day it was last used is kept (the day only, nothing else about the call).
 */
export async function useToken(db: Db, token: string | undefined, ip: string, clock: Clock): Promise<Live> {
  const wait = await connectorThrottle.secondsLocked(db, ip, clock);
  if (wait) throw new Refusal(429, `Too many wrong tokens. Try again in ${wait} seconds.`);
  const hash = token && ACCESS_FORMAT.test(token) ? hashOf(token) : '';
  const row = hash
    ? await db.get<{ id: number; owner_id: number; name: string; sections: string; may_add: number; created_at: string; last_used_on: string | null; ended_at: string | null; access_expires_at: string | null }>(
      'SELECT id, owner_id, name, sections, may_add, created_at, last_used_on, ended_at, access_expires_at FROM ai_connections WHERE access_hash = ?', [hash])
    : undefined;
  if (!row) {
    // An app's first call carries no token at all (that is how it finds out where to sign in), so only a wrong one is counted.
    if (token) await connectorThrottle.failure(db, ip, clock);
    throw new Refusal(401, REFUSED);
  }
  if (row.ended_at || !row.access_expires_at || row.access_expires_at < stamp(clock()) || !(await householdOn(db))) throw new Refusal(401, REFUSED);
  const day = todayOf(clock);
  if (!stillLive(row, day)) {
    await end(db, row.id, clock);
    throw new Refusal(401, REFUSED);
  }
  const now = clock().getTime();
  const recent = memory(recentOf, db);
  const times = (recent.get(row.id) ?? []).filter((t) => now - t < 60_000);
  if (times.length >= PER_MINUTE) throw new Refusal(429, 'This connection is being used too fast. Wait a minute.');
  times.push(now);
  recent.set(row.id, times);
  if (row.last_used_on !== day) await db.run('UPDATE ai_connections SET last_used_on = ? WHERE id = ?', [day, row.id]);
  return { id: row.id, owner: row.owner_id, name: row.name, sections: sectionsOf(row.sections), may_add: row.may_add === 1 };
}
