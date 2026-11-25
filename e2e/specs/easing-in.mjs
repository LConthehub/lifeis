// Easing in: a brand-new person on a 375px phone answers what bugs them most, finishes the start, and lands on a
// working Home with examples marked Example and a Start here card whose steps tick themselves. The examples clear
// with one button and leave what they added alone. A room can be filled by snapping photos, each becoming a thing.
import { browserChoice } from '../browser.mjs';
import { chromium } from 'playwright-core';
import { crc32, deflateSync } from 'node:zlib';
const [base, shots] = process.argv.slice(2);
const PASS = 'trial-only-password-8041';
const results = [];
const check = (name, ok, extra = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); };
process.on('exit', () => console.log(results.join(String.fromCharCode(10))));

const browser = await chromium.launch({ ...browserChoice, headless: true });
const wait = (page, ms = 700) => page.waitForTimeout(ms);
const flat = (s) => s.replace(/\s+/g, ' ');
const bad = [];
const api = (page, method, path, body) => page.evaluate(async ([m, p, b]) => {
  const r = await fetch(p, { method: m, headers: { 'Content-Type': 'application/json' }, body: b === undefined ? undefined : JSON.stringify(b) });
  return { status: r.status, json: r.status === 204 ? null : await r.json().catch(() => null) };
}, [method, path, body]);
// A small real picture, made here: 8 by 8 pixels, one flat color.
const chunk = (type, data) => {
  const body = Buffer.concat([Buffer.from(type), data]);
  const out = Buffer.alloc(body.length + 8);
  out.writeUInt32BE(data.length, 0); body.copy(out, 4); out.writeUInt32BE(crc32(body), body.length + 4);
  return out;
};
const header = Buffer.alloc(13); header.writeUInt32BE(8, 0); header.writeUInt32BE(8, 4); header[8] = 8; header[9] = 2;
const rows = Buffer.concat(Array.from({ length: 8 }, () => Buffer.concat([Buffer.from([0]), Buffer.alloc(24, 180)])));
const PNG = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);

const context = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2 });
const page = await context.newPage();
page.on('pageerror', (e) => check('no page errors', false, e.message));
page.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 400) bad.push(`${r.request().method()} ${new URL(r.url()).pathname} ${r.status()}`); });

// ---------- a brand-new person ----------
await page.goto(base + '/'); await wait(page, 1000);
await page.getByRole('textbox').first().fill('eli');
await page.locator('input[type=password]').fill(PASS);
await page.getByRole('button', { name: /Make my account/ }).click(); await wait(page, 2000);
const dlg = page.getByRole('dialog');
let t = flat(await dlg.innerText());
check('the first thing asked is what bugs them most, with a plain line that most people need no server', /What bugs you most at home\?/.test(t) && /Most people need no server/.test(t), t.slice(0, 200));
const choices = (await dlg.getByRole('radio').evaluateAll((els) => els.map((e) => e.closest('label').innerText.trim())));
check('there are six choices: meals, clutter, bills, the calendar, chores and keeping track', choices.length === 6 && /^Meals/.test(choices[0]) && /^Clutter/.test(choices[1]) && /^Bills/.test(choices[2]) && /^The calendar/.test(choices[3]) && /^Chores/.test(choices[4]) && /^Keeping track/.test(choices[5]), choices.join(' | '));
await dlg.getByLabel(/^Clutter/).check();
await dlg.getByRole('button', { name: 'Next' }).click(); await wait(page, 900);
await dlg.getByRole('button', { name: 'Next' }).click(); await wait(page, 900); // nobody named
t = flat(await dlg.innerText());
check('step 2 has "What we own and where it is" checked for the clutter answer', /Step 2 of 4/.test(t) && await dlg.getByLabel('What we own and where it is').isChecked());
await dlg.getByRole('button', { name: 'Next' }).click(); await wait(page, 900);
await dlg.getByRole('button', { name: 'Next' }).click(); await wait(page, 1200); // upkeep sets
check('step 4 has the examples on already', await dlg.getByLabel('Put a few examples in').isChecked());
await dlg.getByRole('button', { name: 'Finish' }).click(); await wait(page, 1800);
await dlg.getByRole('button', { name: 'Stay on the front page' }).click(); await wait(page, 1800);

// ---------- Home, at 375px ----------
const card = page.getByRole('region', { name: 'Start here' });
const home = async (label) => {
  const r = await page.evaluate(() => {
    const small = [];
    for (const el of document.querySelectorAll('main a, main button')) {
      const b = el.getBoundingClientRect();
      if (b.width > 0 && b.height > 0 && b.height < 43.5 && el.closest('[aria-label="Start here"]')) small.push(`${el.innerText.slice(0, 30)} ${Math.round(b.height)}px`);
    }
    return { sideways: document.documentElement.scrollWidth > window.innerWidth + 1, small };
  });
  check(`${label}: nothing scrolls sideways and the Start here controls are at least 44px tall`, !r.sideways && r.small.length === 0, r.sideways ? 'sideways' : r.small.join('; '));
};
t = flat(await card.innerText());
const steps = await card.locator('li').count();
check('Home has a Start here card with three to five steps, about 2 min each, and Hide this', await card.isVisible() && steps >= 3 && steps <= 5 && /2 min/.test(t) && /Hide this/.test(t), t.slice(0, 240));
check('the first step is the one for the clutter answer', (await card.locator('li').first().getAttribute('data-step')) === 'room', await card.locator('li').first().innerText());
check('no step is ticked yet: the examples do not count', (await card.locator('li[data-done=true]').count()) === 0);
const lead = page.locator('[data-lead=true]');
check('Home opens on the card for the answer (Things), before the other cards', (await lead.count()) === 1 && /Things/.test(await lead.locator('h2').innerText()));
const grid = await page.evaluate(() => {
  const cards = [...document.querySelectorAll('main section')].filter((s) => s.querySelector('h2') && !s.matches('[aria-label]'));
  const tops = cards.map((c) => [c.querySelector('h2').innerText, Math.round(c.getBoundingClientRect().top + scrollY), c.dataset.lead === 'true']);
  return tops;
});
check('the lead card sits above the others on the phone', grid.length > 1 && grid[0] !== undefined && grid.filter((g) => g[2]).every((g) => g[1] <= Math.min(...grid.map((o) => o[1]))), JSON.stringify(grid));
const body = flat(await page.locator('main').innerText());
check('the examples show on Home, each marked Example', /Example: Box of light bulbs/.test(body) && /Example: Water the porch plants/.test(body));
check('and the card says some pages hold examples, with one button to clear them', /each marked Example/.test(t) && await card.getByRole('button', { name: 'Clear the examples' }).isVisible());
await home('Home');
await page.screenshot({ path: shots + '/easing-in-home-light.png', fullPage: true });
await page.evaluate(() => { try { localStorage.setItem('lifeis.theme', 'dark'); } catch { /* none */ } });
await page.reload(); await wait(page, 1800);
check('dark: the Home is dark', await page.evaluate(() => document.documentElement.classList.contains('dark')));
await home('Home, dark');
await page.screenshot({ path: shots + '/easing-in-home-dark.png', fullPage: true });
await page.evaluate(() => { try { localStorage.setItem('lifeis.theme', 'light'); } catch { /* none */ } });
await page.reload(); await wait(page, 1500);

// ---------- Fill a room by snapping photos ----------
const placeId = (await api(page, 'POST', '/api/things/places', { name: 'Garage' })).json.find((p) => p.name === 'Garage').id;
await page.goto(base + `/things/places/${placeId}/fill`); await wait(page, 1500);
check('the fill page has Snap a photo and Pick photos', await page.getByRole('button', { name: /Snap a photo/ }).isVisible() && await page.getByRole('button', { name: 'Pick photos' }).isVisible());
await page.locator('input[aria-label="Photo from the camera"]').setInputFiles({ name: 'a.png', mimeType: 'image/png', buffer: PNG });
await wait(page, 1500);
await page.locator('input[aria-label="Photos from the phone"]').setInputFiles([{ name: 'b.png', mimeType: 'image/png', buffer: PNG }, { name: 'c.png', mimeType: 'image/png', buffer: PNG }]);
await wait(page, 2200);
let there = (await api(page, 'GET', `/api/things/items?place_id=${placeId}`)).json;
check('each photo became a thing in the room at once, with its photo, needing only a name', there.length === 3 && there.every((i) => i.name === 'New thing' && i.photo), JSON.stringify(there.map((i) => [i.name, i.photo])));
const naming = page.getByLabel('Name this thing').first();
check('and each row says Name it, or add details later', await naming.isVisible() && /Name it, or add details later/.test(await naming.getAttribute('placeholder')));
await naming.fill('Blue ladder');
await naming.press('Enter'); await wait(page, 1200);
there = (await api(page, 'GET', `/api/things/items?place_id=${placeId}`)).json;
check('naming one keeps the name, and the rest wait', there.filter((i) => i.name === 'Blue ladder').length === 1 && there.filter((i) => i.name === 'New thing').length === 2);
const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
check('the fill page does not scroll sideways at 375px', !overflow);

// ---------- Steps tick themselves, and the examples clear without touching what is theirs ----------
await page.goto(base + '/'); await wait(page, 1500);
check('having added things of their own, the "room" step ticks itself', (await card.locator('li[data-step=room]').getAttribute('data-done')) === 'true');
const before = (await api(page, 'GET', '/api/things/items')).json.map((i) => i.name).sort();
check('the examples and their own things sit side by side', before.includes('Example: Step stool') && before.includes('Blue ladder'), before.join(', '));
await card.getByRole('button', { name: 'Clear the examples' }).click(); await wait(page, 1500);
const after = (await api(page, 'GET', '/api/things/items')).json.map((i) => i.name).sort();
check('Clear the examples removes only the examples', !after.some((n) => n.startsWith('Example:')) && after.includes('Blue ladder') && after.filter((n) => n === 'New thing').length === 2, after.join(', '));
const jobs = (await api(page, 'GET', '/api/things/upkeep')).json.map((j) => j.name);
check('the example upkeep jobs went too', !jobs.some((n) => n.startsWith('Example:')), jobs.join(', '));
await page.reload(); await wait(page, 1500);
check('the Start here card has the ticked step and no examples button', (await card.locator('li[data-step=room]').getAttribute('data-done')) === 'true' && (await card.getByRole('button', { name: 'Clear the examples' }).count()) === 0);
await page.screenshot({ path: shots + '/easing-in-home-after.png', fullPage: true });
await card.getByRole('button', { name: 'Hide this' }).click(); await wait(page, 1000);
await page.reload(); await wait(page, 1500);
check('Hide this puts the card away for good', (await card.count()) === 0);

// ---------- The weekly question is off without a way to be reminded ----------
const weekly = (await api(page, 'GET', '/api/start/weekly')).json;
check('the weekly question is off for a person with no reminder channel', weekly.channel === false && weekly.on === false && weekly.picks.length === 0, JSON.stringify(weekly));

console.log(bad.length ? 'PROBLEMS SEEN:\n' + [...new Set(bad)].join('\n') : 'no failed requests, no page errors');
check('no failed requests', bad.length === 0, [...new Set(bad)].join('; '));
await browser.close();
