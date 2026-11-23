import { browserChoice } from '../browser.mjs';
import { chromium } from 'playwright-core';
const [base, shots] = process.argv.slice(2);
const browser = await chromium.launch({ ...browserChoice, headless: true });
const page = await browser.newPage({ viewport: { width: 1100, height: 900 }, deviceScaleFactor: 2 });
const bad = [];
const outside = new Set();
page.on('request', (r) => { const u = new URL(r.url()); if (u.origin !== new URL(base).origin && u.protocol.startsWith('http')) outside.add(u.host); });
page.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 400) bad.push(`${r.request().method()} ${new URL(r.url()).pathname} ${r.status()}`); });
page.on('console', (m) => { if (m.type() === 'error') bad.push('console error: ' + m.text()); });
page.on('pageerror', (e) => bad.push('page error: ' + e.message));
const say = (what, ok) => console.log((ok ? 'ok   ' : 'FAIL ') + what);
const wait = (ms = 700) => page.waitForTimeout(ms);
const text = async () => page.locator('main').innerText();
const flat = (s) => s.replace(/\n/g, ' ');
const dialog = page.getByRole('dialog');
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const inDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d; };
const monday = (() => { const d = new Date(); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d; })();
const mon = (weeks, plus = 0) => { const d = new Date(monday); d.setDate(d.getDate() + weeks * 7 + plus); return iso(d); };
const send = (method, address, body) => page.evaluate(async ([m, a, b]) => { const r = await fetch(a, { method: m, headers: { 'Content-Type': 'application/json' }, body: b === undefined ? undefined : JSON.stringify(b) }); return r.status === 204 ? null : r.json(); }, [method, address, body]);
const tooSmall = async (locators) => {
  const small = [];
  for (const loc of locators) for (const el of await loc.all()) { if (await el.isVisible()) { const box = await el.boundingBox(); if (box && box.height < 43.5) small.push((await el.innerText().catch(() => '')).slice(0, 30) || (await el.getAttribute('aria-label'))); } }
  return small;
};
const noSideways = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

await page.goto(base + '/'); await wait();
await page.getByRole('textbox').first().fill('trial');
await page.locator('input[type=password]').fill('trial-only-password-8021');
await page.getByRole('button', { name: 'Sign in' }).click(); await wait(1500);

// ---------- copy last week ----------
const soup = await send('POST', '/api/kitchen/recipes', { title: 'Leek soup', servings: 4, ingredients_text: '3 leeks\n2 potatoes', steps_text: 'Simmer.' });
const pasta = await send('POST', '/api/kitchen/recipes', { title: 'Cream pasta', servings: 4, ingredients_text: '1 cup cream\n2 cups spinach\n1 lb pasta', steps_text: 'Boil.' });
const cookedMeal = await send('POST', '/api/kitchen/plan', { day: mon(-1), meal: 'dinner', recipe_id: soup.id, servings: 6 });
await send('POST', '/api/kitchen/plan', { day: mon(-1, 2), meal: 'lunch', title: 'Leftovers' });
await send('POST', `/api/kitchen/plan/${cookedMeal.id}/cooked`);
await send('POST', '/api/kitchen/plan', { day: mon(0), meal: 'dinner', title: 'Takeout' });
await page.goto(base + '/week'); await wait(1200);
await page.getByRole('button', { name: 'Copy last week' }).click(); await wait(900);
let t = await text();
say('"Copy last week" adds last week\'s meals beside what was there: ' + flat(t).match(/Added [^.]*\.[^.]*\./)?.[0], /Added 2 meals to the week of/.test(t) && /1 of those days already had something, and what was there was kept/.test(t));
say('this week now has the soup (as 6 servings), the leftovers and the takeout', /Leek soup/.test(t) && /6 servings/.test(t) && /Leftovers/.test(t) && /Takeout/.test(t));
say('and the copied soup is not marked as cooked', !/cooked ✓/.test(t));
await page.screenshot({ path: shots + '/copy-week.png', fullPage: true });
await page.getByRole('button', { name: 'Copy last week' }).click(); await wait(900);
say('copying again adds nothing twice', /Nothing was added/.test(await text()) && /2 meals were already there/.test(await text()));

// ---------- copy this week to another ----------
await page.getByRole('button', { name: 'Copy this week to…' }).click(); await wait(400);
await dialog.getByRole('button', { name: 'Next week' }).click();
await dialog.getByRole('button', { name: 'Copy the meals' }).click(); await wait(1000);
t = await text();
say('"Copy this week to…" takes you to the week it went to, with the three meals', /Added 3 meals/.test(t) && (t.match(/Leek soup|Leftovers|Takeout/g) || []).length === 3);

// ---------- templates ----------
await page.getByRole('button', { name: 'Templates' }).click(); await wait(500);
await dialog.getByPlaceholder('School week, Vacation').fill('School week');
await dialog.getByRole('button', { name: 'Save this week as a template' }).click(); await wait(700);
say('a week is saved as a named template', /School week/.test(await dialog.innerText()) && /3 meals/.test(await dialog.innerText()));
await dialog.getByRole('button', { name: 'Rename School week' }).click();
await dialog.getByLabel('New name').fill('Term time');
await dialog.getByRole('button', { name: 'Save', exact: true }).click(); await wait(600);
say('and renamed', /Term time/.test(await dialog.innerText()) && !/School week/.test(await dialog.innerText()));
await page.keyboard.press('Escape'); await wait(300);
if (await dialog.isVisible().catch(() => false)) await dialog.getByRole('button', { name: /close/i }).click();
await page.getByRole('button', { name: 'Week after' }).click(); await wait(800);
say('the week after is empty', /Nothing planned/.test(await text()) && !/Leek soup/.test(await text()));
await page.getByRole('button', { name: 'Templates' }).click(); await wait(500);
await dialog.getByRole('button', { name: 'Use Term time' }).click(); await wait(1000);
t = await text();
say('using a template puts its meals on that week: ' + flat(t).match(/Added [^.]*\./)?.[0], /Added 3 meals/.test(t) && /Leek soup/.test(t) && /Leftovers/.test(t));

// ---------- use it up ----------
await send('PUT', '/api/kitchen/pantry', { name: 'cream', quantity: 1, unit: 'cup', location: 'fridge', expires_on: iso(inDays(2)) });
await send('PUT', '/api/kitchen/pantry', { name: 'spinach', quantity: 2, unit: 'cup', location: 'fridge', expires_on: iso(inDays(4)) });
await send('PUT', '/api/kitchen/pantry', { name: 'pasta', quantity: 1, unit: 'lb', location: 'pantry' });
await send('PUT', '/api/kitchen/pantry', { name: 'milk', quantity: 1, unit: 'l', location: 'fridge', expires_on: iso(inDays(12)) });
await page.goto(base + '/pantry'); await wait(1200);
t = await text();
say('the pantry suggests a recipe for what is going off: ' + flat(t).match(/Use it up.{0,160}/)?.[0], /Use it up/.test(t) && /Cream pasta/.test(t) && /Uses the cream and the spinach/.test(t) && /You have 1 of its 1 other ingredient/.test(t));
say('and does not count the milk that is not going off for twelve days', !/milk \(/.test(t));
await page.getByRole('button', { name: 'Put Cream pasta on the week' }).click(); await wait(300);
await page.screenshot({ path: shots + '/use-it-up.png', fullPage: true });
await page.getByRole('button', { name: 'Put it on the week' }).click(); await wait(900);
const planned = await send('GET', `/api/kitchen/plan?start=${iso(inDays(0))}&days=1`);
say('"Put it on the week" plans it: ' + flat(await text()).match(/Cream pasta is on the week[^.]*\./)?.[0], planned.some((m) => m.recipe_id === pasta.id) && /Cream pasta is on the week/.test(await text()));

// ---------- scan to add ----------
await send('POST', '/api/kitchen/grocery', { label: 'flour' });
const flourLine = (await send('GET', '/api/kitchen/grocery')).find((g) => g.label === 'flour');
await send('PUT', '/api/shopping/scan', { code: '5012345678900', grocery_id: flourLine.id, product: 'Brand flour', size: '2 lb' });
await page.getByRole('button', { name: /Scan to add/ }).click(); await wait(1500);
await dialog.getByLabel('Or type the number under the bars').fill('5012345678900');
await dialog.getByRole('button', { name: 'Find' }).click(); await wait(700);
let d = await dialog.innerText();
say('typing a known barcode finds it, with its usual size ready: ' + flat(d).slice(0, 90), /flour/.test(d) && /2 lb/.test(d) && (await dialog.getByLabel('How much').inputValue()) === '2' && (await dialog.getByLabel('Unit').inputValue()) === 'lb');
await dialog.getByRole('button', { name: 'Add to the pantry' }).click(); await wait(900);
d = await dialog.innerText();
say('it goes in the pantry and the scanner is ready for the next: ' + flat(d).slice(0, 80), /In the pantry so far/.test(d) && /flour: now 2 lb/.test(d) && (await dialog.getByLabel('Or type the number under the bars').count()) === 1);
await dialog.getByLabel('Or type the number under the bars').fill('4006381333931');
await dialog.getByRole('button', { name: 'Find' }).click(); await wait(700);
say('a barcode not seen before asks what it is, and asks nobody outside', /hasn't seen this one before/.test(await dialog.innerText()) && outside.size === 0);
await dialog.getByLabel('What to call it *').fill('coffee');
await dialog.getByLabel('The size on the package').fill('12 oz');
await dialog.getByRole('button', { name: 'Add to the pantry' }).click(); await wait(900);
say('it is named and added, and remembered: ' + flat(await dialog.innerText()).match(/coffee: now[^\n]*/)?.[0], /coffee: now 12 oz \(remembered this barcode\)/.test(await dialog.innerText()));
await dialog.getByLabel('Or type the number under the bars').fill('4006381333931');
await dialog.getByRole('button', { name: 'Find' }).click(); await wait(700);
say('the next scan of it is known, and says what is already there', /coffee/.test(await dialog.innerText()) && /You have 12 oz in the pantry/.test(await dialog.innerText()));
await page.keyboard.press('Escape'); await wait(300);
if (await dialog.isVisible().catch(() => false)) await dialog.getByRole('button', { name: /close/i }).click();
await wait(600);
t = await text();
say('the pantry lists what was scanned in', /flour\s*2 lb/.test(t) && /coffee\s*12 oz/.test(t));

// ---------- aisle order per store ----------
const ingredients = await send('GET', '/api/kitchen/ingredients');
for (const [name, aisle] of [['flour', 'Baking']]) await send('PUT', `/api/kitchen/ingredients/${ingredients.find((i) => i.name === name).id}`, { aisle });
for (const [label, aisle] of [['milk', 'Dairy'], ['apples', 'Produce'], ['frozen peas', 'Frozen']]) {
  await send('POST', '/api/kitchen/grocery', { label });
  const list = await send('GET', '/api/kitchen/ingredients');
  await send('PUT', `/api/kitchen/ingredients/${list.find((i) => i.name === label).id}`, { aisle });
}
await page.goto(base + '/groceries'); await wait(1200);
await page.getByLabel('Shopping at').fill('Aldi'); await page.getByLabel('Shopping at').blur(); await wait(900);
const aisleHeads = async () => (await page.locator('main h2').allInnerTexts()).map((h) => h.toLowerCase().replace(/\s+where you are$/, '')).filter((h) => ['baking', 'dairy', 'frozen', 'produce'].includes(h));
say('with no order set the aisles run in the usual order: ' + (await aisleHeads()).join(', '), (await aisleHeads()).join() === 'baking,dairy,frozen,produce');
await page.getByRole('button', { name: 'Arrange aisles for Aldi' }).click(); await wait(700);
await dialog.getByRole('button', { name: 'Move Produce up' }).click();
await dialog.getByRole('button', { name: 'Move Produce up' }).click();
await dialog.getByRole('button', { name: 'Move Produce up' }).click();
const arranged = flat(await dialog.locator('[data-aisle-order]').innerText()).replace(/[↑↓]/g, '').replace(/\s+/g, ' ').trim();
say('the aisles move up and down with buttons: ' + arranged, arranged === '1 Produce 2 Baking 3 Dairy 4 Frozen');
await dialog.getByRole('button', { name: 'Move Dairy up' }).click();
await dialog.getByRole('button', { name: 'Save the order' }).click(); await wait(900);
say('the list follows Aldi\'s order: ' + (await aisleHeads()).join(', '), (await aisleHeads()).join() === 'produce,dairy,baking,frozen');
await page.reload(); await wait(1200);
say('and keeps it after a reload', (await aisleHeads()).join() === 'produce,dairy,baking,frozen');
await page.getByLabel('Shopping at').fill('Costco'); await page.getByLabel('Shopping at').blur(); await wait(900);
say('another store keeps the usual order: ' + (await aisleHeads()).join(', '), (await aisleHeads()).join() === 'baking,dairy,frozen,produce');
await page.getByLabel('Shopping at').fill('Aldi'); await page.getByLabel('Shopping at').blur(); await wait(900);
say('and back at Aldi it is Aldi\'s again', (await aisleHeads()).join() === 'produce,dairy,baking,frozen');

// ---------- the phone ----------
await page.setViewportSize({ width: 375, height: 812 });
await page.goto(base + '/groceries'); await wait(1200);
await page.getByRole('button', { name: 'Arrange aisles for Aldi' }).click(); await wait(600);
say('at 375px the aisle arranger has 44px buttons and nothing scrolls sideways', (await tooSmall([dialog.getByRole('button')])).length === 0 && await noSideways());
await page.screenshot({ path: shots + '/arrange-aisles-phone.png' });
await page.keyboard.press('Escape'); await wait(300);
if (await dialog.isVisible().catch(() => false)) await dialog.getByRole('button', { name: /close/i }).click();

await page.goto(base + '/week'); await wait(1200);
const weekSmall = await tooSmall([page.getByRole('button', { name: /Copy last week|Copy this week to…|Templates/ })]);
say('at 375px the week\'s copy buttons are 44px tall and nothing scrolls sideways' + (weekSmall.length ? ` (too small: ${weekSmall})` : ''), weekSmall.length === 0 && await noSideways());
await page.getByRole('button', { name: 'Templates' }).click(); await wait(500);
say('and so are the template buttons', (await tooSmall([dialog.getByRole('button'), dialog.locator('input')])).length === 0 && await noSideways());
await page.keyboard.press('Escape'); await wait(300);
if (await dialog.isVisible().catch(() => false)) await dialog.getByRole('button', { name: /close/i }).click();

await send('PUT', '/api/kitchen/pantry', { name: 'cream', quantity: 1, unit: 'cup', location: 'fridge', expires_on: iso(inDays(2)) });
await page.goto(base + '/pantry'); await wait(1500);
const pantrySmall = await tooSmall([page.locator('[data-use-it-up]').getByRole('button'), page.getByRole('button', { name: /Scan to add|\+ Add/ })]);
say('at 375px "Use it up" and "Scan to add" have 44px buttons and nothing scrolls sideways' + (pantrySmall.length ? ` (too small: ${pantrySmall})` : ''), pantrySmall.length === 0 && await noSideways());
await page.screenshot({ path: shots + '/use-it-up-phone.png', fullPage: true });
await page.getByRole('button', { name: /Scan to add/ }).click(); await wait(1200);
say('and the scanner sheet fits too, with its type-it field', (await dialog.getByLabel('Or type the number under the bars').count()) === 1 && (await tooSmall([dialog.locator('input')])).length === 0 && await noSideways());
await page.keyboard.press('Escape');

say('the browser itself never talked to anyone but Life Is: ' + ([...outside].join(', ') || 'no one'), outside.size === 0);
console.log(bad.length ? 'PROBLEMS SEEN:\n' + bad.join('\n') : 'no failed requests, no page errors');
await browser.close();
