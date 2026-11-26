import { browserChoice } from '../browser.mjs';
import { chromium } from 'playwright-core';
// Measures: a person's own numbers, as a plain list. Nothing judged, nothing shared.
const [base, shots] = process.argv.slice(2);
const browser = await chromium.launch({ ...browserChoice, headless: true });
const page = await browser.newPage({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2 });
const bad = [];
const outside = new Set();
page.on('request', (r) => { const u = new URL(r.url()); if (u.origin !== new URL(base).origin && u.protocol.startsWith('http')) outside.add(u.host); });
page.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 400) bad.push(`${r.request().method()} ${new URL(r.url()).pathname} ${r.status()}`); });
page.on('console', (m) => { if (m.type() === 'error') bad.push('console error: ' + m.text()); });
page.on('pageerror', (e) => bad.push('page error: ' + e.message));
const say = (what, ok) => console.log((ok ? 'ok   ' : 'FAIL ') + what);
const wait = (ms = 700) => page.waitForTimeout(ms);
const text = async () => page.locator('main').innerText();
const dialog = page.getByRole('dialog');
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const inDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return iso(d); };
const send = (method, address, body) => page.evaluate(async ([m, a, b]) => { const r = await fetch(a, { method: m, headers: { 'Content-Type': 'application/json' }, body: b === undefined ? undefined : JSON.stringify(b) }); return r.status === 204 ? null : r.json(); }, [method, address, body]);
const tooSmall = async (locators) => {
  const small = [];
  for (const loc of locators) for (const el of await loc.all()) { if (await el.isVisible()) { const box = await el.boundingBox(); if (box && box.height < 43.5) small.push((await el.innerText().catch(() => '')).slice(0, 30) || (await el.getAttribute('aria-label')) || '?'); } }
  return small;
};
const noSideways = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

await page.goto(base + '/'); await wait();
await page.getByRole('textbox').first().fill('trial');
await page.locator('input[type=password]').fill('trial-only-password-8021');
await page.getByRole('button', { name: 'Sign in' }).click(); await wait(1500);

// ---------- the tab ----------
await page.goto(base + '/routines'); await wait(1000);
say('there is a Measures chip on Routines, under on track', await page.getByRole('link', { name: 'Measures', exact: true }).first().isVisible());
await page.getByRole('link', { name: 'Measures', exact: true }).first().click(); await wait(1000);
say('with none yet, the page says how to start, and that only you can see them', /No measures yet/.test(await text()) && (await page.locator('[data-measures-private]').innerText()).includes('Only you can see these'));
say('the page says they are in your own download', (await page.locator('[data-measures-private]').innerText()).includes('full download'));

// ---------- making one, and adding entries ----------
await page.getByRole('button', { name: '+ New measure' }).click(); await wait(500);
await dialog.getByLabel('Name of the measure').fill('Weight');
await dialog.getByLabel('Unit', { exact: true }).fill('lb');
const formSmall = await tooSmall([dialog.locator('button'), dialog.locator('input')]);
say('the form has 44px controls' + (formSmall.length ? ` (too small: ${formSmall})` : ''), formSmall.length === 0 && await noSideways());
await dialog.getByRole('button', { name: 'Save' }).click(); await wait(900);
const m = page.locator('[data-measure="Weight"]');
say('the measure is on the page with no target shown', await m.isVisible() && (await m.locator('[data-target]').count()) === 0);
for (const [n, d] of [[183.4, -9], [182.9, -6], [182.0, -3]]) {
  await m.getByLabel('Day of the entry for Weight').fill(inDays(d));
  await m.getByLabel('New entry for Weight').fill(String(n));
  await m.getByRole('button', { name: 'Add the entry to Weight' }).click(); await wait(500);
}
await m.getByLabel('New entry for Weight').fill('181.6');
await m.getByLabel('Day of the entry for Weight').fill(inDays(0));
await m.getByRole('button', { name: 'Add the entry to Weight' }).click(); await wait(600);
let entries = await m.locator('[data-entry]').allInnerTexts();
say('the recent entries are a plain list, newest first, with the unit', entries.length === 4 && entries[0].includes('181.6 lb') && entries[3].includes('183.4 lb'));
say('nothing says better, worse or up or down, and nothing is colored for it', !/good|bad|better|worse|up|down|on track|goal|streak/i.test((await m.innerText()).replace(/Day of the entry|Add the entry|New entry/g, '')) && (await m.evaluate((el) => [...el.querySelectorAll('*')].filter((n) => [...n.classList].some((c) => /^(text|bg)-(red|green|amber|emerald|rose)/.test(c))).length)) === 0);
await page.reload(); await wait(1000);
say('they are still there after reloading', (await m.locator('[data-entry]').count()) === 4);

// An optional target, only if the person adds one.
await m.getByRole('button', { name: 'Change Weight' }).click(); await wait(500);
await dialog.getByLabel('Target').fill('175');
await dialog.getByRole('button', { name: 'Save' }).click(); await wait(900);
say('a target shows as a plain line, only because the person added it', (await m.locator('[data-target]').innerText()) === 'Target: 175 lb');

// A second measure without a unit, and taking an entry back.
await page.getByRole('button', { name: '+ New measure' }).click(); await wait(500);
await dialog.getByLabel('Name of the measure').fill('Pages read');
await dialog.getByRole('button', { name: 'Save' }).click(); await wait(900);
const pages = page.locator('[data-measure="Pages read"]');
await pages.getByLabel('New entry for Pages read').fill('40');
await pages.getByRole('button', { name: 'Add the entry to Pages read' }).click(); await wait(600);
say('a measure with no unit shows the bare number', (await pages.locator('[data-entry]').first().innerText()).includes('40') && !(await pages.locator('[data-entry]').first().innerText()).includes('lb'));
await pages.getByRole('button', { name: /^Remove the entry on/ }).first().click(); await wait(600);
say('an entry can be taken back', (await pages.locator('[data-entry]').count()) === 0);
const pageSmall = await tooSmall([page.locator('main button'), page.locator('main input'), page.locator('main select')]);
say('the page has 44px controls and fits 375px' + (pageSmall.length ? ` (too small: ${pageSmall})` : ''), pageSmall.length === 0 && await noSideways());
await page.screenshot({ path: shots + '/measures-375.png', fullPage: true });
await page.evaluate(() => document.documentElement.classList.add('dark')); await wait(300);
await page.screenshot({ path: shots + '/measures-dark-375.png', fullPage: true });
await page.evaluate(() => document.documentElement.classList.remove('dark'));

// ---------- private ----------
const found = await send('GET', '/api/search?q=Weight');
say('search never finds a measure', !found.some((r) => /measure/i.test(JSON.stringify(r))) && !(await send('GET', '/api/search?q=Pages%20read')).length);
await page.goto(base + '/'); await wait(1500);
say('the front page does not show them', !(await text()).includes('181.6') && !(await text()).includes('Pages read'));
const zip = await page.evaluate(async () => { const r = await fetch('/api/export/everything.zip'); return r.status; });
say('the person\'s own full download is allowed', zip === 200);

say('nothing was asked of another address' + (outside.size ? ` (${[...outside]})` : ''), outside.size === 0);
say('no failed requests or errors' + (bad.length ? `: ${bad.join('; ')}` : ''), bad.length === 0);
await browser.close();
