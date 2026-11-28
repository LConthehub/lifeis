/**
 * Life Is: the program. Sign-in and the kitchen, on an encrypted database, on your own computer.
 *
 * Everything under /api needs a session, except the few PUBLIC_PATHS. The first account made is the admin.
 * The addresses, what they take and what they answer are the ones the Python server had (backend/main.py and
 * backend/kitchen.py), so the pages don't know the difference. The kitchen itself is core/.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { BlockList, isIP } from 'node:net';
import { busyFor, busyHtml, manualFor, manualHtml } from '../../core/src/index.ts';
import type { PushSender } from '../../core/src/index.ts';
import { atomic, feedFor, kitchen, Problem, shownName, type Db, type Sealer } from '../../core/src/index.ts';
import * as auth from './auth.ts';
import { sealerFromEnvironment, secondStepOn } from './secondStep.ts';
import { securityRoutes } from './securityRoutes.ts';
import { keyRoutes, voiceRoutes } from './keyRoutes.ts';
import { connectorPublic, connectorRoutes } from './connectorRoutes.ts';
import { bearer, REFUSED, useKey, type KeyUse } from './personalKeys.ts';
import type { MailTools } from './mailRoutes.ts';
import { notUnderstood, read, readBody, MAX_PAPER_BODY_BYTES, Refusal, type Context, type Reply, type Route } from './http.ts';
import type { Reach } from './connectionRoutes.ts';
import { cookTimers, type CookTimers } from './cookTimers.ts';
import { cookingTimerRoutes, sendFinished } from './cookingTimerRoutes.ts';
import { everydayRoutes } from './everydayRoutes.ts';
import { backupCopyRoutes } from './backupCopyRoutes.ts';
import type { CopyTools } from '../../core/src/index.ts';
import { pages } from './pages.ts';
import { zip } from './zip.ts';

const PUBLIC_PATHS = new Set(['/api/health', '/api/auth/status', '/api/auth/setup', '/api/auth/login', '/api/auth/logout',
  // The second step of signing in, and signing in with a passkey: asked before anybody is signed in.
  '/api/auth/second-step', '/api/auth/second-step/passkey/begin', '/api/auth/second-step/passkey/finish',
  '/api/auth/passkey/begin', '/api/auth/passkey/finish']);
const PASSKEY_PATHS = /^\/api\/(auth\/(passkey|second-step\/passkey)\/(begin|finish)|security\/passkeys\/(begin|finish))$/;
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-store',
};

export type Options = {
  db: Db;
  /** The folder of built pages to serve. Left out: only /api is answered. */
  staticDir?: string;
  /** Sign a session out after this many unused minutes, unless the person chose their own. */
  idleMinutes?: number;
  /** Addresses of proxies in front of Life Is, comma separated. Left out: the TRUSTED_PROXY setting, else none. */
  trustedProxy?: string;
  clock?: auth.Clock;
  /** How Life Is reaches a media server and locks its key. Left out: media servers can't be connected. */
  reach?: Reach;
  /** How Life Is talks to mail providers and locks an account's password. Left out: email can't be set up. */
  mail?: MailTools;
  /** How the second backup copy is carried and its secrets locked. Left out (and in the demo): it isn't offered. */
  backupCopy?: CopyTools;
  /** How Life Is reaches a photo library and locks its key. Left out: none can be connected. */
  photos?: Reach;
  /** How Life Is reads another calendar's link and locks it. Left out: none can be followed. */
  calendars?: Reach;
  /** How Life Is reads bank accounts through SimpleFIN and locks the access address. Left out: it can't be turned on. */
  bank?: Reach & { allowLocal?: boolean };
  /** How the assistant reaches a model and locks its key. Left out: it can't be turned on. */
  assistant?: Reach;
  /** How a browser is sent a reminder. Left out: browsers can't be sent any. */
  push?: { publicKey: string; send: PushSender };
  /** A demo for anyone to try: its sign-in is offered on the sign-in page, and a few things are refused. See demo.ts. */
  demo?: { username: string; password: string };
  /** Locks the secret of a person's authenticator app. Left out: the vault in the same key folder main.ts uses. */
  sealer?: Sealer;
  /** Cooking timers. Left out: the server keeps its own, in its memory. A test gives one with a clock it can move. */
  timers?: CookTimers;
  /** Told about anything that went wrong inside Life Is itself (never about a person's mistake). */
  onError?: (problem: unknown) => void;
  /** Told one line per step an AI app takes to sign in or call Life Is (see connectorNote). Left out: nothing is noted. */
  note?: (line: string) => void;
};

/**
 * The addresses an AI app uses while it connects, or might try: the connector's own, and the ones the open
 * standard falls back to when it can't find them.
 */
const CONNECTOR_STEPS = /^\/(mcp|connect|oauth\/|\.well-known\/|register$|authorize$|token$|api\/connector\/(request|allow|deny)$)/;
/**
 * One line about a step an AI app took: when, the method and address, the answer's status, the app's own name for
 * itself, and the plain reason when it was refused. Never what was sent: no tokens, codes, data or query strings.
 */
export function connectorNote(at: Date, method: string, path: string, status: number, userAgent: string | undefined, reason: string | undefined): string {
  const clip = (text: string | undefined, most: number) => (text ?? '').replace(/[\u0000-\u001f\u007f"]/g, ' ').slice(0, most);
  return `[connector] ${at.toISOString()} ${method} ${clip(path, 120)} -> ${status} app="${clip(userAgent, 60)}"${reason ? ` why="${clip(reason, 160)}"` : ''}`;
}

// ---------- who is asking, and from where ----------

const NEARBY = new BlockList();
NEARBY.addSubnet('127.0.0.0', 8, 'ipv4');
NEARBY.addSubnet('10.0.0.0', 8, 'ipv4');
NEARBY.addSubnet('172.16.0.0', 12, 'ipv4');
NEARBY.addSubnet('192.168.0.0', 16, 'ipv4');
NEARBY.addSubnet('169.254.0.0', 16, 'ipv4');
NEARBY.addAddress('::1', 'ipv6');
NEARBY.addSubnet('fc00::', 7, 'ipv6');
NEARBY.addSubnet('fe80::', 10, 'ipv6');

function plainAddress(address: string): string {
  return address.startsWith('::ffff:') && isIP(address.slice(7)) === 4 ? address.slice(7) : address;
}

function clientIp(req: IncomingMessage): string {
  return plainAddress(req.socket.remoteAddress ?? '?');
}

/** The addresses in a TRUSTED_PROXY setting: comma separated, anything that is not an address left out. */
export function parseProxies(setting: string | undefined): Set<string> {
  const found = new Set<string>();
  for (const part of (setting ?? '').split(',')) {
    const address = plainAddress(part.trim());
    if (isIP(address) !== 0) found.add(address);
  }
  return found;
}

/**
 * Who is asking, for counting wrong guesses. The connecting address, unless it is a proxy the person in charge
 * named (TRUSTED_PROXY). Then it is the right-most address in X-Forwarded-For that is not itself a trusted proxy.
 * From any other address the header is ignored, so a visitor can't pick their own.
 */
export function visitorIp(req: IncomingMessage, proxies: Set<string>): string {
  const connecting = clientIp(req);
  if (proxies.size === 0 || !proxies.has(connecting)) return connecting;
  const header = req.headers['x-forwarded-for'];
  const hops = (Array.isArray(header) ? header.join(',') : header ?? '').split(',').map((hop) => plainAddress(hop.trim()));
  for (let i = hops.length - 1; i >= 0; i--) {
    const hop = hops[i]!;
    if (isIP(hop) === 0) return connecting;
    if (!proxies.has(hop)) return hop;
  }
  return connecting;
}

/**
 * Opened on this computer (or from the home network), not through a web address. Requests that come through
 * a reverse proxy such as Caddy carry X-Forwarded-For, so they never count as local.
 */
function isLocal(req: IncomingMessage): boolean {
  if (req.headers['x-forwarded-for'] || req.headers.forwarded) return false;
  const ip = clientIp(req);
  const family = isIP(ip);
  return family !== 0 && NEARBY.check(ip, family === 4 ? 'ipv4' : 'ipv6');
}

const isHttps = (req: IncomingMessage) => String(req.headers['x-forwarded-proto'] ?? '').split(',')[0]!.trim().toLowerCase() === 'https';

function cookie(req: IncomingMessage, name: string): string | undefined {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const at = part.indexOf('=');
    if (at !== -1 && part.slice(0, at).trim() === name) return part.slice(at + 1).trim();
  }
  return undefined;
}

function checkNew(username: string, password: string) {
  if (username.length < 2 || username.length > 50 || !/^[\p{L}\p{N}._-]+$/u.test(username) || !/[\p{L}\p{N}]/u.test(username)) {
    throw new Refusal(400, 'Username must be 2–50 letters, numbers, dots, dashes or underscores');
  }
  if (password.length < auth.MIN_PASSWORD_LENGTH) throw new Refusal(400, `Password must be at least ${auth.MIN_PASSWORD_LENGTH} characters`);
}

export function createApp(options: Options) {
  const { db } = options;
  const clock = options.clock ?? (() => new Date());
  const idleDefault = options.idleMinutes ?? 15;
  const proxies = parseProxies(options.trustedProxy ?? process.env.TRUSTED_PROXY);
  const page = options.staticDir ? pages(options.staticDir) : null;
  const now = () => clock().toISOString().slice(0, 19) + '+00:00';

  const sessionCookie = (c: Context, token: string) =>
    `${auth.SESSION_COOKIE}=${token}; Max-Age=${auth.SESSION_DAYS * 86400}; Path=/; HttpOnly; SameSite=Lax${c.https ? '; Secure' : ''}`;

  async function signIn(c: Context, userId: number, method = 'password'): Promise<Record<string, string>> {
    const token = await auth.createSession(db, userId, { method, ip: c.ip, userAgent: c.userAgent }, clock);
    return { 'Set-Cookie': sessionCookie(c, token) };
  }

  // Cooking timers: kept in memory, and sent out the person's own ways (browser push, ntfy) when one ends.
  const timers = options.timers ?? cookTimers({ notify: sendFinished(db, { fetcher: options.reach?.fetcher, push: options.push?.send, clock, onError: options.onError ?? console.error }) });

  // Two-step sign-in and passkeys (securityRoutes.ts).
  const security = securityRoutes(db, { clock, sealer: () => options.sealer ?? sealerFromEnvironment(), demo: Boolean(options.demo), signIn });

  const account = async (c: Context): Promise<Reply> =>
    ({ json: { idle_minutes: await auth.idleMinutesFor(db, c.user.id, idleDefault), idle_choices: auth.IDLE_CHOICES } });

  /** How outside services are asked. Without it (no `reach`), none can be turned on. */
  const outside = options.reach?.fetcher;

  const routes: Route[] = [
    ['GET', /^\/api\/health$/, async () => ({ json: { status: 'ok' } })],

    // ==================== THE FRONT DOOR ====================

    ['GET', /^\/api\/auth\/status$/, async (c) => {
      const people = (await db.get<{ n: number }>('SELECT COUNT(*) AS n FROM users'))!.n;
      return { json: { setup_required: people === 0, local: c.local, user: await auth.userForToken(db, c.token, clock, idleDefault, false),
        // A demo says so, and hands out its sign-in: it is the same for everyone and opens only made-up data.
        ...(options.demo ? { demo: options.demo } : {}) } };
    }],

    // Make the first (admin) account. Only works while there are none, and only on this computer: otherwise
    // whoever found the web address first could make themselves the admin.
    ['POST', /^\/api\/auth\/setup$/, async (c) => {
      if (!c.local) throw new Refusal(403, 'Make the first account on the computer Life Is runs on (http://localhost:8020)');
      const username = read.text(c.body, 'username').trim().toLowerCase();
      const password = read.text(c.body, 'password');
      checkNew(username, password);
      const hash = await auth.hashPassword(password);
      const id = await atomic(db, async (tx) => {
        if ((await tx.get<{ n: number }>('SELECT COUNT(*) AS n FROM users'))!.n > 0) throw new Refusal(403, 'Setup has already been done');
        return (await tx.run('INSERT INTO users (username, password_hash, is_admin, created_at) VALUES (?, ?, 1, ?)', [username, hash, now()])).lastId;
      });
      return { status: 201, json: { id, username, name: username, is_admin: true }, headers: await signIn(c, id) };
    }],

    ['POST', /^\/api\/auth\/login$/, async (c) => {
      const username = read.text(c.body, 'username').trim().toLowerCase();
      const password = read.text(c.body, 'password');
      const pair = `${username}|${c.ip}`;
      const counted: [auth.LoginThrottle, string][] = [[auth.pairThrottle, pair], [auth.ipThrottle, c.ip], [auth.userThrottle, username]];
      let wait = 0;
      for (const [throttle, key] of counted) wait = Math.max(wait, await throttle.secondsLocked(db, key, clock));
      if (wait) throw new Refusal(429, `Too many failed attempts. Try again in ${wait} seconds.`);
      const user = await auth.checkLogin(db, username, password);
      if (!user) {
        for (const [throttle, key] of counted) await throttle.failure(db, key, clock);
        throw new Refusal(401, 'Wrong username or password');
      }
      // With two-step on, the password is only the first step: no session yet, and the failures stay counted
      // until the second step is right (otherwise a stranger who knows the password could clear them by
      // signing in again, and guess codes without limit).
      if (await secondStepOn(db, user.id)) return security.askForSecondStep(user.id);
      for (const [throttle, key] of counted) await throttle.success(db, key);
      // Told something an admin did (their two-step was turned off), when there is something to tell.
      return security.signedIn(c, user.id, 'password');
    }],

    ['POST', /^\/api\/auth\/logout$/, async (c) => {
      await auth.deleteSession(db, c.token);
      return { status: 204, headers: { 'Set-Cookie': `${auth.SESSION_COOKIE}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax` } };
    }],

    ['POST', /^\/api\/auth\/change-password$/, async (c) => {
      const current = read.text(c.body, 'current_password');
      const next = read.text(c.body, 'new_password');
      if (next.length < auth.MIN_PASSWORD_LENGTH) throw new Refusal(400, `Password must be at least ${auth.MIN_PASSWORD_LENGTH} characters`);
      const found = await auth.checkLogin(db, c.user.username, current);
      if (!found || found.id !== c.user.id) throw new Refusal(400, 'Current password is wrong');
      await db.run('UPDATE users SET password_hash = ? WHERE id = ?', [await auth.hashPassword(next), c.user.id]);
      await auth.deleteUserSessions(db, c.user.id, c.token);
      return { status: 204 };
    }],

    // An admin adds someone else in the household, with their own kitchen.
    ['POST', /^\/api\/users$/, async (c) => {
      if (!c.user.is_admin) throw new Refusal(403, 'Only the admin can add people');
      const username = read.text(c.body, 'username').trim().toLowerCase();
      const password = read.text(c.body, 'password');
      checkNew(username, password);
      const hash = await auth.hashPassword(password);
      const id = await atomic(db, async (tx) => {
        if (await tx.get('SELECT 1 AS taken FROM users WHERE username = ?', [username])) throw new Refusal(409, 'That username is taken');
        return (await tx.run('INSERT INTO users (username, password_hash, is_admin, created_at) VALUES (?, ?, 0, ?)', [username, hash, now()])).lastId;
      });
      return { status: 201, json: { id, username, name: username, is_admin: false } };
    }],

    ...security.routes,

    // Personal keys for a voice shortcut, and the few addresses a key opens (keyRoutes.ts).
    ...keyRoutes(db, { clock, demo: Boolean(options.demo) }),
    ...voiceRoutes(db),

    // Use Life Is from your AI app: this person's connections (connectorRoutes.ts). The public addresses an AI app uses are in handle().
    ...connectorRoutes(db, { clock, demo: Boolean(options.demo) }),

    ['GET', /^\/api\/account$/, account],
    ['PUT', /^\/api\/account$/, async (c) => {
      const minutes = read.maybeWhole(c.body, 'idle_minutes');
      if (minutes === null) throw notUnderstood('idle_minutes');
      if (!auth.IDLE_CHOICES.includes(minutes)) throw new Refusal(400, 'Choose one of the offered times');
      await db.run(
        `INSERT INTO user_settings (user_id, key, value) VALUES (?, 'idle_minutes', ?)
         ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value`, [c.user.id, String(minutes)]);
      return account(c);
    }],

    // Every recipe as a zip file. Kept here because making the zip is the server's own work.
    ['GET', /^\/api\/kitchen\/recipes-export\.zip$/, async (c) => ({
      body: zip(await c.kitchen.exportRecipes(), c.clock()),
      headers: { 'Content-Type': 'application/zip', 'Content-Disposition': 'attachment; filename="lifeis-recipes.zip"' },
    })],

    ...cookingTimerRoutes(timers),
    ...backupCopyRoutes(db, options.backupCopy),
    ...everydayRoutes(db, { fetcher: outside, reach: options.reach, mail: options.mail, photos: options.photos, calendars: options.calendars, bank: options.bank, assistant: options.assistant, push: options.push }),
  ];

  /**
   * The clock for one request: the server's time, and the day where the person is. The pages send their day
   * (X-Local-Day). It is believed only when it's the server's day or a neighbour of it, which is as far as
   * any two places on Earth can differ; anything else is ignored.
   */
  function clockFor(req: IncomingMessage): auth.Clock {
    const said = String(req.headers['x-local-day'] ?? '');
    const here = Date.UTC(Number(said.slice(0, 4)), Number(said.slice(5, 7)) - 1, Number(said.slice(8, 10)));
    const server = clock();
    const serverDay = Date.UTC(server.getUTCFullYear(), server.getUTCMonth(), server.getUTCDate());
    if (!/^\d{4}-\d{2}-\d{2}$/.test(said) || !(Math.abs(here - serverDay) <= 86_400_000)) return clock;
    return Object.assign(() => clock(), { today: () => said });
  }

  async function answerApi(req: IncomingMessage, url: URL, path: string): Promise<Reply> {
    const method = req.method ?? 'GET';
    // Refuse changes that another website started.
    if (!SAFE_METHODS.has(method) && ['cross-site', 'same-site'].includes(String(req.headers['sec-fetch-site']))) {
      throw new Refusal(403, 'That was blocked because it came from another website.');
    }
    // A demo is shared by strangers: nobody may lock the others out, add people, or use it to put words on a
    // public page.
    if (options.demo && !SAFE_METHODS.has(method)) {
      if (path === '/api/auth/change-password') throw new Refusal(403, "The demo's password can't be changed: everyone shares it");
      if (path === '/api/auth/setup' || path === '/api/users') throw new Refusal(403, "People can't be added to the demo");
      if (path === '/api/account/name') throw new Refusal(403, "The demo's name can't be changed: everyone shares it");
      if (path === '/api/busy/link') throw new Refusal(403, "The demo's busy times can't be shared by a link. In your own Life Is they can.");
      if (path === '/api/manual/share') throw new Refusal(403, "The demo's manual can't be shared by a link. In your own Life Is it can.");
      // Two-step sign-in and passkeys would let one visitor lock the others out of the shared account.
      if (path.startsWith('/api/security/')) throw new Refusal(403, "Sign-in security can't be changed in the demo: everyone shares its account");
    }
    // A passkey is tied to the address it was made at. A browser says where it is calling from; if that isn't
    // the address this request was sent to, it is refused (the check on the passkey itself is stricter still).
    if (PASSKEY_PATHS.test(path) && req.headers.origin !== undefined
      && req.headers.origin !== (req.headers.host ? `${isHttps(req) ? 'https' : 'http'}://${String(req.headers.host).slice(0, 200)}` : null)) {
      throw new Refusal(403, "That was blocked because it didn't come from this address.");
    }
    const token = cookie(req, auth.SESSION_COOKIE);
    let user: auth.User | null = null;
    let key: KeyUse | undefined;
    if (path.startsWith('/api/voice/')) {
      // A voice address answers to a personal key and to nothing else (no cookie), as the person the key belongs to.
      if (options.demo) throw new Refusal(403, "Voice keys don't work in the demo");
      // Only for an address that is real, so a typo is not counted as a wrong key.
      if (!routes.some(([m, pattern]) => m === method && pattern.test(path))) throw new Refusal(404, 'Not found');
      key = await useKey(db, bearer(req.headers.authorization), visitorIp(req, proxies), clock);
      const owner = await db.get<{ id: number; username: string; name: string; is_admin: number }>(
        `SELECT u.id, u.username, ${shownName('u')} AS name, u.is_admin FROM users u WHERE u.id = ?`, [key.owner]);
      if (!owner) throw new Refusal(401, REFUSED);
      user = { ...owner, is_admin: Boolean(owner.is_admin) };
    } else if (!PUBLIC_PATHS.has(path)) {
      user = await auth.userForToken(db, token, clock, idleDefault, req.headers['x-background'] !== '1');
      if (!user) throw new Refusal(401, 'You are signed out. Sign in again.');
    }
    const here = routes.filter(([, pattern]) => pattern.test(path));
    if (here.length === 0) throw new Refusal(404, 'Not found');
    const route = here.find(([m]) => m === method);
    if (!route) throw new Refusal(405, 'Method not allowed');
    const signedIn = user ?? { id: 0, username: '', name: '', is_admin: false };
    const theirClock = clockFor(req);
    return route[2]({
      path, userAgent: String(req.headers['user-agent'] ?? '') || undefined, query: url.searchParams, id: Number(route[1].exec(path)![1] ?? 0), body: SAFE_METHODS.has(method) ? {} : await readBody(req, /^\/api\/things\/items\/\d+\/documents$/.test(path) ? MAX_PAPER_BODY_BYTES : undefined),
      user: signedIn, key, kitchen: kitchen(db, signedIn.id, theirClock), clock: theirClock, token, ip: visitorIp(req, proxies), https: isHttps(req), local: isLocal(req),
      origin: req.headers.host ? `${isHttps(req) ? 'https' : 'http'}://${String(req.headers.host).slice(0, 200)}` : undefined,
    });
  }

  const connectorAddresses = connectorPublic(db, { clock, demo: Boolean(options.demo) });

  return async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    let url: URL;
    try {
      url = new URL(req.url ?? '/', 'http://lifeis');
    } catch {
      res.writeHead(400).end();
      return;
    }
    const path = url.pathname.replace(/\/+$/, '') || '/';
    const api = path === '/api' || path.startsWith('/api/');
    // The calendar link: the long random part of the address is the only key, since a calendar app can't sign in.
    const feed = /^\/cal\/([0-9a-f]{64})\.ics$/.exec(path);
    // The shared house manual: the same kind of link, for a sitter or a guest, who can't sign in either.
    const shared = /^\/m\/([0-9a-f]{64})$/.exec(path);
    // The shared busy-times page: the same kind of link, and it holds times only.
    const busy = /^\/b\/([0-9a-f]{64})$/.exec(path);

    let reply: Reply;
    try {
      if (api) {
        reply = await answerApi(req, url, path);
      } else if (connectorAddresses.owns(path)) {
        // An AI app's own addresses: no cookie is read, and the cross-site check of /api doesn't apply (a token is the only key).
        const host = req.headers.host ? String(req.headers.host).slice(0, 200) : undefined;
        reply = await connectorAddresses.answer(req, path, { ip: visitorIp(req, proxies), origin: host && /^[\w.\-:[\]]+$/.test(host) ? `${isHttps(req) ? 'https' : 'http'}://${host}` : undefined });
      } else if (feed && (req.method === 'GET' || req.method === 'HEAD')) {
        const host = String(req.headers.host ?? '');
        const text = await feedFor(db, feed[1]!, clock, /^[\w.\-:[\]]+$/.test(host) ? `${isHttps(req) ? 'https' : 'http'}://${host}` : '');
        if (text === null) throw new Refusal(404, 'Not found');
        reply = { body: Buffer.from(text, 'utf8'), headers: { ...SECURITY_HEADERS, 'Content-Type': 'text/calendar; charset=utf-8', 'Cache-Control': 'private, no-store' } };
      } else if (shared && (req.method === 'GET' || req.method === 'HEAD')) {
        const found = await manualFor(db, shared[1]!, clock);
        if (!found) throw new Refusal(404, 'Not found');
        // A page of its own with no scripts, kept out of search engines and out of any cache but the reader's.
        reply = { body: Buffer.from(manualHtml(found), 'utf8'), headers: { ...SECURITY_HEADERS, 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'private, no-store',
          'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; font-src 'self'; img-src 'self'", 'X-Robots-Tag': 'noindex, nofollow', 'Referrer-Policy': 'no-referrer' } };
      } else if (busy && (req.method === 'GET' || req.method === 'HEAD')) {
        const found = await busyFor(db, busy[1]!, clock);
        if (!found) throw new Refusal(404, 'Not found');
        reply = { body: Buffer.from(busyHtml(found), 'utf8'), headers: { ...SECURITY_HEADERS, 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'private, no-store',
          'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; font-src 'self'; img-src 'self'", 'X-Robots-Tag': 'noindex, nofollow', 'Referrer-Policy': 'no-referrer' } };
      } else if (path.startsWith('/.well-known/')) {
        // Programs look for these addresses (an AI app signing in, among others). Any that isn't one of Life Is's own is
        // plainly not here: the app's page in its place would be read as an answer, and make no sense to them.
        throw new Refusal(404, 'Not found');
      } else if (page && (req.method === 'GET' || req.method === 'HEAD')) {
        const found = await page(url.pathname, isHttps(req));
        reply = { headers: found.headers, body: found.body };
      } else {
        throw new Refusal(404, 'Not found');
      }
    } catch (problem) {
      if (problem instanceof Problem || problem instanceof Refusal) {
        // A voice shortcut speaks or shows whatever comes back, so a refusal there is a plain sentence, not a data format.
        reply = path.startsWith('/api/voice/')
          ? { status: problem.status, body: Buffer.from(problem.message, 'utf8'), headers: { 'Content-Type': 'text/plain; charset=utf-8' } }
          : { status: problem.status, json: { detail: problem.message } };
      } else {
        (options.onError ?? console.error)(problem);
        reply = { status: 500, json: { detail: "That didn't work. Try again in a moment." } };
      }
    }

    if (options.note && CONNECTOR_STEPS.test(path)) {
      const said = reply.json && typeof reply.json === 'object' ? reply.json as { error?: unknown; error_description?: unknown; detail?: unknown } : {};
      const reason = (reply.status ?? 200) >= 400 ? [said.error, said.error_description ?? said.detail].filter((x) => typeof x === 'string').join(': ') : undefined;
      options.note(connectorNote(clock(), req.method ?? '?', path, reply.status ?? 200, req.headers['user-agent'] as string | undefined, reason));
    }

    const headers: Record<string, string | string[]> = {};
    if (api) {
      Object.assign(headers, SECURITY_HEADERS);
      if (isHttps(req)) headers['Strict-Transport-Security'] = 'max-age=31536000';
    }
    Object.assign(headers, reply.headers);
    let body = reply.body;
    if (reply.json !== undefined) {
      body = Buffer.from(JSON.stringify(reply.json), 'utf8');
      headers['Content-Type'] = 'application/json';
    }
    // The MCP addresses go out chunked, with no length: on this PC the Avast shield mangles a response with a Content-Length
    // when the request ends in /mcp, and a chunked one is just as good to every client.
    if (body && !/\/mcp$/i.test(path)) headers['Content-Length'] = String(body.length);
    res.writeHead(reply.status ?? 200, headers);
    res.end(req.method === 'HEAD' ? undefined : body);
    // Whatever of the request wasn't read (a refused upload, say) is dropped, so the connection can be reused.
    if (!req.readableEnded) req.resume();
  };
}
