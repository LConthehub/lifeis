// Pictures of the 1970s look, for judging it: the front page, a recipe, the things page, the collection, the sign-in
// page and Settings, each at desktop and phone width in light and dark, plus the website's front page. It also
// walks the Look setting, and checks the words on every page against the 4.5:1 contrast of WCAG AA in both looks.
//
//   node e2e/redesign-shots.mjs         (build the pages first: cd frontend && npx vite build; node docs/build-site.mjs)
//
// Pictures go to e2e/shots/redesign. Like e2e/run.mjs, it starts its own Life Is on a free port with its data in a
// folder that is thrown away afterwards: the made-up demo household for content, and an empty one for the sign-in page.
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';
import { browserChoice } from './browser.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const shots = path.join(here, 'shots', 'redesign');
mkdirSync(shots, { recursive: true });
const results = [];
const check = (name, ok, extra = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); };

const freePort = () => new Promise((resolve, reject) => {
  const probe = createServer(); probe.once('error', reject);
  probe.listen(0, '127.0.0.1', () => { const { port } = probe.address(); probe.close(() => resolve(port)); });
});
async function start(extra = {}) {
  const data = mkdtempSync(path.join(tmpdir(), 'lifeis-look-'));
  const port = await freePort(); const base = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, ['server/src/main.ts'], { cwd: root, stdio: 'ignore',
    env: { ...process.env, DATA_DIR: data, PORT: String(port), HOST: '127.0.0.1', STATIC_DIR: 'frontend/dist', ...extra } });
  for (let i = 0; i < 100; i += 1) { try { if ((await fetch(`${base}/api/health`)).ok) break; } catch { /* not up yet */ } await new Promise((r) => setTimeout(r, 200)); }
  return { base, stop: async () => { server.kill(); await new Promise((r) => { server.once('exit', r); setTimeout(r, 3000); }); rmSync(data, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } };
}

// The contrast of every piece of text on the page, against what is really behind it (backgrounds with some see-through
// are laid over the ones beneath). Reports the worst few. Things drawn over a gradient (the header) are checked on paper.
const audit = () => {
  const parse = (c) => { const m = /rgba?\(([^)]+)\)/.exec(c); if (!m) return null; const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p[3] ?? 1 }; };
  const over = (top, under) => ({ r: top.r * top.a + under.r * (1 - top.a), g: top.g * top.a + under.g * (1 - top.a), b: top.b * top.a + under.b * (1 - top.a), a: 1 });
  const lum = ({ r, g, b }) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  const page = parse(getComputedStyle(document.body).backgroundColor);
  const bad = []; let count = 0;
  for (const el of document.querySelectorAll('main *, nav[aria-label] *')) {
    if (el.closest('header')) continue;
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    if (!own) continue;
    const box = el.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) continue;
    const st = getComputedStyle(el);
    if (st.visibility === 'hidden' || st.opacity === '0') continue;
    // the colours behind it, from the outside in
    const layers = []; let skip = false;
    for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.backgroundImage !== 'none') { skip = true; break; }
      const bg = parse(cs.backgroundColor); if (bg && bg.a > 0) layers.unshift(bg);
      if (bg && bg.a === 1) break;
    }
    if (skip) continue;
    let back = page; for (const l of layers) back = over(l, back);
    let fore = parse(st.color); if (!fore) continue;
    fore = over({ ...fore, a: fore.a * (parseFloat(st.opacity) || 1) }, back);
    const r = ratio(fore, back); count += 1;
    const size = parseFloat(st.fontSize), heavy = parseInt(st.fontWeight, 10) >= 700;
    const need = size >= 24 || (size >= 18.66 && heavy) ? 3 : 4.5;
    if (r < need) bad.push({ r: +r.toFixed(2), text: el.textContent.trim().slice(0, 30), cls: String(el.className).slice(0, 70), size });
  }
  return { count, bad: bad.sort((a, b) => a.r - b.r).slice(0, 6), total: bad.length };
};

const browser = await chromium.launch({ ...browserChoice, headless: true });
const SIZES = { desktop: { width: 1280, height: 900 }, phone: { width: 390, height: 844 } };
const LOOKS = ['light', 'dark'];

const demo = await start({ DEMO_MODE: '1', DEMO_PASSWORD: 'a-demo-password-for-walk-throughs' });
const plain = await start();
const contrast = {};
try {
  // an account in the empty one, for its sign-in page
  const made = await fetch(`${plain.base}/api/auth/setup`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'ana', password: 'trial-only-password-8031' }) });
  check('an account for the sign-in page', made.ok);

  for (const [sizeName, viewport] of Object.entries(SIZES)) {
    for (const look of LOOKS) {
      const context = await browser.newContext({ viewport, hasTouch: sizeName === 'phone', deviceScaleFactor: 1 });
      // The choice is the stored one (what Settings > Look writes), not browser emulation.
      await context.addInitScript((l) => { try { if (!sessionStorage.getItem('seen')) { localStorage.setItem('lifeis.theme', l); sessionStorage.setItem('seen', '1'); } } catch { /* none */ } }, look);
      const page = await context.newPage();
      page.on('pageerror', (e) => check('no page errors', false, e.message));
      const snap = async (name) => { await page.waitForTimeout(700); await page.screenshot({ path: `${shots}/${name}-${look}-${sizeName}.png` }); };
      const audited = async (name) => { const a = await page.evaluate(audit); (contrast[`${sizeName} ${look}`] ??= []).push([name, a]); };

      // sign-in page, not signed in (the empty one)
      await page.goto(plain.base + '/'); await page.waitForTimeout(1000);
      check(`${look} ${sizeName}: the sign-in page is in the ${look} look`, (await page.evaluate(() => document.documentElement.classList.contains('dark'))) === (look === 'dark'));
      await snap('signin'); await audited('signin');
      await context.clearCookies();

      // the demo household
      await page.goto(demo.base + '/'); await page.waitForTimeout(1000);
      await page.getByRole('button', { name: 'Try the demo' }).click(); await page.waitForTimeout(2500);
      await snap('home'); await audited('home');
      await page.goto(demo.base + '/recipes'); await page.waitForTimeout(1200);
      await page.getByRole('link', { name: /Leek and potato soup/ }).first().click(); await page.waitForTimeout(1500);
      await snap('recipe'); await audited('recipe');
      await page.goto(demo.base + '/things'); await page.waitForTimeout(1500);
      await snap('things'); await audited('things');
      await page.goto(demo.base + '/media'); await page.waitForTimeout(1500);
      await snap('collection'); await audited('collection');
      await page.goto(demo.base + (sizeName === 'phone' ? '/settings/home' : '/settings')); await page.waitForTimeout(1500);
      await page.locator('#look').scrollIntoViewIfNeeded();
      await snap('settings'); await audited('settings');
      await context.close();
    }
  }

  // The Look setting itself: three choices, applied at once, remembered, and "same as this device" follows the device.
  const context = await browser.newContext({ viewport: SIZES.desktop, colorScheme: 'light' });
  const page = await context.newPage();
  const dark = () => page.evaluate(() => document.documentElement.classList.contains('dark'));
  await page.goto(demo.base + '/'); await page.getByRole('button', { name: 'Try the demo' }).click(); await page.waitForTimeout(2000);
  await page.goto(demo.base + '/settings'); await page.waitForTimeout(1200);
  const look = page.locator('#look');
  check('Settings has a Look section with Light, Dark and Same as this device', (await look.getByRole('radio').count()) === 3 && (await look.innerText()).includes('Same as this device'));
  check('nothing chosen follows the device (light device: light)', !(await dark()) && await look.getByRole('radio', { name: 'Same as this device' }).isChecked());
  await look.getByRole('radio', { name: 'Dark' }).check(); await page.waitForTimeout(300);
  check('choosing Dark makes it dark at once', await dark());
  check('and it is kept as lifeis.theme', (await page.evaluate(() => localStorage.getItem('lifeis.theme'))) === 'dark');
  await page.reload(); await page.waitForTimeout(1200);
  check('it is still dark after a reload, and Dark is the one checked', (await dark()) && await page.locator('#look').getByRole('radio', { name: 'Dark' }).isChecked());
  await page.locator('#look').getByRole('radio', { name: 'Light' }).check(); await page.waitForTimeout(300);
  check('choosing Light makes it light', !(await dark()));
  await page.locator('#look').getByRole('radio', { name: 'Same as this device' }).check(); await page.waitForTimeout(300);
  check('Same as this device on a light device is light', !(await dark()));
  await page.emulateMedia({ colorScheme: 'dark' }); await page.waitForTimeout(400);
  check('and follows the device when it goes dark while Life Is is open', await dark());
  await page.emulateMedia({ colorScheme: 'light' }); await page.waitForTimeout(400);
  check('and back to light', !(await dark()));
  // printing is black on white, whatever the look
  await page.locator('#look').getByRole('radio', { name: 'Dark' }).check();
  await page.goto(demo.base + '/media/print'); await page.waitForTimeout(1500);
  await page.emulateMedia({ media: 'print', colorScheme: 'dark' });
  check('printed, the page is white behind and black in front', await page.evaluate(() => { const b = getComputedStyle(document.body); return b.backgroundColor === 'rgb(255, 255, 255)'; }), await page.evaluate(() => getComputedStyle(document.body).backgroundColor));
  await context.close();

  // the website's front page
  for (const look of LOOKS) {
    const c = await browser.newContext({ viewport: SIZES.desktop, colorScheme: look });
    const p = await c.newPage();
    const outside = new Set(); p.on('request', (r) => { if (/^https?:/.test(r.url())) outside.add(new URL(r.url()).host); });
    await p.goto(pathToFileURL(path.join(root, 'docs', 'site', 'index.html')).href); await p.waitForTimeout(1000);
    await p.screenshot({ path: `${shots}/site-${look}-desktop.png` });
    check(`the website, ${look}: the display font loaded from the site`, await p.evaluate(() => document.fonts.check('700 20px "Fraunces Variable"')));
    check(`the website, ${look}: nothing from elsewhere`, outside.size === 0, [...outside].join(', '));
    await c.close();
    const c2 = await browser.newContext({ viewport: SIZES.phone, colorScheme: look });
    const p2 = await c2.newPage();
    await p2.goto(pathToFileURL(path.join(root, 'docs', 'site', 'index.html')).href); await p2.waitForTimeout(1000);
    await p2.screenshot({ path: `${shots}/site-${look}-phone.png` });
    await c2.close();
  }
} finally {
  await browser.close(); await demo.stop(); await plain.stop();
}

// the contrast, collected
for (const [where, pages] of Object.entries(contrast)) {
  const total = pages.reduce((n, [, a]) => n + a.count, 0), bad = pages.flatMap(([name, a]) => a.bad.map((b) => ({ name, ...b })));
  const bads = pages.reduce((n, [, a]) => n + a.total, 0);
  check(`contrast ${where}: ${total} pieces of text, all at AA`, bads === 0, bads ? `${bads} below: ` + bad.map((b) => `${b.name} ${b.r} "${b.text}" [${b.cls}] ${b.size}px`).join(' | ') : '');
}
console.log(results.join('\n'));
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
