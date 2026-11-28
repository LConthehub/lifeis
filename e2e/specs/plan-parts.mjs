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

await page.goto(base + '/'); await wait();
await page.getByRole('textbox').first().fill('trial');
await page.locator('input[type=password]').fill('trial-only-password-8021');
await page.getByRole('button', { name: 'Sign in' }).click(); await wait(1500);

// A family with a tent, and a plain plan for a camping weekend with only its Bring list to begin with.
await send('POST', '/api/things/kinds', { name: 'Camping gear', icon: null, fields: [] });
const camping = (await send('GET', '/api/things/kinds')).find((k) => k.name === 'Camping gear').id;
await send('POST', '/api/things/items', { kind_id: camping, name: 'Family tent' });
const tent = (await send('GET', '/api/things/items')).find((i) => i.name === 'Family tent');
const plan = await send('POST', '/api/plans', { name: 'Camping weekend', start_day: later(20), end_day: later(22), parts: ['bring'] });
await send('POST', `/api/plans/${plan.id}/items`, { kind: 'thing', ref_id: tent.id });
// A second plan with nothing on its Bring list, to see what After the trip says then.
const bare = await send('POST', '/api/plans', { name: 'Lake picnic', start_day: later(30), parts: ['bring', 'after_trip'] });

// ---------- checking the parts ----------
await page.goto(base + `/plans/${plan.id}`); await wait(1200);
let t = await text();
say('the plan starts with only its Bring list', /Bring list/.test(t) && !/Seasons|Harvest log|After the trip|Guests/.test(t));
await page.getByRole('button', { name: 'Parts', exact: true }).click(); await wait(500);
for (const part of ['Guests', 'Cards', 'Gifts', 'Decorations', 'Seasons and licenses', 'Harvest log', 'After the trip']) await dialog.getByRole('checkbox', { name: part, exact: true }).check();
await dialog.getByRole('button', { name: 'Save' }).click(); await wait(1500);
for (const name of ['Guests', 'Cards', 'Gifts', 'Put up', 'Seasons', 'Harvest log', 'After the trip']) say(`${name} shows on the plan`, await region(name).isVisible());

// ---------- one line in each ----------
await region('Guests').getByLabel('Guests: a name').fill('Cousin Jo');
await region('Guests').getByRole('button', { name: 'Add', exact: true }).click(); await wait(800);
await region('Cards').getByLabel('Cards: a name').fill('Grandma');
await region('Cards').getByRole('button', { name: 'Add', exact: true }).click(); await wait(800);
await region('Gifts').getByLabel('Who the gift is for, by name').fill('Hank');
await region('Gifts').getByLabel('The gift idea').fill('A lantern');
await region('Gifts').getByRole('button', { name: 'Add', exact: true }).click(); await wait(800);
await region('Put up').getByLabel('Where it goes').fill('Picnic table');
await region('Put up').getByLabel('What it is').fill('Paper lanterns');
await region('Put up').getByRole('button', { name: 'Add it' }).click(); await wait(800);
await region('Seasons').getByLabel('Season name').fill('Deer season');
await region('Seasons').getByLabel('Season for').selectOption('hunting');
await region('Seasons').locator('input[type=date]').first().fill(later(60));
await region('Seasons').getByRole('button', { name: 'Add the season' }).click(); await wait(800);
await region('Harvest log').getByLabel('Animal', { exact: true }).fill('Deer');
await region('Harvest log').getByLabel('Place, in words').fill('By the lake');
await region('Harvest log').getByRole('button', { name: 'Log the harvest' }).click(); await wait(800);
// These tick boxes follow what the server says, so they are clicked and then looked at.
await page.getByLabel('Family tent is back').click(); await wait(800);
await page.getByLabel('What Family tent needs after the trip').selectOption('dry'); await wait(800);
await page.getByLabel('Family tent is dry').click(); await wait(800);

t = await text();
say('the guest, the card and the gift are on the plan', /Cousin Jo/.test(t) && /Grandma/.test(t) && /A lantern/.test(t));
say('the decoration is on the plan', /Paper lanterns/.test(t) && /Picnic table/.test(t));
say('the season and the harvest are on the plan', /Deer season/.test(t) && /By the lake/.test(t));
say('the hunting license check says none is kept yet', /No hunting license is kept/.test(await region('License check').innerText()));
say('the tent is back, dry and done', await page.getByLabel('Family tent is back').isChecked() && (await page.getByLabel('What Family tent needs after the trip').inputValue()) === 'dry' && await page.getByLabel('Family tent is dry').isChecked());

// ---------- it all stays ----------
await page.reload(); await wait(1500);
t = await text();
say('after a reload every line is still there', ['Cousin Jo', 'Grandma', 'A lantern', 'Paper lanterns', 'Deer season', 'By the lake'].every((w) => t.includes(w)) && await page.getByLabel('Family tent is dry').isChecked());
const outdoor = await send('GET', `/api/plans/trips/outdoor/${plan.id}`);
say('the server has the season, the harvest line and the tent', outdoor.seasons.length === 1 && outdoor.harvest.length === 1 && outdoor.gear[0].returned && outdoor.gear[0].after_trip === 'dry' && outdoor.gear[0].after_done);
const people = await send('GET', `/api/plans/holidays/gathering/${plan.id}`);
say('the server has the guest, the card, the gift and the decoration', people.guests.length === 1 && people.cards.length === 1 && people.gifts.length === 1 && people.spots.length === 1);
await shot('plan-parts', { fullPage: true });

// ---------- taking a part off keeps what is in it ----------
await page.getByRole('button', { name: 'Parts', exact: true }).click(); await wait(500);
await dialog.getByRole('checkbox', { name: 'Harvest log', exact: true }).uncheck();
await dialog.getByRole('button', { name: 'Save' }).click(); await wait(1200);
say('with Harvest log off it is hidden', (await region('Harvest log').count()) === 0);
await page.getByRole('button', { name: 'Parts', exact: true }).click(); await wait(500);
await dialog.getByRole('checkbox', { name: 'Harvest log', exact: true }).check();
await dialog.getByRole('button', { name: 'Save' }).click(); await wait(1200);
say('with Harvest log back on, its line is still there', /By the lake/.test(await text()));

// ---------- controls and width ----------
// The controls of these parts (the rest of the plan page was there before and has its own checks).
const mine = ['Guests', 'Cards', 'Gifts', 'Put up', 'Seasons', 'License check', 'Harvest log', 'After the trip'].map(region);
const small = await tooSmall(mine.flatMap((r) => [r.locator('button, a'), r.locator('select'), r.locator('input:not([type=checkbox]):not([type=file])'), r.locator('label:has(input[type=checkbox])')]));
say('the plan has 44px controls' + (small.length ? ` (too small: ${small})` : ''), small.length === 0);
say('the plan does not scroll sideways', await noSideways());

// ---------- nothing on the Bring list ----------
await page.goto(base + `/plans/${bare.id}`); await wait(1200);
say('After the trip with an empty Bring list says to add things first', /Add things to the Bring list first/.test(await region('After the trip').innerText()));
const smallBare = await tooSmall([region('After the trip').locator('button, select, a')]);
say('the empty plan has 44px controls' + (smallBare.length ? ` (too small: ${smallBare})` : ''), smallBare.length === 0);
say('the empty plan does not scroll sideways', await noSideways());

// ---------- starting points ----------
await page.goto(base + '/plans'); await wait(1200);
await page.getByRole('button', { name: '+ New' }).click(); await wait(600);
const kinds = dialog.getByRole('group', { name: 'What kind of plan' });
say('a new plan offers four starting points, Something else picked', (await kinds.getByRole('radio').count()) === 4 && await kinds.getByRole('radio', { name: 'Something else' }).isChecked());
const smallKinds = await tooSmall([kinds.locator('label')]);
say('the starting points are 44px tall' + (smallKinds.length ? ` (too small: ${smallKinds})` : ''), smallKinds.length === 0);
await kinds.getByRole('radio', { name: 'A trip' }).check(); await wait(300);
say('A trip turns on More than one day and says what it starts with', await dialog.getByRole('checkbox', { name: 'More than one day' }).isChecked() && /Starts with: Food, Budget, More than one day, Bring list, After the trip/.test(await dialog.innerText()));
await kinds.getByRole('radio', { name: 'A birthday' }).check(); await wait(300);
say('A birthday turns More than one day back off', !(await dialog.getByRole('checkbox', { name: 'More than one day' }).isChecked()));
await dialog.getByLabel('What it is *').fill("Hank's birthday");
await shot('plan-starts');
say('the new plan form does not scroll sideways', await noSideways());
await dialog.getByRole('button', { name: 'Save' }).click(); await wait(1800);
say('a birthday starts with Guests and Gifts, and no Bring list', await region('Guests').isVisible() && await region('Gifts').isVisible() && !/Bring list/.test(await text()));

// ---------- a one-time plan comes back every year ----------
const cookout = await send('POST', '/api/plans', { name: 'Summer cookout', start_day: later(45), parts: ['food', 'guests'] });
await page.goto(base + `/plans/${cookout.id}`); await wait(1200);
say('a one-time plan is not yearly, and offers Do it again and Every year', !/Yearly/.test(await text()) && await page.getByRole('button', { name: 'Do it again' }).isVisible() && await page.getByRole('button', { name: 'Every year' }).isVisible());
await page.getByRole('button', { name: 'Every year' }).click(); await wait(600);
const smallYearly = await tooSmall([dialog.locator('form button'), dialog.locator('form select'), dialog.locator('form input:not([type=checkbox])')]);
say('the Every year form has 44px controls' + (smallYearly.length ? ` (too small: ${smallYearly})` : ''), smallYearly.length === 0);
say('the Every year form does not scroll sideways', await noSideways());
say('the Every year form offers the three ways to find its day, and the weeks ahead', (await dialog.getByLabel('Its day').locator('option').count()) === 3 && await dialog.getByLabel('Start planning this many weeks ahead').isVisible());
await dialog.getByRole('button', { name: 'Make it yearly' }).click(); await wait(1800);
t = await text();
say('the plan says it is yearly, with its rule', /Yearly · /.test(t) && !(await page.getByRole('button', { name: 'Do it again' }).count()));
say('the server knows it as the first year of a yearly plan', (await send('GET', `/api/plans/${cookout.id}`)).yearly?.years.length === 1);
await shot('plan-yearly', { fullPage: true });
say('the yearly plan does not scroll sideways', await noSideways());
await page.getByRole('button', { name: 'Every year' }).click(); await wait(600);
const smallEdit = await tooSmall([dialog.locator('form button'), dialog.locator('form select'), dialog.locator('form input:not([type=checkbox])')]);
say('the form to change or stop it has 44px controls' + (smallEdit.length ? ` (too small: ${smallEdit})` : ''), smallEdit.length === 0);
page.once('dialog', (d) => d.accept());
await dialog.getByRole('button', { name: 'Stop coming back every year' }).click(); await wait(1800);
say('stopping it takes Yearly off, and brings Do it again back', !/Yearly/.test(await text()) && await page.getByRole('button', { name: 'Do it again' }).isVisible());

say('no request failed' + (bad.length ? `: ${bad.join(' | ')}` : ''), bad.length === 0);
await browser.close();
