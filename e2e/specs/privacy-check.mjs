// The privacy check-up, on a 375px phone: reached from Settings, five short parts (what a guest sees, what the other
// people who sign in see, what shows when the app is left open, what reminders show on a locked phone, which outside
// connections are on with what they send). It only reads. Each line has a link to the switch that changes it.
import { browserChoice } from '../browser.mjs';
import { chromium } from 'playwright-core';
const [base, shots] = process.argv.slice(2);
const PASS = 'trial-only-password-8261';
const results = [];
const check = (name, ok, extra = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); };
process.on('exit', () => console.log(results.join(String.fromCharCode(10))));
const wait = (ms = 700) => new Promise((r) => setTimeout(r, ms));
const flat = (s) => s.replace(/\s+/g, ' ');

const browser = await chromium.launch({ ...browserChoice, headless: true });
const context = await browser.newContext({ viewport: { width: 375, height: 812 }, colorScheme: 'light', hasTouch: true, deviceScaleFactor: 2 });
const page = await context.newPage();
page.on('pageerror', (e) => check('no page errors', false, e.message));
page.on('dialog', (d) => d.accept());
const api = (method, address, body) => page.evaluate(async ([m, a, b]) => {
  const r = await fetch(a, { method: m, headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined });
  return { status: r.status, json: await r.json().catch(() => null) };
}, [method, address, body]);
const sideways = () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
const part = (id) => page.locator(`[data-part="${id}"]`);

await page.goto(base + '/'); await wait(1000);
await page.getByRole('textbox').first().fill('ana');
await page.locator('input[type=password]').fill(PASS);
await page.getByRole('button', { name: /Make my account|Sign in/ }).click(); await wait(2000);
const first = page.getByRole('dialog');
if (await first.isVisible().catch(() => false)) { await first.getByRole('button', { name: 'Set up Life Is' }).click(); await wait(1500); }

// ---- reached from Settings ----
await page.goto(base + '/settings'); await wait(1200);
const link = page.locator('[data-privacy-link]');
check('Settings has a link to the privacy check-up', await link.isVisible());
check('the link is at least 44px tall', (await link.boundingBox()).height >= 43.5);
await link.click(); await wait(2000);
check('it opens the check-up', /\/privacy-check$/.test(page.url()) && await page.locator('[data-privacy-check]').isVisible());
const titles = await page.locator('[data-part] h2').allInnerTexts();
check('five short parts: ' + titles.join(' | '), titles.length === 5 && /guest/.test(titles[0]) && /other people who sign in/.test(titles[1]) && /left open/.test(titles[2]) && /locked phone/.test(titles[3]) && /outside connections/.test(titles[4]));

// ---- as it starts: closed ----
let t = flat(await page.locator('[data-privacy-check]').innerText());
check('no guest link is on, so a guest sees nothing', /No link is on, so a guest sees nothing/.test(t));
check('nobody else signs in yet', /Only you have an account/.test(t));
check('the sign-out time is said', /After 15 minutes without use/.test(t));
check('nothing is on, so nothing is sent', /Nothing is on, so Life Is sends nothing outside/.test(t));
check('the connections that are off are named', /Off: \d+/.test(t) && /Weather/.test(t));
await page.screenshot({ path: shots + '/privacy-check-start-375.png', fullPage: true });

// ---- change things, and see the page follow ----
await api('PUT', '/api/manual/share', { days: 7, pets: false });
await api('PUT', '/api/lookups', { groceries: true });
await api('PUT', '/api/account', { idle_minutes: 0 });
await api('POST', '/api/users', { username: 'ben', password: 'ben-only-password-8261' });
await api('POST', '/api/media/lists', { name: 'Movie night' }).catch(() => {});
await page.goto(base + '/privacy-check'); await wait(2000);
t = flat(await page.locator('[data-privacy-check]').innerText());
check('the guest link shows, with its end day and no pets', /Anyone who has the link can read the manual without signing in, until/.test(t) && /leaves your pets out/.test(t));
check('the sign-out time shows "Never", with what that means', /Never\. Whatever page is on the screen stays there/.test(t));
check('another person is counted', /1 other person signs in here/.test(t));
check('grocery lookups are on, with what they send', (await part('connections').getByText('What it sends:').count()) === 1 && /Grocery lookups/.test(await part('connections').innerText()) && /Open Food Facts|barcode/i.test(await part('connections').innerText()));
await api('PUT', '/api/account', { idle_minutes: 15 });

// ---- every line has a link to its switch ----
const links = await page.locator('[data-line] a').evaluateAll((all) => all.map((a) => a.getAttribute('href')));
check('guest line links to the manual', links.includes('/manual'));
check('connection lines link to Connections', links.some((h) => h.startsWith('/settings/connections')));
const groceries = part('connections').locator('[data-line]').filter({ hasText: 'Grocery lookups' }).getByRole('link');
await groceries.click(); await wait(1800);
check('a connection link opens Settings at its switch', /\/settings\/connections#lookups$/.test(page.url()) && await page.getByLabel('Turn on grocery lookups').isChecked());

// ---- it changes nothing by itself ----
const before = JSON.stringify([(await api('GET', '/api/lookups')).json.groceries, (await api('GET', '/api/manual')).json.share.on, (await api('GET', '/api/account')).json.idle_minutes]);
await page.goto(base + '/privacy-check'); await wait(1800);
await page.goto(base + '/privacy-check'); await wait(1500);
const after = JSON.stringify([(await api('GET', '/api/lookups')).json.groceries, (await api('GET', '/api/manual')).json.share.on, (await api('GET', '/api/account')).json.idle_minutes]);
check('opening it changes nothing', before === after, before);

// ---- a phone: nothing runs off the side, and the links are big enough ----
check('no sideways scroll at 375px', (await sideways()) <= 0, String(await sideways()));
const short = await page.locator('[data-privacy-check] a, [data-privacy-check] button').evaluateAll((els) => els.filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height < 43.5; }).map((e) => (e.textContent || '').trim().slice(0, 30)));
check('every link is at least 44px tall', short.length === 0, short.join('; '));
check('plain words: no "tick"', !/\btick/i.test(await page.locator('[data-privacy-check]').innerText()));
await page.screenshot({ path: shots + '/privacy-check-changed-375.png', fullPage: true });
await browser.close();
