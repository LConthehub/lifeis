import { browserChoice } from '../browser.mjs';
import { chromium } from 'playwright-core';
// Checkups: a person's own list, with the next one worked out, what is due soon, and marking one done. At 375px.
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

// ---------- the page ----------
await page.goto(base + '/routines'); await wait(1000);
say('there is a Checkups chip on Routines', await page.getByRole('link', { name: 'Checkups', exact: true }).first().isVisible());
await page.getByRole('link', { name: 'Checkups', exact: true }).first().click(); await wait(1000);
say('with none yet, the page says how to start, and that only you can see them', /No checkups yet/.test(await text()) && (await page.locator('[data-private]').innerText()).includes('Only you can see these'));

// ---------- making some ----------
const make = async (name, n, unit, last, extra = {}) => {
  await page.getByRole('button', { name: '+ New checkup' }).click(); await wait(400);
  await dialog.getByLabel('Name of the checkup').fill(name);
  await dialog.getByLabel('How many').fill(String(n));
  await dialog.getByLabel('Weeks, months or years').selectOption(unit);
  if (last) await dialog.getByLabel('Day of the last one').fill(last);
  if (extra.note) await dialog.getByLabel('Note').fill(extra.note);
  if (extra.cost) await dialog.getByLabel('Cost').fill(extra.cost);
  return dialog;
};
await make('Dentist', 6, 'month', null);
const formSmall = await tooSmall([dialog.locator('button'), dialog.locator('input'), dialog.locator('select'), dialog.locator('textarea')]);
say('the form has 44px controls and fits 375px' + (formSmall.length ? ` (too small: ${formSmall})` : ''), formSmall.length === 0 && await noSideways());
await dialog.getByRole('button', { name: 'Save' }).click(); await wait(800);
say('one with no last day says there is no next one yet', (await page.locator('[data-checkup="Dentist"] [data-next]').innerText()).includes('No last day yet') && (await page.locator('[data-group="unknown"]').count()) === 1);

// 12 months ago a year-long checkup: next one is today. 12 months and 3 days ago: 3 days late. 11 months ago: due in a few weeks.
const back = (months, days = 0) => { const d = new Date(); d.setMonth(d.getMonth() - months); d.setDate(d.getDate() - days); return iso(d); };
await make('Eyes', 1, 'year', back(12, 3), { note: 'Bring the old glasses', cost: '150' });
await dialog.getByRole('button', { name: 'Save' }).click(); await wait(800);
await make('Bloodwork', 1, 'year', back(11, -10)); // next one in 40 days ... (11 months back, 10 days less) is later
await dialog.getByRole('button', { name: 'Save' }).click(); await wait(800);
await make('Vet for George the dog', 12, 'month', back(12, -7)); // next one in 7 days: soon, and said in the morning reminder
await dialog.getByRole('button', { name: 'Save' }).click(); await wait(800);
await make('Skin check', 2, 'year', back(1));
await dialog.getByRole('button', { name: 'Save' }).click(); await wait(800);

say('what is overdue is listed first, then what is due soon, then later', (await page.locator('main section[data-group]').evaluateAll((els) => els.map((e) => e.dataset.group))).join() === 'overdue,soon,later,unknown');
const eyes = page.locator('[data-checkup="Eyes"]');
say('an overdue one says how many days late, and shows its note and cost', /3 days late/.test(await eyes.locator('[data-next]').innerText()) && (await eyes.locator('[data-cost]').innerText()) === 'Cost: $150.00' && (await eyes.locator('[data-note]').innerText()) === 'Bring the old glasses');
say('one coming up says in how many days', /in 7 days/.test(await page.locator('[data-checkup="Vet for George the dog"] [data-next]').innerText()) && (await page.locator('[data-checkup="Vet for George the dog"]').getAttribute('data-state')) === 'soon');
say('one far off is under later', (await page.locator('[data-group="later"] [data-checkup]').count()) === 2);

// ---------- marking one done ----------
await eyes.getByRole('button', { name: 'Mark Eyes done today' }).click(); await wait(800);
const after = page.locator('[data-checkup="Eyes"]');
say('marking it done sets the last day to today and moves the next one a year on', /last: /.test(await after.innerText()) && (await after.getAttribute('data-state')) === 'later' && /in 36[56] days/.test(await after.locator('[data-next]').innerText()));
say('it moved out of overdue', (await page.locator('[data-group="overdue"]').count()) === 0);

// ---------- changing one ----------
await page.locator('[data-checkup="Skin check"]').getByRole('button', { name: 'Change Skin check' }).click(); await wait(500);
await dialog.getByLabel('Name of the checkup').fill('Skin check at the clinic');
await dialog.getByRole('button', { name: 'Save' }).click(); await wait(800);
say('a checkup can be changed', (await page.locator('[data-checkup="Skin check at the clinic"]').count()) === 1);
await page.reload(); await wait(1000);
say('they are all still there after reloading', (await page.locator('[data-checkup]').count()) === 5);
const pageSmall = await tooSmall([page.locator('main button'), page.locator('main input'), page.locator('main select'), page.locator('main a')]);
say('the page has 44px controls and fits 375px' + (pageSmall.length ? ` (too small: ${pageSmall})` : ''), pageSmall.length === 0 && await noSideways());
await page.screenshot({ path: shots + '/checkups-375.png', fullPage: true });
await page.evaluate(() => document.documentElement.classList.add('dark')); await wait(300);
await page.screenshot({ path: shots + '/checkups-dark-375.png', fullPage: true });
await page.evaluate(() => document.documentElement.classList.remove('dark'));

// ---------- deleting ----------
await page.locator('[data-checkup="Dentist"]').getByRole('button', { name: 'Change Dentist' }).click(); await wait(500);
await dialog.getByRole('button', { name: 'Delete this checkup' }).click();
await dialog.getByRole('button', { name: 'Yes, delete it' }).click(); await wait(800);
say('a checkup can be deleted', (await page.locator('[data-checkup="Dentist"]').count()) === 0);

// ---------- private, and in the morning reminder ----------
say('search never finds a checkup', !(await send('GET', '/api/search?q=Eyes')).some((r) => /checkup/i.test(JSON.stringify(r))) && (await send('GET', '/api/search?q=Bloodwork')).length === 0);
await page.goto(base + '/'); await wait(1500);
say('the front page does not show them', !(await text()).includes('Bloodwork') && !(await text()).includes('Vet for George'));
const lines = (await send('GET', '/api/reminders/digest')).lines;
say('a checkup a week away is a plain line in the morning reminder, with no more than its name and when', lines.some((l) => l.title === 'Checkup: Vet for George the dog' && l.detail === 'due in 7 days') && !lines.some((l) => /Bloodwork|Skin check/.test(l.title)));
const zip = await page.evaluate(async () => (await fetch('/api/export/everything.zip')).status);
say("the person's own full download is allowed", zip === 200);

say('nothing was asked of another address' + (outside.size ? ` (${[...outside]})` : ''), outside.size === 0);
say('no failed requests or errors' + (bad.length ? `: ${bad.join('; ')}` : ''), bad.length === 0);
await browser.close();
