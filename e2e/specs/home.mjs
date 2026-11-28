import { browserChoice } from '../browser.mjs';
import { chromium } from 'playwright-core';
const base = process.argv[2], shots = process.argv[3];
const browser = await chromium.launch({ ...browserChoice, headless: true });
const page = await browser.newPage({ viewport: { width: 1100, height: 900 }, deviceScaleFactor: 2 });
const bad = [];
const outside = new Set();
page.on('request', (r) => { const u = new URL(r.url()); if (u.origin !== new URL(base).origin && u.protocol.startsWith('http')) outside.add(u.host); });
page.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 400) bad.push(`${r.request().method()} ${new URL(r.url()).pathname} ${r.status()}`); });
page.on('console', (m) => { if (m.type() === 'error') bad.push('console error: ' + m.text()); });
page.on('pageerror', (e) => bad.push('page error: ' + e.message));
const say = (what, ok) => console.log((ok ? 'ok   ' : 'FAIL ') + what);
const text = async () => page.locator('main').innerText();
const wait = (ms = 800) => page.waitForTimeout(ms);
const send = (method, address, body) => page.evaluate(async ([m, a, b]) => { const r = await fetch(a, { method: m, headers: { 'Content-Type': 'application/json' }, body: b === undefined ? undefined : JSON.stringify(b) }); return r.status === 204 ? null : r.json(); }, [method, address, body]);
const field = (label) => page.locator('label').filter({ hasText: label }).locator('input, select, textarea').first();
const flat = (s) => s.replace(/\n/g, ' ');
const heads = async () => (await page.locator('main h2').allInnerTexts()).join(' | ');

await page.goto(base + '/'); await wait();
await page.getByRole('textbox').first().fill('trial');
await page.locator('input[type=password]').fill('trial-only-password-8021');
await page.getByRole('button', { name: 'Sign in' }).click(); await wait(1200);
const dialog = page.getByRole('dialog');
if (await dialog.isVisible().catch(() => false)) {
  for (const area of ['Cooking and groceries', 'The calendar', 'Projects', 'Films, shows, music, books and games']) {
    const option = dialog.getByText(area, { exact: false }).first();
    if (await option.isVisible().catch(() => false)) await option.click();
  }
  await dialog.getByRole('button', { name: 'Set up Life Is' }).click(); await wait(2200);
}
await page.goto(base + '/'); await wait(1200);
let t = await text();
console.log('cards: ' + await heads());
say('the front page has the week in numbers, no Coming up card while nothing is coming, and no weather yet', !/Coming up/.test(t) && /This week in numbers/.test(t) && !/Open-Meteo/.test(t));

// A birthday, every year.
await page.goto(base + '/calendar'); await wait(900);
await page.getByRole('button', { name: '+ Add' }).first().click();
await field('What').fill("Mom's birthday");
const soon = new Date(); soon.setDate(soon.getDate() + 2);
const iso = `1958-${String(soon.getMonth() + 1).padStart(2, '0')}-${String(soon.getDate()).padStart(2, '0')}`;
await field('Day').fill(iso);
await page.getByLabel(/Every year/).check();
say('ticking "Every year" closes off "Until"', await field('Until').isDisabled());
await page.getByRole('button', { name: 'Save' }).click(); await wait(900);
await page.goto(base + '/'); await wait(1200);
t = await text();
const years = soon.getFullYear() - 1958;
say(`the birthday shows on Coming up, counting ${years} years: ` + flat(t).match(/Mom's birthday[^|]{0,60}/)?.[0], new RegExp(`Mom's birthday\\s*${years} years`).test(flat(t)) && /in 2 days/.test(t));

// Something going off in the pantry, and a recipe that uses it: the kitchen card says so, and the line opens the pantry.
await send('POST', '/api/kitchen/recipes', { title: 'Yogurt flatbread', servings: 4, ingredients_text: '2 cups flour\n1 cup yogurt', steps_text: 'Bake.' });
const twoDaysOn = new Date(); twoDaysOn.setDate(twoDaysOn.getDate() + 2);
await send('PUT', '/api/kitchen/pantry', { name: 'yogurt', quantity: 1, unit: 'cup', location: 'fridge', expires_on: `${twoDaysOn.getFullYear()}-${String(twoDaysOn.getMonth() + 1).padStart(2, '0')}-${String(twoDaysOn.getDate()).padStart(2, '0')}` });
await page.goto(base + '/'); await wait(1200);
t = await text();
say('the kitchen card says what is going off, and the recipe for it: ' + flat(t).match(/Use up soon:.{0,70}/)?.[0], /Use up soon: [^.]*yogurt\./i.test(flat(t)) && /Yogurt flatbread uses yogurt\./.test(flat(t)));
const useUp = page.getByRole('link', { name: /Use up soon/ });
say('the line goes to the pantry', (await useUp.getAttribute('href')) === '/pantry');
await useUp.click(); await wait(1200);
say('and following it opens the pantry, with the yogurt in it', /\/pantry$/.test(page.url()) && /yogurt/i.test(await text()));

// The weather: off, explained, then on.
await page.goto(base + '/settings/connections'); await wait(1000);
t = await text();
say('settings lists outside services, with the weather off and what it sends', /Connections/.test(t) && /Each one is off until you turn it on/.test(t) && /What it's sent:/.test(t) && /Weather on the front page\s*Off/.test(flat(t)));
say('nothing has been asked of the outside world so far: ' + [...outside].join(', '), outside.size === 0);
say('unchecked, the weather hides its fields but still says what it sends', (await page.getByLabel('Your town, to turn it on').count()) === 0 && /What it's sent:/.test(await text()));
await page.getByLabel('Turn on weather').click(); await wait(400);
await field('Your town, to turn it on').fill('Springfield');
await page.getByRole('button', { name: 'Look it up' }).click(); await wait(2500);
t = await text();
say('looking up a town offers places: ' + flat(t).match(/Springfield, [A-Za-z ]+, United States/)?.[0], /Springfield, \w+/.test(t));
await page.getByRole('button', { name: /Springfield, Missouri/ }).first().click(); await wait(2500);
t = await text();
say('choosing one turns it on', /Weather on the front page\s*On/.test(flat(t)) && /Showing Springfield, Missouri/.test(flat(t)));
await page.screenshot({ path: shots + '/services.png', fullPage: true });

await page.goto(base + '/'); await wait(1800);
t = await text();
console.log('cards: ' + await heads());
say('the front page now shows the forecast: ' + flat(t).match(/Springfield, Missouri, United States[^F]{0,80}/)?.[0], /Springfield, Missouri/.test(t) && /\d+°/.test(t) && /From Open-Meteo, in °F/.test(t) && /today/i.test(t));
say('the browser itself never talked to anyone but Life Is: ' + ([...outside].join(', ') || 'no one'), outside.size === 0);
await page.screenshot({ path: shots + '/home2.png', fullPage: true });
await page.setViewportSize({ width: 390, height: 800 });
await page.reload(); await wait(1500);
await page.screenshot({ path: shots + '/home2-phone.png', fullPage: true });
await page.setViewportSize({ width: 1100, height: 900 });

// A name of their own: set in Settings, shown on the front page at once, with the sign-in name unchanged.
await page.setViewportSize({ width: 375, height: 800 });
await page.goto(base + '/'); await wait(1200);
say('the greeting uses the sign-in name at first', /Good (morning|afternoon|evening)|Up late/.test(await page.locator('main h1').innerText()) && /, trial$/.test(await page.locator('main h1').innerText()));
await page.goto(base + '/settings/home'); await wait(1200);
const nameBox = page.locator('#your-name');
say('Settings has a "Your name" box with its hint, near the top', await nameBox.isVisible() && /What Life Is calls you\. Your sign-in name stays the same\./.test(await nameBox.innerText()));
await nameBox.locator('input').fill('  Sam  ');
await nameBox.getByRole('button', { name: 'Save' }).click(); await wait(900);
say('saving says so: ' + flat(await nameBox.innerText()).match(/Saved\.[^.]*\./)?.[0], /Life Is calls you Sam/.test(await nameBox.innerText()));
const settingsWidth = await page.evaluate(() => document.documentElement.scrollWidth);
say('Settings fits a 375px phone: ' + settingsWidth, settingsWidth <= 375);
await nameBox.scrollIntoViewIfNeeded();
await page.screenshot({ path: shots + '/display-name-settings-375.png' });

await page.goto(base + '/'); await wait(1200);
say('Home greets by the new name, without signing out: ' + await page.locator('main h1').innerText(), /, Sam$/.test(await page.locator('main h1').innerText()));
const homeWidth = await page.evaluate(() => document.documentElement.scrollWidth);
say('Home fits a 375px phone: ' + homeWidth, homeWidth <= 375);
await page.screenshot({ path: shots + '/display-name-home-375.png' });
await page.setViewportSize({ width: 1100, height: 900 });

await page.goto(base + '/settings/connections'); await wait(1000);
page.once('dialog', (d) => d.accept());
await page.getByLabel('Turn on weather').click(); await wait(1000);
say('unchecking turns it off at once and keeps the place for later, with Forget it', /Weather on the front page\s*Off/.test(flat(await text())) && /Kept for later: Springfield, Missouri/.test(flat(await text())) && await page.getByRole('button', { name: 'Forget it' }).isVisible());
await page.goto(base + '/'); await wait(1200);
say('turning it off takes the card away', !/Open-Meteo/.test(await text()));
await page.goto(base + '/settings/connections'); await wait(1000);
await page.getByLabel('Turn on weather').click(); await wait(1500);
say('checking it again brings back the kept place with no search', /Showing Springfield, Missouri/.test(flat(await text())));
await page.getByLabel('Turn on weather').click(); await wait(800);
page.once('dialog', (d) => d.accept());
await page.getByRole('button', { name: 'Forget it' }).click(); await wait(1000);
say('Forget it removes the saved place', !/Kept for later/.test(await text()));
console.log(bad.length ? 'PROBLEMS SEEN:\n' + bad.join('\n') : 'no failed requests, no page errors');
await browser.close();
