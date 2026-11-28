// The busy-times link: made in Settings, read without signing in at phone width, holding times only, ended at will.
import { browserChoice } from '../browser.mjs';
import { chromium } from 'playwright-core';
const [base, shots] = process.argv.slice(2);
const browser = await chromium.launch({ ...browserChoice, headless: true });
const context = await browser.newContext({ viewport: { width: 375, height: 800 }, deviceScaleFactor: 2 });
const page = await context.newPage();
const bad = [];
page.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 400) bad.push(`${r.request().method()} ${new URL(r.url()).pathname} ${r.status()}`); });
page.on('pageerror', (e) => bad.push('page error: ' + e.message));
page.on('dialog', (d) => d.accept());
const say = (what, ok, extra = '') => console.log((ok ? 'PASS ' : 'FAIL ') + what + (extra ? ' - ' + extra : ''));
const wait = (ms = 700) => page.waitForTimeout(ms);
const dialog = page.getByRole('dialog');
const day = (n) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

await page.goto(base + '/'); await wait();
await page.getByRole('textbox').first().fill('trial');
await page.locator('input[type=password]').fill('trial-only-password-8021');
await page.getByRole('button', { name: 'Sign in' }).click(); await wait(1200);
if (await dialog.isVisible().catch(() => false)) {
  await dialog.getByText('Cooking and groceries').first().click();
  await dialog.getByRole('button', { name: 'Set up Life Is' }).click(); await wait(2500);
}
const post = (address, body) => page.evaluate(async ([a, b]) => (await fetch(a, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) })).status, [address, body]);
await post('/api/calendar/events', { title: 'Charlie dentist', day: day(2), time: '09:00', note: 'Room 12, bring the blue folder' });
await post('/api/calendar/events', { title: 'Hank trip', day: day(4), end_day: day(5) });
await post('/api/calendar/events', { title: "Loretta's birthday", day: '1958-03-07', yearly: true });
await post('/api/kitchen/plan', { day: day(1), meal: 'dinner', title: 'George the dog stew' });

await page.goto(base + '/settings/calendars'); await wait(1200);
const part = page.locator('#busy-link');
say('Settings has the busy times card, off to begin with', await part.isVisible() && /Off/.test(await part.innerText()) && await part.getByRole('button', { name: 'Make the link' }).isVisible());
say('the card says what the page shows and what it never shows', /never shows titles, names, places, notes/.test((await part.innerText()).replace(/\s+/g, ' ')));
const tooWide = async (p) => p.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
say('the card fits 375px wide with no sideways scroll', !(await tooWide(page)));
const small = async (loc) => { const boxes = await loc.evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height)); return boxes.filter((h) => h > 0 && h < 43.5).length; };
say('its controls are at least 44px tall', (await small(part.locator('button, select, label:has(input[type=checkbox])'))) === 0);
await part.getByLabel('How long the link works').selectOption('7');
await part.getByRole('button', { name: 'Make the link' }).click(); await wait(900);
const address = await part.getByLabel('The busy times link', { exact: true }).inputValue();
say('making it gives an address: ' + address.replace(/[0-9a-f]{56}$/, '...'), /\/b\/[0-9a-f]{64}$/.test(address));
say('the card says the day it ends', new RegExp('works until ' + new Date(Date.now() + 7 * 86_400_000).toLocaleDateString('en-US', { month: 'short' })).test(await part.innerText()));
say('still fits 375px with the link showing', !(await tooWide(page)) && (await small(part.locator('button, a, select, label:has(input[type=checkbox])'))) === 0);
await page.screenshot({ path: `${shots}/busy-link-card.png`, fullPage: false });

// Read it as a stranger would: no sign-in, no cookies.
const stranger = await browser.newContext({ viewport: { width: 375, height: 800 }, deviceScaleFactor: 2 });
const reader = await stranger.newPage();
const raw = await stranger.request.get(address);
const html = await raw.text();
say('the public answer is a page that holds times only', raw.status() === 200 && !/Charlie|dentist|Hank|Loretta|George|Room 12|blue folder|stew|trip|birthday/i.test(html));
say('it holds no scripts', !/<script/i.test(html));
await reader.goto(address); await reader.waitForTimeout(800);
const text = (await reader.locator('main').innerText()).replace(/\s+/g, ' ');
say('it shows busy time in words, and free days', /Busy from 9:00 AM to 10:00 AM/.test(text) && /Busy all day/.test(text) && /Free all day/.test(text), text.slice(0, 160));
say('it says when it stops working', /Available until/.test(text));
say('four weeks are on it', (await reader.locator('.d').count()) === 28);
say('at 375px it has no sideways scroll', !(await tooWide(reader)));
say('it shows the quiet Made with Life Is line', /Made with Life Is/.test(text));
await reader.screenshot({ path: `${shots}/busy-link-page.png`, fullPage: true });

await part.getByRole('checkbox', { name: /Made with Life Is/ }).click(); await wait(700);
await reader.reload(); await reader.waitForTimeout(500);
say('with the check box off, the line is gone', !/Made with Life Is/.test(await reader.locator('main').innerText()));

await part.getByRole('button', { name: 'Turn it off' }).click(); await wait(900);
say('turning it off puts the card back to Off', /Off/.test(await part.innerText()) && await part.getByRole('button', { name: 'Make the link' }).isVisible());
say('and the old address no longer works', (await stranger.request.get(address)).status() === 404);
say('no failed requests', bad.length === 0, bad.join('; '));
await browser.close();
