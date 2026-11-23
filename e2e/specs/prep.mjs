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
const dialog = page.getByRole('dialog');
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const inDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return iso(d); };
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

// ---------- a recipe's prep steps ----------
const chicken = await send('POST', '/api/kitchen/recipes', { title: 'Prep roast chicken', servings: 4, ingredients_text: '1 whole chicken', steps_text: 'Roast it.' });
await page.setViewportSize({ width: 375, height: 812 });
await page.goto(base + `/recipes/${chicken.id}`); await wait(1200);
await page.locator('[data-section="prep"]').getByRole('button', { name: 'Add' }).click(); await wait(500);
await dialog.getByRole('button', { name: '+ Add a prep step' }).click();
await dialog.getByLabel('What to do').first().fill('Thaw the chicken');
await dialog.getByRole('button', { name: '+ Add a prep step' }).click();
await dialog.getByLabel('What to do').nth(1).fill('Take it out of the fridge');
await dialog.getByLabel('When').nth(1).selectOption('hours_before');
await dialog.getByLabel('Hours before').fill('2');
const dialogSmall = await tooSmall([dialog.getByRole('button', { name: /prep step|Remove|Save/ }), dialog.locator('select'), dialog.locator('input')]);
say('at 375px the prep editor has 44px controls and nothing scrolls sideways' + (dialogSmall.length ? ` (too small: ${dialogSmall})` : ''), dialogSmall.length === 0 && await noSideways());
await dialog.getByRole('button', { name: 'Save' }).click(); await wait(900);
let t = await text();
say('the recipe lists its prep steps in words', /Thaw the chicken: the night before at 8 pm/.test(t) && /Take it out of the fridge: 2 hours before/.test(t));
await page.screenshot({ path: shots + '/prep-recipe-375.png', fullPage: true });

// ---------- a meal on the week ----------
const far = inDays(2);
const near = inDays(1);
const meal = await send('POST', '/api/kitchen/plan', { day: far, meal: 'dinner', recipe_id: chicken.id });
const soon = await send('POST', '/api/kitchen/plan', { day: near, meal: 'dinner', title: 'Slow cooker chili' });
await page.goto(base + '/week'); await wait(1200);
if (!/Thaw the chicken/.test(await text())) { await page.getByRole('button', { name: 'Week after' }).click(); await wait(900); }
t = await text();
say('the week shows the recipe\'s prep under the meal, worked out from a 6 pm dinner', /Thaw the chicken: /.test(t) && /Take it out of the fridge: .*4 pm/.test(t));

// One-off prep and a time to eat on the planned meal.
await page.getByRole('button', { name: 'Prep' }).last().click(); await wait(500);
await dialog.getByLabel('Time to eat').fill('19:00');
await dialog.getByRole('button', { name: '+ Add a prep step' }).click();
await dialog.getByLabel('What to do').first().fill('Start the stock');
await dialog.getByLabel('When').first().selectOption('morning_of');
await dialog.getByLabel('Time of day').fill('09:00');
await dialog.getByRole('button', { name: 'Save' }).click(); await wait(1000);
t = await text();
say('a time to eat of 7 pm moves the hours-before step to 5 pm', /Take it out of the fridge: .*5 pm/.test(t));
say('and the meal\'s own prep shows too', /Start the stock: .*9 am/.test(t));
const weekSmall = await tooSmall([page.getByRole('button', { name: /^(Prep|Cooked|Remove)$/ })]);
say('the Prep buttons are 44px tall and the week fits 375px' + (weekSmall.length ? ` (too small: ${weekSmall})` : ''), weekSmall.length === 0 && await noSideways());
await page.screenshot({ path: shots + '/prep-week-375.png', fullPage: true });
await page.emulateMedia({ colorScheme: 'dark' }); await wait(300);
say('dark at 375px: no sideways scroll', await noSideways());
await page.screenshot({ path: shots + '/prep-week-375-dark.png', fullPage: true });
await page.emulateMedia({ colorScheme: 'light' });
await page.setViewportSize({ width: 1280, height: 900 }); await wait(500);
say('at 1280px: no sideways scroll', await noSideways());
await page.screenshot({ path: shots + '/prep-week-1280.png', fullPage: true });
await page.emulateMedia({ colorScheme: 'dark' }); await wait(300);
say('dark at 1280px: no sideways scroll', await noSideways());
await page.screenshot({ path: shots + '/prep-week-1280-dark.png', fullPage: true });
await page.emulateMedia({ colorScheme: 'light' });
await page.setViewportSize({ width: 375, height: 812 });

// ---------- tomorrow morning on Home ----------
await send('PUT', `/api/prep/meals/${soon.id}`, { steps: [{ words: 'Set the slow cooker going', rule: 'morning_of', at: '06:30' }] });
await page.goto(base + '/'); await wait(1500);
t = await text();
say('Home shows tomorrow morning\'s prep', /Set the slow cooker going: tomorrow morning 6:30 am/.test(t));
say('and not a step that is two days off', !/Start the stock/.test(t));

// ---------- a meal taken off the week takes its reminders ----------
await send('DELETE', `/api/kitchen/plan/${soon.id}`);
await send('DELETE', `/api/kitchen/plan/${meal.id}`);
await page.goto(base + '/'); await wait(1200);
say('taking the meals off the week removes their reminders from Home', !/Set the slow cooker going/.test(await text()));
const kept = await send('GET', `/api/prep/recipes/${chicken.id}`);
say('the recipe keeps its own steps', Array.isArray(kept) && kept.length === 2);

say('the browser itself never talked to anyone but Life Is: ' + ([...outside].join(', ') || 'no one'), outside.size === 0);
console.log(bad.length ? 'PROBLEMS SEEN:\n' + bad.join('\n') : 'no failed requests, no page errors');
await browser.close();
