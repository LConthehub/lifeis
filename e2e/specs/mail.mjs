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
const field = (label) => page.locator('label').filter({ hasText: label }).locator('input, select, textarea').first();
const flat = (s) => s.replace(/\n/g, ' ');

await page.goto(base + '/'); await wait();
await page.getByRole('textbox').first().fill('trial');
await page.locator('input[type=password]').fill('trial-only-password-8021');
await page.getByRole('button', { name: 'Sign in' }).click(); await wait(1200);
const dialog = page.getByRole('dialog');
if (await dialog.isVisible().catch(() => false)) {
  for (const area of ['Cooking and groceries', 'The calendar']) await dialog.getByText(area, { exact: false }).first().click();
  await dialog.getByRole('button', { name: 'Set up Life Is' }).click(); await wait(2200);
}

await page.goto(base + '/mail'); await wait(1000);
let t = await text();
say('before any account, the mail page says email is optional and off, and what it does', /optional and off/.test(t) && /never kept here/.test(t));
await page.goto(base + '/'); await wait(1000);
say('and the front page has no email card', !(await page.locator('main h2').allInnerTexts()).includes('Email'));

await page.goto(base + '/settings/connections'); await wait(1000);
say('settings shows email as off', /read and answer your inbox\s*Off/.test(flat(await text())));
await page.getByLabel('Turn on email').click(); await wait(300);
await field('Email address').fill('someone@gmail.com'); await wait(200);
say('a Gmail address explains the app password', /Gmail needs an "app password"/.test(await text()));
await field('Email address').fill('me@example.org');
await field('Password, or app password').fill('not-the-password');
await field('Your name').fill('Me Myself');
await page.getByRole('button', { name: /Show the server details/ }).click();
await field('Incoming server').fill('mailtest.internal'); await page.locator('input[type=number]').nth(0).fill('3143');
await field('Outgoing server').fill('mailtest.internal'); await page.locator('input[type=number]').nth(1).fill('3025');
await field('Username').fill('me');
await page.getByRole('button', { name: 'Sign in and add' }).click(); await wait(4000);
t = await text();
say('without "on my own network", a plain line is refused before any password is sent: ' + flat(t).match(/mailtest\.internal [^.]*\./)?.[0], /reached|encrypted|error/.test(t) && !/Remove and forget/.test(t));
await page.getByLabel(/On my own computer or network/).check();
await page.getByRole('button', { name: 'Sign in and add' }).click(); await wait(4000);
t = await text();
say("a wrong password isn't saved: " + flat(t).match(/didn't accept[^.]*\./)?.[0], /didn't accept that username and password/.test(t) && !/Remove and forget/.test(t));
await field('Password, or app password').fill('test-pw-one');
await page.getByRole('button', { name: 'Sign in and add' }).click(); await wait(5000);
t = await text();
say('the right one is, and email shows as on', /read and answer your inbox\s*On/.test(flat(t)) && /me@example\.org/.test(t) && /Remove and forget its password/.test(t));
await page.screenshot({ path: shots + '/mail-settings.png', fullPage: true });

await page.goto(base + '/'); await wait(3000);
t = await text();
say('the front page gains an email card with the unread message: ' + flat(t).match(/me@example\.org[^→]{0,80}/)?.[0], /1 unread/.test(t) && /Sam Doe/.test(t) && /Saturday\?/.test(t));
await page.screenshot({ path: shots + '/mail-home.png', fullPage: true });

await page.getByRole('link', { name: 'Inbox →' }).click(); await wait(2500);
t = await text();
say('the inbox lists it as unread: ' + flat(t).slice(0, 90), /Inbox\s*1 unread/.test(flat(t)) && /Sam Doe/.test(t));
await page.screenshot({ path: shots + '/mail-inbox.png' });
await page.getByRole('button', { name: /Sam Doe/ }).click(); await wait(2500);
const box = page.getByRole('dialog');
t = await box.innerText();
say('opening shows its words', /Are you free Saturday\?/.test(t) && /From Sam Doe <sam@example\.com>/.test(t));
await page.screenshot({ path: shots + '/mail-message.png' });
await page.keyboard.press('Escape'); await wait(600);
if (await box.isVisible().catch(() => false)) { await box.getByRole('button', { name: /Close/i }).first().click().catch(() => {}); await wait(400); }
await page.getByRole('button', { name: 'Check again' }).click(); await wait(2500);
say('and it is still unread afterwards', /Inbox\s*1 unread/.test(flat(await text())));

await page.getByRole('button', { name: /Sam Doe/ }).click(); await wait(2500);
await box.getByRole('button', { name: 'Reply', exact: true }).click();
await box.locator('textarea').fill('Yes, see you then.');
await box.getByRole('button', { name: 'Send' }).click(); await wait(6000);
t = await box.innerText();
say('a reply is sent: ' + flat(t).match(/Sent to[^.]*\./)?.[0], /Sent to Sam Doe <sam@example\.com>\./.test(t));
await box.getByRole('button', { name: 'Mark as read' }).click(); await wait(2500);
say('marking it read is done when asked', await box.getByRole('button', { name: 'Mark as unread' }).isVisible());
say('the browser itself never talked to anyone but Life Is: ' + ([...outside].join(', ') || 'no one'), outside.size === 0);

await page.goto(base + '/settings/connections'); await wait(1200);
await page.getByRole('button', { name: 'Remove and forget its password' }).click(); await wait(1200);
say('removing the account turns email off again', /read and answer your inbox\s*Off/.test(flat(await text())));
console.log(bad.length ? 'REFUSALS SEEN (two are expected: the plain line, the wrong password):\n' + bad.join('\n') : 'no failed requests, no page errors');
await browser.close();
