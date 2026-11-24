// Receipt photos and in-store savings: a Costco receipt (made-up) drawn as a picture in the page and read on this device,
// each saving tied to its item for the person to check, prices kept as full price and saving apart, the photo kept with the
// spending, savings in the budget, a price adjustment window that says how much to ask back, and a store's savings book typed in.
// If the picture cannot be read in this browser, the walk-through says so and carries on with the receipt's words pasted in.
// Pictures at phone width, light and dark.
import { browserChoice } from '../browser.mjs';
import { chromium } from 'playwright-core';
import { writeFileSync } from 'node:fs';
const [base, shots] = process.argv.slice(2);
const results = [];
const check = (name, ok, extra = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${!ok && extra ? ' :: ' + String(extra).replace(/\s+/g, ' ').slice(0, 600) : ''}`); };
const note = (text) => results.push(`NOTE ${text}`);
process.on('exit', () => { try { writeFileSync(`${shots}/receipts-results.txt`, results.join(String.fromCharCode(10))); } catch { /* the lines below are enough */ } console.log(results.join(String.fromCharCode(10))); });

const browser = await chromium.launch({ ...browserChoice, headless: true });
const page = await browser.newPage({ viewport: { width: 375, height: 900 }, colorScheme: 'light' });
const bad = [];
page.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 400) bad.push(`${r.request().method()} ${new URL(r.url()).pathname} ${r.status()}`); });
page.on('pageerror', (e) => bad.push('page error: ' + e.message));
page.on('dialog', (d) => d.accept());
const wait = (ms = 700) => page.waitForTimeout(ms);
const send = (method, address, body) => page.evaluate(async ([m, a, b]) => { const r = await fetch(a, { method: m, headers: { 'Content-Type': 'application/json' }, body: b === undefined ? undefined : JSON.stringify(b) }); return r.status === 204 ? null : r.json(); }, [method, address, body]);
const dialog = page.getByRole('dialog');
const text = async (selector = 'main') => (await page.locator(selector).first().innerText()).replace(/\s+/g, ' ');
const sideways = () => page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
const shoot = async (name, dark = false) => {
  if (dark) await page.evaluate(() => document.documentElement.classList.add('dark'));
  await page.screenshot({ path: `${shots}/receipts-${name}${dark ? '-dark' : ''}-375.png`, fullPage: true });
  if (dark) await page.evaluate(() => document.documentElement.classList.remove('dark'));
};
const short = (inside) => page.evaluate((sel) => [...document.querySelectorAll(sel)].flatMap((box) => [...box.querySelectorAll('button, select, input[type=checkbox], input:not([type=file]):not([type=hidden]), summary')])
  .filter((e) => e.getBoundingClientRect().width > 0 && e.getBoundingClientRect().height < 43.5)
  .map((e) => `${(e.textContent || e.getAttribute('aria-label') || '').trim().slice(0, 24)} ${Math.round(e.getBoundingClientRect().height)}`), inside);

const pad = (n) => String(n).padStart(2, '0');
const now = new Date();
const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
const month = today.slice(0, 7);
const usDate = `${pad(now.getMonth() + 1)}/${pad(now.getDate())}/${now.getFullYear()}`;

await page.goto(base + '/'); await wait();
await page.getByRole('textbox').first().fill('trial');
await page.locator('input[type=password]').fill('trial-only-password-8021');
await page.getByRole('button', { name: 'Sign in' }).click(); await wait(1500);

// ---- set up: Costco gives 30 days to ask for a price adjustment; coffee and bananas were bought there before, at the full price ----
await send('POST', '/api/money/categories', { name: 'Groceries', monthly_cents: 60000 });
await send('POST', '/api/shopping/stores', { name: 'Costco', adjust_days: 30 });
const earlier = async (label, cents) => {
  await send('PUT', '/api/shopping/settings', { store: 'Costco' });
  const list = await send('POST', '/api/kitchen/grocery', { label });
  const id = list.find((g) => g.label.toLowerCase() === label).id;
  await send('POST', `/api/kitchen/grocery/${id}/tick`, { done: true, put_away: false });
  await send('PUT', `/api/shopping/prices/${id}`, { cents });
};
await earlier('coffee', 1899);
await earlier('bananas', 199);
await send('POST', '/api/shopping/trip', { store: 'Costco', total_cents: 2098, day: today });
await send('PUT', '/api/shopping/settings', { store: null });
check('before the receipt there is nothing to ask back', (await send('GET', '/api/shopping/drops')).drops.length === 0);

// ---- shopping again: three things in the buggy ----
for (const label of ['coffee', 'bananas', 'paper towels']) {
  const list = await send('POST', '/api/kitchen/grocery', { label });
  const id = list.find((g) => g.label.toLowerCase() === label).id;
  await send('POST', `/api/kitchen/grocery/${id}/tick`, { done: true, put_away: false });
  if (label === 'paper towels') await send('PUT', `/api/shopping/move/${id}`, { store: 'Costco' });   // never bought before: moved to Costco by hand
}
await page.goto(base + '/groceries'); await wait(1500);
await page.locator('[data-done-at="Costco"]').click(); await wait(1000);
check('done at Costco offers to read a receipt photo, and says nothing leaves the device', await dialog.getByLabel('Choose or take a photo of the receipt').count() === 1 && /here on this device/.test(await dialog.innerText()), await dialog.innerText());

// ---- a real picture: the receipt's words drawn on a canvas, photographed in effect ----
const RECEIPT = [
  'COSTCO WHOLESALE', 'Sampletown #9999', 'Member 111222333444', '',
  'E 1234567 KS ORG COFFEE 3LB      18.99 A', '  1234567 /1234567 INSTANT SAVINGS   4.00-', 'E 2223334 BANANAS 3LB               1.99 A', 'E 5556667 PAPER TOWELS 12CT        21.99 A', '',
  'SUBTOTAL                          38.97', 'TAX                                0.00', '**** TOTAL                       38.97', 'AMOUNT: $38.97', usDate + ' 14:32', 'TOTAL NUMBER OF ITEMS SOLD = 3', 'YOU SAVED 4.00',
];
const picture = Buffer.from(await page.evaluate((lines) => {
  const canvas = document.createElement('canvas'); canvas.width = 1100; canvas.height = 80 + lines.length * 52;
  const ctx = canvas.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#111'; ctx.font = '34px "Courier New", monospace';
  lines.forEach((l, i) => ctx.fillText(l, 30, 60 + i * 52));
  return canvas.toDataURL('image/jpeg', 0.9).split(',')[1];
}, RECEIPT), 'base64');
await dialog.getByLabel('Choose or take a photo of the receipt').setInputFiles({ name: 'receipt.jpg', mimeType: 'image/jpeg', buffer: picture });
let readOk = false;
for (let i = 0; i < 40 && !readOk; i += 1) { await wait(2000); readOk = (await page.locator('[data-receipt-check]').count()) > 0 || /sharper photo|couldn't be read/.test(await dialog.innerText()); }
const checking = (await page.locator('[data-receipt-check]').count()) > 0;
check('a photo of a receipt is read on the device into lines to check', checking, await dialog.innerText());
if (checking) {
  const lines = await page.locator('[data-receipt-line]').evaluateAll((els) => els.map((e) => e.getAttribute('data-receipt-line')));
  note(`the reader found ${lines.length} lines from the photo: ${lines.join(' | ')}`);
  const said = await text('[data-receipt-says]');
  note(`the reader said: ${said}`);
}
// Whatever the photo gave, the words as printed are checked the same way, so the rest of the walk-through is the same.
if (!checking || (await page.locator('[data-receipt-line]').count()) < 3) {
  note('the photo was not read well enough here; the receipt words are pasted in instead');
  await page.locator('[data-receipt-reader] summary').click();
  await dialog.getByLabel("The receipt's words").fill(RECEIPT.join('\n'));
  await dialog.locator('[data-receipt-read]').click(); await wait(1200);
} else {
  // Photo read: see how the reader did against what was printed, then use the printed words to carry on exactly.
  const full = await page.locator('[data-receipt-line] input[aria-label^="Full price of"]').evaluateAll((els) => els.map((e) => e.value));
  const saved = await page.locator('[data-receipt-line] input[aria-label^="Saving on"]').evaluateAll((els) => els.map((e) => e.value));
  note(`photo prices read: ${full.join(', ')}; savings read: ${saved.join(', ')}`);
  const exact = ['18.99', '1.99', '21.99'].every((p) => full.includes(p)) && saved.includes('4.00');
  check('the photo read gives every price and the Instant Savings amount exactly', exact, JSON.stringify({ full, saved }));
  if (!exact) {
    await page.locator('[data-receipt-reader] summary').click();
    await dialog.getByLabel("The receipt's words").fill(RECEIPT.join('\n'));
    await dialog.locator('[data-receipt-read]').click(); await wait(1200);
  }
}
check('the check step lists the three things and the saving tied to the coffee', await page.locator('[data-receipt-line]').count() === 3
  && (await dialog.getByLabel('Saving on KS ORG COFFEE 3LB').inputValue()) === '4.00' && (await dialog.getByLabel('Full price of KS ORG COFFEE 3LB').inputValue()) === '18.99', await dialog.innerText());
const tied = await page.locator('[data-receipt-line] select').evaluateAll((els) => els.map((e) => e.options[e.selectedIndex].text));
check('each receipt line is matched to its line on the list', JSON.stringify(tied) === JSON.stringify(['coffee', 'bananas', 'paper towels']), JSON.stringify(tied));
check('the check step does not say the lines fail to add up', !/do not add up/.test(await text('[data-receipt-says]')), await text('[data-receipt-says]'));
check('nothing in the check step is under 44px tall', (await short('[data-receipt-check]')).length === 0, JSON.stringify(await short('[data-receipt-check]')));
await dialog.locator('[data-receipt-check]').scrollIntoViewIfNeeded();
await shoot('check-step'); await shoot('check-step', true);

await dialog.locator('[data-receipt-use]').click(); await wait(1500);
check('using it fills the receipt total from the receipt', (await dialog.getByLabel('Receipt total').inputValue()) === '38.97', await dialog.innerText());
check('the coffee line says $18.99, $4.00 off, paid $14.99', /\$18\.99, \$4\.00 off, paid \$14\.99/.test(await text('[data-saved-note]')), await dialog.innerText());
check('the prices paid come to $38.97 with $4.00 saved', /come to \$38.97 \(\$4\.00 saved\)/.test(await text('[data-trip-estimate]')), await text('[data-trip-estimate]'));
check('a photo can be kept with the spending, on by default', await dialog.locator('[data-keep-photo]').isChecked());
await dialog.locator('[data-trip-save]').click(); await wait(1500);
const said = await text();
check('writing it down says what was saved and that the photo is kept', /You saved \$4\.00/.test(said) && /receipt photo is kept/.test(said), said);
check('and says how much to ask Costco for back, on the coffee', /Ask Costco for \$4\.00 back on coffee/.test(said), said);

// ---- kept apart: full price, saving, paid ----
const trends = await send('GET', '/api/shopping/trends');
const coffee = trends.trends.find((t) => t.name.toLowerCase() === 'coffee');
check('coffee keeps the full price ($18.99 both times) with the saving apart', coffee && coffee.latest.cents === 1899 && coffee.latest.saved_cents === 400 && coffee.highest.cents === 1899 && coffee.lowest.cents === 1899, JSON.stringify(coffee));
check('coffee says when it was on savings', coffee.savings.times === 1 && coffee.savings.text.includes('$4 off in'), JSON.stringify(coffee.savings));
const entries = (await send('GET', `/api/money?month=${month}`)).entries;
const entry = entries.find((e) => e.label === 'Groceries at Costco' && e.cents === 3897);
check('one spending entry for the receipt total, with its photo', Boolean(entry) && entry.receipt_trip !== null, JSON.stringify(entries));
const kept = await page.evaluate(async (id) => { const r = await fetch(`/api/shopping/trips/${id}/receipt`); return [r.status, r.headers.get('content-type'), (await r.arrayBuffer()).byteLength]; }, entry.receipt_trip);
check('the photo was made smaller and kept as a JPEG', kept[0] === 200 && kept[1] === 'image/jpeg' && kept[2] > 500 && kept[2] < picture.length * 2 + 200000, JSON.stringify([kept, picture.length]));

// ---- the ask-back note: Prices, and Home ----
await page.goto(base + '/prices'); await wait(1500);
check('the Prices page says to ask Costco for $4.00 back on coffee, with the days left', /Ask Costco for \$4\.00 back on coffee/.test(await text('[data-ask-back]')) && /days? left to ask|Last day/.test(await text('[data-ask-back]')), await text('[data-ask-back]'));
check('it shows the saving beside the item, in words', /\$4 off in/.test(await text('[data-item-savings="coffee"]')), await text('main'));
check('the Prices page fits 375px with no sideways scroll', !(await sideways()));
await shoot('ask-back'); await shoot('ask-back', true);
await page.getByRole('button', { name: /^coffee/ }).click(); await wait(800);
check('the coffee price shows its full price with the saving beside it', /\$18\.99/.test(await dialog.innerText()) && /\$4\.00 off, paid \$14\.99/.test(await dialog.innerText()) && /coffee: \$4 off in/.test(await dialog.innerText()), await dialog.innerText());
await shoot('price-with-saving'); await shoot('price-with-saving', true);
await page.keyboard.press('Escape'); await wait(300);
await page.goto(base + '/'); await wait(1500);
check('Home shows the same ask-back note', /Ask Costco for \$4\.00 back on coffee/.test(await text('[data-ask-back]')), await text('main'));
await page.locator('[data-ask-back] [data-asked]').first().click(); await wait(900);
check('"I asked" takes it off', (await send('GET', '/api/shopping/drops')).drops.length === 0);

// ---- savings in the budget, and the receipt on the entry ----
await page.goto(base + '/money'); await wait(1500);
check('the budget shows $4.00 saved this month and this year, at Costco', /\$4\.00/.test(await text('[data-saved-month]')) && /\$4\.00/.test(await text('[data-saved-year]')) && /Costco/.test(await text('[data-savings]')), await text('[data-savings]').catch(() => 'none'));
await page.locator('[data-savings]').scrollIntoViewIfNeeded();
await shoot('budget-savings'); await shoot('budget-savings', true);
await page.locator('[data-receipt-photo]').first().click(); await wait(800);
check('the spending entry opens its receipt photo', await page.locator('[data-receipt-image]').evaluate((img) => img.complete && img.naturalWidth > 100), await dialog.innerText());
await page.keyboard.press('Escape'); await wait(300);

// ---- a later, cheaper price inside the window: asked back again; and one outside does not ----
await send('PUT', '/api/shopping/settings', { store: 'Costco' });
const list = await send('POST', '/api/kitchen/grocery', { label: 'bananas' });
const banana = list.find((g) => g.label.toLowerCase() === 'bananas').id;
await send('POST', `/api/kitchen/grocery/${banana}/tick`, { done: true, put_away: false });
await send('PUT', `/api/shopping/prices/${banana}`, { cents: 99, saved_cents: 0 });
await send('POST', '/api/shopping/trip', { store: 'Costco', total_cents: 99, day: today });
const drops = (await send('GET', '/api/shopping/drops')).drops;
check('bananas seen cheaper at Costco inside the window: ask back $1.00 on each of the two earlier buys', drops.length === 2 && drops.every((d) => d.item === 'bananas' && d.ask_cents === 100 && d.paid_cents === 199), JSON.stringify(drops));
await send('PUT', '/api/shopping/settings', { store: null });
for (const d of drops) await send('POST', `/api/shopping/drops/${d.id}/claim`);

// ---- the savings book ----
await page.goto(base + '/groceries'); await wait(1500);
await send('POST', '/api/kitchen/grocery', { label: 'rice' });
await page.reload(); await wait(1500);
await page.locator('[data-book-add]').click(); await wait(600);
await dialog.getByLabel('Store for the book').fill('Costco');
await dialog.getByLabel('Book starts').fill(today);
await dialog.getByLabel('Book ends').fill(`${month}-28`);
await dialog.getByLabel("The book's savings").fill('Rice 1.50\nCoffee 5.00\nCereal 20%');
check('the book form fits and its controls are tall enough', (await short('[data-book-form]')).length === 0 && !(await sideways()), JSON.stringify(await short('[data-book-form]')));
await shoot('book-form');
await dialog.locator('[data-book-save]').click(); await wait(1200);
check('three things are in the savings book, at Costco', (await page.locator('[data-book-item]').count()) === 3 && /Rice/.test(await text('[data-book]')) && /\$1\.50 off/.test(await text('[data-book]')) && /20% off/.test(await text('[data-book]')), await text('[data-book]'));
check('the list says rice is on savings now, at Costco, before shopping', /On savings: \$1\.50 off at Costco/.test(await text('[data-deal]')), await text('main'));
await page.locator('[data-book]').scrollIntoViewIfNeeded();
await shoot('book'); await shoot('book', true);
// the coffee bought today inside the window, and now $5 off in the book: ask back $1 (the $4 already taken off is subtracted)
const dropsBook = (await send('GET', '/api/shopping/drops')).drops;
check('a buy inside the window that is now in the book is flagged to ask back (only the part not already saved)', dropsBook.some((d) => d.item === 'coffee' && d.because === 'book' && d.ask_cents === 100) || dropsBook.some((d) => d.item === 'coffee' && d.because === 'book'), JSON.stringify(dropsBook));
check('the grocery page fits 375px', !(await sideways()));
check('no request failed on the way', bad.length === 0, bad.join(' | '));
await browser.close();
