// Packing: boxes made in one go, one packed by scanning and typing, found by search, then unpacked.
import { browserChoice } from '../browser.mjs';
import { chromium } from 'playwright-core';
const [base, shots] = process.argv.slice(2);
const PASS = 'trial-only-password-8031';
const results = [];
const check = (name, ok, extra = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); };
process.on('exit', () => console.log(results.join(String.fromCharCode(10))));

const browser = await chromium.launch({ ...browserChoice, headless: true });
const page = await (await browser.newContext({ viewport: { width: 393, height: 852 } })).newPage();
page.on('pageerror', (e) => check('no page errors', false, e.message));
await page.goto(base + '/'); await page.waitForTimeout(1000);
await page.getByRole('textbox').first().fill('ana');
await page.locator('input[type=password]').fill(PASS);
await page.getByRole('button', { name: /Make my account|Sign in/ }).click(); await page.waitForTimeout(2000);
const first = page.getByRole('dialog');
if (await first.isVisible().catch(() => false)) { await first.getByRole('button', { name: 'Set up Life Is' }).click(); await page.waitForTimeout(1500); }

await page.evaluate(() => fetch('/api/things/kinds', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Household', icon: '🏠' }) }));

await page.goto(`${base}/things/places`); await page.waitForTimeout(1000);
await page.getByRole('link', { name: 'Packing', exact: true }).click(); await page.waitForTimeout(1000);
const make = page.getByRole('form', { name: 'Make boxes' });
await make.getByLabel('How many boxes').fill('3');
await make.getByLabel('Going to (a room)').fill('Kitchen');
await make.getByRole('button', { name: 'Make them' }).click(); await page.waitForTimeout(1200);
const kitchen = page.getByRole('region', { name: 'Boxes for Kitchen' });
check('three numbered boxes are made for the kitchen', ['Box 1', 'Box 2', 'Box 3'].every((b) => kitchen.getByText(b, { exact: true }).isVisible()) && (await kitchen.locator('[data-box-state="packing"]').count()) === 3);
check('the page says how far along things are', (await page.locator('[data-progress]').innerText()).includes('3 boxes, 0 things in them: 3 being packed'), await page.locator('[data-progress]').innerText());

// Pack the first box: type two things in.
await kitchen.getByRole('link', { name: 'Pack it' }).first().click(); await page.waitForTimeout(1200);
check('packing a box opens the fill page for it', await page.getByRole('heading', { name: 'Filling Box 1' }).isVisible());
for (const thing of ['Kettle', 'Toaster']) {
  await page.getByLabel('Something with no barcode').fill(thing);
  await page.getByLabel('Something with no barcode').press('Enter'); await page.waitForTimeout(900);
}
await page.goto(`${base}/things/packing`); await page.waitForTimeout(1000);
check('the box lists what went in', (await kitchen.innerText()).replace(/\s+/g, ' ').includes('2 things: Kettle, Toaster'));
await kitchen.getByRole('button', { name: 'Mark packed' }).first().click(); await page.waitForTimeout(900);
check('it can be marked packed', (await kitchen.locator('[data-box-state="packed"]').count()) === 1);

await page.keyboard.press('/'); await page.waitForTimeout(300);
await page.getByLabel('Search everything', { exact: true }).fill('kettle'); await page.waitForTimeout(1200);
const found = (await page.getByRole('list', { name: 'What was found' }).innerText()).replace(/\s+/g, ' ');
check('search says which box the kettle is in', found.includes('Kettle') && found.includes('📍 Box 1'), found);
await page.keyboard.press('Escape'); await page.waitForTimeout(300);

await page.goto(`${base}/things/places/stickers?boxes=1`); await page.waitForTimeout(2500);
check('the boxes’ stickers are ready to print', (await page.locator('img[data-code]').count()) === 3);

// Unpack it into a new place.
await page.goto(`${base}/things/packing`); await page.waitForTimeout(1000);
await kitchen.getByRole('button', { name: 'Unpack it…' }).click(); await page.waitForTimeout(500);
const unpack = page.getByRole('dialog');
await unpack.getByLabel('Where its things go').selectOption('new');
await unpack.getByLabel('The new place').fill('New kitchen › Cupboard');
await unpack.getByRole('button', { name: 'Add', exact: true }).click(); await page.waitForTimeout(800);
await unpack.getByRole('button', { name: 'Unpack it' }).click(); await page.waitForTimeout(1500);
check('unpacking says how many things were put away', (await page.getByRole('status').innerText()).includes('Box 1 is unpacked: 2 things put away'));
check('the box is empty and marked unpacked', (await kitchen.locator('[data-box-state="unpacked"]').count()) === 1 && (await kitchen.innerText()).includes('empty'));
const kettle = await page.evaluate(() => fetch('/api/things/items?q=kettle').then((r) => r.json()).then(async (l) => [l[0].place, (await fetch(`/api/things/items/${l[0].id}/history`).then((r) => r.json()))[0]]));
check('the kettle is in its new home, and remembers the box', kettle[0] === 'New kitchen › Cupboard' && kettle[1].from_place === 'Box 1' && kettle[1].note === 'unpacked', JSON.stringify(kettle));
await page.screenshot({ path: `${shots}/packing.png`, fullPage: true });
await browser.close();
