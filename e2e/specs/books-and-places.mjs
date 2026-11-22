// The Books tab, and making a place ("Bedroom › Bookshelf") from inside the form that needs it.
import { browserChoice } from '../browser.mjs';
import { chromium } from 'playwright-core';
const [base, shots] = process.argv.slice(2);
const PASS = 'trial-only-password-8031';
const results = [];
const check = (name, ok, extra = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); };

const browser = await chromium.launch({ ...browserChoice, headless: true });
const page = await (await browser.newContext({ viewport: { width: 393, height: 852 }, hasTouch: true })).newPage();
page.on('pageerror', (e) => check('no page errors', false, e.message));
await page.goto(base + '/'); await page.waitForTimeout(1000);
await page.getByRole('textbox').first().fill('ana');
await page.locator('input[type=password]').fill(PASS);
await page.getByRole('button', { name: /Make my account|Sign in/ }).click(); await page.waitForTimeout(2000);
const dialog = page.getByRole('dialog');
if (await dialog.isVisible().catch(() => false)) { await dialog.getByRole('button', { name: 'Set up Life Is' }).click(); await page.waitForTimeout(1500); }

// One place already there, so the new path has to reuse it rather than make a second "Bedroom".
await page.evaluate(() => fetch('/api/things/places', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Bedroom' }) }));

await page.goto(base + '/media/books'); await page.waitForTimeout(800);
check('Books page has its heading', await page.getByRole('heading', { name: 'Books' }).isVisible());
check('empty Books page explains scanning', await page.getByText('No books yet').isVisible());
await page.getByRole('button', { name: '+ Add' }).click(); await page.waitForTimeout(500);
const form = page.getByRole('dialog');
check('new title starts as a book', (await form.locator('select').first().inputValue()) === 'book');
await form.getByLabel('Title *').fill('The Hobbit');
await form.getByLabel("What it's on").fill('Paperback');
await form.locator('select').nth(1).selectOption('new');
await form.getByLabel('The new place').fill('Bedroom › Bookshelf');
await page.screenshot({ path: `${shots}/books-new-place.png` });
await form.getByRole('button', { name: 'Add', exact: true }).click(); await page.waitForTimeout(800);
const chosen = await form.locator('select').nth(1).evaluate((s) => s.options[s.selectedIndex].text);
check('the new place is chosen', chosen === 'Bedroom › Bookshelf', chosen);
await form.getByRole('button', { name: /Save|Add it/ }).last().click(); await page.waitForTimeout(1200);
check('the book shows where it is', await page.getByText('Bedroom › Bookshelf').first().isVisible().catch(() => false));
const places = await page.evaluate(() => fetch('/api/things/places').then((r) => r.json()));
check('Bedroom was reused, not made twice', places.filter((p) => p.name === 'Bedroom').length === 1 && places.length === 2, places.map((p) => p.path).join(', '));

await page.goto(base + '/media/books'); await page.waitForTimeout(800);
check('Books tab lists it', await page.getByText('The Hobbit').isVisible());
await page.screenshot({ path: `${shots}/books-tab.png` });

// The same picker on a thing (a fresh account has no kinds of thing yet, so one is made first).
await page.evaluate(() => fetch('/api/things/kinds', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Toys', icon: '🧸' }) }));
await page.goto(base + '/things'); await page.waitForTimeout(800);
await page.screenshot({ path: `${shots}/books-things.png` });
await page.getByRole('button', { name: /\+ Add|Add a thing/ }).first().click(); await page.waitForTimeout(500);
const thing = page.getByRole('dialog');
await thing.getByLabel('What *').fill('Lego bin');
await thing.locator('select').filter({ has: page.locator('option[value="new"]') }).selectOption('new');
await thing.getByLabel('The new place').fill('Bedroom > Under the bed');
await thing.getByRole('button', { name: 'Add', exact: true }).click(); await page.waitForTimeout(800);
const placesAfter = await page.evaluate(() => fetch('/api/things/places').then((r) => r.json()));
check('a thing can make a place too', placesAfter.some((p) => p.path === 'Bedroom › Under the bed') && placesAfter.length === 3, placesAfter.map((p) => p.path).join(', '));

console.log(results.join('\n'));
await browser.close();
