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
const regionShot = async (name, file) => {
  const r = region(name);
  await r.scrollIntoViewIfNeeded(); await page.evaluate(() => window.scrollBy(0, -130)); await wait(200);
  await r.screenshot({ path: `${shots}/${file}.png` });
};

const first = later(30);
const last = later(32);

await page.goto(base + '/'); await wait();
await page.getByRole('textbox').first().fill('trial');
await page.locator('input[type=password]').fill('trial-only-password-8021');
await page.getByRole('button', { name: 'Sign in' }).click(); await wait(1500);

// What a family that camps and fishes already keeps: gear, tackle with counts, a recipe.
await send('POST', '/api/things/kinds', { name: 'Camping gear', icon: null, fields: [] });
await send('POST', '/api/things/kinds', { name: 'Fishing tackle', icon: null, fields: [] });
const kinds = await send('GET', '/api/things/kinds');
const camping = kinds.find((k) => k.name === 'Camping gear').id;
const tackle = kinds.find((k) => k.name === 'Fishing tackle').id;
for (const name of ['Family tent', 'Big cooler', 'Two-burner stove']) await send('POST', '/api/things/items', { kind_id: camping, name });
await send('POST', '/api/things/items', { kind_id: tackle, name: 'Jig heads', quantity: 2, low_at: 4 });
await send('POST', '/api/things/items', { kind_id: tackle, name: 'Spinners', quantity: 6, low_at: 2 });
await send('POST', '/api/kitchen/recipes', { title: 'Campfire chili', servings: 4, ingredients_text: '2 lb ground beef\n1 can kidney beans', steps_text: 'Brown the beef. Add the beans. Simmer.' });

// ---------- adding the trip ----------
await page.goto(base + '/plans/trips'); await wait(1000);
let t = await text();
say('Outdoor trips starts empty and says nothing is looked up or sent', /Nothing is looked up/.test(t) && !/Lake weekend/.test(t));
say('Trips is a tab in the busy section', await page.getByRole('link', { name: 'Trips' }).first().isVisible());
await page.getByRole('button', { name: '+ Add a trip' }).click(); await wait(500);
await dialog.getByLabel('Name *').fill('Lake weekend');
await dialog.getByRole('checkbox', { name: 'Camping' }).check();
await dialog.getByRole('checkbox', { name: 'Fishing' }).check();
await dialog.locator('input[type=date]').nth(0).fill(first);
await dialog.locator('input[type=date]').nth(1).fill(last);
await dialog.getByRole('button', { name: 'Add it' }).click(); await wait(1500);
t = await text();
const year = new Date(first + 'T12:00').getFullYear();
say(`one trip with camping and fishing is made for ${year}`, t.includes(`Lake weekend ${year}`) && /Camping, Fishing/.test(t));
const trip = (await send('GET', '/api/plans/trips'))[0];
const planId = trip.years[0].plan_id;
say('it has its own plan, so it is on the calendar by name and days', (await send('GET', `/api/calendar?start=${first}&days=3`)).some((e) => e.title === `Lake weekend ${year}`));

// ---------- the water, then one bring list from the gear ----------
await page.getByLabel('The water, in words').fill('Lake Pepin'); await page.getByLabel('The water, in words').blur(); await wait(800);
const bring = region('Bring list');
await bring.getByRole('button', { name: 'Add my camping gear' }).click(); await wait(900);
await bring.getByRole('button', { name: 'Add my fishing gear' }).click(); await wait(900);
t = await bring.innerText();
say('one bring list holds the camping gear and the tackle', /Family tent/.test(t) && /Big cooler/.test(t) && /Two-burner stove/.test(t) && /Jig heads/.test(t) && /Spinners/.test(t));
say('tackle at its low count says so', /running low/.test(t));
await bring.getByRole('checkbox', { name: 'Family tent is packed' }).click(); await wait(600);
say('a piece can be packed, and the count shows', await bring.getByRole('checkbox', { name: 'Family tent is packed' }).isChecked() && /1 of 5 packed/.test(await bring.innerText()));
await bring.getByLabel('Something else to bring').fill('Bug spray'); await bring.getByRole('button', { name: 'Add to the list' }).click(); await wait(800);
say('something else can be added by words', /Bug spray/.test(await bring.innerText()));

// ---------- the camp menu goes on the grocery list ----------
const menu = region('Camp menu');
await menu.getByLabel('Recipe for the menu').selectOption({ label: 'Campfire chili' });
await menu.getByLabel('Day it is eaten').selectOption(first);
await menu.getByRole('button', { name: 'Add to the menu' }).click(); await wait(1000);
say('the recipe is on the menu with its day', /Campfire chili/.test(await menu.innerText()));
say('the cooler and stove are found among what is owned', /Cooler: you have Big cooler/.test(await menu.innerText()) && /Stove: you have Two-burner stove/.test(await menu.innerText()));
await menu.getByRole('button', { name: 'Put the menu on the grocery list' }).click(); await wait(1200);
say('the menu goes on the grocery list', /on the grocery list/.test(await menu.innerText()) && (await send('GET', '/api/kitchen/grocery')).some((g) => /ground beef/i.test(g.label)));

// ---------- the site booking shows on the calendar ----------
const booking = region('Campsite booking');
await booking.getByLabel('Campground').fill('Pine Hollow'); await booking.getByLabel('Campground').blur(); await wait(600);
await booking.getByLabel('Site', { exact: true }).fill('14'); await booking.getByLabel('Site', { exact: true }).blur(); await wait(600);
await booking.getByLabel('Confirmation number').fill('PH-20418'); await booking.getByLabel('Confirmation number').blur(); await wait(600);
await booking.getByLabel('Check-in').fill(first); await booking.getByLabel('Check-in').blur(); await wait(600);
await booking.getByLabel('Check-out').fill(last); await booking.getByLabel('Check-out').blur(); await wait(900);
const onCalendar = (await send('GET', `/api/calendar?start=${first}&days=3`)).filter((e) => /Pine Hollow/.test(e.title));
const booked = onCalendar.length > 0 ? await send('GET', `/api/calendar/events/${onCalendar[0].id}`) : null;
say('the typed-in booking shows on the calendar with its site and confirmation', booked !== null && /Site 14/.test(booked.note ?? '') && /PH-20418/.test(booked.note ?? '') && booked.day === first && booked.end_day === last);

// ---------- a catch with the lure used ----------
{
  const log = region('Catch log');
  await log.getByLabel('Fish', { exact: true }).fill('Walleye');
  await log.getByLabel('Length (inches)').fill('17.5');
  await log.getByLabel('Lure from your tackle').selectOption({ label: 'Jig heads' });
  await log.getByRole('checkbox', { name: 'Kept' }).check();
  await log.getByRole('button', { name: 'Log the catch' }).click(); await wait(1000);
  t = await log.innerText();
  say('the catch is logged with its water, size and the lure from the tackle', /Walleye/.test(t) && /Lake Pepin/.test(t) && /17\.5 in/.test(t) && /kept/.test(t) && /on Jig heads/.test(t));
  await log.getByRole('button', { name: 'Put the Walleye in the freezer' }).click(); await wait(1000);
  say('a kept fish goes to the freezer', /in the freezer/.test(await log.innerText()) && (await send('GET', '/api/kitchen/pantry')).items.some((i) => /walleye/i.test(i.name) && i.location === 'freezer'));
  say('what worked comes from the log', /Jig heads \(1\)/.test(await region('What worked').innerText()));
  say('tackle running low is listed', /Jig heads/.test(await region('Tackle running low').innerText()));
}

// ---------- after the trip: the torn tent goes to Upkeep ----------
const after = region('After the trip');
await after.getByRole('checkbox', { name: 'Family tent is back' }).click(); await wait(500);
await after.getByLabel('What Family tent needs after the trip').selectOption({ label: 'Repair it (to Upkeep)' }); await wait(1200);
say('the tent is marked to repair, and links to Upkeep', /In Upkeep/.test(await after.innerText()));
const jobs = await send('GET', '/api/things/upkeep');
say('a repair job for the tent is in Upkeep', jobs.some((j) => j.name === 'Repair: Family tent'));
await after.getByLabel('What Bug spray needs after the trip').selectOption({ label: 'Replace it (to the shopping list)' }); await wait(1000);
say('a piece to replace goes on the shopping list', (await send('GET', '/api/kitchen/grocery')).some((g) => /bug spray/i.test(g.label)));

// ---------- how it looks on a phone ----------
await page.goto(base + `/plans/trips/${trip.id}/${planId}`); await wait(1500);
await shot('trips-year-375', { fullPage: true });
await regionShot('Bring list', 'trips-bring-list-375');
await regionShot('Catch log', 'trips-catch-log-375');
await regionShot('After the trip', 'trips-after-375');
const small = await tooSmall([page.locator('main button'), page.locator('main select'), page.locator('main input:not([type=checkbox]):not([type=file])'), page.locator('main summary')]);
say('the trip page has 44px controls' + (small.length ? ` (too small: ${small})` : ''), small.length === 0);
say('the trip page does not scroll sideways', await noSideways());
await page.goto(base + '/plans/trips'); await wait(1000);
say('the trip is on the list, with its parts', /Lake weekend/.test(await text()) && /Camping, Fishing/.test(await text()));
say('the list does not scroll sideways', await noSideways());

// ---------- next year starts from this one ----------
const next = await send('POST', `/api/plans/trips/${trip.id}/years`, { day: later(30 + 365), end_day: later(32 + 365) });
say('next year starts from this one: the same bring list, nothing packed', next.gear.length === 6 && next.gear.every((g) => !g.packed) && next.menu.length === 1 && next.catches.length === 0);

say('no request failed' + (bad.length ? `: ${bad.join(' | ')}` : ''), bad.length === 0);
await browser.close();
