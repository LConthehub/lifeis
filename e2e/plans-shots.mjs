// Phone-size pictures (375px wide) of the one-list Plans page and of three plans in the demo household: a trip's year
// opened as a plan, the Thanksgiving plan, and the memorial lunch. Light and dark. It also checks nothing scrolls
// sideways, the chips are at least 44px tall, and each plan shows the parts it has checked.
//
//   node e2e/plans-shots.mjs      (build the pages first: cd frontend && npx vite build)
//
// Pictures go to e2e/shots/plans. Like e2e/run.mjs it starts its own Life Is on a free port, with its data in a
// folder that is thrown away afterwards.
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { browserChoice } from './browser.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const shots = path.join(here, 'shots', 'plans');
mkdirSync(shots, { recursive: true });
const results = [];
const check = (name, ok, extra = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' (' + extra + ')' : ''}`); };

const freePort = () => new Promise((resolve, reject) => {
  const probe = createServer(); probe.once('error', reject);
  probe.listen(0, '127.0.0.1', () => { const { port } = probe.address(); probe.close(() => resolve(port)); });
});
const data = mkdtempSync(path.join(tmpdir(), 'lifeis-plans-'));
const port = await freePort(); const base = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ['server/src/main.ts'], { cwd: root, stdio: 'ignore',
  env: { ...process.env, DATA_DIR: data, PORT: String(port), HOST: '127.0.0.1', STATIC_DIR: 'frontend/dist', DEMO_MODE: '1', DEMO_PASSWORD: 'a-demo-password-for-walk-throughs' } });
for (let i = 0; i < 300; i += 1) { try { if ((await fetch(`${base}/api/health`)).ok) break; } catch { /* not up yet */ } await new Promise((r) => setTimeout(r, 200)); }

const phone = { width: 375, height: 812 };
const browser = await chromium.launch(browserChoice);
try {
  for (const look of ['light', 'dark']) {
    const context = await browser.newContext({ viewport: phone, colorScheme: look, hasTouch: true, deviceScaleFactor: 2 });
    const page = await context.newPage();
    const tag = `${look} phone`;
    const get = (address) => page.evaluate(async (a) => (await fetch(a)).json(), address);
    const sideways = async (what) => { const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth); check(`${tag}: ${what} does not scroll sideways`, over <= 0, `${over}px over`); };
    await page.goto(base + '/'); await page.waitForTimeout(1000);
    await page.getByRole('button', { name: 'Try the demo' }).click(); await page.waitForTimeout(2500);
    // The phone bar is fixed to the screen; hide it so it does not land in the middle of long pictures.
    await context.addInitScript(() => { addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); s.textContent = 'nav[aria-label="Home and sections"]{display:none!important}'; document.head.append(s); }); });
    const shoot = async (name) => { await page.locator('main').screenshot({ path: path.join(shots, `${name}-phone-${look}.png`) }); };
    const heads = async () => page.locator('main section h2, main section h3').allInnerTexts();

    // The Plans list.
    await page.goto(base + '/plans'); await page.waitForTimeout(1500);
    await shoot('plans-list');
    await sideways('the Plans list');
    const chips = await page.getByRole('group', { name: 'Show' }).getByRole('button').evaluateAll((bs) => bs.map((b) => Math.round(b.getBoundingClientRect().height)));
    check(`${tag}: four chips, each 44px or taller`, chips.length === 4 && chips.every((h) => h >= 44), chips.join(','));
    const list = await page.locator('main').innerText();
    check(`${tag}: the list holds a trip, Thanksgiving, Hank's birthday and the memorial lunch`, ['Thanksgiving', "Hank's birthday", 'memorial lunch'].every((w) => list.includes(w)) && /Deer hunting trip|Spot fishing|Outer Banks beach week/.test(list));

    // A trip's year, opened as a plan.
    const trips = await get('/api/plans/trips');
    await page.goto(base + `/plans/${trips[0].years[0].plan_id}`); await page.waitForTimeout(1800);
    await shoot('trip-plan');
    await sideways("a trip's year");
    check(`${tag}: a trip's year says it is an outdoor trip and shows parts it has checked`, (await page.locator('[data-trip-line]').count()) === 1 && (await heads()).some((h) => /Bring list|Seasons|Campsite booking/.test(h)), (await heads()).join(', '));

    // The demo's Thanksgiving plan.
    const lines = await get('/api/plans/all');
    const dinner = lines.find((l) => /^Thanksgiving/.test(l.name));
    await page.goto(base + dinner.link); await page.waitForTimeout(1800);
    await shoot('thanksgiving');
    await sideways('Thanksgiving');
    const dinnerHeads = await heads();
    check(`${tag}: Thanksgiving shows food, who came, helpers and traditions`, ['Food', 'Who came', 'Helpers and tasks', 'Traditions'].every((w) => dinnerHeads.some((h) => h.includes(w))), dinnerHeads.join(', '));
    check(`${tag}: Thanksgiving has the turkey and the pie`, /Roast turkey/.test(await page.locator('main').innerText()) && /Aunt Dot brings it/.test(await page.locator('main').innerText()));

    // The memorial lunch.
    const lunch = lines.find((l) => /memorial lunch/.test(l.name));
    await page.goto(base + lunch.link); await page.waitForTimeout(1800);
    await shoot('memorial-lunch');
    await sideways('the memorial lunch');
    check(`${tag}: the memorial lunch shows its time and place`, /Oak Hill Community Center/.test(await page.locator('main').innerText()) && /12:00/.test(await page.locator('main').innerText()));
    await context.close();
  }
} finally {
  await browser.close();
  server.kill();
  await new Promise((r) => setTimeout(r, 500));
  rmSync(data, { recursive: true, force: true });
}
console.log(results.join('\n'));
