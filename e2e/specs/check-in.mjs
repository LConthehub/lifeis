import { browserChoice } from '../browser.mjs';
import { chromium } from 'playwright-core';
// The daily check-in: sleep, water, energy and a line, one a day, changeable, with the last weeks as plain rows and flat bars. At 375px.
const [base, shots] = process.argv.slice(2);
const browser = await chromium.launch({ ...browserChoice, headless: true });
const page = await browser.newPage({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2 });
const bad = [];
const outside = new Set();
page.on('request', (r) => { const u = new URL(r.url()); if (u.origin !== new URL(base).origin && u.protocol.startsWith('http')) outside.add(u.host); });
page.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 400 && !refusing && !(expected.has(r.request().method() + ' ' + new URL(r.url()).pathname))) bad.push(`${r.request().method()} ${new URL(r.url()).pathname} ${r.status()}`); });
page.on('console', (m) => { if (m.type() === 'error' && !refusing) bad.push('console error: ' + m.text()); });
page.on('pageerror', (e) => bad.push('page error: ' + e.message));
const expected = new Set();
let refusing = false;
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

await page.goto(base + '/check-in'); await wait(1000);
say('the page says only you can see it, and it is in your download', (await page.locator('[data-private]').innerText()).includes('Only you can see this') && (await page.locator('[data-private]').innerText()).includes('full download'));
say('with nothing kept, it says days not checked in are simply not listed', /Nothing kept yet/.test(await text()));
const formSmall = await tooSmall([page.locator('main button'), page.locator('main input'), page.locator('main a')]);
say('the form has 44px controls and fits 375px' + (formSmall.length ? ` (too small: ${formSmall})` : ''), formSmall.length === 0 && await noSideways());

// ---------- ten seconds ----------
await page.getByLabel('Sleep in hours').fill('7.5');
await page.getByLabel('Water in glasses').fill('6');
await page.getByRole('button', { name: 'Energy 3', exact: true }).click();
await page.getByLabel('One line').fill('Slow start, better by noon');
await page.getByRole('button', { name: 'Keep it' }).click(); await wait(800);
say('it is kept for today, and shows in the last weeks', (await page.locator('[data-entry]').count()) === 1 && (await page.locator('[data-entry]').first().getAttribute('data-entry')) === iso(new Date()));
const row = page.locator('[data-entry]').first();
say('the row shows sleep, water and energy, and the line', (await row.innerText()).includes('7.5 h') && (await row.innerText()).includes('6') && (await row.innerText()).includes('3 of 5') && (await row.locator('[data-line]').innerText()) === 'Slow start, better by noon');
say('each has a flat bar', (await row.locator('[role=img]').count()) === 3);

// ---------- each part is optional, and a day can be changed ----------
await page.getByRole('button', { name: 'Energy 3', exact: true }).click(); // taken back
await page.getByLabel('Sleep in hours').fill('');
await page.getByLabel('Water in glasses').fill('8');
await page.getByLabel('One line').fill('');
await page.getByRole('button', { name: 'Change this day' }).click(); await wait(800);
say('saving again changes the same day, and leaves what was not given empty', (await page.locator('[data-entry]').count()) === 1 && (await row.innerText()).includes('Sleep: not kept') && (await row.innerText()).includes('Energy: not kept') && (await row.locator('[data-line]').count()) === 0);
refusing = true;
await page.getByLabel('Water in glasses').fill(''); await page.getByRole('button', { name: 'Change this day' }).click(); await wait(600);
refusing = false;
say('a check-in with nothing in it is refused in words', /Add at least one thing/.test(await text()));

// ---------- an earlier day ----------
await page.getByLabel('Day', { exact: true }).fill(inDays(-3));
await page.getByLabel('Sleep in hours').fill('6'); await page.getByLabel('Water in glasses').fill('4');
await page.getByRole('button', { name: 'Energy 5', exact: true }).click();
await page.getByRole('button', { name: 'Keep it' }).click(); await wait(800);
const days = await page.locator('[data-entry]').evaluateAll((els) => els.map((e) => e.dataset.entry));
say('an earlier day goes in below today, newest first', days.join() === [iso(new Date()), inDays(-3)].join());
await page.reload(); await wait(1000);
say('they are still there after reloading', (await page.locator('[data-entry]').count()) === 2);

// ---------- nothing judged ----------
const shown = (await text()).replace(/Keep it|Change this day|Remove this day/g, '');
say('nothing says good, bad, better, worse, score, goal or streak, and nothing is colored for up or down', !/\b(good|bad|better|worse|score|goal|streak|great|poor|should|try to|on track)\b/i.test(shown.replace(/better by noon/i, '')) && (await page.locator('main').evaluate((el) => [...el.querySelectorAll('*')].filter((n) => [...n.classList].some((c) => /^(text|bg)-(red|green|amber|emerald|rose|yellow)/.test(c) && !/text-red-(600|700)/.test(c))).length)) === 0);

// ---------- changing one from the list, and taking one back ----------
await page.locator(`[data-entry="${inDays(-3)}"]`).getByRole('button', { name: /^Change / }).click(); await wait(500);
say('Change brings that day into the form', (await page.getByLabel('Sleep in hours').inputValue()) === '6' && (await page.getByLabel('Day', { exact: true }).inputValue()) === inDays(-3));
await page.getByRole('button', { name: /^Remove the check-in for/ }).click(); await wait(800);
say('a day can be taken back', (await page.locator('[data-entry]').count()) === 1);

const pageSmall = await tooSmall([page.locator('main button'), page.locator('main input'), page.locator('main a')]);
say('the page has 44px controls and fits 375px' + (pageSmall.length ? ` (too small: ${pageSmall})` : ''), pageSmall.length === 0 && await noSideways());
await page.screenshot({ path: shots + '/check-in-375.png', fullPage: true });
await page.evaluate(() => document.documentElement.classList.add('dark')); await wait(300);
await page.screenshot({ path: shots + '/check-in-dark-375.png', fullPage: true });
await page.evaluate(() => document.documentElement.classList.remove('dark'));

// ---------- private ----------
say('search never finds a check-in', (await send('GET', '/api/search?q=Slow%20start')).length === 0);
await page.goto(base + '/'); await wait(1500);
say('the front page does not show it', !(await text()).includes('Slow start'));
await send('PUT', '/api/check-ins', { line: 'Plinthbottom line' });
const zip = await page.evaluate(async () => (await fetch('/api/export/everything.zip')).status);
say("the person's own full download is allowed", zip === 200);

say('nothing was asked of another address' + (outside.size ? ` (${[...outside]})` : ''), outside.size === 0);
say('no failed requests or errors' + (bad.length ? `: ${bad.join('; ')}` : ''), bad.length === 0);
await browser.close();
