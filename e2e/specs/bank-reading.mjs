// Reading bank accounts through SimpleFIN, against a stand-in for a SimpleFIN bridge on this computer (the walk-through
// starts Life Is with SIMPLEFIN_ALLOW_LOCAL=1, which is the one setting that lets it reach a stand-in here; no real
// SimpleFIN server is ever contacted). Turn it on and read what is sent, refuse a wrong token, connect, choose an
// account and a category, read, read again (nothing twice), see the errors SimpleFIN returned, check the stand-in's own
// log for what was and was not sent, check the access address is nowhere on a page, disconnect, and see the phone-app note.
import { browserChoice } from '../browser.mjs';
import { chromium } from 'playwright-core';
const [base, shots] = process.argv.slice(2);
const results = [];
const check = (name, ok, extra = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${!ok && extra ? ' :: ' + String(extra).replace(/\s+/g, ' ').slice(0, 400) : ''}`); };
process.on('exit', () => console.log(results.join(String.fromCharCode(10))));
const stand = 'http://127.0.0.1:8102';
const GOOD = Buffer.from(`${stand}/simplefin/claim/GOODTOKEN`).toString('base64');
const WRONG = Buffer.from(`${stand}/simplefin/claim/SOMETOKEN`).toString('base64');
const PASS = 'bankpass-0123456789';

const browser = await chromium.launch({ ...browserChoice, headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
const page = await context.newPage();
const bad = [];
page.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 400 && !([400, 409].includes(r.status()) && r.url().includes('/api/money/simplefin/connect'))) bad.push(`${r.request().method()} ${new URL(r.url()).pathname} ${r.status()}`); });
page.on('pageerror', (e) => bad.push('page error: ' + e.message));
page.on('dialog', (d) => d.accept());
const wait = (ms = 700) => page.waitForTimeout(ms);
const flat = (s) => s.replace(/\s+/g, ' ');
const api = (method, address, body) => page.evaluate(async ([m, a, b]) => { const r = await fetch(a, { method: m, headers: { 'Content-Type': 'application/json' }, body: b === undefined ? undefined : JSON.stringify(b) }); return r.status === 204 ? null : r.json(); }, [method, address, body]);
const iso = (d) => d.toISOString().slice(0, 10);
const dayAgo = (n) => { const d = new Date(); d.setUTCHours(12, 0, 0, 0); d.setUTCDate(d.getUTCDate() - n); return iso(d); };
const block = () => page.locator('[data-bank]');
const shoot = async (name, target = block()) => {
  await page.addStyleTag({ content: '.sticky, [class*="sticky"], [class*="fixed"] { position: static !important; }' }); // so the page's own top bar doesn't sit over the picture
  await page.setViewportSize({ width: 375, height: 812 }); await wait(500);
  await target.scrollIntoViewIfNeeded(); await target.screenshot({ path: `${shots}/simplefin-${name}-375.png` });
  const sideways = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  check(`at 375px nothing scrolls sideways (${name})`, !sideways);
  await page.setViewportSize({ width: 1280, height: 1000 }); await wait(500);
  await target.scrollIntoViewIfNeeded(); await target.screenshot({ path: `${shots}/simplefin-${name}-1280.png` });
};
const short = () => page.evaluate(() => [...document.querySelectorAll('[data-bank] button, [data-bank] input:not([type=checkbox]), [data-bank] select, [data-bank] label')]
  .filter((e) => e.getBoundingClientRect().width > 0 && e.getBoundingClientRect().height < 43.5).map((e) => `${(e.textContent || e.type || e.tagName).trim().slice(0, 24)} ${Math.round(e.getBoundingClientRect().height)}`));

await page.goto(base + '/'); await wait();
await page.getByRole('textbox').first().fill('trial');
await page.locator('input[type=password]').fill('trial-only-password-8021');
await page.getByRole('button', { name: 'Sign in' }).click(); await wait(1500);
{ const skip = page.getByRole('dialog').getByRole('button', { name: 'Skip, show me everything' }); if (await skip.isVisible().catch(() => false)) { await skip.click(); await wait(900); } }

// ---- off, and what it says it sends
await page.goto(base + '/settings/connections'); await wait(1200);
await block().scrollIntoViewIfNeeded();
let t = flat(await block().innerText());
check('it starts off', /Off/.test(t) && await block().getByLabel('Turn on bank reading').isVisible() && (await block().locator('input[type=password]').count()) === 0, t.slice(0, 200));
const sends = flat(await block().locator('[data-bank-sends]').innerText());
check('it says exactly what is sent, and that nothing of Life Is goes to SimpleFIN', /setup token is used once/.test(sends) && /Nothing from Life Is is sent to it/.test(sends) && /cannot move money/.test(sends), sends);
check('it links to SimpleFIN and its bridge, and quotes no price', (await block().locator('a[href="https://www.simplefin.org/"]').count()) === 1 && (await block().locator('a[href="https://bridge.simplefin.org/"]').count()) === 1 && !/\$\s?\d|per (month|year)/i.test(t), t);
check('nothing was asked of the stand-in before it was turned on', (await (await fetch(`${stand}/__log`)).json()).length === 0);
await shoot('turn-on');

// ---- on: the token form; a wrong token keeps nothing
await block().getByLabel('Turn on bank reading').click(); await wait(900);
check('turned on, it asks for a setup token', await block().locator('[data-bank-connect]').isVisible());
await block().locator('input[type=password]').fill('this is not a token');
await block().getByRole('button', { name: 'Connect' }).click(); await wait(800);
t = flat(await block().innerText());
check('a junk token is refused in plain words', /doesn.t look like a SimpleFIN setup token/.test(t), t.slice(-300));
await block().locator('input[type=password]').fill(WRONG);
await block().getByRole('button', { name: 'Connect' }).click(); await wait(1000);
t = flat(await block().innerText());
check('a token SimpleFIN refuses says it was used already or is wrong, and nothing is kept', /used already, or it is wrong/.test(t) && /Nothing was kept/.test(t) && !(await block().locator('[data-bank-connected]').count()), t.slice(-300));

// ---- connect
await block().locator('input[type=password]').fill(GOOD);
await block().getByRole('button', { name: 'Connect' }).click(); await wait(1200);
if (!(await block().locator('[data-bank-connected]').count())) { check('connecting worked', false, flat(await block().innerText())); process.exit(1); }
const connected = flat(await block().locator('[data-bank-connected]').innerText());
check('connected: only the host name and the time show', /Connected to 127\.0\.0\.1 on /.test(connected) && !connected.includes('bankuser') && !connected.includes(PASS), connected);
check('the token box is gone and its text is nowhere on the page', !(await page.content()).includes(GOOD) && (await block().locator('input[type=password]').count()) === 0);
const rows = await block().locator('[data-bank-accounts] li').allInnerTexts();
check('the accounts are listed, none chosen yet', rows.length === 2 && /Everyday Checking/.test(rows[0]) && /Savings/.test(rows[1]) && /balance 2,345\.67 USD/.test(rows[0]), rows.join(' | '));
check('claiming a token again is refused while connected', JSON.stringify(await api('POST', '/api/money/simplefin/connect', { token: GOOD })).includes('connected already'));

// ---- choose an account and a category
await api('POST', '/api/money/categories', { name: 'Everyday', monthly_cents: 60000 });
await page.reload(); await wait(1200);
await block().locator('[data-bank-accounts] li').first().locator('input[type=checkbox]').check(); await wait(300);
await block().locator('[data-bank-accounts] li').first().locator('select').selectOption({ label: 'Everyday' });
await block().getByRole('button', { name: 'Save my choices' }).click(); await wait(800);
check('the choice is saved', /Saved\./.test(await block().innerText()) && (await api('GET', '/api/money/simplefin')).accounts.filter((a) => a.chosen).length === 1);
// a spending entry written by hand that the bank also shows
await api('POST', '/api/money/entries', { label: 'Corner Store', cents: 1230, day: dayAgo(5) });
await shoot('connected');

// ---- read
await block().getByRole('button', { name: 'Read now' }).click(); await wait(1500);
const result = flat(await block().locator('[data-bank-result]').innerText());
check('the result says added, already there, left out', /2 added, 1 already there, 2 left out/.test(result) && /1 money in/.test(result) && /1 still pending/.test(result), result);
check('the errors SimpleFIN returned are shown as text', /SimpleFIN says/.test(result) && /Example Credit Union needs you to sign in again\./.test(result), result);
await shoot('result');
const months = [...new Set([dayAgo(5), dayAgo(4), dayAgo(2)].map((d) => d.slice(0, 7)))];
const entries = [];
for (const m of months) entries.push(...(await api('GET', `/api/money?month=${m}`)).entries);
const order = (a, b) => (a[2] + a[0] < b[2] + b[0] ? -1 : 1);
const mine = entries.map((e) => [e.label, e.cents, e.day, e.category]).sort(order);
check('the money out that settled came in, in cents, on its posted day, in the chosen category', JSON.stringify(mine) === JSON.stringify([['Corner Store', 1230, dayAgo(5), null], ['Coffee Cart', 500, dayAgo(4), 'Everyday'], ['Furnace repair', 123450, dayAgo(2), 'Everyday']].sort(order)), JSON.stringify(mine));
check('money in, the pending item and the account not chosen did not come in', !entries.some((e) => /Payroll|Hardware|Transfer/.test(e.label)));

// ---- read again: nothing twice
await block().getByRole('button', { name: 'Read now' }).click(); await wait(1500);
const again = flat(await block().locator('[data-bank-result]').innerText());
check('reading again adds nothing and says so', /0 added, 3 already there, 2 left out/.test(again), again);
let count = 0;
for (const m of months) count += (await api('GET', `/api/money?month=${m}`)).entries.length;
check('there are still just three entries', count === 3, count);

// ---- what the stand-in saw
const log = await (await fetch(`${stand}/__log`)).json();
const claims = log.filter((l) => l.path.includes('/claim/'));
const reads = log.filter((l) => l.path === '/simplefin/accounts');
check('each token was claimed with one empty POST, the good one once', claims.length === 2 && claims.every((c) => c.method === 'POST' && c.bodyBytes === 0) && claims.filter((c) => c.path.endsWith('GOODTOKEN')).length === 1, JSON.stringify(claims));
check('every read signed in with a header, and none carried the password in its address', reads.length >= 3 && reads.every((r) => r.signedIn && !r.credentialsInAddress && r.bodyBytes === 0), JSON.stringify(reads));
const real = reads.filter((r) => r.query['start-date']);
check('a reading asks for a date range as unix times, and nothing else', real.length === 2 && real.every((r) => /^\d{10}$/.test(r.query['start-date']) && /^\d{10}$/.test(r.query['end-date']) && Object.keys(r.query).sort().join() === 'end-date,pending,start-date'), JSON.stringify(real));

// ---- the access address is nowhere
const sources = [await page.content(), JSON.stringify(await api('GET', '/api/money/simplefin')), JSON.stringify(await api('GET', '/api/lookups')), JSON.stringify(await api('GET', `/api/money?month=${months[0]}`))];
const everything = await page.evaluate(async () => { const r = await fetch('/api/export/everything.zip'); return r.ok ? btoa(String.fromCharCode(...new Uint8Array(await r.arrayBuffer()))) : ''; });
const zipText = Buffer.from(everything, 'base64').toString('latin1');
check('the password and user are on no page, in no answer, and not in the download', [PASS, 'bankuser', 'GOODTOKEN'].every((w) => sources.every((s) => !s.includes(w)) && !zipText.includes(w)) && everything.length > 100);
check('the controls are at least 44px tall', (await short()).length === 0, (await short()).join('; '));

// ---- disconnect
await block().getByRole('button', { name: 'Disconnect' }).click(); await wait(1000);
t = flat(await block().innerText());
check('disconnected: back to the token form, spending stays', /Disconnected\./.test(t) && (await block().locator('[data-bank-connect]').count()) === 1 && (await api('GET', `/api/money?month=${months[0]}`)).entries.length >= 1);
const after = await api('GET', '/api/money/simplefin');
check('the connection and the accounts are gone', after.connection === null && after.accounts.length === 0);
await block().getByLabel('Turn on bank reading').click(); await wait(800);
check('turned off again', /Off/.test(await block().innerText()) && (await api('GET', '/api/money/simplefin')).on === false);

// ---- the phone app keeping everything on the phone: not offered, and says why
const phone = await context.newPage();
await phone.setViewportSize({ width: 375, height: 812 });
await phone.addInitScript(() => { window.lifeisApp = { place: { kind: 'device' }, chooseAgain() {} }; });
await phone.goto(base + '/settings/connections'); await phone.waitForTimeout(1500);
const why = phone.locator('[data-bank-why]');
check('on the device-only phone app it is not offered, and says why', (await why.count()) === 1 && /keeps everything on this phone/.test(await why.innerText()) && (await phone.locator('[data-bank] button').count()) === 0, await phone.locator('body').innerText().then((s) => s.slice(0, 200)).catch(() => ''));

check('no request failed and nothing broke', bad.length === 0, bad.join('; '));
await browser.close();
