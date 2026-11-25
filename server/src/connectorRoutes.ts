/**
 * Use Life Is from your AI app: the addresses.
 *
 * - /api/connector, for the person signed in (session cookie, the usual checks): the switch for the household, their
 *   connections and log, and the approval page's two questions (what is this app asking, and yes or no).
 * - The public addresses, outside /api and never reading the session cookie: the sign-in documents (/.well-known/...),
 *   registering an app (/oauth/register), swapping a code or refresh token (/oauth/token), and /mcp itself (MCP over
 *   Streamable HTTP: stateless, plain JSON answers). They answer only while the household switch is on, and never in the demo.
 * What an AI app may see and do is core/'s connector.ts; the sign-in is connectorAuth.ts.
 */
import type { IncomingMessage } from 'node:http';
import {
  callTool, CONNECTOR_ADDS, CONNECTOR_NEVER, CONNECTOR_SECTIONS, CONNECTOR_SERVICE, connectionTools, connector, householdOn, isLocalAddress, Problem, UNUSED_DAYS,
  type Db, type Live,
} from '../../core/src/index.ts';
import type { Clock } from './auth.ts';
import * as sign from './connectorAuth.ts';
import { read, Refusal, type Body, type Context, type Reply, type Route } from './http.ts';

const ID = '(\\d{1,15})';
const VERSION = '0.2.0';
const MAX_OAUTH_BODY = 64 * 1024;
const MAX_MCP_BODY = 1024 * 1024;
const PROTOCOLS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
const INSTRUCTIONS = 'Life Is is a private home organizer. These tools read what the person allowed and, if they allowed it, add a few simple things. Nothing is ever changed or deleted.';
const sent = (body: Body, name: string) => Object.hasOwn(body, name);

/** Whether an AI app out on the internet could reach this address. Looks at the address only; never contacts anything. */
export function reachOf(origin: string | undefined): { ok: boolean; why: string | null } {
  if (!origin || !origin.startsWith('https://')) return { ok: false, why: 'AI apps only connect to addresses that start with https://.' };
  if (isLocalAddress(origin)) return { ok: false, why: "This Life Is is only on your home network, so an AI app on the internet can't reach it." };
  return { ok: true, why: null };
}

/** The redirect an app is sent back to: its own address with what it needs added, and anything already in it kept. */
function redirectWith(redirectUri: string, extra: Record<string, string | null>): string {
  const url = new URL(redirectUri);
  for (const [name, value] of Object.entries(extra)) if (value) url.searchParams.set(name, value);
  return url.toString();
}

// ---------- for the person signed in ----------

export function connectorRoutes(db: Db, tools: { clock: Clock; demo: boolean }): Route[] {
  const mine = (c: Context) => connector(db, c.user.id, c.clock);
  const state = async (c: Context) => ({
    ...await mine(c).status(),
    available: !tools.demo,
    is_admin: c.user.is_admin,
    address: c.origin ? `${c.origin}/mcp` : '',
    reach: reachOf(c.origin),
  });
  const notDemo = () => { if (tools.demo) throw new Refusal(403, "AI apps can't connect to the demo: everyone shares it"); };
  const mustBeOn = async () => {
    notDemo();
    if (!(await householdOn(db))) throw new Refusal(403, "The person in charge of this Life Is hasn't turned this on.");
  };
  /** The mcp address (or the plain address) this app says it wants a token for. Anything else is not this Life Is. */
  const checkResource = (c: Context, resource: string | null) => {
    if (resource && c.origin && resource !== `${c.origin}/mcp` && resource !== c.origin) throw new Refusal(400, "That AI app asked for a different address than this one. Nothing was shared.");
  };
  const asked = (body: Body | URLSearchParams) => {
    const get = (name: string) => body instanceof URLSearchParams ? body.get(name) : read.maybeText(body, name);
    return { client_id: get('client_id'), redirect_uri: get('redirect_uri'), code_challenge: get('code_challenge'), code_challenge_method: get('code_challenge_method'),
      state: get('state'), resource: get('resource') };
  };

  return [
    ['GET', /^\/api\/connector$/, async (c) => ({ json: await state(c) })],
    ['PUT', /^\/api\/connector\/household$/, async (c) => {
      notDemo();
      await mine(c).setHousehold(read.yesNo(c.body, 'on'), c.user.is_admin);
      return { json: await state(c) };
    }],
    ['PUT', new RegExp(`^/api/connector/connections/${ID}$`), async (c) => {
      notDemo();
      await mine(c).update(c.id, {
        ...(sent(c.body, 'name') ? { name: read.maybeText(c.body, 'name') } : {}),
        ...(sent(c.body, 'sections') ? { sections: read.texts(c.body, 'sections') } : {}),
        ...(sent(c.body, 'may_add') ? { may_add: read.yesNo(c.body, 'may_add') } : {}),
      });
      return { json: await state(c) };
    }],
    ['DELETE', new RegExp(`^/api/connector/connections/${ID}$`), async (c) => {
      await mine(c).cutOff(c.id);
      return { json: await state(c) };
    }],
    ['POST', new RegExp(`^/api/connector/log/${ID}/undo$`), async (c) => {
      notDemo();
      await mine(c).undo(c.id);
      return { json: await state(c) };
    }],

    // What the approval page shows before the person says yes or no.
    ['GET', /^\/api\/connector\/request$/, async (c) => {
      await mustBeOn();
      const q = asked(c.query);
      if (q.client_id === null && q.redirect_uri === null) throw new Refusal(400, "This page opens from an AI app. Start from the app's settings.");
      const client = await sign.checkAsking(db, q);
      sign.checkChallenge(q);
      checkResource(c, q.resource);
      return { json: {
        app_name: client.name, goes_to: new URL(q.redirect_uri!).host, suggested_name: client.name,
        sections: CONNECTOR_SECTIONS, never: CONNECTOR_NEVER, adds: CONNECTOR_ADDS, service: CONNECTOR_SERVICE, unused_days: UNUSED_DAYS,
      } };
    }],
    ['POST', /^\/api\/connector\/allow$/, async (c) => {
      await mustBeOn();
      const q = asked(c.body);
      checkResource(c, q.resource);
      const code = await sign.makeCode(db, c.user.id,
        { client_id: q.client_id ?? '', redirect_uri: q.redirect_uri ?? '', code_challenge: q.code_challenge ?? '', code_challenge_method: q.code_challenge_method ?? '' },
        { name: read.maybeText(c.body, 'name'), sections: read.texts(c.body, 'sections'), may_add: read.yesNo(c.body, 'may_add', false) }, c.clock);
      return { json: { redirect: redirectWith(q.redirect_uri!, { code, state: q.state }) } };
    }],
    ['POST', /^\/api\/connector\/deny$/, async (c) => {
      notDemo();
      const q = asked(c.body);
      await sign.checkAsking(db, q);
      return { json: { redirect: redirectWith(q.redirect_uri!, { error: 'access_denied', state: q.state }) } };
    }],
  ];
}

// ---------- the public addresses ----------

const PUBLIC = /^\/(\.well-known\/oauth-(protected-resource(\/mcp)?|authorization-server)|oauth\/(register|token)|mcp)$/;
const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, MCP-Protocol-Version, Mcp-Session-Id', 'Access-Control-Expose-Headers': 'WWW-Authenticate',
};
const HEADERS: Record<string, string> = { ...CORS, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };

async function readRaw(req: IncomingMessage, most: number): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > most) throw new Refusal(413, "That's too much to send at once");
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** What an OAuth address was sent: a form (the usual) or JSON, as text values. */
async function readOAuth(req: IncomingMessage): Promise<Record<string, unknown>> {
  let text: string;
  try { text = await readRaw(req, MAX_OAUTH_BODY); } catch (problem) {
    if (problem instanceof Refusal) throw new sign.OAuthError('invalid_request', problem.message, problem.status);
    throw problem;
  }
  if (!text.trim()) return {};
  if (String(req.headers['content-type'] ?? '').toLowerCase().includes('application/json')) {
    try {
      const data: unknown = JSON.parse(text);
      if (typeof data === 'object' && data !== null && !Array.isArray(data)) return data as Record<string, unknown>;
    } catch { /* said below */ }
    throw new sign.OAuthError('invalid_request', "That couldn't be read");
  }
  return Object.fromEntries(new URLSearchParams(text));
}
const textOf = (body: Record<string, unknown>, name: string) => typeof body[name] === 'string' ? body[name] as string : undefined;

const rpcError = (id: unknown, code: number, message: string, status = 200): Reply =>
  ({ status, json: { jsonrpc: '2.0', id: id ?? null, error: { code, message } } });

export type PublicAddresses = {
  owns(path: string): boolean;
  answer(req: IncomingMessage, path: string, where: { ip: string; origin: string | undefined }): Promise<Reply>;
};

export function connectorPublic(db: Db, tools: { clock: Clock; demo: boolean }): PublicAddresses {
  const { clock } = tools;
  const json = (value: unknown, status = 200): Reply => ({ status, json: value });

  async function mcp(req: IncomingMessage, ip: string): Promise<Reply> {
    if (req.method !== 'POST') return { status: 405, headers: { Allow: 'POST' }, json: { detail: 'Method not allowed' } };
    const live = await sign.useToken(db, sign.bearerToken(req.headers.authorization), ip, clock);
    let message: unknown;
    try {
      message = JSON.parse(await readRaw(req, MAX_MCP_BODY));
    } catch (problem) {
      if (problem instanceof Refusal) return rpcError(null, -32600, problem.message, problem.status);
      return rpcError(null, -32700, "That couldn't be read", 400);
    }
    if (Array.isArray(message)) return rpcError(null, -32600, 'Send one message at a time', 400);
    if (typeof message !== 'object' || message === null) return rpcError(null, -32600, 'That is not a message', 400);
    const { id, method, params } = message as { id?: unknown; method?: unknown; params?: unknown };
    // Notifications, and answers the app sends back, get no reply.
    if (typeof method !== 'string') return { status: 202 };
    if (method.startsWith('notifications/')) return { status: 202 };
    const ok = (result: unknown): Reply => ({ json: { jsonrpc: '2.0', id: id ?? null, result } });
    const given = (typeof params === 'object' && params !== null && !Array.isArray(params) ? params : {}) as Record<string, unknown>;
    switch (method) {
      case 'initialize': {
        const asked = typeof given.protocolVersion === 'string' ? given.protocolVersion : '';
        return ok({ protocolVersion: PROTOCOLS.includes(asked) ? asked : '2025-06-18', capabilities: { tools: {} },
          serverInfo: { name: 'Life Is', version: VERSION }, instructions: INSTRUCTIONS });
      }
      case 'ping': return ok({});
      case 'tools/list': return ok({ tools: connectionTools(live) });
      case 'tools/call': return ok(await call(live, given));
      default: return rpcError(id, -32601, 'That method is not offered');
    }
  }

  async function call(live: Live, given: Record<string, unknown>) {
    const name = given.name;
    const args = given.arguments ?? {};
    if (typeof name !== 'string' || typeof args !== 'object' || args === null || Array.isArray(args)) {
      return { content: [{ type: 'text', text: 'That tool call could not be read.' }], isError: true };
    }
    try {
      return { content: [{ type: 'text', text: await callTool(db, clock, live, name, args as Record<string, unknown>) }] };
    } catch (problem) {
      if (problem instanceof Problem) return { content: [{ type: 'text', text: problem.message }], isError: true };
      throw problem;
    }
  }

  async function answerOne(req: IncomingMessage, path: string, where: { ip: string; origin: string | undefined }): Promise<Reply> {
    const method = req.method ?? 'GET';
    const origin = where.origin ?? '';
    if (path === '/mcp') return mcp(req, where.ip);
    const wrongMethod = (): Reply => ({ status: 405, json: { detail: 'Method not allowed' } });
    if (path.startsWith('/.well-known/')) {
      if (method !== 'GET' && method !== 'HEAD') return wrongMethod();
      if (path === '/.well-known/oauth-authorization-server') {
        return json({
          issuer: origin, authorization_endpoint: `${origin}/connect`, token_endpoint: `${origin}/oauth/token`, registration_endpoint: `${origin}/oauth/register`,
          response_types_supported: ['code'], grant_types_supported: ['authorization_code', 'refresh_token'],
          code_challenge_methods_supported: ['S256'], token_endpoint_auth_methods_supported: ['none'],
        });
      }
      return json({ resource: `${origin}/mcp`, authorization_servers: [origin], bearer_methods_supported: ['header'] });
    }
    if (method !== 'POST') return wrongMethod();
    const body = await readOAuth(req);
    if (path === '/oauth/register') {
      const made = await sign.registerClient(db, body, where.ip, clock);
      return json({ ...made, grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none' }, 201);
    }
    const grant = textOf(body, 'grant_type');
    if (grant === 'authorization_code') {
      return json(await sign.exchangeCode(db, { code: textOf(body, 'code'), code_verifier: textOf(body, 'code_verifier'),
        client_id: textOf(body, 'client_id'), redirect_uri: textOf(body, 'redirect_uri') }, where.ip, clock));
    }
    if (grant === 'refresh_token') {
      return json(await sign.refresh(db, { refresh_token: textOf(body, 'refresh_token'), client_id: textOf(body, 'client_id') }, where.ip, clock));
    }
    throw new sign.OAuthError(grant === undefined ? 'invalid_request' : 'unsupported_grant_type', grant === undefined ? 'grant_type is needed' : 'Only authorization_code and refresh_token are offered');
  }

  return {
    owns: (path) => PUBLIC.test(path),
    async answer(req, path, where) {
      let reply: Reply;
      if (req.method === 'OPTIONS') {
        reply = { status: 204 };
      } else if (tools.demo || !(await householdOn(db))) {
        // While the switch is off nothing here answers, /mcp included: a stranger can't tell this Life Is from one without it.
        reply = { status: 404, json: { detail: 'Not found' } };
      } else {
        try {
          reply = await answerOne(req, path, where);
        } catch (problem) {
          if (problem instanceof sign.OAuthError) {
            reply = { status: problem.status, json: { error: problem.code, error_description: problem.message } };
          } else if (problem instanceof Refusal || problem instanceof Problem) {
            const status = problem.status;
            reply = { status, json: path === '/mcp' ? { error: status === 401 ? 'invalid_token' : 'error', error_description: problem.message } : { detail: problem.message } };
            if (path === '/mcp' && status === 401) {
              reply.headers = { 'WWW-Authenticate': `Bearer resource_metadata="${where.origin ?? ''}/.well-known/oauth-protected-resource/mcp"` };
            }
          } else {
            throw problem;
          }
        }
      }
      return { ...reply, headers: { ...HEADERS, ...reply.headers } };
    },
  };
}
