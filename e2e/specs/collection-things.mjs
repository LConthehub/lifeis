// Physical copies from the Collection as things: the Collection chip on Things and the home report. At phone width.
import { browserChoice } from '../browser.mjs';
import { chromium } from 'playwright-core';
const [base, shots] = process.argv.slice(2);
const PASS = 'trial-only-password-8041';
const results = [];
const check = (name, ok, extra = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); };
process.on('exit', () => console.log(results.join(String.fromCharCode(10))));

const browser = await chromium.launch({ ...browserChoice, headless: true });
const page = await (await browser.newContext({ viewport: { width: 375, height: 812 } })).newPage();
page.on('pageerror', (e) => check('no page errors', false, e.message));
page.on('dialog', (d) => d.accept());
await page.goto(base + '/'); await page.waitForTimeout(1000);
await page.getByRole('textbox').first().fill('ana');
await page.locator('input[type=password]').fill(PASS);
await page.getByRole('button', { name: /Make my account|Sign in/ }).click(); await page.waitForTimeout(2000);
const first = page.getByRole('dialog');
if (await first.isVisible().catch(() => false)) { await first.getByRole('button', { name: 'Set up Life Is' }).click(); await page.waitForTimeout(1500); }

const ids = await page.evaluate(async () => {
  const send = (method, url, body) => fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
  const kind = (await send('POST', '/api/things/kinds', { name: 'Appliances', icon: '📺' }))[0].id;
  const den = (await send('POST', '/api/things/places', { name: 'Den' })).find((p) => p.name === 'Den').id;
  await send('POST', '/api/things/items', { kind_id: kind, name: 'Television', place_id: den, records: { price_cents: 50000 } });
  // One title with a disc and a server-only copy: counts once. A wanted title: never counts.
  const alien = await send('POST', '/api/media', { type: 'film', title: 'Alien', year: 1979, copy: { format: 'Blu-ray', place_id: den, cost_cents: 1500, value_cents: 2500 } });
  await send('POST', `/api/media/${alien.id}/copies`, { format: 'Digital' });
  await send('POST', '/api/media', { type: 'music', title: 'Rumours', wanted: true });
  return { alien: alien.id };
});
const noSideways = async (what) => check(`${what} fits 375px wide with no sideways scroll`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
const small = async (what, locator) => {
  const heights = await locator.evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
  check(`${what} are at least 44px tall`, heights.length > 0 && heights.every((h) => h >= 43.5), JSON.stringify(heights));
};

// Things: without the chip, nothing changes.
await page.goto(`${base}/things`); await page.waitForTimeout(1500);
const chip = page.getByRole('button', { name: /^Collection/ });
check('the Collection chip counts one copy, not two', (await chip.innerText()).replace(/\s+/g, ' ') === 'Collection 1', await chip.innerText());
check('the chip starts off and Alien is not listed', (await chip.getAttribute('aria-pressed')) === 'false' && !(await page.locator('main').innerText()).includes('Alien'));
check('Everything counts only what was already kept', /Everything\s*1\b/.test(await page.locator('main').innerText()));
await chip.click(); await page.waitForTimeout(600);
const on = (await page.locator('main').innerText()).replace(/\s+/g, ' ');
check('with the chip on, the disc is a row with its format and place', on.includes('Alien (1979)') && on.includes('Blu-ray') && on.includes('Den'), on.slice(0, 300));
check('the Things total adds the copy once: 2 things, $25.00 from the Collection', /2 things in all, 1 of them from your Collection, worth \$25\.00/.test(on), on.slice(0, 300));
check('a wanted title is not listed', !on.includes('Rumours'));
check('Everything now counts 2', /Everything\s*2\b/.test(on));
await small('the Collection chip and rows', page.locator('[data-collection-things] a, button[aria-pressed]'));
await noSideways('Things with the Collection chip on');
await page.screenshot({ path: `${shots}/things-collection.png`, fullPage: true });
await page.locator('[data-collection-things] a').first().click(); await page.waitForTimeout(1200);
check('a row leads to its title in the Collection', page.url().endsWith(`/media/${ids.alien}`), page.url());
// The Collection itself is unchanged: still two copies on its own page.
check('the title still has both its copies', (await page.locator('main').innerText()).includes('Digital'));
await page.goto(`${base}/things`); await page.waitForTimeout(1200);
await page.getByRole('button', { name: /^Collection/ }).click(); await page.waitForTimeout(300);
await page.getByRole('button', { name: /^Collection/ }).click(); await page.waitForTimeout(500);
check('turning the chip off puts the list back', !(await page.locator('main').innerText()).includes('Alien'));

// The home report: by room, counted once, server copy left out.
await page.goto(`${base}/things/report`); await page.waitForTimeout(1500);
const report = (await page.locator('main').innerText()).replace(/\s+/g, ' ');
check('the home report totals 2 things worth $525.00', /2 things · worth \$525\.00 in all/.test(report), report.slice(0, 400));
check('the report says one of them is from the Collection', report.includes('1 of them is a disc, record, book or cartridge from your Collection'));
check('the disc sits in its room, counted in its cost and worth', /Den[\s\S]*Alien/.test(report) && report.includes('Cost $515.00 in all') && report.includes('cost $515.00 · worth now $525.00') && report.includes('$25.00'), report.slice(0, 500));
check('the report links the disc to its title', (await page.locator(`a[href="/media/${ids.alien}"]`).count()) === 1);
check('the wanted title is not in the report', !report.includes('Rumours'));
await noSideways('the home report');
await page.screenshot({ path: `${shots}/report-collection.png`, fullPage: true });
await browser.close();
