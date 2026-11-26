// Things at home: no longer have it (and undoing it), insured, asset numbers on the page and the sticker, and fields of your own. At phone width.
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
  const post = (url, body) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
  const kind = (await post('/api/things/kinds', { name: 'Appliances', icon: '📺' }))[0].id;
  const living = (await post('/api/things/places', { name: 'Living room' }))[0].id;
  const tv = (await post('/api/things/items', { kind_id: kind, name: 'Television', place_id: living })).id;
  const lamp = (await post('/api/things/items', { kind_id: kind, name: 'Lamp', place_id: living })).id;
  return { tv, lamp };
});
const noSideways = async (what) => check(`${what} fits 375px wide with no sideways scroll`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));

// The asset number, small, on the thing's page; found by typing it.
await page.goto(`${base}/things/${ids.tv}`); await page.waitForTimeout(1200);
check('the thing page shows its asset number', (await page.locator('main').innerText()).includes('Asset 000-001'));
const found = await page.evaluate(async () => (await fetch('/api/things/items?q=000-002').then((r) => r.json())).map((t) => t.name));
check('typing an asset number finds the thing', JSON.stringify(found) === '["Lamp"]', JSON.stringify(found));

// Insured, and a field of its own, from the Change form.
await page.getByRole('button', { name: 'Change', exact: true }).click(); await page.waitForTimeout(500);
await page.getByLabel('Insured').check();
await page.getByRole('button', { name: '+ Add a field of your own' }).click();
await page.getByLabel('Name of your field').fill('Remote');
await page.getByLabel('Value of your field').fill('In the drawer');
await page.getByRole('button', { name: 'Save' }).click(); await page.waitForTimeout(1500);
const main = (await page.locator('main').innerText()).replace(/\s+/g, ' ');
check('insured and its own field show on the page', main.includes('Insured') && main.includes('Remote') && main.includes('In the drawer'), main.slice(0, 300));
await noSideways('the thing page');
// One tap on "I used it": today, with Undo and Add details; Last used before it.
check('a thing never used says Not used yet', (await page.locator('main').innerText()).includes('Not used yet'));
await page.getByRole('button', { name: 'I used it' }).click(); await page.waitForTimeout(800);
const usedText = await page.locator('[data-did]').innerText();
check('one tap says Used it today, with Undo and Add details', usedText.includes('Used it today') && await page.getByRole('button', { name: 'Undo' }).isVisible() && await page.getByRole('button', { name: 'Add details' }).isVisible(), usedText.replace(/\s+/g, ' '));
const usedTall = await page.locator('[data-did]').getByRole('button').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
check('Undo and Add details are at least 44px tall', usedTall.length === 2 && usedTall.every((h) => h >= 44), usedTall.join(','));
await page.getByRole('button', { name: 'Undo' }).click(); await page.waitForTimeout(800);
check('Undo takes it back to Not used yet', (await page.locator('main').innerText()).includes('Not used yet'));
await page.screenshot({ path: `${shots}/things-kept-thing.png`, fullPage: true });

// Its sticker carries the number.
await page.goto(`${base}/things/stickers?ids=${ids.tv}`); await page.waitForTimeout(1500);
check('the sticker prints the asset number', (await page.locator('[data-asset]').first().innerText()) === '000-001');

// The report can be narrowed to the insured things.
await page.goto(`${base}/things/report`); await page.waitForTimeout(1500);
check('the report starts with both things', (await page.getByLabel('The inventory').innerText()).includes('Lamp'));
await page.getByLabel(/Only insured things/).check(); await page.waitForTimeout(1200);
const sheet = await page.getByLabel('The inventory').innerText();
check('only insured things shows just the television', sheet.includes('Television') && !sheet.includes('Lamp'), sheet.slice(0, 200));
await noSideways('the report');

// No longer have it: sold, with who to and the price. It leaves the list and can be undone.
await page.goto(`${base}/things/${ids.lamp}`); await page.waitForTimeout(1200);
await page.getByRole('button', { name: 'No longer have it' }).click(); await page.waitForTimeout(500);
await page.screenshot({ path: `${shots}/things-kept-gone-form.png` });
await page.getByLabel('Who to (if you want to say)').fill('A neighbor');
await page.getByLabel('Sold for (dollars)').fill('12.50');
await page.getByRole('button', { name: 'Keep it' }).click(); await page.waitForTimeout(1500);
const banner = (await page.locator('[data-gone]').innerText()).replace(/\s+/g, ' ');
check('the page says it was sold, to whom and for how much', banner.includes('Sold') && banner.includes('to A neighbor') && banner.includes('$12.50'), banner);
await page.screenshot({ path: `${shots}/things-kept-gone.png`, fullPage: true });
await page.goto(`${base}/things`); await page.waitForTimeout(1200);
check('it is gone from the list', !(await page.locator('main').innerText()).includes('Lamp'));
await page.getByRole('button', { name: 'No longer have' }).click(); await page.waitForTimeout(1000);
check('and shown under "No longer have"', (await page.locator('main').innerText()).includes('Lamp') && (await page.locator('main').innerText()).includes('Sold'));
await noSideways('the "No longer have" list');
await page.getByRole('link', { name: /Lamp/ }).first().click(); await page.waitForTimeout(1200);
await page.getByRole('button', { name: 'I have it again' }).click(); await page.waitForTimeout(1200);
check('undoing it puts it back', (await page.locator('[data-gone]').count()) === 0 && (await page.getByRole('button', { name: 'No longer have it' }).count()) === 1);

await browser.close();
