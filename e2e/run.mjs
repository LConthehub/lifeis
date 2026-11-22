// Life Is, clicked through as a person would, in a real browser.
//
// Each walk-through gets a Life Is of its own: a fresh, empty copy started on a free port with its data in a
// folder that is thrown away afterwards. Nothing here touches a Life Is you use.
//
//   node e2e/run.mjs                 every walk-through that needs nothing from outside
//   node e2e/run.mjs upkeep trial    only those
//   node e2e/run.mjs --online        also the ones that look things up on the internet (Open Library and so on)
//   node e2e/run.mjs --slow          also every page at every screen size (several minutes)
//   node e2e/run.mjs --docker        also mail and photos, which need the stand-in mail server and Immich
//                                    from the Docker test setup (mailtest.internal, photos.internal)
//   node e2e/run.mjs --build         build the pages (and the phone app's pages) first
//
// The pages are served from frontend/dist, so build them (--build) after changing them.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

// One entry per Life Is: the walk-throughs that run against it, in turn (a later one may use what an earlier
// one made). `account` is made, and set up for every part of Life Is, before they start, for walk-throughs
// that sign in rather than make the first account. `phone` serves the phone app's own pages, where Life Is
// runs inside the app. `fixtures` are stand-ins started first (e2e/fixtures), such as a pretend Jellyfin.
// `docker` needs stand-ins only the Docker test setup has.
const TRIAL = ['trial', 'trial-only-password-8021'];
const SUITE = [
  { specs: ['books-and-places'] },
  { specs: ['fill-a-place', 'gear-and-copy-history'], online: true },
  { specs: ['upkeep'] },
  { specs: ['household'] },
  { specs: ['search'] },
  { specs: ['records'] },
  { specs: ['reminders'], fixtures: [['ntfy', 8098]] },
  { specs: ['spending'] },
  { specs: ['backup'], phone: true },
  { specs: ['settings'] },
  { specs: ['assistant'] },
  { specs: ['home'], account: TRIAL, online: true },
  { specs: ['calendar-link'], account: TRIAL },
  { specs: ['collection'], account: TRIAL },
  { specs: ['mail'], account: TRIAL, docker: true },
  { specs: ['media-servers'], account: TRIAL, fixtures: [['jellyfin', 8097]] },
  { specs: ['photo-library'], account: TRIAL, docker: true },
  { specs: ['touch-targets'], account: TRIAL },
  { specs: ['trial'], phone: true },
  { specs: ['barcode-lookups'], online: true },
  { specs: ['screen-sizes'], slow: true },
];

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('--')));
const named = args.filter((a) => !a.startsWith('--'));
const unknown = named.filter((n) => !SUITE.some((g) => g.specs.includes(n)));
if (unknown.length) {
  console.error(`No walk-through called ${unknown.join(', ')}. There are: ${SUITE.flatMap((g) => g.specs).join(', ')}`);
  process.exit(2);
}
const chosen = SUITE.filter((g) => (named.length ? g.specs.some((s) => named.includes(s))
  : (!g.online || flags.has('--online')) && (!g.slow || flags.has('--slow')) && (!g.docker || flags.has('--docker'))));
const left = SUITE.filter((g) => !chosen.includes(g)).flatMap((g) => g.specs);

if (flags.has('--build')) {
  for (const script of ['build', 'build:app']) {
    const built = spawnSync('npm', ['run', script], { cwd: path.join(root, 'frontend'), stdio: 'inherit', shell: true });
    if (built.status !== 0) process.exit(built.status ?? 1);
  }
}
for (const [dist, wanted] of [['dist', chosen.some((g) => !g.phone)], ['dist-device', chosen.some((g) => g.phone)]]) {
  if (wanted && !existsSync(path.join(root, 'frontend', dist, 'index.html'))) {
    console.error(`The pages aren't built (frontend/${dist}). Run: node e2e/run.mjs --build`);
    process.exit(2);
  }
}

const freePort = () => new Promise((resolve, reject) => {
  const probe = createServer();
  probe.once('error', reject);
  probe.listen(0, '127.0.0.1', () => { const { port } = probe.address(); probe.close(() => resolve(port)); });
});

/** A stand-in started before a walk-through, and stopped after; it's ready once its port answers. */
async function startFixture([name, port]) {
  const child = spawn(process.execPath, [path.join(here, 'fixtures', `${name}.mjs`)], { cwd: here, stdio: 'ignore' });
  for (let i = 0; i < 50; i += 1) {
    try { await fetch(`http://127.0.0.1:${port}/`); return child; } catch { await new Promise((r) => setTimeout(r, 100)); }
  }
  child.kill();
  throw new Error(`The stand-in ${name} didn't start on port ${port}`);
}

async function startLifeIs(group) {
  const data = mkdtempSync(path.join(tmpdir(), 'lifeis-e2e-'));
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, ['server/src/main.ts'], {
    cwd: root, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, DATA_DIR: data, PORT: String(port), HOST: '127.0.0.1', STATIC_DIR: group.phone ? 'frontend/dist-device' : 'frontend/dist' },
  });
  let said = '';
  server.stdout.on('data', (d) => { said += d; });
  server.stderr.on('data', (d) => { said += d; });
  for (let i = 0; i < 100; i += 1) {
    if (server.exitCode !== null) break;
    let up = false;
    try { up = (await fetch(`${base}/api/health`)).ok; } catch { /* not up yet */ }
    if (up) {
      try { if (group.account) await makeAccount(base, ...group.account); } catch (problem) { await stop(server, data); throw problem; }
      return { base, stop: () => stop(server, data) };
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  await stop(server, data);
  throw new Error(`Life Is didn't start:\n${said.slice(-2000)}`);
}

/** The first account, set up for every part of Life Is, as if its person had already been welcomed. */
async function makeAccount(base, username, password) {
  const made = await fetch(`${base}/api/auth/setup`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
  if (!made.ok) throw new Error(`The account couldn't be made: ${made.status} ${await made.text()}`);
  const cookie = made.headers.get('set-cookie')?.split(';')[0] ?? '';
  const areas = ['eating', 'planning', 'keeping', 'making', 'enjoying', 'spending'];
  const life = await fetch(`${base}/api/life`, { method: 'PUT', headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: base }, body: JSON.stringify({ areas }) });
  if (!life.ok) throw new Error(`The account couldn't be set up: ${life.status} ${await life.text()}`);
}

async function stop(server, data) {
  if (server.exitCode === null) {
    server.kill();
    await new Promise((r) => { server.once('exit', r); setTimeout(r, 3000); });
  }
  rmSync(data, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}

/** Runs one walk-through and reads what it said: lines starting PASS or ok passed, FAIL failed. */
function walk(spec, base, shots) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(here, 'specs', `${spec}.mjs`), base, shots], { cwd: here, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    const timer = setTimeout(() => { out += '\nFAIL took more than ten minutes, and was stopped'; child.kill(); }, 10 * 60 * 1000);
    child.on('exit', (code) => {
      clearTimeout(timer);
      const lines = [...new Set(out.split(/\r?\n/).map((l) => l.trimEnd()))];
      const passed = lines.filter((l) => /^(PASS|ok)\b/.test(l));
      const failed = lines.filter((l) => /^FAIL\b/.test(l));
      // A walk-through that stopped part way, or checked nothing, hasn't passed.
      if (code !== 0) failed.push(`FAIL stopped part way (exit ${code}): ${lines.filter((l) => /Error|waiting for|Timeout/.test(l)).slice(0, 3).join(' | ') || lines.slice(-3).join(' | ')}`);
      else if (!passed.length && !failed.length) failed.push(`FAIL checked nothing: ${lines.slice(-3).join(' | ')}`);
      resolve({ passed, failed });
    });
  });
}

const shots = path.join(here, 'shots');
mkdirSync(shots, { recursive: true });
let passes = 0;
const failures = [];
for (const group of chosen) {
  let life;
  const helpers = [];
  try { for (const f of group.fixtures ?? []) helpers.push(await startFixture(f)); } catch (problem) { failures.push(problem.message); console.log(`✗ ${problem.message}`); helpers.forEach((h) => h.kill()); continue; }
  try { life = await startLifeIs(group); } catch (problem) { failures.push(`${group.specs.join(' + ')}: ${problem.message}`); console.log(`✗ ${group.specs.join(' + ')}: ${problem.message}`); continue; }
  for (const spec of group.specs) {
    const started = Date.now();
    const { passed, failed } = await walk(spec, life.base, shots);
    passes += passed.length;
    console.log(`${failed.length ? '✗' : '✓'} ${spec}: ${passed.length} passed${failed.length ? `, ${failed.length} failed` : ''} (${Math.round((Date.now() - started) / 1000)} s)`);
    for (const f of failed) { console.log(`    ${f}`); failures.push(`${spec}: ${f}`); }
  }
  await life.stop();
  helpers.forEach((h) => h.kill());
}
if (left.length && !named.length) console.log(`\nNot run this time: ${left.join(', ')} (see the flags at the top of e2e/run.mjs).`);
console.log(`\n${passes} checks passed${failures.length ? `, ${failures.length} failed` : ''}, in ${chosen.reduce((n, g) => n + g.specs.length, 0)} walk-throughs.`);
process.exit(failures.length ? 1 : 0);
