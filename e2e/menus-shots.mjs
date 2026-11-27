// Pictures of the renamed menus on the demo household, at phone width (375): Home with its bottom bar, the open
// drop-down, each section's first page with its tab row, Plans with Holidays chosen, Routines with Measures, and
// Things with the Licenses chip. It also checks the old addresses still show the right section and tab, no section
// has more than five tabs, and nothing scrolls sideways.
//
//   node e2e/menus-shots.mjs      (build the pages first: cd frontend && npx vite build)
//
// Pictures go to e2e/shots/menus-*.png. Like e2e/run.mjs it starts its own Life Is on a free port, with its data
// in a folder that is thrown away afterwards.
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
const shots = path.join(here, 'shots');
mkdirSync(shots, { recursive: true });
const results = [];
const check = (name, ok, extra = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' (' + extra + ')' : ''}`); };
const freePort = () => new Promise((resolve, reject) => {
  const probe = createServer(); probe.once('error', reject);
  probe.listen(0, '127.0.0.1', () => { const { port } = probe.address(); probe.close(() => resolve(port)); });
});
const data = mkdtempSync(path.join(tmpdir(), 'lifeis-menus-'));
const port = await freePort(); const base = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ['server/src/main.ts'], { cwd: root, stdio: 'ignore',
  env: { ...process.env, DATA_DIR: data, PORT: String(port), HOST: '127.0.0.1', STATIC_DIR: 'frontend/dist', DEMO_MODE: '1', DEMO_PASSWORD: 'a-demo-password-for-walk-throughs' } });
for (let i = 0; i < 100; i += 1) { try { if ((await fetch(`${base}/api/health`)).ok) break; } catch { /* not up yet */ } await new Promise((r) => setTimeout(r, 200)); }

const browser = await chromium.launch(browserChoice);
try {
  const context = await browser.newContext({ viewport: { width: 375, height: 812 }, hasTouch: true, deviceScaleFactor: 2 });
  const page = await context.newPage();
  await page.goto(base + '/'); await page.waitForTimeout(1000);
  await page.getByRole('button', { name: 'Try the demo' }).click(); await page.waitForTimeout(2500);
  const go = async (to) => { await page.goto(base + to); await page.waitForTimeout(1500); };
  const shot = (name) => page.screenshot({ path: path.join(shots, `menus-${name}.png`) });
  const sideways = async (tag) => check(`${tag}: nothing scrolls sideways`, (await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 0);
  const sentence = async () => (await page.locator('[data-life-sentence]').innerText()).replace(/\s+/g, ' ').trim();
  const tabsOf = async (word) => (await page.getByRole('navigation', { name: `Life is ${word}` }).getByRole('link').allInnerTexts()).map((t) => t.trim());
  const current = async (word) => (await page.getByRole('navigation', { name: `Life is ${word}` }).locator('a.bg-white\\/25').allInnerTexts()).map((t) => t.trim()).join();

  await go('/'); await shot('home'); await sideways('home');
  const bar = page.getByRole('navigation', { name: 'Home and sections' });
  const heights = await bar.getByRole('link').evaluateAll((ls) => ls.map((l) => Math.round(l.getBoundingClientRect().height)));
  check('the bottom bar is 44px or taller everywhere', heights.every((h) => h >= 44), heights.join(','));
  check('the bottom bar reads Life is, on track, cooking, in order, budgeted, entertaining', (await bar.getByRole('link').allInnerTexts()).map((t) => t.trim()).join(',') === 'Life is,on track,cooking,in order,budgeted,entertaining', (await bar.innerText()).replace(/\s+/g, ' '));

  const button = page.locator('header button[aria-haspopup]');
  await go('/calendar'); await button.click(); await page.waitForTimeout(300); await shot('dropdown');
  const rows = (await page.getByRole('navigation', { name: 'Sections', exact: true }).getByRole('link').allInnerTexts()).map((t) => t.trim());
  check('the drop-down lists home and the five sections in order', rows.join(',') === 'home,on track,cooking,in order,budgeted,entertaining', rows.join(','));
  await page.keyboard.press('Escape');

  const FIRST = [['on track', '/calendar', 'Calendar,Routines,Plans,Projects,Activities', 'Calendar'], ['cooking', '/week', 'Week,Groceries,Recipes,Pantry,Prices', 'Week'],
    ['in order', '/manual', 'House Manual,Upkeep,Pets,Places,Things', 'House Manual'], ['budgeted', '/money', 'This month,Income and bills,Goals,Year', 'This month'],
    ['entertaining', '/media', 'Collection,Lists,Connections', 'Collection']];
  for (const [word, to, tabs, now] of FIRST) {
    await go(to); await shot(word.replace(' ', '-')); await sideways(word);
    check(`${word}: header reads Life is ${word}`, (await sentence()) === `Life is ${word}`, await sentence());
    check(`${word}: tabs are ${tabs}`, (await tabsOf(word)).join(',') === tabs, (await tabsOf(word)).join(','));
    check(`${word}: ${now} is the current tab`, (await current(word)) === now, await current(word));
    const tall = await page.getByRole('navigation', { name: `Life is ${word}` }).getByRole('link').evaluateAll((ls) => ls.map((l) => Math.round(l.getBoundingClientRect().height)));
    check(`${word}: tabs are 44px or taller`, tall.every((h) => h >= 44), tall.join(','));
    // One row only (owner, Nov 25, 2026): every tab starts at the same height, and none is cut off at the right.
    const row = await page.getByRole('navigation', { name: `Life is ${word}` }).getByRole('link').evaluateAll((ls) => ls.map((l) => { const r = l.getBoundingClientRect(); return { top: Math.round(r.top), right: Math.round(r.right) }; }));
    check(`${word}: tabs fit one row`, new Set(row.map((r) => r.top)).size === 1 && row.every((r) => r.right <= 375), JSON.stringify(row));
  }
  // each section in the drop-down opens its first tab
  for (const [word, to] of FIRST) {
    await go('/settings'); await button.click(); await page.getByRole('navigation', { name: 'Sections', exact: true }).getByRole('link', { name: word, exact: true }).click(); await page.waitForTimeout(800);
    check(`the drop-down opens ${word} on ${to}`, new URL(page.url()).pathname === to, page.url());
  }

  // old addresses: the right section and tab
  const OLD = [['/measures', 'on track', 'Routines'], ['/plans/holidays', 'on track', 'Plans'], ['/plans/trips', 'on track', 'Plans'], ['/manual/services', 'in order', 'House Manual'],
    ['/things/licenses', 'in order', 'Things'], ['/things/activities', 'on track', 'Activities'], ['/media/books', 'entertaining', 'Collection'], ['/recipes', 'cooking', 'Recipes'], ['/money/year', 'budgeted', 'Year']];
  for (const [to, word, tab] of OLD) {
    await go(to);
    check(`${to} shows ${word} and the ${tab} tab`, (await sentence()) === `Life is ${word}` && (await current(word)) === tab, `${await sentence()} / ${await current(word)}`);
  }

  await go('/plans/holidays'); await shot('plans-holidays'); await sideways('plans/holidays');
  await go('/plans/trips'); await sideways('plans/trips');
  await go('/routines'); await page.getByRole('link', { name: 'Measures', exact: true }).first().click(); await page.waitForTimeout(1200);
  check('the Measures chip opens /measures', new URL(page.url()).pathname === '/measures');
  await shot('routines-measures'); await sideways('measures');
  await go('/manual'); await page.getByRole('link', { name: 'Home lab', exact: true }).click(); await page.waitForTimeout(1200);
  check('the Home lab chip opens /manual/services', new URL(page.url()).pathname === '/manual/services'); await sideways('home lab');
  await go('/things'); await page.getByRole('link', { name: 'Licenses', exact: true }).first().click(); await page.waitForTimeout(1200);
  check('the Licenses chip opens /things/licenses', new URL(page.url()).pathname === '/things/licenses');
  await shot('things-licenses'); await sideways('licenses');
  await go('/things'); await shot('things'); await sideways('things');
} finally {
  await browser.close(); server.kill();
  console.log(results.join('\n'));
  await new Promise((r) => setTimeout(r, 1500));
  try { rmSync(data, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }); } catch { /* the temp folder goes later */ }
}
if (results.some((r) => r.startsWith('FAIL'))) process.exit(1);
