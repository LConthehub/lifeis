import { browserChoice } from '../browser.mjs';
import { chromium } from 'playwright-core';
const [base, shots] = process.argv.slice(2);
const browser = await chromium.launch({ ...browserChoice, headless: true });
const page = await browser.newPage({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2 });
const bad = [];
page.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 400) bad.push(`${r.request().method()} ${new URL(r.url()).pathname} ${r.status()}`); });
page.on('console', (m) => { if (m.type() === 'error' && !/status of 4\d\d/.test(m.text())) bad.push('console error: ' + m.text()); });
page.on('pageerror', (e) => bad.push('page error: ' + e.message));
const say = (what, ok) => console.log((ok ? 'ok   ' : 'FAIL ') + what);
const wait = (ms = 700) => page.waitForTimeout(ms);
const text = async () => page.locator('main').innerText();
const dialog = page.getByRole('dialog');
/** A field of the form, by the words above it (the label also holds what it shows, so its name is not exact). */
const pick = (words) => dialog.locator('label').filter({ has: page.locator('span', { hasText: new RegExp('^' + words + '$') }) }).locator('select, input');
const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const later = (days) => iso(new Date(Date.now() + days * 86400000));
const send = (method, address, body) => page.evaluate(async ([m, a, b]) => { const r = await fetch(a, { method: m, headers: { 'Content-Type': 'application/json' }, body: b === undefined ? undefined : JSON.stringify(b) }); return r.status === 204 ? null : r.json(); }, [method, address, body]);
const shot = async (name, options = {}) => { await page.screenshot({ path: `${shots}/${name}.png`, ...options }); };
const noSideways = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const tooSmall = async (locators) => {
  const small = [];
  for (const loc of locators) for (const el of await loc.all()) { if (await el.isVisible()) { const box = await el.boundingBox(); if (box && box.height < 43.5) small.push(((await el.innerText().catch(() => '')).slice(0, 30) || (await el.getAttribute('aria-label')) || 'a control')); } }
  return small;
};
const region = (name) => page.getByRole('region', { name, exact: true });
/** Every control on the page is 44px tall, and nothing makes the page scroll sideways. */
const fits = async (what) => {
  const small = await tooSmall([page.locator('main button'), page.locator('main select'), page.locator('main input:not([type=checkbox]):not([type=file])'), page.locator('main summary')]);
  say(`${what} fits 375px with no sideways scroll and 44px controls` + (small.length ? ` (too small: ${small})` : ''), small.length === 0 && await noSideways());
};
/** Checks a part in the Parts list. */
const addPart = async (name) => {
  await page.getByRole('button', { name: 'Parts', exact: true }).click(); await wait(500);
  await dialog.getByRole('checkbox', { name, exact: true }).check();
  await dialog.getByRole('button', { name: 'Save' }).click(); await wait(1300);
};

await page.goto(base + '/'); await wait();
await page.getByRole('textbox').first().fill('trial');
await page.locator('input[type=password]').fill('trial-only-password-8021');
await page.getByRole('button', { name: 'Sign in' }).click(); await wait(1500);

// A plain, one-time plan: a lunch for someone who has died, with nothing on it but a budget to begin with.
const plan = await send('POST', '/api/plans', { name: 'Memorial lunch', start_day: later(40), parts: ['budget'] });
await page.goto(base + `/plans/${plan.id}`); await wait(1300);
let t = await text();
say('the plain plan starts with none of the parts', (await Promise.all(['Guests', 'Cards', 'Gifts', 'Put up', 'Food', 'Traditions', 'When and where', 'Helpers and tasks'].map((n) => region(n).count()))).every((n) => n === 0));
await fits('the plan before any part');

// ---------- Guests ----------
await addPart('Guests');
say('checking Guests shows a Guests card', await region('Guests').isVisible());
await region('Guests').getByLabel('Guests: a name').fill('Aunt Dot');
await region('Guests').getByRole('button', { name: 'Add', exact: true }).click(); await wait(900);
say('a guest is added', /Aunt Dot/.test(await region('Guests').innerText()));
await fits('Guests');

// ---------- Cards ----------
await addPart('Cards');
say('checking Cards shows a Cards card', await region('Cards').isVisible());
await region('Cards').getByLabel('Cards: a name').fill('Cousin June');
await region('Cards').getByRole('button', { name: 'Add', exact: true }).click(); await wait(900);
say('a card to send is added', /Cousin June/.test(await region('Cards').innerText()));
await fits('Cards');

// ---------- Gifts ----------
await addPart('Gifts');
say('checking Gifts shows a Gifts card', await region('Gifts').isVisible());
await region('Gifts').getByLabel('Who the gift is for, by name').fill('Hank');
await region('Gifts').getByLabel('The gift idea').fill('A framed photo');
await region('Gifts').getByRole('button', { name: 'Add', exact: true }).click(); await wait(900);
say('a gift idea is added', /A framed photo/.test(await region('Gifts').innerText()));
await fits('Gifts');

// ---------- Decorations ----------
await addPart('Decorations');
say('checking Decorations shows a Put up card', await region('Put up').isVisible());
await region('Put up').getByLabel('Where it goes').fill('Front table');
await region('Put up').getByLabel('What it is').fill('Photos in frames');
await region('Put up').getByRole('button', { name: 'Add it' }).click(); await wait(900);
say('a decoration is added', /Photos in frames/.test(await region('Put up').innerText()) && /Front table/.test(await region('Put up').innerText()));
await fits('Decorations');

// ---------- Food, with a line that is bought or brought ----------
await addPart('Food');
const food = region('Food');
say('checking Food shows a Food card', await food.isVisible());
await food.getByLabel('A meal or refreshments').selectOption('refreshments'); await wait(800);
await food.getByLabel('What is it').fill('Lemon bars');
await food.getByLabel('Who brings it (if anyone)').fill('Aunt Dot');
await food.getByRole('button', { name: 'Add the food' }).click(); await wait(900);
say('a bought-or-brought line says who brings it', /Lemon bars/.test(await food.innerText()) && /Aunt Dot brings it/.test(await food.innerText()));
await food.getByRole('checkbox', { name: 'Lemon bars is here' }).click(); await wait(800);
say('the line can be checked off when it is here', await food.getByRole('checkbox', { name: 'Lemon bars is here' }).isChecked());
await fits('Food');

// ---------- Traditions ----------
await addPart('Traditions');
const trad = region('Traditions');
say('checking Traditions shows a Traditions card', await trad.isVisible());
await trad.getByLabel('Something you always do').fill('Everyone shares a story');
await trad.getByRole('button', { name: 'Add', exact: true }).click(); await wait(900);
say('a tradition is added', (await trad.locator('[data-tradition]').count()) === 1);
await fits('Traditions');

// ---------- When and where ----------
await addPart('When and where');
const when = region('When and where');
say('checking When and where shows the card', await when.isVisible());
await when.getByLabel('Starts at').fill('12:00'); await when.getByLabel('Starts at').blur(); await wait(900);
await when.getByLabel('Where').fill('Community center'); await when.getByLabel('Where').blur(); await wait(900);
say('the plan page shows the time and the place', /12:00 · Community center/.test(await text()));
await fits('When and where');

// ---------- Helpers and tasks ----------
await addPart('Helpers and tasks');
const helpers = region('Helpers and tasks');
say('checking Helpers and tasks shows the card', await helpers.isVisible());
await helpers.getByLabel('Something to do').fill('Hank sets out the chairs');
await helpers.getByRole('button', { name: 'Add', exact: true }).click(); await wait(900);
await helpers.getByRole('checkbox', { name: 'Hank sets out the chairs' }).click(); await wait(800);
say('a task is added and checked off', await helpers.getByRole('checkbox', { name: 'Hank sets out the chairs' }).isChecked() && /1 of 1/.test(await helpers.innerText()));
await fits('Helpers and tasks');

// ---------- all of it stays ----------
await page.reload(); await wait(1600);
t = await text();
say('after a reload every part still has its line', ['Aunt Dot', 'Cousin June', 'A framed photo', 'Photos in frames', 'Lemon bars', 'Community center', 'Hank sets out the chairs'].every((w) => t.includes(w)) && await trad.getByLabel('Reword Everyone shares a story').isVisible());
const seen = await send('GET', `/api/plans/${plan.id}`);
say('the server has the parts and what is in them', ['guests', 'cards', 'gifts', 'decorations', 'food', 'traditions', 'when_where', 'tasks'].every((p) => seen.parts.includes(p))
  && seen.food_lines.length === 1 && seen.food_lines[0].brought_by === 'Aunt Dot' && seen.traditions.length === 1 && seen.place === 'Community center');
await fits('the whole plan');
await shot('plain-plan-parts', { fullPage: true });

say('no request failed' + (bad.length ? `: ${bad.join(' | ')}` : ''), bad.length === 0);
await browser.close();
