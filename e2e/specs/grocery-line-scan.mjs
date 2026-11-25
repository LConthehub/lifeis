// Scanning from a line of the grocery list: a barcode typed in (the camera is not needed) is taught as that
// line's grocery, the line ticks off at once, last time's price is filled in and kept as a guess unless a price
// is typed, a second barcode joins the same grocery, a barcode known as something else is asked about, and a
// line typed freely becomes a known grocery. Pictures at phone width, light and dark.
import { browserChoice } from '../browser.mjs';
import { chromium } from 'playwright-core';
const [base, shots] = process.argv.slice(2);
const results = [];
const check = (name, ok, extra = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${!ok && extra ? ' :: ' + String(extra).replace(/\s+/g, ' ').slice(0, 400) : ''}`); };
process.on('exit', () => { console.log(results.join('\n')); });

const browser = await chromium.launch({ ...browserChoice, headless: true });
const page = await browser.newPage({ viewport: { width: 375, height: 900 }, colorScheme: 'light' });
const bad = [];
page.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 400) bad.push(`${r.request().method()} ${new URL(r.url()).pathname} ${r.status()}`); });
page.on('pageerror', (e) => bad.push('page error: ' + e.message));
const wait = (ms = 700) => page.waitForTimeout(ms);
const send = (method, address, body) => page.evaluate(async ([m, a, b]) => { const r = await fetch(a, { method: m, headers: { 'Content-Type': 'application/json' }, body: b === undefined ? undefined : JSON.stringify(b) }); return r.status === 204 ? null : r.json(); }, [method, address, body]);
const dialog = page.getByRole('dialog');
const sideways = () => page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
const shoot = async (name, dark) => {
  await page.evaluate((on) => document.documentElement.classList.toggle('dark', on), dark);
  await page.screenshot({ path: `${shots}/grocery-line-scan-${name}-${dark ? 'dark' : 'light'}-375.png`, fullPage: true });
  await page.evaluate(() => document.documentElement.classList.remove('dark'));
};

const MILK_STORE = '4056489000011';
const MILK_ORGANIC = '4056489000028';
const OAT = '7310865001016';
const CARD = '9780140449136';

await page.goto(base + '/'); await wait();
await page.getByRole('textbox').first().fill('trial');
await page.locator('input[type=password]').fill('trial-only-password-8021');
await page.getByRole('button', { name: 'Sign in' }).click(); await wait(1500);

const lines = () => send('GET', '/api/kitchen/grocery');
const lineNamed = async (label, done) => (await lines()).find((g) => g.label.toLowerCase() === label && (done === undefined || g.done === done));
const shopLine = async (id) => (await send('GET', '/api/shopping')).lines.find((l) => l.id === id);
const addLine = async (label) => { await send('POST', '/api/kitchen/grocery', { label }); return lineNamed(label, false); };
const scanFromLine = async (label, code) => {
  await page.getByRole('button', { name: `Scan ${label}`, exact: true }).click(); await wait(500);
  await dialog.getByLabel('Or type the number under the bars').fill(code);
  await dialog.getByRole('button', { name: 'Find' }).click(); await wait(900);
};

// ---- set up: milk was bought before at 3.49, and oat milk is a known grocery with its own barcode ----
await send('PUT', '/api/shopping/settings', { store: 'Aldi' });
let milk = await addLine('milk');
await send('POST', `/api/kitchen/grocery/${milk.id}/tick`, { done: true, put_away: false });
await send('PUT', `/api/shopping/prices/${milk.id}`, { cents: 349 });
const oatLine = await addLine('oat milk');
await send('PUT', '/api/shopping/scan', { code: OAT, grocery_id: oatLine.id, product: 'Oat drink' });
await send('POST', `/api/kitchen/grocery/${oatLine.id}/tick`, { done: true, put_away: false });
await send('PUT', `/api/shopping/prices/${oatLine.id}`, { cents: 429 });
await send('POST', '/api/kitchen/grocery/clear-done');

milk = await addLine('milk');
await addLine('birthday card');
await page.goto(base + '/groceries'); await wait(1200);

// ---- the buttons ----
const buttons = page.locator('[data-line-scan]');
check('each open line has a scan button with a name', (await buttons.count()) === 2 && (await page.getByRole('button', { name: 'Scan milk', exact: true }).count()) === 1);
const small = await buttons.evaluateAll((all) => all.filter((b) => b.getBoundingClientRect().width < 43.5 || b.getBoundingClientRect().height < 43.5).length);
check('the scan buttons are 44px', small === 0);
check('nothing scrolls sideways at 375px', !(await sideways()));
await shoot('list', false); await shoot('list', true);

// ---- a new barcode from the Milk line: taught, line ticked, last price filled in ----
await scanFromLine('milk', MILK_STORE);
check('the price box shows last time\'s price', (await dialog.getByLabel(/What it costs/).inputValue()) === '3.49' && /Last time \$3\.49/.test(await dialog.innerText()), await dialog.innerText());
check('the line is ticked as soon as it matches', (await lineNamed('milk', true)) !== undefined);
await shoot('price', false);
await dialog.getByRole('button', { name: 'Done' }).click(); await wait(900);
let seen = await send('GET', `/api/shopping/scan?code=${MILK_STORE}`);
check('that barcode is milk from then on', seen.ingredient?.name.toLowerCase() === 'milk');
let row = await shopLine(milk.id);
check('left as it was, the price is recorded as assumed', row.price_cents === 349 && row.assumed === true, JSON.stringify(row));
check('back on the list with the dialog closed', !(await dialog.isVisible().catch(() => false)));

// ---- a second barcode for milk, with a price typed ----
await send('POST', '/api/kitchen/grocery/clear-done');
milk = await addLine('milk');
await page.goto(base + '/groceries'); await wait(1000);
await scanFromLine('milk', MILK_ORGANIC);
await dialog.getByLabel(/What it costs/).fill('4.29');
await dialog.getByRole('button', { name: 'Done' }).click(); await wait(900);
row = await shopLine(milk.id);
check('a typed price is recorded as seen, not assumed', row.price_cents === 429 && row.assumed === false, JSON.stringify(row));
const a = await send('GET', `/api/shopping/scan?code=${MILK_STORE}`);
const b = await send('GET', `/api/shopping/scan?code=${MILK_ORGANIC}`);
check('a grocery can have two barcodes', a.ingredient?.id === b.ingredient?.id && b.ingredient?.name.toLowerCase() === 'milk');

// ---- a barcode known as oat milk, scanned from the Milk line ----
await send('POST', '/api/kitchen/grocery/clear-done');
milk = await addLine('milk');
await page.goto(base + '/groceries'); await wait(1000);
await scanFromLine('milk', OAT);
const asked = (await dialog.innerText()).replace(/\s+/g, ' ');
check('it asks about oat milk in place of milk', /This is oat milk\. Get it in place of milk this time\?/.test(asked), asked);
check('it has not ticked anything yet', (await lineNamed('milk', false)) !== undefined);
await shoot('in-place', false); await shoot('in-place', true);
// Scan again
await dialog.getByRole('button', { name: 'Scan again' }).click(); await wait(500);
check('"Scan again" is the camera again', await dialog.getByLabel('Or type the number under the bars').isVisible());
await dialog.getByLabel('Or type the number under the bars').fill(OAT);
await dialog.getByRole('button', { name: 'Find' }).click(); await wait(900);
// Yes, this time
await dialog.getByRole('button', { name: 'Yes, get it this time' }).click(); await wait(900);
check('yes ticks milk off with last oat milk price filled in', (await dialog.getByLabel(/What it costs/).inputValue()) === '4.29' && (await lineNamed('milk', true)) !== undefined, await dialog.innerText());
await dialog.getByLabel(/What it costs/).fill('4.59');
await dialog.getByRole('button', { name: 'Done' }).click(); await wait(900);
row = await shopLine(milk.id);
check('yes records the price on the Milk line', row.price_cents === 459, JSON.stringify(row));
seen = await send('GET', `/api/shopping/scan?code=${OAT}`);
check('and the barcode is still oat milk', seen.ingredient?.name.toLowerCase() === 'oat milk');

// "It's milk from now on"
await send('POST', '/api/kitchen/grocery/clear-done');
milk = await addLine('milk');
await page.goto(base + '/groceries'); await wait(1000);
await scanFromLine('milk', OAT);
await dialog.getByRole('button', { name: "It's milk from now on" }).click(); await wait(900);
check('the third answer ticks milk too', (await lineNamed('milk', true)) !== undefined);
await dialog.getByRole('button', { name: 'Done' }).click(); await wait(900);
seen = await send('GET', `/api/shopping/scan?code=${OAT}`);
check('and changes what the barcode is', seen.ingredient?.name.toLowerCase() === 'milk');

// ---- a line typed freely becomes a known grocery ----
const card = await lineNamed('birthday card', false);
await scanFromLine('birthday card', CARD);
await dialog.getByRole('button', { name: 'Done' }).click(); await wait(900);
seen = await send('GET', `/api/shopping/scan?code=${CARD}`);
check('a typed line is a known grocery after its first scan', seen.ingredient?.name.toLowerCase() === 'birthday card' && (await lineNamed('birthday card', true))?.id === card.id, JSON.stringify(seen));
check('no calls failed and nothing broke', bad.length === 0, bad.join(' | '));
await browser.close();
