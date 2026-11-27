import { browserChoice } from '../browser.mjs';
import { chromium } from 'playwright-core';
const [base, shots] = process.argv.slice(2);
const browser = await chromium.launch({ ...browserChoice, headless: true });
const page = await browser.newPage({ viewport: { width: 1100, height: 900 }, deviceScaleFactor: 2 });
const bad = [];
const outside = new Set();
page.on('request', (r) => { const u = new URL(r.url()); if (u.origin !== new URL(base).origin && u.protocol.startsWith('http')) outside.add(u.host); });
page.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 400) bad.push(`${r.request().method()} ${new URL(r.url()).pathname} ${r.status()}`); });
page.on('pageerror', (e) => bad.push('page error: ' + e.message));
const say = (what, ok) => console.log((ok ? 'ok   ' : 'FAIL ') + what);
const wait = (ms = 800) => page.waitForTimeout(ms);
const text = async () => page.locator('main').innerText();
const flat = (s) => s.replace(/\n/g, ' ');
const field = (label) => page.locator('label').filter({ hasText: label }).locator('input, select, textarea').first();
const dialog = page.getByRole('dialog');
const pad = (n) => String(n).padStart(2, '0');
const day = (offset) => { const d = new Date(Date.now() + offset * 86_400_000); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; };
const section = (title) => page.locator('section').filter({ has: page.getByRole('heading', { name: title }) });
const loaded = (img) => img.evaluate((el) => el.complete && el.naturalWidth > 0);

await page.goto(base + '/'); await wait();
await page.getByRole('textbox').first().fill('trial');
await page.locator('input[type=password]').fill('trial-only-password-8021');
await page.getByRole('button', { name: 'Sign in' }).click(); await wait(1200);
if (await dialog.isVisible().catch(() => false)) {
  await dialog.getByText('The calendar', { exact: false }).first().click();
  await dialog.getByRole('button', { name: 'Set up Life Is' }).click(); await wait(2200);
}

await page.goto(base + '/plans'); await wait(900);
await page.getByRole('button', { name: '+ New' }).click();
await field('What it is').fill('Saturday sewing'); await field('Day').fill(day(-2));
await dialog.getByRole('button', { name: 'Save' }).click(); await wait(1200);
say('before a library is connected, the plan only offers this device, and says Immich can be connected', !(await page.getByRole('button', { name: '+ From Immich' }).isVisible()) && /connect it in Settings/.test(await text()));

await page.goto(base + '/settings/connections'); await wait(1000);
const row = page.locator('div.py-3').filter({ hasText: 'Photos from your Immich' });
say('settings lists Immich, off, with what it does and what the key needs', /Off/.test(await row.innerText()) && /Photos stay in Immich/.test(await row.innerText()));
await row.getByRole('button', { name: 'Connect Immich' }).click();
say('the form says which two permissions the key needs', /asset\.read and asset\.view/.test(await row.innerText()));
await field("Immich's address").fill('http://photos.internal:2283'); await field('API key').fill('wrong-key');
await row.getByRole('button', { name: 'Check and connect' }).click(); await wait(2000);
say("a wrong key isn't saved: " + flat(await row.innerText()).match(/Immich didn't accept that key/)?.[0], /Immich didn't accept that key/.test(await row.innerText()));
await field('API key').fill('an-immich-key-for-testing');
await row.getByRole('button', { name: 'Check and connect' }).click(); await wait(2000);
say('the right one connects it', /On/.test(await row.innerText()) && /Connected to\s*http:\/\/photos\.internal:2283/.test(flat(await row.innerText())));
await page.screenshot({ path: shots + '/immich-settings.png', fullPage: true });

await page.goto(base + '/plans'); await wait(900);
await page.getByRole('link', { name: /Saturday sewing/ }).click(); await wait(1200);
await page.getByRole('button', { name: '+ From Immich' }).click(); await wait(2500);
say('the plan offers the photos taken on its day', (await dialog.locator('img').count()) === 2 && await loaded(dialog.locator('img').first()) && /Check the ones that belong here/.test(await dialog.innerText()));
await page.screenshot({ path: shots + '/immich-pick.png' });
await dialog.locator('input[type=checkbox]').first().check();
await dialog.getByRole('button', { name: 'Link 1' }).click(); await wait(2000);
say('a ticked photo is linked and shows on the plan', (await section('Photos').locator('img').count()) === 1 && await loaded(section('Photos').locator('img').first()));
await page.getByRole('button', { name: '+ From Immich' }).click(); await wait(2000);
say('the picker marks it as already here', /already here/.test(await dialog.innerText()) && await dialog.locator('input[type=checkbox]').first().isDisabled());
await page.keyboard.press('Escape'); await wait(400);
await page.screenshot({ path: shots + '/immich-plan.png', fullPage: true });
await section('Photos').locator('button:has(img)').click(); await wait(800);
say('opening it says removing only takes it off the plan', /it stays in your library/.test(await dialog.innerText()));
say('the browser itself never talked to anyone but Life Is: ' + ([...outside].join(', ') || 'no one'), outside.size === 0);
console.log(bad.length ? 'REFUSALS SEEN (one is expected: the wrong key):\n' + bad.join('\n') : 'no failed requests, no page errors');
await browser.close();
