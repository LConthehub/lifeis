// Bringing in a HomeBox export: the CSV is chosen on the Things page, looked over (nothing is kept yet), brought in,
// and chosen again (nothing is added). Looked at on a phone too.
import { readFileSync } from 'node:fs';
import { browserChoice } from '../browser.mjs';
import { chromium } from 'playwright-core';
const [base, shots] = process.argv.slice(2);
const say = (what, ok, extra = '') => console.log((ok ? 'ok   ' : 'FAIL ') + what + (!ok && extra ? ' :: ' + String(extra).replace(/\s+/g, ' ').slice(0, 400) : ''));

const sample = readFileSync(new URL('../fixtures/homebox-sample.csv', import.meta.url));
const file = { name: 'homebox-export.csv', mimeType: 'text/csv', buffer: sample };

const browser = await chromium.launch({ ...browserChoice, headless: true });
const page = await browser.newPage({ viewport: { width: 375, height: 812 } });
const bad = [];
page.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 400) bad.push(`${r.request().method()} ${new URL(r.url()).pathname} ${r.status()}`); });
page.on('pageerror', (e) => bad.push('page error: ' + e.message));
const wait = (ms = 700) => page.waitForTimeout(ms);
const dialog = page.getByRole('dialog');
const send = (method, address, body) => page.evaluate(async ([m, a, b]) => { const r = await fetch(a, { method: m, headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }); return r.status === 204 ? null : r.json(); }, [method, address, body]);
const sideways = () => page.evaluate(() => document.documentElement.scrollWidth > 375 || document.body.scrollWidth > 375);

await page.goto(base + '/'); await wait();
await page.getByRole('textbox').first().fill('trial');
await page.locator('input[type=password]').fill('trial-only-password-8021');
await page.getByRole('button', { name: 'Sign in' }).click(); await wait(1500);

say('the account starts with no things', (await send('GET', '/api/things/items')).length === 0);
const open = async () => {
  await page.goto(base + '/things'); await wait(900);
  await page.getByRole('button', { name: 'Bring in from HomeBox' }).click(); await wait(400);
};
await open();
await dialog.getByLabel('A file (.csv)').setInputFiles(file);
await wait(400);
await dialog.getByRole('button', { name: 'Look it over' }).click(); await wait(1000);
const look = await dialog.innerText();
say('the look-over counts the things: ' + look.match(/\d+ things in the file[^\n]*/)?.[0], /6 things in the file\. 6 would be added\./.test(look), look);
const kinds = await dialog.locator('[data-homebox-kinds] li').allInnerTexts();
say('it shows a count for each kind: ' + kinds.map((k) => k.replace(/\s+/g, ' ')).join(' | '), kinds.length === 4 && kinds.some((k) => /Tools[\s\S]*2$/.test(k)) && kinds.some((k) => /Other[\s\S]*2$/.test(k)));
say('it counts places and tags', /Places: 5, 5 new/.test(look) && /Tags: 6, 6 new/.test(look), look);
say('it says one thing was sold', /1 thing that HomeBox says was sold/.test(look), look);
say('nothing is kept by looking', (await send('GET', '/api/things/items')).length === 0);
say('nothing scrolls sideways at 375px', !(await sideways()));
const tooSmall = await page.evaluate(() => [...document.querySelectorAll('[role=dialog] button:not([aria-label=Close])')].map((b) => [b.textContent.trim().slice(0, 20), b.getBoundingClientRect().height]).filter(([, h]) => h > 0 && h < 43.5));
say('buttons in it are at least 44px tall' + (tooSmall.length ? ': ' + JSON.stringify(tooSmall) : ''), tooSmall.length === 0);
await page.screenshot({ path: shots + '/homebox-review-375.png' });
await dialog.getByRole('button', { name: 'Bring in 6' }).click(); await wait(1500);
const done = await dialog.innerText();
say('it says what came in', /Brought in 6 things/.test(done), done);
await dialog.getByRole('button', { name: 'Done' }).click(); await wait(900);

const here = await send('GET', '/api/things/items');
say('the five that are still here are on the page: ' + here.map((i) => i.name).join(', '), here.length === 5 && /Cordless drill/.test(await page.locator('main').innerText()));
const drill = here.find((i) => i.name === 'Cordless drill');
say('the drill has its place, asset number, tags, warranty and own fields', drill?.place === 'Garage › Shelf 2' && drill.asset_no === '000-001' && drill.tag_list.length === 2
  && drill.records.warranty_until === '2047-05-12' && drill.own_fields.some((f) => f.name === 'Color' && f.value === 'Blue') && drill.insured === true && drill.records.price_cents === 8999, JSON.stringify(drill));
say('the toaster is under no longer have, sold', (await send('GET', '/api/things/items?gone=1')).some((i) => i.name === 'Toaster' && i.gone.how === 'sold' && i.gone.cents === 1200));
const places = (await send('GET', '/api/things/places')).map((p) => p.path);
say('places keep their nesting: ' + places.join(' | '), places.includes('Garage › Shelf 2') && places.includes('Office › Desk'));

// The same file again.
await open();
await dialog.getByLabel('A file (.csv)').setInputFiles(file);
await wait(400);
await dialog.getByRole('button', { name: 'Look it over' }).click(); await wait(1000);
const again = await dialog.innerText();
say('looked over again, none are new', /6 things in the file\. None of them are new\./.test(again) && /6 already in Life Is/.test(again) && await dialog.getByRole('button', { name: /^Bring in/ }).isDisabled(), again);
await page.screenshot({ path: shots + '/homebox-again-375.png' });
await dialog.getByRole('button', { name: 'Back' }).click(); await wait(200);
await dialog.getByRole('button', { name: 'Close' }).click().catch(() => {});
say('still five things, one in the gone list', (await send('GET', '/api/things/items')).length === 5 && (await send('GET', '/api/things/items?gone=1')).length === 1);

console.log(bad.length ? 'PROBLEMS SEEN:\n' + bad.join('\n') : 'no failed requests, no page errors');
await browser.close();
