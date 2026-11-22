/**
 * Life Is: the program. Sign-in and the kitchen, on an encrypted database, on your own computer.
 *
 * Everything under /api needs a session, except the few PUBLIC_PATHS. The first account made is the admin.
 * The addresses, what they take and what they answer are the ones the Python server had (backend/main.py and
 * backend/kitchen.py), so the pages don't know the difference. The kitchen itself is core/.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { BlockList, isIP } from 'node:net';
import type { PushSender } from '../../core/src/index.ts';
import { atomic, feedFor, kitchen, Problem, type Db } from '../../core/src/index.ts';
import * as auth from './auth.ts';
import type { MailTools } from './mailRoutes.ts';
import { notUnderstood, read, readBody, Refusal, type Context, type Reply, type Route } from './http.ts';
import type { Reach } from './connectionRoutes.ts';
import { everydayRoutes } from './everydayRoutes.ts';
import { pages } from './pages.ts';
import { zip } from './zip.ts';

const PUBLIC_PATHS = new Set(['/api/health', '/api/auth/status', '/api/auth/setup', '/api/auth/login', '/api/auth/logout']);
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
  clock?: auth.Clock;
  /** How Life Is reaches a media server and locks its key. Left out: media servers can't be connected. */
  reach?: Reach;
  /** How Life Is talks to mail providers and locks an account's password. Left out: email can't be set up. */
  mail?: MailTools;
  /** How Life Is reaches a photo library and locks its key. Left out: none can be connected. */
  photos?: Reach;
  /** How Life Is reads another calendar's link and locks it. Left out: none can be followed. */
  calendars?: Reach;
  /** How the assistant reaches a model and locks its key. Left out: it can't be turned on. */
  assistant?: Reach;
  /** How a browser is sent a reminder. Left out: browsers can't be sent any. */
  push?: { publicKey: string; send: PushSender };
  /** Told about anything that went wrong inside Life Is itself (never about a person's mistake). */
  onError?: (problem: unknown) => void;
};

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

function clientIp(req: IncomingMessage): string {
  const address = req.socket.remoteAddress ?? '?';
  return address.startsWith('::ffff:') && isIP(address.slice(7)) === 4 ? address.slice(7) : address;
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
  const page = options.staticDir ? pages(options.staticDir) : null;
  const now = () => clock().toISOString().slice(0, 19) + '+00:00';

  const sessionCookie = (c: Context, token: string) =>
    `${auth.SESSION_COOKIE}=${token}; Max-Age=${auth.SESSION_DAYS * 86400}; Path=/; HttpOnly; SameSite=Lax${c.https ? '; Secure' : ''}`;

  async function signIn(c: Context, userId: number): Promise<Record<string, string>> {
    const token = await auth.createSession(db, userId, { method: 'password', ip: c.ip, userAgent: c.userAgent }, clock);
    return { 'Set-Cookie': sessionCookie(c, token) };
  }

  const account = async (c: Context): Promise<Reply> =>
    ({ json: { idle_minutes: await auth.idleMinutesFor(db, c.user.id, idleDefault), idle_choices: auth.IDLE_CHOICES } });

  /** How outside services are asked. Without it (no `reach`), none can be turned on. */
  const outside = options.reach?.fetcher;

  const routes: Route[] = [
    ['GET', /^\/api\/health$/, async () => ({ json: { status: 'ok' } })],

    // ==================== THE FRONT DOOR ====================

    ['GET', /^\/api\/auth\/status$/, async (c) => {
      const people = (await db.get<{ n: number }>('SELECT COUNT(*) AS n FROM users'))!.n;
      return { json: { setup_required: people === 0, local: c.local, user: await auth.userForToken(db, c.token, clock, idleDefault, false) } };
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
      return { status: 201, json: { id, username, is_admin: true }, headers: await signIn(c, id) };
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
      for (const [throttle, key] of counted) await throttle.success(db, key);
      return { json: user, headers: await signIn(c, user.id) };
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
      return { status: 201, json: { id, username, is_admin: false } };
    }],

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

    ...everydayRoutes(db, { fetcher: outside, reach: options.reach, mail: options.mail, photos: options.photos, calendars: options.calendars, assistant: options.assistant, push: options.push }),
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
      throw new Refusal(403, 'Request blocked: it came from another website');
    }
    const token = cookie(req, auth.SESSION_COOKIE);
    let user: auth.User | null = null;
    if (!PUBLIC_PATHS.has(path)) {
      user = await auth.userForToken(db, token, clock, idleDefault, req.headers['x-background'] !== '1');
      if (!user) throw new Refusal(401, 'Not logged in');
    }
    const here = routes.filter(([, pattern]) => pattern.test(path));
    if (here.length === 0) throw new Refusal(404, 'Not found');
    const route = here.find(([m]) => m === method);
    if (!route) throw new Refusal(405, 'Method not allowed');
    const signedIn = user ?? { id: 0, username: '', is_admin: false };
    const theirClock = clockFor(req);
    return route[2]({
      path, userAgent: String(req.headers['user-agent'] ?? '') || undefined, query: url.searchParams, id: Number(route[1].exec(path)![1] ?? 0), body: SAFE_METHODS.has(method) ? {} : await readBody(req),
      user: signedIn, kitchen: kitchen(db, signedIn.id, theirClock), clock: theirClock, token, ip: clientIp(req), https: isHttps(req), local: isLocal(req),
      origin: req.headers.host ? `${isHttps(req) ? 'https' : 'http'}://${String(req.headers.host).slice(0, 200)}` : undefined,
    });
  }

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

    let reply: Reply;
    try {
      if (api) {
        reply = await answerApi(req, url, path);
      } else if (feed && (req.method === 'GET' || req.method === 'HEAD')) {
        const host = String(req.headers.host ?? '');
        const text = await feedFor(db, feed[1]!, clock, /^[\w.\-:[\]]+$/.test(host) ? `${isHttps(req) ? 'https' : 'http'}://${host}` : '');
        if (text === null) throw new Refusal(404, 'Not found');
        reply = { body: Buffer.from(text, 'utf8'), headers: { ...SECURITY_HEADERS, 'Content-Type': 'text/calendar; charset=utf-8', 'Cache-Control': 'private, no-store' } };
      } else if (page && (req.method === 'GET' || req.method === 'HEAD')) {
        const found = await page(url.pathname, isHttps(req));
        reply = { headers: found.headers, body: found.body };
      } else {
        throw new Refusal(404, 'Not found');
      }
    } catch (problem) {
      if (problem instanceof Problem || problem instanceof Refusal) {
        reply = { status: problem.status, json: { detail: problem.message } };
      } else {
        (options.onError ?? console.error)(problem);
        reply = { status: 500, json: { detail: 'Something went wrong inside Life Is' } };
      }
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
    if (body) headers['Content-Length'] = String(body.length);
    res.writeHead(reply.status ?? 200, headers);
    res.end(req.method === 'HEAD' ? undefined : body);
    // Whatever of the request wasn't read (a refused upload, say) is dropped, so the connection can be reused.
    if (!req.readableEnded) req.resume();
  };
}
