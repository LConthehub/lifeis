import { browserChoice } from '../browser.mjs';
import { chromium } from 'playwright-core';
// The incident log: dated entries only the person sees; changeable for 24 hours, then only added to; the whole log printed on letter paper. At 375px.
const [base, shots] = process.argv.slice(2);
const browser = await chromium.launch({ ...browserChoice, headless: true });
const page = await browser.newPage({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2 });
const bad = [];
const outside = new Set();
page.on('request', (r) => { const u = new URL(r.url()); if (u.origin !== new URL(base).origin && u.protocol.startsWith('http')) outside.add(u.host); });
page.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 400 && !(expected.has(r.request().method() + ' ' + new URL(r.url()).pathname))) bad.push(`${r.request().method()} ${new URL(r.url()).pathname} ${r.status()}`); });
page.on('console', (m) => { if (m.type() === 'error' && !/status of (403|404)/.test(m.text())) bad.push('console error: ' + m.text()); });
page.on('pageerror', (e) => bad.push('page error: ' + e.message));
const expected = new Set();
const say = (what, ok) => console.log((ok ? 'ok   ' : 'FAIL ') + what);
const wait = (ms = 700) => page.waitForTimeout(ms);
const text = async () => page.locator('main').innerText();
const dialog = page.getByRole('dialog');
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const inDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return iso(d); };
const send = (method, address, body) => page.evaluate(async ([m, a, b]) => { const r = await fetch(a, { method: m, headers: { 'Content-Type': 'application/json' }, body: b === undefined ? undefined : JSON.stringify(b) }); return r.status === 204 ? null : r.json(); }, [method, address, body]);
const tooSmall = async (locators) => {
  const small = [];
  for (const loc of locators) for (const el of await loc.all()) { if (await el.isVisible()) { const box = await el.boundingBox(); if (box && box.height < 43.5) small.push((await el.innerText().catch(() => '')).slice(0, 30) || (await el.getAttribute('aria-label')) || '?'); } }
  return small;
};
const noSideways = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

await page.goto(base + '/'); await wait();
await page.getByRole('textbox').first().fill('trial');
await page.locator('input[type=password]').fill('trial-only-password-8021');
await page.getByRole('button', { name: 'Sign in' }).click(); await wait(1500);

await page.goto(base + '/routines'); await wait(1000);
say('there is an Incident log chip on Routines', await page.getByRole('link', { name: 'Incident log', exact: true }).first().isVisible());
await page.getByRole('link', { name: 'Incident log', exact: true }).first().click(); await wait(1000);
say('with none yet, the page says how to start, that only you can see it, and the 24 hour rule', /No entries yet/.test(await text()) && (await page.locator('[data-private]').innerText()).includes('Only you can see this') && (await page.locator('[data-lock-rule]').first().innerText()).includes('24 hours') && (await page.locator('[data-lock-rule]').first().innerText()).includes('only be added to'));
say('there is nothing to print yet', (await page.getByRole('link', { name: 'Print the whole log' }).count()) === 0);

// ---------- writing an entry ----------
await page.getByRole('button', { name: '+ New entry' }).click(); await wait(500);
say('the form says the rule too', (await dialog.locator('[data-lock-rule]').innerText()).includes('24 hours'));
await dialog.getByLabel('Day it happened').fill(inDays(-2));
await dialog.getByLabel('Time').fill('about 9 pm');
await dialog.getByLabel('What happened').fill('The back door was open when we got home.');
await dialog.getByLabel('Who was there').fill('Charlie and Hank');
await dialog.getByLabel('What you kept').fill('Four photos on my phone, and a text from the landlord');
const formSmall = await tooSmall([dialog.locator('button'), dialog.locator('input'), dialog.locator('textarea')]);
say('the form has 44px controls and fits 375px' + (formSmall.length ? ` (too small: ${formSmall})` : ''), formSmall.length === 0 && await noSideways());
await dialog.getByRole('button', { name: 'Save' }).click(); await wait(900);
const card = page.locator('[data-entry]').first();
say('the entry shows what happened, who, and what was kept', (await card.locator('[data-what]').innerText()).includes('back door') && (await card.innerText()).includes('Who was there: Charlie and Hank') && (await card.innerText()).includes('What I kept: Four photos'));
say('it says when it was written and until when it can be changed', /Written .*You can change or delete it until/.test(await card.locator('[data-written]').innerText()) && (await card.getAttribute('data-locked')) === 'no');

// ---------- changing it within 24 hours ----------
await card.getByRole('button', { name: /^Change the entry of/ }).click(); await wait(500);
await dialog.getByLabel('What happened').fill('The back door was open when we got home. A light was on in the kitchen.');
await dialog.getByRole('button', { name: 'Save' }).click(); await wait(900);
say('a new entry can be changed', (await page.locator('[data-entry] [data-what]').first().innerText()).includes('A light was on'));

// ---------- adding to it, at any time ----------
await card.getByRole('button', { name: /^Add to the entry of/ }).click(); await wait(300);
await card.getByLabel(/^What to add to the entry of/).fill('The landlord called back the next morning.');
await card.getByRole('button', { name: 'Keep this addition' }).click(); await wait(800);
say('an addition is shown below the entry with when it was added', (await card.locator('[data-addition]').count()) === 1 && /Added /.test(await card.locator('[data-addition]').innerText()) && (await card.locator('[data-addition]').innerText()).includes('landlord called back'));
say('an addition has no Change or Delete', (await card.locator('[data-addition] button').count()) === 0);
say('and the entry itself is unchanged by it', (await card.locator('[data-what]').innerText()).includes('A light was on'));

// ---------- an entry older than 24 hours: restored from a download, it keeps when it was written ----------
const old = '2025-01-02T08:00:00+00:00';
const csv = ['Written at,Day,Time,What happened,Who was there,What was kept,Added at,Added words', `${old},2024-12-31,evening,"A neighbor shouted over the fence.",Loretta,"A voice note",,`, `${old},2024-12-31,evening,"A neighbor shouted over the fence.",Loretta,"A voice note",2025-01-03T09:30:00+00:00,"Wrote down what was said."`].join('\n') + '\n';
const brought = await send('POST', '/api/export/bring-in', { files: { 'incident-log.csv': csv }, kinds: ['incidents'] });
say('a download brings an entry back with its additions', brought.kinds[0].ok === true && brought.kinds[0].fresh === 1);
await page.reload(); await wait(1000);
const locked = page.locator('[data-entry][data-locked="yes"]');
say('an entry written long ago is shown as locked, in its place by date', (await locked.count()) === 1 && (await page.locator('[data-entry]').evaluateAll((els) => els.map((e) => e.dataset.entry))).join() === [inDays(-2), '2024-12-31'].join());
say('it says it can only be added to now', (await locked.locator('[data-written]').innerText()).includes('It can only be added to now.'));
say('it has no Change button, and no way to delete it', (await locked.getByRole('button', { name: /^Change the entry of/ }).count()) === 0 && (await locked.getByRole('button', { name: /Delete/ }).count()) === 0);
say('its addition came back with when it was written', (await locked.locator('[data-addition]').innerText()).includes('Wrote down what was said.'));
await locked.getByRole('button', { name: /^Add to the entry of/ }).click(); await wait(300);
await locked.getByLabel(/^What to add to the entry of/).fill('It happened again the next week.');
await locked.getByRole('button', { name: 'Keep this addition' }).click(); await wait(800);
say('a locked entry can still be added to', (await locked.locator('[data-addition]').count()) === 2);
const id = (await send('GET', '/api/incidents')).find((i) => i.locked).id;
expected.add('PUT /api/incidents/' + id); expected.add('DELETE /api/incidents/' + id);
const tried = await page.evaluate(async (n) => {
  const put = await fetch('/api/incidents/' + n, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ happened_on: '2024-12-31', what: 'Rewritten' }) });
  const del = await fetch('/api/incidents/' + n, { method: 'DELETE' });
  return [put.status, del.status, (await put.json()).detail];
}, id);
say('the server refuses to change or delete it, in words', tried[0] === 403 && tried[1] === 403 && /more than 24 hours ago/.test(tried[2]));
const again = await send('POST', '/api/export/bring-in', { files: { 'incident-log.csv': csv }, kinds: ['incidents'] });
say('bringing the same download in again adds nothing', again.kinds[0].fresh === 0 && again.kinds[0].already === 1);

// ---------- the page at 375px ----------
await page.reload(); await wait(1000);
const pageSmall = await tooSmall([page.locator('main button'), page.locator('main input'), page.locator('main a')]);
say('the page has 44px controls and fits 375px' + (pageSmall.length ? ` (too small: ${pageSmall})` : ''), pageSmall.length === 0 && await noSideways());
await page.screenshot({ path: shots + '/incident-log-375.png', fullPage: true });
await page.evaluate(() => document.documentElement.classList.add('dark')); await wait(300);
await page.screenshot({ path: shots + '/incident-log-dark-375.png', fullPage: true });
await page.evaluate(() => document.documentElement.classList.remove('dark'));

// ---------- printing the whole log on letter paper ----------
await page.getByRole('link', { name: 'Print the whole log' }).click(); await wait(1000);
const sheet = page.locator('[aria-label="The incident log"]');
const entries = await sheet.locator('[data-print-entry]').allInnerTexts();
say('the printout has the entries oldest first, each with when it was written', entries.length === 2 && entries[0].includes('neighbor shouted') && entries[1].includes('back door') && entries.every((e) => /Written /.test(e)));
say('and each addition with when it was added', entries[0].includes('Wrote down what was said.') && entries[0].includes('It happened again the next week.') && /Added .*: Wrote down/.test(entries[0].replace(/\n/g, ' ')));
say('the printout says the rule, and has no art but the print frame', (await sheet.innerText()).includes('24 hours'));
say('the page fits 375px', await noSideways());
const printSmall = await tooSmall([page.locator('main button'), page.locator('main a'), page.locator('main select')]);
say('its controls are 44px' + (printSmall.length ? ` (too small: ${printSmall})` : ''), printSmall.length === 0);
await page.screenshot({ path: shots + '/incident-print-375.png', fullPage: true });
await page.emulateMedia({ media: 'print' });
const hidden = await page.evaluate(() => ({ controls: !document.querySelector('main button').checkVisibility(), head: !document.querySelector('header').checkVisibility() }));
say('on paper the buttons and the app bar are left out', hidden.controls && hidden.head);
const pdf = await page.pdf({ preferCSSPageSize: true });
const pdfText = pdf.toString('latin1');
const box = /\/MediaBox\s*\[\s*0\s+0\s+([0-9.]+)\s+([0-9.]+)\s*\]/.exec(pdfText);
say('the PDF is letter size, 8.5 by 11 inches', Boolean(box) && Math.abs(Number(box[1]) - 612) < 1 && Math.abs(Number(box[2]) - 792) < 1);
await page.emulateMedia({ media: 'screen' });

// ---------- deleting inside 24 hours ----------
await page.goto(base + '/incident-log'); await wait(1000);
await page.locator('[data-entry][data-locked="no"]').getByRole('button', { name: /^Change the entry of/ }).click(); await wait(500);
await dialog.getByRole('button', { name: 'Delete this entry' }).click();
await dialog.getByRole('button', { name: /^Yes, delete it/ }).click(); await wait(900);
say('a new entry can be deleted inside the 24 hours', (await page.locator('[data-entry]').count()) === 1);

// ---------- private ----------
say('search never finds an entry', (await send('GET', '/api/search?q=neighbor')).length === 0 && (await send('GET', '/api/search?q=Loretta')).length === 0);
await page.goto(base + '/'); await wait(1500);
say('the front page does not show it', !(await text()).includes('neighbor') && !(await text()).includes('Loretta'));
const zip = await page.evaluate(async () => (await fetch('/api/export/everything.zip')).status);
say("the person's own full download is allowed", zip === 200);

say('nothing was asked of another address' + (outside.size ? ` (${[...outside]})` : ''), outside.size === 0);
say('no failed requests or errors' + (bad.length ? `: ${bad.join('; ')}` : ''), bad.length === 0);
await browser.close();
