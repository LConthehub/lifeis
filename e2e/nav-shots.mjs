// Pictures of the navigation sample on the demo household, for the owner's OK: Home, tasty, tidy, busy and
// Settings, at phone (375) and desktop (1280) width, light and dark, and again with the "Life is ..." drop-down
// open. It also checks: the header reads "Life is busy" on the calendar and "Life is home" on Home, the first place
// in the phone bar says "Life is", nothing scrolls sideways, every place in the bar and every row of the drop-down
// is at least 44px tall, the drop-down fits on screen, and the end of a page is not hidden under the bar.
//
//   node e2e/nav-shots.mjs      (build the pages first: cd frontend && npx vite build)
//
// Pictures go to e2e/shots/nav. Like e2e/run.mjs it starts its own Life Is on a free port, with its data in a
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
const shots = path.join(here, 'shots', 'nav');
mkdirSync(shots, { recursive: true });
const results = [];
const check = (name, ok, extra = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' (' + extra + ')' : ''}`); };

const freePort = () => new Promise((resolve, reject) => {
  const probe = createServer(); probe.once('error', reject);
  probe.listen(0, '127.0.0.1', () => { const { port } = probe.address(); probe.close(() => resolve(port)); });
});
const data = mkdtempSync(path.join(tmpdir(), 'lifeis-nav-'));
const port = await freePort(); const base = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ['server/src/main.ts'], { cwd: root, stdio: 'ignore',
  env: { ...process.env, DATA_DIR: data, PORT: String(port), HOST: '127.0.0.1', STATIC_DIR: 'frontend/dist', DEMO_MODE: '1', DEMO_PASSWORD: 'a-demo-password-for-walk-throughs' } });
for (let i = 0; i < 100; i += 1) { try { if ((await fetch(`${base}/api/health`)).ok) break; } catch { /* not up yet */ } await new Promise((r) => setTimeout(r, 200)); }

const SIZES = { phone: { width: 375, height: 812 }, desktop: { width: 1280, height: 800 } };
const PAGES = [['home', '/'], ['tasty', '/recipes'], ['tidy', '/things'], ['busy', '/calendar'], ['settings', '/settings/home']];
const browser = await chromium.launch(browserChoice);
try {
  for (const look of ['light', 'dark']) {
    for (const [sizeName, viewport] of Object.entries(SIZES)) {
      const context = await browser.newContext({ viewport, colorScheme: look, hasTouch: sizeName === 'phone', deviceScaleFactor: 2 });
      const page = await context.newPage();
      await page.goto(base + '/'); await page.waitForTimeout(1000);
      await page.getByRole('button', { name: 'Try the demo' }).click(); await page.waitForTimeout(2500);
      for (const [name, to] of PAGES) {
        await page.goto(base + to); await page.waitForTimeout(1500);
        await page.screenshot({ path: path.join(shots, `${name}-${sizeName}-${look}.png`) });
        const tag = `${look} ${sizeName} ${name}`;
        const wide = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        check(`${tag}: nothing scrolls sideways`, wide <= 0, `${wide}px over`);
        const bar = page.getByRole('navigation', { name: 'Home and sections' });
        if (sizeName === 'phone') {
          check(`${tag}: the bottom bar shows`, await bar.isVisible());
          check(`${tag}: the bar's first place says Life is`, (await bar.getByRole('link').first().innerText()).trim() === 'Life is');
          const heights = await bar.getByRole('link').evaluateAll((ls) => ls.map((l) => Math.round(l.getBoundingClientRect().height)));
          check(`${tag}: every place in the bar is 44px or taller`, heights.length >= 2 && heights.every((h) => h >= 44), heights.join(','));
          const words = (await bar.innerText()).replace(/\s+/g, ' ').trim();
          if (name === 'home') check(`${tag}: the bar reads Life is and the words`, /^Life is/.test(words) && /tasty/.test(words), words);
          // the end of the page sits above the bar
          await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight)); await page.waitForTimeout(300);
          const gap = await page.evaluate(() => {
            const sheet = document.querySelector('main > div'); const barBox = document.querySelector('nav[aria-label="Home and sections"]').getBoundingClientRect();
            return Math.round(barBox.top - sheet.getBoundingClientRect().bottom);
          });
          check(`${tag}: the end of the page is above the bar`, gap >= 0, `${gap}px`);
          if (name === 'tidy' || name === 'busy') await page.screenshot({ path: path.join(shots, `${name}-${sizeName}-${look}-end.png`) });
        } else {
          check(`${tag}: no bottom bar on a computer`, !(await bar.isVisible()));
          check(`${tag}: the words are not a row across the top`, (await page.getByRole('navigation', { name: 'Sections', exact: true }).count()) === 0);
        }
        // the header reads as a sentence
        const sentence = (await page.locator('[data-life-sentence]').innerText()).replace(/\s+/g, ' ').trim();
        if (name === 'busy') check(`${tag}: the header reads Life is busy`, sentence === 'Life is busy', sentence);
        if (name === 'home') check(`${tag}: the header reads Life is home`, sentence === 'Life is home', sentence);
        if (name === 'settings') check(`${tag}: the header reads Life is with no word`, sentence === 'Life is', sentence);
        // the drop-down, open
        const button = page.locator('header button[aria-haspopup]');
        await button.click(); await page.waitForTimeout(300);
        const menu = page.getByRole('navigation', { name: 'Sections', exact: true });
        check(`${tag}: the drop-down opens`, await menu.isVisible() && (await button.getAttribute('aria-expanded')) === 'true');
        const rows = await menu.getByRole('link').evaluateAll((ls) => ls.map((l) => { const r = l.getBoundingClientRect(); return { t: l.innerText.trim(), h: Math.round(r.height) }; }));
        check(`${tag}: the drop-down lists home and the five words`, rows.map((r) => r.t).join(',') === 'home,tasty,tidy,balanced,busy,fun', rows.map((r) => r.t).join(','));
        check(`${tag}: every row is 44px or taller`, rows.every((r) => r.h >= 44), rows.map((r) => r.h).join(','));
        const box = await menu.boundingBox();
        check(`${tag}: the drop-down is on screen`, box.x >= 0 && box.x + box.width <= viewport.width && box.y + box.height <= viewport.height, JSON.stringify(box));
        const lit = await menu.locator('a[aria-current="page"]').allInnerTexts();
        const want = { home: ['home'], tasty: ['tasty'], tidy: ['tidy'], busy: ['busy'], settings: [] }[name];
        check(`${tag}: the right row is lit`, lit.map((t) => t.trim()).join() === want.join(), lit.join());
        await page.screenshot({ path: path.join(shots, `${name}-${sizeName}-${look}-menu.png`) });
        if (name === 'busy') {
          await page.keyboard.press('Escape'); await page.waitForTimeout(200);
          check(`${tag}: Escape closes the drop-down`, !(await menu.isVisible()));
          await button.click(); await page.getByRole('navigation', { name: 'Sections', exact: true }).getByRole('link', { name: 'tidy', exact: true }).click(); await page.waitForTimeout(600);
          check(`${tag}: picking tidy goes to its home and closes`, /\/things$/.test(page.url()) && !(await page.getByRole('navigation', { name: 'Sections', exact: true }).isVisible()), page.url());
        } else { await page.keyboard.press('Escape'); }
      }
      await context.close();
    }
  }
} finally {
  await browser.close(); server.kill();
  await new Promise((r) => { server.once('exit', r); setTimeout(r, 3000); });
  rmSync(data, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
console.log(results.join('\n'));
console.log(`${results.filter((r) => r.startsWith('PASS')).length} passed, ${results.filter((r) => r.startsWith('FAIL')).length} failed; pictures in ${shots}`);
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
