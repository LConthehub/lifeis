/**
 * Life Is with no server: the pages' requests are answered here, inside the app.
 *
 * The pages ask for "/api/kitchen/recipes" exactly as they do of a server. Here that request never leaves
 * the device: it is handed to the same handlers the server uses (server/src/everydayRoutes.ts), which read
 * and write the database on the device.
 *
 * There is no sign-in, because there is nobody to tell apart: the device belongs to one person, and the
 * device's own lock is the front door. So the few addresses about accounts answer for that one person.
 */
import { kitchen, Problem } from '../../../core/src/index.ts';
import { everydayRoutes } from '../../../server/src/everydayRoutes.ts';
import { Refusal } from '../../../server/src/http.ts';

const pad = (n) => String(n).padStart(2, '0');
const today = () => { const now = new Date(); return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`; };
const clock = Object.assign(() => new Date(), { today });
const notHere = async () => { throw new Refusal(400, "There are no accounts or passwords when Life Is keeps everything on this device. Its lock is the device's own."); };

/** The one person this device belongs to. Made the first time the app opens. */
async function owner(db) {
  const found = await db.get('SELECT id, username FROM users ORDER BY id LIMIT 1');
  if (found) return { id: found.id, username: found.username, is_admin: true };
  // No password is kept: 'none' can never match one.
  const made = await db.run("INSERT INTO users (username, password_hash, is_admin, created_at) VALUES ('me', 'none', 1, ?)", [new Date().toISOString().slice(0, 19) + '+00:00']);
  return { id: made.lastId, username: 'me', is_admin: true };
}

export async function deviceAnswers(db, outside = {}) {
  const user = await owner(db);
  const account = async () => ({ json: { idle_minutes: 0, idle_choices: [0] } });
  const routes = [
    ['GET', /^\/api\/health$/, async () => ({ json: { status: 'ok' } })],
    ['GET', /^\/api\/auth\/status$/, async () => ({ json: { setup_required: false, local: true, on_device: true, user } })],
    ['POST', /^\/api\/auth\/logout$/, async () => ({ status: 204 })],
    ['POST', /^\/api\/auth\/(setup|login|change-password)$/, notHere],
    ['POST', /^\/api\/users$/, notHere],
    ['GET', /^\/api\/account$/, account],
    ['PUT', /^\/api\/account$/, account],
    ...everydayRoutes(db, outside),
  ];

  /** Answers one request: { status, data, headers }. Never throws for a refusal; that is an answer too. */
  return async function answer(method, address, body) {
    const url = new URL(address, 'http://lifeis');
    const path = url.pathname.replace(/\/+$/, '') || '/';
    let reply;
    try {
      const here = routes.filter(([, pattern]) => pattern.test(path));
      if (here.length === 0) throw new Refusal(404, 'Not found');
      const route = here.find(([m]) => m === method);
      if (!route) throw new Refusal(405, 'Method not allowed');
      reply = await route[2]({
        path, query: url.searchParams, id: Number(route[1].exec(path)[1] ?? 0), body: body && typeof body === 'object' ? body : {},
        user, kitchen: kitchen(db, user.id, clock), clock, token: undefined, ip: '', https: true, local: true,
      });
    } catch (problem) {
      if (problem instanceof Problem || problem instanceof Refusal) reply = { status: problem.status, json: { detail: problem.message } };
      else { console.error(problem); reply = { status: 500, json: { detail: 'Something went wrong inside Life Is' } }; }
    }
    return { status: reply.status ?? 200, data: reply.json !== undefined ? reply.json : reply.body ?? '', headers: reply.headers ?? {} };
  };
}
