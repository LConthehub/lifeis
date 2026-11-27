// Pictures of the one-list Plans page on the demo household, for the owner's OK: phone (375) and desktop (1280),
// light and dark, with All and with Yearly chosen. It also checks nothing scrolls sideways and the chips are
// at least 44px tall.
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
for (let i = 0; i < 100; i += 1) { try { if ((await fetch(`${base}/api/health`)).ok) break; } catch { /* not up yet */ } await new Promise((r) => setTimeout(r, 200)); }

const SIZES = { phone: { width: 375, height: 812 }, desktop: { width: 1280, height: 800 } };
const browser = await chromium.launch(browserChoice);
try {
  for (const look of ['light', 'dark']) {
    for (const [sizeName, viewport] of Object.entries(SIZES)) {
      const context = await browser.newContext({ viewport, colorScheme: look, hasTouch: sizeName === 'phone', deviceScaleFactor: 2 });
      const page = await context.newPage();
      await page.goto(base + '/'); await page.waitForTimeout(1000);
      await page.getByRole('button', { name: 'Try the demo' }).click(); await page.waitForTimeout(2500);
      await page.goto(base + '/plans'); await page.waitForTimeout(1500);
      const tag = `${look} ${sizeName}`;
      await page.locator('main').screenshot({ path: path.join(shots, `all-${sizeName}-${look}.png`) });
      const wide = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      check(`${tag}: nothing scrolls sideways`, wide <= 0, `${wide}px over`);
      const chips = await page.getByRole('group', { name: 'Show' }).getByRole('button').evaluateAll((bs) => bs.map((b) => Math.round(b.getBoundingClientRect().height)));
      check(`${tag}: four chips, each 44px or taller`, chips.length === 4 && chips.every((h) => h >= 44), chips.join(','));
      const sections = await page.locator('main section h2').allInnerTexts();
      check(`${tag}: sections`, sections.length > 0, sections.join(', '));
      await page.getByRole('button', { name: 'Yearly' }).click(); await page.waitForTimeout(400);
      await page.locator('main').screenshot({ path: path.join(shots, `yearly-${sizeName}-${look}.png`) });
      await context.close();
    }
  }
} finally {
  await browser.close();
  server.kill();
  await new Promise((r) => setTimeout(r, 500));
  rmSync(data, { recursive: true, force: true });
}
console.log(results.join('\n'));
